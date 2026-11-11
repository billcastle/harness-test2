// Money is integer centavos everywhere. Parsing is string -> bigint -> number with no float math.
export const MAX_CENTAVOS = 9_000_000_000_000; // 90 billion pesos; matches the DB CHECK

export class MoneyError extends Error {}

const PLAIN = /^\d+(\.\d{1,2})?$/;
const GROUPED = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;

/** "250.50" -> 25050, "1,250.5" -> 125050. Rejects negatives, zero, symbols, >2 decimals, and values over the cap. */
export function parseAmount(input: unknown): number {
  if (typeof input !== 'string' && typeof input !== 'number') throw new MoneyError('amount is required');
  const raw = String(input).trim();
  if (!PLAIN.test(raw) && !GROUPED.test(raw)) {
    throw new MoneyError('amount must look like 250, 250.5, 250.50 or 1,250.50 (no symbols, at most 2 decimals)');
  }
  const [whole = '0', frac = ''] = raw.replace(/,/g, '').split('.');
  const centavos = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  if (centavos <= 0n) throw new MoneyError('amount must be greater than zero');
  if (centavos > BigInt(MAX_CENTAVOS)) throw new MoneyError('amount is too large');
  return Number(centavos);
}

/** 123450 -> "1234.50" (plain string, no currency symbol; the UI adds the peso sign and grouping). */
export function formatCentavos(c: number): string {
  const sign = c < 0 ? '-' : '';
  const abs = BigInt(Math.abs(c));
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
