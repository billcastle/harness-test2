import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nextDue, recurringCost, type RecurringTerms } from '../src/lib/recurring.js';
import { testApp, type TestApp } from './helpers.js';

const TODAY = '2026-11-15';
const monthly = (amountCentavos: number, startDate: string, endDate: string | null = null): RecurringTerms => ({ amountCentavos, frequency: 'monthly', startDate, endDate });
const yearly = (amountCentavos: number, startDate: string, endDate: string | null = null): RecurringTerms => ({ amountCentavos, frequency: 'yearly', startDate, endDate });
const cost = (r: RecurringTerms, from: string, to: string) => recurringCost(r, from, to, TODAY);

describe('recurringCost', () => {
  it('a monthly bill counts in full for each whole month, including the month it started in', () => {
    const netflix = monthly(54_900, '2026-08-12');
    expect(cost(netflix, '2026-11-01', '2026-11-30')).toBe(54_900);
    expect(cost(netflix, '2026-08-01', '2026-08-31')).toBe(54_900); // started on the 12th, still the whole month
    expect(cost(netflix, '2026-07-01', '2026-07-31')).toBe(0); // before it began
    expect(cost(netflix, '2026-10-01', '2026-11-30')).toBe(109_800);
  });

  it('a yearly bill is one twelfth per month, so it still shows in a monthly view', () => {
    const insurance = yearly(120_000, '2026-03-15');
    expect(cost(insurance, '2026-11-01', '2026-11-30')).toBe(10_000);
    expect(cost(insurance, '2026-06-01', '2026-06-30')).toBe(10_000); // every month, not just March
    expect(cost(insurance, '2026-02-01', '2026-02-28')).toBe(0); // before the first charge
    expect(cost(yearly(100_001, '2026-01-01'), '2026-11-01', '2026-11-30')).toBe(Math.round(100_001 / 12));
  });

  it('never projects past the month that contains today', () => {
    expect(cost(monthly(10_000, '2026-01-01'), '2026-12-01', '2026-12-31')).toBe(0);
    expect(cost(monthly(10_000, '2026-01-01'), '2026-01-01', '2026-12-31')).toBe(11 * 10_000); // Jan to Nov
    expect(cost(yearly(120_000, '2026-03-15'), '2026-01-01', '2026-12-31')).toBe(9 * 10_000); // Mar to Nov
  });

  it('a custom range is pro-rated by the days it covers', () => {
    expect(cost(monthly(300_000, '2026-01-01'), '2026-11-01', '2026-11-15')).toBe(150_000); // 15 of 30 days
    expect(cost(monthly(300_000, '2026-01-01'), '2026-10-16', '2026-11-15')).toBe(Math.round(300_000 * (16 / 31 + 15 / 30)));
  });

  it('an end date stops it after the month it falls in', () => {
    const gym = monthly(50_000, '2026-01-01', '2026-09-10');
    expect(cost(gym, '2026-09-01', '2026-09-30')).toBe(50_000);
    expect(cost(gym, '2026-10-01', '2026-10-31')).toBe(0);
  });

  it('All time starts at the first charge, not in 1970', () => {
    expect(cost(monthly(10_000, '2026-09-20'), '1970-01-01', TODAY)).toBe(Math.round(10_000 * (2 + 15 / 30))); // Sep, Oct, and half of November to date
    expect(cost(monthly(10_000, '2026-09-20'), '1970-01-01', '2026-11-30')).toBe(30_000);
  });
});

