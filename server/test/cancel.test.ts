import { describe, expect, it } from 'vitest';
import { cancelRefunds } from '../src/import/cancel.js';
import type { ParsedRow } from '../src/import/types.js';

const row = (over: Partial<ParsedRow>): ParsedRow => ({ date: '2026-11-03', description: 'Shopee', direction: 'out', amountCentavos: 50_000, kind: 'expense', reason: 'x', ...over });
const refund = (over: Partial<ParsedRow>) => row({ direction: 'in', kind: 'refund', description: 'Shopee', date: '2026-11-09', ...over });

describe('cancelRefunds', () => {
  it('a refund and the purchase it undid are both dropped', () => {
    const { drop, cancelled } = cancelRefunds('gcash', [row({}), refund({})]);
    expect([...drop].sort()).toEqual([0, 1]);
    expect(cancelled).toEqual([{ description: 'Shopee', amountCentavos: 50_000, paidOn: '2026-11-03', refundedOn: '2026-11-09' }]);
  });

  it('matches across the wording the banks use: "Payment to X" with "Refund from X", "Refund - X Payment" with "X Payment"', () => {
    expect(cancelRefunds('gcash', [row({ description: 'Payment to Lazada' }), refund({ description: 'Refund from Lazada' })]).drop.size).toBe(2);
    expect(cancelRefunds('maribank', [row({ description: 'Shopee Payment' }), refund({ description: 'Refund - Shopee Payment' })]).drop.size).toBe(2);
    expect(cancelRefunds('gcash', [row({ description: 'Payment to Lazada, Merchant Transaction Number: ABC' }), refund({ description: 'Refund from Lazada' })]).drop.size).toBe(2);
  });

  it('needs the same amount and the same merchant, and a purchase on or before the refund', () => {
    expect(cancelRefunds('gcash', [row({}), refund({ amountCentavos: 49_900 })]).drop.size).toBe(0); // a partial refund is not a cancellation
    expect(cancelRefunds('gcash', [row({}), refund({ description: 'Refund from Lazada' })]).drop.size).toBe(0);
    expect(cancelRefunds('gcash', [row({ date: '2026-11-10' }), refund({ date: '2026-11-09' })]).drop.size).toBe(0);
    expect(cancelRefunds('gcash', [row({ date: '2026-11-09' }), refund({ date: '2026-11-09' })]).drop.size).toBe(2); // same day is fine
  });

  it('one refund cancels one purchase; the closest earlier one, and the rest stay', () => {
    const rows = [row({ date: '2026-11-01' }), row({ date: '2026-11-05' }), refund({})];
    const { drop } = cancelRefunds('gcash', rows);
    expect([...drop].sort()).toEqual([1, 2]);
    const two = cancelRefunds('gcash', [row({ date: '2026-11-01' }), row({ date: '2026-11-05' }), refund({ date: '2026-11-08' }), refund({ date: '2026-11-09' })]);
    expect(two.drop.size).toBe(4);
  });

  it('a refund with no matching purchase in the statement stays, because it still reduces spending', () => {
    expect(cancelRefunds('gcash', [refund({})]).drop.size).toBe(0);
  });

  it('income, transfers and other outgoing kinds are never matched', () => {
    expect(cancelRefunds('gcash', [row({ kind: 'transfer' }), refund({})]).drop.size).toBe(0);
    expect(cancelRefunds('gcash', [row({}), row({ direction: 'in', kind: 'income', date: '2026-11-09' })]).drop.size).toBe(0);
  });

  it('BPI: a credit that matches a purchase is a refund and cancels it; any other credit is a card payment and is left out', () => {
    const rows = [
      row({ description: 'AMAZON', amountCentavos: 120_000 }),
      row({ direction: 'in', kind: 'transfer', description: 'AMAZON', amountCentavos: 120_000, date: '2026-11-09' }),
      row({ direction: 'in', kind: 'transfer', description: 'Payment Received', amountCentavos: 300_000, date: '2026-11-10' }),
      row({ description: 'GROCER', amountCentavos: 20_000 }),
    ];
    const { drop, cancelled, leftOut } = cancelRefunds('bpi', rows);
    expect([...drop].sort()).toEqual([0, 1, 2]);
    expect(cancelled).toHaveLength(1);
    expect(leftOut).toEqual([{ description: 'Payment Received', date: '2026-11-10', amountCentavos: 300_000, reason: 'credit card payment' }]);
  });

  it('only BPI card payments are left out; other banks keep their non-expense rows for review', () => {
    expect(cancelRefunds('gcash', [row({ direction: 'in', kind: 'transfer', description: 'Received GCash from BPI' })]).leftOut).toEqual([]);
    expect(cancelRefunds('maribank', [row({ direction: 'in', kind: 'transfer', description: 'Bill Castillo' })]).drop.size).toBe(0);
  });
});
