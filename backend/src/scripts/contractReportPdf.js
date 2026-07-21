/**
 * SJVN Contract Portfolio Report — landscape A4 PDF.
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

function fmtMoneyShort(n) {
  const v = Number(n || 0);
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}${CUR} ${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}${CUR} ${(abs / 1e5).toFixed(2)} L`;
  return `${sign}${CUR} ${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtMw(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MW`;
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
  doc.fillColor(accent || INK).font('Helvetica-Bold').fontSize(13)
    .text(value, x + 12, y + 24, { width: w - 20, lineBreak: false });
  if (sub) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7)
      .text(sub, x + 12, y + h - 16, { width: w - 20, lineBreak: false });
  }
}

export function generateContractReportPdf(report, meta, res) {
  const rows = report.rows || [];
  const t = report.totals || {};

  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: M, bottom: M, left: M, right: M },
    bufferPages: true,
    info: {
      Title: 'SJVN Contract Portfolio Report',
      Author: 'SJVN Limited',
      Subject: 'PPA / PSA contract register',
      Creator: 'SJVN Energy Platform',
    },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="SJVN_Contract_Portfolio_Report.pdf"');
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
    .text('CONTRACT PORTFOLIO REPORT', M, 20, { width: CONTENT_W, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#c5d4ea')
    .text('PPA / PSA Lifecycle', M, 40, { width: CONTENT_W, align: 'right', lineBreak: false });

  let y = 88;
  drawRoundedRect(doc, M, y, CONTENT_W, 28, 4, NAVY_SOFT, null);
  doc.fillColor(INK).font('Helvetica').fontSize(8);
  doc.text(`Contracts listed: ${report.row_count || rows.length}`, M + 12, y + 9, { lineBreak: false });
  doc.text(`Filter: ${report.filter_label || 'All'}`, M + 220, y + 9, { lineBreak: false });
  doc.text(`Generated: ${nowStamp()}`, M + 420, y + 9, { lineBreak: false });
  doc.text(`By: ${meta?.generatedBy || 'System'}`, M + 580, y + 9, { width: 160, lineBreak: false });
  y += 40;

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
    .text('EXECUTIVE SUMMARY', M, y, { lineBreak: false });
  y += 16;

  const cardW = (CONTENT_W - 18) / 4;
  const cardH = 58;
  const gap = 6;
  const kpis = [
    { label: 'Active Contracts', value: String(t.active || 0), sub: `${t.ppa_active || 0} PPA · ${t.psa_active || 0} PSA`, accent: GREEN },
    { label: 'Contracted Capacity', value: fmtMw(t.active_capacity_mw), sub: 'Active portfolio MW', accent: NAVY },
    { label: 'Commissioned (COD)', value: fmtMw(t.commissioned_mw), sub: 'COD capacity', accent: GREEN },
    { label: 'PBG / Security Cover', value: fmtMoneyShort(t.pbg_total), sub: 'Sum of PBG amounts', accent: NAVY },
    { label: 'Nearing Expiry', value: String(t.nearing_expiry || 0), sub: 'Within watch window', accent: (t.nearing_expiry || 0) > 0 ? AMBER : GREEN },
    { label: 'Under Negotiation', value: String(t.pipeline || 0), sub: 'Draft / signed / pending', accent: AMBER },
    { label: 'Terminated / Expired', value: String((t.terminated || 0) + (t.expired || 0)), sub: `${t.terminated || 0} term · ${t.expired || 0} exp`, accent: RED },
    { label: 'Technologies', value: String(t.tech_count || 0), sub: t.tech_list || '—', accent: NAVY },
  ];
  kpis.forEach((k, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    kpiCard(doc, M + col * (cardW + gap), y + row * (cardH + gap), cardW, cardH, k.label, k.value, k.sub, k.accent);
  });
  y += 2 * (cardH + gap) + 14;

  if (report.by_project_type?.length) {
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
      .text('CAPACITY BY TECHNOLOGY', M, y, { lineBreak: false });
    y += 12;
    drawRoundedRect(doc, M, y, CONTENT_W, 28, 4, NAVY_TINT, '#d8dee9');
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5);
    const bits = report.by_project_type.map((p) =>
      `${p.project_type}: ${p.contracts} contracts · ${Number(p.capacity).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MW`
    );
    doc.text(bits.join('   ·   '), M + 10, y + 10, { width: CONTENT_W - 20, lineBreak: false });
    y += 36;
  }

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
    .text('CONTRACT REGISTER', M, y, { lineBreak: false });
  y += 14;

  const cols = [
    { key: 'contract_no', label: 'Contract No', w: 100, align: 'left' },
    { key: 'contract_type', label: 'Type', w: 40, align: 'left' },
    { key: 'party', label: 'Counterparty', w: 110, align: 'left' },
    { key: 'project_type', label: 'Tech', w: 48, align: 'left' },
    { key: 'capacity_mw', label: 'Capacity', w: 55, align: 'right', fmt: (v) => Number(v || 0).toFixed(1) },
    { key: 'commissioned_capacity_mw', label: 'COD MW', w: 50, align: 'right', fmt: (v) => Number(v || 0).toFixed(1) },
    { key: 'tariff_per_unit', label: 'Tariff', w: 48, align: 'right', fmt: (v) => `Rs.${Number(v || 0).toFixed(2)}` },
    { key: 'tenure', label: 'Tenure', w: 90, align: 'left' },
    { key: 'pbg_amount', label: 'PBG', w: 70, align: 'right', fmt: (v) => v ? fmtMoneyShort(v) : '—' },
    { key: 'status', label: 'Status', w: 70, align: 'left' },
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
      if (c.key === 'status' && row.status === 'ACTIVE') color = GREEN;
      if (c.key === 'status' && ['TERMINATED', 'EXPIRED'].includes(row.status)) color = RED;
      if (c.key === 'status' && row.status === 'NEARING_EXPIRY') color = AMBER;
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
      .text('No contracts match the selected filters.', M + 8, y + 10);
    y += 28;
  } else {
    rows.forEach((r, i) => {
      if (y + rowH + 50 > PAGE_H - M) {
        doc.addPage();
        y = M;
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
          .text('CONTRACT PORTFOLIO REPORT (continued)', M, y, { lineBreak: false });
        y += 16;
        y = drawHeader(y);
      }
      y = drawRow(y, r, i % 2 === 1);
    });
  }

  y += 14;
  if (y + 50 > PAGE_H - M) { doc.addPage(); y = M; }
  drawRoundedRect(doc, M, y, CONTENT_W, 48, 5, NAVY_TINT, '#d8dee9');
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8).text('Notes', M + 12, y + 8, { lineBreak: false });
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5);
  [
    'Capacity = contracted MW. COD MW = commissioned capacity. Tariff shown as Rs./unit (₹/kWh).',
    'Pipeline = DRAFT / UNDER_NEGOTIATION / SIGNED / PENDING_REGULATORY_APPROVAL. This is a system-generated management report.',
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
