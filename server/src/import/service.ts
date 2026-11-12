import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';
import { AppError, pgCode } from '../errors.js';
import { MAX_CENTAVOS } from '../lib/money.js';
import { assignOccurrenceIndexes, dedupeHash, merchantKey } from '../lib/normalize.js';
import { isValidDate } from '../lib/time.js';
import { getUncategorizedId, upsertMerchantRule } from '../repo/categories.js';
import { KINDS, type Kind } from '../repo/transactions.js';
import { BANKS, type Bank, type ParsedRow, type ParseIssue, type ParseResult } from './types.js';

export const MAX_IMPORT_ROWS = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PreviewRow extends ParsedRow {
  index: number;
  /** Rows with the same key are "similar": they share a remembered category. */
  merchantKey: string;
  occurrenceIndex: number;
  /** Id of an existing transaction with the same hash, when this row looks like one you already imported. */
  duplicateOf: number | null;
  suggestedCategoryId: number;
  /** A merchant rule matched, so the suggestion is one you chose before. */
  fromRule: boolean;
  /** Whether the row starts ticked: expenses and refunds that are not duplicates. */
  include: boolean;
}
export interface Preview {
  batchId: string;
  bank: Bank;
  rows: PreviewRow[];
  errors: ParseIssue[];
  warnings: ParseIssue[];
  reconcile: ParseResult['reconcile'];
}

/** Flags duplicates against what is already stored and pre-fills categories from your merchant rules. Saves nothing. */
export async function buildPreview(db: Db, result: ParseResult): Promise<Preview> {
  const indexed = assignOccurrenceIndexes(result.rows.map((r) => ({ source: result.bank, date: r.date, amountCentavos: r.amountCentavos, description: r.description })));
  const hashes = indexed.map((r) => dedupeHash(r));
  const existing = new Map<string, number>();
  if (hashes.length) {
    const r = await db.query<{ dedupe_hash: string; id: string }>(
      'select dedupe_hash, min(id)::text as id from transactions where dedupe_hash = any($1::text[]) and deleted_at is null group by dedupe_hash',
      [hashes],
    );
    for (const row of r.rows) existing.set(row.dedupe_hash, Number(row.id));
  }
  const merchants = [...new Set(result.rows.map((r) => merchantKey(r.description)))];
  const rules = new Map<string, number>();
  if (merchants.length) {
    const r = await db.query<{ m: string; c: string }>('select merchant_normalized as m, category_id::text as c from merchant_rules where merchant_normalized = any($1::text[])', [merchants]);
    for (const row of r.rows) rules.set(row.m, Number(row.c));
  }
  const uncategorized = await getUncategorizedId(db);

  const rows: PreviewRow[] = result.rows.map((r, i) => {
    const duplicateOf = existing.get(hashes[i]!) ?? null;
    const rule = rules.get(merchantKey(r.description));
    return {
      ...r,
      index: i,
      merchantKey: merchantKey(r.description),
      occurrenceIndex: indexed[i]!.occurrenceIndex,
      duplicateOf,
      suggestedCategoryId: rule ?? uncategorized,
      fromRule: rule !== undefined,
      include: (r.kind === 'expense' || r.kind === 'refund') && duplicateOf === null,
    };
  });
  return { batchId: randomUUID(), bank: result.bank, rows, errors: result.errors, warnings: result.warnings, reconcile: result.reconcile };
}

// ---------------------------------------------------------------- confirm
export interface ConfirmRow {
  date: string;
  description: string;
  amountCentavos: number;
  kind: Kind;
  categoryId: number;
  occurrenceIndex: number;
  remember: boolean;
}
export interface ConfirmInput {
  batchId: string;
  source: Bank;
  rows: ConfirmRow[];
}

