// Owner recovery: sets a new 4-digit PIN, clears all lockouts and signs out every session.
//   Local:   DATABASE_URL=postgres://... npm run reset-pin
//   Compose: docker compose exec app npm run reset-pin
// The PIN is typed at a hidden prompt, never passed on the command line, so it stays out of shell history.
import readline from 'node:readline';
import { setPin } from '../auth/admin.js';
import { PIN_RE } from '../auth/pin.js';
import { createPgDb } from '../db.js';
import { migrate } from '../migrate.js';

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const w = rl as unknown as { _writeToOutput: (s: string) => void };
    w._writeToOutput = (s: string) => process.stdout.write(s.includes(prompt) ? s : '*');
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const pin = await askHidden('New 4-digit PIN: ');
if (!PIN_RE.test(pin)) {
  console.error('The PIN must be exactly 4 digits.');
  process.exit(1);
}
if (pin !== (await askHidden('Repeat PIN: '))) {
  console.error('The PINs do not match.');
  process.exit(1);
}
const db = createPgDb(url);
await migrate(db);
await setPin(db, pin);
await db.close();
console.log('PIN updated. All lockouts cleared and all sessions signed out.');
