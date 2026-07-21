/**
 * SJVN REIA Dashboard Snapshot Report — landscape A4 PDF.
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '../assets/sjvn_logo.png');

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

function nowStamp() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function drawRoundedRect(doc, x, y, w, h, r, fill, stroke) {
  doc.save();
  doc.roundedRect(x, y, w, h, r);
  if (fill) doc.fillColor(fill).fill();
  if (stroke) doc.roundedRect(x, y, w, h, r).strokeColor(stroke).lineWidth(0.6).stroke();
  doc.restore();
}

function kpiCard(doc, x, y, w, h, label, value, sub, accent) {
  drawRoundedRect(doc, x, y, w, h, 6, '#ffffff', '#d8dee9');
  doc.save();
  doc.rect(x, y, 3.5, h).fill(accent || NAVY);
  doc.restore();
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
    .text(label.toUpperCase(), x + 12, y + 10, { width: w - 20, lineBreak: false });
  doc.fillColor(accent || INK).font('Helvetica-Bold').fontSize(12)
    .text(value, x + 12, y + 24, { width: w - 20, lineBreak: false });
  if (sub) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7)
      .text(sub, x + 12, y + h - 16, { width: w - 20, lineBreak: false });
  }
}

export function generateReiaDashboardPdf(report, meta, res) {
  const k = report.kpis || {};
  const monthly = report.monthlyBilling || [];
  const byProject = report.byProjectType || [];
  const byStatus = report.byStatus || [];

  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: M, bottom: M, left: M, right: M },
    bufferPages: true,
    info: {
      Title: 'SJVN REIA Dashboard Snapshot',
      Author: 'SJVN Limited',
      Subject: 'REIA billing & settlement overview',
      Creator: 'SJVN Energy Platform',
    },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="SJVN_REIA_Dashboard_Snapshot_${nowStamp().replace(/[.: ]/g, '-')}.pdf"`);
  doc.pipe(res);

  doc.rect(0, 0, PAGE_W, 72).fill(NAVY);
  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, M, 12, { height: 48, fit: [48, 48] }); } catch { /* */ }
  }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16)
    .text('SJVN Limited', M + 60, 16, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#c5d4ea')
    .text('RE Commercial · Billing · Settlement Platform', M + 60, 36, { lineBreak: false });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(13)
    .text('REIA DASHBOARD SNAPSHOT', M, 20, { width: CONTENT_W, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#c5d4ea')
    .text('As-of management overview', M, 40, { width: CONTENT_W, align: 'right', lineBreak: false });

  let y = 88;
  drawRoundedRect(doc, M, y, CONTENT_W, 28, 4, NAVY_SOFT, null);
  doc.fillColor(INK).font('Helvetica').fontSize(8);
  doc.text('Scope: Full REIA portfolio', M + 12, y + 9, { lineBreak: false });
  doc.text(`Snapshot at: ${nowStamp()}`, M + 260, y + 9, { lineBreak: false });
  doc.text(`By: ${meta?.generatedBy || 'System'}`, M + 520, y + 9, { width: 220, lineBreak: false });
  y += 40;

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
    .text('PORTFOLIO KPIs', M, y, { lineBreak: false });
  y += 16;

  const cardW = (CONTENT_W - 18) / 4;
  const cardH = 56;
  const gap = 6;
  const kpis = [
    { label: 'Active Contracts', value: String(k.activeContracts || 0), sub: 'Live PPAs / PSAs', accent: GREEN },
    { label: 'Contracted Capacity', value: `${Number(k.contractedCapacity || 0).toLocaleString('en-IN')} MW`, sub: 'Active MW', accent: NAVY },
    { label: 'Energy Supplied', value: `${Number(k.energySupplied || 0).toLocaleString('en-IN')} MWh`, sub: 'All energy records', accent: NAVY },
    { label: 'Invoice Value', value: fmtMoneyShort(k.totalInvoiceValue), sub: `${k.totalInvoices || 0} invoices`, accent: NAVY },
    { label: 'Receivables', value: fmtMoneyShort(k.receivables), sub: 'SJVN → Buyer unpaid', accent: AMBER },
    { label: 'Payables', value: fmtMoneyShort(k.payables), sub: 'Seller → SJVN unpaid', accent: AMBER },
    { label: 'Collected / Paid Out', value: `${fmtMoneyShort(k.paymentsReceived)} / ${fmtMoneyShort(k.paymentsDisbursed)}`, sub: 'Cash movement', accent: GREEN },
    { label: 'Exceptions Watch', value: `${k.pendingDisputes || 0} / ${k.reconciliationExceptions || 0} / ${k.overdue || 0}`, sub: 'Disputes · Recon · Overdue', accent: ((k.pendingDisputes || 0) + (k.reconciliationExceptions || 0) + (k.overdue || 0)) > 0 ? RED : GREEN },
  ];
  kpis.forEach((kItem, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    kpiCard(doc, M + col * (cardW + gap), y + row * (cardH + gap), cardW, cardH, kItem.label, kItem.value, kItem.sub, kItem.accent);
  });
  y += 2 * (cardH + gap) + 12;

  // Secondary strip
  drawRoundedRect(doc, M, y, CONTENT_W, 28, 4, NAVY_TINT, '#d8dee9');
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5);
  doc.text(
    `Pending approvals: ${k.pendingApprovals || 0}   ·   Securities expiring (60d): ${k.expiringSecurities || 0}   ·   Billed energy: ${Number(k.billedEnergy || 0).toLocaleString('en-IN')} MWh`,
    M + 12, y + 10, { width: CONTENT_W - 24, lineBreak: false }
  );
  y += 40;

  // Two columns: tech mix + invoice status
  const half = (CONTENT_W - 12) / 2;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
    .text('ACTIVE CAPACITY BY TECHNOLOGY', M, y, { lineBreak: false })
    .text('INVOICES BY STATUS', M + half + 12, y, { lineBreak: false });
  y += 12;

  const boxH = Math.max(20 + Math.max(byProject.length, byStatus.length, 1) * 14, 40);
  drawRoundedRect(doc, M, y, half, boxH, 4, '#ffffff', '#d8dee9');
  drawRoundedRect(doc, M + half + 12, y, half, boxH, 4, '#ffffff', '#d8dee9');

  if (!byProject.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('No active contracts', M + 10, y + 12);
  } else {
    byProject.forEach((p, i) => {
      doc.fillColor(INK).font('Helvetica').fontSize(8)
        .text(`${p.project_type}`, M + 10, y + 10 + i * 14, { lineBreak: false })
        .text(`${p.contracts} ctr · ${Number(p.capacity).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MW`, M + 10, y + 10 + i * 14, { width: half - 20, align: 'right', lineBreak: false });
    });
  }
  if (!byStatus.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('No invoices', M + half + 22, y + 12);
  } else {
    byStatus.forEach((s, i) => {
      doc.fillColor(INK).font('Helvetica').fontSize(8)
        .text(String(s.status).replace(/_/g, ' '), M + half + 22, y + 10 + i * 14, { lineBreak: false })
        .text(String(s.c), M + half + 22, y + 10 + i * 14, { width: half - 20, align: 'right', lineBreak: false });
    });
  }
  y += boxH + 16;

  // Monthly billing table
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
    .text('MONTHLY BILLING TREND', M, y, { lineBreak: false });
  y += 14;

  const cols = [
    { key: 'billing_period', label: 'Month', w: 120, align: 'left', fmt: periodLabel },
    { key: 'energy', label: 'Energy (MWh)', w: 140, align: 'right', fmt: (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 }) },
    { key: 'total', label: 'Billed Amount', w: 160, align: 'right', fmt: fmtMoney },
  ];
  // stretch
  const rawW = cols.reduce((s, c) => s + c.w, 0);
  const scale = CONTENT_W / rawW;
  cols.forEach((c) => { c.w = Math.floor(c.w * scale); });

  const rowH = 18;
  const headerH = 22;

  function drawHeader(yy) {
    doc.rect(M, yy, CONTENT_W, headerH).fill(NAVY);
    let x = M;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    for (const c of cols) {
      doc.text(c.label, x + 6, yy + 7, { width: c.w - 12, align: c.align, lineBreak: false });
      x += c.w;
    }
    return yy + headerH;
  }

  y = drawHeader(y);
  if (!monthly.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('No billing months yet.', M + 8, y + 10);
    y += 28;
  } else {
    monthly.forEach((m, i) => {
      if (y + rowH + 40 > PAGE_H - M) {
        doc.addPage();
        y = M;
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
          .text('REIA DASHBOARD SNAPSHOT (continued)', M, y, { lineBreak: false });
        y += 16;
        y = drawHeader(y);
      }
      if (i % 2 === 1) doc.rect(M, y, CONTENT_W, rowH).fill(NAVY_TINT);
      let x = M;
      for (const c of cols) {
        const text = c.fmt ? c.fmt(m[c.key]) : String(m[c.key] ?? '');
        doc.font('Helvetica').fontSize(8).fillColor(INK)
          .text(text, x + 6, y + 5, { width: c.w - 12, align: c.align, lineBreak: false });
        x += c.w;
      }
      doc.moveTo(M, y + rowH).lineTo(M + CONTENT_W, y + rowH).strokeColor('#e2e8f0').lineWidth(0.4).stroke();
      y += rowH;
    });
  }

  y += 14;
  if (y + 48 > PAGE_H - M) { doc.addPage(); y = M; }
  drawRoundedRect(doc, M, y, CONTENT_W, 44, 5, NAVY_TINT, '#d8dee9');
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8).text('Notes', M + 12, y + 8, { lineBreak: false });
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5);
  doc.text('Snapshot of live REIA KPIs at generation time. Receivables / payables exclude PAID and CANCELLED invoices.', M + 12, y + 20, { width: CONTENT_W - 24, lineBreak: false });
  doc.text('Exceptions Watch = Open disputes · Recon exceptions · Overdue invoices. Confidential — for internal use.', M + 12, y + 30, { width: CONTENT_W - 24, lineBreak: false });

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
