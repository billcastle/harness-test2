import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Trends } from '../lib/api';
import { MONTHS } from '../lib/dates';
import { formatPeso } from '../lib/money';

const W = 640;
const H = 260;
const PAD = { top: 12, right: 8, bottom: 28, left: 52 };
const MAX_SERIES = 6;
const OTHER_COLOR = '#94a3b8';

const monthName = (m: string, long = false) => {
  const name = MONTHS[Number(m.slice(5, 7)) - 1]!;
  return long ? `${name} ${m.slice(0, 4)}` : name.slice(0, 3);
};
/** 123450 -> "₱1.2k" for axis labels. */
const compact = (centavos: number) => {
  const p = centavos / 100;
  return `₱${p >= 1_000_000 ? `${+(p / 1_000_000).toFixed(1)}M` : p >= 1000 ? `${+(p / 1000).toFixed(1)}k` : Math.round(p)}`;
};
/** A round ceiling for the axis: 1, 2, 2.5, 5 or 10 times a power of ten. */
function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

/** The biggest categories keep their own colour; the rest are folded into "Other" so the legend stays readable. */
function group(series: Trends['series']): Trends['series'] {
  if (series.length <= MAX_SERIES + 1) return series;
  const rest = series.slice(MAX_SERIES);
  return [...series.slice(0, MAX_SERIES), { categoryId: -1, name: 'Other', color: OTHER_COLOR, centavos: rest[0]!.centavos.map((_, i) => rest.reduce((s, c) => s + c.centavos[i]!, 0)) }];
}

/** "November 2026 is 18% above your average of the 5 months before", or nothing when there is nothing honest to compare. */
export function trendSentence(t: Trends, thisMonth: string): string | null {
  const n = t.totals.length;
  const prior = t.totals.slice(0, -1);
  const avg = prior.reduce((s, v) => s + v, 0) / (prior.length || 1);
  if (n < 3 || avg <= 0) return null;
  const last = t.totals[n - 1]!;
  const pct = Math.round((Math.abs(last - avg) / avg) * 100);
  const label = monthName(t.months[n - 1]!, true);
  const running = t.months[n - 1] === thisMonth ? ' so far' : '';
  if (pct === 0) return `${label}${running} is right on your ${n - 1}-month average.`;
  return `${label}${running} is ${pct}% ${last > avg ? 'above' : 'below'} your average of ${formatPeso(Math.round(avg))} over the ${n - 1} months before.`;
}

/**
 * Spending per month, stacked by category. The colour is never the only cue: every bar has a total above it, each segment
 * has a tooltip, and the table view lists every number.
 */
export function TrendsChart({ trends, thisMonth }: { trends: Trends; thisMonth: string }) {
  const [asTable, setAsTable] = useState(false);
  const series = group(trends.series);
  const n = trends.months.length;
  const positives = trends.months.map((_, i) => series.reduce((s, c) => s + Math.max(0, c.centavos[i]!), 0));
  const top = niceMax(Math.max(...positives));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / n;
  const barW = Math.min(56, slot * 0.62);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const sentence = trendSentence(trends, thisMonth);
  const label = `Spending by month: ${trends.months.map((m, i) => `${monthName(m)} ${formatPeso(trends.totals[i]!)}`).join(', ')}`;

  if (asTable) {
    return (
      <div className="grid gap-4">
        {sentence && <p className="text-muted-foreground">{sentence}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left" data-testid="trends-table">
            <caption className="sr-only">Spending by month and category</caption>
            <thead>
              <tr className="border-b text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">Month</th>
                {series.map((s) => <th key={s.categoryId} scope="col" className="py-2 pr-4 text-right font-medium whitespace-nowrap">{s.name}</th>)}
                <th scope="col" className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {trends.months.map((m, i) => (
                <tr key={m} className="border-b last:border-0" data-month={m}>
                  <th scope="row" className="py-2 pr-4 font-normal whitespace-nowrap">{monthName(m, true)}</th>
                  {series.map((s) => <td key={s.categoryId} className="py-2 pr-4 text-right tabular-nums">{s.centavos[i] ? formatPeso(s.centavos[i]!) : '—'}</td>)}
                  <td className="py-2 text-right font-medium tabular-nums">{formatPeso(trends.totals[i]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button type="button" variant="outline" className="justify-self-start" aria-pressed onClick={() => setAsTable(false)}>Show chart</Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {sentence && <p className="text-muted-foreground" data-testid="trend-sentence">{sentence}</p>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="w-full" data-testid="trends-chart">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(top * f)} y2={y(top * f)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(top * f) + 4} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">{compact(top * f)}</text>
          </g>
        ))}
        {trends.months.map((m, i) => {
          const x = PAD.left + slot * i + (slot - barW) / 2;
          let acc = 0;
          return (
            <g key={m} data-month={m}>
              {series.map((s) => {
                const v = Math.max(0, s.centavos[i]!);
                if (v === 0) return null;
                const seg = (
                  <rect key={s.categoryId} x={x} y={y(acc + v)} width={barW} height={Math.max(1, y(acc) - y(acc + v))} fill={s.color} stroke="var(--card)" strokeWidth={1}>
                    <title>{`${monthName(m, true)} · ${s.name}: ${formatPeso(s.centavos[i]!)}`}</title>
                  </rect>
                );
                acc += v;
                return seg;
              })}
              <text x={x + barW / 2} y={y(acc) - 5} textAnchor="middle" fontSize={11} fill="var(--foreground)" className="tabular-nums">{acc > 0 ? compact(trends.totals[i]!) : ''}</text>
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)" fontWeight={m === trends.months[n - 1] ? 600 : 400}>{monthName(m)}</text>
            </g>
          );
        })}
      </svg>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Categories">
        {series.map((s) => (
          <li key={s.categoryId} className="flex items-center gap-2"><span aria-hidden className="size-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />{s.name}</li>
        ))}
      </ul>
      <Button type="button" variant="outline" className="justify-self-start" aria-pressed={false} onClick={() => setAsTable(true)}>Show months as table</Button>
    </div>
  );
}
