// Spike: dump positioned text per page so we can see what each bank's layout really looks like.
// Usage: node dump.mjs <pdf> <outPrefix>
import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [pdfPath, outPrefix] = process.argv.slice(2);
const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;

const summary = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const { items } = await page.getTextContent();
  const texts = items.filter((i) => i.str && i.str.trim() !== '');
  // group into visual rows by y (PDF y grows upward), tolerance 2pt
  const rows = [];
  for (const it of texts) {
    const x = it.transform[4];
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) rows.push((row = { y, cells: [] }));
    row.cells.push({ x, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  const lines = rows.map((r) => {
    r.cells.sort((a, b) => a.x - b.x);
    return `${r.y.toFixed(0).padStart(4)} | ` + r.cells.map((c) => `[${c.x.toFixed(0)}]${c.s}`).join(' ');
  });
  fs.writeFileSync(`${outPrefix}-p${p}.txt`, lines.join('\n') + '\n');
  summary.push({ page: p, textItems: texts.length, rows: rows.length });
}
console.log(JSON.stringify({ pdf: pdfPath.split('/').pop(), pages: doc.numPages, summary }));
