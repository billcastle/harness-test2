// In-memory stand-in for the server API, shaped exactly like the real responses (see server/src/app.ts).
// Server behavior itself is covered by the server's own tests; this only lets the UI tests run fast and deterministically.
import { vi } from 'vitest';
import { checkAmount } from '../src/lib/money';
import type { Category, Kind, Transaction } from '../src/lib/api';

export interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

export function createFakeApi(seed: { categories?: Category[]; transactions?: Partial<Transaction>[]; signedIn?: boolean } = {}) {
  const categories: Category[] = seed.categories ?? [
    { id: 1, name: 'Uncategorized', color: '#94a3b8', isSystem: true },
    { id: 2, name: 'Food', color: '#16a34a', isSystem: false },
    { id: 3, name: 'Transport', color: '#2563eb', isSystem: false },
  ];
  let nextId = 100;
  const txs: (Transaction & { deleted?: boolean })[] = (seed.transactions ?? []).map((t) => ({
    id: nextId++, date: '2026-11-10', amountCentavos: 10000, description: '', categoryId: 1, categoryName: 'Uncategorized', source: 'manual', kind: 'expense' as Kind, importBatchId: null, ...t,
  }));
  const state = { signedIn: seed.signedIn ?? true, pin: '4821', calls: [] as Call[], failures: [] as { match: RegExp; status: number; error: string; once: boolean; retryAfterSeconds?: number }[], delayMs: 0 };

  const json = (status: number, body: unknown) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? 'Uncategorized';

  async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    state.calls.push({ method, url: url.pathname + url.search, body });
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    const key = `${method} ${url.pathname}${url.search}`;
    const f = state.failures.find((x) => x.match.test(key));
    if (f) {
      if (f.once) state.failures.splice(state.failures.indexOf(f), 1);
      return json(f.status, { error: f.error, ...(f.retryAfterSeconds ? { retryAfterSeconds: f.retryAfterSeconds } : {}) });
    }
    const p = url.pathname;
    if (p === '/api/login') {
      if (body?.pin === state.pin) { state.signedIn = true; return json(200, { ok: true }); }
      return json(401, { error: 'wrong PIN' });
    }
    if (!state.signedIn) return json(401, { error: 'not signed in' });
    if (p === '/api/session') return json(200, { authenticated: true });
    if (p === '/api/logout') { state.signedIn = false; return json(200, { ok: true }); }
    if (p === '/api/categories') return json(200, { items: categories });

    if (p === '/api/transactions' && method === 'GET') {
      const q = url.searchParams;
      let rows = txs.filter((t) => !t.deleted);
      if (q.get('from')) rows = rows.filter((t) => t.date >= q.get('from')!);
      if (q.get('to')) rows = rows.filter((t) => t.date <= q.get('to')!);
      if (q.get('categoryId')) rows = rows.filter((t) => t.categoryId === Number(q.get('categoryId')));
      if (q.get('q')) rows = rows.filter((t) => t.description.toLowerCase().includes(q.get('q')!.toLowerCase()));
      rows.sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
      const page = Number(q.get('page') ?? 1);
      return json(200, { items: rows.slice((page - 1) * 50, page * 50), total: rows.length, page, pageSize: 50 });
    }
    if (p === '/api/transactions' && method === 'POST') {
      const err = checkAmount(String(body?.amount ?? ''));
      if (err) return json(400, { error: err });
      const categoryId = (body?.categoryId as number | undefined) ?? 1;
      const tx: Transaction = {
        id: nextId++, date: String(body?.date), amountCentavos: Math.round(Number(String(body?.amount).replace(/,/g, '')) * 100), description: String(body?.description ?? ''),
        categoryId, categoryName: catName(categoryId), source: 'manual', kind: 'expense', importBatchId: null,
      };
      txs.push(tx);
      return json(201, tx);
    }
    const m = /^\/api\/transactions\/(\d+)(\/restore)?$/.exec(p);
    if (m) {
      const tx = txs.find((t) => t.id === Number(m[1]));
      if (!tx) return json(404, { error: 'transaction not found' });
      if (m[2]) { tx.deleted = false; return json(200, tx); }
      if (method === 'DELETE') { tx.deleted = true; return json(204, null); }
      if (method === 'PATCH') {
        if (body?.amount !== undefined) tx.amountCentavos = Math.round(Number(String(body.amount).replace(/,/g, '')) * 100);
        if (body?.description !== undefined) tx.description = String(body.description);
        if (body?.date !== undefined) tx.date = String(body.date);
        if (body?.kind !== undefined) tx.kind = body.kind as Kind;
        if (body?.categoryId !== undefined) { tx.categoryId = body.categoryId as number; tx.categoryName = catName(tx.categoryId); }
        return json(200, tx);
      }
    }
    return json(404, { error: 'not found' });
  }

  const fetchMock = vi.fn(handle);
  return {
    state, txs, categories, fetchMock,
    install: () => vi.stubGlobal('fetch', fetchMock),
    failNext: (match: RegExp, status: number, error: string, extra: { retryAfterSeconds?: number } = {}) =>
      state.failures.push({ match, status, error, once: true, ...extra }),
    failAlways: (match: RegExp, status: number, error: string) => state.failures.push({ match, status, error, once: false }),
    clearFailures: () => (state.failures.length = 0),
    callsTo: (method: string, pathPart: string) => state.calls.filter((c) => c.method === method && c.url.includes(pathPart)),
  };
}
export type FakeApi = ReturnType<typeof createFakeApi>;
