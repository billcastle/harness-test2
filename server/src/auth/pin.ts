// PIN hashing with argon2id from Node's built-in crypto (no dependency).
// A 4-digit PIN has only 10,000 possibilities, so this hash only protects against casual exposure of the
// database or a backup: an attacker holding the hash can brute-force it offline in seconds. The real
// protection is the online lockout (src/auth/lockout.ts). Treat the hash as a secret.
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export interface Argon2Params {
  memory: number; // KiB
  passes: number;
  parallelism: number;
}
/** OWASP-recommended argon2id minimums: 19 MiB, 2 passes, 1 lane. */
export const PROD_ARGON2: Argon2Params = { memory: 19_456, passes: 2, parallelism: 1 };
export const PIN_RE = /^\d{4}$/;

type Argon2Fn = (algorithm: string, params: Record<string, unknown>, cb: (err: Error | null, out: Buffer) => void) => void;
const run = promisify(argon2 as unknown as Argon2Fn);

async function derive(pin: string, salt: Buffer, p: Argon2Params): Promise<Buffer> {
  return run('argon2id', { message: pin, nonce: salt, parallelism: p.parallelism, tagLength: 32, memory: p.memory, passes: p.passes });
}

export async function hashPin(pin: string, p: Argon2Params = PROD_ARGON2): Promise<string> {
  if (!PIN_RE.test(pin)) throw new Error('PIN must be exactly 4 digits');
  const salt = randomBytes(16);
  const tag = await derive(pin, salt, p);
  return `argon2id$m=${p.memory},t=${p.passes},p=${p.parallelism}$${salt.toString('base64')}$${tag.toString('base64')}`;
}

export async function verifyPin(pin: string, encoded: string): Promise<boolean> {
  const m = /^argon2id\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(encoded);
  if (!m || !PIN_RE.test(pin)) return false;
  const params: Argon2Params = { memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]) };
  const expected = Buffer.from(m[5]!, 'base64');
  const actual = await derive(pin, Buffer.from(m[4]!, 'base64'), params);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
