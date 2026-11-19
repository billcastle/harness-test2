import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Preview, PreviewRow } from '../src/import/service.js';
import { upsertMerchantRule } from '../src/repo/categories.js';
import { makePdf, type Cell } from './fixtures/makePdf.js';
import { bpiPages, gcashPages, GCASH_ROWS, maribankPages, MARI_ROWS } from './fixtures/statements.js';
import { testApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await testApp();
});
beforeEach(async () => {
  await t.reset();
});

const req = async (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const res = await t.app.inject({ method, url, payload: payload as object | undefined, headers });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const postPdf = (pages: Cell[][], query = '') =>
  req('POST', `/api/import/parse${query}`, Buffer.from(makePdf(pages)), { 'content-type': 'application/pdf' });
const preview = async (pages: Cell[][]): Promise<Preview> => (await postPdf(pages)).body;
const toConfirm = (p: Preview, pick: (r: PreviewRow) => boolean = (r) => r.include, extra: Partial<Record<string, unknown>> = {}) => ({
  batchId: p.batchId,
  source: p.bank,
  rows: p.rows.filter(pick).map((r) => ({
    date: r.date, description: r.description, amountCentavos: r.amountCentavos, kind: r.kind,
    categoryId: r.suggestedCategoryId, occurrenceIndex: r.occurrenceIndex, remember: false, ...extra,
  })),
});
const txCount = async () => Number((await t.db.query<{ n: string }>('select count(*)::text as n from transactions')).rows[0]!.n);
const batchCount = async () => Number((await t.db.query<{ n: string }>('select count(*)::text as n from import_batches')).rows[0]!.n);

describe('preview', () => {
  it('parses the upload and returns rows, a batch id, and the reconciliation, saving nothing', async () => {
    const r = await postPdf(gcashPages());
    expect(r.status).toBe(200);
    expect(r.body.bank).toBe('gcash');
    expect(r.body.batchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.body.rows).toHaveLength(GCASH_ROWS.length);
    expect(r.body.reconcile.ok).toBe(true);
    expect(await txCount()).toBe(0);
    expect(await batchCount()).toBe(0);
  });

  it('ticks expenses and refunds by default and leaves transfers and income unticked', async () => {
    const p = await preview(gcashPages());
    expect(p.rows.map((x) => [x.kind, x.include])).toEqual([
      ['expense', true], ['expense', true], ['transfer', false], ['expense', true], ['refund', true], ['expense', true],
    ]);
  });

  it('suggests Uncategorized by default, and your remembered category when a merchant rule matches', async () => {
    const food = (await req('POST', '/api/categories', { name: 'Food' })).body.id as number;
    await upsertMerchantRule(t.db, 'Cafe Uno', food);
    const p = await preview(gcashPages());
    const cafe = p.rows.filter((x) => x.description === 'Cafe Uno');
    expect(cafe).toHaveLength(2);
    expect(cafe.every((x) => x.suggestedCategoryId === food && x.fromRule)).toBe(true);
    const other = p.rows.find((x) => x.kind === 'refund')!;
    expect(other.fromRule).toBe(false);
    expect(other.suggestedCategoryId).not.toBe(food);
  });

  it('a remembered category applies to a merchant whatever reference number the statement carried (it is dropped from the description)', async () => {
    const shopping = (await req('POST', '/api/categories', { name: 'Software' })).body.id as number;
    await upsertMerchantRule(t.db, 'Payment to Google, Merchant Transaction Number: OLDREF123', shopping); // an older, untidied description
    await upsertMerchantRule(t.db, 'Google', shopping);
    const p = await preview(gcashPages());
    const google = p.rows.find((x) => x.description === 'Google')!;
    expect(google.merchantKey).toBe('google');
    expect(google.suggestedCategoryId).toBe(shopping);
    expect(google.fromRule).toBe(true);
  });

  it('works for all three banks', async () => {
    expect((await preview(bpiPages())).bank).toBe('bpi');
    expect((await preview(maribankPages())).bank).toBe('maribank');
  });
});

describe('confirm', () => {
  it('saves the ticked rows as one batch with source, kind, category and a dedupe hash', async () => {
    const p = await preview(gcashPages());
    const r = await req('POST', '/api/import/confirm', toConfirm(p));
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ batchId: p.batchId, inserted: 5, alreadyImported: false });
    const rows = (await t.db.query<{ source: string; kind: string; batch: string; hash: string | null }>(
      'select source, kind, import_batch_id::text as batch, dedupe_hash as hash from transactions order by id')).rows;
    expect(rows).toHaveLength(5);
    expect(rows.every((x) => x.source === 'gcash' && x.batch === p.batchId && /^[0-9a-f]{64}$/.test(x.hash ?? ''))).toBe(true);
    expect(rows.map((x) => x.kind).sort()).toEqual(['expense', 'expense', 'expense', 'expense', 'refund']);
  });

  it('the imported rows show up in the transaction list and can be filtered by batch', async () => {
    const p = await preview(gcashPages());
    await req('POST', '/api/import/confirm', toConfirm(p));
    const list = await req('GET', `/api/transactions?batchId=${p.batchId}`);
    expect(list.body.total).toBe(5);
    expect(list.body.items[0].importBatchId).toBe(p.batchId);
  });

  it('is idempotent: confirming the same batch again adds nothing', async () => {
    const p = await preview(gcashPages());
    const body = toConfirm(p);
    expect((await req('POST', '/api/import/confirm', body)).status).toBe(201);
    const again = await req('POST', '/api/import/confirm', body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ inserted: 5, alreadyImported: true });
    expect(await txCount()).toBe(5);
    expect(await batchCount()).toBe(1);
  });

  it('a burst of simultaneous double-clicks still creates exactly one batch', async () => {
    const p = await preview(gcashPages());
    const body = toConfirm(p);
    const results = await Promise.all(Array.from({ length: 8 }, () => req('POST', '/api/import/confirm', body)));
    expect(results.filter((x) => x.status === 201)).toHaveLength(1);
    expect(results.filter((x) => x.status === 200)).toHaveLength(7);
    expect(await txCount()).toBe(5);
    expect(await batchCount()).toBe(1);
  });

  it('rejects bad input and writes nothing, including no batch row', async () => {
    const p = await preview(gcashPages());
    const good = toConfirm(p);
    const bad = (mutate: (r: Record<string, unknown>) => void) => {
      const b = structuredClone(good);
      mutate(b.rows[0] as unknown as Record<string, unknown>);
      return b;
    };
    const cases: [string, unknown, RegExp][] = [
      ['bad date', bad((r) => (r.date = '2026-02-30')), /real date/],
      ['zero amount', bad((r) => (r.amountCentavos = 0)), /amount/],
      ['fractional amount', bad((r) => (r.amountCentavos = 10.5)), /amount/],
      ['huge amount', bad((r) => (r.amountCentavos = 9_000_000_000_001)), /amount/],
      ['bad kind', bad((r) => (r.kind = 'bogus')), /kind/],
      ['bad category id', bad((r) => (r.categoryId = 'x')), /categoryId/],
      ['negative occurrence', bad((r) => (r.occurrenceIndex = -1)), /occurrenceIndex/],
      ['long description', bad((r) => (r.description = 'x'.repeat(501))), /description/],
      ['missing category', bad((r) => (r.categoryId = 99999)), /category does not exist|categories does not exist/],
      ['bad batch id', { ...good, batchId: 'nope' }, /batchId/],
      ['bad source', { ...good, source: 'chase' }, /source/],
      ['no rows', { ...good, rows: [] }, /no rows/],
    ];
    for (const [name, body, msg] of cases) {
      const r = await req('POST', '/api/import/confirm', body);
      expect(r.status, name).toBe(400);
      expect(r.body.error, name).toMatch(msg);
    }
    expect(await txCount()).toBe(0);
    expect(await batchCount()).toBe(0);
  });

  it('caps the number of rows per request', async () => {
    const p = await preview(gcashPages());
    const row = toConfirm(p).rows[0]!;
    const r = await req('POST', '/api/import/confirm', { batchId: p.batchId, source: 'gcash', rows: Array.from({ length: 2001 }, () => row) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/too many rows/);
  });

  it('never trusts the client: the hash comes from the server, so a tampered row cannot fake a "new" one', async () => {
    const p = await preview(gcashPages());
    const body = toConfirm(p);
    (body.rows[0] as unknown as Record<string, unknown>).dedupeHash = 'attacker-chosen'; // an unknown field is ignored
    await req('POST', '/api/import/confirm', body);
    const hashes = (await t.db.query<{ h: string }>('select dedupe_hash as h from transactions')).rows.map((x) => x.h);
    expect(hashes.includes('attacker-chosen')).toBe(false);
  });

  it('"remember" saves a merchant rule for the chosen category, but never for Uncategorized', async () => {
    const food = (await req('POST', '/api/categories', { name: 'Food' })).body.id as number;
    const p = await preview(gcashPages());
    const body = toConfirm(p);
    body.rows.forEach((r) => {
      r.remember = true;
      if (r.description === 'Cafe Uno') r.categoryId = food;
    });
    await req('POST', '/api/import/confirm', body);
    const rules = (await req('GET', '/api/merchant-rules')).body.items;
    expect(rules).toEqual([{ merchant: 'cafe uno', categoryId: food }]);
  });
});

