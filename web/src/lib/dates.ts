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

export type Preset = 'this-month' | 'last-month' | 'this-year' | 'all-time' | 'custom';
export interface Range {
  from: string;
  to: string;
}
export const ALL_TIME_START = '1970-01-01';

export function presetRange(preset: Exclude<Preset, 'custom'>, today: string): Range {
  switch (preset) {
    case 'this-month':
      return monthRange(today);
    case 'last-month':
      return monthRange(addMonths(today, -1));
    case 'this-year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'all-time':
      return { from: ALL_TIME_START, to: today };
  }
}

/** Which preset (if any) a from/to pair equals, so the control can show it as selected. */
export function detectPreset(r: Range, today: string): Preset {
  for (const p of ['this-month', 'last-month', 'this-year', 'all-time'] as const) {
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
