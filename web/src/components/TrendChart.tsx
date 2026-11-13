import type { TrendPoint } from '../lib/trend';
import { formatPeso } from '../lib/money';

const W = 640;
const H = 220;
const PAD = { l: 8, r: 8, t: 12, b: 28 };

const label = (bucket: string) => {
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(bucket.slice(5, 7)) - 1]!;
  return bucket.length === 10 ? `${m} ${Number(bucket.slice(8))}` : `${m} ${bucket.slice(0, 4)}`;
};

/** A plain SVG line chart (no chart library): the axis shows only the first and last label, every point carries a tooltip. */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.netCentavos));
  const min = Math.min(0, ...points.map((p) => p.netCentavos));
  const x = (i: number) => PAD.l + (points.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (points.length - 1));
  const y = (v: number) => PAD.t + ((max - v) * (H - PAD.t - PAD.b)) / (max - min);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.netCentavos).toFixed(1)}`).join(' ');
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Spending over time, ${label(first.bucket)} to ${label(last.bucket)}, highest ${formatPeso(max)}`} className="h-auto w-full">
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth={1} />
      <path d={`${line} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`} className="fill-primary/10" />
      <path d={line} className="fill-none stroke-primary" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={p.bucket} cx={x(i)} cy={y(p.netCentavos)} r={points.length > 40 ? 3 : 4.5} className="fill-primary">
          <title>{`${label(p.bucket)}: ${formatPeso(p.netCentavos)}`}</title>
        </circle>
      ))}
      <text x={PAD.l} y={H - 6} className="fill-muted-foreground text-[13px]">{label(first.bucket)}</text>
      {points.length > 1 && <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-muted-foreground text-[13px]">{label(last.bucket)}</text>}
    </svg>
  );
}

export function TrendTable({ points }: { points: TrendPoint[] }) {
  return (
    <table className="w-full text-left">
      <caption className="sr-only">Spending over time</caption>
      <thead><tr className="border-b text-muted-foreground"><th scope="col" className="py-2 font-medium">When</th><th scope="col" className="py-2 text-right font-medium">Net spent</th></tr></thead>
      <tbody>
        {points.map((p) => (
          <tr key={p.bucket} className="border-b last:border-0"><th scope="row" className="py-2 font-normal">{label(p.bucket)}</th><td className="py-2 text-right tabular-nums">{formatPeso(p.netCentavos)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
