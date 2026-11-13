import type { Summary } from '../lib/api';
import { formatPeso } from '../lib/money';

type Row = Summary['byCategory'][number];

/** Horizontal bars, one per category, always labelled with the name. A category whose refunds exceed its spending shows its negative amount and no bar. */
export function CategoryBars({ rows }: { rows: Row[] }) {
  const max = Math.max(1, ...rows.map((r) => r.netCentavos));
  const positiveTotal = rows.reduce((s, r) => s + Math.max(0, r.netCentavos), 0);
  const hasNegative = rows.some((r) => r.netCentavos < 0);
  return (
    <div>
      <ul className="grid gap-5">
        {rows.map((r) => (
          <li key={r.categoryId} data-category={r.name}>
            <div className="mb-2 flex items-baseline justify-between gap-4">
              <span className="flex items-center gap-3"><span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: r.color }} />{r.name}</span>
              <span className="tabular-nums">
                {formatPeso(r.netCentavos)}
                {r.netCentavos > 0 && positiveTotal > 0 && <span className="ml-3 text-muted-foreground">{Math.round((r.netCentavos / positiveTotal) * 100)}%</span>}
              </span>
            </div>
            <div className="h-3 rounded-full bg-muted" aria-hidden>
              <div className="h-3 rounded-full" style={{ width: `${Math.max(0, (r.netCentavos / max) * 100)}%`, backgroundColor: r.color }} />
            </div>
          </li>
        ))}
      </ul>
      {hasNegative && <p className="mt-5 text-sm text-muted-foreground">A negative amount means refunds in that category were more than what was spent.</p>}
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
