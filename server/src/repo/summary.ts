import type { Db } from '../db.js';
import { merchantKey } from '../lib/normalize.js';
import { recurringCost, type Frequency } from '../lib/recurring.js';
import { recurringForSummary } from './recurring.js';
import { addDays, addMonths, monthRange, spanDays, weekdayOf } from '../lib/time.js';

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

export interface Summary {
  from: string;
  to: string;
  netCentavos: number; // expenses minus refunds, plus the recurring costs that fall in the period
  count: number; // expense and refund rows in range
  byCategory: { categoryId: number; name: string; color: string; netCentavos: number }[];
  trend: { granularity: 'day' | 'month'; points: { bucket: string; netCentavos: number }[] };
  /** Subscriptions and bills counted in netCentavos and byCategory; only those with a cost in the period. */
  recurring: { totalCentavos: number; items: RecurringLine[] };
  insights: Insights;
}

export interface ExpenseRef {
  id: number;
  date: string;
  description: string;
  amountCentavos: number;
  categoryName: string;
}
export interface MerchantStat {
  name: string;
  count: number;
  totalCentavos: number;
}
/** Plain facts about the period. Every part is null (or empty) when there is not enough data to say anything honest. */
export interface Insights {
  /** Days from the start of the range to today (or the range end if that is earlier); the divisor for the daily average. */
  elapsedDays: number;
  averagePerDayCentavos: number;
  /** Over expense rows only (refunds excluded). Recurring bills are not transactions, so they are not in these averages or in the daily average. */
  averageExpenseCentavos: number;
  medianExpenseCentavos: number;
  largest: ExpenseRef | null;
  /** The ten biggest expenses (refunds excluded), highest first. */
  topExpenses: ExpenseRef[];
  /** Merchants seen at least twice. */
  mostFrequent: MerchantStat | null;
  topBySpend: MerchantStat | null;
  busiestDay: { date: string; totalCentavos: number; count: number } | null;
  /** Needs two weeks of data to mean anything. weekday: 0 = Sunday. */
  priciestWeekday: { weekday: number; totalCentavos: number } | null;
  /** Purchases under SMALL_CENTAVOS; only reported when there are at least three. */
  small: { thresholdCentavos: number; count: number; totalCentavos: number } | null;
  /** Same merchant and same amount in two or more different months. */
  recurring: { name: string; amountCentavos: number; months: number }[];
  uncategorized: { count: number; totalCentavos: number } | null;
  refunds: { count: number; totalCentavos: number } | null;
  /**
   * What to compare with: the previous calendar month or year when the range is exactly one (cut to the same number of days
   * when the current one is still running), otherwise the same number of days just before the range. Null when that period
   * has no expenses (for example All time).
   */
  previous: { from: string; to: string; netCentavos: number } | null;
}
export const SMALL_CENTAVOS = 20_000;

// income, transfer and ignored rows never count; deleted rows never count.
const NET = `case t.kind when 'expense' then t.amount_centavos when 'refund' then -t.amount_centavos else 0 end`;
const SCOPE = `t.deleted_at is null and t.kind in ('expense', 'refund') and t.date between $1 and $2`;

