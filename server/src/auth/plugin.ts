import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import { AppError } from '../errors.js';
import type { Clock } from '../lib/time.js';
import { parseCookies, serializeSession, sessionCookieName } from './cookies.js';
import { DEFAULT_LOCKOUT, releaseSuccess, reserveAttempt, type LockoutConfig } from './lockout.js';
import { PIN_RE, verifyPin } from './pin.js';
import { checkSession, createSession, destroySession, getPinHash } from './sessions.js';

export interface AuthConfig {
  /** Exact origins allowed to make state-changing requests, e.g. ["https://expenses.example.com"]. */
  allowedOrigins: string[];
  /** true in production (Secure + __Host- cookie). false only for local HTTP development. */
  secureCookies: boolean;
  /** Requests per client IP per minute across the whole API. */
  rateLimitPerMinute: number;
  lockout?: LockoutConfig;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Routes are protected by default; set `public: true` to opt out (login, health). */
    public?: boolean;
  }
}

/**
 * Default-deny: every route requires a valid session unless it is explicitly marked `config: { public: true }`.
 * A new route added later is therefore protected automatically.
 */
export function registerAuth(app: FastifyInstance, db: Db, now: Clock, cfg: AuthConfig): void {
  const cookieName = sessionCookieName(cfg.secureCookies);
  const lockout = cfg.lockout ?? DEFAULT_LOCKOUT;

  // ---- 1) per-IP rate limit on the whole API (in memory; the lockout, not this, is the security-critical limiter)
  const buckets = new Map<string, { count: number; resetAt: number }>();
  app.addHook('onRequest', async (req, reply) => {
    const t = now().getTime();
    const b = buckets.get(req.ip);
    if (!b || b.resetAt <= t) buckets.set(req.ip, { count: 1, resetAt: t + 60_000 });
    else if (++b.count > cfg.rateLimitPerMinute) {
      reply.header('retry-after', String(Math.ceil((b.resetAt - t) / 1000)));
      return reply.status(429).send({ error: 'too many requests' });
    }
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= t) buckets.delete(k);
  });

  // ---- 2) CSRF: SameSite=Strict plus an exact Origin check on every state-changing request (a missing Origin is rejected)
  app.addHook('onRequest', async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    if (!origin || !cfg.allowedOrigins.includes(origin)) return reply.status(403).send({ error: 'origin not allowed' });
  });

  // ---- 3) default-deny session check
  app.addHook('onRequest', async (req, reply) => {
    if (req.routeOptions.config?.public) return;
    const token = parseCookies(req.headers.cookie)[cookieName];
    const s = token ? await checkSession(db, token, now()) : ({ ok: false } as const);
    if (!s.ok) return reply.status(401).send({ error: 'not signed in' });
    if (s.refreshedExpiresAt && token) {
      reply.header('set-cookie', serializeSession(cookieName, token, { secure: cfg.secureCookies, expires: s.refreshedExpiresAt }));
    }
    (req as FastifyRequest & { sessionToken?: string }).sessionToken = token;
  });

  // ---- 4) never cache API responses; no sniffing
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  // ---- routes
  app.post('/api/login', { config: { public: true } }, async (req, reply) => {
    const pin = (req.body as { pin?: unknown } | null)?.pin;
    if (typeof pin !== 'string' || !PIN_RE.test(pin)) throw new AppError(400, 'PIN must be exactly 4 digits');
    const stored = await getPinHash(db);
    if (!stored) throw new AppError(503, 'no PIN has been set; run npm run reset-pin on the server');

    const t = now();
    const res = await reserveAttempt(db, req.ip, t, lockout); // counted BEFORE comparing
    if (!res.ok) {
      if (res.reason === 'ip_blocked') {
        reply.header('retry-after', String(res.retryAfterSeconds));
        return reply.status(429).send({ error: 'too many wrong attempts', retryAfterSeconds: res.retryAfterSeconds });
      }
      return reply.status(429).send({ error: 'try again later' }); // generic on purpose
    }

    if (!(await verifyPin(pin, stored))) {
      if (res.blockedNow) req.log.warn({ ip: req.ip, failures: res.failures }, 'login lockout activated');
      const retry = res.blockedUntil ? Math.max(1, Math.ceil((res.blockedUntil.getTime() - t.getTime()) / 1000)) : undefined;
      return reply.status(401).send({ error: 'wrong PIN', ...(retry ? { retryAfterSeconds: retry } : {}) });
    }
    await releaseSuccess(db, req.ip, res.reservationId);
    const session = await createSession(db, t);
    reply.header('set-cookie', serializeSession(cookieName, session.token, { secure: cfg.secureCookies, expires: session.expiresAt }));
    return { ok: true };
  });

  app.post('/api/logout', async (req, reply) => {
    const token = (req as FastifyRequest & { sessionToken?: string }).sessionToken;
    if (token) await destroySession(db, token);
    reply.header('set-cookie', serializeSession(cookieName, '', { secure: cfg.secureCookies, expires: null }));
    return { ok: true };
  });

  // lets the SPA ask "am I signed in?"; protected like everything else, so it answers 401 when not
  app.get('/api/session', async () => ({ authenticated: true }));

  app.get('/api/health', { config: { public: true } }, async () => ({ ok: true }));
}
