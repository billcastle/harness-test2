import type { Db } from '../db.js';
import { AppError, pgCode } from '../errors.js';
import { merchantKey } from '../lib/normalize.js';

export interface Category {
  id: number;
  name: string;
  color: string;
  isSystem: boolean;
  /** Live (not deleted) transactions in this category. */
  transactionCount: number;
  /** Remembered merchants that point at this category. */
  ruleCount: number;
}
interface Row {
  id: string;
  name: string;
  color: string;
  is_system: boolean;
  tx: string;
  rules: string;
}
const SELECT = `select c.id::text as id, c.name, c.color, c.is_system,
  (select count(*) from transactions t where t.category_id = c.id and t.deleted_at is null)::text as tx,
  (select count(*) from merchant_rules m where m.category_id = c.id)::text as rules
  from categories c`;
const map = (r: Row): Category => ({
  id: Number(r.id), name: r.name, color: r.color, isSystem: r.is_system, transactionCount: Number(r.tx), ruleCount: Number(r.rules),
});

export async function listCategories(db: Db): Promise<Category[]> {
  const r = await db.query<Row>(`${SELECT} order by c.is_system desc, lower(c.name)`);
  return r.rows.map(map);
}

async function getCategory(db: Db, id: number): Promise<Category> {
  const r = await db.query<Row>(`${SELECT} where c.id = $1`, [id]);
  if (!r.rows[0]) throw new AppError(404, 'category not found');
  return map(r.rows[0]);
}

export async function getUncategorizedId(db: Db): Promise<number> {
  const r = await db.query<{ id: string }>('select id::text as id from categories where is_system limit 1');
  if (!r.rows[0]) throw new AppError(500, 'system category is missing');
  return Number(r.rows[0].id);
}

function checkName(name: unknown): string {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 60) {
    throw new AppError(400, 'name must be 1 to 60 characters');
  }
  return name.trim();
}
function checkColor(color: unknown): string {
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw new AppError(400, 'color must look like #1a2b3c');
  return color;
}

export async function createCategory(db: Db, input: { name?: unknown; color?: unknown }): Promise<Category> {
  const name = checkName(input.name);
  const color = input.color === undefined ? '#64748b' : checkColor(input.color);
  try {
    const r = await db.query<{ id: string }>('insert into categories (name, color) values ($1, $2) returning id::text as id', [name, color]);
    return getCategory(db, Number(r.rows[0]!.id));
  } catch (err) {
    if (pgCode(err) === '23505') throw new AppError(409, 'a category with that name already exists');
    throw err;
  }
}

export async function updateCategory(db: Db, id: number, input: { name?: unknown; color?: unknown }): Promise<Category> {
  const row = await getCategory(db, id);
  if (row.isSystem && input.name !== undefined) throw new AppError(409, 'the Uncategorized category cannot be renamed');
  const name = input.name === undefined ? row.name : checkName(input.name);
  const color = input.color === undefined ? row.color : checkColor(input.color);
  try {
    await db.query('update categories set name = $2, color = $3 where id = $1', [id, name, color]);
    return getCategory(db, id);
  } catch (err) {
    if (pgCode(err) === '23505') throw new AppError(409, 'a category with that name already exists');
    throw err;
  }
}

/** Deleting a category reassigns its transactions and merchant rules to Uncategorized, atomically. */
export async function deleteCategory(db: Db, id: number): Promise<{ reassignedTransactions: number; reassignedRules: number }> {
  return db.transaction(async (tx) => {
    const cur = await tx.query<{ is_system: boolean }>('select is_system from categories where id = $1 for update', [id]);
    const row = cur.rows[0];
    if (!row) throw new AppError(404, 'category not found');
    if (row.is_system) throw new AppError(409, 'the Uncategorized category cannot be deleted');
    const uncategorized = await getUncategorizedId(tx);
    const t = await tx.query('update transactions set category_id = $2, updated_at = now() where category_id = $1', [id, uncategorized]);
    const m = await tx.query('update merchant_rules set category_id = $2, updated_at = now() where category_id = $1', [id, uncategorized]);
    await tx.query('delete from categories where id = $1', [id]);
    return { reassignedTransactions: t.rowCount, reassignedRules: m.rowCount };
  });
}

// ---- merchant rules (exact match on the normalized description; most recently updated wins because it is the primary key)
export interface MerchantRule {
  merchant: string;
  categoryId: number;
}

export async function listMerchantRules(db: Db): Promise<MerchantRule[]> {
  const r = await db.query<{ m: string; c: string }>('select merchant_normalized as m, category_id::text as c from merchant_rules order by merchant_normalized');
  return r.rows.map((x) => ({ merchant: x.m, categoryId: Number(x.c) }));
}

export async function upsertMerchantRule(db: Db, description: string, categoryId: number): Promise<MerchantRule> {
  const merchant = merchantKey(description);
  if (!merchant) throw new AppError(400, 'description is empty');
  try {
    await db.query(
      `insert into merchant_rules (merchant_normalized, category_id) values ($1, $2)
       on conflict (merchant_normalized) do update set category_id = excluded.category_id, updated_at = now()`,
      [merchant, categoryId],
    );
  } catch (err) {
    if (pgCode(err) === '23503') throw new AppError(400, 'category does not exist');
    throw err;
  }
  return { merchant, categoryId };
}

export async function deleteMerchantRule(db: Db, merchantNormalized: string): Promise<void> {
  const r = await db.query('delete from merchant_rules where merchant_normalized = $1', [merchantNormalized]);
  if (r.rowCount === 0) throw new AppError(404, 'rule not found');
}
