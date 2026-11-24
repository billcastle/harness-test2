// In-memory stand-in for the server API, shaped exactly like the real responses (see server/src/app.ts).
// Server behavior itself is covered by the server's own tests; this only lets the UI tests run fast and deterministically.
import { vi } from 'vitest';
import { checkAmount } from '../src/lib/money';
import type { Category, ImportBatch, Kind, MerchantRule, Preview, Recurring, Transaction } from '../src/lib/api';

export interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
  contentType?: string | null;
  file?: File | null;
}

// A small stand-in for the server's insights: enough for page tests. The real rules are tested on the server.
function fakeRecurringSummary(items: Recurring[]) {
  const lines = items.filter((r) => !r.ended).map((r) => ({ id: r.id, description: r.description, categoryName: r.categoryName, frequency: r.frequency, amountCentavos: r.amountCentavos, costCentavos: r.perMonthCentavos }));
  return { totalCentavos: lines.reduce((s, l) => s + l.costCentavos, 0), items: lines };
}

function fakeInsights(rows: Transaction[], net: (t: Transaction) => number, days: number) {
  const expenses = rows.filter((t) => t.kind === 'expense');
  const sum = expenses.reduce((s, t) => s + t.amountCentavos, 0);
  const largest = expenses.reduce<Transaction | null>((b, t) => (!b || t.amountCentavos > b.amountCentavos ? t : b), null);
  const total = rows.reduce((s, t) => s + net(t), 0);
  return {
    elapsedDays: days, averagePerDayCentavos: Math.round(total / days), averageExpenseCentavos: expenses.length ? Math.round(sum / expenses.length) : 0,
    medianExpenseCentavos: expenses.length ? [...expenses].map((t) => t.amountCentavos).sort((a, b) => a - b)[expenses.length >> 1]! : 0,
    largest: largest && { id: largest.id, date: largest.date, description: largest.description, amountCentavos: largest.amountCentavos, categoryName: largest.categoryName },
    topExpenses: [...expenses].sort((a, b) => b.amountCentavos - a.amountCentavos).slice(0, 10).map((t) => ({ id: t.id, date: t.date, description: t.description, amountCentavos: t.amountCentavos, categoryName: t.categoryName })),
    mostFrequent: null, topBySpend: null, busiestDay: null, priciestWeekday: null, small: null, recurring: [], uncategorized: null, refunds: null, previous: null,
  };
}

