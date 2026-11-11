import fs from 'node:fs';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])), isEvalSupported: false }).promise;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const ops = await page.getOperatorList();
  const imgs = ops.fnArray.filter((f) => f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject || f === OPS.paintImageMaskXObject).length;
  const vp = page.getViewport({ scale: 1 });
  console.log(`page ${p}: ${Math.round(vp.width)}x${Math.round(vp.height)} images=${imgs} ops=${ops.fnArray.length}`);
}
