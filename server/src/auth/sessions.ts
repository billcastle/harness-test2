import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db.js';

export const SESSION_DAYS = 30;
const REFRESH_AFTER_MS = 3_600_000; // sliding expiry is written at most once per hour

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export async function createSession(db: Db, now: Date): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = addDays(now, SESSION_DAYS);
  await db.query(
    'insert into sessions (token_hash, created_at, last_seen_at, expires_at) values ($1, $2::timestamptz, $2::timestamptz, $3::timestamptz)',
    [hash(token), now.toISOString(), expiresAt.toISOString()],
  );
  return { token, expiresAt };
}

export type SessionCheck = { ok: false } | { ok: true; refreshedExpiresAt: Date | null };

/** Valid if known and unexpired. Slides the 30-day expiry forward, but writes at most once per hour. */
export async function checkSession(db: Db, token: string, now: Date): Promise<SessionCheck> {
  const r = await db.query<{ last_seen: string; expires: string }>(
    'select last_seen_at::text as last_seen, expires_at::text as expires from sessions where token_hash = $1',
    [hash(token)],
  );
  const row = r.rows[0];
  if (!row) return { ok: false };
  if (new Date(row.expires).getTime() <= now.getTime()) {
    await db.query('delete from sessions where token_hash = $1', [hash(token)]);
    return { ok: false };
  }
  if (now.getTime() - new Date(row.last_seen).getTime() < REFRESH_AFTER_MS) return { ok: true, refreshedExpiresAt: null };
  const expiresAt = addDays(now, SESSION_DAYS);
  await db.query('update sessions set last_seen_at = $2::timestamptz, expires_at = $3::timestamptz where token_hash = $1', [
    hash(token), now.toISOString(), expiresAt.toISOString(),
  ]);
  return { ok: true, refreshedExpiresAt: expiresAt };
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.query('delete from sessions where token_hash = $1', [hash(token)]);
}

export async function destroyAllSessions(db: Db): Promise<void> {
  await db.query('delete from sessions');
}

export async function purgeExpiredSessions(db: Db, now: Date): Promise<number> {
  const r = await db.query('delete from sessions where expires_at <= $1::timestamptz', [now.toISOString()]);
  return r.rowCount;
}

// ---- PIN storage
export async function getPinHash(db: Db): Promise<string | null> {
  const r = await db.query<{ pin_hash: string }>('select pin_hash from auth_settings where id = 1');
  return r.rows[0]?.pin_hash ?? null;
}

export async function storePinHash(db: Db, pinHash: string): Promise<void> {
  await db.query(
    `insert into auth_settings (id, pin_hash) values (1, $1)
     on conflict (id) do update set pin_hash = excluded.pin_hash, updated_at = now()`,
    [pinHash],
  );
}
