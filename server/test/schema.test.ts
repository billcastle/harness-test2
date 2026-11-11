import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/migrate.js';
import { testDb } from './helpers.js';

let t: Awaited<ReturnType<typeof testDb>>;
beforeAll(async () => {
  t = await testDb();
});

const uncategorizedId = async () => Number((await t.db.query<{ id: string }>('select id::text as id from categories where is_system')).rows[0]!.id);

describe('migrations and schema integrity', () => {
  it('is idempotent: running again applies nothing and keeps a single Uncategorized row', async () => {
    expect(await migrate(t.db)).toEqual([]);
    const r = await t.db.query('select * from categories where is_system');
    expect(r.rows).toHaveLength(1);
  });

  it('rejects zero and negative amounts at the database level', async () => {
    const c = await uncategorizedId();
    for (const bad of [0, -1]) {
      await expect(
        t.db.query('insert into transactions (date, amount_centavos, category_id) values ($1, $2, $3)', ['2026-11-01', bad, c]),
      ).rejects.toThrow();
    }
  });

  it('rejects amounts above the cap', async () => {
    const c = await uncategorizedId();
    await expect(
      t.db.query('insert into transactions (date, amount_centavos, category_id) values ($1, $2, $3)', ['2026-11-01', 9_000_000_000_001, c]),
    ).rejects.toThrow();
  });

  it('rejects unknown kinds and sources', async () => {
    const c = await uncategorizedId();
    await expect(t.db.query(`insert into transactions (date, amount_centavos, category_id, kind) values ('2026-11-01', 100, $1, 'bogus')`, [c])).rejects.toThrow();
    await expect(t.db.query(`insert into transactions (date, amount_centavos, category_id, source) values ('2026-11-01', 100, $1, 'bogus')`, [c])).rejects.toThrow();
  });

  it('the system category cannot be deleted or renamed even by raw SQL', async () => {
    await expect(t.db.query('delete from categories where is_system')).rejects.toThrow(/cannot be deleted/);
    await expect(t.db.query(`update categories set name = 'X' where is_system`)).rejects.toThrow(/cannot be renamed/);
    await expect(t.db.query('update categories set is_system = false where is_system')).rejects.toThrow(/cannot be renamed or unflagged/);
  });

  it('the dedupe hash is NOT unique, so a repeated hash never fails an insert', async () => {
    const c = await uncategorizedId();
    const ins = () => t.db.query(`insert into transactions (date, amount_centavos, category_id, source, dedupe_hash) values ('2026-11-01', 100, $1, 'gcash', 'abc')`, [c]);
    await ins();
    await expect(ins()).resolves.toBeDefined();
  });

  it('category names are unique case-insensitively', async () => {
    await t.db.query(`insert into categories (name) values ('Food')`);
    await expect(t.db.query(`insert into categories (name) values ('FOOD')`)).rejects.toThrow();
  });

  it('merchant_rules is keyed by the normalized merchant (upsert, not duplicates)', async () => {
    const c = await uncategorizedId();
    await t.db.query(`insert into merchant_rules (merchant_normalized, category_id) values ('shopee payment', $1)`, [c]);
    await expect(t.db.query(`insert into merchant_rules (merchant_normalized, category_id) values ('shopee payment', $1)`, [c])).rejects.toThrow();
  });
});