describe('duplicates', () => {
  it('re-uploading the same statement flags every saved row as a possible duplicate, unticked, with a link target', async () => {
    const first = await preview(gcashPages());
    await req('POST', '/api/import/confirm', toConfirm(first));
    const second = await preview(gcashPages());
    const saved = second.rows.filter((r) => r.kind === 'expense' || r.kind === 'refund');
    expect(saved.every((r) => r.duplicateOf !== null && r.include === false)).toBe(true);
    const ids = (await t.db.query<{ id: string }>('select id::text as id from transactions')).rows.map((x) => Number(x.id));
    expect(saved.every((r) => ids.includes(r.duplicateOf!))).toBe(true);
    expect(second.rows.find((r) => r.kind === 'transfer')!.duplicateOf).toBeNull(); // it was never saved
  });

  it('a refund cancels one of two identical same-day purchases; the one left stays distinct and a partial import only flags the saved one', async () => {
    const p = await preview(maribankPages());
    expect(p.cancelled).toEqual([{ description: 'Shopee Payment', amountCentavos: 44_100, paidOn: '2026-10-11', refundedOn: '2026-10-12' }]);
    expect(p.rows.some((r) => r.description.startsWith('Refund'))).toBe(false); // the refund is not offered
    const same = p.rows.filter((r) => r.description === 'Shopee Payment' && r.date === '2026-10-11');
    expect(same).toHaveLength(1); // two purchases, one refunded
    await req('POST', '/api/import/confirm', toConfirm(p, (r) => r === same[0]));
    const again = await preview(maribankPages());
    expect(again.rows.filter((r) => r.description === 'Shopee Payment' && r.date === '2026-10-11').map((r) => r.duplicateOf !== null)).toEqual([true]);
  });

  it('a row you deleted can be imported again; soft-deleted rows do not count as duplicates', async () => {
    const p = await preview(gcashPages());
    await req('POST', '/api/import/confirm', toConfirm(p));
    const id = (await t.db.query<{ id: string }>('select min(id)::text as id from transactions')).rows[0]!.id;
    await req('DELETE', `/api/transactions/${id}`);
    const again = await preview(gcashPages());
    expect(again.rows.filter((r) => r.duplicateOf === null && (r.kind === 'expense' || r.kind === 'refund'))).toHaveLength(1);
  });
});

