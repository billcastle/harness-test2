import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { registerAuth, type AuthConfig } from './auth/plugin.js';
import type { Db } from './db.js';
import { AppError } from './errors.js';
import { isValidDate, manilaToday, monthRange, type Clock } from './lib/time.js';
import {
  createCategory, deleteCategory, deleteMerchantRule, listCategories, listMerchantRules, updateCategory,
} from './repo/categories.js';
import {
  createTransaction, listTransactions, parseTransactionBody, restoreTransaction, softDeleteTransaction, updateTransaction,
} from './repo/transactions.js';
import { summarize } from './repo/summary.js';

export interface AppDeps {
  db: Db;
  now?: Clock;
  logger?: boolean | { level: string; stream: NodeJS.WritableStream };
  /** Test aid: called for every route as it is registered. */
  onRoute?: (route: { method: string | string[]; url: string; public: boolean }) => void;
  /** Required unless `insecureNoAuth` is set: the app refuses to be built without authentication. */
  auth?: AuthConfig;
  /**
   * Fastify trustProxy setting for reading the real client IP from X-Forwarded-For. Leave false unless a reverse
   * proxy you control (Caddy on the compose network) is in front; then trust only that hop, e.g. "172.16.0.0/12".
   */
  trustProxy?: boolean | string | string[];
  /** Domain-logic tests only. Never set in production code. */
  insecureNoAuth?: boolean;
}

function idParam(req: FastifyRequest): number {
  const raw = (req.params as { id?: string }).id ?? '';
  if (!/^\d{1,15}$/.test(raw) || Number(raw) < 1) throw new AppError(400, 'id must be a positive integer');
  return Number(raw);
}

function rangeQuery(q: Record<string, string | undefined>, today: string): { from: string; to: string } {
  if (q.from === undefined && q.to === undefined) return monthRange(today);
  if (!isValidDate(q.from) || !isValidDate(q.to)) throw new AppError(400, 'from and to must both be real dates like 2026-11-01');
  if (q.from > q.to) throw new AppError(400, 'from must not be after to');
  return { from: q.from, to: q.to };
}

export function buildApp({ db, now = () => new Date(), logger = false, auth, trustProxy = false, insecureNoAuth = false, onRoute }: AppDeps): FastifyInstance {
  if (!auth && !insecureNoAuth) throw new Error('buildApp requires an `auth` config (the app is default-deny)');
  const app = Fastify({ logger, bodyLimit: 1_048_576, trustProxy });
  const today = () => manilaToday(now());
  if (onRoute) app.addHook('onRoute', (r) => onRoute({ method: r.method, url: r.url, public: Boolean(r.config?.public) }));

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error({ err: err.message }, 'unhandled error'); // never log request bodies
    return reply.status(500).send({ error: 'internal error' });
  });

  // Hooks only apply to routes registered after them, so auth goes first. Every route below is protected by default.
  if (auth) registerAuth(app, db, now, auth);

  // ---- categories
  app.get('/api/categories', async () => ({ items: await listCategories(db) }));
  app.post('/api/categories', async (req, reply) => reply.status(201).send(await createCategory(db, (req.body ?? {}) as object)));
  app.patch('/api/categories/:id', async (req) => updateCategory(db, idParam(req), (req.body ?? {}) as object));
  app.delete('/api/categories/:id', async (req) => deleteCategory(db, idParam(req)));

  // ---- merchant rules
  app.get('/api/merchant-rules', async () => ({ items: await listMerchantRules(db) }));
  app.delete('/api/merchant-rules', async (req, reply) => {
    const m = (req.query as { merchant?: string }).merchant;
    if (!m) throw new AppError(400, 'merchant query parameter is required');
    await deleteMerchantRule(db, m);
    return reply.status(204).send();
  });

  // ---- transactions
  app.get('/api/transactions', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const page = q.page === undefined ? 1 : Number(q.page);
    if (!Number.isInteger(page) || page < 1) throw new AppError(400, 'page must be a positive integer');
    const filter: Parameters<typeof listTransactions>[1] = { page, pageSize: 50 };
    if (q.from !== undefined) {
      if (!isValidDate(q.from)) throw new AppError(400, 'from must be a real date');
      filter.from = q.from;
    }
    if (q.to !== undefined) {
      if (!isValidDate(q.to)) throw new AppError(400, 'to must be a real date');
      filter.to = q.to;
    }
    if (q.categoryId !== undefined) {
      if (!/^\d{1,15}$/.test(q.categoryId)) throw new AppError(400, 'categoryId must be a positive integer');
      filter.categoryId = Number(q.categoryId);
    }
    if (q.q) filter.q = q.q.slice(0, 100);
    if (q.batchId !== undefined) {
      if (!/^[0-9a-f-]{36}$/i.test(q.batchId)) throw new AppError(400, 'batchId must be a UUID');
      filter.batchId = q.batchId;
    }
    return listTransactions(db, filter);
  });
  app.post('/api/transactions', async (req, reply) =>
    reply.status(201).send(await createTransaction(db, parseTransactionBody(req.body, true, today()))),
  );
  app.patch('/api/transactions/:id', async (req) => updateTransaction(db, idParam(req), parseTransactionBody(req.body, false, today())));
  app.delete('/api/transactions/:id', async (req, reply) => {
    await softDeleteTransaction(db, idParam(req));
    return reply.status(204).send();
  });
  app.post('/api/transactions/:id/restore', async (req) => restoreTransaction(db, idParam(req)));

  // ---- dashboard summary (default range: this month in Asia/Manila)
  app.get('/api/summary', async (req) => {
    const { from, to } = rangeQuery(req.query as Record<string, string | undefined>, today());
    return summarize(db, from, to);
  });

  return app;
}
