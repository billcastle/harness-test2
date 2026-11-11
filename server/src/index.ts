import { buildApp } from './app.js';
import { purgeLockoutData } from './auth/lockout.js';
import { getPinHash, purgeExpiredSessions } from './auth/sessions.js';
import { createPgDb } from './db.js';
import { migrate } from './migrate.js';
import { purgeDeleted } from './repo/transactions.js';

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is required (see server/README.md)`);
    process.exit(1);
  }
  return v;
};

const db = createPgDb(need('DATABASE_URL'));
// Exact browser origin(s) allowed to make changes, e.g. https://expenses.example.com (comma-separated for several).
const allowedOrigins = need('ALLOWED_ORIGIN').split(',').map((s) => s.trim()).filter(Boolean);
// Production is HTTPS-only. Set COOKIE_INSECURE_DEV=1 only for local http development.
const secureCookies = process.env.COOKIE_INSECURE_DEV !== '1';
// Trust X-Forwarded-For only from the reverse proxy you control. Unset = use the socket address.
const tp = process.env.TRUST_PROXY;
const trustProxy = tp ? tp.split(',').map((s) => s.trim()) : false;

const applied = await migrate(db);
if (applied.length) console.log('applied migrations:', applied.join(', '));
if (!(await getPinHash(db))) console.warn('No PIN is set yet: logins fail until you run `npm run reset-pin`.');

// housekeeping: soft-deleted transactions are kept 24 hours for Undo; expired sessions and stale lockout rows go too
const housekeeping = async () => {
  const now = new Date();
  await purgeDeleted(db, new Date(now.getTime() - 24 * 3_600_000));
  await purgeExpiredSessions(db, now);
  await purgeLockoutData(db, now);
};
const tick = () => housekeeping().catch((e) => console.error('housekeeping failed:', e.message));
setInterval(tick, 3_600_000).unref();
void tick();

const app = buildApp({
  db,
  logger: true,
  trustProxy,
  auth: { allowedOrigins, secureCookies, rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 600) },
});
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
