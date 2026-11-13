import { addMonths } from './dates';

export interface TrendPoint {
  bucket: string; // YYYY-MM-DD (daily) or YYYY-MM (monthly)
  netCentavos: number;
}

function* days(from: string, to: string) {
  const end = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  for (let t = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10)); t <= end; t += 86_400_000) {
    yield new Date(t).toISOString().slice(0, 10);
  }
}

/**
 * The server only returns buckets that have spending. A line chart needs the quiet ones too, as zero.
 * Daily: every day from the range start to the earlier of the range end and today (days still to come are not zero spend, they are unknown).
 * Monthly: every month from the first to the last month that has data (an all-time range starts in 1970, so the range itself is no use).
 */
export function fillTrend(points: TrendPoint[], granularity: 'day' | 'month', range: { from: string; to: string }, today: string): TrendPoint[] {
  const byBucket = new Map(points.map((p) => [p.bucket, p.netCentavos]));
  const out: TrendPoint[] = [];
  if (granularity === 'day') {
    const end = range.to < today ? range.to : today;
    for (const d of days(range.from, end < range.from ? range.from : end)) out.push({ bucket: d, netCentavos: byBucket.get(d) ?? 0 });
    return out;
  }
  if (points.length === 0) return out;
  const first = points[0]!.bucket;
  const last = points[points.length - 1]!.bucket;
  for (let m = `${first}-01`; m.slice(0, 7) <= last; m = addMonths(m, 1)) {
    out.push({ bucket: m.slice(0, 7), netCentavos: byBucket.get(m.slice(0, 7)) ?? 0 });
  }
  return out;
}
