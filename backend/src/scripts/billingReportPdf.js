/**
 * SJVN Month-wise Billing & Invoicing Report — professional PDF (landscape A4).
 * Built with PDFKit (same stack as invoice PDFs). Not a screenshot — typeset document.
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '../assets/sjvn_logo.png');

// Landscape A4
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const M = 36;
const CONTENT_W = PAGE_W - M * 2;

const NAVY = '#1b3b6f';
const NAVY_SOFT = '#eef2f8';
const NAVY_TINT = '#f6f8fc';
const GREEN = '#0f766e';
const AMBER = '#b45309';
const RED = '#b91c1c';
const INK = '#1a1a1a';
const MUTED = '#64748b';
const CUR = 'Rs.';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmtMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return `${CUR} 0`;
  return `${CUR} ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtMoneyShort(n) {
  const v = Number(n || 0);
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}${CUR} ${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}${CUR} ${(abs / 1e5).toFixed(2)} L`;
  return `${sign}${CUR} ${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function periodLabel(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || '—';
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function periodRangeLabel(from, to) {
  if (!from && !to) return 'All periods';
  if (from && to && from === to) return periodLabel(from);
  return `${periodLabel(from || '…')}  →  ${periodLabel(to || '…')}`;
}

function nowStamp() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
}

function drawRoundedRect(doc, x, y, w, h, r, fill, stroke) {
  doc.save();
  doc.roundedRect(x, y, w, h, r);
  if (fill) { doc.fillColor(fill).fill(); }
  if (stroke) { doc.roundedRect(x, y, w, h, r).strokeColor(stroke).lineWidth(0.6).stroke(); }
  doc.restore();
}

function kpiCard(doc, x, y, w, h, label, value, sub, accent) {
  drawRoundedRect(doc, x, y, w, h, 6, '#ffffff', '#d8dee9');
  // left accent bar
  doc.save();
  doc.rect(x, y, 3.5, h).fill(accent || NAVY);
  doc.restore();

  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
    .text(label.toUpperCase(), x + 12, y + 10, { width: w - 20, lineBreak: false });
  doc.fillColor(accent || INK).font('Helvetica-Bold').fontSize(13)
    .text(value, x + 12, y + 24, { width: w - 20, lineBreak: false });
  if (sub) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7)
      .text(sub, x + 12, y + h - 16, { width: w - 20, lineBreak: false });
  }
}

/**
 * Stream a professional billing summary PDF to `res`.
 * @param {object} report — { from, to, months, totals, month_count }
 * @param {object} meta — { generatedBy }
 * @param {import('http').ServerResponse} res
 */
