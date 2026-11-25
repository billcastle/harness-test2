// Thin typed client for the server API. The server is authoritative for every rule; this only shapes requests.
export type Kind = 'expense' | 'income' | 'refund' | 'transfer' | 'ignored';
export const KINDS: Kind[] = ['expense', 'income', 'refund', 'transfer', 'ignored'];

export interface Category {
  id: number;
  name: string;
  color: string;
  isSystem: boolean;
  /** Live transactions in this category. */
  transactionCount: number;
  /** Remembered merchants pointing at this category. */
  ruleCount: number;
}
export interface MerchantRule {
  merchant: string;
  categoryId: number;
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
  /** One exact day; wins over from and to. */
  date?: string;
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

export interface Trends {
  months: string[];
  series: { categoryId: number; name: string; color: string; centavos: number[] }[];
  totals: number[];
}

export interface Summary {
  from: string;
  to: string;
  /** Expenses minus refunds. */
  netCentavos: number;
  count: number;
  byCategory: { categoryId: number; name: string; color: string; netCentavos: number }[];
  trend: { granularity: 'day' | 'month'; points: { bucket: string; netCentavos: number }[] };
  /** Subscriptions and bills already counted in netCentavos and byCategory. */
  recurring: { totalCentavos: number; items: RecurringLine[] };
  insights: Insights;
}

export type Frequency = 'monthly' | 'yearly';
export const FREQUENCY_LABEL: Record<Frequency, string> = { monthly: 'Every month', yearly: 'Every year' };
export interface RecurringLine {
  id: number;
  description: string;
  categoryName: string;
  frequency: Frequency;
  /** The bill as entered (the yearly amount for a yearly bill). */
  amountCentavos: number;
  /** What it adds to the period being viewed. */
  costCentavos: number;
}
export interface Recurring {
  id: number;
  description: string;
  amountCentavos: number;
  frequency: Frequency;
  categoryId: number;
  categoryName: string;
  startDate: string;
  endDate: string | null;
  /** The amount, or a twelfth of it for a yearly bill. */
  perMonthCentavos: number;
  nextDue: string | null;
  ended: boolean;
}
export interface RecurringInput {
  description?: string;
  amount?: string;
  frequency?: Frequency;
  categoryId?: number;
  startDate?: string;
  endDate?: string | null;
}

export interface ExpenseRef { id: number; date: string; description: string; amountCentavos: number; categoryName: string }
export interface MerchantStat {
  name: string;
  count: number;
  totalCentavos: number;
}
/** Facts about the period, computed on the server. Each part is null (or empty) when there is not enough data. */
export interface Insights {
  elapsedDays: number;
  averagePerDayCentavos: number;
  averageExpenseCentavos: number;
  medianExpenseCentavos: number;
  largest: ExpenseRef | null;
  /** The ten biggest expenses, highest first. */
  topExpenses: ExpenseRef[];
  mostFrequent: MerchantStat | null;
  topBySpend: MerchantStat | null;
  busiestDay: { date: string; totalCentavos: number; count: number } | null;
  /** 0 = Sunday. */
  priciestWeekday: { weekday: number; totalCentavos: number } | null;
  small: { thresholdCentavos: number; count: number; totalCentavos: number } | null;
  recurring: { name: string; amountCentavos: number; months: number }[];
  uncategorized: { count: number; totalCentavos: number } | null;
  refunds: { count: number; totalCentavos: number } | null;
  previous: { from: string; to: string; netCentavos: number } | null;
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
  guessed?: boolean;
  include: boolean;
}
export interface ParseIssue {
  page?: number;
  reason: string;
  text?: string;
  date?: string;
}
/** A purchase and the refund that undid it: together they cost nothing, so neither is offered for import. */
export interface CancelledPair {
  description: string;
  amountCentavos: number;
  paidOn: string;
  refundedOn: string;
}
/** A row that is not spending (a credit card payment), so it is not offered for import. */
export interface LeftOut {
  description: string;
  date: string;
  amountCentavos: number;
  reason: string;
}
export interface Preview {
  batchId: string;
  bank: Bank;
  rows: PreviewRow[];
  cancelled: CancelledPair[];
  leftOut: LeftOut[];
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
  createCategory: (input: { name: string; color?: string }) => request<Category>('POST', '/api/categories', input),
  updateCategory: (id: number, input: { name?: string; color?: string }) => request<Category>('PATCH', `/api/categories/${id}`, input),
  deleteCategory: (id: number) => request<{ reassignedTransactions: number; reassignedRules: number }>('DELETE', `/api/categories/${id}`),
  merchantRules: () => request<{ items: MerchantRule[] }>('GET', '/api/merchant-rules').then((r) => r.items),
  deleteMerchantRule: (merchant: string) => request<void>('DELETE', `/api/merchant-rules?merchant=${encodeURIComponent(merchant)}`),
  recurring: () => request<{ items: Recurring[] }>('GET', '/api/recurring').then((r) => r.items),
  createRecurring: (input: RecurringInput) => request<Recurring>('POST', '/api/recurring', input),
  updateRecurring: (id: number, input: RecurringInput) => request<Recurring>('PATCH', `/api/recurring/${id}`, input),
  deleteRecurring: (id: number) => request<void>('DELETE', `/api/recurring/${id}`),
  trends: (to: string, months: number) => request<Trends>('GET', `/api/trends?${qs({ to, months })}`),
  summary: (from: string, to: string) => request<Summary>('GET', `/api/summary?${qs({ from, to })}`),
  transactions: (f: TransactionFilter) =>
    request<TransactionPage>('GET', `/api/transactions?${qs({ from: f.from, to: f.to, q: f.q, categoryId: f.categoryId, batchId: f.batchId, date: f.date, page: f.page })}`),
  createTransaction: (input: TransactionInput) => request<Transaction>('POST', '/api/transactions', input),
  updateTransaction: (id: number, input: TransactionInput) => request<Transaction>('PATCH', `/api/transactions/${id}`, input),
  deleteTransaction: (id: number) => request<void>('DELETE', `/api/transactions/${id}`),
  deleteTransactions: (ids: number[]) => request<{ deleted: number }>('POST', '/api/transactions/batch-delete', { ids }),
  restoreTransactions: (ids: number[]) => request<{ restored: number }>('POST', '/api/transactions/batch-restore', { ids }),
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
