/**
 * Power Trading reports — Market Rates & Analytics, and Financial & Profitability.
 * Portrait A4, same brand language as the Billing / Energy / Reconciliation reports.
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '../assets/sjvn_logo.jpg');

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 36;
const CONTENT_W = PAGE_W - M * 2;

const NAVY = '#1b3b6f';
const NAVY_SOFT = '#eef2f8';
const GREEN = '#0f766e';
const RED = '#b91c1c';
const INK = '#1a1a1a';
const MUTED = '#64748b';

const rs = (n) => {
  const v = Number(n || 0);
  const a = Math.abs(v);
  if (a >= 1e7) return `Rs ${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `Rs ${(v / 1e5).toFixed(2)} L`;
  return `Rs ${Math.round(v).toLocaleString('en-IN')}`;
};
const signed = (n) => (Number(n) > 0 ? `+${n}` : String(n));

function roundedRect(doc, x, y, w, h, r, fill) {
  doc.roundedRect(x, y, w, h, r);
  if (fill) doc.fillColor(fill).fill();
}

function header(doc, title, subtitle, generatedAt) {
  doc.rect(0, 0, PAGE_W, 66).fill(NAVY);
  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, M, 10, { height: 44, fit: [44, 44] }); } catch { /* logo optional */ }
  }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14).text('SJVN Limited', M + 54, 14, { lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor('#c5d4ea').text('Power Trading', M + 54, 32, { lineBreak: false });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text(title, M, 14, { width: CONTENT_W, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor('#c5d4ea').text(subtitle, M, 30, { width: CONTENT_W, align: 'right', lineBreak: false });
  doc.fontSize(7).text(`Generated ${generatedAt}`, M, 44, { width: CONTENT_W, align: 'right', lineBreak: false });
}

function kpiBand(doc, y, items) {
  const w = CONTENT_W / items.length;
  roundedRect(doc, M, y, CONTENT_W, 44, 4, NAVY_SOFT);
  items.forEach((k, i) => {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(k.label, M + 10 + i * w, y + 8, { width: w - 16, lineBreak: false });
    doc.fillColor(k.tone || NAVY).font('Helvetica-Bold').fontSize(13).text(k.value, M + 10 + i * w, y + 20, { width: w - 16, lineBreak: false });
  });
  return y + 56;
}

function table(doc, startY, cols, rows, ctx) {
  const rowH = 15;
  let y = startY;
  const head = () => {
    roundedRect(doc, M, y, CONTENT_W, rowH, 2, NAVY_SOFT);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(7);
    let x = M + 6;
    cols.forEach((c) => { doc.text(c.label, x, y + 4.5, { width: c.w - 8, align: c.align || 'left', lineBreak: false }); x += c.w; });
    y += rowH;
  };
  head();
  doc.font('Helvetica').fontSize(7);
  for (const r of rows) {
    // Break before a row, never through one.
    if (y + rowH > PAGE_H - M - 14) {
      doc.addPage();
      header(doc, ctx.title, ctx.subtitle, ctx.generatedAt);
      y = 84; head(); doc.font('Helvetica').fontSize(7);
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

function sectionTitle(doc, y, text, note) {
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(text, M, y);
  if (note) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(note, M, y + 13, { width: CONTENT_W });
    return y + 26;
  }
  return y + 16;
}

function pageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.fillColor(MUTED).font('Helvetica').fontSize(7)
      .text(`Page ${i + 1} of ${range.count}`, M, PAGE_H - M + 6, { width: CONTENT_W, align: 'right', lineBreak: false });
  }
}

function newDoc(res, title, filename) {
  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: M, bottom: M, left: M, right: M },
    bufferPages: true,
    info: { Title: title, Author: 'SJVN Limited', Creator: 'SJVN Energy Platform' },
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  return doc;
}

// ─── Market Rates & Analytics ─────────────────────────────────────────────
export function generateMarketAnalyticsPdf(r, meta, res) {
  const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const title = 'MARKET RATES & ANALYTICS';
  const subtitle = `${r.window.start_date} to ${r.window.end_date}`;
  const ctx = { title, subtitle, generatedAt };
  const doc = newDoc(res, 'SJVN Market Rates & Analytics Report', `SJVN_Market_Analytics_${r.window.end_date}.pdf`);

  header(doc, title, subtitle, generatedAt);
  let y = 84;

  const chg = r.previous.change_percent;
  y = kpiBand(doc, y, [
    { label: 'Average MCP', value: `Rs ${r.overall.avg_rate ?? '—'}/kWh` },
    { label: 'Range', value: `${r.overall.min_rate ?? '—'} – ${r.overall.max_rate ?? '—'}` },
    { label: 'vs previous period', value: chg === null ? '—' : `${signed(chg)}%`, tone: chg > 0 ? RED : GREEN },
    { label: 'Observations', value: String(r.overall.observations ?? 0) },
  ]);

  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(
    `Window ${r.window.days} day(s). Previous period ${r.previous.window.start_date} to ${r.previous.window.end_date}`
    + ` averaged Rs ${r.previous.avg_rate ?? '—'}/kWh.`
    + (r.filters.exchange ? ` Filtered to ${r.filters.exchange}.` : '')
    + (r.filters.product ? ` Product ${r.filters.product}.` : '')
    + (r.forecast_accuracy.mape_percent !== null
      ? ` Forecast MAPE ${r.forecast_accuracy.mape_percent}% over ${r.forecast_accuracy.observations_with_forecast} forecast observation(s).`
      : ' No forecast values recorded in this window.'),
    M, y, { width: CONTENT_W },
  );
  y += 26;

  y = sectionTitle(doc, y, 'Exchange comparison', 'Ordered cheapest average MCP first.');
  y = table(doc, y, [
    { label: 'Exchange', w: 90, value: (x) => x.exchange },
    { label: 'Obs', w: 50, align: 'right', value: (x) => x.observations },
    { label: 'Avg Rs/kWh', w: 80, align: 'right', value: (x) => x.avg_rate },
    { label: 'Min', w: 60, align: 'right', value: (x) => x.min_rate },
    { label: 'Max', w: 60, align: 'right', value: (x) => x.max_rate },
    { label: 'Volume MW', w: 84, align: 'right', value: (x) => Number(x.total_volume_mw).toLocaleString('en-IN') },
  ], r.by_exchange, ctx);
  y += 18;

  y = sectionTitle(doc, y, 'Product comparison');
  y = table(doc, y, [
    { label: 'Product', w: 90, value: (x) => x.product },
    { label: 'Obs', w: 50, align: 'right', value: (x) => x.observations },
    { label: 'Avg Rs/kWh', w: 80, align: 'right', value: (x) => x.avg_rate },
    { label: 'Min', w: 60, align: 'right', value: (x) => x.min_rate },
    { label: 'Max', w: 60, align: 'right', value: (x) => x.max_rate },
    { label: 'Volume MW', w: 84, align: 'right', value: (x) => Number(x.total_volume_mw).toLocaleString('en-IN') },
  ], r.by_product, ctx);
  y += 18;

  if (r.execution.length) {
    y = sectionTitle(doc, y, 'SJVN execution vs market',
      'Weighted cleared price against the average MCP for the same exchange, product and delivery date. Negative is below market.');
    y = table(doc, y, [
      { label: 'Delivery', w: 78, value: (x) => x.delivery_date },
      { label: 'Exchange', w: 62, value: (x) => x.exchange },
      { label: 'Product', w: 55, value: (x) => x.product },
      { label: 'Cleared MW', w: 72, align: 'right', value: (x) => x.cleared_mw },
      { label: 'Our price', w: 62, align: 'right', value: (x) => x.avg_cleared_price },
      { label: 'Market MCP', w: 68, align: 'right', value: (x) => x.market_mcp },
      { label: 'Diff', w: 47, align: 'right', value: (x) => (x.vs_market === null ? '—' : signed(x.vs_market)), colour: (x) => (x.vs_market > 0 ? RED : GREEN) },
    ], r.execution, ctx);
    y += 18;
  }

  if (y > PAGE_H - M - 120) { doc.addPage(); header(doc, title, subtitle, generatedAt); y = 84; }
  y = sectionTitle(doc, y, 'Daily price movement', 'Most recent first, up to 40 days.');
  table(doc, y, [
    { label: 'Date', w: 96, value: (x) => x.rate_date },
    { label: 'Avg Rs/kWh', w: 92, align: 'right', value: (x) => x.avg_rate },
    { label: 'Min', w: 78, align: 'right', value: (x) => x.min_rate },
    { label: 'Max', w: 78, align: 'right', value: (x) => x.max_rate },
    { label: 'Volume MW', w: 80, align: 'right', value: (x) => Number(x.volume_mw).toLocaleString('en-IN') },
  ], r.daily, ctx);

  pageNumbers(doc);
  doc.end();
}

// ─── Financial & Profitability ────────────────────────────────────────────
export function generateTradingProfitabilityPdf(r, meta, res) {
  const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const title = 'FINANCIAL & PROFITABILITY';
  const subtitle = r.window.from || r.window.to ? `${r.window.from || 'start'} to ${r.window.to || 'date'}` : 'All periods';
  const ctx = { title, subtitle, generatedAt };
  const doc = newDoc(res, 'SJVN Trading Financial & Profitability Report', `SJVN_Trading_Profitability_${new Date().toISOString().slice(0, 10)}.pdf`);

  header(doc, title, subtitle, generatedAt);
  let y = 84;

  y = kpiBand(doc, y, [
    { label: 'Net margin', value: rs(r.net_margin), tone: r.net_margin >= 0 ? GREEN : RED },
    { label: 'REC realised margin', value: rs(r.rec.margin), tone: r.rec.margin >= 0 ? GREEN : RED },
    { label: 'Bilateral contracted', value: rs(r.bilateral.contracted_margin) },
    { label: 'Open access charges', value: rs(r.open_access_charges.total), tone: RED },
  ]);

  y = sectionTitle(doc, y, 'Revenue streams',
    'Basis differs by stream — REC is realised against issuance cost, bilateral is contracted margin net of open access charges.');
  y = table(doc, y, [
    { label: 'Stream', w: 150, value: (x) => x.stream },
    { label: 'Basis', w: 80, value: (x) => x.basis },
    { label: 'Revenue', w: 100, align: 'right', value: (x) => (x.revenue === null ? '—' : rs(x.revenue)) },
    { label: 'Cost', w: 100, align: 'right', value: (x) => rs(x.cost) },
    { label: 'Margin', w: 93, align: 'right', value: (x) => rs(x.margin), colour: (x) => (x.margin >= 0 ? GREEN : RED) },
  ], r.streams, ctx);
  y += 18;

  y = sectionTitle(doc, y, 'REC trading', `${r.rec.qty} certificate(s) sold.`);
  y = table(doc, y, [
    { label: 'Measure', w: 260, value: (x) => x.k },
    { label: 'Amount', w: 263, align: 'right', value: (x) => rs(x.v), colour: (x) => x.tone },
  ], [
    { k: 'Sale proceeds', v: r.rec.revenue },
    { k: 'Issuance cost of certificates sold', v: r.rec.cost, tone: RED },
    { k: 'Realised margin', v: r.rec.margin, tone: r.rec.margin >= 0 ? GREEN : RED },
  ], ctx);
  y += 18;

  y = sectionTitle(doc, y, 'Open access charges paid', 'Direct cost of running bilateral open-access trades.');
  y = table(doc, y, [
    { label: 'Category', w: 200, value: (x) => x.category },
    { label: 'Transactions', w: 120, align: 'right', value: (x) => x.txns },
    { label: 'Amount', w: 203, align: 'right', value: (x) => rs(x.amount), colour: () => RED },
  ], r.open_access_charges.by_category, ctx);
  y += 18;

  if (r.exchange.products.length) {
    if (y > PAGE_H - M - 130) { doc.addPage(); header(doc, title, subtitle, generatedAt); y = 84; }
    y = sectionTitle(doc, y, 'Exchange clearing by product', 'Cleared bids only; open bids are excluded.');
    y = table(doc, y, [
      { label: 'Product', w: 100, value: (x) => x.product },
      { label: 'Bids', w: 70, align: 'right', value: (x) => x.bids },
      { label: 'Cleared MW', w: 110, align: 'right', value: (x) => x.cleared_mw },
      { label: 'Price gain vs bid', w: 143, align: 'right', value: (x) => x.price_gain_per_mw_unit, colour: (x) => (x.price_gain_per_mw_unit >= 0 ? GREEN : RED) },
    ], r.exchange.products, ctx);
    y += 18;
  }

  if (y > PAGE_H - M - 140) { doc.addPage(); header(doc, title, subtitle, generatedAt); y = 84; }
  y = sectionTitle(doc, y, 'Bilateral contracted margin', `${r.bilateral.deals} active deal(s); top 20 by start date.`);
  y = table(doc, y, [
    { label: 'Counterparty', w: 140, value: (x) => x.counterparty },
    { label: 'Term', w: 40, value: (x) => x.oa_type },
    { label: 'MW', w: 42, align: 'right', value: (x) => x.quantum_mw },
    { label: 'Tariff', w: 48, align: 'right', value: (x) => x.tariff_per_unit },
    { label: 'Purchase', w: 52, align: 'right', value: (x) => x.purchase_rate_per_unit },
    { label: 'Days', w: 40, align: 'right', value: (x) => x.term_days },
    { label: 'Contracted margin', w: 161, align: 'right', value: (x) => rs(x.contracted_margin), colour: (x) => (x.contracted_margin >= 0 ? GREEN : RED) },
  ], r.bilateral.rows, ctx);
  y += 18;

  if (y > PAGE_H - M - 110) { doc.addPage(); header(doc, title, subtitle, generatedAt); y = 84; }
  y = sectionTitle(doc, y, 'Basis and exclusions');
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5);
  for (const c of r.caveats) {
    doc.text(`•  ${c}`, M, y, { width: CONTENT_W });
    y = doc.y + 3;
  }

  pageNumbers(doc);
  doc.end();
}

// ─── Trading Dashboard snapshot ───────────────────────────────────────────
export function generateTradingDashboardPdf(r, meta, res) {
  const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const title = 'TRADING DASHBOARD';
  const subtitle = `Snapshot as at ${generatedAt}`;
  const ctx = { title, subtitle, generatedAt };
  const doc = newDoc(res, 'SJVN Trading Dashboard Snapshot', `SJVN_Trading_Dashboard_${new Date().toISOString().slice(0, 10)}.pdf`);

  header(doc, title, subtitle, generatedAt);
  let y = 84;

  const rt = r.realtime; const dy = r.daily; const pd = r.periodic;
  y = kpiBand(doc, y, [
    { label: 'Open positions', value: `${rt.open_positions.count} bid(s)` },
    { label: 'Open quantum', value: `${rt.open_positions.quantum_mw} MW` },
    { label: 'Cleared today', value: `${dy.daily_summary.quantumCleared} MW` },
    { label: 'Clear ratio today', value: `${Math.round(dy.daily_summary.clearRatio)}%` },
  ]);

  y = sectionTitle(doc, y, 'Client exposure utilisation',
    'Valued as energy against each client\'s limit — the same basis the limit check enforces.');
  y = table(doc, y, [
    { label: 'Client', w: 180, value: (x) => x.name },
    { label: 'Limit', w: 110, align: 'right', value: (x) => rs(x.exposure_limit) },
    { label: 'Utilised', w: 110, align: 'right', value: (x) => rs(x.utilized) },
    { label: 'Used %', w: 123, align: 'right',
      value: (x) => (x.exposure_limit ? `${Math.round((x.utilized / x.exposure_limit) * 1000) / 10}%` : '—'),
      colour: (x) => (x.exposure_limit && x.utilized / x.exposure_limit > 0.8 ? RED : INK) },
  ], rt.client_limits, ctx);
  y += 18;

  if (rt.exchange_exposure.length) {
    y = sectionTitle(doc, y, 'Open position by exchange');
    y = table(doc, y, [
      { label: 'Exchange', w: 180, value: (x) => x.exchange },
      { label: 'Open bids', w: 170, align: 'right', value: (x) => x.bid_count },
      { label: 'Quantum MW', w: 173, align: 'right', value: (x) => x.total_mw },
    ], rt.exchange_exposure, ctx);
    y += 18;
  }

  const ratePairs = Object.entries(rt.live_rates || {});
  if (ratePairs.length) {
    y = sectionTitle(doc, y, 'Latest recorded market clearing price',
      `As at ${rt.rates_as_of || 'unknown date'} — the most recent rates held on record, not a live feed.`);
    y = table(doc, y, [
      { label: 'Exchange', w: 261, value: (x) => x[0] },
      { label: 'MCP Rs/kWh', w: 262, align: 'right', value: (x) => x[1] },
    ], ratePairs, ctx);
    y += 18;
  }

  if (y > PAGE_H - M - 150) { doc.addPage(); header(doc, title, subtitle, generatedAt); y = 84; }
  y = sectionTitle(doc, y, "Today's bidding", 'Bids raised today, by count and quantum.');
  y = table(doc, y, [
    { label: 'Measure', w: 300, value: (x) => x.k },
    { label: 'Value', w: 223, align: 'right', value: (x) => x.v },
  ], [
    { k: 'Bids raised', v: dy.daily_summary.totalBids },
    { k: 'Bids cleared or partially cleared', v: dy.daily_summary.clearedBids },
    { k: 'Quantum bid (MW)', v: dy.daily_summary.quantumBid },
    { k: 'Quantum cleared (MW)', v: dy.daily_summary.quantumCleared },
    { k: 'Realised P&L (invoiced)', v: rs(dy.pnl.realized) },
    { k: 'Price gain on cleared blocks', v: rs(dy.pnl.unrealized) },
  ], ctx);
  y += 18;

  if (dy.rejected_analysis.length) {
    y = sectionTitle(doc, y, 'Rejections today');
    y = table(doc, y, [
      { label: 'Status', w: 300, value: (x) => x.status },
      { label: 'Count', w: 223, align: 'right', value: (x) => x.c },
    ], dy.rejected_analysis, ctx);
    y += 18;
  }

  if (y > PAGE_H - M - 150) { doc.addPage(); header(doc, title, subtitle, generatedAt); y = 84; }
  y = sectionTitle(doc, y, 'Monthly volume trend');
  y = table(doc, y, [
    { label: 'Month', w: 180, value: (x) => x.month },
    { label: 'Bid MW', w: 170, align: 'right', value: (x) => x.bid_mw },
    { label: 'Cleared MW', w: 173, align: 'right', value: (x) => x.cleared_mw },
  ], pd.volume_trend, ctx);
  y += 18;

  y = sectionTitle(doc, y, 'Client margin', 'Basis is stated per client — invoiced where invoices exist, otherwise contracted.');
  y = table(doc, y, [
    { label: 'Client', w: 240, value: (x) => x.client_name },
    { label: 'Basis', w: 100, value: (x) => x.basis || '—' },
    { label: 'Margin', w: 183, align: 'right', value: (x) => rs(x.total_margin), colour: (x) => (x.total_margin >= 0 ? GREEN : RED) },
  ], pd.client_profitability, ctx);
  y += 18;

  if (pd.product_mix.length) {
    if (y > PAGE_H - M - 100) { doc.addPage(); header(doc, title, subtitle, generatedAt); y = 84; }
    y = sectionTitle(doc, y, 'Cleared volume by product');
    table(doc, y, [
      { label: 'Product', w: 261, value: (x) => x.product },
      { label: 'Cleared MW', w: 262, align: 'right', value: (x) => x.cleared_mw },
    ], pd.product_mix, ctx);
  }

  pageNumbers(doc);
  doc.end();
}

// ─── Letter of Intent (LoI) ──────────────────────────────────────────────────
export function generateLoiPdf(tx, meta, res) {
  const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const doc = newDoc(res, 'Letter of Intent (LoI)', `SJVN_LoI_${tx.loi_contract_ref ? tx.loi_contract_ref.replace(/[/\\?%*:|"<>]/g, '_') : tx.id}.pdf`);

  // Formal Header Banner
  doc.rect(0, 0, PAGE_W, 72).fill(NAVY);
  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, M, 10, { height: 48, fit: [48, 48] }); } catch { /* logo optional */ }
  }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14).text('SJVN LIMITED', M + 56, 12, { lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor('#c5d4ea').text('(A Mini Ratna Schedule \'A\' PSU under Ministry of Power, Govt. of India)', M + 56, 28, { lineBreak: false });
  doc.fontSize(7.5).fillColor('#94a3b8').text('Corporate Office: Shanan, Shimla, Himachal Pradesh - 171006 | Power Trading Division', M + 56, 40, { lineBreak: false });
  
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12).text('LETTER OF INTENT', M, 16, { width: CONTENT_W, align: 'right', lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#38bdf8').text(`REF: ${tx.loi_contract_ref || ('LOI/SJVN/TRD/' + tx.id)}`, M, 32, { width: CONTENT_W, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(7.5).fillColor('#c5d4ea').text(`Date of Issue: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, M, 46, { width: CONTENT_W, align: 'right', lineBreak: false });

  let y = 88;

  // Addressed To Box
  roundedRect(doc, M, y, CONTENT_W, 58, 4, NAVY_SOFT);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5).text('ISSUED TO (BUYER / COUNTERPARTY):', M + 10, y + 8);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(tx.counterparty || tx.client_name || tx.client_id, M + 10, y + 20);
  
  const recipientMeta = [];
  if (tx.pan_number) recipientMeta.push(`PAN: ${tx.pan_number}`);
  if (tx.gstin) recipientMeta.push(`GSTIN: ${tx.gstin}`);
  if (tx.contact_person) recipientMeta.push(`Attn: ${tx.contact_person}`);
  if (tx.contact_phone) recipientMeta.push(`Ph: ${tx.contact_phone}`);
  
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
    recipientMeta.length > 0 ? recipientMeta.join('  |  ') : 'Registered Electricity Trader / Distribution Licensee / Open Access Consumer',
    M + 10, y + 36, { width: CONTENT_W - 20 }
  );

  y += 70;

  // Subject Heading
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text(
    `SUB: Letter of Intent (LoI) for Bilateral Open Access Power Procurement under ${tx.oa_type || 'STOA'} Arrangement`,
    M, y, { width: CONTENT_W }
  );
  y += 20;

  doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(
    `Dear Sir/Madam,\nWith reference to the mutual discussions and commercial consent, SJVN Limited ("Seller / Trading Licensee") is pleased to convey its formal intent to supply power to ${tx.counterparty || 'the Counterparty'} ("Buyer") on bilateral basis, subject to the following key commercial terms and operational modalities:`,
    M, y, { width: CONTENT_W, align: 'justify', lineGap: 2 }
  );
  y += 44;

  // Commercial Mandate Table
  const tableTop = y;
  const colW1 = 150;
  const colW2 = CONTENT_W - colW1;
  const rowHeight = 18;

  const totalLoss = (Number(tx.loss_injection_state || 0) + Number(tx.loss_inter_state || 0) + Number(tx.loss_drawee_state || 0)).toFixed(2);

  const rows = [
    ['Transaction Reference ID', tx.id],
    ['Contract / LoI Reference', tx.loi_contract_ref || `LOI/SJVN/TRD/${tx.id}`],
    ['Open Access Modality', `${tx.oa_type || 'STOA'} (Short-Term Open Access via NOAR Portal)`],
    ['Supply Period (Delivery Horizon)', `${tx.start_date}  to  ${tx.end_date}`],
    ['Contracted Quantum', `${tx.quantum_mw} MW (Round-the-Clock / As per 96-Block Schedule)`],
    ['Contracted Tariff (Ex-Bus)', `₹ ${Number(tx.tariff_per_unit).toFixed(2)} / kWh (excluding Open Access & Statutory Levies)`],
    ['Source Generating Asset', tx.client_name || tx.client_id || 'SJVN Hydro/Solar Generation Pool'],
    ['Delivery Point', 'Regional Periphery / STU-ISTS Interconnection Interface'],
    ['NOAR Portal Contract Reference', tx.noar_contract_no || 'Under NOAR Registration & Scheduling'],
    ['Transmission Loss Matrix', `Injection: ${tx.loss_injection_state || 0}% | ISTS: ${tx.loss_inter_state || 0}% | Drawee: ${tx.loss_drawee_state || 0}% (Total: ${totalLoss}%)`],
    ['Open Access & Wheeling Charges', `Wheeling: ₹ ${Number(tx.wheeling_charges || 0).toFixed(2)}/kWh | Transmission: ₹ ${Number(tx.transmission_charges || 0).toFixed(2)}/kWh`],
  ];

  roundedRect(doc, M, tableTop, CONTENT_W, rows.length * rowHeight, 3, '#ffffff');
  doc.rect(M, tableTop, CONTENT_W, rows.length * rowHeight).strokeColor('#cbd5e1').lineWidth(0.5).stroke();

  rows.forEach((r, idx) => {
    const curY = tableTop + idx * rowHeight;
    const isEven = idx % 2 === 0;
    if (isEven) {
      doc.rect(M, curY, CONTENT_W, rowHeight).fill('#f8fafc');
    }
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8).text(r[0], M + 8, curY + 5, { width: colW1 - 12, lineBreak: false });
    doc.fillColor(INK).font('Helvetica').fontSize(8).text(String(r[1]), M + colW1 + 8, curY + 5, { width: colW2 - 12, lineBreak: false });
    doc.moveTo(M, curY + rowHeight).lineTo(M + CONTENT_W, curY + rowHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
  });
  doc.moveTo(M + colW1, tableTop).lineTo(M + colW1, tableTop + rows.length * rowHeight).strokeColor('#cbd5e1').lineWidth(0.5).stroke();

  y = tableTop + rows.length * rowHeight + 14;

  // Regulatory & Operational Guidelines
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5).text('SPECIAL CONDITIONS & REGULATORY COMPLIANCE:', M, y);
  y += 12;

  const clauses = [
    '1. Grid Scheduling & Dispatch: 15-minute block-wise scheduling (Format-D) shall be submitted through the NOAR/WBES portal in strict compliance with Grid-India procedures and CERC Open Access Regulations.',
    '2. Standing Clearance & Approvals: Power supply is subject to the grant of Standing Clearance / Concurrence by concerned SLDCs and approval of NOAR contract.',
    '3. Payment Security Mechanism (PSM): The Buyer shall establish an irrevocable, revolving Letter of Credit (LC) / Bank Guarantee equivalent to 30 days of estimated billing prior to the commencement of power supply.',
    '4. Deviation Settlement (DSM): Any deviations from the approved schedule shall be settled in accordance with CERC (Deviation Settlement Mechanism and Related Matters) Regulations.',
    '5. Validity: This Letter of Intent is valid for formal acceptance within 7 (seven) business days from issuance.'
  ];

  doc.font('Helvetica').fontSize(7.2).fillColor('#334155');
  clauses.forEach(c => {
    doc.text(c, M + 4, y, { width: CONTENT_W - 8, lineGap: 1.5 });
    y += 15;
  });

  y += 10;

  // Signature Block
  const sigY = Math.max(y, PAGE_H - M - 90);
  roundedRect(doc, M, sigY, CONTENT_W / 2 - 6, 75, 4, NAVY_SOFT);
  roundedRect(doc, M + CONTENT_W / 2 + 6, sigY, CONTENT_W / 2 - 6, 75, 4, NAVY_SOFT);

  // Left Signature: SJVN
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8).text('For & on behalf of SJVN LIMITED', M + 10, sigY + 8);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5).text('Authorized Signatory', M + 10, sigY + 44);
  doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(`Power Trading Division | Issued by: ${meta.generatedBy || 'Trading Desk'}`, M + 10, sigY + 56);

  // Right Signature: Buyer Acceptance
  const rightX = M + CONTENT_W / 2 + 6;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8).text('ACCEPTED & CONFIRMED (BUYER)', rightX + 10, sigY + 8);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5).text('Authorized Signatory & Official Seal', rightX + 10, sigY + 44);
  doc.font('Helvetica').fontSize(7).fillColor(MUTED).text('Name: ____________________  Date: ____________', rightX + 10, sigY + 56);

  pageNumbers(doc);
  doc.end();
}