export function generateBillingReportPdf(report, meta, res) {
  const months = report.months || [];
  const t = report.totals || {};
  const from = report.from;
  const to = report.to;

  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: M, bottom: M, left: M, right: M },
    bufferPages: true,
    info: {
      Title: 'SJVN Billing & Invoicing Report',
      Author: 'SJVN Limited',
      Subject: `Billing summary ${periodRangeLabel(from, to)}`,
      Creator: 'SJVN Energy Platform',
    },
  });

  const filename = `SJVN_Billing_Report_${from || 'all'}_to_${to || 'all'}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  // ── Header band ──────────────────────────────────────
  doc.rect(0, 0, PAGE_W, 72).fill(NAVY);

  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, M, 12, { height: 48, fit: [48, 48] });
    } catch { /* ignore */ }
  }

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16)
    .text('SJVN Limited', M + 60, 16, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#c5d4ea')
    .text('RE Commercial · Billing · Settlement Platform', M + 60, 36, { lineBreak: false });

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14)
    .text('BILLING & INVOICING REPORT', M, 20, { width: CONTENT_W, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#c5d4ea')
    .text(periodRangeLabel(from, to), M, 40, { width: CONTENT_W, align: 'right', lineBreak: false });

  let y = 88;

  // ── Meta strip ───────────────────────────────────────
  drawRoundedRect(doc, M, y, CONTENT_W, 28, 4, NAVY_SOFT, null);
  doc.fillColor(INK).font('Helvetica').fontSize(8);
  doc.text(`Report period: ${periodRangeLabel(from, to)}`, M + 12, y + 9, { lineBreak: false });
  doc.text(`Months covered: ${report.month_count || months.length}`, M + 260, y + 9, { lineBreak: false });
  doc.text(`Generated: ${nowStamp()}`, M + 420, y + 9, { lineBreak: false });
  doc.text(`By: ${meta?.generatedBy || 'System'}`, M + 580, y + 9, { width: 160, lineBreak: false });
  y += 40;

  // ── KPI cards (2 rows × 4) ────────────────────────────
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
    .text('EXECUTIVE SUMMARY', M, y, { lineBreak: false });
  y += 16;

  const cardW = (CONTENT_W - 18) / 4;
  const cardH = 58;
  const gap = 6;

  const kpis = [
    { label: 'Total Sales Billed', value: fmtMoneyShort(t.sales_billed), sub: `${t.sales_count || 0} buyer invoice(s)`, accent: NAVY },
    { label: 'Total Purchases', value: fmtMoneyShort(t.purchase_billed), sub: `${t.purchase_count || 0} developer invoice(s)`, accent: NAVY },
    { label: 'Gross Margin', value: fmtMoneyShort(t.gross_margin), sub: 'Sales − Purchases', accent: (t.gross_margin || 0) >= 0 ? GREEN : RED },
    { label: 'Trading Margin', value: fmtMoneyShort(t.trading_margin), sub: 'SJVN margin on PSAs', accent: GREEN },
    { label: 'Rebate Saved', value: fmtMoneyShort(t.rebate_saved), sub: 'Early-payment rebates', accent: GREEN },
    { label: 'Net Profit', value: fmtMoneyShort(t.net_profit), sub: 'Gross + rebate + LPS net', accent: (t.net_profit || 0) >= 0 ? GREEN : RED },
    { label: 'Collected', value: fmtMoneyShort(t.collected), sub: 'Received from buyers', accent: NAVY },
    { label: 'Outstanding Receivable', value: fmtMoneyShort(t.outstanding_receivable), sub: 'Yet to collect', accent: (t.outstanding_receivable || 0) > 0 ? AMBER : GREEN },
  ];

  kpis.forEach((k, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    const x = M + col * (cardW + gap);
    const cy = y + row * (cardH + gap);
    kpiCard(doc, x, cy, cardW, cardH, k.label, k.value, k.sub, k.accent);
  });
  y += 2 * (cardH + gap) + 14;

  // ── Month-wise table ─────────────────────────────────
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
    .text('MONTH-WISE BREAKUP', M, y, { lineBreak: false });
  y += 14;

  // Column layout — compact landscape table
  const cols = [
    { key: 'billing_period', label: 'Month', w: 72, align: 'left', fmt: (v) => periodLabel(v) },
    { key: 'sales_billed', label: 'Sales Billed', w: 78, align: 'right', fmt: fmtMoney },
    { key: 'purchase_billed', label: 'Purchases', w: 78, align: 'right', fmt: fmtMoney },
    { key: 'gross_margin', label: 'Gross Margin', w: 78, align: 'right', fmt: fmtMoney },
    { key: 'trading_margin', label: 'Trading Margin', w: 78, align: 'right', fmt: fmtMoney },
    { key: 'rebate_saved', label: 'Rebate Saved', w: 70, align: 'right', fmt: fmtMoney },
    { key: 'net_profit', label: 'Net Profit', w: 78, align: 'right', fmt: fmtMoney },
    { key: 'collected', label: 'Collected', w: 72, align: 'right', fmt: fmtMoney },
    { key: 'outstanding_receivable', label: 'Outstanding', w: 78, align: 'right', fmt: fmtMoney },
    { key: 'energy_mwh', label: 'Energy MWh', w: 68, align: 'right', fmt: (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 }) },
  ];
  // Scale columns to fit CONTENT_W
  const rawW = cols.reduce((s, c) => s + c.w, 0);
  const scale = CONTENT_W / rawW;
  cols.forEach((c) => { c.w = Math.floor(c.w * scale); });

  const rowH = 20;
  const headerH = 22;

  function drawTableHeader(yy) {
    doc.rect(M, yy, CONTENT_W, headerH).fill(NAVY);
    let x = M;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
    for (const c of cols) {
      doc.text(c.label, x + 4, yy + 7, { width: c.w - 8, align: c.align, lineBreak: false });
      x += c.w;
    }
    return yy + headerH;
  }

  function drawDataRow(yy, row, opts = {}) {
    const { isTotal = false, zebra = false } = opts;
    if (isTotal) doc.rect(M, yy, CONTENT_W, rowH).fill(NAVY_SOFT);
    else if (zebra) doc.rect(M, yy, CONTENT_W, rowH).fill(NAVY_TINT);

    let x = M;
    doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5)
      .fillColor(isTotal ? NAVY : INK);
    for (const c of cols) {
      let val = row[c.key];
      if (c.key === 'billing_period' && isTotal) val = 'TOTAL';
      const text = isTotal && c.key === 'billing_period' ? 'TOTAL' : (c.fmt ? c.fmt(val) : String(val ?? ''));
      const color = (c.key === 'gross_margin' || c.key === 'net_profit')
        ? ((Number(row[c.key]) || 0) >= 0 ? GREEN : RED)
        : (isTotal ? NAVY : INK);
      doc.fillColor(isTotal && c.key === 'billing_period' ? NAVY : color);
      doc.text(text, x + 4, yy + 6, { width: c.w - 8, align: c.align, lineBreak: false });
      x += c.w;
    }
    // bottom hairline
    doc.moveTo(M, yy + rowH).lineTo(M + CONTENT_W, yy + rowH).strokeColor('#e2e8f0').lineWidth(0.4).stroke();
    return yy + rowH;
  }

  y = drawTableHeader(y);

  if (!months.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text('No invoice data for the selected period.', M + 8, y + 10);
    y += 30;
  } else {
    months.forEach((m, i) => {
      // new page if needed
      if (y + rowH + 40 > PAGE_H - M) {
        doc.addPage();
        y = M;
        // mini header on continuation
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
          .text('BILLING & INVOICING REPORT (continued)', M, y, { lineBreak: false });
        y += 16;
        y = drawTableHeader(y);
      }
      y = drawDataRow(y, m, { zebra: i % 2 === 1 });
    });
    y = drawDataRow(y, t, { isTotal: true });
  }

  y += 18;

  // ── Notes / legend ───────────────────────────────────
  if (y + 70 > PAGE_H - M) {
    doc.addPage();
    y = M;
  }

  drawRoundedRect(doc, M, y, CONTENT_W, 62, 5, NAVY_TINT, '#d8dee9');
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8)
    .text('Notes', M + 12, y + 8, { lineBreak: false });
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5);
  const notes = [
    'Sales Billed = SJVN → Buyer (PSA) invoices  ·  Purchases = Developer → SJVN (PPA) invoices',
    'Gross Margin = Sales − Purchases  ·  Net Profit = Gross Margin + Rebate Saved + LPS Receivable − LPS Payable',
    'Trading Margin is SJVN\'s contractual margin on PSA energy. Outstanding Receivable = Sales Billed − Collected.',
    'This is a system-generated management report. Figures exclude CANCELLED invoices. Amounts in Indian Rupees.',
  ];
  notes.forEach((n, i) => {
    doc.text(n, M + 12, y + 20 + i * 10, { width: CONTENT_W - 24, lineBreak: false });
  });

  // ── Footer on every page ─────────────────────────────
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.moveTo(M, PAGE_H - 22).lineTo(M + CONTENT_W, PAGE_H - 22).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(7)
      .text('SJVN Limited  ·  Confidential — for internal use', M, PAGE_H - 16, { lineBreak: false })
      .text(`Page ${i + 1} of ${pages.count}`, M, PAGE_H - 16, { width: CONTENT_W, align: 'right', lineBreak: false });
  }

  doc.end();
}
