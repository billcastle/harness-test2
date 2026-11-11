import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeDeleted } from '../src/repo/transactions.js';
import { upsertMerchantRule } from '../src/repo/categories.js';
import { testApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await testApp(); // clock: 2026-11-15 12:00 Manila
});
beforeEach(async () => {
  await t.reset();
});

const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
  const res = await t.app.inject({ method, url, payload: payload as object | undefined });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const addTx = (over: Record<string, unknown> = {}) => call('POST', '/api/transactions', { amount: '100', date: '2026-11-10', ...over });
const addCat = async (name: string) => (await call('POST', '/api/categories', { name })).body.id as number;

describe('categories', () => {
  it('starts with only the system Uncategorized category', async () => {
    const r = await call('GET', '/api/categories');
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ name: 'Uncategorized', isSystem: true });
  });

  it('creates, renames, recolors, and rejects duplicate names (case-insensitive)', async () => {
    const id = await addCat('Food');
    expect((await call('PATCH', `/api/categories/${id}`, { name: 'Groceries', color: '#112233' })).body).toMatchObject({ name: 'Groceries', color: '#112233' });
    expect((await call('POST', '/api/categories', { name: 'GROCERIES' })).status).toBe(409);
    expect((await call('POST', '/api/categories', { name: '' })).status).toBe(400);
    expect((await call('POST', '/api/categories', { name: 'X', color: 'red' })).status).toBe(400);
  });

  it('cannot rename or delete Uncategorized (409 from the service, not just the trigger)', async () => {
    const sys = (await call('GET', '/api/categories')).body.items[0].id;
    expect((await call('PATCH', `/api/categories/${sys}`, { name: 'Other' })).status).toBe(409);
    expect((await call('DELETE', `/api/categories/${sys}`)).status).toBe(409);
  });

  it('deleting a category reassigns its transactions and merchant rules to Uncategorized, in one step', async () => {
    const food = await addCat('Food');
    const tx = (await addTx({ categoryId: food, description: 'Jollibee' })).body;
    await upsertMerchantRule(t.db, 'Jollibee', food);
    const del = await call('DELETE', `/api/categories/${food}`);
    expect(del.body).toEqual({ reassignedTransactions: 1, reassignedRules: 1 });
    const moved = (await call('GET', `/api/transactions?categoryId=${food}`)).body;
    expect(moved.total).toBe(0);
    const all = (await call('GET', '/api/transactions')).body.items.find((x: { id: number }) => x.id === tx.id);
    expect(all.categoryName).toBe('Uncategorized');
    expect((await call('GET', '/api/merchant-rules')).body.items[0].categoryId).toBe(all.categoryId);
    expect((await call('DELETE', `/api/categories/${food}`)).status).toBe(404);
  });

  it('merchant rule upsert keeps one row per normalized merchant and the latest category wins', async () => {
    const a = await addCat('A');
    const b = await addCat('B');
    await upsertMerchantRule(t.db, '  Shopee   PAYMENT ', a);
    await upsertMerchantRule(t.db, 'shopee payment', b);
    const rules = (await call('GET', '/api/merchant-rules')).body.items;
    expect(rules).toEqual([{ merchant: 'shopee payment', categoryId: b }]);
    expect((await call('DELETE', '/api/merchant-rules?merchant=shopee%20payment')).status).toBe(204);
    expect((await call('DELETE', '/api/merchant-rules?merchant=shopee%20payment')).status).toBe(404);
  });
});

