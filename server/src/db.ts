// Thin database interface so the app code never depends on a specific driver.
// Production uses `pg`; tests use PGlite (real Postgres compiled to WASM) with the same migrations.
// Rule for all queries: cast dates and bigints to text in SQL (`date::text`, `x::text`) so every driver
// returns the same shapes, and the app never relies on JS Date or on driver-specific bigint parsing.
import pg from 'pg';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export function createPgDb(connectionString: string): Db & { close(): Promise<void> } {
  const pool = new pg.Pool({ connectionString, max: 5 });
  const wrap = (c: pg.Pool | pg.PoolClient): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await c.query(sql, params);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
    async transaction() {
      throw new Error('nested transactions are not supported');
    },
  });
  return {
    ...wrap(pool),
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(wrap(client));
        await client.query('commit');
        return out;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
