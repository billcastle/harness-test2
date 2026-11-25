import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { trendSentence, TrendsChart } from '../src/components/TrendsChart';
import type { Trends } from '../src/lib/api';

const trends = (totalsByCat: Record<string, number[]>, months = ['2026-08', '2026-09', '2026-10', '2026-11']): Trends => {
  const series = Object.entries(totalsByCat).map(([name, centavos], i) => ({ categoryId: i + 1, name, color: `#00${i}000`, centavos }));
  return { months, series, totals: months.map((_, i) => series.reduce((s, c) => s + c.centavos[i]!, 0)) };
};

describe('trendSentence', () => {
  it('compares the latest month with the average of the ones before, and says so when it is still running', () => {
    const t = trends({ Food: [100_00, 100_00, 100_00, 150_00] });
    expect(trendSentence(t, '2026-12')).toBe('November 2026 is 50% above your average of ₱100.00 over the 3 months before.');
    expect(trendSentence(t, '2026-11')).toContain('November 2026 so far is 50% above');
    expect(trendSentence(trends({ Food: [100_00, 100_00, 100_00, 50_00] }), '2026-12')).toContain('50% below');
  });
  it('says nothing without a history to compare with', () => {
    expect(trendSentence(trends({ Food: [0, 0, 0, 50_00] }), '2026-12')).toBeNull();
    expect(trendSentence(trends({ Food: [10_00, 20_00] }, ['2026-10', '2026-11']), '2026-12')).toBeNull();
  });
});

describe('TrendsChart', () => {
  it('draws a stacked bar per month with an accessible summary, and a table with every number', async () => {
    const t = trends({ Food: [100_00, 0, 200_00, 300_00], Transport: [50_00, 50_00, 0, 100_00] });
    render(<TrendsChart trends={t} thisMonth="2026-11" />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Spending by month: Aug ₱150.00, Sep ₱50.00, Oct ₱200.00, Nov ₱400.00');
    expect(document.querySelectorAll('[data-month]')).toHaveLength(4);
    await userEvent.click(screen.getByRole('button', { name: 'Show months as table' }));
    const row = within(screen.getByTestId('trends-table')).getByText('November 2026').closest('tr')!;
    expect(row).toHaveTextContent('₱300.00');
    expect(row).toHaveTextContent('₱100.00');
    expect(row).toHaveTextContent('₱400.00');
  });

  it('folds the small categories into Other so the legend stays short', () => {
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`Cat${i}`, [(9 - i) * 10_00, 0, 0, 0]]));
    render(<TrendsChart trends={trends(many)} thisMonth="2026-11" />);
    const legend = within(screen.getByRole('list', { name: 'Categories' })).getAllByRole('listitem').map((l) => l.textContent);
    expect(legend).toEqual(['Cat0', 'Cat1', 'Cat2', 'Cat3', 'Cat4', 'Cat5', 'Other']);
  });
});
