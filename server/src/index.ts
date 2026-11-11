import { buildApp } from './app.js';
import { createPgDb } from './db.js';
import { migrate } from './migrate.js';
import { purgeDeleted } from './repo/transactions.js';

// Safety: there is no authentication until step 3. Refuse to start unless the developer says so explicitly,
// and bind to loopback so the app is not reachable from the network even then.
if (process.env.ALLOW_UNAUTHENTICATED_DEV !== '1') {
  console.error('Refusing to start: authentication is not implemented yet. Set ALLOW_UNAUTHENTICATED_DEV=1 for local development only.');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required, for example postgres://user:pass@localhost:5432/expenses');
  process.exit(1);
}

const db = createPgDb(url);
const applied = await migrate(db);
if (applied.length) console.log('applied migrations:', applied.join(', '));

// soft-deleted transactions are kept 24 hours for Undo, then purged
const purge = () => purgeDeleted(db, new Date(Date.now() - 24 * 3_600_000)).catch((e) => console.error('purge failed', e.message));
setInterval(purge, 3_600_000).unref();
void purge();

const app = buildApp({ db, logger: true });
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
