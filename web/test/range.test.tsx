import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RangeControl } from '../src/components/RangeControl';
import { manilaToday, monthRange, type Range } from '../src/lib/dates';
import { renderWithProviders } from './render';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

const today = manilaToday();
const year = today.slice(0, 4);

function Harness({ start, onChange }: { start: Range; onChange?: (r: Range) => void }) {
  const [range, setRange] = useState(start);
  return <RangeControl range={range} onChange={(r) => { setRange(r); onChange?.(r); }} />;
}
const open = async (user: ReturnType<typeof renderWithProviders>['user'], name: string) => user.click(screen.getByRole('combobox', { name }));
const options = async () => (await screen.findAllByRole('option')).map((o) => o.textContent);

describe('date range control', () => {
  it('offers Current month, This year, All time and Custom range, and no "Last month"', async () => {
    const { user } = renderWithProviders(<Harness start={monthRange(today)} />);
    await open(user, 'Date range');
    expect(await options()).toEqual(['Current month', 'This year', 'All time', 'Custom range']);
  });

  it('Current month shows a month dropdown with the current month selected and every month of this year', async () => {
    const { user } = renderWithProviders(<Harness start={monthRange(today)} />);
    expect(screen.getByRole('combobox', { name: 'Date range' })).toHaveTextContent('Current month');
    const month = screen.getByRole('combobox', { name: 'Month' });
    expect(month).toHaveTextContent(new Date(`${today}T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }));
    await user.click(month);
    expect(await options()).toEqual(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
  });

  it('choosing another month changes the range to that whole month of this year, and the dropdown stays', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Harness start={monthRange(today)} onChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: 'Month' }));
    await user.click(await screen.findByRole('option', { name: 'February' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: `${year}-02-01`, to: `${year}-02-${year === '2028' ? '29' : '28'}` });
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveTextContent('February');
    expect(screen.getByRole('combobox', { name: 'Date range' })).toHaveTextContent('Current month');
  });

  it('a range that is a month of this year opens with Current month and that month (a shared link keeps its view)', () => {
    renderWithProviders(<Harness start={{ from: `${year}-03-01`, to: `${year}-03-31` }} />);
    expect(screen.getByRole('combobox', { name: 'Date range' })).toHaveTextContent('Current month');
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveTextContent('March');
  });

  it('the month dropdown is only there for Current month: This year and Custom range hide it, and Current month brings it back at this month', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Harness start={{ from: `${year}-03-01`, to: `${year}-03-31` }} onChange={onChange} />);
    await open(user, 'Date range');
    await user.click(await screen.findByRole('option', { name: 'This year' }));
    expect(screen.queryByRole('combobox', { name: 'Month' })).not.toBeInTheDocument();
    await open(user, 'Date range');
    await user.click(await screen.findByRole('option', { name: 'Custom range' }));
    expect(screen.queryByRole('combobox', { name: 'Month' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    await open(user, 'Date range');
    await user.click(await screen.findByRole('option', { name: 'Current month' }));
    expect(onChange).toHaveBeenLastCalledWith(monthRange(today));
    expect(within(document.body).getByRole('combobox', { name: 'Month' })).toBeInTheDocument();
  });

  it('a month from another year is a custom range, so no month dropdown', () => {
    renderWithProviders(<Harness start={{ from: `${Number(year) - 1}-03-01`, to: `${Number(year) - 1}-03-31` }} />);
    expect(screen.getByRole('combobox', { name: 'Date range' })).toHaveTextContent('Custom range');
    expect(screen.queryByRole('combobox', { name: 'Month' })).not.toBeInTheDocument();
  });
});
