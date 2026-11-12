// Minimal PDF writer for tests: pages of text placed at exact (x, y) points (Helvetica, y grows upward like real statements).
export interface Cell {
  x: number;
  y: number;
  s: string;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

export function makePdf(pages: Cell[][]): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => objs.push(body) && objs.length; // returns the 1-based object number
  add('<< /Type /Catalog /Pages 2 0 R >>'); // 1
  add(''); // 2: Pages, filled in below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 3
  const kids: number[] = [];
  for (const cells of pages) {
    const stream = cells.map((c) => `BT /F1 6 Tf ${c.x} ${c.y} Td (${esc(c.s)}) Tj ET`).join('\n');
    const contentNo = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageNo = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNo} 0 R >>`);
    kids.push(pageNo);
  }
  objs[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