describe('history and undo', () => {
  it('lists batches with their row count and how many rows were edited afterwards', async () => {
    const p = await preview(gcashPages());
    await req('POST', '/api/import/confirm', toConfirm(p));
    const id = (await t.db.query<{ id: string }>('select min(id)::text as id from transactions')).rows[0]!.id;
    await t.db.query(`update transactions set updated_at = created_at + interval '1 minute' where id = $1`, [id]);
    const list = (await req('GET', '/api/import/batches')).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: p.batchId, source: 'gcash', count: 5, edited: 1 });
  });

  it('undo deletes every row of the batch, including edited ones, and keeps merchant rules', async () => {
    const food = (await req('POST', '/api/categories', { name: 'Food' })).body.id as number;
    const p = await preview(gcashPages());
    await req('POST', '/api/import/confirm', toConfirm(p, undefined, { remember: true, categoryId: food }));
    await t.db.query(`update transactions set description = 'edited by me', updated_at = created_at + interval '1 minute'`);
    await req('POST', '/api/transactions', { amount: '5', description: 'a manual one' }); // not part of the batch
    const r = await req('DELETE', `/api/import/batches/${p.batchId}`);
    expect(r.body).toEqual({ deleted: 5 });
    expect(await txCount()).toBe(1); // only the manual transaction is left
    expect((await req('GET', '/api/import/batches')).body.items).toEqual([]);
    expect((await req('GET', '/api/merchant-rules')).body.items.length).toBeGreaterThan(0);
  });

  it('undo of an unknown or malformed id is a clean error', async () => {
    expect((await req('DELETE', '/api/import/batches/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await req('DELETE', '/api/import/batches/not-a-uuid')).status).toBe(400);
  });

  it('after undo the same statement previews as brand new again', async () => {
    const p = await preview(gcashPages());
    await req('POST', '/api/import/confirm', toConfirm(p));
    await req('DELETE', `/api/import/batches/${p.batchId}`);
    const again = await preview(gcashPages());
    expect(again.rows.every((r) => r.duplicateOf === null)).toBe(true);
  });
});

describe('upload failures', () => {
  it('wrong content type is refused with 415', async () => {
    const r = await req('POST', '/api/import/parse', { not: 'a pdf' });
    expect(r.status).toBe(415);
  });

  it('bytes that are not a PDF are refused whatever they are labelled', async () => {
    const r = await req('POST', '/api/import/parse', Buffer.from('MZ this is an executable, not a pdf'), { 'content-type': 'application/pdf' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('not_pdf');
  });

  it('a corrupt PDF gives a clear message, and the API keeps working afterwards', async () => {
    const r = await req('POST', '/api/import/parse', Buffer.from('%PDF-1.4\ngarbage\n%%EOF'), { 'content-type': 'application/pdf' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('unreadable');
    expect((await postPdf(gcashPages())).status).toBe(200);
  });

  it('a file over 10 MB is refused with 413', async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 0x20);
    big.write('%PDF-1.4');
    const r = await req('POST', '/api/import/parse', big, { 'content-type': 'application/pdf' });
    expect(r.status).toBe(413);
  });

  it('an unrecognized statement asks you to choose the bank, and choosing one lets you continue', async () => {
    const other: Cell[][] = [[{ x: 50, y: 700, s: 'Some other document' }]];
    const r = await postPdf(other);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'unknown_bank', error: expect.stringMatching(/Pick the bank/) });
    const chosen = await postPdf(other, '?bank=gcash');
    expect(chosen.status).toBe(200);
    expect(chosen.body.rows).toEqual([]);
    expect(chosen.body.reconcile.ok).toBe(false); // nothing matched, so it does not pass reconciliation
  });

  it('rejects an unknown bank parameter', async () => {
    expect((await postPdf(gcashPages(), '?bank=chase')).status).toBe(400);
  });

  it('a parse that exceeds the time limit is stopped and reported', async () => {
    const slow = await testApp(undefined);
    const { buildApp } = await import('../src/app.js');
    const app = buildApp({ db: slow.db, insecureNoAuth: true, importWorker: { timeoutMs: 1 } });
    const res = await app.inject({ method: 'POST', url: '/api/import/parse', payload: Buffer.from(makePdf(gcashPages())), headers: { 'content-type': 'application/pdf' } });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('timeout');
  });
});

describe('totals are not trusted blindly', () => {
  it('a statement whose printed totals disagree is flagged in the preview, not rejected', async () => {
    const r = await postPdf(gcashPages(GCASH_ROWS, { wrongTotals: true }));
    expect(r.status).toBe(200);
    expect(r.body.reconcile.ok).toBe(false);
  });

  it('keeps the whole Maribank statement together, including its page break', async () => {
    const p = await preview(maribankPages());
    expect(p.rows).toHaveLength(MARI_ROWS.length - 2); // the refund and the purchase it undid are left out
    expect(p.cancelled).toHaveLength(1);
    expect(p.reconcile.ok).toBe(true); // the statement still adds up: the parser saw every row
  });
});
