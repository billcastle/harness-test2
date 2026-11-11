// Spike: position-aware parsers for BPI (credit card), GCash and Maribank statements.
// Usage: node parse.mjs <bank> <pdf> <out.json>
// Output rows use integer centavos (no float math) and a `kind` guess from simple keyword rules.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
const fontDir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';

async function loadPages(pdfPath) {
  const doc = await getDocument({
    data: new Uint8Array(fs.readFileSync(pdfPath)),
    isEvalSupported: false,
    standardFontDataUrl: fontDir,
  }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const { items } = await (await doc.getPage(n)).getTextContent();
    pages.push({
      n,
      items: items
        .filter((i) => i.str && i.str.trim() !== '')
        .map((i) => ({ x: i.transform[4], y: i.transform[5], s: i.str })),
    });
  }
  return pages;
}

// money: "1,234.50" -> 123450 (integer centavos), no float math. Returns null if not money.
function toCentavos(str) {
  const m = /^(-)?(\d[\d,]*)(?:\.(\d{1,2}))?$/.exec(str.replace(/\s+/g, ''));
  if (!m) return null;
  const whole = m[2].replace(/,/g, '');
  const frac = (m[3] || '').padEnd(2, '0');
  const v = BigInt(whole) * 100n + BigInt(frac);
  if (v > 9_000_000_000_000n) return null;
  return Number(m[1] ? -v : v);
}
const fmt = (c) => (c < 0 ? '-' : '') + (Math.abs(c) / 100).toFixed(2);

