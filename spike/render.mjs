import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
const require = createRequire(import.meta.url);
const fontDir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';
const [pdf, out, ...pages] = process.argv.slice(2);
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), isEvalSupported: false, standardFontDataUrl: fontDir }).promise;
for (const n of pages.map(Number)) {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 1.4 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
  fs.writeFileSync(`${out}-p${n}.png`, canvas.toBuffer('image/png'));
  console.log('wrote', `${out}-p${n}.png`);
}
