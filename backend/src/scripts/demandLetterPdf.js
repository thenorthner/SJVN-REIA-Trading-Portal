/**
 * Demand for payment under a security instrument — a portrait A4 letter.
 *
 * The invocation already assembled everything a demand needs: who it is
 * addressed to, what was called for, which instruments were drawn and for how
 * much. It only ever existed as demand_letter_json in the database, so a bank
 * being asked to honour a guarantee had nothing to be sent — every other
 * document in this platform renders, and the one that actually asks a third
 * party for money did not.
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '../assets/sjvn_logo.jpg');

const PAGE_W = 595.28;
const M = 50;
const CONTENT_W = PAGE_W - M * 2;
const NAVY = '#1b3b6f';
const NAVY_TINT = '#f6f8fc';
const INK = '#1a1a1a';

// 'Rs.' rather than the rupee sign: PDFKit's built-in Helvetica has no glyph for
// U+20B9 and silently substitutes another, so a demand for 45,00,000 went out
// reading as something else entirely. The invoice template settled on the same
// spelling for the same reason.
const CUR = 'Rs.';
const money = (n) => `${CUR}${Number(n || 0).toLocaleString('en-IN')}`;
const onDate = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('.') : '');

export function buildDemandLetter(doc, { invocation, letter, contract, instruments = [], entity }) {
  let y = M;

  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, M, y, { width: 54 }); } catch { /* letter still works without it */ }
  }
  doc.font('Helvetica-Bold').fontSize(15).fillColor(NAVY)
    .text('SJVN LIMITED', M + 66, y + 4);
  doc.font('Helvetica').fontSize(8).fillColor('#5b6b85')
    .text('Commercial and System Operation Department', M + 66, y + 22)
    .text('Corporate Headquarters, Shakti Sadan, Shanan, Shimla, HP, 171006', M + 66, y + 33);
  y += 62;

  doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(1).strokeColor(NAVY).stroke();
  y += 18;

  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK)
    .text('DEMAND FOR PAYMENT UNDER SECURITY', M, y, { width: CONTENT_W, align: 'center' });
  y += 26;

  const meta = [
    ['Notice No.', invocation?.invocation_no ?? '—'],
    ['Date', onDate(letter?.issued_at ?? invocation?.created_at)],
    ['Contract', contract?.contract_no ?? invocation?.contract_id ?? '—'],
    ['Counterparty', entity?.name ?? '—'],
  ];
  doc.roundedRect(M, y, CONTENT_W, meta.length * 16 + 10, 3).fill(NAVY_TINT);
  let my = y + 7;
  for (const [k, v] of meta) {
    doc.font('Helvetica').fontSize(9).fillColor('#5b6b85').text(k, M + 10, my, { width: 110 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(String(v), M + 125, my, { width: CONTENT_W - 135 });
    my += 16;
  }
  y = my + 14;

  doc.font('Helvetica').fontSize(10).fillColor(INK);
  doc.text(`To: ${letter?.to ?? 'Issuing Bank / Counterparty'}`, M, y);
  y += 20;
  doc.text(
    `This is a formal demand under the security furnished for the above contract. `
    + `An amount of ${money(letter?.requested)} has fallen due and remains unpaid. `
    + `You are called upon to honour the instruments listed below.`,
    M, y, { width: CONTENT_W, align: 'justify' },
  );
  y = doc.y + 16;

  // What was drawn, and from where. The point of the letter.
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('Instruments drawn', M, y);
  y += 16;
  const cols = [
    { label: 'Instrument', w: 170 },
    { label: 'Type', w: 150 },
    { label: 'Issuing bank', w: 110 },
    { label: 'Amount', w: CONTENT_W - 430, align: 'right' },
  ];
  doc.rect(M, y, CONTENT_W, 18).fill(NAVY);
  let cx = M + 6;
  for (const c of cols) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff')
      .text(c.label, cx, y + 5, { width: c.w - 8, align: c.align || 'left' });
    cx += c.w;
  }
  y += 18;

  const draws = letter?.waterfall ?? [];
  const byId = Object.fromEntries(instruments.map((i) => [i.id, i]));
  draws.forEach((d, idx) => {
    if (idx % 2 === 1) doc.rect(M, y, CONTENT_W, 17).fill(NAVY_TINT);
    const inst = byId[d.id] || {};
    const cells = [d.instrument_no ?? '—', d.type ?? '—', inst.issuing_bank ?? '—', money(d.amount)];
    cx = M + 6;
    cols.forEach((c, i) => {
      doc.font('Helvetica').fontSize(8).fillColor(INK)
        .text(String(cells[i]), cx, y + 5, { width: c.w - 8, align: c.align || 'left' });
      cx += c.w;
    });
    y += 17;
  });
  if (!draws.length) {
    doc.font('Helvetica').fontSize(8).fillColor('#5b6b85').text('No instruments were drawn.', M + 6, y + 5);
    y += 17;
  }

  const recovered = draws.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(0.7).strokeColor('#c9d4e6').stroke();
  y += 6;
  for (const [label, value, bold] of [
    ['Amount demanded', letter?.requested, false],
    ['Recovered under this notice', recovered, false],
    // Stated on the letter because it is the part that is not settled by it —
    // the counterparty remains liable for whatever the security did not cover.
    ['Balance remaining due', letter?.shortfall_uncovered, true],
  ]) {
    // Right-aligned to the same edge as the table above. The value box was
    // starting far enough right that only 45pt remained, so every total wrapped
    // mid-figure and read as two numbers.
    const valueW = 120;
    const valueX = M + CONTENT_W - valueW;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(INK)
      .text(label, valueX - 190, y, { width: 185, align: 'right' })
      .text(money(value), valueX, y, { width: valueW, align: 'right' });
    y += 15;
  }
  y += 14;

  if (Number(letter?.shortfall_uncovered) > 0) {
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(
      `The security drawn does not extinguish the liability. ${money(letter.shortfall_uncovered)} `
      + `remains outstanding and is payable forthwith.`,
      M, y, { width: CONTENT_W, align: 'justify' },
    );
    y = doc.y + 14;
  }

  doc.font('Helvetica').fontSize(9).fillColor('#5b6b85').text(
    'Issued under the payment security provisions of the referenced agreement. '
    + 'This is a system-generated notice and is valid without signature.',
    M, y, { width: CONTENT_W, align: 'justify' },
  );
  y = doc.y + 26;

  doc.font('Helvetica').fontSize(9).fillColor(INK).text('For and on behalf of', M, y);
  doc.font('Helvetica-Bold').fontSize(10).text('SJVN Limited', M, y + 14);
  doc.font('Helvetica').fontSize(8).fillColor('#5b6b85').text('Commercial & Billing', M, y + 28);

  return doc;
}

export function generateDemandLetterPdf(payload, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const no = String(payload.invocation?.invocation_no || 'notice').replace(/[^\w.-]+/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="SJVN_Demand_${no}.pdf"`);
  doc.pipe(res);
  buildDemandLetter(doc, payload);
  doc.end();
  return doc;
}
