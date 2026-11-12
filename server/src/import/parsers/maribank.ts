import { classify } from '../rules.js';
import type { ParsedRow, ParseIssue, ParseResult } from '../types.js';
import { fmt, loadPages, MONTHS, nearestAnchor, pad2, toCentavos, type Item, type Page } from '../util.js';

const DATE_RE = /^(?:(\d{2}) )?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/;

export const isMaribank = (pages: Page[]): boolean => pages[0]?.items.some((i) => /MARIBANK ACCOUNT/i.test(i.s)) ?? false;

/** Direction comes from the amount's x position: OUTGOING column ends about x=406, INCOMING starts about x=485. */
export function parseMaribankPages(pages: Page[]): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: ParseIssue[] = [];
  let period: string | null = null;
  let summary: { start: number; outgoing: number; incoming: number; end: number } | null = null;
  let inSection = false;
  let ended = false;

  for (const { n, items } of pages) {
    if (!period) period = items.find((i) => /^\d{2} [A-Z]{3} \d{4} to \d{2} [A-Z]{3} \d{4}$/.test(i.s))?.s ?? null;
    if (!summary) {
      const top = items.find((i) => i.s === 'SAVINGS' && i.x < 80);
      if (top) {
        const nums = items.filter((i) => Math.abs(i.y - top.y) < 2 && i.x > 150).sort((a, b) => a.x - b.x).map((i) => toCentavos(i.s));
        if (nums.length === 4 && nums.every((v): v is number => v !== null)) summary = { start: nums[0]!, outgoing: nums[1]!, incoming: nums[2]!, end: nums[3]! };
      }
    }
    if (ended) continue;
    const start = items.find((i) => i.s === 'SAVINGS - TRANSACTION DETAILS');
    const stop = items.find((i) => i.s.startsWith('SAVINGS - INTEREST'));
    let top = Infinity;
    if (start) {
      inSection = true;
      top = start.y;
    } else if (inSection) top = 740; // continuation page: below the page header
    if (!inSection) continue;
    let bottom = 60; // above the footer
    if (stop) {
      bottom = stop.y;
      ended = true;
    }
    const hdr = items.find((i) => i.s === 'TRANSACTION' && i.x > 150 && i.x < 200);
    const hdrY = hdr ? hdr.y : Infinity;
    const section = items.filter((i) => i.y < top - 1 && i.y > bottom + 1 && i.y < hdrY - 1);
    const anchors = section.filter((i) => i.x < 80 && DATE_RE.test(i.s));
    const frags = section.filter((i) => i.x >= 150 && i.x < 340);
    const bucket = new Map<Item, Item[]>(anchors.map((a) => [a, []]));
    for (const f of frags) {
      const a = nearestAnchor(anchors, f.y);
      if (a && Math.abs(a.y - f.y) <= 14) bucket.get(a)!.push(f);
      else errors.push({ page: n, reason: 'orphan description fragment', text: f.s });
    }
    const yr = period ? Number(period.slice(7, 11)) : null;
    for (const a of anchors.sort((p, q) => q.y - p.y)) {
      const amts = section.filter((i) => Math.abs(i.y - a.y) <= 2.5 && i.x >= 340 && toCentavos(i.s) !== null);
      if (amts.length !== 1) {
        errors.push({ page: n, reason: `expected one amount, found ${amts.length}`, date: a.s });
        continue;
      }
      const direction = amts[0]!.x > 450 ? 'in' : 'out';
      const dm = DATE_RE.exec(a.s)!;
      const description = bucket.get(a)!.sort((p, q) => q.y - p.y || p.x - q.x).map((f) => f.s).join(' ');
      const month = MONTHS[dm[2]!]!;
      const lastDay = yr ? new Date(Date.UTC(yr, month, 0)).getUTCDate() : 28;
      rows.push({
        date: `${yr ?? 0}-${pad2(month)}-${dm[1] ?? pad2(lastDay)}`,
        ...(dm[1] ? {} : { dateApprox: true }),
        description,
        direction,
        amountCentavos: toCentavos(amts[0]!.s)!,
        ...classify('maribank', direction, description),
      });
    }
  }
  const out = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amountCentavos, 0);
  const inn = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amountCentavos, 0);
  return {
    bank: 'maribank',
    rows,
    errors,
    warnings: [],
    reconcile: {
      period,
      parsedOutgoing: fmt(out), statementOutgoing: summary ? fmt(summary.outgoing) : null,
      parsedIncoming: fmt(inn), statementIncoming: summary ? fmt(summary.incoming) : null,
      balanceCheck: summary ? `${fmt(summary.start - out + inn)} vs ${fmt(summary.end)}` : null,
      ok: !!summary && out === summary.outgoing && inn === summary.incoming && summary.start - out + inn === summary.end && errors.length === 0,
    },
  };
}

export const parseMaribank = async (bytes: Uint8Array): Promise<ParseResult> => parseMaribankPages(await loadPages(bytes));
