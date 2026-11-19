// Vercel entry: one Fastify app per warm function instance, migrations and housekeeping on the first request.
// Built by deploy/build-vercel.mjs; not used by `npm start` or the tests.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app.js';
import { purgeLockoutData } from './auth/lockout.js';
import { purgeExpiredSessions } from './auth/sessions.js';
import { createPgDb } from './db.js';
import { parseTrustProxy } from './lib/trust-proxy.js';
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
  return app;
}

let booting: ReturnType<typeof boot> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    booting ??= boot();
    const app = await booting;
    app.server.emit('request', req, res);
  } catch (err) {
    booting = undefined; // retry on the next request instead of caching a failed start
    console.error('startup failed:', (err as Error).message);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end('{"error":"internal error"}');
  }
}
