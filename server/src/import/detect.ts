import { isBpi, parseBpiPages } from './parsers/bpi.js';
import { isGcash, parseGcashPages } from './parsers/gcash.js';
import { isMaribank, parseMaribankPages } from './parsers/maribank.js';
import { ImportError, type Bank, type ParseResult } from './types.js';
import { loadPages } from './util.js';

/** Reads the PDF, detects the bank (unless one is given) and parses it. Runs inside the worker. */
export async function parseStatement(bytes: Uint8Array, bank?: Bank): Promise<ParseResult> {
  const pages = await loadPages(bytes);
  const detected: Bank | null = isGcash(pages) ? 'gcash' : isMaribank(pages) ? 'maribank' : isBpi(pages) ? 'bpi' : null;
  const chosen = bank ?? detected;
  if (!chosen) throw new ImportError('unknown_bank', 'Could not tell which bank this statement is from. Pick the bank and try again.');
  const result = chosen === 'gcash' ? parseGcashPages(pages) : chosen === 'maribank' ? parseMaribankPages(pages) : parseBpiPages(pages);
  if (bank && detected && bank !== detected) {
    result.warnings.push({ reason: `You chose ${bank}, but this looks like a ${detected} statement. Check the preview carefully.` });
  }
  return result;
}
