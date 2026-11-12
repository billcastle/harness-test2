// Runs the real parser path on the owner's actual statements when they exist locally.
// statements/ is gitignored (private), so on any other machine these tests are skipped, not failed.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseInWorker } from '../src/import/run.js';
import type { Bank } from '../src/import/types.js';

const dir = path.resolve(import.meta.dirname, '..', '..', 'statements');
const known: { bank: Bank; file: string; rows: number }[] = [
  { bank: 'gcash', file: 'gcash.pdf', rows: 322 },
  { bank: 'bpi', file: 'bpi.pdf', rows: 15 },
  { bank: 'maribank', file: 'maribank.pdf', rows: 17 },
];

describe.each(known)('real $bank statement', ({ bank, file, rows }) => {
  const p = path.join(dir, file);
  it.skipIf(!fs.existsSync(p))('is detected, fully read, and reconciles against its own printed totals', async () => {
    const r = await parseInWorker(fs.readFileSync(p), undefined, { timeoutMs: 60_000 });
    expect(r.bank).toBe(bank);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(rows);
    expect(r.reconcile.ok).toBe(true);
    expect(r.rows.every((x) => x.amountCentavos > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.date))).toBe(true);
  }, 90_000);
});