describe('nextDue', () => {
  const due = (r: Parameters<typeof nextDue>[0], today = TODAY) => nextDue(r, today);
  it('monthly: this month if the day has not passed, otherwise next month; today counts', () => {
    expect(due({ frequency: 'monthly', startDate: '2026-01-20', endDate: null })).toBe('2026-11-20');
    expect(due({ frequency: 'monthly', startDate: '2026-01-10', endDate: null })).toBe('2026-12-10');
    expect(due({ frequency: 'monthly', startDate: '2026-01-15', endDate: null })).toBe('2026-11-15');
  });
  it('a day that does not exist in a month falls on its last day', () => {
    expect(due({ frequency: 'monthly', startDate: '2026-01-31', endDate: null })).toBe('2026-11-30');
    expect(due({ frequency: 'monthly', startDate: '2026-01-31', endDate: null }, '2027-02-01')).toBe('2027-02-28');
  });
  it('yearly: the next anniversary', () => {
    expect(due({ frequency: 'yearly', startDate: '2025-03-15', endDate: null })).toBe('2027-03-15');
    expect(due({ frequency: 'yearly', startDate: '2025-12-01', endDate: null })).toBe('2026-12-01');
  });
  it('not before the first charge, and nothing once ended', () => {
    expect(due({ frequency: 'monthly', startDate: '2027-02-10', endDate: null })).toBe('2027-02-10');
    expect(due({ frequency: 'monthly', startDate: '2026-01-10', endDate: '2026-10-31' })).toBeNull();
  });
});

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
const addRec = (over: Record<string, unknown> = {}) => call('POST', '/api/recurring', { description: 'Netflix', amount: '549', frequency: 'monthly', startDate: '2026-08-12', ...over });
const addCat = async (name: string) => (await call('POST', '/api/categories', { name })).body.id as number;

