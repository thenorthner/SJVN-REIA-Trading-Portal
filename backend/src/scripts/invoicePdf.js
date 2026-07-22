import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { invoiceVerifyToken, PUBLIC_BASE_URL } from '../util.js';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 46;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const HSN_CODE = '27160000';
// PDFKit's built-in Helvetica has no ₹ (U+20B9) glyph, so it renders as a
// broken character. Use "Rs." for portability. To switch to the literal ₹,
// embed a Unicode TTF (e.g. Noto Sans) and set CUR = '₹'.
const CUR = 'Rs.';

// ── Brand palette (deep royal blue theme) ─────────────
const NAVY = '#1b3b6f';       // headings, borders, table header band
const NAVY_SOFT = '#eef2f8';   // section band fill
const NAVY_TINT = '#f6f8fc';   // subtle zebra / totals fill
const INK = '#1a1a1a';         // body text
const SEAL = '#22447e';        // round seal + signature accent

const SJVN_FALLBACK = {
  name: 'SJVN Limited',
  address: 'Corporate Headquarters, Shakti Sadan, Shanan, Shimla, HP, 171006',
  cin: '',
  gst_no: '',
  pan_no: '',
  tan_no: '',
  corporate_email: 'finance@sjvn.co.in',
  corporate_phone: '',
  corporate_website: 'www.sjvn.nic.in',
};

function blank(v) {
  if (v == null || v === '' || v === undefined) return '';
  return String(v);
}

function fmtMoney(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(n, digits = 2) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) {
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    return String(d);
  }
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function periodLabel(billingPeriod) {
  if (!billingPeriod || !/^\d{4}-\d{2}$/.test(billingPeriod)) return blank(billingPeriod);
  const [y, m] = billingPeriod.split('-').map(Number);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const start = `01.${String(m).padStart(2, '0')}.${y}`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${String(lastDay).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
  return `${monthNames[m - 1]} ${y} / ${start} to ${end}`;
}

function periodRange(billingPeriod) {
  if (!billingPeriod || !/^\d{4}-\d{2}$/.test(billingPeriod)) return blank(billingPeriod);
  const [y, m] = billingPeriod.split('-').map(Number);
  const start = `01.${String(m).padStart(2, '0')}.${y}`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${String(lastDay).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
  return `${start} to ${end}`;
}

function drawHLine(doc, y, x = MARGIN, w = CONTENT_WIDTH, color = NAVY) {
  doc.save().lineWidth(0.7).strokeColor(color).moveTo(x, y).lineTo(x + w, y).stroke().restore();
}

function drawVLine(doc, x, y1, y2, color = NAVY) {
  doc.save().lineWidth(0.7).strokeColor(color).moveTo(x, y1).lineTo(x, y2).stroke().restore();
}

function resetCursor(doc, y) {
  doc.x = MARGIN;
  doc.y = y;
  doc.font('Helvetica').fontSize(9).fillColor(INK);
}

/** Cell text with optional colour. */
function cellText(doc, text, x, y, w, h, { bold = false, size = 8, align = 'left', valign = 'top', pad = 3, color = INK } = {}) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
  const opts = { width: w - pad * 2, align };
  if (valign === 'center') {
    const hEst = doc.heightOfString(String(text || ''), opts);
    const ty = y + Math.max(pad, (h - hEst) / 2);
    doc.text(String(text || ''), x + pad, ty, { ...opts, lineBreak: true, height: h - pad });
  } else {
    doc.text(String(text || ''), x + pad, y + pad, { ...opts, lineBreak: true, height: h - pad * 2 });
  }
}

/** A small floral medallion (concentric petals). */
function drawFlower(doc, cx, cy, color = NAVY) {
  doc.save();
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    doc.circle(cx + 4.6 * Math.cos(a), cy + 4.6 * Math.sin(a), 2.1).fill(color);
  }
  doc.circle(cx, cy, 2.6).fillAndStroke('#ffffff', color);
  doc.restore();
}

/** One ornamental corner drawn in local +x/+y quadrant (origin at frame corner). */
function drawCornerMotif(doc) {
  doc.save();
  doc.lineWidth(1).strokeColor(NAVY);
  doc.path('M 8 60 C 8 30 30 8 60 8').stroke();
  doc.path('M 8 46 C 8 26 26 8 46 8').stroke();
  // small elbow curl
  doc.lineWidth(0.9).path('M 15 40 C 20 45 27 45 31 40 C 34 36 33 30 27 29').stroke();
  drawFlower(doc, 14, 14, NAVY);
  doc.restore();
}

