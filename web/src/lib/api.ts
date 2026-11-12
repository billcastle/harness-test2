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
  from: string;
  to: string;
  q?: string;
  categoryId?: number;
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
  const data = (await res.json().catch(() => null)) as { error?: string; retryAfterSeconds?: number } | null;
  if (!res.ok) {
    if (res.status === 401 && !url.endsWith('/api/login')) window.dispatchEvent(new Event(SESSION_EXPIRED));
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.retryAfterSeconds);
  }
  return data as T;
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
    request<TransactionPage>('GET', `/api/transactions?${qs({ from: f.from, to: f.to, q: f.q, categoryId: f.categoryId, page: f.page })}`),
  createTransaction: (input: TransactionInput) => request<Transaction>('POST', '/api/transactions', input),
  updateTransaction: (id: number, input: TransactionInput) => request<Transaction>('PATCH', `/api/transactions/${id}`, input),
  deleteTransaction: (id: number) => request<void>('DELETE', `/api/transactions/${id}`),
  restoreTransaction: (id: number) => request<Transaction>('POST', `/api/transactions/${id}/restore`),
};
