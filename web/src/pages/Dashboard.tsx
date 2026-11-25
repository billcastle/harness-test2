import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CategoryPie, CategoryTable } from '../components/CategoryPie';
import { TrendsChart } from '../components/TrendsChart';
import { KeyFindings, PreviousComparison, Stat, SummaryStats } from '../components/KeyFindings';
import { RangeControl } from '../components/RangeControl';
import { useCategories } from '../hooks';
import { api, type Summary } from '../lib/api';
import { manilaToday, rangeFromParams, rangeLabel, type Range } from '../lib/dates';
import { formatPeso } from '../lib/money';
import { amountLabel } from './Recurring';

/** `showRange={false}` when a parent page already shows the range control (the Overview page). */
export function DashboardPage({ showRange = true }: { showRange?: boolean }) {
  const [params, setParams] = useSearchParams();
  const today = manilaToday();
  const range = rangeFromParams(params, today);
  const [asTable, setAsTable] = useState(false);
  const setRange = (r: Range) => setParams({ from: r.from, to: r.to });

  const query = useQuery({ queryKey: ['summary', range.from, range.to], queryFn: () => api.summary(range.from, range.to), placeholderData: keepPreviousData });
  const data = query.data;
  const [trendMonths, setTrendMonths] = useState(6);
  // under 'summary' so every edit that refreshes the summary refreshes this too
  const trends = useQuery({ queryKey: ['summary', 'trends', range.to, trendMonths], queryFn: () => api.trends(range.to, trendMonths), placeholderData: keepPreviousData });
  const categories = useCategories().data ?? [];
  // jump to the transactions list filtered to what has no category yet
  const reviewUncategorized = () => {
    const sys = categories.find((c) => c.isSystem);
    if (sys) setParams((p) => { const n = new URLSearchParams(p); n.set('category', String(sys.id)); n.delete('page'); return n; });
    document.getElementById('transactions')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="grid gap-8 sm:gap-10">
      {showRange && <RangeControl range={range} onChange={setRange} />}

      {query.isError && !data ? (
        <Alert variant="destructive" className="flex items-center justify-between gap-4 p-5">
          <span>Could not load the summary.</span>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>Retry</Button>
        </Alert>
      ) : !data ? (
        <div className="grid gap-6" aria-busy="true" aria-label="Loading summary">
          <Skeleton className="h-24 w-72" />
          <Skeleton className="h-60 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
      ) : data.count === 0 && data.recurring.items.length === 0 ? (
        <Card>
          <CardContent className="grid justify-items-start gap-6 py-4">
            <div>
              <p className="text-lg font-medium">No expenses in {rangeLabel(range, today)}</p>
              <p className="text-muted-foreground">Add one with the Add expense button, or import a statement, and the summary and charts will appear here.</p>
            </div>
            <Button asChild size="lg"><Link to="/import">Import statement</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <section aria-label="Total" className="grid gap-2">
            <p className="text-lg text-muted-foreground">{rangeLabel(range, today)}</p>
            <p className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl" data-testid="net-total">{formatPeso(data.netCentavos)}</p>
            <p className="text-muted-foreground">
              {data.netCentavos < 0 && <span className="mr-2">net of refunds ·</span>}
              {data.count} {data.count === 1 ? 'transaction' : 'transactions'} ·{' '}
              <a href="#transactions" className="font-medium text-primary underline underline-offset-4">See them below</a>
            </p>
            {data.recurring.totalCentavos > 0 && (
              <p className="text-muted-foreground" data-testid="includes-recurring">Includes {formatPeso(data.recurring.totalCentavos)} of recurring bills and subscriptions</p>
            )}
            <PreviousComparison data={data} today={today} />
          </section>

          {data.count > 0 && <SummaryStats data={data} />}

          {data.count > 0 && <KeyFindings data={data} onReviewUncategorized={reviewUncategorized} />}

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Spending by category</CardTitle>
              <Button type="button" variant="outline" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>{asTable ? 'Show chart' : 'Show as table'}</Button>
            </CardHeader>
            <CardContent>{asTable ? <CategoryTable rows={data.byCategory} /> : <CategoryPie rows={data.byCategory} />}</CardContent>
          </Card>

          {trends.data && trends.data.totals.some((v) => v !== 0) && (
            <Card data-testid="trends-card">
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Spending over time</CardTitle>
                <div className="flex gap-2" role="group" aria-label="Months shown">
                  {[6, 12].map((m) => (
                    <Button key={m} type="button" size="sm" variant={trendMonths === m ? 'default' : 'outline'} aria-pressed={trendMonths === m} onClick={() => setTrendMonths(m)}>{m} months</Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent><TrendsChart trends={trends.data} thisMonth={today.slice(0, 7)} /></CardContent>
            </Card>
          )}

          {data.recurring.items.length > 0 && <RecurringSection recurring={data.recurring} />}
        </>
      )}
    </div>
  );
}

/** Recurring bills and subscriptions that count in the chosen period: highlight cards, then a table. */
function RecurringSection({ recurring }: { recurring: Summary['recurring'] }) {
  const biggest = recurring.items.reduce((b, r) => (r.costCentavos > b.costCentavos ? r : b));
  return (
    <section aria-labelledby="recurring-title" className="grid gap-4 sm:gap-6" data-testid="recurring-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="recurring-title" className="text-xl font-semibold tracking-tight">Recurring in this period</h2>
        <Link to="/recurring" className="font-medium text-primary underline underline-offset-4">Manage</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-5">
        <Stat label="Total recurring" value={formatPeso(recurring.totalCentavos)} detail={`${recurring.items.length} ${recurring.items.length === 1 ? 'bill' : 'bills'}`} testId="recurring-total" />
        <Stat label="Most expensive recurring" value={formatPeso(biggest.costCentavos)} detail={biggest.description} testId="recurring-biggest" />
      </div>
      <div className="rounded-2xl border bg-card p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Billed</TableHead>
              <TableHead className="text-right">This period</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recurring.items.map((r) => (
              <TableRow key={r.id} data-recurring={r.description}>
                <TableCell className="whitespace-normal break-words">{r.description}</TableCell>
                <TableCell>{r.categoryName}</TableCell>
                <TableCell className="text-muted-foreground">{r.frequency === 'yearly' ? `${amountLabel(r)}, a twelfth each month` : amountLabel(r)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPeso(r.costCentavos)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>Total recurring</TableCell>
              <TableCell className="text-right tabular-nums">{formatPeso(recurring.totalCentavos)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </section>
  );
}
