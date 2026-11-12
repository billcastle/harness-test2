import type { Kind } from '../repo/transactions.js';

export type Bank = 'gcash' | 'bpi' | 'maribank';
export const BANKS: Bank[] = ['gcash', 'bpi', 'maribank'];

/** One transaction row read from a statement, before the user reviews it. */
export interface ParsedRow {
  date: string; // YYYY-MM-DD
  dateApprox?: boolean; // the statement gave no day (Maribank monthly interest)
  description: string;
  direction: 'in' | 'out';
  amountCentavos: number; // always positive
  kind: Kind; // a guess from the classification rules
  reason: string;
  review?: boolean; // the guess is uncertain; show it to the user
  reference?: string | null;
}

export interface ParseIssue {
  page?: number;
  reason: string;
  [k: string]: unknown;
}

export interface ParseResult {
  bank: Bank;
  rows: ParsedRow[];
  /** Things that could not be parsed. These are shown to the user, never silently dropped. */
  errors: ParseIssue[];
  /** Things worth knowing that did not stop parsing (for example the statement's own balance chain breaks). */
  warnings: ParseIssue[];
  /** Comparison of the parsed rows against the statement's own printed totals. `ok` is the pass/fail check. */
  reconcile: { ok: boolean; [k: string]: unknown };
}

export class ImportError extends Error {
  constructor(
    public code: 'not_pdf' | 'encrypted' | 'unreadable' | 'unknown_bank' | 'timeout' | 'too_large',
    message: string,
  ) {
    super(message);
  }
}
