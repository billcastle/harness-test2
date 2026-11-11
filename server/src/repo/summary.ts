import type { Db } from '../db.js';
import { spanDays } from '../lib/time.js';

export interface Summary {
  from: string;
  to: string;
  netCentavos: number; // expenses minus refunds
  count: number; // expense and refund rows in range
  byCategory: { categoryId: number; name: string; color: string; netCentavos: number }[];
  trend: { granularity: 'day' | 'month'; points: { bucket: string; netCentavos: number }[] };
}

// income, transfer and ignored rows never count; deleted rows never count.
const NET = `case t.kind when 'expense' then t.amount_centavos when 'refund' then -t.amount_centavos else 0 end`;
const SCOPE = `t.deleted_at is null and t.kind in ('expense', 'refund') and t.date between $1 and $2`;

/** Aggregation happens in SQL. Trend is daily for ranges of 62 days or less, otherwise monthly. */
export async function summarize(db: Db, from: string, to: string): Promise<Summary> {
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
  return {
    from,
    to,
    netCentavos: Number(total.rows[0]!.net),
    count: Number(total.rows[0]!.n),
    byCategory: cats.rows.map((r) => ({ categoryId: Number(r.id), name: r.name, color: r.color, netCentavos: Number(r.net) })),
    trend: { granularity, points: trend.rows.map((r) => ({ bucket: r.bucket, netCentavos: Number(r.net) })) },
  };
}
