import { addMonths, monthRange } from './time.js';

export type Frequency = 'monthly' | 'yearly';
export const FREQUENCIES: readonly Frequency[] = ['monthly', 'yearly'];

export interface RecurringTerms {
  amountCentavos: number;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
}

/** What one month of this item costs: a monthly bill in full, a yearly bill as one twelfth. */
export const monthlyCost = (r: Pick<RecurringTerms, 'amountCentavos' | 'frequency'>): number =>
  r.frequency === 'monthly' ? r.amountCentavos : r.amountCentavos / 12;

const daysIn = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000 + 1;

/**
 * The cost of a recurring item inside [from, to], in whole centavos.
 * It applies from the month of its first charge to the month of its end date, and never to months after the one
 * containing `today` (nothing is projected into the future). Each month contributes its monthly cost times the
 * share of that month's days that fall inside the range, so a whole month counts in full and a custom range is
 * pro-rated. Months are the unit, so an item that starts on the 20th still counts for the whole month it started in.
 */
export function recurringCost(r: RecurringTerms, from: string, to: string, today: string): number {
  const firstMonth = `${r.startDate.slice(0, 7)}-01`;
  const lastDay = [to, monthRange(today).to, r.endDate ? monthRange(r.endDate).to : '9999-12-31'].reduce((a, b) => (a < b ? a : b));
  let month = from > firstMonth ? `${from.slice(0, 7)}-01` : firstMonth;
  let months = 0;
  while (month <= lastDay) {
    const { to: monthEnd } = monthRange(month);
    const lo = from > month ? from : month;
    const hi = to < monthEnd ? to : monthEnd;
    const cap = hi < lastDay ? hi : lastDay;
    if (cap >= lo) months += daysIn(lo, cap) / daysIn(month, monthEnd);
    month = addMonths(month, 1);
  }
  return Math.round(monthlyCost(r) * months);
}

/** The next date on or after `today` that this item is charged, or null once it has ended. A day that does not exist that month (the 31st) falls on the month's last day. */
export function nextDue(r: Pick<RecurringTerms, 'frequency' | 'startDate' | 'endDate'>, today: string): string | null {
  const day = Number(r.startDate.slice(8, 10));
  const clamp = (monthStart: string) => {
    const end = monthRange(monthStart).to;
    return `${monthStart.slice(0, 8)}${String(Math.min(day, Number(end.slice(8, 10)))).padStart(2, '0')}`;
  };
  let candidate: string;
  if (r.frequency === 'monthly') {
    candidate = clamp(`${today.slice(0, 7)}-01`);
    if (candidate < today) candidate = clamp(addMonths(`${today.slice(0, 7)}-01`, 1));
  } else {
    const startMonth = r.startDate.slice(5, 7);
    let year = Number(today.slice(0, 4));
    candidate = clamp(`${year}-${startMonth}-01`);
    if (candidate < today) candidate = clamp(`${++year}-${startMonth}-01`);
  }
  if (candidate < r.startDate) candidate = r.startDate;
  return r.endDate && candidate > r.endDate ? null : candidate;
}

