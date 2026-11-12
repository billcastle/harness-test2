// Runs inside a worker thread so a slow or hostile PDF cannot block or crash the API (see run.ts).
import { parentPort, workerData } from 'node:worker_threads';
import { parseStatement } from './detect.js';
import { ImportError, type Bank } from './types.js';

const { bytes, bank } = workerData as { bytes: Uint8Array; bank?: Bank };
try {
  parentPort!.postMessage({ ok: true, result: await parseStatement(bytes, bank) });
} catch (e) {
  if (e instanceof ImportError) parentPort!.postMessage({ ok: false, code: e.code, message: e.message });
  else parentPort!.postMessage({ ok: false, code: 'unreadable', message: 'This file could not be read as a PDF.' });
}
