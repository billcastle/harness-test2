import type { Db } from '../db.js';
import { clearLockouts } from './lockout.js';
import { hashPin, PROD_ARGON2, type Argon2Params } from './pin.js';
import { destroyAllSessions, storePinHash } from './sessions.js';

/**
 * Sets (or replaces) the PIN, clears every lockout counter and signs out every session.
 * This is the owner's recovery path: run it on the server (`npm run reset-pin`).
 */
export async function setPin(db: Db, pin: string, params: Argon2Params = PROD_ARGON2): Promise<void> {
  const hash = await hashPin(pin, params); // throws unless the PIN is exactly 4 digits
  await storePinHash(db, hash);
  await clearLockouts(db);
  await destroyAllSessions(db);
}
