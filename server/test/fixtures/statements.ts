// Synthetic statements (invented names and numbers) in the same three layouts as the real ones, with printed totals
// that reconcile. Used instead of real statements, which are private and gitignored.
import type { Cell } from './makePdf.js';

const money = (centavos: number) => (centavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const spaced = (s: string) => s.split('').join(' '); // BPI text is character-spaced

// ------------------------------------------------------------------ GCash
export interface GcashRow {
  at: string; // "2026-11-03 12:46 PM"
  desc: string[]; // one or more description lines
  credit?: boolean;
  amount: number; // centavos
}
export const GCASH_ROWS: GcashRow[] = [
  { at: '2026-11-02 09:15 AM', desc: ['Payment to Cafe Uno'], amount: 18500 },
  { at: '2026-11-03 12:46 PM', desc: ['Payment to Google, Merchant Transaction Number:', 'G31abcDEFghiJKLmnoPQR'], amount: 37900 }, // two lines
  { at: '2026-11-04 08:00 PM', desc: ['Received GCash from BPI / VYBE by BPI with account ending', 'in 1234 and', 'invno:20261104XXXX'], credit: true, amount: 500000 },
  { at: '2026-11-05 10:30 AM', desc: ['Transfer from 09170000000 to 09181111111'], amount: 30000 },
  { at: '2026-11-06 03:05 PM', desc: ['Refund from Grab Philippines'], credit: true, amount: 12000 },
  { at: '2026-11-07 06:40 PM', desc: ['Payment to Cafe Uno'], amount: 18500 }, // same merchant and amount as the first, different day
];
const START = 100000;

export function gcashPages(rows: GcashRow[] = GCASH_ROWS, opts: { breakChainAt?: number; wrongTotals?: boolean } = {}): Cell[][] {
  const cells: Cell[] = [
    { x: 210, y: 713, s: 'GCash Transaction History' },
    { x: 263, y: 691, s: '2026-11-01 to 2026-11-30' },
    { x: 97, y: 673, s: 'Date and Time' }, { x: 214, y: 673, s: 'Description' }, { x: 324, y: 673, s: 'Reference No.' },
    { x: 416, y: 673, s: 'Debit' }, { x: 457, y: 673, s: 'Credit' }, { x: 497, y: 673, s: 'Balance' },
    { x: 161, y: 664, s: 'STARTING BALANCE' }, { x: 498, y: 664, s: (START / 100).toFixed(2) },
  ];
  let y = 652;
  let bal = START;
  let totalOut = 0;
  let totalIn = 0;
  rows.forEach((r, i) => {
    // description lines sit around the date row like the real statements: 2 lines at +3/-3, 3 lines at +6/0/-7
    const offsets = r.desc.length === 1 ? [0] : r.desc.length === 2 ? [3, -3] : [6, 0, -7];
    r.desc.forEach((line, k) => cells.push({ x: 161, y: y + (offsets[k] ?? 0), s: line }));
    bal += r.credit ? r.amount : -r.amount;
    if (opts.breakChainAt === i) bal += 5000; // an unlisted reversal, like the real GCash statement
    if (r.credit) totalIn += r.amount;
    else totalOut += r.amount;
    cells.push({ x: 97, y, s: r.at }, { x: 295, y, s: String(8000000000000 + i) });
    cells.push({ x: r.credit ? 452 : 413, y, s: (r.amount / 100).toFixed(2) }, { x: 498, y, s: (bal / 100).toFixed(2) });
    y -= 30;
  });
  const bump = opts.wrongTotals ? 100 : 0;
  cells.push({ x: 161, y, s: 'ENDING BALANCE' }, { x: 498, y, s: (bal / 100).toFixed(2) });
  cells.push({ x: 161, y: y - 10, s: 'Total Debit' }, { x: 405, y: y - 10, s: ((totalOut + bump) / 100).toFixed(2) });
  cells.push({ x: 161, y: y - 20, s: 'Total Credit' }, { x: 449, y: y - 20, s: (totalIn / 100).toFixed(2) });
  return [cells];
}

// ------------------------------------------------------------------ BPI credit card
export interface BpiRow {
  tx: [string, number]; // [Month name, day]
  post: [string, number];
  desc: string[]; // words
  amount: number; // centavos, negative = payment
}
export const BPI_ROWS: BpiRow[] = [
  { tx: ['September', 28], post: ['September', 28], desc: ['Payment', 'Received'], amount: -300000 },
  { tx: ['September', 12], post: ['September', 14], desc: ['Cafe', 'Uno', 'Makati'], amount: 24500 },
  { tx: ['September', 12], post: ['September', 14], desc: ['Bookshop', 'Manila'], amount: 138000 },
  { tx: ['October', 9], post: ['October', 12], desc: ['Hotel', 'Stay', 'Pasay'], amount: 309500 },
];

export function bpiPages(rows: BpiRow[] = BPI_ROWS, opts: { wrongPurchases?: boolean } = {}): Cell[][] {
  const purchases = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const credits = -rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
  const prev = credits; // previous balance fully paid
  const due = prev - credits + purchases;
  const word = (x: number, y: number, s: string): Cell => ({ x, y, s: spaced(s) });
  const page1: Cell[] = [
    word(342, 641, 'STATEMENT'), word(406, 641, 'DATE'), word(476, 641, 'OCTOBER'), word(529, 641, '12,'), word(545, 641, '2026'),
    word(36, 619, 'JUAN DELA CRUZ'),
  ];
  const page2: Cell[] = []; // an image-only page in the real statement: no text at all
  const sum = [prev, credits, opts.wrongPurchases ? purchases + 100 : purchases, 0, 0, 0, due];
  const page3: Cell[] = [
    word(324, 641, 'STATEMENT'), word(388, 641, 'DATE'), word(476, 641, 'OCTOBER'), word(529, 641, '12,'), word(545, 641, '2026'),
    word(43, 479, 'BPI'), word(58, 479, 'Rewards'),
    ...sum.map((v, i) => word(133 + i * 56, 479, money(v))),
  ];
  const page6: Cell[] = [
    { x: 36, y: 659, s: 'Statement of Account' },
    word(54, 583, 'Transaction'), word(220, 583, 'Description'), word(504, 583, 'Amount'),
  ];
  let y = 551;
  for (const r of rows) {
    page6.push(word(54, y, r.tx[0]), word(101, y, String(r.tx[1])), word(144, y, r.post[0]), word(191, y, String(r.post[1])));
    let wx = 220; // advance by each spaced word's width plus a gap, so neighbouring words never touch
    for (const w of r.desc) {
      page6.push(word(wx, y, w));
      wx += spaced(w).length * 3.2 + 14;
    }
    page6.push(word(r.amount < 0 ? 488 : 496, y, (r.amount < 0 ? '-' : '') + money(Math.abs(r.amount))));
    y -= 10;
  }
  return [page1, page2, page3, page6];
}

// ------------------------------------------------------------------ Maribank
export interface MariRow {
  day?: string; // "03" or undefined for the month-only interest row
  desc: string[];
  incoming?: boolean;
  amount: number;
}
export const MARI_ROWS: MariRow[] = [
  { desc: ['Interest', 'Net Interest'], incoming: true, amount: 1051 }, // no day
  { day: '09', desc: ['Shopee', 'Payment'], amount: 133200 },
  { day: '11', desc: ['Shopee', 'Payment'], amount: 44100 },
  { day: '11', desc: ['Shopee', 'Payment'], amount: 44100 }, // an identical repeat on the same day
  { day: '12', desc: ['Refund - Shopee', 'Payment'], incoming: true, amount: 44100 },
  { day: '19', desc: ['Juan Dela Cruz', 'Transfer'], incoming: true, amount: 5000000 },
  { day: '19', desc: ['Others'], amount: 10000000 },
];

export function maribankPages(rows: MariRow[] = MARI_ROWS, opts: { wrongTotals?: boolean } = {}): Cell[][] {
  const out = rows.filter((r) => !r.incoming).reduce((s, r) => s + r.amount, 0);
  const inn = rows.filter((r) => r.incoming).reduce((s, r) => s + r.amount, 0);
  const start = 20_000_000;
  const end = start - out + inn;
  const num = (c: number) => money(c);
  const p1: Cell[] = [
    { x: 40, y: 708, s: 'MARIBANK ACCOUNT: 00000000000' },
    { x: 233, y: 618, s: '01 OCT 2026 to 31 OCT 2026' },
    { x: 49, y: 547, s: 'SAVINGS' }, { x: 189, y: 547, s: num(start) }, { x: 289, y: 547, s: num(out + (opts.wrongTotals ? 100 : 0)) },
    { x: 398, y: 547, s: num(inn) }, { x: 510, y: 547, s: num(end) },
    { x: 187, y: 275, s: 'SAVINGS - TRANSACTION DETAILS' },
    { x: 49, y: 244, s: 'DATE' }, { x: 169, y: 244, s: 'TRANSACTION' }, { x: 364, y: 244, s: 'OUTGOING' }, { x: 485, y: 244, s: 'INCOMING' },
  ];
  const p2: Cell[] = [{ x: 49, y: 727, s: 'DATE' }, { x: 169, y: 727, s: 'TRANSACTION' }, { x: 364, y: 727, s: 'OUTGOING' }, { x: 485, y: 727, s: 'INCOMING' }];
  // first three rows on page 1, the rest continue on page 2
  const split = 3;
  const place = (cells: Cell[], list: MariRow[], startY: number) => {
    let y = startY;
    for (const r of list) {
      const date = (r.day ? `${r.day} ` : '') + 'OCT';
      cells.push({ x: 49, y, s: date }, { x: r.incoming ? 517 : 390, y, s: num(r.amount) });
      if (r.desc.length === 1) cells.push({ x: 169, y, s: r.desc[0]! });
      else cells.push({ x: 169, y: y + 7, s: r.desc[0]! }, { x: 169, y: y - 7, s: r.desc[1]! });
      y -= 40;
    }
    return y;
  };
  place(p1, rows.slice(0, split), 210);
  p1.push({ x: 500, y: 42, s: 'page' });
  const yEnd = place(p2, rows.slice(split), 693);
  p2.push({ x: 179, y: yEnd - 10, s: 'SAVINGS - INTEREST & TAX DETAILS*' });
  return [p1, p2];
}