/** Full decorative frame + four ornamental corners. */
function drawDecorativeBorder(doc) {
  const o1 = 18; // outer frame inset
  const o2 = 23; // inner keyline inset
  doc.save();
  doc.lineWidth(1.6).strokeColor(NAVY)
    .rect(o1, o1, PAGE_WIDTH - o1 * 2, PAGE_HEIGHT - o1 * 2).stroke();
  doc.lineWidth(0.5).strokeColor(NAVY)
    .rect(o2, o2, PAGE_WIDTH - o2 * 2, PAGE_HEIGHT - o2 * 2).stroke();
  doc.restore();

  const place = (tx, ty, sx, sy) => {
    doc.save();
    doc.translate(tx, ty).scale(sx, sy);
    drawCornerMotif(doc);
    doc.restore();
  };
  place(o1, o1, 1, 1);                                  // top-left
  place(PAGE_WIDTH - o1, o1, -1, 1);                    // top-right
  place(o1, PAGE_HEIGHT - o1, 1, -1);                   // bottom-left
  place(PAGE_WIDTH - o1, PAGE_HEIGHT - o1, -1, -1);     // bottom-right
}

/** Text along a circle arc (for the round seal). */
function curvedText(doc, text, cx, cy, radius, centerDeg, upright) {
  doc.font('Helvetica-Bold').fillColor(SEAL);
  const chars = String(text).toUpperCase().split('');
  const per = Math.min(15, chars.length > 1 ? 220 / (chars.length - 1) : 0);
  doc.fontSize(radius > 24 ? 6 : 5);
  const start = centerDeg - ((chars.length - 1) * per) / 2;
  chars.forEach((ch, i) => {
    const deg = start + i * per;
    const a = deg * Math.PI / 180;
    const x = cx + radius * Math.cos(a);
    const y = cy + radius * Math.sin(a);
    doc.save();
    doc.translate(x, y);
    const rot = (deg + (upright ? 90 : -90));
    doc.rotate(rot, { origin: [0, 0] });
    doc.text(ch, -2.2, -3, { lineBreak: false });
    doc.restore();
  });
}

function drawStar(doc, cx, cy, r, color) {
  doc.save();
  doc.fillColor(color);
  let path = '';
  for (let i = 0; i < 5; i++) {
    const outer = (-90 + i * 72) * Math.PI / 180;
    const inner = (-90 + i * 72 + 36) * Math.PI / 180;
    path += (i === 0 ? 'M' : 'L') + ` ${cx + r * Math.cos(outer)} ${cy + r * Math.sin(outer)}`;
    path += ` L ${cx + r * 0.42 * Math.cos(inner)} ${cy + r * 0.42 * Math.sin(inner)}`;
  }
  path += ' Z';
  doc.path(path).fill();
  doc.restore();
}

/** Round company seal with the issuer name on the top arc and city on the bottom. */
function drawRoundSeal(doc, cx, cy, r, name, city) {
  doc.save();
  doc.lineWidth(1.4).strokeColor(SEAL).circle(cx, cy, r).stroke();
  doc.lineWidth(0.6).strokeColor(SEAL).circle(cx, cy, r - 4.5).stroke();
  curvedText(doc, name, cx, cy, r - 9, -90, true);
  if (city) curvedText(doc, city, cx, cy, r - 9, 90, false);
  drawStar(doc, cx, cy, 4.5, SEAL);
  doc.restore();
}

function resolveParties(invoice, contract, seller, buyer) {
  let issuer = seller;
  let recipient = buyer;
  if (invoice.direction === 'SJVN_TO_BUYER') {
    issuer = seller || { ...SJVN_FALLBACK, name: 'SJVN Limited' };
    recipient = buyer;
  } else {
    issuer = seller;
    recipient = buyer || SJVN_FALLBACK;
  }
  return { issuer: issuer || {}, recipient: recipient || {} };
}

