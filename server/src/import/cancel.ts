import { merchantKey } from '../lib/normalize.js';
import type { Bank, ParsedRow } from './types.js';

/** A purchase and the refund that undid it. Neither is imported: together they cost nothing. */
export interface CancelledPair {
  description: string;
  amountCentavos: number;
  paidOn: string;
  refundedOn: string;
}
/** A row that is never an expense, so it is not offered for import at all. */
export interface LeftOut {
  description: string;
  date: string;
  amountCentavos: number;
  reason: string;
}

/** "Refund - Shopee Payment" and "Payment to Shopee" both come down to a name, so a refund can be matched to what it refunds. */
const core = (description: string): string =>
  merchantKey(description)
    .replace(/^(refund|reversal)\b[\s\-–:]*(of|from|for)?\s*/, '')
    .replace(/^(bills )?payment to\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** A credit on a card statement is either your payment to the bank or a refund; only a refund can match a purchase. */
const isCreditCandidate = (bank: Bank, r: ParsedRow) => r.direction === 'in' && (r.kind === 'refund' || (bank === 'bpi' && r.kind === 'transfer'));

/**
 * Within one statement, pairs each refund with an earlier purchase of the same amount from the same merchant (one purchase per
 * refund, the closest one before it). Paired rows are returned as `cancelled` and must not be imported. Credit card payments
 * (BPI credits that match no purchase) are returned as `leftOut`. Everything else is untouched. Refunds with no purchase in this
 * statement stay, because they still reduce what you spent.
 */
export function cancelRefunds(bank: Bank, rows: ParsedRow[]): { drop: Set<number>; cancelled: CancelledPair[]; leftOut: LeftOut[] } {
  const drop = new Set<number>();
  const cancelled: CancelledPair[] = [];
  const credits = rows.map((r, i) => ({ r, i })).filter(({ r }) => isCreditCandidate(bank, r)).sort((a, b) => a.r.date.localeCompare(b.r.date) || a.i - b.i);
  for (const { r: credit, i: ci } of credits) {
    const name = core(credit.description);
    let best = -1;
    rows.forEach((p, pi) => {
      if (drop.has(pi) || p.direction !== 'out' || p.kind !== 'expense' || p.amountCentavos !== credit.amountCentavos || p.date > credit.date) return;
      if (!name || core(p.description) !== name) return;
      if (best === -1 || p.date >= rows[best]!.date) best = pi; // the closest purchase before the refund
    });
    if (best === -1) continue;
    drop.add(best).add(ci);
    cancelled.push({ description: rows[best]!.description, amountCentavos: credit.amountCentavos, paidOn: rows[best]!.date, refundedOn: credit.date });
  }
  const leftOut: LeftOut[] = [];
  if (bank === 'bpi') {
    rows.forEach((r, i) => {
      if (drop.has(i) || r.direction !== 'in' || r.kind !== 'transfer') return;
      drop.add(i);
      leftOut.push({ description: r.description, date: r.date, amountCentavos: r.amountCentavos, reason: 'credit card payment' });
    });
  }
  return { drop, cancelled, leftOut };
}
