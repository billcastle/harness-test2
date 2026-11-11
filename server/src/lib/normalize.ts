// One normalization function shared by dedupe hashing and merchant rules (plan: "one shared function in one module").
import { createHash } from 'node:crypto';

/** Lowercase, collapse whitespace, trim. */
export function normalizeText(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
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