describe('transactions', () => {
  it('creates with defaults: today in Manila, Uncategorized, kind expense, manual source', async () => {
    const r = await call('POST', '/api/transactions', { amount: '250.50' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ date: '2026-11-15', amountCentavos: 25050, categoryName: 'Uncategorized', kind: 'expense', source: 'manual', description: '' });
  });

  it.each([
    [{ amount: '250.555' }, /decimals/],
    [{ amount: '-5' }, /amount/],
    [{ amount: '₱250' }, /amount/],
    [{}, /amount is required/],
    [{ amount: '5', date: '2026-02-30' }, /real date/],
    [{ amount: '5', kind: 'bogus' }, /kind/],
    [{ amount: '5', categoryId: 9999 }, /category does not exist/],
    [{ amount: '5', categoryId: 'x' }, /categoryId/],
    [{ amount: '5', description: 'x'.repeat(501) }, /description/],
  ])('rejects bad input %j', async (body, msg) => {
    const r = await call('POST', '/api/transactions', body);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(msg);
  });

  it('edits a field in place and bumps updated_at only through the service', async () => {
    const tx = (await addTx({ description: 'old' })).body;
    const r = await call('PATCH', `/api/transactions/${tx.id}`, { amount: '1,250.50', description: 'new', kind: 'refund' });
    expect(r.body).toMatchObject({ amountCentavos: 125050, description: 'new', kind: 'refund' });
    expect((await call('PATCH', `/api/transactions/${tx.id}`, {})).status).toBe(400);
    expect((await call('PATCH', '/api/transactions/99999', { amount: '5' })).status).toBe(404);
    expect((await call('PATCH', '/api/transactions/abc', { amount: '5' })).status).toBe(400);
  });

  it('lists newest first with a stable order (date desc, id desc) and paginates 50 per page without gaps or repeats', async () => {
    for (let i = 0; i < 55; i++) await addTx({ amount: '1', date: i % 2 ? '2026-11-02' : '2026-11-01' }); // many ties on date
    const p1 = (await call('GET', '/api/transactions?page=1')).body;
    const p2 = (await call('GET', '/api/transactions?page=2')).body;
    expect(p1.total).toBe(55);
    expect(p1.items).toHaveLength(50);
    expect(p2.items).toHaveLength(5);
    const ids = [...p1.items, ...p2.items].map((x: { id: number }) => x.id);
    expect(new Set(ids).size).toBe(55);
    const keys = [...p1.items, ...p2.items].map((x: { date: string; id: number }) => `${x.date}|${String(x.id).padStart(6, '0')}`);
    expect(keys).toEqual([...keys].sort().reverse());
    expect((await call('GET', '/api/transactions?page=0')).status).toBe(400);
  });

  it('filters by inclusive date range, category and description search (including LIKE wildcards literally)', async () => {
    const food = await addCat('Food');
    await addTx({ date: '2026-11-01', description: 'Jollibee', categoryId: food });
    await addTx({ date: '2026-11-30', description: '100% juice' });
    await addTx({ date: '2026-12-01', description: 'next month' });
    expect((await call('GET', '/api/transactions?from=2026-11-01&to=2026-11-30')).body.total).toBe(2); // both ends inclusive
    expect((await call('GET', `/api/transactions?categoryId=${food}`)).body.total).toBe(1);
    expect((await call('GET', '/api/transactions?q=jolli')).body.total).toBe(1);
    expect((await call('GET', '/api/transactions?q=100%25')).body.total).toBe(1); // "%" is matched literally
    expect((await call('GET', '/api/transactions?q=%25')).body.total).toBe(1); // not "match everything"
    expect((await call('GET', '/api/transactions?from=bad')).status).toBe(400);
  });

  it('soft delete hides the row, restore brings it back, and purge removes only rows deleted before the cutoff', async () => {
    const a = (await addTx()).body;
    const b = (await addTx()).body;
    expect((await call('DELETE', `/api/transactions/${a.id}`)).status).toBe(204);
    expect((await call('DELETE', `/api/transactions/${a.id}`)).status).toBe(404); // already deleted
    expect((await call('GET', '/api/transactions')).body.total).toBe(1);
    expect((await call('POST', `/api/transactions/${a.id}/restore`)).body.id).toBe(a.id);
    expect((await call('GET', '/api/transactions')).body.total).toBe(2);
    expect((await call('POST', `/api/transactions/${a.id}/restore`)).status).toBe(404); // not deleted

    await call('DELETE', `/api/transactions/${b.id}`);
    expect(await purgeDeleted(t.db, new Date(Date.now() - 24 * 3_600_000))).toBe(0); // deleted just now: kept for Undo
    expect(await purgeDeleted(t.db, new Date(Date.now() + 60_000))).toBe(1); // cutoff in the future: purged
    expect((await call('POST', `/api/transactions/${b.id}/restore`)).status).toBe(404);
  });
});