/** The client's rows are never trusted: every field is re-validated here. */
export function parseConfirmBody(body: unknown): ConfirmInput {
  if (typeof body !== 'object' || body === null) throw new AppError(400, 'JSON body required');
  const b = body as Record<string, unknown>;
  if (typeof b.batchId !== 'string' || !UUID_RE.test(b.batchId)) throw new AppError(400, 'batchId must be a UUID');
  if (typeof b.source !== 'string' || !(BANKS as string[]).includes(b.source)) throw new AppError(400, `source must be one of ${BANKS.join(', ')}`);
  if (!Array.isArray(b.rows) || b.rows.length < 1) throw new AppError(400, 'there are no rows to import');
  if (b.rows.length > MAX_IMPORT_ROWS) throw new AppError(400, `too many rows (limit ${MAX_IMPORT_ROWS})`);
  const rows = b.rows.map((raw, i): ConfirmRow => {
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const at = `row ${i + 1}`;
    if (!isValidDate(r.date)) throw new AppError(400, `${at}: date must be a real date`);
    if (typeof r.amountCentavos !== 'number' || !Number.isInteger(r.amountCentavos) || r.amountCentavos < 1 || r.amountCentavos > MAX_CENTAVOS) throw new AppError(400, `${at}: amount is not valid`);
    if (typeof r.description !== 'string' || r.description.length > 500) throw new AppError(400, `${at}: description must be text up to 500 characters`);
    if (typeof r.kind !== 'string' || !(KINDS as readonly string[]).includes(r.kind)) throw new AppError(400, `${at}: kind is not valid`);
    if (typeof r.categoryId !== 'number' || !Number.isInteger(r.categoryId) || r.categoryId < 1) throw new AppError(400, `${at}: categoryId is not valid`);
    if (typeof r.occurrenceIndex !== 'number' || !Number.isInteger(r.occurrenceIndex) || r.occurrenceIndex < 0 || r.occurrenceIndex > 100_000) throw new AppError(400, `${at}: occurrenceIndex is not valid`);
    return { date: r.date, description: r.description.trim(), amountCentavos: r.amountCentavos, kind: r.kind as Kind, categoryId: r.categoryId, occurrenceIndex: r.occurrenceIndex, remember: r.remember === true };
  });
  return { batchId: b.batchId, source: b.source as Bank, rows };
}

export interface ConfirmResult {
  batchId: string;
  inserted: number;
  /** True when this batchId was already saved (a double click or a retry): nothing new was written. */
  alreadyImported: boolean;
}

/** Saves the whole batch in one transaction. Repeating the same batchId is harmless. */
export async function confirmImport(db: Db, input: ConfirmInput): Promise<ConfirmResult> {
  try {
    return await db.transaction(async (tx) => {
      const claimed = await tx.query('insert into import_batches (id, source) values ($1, $2) on conflict (id) do nothing returning id', [input.batchId, input.source]);
      if (claimed.rowCount === 0) {
        const n = await tx.query<{ n: string }>('select count(*)::text as n from transactions where import_batch_id = $1', [input.batchId]);
        return { batchId: input.batchId, inserted: Number(n.rows[0]!.n), alreadyImported: true };
      }
      const CHUNK = 200;
      for (let i = 0; i < input.rows.length; i += CHUNK) {
        const chunk = input.rows.slice(i, i + CHUNK);
        const params: unknown[] = [];
        const values = chunk.map((r) => {
          const hash = dedupeHash({ source: input.source, date: r.date, amountCentavos: r.amountCentavos, description: r.description, occurrenceIndex: r.occurrenceIndex });
          params.push(r.date, r.amountCentavos, r.description, r.categoryId, input.source, r.kind, input.batchId, hash);
          const n = params.length;
          return `($${n - 7}, $${n - 6}, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}::uuid, $${n})`;
        });
        await tx.query(
          `insert into transactions (date, amount_centavos, description, category_id, source, kind, import_batch_id, dedupe_hash) values ${values.join(', ')}`,
          params,
        );
      }
      const uncategorized = await getUncategorizedId(tx);
      for (const r of input.rows) if (r.remember && r.categoryId !== uncategorized && r.description) await upsertMerchantRule(tx, r.description, r.categoryId);
      return { batchId: input.batchId, inserted: input.rows.length, alreadyImported: false };
    });
  } catch (err) {
    if (pgCode(err) === '23503') throw new AppError(400, 'one of the categories does not exist');
    throw err;
  }
}

// ---------------------------------------------------------------- history and undo
export interface BatchSummary {
  id: string;
  source: Bank;
  importedAt: string;
  count: number;
  /** Rows changed after the import. Undo deletes them too, so the confirmation shows this number. */
  edited: number;
}

export async function listBatches(db: Db): Promise<BatchSummary[]> {
  const r = await db.query<{ id: string; source: Bank; at: string; n: string; edited: string }>(
    `select b.id::text as id, b.source, b.imported_at::text as at,
            count(t.id)::text as n, count(t.id) filter (where t.updated_at > t.created_at)::text as edited
       from import_batches b left join transactions t on t.import_batch_id = b.id and t.deleted_at is null
      group by b.id order by b.imported_at desc, b.id desc`,
  );
  return r.rows.map((x) => ({ id: x.id, source: x.source, importedAt: x.at, count: Number(x.n), edited: Number(x.edited) }));
}

/** Deletes every row of the batch (including ones edited since). Merchant rules learned from it are kept. */
export async function undoBatch(db: Db, id: string): Promise<{ deleted: number }> {
  if (!UUID_RE.test(id)) throw new AppError(400, 'id must be a UUID');
  return db.transaction(async (tx) => {
    const exists = await tx.query('select 1 from import_batches where id = $1 for update', [id]);
    if (exists.rowCount === 0) throw new AppError(404, 'import not found');
    const del = await tx.query('delete from transactions where import_batch_id = $1', [id]);
    await tx.query('delete from import_batches where id = $1', [id]);
    return { deleted: del.rowCount };
  });
}
