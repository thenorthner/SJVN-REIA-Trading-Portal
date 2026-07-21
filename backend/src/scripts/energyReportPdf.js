/**
 * SJVN Energy Data & Validation Report — professional PDF (landscape A4).
 * Same visual language as the Billing & Invoicing report.
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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmtMwh(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })} MWh`;
}

function fmtMwhShort(n) {
  if (n == null || Number.isNaN(Number(n))) return '0';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 });
}

function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toFixed(1)}%`;
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

/**
 * @param {object} report — buildEnergySummary() result
 * @param {object} meta — { generatedBy }
 * @param {import('http').ServerResponse} res
 */
export function generateEnergyReportPdf(report, meta, res) {
  const rows = report.rows || [];
  const t = report.totals || {};
  const from = report.from;
  const to = report.to;

  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: M, bottom: M, left: M, right: M },
    bufferPages: true,
    info: {
      Title: 'SJVN Energy Data & Validation Report',
      Author: 'SJVN Limited',
      Subject: `Energy summary ${periodRangeLabel(from, to)}`,
      Creator: 'SJVN Energy Platform',
    },
  });

  const filename = `SJVN_Energy_Report_${from || 'all'}_to_${to || 'all'}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  // Header
  doc.rect(0, 0, PAGE_W, 72).fill(NAVY);
  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, M, 12, { height: 48, fit: [48, 48] }); } catch { /* ignore */ }
  }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16)
    .text('SJVN Limited', M + 60, 16, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#c5d4ea')
    .text('RE Commercial · Billing · Settlement Platform', M + 60, 36, { lineBreak: false });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(13)
    .text('ENERGY DATA & VALIDATION REPORT', M, 20, { width: CONTENT_W, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#c5d4ea')
    .text(periodRangeLabel(from, to), M, 40, { width: CONTENT_W, align: 'right', lineBreak: false });

  let y = 88;

  drawRoundedRect(doc, M, y, CONTENT_W, 28, 4, NAVY_SOFT, null);
  doc.fillColor(INK).font('Helvetica').fontSize(8);
  doc.text(`Report period: ${periodRangeLabel(from, to)}`, M + 12, y + 9, { lineBreak: false });
  doc.text(`Contract-periods: ${report.row_count || rows.length}`, M + 260, y + 9, { lineBreak: false });
  doc.text(`Generated: ${nowStamp()}`, M + 420, y + 9, { lineBreak: false });
  doc.text(`By: ${meta?.generatedBy || 'System'}`, M + 580, y + 9, { width: 160, lineBreak: false });
  y += 40;

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
    .text('EXECUTIVE SUMMARY', M, y, { lineBreak: false });
  y += 16;

  const cardW = (CONTENT_W - 18) / 4;
  const cardH = 58;
  const gap = 6;

  const deltaTone = (t.delta_mwh || 0) === 0 ? NAVY : ((t.delta_mwh || 0) > 0 ? GREEN : RED);
  const kpis = [
    { label: 'Provisional Energy', value: fmtMwhShort(t.provisional_mwh), sub: `${t.provisional_count || 0} record(s)`, accent: NAVY },
    { label: 'Final Energy', value: fmtMwhShort(t.final_mwh), sub: `${t.final_count || 0} record(s)`, accent: NAVY },
    { label: 'Δ Energy (Final − Prov)', value: fmtMwhShort(t.delta_mwh), sub: 'True-up volume', accent: deltaTone },
    { label: 'Avg CUF', value: t.avg_cuf != null ? fmtPct(t.avg_cuf) : '—', sub: 'Where available', accent: GREEN },
    { label: 'Locked', value: String(t.locked || 0), sub: 'Ready for billing', accent: GREEN },
    { label: 'Validated', value: String(t.validated || 0), sub: 'Awaiting lock', accent: NAVY },
    { label: 'Draft / Open', value: String((t.draft || 0) + (t.disputed || 0)), sub: `${t.draft || 0} draft · ${t.disputed || 0} disputed`, accent: AMBER },
    { label: 'Awaiting Final', value: String(t.awaiting_final || 0), sub: 'Prov only — CERC pending', accent: (t.awaiting_final || 0) > 0 ? AMBER : GREEN },
  ];

  kpis.forEach((k, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    const x = M + col * (cardW + gap);
    const cy = y + row * (cardH + gap);
    kpiCard(doc, x, cy, cardW, cardH, k.label, k.value, k.sub, k.accent);
  });
  y += 2 * (cardH + gap) + 14;

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
    .text('PERIOD × CONTRACT BREAKUP', M, y, { lineBreak: false });
  y += 14;

  const cols = [
    { key: 'period_month', label: 'Period', w: 70, align: 'left', fmt: periodLabel },
    { key: 'contract_no', label: 'Contract', w: 110, align: 'left', fmt: (v) => v || '—' },
    { key: 'project_type', label: 'Tech', w: 48, align: 'left', fmt: (v) => v || '—' },
    { key: 'provisional_mwh', label: 'Provisional', w: 72, align: 'right', fmt: fmtMwhShort },
    { key: 'final_mwh', label: 'Final', w: 72, align: 'right', fmt: (v) => (v == null ? '—' : fmtMwhShort(v)) },
    { key: 'delta_mwh', label: 'Δ MWh', w: 62, align: 'right', fmt: (v) => (v == null ? '—' : fmtMwhShort(v)) },
    { key: 'cuf_percent', label: 'CUF %', w: 48, align: 'right', fmt: (v) => (v == null ? '—' : Number(v).toFixed(1)) },
    { key: 'availability_percent', label: 'Avail %', w: 48, align: 'right', fmt: (v) => (v == null ? '—' : Number(v).toFixed(1)) },
    { key: 'source', label: 'Source', w: 48, align: 'left', fmt: (v) => v || '—' },
    { key: 'status_label', label: 'Status', w: 70, align: 'left', fmt: (v) => v || '—' },
    { key: 'billing_family_ref', label: 'BFR', w: 120, align: 'left', fmt: (v) => (v ? String(v).replace(/^BFR\//, '') : '—') },
  ];
  const rawW = cols.reduce((s, c) => s + c.w, 0);
  const scale = CONTENT_W / rawW;
  cols.forEach((c) => { c.w = Math.floor(c.w * scale); });

  const rowH = 18;
  const headerH = 22;

  function drawTableHeader(yy) {
    doc.rect(M, yy, CONTENT_W, headerH).fill(NAVY);
    let x = M;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
    for (const c of cols) {
      doc.text(c.label, x + 3, yy + 7, { width: c.w - 6, align: c.align, lineBreak: false });
      x += c.w;
    }
    return yy + headerH;
  }

  function drawDataRow(yy, row, opts = {}) {
    const { isTotal = false, zebra = false } = opts;
    if (isTotal) doc.rect(M, yy, CONTENT_W, rowH).fill(NAVY_SOFT);
    else if (zebra) doc.rect(M, yy, CONTENT_W, rowH).fill(NAVY_TINT);

    let x = M;
    for (const c of cols) {
      let text;
      if (isTotal && c.key === 'period_month') text = 'TOTAL';
      else if (isTotal && ['contract_no', 'project_type', 'source', 'status_label', 'billing_family_ref'].includes(c.key)) text = '';
      else text = c.fmt ? c.fmt(row[c.key]) : String(row[c.key] ?? '');

      let color = isTotal ? NAVY : INK;
      if (c.key === 'delta_mwh' && row.delta_mwh != null) {
        color = row.delta_mwh > 0 ? GREEN : (row.delta_mwh < 0 ? RED : INK);
      }
      doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(7).fillColor(color)
        .text(text, x + 3, yy + 5, { width: c.w - 6, align: c.align, lineBreak: false });
      x += c.w;
    }
    doc.moveTo(M, yy + rowH).lineTo(M + CONTENT_W, yy + rowH).strokeColor('#e2e8f0').lineWidth(0.4).stroke();
    return yy + rowH;
  }

  y = drawTableHeader(y);

  if (!rows.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text('No energy data for the selected period.', M + 8, y + 10);
    y += 30;
  } else {
    rows.forEach((r, i) => {
      if (y + rowH + 40 > PAGE_H - M) {
        doc.addPage();
        y = M;
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
          .text('ENERGY DATA & VALIDATION REPORT (continued)', M, y, { lineBreak: false });
        y += 16;
        y = drawTableHeader(y);
      }
      y = drawDataRow(y, r, { zebra: i % 2 === 1 });
    });
    y = drawDataRow(y, {
      provisional_mwh: t.provisional_mwh,
      final_mwh: t.final_mwh,
      delta_mwh: t.delta_mwh,
      cuf_percent: t.avg_cuf,
      availability_percent: t.avg_availability,
    }, { isTotal: true });
  }

  y += 16;
  if (y + 70 > PAGE_H - M) {
    doc.addPage();
    y = M;
  }

  drawRoundedRect(doc, M, y, CONTENT_W, 62, 5, NAVY_TINT, '#d8dee9');
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8)
    .text('Notes', M + 12, y + 8, { lineBreak: false });
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5);
  const notes = [
    'Provisional = REA/metered preliminary energy  ·  Final = CERC/REA final for the same contract-period (linked via BFR).',
    'Δ MWh = Final − Provisional. Positive Δ means upward true-up; negative means downward adjustment.',
    'Status reflects the latest applicable row (prefer Final when present). Locked records are billing-ready.',
    'Awaiting Final = contract-periods with Provisional only. This is a system-generated management report.',
  ];
  notes.forEach((n, i) => {
    doc.text(n, M + 12, y + 20 + i * 10, { width: CONTENT_W - 24, lineBreak: false });
  });

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