export async function generateInvoicePdf(invoice, contract, seller, buyer, res, beneficiaries = []) {
  const { issuer, recipient } = resolveParties(invoice, contract, seller, buyer);
  const isDraft = !invoice.status || invoice.status === 'DRAFT';

  // Split a GST amount into CGST+SGST (intra-state) or IGST (inter-state). The
  // first two digits of a GSTIN are the state code, so same prefix = intra-state.
  function gstLines(taxAmt) {
    const t = Number(taxAmt) || 0;
    if (!t) return [];
    const stateOf = (g) => (g && String(g).length >= 2 ? String(g).slice(0, 2) : null);
    const s = stateOf(issuer.gst_no);
    const r = stateOf(recipient.gst_no);
    if (s && r && s === r) {
      const half = Math.round(t / 2);
      return [['CGST', half], ['SGST', t - half]];
    }
    return [['IGST', t]];
  }

  // Pre-render the verification QR (async) before we start streaming the doc.
  // Encodes a public verify URL with a tamper-proof HMAC token, so anyone can
  // scan the printed bill and confirm it against the live platform record.
  let qrBuffer = null;
  try {
    const verifyUrl = invoice.id
      ? `${PUBLIC_BASE_URL}/verify/${invoice.id}?sig=${invoiceVerifyToken(invoice.id)}`
      : `${PUBLIC_BASE_URL}/verify`;
    qrBuffer = await QRCode.toBuffer(verifyUrl, {
      width: 240, margin: 1, errorCorrectionLevel: 'M',
      color: { dark: NAVY, light: '#ffffff' },
    });
  } catch (e) {
    qrBuffer = null;
  }

  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, autoFirstPage: true });
  doc.pipe(res);

  // ========== DECORATIVE FRAME ==========
  drawDecorativeBorder(doc);
  doc.strokeColor(NAVY).lineWidth(0.7).fillColor(INK);

  // ========== HEADER: logo LEFT, company block RIGHT ==========
  const headerTop = MARGIN + 6;
  const logoSize = 66;
  let headerBottom = headerTop + logoSize;

  if (issuer.logo_url) {
    try {
      const logoPath = process.cwd() + issuer.logo_url;
      doc.image(logoPath, MARGIN, headerTop, { width: logoSize, fit: [logoSize, logoSize] });
    } catch (e) {
      console.error('Failed to load logo:', e);
    }
  }

  const rightBlockX = MARGIN + 100;
  const rightBlockW = PAGE_WIDTH - MARGIN - rightBlockX;
  let ry = headerTop;

  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY)
    .text(blank(issuer.name).toUpperCase() || ' ', rightBlockX, ry, { width: rightBlockW, align: 'right' });
  ry = doc.y + 2;

  if (issuer.parent_entity_id || issuer.category) {
    doc.font('Helvetica').fontSize(7).fillColor(INK)
      .text('(A wholly owned subsidiary of SJVN Limited)', rightBlockX, ry, { width: rightBlockW, align: 'right' });
    ry = doc.y + 1;
  }

  doc.font('Helvetica').fontSize(7.5).fillColor(INK);
  const rightLines = [
    issuer.cin ? `CIN: ${issuer.cin}` : null,
    'Commercial and System Operation Department',
    issuer.address || null,
    [
      issuer.corporate_email ? `Email: ${issuer.corporate_email}` : null,
      issuer.corporate_phone ? `Phone: ${issuer.corporate_phone}` : null,
      issuer.corporate_website ? `Website: ${issuer.corporate_website}` : null,
    ].filter(Boolean).join(' | ') || null,
  ].filter(Boolean);

  for (const line of rightLines) {
    doc.text(line, rightBlockX, ry, { width: rightBlockW, align: 'right' });
    ry = doc.y + 1;
  }
  headerBottom = Math.max(headerBottom, ry);

  // Header divider with a centre diamond (like the reference letterhead)
  const dividerY = headerBottom + 8;
  const cx = PAGE_WIDTH / 2;
  drawHLine(doc, dividerY, MARGIN, cx - MARGIN - 10, NAVY);
  drawHLine(doc, dividerY, cx + 10, CONTENT_WIDTH / 2 - 10, NAVY);
  doc.save().fillColor(NAVY);
  doc.path(`M ${cx} ${dividerY - 4} L ${cx + 5} ${dividerY} L ${cx} ${dividerY + 4} L ${cx - 5} ${dividerY} Z`).fill();
  doc.restore();

  // Title
  let y = dividerY + 12;
  doc.font('Helvetica-Bold').fontSize(15).fillColor(NAVY)
    .text('MONTHLY ENERGY BILL', MARGIN, y, { width: CONTENT_WIDTH, align: 'center', underline: true });
  doc.fillColor(INK);
  y = doc.y + 8;

  // ========== META TABLE (To | Billing details) ==========
  const half = CONTENT_WIDTH / 2;
  const metaTop = y;

  const leftAddr = [blank(recipient.name), blank(recipient.address)].filter(Boolean).join('\n');
  const leftRows = [
    { label: 'To', value: leftAddr || ' ', h: 52 },
    { label: 'CIN', value: blank(recipient.cin), h: 16 },
    { label: 'PAN', value: blank(recipient.pan_no), h: 16 },
    { label: 'GST No', value: blank(recipient.gst_no), h: 16 },
  ];
  const rightRows = [
    { label: 'Billing Month / Period', value: periodLabel(invoice.billing_period), h: 20 },
    { label: 'Invoice No', value: blank(invoice.invoice_no), h: 16 },
    { label: 'Invoice Date', value: fmtDate(invoice.created_at), h: 16 },
    { label: 'Due Date', value: fmtDate(invoice.due_date), h: 16 },
    { label: 'CIN', value: blank(issuer.cin), h: 16 },
    { label: 'Supplier GST No', value: blank(issuer.gst_no), h: 16 },
    { label: 'Supplier PAN', value: blank(issuer.pan_no), h: 16 },
    { label: 'Supplier TAN', value: blank(issuer.tan_no), h: 16 },
    { label: 'HSN Code', value: HSN_CODE, h: 16 },
  ];

  const leftH = leftRows.reduce((s, r) => s + r.h, 0);
  const rightH = rightRows.reduce((s, r) => s + r.h, 0);
  const metaH = Math.max(leftH, rightH);

  doc.save().lineWidth(0.8).strokeColor(NAVY).rect(MARGIN, metaTop, CONTENT_WIDTH, metaH).stroke().restore();
  drawVLine(doc, MARGIN + half, metaTop, metaTop + metaH);

  let ly = metaTop;
  leftRows.forEach((row, idx) => {
    if (idx > 0) drawHLine(doc, ly, MARGIN, half);
    if (row.label === 'To') {
      cellText(doc, 'To', MARGIN, ly, half, 12, { bold: true, size: 8, color: NAVY });
      cellText(doc, row.value, MARGIN, ly + 12, half, row.h - 12, { size: 8 });
    } else {
      const lw = 55;
      drawVLine(doc, MARGIN + lw, ly, ly + row.h);
      cellText(doc, row.label, MARGIN, ly, lw, row.h, { bold: true, size: 8, valign: 'center', color: NAVY });
      cellText(doc, row.value, MARGIN + lw, ly, half - lw, row.h, { size: 8, valign: 'center' });
    }
    ly += row.h;
  });
  if (leftH < metaH) drawHLine(doc, metaTop + leftH, MARGIN, half);

  let rry = metaTop;
  const labelW = 118;
  rightRows.forEach((row, idx) => {
    if (idx > 0) drawHLine(doc, rry, MARGIN + half, half);
    drawVLine(doc, MARGIN + half + labelW, rry, rry + row.h);
    cellText(doc, row.label, MARGIN + half, rry, labelW, row.h, { bold: true, size: 7.5, valign: 'center', color: NAVY });
    cellText(doc, row.value, MARGIN + half + labelW, rry, half - labelW, row.h, { size: 7.5, valign: 'center' });
    rry += row.h;
  });

  y = metaTop + metaH;

  // ========== REFERENCE ==========
  const capacity = contract?.capacity_mw ?? contract?.contracted_capacity_mw;
  const tech = contract?.project_type || contract?.technology || '';
  const ppaDate = contract?.tenure_start || contract?.created_at;
  const counterparty = invoice.direction === 'SJVN_TO_BUYER'
    ? blank(recipient.name)
    : blank(issuer.name);
  const refBody = `1. Power Purchase Agreement (PPA) dated ${fmtDate(ppaDate) || '—'}`
    + (capacity != null ? ` for ${capacity} MW` : '')
    + (tech ? ` ${tech}` : '')
    + (counterparty ? ` — ${counterparty}` : '')
    + '.'
    + (invoice.billing_family_ref ? `  2. Billing Family Ref: ${invoice.billing_family_ref}` : '');

  const refH = 28;
  doc.save().lineWidth(0.8).strokeColor(NAVY).rect(MARGIN, y, CONTENT_WIDTH, refH).stroke().restore();
  cellText(doc, 'Reference:', MARGIN, y, 70, refH, { bold: true, size: 8, valign: 'center', color: NAVY });
  drawVLine(doc, MARGIN + 70, y, y + refH);
  cellText(doc, refBody, MARGIN + 70, y, CONTENT_WIDTH - 70, refH, { size: 7.5, valign: 'center' });
  y += refH;

  // ========== BILLING TABLE ==========
  const cols = [
    { key: 'sr', w: 32, align: 'center' },
    { key: 'desc', w: 188, align: 'left' },
    { key: 'dur', w: 78, align: 'center' },
    { key: 'units', w: 72, align: 'right' },
    { key: 'tariff', w: 62, align: 'right' },
    { key: 'amt', w: CONTENT_WIDTH - 32 - 188 - 78 - 72 - 62, align: 'right' },
  ];

  function drawBillingRow(rowY, rowH, cells, { bold = false, centerAll = false, headerBand = false } = {}) {
    let x = MARGIN;
    const textColor = headerBand ? '#ffffff' : INK;
    if (headerBand) {
      doc.save().rect(MARGIN, rowY, CONTENT_WIDTH, rowH).fill(NAVY).restore();
    }
    doc.save().lineWidth(0.7).strokeColor(NAVY).rect(MARGIN, rowY, CONTENT_WIDTH, rowH).stroke().restore();
    cols.forEach((c, i) => {
      if (i > 0) drawVLine(doc, x, rowY, rowY + rowH, headerBand ? '#5a7bad' : NAVY);
      const align = centerAll ? 'center' : c.align;
      cellText(doc, cells[i] ?? '', x, rowY, c.w, rowH, {
        bold: headerBand || bold,
        size: headerBand || bold ? 8 : 7.5,
        align,
        valign: 'center',
        color: textColor,
      });
      x += c.w;
    });
  }

  function drawSpanRow(rowY, rowH, label, amount, { bold = true, center = false, band = false } = {}) {
    if (band) doc.save().rect(MARGIN, rowY, CONTENT_WIDTH, rowH).fill(NAVY_SOFT).restore();
    else if (amount !== null) doc.save().rect(MARGIN, rowY, CONTENT_WIDTH, rowH).fill(NAVY_TINT).restore();
    doc.save().lineWidth(0.7).strokeColor(NAVY).rect(MARGIN, rowY, CONTENT_WIDTH, rowH).stroke().restore();
    if (center || amount === null) {
      cellText(doc, label, MARGIN, rowY, CONTENT_WIDTH, rowH, { bold, size: 8, align: 'center', valign: 'center', color: NAVY });
      return;
    }
    const amtW = cols[cols.length - 1].w;
    drawVLine(doc, MARGIN + CONTENT_WIDTH - amtW, rowY, rowY + rowH);
    cellText(doc, label, MARGIN, rowY, CONTENT_WIDTH - amtW, rowH, { bold, size: 8, valign: 'center', color: NAVY });
    cellText(doc, amount, MARGIN + CONTENT_WIDTH - amtW, rowY, amtW, rowH, { bold, size: 8, align: 'right', valign: 'center', color: NAVY });
  }

  // Hydro/PSP bills follow the CERC AFC format (A-params, C capacity+beta,
  // E energy details, EE energy charges) — a different structure from the
  // simple energy×tariff bill used for Solar/Wind.
  const isHydro = ['Hydro', 'PSP'].includes(contract?.project_type);

  let bdLines = [];
  try { bdLines = JSON.parse(invoice.invoice_breakdown_json || '[]'); } catch { bdLines = []; }
  const bd = (code) => { const l = bdLines.find((x) => x.code === code); return l ? l.value : null; };

  // Hydro row: code | particular | value (label spans wide, value right-aligned).
  function drawHydroRow(rowY, rowH, code, label, value, { bold = false } = {}) {
    const codeW = 34;
    const valW = 128;
    doc.save().lineWidth(0.7).strokeColor(NAVY).rect(MARGIN, rowY, CONTENT_WIDTH, rowH).stroke().restore();
    cellText(doc, code || '', MARGIN, rowY, codeW, rowH, { bold, size: 7.5, align: 'center', valign: 'center', color: NAVY });
    drawVLine(doc, MARGIN + codeW, rowY, rowY + rowH);
    cellText(doc, label, MARGIN + codeW, rowY, CONTENT_WIDTH - codeW - valW, rowH, { bold, size: 7.5, valign: 'center', color: bold ? NAVY : INK });
    drawVLine(doc, MARGIN + CONTENT_WIDTH - valW, rowY, rowY + rowH);
    cellText(doc, value != null ? String(value) : '', MARGIN + CONTENT_WIDTH - valW, rowY, valW, rowH, { bold, size: 7.5, align: 'right', valign: 'center', color: bold ? NAVY : INK });
  }

  if (isHydro) {
    const afcAnnual = (Number(contract?.capacity_charges_total) || 0) * 12;
    const aux = Number(contract?.normative_aux) || 0;
    const fehs = Number(contract?.free_energy_home_state) || 0;
    const capCharge = Number(invoice.capacity_charges) || 0;
    const betaIncentive = Number(invoice.incentive_charges) || 0;
    const betaVal = bd('BETA');
    const betaStr = (betaVal != null && betaVal !== '') ? Number(betaVal).toFixed(3) : 'Pending (NRPC)';
    const nrldcFees = Number(invoice.nrldc_fees) || 0;
    const lpsAmt = Number(invoice.lps) || 0;
    const energyCharges = Number(invoice.energy_charges) || 0;
    const num = (v, d = 2) => (v != null && v !== '' ? fmtNum(Number(v), d) : '—');

    drawBillingRow(y, 18, ['Sr', 'Particulars', '', '', '', `Value / ${CUR}`], { headerBand: true });
    y += 18;

    drawSpanRow(y, 16, 'A.  Tariff Parameters (as approved by CERC)', null, { center: true, band: true }); y += 16;
    drawHydroRow(y, 16, 'A1', 'Annual Fixed Charges (AFC)', fmtMoney(afcAnnual)); y += 16;
    drawHydroRow(y, 16, 'A3', 'Normative Auxiliary Consumption', `${aux} %`); y += 16;
    drawHydroRow(y, 16, 'A4', 'Free Energy for Home State (FEHS)', `${fehs} %`); y += 16;
    drawHydroRow(y, 16, 'A7', 'Installed Capacity', `${contract?.capacity_mw ?? '—'} MW`); y += 16;
    drawHydroRow(y, 16, 'A12', 'Energy Charge Rate (ECR)', `${CUR} ${invoice.tariff_per_unit}/kWh`); y += 16;

    drawSpanRow(y, 16, 'Capacity Charges (inclusive of incentive)', null, { center: true, band: true }); y += 16;
    drawHydroRow(y, 16, 'C2', 'Capacity Charge for the month', fmtMoney(capCharge)); y += 16;
    drawHydroRow(y, 16, 'C3', 'Beta Factor (as per REA, range 0 to 1)', betaStr); y += 16;
    drawHydroRow(y, 20, 'C4', 'Incentive on account of Beta { (3% x Beta x 0.5 x AFC) / 12 }', fmtMoney(betaIncentive)); y += 20;
    drawHydroRow(y, 18, 'C5', 'Total Capacity Charges (incl. Beta Incentive)', fmtMoney(capCharge + betaIncentive), { bold: true }); y += 18;

    drawSpanRow(y, 16, 'Energy Details (MWh)', null, { center: true, band: true }); y += 16;
    drawHydroRow(y, 16, 'E1', 'Gross Energy Generated', num(bd('E1'))); y += 16;
    drawHydroRow(y, 16, 'E2', `Auxiliary Consumption (${aux}%)`, num(bd('E2'))); y += 16;
    drawHydroRow(y, 16, 'E3', 'Net Ex-Bus Energy', num(bd('E3'))); y += 16;
    drawHydroRow(y, 16, 'E4', `Free Power to Home State (${fehs}%)`, num(bd('E4'))); y += 16;
    drawHydroRow(y, 16, 'E5', 'Saleable Energy', num(bd('E5'))); y += 16;

    drawSpanRow(y, 16, 'Energy Charges', null, { center: true, band: true }); y += 16;
    drawHydroRow(y, 18, 'EE1', 'Energy Charges (Saleable Energy x ECR)', fmtMoney(energyCharges)); y += 18;
    if (nrldcFees) { drawHydroRow(y, 16, '', 'NRLDC / SLDC Fees', fmtMoney(nrldcFees)); y += 16; }
    for (const [glabel, gamount] of gstLines(Number(invoice.taxes) || 0)) {
      drawHydroRow(y, 16, '', glabel, fmtMoney(gamount)); y += 16;
    }
    if (lpsAmt) { drawHydroRow(y, 16, '', 'Late Payment Surcharge (LPS)', fmtMoney(lpsAmt)); y += 16; }

    const hydroGrand = invoice.total_amount != null
      ? Number(invoice.total_amount)
      : capCharge + betaIncentive + energyCharges + nrldcFees + lpsAmt;
    drawSpanRow(y, 20, `Total Charges (${CUR})  (C5 + EE1${nrldcFees ? ' + NRLDC' : ''}${lpsAmt ? ' + LPS' : ''})`, fmtMoney(hydroGrand), { bold: true });
    y += 20;

    if (isDraft) {
      doc.save();
      doc.font('Helvetica-Bold').fontSize(48).fillColor('#9fb0cc').opacity(0.25);
      doc.text('DRAFT', MARGIN, metaTop + metaH + 80, { width: CONTENT_WIDTH, align: 'center' });
      doc.restore();
      doc.fillColor(INK).opacity(1).strokeColor(NAVY);
    }
    y += 10;
  } else {

  drawBillingRow(y, 18, ['Sr No', 'Description', 'Duration / Month', 'Units (kWh)', `Tariff (${CUR}/kWh)`, `Amount (${CUR})`], { headerBand: true });
  y += 18;

  drawSpanRow(y, 16, 'Part-A  UNITS GENERATED', null, { bold: true, center: true, band: true });
  y += 16;

  const unitsKwh = invoice.energy_mwh != null ? Number(invoice.energy_mwh) * 1000 : null;
  const tariff = invoice.tariff_per_unit;
  const energyAmt = invoice.energy_charges;
  const duration = periodRange(invoice.billing_period);
  const invType = invoice.invoice_type || 'PROVISIONAL';

  const row1Desc = invType === 'FINAL'
    ? 'Final amount, based on units as per Energy Accounts / Injection Schedule Report for the billing month.'
    : 'Provisional amount, based on units as per Injection Schedule Report for the billing month.';

  drawBillingRow(y, 36, [
    '1',
    row1Desc,
    duration,
    unitsKwh != null ? fmtNum(unitsKwh, 2) : '',
    tariff != null ? fmtNum(tariff, 2) : '',
    energyAmt != null ? fmtMoney(energyAmt) : '',
  ]);
  y += 36;

  const adj = Number(invoice.other_adjustments) || 0;
  drawBillingRow(y, 22, [
    '2',
    'Adjustment against the preceding months Provisional Bill(s).',
    '', '', '',
    adj !== 0 ? fmtMoney(adj) : '',
  ]);
  y += 22;

  drawBillingRow(y, 28, ['2.1', 'Based on Energy Accounts Statement issued as per SLDC / RPC for preceding months.', '', '', '', '']);
  y += 28;

  drawBillingRow(y, 28, ['2.2', 'Provisional amount, based on units as per Injection Schedule Report in preceding months.', '', '', '', '']);
  y += 28;

  const subTotalA = (Number(energyAmt) || 0) + adj;
  drawSpanRow(y, 18, 'I. Sub-Total (A)', fmtMoney(subTotalA), { bold: true });
  y += 18;

  drawSpanRow(y, 16, 'Part-B  Other charges, taxes, duties, levies, GST etc', null, { bold: true, center: true, band: true });
  y += 16;

  const taxAmt = Number(invoice.taxes) || 0;
  const txCharges = Number(invoice.transmission_charges) || 0;
  const tradingMargin = Number(invoice.trading_margin) || 0;
  const nrldcFees = Number(invoice.nrldc_fees) || 0;
  const lps = Number(invoice.lps) || 0;
  const rebate = Number(invoice.rebate) || 0;

  // Itemise Part-B so the bill shows exactly what each rupee is — instead of a
  // single lumped figure. Only non-zero charges are printed. Rebate (early-payment
  // discount) shows as a negative line.
  const partBItems = [
    ['Trading Margin', tradingMargin],
    ['NRLDC / SLDC Fees', nrldcFees],
    ['Transmission / Wheeling Charges', txCharges],
    ...gstLines(taxAmt),
    ['Late Payment Surcharge (LPS)', lps],
    ['Early-Payment Rebate', rebate ? -rebate : 0],
  ].filter(([, v]) => Number(v) !== 0);

  let bSr = 0;
  for (const [label, amount] of partBItems) {
    bSr += 1;
    drawBillingRow(y, 18, [`B${bSr}`, label, '', '', '', fmtMoney(amount)]);
    y += 18;
  }
  if (partBItems.length === 0) {
    drawBillingRow(y, 18, ['', 'No additional charges for this bill.', '', '', '', fmtMoney(0)]);
    y += 18;
  }

  const partB = taxAmt + txCharges + tradingMargin + nrldcFees + lps - rebate;
  drawSpanRow(y, 18, `II. Sub-Total (B)`, fmtMoney(partB), { bold: true });
  y += 18;

  const grand = invoice.total_amount != null ? Number(invoice.total_amount) : subTotalA + partB;
  drawSpanRow(y, 20, `Total amount to be paid (${CUR}) (A+B)`, fmtMoney(grand), { bold: true });
  y += 20;

  if (isDraft) {
    doc.save();
    doc.font('Helvetica-Bold').fontSize(48).fillColor('#9fb0cc').opacity(0.25);
    doc.text('DRAFT', MARGIN, metaTop + metaH + 80, { width: CONTENT_WIDTH, align: 'center' });
    doc.restore();
    doc.fillColor(INK).opacity(1).strokeColor(NAVY);
  }

  y += 10;
  }

  // ========== BANK (left) + SIGNATURE (right) ==========
  const bankW = CONTENT_WIDTH * 0.58;
  const sigW = CONTENT_WIDTH - bankW;
  const sigX = MARGIN + bankW;
  const bankTop = y;
  const bankRows = [
    ['A/c Name', blank(issuer.name)],
    ['A/c No', blank(issuer.account_no)],
    ['IFS Code', blank(issuer.ifsc_code)],
    ['Branch & Address', [blank(issuer.bank_name), blank(issuer.branch_address)].filter(Boolean).join(', ')],
  ];
  const bankRowH = 16;
  const bankHeaderH = 28;
  const bankH = bankHeaderH + bankRows.length * bankRowH;

  doc.save().lineWidth(0.8).strokeColor(NAVY).rect(MARGIN, bankTop, bankW, bankH).stroke().restore();
  cellText(doc, `The bank details of ${blank(issuer.name) || 'the Supplier'} for bill payment is:`,
    MARGIN, bankTop, bankW, bankHeaderH, { bold: true, size: 7.5, valign: 'center', color: NAVY });
  drawHLine(doc, bankTop + bankHeaderH, MARGIN, bankW);

  let by = bankTop + bankHeaderH;
  const blw = 90;
  bankRows.forEach((row, idx) => {
    if (idx > 0) drawHLine(doc, by, MARGIN, bankW);
    drawVLine(doc, MARGIN + blw, by, by + bankRowH);
    cellText(doc, row[0], MARGIN, by, blw, bankRowH, { bold: true, size: 7.5, valign: 'center', color: NAVY });
    cellText(doc, row[1], MARGIN + blw, by, bankW - blw, bankRowH, { size: 7.5, valign: 'center' });
    by += bankRowH;
  });

  // Signature block
  doc.save().lineWidth(0.8).strokeColor(NAVY).rect(sigX, bankTop, sigW, bankH).stroke().restore();
  cellText(doc, `For & on the behalf of\n${blank(issuer.name) || 'Supplier'}`,
    sigX, bankTop + 6, sigW, 22, { bold: true, size: 8, align: 'center', color: NAVY });

  // Signature image (left half of the block) + round seal (right half)
  const sigMidY = bankTop + 30;
  if (issuer.signature_url) {
    try {
      const sigPath = process.cwd() + issuer.signature_url;
      doc.image(sigPath, sigX + 12, sigMidY, { fit: [sigW * 0.5 - 12, 26], align: 'center', valign: 'center' });
    } catch (e) {
      console.error('Failed to load signature:', e);
    }
  }
  // Round company seal
  try {
    const sealCx = sigX + sigW * 0.72;
    const sealCy = sigMidY + 16;
    const sealName = (blank(issuer.name) || 'Company').replace(/\bPvt\b\.?/i, 'PVT').replace(/\bLtd\b\.?/i, 'LTD');
    const sealCity = blank(issuer.branch_address).split(',')[0] || '';
    drawRoundSeal(doc, sealCx, sealCy, 22, sealName, sealCity);
  } catch (e) {
    console.error('Failed to draw seal:', e);
  }

  // Digital-signature caption
  const signedName = blank(issuer.signatory_name) || 'Authorised Signatory';
  const signedDesig = blank(issuer.signatory_designation) || 'Authorised Signatory';
  const signedDate = fmtDate(invoice.updated_at || invoice.created_at) || fmtDate(new Date());
  const caption = `Digitally signed by ${signedName}\n${signedDesig}  |  Date: ${signedDate}`;
  cellText(doc, caption, sigX, bankTop + bankH - 24, sigW, 22, { size: 6.5, align: 'center', color: INK });

  y = bankTop + bankH + 12;

  // ========== NOTE (left) + QR (right) ==========
  const noteW = CONTENT_WIDTH - 96;
  resetCursor(doc, y);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY)
    .text('NOTE:', MARGIN, y, { width: noteW, underline: true });
  let ny = doc.y + 4;
  doc.font('Helvetica').fontSize(7.5).fillColor(INK);
  const notes = [
    '1. This bill is raised for the energy scheduled / accounted for the billing month as per applicable Energy Accounts / Injection Schedule.',
    '2. Due date of payment = Date of Billing + 45 days (or as per the Payment Terms of the PPA / PSA).',
    '3. Late payment surcharge shall be payable at the base rate of Late Payment Surcharge applicable for the month plus 0.5% as per the PPA / PSA / MoP LPS Rules.',
    '4. Rebate of 1.5% shall be allowed for payment made within 5 days of presentation of the bill, as per applicable contract terms.',
    '5. No rebate shall be applicable on taxes, duties, levies or change-in-law amounts, if any.',
  ];
  notes.forEach((n) => {
    doc.text(n, MARGIN, ny, { width: noteW, align: 'left' });
    ny = doc.y + 3;
  });

  // QR bottom-right
  if (qrBuffer) {
    const qrSize = 70;
    const qrX = PAGE_WIDTH - MARGIN - qrSize;
    const qrY = y + 2;
    try {
      doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
      doc.font('Helvetica-Bold').fontSize(7).fillColor(NAVY)
        .text('Scan to verify\nthis document', qrX - 8, qrY + qrSize + 3, { width: qrSize + 16, align: 'center' });
    } catch (e) {
      console.error('Failed to place QR:', e);
    }
  }

  // ========== PAGE 2: BENEFICIARY-WISE ALLOCATION (hydro) ==========
  // Mirrors the NJHPS statement's second page — how the plant's charges split
  // across the DISCOMs allocated to it (per REA / NRPC order).
  if (Array.isArray(beneficiaries) && beneficiaries.length) {
    doc.addPage();
    let py = MARGIN;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY)
      .text('Beneficiary-wise Allocation', MARGIN, py, { width: CONTENT_WIDTH, align: 'center' });
    py = doc.y + 3;
    doc.font('Helvetica').fontSize(8).fillColor(INK)
      .text(`Allocation of charges to beneficiaries as per REA / NRPC order — ${periodLabel(invoice.billing_period)}`,
        MARGIN, py, { width: CONTENT_WIDTH, align: 'center' });
    py = doc.y + 12;

    drawBillingRow(py, 18, ['Sr', 'Beneficiary (DISCOM)', '', '', 'Allocation %', `Share (${CUR})`], { headerBand: true });
    py += 18;
    beneficiaries.forEach((b, i) => {
      drawBillingRow(py, 18, [String(i + 1), blank(b.name) || '—', '', '', `${b.allocation_percent}%`, fmtMoney(b.share)]);
      py += 18;
    });
    const totPct = beneficiaries.reduce((s, b) => s + (Number(b.allocation_percent) || 0), 0);
    const totShare = beneficiaries.reduce((s, b) => s + (Number(b.share) || 0), 0);
    drawSpanRow(py, 20, `Total Allocated  (${totPct}%)`, fmtMoney(totShare), { bold: true });
    py += 20;

    doc.font('Helvetica-Oblique').fontSize(7).fillColor(INK)
      .text('Note: Allocation percentages are as per the applicable REA / NRPC allocation order for the billing month. Share is the beneficiary’s portion of the total billed amount.',
        MARGIN, py + 8, { width: CONTENT_WIDTH, align: 'left' });
  }

  doc.end();
}
