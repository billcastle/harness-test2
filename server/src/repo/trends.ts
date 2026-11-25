import type { Db } from '../db.js';
import { recurringCost } from '../lib/recurring.js';
import { addMonths, monthRange } from '../lib/time.js';
import { recurringForSummary } from './recurring.js';

export interface Trends {
  /** "2026-06" … oldest first; the last one is the month of the range end (or this month if that is in the future). */
  months: string[];
  /** Net spend per category for each month, aligned with `months`; the biggest categories first. Recurring bills are included. */
  series: { categoryId: number; name: string; color: string; centavos: number[] }[];
  /** Net spend per month across all categories. */
  totals: number[];
}

const NET = `case t.kind when 'expense' then t.amount_centavos when 'refund' then -t.amount_centavos else 0 end`;

/** Month-by-month spending by category for the `count` months ending at the month of `to` (never past the current month). */
export async function trends(db: Db, to: string, count: number, today: string): Promise<Trends> {
  const last = `${(to < today ? to : today).slice(0, 7)}-01`;
  const starts = Array.from({ length: count }, (_, i) => addMonths(last, i - (count - 1)));
  const months = starts.map((m) => m.slice(0, 7));
  const from = starts[0]!;
  const end = monthRange(last).to;

  const rows = await db.query<{ month: string; id: string; name: string; color: string; net: string }>(
    `select to_char(t.date, 'YYYY-MM') as month, c.id::text as id, c.name, c.color, sum(${NET})::text as net
       from transactions t join categories c on c.id = t.category_id
      where t.deleted_at is null and t.kind in ('expense', 'refund') and t.date between $1 and $2
      group by 1, c.id, c.name, c.color`,
    [from, end],
  );
  const byId = new Map<number, Trends['series'][number]>();
  const slot = (id: number, name: string, color: string) => {
    let s = byId.get(id);
    if (!s) byId.set(id, (s = { categoryId: id, name, color, centavos: new Array<number>(count).fill(0) }));
    return s;
  };
  for (const r of rows.rows) slot(Number(r.id), r.name, r.color).centavos[months.indexOf(r.month)]! += Number(r.net);
  for (const r of await recurringForSummary(db)) {
    starts.forEach((m, i) => {
      const cost = recurringCost(r, m, monthRange(m).to, today);
      if (cost > 0) slot(r.categoryId, r.categoryName, r.color).centavos[i]! += cost;
    });
  }
  const series = [...byId.values()].sort((a, b) => sum(b.centavos) - sum(a.centavos) || a.name.localeCompare(b.name));
  const totals = months.map((_, i) => series.reduce((s, c) => s + c.centavos[i]!, 0));
  return { months, series, totals };
}

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