/** Aggregation happens in SQL. Trend is daily for ranges of 62 days or less, otherwise monthly. */
export async function summarize(db: Db, from: string, to: string, today: string): Promise<Summary> {
  const total = await db.query<{ net: string; n: string }>(
    `select coalesce(sum(${NET}), 0)::text as net, count(*)::text as n from transactions t where ${SCOPE}`,
    [from, to],
  );
  const cats = await db.query<{ id: string; name: string; color: string; net: string }>(
    `select c.id::text as id, c.name, c.color, sum(${NET})::text as net
       from transactions t join categories c on c.id = t.category_id
      where ${SCOPE} group by c.id, c.name, c.color order by sum(${NET}) desc, c.name`,
    [from, to],
  );
  const granularity = spanDays(from, to) <= 62 ? 'day' : 'month';
  const bucketExpr = granularity === 'day' ? 't.date::text' : `to_char(t.date, 'YYYY-MM')`;
  const trend = await db.query<{ bucket: string; net: string }>(
    `select ${bucketExpr} as bucket, sum(${NET})::text as net from transactions t where ${SCOPE} group by 1 order by 1`,
    [from, to],
  );
  // recurring bills are spread over the months they apply to, and add to the total and to their category
  const standing = await recurringForSummary(db);
  const lines: RecurringLine[] = [];
  const byCategory = new Map<number, Summary['byCategory'][number]>(
    cats.rows.map((r) => [Number(r.id), { categoryId: Number(r.id), name: r.name, color: r.color, netCentavos: Number(r.net) }]),
  );
  let recurringTotal = 0;
  for (const r of standing) {
    const cost = recurringCost(r, from, to, today);
    if (cost <= 0) continue;
    lines.push({ id: r.id, description: r.description, categoryName: r.categoryName, frequency: r.frequency, amountCentavos: r.amountCentavos, costCentavos: cost });
    recurringTotal += cost;
    const cat = byCategory.get(r.categoryId) ?? { categoryId: r.categoryId, name: r.categoryName, color: r.color, netCentavos: 0 };
    cat.netCentavos += cost;
    byCategory.set(r.categoryId, cat);
  }
  lines.sort((a, b) => b.costCentavos - a.costCentavos || a.description.localeCompare(b.description));
  return {
    from,
    to,
    netCentavos: Number(total.rows[0]!.net) + recurringTotal,
    count: Number(total.rows[0]!.n),
    byCategory: [...byCategory.values()].sort((a, b) => b.netCentavos - a.netCentavos || a.name.localeCompare(b.name)),
    trend: { granularity, points: trend.rows.map((r) => ({ bucket: r.bucket, netCentavos: Number(r.net) })) },
    recurring: { totalCentavos: recurringTotal, items: lines },
    insights: await insightsFor(db, from, to, today, standing),
  };
}

interface Row {
  id: string;
  date: string;
  amount: string;
  description: string;
  kind: string;
  category: string;
  is_system: boolean;
}

