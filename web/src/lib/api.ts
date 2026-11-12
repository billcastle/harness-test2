// Thin typed client for the server API. The server is authoritative for every rule; this only shapes requests.
export type Kind = 'expense' | 'income' | 'refund' | 'transfer' | 'ignored';
export const KINDS: Kind[] = ['expense', 'income', 'refund', 'transfer', 'ignored'];

export interface Category {
  id: number;
  name: string;
  color: string;
  isSystem: boolean;
}
export interface Transaction {
  id: number;
  date: string;
  amountCentavos: number;
  description: string;
  categoryId: number;
  categoryName: string;
  source: string;
  kind: Kind;
  importBatchId: string | null;
}
export interface TransactionPage {
  items: Transaction[];
  total: number;
  page: number;
  pageSize: number;
}
export interface TransactionFilter {
  from?: string;
  to?: string;
  q?: string;
  categoryId?: number;
  batchId?: string;
  page?: number;
}
export interface TransactionInput {
  amount?: string;
  date?: string;
  description?: string;
  categoryId?: number;
  kind?: Kind;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterSeconds?: number,
    public code?: string,
  ) {
    super(message);
  }
}

/** Fired when any request comes back 401, so the app can return to the PIN screen without losing in-memory state. */
export const SESSION_EXPIRED = 'session-expired';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: string; retryAfterSeconds?: number; code?: string } | null;
  if (!res.ok) {
    if (res.status === 401 && !url.endsWith('/api/login')) window.dispatchEvent(new Event(SESSION_EXPIRED));
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.retryAfterSeconds, data?.code);
  }
  return data as T;
}

// ---- statement import
export type Bank = 'gcash' | 'bpi' | 'maribank';
export const BANK_LABEL: Record<Bank, string> = { gcash: 'GCash', bpi: 'BPI credit card', maribank: 'Maribank' };
export interface PreviewRow {
  index: number;
  /** Rows with the same key are "similar" (the server strips per-transaction reference numbers). */
  merchantKey: string;
  date: string;
  dateApprox?: boolean;
  description: string;
  direction: 'in' | 'out';
  amountCentavos: number;
  kind: Kind;
  reason: string;
  review?: boolean;
  occurrenceIndex: number;
  duplicateOf: number | null;
  suggestedCategoryId: number;
  fromRule: boolean;
  include: boolean;
}
export interface ParseIssue {
  page?: number;
  reason: string;
  text?: string;
  date?: string;
}
export interface Preview {
  batchId: string;
  bank: Bank;
  rows: PreviewRow[];
  errors: ParseIssue[];
  warnings: ParseIssue[];
  reconcile: { ok: boolean };
}
export interface ConfirmRow {
  date: string;
  description: string;
  amountCentavos: number;
  kind: Kind;
  categoryId: number;
  occurrenceIndex: number;
  remember: boolean;
}
export interface ImportBatch {
  id: string;
  source: Bank;
  importedAt: string;
  count: number;
  edited: number;
}

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
};

export const api = {
  session: () => request<{ authenticated: true }>('GET', '/api/session'),
  login: (pin: string) => request<{ ok: true }>('POST', '/api/login', { pin }),
  logout: () => request<{ ok: true }>('POST', '/api/logout'),
  categories: () => request<{ items: Category[] }>('GET', '/api/categories').then((r) => r.items),
  transactions: (f: TransactionFilter) =>
    request<TransactionPage>('GET', `/api/transactions?${qs({ from: f.from, to: f.to, q: f.q, categoryId: f.categoryId, batchId: f.batchId, page: f.page })}`),
  createTransaction: (input: TransactionInput) => request<Transaction>('POST', '/api/transactions', input),
  updateTransaction: (id: number, input: TransactionInput) => request<Transaction>('PATCH', `/api/transactions/${id}`, input),
  deleteTransaction: (id: number) => request<void>('DELETE', `/api/transactions/${id}`),
  restoreTransaction: (id: number) => request<Transaction>('POST', `/api/transactions/${id}/restore`),
  // The PDF is sent as the raw request body; the server checks the bytes, not the file name.
  parseStatement: async (file: File, bank: Bank | null, signal?: AbortSignal): Promise<Preview> => {
    const res = await fetch(`/api/import/parse${bank ? `?bank=${bank}` : ''}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/pdf' },
      body: file,
      signal,
    });
    const data = (await res.json().catch(() => null)) as (Preview & { error?: string; code?: string }) | null;
    if (!res.ok) {
      if (res.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED));
      throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, undefined, data?.code);
    }
    return data as Preview;
  },
  confirmImport: (input: { batchId: string; source: Bank; rows: ConfirmRow[] }) =>
    request<{ batchId: string; inserted: number; alreadyImported: boolean }>('POST', '/api/import/confirm', input),
  importBatches: () => request<{ items: ImportBatch[] }>('GET', '/api/import/batches').then((r) => r.items),
  undoImport: (id: string) => request<{ deleted: number }>('DELETE', `/api/import/batches/${id}`),
};
