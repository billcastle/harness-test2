// Run the whole server locally with no Postgres install: data lives in ./.pglite-data (gitignored).
//   npm run dev:local            (PIN defaults to 1234; override with DEV_PIN=4821)
// DEV ONLY. Not for deployment: production uses src/index.ts with a real Postgres.
import { PGlite } from '@electric-sql/pglite';
import { buildApp } from './app.js';
import { setPin } from './auth/admin.js';
import { getPinHash } from './auth/sessions.js';
import { migrate } from './migrate.js';
import { pgliteDb } from './pglite-db.js';

const pg = new PGlite(process.env.PGLITE_DIR ?? './.pglite-data');
const db = pgliteDb(pg);
await migrate(db);

const pin = process.env.DEV_PIN ?? '1234';
if (process.env.DEV_PIN || !(await getPinHash(db))) {
  await setPin(db, pin);
  console.log(`PIN set to ${pin} (dev only)`);
}

const app = buildApp({
  db,
  logger: true,
  auth: {
    allowedOrigins: (process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    secureCookies: false, // plain http on localhost
    rateLimitPerMinute: 600,
  },
});
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
