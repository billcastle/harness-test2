import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { registerAuth, type AuthConfig } from './auth/plugin.js';
import type { Db } from './db.js';
import { AppError } from './errors.js';
import { buildPreview, confirmImport, listBatches, parseConfirmBody, undoBatch } from './import/service.js';
import { MAX_PDF_BYTES, parseInWorker, type RunOptions } from './import/run.js';
import { BANKS, ImportError, type Bank } from './import/types.js';
import { isValidDate, manilaToday, monthRange, type Clock } from './lib/time.js';
import {
  createCategory, deleteCategory, deleteMerchantRule, listCategories, listMerchantRules, updateCategory,
} from './repo/categories.js';
import {
  createTransaction, listTransactions, parseTransactionBody, restoreMany, restoreTransaction, softDeleteMany, softDeleteTransaction, updateTransaction,
} from './repo/transactions.js';
import { summarize } from './repo/summary.js';
import { createRecurring, deleteRecurring, listRecurring, parseRecurringBody, updateRecurring } from './repo/recurring.js';

export interface AppDeps {
  db: Db;
  now?: Clock;
  logger?: boolean | { level: string; stream: NodeJS.WritableStream };
  /** Worker limits for statement parsing (tests lower the timeout). */
  importWorker?: RunOptions;
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

export function buildApp({ db, now = () => new Date(), logger = false, auth, trustProxy = false, insecureNoAuth = false, onRoute, importWorker }: AppDeps): FastifyInstance {
  if (!auth && !insecureNoAuth) throw new Error('buildApp requires an `auth` config (the app is default-deny)');
  const app = Fastify({ logger, bodyLimit: 1_048_576, trustProxy });
  const today = () => manilaToday(now());
  if (onRoute) app.addHook('onRoute', (r) => onRoute({ method: r.method, url: r.url, public: Boolean(r.config?.public) }));

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.message, ...(err.code ? { code: err.code } : {}) });
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
    if (q.date !== undefined) {
      if (!isValidDate(q.date)) throw new AppError(400, 'date must be a real date');
      filter.date = q.date;
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
  // several at once (the table's checkboxes); restore is the Undo for a batch delete
  const idsBody = (body: unknown): number[] => {
    const ids = (body as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 || !ids.every((x) => Number.isInteger(x) && x >= 1 && x <= Number.MAX_SAFE_INTEGER)) {
      throw new AppError(400, 'ids must be a list of 1 to 500 transaction ids');
    }
    return [...new Set(ids as number[])];
  };
  app.post('/api/transactions/batch-delete', async (req) => ({ deleted: await softDeleteMany(db, idsBody(req.body)) }));
  app.post('/api/transactions/batch-restore', async (req) => ({ restored: await restoreMany(db, idsBody(req.body)) }));
  app.post('/api/transactions/:id/restore', async (req) => restoreTransaction(db, idParam(req)));

  // ---- recurring expenses (subscriptions, utilities)
  app.get('/api/recurring', async () => ({ items: await listRecurring(db, today()) }));
  app.post('/api/recurring', async (req, reply) => reply.status(201).send(await createRecurring(db, parseRecurringBody(req.body, true, today()), today())));
  app.patch('/api/recurring/:id', async (req) => updateRecurring(db, idParam(req), parseRecurringBody(req.body, false, today()), today()));
  app.delete('/api/recurring/:id', async (req, reply) => {
    await deleteRecurring(db, idParam(req));
    return reply.status(204).send();
  });

  // ---- dashboard summary (default range: this month in Asia/Manila)
  app.get('/api/summary', async (req) => {
    const { from, to } = rangeQuery(req.query as Record<string, string | undefined>, today());
    return summarize(db, from, to, today());
  });

  // ---- statement import: upload a PDF, review the preview, confirm
  // The PDF arrives as the raw request body (Content-Type: application/pdf); the bytes, not the label, are checked.
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: MAX_PDF_BYTES + 1024 }, (_req, body, done) => done(null, body));
  const IMPORT_STATUS: Record<ImportError['code'], number> = { not_pdf: 400, encrypted: 422, unreadable: 422, unknown_bank: 422, timeout: 422, too_large: 413 };
  app.post('/api/import/parse', { bodyLimit: MAX_PDF_BYTES + 1024 }, async (req) => {
    const bank = (req.query as { bank?: string }).bank;
    if (bank !== undefined && bank !== '' && !(BANKS as string[]).includes(bank)) throw new AppError(400, `bank must be one of ${BANKS.join(', ')}`);
    const bytes = req.body instanceof Buffer ? req.body : null;
    if (!bytes) throw new AppError(415, 'send the PDF as the request body with Content-Type: application/pdf');
    try {
      const result = await parseInWorker(bytes, (bank || undefined) as Bank | undefined, importWorker);
      return await buildPreview(db, result);
    } catch (e) {
      if (e instanceof ImportError) throw new AppError(IMPORT_STATUS[e.code], e.message, e.code);
      throw e;
    }
  });
  app.post('/api/import/confirm', async (req, reply) => {
    const result = await confirmImport(db, parseConfirmBody(req.body));
    return reply.status(result.alreadyImported ? 200 : 201).send(result);
  });
  app.get('/api/import/batches', async () => ({ items: await listBatches(db) }));
  app.delete('/api/import/batches/:id', async (req) => undoBatch(db, (req.params as { id: string }).id));

  return app;
}
