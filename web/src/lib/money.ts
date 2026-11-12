const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

/** 123450 -> "₱1,234.50". Centavos are integers below 2^53, so the division is exact enough for display. */
export const formatPeso = (centavos: number): string => peso.format(centavos / 100);

/** 123450 -> "1234.50" (what an amount input holds while editing). */
export const centavosToInput = (c: number): string => (c / 100).toFixed(2);

// Same rules as the server (which is authoritative): plain or comma-grouped, at most 2 decimals, greater than zero.
const PLAIN = /^\d+(\.\d{1,2})?$/;
const GROUPED = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;
export function checkAmount(raw: string): string | null {
  const s = raw.trim();
  if (!s) return 'Enter an amount';
  if (!PLAIN.test(s) && !GROUPED.test(s)) return 'Use numbers like 250 or 1,250.50';
  if (Number(s.replace(/,/g, '')) <= 0) return 'Amount must be more than zero';
  return null;
}
