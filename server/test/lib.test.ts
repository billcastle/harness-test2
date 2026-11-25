import { describe, expect, it } from 'vitest';
import { guessCategoryId } from '../src/import/guess.js';
import { formatCentavos, MoneyError, parseAmount } from '../src/lib/money.js';
import { isValidDate, manilaToday, monthRange, spanDays } from '../src/lib/time.js';
import { parseTrustProxy } from '../src/lib/trust-proxy.js';
import { assignOccurrenceIndexes, dedupeHash, merchantKey, normalizeText } from '../src/lib/normalize.js';

describe('parseAmount', () => {
  it.each([
    ['250', 25000],
    ['250.5', 25050],
    ['250.50', 25050],
    ['1,250.5', 125050],
    ['100,000.00', 10_000_000],
    ['0.01', 1],
    [250.5, 25050],
    ['  42  ', 4200],
  ])('accepts %j -> %i', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each([
    '250.555', // more than 2 decimals
    '-5', // negative
    '0', '0.00', // zero
    '₱250', '$5', // symbols
    '1,25.00', '1,2500', // bad grouping
    '.5', '5.', '1e3', 'abc', '', ' ',
    '90000000000.01', // above the cap
  ])('rejects %j', (input) => {
    expect(() => parseAmount(input)).toThrow(MoneyError);
  });

  it('rejects non-string, non-number input', () => {
    expect(() => parseAmount(undefined)).toThrow(MoneyError);
    expect(() => parseAmount(null)).toThrow(MoneyError);
    expect(() => parseAmount({})).toThrow(MoneyError);
  });

  it('has no float drift (0.1 + 0.2 style values stay exact)', () => {
    expect(parseAmount('0.07')).toBe(7);
    expect(parseAmount('19.99')).toBe(1999);
    expect(parseAmount('90000000000.00')).toBe(9_000_000_000_000);
  });

  it('formats centavos back to a plain string', () => {
    expect(formatCentavos(123450)).toBe('1234.50');
    expect(formatCentavos(5)).toBe('0.05');
    expect(formatCentavos(-4200)).toBe('-42.00');
  });
});

describe('Asia/Manila time', () => {
  it('uses Manila, not UTC: 23:30 UTC on a month end is already the next month in Manila', () => {
    const now = new Date('2026-10-31T23:30:00Z'); // 2026-11-01 07:30 in Manila
    expect(manilaToday(now)).toBe('2026-11-01');
    expect(monthRange(manilaToday(now))).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });

  it('still the previous day in Manila just before 16:00 UTC', () => {
    expect(manilaToday(new Date('2026-11-10T15:59:00Z'))).toBe('2026-11-10');
    expect(manilaToday(new Date('2026-11-10T16:00:00Z'))).toBe('2026-11-11');
  });

  it('month ranges handle February and leap years', () => {
    expect(monthRange('2027-02-10')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    expect(monthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('validates real calendar dates only', () => {
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('26-01-01')).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
  });

  it('counts inclusive span days', () => {
    expect(spanDays('2026-11-01', '2026-11-01')).toBe(1);
    expect(spanDays('2026-11-01', '2026-11-30')).toBe(30);
    expect(spanDays('2026-01-01', '2026-03-03')).toBe(62);
    expect(spanDays('2026-01-01', '2026-03-04')).toBe(63);
  });
});

describe('normalization and dedupe hash', () => {
  const base = { source: 'gcash', date: '2026-01-03', amountCentavos: 37900, description: 'Payment to Google', occurrenceIndex: 0 };

  it('normalizes case and whitespace', () => {
    expect(normalizeText('  Payment   TO\tGoogle ')).toBe('payment to google');
  });

  it('same logical row hashes the same regardless of case/whitespace', () => {
    expect(dedupeHash(base)).toBe(dedupeHash({ ...base, description: '  PAYMENT to   google' }));
  });

  it('differs when any identifying field or the occurrence index differs', () => {
    const h = dedupeHash(base);
    expect(dedupeHash({ ...base, source: 'bpi' })).not.toBe(h);
    expect(dedupeHash({ ...base, date: '2026-01-04' })).not.toBe(h);
    expect(dedupeHash({ ...base, amountCentavos: 37901 })).not.toBe(h);
    expect(dedupeHash({ ...base, occurrenceIndex: 1 })).not.toBe(h);
  });

  it('numbers identical rows within one statement so real repeats stay distinct', () => {
    const rows = [
      { source: 'maribank', date: '2026-10-11', amountCentavos: 44100, description: 'Shopee Payment' },
      { source: 'maribank', date: '2026-10-11', amountCentavos: 44100, description: 'shopee  payment' },
      { source: 'maribank', date: '2026-10-11', amountCentavos: 207500, description: 'Shopee Payment' },
    ];
    const out = assignOccurrenceIndexes(rows);
    expect(out.map((r) => r.occurrenceIndex)).toEqual([0, 1, 0]);
    expect(new Set(out.map((r) => dedupeHash(r))).size).toBe(3);
  });

  it('overlap cases: a re-import of the same statement matches every hash; a shorter window matches a prefix', () => {
    const stmt1 = assignOccurrenceIndexes([base, base]).map(dedupeHash); // two identical rows: idx 0 and 1
    const stmt2 = assignOccurrenceIndexes([base]).map(dedupeHash); // overlapping window sees only one
    expect(stmt2[0]).toBe(stmt1[0]); // flagged as a possible duplicate, which is correct
    const reimport = assignOccurrenceIndexes([base, base]).map(dedupeHash);
    expect(reimport).toEqual(stmt1);
    // a row deleted from the DB then re-imported is simply absent from the existing-hash set, so it shows as new
    const existing = new Set([stmt1[0]]);
    expect(reimport.filter((h) => !existing.has(h))).toEqual([stmt1[1]]);
  });
});

describe('merchantKey', () => {
  it('ignores per-transaction reference numbers so one merchant is one key', () => {
    const a = merchantKey('Payment to Google, Merchant Transaction Number: G31ism9WWKhgs7dZiKE42aR');
    const b = merchantKey('Payment  to GOOGLE, Merchant Transaction Number: G3KKebvPpPVufLE3cFfyBTn');
    expect(a).toBe('payment to google');
    expect(b).toBe(a);
  });
  it('ignores invoice numbers', () => {
    expect(merchantKey('Received GCash from BPI with account ending in 4495 and invno:20260103BOPIPHMMXXXB000215727574685'))
      .toBe('received gcash from bpi with account ending in 4495 and');
  });
  it('keeps what really distinguishes merchants and recipients', () => {
    expect(merchantKey('Transfer from 09170000000 to 09181111111')).not.toBe(merchantKey('Transfer from 09170000000 to 09182222222'));
    expect(merchantKey('Payment to Cafe Uno')).not.toBe(merchantKey('Payment to Cafe Dos'));
  });
  it('the dedupe hash still sees the full text, so two real Google payments stay distinct', () => {
    const base = { source: 'gcash', date: '2026-01-03', amountCentavos: 37900, occurrenceIndex: 0 };
    expect(dedupeHash({ ...base, description: 'Payment to Google, Merchant Transaction Number: AAA' }))
      .not.toBe(dedupeHash({ ...base, description: 'Payment to Google, Merchant Transaction Number: BBB' }));
  });
});

describe('parseTrustProxy', () => {
  it('unset means the socket address; "true" trusts the platform header; otherwise a list', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('TRUE')).toBe(true);
    expect(parseTrustProxy('10.0.0.1, 172.28.0.0/24')).toEqual(['10.0.0.1', '172.28.0.0/24']);
  });
});

describe('guessCategoryId', () => {
  const cats = [{ id: 2, name: 'Transport' }, { id: 3, name: 'Shopping' }, { id: 4, name: 'Subscriptions' }, { id: 5, name: 'Food' }];
  it.each([
    ['Payment to Grab, Merchant Transaction Number: G1', 2],
    ['MOVEIT RIDE', 2],
    ['SHOPEE MANILA PH', 3],
    ['Lazada Philippines', 3],
    ['Payment to Spotify', 4],
    ['Payment to Google, Merchant Transaction Number: G31', 4],
    ['GRABFOOD ORDER', 5],
    ['McDelivery', 5],
    ['JFC', 5],
    ['ZUS COFFEE', 5],
    ['Transfer to Juan', null],
    ['Meralco', null], // no Bills category to land in
  ])('%s -> %s', (d, id) => {
    expect(guessCategoryId(d, cats)).toBe(id);
  });
});
