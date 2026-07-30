/**
 * Shared layout primitives for the platform's PDF reports.
 *
 * Every report uses the same page geometry, brand colours, header band, KPI
 * strip and table renderer, so they read as one family. Extracted rather than
 * copied per report — a layout fix should land once.
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOGO_PATH = path.join(__dirname, '../assets/sjvn_logo.png');

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const M = 36;
export const CONTENT_W = PAGE_W - M * 2;

export const NAVY = '#1b3b6f';
export const NAVY_SOFT = '#eef2f8';
export const GREEN = '#0f766e';
export const AMBER = '#b45309';
export const RED = '#b91c1c';
export const INK = '#1a1a1a';
export const MUTED = '#64748b';

/** Indian-notation rupees, abbreviated to lakh/crore once it gets long. */
export const rs = (n) => {
  const v = Number(n || 0);
  const a = Math.abs(v);
  if (a >= 1e7) return `Rs ${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `Rs ${(v / 1e5).toFixed(2)} L`;
  return `Rs ${Math.round(v).toLocaleString('en-IN')}`;
};

export const signed = (n) => (Number(n) > 0 ? `+${n}` : String(n));

/** SQLite writes UTC without a zone marker; render it in local time. */
export const stamp = (s) => {
  if (!s) return '—';
  const d = new Date(`${String(s).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
};

export const nowLabel = () => new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export function roundedRect(doc, x, y, w, h, r, fill) {
  doc.roundedRect(x, y, w, h, r);
  if (fill) doc.fillColor(fill).fill();
}

/**
 * Header band. Repeated on every page so a detached sheet still identifies
 * itself and the period it covers.
 */
export function header(doc, { vertical, title, subtitle, generatedAt }) {
  doc.rect(0, 0, PAGE_W, 66).fill(NAVY);
  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, M, 10, { height: 44, fit: [44, 44] }); } catch { /* logo optional */ }
  }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14).text('SJVN Limited', M + 54, 14, { lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor('#c5d4ea').text(vertical, M + 54, 32, { lineBreak: false });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text(title, M, 14, { width: CONTENT_W, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor('#c5d4ea').text(subtitle, M, 30, { width: CONTENT_W, align: 'right', lineBreak: false });
  doc.fontSize(7).text(`Generated ${generatedAt}`, M, 44, { width: CONTENT_W, align: 'right', lineBreak: false });
}

export function kpiBand(doc, y, items) {
  const w = CONTENT_W / items.length;
  roundedRect(doc, M, y, CONTENT_W, 44, 4, NAVY_SOFT);
  items.forEach((k, i) => {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(k.label, M + 10 + i * w, y + 8, { width: w - 16, lineBreak: false });
    doc.fillColor(k.tone || NAVY).font('Helvetica-Bold').fontSize(13).text(k.value, M + 10 + i * w, y + 20, { width: w - 16, lineBreak: false });
  });
  return y + 56;
}

export function sectionTitle(doc, y, text, note) {
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(text, M, y);
  if (note) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(note, M, y + 13, { width: CONTENT_W });
    return y + 26;
  }
  return y + 16;
}

/**
 * Table renderer. `ctx` carries the header fields so a page break can redraw
 * the band and the column heads.
 */
export function table(doc, startY, cols, rows, ctx, opts = {}) {
  const rowH = opts.rowH ?? 15;
  const fontSize = opts.fontSize ?? 7;
  let y = startY;

  const head = () => {
    roundedRect(doc, M, y, CONTENT_W, rowH, 2, NAVY_SOFT);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(fontSize);
    let x = M + 6;
    cols.forEach((c) => { doc.text(c.label, x, y + 4.5, { width: c.w - 8, align: c.align || 'left', lineBreak: false }); x += c.w; });
    y += rowH;
  };
  head();

  doc.font('Helvetica').fontSize(fontSize);
  if (!rows.length) {
    doc.fillColor(MUTED).text(opts.emptyMessage || 'No records.', M + 6, y + 4, { width: CONTENT_W - 12, lineBreak: false });
    return y + rowH;
  }
  for (const r of rows) {
    // Break before a row, never through one.
    if (y + rowH > PAGE_H - M - 14) {
      doc.addPage();
      header(doc, ctx);
      y = 84; head();
      doc.font('Helvetica').fontSize(fontSize);
    }
    let x = M + 6;
    cols.forEach((c) => {
      const v = c.value(r);
      doc.fillColor(c.colour ? c.colour(r) : INK);
      doc.text(v === null || v === undefined || v === '' ? '—' : String(v), x, y + 4, {
        width: c.w - 8, align: c.align || 'left', lineBreak: false, ellipsis: true,
      });
      x += c.w;
    });
    doc.moveTo(M, y + rowH).lineTo(M + CONTENT_W, y + rowH).strokeColor('#e8edf5').lineWidth(0.5).stroke();
    y += rowH;
  }
  return y;
}

/** Bulleted notes — used for stating a report's basis and exclusions. */
export function notes(doc, y, lines) {
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5);
  let cur = y;
  for (const line of lines) {
    doc.text(`•  ${line}`, M, cur, { width: CONTENT_W });
    cur = doc.y + 3;
  }
  return cur;
}

/** Start a fresh page when the remaining space cannot hold a section. */
export function ensureSpace(doc, y, needed, ctx) {
  if (y > PAGE_H - M - needed) {
    doc.addPage();
    header(doc, ctx);
    return 84;
  }
  return y;
}

/** Page numbers, written last so the total is known. */
export function pageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.fillColor(MUTED).font('Helvetica').fontSize(7)
      .text(`Page ${i + 1} of ${range.count}`, M, PAGE_H - M + 6, { width: CONTENT_W, align: 'right', lineBreak: false });
  }
}

export function newDoc(res, docTitle, filename) {
  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: M, bottom: M, left: M, right: M },
    bufferPages: true,
    info: { Title: docTitle, Author: 'SJVN Limited', Creator: 'SJVN Energy Platform' },
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  return doc;
}
