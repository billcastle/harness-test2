import { classify } from '../rules.js';
import type { ParsedRow, ParseIssue, ParseResult } from '../types.js';
import { fmt, loadPages, nearestAnchor, toCentavos, type Item, type Page } from '../util.js';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}) ([AP]M)$/;

export const isGcash = (pages: Page[]): boolean => pages[0]?.items.some((i) => i.s === 'GCash Transaction History') ?? false;

/** Columns by x position: date ~97, description ~161, reference ~295, debit ~410-416, credit ~452, balance ~495. */
export function parseGcashPages(pages: Page[]): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: ParseIssue[] = [];
  const warnings: ParseIssue[] = [];
  const footer: Record<string, number> = {};
  let startBalance: number | null = null;
  let prevBalance: number | null = null;
  let chainChecks = 0;
  let chainMismatches = 0;
  const FOOTER = new Set(['STARTING BALANCE', 'ENDING BALANCE', 'Total Debit', 'Total Credit']);

  for (const { n, items } of pages) {
    const hdr = items.find((i) => i.s === 'Debit');
    const headerY = hdr ? hdr.y : Infinity;
    const body = items.filter((i) => i.y < headerY - 1);
    const sb = body.find((i) => i.s === 'STARTING BALANCE');
    if (sb) {
      const b = body.find((i) => Math.abs(i.y - sb.y) < 2 && i.x > 480);
      if (b) startBalance = prevBalance = toCentavos(b.s);
    }
    for (const label of ['ENDING BALANCE', 'Total Debit', 'Total Credit']) {
      const f = body.find((i) => i.s === label);
      const v = f && body.find((i) => Math.abs(i.y - f.y) < 2 && i.x > 380 && toCentavos(i.s) !== null);
      if (v) footer[label] = toCentavos(v.s)!;
    }
    const anchors = body.filter((i) => i.x < 150 && DATE_RE.test(i.s));
    const frags = body.filter((i) => i.x >= 150 && i.x < 290 && !FOOTER.has(i.s));
    const byAnchor = new Map<Item, Item[]>(anchors.map((a) => [a, []]));
    for (const f of frags) {
      const a = nearestAnchor(anchors, f.y);
      if (a && Math.abs(a.y - f.y) <= 12) byAnchor.get(a)!.push(f);
      else errors.push({ page: n, reason: 'orphan description fragment', text: f.s });
    }
    for (const a of anchors.sort((p, q) => q.y - p.y)) {
      const same = body.filter((i) => Math.abs(i.y - a.y) <= 2.5 && i.x >= 290);
      const ref = same.find((i) => /^\d{10,}$/.test(i.s));
      const nums = same.filter((i) => i.x > 380 && /^\d+\.\d\d$/.test(i.s)).sort((p, q) => p.x - q.x);
      if (nums.length !== 2) {
        errors.push({ page: n, reason: `expected an amount and a balance, found ${nums.length}`, date: a.s });
        continue;
      }
      const [amt, bal] = nums as [Item, Item];
      const isCredit = amt.x > 435;
      const amount = toCentavos(amt.s)!;
      const balance = toCentavos(bal.s)!;
      const description = byAnchor.get(a)!.sort((p, q) => q.y - p.y || p.x - q.x).map((f) => f.s).join(' ');
      if (prevBalance !== null) {
        chainChecks++;
        const expected = prevBalance + (isCredit ? amount : -amount);
        if (expected !== balance) {
          chainMismatches++;
          warnings.push({ page: n, reason: 'balance chain mismatch (the statement is inconsistent here; amounts were still captured)', date: a.s, expected: fmt(expected), got: fmt(balance) });
        }
      }
      prevBalance = balance;
      const m = DATE_RE.exec(a.s)!;
      const direction = isCredit ? 'in' : 'out';
      rows.push({ date: `${m[1]}-${m[2]}-${m[3]}`, description, direction, amountCentavos: amount, reference: ref?.s ?? null, ...classify('gcash', direction, description) });
    }
  }
  const out = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amountCentavos, 0);
  const inn = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amountCentavos, 0);
  const printedOut = footer['Total Debit'] ?? null;
  const printedIn = footer['Total Credit'] ?? null;
  return {
    bank: 'gcash',
    rows,
    errors,
    warnings,
    reconcile: {
      parsedOut: fmt(out), printedTotalDebit: printedOut === null ? null : fmt(printedOut),
      parsedIn: fmt(inn), printedTotalCredit: printedIn === null ? null : fmt(printedIn),
      startBalance: startBalance === null ? null : fmt(startBalance),
      balanceChainChecks: chainChecks,
      balanceChainMismatches: chainMismatches,
      // printed totals are the pass/fail check; a broken balance chain is only a warning
      ok: printedOut !== null && printedIn !== null && out === printedOut && inn === printedIn && errors.length === 0,
    },
  };
}

export async function parseGcash(bytes: Uint8Array): Promise<ParseResult> {
  return parseGcashPages(await loadPages(bytes));
}
