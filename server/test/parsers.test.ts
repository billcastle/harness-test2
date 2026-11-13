import { describe, expect, it } from 'vitest';
import { tidyGcashDescription } from '../src/import/parsers/gcash.js';
import { parseStatement } from '../src/import/detect.js';
import { hasPdfMagic, parseInWorker } from '../src/import/run.js';
import { ImportError } from '../src/import/types.js';
import { loadPages } from '../src/import/util.js';
import { makePdf } from './fixtures/makePdf.js';
import { bpiPages, BPI_ROWS, gcashPages, GCASH_ROWS, maribankPages, MARI_ROWS } from './fixtures/statements.js';

const parse = async (pages: ReturnType<typeof gcashPages>, bank?: 'gcash' | 'bpi' | 'maribank') => parseStatement(makePdf(pages), bank);

describe('GCash description tidying', () => {
  it.each([
    ['Payment to Grab Philippines', 'Grab Philippines'],
    ['Bills Payment to UnionBank of the Philippines', 'UnionBank of the Philippines'],
    ['Payment to Google, Merchant Transaction Number: G31ism9WWKhgs7dZiKE42aR', 'Google'],
    ['Refund from MoveIt', 'MoveIt'],
    ['Received GCash from BDO Unibank, Inc. with account ending in 8701 and invno:20260103BOPIPHMMXXXB000215727574685', 'BDO Unibank, Inc. ·8701'],
    ['Transfer from System to AbC123xyz', 'System → AbC123xyz'],
    ['Something GCash has not used before', 'Something GCash has not used before'],
  ])('%s -> %s', (raw, tidy) => expect(tidyGcashDescription(raw)).toBe(tidy));

  it('transfers and loads show only the other party once your own number is known', () => {
    const own = '09170000000';
    expect(tidyGcashDescription(`Transfer from ${own} to 09181111111`, own)).toBe('09181111111');
    expect(tidyGcashDescription(`Transfer from 09182222222 to ${own}`, own)).toBe('09182222222');
    expect(tidyGcashDescription(`Buy Load Transaction for ${own}`, own)).toBe('Load');
    expect(tidyGcashDescription('Buy Load Transaction for 09183333333', own)).toBe('Load 09183333333');
  });

  it('finds your own number as the one on most rows', async () => {
    const rows = [
      ...[1, 2, 3].map((i) => ({ at: `2026-11-0${i} 09:00 AM`, desc: [`Transfer from 09170000000 to 0918111111${i}`], amount: 1000 })),
      { at: '2026-11-04 09:00 AM', desc: ['Buy Load Transaction for 09170000000'], amount: 500 },
    ];
    const r = await parse(gcashPages(rows));
    expect(r.rows.map((x) => x.description)).toEqual(['09181111111', '09181111112', '09181111113', 'Load']);
  });

  it('classification still reads the original text, not the tidy one', async () => {
    const r = await parse(gcashPages());
    expect(r.rows[2]!.kind).toBe('transfer'); // "BPI / VYBE by BPI ·1234" alone would not say "Received GCash from"
  });
});

describe('GCash parser', () => {
  it('reads every row with the right date, description (including multi-line), direction and amount', async () => {
    const r = await parse(gcashPages());
    expect(r.bank).toBe('gcash');
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(GCASH_ROWS.length);
    expect(r.rows.map((x) => [x.date, x.description, x.direction, x.amountCentavos])).toEqual([
      ['2026-11-02', 'Cafe Uno', 'out', 18500],
      ['2026-11-03', 'Google', 'out', 37900],
      ['2026-11-04', 'BPI / VYBE by BPI ·1234', 'in', 500000],
      ['2026-11-05', '09170000000 → 09181111111', 'out', 30000],
      ['2026-11-06', 'Grab Philippines', 'in', 12000],
      ['2026-11-07', 'Cafe Uno', 'out', 18500],
    ]);
  });

  it('classifies by the editable rules: merchant payments are expenses, bank top-ups are transfers, refunds are refunds', async () => {
    const r = await parse(gcashPages());
    expect(r.rows.map((x) => x.kind)).toEqual(['expense', 'expense', 'transfer', 'expense', 'refund', 'expense']);
    expect(r.rows[3]).toMatchObject({ review: true }); // person-to-person transfer needs a human look
    expect(r.rows[2]).toMatchObject({ review: true }); // "is that bank account yours?"
    expect(r.rows[0]!.review).toBeUndefined();
  });

  it('reconciles against the printed Total Debit and Total Credit', async () => {
    const r = await parse(gcashPages());
    expect(r.reconcile).toMatchObject({ ok: true, parsedOut: '1049.00', printedTotalDebit: '1049.00', parsedIn: '5120.00', printedTotalCredit: '5120.00' });
    expect(r.warnings).toEqual([]);
  });

  it('fails reconciliation when a printed total disagrees', async () => {
    expect((await parse(gcashPages(GCASH_ROWS, { wrongTotals: true }))).reconcile.ok).toBe(false);
  });

  it('a broken running balance is a warning, not a failure (the statement itself is inconsistent)', async () => {
    const r = await parse(gcashPages(GCASH_ROWS, { breakChainAt: 3 }));
    expect(r.reconcile.ok).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ reason: expect.stringMatching(/balance chain mismatch/) });
  });

  it('a row it cannot read becomes an error row, never a silently dropped one', async () => {
    const pages = gcashPages();
    pages[0] = pages[0]!.filter((c) => c.s !== (GCASH_ROWS[0]!.amount / 100).toFixed(2) || c.x < 400); // remove the first row's amount
    const r = await parse(pages);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatchObject({ reason: expect.stringMatching(/expected an amount/) });
    expect(r.reconcile.ok).toBe(false);
  });
});

