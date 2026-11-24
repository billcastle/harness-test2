import { useSearchParams } from 'react-router-dom';
import { RangeControl } from '../components/RangeControl';
import { manilaToday, rangeFromParams, type Range } from '../lib/dates';
import { DashboardPage } from './Dashboard';
import { TransactionsPage } from './Transactions';

/** One page: the summary, key findings and charts for the chosen period, with that period's transactions right below. */
export function OverviewPage() {
  const [params, setParams] = useSearchParams();
  const range = rangeFromParams(params, manilaToday());
  const batch = params.get('batch'); // right after an import: show exactly that import's rows and nothing else
  const setRange = (r: Range) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('from', r.from);
      n.set('to', r.to);
      n.delete('date');
      n.delete('page');
      return n;
    });

  return (
    <div className="grid gap-10">
      {!batch && <RangeControl range={range} onChange={setRange} />}
      {!batch && <DashboardPage showRange={false} />}
      <section id="transactions" aria-labelledby="transactions-title" className="grid scroll-mt-6 gap-6">
        {!batch && <h2 id="transactions-title" className="text-xl font-semibold tracking-tight">Transactions</h2>}
        <TransactionsPage showRange={false} />
      </section>
    </div>
  );
}
