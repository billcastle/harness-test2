import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { setPin } from '../src/auth/admin.js';
import { hashPin, verifyPin } from '../src/auth/pin.js';
import { purgeExpiredSessions } from '../src/auth/sessions.js';
import { authTestApp, FAST_ARGON, ORIGIN, PIN } from './helpers.js';

const MIN = 60_000;
const failureRows = async (a: Awaited<ReturnType<typeof authTestApp>>) =>
  Number((await a.db.query<{ n: string }>('select count(*)::text as n from login_failures')).rows[0]!.n);

describe('PIN hashing (argon2id)', () => {
  it('round-trips, salts every hash, and rejects wrong or malformed input', async () => {
    const h1 = await hashPin('1234', FAST_ARGON);
    const h2 = await hashPin('1234', FAST_ARGON);
    expect(h1).not.toBe(h2); // random salt
    expect(h1).toMatch(/^argon2id\$m=64,t=1,p=1\$/);
    expect(await verifyPin('1234', h1)).toBe(true);
    expect(await verifyPin('1235', h1)).toBe(false);
    expect(await verifyPin('12345', h1)).toBe(false);
    expect(await verifyPin('1234', 'garbage')).toBe(false);
    await expect(hashPin('12a4', FAST_ARGON)).rejects.toThrow(/4 digits/);
    await expect(hashPin('123', FAST_ARGON)).rejects.toThrow(/4 digits/);
  });
});

