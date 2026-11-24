// Vercel entry: one Fastify app per warm function instance, migrations and housekeeping on the first request.
// Built by deploy/build-vercel.mjs; not used by `npm start` or the tests.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app.js';
import { purgeLockoutData } from './auth/lockout.js';
import { purgeExpiredSessions } from './auth/sessions.js';
import { createPgDb } from './db.js';
import { parseTrustProxy } from './lib/trust-proxy.js';
import { runMonthlyMaintenance } from './maintenance/monthly.js';
import { migrate } from './migrate.js';
import { purgeDeleted } from './repo/transactions.js';

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (Vercel project settings, Environment Variables)`);
  return v;
};

async function boot() {
  // A few connections per instance (a transaction holds one while other queries may run); Neon's pooler fans them in.
  const db = createPgDb(need('DATABASE_URL'), 3);
  await migrate(db);
  const now = new Date();
  await purgeDeleted(db, new Date(now.getTime() - 24 * 3_600_000));
  await purgeExpiredSessions(db, now);
  await purgeLockoutData(db, now);
  const app = buildApp({
    db,
    logger: { level: 'info', stream: process.stdout },
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY ?? 'true'),
    auth: {
      allowedOrigins: need('ALLOWED_ORIGIN').split(',').map((s) => s.trim()).filter(Boolean),
      secureCookies: true,
      rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 600),
    },
  });
  await app.ready();
  return { app, db };
}

let booting: ReturnType<typeof boot> | undefined;

export const CRON_PATH = '/api/cron/monthly';

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

/** Vercel Cron calls this with `Authorization: Bearer <CRON_SECRET>`. Anything else is refused, and so is every call when no secret is set. */
export function cronAuthorized(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    booting ??= boot();
    const { app, db } = await booting;
    if (new URL(req.url ?? '/', 'http://x').pathname === CRON_PATH) {
      if (req.method !== 'GET' || !cronAuthorized(req.headers.authorization, process.env.CRON_SECRET)) return send(res, 401, { error: 'unauthorized' });
      const report = await runMonthlyMaintenance(db, new Date());
      console.log('monthly maintenance:', JSON.stringify(report));
      return send(res, 200, report);
    }
    app.server.emit('request', req, res);
  } catch (err) {
    booting = undefined; // retry on the next request instead of caching a failed start
    console.error('startup failed:', (err as Error).message);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end('{"error":"internal error"}');
  }
}
