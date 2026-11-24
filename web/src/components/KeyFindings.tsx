import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Summary } from '../lib/api';
import { rangeLabel, shortDate, WEEKDAYS } from '../lib/dates';
import { formatPeso } from '../lib/money';

const times = (n: number) => (n === 2 ? 'twice' : `${n} times`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function Stat({ label, value, detail, testId }: { label: string; value: string; detail?: ReactNode; testId?: string }) {
  return (
    <div className="grid content-start gap-1 rounded-2xl border bg-card p-4 sm:p-5" data-testid={testId}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tracking-tight tabular-nums break-words sm:text-2xl">{value}</p>
      {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
    </div>
  );
}

function Finding({ title, headline, children, testId }: { title: string; headline: string; children?: ReactNode; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="grid content-start gap-2">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <p className="text-xl font-semibold tracking-tight break-words">{headline}</p>
        {children && <div className="text-muted-foreground">{children}</div>}
      </CardContent>
    </Card>
  );
}

/** The row of numbers under the total: how fast money goes, what a typical expense costs, and how this period compares. */
export function SummaryStats({ data }: { data: Summary }) {
  const { insights: i } = data;
  const top = data.byCategory.find((c) => c.netCentavos > 0);
  const positiveTotal = data.byCategory.reduce((s, c) => s + Math.max(0, c.netCentavos), 0);
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4" aria-label="Summary numbers" role="group">
      <Stat label="Average per day" value={formatPeso(i.averagePerDayCentavos)} detail={`over ${plural(i.elapsedDays, 'day')}`} testId="stat-per-day" />
      <Stat label="Typical expense" value={formatPeso(i.medianExpenseCentavos)} detail={`median · average ${formatPeso(i.averageExpenseCentavos)}`} testId="stat-typical" />
      <Stat label="Transactions" value={String(data.count)} detail={i.refunds ? `incl. ${plural(i.refunds.count, 'refund')}` : 'expenses'} testId="stat-count" />
      <Stat
        label="Biggest category"
        value={top ? top.name : '—'}
        detail={top && positiveTotal > 0 ? `${formatPeso(top.netCentavos)} · ${Math.round((top.netCentavos / positiveTotal) * 100)}% of spending` : undefined}
        testId="stat-category"
      />
    </div>
  );
}

/** "Up 12% from October 2026" / "Down …" under the total. Says nothing when there is nothing honest to compare with. */
export function PreviousComparison({ data, today }: { data: Summary; today: string }) {
  const prev = data.insights.previous;
  if (!prev) return null;
  const label = rangeLabel({ from: prev.from, to: prev.to }, today);
  const diff = data.netCentavos - prev.netCentavos;
  if (diff === 0) return <p data-testid="vs-previous">Same as {label}</p>;
  const pct = prev.netCentavos > 0 ? ` (${Math.round((Math.abs(diff) / prev.netCentavos) * 100)}%)` : '';
  return (
    <p data-testid="vs-previous" className="text-muted-foreground">
      <span className="font-medium text-foreground">{diff > 0 ? 'Up' : 'Down'} {formatPeso(Math.abs(diff))}{pct}</span> vs {label}
    </p>
  );
}

/** The ten biggest expenses of the period, highest first, shown inside the "Most expensive purchase" card. */
function TopExpenses({ rows }: { rows: Summary['insights']['topExpenses'] }) {
  return (
    <table className="w-full text-sm" data-testid="top-expenses">
      <caption className="sr-only">Top {rows.length} most expensive purchases</caption>
      <thead>
        <tr className="border-b border-primary-foreground/30 text-left opacity-80">
          <th scope="col" className="py-1.5 pr-3 font-medium">#</th>
          <th scope="col" className="py-1.5 pr-3 font-medium">Description</th>
          <th scope="col" className="hidden py-1.5 pr-3 font-medium sm:table-cell">Category</th>
          <th scope="col" className="py-1.5 pr-3 font-medium">Date</th>
          <th scope="col" className="py-1.5 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x, n) => (
          <tr key={x.id} className="border-b border-primary-foreground/15 last:border-0" data-top-expense={x.id}>
            <td className="py-1.5 pr-3 tabular-nums opacity-80">{n + 1}</td>
            <td className="py-1.5 pr-3 break-words">{x.description || 'No description'}</td>
            <td className="hidden py-1.5 pr-3 sm:table-cell">{x.categoryName}</td>
            <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{shortDate(x.date)}</td>
            <td className="py-1.5 text-right font-medium tabular-nums">{formatPeso(x.amountCentavos)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function KeyFindings({ data, onReviewUncategorized }: { data: Summary; onReviewUncategorized: () => void }) {
  const i = data.insights;
  const { largest, mostFrequent, topBySpend, busiestDay, priciestWeekday, small, recurring, uncategorized, refunds } = i;
  // the top spender is only worth its own card when it is a different story from the most frequent one
  const spendCard = topBySpend && topBySpend.name !== mostFrequent?.name ? topBySpend : null;
  const total = data.byCategory.reduce((s, c) => s + Math.max(0, c.netCentavos), 0);
  const [showTop, setShowTop] = useState(false);
  const top = i.topExpenses ?? [];

  return (
    <section aria-labelledby="findings-title" className="grid gap-4 sm:gap-6">
      <h2 id="findings-title" className="text-xl font-semibold tracking-tight">Key findings</h2>

      {largest && (
        <Card data-testid="finding-largest" className="bg-primary text-primary-foreground">
          <CardContent className="grid gap-3">
            <p className="text-sm font-medium opacity-80">Most expensive purchase</p>
            <p className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{formatPeso(largest.amountCentavos)}</p>
            <p className="text-lg break-words">{largest.description || 'No description'}</p>
            <p className="flex flex-wrap items-center gap-3 opacity-90">
              <Badge variant="secondary">{largest.categoryName}</Badge>
              <span>{shortDate(largest.date)}</span>
              {total > 0 && <span>{Math.round((largest.amountCentavos / total) * 100)}% of everything spent in this period</span>}
            </p>
            {top.length > 1 && (
              <>
                <Button type="button" variant="secondary" className="justify-self-start" aria-expanded={showTop} onClick={() => setShowTop((v) => !v)}>
                  {showTop ? 'Show less' : `Show more (top ${top.length})`}
                </Button>
                {showTop && <TopExpenses rows={top} />}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        {mostFrequent && (
          <Finding testId="finding-frequent" title="Most frequent expense" headline={mostFrequent.name}>
            {times(mostFrequent.count)} · {formatPeso(mostFrequent.totalCentavos)} in total · about {formatPeso(Math.round(mostFrequent.totalCentavos / mostFrequent.count))} each
          </Finding>
        )}
        {spendCard && (
          <Finding testId="finding-top-spend" title="Where the most money went" headline={spendCard.name}>
            {formatPeso(spendCard.totalCentavos)} across {plural(spendCard.count, 'purchase')}
            {total > 0 && ` · ${Math.round((spendCard.totalCentavos / total) * 100)}% of spending`}
          </Finding>
        )}
        {busiestDay && (
          <Finding testId="finding-busiest" title="Busiest day" headline={shortDate(busiestDay.date)}>
            {formatPeso(busiestDay.totalCentavos)} across {plural(busiestDay.count, 'purchase')}
          </Finding>
        )}
        {priciestWeekday && (
          <Finding testId="finding-weekday" title="Priciest day of the week" headline={`${WEEKDAYS[priciestWeekday.weekday]}s`}>
            {formatPeso(priciestWeekday.totalCentavos)} spent on {WEEKDAYS[priciestWeekday.weekday]}s in this period
          </Finding>
        )}
        {small && (
          <Finding testId="finding-small" title="Small purchases add up" headline={`${plural(small.count, 'purchase')} under ${formatPeso(small.thresholdCentavos)}`}>
            {formatPeso(small.totalCentavos)} in total
            {` · ${Math.round((small.count / Math.max(1, data.count - (refunds?.count ?? 0))) * 100)}% of your purchases`}
          </Finding>
        )}
        {recurring.length > 0 && (
          <Finding testId="finding-recurring" title="Possibly recurring" headline={recurring.length === 1 ? recurring[0]!.name : `${recurring.length} repeating charges`}>
            <ul className="grid gap-1">
              {recurring.map((r) => (
                <li key={`${r.name}-${r.amountCentavos}`}>{r.name} · {formatPeso(r.amountCentavos)} in {r.months} different months</li>
              ))}
            </ul>
          </Finding>
        )}
        {refunds && (
          <Finding testId="finding-refunds" title="Refunds" headline={formatPeso(refunds.totalCentavos)}>
            from {plural(refunds.count, 'refund')}, already taken off the total
          </Finding>
        )}
        {uncategorized && (
          <Finding testId="finding-uncategorized" title="Needs a category" headline={`${plural(uncategorized.count, 'expense')} uncategorized`}>
            <p className="mb-3">{formatPeso(uncategorized.totalCentavos)} is not in any category yet, so the charts understate where it went.</p>
            <Button type="button" variant="outline" onClick={onReviewUncategorized}>Review them</Button>
          </Finding>
        )}
      </div>
    </section>
  );
}
