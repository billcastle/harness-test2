import { classify } from '../rules.js';
import type { ParsedRow, ParseIssue, ParseResult } from '../types.js';
import { fmt, groupRows, MONTHS, pad2, toCentavos, type Page } from '../util.js';

const compact = (s: string) => s.replace(/\s+/g, '');
const MONTH_NAMES = 'JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER';

export const isBpi = (pages: Page[]): boolean =>
  pages.some((p) => groupRows(p.items).some((r) => /BPICreditCards|StatementofAccount/i.test(r.cells.map((c) => compact(c.s)).join(''))));

/**
 * BPI credit card statement. Text is character-spaced ("P a y m e n t"), so every cell is compacted.
 * Payments carry an explicit minus sign. Pages without text (interest examples, announcements) are skipped.
 */
export function parseBpiPages(pages: Page[]): ParseResult {
  const raw: { txMonth: number; txDay: number; description: string; amount: number }[] = [];
  const errors: ParseIssue[] = [];
  let stmt: { y: number; m: number; d: number } | null = null;
  let summary: { prev: number; credits: number; purchases: number; installment: number; finance: number; late: number; due: number } | null = null;
  const textlessPages: number[] = [];

  for (const { n, items } of pages) {
    if (items.length === 0) {
      textlessPages.push(n);
      continue;
    }
    for (const line of groupRows(items)) {
      const c = line.cells.map((x) => ({ x: x.x, s: compact(x.s) }));
      const joined = c.map((x) => x.s).join('');
      if (!stmt && joined.includes('STATEMENT')) {
        const m = new RegExp(`(${MONTH_NAMES})(\\d{1,2}),(\\d{4})`).exec(joined);
        if (m) stmt = { y: Number(m[3]), m: MONTHS[m[1]!.slice(0, 3)]!, d: Number(m[2]) };
      }
      const nums = c.map((x) => toCentavos(x.s)).filter((v): v is number => v !== null);
      if (!summary && /^BPI/.test(c[0]?.s ?? '') && nums.length === 7) {
        summary = { prev: nums[0]!, credits: nums[1]!, purchases: nums[2]!, installment: nums[3]!, finance: nums[4]!, late: nums[5]!, due: nums[6]! };
      }
      // transaction row: Month Day Month Day Description... Amount
      if (c.length >= 6 && MONTHS[c[0]!.s.slice(0, 3).toUpperCase()] && /^[A-Za-z]+$/.test(c[0]!.s) && /^\d{1,2}$/.test(c[1]!.s) &&
          MONTHS[c[2]!.s.slice(0, 3).toUpperCase()] && /^\d{1,2}$/.test(c[3]!.s)) {
        const amt = toCentavos(c[c.length - 1]!.s);
        if (amt === null) {
          errors.push({ page: n, reason: 'no amount at the end of the row', text: c.map((x) => x.s).join(' ') });
          continue;
        }
        raw.push({ txMonth: MONTHS[c[0]!.s.slice(0, 3).toUpperCase()]!, txDay: Number(c[1]!.s), description: c.slice(4, -1).map((x) => x.s).join(' '), amount: amt });
      }
    }
  }
  if (!stmt) errors.push({ reason: 'statement date not found' });

  const rows: ParsedRow[] = raw.map((r) => {
    // a card statement covers about a month; a transaction month later than the statement month belongs to the previous year
    const y = stmt ? (r.txMonth > stmt.m ? stmt.y - 1 : stmt.y) : 0;
    const direction = r.amount < 0 ? 'in' : 'out';
    const description = r.description;
    return { date: `${y}-${pad2(r.txMonth)}-${pad2(r.txDay)}`, description, direction, amountCentavos: Math.abs(r.amount), ...classify('bpi', direction, description) };
  });
  const purchases = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amountCentavos, 0);
  const credits = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amountCentavos, 0);
  const chainOk = !!summary && summary.prev - summary.credits + summary.purchases + summary.installment + summary.finance + summary.late === summary.due;
  return {
    bank: 'bpi',
    rows,
    errors,
    warnings: [],
    reconcile: {
      statementDate: stmt ? `${stmt.y}-${pad2(stmt.m)}-${pad2(stmt.d)}` : null,
      textlessPagesSkipped: textlessPages,
      parsedPurchases: fmt(purchases), statementPurchases: summary ? fmt(summary.purchases) : null,
      parsedCredits: fmt(credits), statementCredits: summary ? fmt(summary.credits) : null,
      statementAmountDue: summary ? fmt(summary.due) : null,
      ok: !!summary && purchases === summary.purchases && credits === summary.credits && chainOk && errors.length === 0,
    },
  };
}

export const parseBpi = async (bytes: Uint8Array): Promise<ParseResult> => {
  const { loadPages } = await import('../util.js');
  return parseBpiPages(await loadPages(bytes));
};
