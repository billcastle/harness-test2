import type { Db } from '../db.js';
import { AppError, pgCode } from '../errors.js';
import { MoneyError, parseAmount } from '../lib/money.js';
import { isValidDate } from '../lib/time.js';
import { getUncategorizedId } from './categories.js';

export const KINDS = ['expense', 'income', 'refund', 'transfer', 'ignored'] as const;
export type Kind = (typeof KINDS)[number];

export interface Transaction {
  id: number;
  date: string;
  amountCentavos: number;
  description: string;
  categoryId: number;
  categoryName: string;
  source: string;
  kind: Kind;
  importBatchId: string | null;
  createdAt: string;
  updatedAt: string;
}
interface Row {
  id: string;
  date: string;
  amount: string;
  description: string;
  category_id: string;
  category_name: string;
  source: string;
  kind: Kind;
  batch_id: string | null;
  created_at: string;
  updated_at: string;
}
const SELECT = `select t.id::text as id, t.date::text as date, t.amount_centavos::text as amount, t.description,
  t.category_id::text as category_id, c.name as category_name, t.source, t.kind, t.import_batch_id::text as batch_id,
  t.created_at::text as created_at, t.updated_at::text as updated_at
  from transactions t join categories c on c.id = t.category_id`;
const map = (r: Row): Transaction => ({
  id: Number(r.id), date: r.date, amountCentavos: Number(r.amount), description: r.description,
  categoryId: Number(r.category_id), categoryName: r.category_name, source: r.source, kind: r.kind,
  importBatchId: r.batch_id, createdAt: r.created_at, updatedAt: r.updated_at,
});

export interface TransactionInput {
  date?: string;
  amountCentavos?: number;
  description?: string;
  categoryId?: number;
  kind?: Kind;
}

/** Validates a request body. `forCreate` fills defaults; for updates only the given fields are checked. */
export function parseTransactionBody(body: unknown, forCreate: boolean, today: string): TransactionInput {
  if (typeof body !== 'object' || body === null) throw new AppError(400, 'JSON body required');
  const b = body as Record<string, unknown>;
  const out: TransactionInput = {};
  if (b.date !== undefined || forCreate) {
    const d = b.date ?? today;
    if (!isValidDate(d)) throw new AppError(400, 'date must be a real date like 2026-11-30');
    out.date = d;
  }
  if (b.amount !== undefined || forCreate) {
    try {
      out.amountCentavos = parseAmount(b.amount);
    } catch (e) {
      if (e instanceof MoneyError) throw new AppError(400, e.message);
      throw e;
    }
  }
  if (b.description !== undefined) {
    if (typeof b.description !== 'string' || b.description.length > 500) throw new AppError(400, 'description must be text up to 500 characters');
    out.description = b.description.trim();
  }
  if (b.categoryId !== undefined) {
    if (typeof b.categoryId !== 'number' || !Number.isInteger(b.categoryId) || b.categoryId < 1) throw new AppError(400, 'categoryId must be a positive integer');
    out.categoryId = b.categoryId;
  }
  if (b.kind !== undefined) {
    if (typeof b.kind !== 'string' || !(KINDS as readonly string[]).includes(b.kind)) throw new AppError(400, `kind must be one of ${KINDS.join(', ')}`);
    out.kind = b.kind as Kind;
  }
  return out;
}

export async function getTransaction(db: Db, id: number): Promise<Transaction> {
  const r = await db.query<Row>(`${SELECT} where t.id = $1 and t.deleted_at is null`, [id]);
  if (!r.rows[0]) throw new AppError(404, 'transaction not found');
  return map(r.rows[0]);
}

export async function createTransaction(db: Db, input: TransactionInput): Promise<Transaction> {
  const categoryId = input.categoryId ?? (await getUncategorizedId(db));
  try {
    const r = await db.query<{ id: string }>(
      `insert into transactions (date, amount_centavos, description, category_id, kind)
       values ($1, $2, $3, $4, $5) returning id::text as id`,
      [input.date, input.amountCentavos, input.description ?? '', categoryId, input.kind ?? 'expense'],
    );
    return getTransaction(db, Number(r.rows[0]!.id));
  } catch (err) {
    if (pgCode(err) === '23503') throw new AppError(400, 'category does not exist');
    throw err;
  }
}

export async function updateTransaction(db: Db, id: number, input: TransactionInput): Promise<Transaction> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const add = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (input.date !== undefined) add('date', input.date);
  if (input.amountCentavos !== undefined) add('amount_centavos', input.amountCentavos);
  if (input.description !== undefined) add('description', input.description);
  if (input.categoryId !== undefined) add('category_id', input.categoryId);
  if (input.kind !== undefined) add('kind', input.kind);
  if (sets.length === 0) throw new AppError(400, 'nothing to update');
  try {
    const r = await db.query(`update transactions set ${sets.join(', ')}, updated_at = now() where id = $1 and deleted_at is null`, params);
    if (r.rowCount === 0) throw new AppError(404, 'transaction not found');
  } catch (err) {
    if (pgCode(err) === '23503') throw new AppError(400, 'category does not exist');
    throw err;
  }
  return getTransaction(db, id);
}

/** Soft delete: the row stays for the Undo window and is purged later by purgeDeleted. */
export async function softDeleteTransaction(db: Db, id: number): Promise<void> {
  const r = await db.query('update transactions set deleted_at = now(), updated_at = now() where id = $1 and deleted_at is null', [id]);
  if (r.rowCount === 0) throw new AppError(404, 'transaction not found');
}

export async function restoreTransaction(db: Db, id: number): Promise<Transaction> {
  const r = await db.query('update transactions set deleted_at = null, updated_at = now() where id = $1 and deleted_at is not null', [id]);
  if (r.rowCount === 0) throw new AppError(404, 'nothing to restore');
  return getTransaction(db, id);
}

/** Permanently removes rows soft-deleted before `cutoff`. */
export async function purgeDeleted(db: Db, cutoff: Date): Promise<number> {
  const r = await db.query('delete from transactions where deleted_at is not null and deleted_at < $1', [cutoff.toISOString()]);
  return r.rowCount;
}

export interface ListFilter {
  from?: string;
  to?: string;
  categoryId?: number;
  q?: string;
  batchId?: string;
  page: number;
  pageSize: number;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listTransactions(db: Db, f: ListFilter): Promise<{ items: Transaction[]; total: number; page: number; pageSize: number }> {
  const where: string[] = ['t.deleted_at is null'];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.from) add('t.date >= ?', f.from);
  if (f.to) add('t.date <= ?', f.to);
  if (f.categoryId) add('t.category_id = ?', f.categoryId);
  if (f.q) add(`t.description ilike ? escape '\\'`, `%${escapeLike(f.q)}%`);
  if (f.batchId) add('t.import_batch_id = ?', f.batchId);
  const clause = where.join(' and ');
  const total = await db.query<{ n: string }>(`select count(*)::text as n from transactions t where ${clause}`, params);
  // stable order so pagination never skips or repeats rows
  const rows = await db.query<Row>(
    `${SELECT} where ${clause} order by t.date desc, t.id desc limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}`,
    params,
  );
  return { items: rows.rows.map(map), total: Number(total.rows[0]!.n), page: f.page, pageSize: f.pageSize };
}
