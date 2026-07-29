/**
 * SJVN NOAR Open-Access Approval Report — portrait A4 PDF.
 * Same brand language as the Billing / Energy / Reconciliation reports.
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '../assets/sjvn_logo.png');

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 36;
const CONTENT_W = PAGE_W - M * 2;

const NAVY = '#1b3b6f';
const NAVY_SOFT = '#eef2f8';
const GREEN = '#0f766e';
const AMBER = '#b45309';
const RED = '#b91c1c';
const INK = '#1a1a1a';
const MUTED = '#64748b';

const STATE_LABEL = {
  ON_TRACK: 'On track', AT_RISK: 'At risk', BREACHED: 'Overdue',
  MET: 'Met', MISSED: 'Missed', REJECTED: 'Rejected', NOT_APPLICABLE: 'Not submitted',
};
const STATE_COLOUR = {
  ON_TRACK: GREEN, MET: GREEN, AT_RISK: AMBER, BREACHED: RED, MISSED: RED, REJECTED: AMBER, NOT_APPLICABLE: MUTED,
};

function drawRoundedRect(doc, x, y, w, h, r, fill, stroke) {
  doc.roundedRect(x, y, w, h, r);
  if (fill) doc.fillColor(fill).fill();
  if (stroke) doc.strokeColor(stroke).lineWidth(0.5).stroke();
}

/** Header band, repeated on every page so a detached sheet still identifies itself. */
function drawHeader(doc, generatedAt) {
  doc.rect(0, 0, PAGE_W, 66).fill(NAVY);
  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, M, 10, { height: 44, fit: [44, 44] }); } catch { /* logo is optional */ }
  }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14)
    .text('SJVN Limited', M + 54, 14, { lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor('#c5d4ea')
    .text('Power Trading · Open Access', M + 54, 32, { lineBreak: false });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11)
    .text('NOAR APPROVAL REPORT', M, 18, { width: CONTENT_W, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor('#c5d4ea')
    .text(`Generated ${generatedAt}`, M, 34, { width: CONTENT_W, align: 'right', lineBreak: false });
}

function drawTable(doc, startY, cols, rows, opts = {}) {
  const rowH = opts.rowH ?? 16;
  let y = startY;

  const head = () => {
    drawRoundedRect(doc, M, y, CONTENT_W, rowH, 2, NAVY_SOFT, null);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(7.5);
    let x = M + 6;
    cols.forEach((c) => {
      doc.text(c.label, x, y + 5, { width: c.w - 8, align: c.align || 'left', lineBreak: false });
      x += c.w;
    });
    y += rowH;
  };
  head();

  doc.font('Helvetica').fontSize(7.5);
  for (const r of rows) {
    // Break before drawing, never mid-row, so no row is split across pages.
    if (y + rowH > PAGE_H - M - 16) {
      doc.addPage();
      drawHeader(doc, opts.generatedAt || '');
      y = 84;
      head();
      doc.font('Helvetica').fontSize(7.5);
    }
    let x = M + 6;
    cols.forEach((c) => {
      const raw = c.value(r);
      doc.fillColor(c.colour ? c.colour(r) : INK);
      doc.text(raw === null || raw === undefined ? '—' : String(raw), x, y + 4.5, {
        width: c.w - 8, align: c.align || 'left', lineBreak: false, ellipsis: true,
      });
      x += c.w;
    });
    doc.moveTo(M, y + rowH).lineTo(M + CONTENT_W, y + rowH).strokeColor('#e8edf5').lineWidth(0.5).stroke();
    y += rowH;
  }
  return y;
}

/**
 * @param {object} summary  payload from GET /bilateral/noar-sla
 * @param {Array}  decided  recently decided applications with turnaround
 */
export function generateNoarApprovalReportPdf(summary, decided, res) {
  const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: M, bottom: M, left: M, right: M },
    bufferPages: true,
    info: {
      Title: 'SJVN NOAR Approval Report',
      Author: 'SJVN Limited',
      Subject: 'Open-access approval tracking and SLA performance',
      Creator: 'SJVN Energy Platform',
    },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="SJVN_NOAR_Approval_Report_${new Date().toISOString().slice(0, 10)}.pdf"`);
  doc.pipe(res);

  drawHeader(doc, generatedAt);
  let y = 84;

  // ── KPI band ────────────────────────────────────────────────
  const c = summary.counts || {};
  const kpis = [
    { label: 'Pending approvals', value: String(summary.pending_total ?? 0) },
    { label: 'On-time rate', value: summary.on_time_rate_pct === null ? '—' : `${summary.on_time_rate_pct}%` },
    { label: 'Avg approval time', value: summary.avg_approval_days === null ? '—' : `${summary.avg_approval_days} d` },
    { label: 'Needs attention', value: String((summary.needs_attention || []).length) },
  ];
  const kw = CONTENT_W / kpis.length;
  drawRoundedRect(doc, M, y, CONTENT_W, 44, 4, NAVY_SOFT, null);
  kpis.forEach((k, i) => {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7)
      .text(k.label, M + 10 + i * kw, y + 8, { width: kw - 16, lineBreak: false });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15)
      .text(k.value, M + 10 + i * kw, y + 20, { width: kw - 16, lineBreak: false });
  });
  y += 56;

  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(
    `Targets — ${Object.entries(summary.targets || {}).map(([k, v]) => `${k} ${v}d`).join(' · ')}`
    + `. Measured from submission to NLDC approval; warning raised at ${Math.round((summary.warning_fraction ?? 0.7) * 100)}% of target.`,
    M, y, { width: CONTENT_W },
  );
  y += 22;

  // ── State distribution ──────────────────────────────────────
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Approval status distribution', M, y);
  y += 16;
  const stateRows = Object.keys(STATE_LABEL).filter((k) => (c[k] ?? 0) > 0).map((k) => ({ key: k, n: c[k] }));
  const total = stateRows.reduce((s, r) => s + r.n, 0) || 1;
  y = drawTable(doc, y, [
    { label: 'Status', w: 190, value: (r) => STATE_LABEL[r.key], colour: (r) => STATE_COLOUR[r.key] },
    { label: 'Count', w: 80, align: 'right', value: (r) => r.n },
    { label: 'Share', w: 80, align: 'right', value: (r) => `${Math.round((r.n / total) * 1000) / 10}%` },
  ], stateRows, { generatedAt });
  y += 20;

  // ── Needs attention ─────────────────────────────────────────
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Needs attention', M, y);
  y += 16;
  const attention = summary.needs_attention || [];
  if (!attention.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text('No overdue, at-risk or rejected applications.', M, y);
    y += 20;
  } else {
    y = drawTable(doc, y, [
      { label: 'Counterparty', w: 150, value: (r) => r.counterparty },
      { label: 'Contract', w: 95, value: (r) => r.noar_contract_no || r.id },
      { label: 'Term', w: 40, value: (r) => r.oa_type },
      { label: 'Status', w: 60, value: (r) => STATE_LABEL[r.state], colour: (r) => STATE_COLOUR[r.state] },
      { label: 'Elapsed', w: 55, align: 'right', value: (r) => `${r.elapsed_days}d` },
      { label: 'Target', w: 45, align: 'right', value: (r) => `${r.target_days}d` },
      { label: 'Reason', w: 78, value: (r) => r.rejection_reason || '' },
    ], attention, { generatedAt });
    y += 20;
  }

  // ── Decided applications ────────────────────────────────────
  if (y > PAGE_H - M - 120) { doc.addPage(); drawHeader(doc, generatedAt); y = 84; }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Decided applications', M, y);
  y += 16;
  if (!decided.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('No approvals decided yet.', M, y);
  } else {
    drawTable(doc, y, [
      { label: 'Counterparty', w: 160, value: (r) => r.counterparty },
      { label: 'Contract', w: 100, value: (r) => r.noar_contract_no || r.id },
      { label: 'Term', w: 45, value: (r) => r.oa_type },
      { label: 'Submitted', w: 85, value: (r) => (r.submitted_at || '').slice(0, 10) },
      { label: 'Decided', w: 85, value: (r) => (r.decided_at || '').slice(0, 10) },
      { label: 'Took', w: 48, align: 'right', value: (r) => `${r.elapsed_days}d`, colour: (r) => STATE_COLOUR[r.state] },
    ], decided, { generatedAt });
  }

  // Page numbers last, once the total is known.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.fillColor(MUTED).font('Helvetica').fontSize(7)
      .text(`Page ${i + 1} of ${range.count}`, M, PAGE_H - M + 6, { width: CONTENT_W, align: 'right', lineBreak: false });
  }

  doc.end();
}
