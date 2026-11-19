import type { Summary } from '../lib/api';
import { formatPeso } from '../lib/money';

type Row = Summary['byCategory'][number];

const SIZE = 240;
const R = SIZE / 2 - 4;
const C = SIZE / 2;
const point = (angle: number) => `${(C + R * Math.sin(angle)).toFixed(2)} ${(C - R * Math.cos(angle)).toFixed(2)}`;

/**
 * A pie of where the money went, with a legend that always names each slice, its amount and its share (colour is never the only cue).
 * Categories whose refunds exceed their spending have no slice; they stay in the legend with their negative amount.
 */
export function CategoryPie({ rows }: { rows: Row[] }) {
  const positive = rows.filter((r) => r.netCentavos > 0);
  const total = positive.reduce((s, r) => s + r.netCentavos, 0);
  const pct = (v: number) => Math.round((v / total) * 100);
  let start = 0;
  const slices = positive.map((r) => {
    const sweep = (r.netCentavos / total) * Math.PI * 2;
    const slice = { row: r, from: start, to: start + sweep };
    start += sweep;
    return slice;
  });
  const label = `Spending by category: ${positive.map((r) => `${r.name} ${pct(r.netCentavos)}%`).join(', ')}`;
  return (
    <div className="grid items-center gap-8 md:grid-cols-[15rem_1fr]">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label} className="mx-auto w-full max-w-60">
        {slices.length === 1 ? (
          <circle cx={C} cy={C} r={R} fill={slices[0]!.row.color} data-slice={slices[0]!.row.name} />
        ) : (
          slices.map(({ row, from, to }) => (
            <path
              key={row.categoryId}
              data-slice={row.name}
              d={`M ${C} ${C} L ${point(from)} A ${R} ${R} 0 ${to - from > Math.PI ? 1 : 0} 1 ${point(to)} Z`}
              fill={row.color}
              stroke="var(--card)"
              strokeWidth={2}
            />
          ))
        )}
      </svg>
      <div>
        <ul className="grid gap-4">
          {rows.map((r) => (
            <li key={r.categoryId} data-category={r.name} className="flex items-baseline justify-between gap-4">
              <span className="flex items-center gap-3"><span aria-hidden className="size-3 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />{r.name}</span>
              <span className="tabular-nums">
                {formatPeso(r.netCentavos)}
                {r.netCentavos > 0 && <span className="ml-3 text-muted-foreground">{pct(r.netCentavos)}%</span>}
              </span>
            </li>
          ))}
        </ul>
        {rows.some((r) => r.netCentavos < 0) && <p className="mt-5 text-sm text-muted-foreground">A negative amount means refunds in that category were more than what was spent, so it has no slice.</p>}
      </div>
    </div>
  );
}

export function CategoryTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full text-left">
      <caption className="sr-only">Spending by category</caption>
      <thead><tr className="border-b text-muted-foreground"><th scope="col" className="py-2 font-medium">Category</th><th scope="col" className="py-2 text-right font-medium">Net spent</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.categoryId} className="border-b last:border-0"><th scope="row" className="py-2 font-normal">{r.name}</th><td className="py-2 text-right tabular-nums">{formatPeso(r.netCentavos)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
