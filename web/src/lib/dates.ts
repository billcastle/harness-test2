// All dates are calendar dates in Asia/Manila, matching the server ("today" and "this month" never come from the browser's own timezone).
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });

export const manilaToday = (now: Date = new Date()): string => fmt.format(now); // YYYY-MM-DD

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function monthRange(date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` };
}
export function addMonths(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
}

/** 'current-month' also covers any other single calendar month of the current year (picked in the month dropdown). */
export type Preset = 'current-month' | 'this-year' | 'all-time' | 'custom';
export interface Range {
  from: string;
  to: string;
}
export const ALL_TIME_START = '1970-01-01';

export function presetRange(preset: Exclude<Preset, 'custom'>, today: string): Range {
  switch (preset) {
    case 'current-month':
      return monthRange(today);
    case 'this-year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'all-time':
      return { from: ALL_TIME_START, to: today };
  }
}

/** The month number (1 to 12) when the range is exactly one calendar month of today's year, else null. */
export function monthOfYear(r: Range, today: string): number | null {
  if (r.from.slice(0, 4) !== today.slice(0, 4) || r.from.slice(8) !== '01' || monthRange(r.from).to !== r.to) return null;
  return Number(r.from.slice(5, 7));
}

/** The whole of month `month` (1 to 12) in today's year. */
export const monthOfThisYear = (month: number, today: string): Range => monthRange(`${today.slice(0, 4)}-${pad(month)}-01`);

/** Which preset (if any) a from/to pair equals, so the control can show it as selected. */
export function detectPreset(r: Range, today: string): Preset {
  if (monthOfYear(r, today) !== null) return 'current-month';
  for (const p of ['this-year', 'all-time'] as const) {
    const pr = presetRange(p, today);
    if (pr.from === r.from && pr.to === r.to) return p;
  }
  return 'custom';
}

/** The range in the URL, or this month when absent or invalid. */
export function rangeFromParams(params: URLSearchParams, today: string): Range {
  const from = params.get('from');
  const to = params.get('to');
  if (isValidDate(from) && isValidDate(to) && from <= to) return { from, to };
  return monthRange(today);
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "Nov 3, 2026" */
export const shortDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]!.slice(0, 3)} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;

/** The heading above the total: "November 2026", "2026", "All time", or "Nov 3, 2026 – Nov 9, 2026". */
export function rangeLabel(r: Range, today: string): string {
  const monthStart = r.from.slice(8) === '01' && monthRange(r.from).to === r.to;
  if (monthStart) return `${MONTHS[Number(r.from.slice(5, 7)) - 1]} ${r.from.slice(0, 4)}`;
  if (r.from.endsWith('-01-01') && r.to === `${r.from.slice(0, 4)}-12-31`) return r.from.slice(0, 4);
  if (detectPreset(r, today) === 'all-time') return 'All time';
  return `${shortDate(r.from)} – ${shortDate(r.to)}`;
}
