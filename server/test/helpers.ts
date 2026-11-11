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
  const app = buildApp({ db: t.db, now, insecureNoAuth: true }); // domain tests; auth is covered in auth.test.ts
  return { ...t, app, now };
}

export type TestApp = Awaited<ReturnType<typeof testApp>>;

export async function json(res: { body: string }) {
  return JSON.parse(res.body);
}

// ---------------------------------------------------------------- auth-enabled app
import { setPin } from '../src/auth/admin.js';
import type { AuthConfig } from '../src/auth/plugin.js';
import type { Argon2Params } from '../src/auth/pin.js';

export const ORIGIN = 'https://expenses.test';
export const PIN = '4821';
export const FAST_ARGON: Argon2Params = { memory: 64, passes: 1, parallelism: 1 }; // tests only; production uses PROD_ARGON2

export async function authTestApp(opts: {
  trustProxy?: boolean | string | string[];
  secureCookies?: boolean;
  rateLimitPerMinute?: number;
  lockout?: AuthConfig['lockout'];
  logStream?: NodeJS.WritableStream;
  setPinTo?: string | null;
} = {}) {
  const clock = { ms: Date.parse('2026-11-15T04:00:00Z') };
  const now = () => new Date(clock.ms);
  const advance = (ms: number) => { clock.ms += ms; };
  const t = await testDb();
  const routes: { method: string | string[]; url: string; public: boolean }[] = [];
  const build = () =>
    buildApp({
      db: t.db,
      now,
      trustProxy: opts.trustProxy ?? false,
      logger: opts.logStream ? { level: 'info', stream: opts.logStream } : false,
      onRoute: (r) => routes.push(r),
      auth: {
        allowedOrigins: [ORIGIN],
        secureCookies: opts.secureCookies ?? true,
        rateLimitPerMinute: opts.rateLimitPerMinute ?? 10_000,
        ...(opts.lockout ? { lockout: opts.lockout } : {}),
      },
    });
  let app = build();
  if (opts.setPinTo !== null) await setPin(t.db, opts.setPinTo ?? PIN, FAST_ARGON);

  const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, o: { body?: unknown; cookie?: string; origin?: string | null; ip?: string; headers?: Record<string, string> } = {}) =>
    app.inject({
      method, url, payload: o.body as object | undefined, remoteAddress: o.ip ?? '10.0.0.1',
      headers: { ...(o.origin === null ? {} : { origin: o.origin ?? ORIGIN }), ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.headers ?? {}) },
    });
  const cookieFrom = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const login = async (pin = PIN, ip = '10.0.0.1') => {
    const res = await req('POST', '/api/login', { body: { pin }, ip });
    return { res, status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, cookie: cookieFrom(res) };
  };
  return { ...t, get app() { return app; }, restart: () => { app = build(); }, req, login, cookieFrom, advance, routes, now };
}
