// DEV AND TEST ONLY: adapts PGlite (Postgres compiled to WASM) to the app's Db interface.
// Production uses createPgDb (src/db.ts) against a real Postgres server.
import type { PGlite } from '@electric-sql/pglite';
import type { Db } from './db.js';

type Runner = Pick<PGlite, 'query' | 'exec'>;

export function pgliteDb(pg: PGlite, r: Runner = pg): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      // PGlite's extended protocol runs one statement; use exec() for parameterless (possibly multi-statement) SQL.
      if (params.length === 0) {
        const results = await r.exec(sql);
        const last = results[results.length - 1];
        const rows = (last?.rows ?? []) as T[];
        return { rows, rowCount: Math.max(last?.affectedRows ?? 0, rows.length) };
      }
      const res = await r.query<T>(sql, params);
      // PGlite reports affectedRows 0 for SELECTs, so take the larger of the two (pg's rowCount is the row count)
      return { rows: res.rows, rowCount: Math.max(res.affectedRows ?? 0, res.rows.length) };
    },
    transaction: (fn) => pg.transaction((tx) => fn(pgliteDb(pg, tx))),
  };
}
