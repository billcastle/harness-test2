import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../src/lib/api';
import { manilaToday, monthRange, rangeLabel } from '../src/lib/dates';
import { fillTrend } from '../src/lib/trend';
import { DashboardPage } from '../src/pages/Dashboard';
import { createFakeApi, type FakeApi } from './fakeApi';
import { renderWithProviders } from './render';

let api: FakeApi;
const today = manilaToday();
const month = today.slice(0, 7);
const range = monthRange(today);

function setup(transactions: Partial<Transaction>[], route = '/dashboard') {
  api = createFakeApi({ transactions });
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
  it('defaults to this month and shows the net total, the count and a bar per category', async () => {
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
    expect(screen.getByRole('img', { name: /Spending over time/ })).toBeInTheDocument();
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

  it('a range where refunds exceed spending shows a minus sign, "net of refunds", and a negative category with no bar', async () => {
    setup([{ ...food, amountCentavos: 30000, date: `${month}-01`, kind: 'refund' }, { ...transport, amountCentavos: 5000, date: `${month}-01` }]);
    const total = await screen.findByTestId('net-total');
    expect(total.textContent).toMatch(/-₱250\.00|−₱250\.00/);
    expect(screen.getByText(/net of refunds/)).toBeInTheDocument();
    const foodRow = document.querySelector('[data-category="Food"]') as HTMLElement;
    expect(foodRow.textContent).toMatch(/[-−]₱300\.00/);
    expect((foodRow.querySelector('div.rounded-full > div') as HTMLElement).style.width).toBe('0%');
    expect(screen.getByText(/refunds in that category were more than what was spent/)).toBeInTheDocument();
  });

  it('shows an empty state with the two ways to add data when the range has nothing', async () => {
    setup([{ ...food, date: '2001-01-01' }]);
    expect(await screen.findByText(/No expenses in/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add expense' })).toHaveAttribute('href', '/transactions');
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

  it('"View transactions" carries the range, and changing the range refetches', async () => {
    const { user } = setup([{ ...food, amountCentavos: 10000, date: `${month}-01` }], `/dashboard?from=${range.from}&to=${range.to}`);
    expect(await screen.findByRole('link', { name: 'View transactions' })).toHaveAttribute('href', `/transactions?from=${range.from}&to=${range.to}`);
    await user.click(screen.getByRole('combobox', { name: 'Date range' }));
    await user.click(await screen.findByRole('option', { name: 'This year' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Date range' })).toHaveTextContent('This year'));
    await waitFor(() => expect(api.callsTo('GET', '/api/summary').some((c) => c.url.includes(`from=${today.slice(0, 4)}-01-01`))).toBe(true));
    expect(screen.getByTestId('url')).toHaveTextContent(`from=${today.slice(0, 4)}-01-01`);
  });

  it('"Show as table" swaps both charts for tables with the same numbers, and back', async () => {
    const { user } = setup([{ ...food, amountCentavos: 25000, date: `${month}-01` }]);
    await screen.findByTestId('net-total');
    await user.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.queryByRole('img', { name: /Spending over time/ })).not.toBeInTheDocument();
    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(2);
    expect(within(tables[1]!).getByRole('row', { name: /Food/ })).toHaveTextContent('₱250.00');
    await user.click(screen.getByRole('button', { name: 'Show charts' }));
    expect(screen.getByRole('img', { name: /Spending over time/ })).toBeInTheDocument();
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

describe('fillTrend', () => {
  it('daily: every day from the start to today, quiet days as zero; days still to come are left out', () => {
    const out = fillTrend([{ bucket: '2026-11-02', netCentavos: 500 }], 'day', { from: '2026-11-01', to: '2026-11-30' }, '2026-11-04');
    expect(out).toEqual([
      { bucket: '2026-11-01', netCentavos: 0 }, { bucket: '2026-11-02', netCentavos: 500 },
      { bucket: '2026-11-03', netCentavos: 0 }, { bucket: '2026-11-04', netCentavos: 0 },
    ]);
  });
  it('daily: a fully past range is filled to its own end', () => {
    expect(fillTrend([], 'day', { from: '2026-02-27', to: '2026-03-02' }, '2026-11-04').map((p) => p.bucket)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });
  it('monthly: fills between the first and last month with data, so an all-time range does not start in 1970', () => {
    const out = fillTrend([{ bucket: '2025-11', netCentavos: 100 }, { bucket: '2026-02', netCentavos: 200 }], 'month', { from: '1970-01-01', to: '2026-11-04' }, '2026-11-04');
    expect(out.map((p) => p.bucket)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(out.map((p) => p.netCentavos)).toEqual([100, 0, 0, 200]);
  });
  it('monthly with no data is empty', () => {
    expect(fillTrend([], 'month', { from: '2026-01-01', to: '2026-12-31' }, '2026-11-04')).toEqual([]);
  });
});

describe('rangeLabel', () => {
  it.each([
    [{ from: '2026-11-01', to: '2026-11-30' }, 'November 2026'],
    [{ from: '2028-02-01', to: '2028-02-29' }, 'February 2028'],
    [{ from: '2026-01-01', to: '2026-12-31' }, '2026'],
    [{ from: '1970-01-01', to: '2026-11-12' }, 'All time'],
    [{ from: '2026-11-03', to: '2026-11-09' }, 'Nov 3, 2026 – Nov 9, 2026'],
  ])('%j -> %s', (r, label) => expect(rangeLabel(r, '2026-11-12')).toBe(label));
});
