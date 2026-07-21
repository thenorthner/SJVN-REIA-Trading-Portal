/**
 * SJVN Reconciliation Report — landscape A4 PDF (same brand language as Billing/Energy/Disputes).
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

export function generateReconReportPdf(report, meta, res) {
  const rows = report.rows || [];
  const t = report.totals || {};
  const from = report.from;
  const to = report.to;

  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: M, bottom: M, left: M, right: M },
    bufferPages: true,
    info: {
      Title: 'SJVN Reconciliation Report',
      Author: 'SJVN Limited',
      Subject: `Reconciliation ${periodRangeLabel(from, to)}`,
      Creator: 'SJVN Energy Platform',
    },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="SJVN_Reconciliation_Report_${from || 'all'}_to_${to || 'all'}.pdf"`);
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
    .text('RECONCILIATION REPORT', M, 20, { width: CONTENT_W, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#c5d4ea')
    .text(periodRangeLabel(from, to), M, 40, { width: CONTENT_W, align: 'right', lineBreak: false });

  let y = 88;
  drawRoundedRect(doc, M, y, CONTENT_W, 28, 4, NAVY_SOFT, null);
  doc.fillColor(INK).font('Helvetica').fontSize(8);
  doc.text(`Period: ${periodRangeLabel(from, to)}`, M + 12, y + 9, { lineBreak: false });
  doc.text(`Runs: ${report.row_count || rows.length}`, M + 260, y + 9, { lineBreak: false });
  doc.text(`Generated: ${nowStamp()}`, M + 420, y + 9, { lineBreak: false });
  doc.text(`By: ${meta?.generatedBy || 'System'}`, M + 580, y + 9, { width: 160, lineBreak: false });
  y += 40;

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
    .text('EXECUTIVE SUMMARY', M, y, { lineBreak: false });
  y += 16;

  const cardW = (CONTENT_W - 18) / 4;
  const cardH = 58;
  const gap = 6;
  const avgMatch = Number(t.avg_auto_match_pct || 0);
  const kpis = [
    { label: 'Avg Auto-Match', value: `${avgMatch.toFixed(1)}%`, sub: 'Across recon runs', accent: avgMatch >= 90 ? GREEN : AMBER },
    { label: 'Needs Review', value: String(t.needs_review || 0), sub: 'Exception queues', accent: (t.needs_review || 0) > 0 ? AMBER : GREEN },
    { label: 'Pending Sign-off', value: String(t.pending_signoff || 0), sub: 'Awaiting joint ack', accent: NAVY },
    { label: 'Disputed Recons', value: String(t.disputed || 0), sub: 'Linked to disputes', accent: (t.disputed || 0) > 0 ? RED : GREEN },
    { label: 'Unreconciled ₹', value: fmtMoneyShort(t.unreconciled_amount), sub: 'Open exposure', accent: (t.unreconciled_amount || 0) > 0 ? RED : GREEN },
    { label: 'Exceptions (items)', value: String(t.items_exception || 0), sub: `${t.items_auto_matched || 0} auto-matched`, accent: AMBER },
    { label: 'Agreed / Closed', value: String((t.agreed || 0) + (t.closed || 0)), sub: `${t.agreed || 0} agreed · ${t.closed || 0} closed`, accent: GREEN },
    { label: 'Aging 0–7 / 30+', value: `${t.aging?.['0_7'] || 0} / ${t.aging?.['30_plus'] || 0}`, sub: 'Open recon age', accent: NAVY },
  ];
  kpis.forEach((k, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    kpiCard(doc, M + col * (cardW + gap), y + row * (cardH + gap), cardW, cardH, k.label, k.value, k.sub, k.accent);
  });
  y += 2 * (cardH + gap) + 14;

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
    .text('RECONCILIATION REGISTER', M, y, { lineBreak: false });
  y += 14;

  const cols = [
    { key: 'recon_no', label: 'Recon No', w: 90, align: 'left' },
    { key: 'period', label: 'Period', w: 58, align: 'left', fmt: periodLabel },
    { key: 'contract_no', label: 'Contract / Client', w: 100, align: 'left' },
    { key: 'data_basis', label: 'Basis', w: 52, align: 'left' },
    { key: 'auto_match_pct', label: 'Auto %', w: 48, align: 'right', fmt: (v) => `${Number(v || 0).toFixed(1)}%` },
    { key: 'items_exception', label: 'Exceptions', w: 58, align: 'right' },
    { key: 'unreconciled_amount', label: 'Unreconciled', w: 78, align: 'right', fmt: fmtMoney },
    { key: 'status', label: 'Status', w: 78, align: 'left' },
    { key: 'age_days', label: 'Age', w: 36, align: 'right', fmt: (v) => `${v ?? 0}d` },
    { key: 'signoff', label: 'Sign-off', w: 70, align: 'left' },
  ];
  const scale = CONTENT_W / cols.reduce((s, c) => s + c.w, 0);
  cols.forEach((c) => { c.w = Math.floor(c.w * scale); });

  const rowH = 17;
  const headerH = 22;

  function drawHeader(yy) {
    doc.rect(M, yy, CONTENT_W, headerH).fill(NAVY);
    let x = M;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
    for (const c of cols) {
      doc.text(c.label, x + 3, yy + 7, { width: c.w - 6, align: c.align, lineBreak: false });
      x += c.w;
    }
    return yy + headerH;
  }

  function drawRow(yy, row, zebra) {
    if (zebra) doc.rect(M, yy, CONTENT_W, rowH).fill(NAVY_TINT);
    let x = M;
    for (const c of cols) {
      const raw = row[c.key];
      const text = c.fmt ? c.fmt(raw) : String(raw ?? '—');
      let color = INK;
      if (c.key === 'items_exception' && Number(raw) > 0) color = AMBER;
      if (c.key === 'status' && ['NEEDS_REVIEW', 'DISPUTED', 'REOPENED'].includes(row.status)) color = RED;
      if (c.key === 'status' && ['AGREED', 'CLOSED', 'AUTO_MATCHED'].includes(row.status)) color = GREEN;
      if (c.key === 'auto_match_pct' && Number(row.auto_match_pct) >= 90) color = GREEN;
      doc.font('Helvetica').fontSize(6.5).fillColor(color)
        .text(text, x + 3, yy + 5, { width: c.w - 6, align: c.align, lineBreak: false });
      x += c.w;
    }
    doc.moveTo(M, yy + rowH).lineTo(M + CONTENT_W, yy + rowH).strokeColor('#e2e8f0').lineWidth(0.4).stroke();
    return yy + rowH;
  }

  y = drawHeader(y);
  if (!rows.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text('No reconciliations in the selected period.', M + 8, y + 10);
    y += 28;
  } else {
    rows.forEach((r, i) => {
      if (y + rowH + 50 > PAGE_H - M) {
        doc.addPage();
        y = M;
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
          .text('RECONCILIATION REPORT (continued)', M, y, { lineBreak: false });
        y += 16;
        y = drawHeader(y);
      }
      y = drawRow(y, r, i % 2 === 1);
    });
  }

  y += 14;
  if (y + 55 > PAGE_H - M) { doc.addPage(); y = M; }
  drawRoundedRect(doc, M, y, CONTENT_W, 52, 5, NAVY_TINT, '#d8dee9');
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8).text('Notes', M + 12, y + 8, { lineBreak: false });
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5);
  [
    'Three-way trust: Metered ↔ Billed ↔ Paid. Auto-match % = items within tolerance / total items.',
    'Unreconciled ₹ = residual variance on open / exception runs. Sign-off = SJVN + counterparty acknowledgment.',
    'This is a system-generated management report. Amounts in Indian Rupees.',
  ].forEach((n, i) => doc.text(n, M + 12, y + 20 + i * 10, { width: CONTENT_W - 24, lineBreak: false }));

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