describe('BPI credit card parser', () => {
  it('reads purchases and the payment, skips text-less pages, and infers the year from the statement date', async () => {
    const r = await parse(bpiPages());
    expect(r.bank).toBe('bpi');
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.date, x.description, x.direction, x.amountCentavos])).toEqual([
      ['2026-09-28', 'Payment Received', 'in', 300000],
      ['2026-09-12', 'Cafe Uno Makati', 'out', 24500],
      ['2026-09-12', 'Bookshop Manila', 'out', 138000],
      ['2026-10-09', 'Hotel Stay Pasay', 'out', 309500],
    ]);
    expect(r.rows.map((x) => x.kind)).toEqual(['transfer', 'expense', 'expense', 'expense']); // the card payment is not spending
    expect(r.reconcile).toMatchObject({ ok: true, textlessPagesSkipped: [2], statementDate: '2026-10-12' });
  });

  it('fails reconciliation when the printed purchases disagree with the rows', async () => {
    expect((await parse(bpiPages(BPI_ROWS, { wrongPurchases: true }))).reconcile.ok).toBe(false);
  });
});

describe('Maribank parser', () => {
  it('reads rows across a page break, with direction taken from the column, and a month-only interest row', async () => {
    const r = await parse(maribankPages());
    expect(r.bank).toBe('maribank');
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(MARI_ROWS.length);
    expect(r.rows.map((x) => [x.date, x.description, x.direction, x.amountCentavos])).toEqual([
      ['2026-10-31', 'Interest Net Interest', 'in', 1051],
      ['2026-10-09', 'Shopee Payment', 'out', 133200],
      ['2026-10-11', 'Shopee Payment', 'out', 44100],
      ['2026-10-11', 'Shopee Payment', 'out', 44100],
      ['2026-10-12', 'Refund - Shopee Payment', 'in', 44100],
      ['2026-10-19', 'Juan Dela Cruz Transfer', 'in', 5000000],
      ['2026-10-19', 'Others', 'out', 10000000],
    ]);
    expect(r.rows[0]).toMatchObject({ dateApprox: true, kind: 'income' });
    expect(r.rows.find((x) => x.description === 'Refund - Shopee Payment')!.kind).toBe('refund');
    expect(r.rows[6]).toMatchObject({ kind: 'transfer', review: true }); // "Others" outgoing: probably a time deposit
  });

  it('reconciles to the printed outgoing, incoming and ending balance', async () => {
    const r = await parse(maribankPages());
    expect(r.reconcile.ok).toBe(true);
    const [computed, printed] = String(r.reconcile.balanceCheck).split(' vs ');
    expect(computed).toBe(printed); // starting balance - outgoing + incoming equals the printed ending balance
  });

  it('fails reconciliation when a printed total disagrees', async () => {
    expect((await parse(maribankPages(MARI_ROWS, { wrongTotals: true }))).reconcile.ok).toBe(false);
  });
});

describe('detection and the worker', () => {
  it('detects each bank from the content', async () => {
    expect((await parse(gcashPages())).bank).toBe('gcash');
    expect((await parse(bpiPages())).bank).toBe('bpi');
    expect((await parse(maribankPages())).bank).toBe('maribank');
  });

  it('an unrecognized PDF needs the bank to be chosen; choosing a wrong bank warns', async () => {
    const blank = makePdf([[{ x: 50, y: 700, s: 'Some other document' }]]);
    await expect(parseStatement(blank)).rejects.toMatchObject({ code: 'unknown_bank' });
    const r = await parseStatement(makePdf(gcashPages()), 'maribank');
    expect(r.warnings[0]).toMatchObject({ reason: expect.stringMatching(/looks like a gcash statement/) });
  });

  it('the PDF magic check rejects non-PDF bytes whatever the file is called', () => {
    expect(hasPdfMagic(makePdf([[]]))).toBe(true);
    expect(hasPdfMagic(new TextEncoder().encode('MZ not a pdf at all'))).toBe(false);
    expect(hasPdfMagic(new Uint8Array(0))).toBe(false);
  });

  it('loads pages with positions from real PDF bytes', async () => {
    const pages = await loadPages(makePdf([[{ x: 100, y: 200, s: 'hello' }]]));
    expect(pages[0]!.items).toEqual([{ x: 100, y: 200, s: 'hello' }]);
  });

  it('parseInWorker returns the same result as parsing in-process', async () => {
    const bytes = makePdf(gcashPages());
    const viaWorker = await parseInWorker(bytes, undefined);
    expect(viaWorker.rows).toHaveLength(GCASH_ROWS.length);
    expect(viaWorker.reconcile.ok).toBe(true);
  });

  it('parseInWorker rejects non-PDF input and oversized files without starting a worker', async () => {
    await expect(parseInWorker(new TextEncoder().encode('definitely not a pdf'), undefined)).rejects.toMatchObject({ code: 'not_pdf' });
    await expect(parseInWorker(new Uint8Array(10 * 1024 * 1024 + 1), undefined)).rejects.toMatchObject({ code: 'too_large' });
  });

  it('a corrupt PDF becomes a clean error for that upload', async () => {
    const corrupt = new TextEncoder().encode('%PDF-1.4\nthis is garbage, not a real document\n%%EOF');
    await expect(parseInWorker(corrupt, undefined)).rejects.toBeInstanceOf(ImportError);
  });

  it('a parse that runs too long is stopped (timeout) and the process keeps going', async () => {
    const t0 = Date.now();
    await expect(parseInWorker(makePdf(gcashPages()), undefined, { timeoutMs: 1 })).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(5000);
    // and a normal parse still works afterwards
    expect((await parseInWorker(makePdf(gcashPages()), undefined)).rows.length).toBeGreaterThan(0);
  });
});