function nearestAnchor(anchors, y) {
  let best = null;
  for (const a of anchors) if (!best || Math.abs(a.y - y) < Math.abs(best.y - y)) best = a;
  return best;
}

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const pad2 = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------- GCash
async function parseGcash(pdfPath) {
  const pages = await loadPages(pdfPath);
  const rows = [];
  const errors = [];
  let startBalance = null;
  const footer = {};
  const warnings = [];
  let balanceChecks = 0;
  let balanceMismatches = 0;
  let prevBalance = null;
  const dateRe = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}) ([AP]M)$/;

  for (const { n, items } of pages) {
    const hdr = items.find((i) => i.s === 'Debit');
    const headerY = hdr ? hdr.y : Infinity;
    const body = items.filter((i) => i.y < headerY - 1);
    const sb = body.find((i) => i.s === 'STARTING BALANCE');
    if (sb) {
      const b = body.find((i) => Math.abs(i.y - sb.y) < 2 && i.x > 480);
      if (b) {
        startBalance = toCentavos(b.s);
        prevBalance = startBalance;
      }
    }
    const anchors = body.filter((i) => i.x < 150 && dateRe.test(i.s));
    for (const label of ['ENDING BALANCE', 'Total Debit', 'Total Credit']) {
      const f = body.find((i) => i.s === label);
      if (f) {
        const v = body.find((i) => Math.abs(i.y - f.y) < 2 && i.x > 380 && toCentavos(i.s) !== null);
        if (v) footer[label] = toCentavos(v.s);
      }
    }
    const FOOTER = new Set(['STARTING BALANCE', 'ENDING BALANCE', 'Total Debit', 'Total Credit']);
    const frags = body.filter((i) => i.x >= 150 && i.x < 290 && !FOOTER.has(i.s));
    const byAnchor = new Map(anchors.map((a) => [a, []]));
    for (const f of frags) {
      const a = nearestAnchor(anchors, f.y);
      if (a && Math.abs(a.y - f.y) <= 12) byAnchor.get(a).push(f);
      else errors.push({ page: n, reason: 'orphan description fragment', text: f.s });
    }
    for (const a of anchors.sort((p, q) => q.y - p.y)) {
      const same = body.filter((i) => Math.abs(i.y - a.y) <= 2.5 && i.x >= 290);
      const ref = same.find((i) => /^\d{10,}$/.test(i.s));
      const nums = same.filter((i) => i.x > 380 && /^\d+\.\d\d$/.test(i.s)).sort((p, q) => p.x - q.x);
      if (nums.length !== 2) {
        errors.push({ page: n, reason: `expected amount+balance, found ${nums.length}`, date: a.s });
        continue;
      }
      const [amt, bal] = nums;
      const isCredit = amt.x > 435;
      const amount = toCentavos(amt.s);
      const balance = toCentavos(bal.s);
      const desc = byAnchor
        .get(a)
        .sort((p, q) => q.y - p.y || p.x - q.x)
        .map((f) => f.s)
        .join(' ');
      if (prevBalance !== null) {
        balanceChecks++;
        const expected = prevBalance + (isCredit ? amount : -amount);
        if (expected !== balance) {
          balanceMismatches++;
          warnings.push({ page: n, reason: 'balance chain mismatch (statement inconsistency, amounts still captured)', date: a.s, expected: fmt(expected), got: fmt(balance) });
        }
      }
      prevBalance = balance;
      const m = dateRe.exec(a.s);
      rows.push({
        date: `${m[1]}-${m[2]}-${m[3]}`,
        time: `${m[4]} ${m[5]}`,
        description: desc,
        reference: ref ? ref.s : null,
        direction: isCredit ? 'in' : 'out',
        amountCentavos: amount,
        balanceCentavos: balance,
        ...classifyGcash(desc, isCredit),
      });
    }
  }
  const out = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amountCentavos, 0);
  const inn = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amountCentavos, 0);
  const printedOut = footer['Total Debit'] ?? null;
  const printedIn = footer['Total Credit'] ?? null;
  const impliedEnd = startBalance === null ? null : startBalance + (printedIn ?? 0) - (printedOut ?? 0);
  return {
    bank: 'gcash',
    rows,
    errors,
    warnings,
    reconcile: {
      parsedOut: fmt(out), printedTotalDebit: printedOut === null ? null : fmt(printedOut),
      parsedIn: fmt(inn), printedTotalCredit: printedIn === null ? null : fmt(printedIn),
      printedEndingBalance: footer['ENDING BALANCE'] === undefined ? null : fmt(footer['ENDING BALANCE']),
      endingBalanceImpliedByPrintedTotals: impliedEnd === null ? null : fmt(impliedEnd),
      statementInconsistencyCentavos: impliedEnd === null || footer['ENDING BALANCE'] === undefined ? null : footer['ENDING BALANCE'] - impliedEnd,
      balanceChainChecks: balanceChecks,
      balanceChainMismatches: balanceMismatches,
      ok: printedOut !== null && printedIn !== null && out === printedOut && inn === printedIn && errors.length === 0,
    },
  };
}
function classifyGcash(desc, isCredit) {
  if (isCredit) {
    if (/^Refund/i.test(desc)) return { kind: 'refund', reason: 'merchant refund' };
    if (/^Transfer from System/i.test(desc)) return { kind: 'refund', reason: 'system credit (likely reversal; review)', review: true };
    if (/^Received GCash from (BPI|BDO|Maribank)/i.test(desc)) return { kind: 'transfer', reason: 'top-up from a bank (review: confirm it is your own account)', review: true };
    return { kind: 'income', reason: 'credit', review: true };
  }
  if (/^Payment to |Buy Load|Bills Payment/i.test(desc)) return { kind: 'expense', reason: 'merchant payment' };
  if (/^Transfer from/i.test(desc)) return { kind: 'expense', reason: 'transfer to person (review: may be own account)', review: true };
  return { kind: 'expense', reason: 'default debit', review: true };
}

