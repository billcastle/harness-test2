// Online brute-force protection, stored in Postgres and decided BEFORE the PIN is compared.
//
// Per client IP: 5 failures, then the IP is blocked for 1 minute; each further failure after a block expires
// blocks longer: 5, 15, then 60 minutes (cap). A correct PIN resets that IP.
// Global: at most 30 attempts that reached a PIN comparison and did not succeed in any rolling hour, across all
// IPs. While the cap is active even the correct PIN is rejected, and rejected attempts are NOT recorded, so an
// attacker cannot extend the window by hammering it. That is a deliberate denial-of-service tradeoff against the
// owner; the owner recovers with `npm run reset-pin`.
//
// Atomicity: an attempt is counted by one upsert whose WHERE clause refuses blocked IPs. The attempt that
// reaches the threshold sets the block in the same statement, so parallel guesses cannot slip through between
// "count" and "block". A global advisory lock serializes the whole reservation.
import type { Db } from '../db.js';

export interface LockoutConfig {
  ipThreshold: number; // failures before the first block
  ladderMinutes: number[]; // block length for the 1st, 2nd, ... block; the last entry repeats
  globalCap: number; // failed/in-flight attempts per rolling hour, all IPs
  globalWindowMinutes: number;
}
export const DEFAULT_LOCKOUT: LockoutConfig = { ipThreshold: 5, ladderMinutes: [1, 5, 15, 60], globalCap: 30, globalWindowMinutes: 60 };

export type Reservation =
  | { ok: true; reservationId: number; failures: number; blockedNow: boolean; blockedUntil: Date | null }
  | { ok: false; reason: 'ip_blocked'; retryAfterSeconds: number }
  | { ok: false; reason: 'global_cap' };

class GlobalCapReached extends Error {}

const GLOBAL_LOCK = 7_001; // arbitrary constant key for pg_advisory_xact_lock

export async function reserveAttempt(db: Db, ip: string, now: Date, cfg: LockoutConfig = DEFAULT_LOCKOUT): Promise<Reservation> {
  const t = now.toISOString();
  try {
    return await db.transaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock($1)', [GLOBAL_LOCK]);

      // Ladder as a CASE: failure number n >= threshold blocks for ladder[min(n - threshold, last)] minutes.
      const ladder = cfg.ladderMinutes;
      const idx = `least(login_attempts.failures + 1 - ${cfg.ipThreshold}, ${ladder.length - 1})`;
      const whenClauses = ladder.map((m, i) => `when ${i} then ${m} * interval '1 minute'`).join(' ');
      const up = await tx.query<{ failures: number; blocked_until: string | null }>(
        `insert into login_attempts (ip, failures, updated_at) values ($1, 1, $2::timestamptz)
         on conflict (ip) do update set
           failures = login_attempts.failures + 1,
           updated_at = $2::timestamptz,
           blocked_until = case
             when login_attempts.failures + 1 >= ${cfg.ipThreshold}
             then $2::timestamptz + case ${idx} ${whenClauses} end
             else login_attempts.blocked_until end
         where login_attempts.blocked_until is null or login_attempts.blocked_until <= $2::timestamptz
         returning failures, blocked_until::text as blocked_until`,
        [ip, t],
      );
      const row = up.rows[0];
      if (!row) {
        const cur = await tx.query<{ secs: string }>(
          `select greatest(ceil(extract(epoch from (blocked_until - $2::timestamptz))), 1)::text as secs from login_attempts where ip = $1`,
          [ip, t],
        );
        return { ok: false, reason: 'ip_blocked', retryAfterSeconds: Number(cur.rows[0]?.secs ?? 60) } as const;
      }

      const recent = await tx.query<{ n: string }>(
        `select count(*)::text as n from login_failures where at > $1::timestamptz - $2 * interval '1 minute'`,
        [t, cfg.globalWindowMinutes],
      );
      if (Number(recent.rows[0]!.n) >= cfg.globalCap) throw new GlobalCapReached(); // rolls back the per-IP increment too

      const ins = await tx.query<{ id: string }>('insert into login_failures (ip, at) values ($1, $2::timestamptz) returning id::text as id', [ip, t]);
      const blockedUntil = row.blocked_until ? new Date(row.blocked_until) : null;
      return {
        ok: true,
        reservationId: Number(ins.rows[0]!.id),
        failures: Number(row.failures),
        blockedNow: blockedUntil !== null && blockedUntil.getTime() > now.getTime(),
        blockedUntil,
      } as const;
    });
  } catch (err) {
    if (err instanceof GlobalCapReached) return { ok: false, reason: 'global_cap' };
    throw err;
  }
}

/** The PIN was correct: forget this attempt and reset the IP's counter. */
export async function releaseSuccess(db: Db, ip: string, reservationId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query('delete from login_failures where id = $1', [reservationId]);
    await tx.query('delete from login_attempts where ip = $1', [ip]);
  });
}

/** Owner recovery: clear every lockout counter. */
export async function clearLockouts(db: Db): Promise<void> {
  await db.query('delete from login_failures');
  await db.query('delete from login_attempts');
}

/** Housekeeping: drop counters that can no longer matter. */
export async function purgeLockoutData(db: Db, now: Date): Promise<void> {
  const t = now.toISOString();
  await db.query(`delete from login_failures where at < $1::timestamptz - interval '2 hours'`, [t]);
  await db.query(
    `delete from login_attempts where updated_at < $1::timestamptz - interval '24 hours' and (blocked_until is null or blocked_until < $1::timestamptz)`,
    [t],
  );
}