export function createFakeApi(seed: { categories?: Category[]; transactions?: Partial<Transaction>[]; recurring?: Partial<Recurring>[]; signedIn?: boolean } = {}) {
  const categories: Category[] = seed.categories ?? [
    { id: 1, name: 'Uncategorized', color: '#94a3b8', isSystem: true, transactionCount: 0, ruleCount: 0 },
    { id: 2, name: 'Food', color: '#16a34a', isSystem: false, transactionCount: 0, ruleCount: 0 },
    { id: 3, name: 'Transport', color: '#2563eb', isSystem: false, transactionCount: 0, ruleCount: 0 },
  ];
  let nextId = 100;
  const txs: (Transaction & { deleted?: boolean })[] = (seed.transactions ?? []).map((t) => ({
    id: nextId++, date: '2026-11-10', amountCentavos: 10000, description: '', categoryId: 1, categoryName: 'Uncategorized', source: 'manual', kind: 'expense' as Kind, importBatchId: null, ...t,
  }));
  const recurring: Recurring[] = (seed.recurring ?? []).map((r) => {
    const base = { id: nextId++, description: 'Netflix', amountCentavos: 54900, frequency: 'monthly' as const, categoryId: 1, categoryName: 'Uncategorized', startDate: '2026-01-01', endDate: null, nextDue: '2026-12-01', ended: false, ...r };
    return { perMonthCentavos: base.frequency === 'yearly' ? Math.round(base.amountCentavos / 12) : base.amountCentavos, ...base };
  });
  const state = { signedIn: seed.signedIn ?? true, pin: '4821', preview: null as Preview | null, batches: [] as ImportBatch[], rules: [] as MerchantRule[], calls: [] as Call[], failures: [] as { match: RegExp; status: number; error: string; once: boolean; retryAfterSeconds?: number }[], delayMs: 0 };

  const json = (status: number, body: unknown) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? 'Uncategorized';

  async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const isFile = typeof File !== 'undefined' && init?.body instanceof File;
    const body = init?.body && !isFile ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    state.calls.push({ method, url: url.pathname + url.search, body, contentType: headers['content-type'] ?? null, file: isFile ? (init!.body as File) : null });
    if (state.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, state.delayMs);
        init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
      });
    }
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
    if (p === '/api/categories' && method === 'GET') {
      const withCounts = categories.map((c) => ({ ...c, transactionCount: txs.filter((t) => !t.deleted && t.categoryId === c.id).length, ruleCount: state.rules.filter((r) => r.categoryId === c.id).length }));
      return json(200, { items: withCounts });
    }
    if (p === '/api/categories' && method === 'POST') {
      const name = String(body?.name ?? '').trim();
      if (!name || name.length > 60) return json(400, { error: 'name must be 1 to 60 characters' });
      if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return json(409, { error: 'a category with that name already exists' });
      const c: Category = { id: nextId++, name, color: String(body?.color ?? '#64748b'), isSystem: false, transactionCount: 0, ruleCount: 0 };
      categories.push(c);
      return json(201, c);
    }
    const cm = /^\/api\/categories\/(\d+)$/.exec(p);
    if (cm) {
      const c = categories.find((x) => x.id === Number(cm[1]));
      if (!c) return json(404, { error: 'category not found' });
      if (method === 'PATCH') {
        if (body?.name !== undefined) {
          if (c.isSystem) return json(409, { error: 'the Uncategorized category cannot be renamed' });
          const name = String(body.name).trim();
          if (categories.some((x) => x !== c && x.name.toLowerCase() === name.toLowerCase())) return json(409, { error: 'a category with that name already exists' });
          c.name = name;
          txs.filter((t) => t.categoryId === c.id).forEach((t) => (t.categoryName = name));
        }
        if (body?.color !== undefined) c.color = String(body.color);
        return json(200, c);
      }
      if (method === 'DELETE') {
        if (c.isSystem) return json(409, { error: 'the Uncategorized category cannot be deleted' });
        const moved = txs.filter((t) => t.categoryId === c.id);
        moved.forEach((t) => { t.categoryId = 1; t.categoryName = 'Uncategorized'; });
        const movedRules = state.rules.filter((r) => r.categoryId === c.id);
        movedRules.forEach((r) => (r.categoryId = 1));
        categories.splice(categories.indexOf(c), 1);
        return json(200, { reassignedTransactions: moved.length, reassignedRules: movedRules.length });
      }
    }
    if (p === '/api/merchant-rules' && method === 'GET') return json(200, { items: state.rules });
    if (p === '/api/merchant-rules' && method === 'DELETE') {
      const m = url.searchParams.get('merchant');
      const r = state.rules.find((x) => x.merchant === m);
      if (!r) return json(404, { error: 'rule not found' });
      state.rules = state.rules.filter((x) => x !== r);
      return json(204, null);
    }

    // ---- statement import
    if (p === '/api/import/parse' && method === 'POST') return state.preview ? json(200, state.preview) : json(422, { error: 'no preview configured', code: 'unreadable' });
    if (p === '/api/import/confirm' && method === 'POST') {
      const rows = (body?.rows as unknown[]) ?? [];
      return json(201, { batchId: body?.batchId, inserted: rows.length, alreadyImported: false });
    }
    if (p === '/api/import/batches' && method === 'GET') return json(200, { items: state.batches });
    const bm = /^\/api\/import\/batches\/([^/]+)$/.exec(p);
    if (bm && method === 'DELETE') {
      const b = state.batches.find((x) => x.id === bm[1]);
      if (!b) return json(404, { error: 'import not found' });
      state.batches = state.batches.filter((x) => x !== b);
      return json(200, { deleted: b.count });
    }

    if (p === '/api/summary' && method === 'GET') {
      const from = url.searchParams.get('from') ?? '0000-01-01';
      const to = url.searchParams.get('to') ?? '9999-12-31';
      const rows = txs.filter((t) => !t.deleted && (t.kind === 'expense' || t.kind === 'refund') && t.date >= from && t.date <= to);
      const net = (t: Transaction) => (t.kind === 'refund' ? -t.amountCentavos : t.amountCentavos);
      const by = new Map<number, number>();
      const byDay = new Map<string, number>();
      for (const t of rows) { by.set(t.categoryId, (by.get(t.categoryId) ?? 0) + net(t)); byDay.set(t.date, (byDay.get(t.date) ?? 0) + net(t)); }
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
      const monthly = days > 62;
      const buckets = new Map<string, number>();
      for (const [d, v] of byDay) { const b = monthly ? d.slice(0, 7) : d; buckets.set(b, (buckets.get(b) ?? 0) + v); }
      return json(200, {
        from, to, netCentavos: rows.reduce((s, t) => s + net(t), 0) + fakeRecurringSummary(recurring).totalCentavos, count: rows.length,
        byCategory: [...by].map(([id, v]) => ({ categoryId: id, name: catName(id), color: categories.find((c) => c.id === id)?.color ?? '#94a3b8', netCentavos: v })).sort((a, b) => b.netCentavos - a.netCentavos),
        trend: { granularity: monthly ? 'month' : 'day', points: [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, v]) => ({ bucket, netCentavos: v })) },
        recurring: fakeRecurringSummary(recurring),
        insights: fakeInsights(rows, net, days),
      });
    }
    if (p === '/api/recurring' && method === 'GET') return json(200, { items: recurring });
    if (p === '/api/recurring' && method === 'POST') {
      const err = checkAmount(String(body?.amount ?? ''));
      if (err) return json(400, { error: err });
      const amountCentavos = Math.round(Number(String(body?.amount).replace(/,/g, '')) * 100);
      const frequency = (body?.frequency as Recurring['frequency']) ?? 'monthly';
      const r: Recurring = {
        id: nextId++, description: String(body?.description ?? ''), amountCentavos, frequency, categoryId: Number(body?.categoryId ?? 1), categoryName: catName(Number(body?.categoryId ?? 1)),
        startDate: String(body?.startDate ?? '2026-11-01'), endDate: (body?.endDate as string | null) ?? null, perMonthCentavos: frequency === 'yearly' ? Math.round(amountCentavos / 12) : amountCentavos,
        nextDue: '2026-12-01', ended: false,
      };
      recurring.push(r);
      return json(201, r);
    }
    const rm = /^\/api\/recurring\/(\d+)$/.exec(p);
    if (rm) {
      const r = recurring.find((x) => x.id === Number(rm[1]));
      if (!r) return json(404, { error: 'recurring expense not found' });
      if (method === 'DELETE') { recurring.splice(recurring.indexOf(r), 1); return json(204, null); }
      if (method === 'PATCH') {
        if (body?.description !== undefined) r.description = String(body.description);
        if (body?.amount !== undefined) { r.amountCentavos = Math.round(Number(String(body.amount).replace(/,/g, '')) * 100); }
        if (body?.frequency !== undefined) r.frequency = body.frequency as Recurring['frequency'];
        if (body?.categoryId !== undefined) { r.categoryId = Number(body.categoryId); r.categoryName = catName(r.categoryId); }
        if (body?.endDate !== undefined) r.endDate = body.endDate as string | null;
        r.perMonthCentavos = r.frequency === 'yearly' ? Math.round(r.amountCentavos / 12) : r.amountCentavos;
        return json(200, r);
      }
    }
    if (p === '/api/transactions' && method === 'GET') {
      const q = url.searchParams;
      let rows = txs.filter((t) => !t.deleted);
      if (q.get('date')) rows = rows.filter((t) => t.date === q.get('date'));
      else {
        if (q.get('from')) rows = rows.filter((t) => t.date >= q.get('from')!);
        if (q.get('to')) rows = rows.filter((t) => t.date <= q.get('to')!);
      }
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
    if ((p === '/api/transactions/batch-delete' || p === '/api/transactions/batch-restore') && method === 'POST') {
      const del = p.endsWith('delete');
      const hit = txs.filter((t) => (body!.ids as number[]).includes(t.id) && Boolean(t.deleted) === !del);
      for (const t of hit) t.deleted = del;
      return json(200, del ? { deleted: hit.length } : { restored: hit.length });
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
