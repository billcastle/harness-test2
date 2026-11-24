import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cronAuthorized } from '../src/vercel.js';
import { detectRecurring, runMonthlyMaintenance } from '../src/maintenance/monthly.js';
import { upsertMerchantRule } from '../src/repo/categories.js';
import { testDb } from './helpers.js';

const NOW = new Date('2026-11-15T04:00:00Z');
let t: Awaited<ReturnType<typeof testDb>>;
beforeAll(async () => { t = await testDb(); });
afterAll(async () => { await t.pg.close(); });
beforeEach(async () => { await t.reset(); });

const cat = async (name: string) => Number((await t.db.query<{ id: string }>('insert into categories (name) values ($1) returning id::text as id', [name])).rows[0]!.id);
const unc = async () => Number((await t.db.query<{ id: string }>('select id::text as id from categories where is_system')).rows[0]!.id);
const add = (date: string, amount: number, description: string, categoryId: number, kind = 'expense') =>
  t.db.query('insert into transactions (date, amount_centavos, description, category_id, kind) values ($1, $2, $3, $4, $5)', [date, amount, description, categoryId, kind]);
const live = async () => (await t.db.query<{ description: string; category_id: string }>('select description, category_id::text as category_id from transactions where deleted_at is null order by id')).rows;

describe('monthly maintenance', () => {
  it('categorizes by remembered merchant, then keyword guess, and leaves unsure rows alone', async () => {
    const u = await unc(); const transport = await cat('Transport'); const food = await cat('Food');
    await upsertMerchantRule(t.db, 'Mang Tomas', food);
    await add('2026-11-01', 20000, 'Payment to Grab', u);
    await add('2026-11-02', 30000, 'Mang Tomas', u);
    await add('2026-11-03', 40000, 'Payment to Juan', u);
    const r = await runMonthlyMaintenance(t.db, NOW);
    expect(r.categorized).toBe(2);
    expect((await live()).map((x) => Number(x.category_id))).toEqual([transport, food, u]);
  });

  it('never moves a transaction you already categorized', async () => {
    const u = await unc(); const food = await cat('Food'); await cat('Transport');
    await add('2026-11-01', 20000, 'Payment to Grab', food);
    await runMonthlyMaintenance(t.db, NOW);
    expect(Number((await live())[0]!.category_id)).toBe(food);
    expect(u).not.toBe(food);
  });

  it('tidies whitespace', async () => {
    await add('2026-11-01', 20000, '  Cafe   Uno ', await unc());
    expect((await runMonthlyMaintenance(t.db, NOW)).tidied).toBe(1);
    expect((await live())[0]!.description).toBe('Cafe Uno');
  });

  it('turns a monthly charge into a recurring expense once, and takes it out of the list', async () => {
    const subs = await cat('Subscriptions');
    for (const d of ['2026-08-05', '2026-09-05', '2026-10-05']) await add(d, 54900, 'Payment to Netflix', subs);
    await add('2026-10-20', 10000, 'Something else', subs);
    const r = await runMonthlyMaintenance(t.db, NOW);
    expect(r.recurringCreated).toEqual([{ description: 'Payment to Netflix', amountCentavos: 54900, frequency: 'monthly' }]);
    expect(r.transactionsMoved).toBe(3);
    expect((await live()).map((x) => x.description)).toEqual(['Something else']);
    const rec = (await t.db.query<{ start_date: string; category_id: string }>('select start_date::text as start_date, category_id::text as category_id from recurring_expenses')).rows;
    expect(rec).toEqual([{ start_date: '2026-08-05', category_id: String(subs) }]);
    const again = await runMonthlyMaintenance(t.db, NOW);
    expect(again).toMatchObject({ recurringCreated: [], transactionsMoved: 0, categorized: 0 });
  });

  it('does not add a recurring expense that exists, but still takes its charges out of the list', async () => {
    const subs = await cat('Subscriptions');
    await t.db.query(`insert into recurring_expenses (description, amount_centavos, frequency, category_id, start_date) values ('Netflix', 54900, 'monthly', $1, '2026-01-01')`, [subs]);
    for (const d of ['2026-08-05', '2026-09-05', '2026-10-05']) await add(d, 54900, 'Netflix', subs);
    const r = await runMonthlyMaintenance(t.db, NOW);
    expect(r.recurringCreated).toEqual([]);
    expect(r.transactionsMoved).toBe(3);
    expect((await t.db.query('select 1 from recurring_expenses')).rowCount).toBe(1);
  });

  it('remembers a merchant that always went to one category', async () => {
    const food = await cat('Food');
    for (const d of ['2026-11-01', '2026-11-02', '2026-11-03']) await add(d, 15000 + Number(d.slice(-1)), 'Cafe Uno', food);
    expect((await runMonthlyMaintenance(t.db, NOW)).rulesLearned).toBe(1);
    expect((await t.db.query<{ m: string }>('select merchant_normalized as m from merchant_rules')).rows).toEqual([{ m: 'cafe uno' }]);
  });
});

describe('detectRecurring', () => {
  const tx = (id: number, date: string, amount = 100, description = 'Gym') => ({ id, date, amount, description, categoryId: 1 });
  it('needs three consecutive months, one a month, still running', () => {
    expect(detectRecurring([tx(1, '2026-08-01'), tx(2, '2026-09-01'), tx(3, '2026-10-01')], '2026-11-15')).toHaveLength(1);
    expect(detectRecurring([tx(1, '2026-08-01'), tx(2, '2026-10-01'), tx(3, '2026-11-01')], '2026-11-15')).toHaveLength(0); // a gap
    expect(detectRecurring([tx(1, '2026-08-01'), tx(2, '2026-09-01')], '2026-11-15')).toHaveLength(0); // only two
    expect(detectRecurring([tx(1, '2026-03-01'), tx(2, '2026-04-01'), tx(3, '2026-05-01')], '2026-11-15')).toHaveLength(0); // stopped long ago
    expect(detectRecurring([tx(1, '2026-09-01'), tx(2, '2026-09-20'), tx(3, '2026-10-01'), tx(4, '2026-11-01')], '2026-11-15')).toHaveLength(0); // daily-coffee shape
  });
  it('finds a yearly charge', () => {
    expect(detectRecurring([tx(1, '2025-03-10', 1200000, 'Insurance'), tx(2, '2026-03-10', 1200000, 'Insurance')], '2026-11-15')).toMatchObject([{ frequency: 'yearly' }]);
  });
});

describe('cronAuthorized', () => {
  it('only accepts the exact bearer secret', () => {
    expect(cronAuthorized('Bearer s3cret', 's3cret')).toBe(true);
    expect(cronAuthorized('Bearer nope!!', 's3cret')).toBe(false);
    expect(cronAuthorized(undefined, 's3cret')).toBe(false);
    expect(cronAuthorized('Bearer ', '')).toBe(false); // no secret configured: always refused
  });
});
