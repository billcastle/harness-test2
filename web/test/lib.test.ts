import { describe, expect, it } from 'vitest';
import { addMonths, detectPreset, isValidDate, manilaToday, monthRange, presetRange, rangeFromParams } from '../src/lib/dates';
import { centavosToInput, checkAmount, formatPeso } from '../src/lib/money';

describe('Manila dates', () => {
  it('23:30 UTC on a month end is already next month in Manila', () => {
    expect(manilaToday(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
    expect(manilaToday(new Date('2026-11-10T15:59:00Z'))).toBe('2026-11-10');
    expect(manilaToday(new Date('2026-11-10T16:00:00Z'))).toBe('2026-11-11');
  });
  it('month math handles year boundaries and leap years', () => {
    expect(monthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
    expect(presetRange('last-month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('presets: this year and all time', () => {
    expect(presetRange('this-year', '2026-11-15')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(presetRange('all-time', '2026-11-15')).toEqual({ from: '1970-01-01', to: '2026-11-15' });
  });
  it('detects which preset a range equals, else custom', () => {
    const today = '2026-11-15';
    expect(detectPreset(presetRange('this-month', today), today)).toBe('this-month');
    expect(detectPreset(presetRange('all-time', today), today)).toBe('all-time');
    expect(detectPreset({ from: '2026-11-02', to: '2026-11-09' }, today)).toBe('custom');
  });
  it('reads the range from the URL, falling back to this month when absent or invalid', () => {
    const today = '2026-11-15';
    expect(rangeFromParams(new URLSearchParams('from=2026-01-01&to=2026-03-31'), today)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(rangeFromParams(new URLSearchParams(''), today)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(rangeFromParams(new URLSearchParams('from=2026-03-31&to=2026-01-01'), today)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(rangeFromParams(new URLSearchParams('from=bad&to=2026-01-01'), today)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
  it('validates real calendar dates', () => {
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-02-28')).toBe(true);
  });
});

describe('money', () => {
  it('formats pesos with grouping and two decimals', () => {
    expect(formatPeso(123450)).toBe('₱1,234.50');
    expect(formatPeso(5)).toBe('₱0.05');
  });
  it('turns centavos into an editable string', () => {
    expect(centavosToInput(123450)).toBe('1234.50');
  });
  it.each(['250', '250.5', '1,250.50'])('accepts %s', (s) => expect(checkAmount(s)).toBeNull());
  it.each(['', '  ', '250.555', '-5', '0', '₱250', 'abc', '1,25.00'])('rejects %j', (s) => expect(checkAmount(s)).not.toBeNull());
});
