import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import type { Clock } from '../src/lib/time.js';

type Runner = Pick<PGlite, 'query' | 'exec'>;

function wrap(r: Runner, pg: PGlite): Db {
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
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx, pg))),
  };
}

export async function testDb() {
  const pg = new PGlite();
  const db = wrap(pg, pg);
  await migrate(db);
  const reset = async () => {
    await db.query('truncate transactions, merchant_rules, import_batches restart identity');
    await db.query('delete from categories where not is_system');
  };
  return { pg, db, reset };
}

export async function testApp(now: Clock = () => new Date('2026-11-15T04:00:00Z')) {
  const t = await testDb();
  const app = buildApp({ db: t.db, now });
  return { ...t, app, now };
}

export type TestApp = Awaited<ReturnType<typeof testApp>>;

export async function json(res: { body: string }) {
  return JSON.parse(res.body);
}