describe('summary', () => {
  it('defaults to this month in Manila and sums expenses minus refunds; income/transfer/ignored/deleted never count', async () => {
    const food = await addCat('Food');
    await addTx({ amount: '1000', date: '2026-11-03', categoryId: food });
    await addTx({ amount: '250.50', date: '2026-11-04' });
    await addTx({ amount: '300', date: '2026-11-05', kind: 'refund', categoryId: food });
    await addTx({ amount: '5000', date: '2026-11-06', kind: 'income' });
    await addTx({ amount: '9000', date: '2026-11-07', kind: 'transfer' });
    await addTx({ amount: '7000', date: '2026-11-08', kind: 'ignored' });
    await addTx({ amount: '999', date: '2026-10-31' }); // previous month
    const del = (await addTx({ amount: '400', date: '2026-11-09' })).body;
    await call('DELETE', `/api/transactions/${del.id}`);

    const s = (await call('GET', '/api/summary')).body;
    expect(s.from).toBe('2026-11-01');
    expect(s.to).toBe('2026-11-30');
    expect(s.netCentavos).toBe(100_000 + 25_050 - 30_000);
    expect(s.count).toBe(3); // two expenses and one refund
    expect(s.byCategory).toEqual([
      expect.objectContaining({ name: 'Food', netCentavos: 70_000 }),
      expect.objectContaining({ name: 'Uncategorized', netCentavos: 25_050 }),
    ]);
    expect(s.trend.granularity).toBe('day');
    expect(s.trend.points).toEqual([
      { bucket: '2026-11-03', netCentavos: 100_000 },
      { bucket: '2026-11-04', netCentavos: 25_050 },
      { bucket: '2026-11-05', netCentavos: -30_000 },
    ]);
  });

  it('empty range returns zeros, not errors', async () => {
    const s = (await call('GET', '/api/summary')).body;
    expect(s).toMatchObject({ netCentavos: 0, count: 0, byCategory: [], trend: { granularity: 'day', points: [] } });
  });

  it('a refunds-only range has a negative net and a negative category total', async () => {
    const food = await addCat('Food');
    await addTx({ amount: '120', kind: 'refund', categoryId: food });
    const s = (await call('GET', '/api/summary')).body;
    expect(s.netCentavos).toBe(-12_000);
    expect(s.byCategory[0]).toMatchObject({ name: 'Food', netCentavos: -12_000 });
  });

  it('trend switches from daily to monthly at 63 days (62 days is still daily)', async () => {
    await addTx({ amount: '10', date: '2026-01-15' });
    await addTx({ amount: '20', date: '2026-02-20' });
    const daily = (await call('GET', '/api/summary?from=2026-01-01&to=2026-03-03')).body; // 62 days
    expect(daily.trend.granularity).toBe('day');
    const monthly = (await call('GET', '/api/summary?from=2026-01-01&to=2026-03-04')).body; // 63 days
    expect(monthly.trend).toEqual({
      granularity: 'month',
      points: [{ bucket: '2026-01', netCentavos: 1000 }, { bucket: '2026-02', netCentavos: 2000 }],
    });
  });

  it('range ends are inclusive and validated', async () => {
    await addTx({ amount: '10', date: '2026-11-01' });
    await addTx({ amount: '20', date: '2026-11-30' });
    expect((await call('GET', '/api/summary?from=2026-11-01&to=2026-11-30')).body.netCentavos).toBe(3000);
    expect((await call('GET', '/api/summary?from=2026-11-02&to=2026-11-29')).body.netCentavos).toBe(0);
    expect((await call('GET', '/api/summary?from=2026-11-30&to=2026-11-01')).status).toBe(400);
    expect((await call('GET', '/api/summary?from=2026-11-01')).status).toBe(400);
  });
});

describe('Manila "this month" at a month boundary', () => {
  it('23:30 UTC on Oct 31 already shows November in the default range', async () => {
    const late = await testApp(() => new Date('2026-10-31T23:30:00Z'));
    const res = await late.app.inject({ method: 'GET', url: '/api/summary' });
    expect(JSON.parse(res.body)).toMatchObject({ from: '2026-11-01', to: '2026-11-30' });
    const created = await late.app.inject({ method: 'POST', url: '/api/transactions', payload: { amount: '5' } });
    expect(JSON.parse(created.body).date).toBe('2026-11-01');
  });
});

describe('error handling', () => {
  it('returns JSON errors, never stack traces or request bodies', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/transactions', payload: '{bad json', headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body)).toHaveProperty('error');
    expect(r.body).not.toMatch(/at \w+ \(/);
  });
});