// ---------------------------------------------------------------- BPI credit card
const compact = (s) => s.replace(/\s+/g, '');
async function parseBpi(pdfPath) {
  const pages = await loadPages(pdfPath);
  const rows = [];
  const errors = [];
  let stmtDate = null;
  let summary = null;
  const textlessPages = [];
  for (const { n, items } of pages) {
    if (items.length === 0) {
      textlessPages.push(n);
      continue;
    }
    const lines = groupRows(items).map((r) => ({ y: r.y, cells: r.cells.map((c) => ({ x: c.x, s: compact(c.s) })) }));
    for (const line of lines) {
      const joined = line.cells.map((c) => c.s).join(' ');
      let m = /^STATEMENTDATE(?:CUSTOMERNUMBER)?.*?(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)(\d{1,2}),(\d{4})/.exec(
        line.cells.map((c) => c.s).join(''),
      );
      if (!m) m = /(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)(\d{1,2}),(\d{4})/.exec(line.cells.map((c) => c.s).join(''));
      if (m && joined.includes('STATEMENT') && !stmtDate) {
        stmtDate = { y: Number(m[3]), m: MONTHS[m[1].slice(0, 3)], d: Number(m[2]) };
      }
      // summary row: "BPIRewards 42,241.87 42,241.87 35,496.00 0.00 0.00 0.00 35,496.00"
      const nums = line.cells.map((c) => toCentavos(c.s)).filter((v) => v !== null);
      if (!summary && /^BPI/.test(line.cells[0]?.s || '') && nums.length === 7) {
        summary = { prev: nums[0], credits: nums[1], purchases: nums[2], installment: nums[3], finance: nums[4], late: nums[5], due: nums[6] };
      }
      // transaction row: Month Day Month Day Description... Amount
      const c = line.cells;
      if (c.length >= 6 && /^[A-Za-z]+$/.test(c[0].s) && MONTHS[c[0].s.slice(0, 3).toUpperCase()] && /^\d{1,2}$/.test(c[1].s) &&
          MONTHS[c[2].s.slice(0, 3).toUpperCase()] && /^\d{1,2}$/.test(c[3].s)) {
        const amt = toCentavos(c[c.length - 1].s);
        if (amt === null) {
          errors.push({ page: n, reason: 'no amount at end of row', text: joined });
          continue;
        }
        rows.push({
          txMonth: MONTHS[c[0].s.slice(0, 3).toUpperCase()], txDay: Number(c[1].s),
          description: c.slice(4, -1).map((x) => x.s).join(' '),
          amountCentavos: amt, // negative = payment/credit
        });
      }
    }
  }
  if (!stmtDate) errors.push({ reason: 'statement date not found' });
  for (const r of rows) {
    // card statements cover ~1 month; a month later than the statement month belongs to the previous year
    const y = stmtDate && r.txMonth > stmtDate.m ? stmtDate.y - 1 : stmtDate ? stmtDate.y : null;
    r.date = y ? `${y}-${pad2(r.txMonth)}-${pad2(r.txDay)}` : null;
    delete r.txMonth; delete r.txDay;
    if (r.amountCentavos < 0) {
      r.direction = 'in'; r.amountCentavos = -r.amountCentavos;
      r.kind = 'transfer'; r.reason = 'card payment (money moved from own bank)';
    } else { r.direction = 'out'; r.kind = 'expense'; r.reason = 'card purchase'; }
  }
  const purchases = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amountCentavos, 0);
  const credits = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amountCentavos, 0);
  const rec = {
    statementDate: stmtDate ? `${stmtDate.y}-${pad2(stmtDate.m)}-${pad2(stmtDate.d)}` : null,
    textlessPages,
    parsedPurchases: fmt(purchases), statementPurchases: summary ? fmt(summary.purchases) : null,
    parsedCredits: fmt(credits), statementCredits: summary ? fmt(summary.credits) : null,
    statementAmountDue: summary ? fmt(summary.due) : null,
  };
  rec.ok = !!summary && purchases === summary.purchases && credits === summary.credits &&
    summary.prev - summary.credits + summary.purchases + summary.installment + summary.finance + summary.late === summary.due &&
    errors.length === 0;
  return { bank: 'bpi', rows, errors, reconcile: rec };
}

function groupRows(items, tol = 2.5) {
  const rows = [];
  for (const it of items) {
    let r = rows.find((q) => Math.abs(q.y - it.y) <= tol);
    if (!r) rows.push((r = { y: it.y, cells: [] }));
    r.cells.push({ x: it.x, s: it.s });
  }
  rows.sort((a, b) => b.y - a.y);
  rows.forEach((r) => r.cells.sort((a, b) => a.x - b.x));
  return rows;
}

