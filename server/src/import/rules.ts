import rulesJson from './rules.json' with { type: 'json' };
import type { Kind } from '../repo/transactions.js';
import type { Bank } from './types.js';

interface Rule {
  pattern?: string;
  kind: Kind;
  reason: string;
  review?: boolean;
}
interface BankRules {
  in: Rule[];
  inDefault: Rule;
  out: Rule[];
  outDefault: Rule;
}
const rules = rulesJson as unknown as Record<Bank, BankRules>;

export function classify(bank: Bank, direction: 'in' | 'out', description: string): { kind: Kind; reason: string; review?: boolean } {
  const set = rules[bank];
  const list = direction === 'in' ? set.in : set.out;
  const hit = list.find((r) => r.pattern && new RegExp(r.pattern, 'i').test(description));
  const r = hit ?? (direction === 'in' ? set.inDefault : set.outDefault);
  return { kind: r.kind, reason: r.reason, ...(r.review ? { review: true } : {}) };
}