describe('login, sessions and cookies', () => {
  it('a correct PIN sets a hardened cookie, and the session then works', async () => {
    const a = await authTestApp();
    const l = await a.login();
    expect(l.status).toBe(200);
    const setCookie = String(l.res.headers['set-cookie']);
    expect(setCookie).toMatch(/^__Host-session=[A-Za-z0-9_-]{40,}/);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(setCookie).toContain(attr);
    expect(setCookie).not.toMatch(/Domain=/i); // required by the __Host- prefix
    expect((await a.req('GET', '/api/session', { cookie: l.cookie })).statusCode).toBe(200);
  });

  it('local HTTP development uses a plain cookie name without Secure', async () => {
    const a = await authTestApp({ secureCookies: false });
    const l = await a.login();
    const setCookie = String(l.res.headers['set-cookie']);
    expect(setCookie).toMatch(/^session=/);
    expect(setCookie).not.toContain('Secure');
    expect((await a.req('GET', '/api/session', { cookie: l.cookie })).statusCode).toBe(200);
  });

  it('the cookie token is not stored in the database, only its hash', async () => {
    const a = await authTestApp();
    const l = await a.login();
    const token = l.cookie.split('=')[1]!;
    const rows = await a.db.query<{ token_hash: string }>('select token_hash from sessions');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.token_hash).not.toBe(token);
    expect(rows.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('logout ends the session on the server, not just in the browser', async () => {
    const a = await authTestApp();
    const { cookie } = await a.login();
    expect((await a.req('POST', '/api/logout', { cookie })).statusCode).toBe(200);
    expect((await a.req('GET', '/api/session', { cookie })).statusCode).toBe(401); // the old cookie is dead
  });

  it('rejects a bad body or a non 4-digit PIN with 400 and does not count it as a guess', async () => {
    const a = await authTestApp();
    for (const body of [{}, { pin: 1234 }, { pin: '12' }, { pin: 'abcd' }, null]) {
      expect((await a.req('POST', '/api/login', { body })).statusCode).toBe(400);
    }
    expect(await failureRows(a)).toBe(0);
  });

  it('answers 503 when no PIN has been set yet', async () => {
    const a = await authTestApp({ setPinTo: null });
    expect((await a.login()).status).toBe(503);
  });

  it('sessions expire after 30 days, and activity slides the expiry at most once per hour', async () => {
    const a = await authTestApp();
    const { cookie } = await a.login();
    const lastSeen = async () => (await a.db.query<{ t: string }>('select last_seen_at::text as t from sessions')).rows[0]!.t;
    const first = await lastSeen();

    a.advance(10 * MIN); // within the hour: no write, no new cookie
    const quick = await a.req('GET', '/api/session', { cookie });
    expect(quick.statusCode).toBe(200);
    expect(quick.headers['set-cookie']).toBeUndefined();
    expect(await lastSeen()).toBe(first);

    a.advance(2 * 60 * MIN); // past the hour: slides forward and re-sends the cookie
    const slid = await a.req('GET', '/api/session', { cookie });
    expect(slid.statusCode).toBe(200);
    expect(String(slid.headers['set-cookie'])).toContain('__Host-session=');
    expect(await lastSeen()).not.toBe(first);

    a.advance(29 * 24 * 60 * MIN); // 29 days after the slide: still valid
    expect((await a.req('GET', '/api/session', { cookie })).statusCode).toBe(200);
    a.advance(31 * 24 * 60 * MIN); // idle for 31 days: expired
    expect((await a.req('GET', '/api/session', { cookie })).statusCode).toBe(401);
  });

  it('purges expired sessions', async () => {
    const a = await authTestApp();
    await a.login();
    a.advance(31 * 24 * 60 * MIN);
    expect(await purgeExpiredSessions(a.db, a.now())).toBe(1);
  });
});

describe('default-deny and CSRF', () => {
  it('every registered route except login and health rejects an unauthenticated request with 401', async () => {
    const a = await authTestApp();
    await a.app.ready();
    // Fastify auto-adds a HEAD twin for every GET; compare the real methods only
    const methodsOf = (r: { method: string | string[] }) => [r.method].flat().filter((m) => m !== 'HEAD');
    const publicRoutes = a.routes.filter((r) => r.public).flatMap((r) => methodsOf(r).map((m) => `${m} ${r.url}`)).sort();
    expect(publicRoutes).toEqual(['GET /api/health', 'POST /api/login']);

    const protectedRoutes = a.routes.filter((r) => !r.public);
    expect(protectedRoutes.length).toBeGreaterThan(10);
    for (const r of protectedRoutes) {
      for (const method of methodsOf(r)) {
        const url = r.url.replace(/:id/g, '1');
        const res = await a.req(method as 'GET', url, { body: method === 'GET' || method === 'DELETE' ? undefined : {} });
        expect(res.statusCode, `${method} ${r.url}`).toBe(401);
      }
    }
  });

  it('a protected route works with a session', async () => {
    const a = await authTestApp();
    const { cookie } = await a.login();
    expect((await a.req('GET', '/api/transactions', { cookie })).statusCode).toBe(200);
    const created = await a.req('POST', '/api/transactions', { cookie, body: { amount: '12.50' } });
    expect(created.statusCode).toBe(201);
  });

  it('state-changing requests need an exact allowed Origin, including login; a missing Origin is rejected', async () => {
    const a = await authTestApp();
    const { cookie } = await a.login();
    expect((await a.req('POST', '/api/login', { body: { pin: PIN }, origin: null })).statusCode).toBe(403);
    expect((await a.req('POST', '/api/login', { body: { pin: PIN }, origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await a.req('POST', '/api/login', { body: { pin: PIN }, origin: `${ORIGIN}.evil.example` })).statusCode).toBe(403);
    expect((await a.req('POST', '/api/transactions', { cookie, body: { amount: '5' }, origin: null })).statusCode).toBe(403);
    expect((await a.req('DELETE', '/api/transactions/1', { cookie, origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await a.req('GET', '/api/transactions', { cookie, origin: null })).statusCode).toBe(200); // reads need no Origin
  });

  it('API responses are never cached', async () => {
    const a = await authTestApp();
    expect((await a.req('GET', '/api/health')).headers['cache-control']).toBe('no-store');
    expect((await a.req('GET', '/api/health')).headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('lockout', () => {
  it('5 wrong PINs block the IP for 1 minute, and even the correct PIN is refused while blocked', async () => {
    const a = await authTestApp();
    for (let i = 1; i <= 4; i++) expect((await a.login('0000')).status).toBe(401);
    const fifth = await a.login('0000');
    expect(fifth.status).toBe(401);
    expect(fifth.body.retryAfterSeconds).toBe(60); // the countdown the UI shows
    const blocked = await a.login(PIN); // correct PIN, but blocked
    expect(blocked.status).toBe(429);
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.res.headers['retry-after']).toBeDefined();
    a.advance(61_000);
    const ok = await a.login(PIN);
    expect(ok.status).toBe(200);
  });

  it('escalates 1, 5, 15, then 60 minutes (cap), and a success resets the IP', async () => {
    const a = await authTestApp();
    for (let i = 0; i < 5; i++) await a.login('0000'); // block #1: 1 minute
    const waits: number[] = [];
    for (const expected of [5, 15, 60, 60]) {
      a.advance(61 * MIN); // always long enough to clear the current block
      const r = await a.login('0000'); // one more wrong attempt right after each block ends
      expect(r.status).toBe(401);
      waits.push(r.body.retryAfterSeconds / 60);
      expect(r.body.retryAfterSeconds / 60).toBe(expected);
    }
    expect(waits).toEqual([5, 15, 60, 60]);
    a.advance(61 * MIN);
    expect((await a.login(PIN)).status).toBe(200);
    // reset: five more wrong attempts are needed again before the next block
    for (let i = 0; i < 4; i++) expect((await a.login('0000')).status).toBe(401);
    expect((await a.login('0000')).body.retryAfterSeconds).toBe(60);
  });

  it('one IP being blocked does not affect another IP', async () => {
    const a = await authTestApp();
    for (let i = 0; i < 5; i++) await a.login('0000', '10.0.0.1');
    expect((await a.login(PIN, '10.0.0.1')).status).toBe(429);
    expect((await a.login(PIN, '10.0.0.2')).status).toBe(200);
  });

  it('100 parallel wrong guesses from one IP let exactly 5 reach a PIN comparison', async () => {
    const a = await authTestApp();
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => a.login(String(i).padStart(4, '0').replace('4821', '0000'))));
    const compared = results.filter((r) => r.status === 401).length;
    const refused = results.filter((r) => r.status === 429).length;
    expect(compared).toBe(5);
    expect(refused).toBe(95);
    expect(await failureRows(a)).toBe(5);
  });

  it('survives an app restart because the counters live in Postgres', async () => {
    const a = await authTestApp();
    for (let i = 0; i < 5; i++) await a.login('0000');
    a.restart(); // fresh app instance, same database
    expect((await a.login(PIN)).status).toBe(429);
  });

  it('global cap: 30 failures in a rolling hour across many IPs refuses even the correct PIN, without extending the window', async () => {
    const a = await authTestApp();
    for (let i = 0; i < 30; i++) expect((await a.login('0000', `10.1.0.${i + 1}`)).status).toBe(401);
    const generic = await a.login('0000', '10.1.1.1');
    expect(generic.status).toBe(429);
    expect(generic.body).toEqual({ error: 'try again later' }); // generic, no countdown
    expect((await a.login(PIN, '10.1.1.2')).status).toBe(429); // correct PIN refused while the cap is active
    for (let i = 0; i < 20; i++) await a.login('0000', `10.2.0.${i + 1}`); // hammering while capped...
    expect(await failureRows(a)).toBe(30); // ...records nothing, so the window is not extended
    a.advance(61 * MIN);
    expect((await a.login(PIN, '10.1.1.3')).status).toBe(200);
  });

  it('a rejected cap attempt does not leave a per-IP increment behind', async () => {
    const a = await authTestApp();
    for (let i = 0; i < 30; i++) await a.login('0000', `10.1.0.${i + 1}`);
    await a.login('0000', '10.9.9.9'); // refused by the global cap
    const row = await a.db.query('select * from login_attempts where ip = $1', ['10.9.9.9']);
    expect(row.rows).toHaveLength(0);
  });
});

describe('client IP from proxy headers', () => {
  it('an untrusted peer cannot dodge the lockout by spoofing X-Forwarded-For', async () => {
    const a = await authTestApp({ trustProxy: false });
    for (let i = 0; i < 5; i++) await a.req('POST', '/api/login', { body: { pin: '0000' }, headers: { 'x-forwarded-for': `203.0.113.${i + 1}` } });
    const r = await a.req('POST', '/api/login', { body: { pin: PIN }, headers: { 'x-forwarded-for': '198.51.100.7' } });
    expect(r.statusCode).toBe(429); // still the same peer address, so still blocked
  });

  it('behind a trusted proxy hop, the forwarded client address is what is counted', async () => {
    const a = await authTestApp({ trustProxy: ['10.0.0.1'] });
    for (let i = 0; i < 5; i++) await a.req('POST', '/api/login', { body: { pin: '0000' }, ip: '10.0.0.1', headers: { 'x-forwarded-for': '203.0.113.5' } });
    const blocked = await a.req('POST', '/api/login', { body: { pin: PIN }, ip: '10.0.0.1', headers: { 'x-forwarded-for': '203.0.113.5' } });
    const other = await a.req('POST', '/api/login', { body: { pin: PIN }, ip: '10.0.0.1', headers: { 'x-forwarded-for': '203.0.113.6' } });
    expect(blocked.statusCode).toBe(429);
    expect(other.statusCode).toBe(200); // a different real client behind the same proxy is not blocked
  });

  it('a request that does not come from the trusted proxy ignores its X-Forwarded-For', async () => {
    const a = await authTestApp({ trustProxy: ['10.0.0.1'] });
    for (let i = 0; i < 5; i++) await a.req('POST', '/api/login', { body: { pin: '0000' }, ip: '192.0.2.9', headers: { 'x-forwarded-for': `203.0.113.${i + 1}` } });
    const r = await a.req('POST', '/api/login', { body: { pin: PIN }, ip: '192.0.2.9', headers: { 'x-forwarded-for': '198.51.100.7' } });
    expect(r.statusCode).toBe(429);
  });
});

describe('owner recovery (reset-pin)', () => {
  it('sets a new PIN, clears every lockout and signs out every session', async () => {
    const a = await authTestApp();
    const { cookie } = await a.login();
    for (let i = 0; i < 5; i++) await a.login('0000', '10.0.0.5');
    expect((await a.login(PIN, '10.0.0.5')).status).toBe(429);

    await setPin(a.db, '9999', FAST_ARGON);

    expect((await a.req('GET', '/api/session', { cookie })).statusCode).toBe(401); // signed out
    expect((await a.login(PIN, '10.0.0.5')).status).toBe(401); // the old PIN no longer works, and the IP is no longer blocked
    expect((await a.login('9999', '10.0.0.6')).status).toBe(200);
    expect(await failureRows(a)).toBe(1); // only the one wrong attempt just made
  });

  it('refuses a PIN that is not exactly 4 digits', async () => {
    const a = await authTestApp();
    await expect(setPin(a.db, '12345', FAST_ARGON)).rejects.toThrow(/4 digits/);
    expect((await a.login(PIN)).status).toBe(200); // unchanged
  });
});

describe('rate limit on the whole API', () => {
  it('limits requests per IP per minute and resets after the window', async () => {
    const a = await authTestApp({ rateLimitPerMinute: 5 });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await a.req('GET', '/api/health')).statusCode);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
    expect((await a.req('GET', '/api/health', { ip: '10.0.0.99' })).statusCode).toBe(200); // other IPs unaffected
    a.advance(61_000);
    expect((await a.req('GET', '/api/health')).statusCode).toBe(200);
  });
});

describe('log hygiene', () => {
  it('never writes the PIN or request bodies to the logs', async () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb(); } });
    const a = await authTestApp({ logStream: stream });
    for (let i = 0; i < 5; i++) await a.login('7777'); // wrong PINs, ends in a lockout
    await a.login(PIN);
    const logged = lines.join('');
    expect(logged).toContain('login lockout activated'); // lockout activation is logged...
    expect(logged).not.toContain('7777'); // ...but no PIN ever is
    expect(logged).not.toContain(PIN);
    expect(logged).not.toMatch(/"pin"/);
  });
});

describe('buildApp is default-deny at construction time', () => {
  it('refuses to build without an auth config', async () => {
    const { testDb } = await import('./helpers.js');
    const { buildApp } = await import('../src/app.js');
    const t = await testDb();
    expect(() => buildApp({ db: t.db })).toThrow(/auth/);
  });
});