async function insightsFor(db: Db, from: string, to: string, today: string, standing: Awaited<ReturnType<typeof recurringForSummary>>): Promise<Insights> {
  const r = await db.query<Row>(
    `select t.id::text as id, t.date::text as date, t.amount_centavos::text as amount, t.description, t.kind,
            c.name as category, c.is_system
       from transactions t join categories c on c.id = t.category_id
      where ${SCOPE} order by t.date, t.id`,
    [from, to],
  );
  const rows = r.rows.map((x) => ({ ...x, id: Number(x.id), amount: Number(x.amount) }));
  const expenses = rows.filter((x) => x.kind === 'expense');
  const refunds = rows.filter((x) => x.kind === 'refund');
  const net = expenses.reduce((s, x) => s + x.amount, 0) - refunds.reduce((s, x) => s + x.amount, 0);

  const end = to < today ? to : today;
  const elapsedDays = end < from ? 0 : spanDays(from, end);

  const amounts = expenses.map((x) => x.amount).sort((a, b) => a - b);
  const mid = amounts.length >> 1;
  const median = amounts.length === 0 ? 0 : amounts.length % 2 ? amounts[mid]! : Math.round((amounts[mid - 1]! + amounts[mid]!) / 2);

  let largest: ExpenseRef | null = null;
  for (const x of expenses) {
    if (!largest || x.amount > largest.amountCentavos) largest = { id: x.id, date: x.date, description: x.description, amountCentavos: x.amount, categoryName: x.category };
  }

  const topExpenses: ExpenseRef[] = [...expenses]
    .sort((a, b) => b.amount - a.amount || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || b.id - a.id)
    .slice(0, 10)
    .map((x) => ({ id: x.id, date: x.date, description: x.description, amountCentavos: x.amount, categoryName: x.category }));

  // merchants: grouped by the normalized description with reference numbers removed; shown under the latest wording
  const merchants = new Map<string, MerchantStat & { amounts: Map<number, Set<string>> }>();
  for (const x of expenses) {
    const key = merchantKey(x.description) || x.description;
    const m = merchants.get(key) ?? { name: x.description, count: 0, totalCentavos: 0, amounts: new Map() };
    m.name = x.description; // rows are ordered by date, so this ends as the most recent wording
    m.count += 1;
    m.totalCentavos += x.amount;
    const months = m.amounts.get(x.amount) ?? new Set<string>();
    months.add(x.date.slice(0, 7));
    m.amounts.set(x.amount, months);
    merchants.set(key, m);
  }
  const stat = ({ name, count, totalCentavos }: MerchantStat): MerchantStat => ({ name, count, totalCentavos });
  const list = [...merchants.values()];
  const repeated = list.filter((m) => m.count >= 2).sort((a, b) => b.count - a.count || b.totalCentavos - a.totalCentavos || a.name.localeCompare(b.name));
  const bySpend = [...list].sort((a, b) => b.totalCentavos - a.totalCentavos || a.name.localeCompare(b.name));

  const recurring: Insights['recurring'] = [];
  for (const m of list) for (const [amount, months] of m.amounts) if (months.size >= 2) recurring.push({ name: m.name, amountCentavos: amount, months: months.size });
  recurring.sort((a, b) => b.months - a.months || b.amountCentavos - a.amountCentavos || a.name.localeCompare(b.name));

  const days = new Map<string, { total: number; count: number }>();
  const weekdays = new Array<number>(7).fill(0);
  for (const x of expenses) {
    const d = days.get(x.date) ?? { total: 0, count: 0 };
    d.total += x.amount;
    d.count += 1;
    days.set(x.date, d);
    weekdays[weekdayOf(x.date)]! += x.amount;
  }
  let busiest: Insights['busiestDay'] = null;
  for (const [date, d] of days) if (!busiest || d.total > busiest.totalCentavos) busiest = { date, totalCentavos: d.total, count: d.count };
  let priciest: Insights['priciestWeekday'] = null;
  if (elapsedDays >= 14) {
    const top = weekdays.reduce((best, v, i) => (v > weekdays[best]! ? i : best), 0);
    if (weekdays[top]! > 0) priciest = { weekday: top, totalCentavos: weekdays[top]! };
  }

  const small = expenses.filter((x) => x.amount < SMALL_CENTAVOS);
  const unc = expenses.filter((x) => x.is_system);

  // like-for-like comparison, so a month in progress is not compared with a whole finished month
  let previous: Insights['previous'] = null;
  if (elapsedDays > 0) {
    const isMonth = from.endsWith('-01') && monthRange(from).to === to;
    const isYear = from.endsWith('-01-01') && to === `${from.slice(0, 4)}-12-31`;
    const lastYear = Number(from.slice(0, 4)) - 1;
    const pFrom = isMonth ? addMonths(from, -1) : isYear ? `${lastYear}-01-01` : addDays(from, -elapsedDays);
    const pEnd = isMonth ? monthRange(pFrom).to : isYear ? `${lastYear}-12-31` : addDays(from, -1);
    // a period still running is cut to the same number of days
    const cut = isMonth || isYear ? addDays(pFrom, elapsedDays - 1) : pEnd;
    const pTo = cut < pEnd ? cut : pEnd;
    const p = await db.query<{ net: string; n: string }>(
      `select coalesce(sum(${NET}), 0)::text as net, count(*)::text as n from transactions t where ${SCOPE}`,
      [pFrom, pTo],
    );
    // recurring bills are compared as the whole previous month or year (as the current period counts them), not cut to the elapsed days
    const pRecurring = standing.reduce((sum, r) => sum + recurringCost(r, pFrom, isMonth || isYear ? pEnd : pTo, today), 0);
    if (Number(p.rows[0]!.n) > 0 || pRecurring > 0) previous = { from: pFrom, to: pTo, netCentavos: Number(p.rows[0]!.net) + pRecurring };
  }

  return {
    elapsedDays,
    averagePerDayCentavos: elapsedDays > 0 ? Math.round(net / elapsedDays) : 0,
    averageExpenseCentavos: expenses.length ? Math.round(amounts.reduce((s, v) => s + v, 0) / expenses.length) : 0,
    medianExpenseCentavos: median,
    largest,
    topExpenses,
    mostFrequent: repeated[0] ? stat(repeated[0]) : null,
    topBySpend: bySpend[0] ? stat(bySpend[0]) : null,
    busiestDay: busiest,
    priciestWeekday: priciest,
    small: small.length >= 3 ? { thresholdCentavos: SMALL_CENTAVOS, count: small.length, totalCentavos: small.reduce((s, x) => s + x.amount, 0) } : null,
    recurring: recurring.slice(0, 3),
    uncategorized: unc.length ? { count: unc.length, totalCentavos: unc.reduce((s, x) => s + x.amount, 0) } : null,
    refunds: refunds.length ? { count: refunds.length, totalCentavos: refunds.reduce((s, x) => s + x.amount, 0) } : null,
    previous,
  };
}
