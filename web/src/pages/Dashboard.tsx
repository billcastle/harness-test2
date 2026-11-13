import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CategoryBars, CategoryTable } from '../components/CategoryBars';
import { RangeControl } from '../components/RangeControl';
import { TrendChart, TrendTable } from '../components/TrendChart';
import { api } from '../lib/api';
import { manilaToday, rangeFromParams, rangeLabel, type Range } from '../lib/dates';
import { formatPeso } from '../lib/money';
import { fillTrend } from '../lib/trend';

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const today = manilaToday();
  const range = rangeFromParams(params, today);
  const [asTable, setAsTable] = useState(false);
  const setRange = (r: Range) => setParams({ from: r.from, to: r.to });

  const query = useQuery({ queryKey: ['summary', range.from, range.to], queryFn: () => api.summary(range.from, range.to), placeholderData: keepPreviousData });
  const data = query.data;
  const viewTransactions = `/transactions?from=${range.from}&to=${range.to}`;

  return (
    <div className="grid gap-10">
      <RangeControl range={range} onChange={setRange} />

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
      ) : data.count === 0 ? (
        <Card>
          <CardContent className="grid justify-items-start gap-6 py-4">
            <div>
              <p className="text-lg font-medium">No expenses in {rangeLabel(range, today)}</p>
              <p className="text-muted-foreground">Add one by hand or import a statement and the charts will appear here.</p>
            </div>
            <div className="flex flex-wrap gap-4">
              <Button asChild size="lg"><Link to="/transactions">Add expense</Link></Button>
              <Button asChild size="lg" variant="outline"><Link to="/import">Import statement</Link></Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <section aria-label="Total" className="grid gap-2">
            <p className="text-lg text-muted-foreground">{rangeLabel(range, today)}</p>
            <p className="text-5xl font-semibold tracking-tight tabular-nums" data-testid="net-total">{formatPeso(data.netCentavos)}</p>
            <p className="text-muted-foreground">
              {data.netCentavos < 0 && <span className="mr-2">net of refunds ·</span>}
              {data.count} {data.count === 1 ? 'transaction' : 'transactions'} ·{' '}
              <Link to={viewTransactions} className="font-medium text-primary underline underline-offset-4">View transactions</Link>
            </p>
          </section>

          <div className="flex justify-end">
            <Button type="button" variant="outline" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>{asTable ? 'Show charts' : 'Show as table'}</Button>
          </div>

          <Card>
            <CardHeader><CardTitle>Spending over time</CardTitle></CardHeader>
            <CardContent>
              {(() => {
                const points = fillTrend(data.trend.points, data.trend.granularity, range, today);
                return asTable ? <TrendTable points={points} /> : <TrendChart points={points} />;
              })()}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>By category</CardTitle></CardHeader>
            <CardContent>{asTable ? <CategoryTable rows={data.byCategory} /> : <CategoryBars rows={data.byCategory} />}</CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