// ---------------------------------------------------------------- Maribank
async function parseMaribank(pdfPath) {
  const pages = await loadPages(pdfPath);
  const rows = [];
  const errors = [];
  let period = null;
  let summary = null;
  let inSection = false;
  let ended = false;
  const dateRe = /^(?:(\d{2}) )?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/;
  for (const { n, items } of pages) {
    if (!period) {
      const p = items.find((i) => /^\d{2} [A-Z]{3} \d{4} to \d{2} [A-Z]{3} \d{4}$/.test(i.s));
      if (p) period = p.s;
    }
    if (!summary) {
      const top = items.find((i) => i.s === 'SAVINGS' && i.x < 80);
      if (top) {
        const nums = items.filter((i) => Math.abs(i.y - top.y) < 2 && i.x > 150).sort((a, b) => a.x - b.x).map((i) => toCentavos(i.s));
        if (nums.length === 4) summary = { start: nums[0], outgoing: nums[1], incoming: nums[2], end: nums[3] };
      }
    }
    if (ended) continue;
    let section = [];
    let sectionTop = Infinity;
    let sectionBottom = -Infinity;
    const start = items.find((i) => i.s === 'SAVINGS - TRANSACTION DETAILS');
    const stop = items.find((i) => i.s.startsWith('SAVINGS - INTEREST'));
    if (start) { inSection = true; sectionTop = start.y; }
    else if (inSection) sectionTop = 740; // continuation page: below the page header
    if (!inSection) continue;
    if (stop) { sectionBottom = stop.y; ended = true; } else sectionBottom = 60; // above the footer
    const hdr = items.find((i) => i.s === 'TRANSACTION' && i.x > 150 && i.x < 200);
    const hdrY = hdr ? hdr.y : Infinity;
    section = items.filter((i) => i.y < sectionTop - 1 && i.y > sectionBottom + 1 && i.y < hdrY - 1);
    const anchors = section.filter((i) => i.x < 80 && dateRe.test(i.s));
    const frags = section.filter((i) => i.x >= 150 && i.x < 340);
    const bucket = new Map(anchors.map((a) => [a, []]));
    for (const f of frags) {
      const a = nearestAnchor(anchors, f.y);
      if (a && Math.abs(a.y - f.y) <= 14) bucket.get(a).push(f);
      else errors.push({ page: n, reason: 'orphan description fragment', text: f.s });
    }
    for (const a of anchors.sort((p, q) => q.y - p.y)) {
      const amts = section.filter((i) => Math.abs(i.y - a.y) <= 2.5 && i.x >= 340 && toCentavos(i.s) !== null);
      if (amts.length !== 1) {
        errors.push({ page: n, reason: `expected one amount, found ${amts.length}`, date: a.s });
        continue;
      }
      const isIn = amts[0].x > 450; // OUTGOING column ends ~406, INCOMING column starts ~485
      const dm = dateRe.exec(a.s);
      const yr = period ? Number(period.slice(7, 11)) : null;
      const desc = bucket.get(a).sort((p, q) => q.y - p.y || p.x - q.x).map((f) => f.s).join(' ');
      const lastDay = new Date(Date.UTC(yr, MONTHS[dm[2]], 0)).getUTCDate();
      rows.push({
        date: yr ? `${yr}-${pad2(MONTHS[dm[2]])}-${dm[1] || pad2(lastDay)}` : null,
        dateApprox: !dm[1],
        description: desc,
        direction: isIn ? 'in' : 'out',
        amountCentavos: toCentavos(amts[0].s),
        ...classifyMaribank(desc, isIn),
      });
    }
  }
  const out = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amountCentavos, 0);
  const inn = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amountCentavos, 0);
  const rec = {
    period,
    parsedOutgoing: fmt(out), statementOutgoing: summary ? fmt(summary.outgoing) : null,
    parsedIncoming: fmt(inn), statementIncoming: summary ? fmt(summary.incoming) : null,
    balanceCheck: summary ? fmt(summary.start - out + inn) + ' vs ' + fmt(summary.end) : null,
  };
  rec.ok = !!summary && out === summary.outgoing && inn === summary.incoming && summary.start - out + inn === summary.end && errors.length === 0;
  return { bank: 'maribank', rows, errors, reconcile: rec };
}
function classifyMaribank(desc, isIn) {
  if (/^Refund/i.test(desc)) return { kind: 'refund', reason: 'refund' };
  if (/Bill Castillo/i.test(desc)) return { kind: 'transfer', reason: 'own-name transfer' };
  if (/Interest/i.test(desc)) return { kind: 'income', reason: 'interest' };
  if (/^Others/i.test(desc)) return isIn
    ? { kind: 'income', reason: 'Others incoming (review)', review: true }
    : { kind: 'transfer', reason: 'Others outgoing, likely time deposit placement (review)', review: true };
  if (isIn) return { kind: 'income', reason: 'credit', review: true };
  return { kind: 'expense', reason: 'debit' };
}

// ---------------------------------------------------------------- CLI
const [bank, pdf, outPath] = process.argv.slice(2);
const parsers = { gcash: parseGcash, bpi: parseBpi, maribank: parseMaribank };
if (!parsers[bank]) { console.error('bank must be gcash|bpi|maribank'); process.exit(2); }
const result = await parsers[bank](pdf);
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
const kinds = {};
for (const r of result.rows) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
console.log(JSON.stringify({ bank: result.bank, rows: result.rows.length, kinds, errors: result.errors.length, warnings: (result.warnings || []).length, reconcile: result.reconcile }, null, 2));
