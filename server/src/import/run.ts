import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { ImportError, type Bank, type ParseResult } from './types.js';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export interface RunOptions {
  timeoutMs?: number;
  maxMemoryMb?: number;
}

/** True when the bytes start like a PDF. The extension and the Content-Type are not trusted. */
export const hasPdfMagic = (b: Uint8Array): boolean => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d; // "%PDF-"

// The Vercel build ships a pre-bundled worker next to the bundled handler; everywhere else the TypeScript source runs through tsx.
const bundledWorker = new URL('./import-worker.mjs', import.meta.url);
const workerFile = fs.existsSync(fileURLToPath(bundledWorker))
  ? { url: bundledWorker, bundled: true }
  : { url: new URL('./worker.ts', import.meta.url), bundled: false };

/**
 * Parses a statement in a worker thread with a time limit and a memory cap. A crash, an out-of-memory or a timeout
 * becomes an ImportError for this one upload; the API process keeps serving other requests.
 */
export function parseInWorker(bytes: Uint8Array, bank: Bank | undefined, { timeoutMs = 30_000, maxMemoryMb = 512 }: RunOptions = {}): Promise<ParseResult> {
  if (bytes.length > MAX_PDF_BYTES) return Promise.reject(new ImportError('too_large', 'That file is larger than 10 MB.'));
  if (!hasPdfMagic(bytes)) return Promise.reject(new ImportError('not_pdf', 'That is not a PDF file.'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile.url, {
      workerData: { bytes, bank },
      execArgv: workerFile.bundled ? [] : ['--import', 'tsx'],
      resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb },
    });
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new ImportError('timeout', 'Reading this statement took too long, so it was stopped.'))), timeoutMs);
    worker.once('message', (m: { ok: true; result: ParseResult } | { ok: false; code: ImportError['code']; message: string }) =>
      finish(() => (m.ok ? resolve(m.result) : reject(new ImportError(m.code, m.message)))),
    );
    worker.once('error', () => finish(() => reject(new ImportError('unreadable', 'This statement could not be read (it may be too complex).'))));
    worker.once('exit', (code) => finish(() => reject(new ImportError('unreadable', `The reader stopped unexpectedly (exit ${code}).`))));
  });
}
