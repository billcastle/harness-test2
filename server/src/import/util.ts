// Position-aware text extraction and small helpers shared by the bank parsers.
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ImportError } from './types.js';

export interface Item {
  x: number;
  y: number;
  s: string;
}
export interface Page {
  n: number;
  items: Item[];
}

const require = createRequire(import.meta.url);
const fontDir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';

export async function loadPages(bytes: Uint8Array): Promise<Page[]> {
  let doc: Awaited<ReturnType<typeof getDocument>['promise']>;
  try {
    // pdfjs 6 has no eval path (the old isEvalSupported option is gone)
    doc = await getDocument({ data: bytes, standardFontDataUrl: fontDir }).promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') throw new ImportError('encrypted', 'This PDF is password protected. Password entry is not supported yet.');
    throw new ImportError('unreadable', 'This file could not be read as a PDF.');
  }
  const pages: Page[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const { items } = await (await doc.getPage(n)).getTextContent();
    pages.push({
      n,
      items: items
        .filter((i): i is typeof i & { str: string; transform: number[] } => 'str' in i && i.str.trim() !== '')
        .map((i) => ({ x: i.transform[4] ?? 0, y: i.transform[5] ?? 0, s: i.str })),
    });
  }
  return pages;
}

/** "1,234.50" -> 123450 (integer centavos, no float math); "-42.00" -> -4200. Null when it is not a money value. */
export function toCentavos(str: string): number | null {
  const m = /^(-)?(\d[\d,]*)(?:\.(\d{1,2}))?$/.exec(str.replace(/\s+/g, ''));
  if (!m) return null;
  const v = BigInt(m[2]!.replace(/,/g, '')) * 100n + BigInt((m[3] ?? '').padEnd(2, '0'));
  if (v > 9_000_000_000_000n) return null;
  return Number(m[1] ? -v : v);
}

export const fmt = (c: number): string => (c < 0 ? '-' : '') + (Math.abs(c) / 100).toFixed(2);

export function nearestAnchor<T extends { y: number }>(anchors: T[], y: number): T | null {
  let best: T | null = null;
  for (const a of anchors) if (!best || Math.abs(a.y - y) < Math.abs(best.y - y)) best = a;
  return best;
}

export function groupRows(items: Item[], tol = 2.5): { y: number; cells: { x: number; s: string }[] }[] {
  const rows: { y: number; cells: { x: number; s: string }[] }[] = [];
  for (const it of items) {
    let r = rows.find((q) => Math.abs(q.y - it.y) <= tol);
    if (!r) rows.push((r = { y: it.y, cells: [] }));
    r.cells.push({ x: it.x, s: it.s });
  }
  rows.sort((a, b) => b.y - a.y);
  rows.forEach((r) => r.cells.sort((a, b) => a.x - b.x));
  return rows;
}

export const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
export const pad2 = (n: number) => String(n).padStart(2, '0');
