// One normalization function shared by dedupe hashing and merchant rules (plan: "one shared function in one module").
import { createHash } from 'node:crypto';

/** Lowercase, collapse whitespace, trim. */
export function normalizeText(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The key a remembered category is stored under, and what "similar rows" means. It is the normalized description
 * without per-transaction reference numbers, which differ on every row of the same merchant
 * ("Payment to Google, Merchant Transaction Number: G31ism9WW..."). The dedupe hash deliberately keeps the full text.
 */
export function merchantKey(s: string): string {
  return normalizeText(s)
    .replace(/merchant transaction number:?\s*\S+/g, '')
    .replace(/invno:\S+/g, '')
    .replace(/[\s,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface HashInput {
  source: string;
  date: string;
  amountCentavos: number;
  description: string;
  occurrenceIndex: number;
}

export function dedupeHash(i: HashInput): string {
  const key = [i.source, i.date, i.amountCentavos, normalizeText(i.description), i.occurrenceIndex].join('|');
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Number identical rows within one statement (same source, date, amount, normalized description) 0, 1, 2...
 * so two real same-day identical purchases get different hashes.
 */
export function assignOccurrenceIndexes<T extends Omit<HashInput, 'occurrenceIndex'>>(rows: T[]): (T & { occurrenceIndex: number })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const key = [r.source, r.date, r.amountCentavos, normalizeText(r.description)].join('|');
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return { ...r, occurrenceIndex: n };
  });
}