describe('recurring API', () => {
  it('creates and lists, with the per-month amount and the next charge date', async () => {
    const bills = await addCat('Bills');
    const m = (await addRec({ categoryId: bills })).body;
    expect(m).toMatchObject({ description: 'Netflix', amountCentavos: 54_900, frequency: 'monthly', categoryName: 'Bills', perMonthCentavos: 54_900, nextDue: '2026-12-12', ended: false, endDate: null });
    const y = (await addRec({ description: 'Insurance', amount: '12,000', frequency: 'yearly', startDate: '2026-03-15' })).body;
    expect(y).toMatchObject({ amountCentavos: 1_200_000, perMonthCentavos: 100_000, nextDue: '2027-03-15', categoryName: 'Uncategorized' });
    expect((await call('GET', '/api/recurring')).body.items.map((x: { description: string }) => x.description)).toEqual(['Insurance', 'Netflix']);
  });

  it('defaults the start date to today and validates everything', async () => {
    expect((await addRec({ startDate: undefined })).body.startDate).toBe(TODAY);
    for (const bad of [
      { description: '' }, { description: 'x'.repeat(201) }, { amount: '0' }, { amount: '5.555' }, { amount: undefined },
      { frequency: 'weekly' }, { frequency: undefined }, { startDate: '2026-02-30' }, { endDate: '2026-01-01' }, { categoryId: 99999 }, { categoryId: 'x' },
    ]) {
      expect((await addRec(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await call('POST', '/api/recurring', [])).status).toBe(400);
  });

  it('edits some fields, can end it (and un-end it), and 404s for unknown ids', async () => {
    const id = (await addRec()).body.id;
    expect((await call('PATCH', `/api/recurring/${id}`, { amount: '599', frequency: 'yearly' })).body).toMatchObject({ amountCentavos: 59_900, frequency: 'yearly', description: 'Netflix' });
    const ended = (await call('PATCH', `/api/recurring/${id}`, { endDate: '2026-10-31' })).body;
    expect(ended).toMatchObject({ endDate: '2026-10-31', ended: true, nextDue: null });
    expect((await call('PATCH', `/api/recurring/${id}`, { endDate: null })).body).toMatchObject({ endDate: null, ended: false });
    expect((await call('PATCH', `/api/recurring/${id}`, { endDate: '2026-01-01' })).status).toBe(400); // before the start
    expect((await call('PATCH', '/api/recurring/999', { amount: '5' })).status).toBe(404);
    expect((await call('DELETE', `/api/recurring/${id}`)).status).toBe(204);
    expect((await call('DELETE', `/api/recurring/${id}`)).status).toBe(404);
  });

  it('lists active items first and ended ones last', async () => {
    await addRec({ description: 'Old gym', endDate: '2026-09-30' });
    await addRec({ description: 'Zoom' });
    expect((await call('GET', '/api/recurring')).body.items.map((x: { description: string }) => x.description)).toEqual(['Zoom', 'Old gym']);
  });

  it('deleting a category moves its recurring items to Uncategorized instead of failing', async () => {
    const bills = await addCat('Bills');
    await addRec({ categoryId: bills });
    expect((await call('DELETE', `/api/categories/${bills}`)).status).toBe(200);
    expect((await call('GET', '/api/recurring')).body.items[0]).toMatchObject({ categoryName: 'Uncategorized' });
  });
});

describe('recurring in the summary', () => {
  const summary = async (q = '') => (await call('GET', `/api/summary${q}`)).body;

  it('adds to the total and to its category, and lists what it contributes', async () => {
    const bills = await addCat('Bills');
    const food = await addCat('Food');
    await call('POST', '/api/transactions', { amount: '1000', date: '2026-11-05', categoryId: food });
    await addRec({ categoryId: bills });
    await addRec({ description: 'Insurance', amount: '12,000', frequency: 'yearly', startDate: '2026-03-15', categoryId: bills });
    const s = await summary();
    expect(s.netCentavos).toBe(100_000 + 54_900 + 100_000);
    expect(s.count).toBe(1); // recurring bills are not transactions
    expect(s.byCategory).toEqual([
      expect.objectContaining({ name: 'Bills', netCentavos: 154_900 }),
      expect.objectContaining({ name: 'Food', netCentavos: 100_000 }),
    ]);
    expect(s.recurring).toEqual({
      totalCentavos: 154_900,
      items: [
        expect.objectContaining({ description: 'Insurance', frequency: 'yearly', amountCentavos: 1_200_000, costCentavos: 100_000 }), // the yearly bill, as one twelfth
        expect.objectContaining({ description: 'Netflix', frequency: 'monthly', amountCentavos: 54_900, costCentavos: 54_900 }),
      ],
    });
  });

  it('a category with only recurring spending still appears, and a view before the bill began is unchanged', async () => {
    await addRec({ categoryId: await addCat('Bills') });
    expect((await summary()).byCategory).toEqual([expect.objectContaining({ name: 'Bills', netCentavos: 54_900 })]);
    const before = await summary('?from=2026-07-01&to=2026-07-31');
    expect(before).toMatchObject({ netCentavos: 0, byCategory: [], recurring: { totalCentavos: 0, items: [] } });
  });

  it('the daily average and typical expense stay about actual spending; the comparison counts recurring on both sides', async () => {
    await addRec({ startDate: '2026-09-01' });
    await call('POST', '/api/transactions', { amount: '150', date: '2026-11-03' }); // 15 days elapsed
    await call('POST', '/api/transactions', { amount: '100', date: '2026-10-03' });
    const s = await summary();
    expect(s.insights.averagePerDayCentavos).toBe(Math.round(15_000 / 15)); // 150 pesos over 15 days, recurring left out
    expect(s.insights.previous).toEqual({ from: '2026-10-01', to: '2026-10-15', netCentavos: 10_000 + 54_900 });
    expect(s.netCentavos).toBe(15_000 + 54_900);
  });

  it('an item that has ended stops counting after its last month', async () => {
    await addRec({ startDate: '2026-01-01', endDate: '2026-09-30' });
    expect((await summary('?from=2026-09-01&to=2026-09-30')).recurring.totalCentavos).toBe(54_900);
    expect((await summary('?from=2026-10-01&to=2026-10-31')).recurring.totalCentavos).toBe(0);
  });
});
