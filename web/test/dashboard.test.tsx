import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyFindings, PreviousComparison, SummaryStats } from '../src/components/KeyFindings';
import type { Insights, Recurring, Summary, Transaction } from '../src/lib/api';
import { manilaToday, monthRange, rangeLabel } from '../src/lib/dates';
import { DashboardPage } from '../src/pages/Dashboard';
import { createFakeApi, type FakeApi } from './fakeApi';
import { renderWithProviders } from './render';

let api: FakeApi;
const today = manilaToday();
const month = today.slice(0, 7);
const range = monthRange(today);

function setup(transactions: Partial<Transaction>[], route = '/dashboard', recurring: Partial<Recurring>[] = []) {
  api = createFakeApi({ transactions, recurring });
  api.install();
  return renderWithProviders(<DashboardPage />, { route });
}
const food = { categoryId: 2, categoryName: 'Food' };
const transport = { categoryId: 3, categoryName: 'Transport' };

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Dashboard', () => {
  it('defaults to this month and shows the net total, the count and a slice per category', async () => {
    setup([
      { ...food, amountCentavos: 25000, date: `${month}-01` },
      { ...food, amountCentavos: 15000, date: `${month}-01` },
      { ...transport, amountCentavos: 10000, date: `${month}-01` },
    ]);
    expect(await screen.findByTestId('net-total')).toHaveTextContent('₱500.00');
    expect(screen.getByText(/3 transactions/)).toBeInTheDocument();
    expect(api.callsTo('GET', '/api/summary')[0]!.url).toBe(`/api/summary?from=${range.from}&to=${range.to}`);
    const foodRow = document.querySelector('[data-category="Food"]') as HTMLElement;
    expect(foodRow).toHaveTextContent('₱400.00');
    expect(foodRow).toHaveTextContent('80%');
    expect(document.querySelector('[data-category="Transport"]')).toHaveTextContent('20%');
    expect(screen.getByRole('img', { name: 'Spending by category: Food 80%, Transport 20%' })).toBeInTheDocument();
    expect(screen.queryByText('Spending over time')).not.toBeInTheDocument();
    // the big slice takes the long way round (large-arc flag 1), the small one the short way
    expect(document.querySelector('[data-slice="Food"]')!.getAttribute('d')).toMatch(/A [\d.]+ [\d.]+ 0 1 1 /);
    expect(document.querySelector('[data-slice="Transport"]')!.getAttribute('d')).toMatch(/A [\d.]+ [\d.]+ 0 0 1 /);
  });

  it('one category is a full circle, not a broken arc', async () => {
    setup([{ ...food, amountCentavos: 25000, date: `${month}-01` }]);
    await screen.findByTestId('net-total');
    expect(document.querySelector('circle[data-slice="Food"]')).toBeInTheDocument();
    expect(document.querySelector('[data-category="Food"]')).toHaveTextContent('100%');
  });

  it('subtracts refunds and ignores income, transfers and rows from other months', async () => {
    setup([
      { ...food, amountCentavos: 50000, date: `${month}-01` },
      { ...food, amountCentavos: 12000, date: `${month}-01`, kind: 'refund' },
      { ...food, amountCentavos: 999900, date: `${month}-01`, kind: 'income' },
      { ...food, amountCentavos: 777700, date: `${month}-01`, kind: 'transfer' },
      { ...food, amountCentavos: 555500, date: '2001-01-01' },
    ]);
    expect(await screen.findByTestId('net-total')).toHaveTextContent('₱380.00');
    expect(screen.getByText(/2 transactions/)).toBeInTheDocument();
  });

  it('a range where refunds exceed spending shows a minus sign, "net of refunds", and a negative category with no slice', async () => {
    setup([{ ...food, amountCentavos: 30000, date: `${month}-01`, kind: 'refund' }, { ...transport, amountCentavos: 5000, date: `${month}-01` }]);
    const total = await screen.findByTestId('net-total');
    expect(total.textContent).toMatch(/-₱250\.00|−₱250\.00/);
    expect(screen.getByText(/net of refunds/)).toBeInTheDocument();
    const foodRow = document.querySelector('[data-category="Food"]') as HTMLElement;
    expect(foodRow.textContent).toMatch(/[-−]₱300\.00/);
    expect(document.querySelector('[data-slice="Food"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-slice="Transport"]')).toBeInTheDocument();
    expect(screen.getByText(/refunds in that category were more than what was spent/)).toBeInTheDocument();
  });

  it('shows an empty state with the two ways to add data when the range has nothing', async () => {
    setup([{ ...food, date: '2001-01-01' }]);
    expect(await screen.findByText(/No expenses in/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import statement' })).toHaveAttribute('href', '/import');
    expect(screen.queryByTestId('net-total')).not.toBeInTheDocument();
  });

  it('a failed load shows an error with Retry, and Retry recovers', async () => {
    api = createFakeApi({ transactions: [{ ...food, amountCentavos: 10000, date: `${month}-01` }] });
    api.install();
    api.state.failures.push({ match: /GET \/api\/summary/, status: 500, error: 'boom', once: true });
    const { user } = renderWithProviders(<DashboardPage />, { route: '/dashboard' });
    expect(await screen.findByText('Could not load the summary.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('net-total')).toHaveTextContent('₱100.00');
  });

  it('links down to the transactions on the same page, and changing the range refetches', async () => {
    const { user } = setup([{ ...food, amountCentavos: 10000, date: `${month}-01` }], `/dashboard?from=${range.from}&to=${range.to}`);
    expect(await screen.findByRole('link', { name: 'See them below' })).toHaveAttribute('href', '#transactions');
    await user.click(screen.getByRole('combobox', { name: 'Date range' }));
    await user.click(await screen.findByRole('option', { name: 'This year' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Date range' })).toHaveTextContent('This year'));
    await waitFor(() => expect(api.callsTo('GET', '/api/summary').some((c) => c.url.includes(`from=${today.slice(0, 4)}-01-01`))).toBe(true));
    expect(screen.getByTestId('url')).toHaveTextContent(`from=${today.slice(0, 4)}-01-01`);
  });

  it('"Show as table" swaps the pie for a table with the same numbers, and back', async () => {
    const { user } = setup([{ ...food, amountCentavos: 25000, date: `${month}-01` }]);
    await screen.findByTestId('net-total');
    await user.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.queryByRole('img', { name: /Spending by category/ })).not.toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('row', { name: /Food/ })).toHaveTextContent('₱250.00');
    await user.click(screen.getByRole('button', { name: 'Show chart' }));
    expect(screen.getByRole('img', { name: /Spending by category/ })).toBeInTheDocument();
  });

  it('shows a skeleton, not stale or empty content, while the first load is in flight', async () => {
    api = createFakeApi({ transactions: [] });
    api.install();
    api.state.delayMs = 200;
    renderWithProviders(<DashboardPage />, { route: '/dashboard' });
    expect(screen.getByLabelText('Loading summary')).toBeInTheDocument();
    expect(screen.queryByText(/No expenses in/)).not.toBeInTheDocument();
  });
});

describe('recurring on the dashboard', () => {
  it('counts recurring bills in the total, says so, and lists them; a yearly bill appears as a twelfth', async () => {
    setup(
      [{ ...food, amountCentavos: 100000, date: `${month}-01` }],
      '/dashboard',
      [{ description: 'Netflix', amountCentavos: 54900 }, { description: 'Insurance', amountCentavos: 1200000, frequency: 'yearly' }],
    );
    expect(await screen.findByTestId('net-total')).toHaveTextContent('₱2,549.00'); // 1,000 + 549 + 1,000 (12,000 / 12)
    expect(screen.getByTestId('includes-recurring')).toHaveTextContent('Includes ₱1,549.00 of recurring bills and subscriptions');
    const card = screen.getByTestId('recurring-card');
    expect(within(card).getByText('Insurance').closest('li')).toHaveTextContent('₱12,000.00 / year, a twelfth each month');
    expect(within(card).getByText('Insurance').closest('li')).toHaveTextContent('₱1,000.00');
    expect(within(card).getByText('Netflix').closest('li')).toHaveTextContent('₱549.00 / month');
    expect(within(card).getByText(/Total recurring/).closest('p')).toHaveTextContent('₱1,549.00');
    expect(within(card).getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/recurring');
  });

  it('a period with only recurring bills still shows them instead of the empty state', async () => {
    setup([], '/dashboard', [{ description: 'Rent', amountCentavos: 1500000 }]);
    expect(await screen.findByTestId('net-total')).toHaveTextContent('₱15,000.00');
    expect(screen.queryByText(/No expenses in/)).not.toBeInTheDocument();
    expect(screen.queryByText('Key findings')).not.toBeInTheDocument(); // no transactions, nothing to find
  });

  it('shows no recurring card or note when there are none', async () => {
    setup([{ ...food, amountCentavos: 10000, date: `${month}-01` }]);
    await screen.findByTestId('net-total');
    expect(screen.queryByTestId('recurring-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('includes-recurring')).not.toBeInTheDocument();
  });
});

describe('key findings', () => {
  const empty: Insights = {
    elapsedDays: 15, averagePerDayCentavos: 0, averageExpenseCentavos: 0, medianExpenseCentavos: 0, largest: null, mostFrequent: null,
    topBySpend: null, busiestDay: null, priciestWeekday: null, small: null, recurring: [], uncategorized: null, refunds: null, previous: null,
  };
  const summary = (insights: Partial<Insights>, over: Partial<Summary> = {}): Summary => ({
    from: '2026-11-01', to: '2026-11-30', netCentavos: 100_000, count: 8,
    byCategory: [{ categoryId: 2, name: 'Food', color: '#f00', netCentavos: 60_000 }, { categoryId: 1, name: 'Uncategorized', color: '#999', netCentavos: 40_000 }],
    trend: { granularity: 'day', points: [] }, recurring: { totalCentavos: 0, items: [] }, insights: { ...empty, ...insights }, ...over,
  });

  it('features the most expensive purchase with its share, and tells the busiest day, repeat merchant and weekday', () => {
    render(
      <KeyFindings
        onReviewUncategorized={() => undefined}
        data={summary({
          largest: { id: 1, date: '2026-11-07', description: 'Laptop bag', amountCentavos: 50_000, categoryName: 'Shopping' },
          mostFrequent: { name: 'Jollibee', count: 3, totalCentavos: 35_500 },
          topBySpend: { name: 'Laptop bag', count: 1, totalCentavos: 50_000 },
          busiestDay: { date: '2026-11-07', totalCentavos: 70_000, count: 2 },
          priciestWeekday: { weekday: 6, totalCentavos: 70_000 },
        })}
      />,
    );
    const big = screen.getByTestId('finding-largest');
    expect(big).toHaveTextContent('₱500.00');
    expect(big).toHaveTextContent('Laptop bag');
    expect(big).toHaveTextContent('Shopping');
    expect(big).toHaveTextContent('Nov 7, 2026');
    expect(big).toHaveTextContent('50% of everything spent');
    expect(screen.getByTestId('finding-frequent')).toHaveTextContent('Jollibee');
    expect(screen.getByTestId('finding-frequent')).toHaveTextContent('3 times · ₱355.00 in total · about ₱118.33 each');
    expect(screen.getByTestId('finding-top-spend')).toHaveTextContent('Laptop bag'); // a different story from the most frequent one
    expect(screen.getByTestId('finding-busiest')).toHaveTextContent('Nov 7, 2026');
    expect(screen.getByTestId('finding-weekday')).toHaveTextContent('Saturdays');
  });

  it('leaves out cards it has nothing honest to say for, and does not repeat the same merchant twice', () => {
    render(
      <KeyFindings
        onReviewUncategorized={() => undefined}
        data={summary({ mostFrequent: { name: 'Jollibee', count: 2, totalCentavos: 20_000 }, topBySpend: { name: 'Jollibee', count: 2, totalCentavos: 20_000 } })}
      />,
    );
    expect(screen.getByTestId('finding-frequent')).toHaveTextContent('twice');
    for (const id of ['largest', 'top-spend', 'busiest', 'weekday', 'small', 'recurring', 'refunds', 'uncategorized']) {
      expect(screen.queryByTestId(`finding-${id}`)).not.toBeInTheDocument();
    }
  });

  it('shows small purchases, possible subscriptions and refunds in plain words', () => {
    render(
      <KeyFindings
        onReviewUncategorized={() => undefined}
        data={summary({
          small: { thresholdCentavos: 20_000, count: 4, totalCentavos: 30_000 },
          recurring: [{ name: 'Netflix', amountCentavos: 54_900, months: 3 }],
          refunds: { count: 1, totalCentavos: 10_000 },
        }, { count: 9 })}
      />,
    );
    expect(screen.getByTestId('finding-small')).toHaveTextContent('4 purchases under ₱200.00');
    expect(screen.getByTestId('finding-small')).toHaveTextContent('₱300.00 in total · 50% of your purchases');
    expect(screen.getByTestId('finding-recurring')).toHaveTextContent('Netflix · ₱549.00 in 3 different months');
    expect(screen.getByTestId('finding-refunds')).toHaveTextContent('₱100.00');
  });

  it('"Review them" is offered for uncategorized spending and calls back', async () => {
    const onReview = vi.fn();
    render(<KeyFindings onReviewUncategorized={onReview} data={summary({ uncategorized: { count: 5, totalCentavos: 40_000 } })} />);
    expect(screen.getByTestId('finding-uncategorized')).toHaveTextContent('5 expenses uncategorized');
    await userEvent.click(screen.getByRole('button', { name: 'Review them' }));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it('summary numbers: per-day, typical expense (median and mean) and the biggest category with its share', () => {
    render(<SummaryStats data={summary({ averagePerDayCentavos: 6_667, medianExpenseCentavos: 10_000, averageExpenseCentavos: 12_500, elapsedDays: 15 })} />);
    expect(screen.getByTestId('stat-per-day')).toHaveTextContent('₱66.67');
    expect(screen.getByTestId('stat-per-day')).toHaveTextContent('over 15 days');
    expect(screen.getByTestId('stat-typical')).toHaveTextContent('₱100.00');
    expect(screen.getByTestId('stat-typical')).toHaveTextContent('average ₱125.00');
    expect(screen.getByTestId('stat-category')).toHaveTextContent('Food');
    expect(screen.getByTestId('stat-category')).toHaveTextContent('₱600.00 · 60% of spending');
  });

  it('says up or down against the previous period in words, and nothing when there is nothing to compare', () => {
    const prev = { from: '2026-10-17', to: '2026-10-31' };
    const { rerender } = render(<PreviousComparison today="2026-11-15" data={summary({ previous: { ...prev, netCentavos: 80_000 } })} />);
    expect(screen.getByTestId('vs-previous')).toHaveTextContent('Up ₱200.00 (25%) vs Oct 17, 2026 – Oct 31, 2026');
    rerender(<PreviousComparison today="2026-11-15" data={summary({ previous: { ...prev, netCentavos: 125_000 } })} />);
    expect(screen.getByTestId('vs-previous')).toHaveTextContent('Down ₱250.00 (20%)');
    rerender(<PreviousComparison today="2026-11-15" data={summary({ previous: { ...prev, netCentavos: 100_000 } })} />);
    expect(screen.getByTestId('vs-previous')).toHaveTextContent('Same as');
    rerender(<PreviousComparison today="2026-11-15" data={summary({ previous: null })} />);
    expect(screen.queryByTestId('vs-previous')).not.toBeInTheDocument();
  });
});
