import { db } from '../db/index.js';
import { newId, pushNotification } from '../util.js';
import _xlsx from 'xlsx';
const XLSX = _xlsx.default || _xlsx;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Overridable so a server started on a throwaway database (the browser suite)
// can be given its own folder. The tracked reports here are what a fresh deploy
// seeds from; nothing in this module writes over one of them.
const CERC_DOWNLOAD_DIR = process.env.SJVN_CERC_DIR || path.join(__dirname, '../../cerc_downloads');

if (!fs.existsSync(CERC_DOWNLOAD_DIR)) {
  fs.mkdirSync(CERC_DOWNLOAD_DIR, { recursive: true });
}

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const monthAbbrs = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

function buildCercUrls(year, month) {
  const mIndex = parseInt(month, 10) - 1;
  const fullMonth = monthNames[mIndex];
  const abbrMonth = monthAbbrs[mIndex];
  
  const excelUrl = encodeURI(`https://cercind.gov.in/${year}/market_monitoring/MMC Report ${abbrMonth} ${year}.xlsx`);
  const pdfUrl = encodeURI(`https://cercind.gov.in/${year}/market_monitoring/MMC Report on Short term market for ${fullMonth} ${year}.pdf`);
  
  return { excelUrl, pdfUrl };
}

function reportPaths(period) {
  const dir = path.join(CERC_DOWNLOAD_DIR, period);
  return {
    excelPath: path.join(dir, `MMC_Report_${period}.xlsx`),
    pdfPath: path.join(dir, `MMC_Report_${period}.pdf`),
  };
}

// Returns the bytes written, or false when CERC has no such file. Never replaces
// a file already on disk: CERC revises its reports in place, and the copy here is
// the one the platform was seeded from.
async function downloadFile(url, destPath) {
  const response = await fetch(url);
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer, { flag: 'wx' });
  return buffer.length;
}

function num(val) {
  if (val === null || val === undefined || val === '-' || val === ' - ' || val === '' || val === 'NA' || val === 'N/A') return null;
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, '').trim());
  return isNaN(n) ? null : n;
}

function findSheet(workbook, patterns) {
  const sheetNames = workbook.SheetNames || [];
  for (const pat of patterns) {
    if (typeof pat === 'string') {
      const pNorm = pat.replace(/[-\s_]/g, '').toLowerCase();
      const match = sheetNames.find(s => s.replace(/[-\s_]/g, '').toLowerCase() === pNorm);
      if (match && workbook.Sheets[match]) return workbook.Sheets[match];
    } else if (pat instanceof RegExp) {
      const match = sheetNames.find(s => pat.test(s));
      if (match && workbook.Sheets[match]) return workbook.Sheets[match];
    }
  }
  return null;
}

// CERC renumbers its tables every year (the DSM day-wise table is Table-29 in
// 2024-03, Table-33 in 2024-08, Table-42 in 2026-02), but the table TITLE in
// the first cell stays constant. Matching by title avoids parsing the wrong
// table — the earlier number-based matcher silently read REC/region tables as
// DSM and seeded garbage rates for pre-2025 reports.
function findSheetByTitle(workbook, titleRegex) {
  for (const name of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    // The title lives in the first cell of the first non-empty row.
    for (const r of rows.slice(0, 3)) {
      const cell = String((r && r[0]) || '');
      if (cell && titleRegex.test(cell)) return sheet;
    }
  }
  return null;
}

/**
 * Table-1, "Volume of short-term transactions of electricity and DSM".
 *
 * The rows run: Bilateral, Through Power Exchanges, then per exchange "(a) DAM,
 * (b) RTM, (c) GDAM, (d) HP-DAM", then Through DSM and the totals, then footnotes.
 * Two things went wrong before this was pulled out. Products were matched with
 * label.includes('DAM') first, which "GDAM" and "HP-DAM" both contain — so every
 * exchange's GDAM and HP-DAM volumes were stored as more DAM rows and the GDAM
 * and HP-DAM branches never ran. And a footnote reading "* includes bilateral
 * short-term transactions under GNA" matched "bilateral" too and overwrote the
 * month's bilateral volume with nothing, which is why half the months showed 0.
 * Products are matched exactly now, and reading stops at the source line.
 */
export function parseVolumeTable(rows) {
  const out = { marketData: [], bilateral_volume_mu: 0, total_short_term_volume_mu: 0, total_generation_mu: null };
  let exchange = null;
  for (const r of rows) {
    const c0 = String(r?.[0] ?? '').trim();
    const c1 = String(r?.[1] ?? '').trim();
    const label = c1 || c0;
    if (/^source\b/i.test(c0) || /^\*/.test(c0)) break;
    const val = num(r?.[2]);
    const push = (product, ex = 'ALL') => out.marketData.push({ category: 'VOLUME', product, exchange: ex, metric: 'Volume', val, unit: 'MU' });

    let m;
    if (/^total short.?-?\s*term/i.test(label)) {
      out.total_short_term_volume_mu = val || 0;
    } else if (/^total generation/i.test(label)) {
      out.total_generation_mu = val;
    } else if (/^bilateral/i.test(label)) {
      out.bilateral_volume_mu = val || 0;
      push('BILATERAL');
    } else if (/power exchanges/i.test(label)) {
      push('PX_TOTAL');
    } else if (/through dsm|^dsm volume/i.test(label)) {
      push('DSM', 'GRID');
    } else if ((m = /^\(i{1,3}\)\s*(IEX|PXIL|HPX)\b/i.exec(label))) {
      exchange = m[1].toUpperCase();
    } else if (exchange && (m = /^\([a-d]\)\s*(HP-?DAM|GDAM|DAM|RTM)\b/i.exec(label))) {
      const product = m[1].toUpperCase().replace('HPDAM', 'HP-DAM');
      push(product, exchange);
    }
  }
  return out;
}

/** "Table-31: VOLUME OF ..." → "Table-31". The number moves between years. */
export function tableNumber(title) {
  const m = /^\s*table[-\s]*(\d+(?:\s*\([a-z,\s]+\))?)/i.exec(String(title || ''));
  return m ? `Table-${m[1].replace(/\s+/g, '')}` : null;
}

// Top-five shares are printed as a fraction in Table 2 (0.812) and as a percent
// in the entity tables (46.78); an index is always 0–1 in these reports, but a
// month printing it in points (1862) is read on the same scale.
const asPercent = (v) => (v == null ? null : (v <= 1 ? v * 100 : v));
const asIndex = (v) => (v == null ? null : (v > 1 ? v / 10000 : v));

/**
 * An entity-wise volume table — who sold, or bought, how much in one segment —
 * or Table 2, each trading licensee's share of what licensees transacted.
 *
 * Rows run: a title, a header, one row per entity in CERC's order, then "Total",
 * the top five, the Herfindahl-Hirschman index, and a source line. Entities are
 * read until the footer; the footer gives the concentration, and nothing below
 * the source line is read.
 */
export function parseParticipantTable(rows, { licensee = false } = {}) {
  const out = {
    source_table: tableNumber(rows?.[0]?.find?.((c) => c)),
    participants: [],
    concentration: { entity_count: 0, total_volume_mu: null, top5_volume_mu: null, top5_share_percent: null, hhi: null },
  };
  const headerIdx = (rows || []).findIndex((r) => (r || []).some((c) => /name of the (entity|trading licensee)/i.test(String(c ?? ''))));
  if (headerIdx < 0) return out;

  for (const r of rows.slice(headerIdx + 1)) {
    if (!r || r.every((c) => c == null || c === '')) continue;
    const c0 = String(r[0] ?? '').trim();
    const name = licensee ? String(r[1] ?? '').trim() : c0;
    const label = c0 || name;

    if (/^(source\b|nldc\b|note\b|\*)/i.test(label)) break;
    if (/^total$/i.test(label)) {
      // Table 2's TOTAL is the shares summing to 1, not a volume.
      if (!licensee) out.concentration.total_volume_mu = num(r[1]);
      continue;
    }
    if (/top\s*5|top five/i.test(label)) {
      if (licensee) {
        out.concentration.top5_share_percent = asPercent(num(r[2]));
      } else {
        out.concentration.top5_volume_mu = num(r[1]);
        out.concentration.top5_share_percent = asPercent(num(r[2]));
      }
      continue;
    }
    if (/herfindahl/i.test(label)) {
      out.concentration.hhi = asIndex(num(r[2]) ?? num(r[1]));
      continue;
    }

    if (licensee) {
      const share = num(r[2]);
      if (!name || share == null) continue;
      out.participants.push({
        rank: num(r[0]) ?? out.participants.length + 1,
        entity_name: name,
        volume_mu: null,
        share_percent: share,
      });
    } else {
      const volume = num(r[1]);
      if (!name || volume == null) continue;
      out.participants.push({
        rank: out.participants.length + 1,
        entity_name: name,
        volume_mu: volume,
        share_percent: num(r[2]),
      });
    }
  }
  out.concentration.entity_count = out.participants.length;
  return out;
}

/**
 * The REC table: for each exchange, the volume bid to buy, bid to sell, their
 * ratio, what traded and at what weighted price — and the same traded volume
 * and price for RECs sold bilaterally through traders.
 *
 * Only the traded volume and price were read before. The bid volumes are the
 * depth of the market: a session where sellers offered six times what buyers
 * wanted clears very differently from one where the two were level.
 */
export function parseRecTable(rows) {
  const out = { marketData: [], volume: {}, price: {} };
  // The exchange names sit on the row under the "Through Power Exchange" band;
  // the traders' column is the one under "Through Traders".
  const namesIdx = (rows || []).findIndex((r) => (r || []).some((c) => /^\s*iex\s*$/i.test(String(c ?? ''))));
  if (namesIdx < 0) return out;
  const columns = [];
  (rows[namesIdx] || []).forEach((c, i) => {
    const name = String(c ?? '').trim().toUpperCase();
    if (['IEX', 'PXIL', 'HPX'].includes(name)) columns.push([i, name]);
  });
  const band = rows[namesIdx - 1] || [];
  const tradersCol = band.findIndex((c) => /trader/i.test(String(c ?? '')));
  if (tradersCol >= 0) columns.push([tradersCol, 'TRADERS']);

  const metricOf = (label) => {
    if (/ratio/i.test(label)) return ['Buy/Sell Bid Ratio', 'ratio'];
    if (/buy\s*bid/i.test(label)) return ['Buy Bid Volume', 'MWh'];
    if (/sell\s*bid/i.test(label)) return ['Sell Bid Volume', 'MWh'];
    if (/traded\s*volume/i.test(label)) return ['Traded Volume', 'MWh'];
    if (/price/i.test(label)) return ['Weighted Avg Price', 'Rs/MWh'];
    return null;
  };

  for (const r of rows.slice(namesIdx + 1)) {
    const c0 = String(r?.[0] ?? '').trim();
    if (/^(source\b|note\b)/i.test(c0)) break;
    const metric = metricOf(String(r?.[1] ?? ''));
    if (!metric) continue;
    for (const [i, exchange] of columns) {
      const val = num(r[i]);
      if (val === null) continue;
      out.marketData.push({ category: 'REC', product: 'REC', exchange, metric: metric[0], val, unit: metric[1] });
      if (metric[0] === 'Traded Volume') out.volume[exchange] = val;
      if (metric[0] === 'Weighted Avg Price') out.price[exchange] = val;
    }
  }
  return out;
}

const CONTRACT_TYPES = [
  [/intra-?\s*day/i, 'INTRADAY'],
  [/day\s*ahead\s*contingency/i, 'DAY_AHEAD_CONTINGENCY'],
  [/any\s*day/i, 'ANY_DAY_SINGLE_SIDED'],
  [/daily/i, 'DAILY'],
  [/weekly/i, 'WEEKLY'],
  [/monthly/i, 'MONTHLY'],
];

/**
 * The term-ahead tables inside the combined price sheet ("Table-3 to 26"): for
 * each exchange, TAM, green TAM and high-price TAM volume and weighted price by
 * contract type.
 *
 * A table starts at its title and ends at its source line. The title names the
 * market and the exchange; each contract row gives the scheduled volume and the
 * price; the Total row is kept only to check the contracts against. A contract
 * that scheduled nothing is printed at a price of 0, which is read as no price.
 */
export function parseTermAheadTables(rows) {
  const out = { contracts: [], printed_totals: [] };
  let current = null;
  for (const r of rows || []) {
    const c0 = String(r?.[0] ?? '').replace(/\s+/g, ' ').trim();
    const m = /^table[-\s]*\d+\s*:.*?\b(high price |green )?(term ahead market|intraday and contingency) of (iex|pxil|hpx)\b/i.exec(c0);
    if (m) {
      const kind = (m[1] || '').trim().toLowerCase();
      current = {
        market: kind === 'green' ? 'GTAM' : kind === 'high price' ? 'HP-TAM' : 'TAM',
        exchange: m[3].toUpperCase(),
        source_table: tableNumber(c0),
      };
      continue;
    }
    if (/^table/i.test(c0)) { current = null; continue; }
    if (!current) continue;
    if (/^source\b/i.test(c0)) { current = null; continue; }

    const label = String(r?.[1] ?? '').replace(/\s+/g, ' ').trim();
    const volume = num(r?.[2]);
    if (/^total$/i.test(label)) {
      out.printed_totals.push({ ...current, volume_mu: volume });
      continue;
    }
    // A contract row is numbered, or names a contract type. The label is not
    // always "... Contracts": some months print plain "Monthly".
    const isContract = num(r?.[0]) !== null || CONTRACT_TYPES.some(([re]) => re.test(label));
    if (!label || !isContract || volume === null) continue;
    const price = num(r?.[3]);
    out.contracts.push({
      ...current,
      contract_type: (CONTRACT_TYPES.find(([re]) => re.test(label)) || [null, 'OTHER'])[1],
      contract_label: label,
      volume_mu: volume,
      price_rs_kwh: volume > 0 && price !== null && price > 0 ? price : null,
    });
  }
  return out;
}

function saveTermAhead(workbook, period, logId) {
  const sheet = findSheet(workbook, ['Table-3 to 26', 'Table-3 to 17', 'Table 3 to 17', 'Table 3 to 26', /^table[- ]*3\s*to/i]);
  const parsed = sheet ? parseTermAheadTables(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })) : { contracts: [] };
  db.transaction(() => {
    db.prepare('DELETE FROM cerc_term_ahead WHERE report_period = ?').run(period);
    const insert = db.prepare(`
      INSERT OR REPLACE INTO cerc_term_ahead (id, report_period, market, exchange, contract_type, contract_label, volume_mu, price_rs_kwh, source_table, fetch_log_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of parsed.contracts) {
      insert.run(newId('CTA'), period, c.market, c.exchange, c.contract_type, c.contract_label, c.volume_mu, c.price_rs_kwh, c.source_table, logId);
    }
  })();
  return parsed.contracts.length;
}

/** The entity-wise tables, by title. Each is present from the month it began. */
export const PARTICIPANT_TABLES = [
  { segment: 'TRADING_LICENSEE', side: 'ALL', title: /PERCENTAGE SHARE OF ELECTRICITY TRANSACTED BY TRADING LICENSEES/i, licensee: true },
  { segment: 'BILATERAL', side: 'SELL', title: /VOLUME OF ELECTRICITY SOLD THROUGH BILATERAL/i },
  { segment: 'BILATERAL', side: 'BUY', title: /VOLUME OF ELECTRICITY PURCHASED THROUGH BILATERAL/i },
  { segment: 'DAM', side: 'SELL', title: /VOLUME OF ELECTRICITY SOLD IN DAY AHEAD MARKET/i },
  { segment: 'DAM', side: 'BUY', title: /VOLUME OF ELECTRICITY PURCHASED IN DAY AHEAD MARKET/i },
  { segment: 'GDAM', side: 'SELL', title: /VOLUME OF ELECTRICITY SOLD IN GREEN DAY AHEAD MARKET/i },
  { segment: 'GDAM', side: 'BUY', title: /VOLUME OF ELECTRICITY PURCHASED IN GREEN DAY AHEAD MARKET/i },
  { segment: 'HP-DAM', side: 'SELL', title: /VOLUME OF ELECTRICITY SOLD IN HIGH PRICE DAY AHEAD MARKET/i },
  { segment: 'HP-DAM', side: 'BUY', title: /VOLUME OF ELECTRICITY PURCHASED IN HIGH PRICE DAY AHEAD MARKET/i },
  { segment: 'RTM', side: 'SELL', title: /VOLUME OF ELECTRICITY SOLD IN REAL TIME MARKET/i },
  { segment: 'RTM', side: 'BUY', title: /VOLUME OF ELECTRICITY PURCHASED IN REAL TIME MARKET/i },
];

/** Write one report's participant tables, replacing whatever that period held. */
function saveParticipants(workbook, period, logId) {
  let written = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM cerc_participants WHERE report_period = ?').run(period);
    db.prepare('DELETE FROM cerc_market_concentration WHERE report_period = ?').run(period);
    const insertRow = db.prepare(`
      INSERT INTO cerc_participants (id, report_period, segment, side, rank, entity_name, volume_mu, share_percent, source_table, fetch_log_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertConc = db.prepare(`
      INSERT INTO cerc_market_concentration (id, report_period, segment, side, entity_count, total_volume_mu,
        top5_volume_mu, top5_share_percent, hhi, source_table, fetch_log_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const spec of PARTICIPANT_TABLES) {
      const sheet = findSheetByTitle(workbook, spec.title);
      if (!sheet) continue;
      const parsed = parseParticipantTable(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }), { licensee: !!spec.licensee });
      if (!parsed.participants.length) continue;
      for (const p of parsed.participants) {
        insertRow.run(newId('CPT'), period, spec.segment, spec.side, p.rank, p.entity_name, p.volume_mu, p.share_percent, parsed.source_table, logId);
        written += 1;
      }
      const c = parsed.concentration;
      insertConc.run(newId('CMC'), period, spec.segment, spec.side, c.entity_count, c.total_volume_mu,
        c.top5_volume_mu, c.top5_share_percent, c.hhi, parsed.source_table, logId);
    }
  })();
  return written;
}

/**
 * Periods seeded before parseVolumeTable carry the mislabelled volume rows, and
 * periods seeded before the participant tables were read carry none of them. A
 * period whose local report is on disk and that lacks either is parsed again
 * from that file — the same file, so only what was misread or skipped changes.
 */
function repairLocalVolumes() {
  if (!fs.existsSync(CERC_DOWNLOAD_DIR)) return 0;
  let repaired = 0;
  for (const d of fs.readdirSync(CERC_DOWNLOAD_DIR).sort()) {
    if (!/^\d{4}-\d{2}$/.test(d)) continue;
    const summaryRow = db.prepare('SELECT fetch_log_id FROM cerc_monthly_summary WHERE report_period = ?').get(d);
    if (!summaryRow) continue;
    const { excelPath } = reportPaths(d);
    if (!fs.existsSync(excelPath)) continue;
    const labelled = db.prepare(`
      SELECT COUNT(*) AS n FROM cerc_market_data WHERE report_period = ? AND data_category = 'VOLUME' AND product IN ('GDAM', 'PX_TOTAL')
    `).get(d).n;
    // Seeded before the participant tables and REC bid depth were read.
    const participants = db.prepare('SELECT COUNT(*) AS n FROM cerc_participants WHERE report_period = ?').get(d).n;
    const termAhead = db.prepare('SELECT COUNT(*) AS n FROM cerc_term_ahead WHERE report_period = ?').get(d).n;
    if (labelled && participants && termAhead) continue;
    try {
      parseAndSaveExcel(excelPath, d, summaryRow.fetch_log_id);
      repaired += 1;
    } catch (e) {
      console.warn(`[CERC Scraper] Volume repair failed for ${d}:`, e.message);
    }
  }
  return repaired;
}

function parseAndSaveExcel(excelPath, period, logId) {
  const workbook = XLSX.readFile(excelPath);
  let records = 0;
  
  console.log(`[CERC Scraper] Parsing Excel for ${period}. Sheets:`, workbook.SheetNames);

  // Clear previous records for this period to allow re-runs
  db.prepare(`DELETE FROM cerc_market_data WHERE report_period = ?`).run(period);

  const summary = {
    report_period: period,
    total_short_term_volume_mu: 0,
    dam_iex_avg_price: null,
    dam_pxil_avg_price: null,
    dam_hpx_avg_price: null,
    gdam_iex_avg_price: null,
    rtm_iex_avg_price: null,
    dsm_avg_charge: null,
    dsm_min_charge: null,
    dsm_max_charge: null,
    rec_iex_volume: 0,
    rec_iex_avg_price: null,
    rec_pxil_volume: 0,
    rec_pxil_avg_price: null,
    rec_hpx_volume: 0,
    rec_hpx_avg_price: null,
    bilateral_volume_mu: 0,
    trading_margin_avg: null,
  };

  const marketData = [];

  // 1. Sheet "Table-1": Volumes
  const t1Sheet = findSheet(workbook, ['Table-1', 'Table 1', 'Summary Table-1 (N)', 'Summary Table-1', /^table[- ]*1$/i, /^summary table/i]);
  if (t1Sheet) {
    const volumes = parseVolumeTable(XLSX.utils.sheet_to_json(t1Sheet, { header: 1 }));
    summary.bilateral_volume_mu = volumes.bilateral_volume_mu;
    summary.total_short_term_volume_mu = volumes.total_short_term_volume_mu;
    marketData.push(...volumes.marketData);
  }

  // 2. Sheet "Table-3 to 26" or "Table-3 to 17": Exchange Prices
  const t3Sheet = findSheet(workbook, ['Table-3 to 26', 'Table-3 to 17', 'Table 3 to 17', 'Table 3 to 26', /^table[- ]*3\s*to/i]);
  if (t3Sheet) {
    const rows = XLSX.utils.sheet_to_json(t3Sheet, { header: 1 });
    let currentTable = '';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const title = String(r[0] || '').trim();
      if (title.startsWith('Table-') || title.startsWith('Table ')) {
        currentTable = title;
      }

      const isDam = (currentTable.includes('Table-5:') || currentTable.includes('Table 5:') || currentTable.includes('DAY AHEAD MARKET')) && !currentTable.includes('GREEN') && !currentTable.includes('HIGH PRICE');
      const isGdam = currentTable.includes('Table-6:') || currentTable.includes('Table 6:') || currentTable.includes('GREEN DAY AHEAD MARKET');
      const isHpDam = currentTable.includes('Table-7:') || currentTable.includes('Table 7:') || currentTable.includes('HIGH PRICE');
      const isRtm = currentTable.includes('REAL TIME MARKET');

      if (isDam) {
        if (r[1] === 'Minimum' || r[1] === 'Maximum' || r[1] === 'Weighted Average') {
          const metric = r[1];
          const iex = num(r[2]), pxil = num(r[3]), hpx = num(r[4]);
          if (iex !== null) marketData.push({ category: 'PRICE', product: 'DAM', exchange: 'IEX', metric, val: iex, unit: 'Rs/kWh' });
          if (pxil !== null) marketData.push({ category: 'PRICE', product: 'DAM', exchange: 'PXIL', metric, val: pxil, unit: 'Rs/kWh' });
          if (hpx !== null) marketData.push({ category: 'PRICE', product: 'DAM', exchange: 'HPX', metric, val: hpx, unit: 'Rs/kWh' });
          if (metric === 'Weighted Average') {
            summary.dam_iex_avg_price = iex;
            summary.dam_pxil_avg_price = pxil;
            summary.dam_hpx_avg_price = hpx;
          }
        }
      } else if (isGdam) {
        if (r[1] === 'Minimum' || r[1] === 'Maximum' || r[1] === 'Weighted Average') {
          const metric = r[1];
          const iex = num(r[2]), pxil = num(r[3]), hpx = num(r[4]);
          if (iex !== null) marketData.push({ category: 'PRICE', product: 'GDAM', exchange: 'IEX', metric, val: iex, unit: 'Rs/kWh' });
          if (pxil !== null) marketData.push({ category: 'PRICE', product: 'GDAM', exchange: 'PXIL', metric, val: pxil, unit: 'Rs/kWh' });
          if (hpx !== null) marketData.push({ category: 'PRICE', product: 'GDAM', exchange: 'HPX', metric, val: hpx, unit: 'Rs/kWh' });
          if (metric === 'Weighted Average') summary.gdam_iex_avg_price = iex;
        }
      } else if (isHpDam) {
        if (r[1] === 'Minimum' || r[1] === 'Maximum' || r[1] === 'Weighted Average') {
          const metric = r[1];
          const iex = num(r[2]), pxil = num(r[3]), hpx = num(r[4]);
          if (iex !== null) marketData.push({ category: 'PRICE', product: 'HP-DAM', exchange: 'IEX', metric, val: iex, unit: 'Rs/kWh' });
          if (pxil !== null) marketData.push({ category: 'PRICE', product: 'HP-DAM', exchange: 'PXIL', metric, val: pxil, unit: 'Rs/kWh' });
          if (hpx !== null) marketData.push({ category: 'PRICE', product: 'HP-DAM', exchange: 'HPX', metric, val: hpx, unit: 'Rs/kWh' });
        }
      } else if (isRtm) {
        if (r[1] === 'Minimum' || r[1] === 'Maximum' || r[1] === 'Weighted Average') {
          const metric = r[1];
          const iex = num(r[2]), pxil = num(r[3]), hpx = num(r[4]);
          if (iex !== null) marketData.push({ category: 'PRICE', product: 'RTM', exchange: 'IEX', metric, val: iex, unit: 'Rs/kWh' });
          if (pxil !== null) marketData.push({ category: 'PRICE', product: 'RTM', exchange: 'PXIL', metric, val: pxil, unit: 'Rs/kWh' });
          if (hpx !== null) marketData.push({ category: 'PRICE', product: 'RTM', exchange: 'HPX', metric, val: hpx, unit: 'Rs/kWh' });
          if (metric === 'Weighted Average') summary.rtm_iex_avg_price = iex;
        }
      }
    }
  }

  // 3. Daily trend: Table 40(a) / Table 31(a) / Table 29(a) / Table 27(a) DAM daily
  const t40a = findSheet(workbook, ['Table 40(a)', 'Table-40(a)', 'Table 31(a)', 'Table-31(a)', 'Table 29(a)', 'Table-29(a)', 'Table 27(a)', 'Table-27(a)', /.*(?:40|31|29|27)\s*\(a\).*/i]);
  if (t40a) {
    const rows = XLSX.utils.sheet_to_json(t40a, { header: 1 });
    let day = 1;
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r[0] === undefined || r[0] === null || r[0] === '' || (typeof r[0] === 'string' && r[0].toLowerCase().includes('total'))) continue;
      const iexAvg = num(r[3]);
      if (iexAvg !== null) {
        marketData.push({ category: 'PRICE', product: 'DAM', exchange: 'IEX', metric: 'Daily Price', val: iexAvg, unit: 'Rs/kWh', day_of_month: day });
        day++;
      }
    }
  }

  // 4. Daily trend: GDAM daily
  const t40b = findSheet(workbook, ['Table 40(b)', 'Table-40(b)', 'Table 31(b)', 'Table-31(b)', 'Table 29(b)', 'Table-29(b)', 'Table 27(b)', 'Table-27(b)', /.*(?:40|31|29|27)\s*\(b\).*/i]);
  if (t40b) {
    const rows = XLSX.utils.sheet_to_json(t40b, { header: 1 });
    let day = 1;
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r[0] === undefined || r[0] === null || r[0] === '' || (typeof r[0] === 'string' && r[0].toLowerCase().includes('total'))) continue;
      const iexAvg = num(r[3]);
      if (iexAvg !== null) {
        marketData.push({ category: 'PRICE', product: 'GDAM', exchange: 'IEX', metric: 'Daily Price', val: iexAvg, unit: 'Rs/kWh', day_of_month: day });
        day++;
      }
    }
  }

  // 5. Daily trend: RTM daily
  const t40c = findSheet(workbook, ['Table 40(c)', 'Table-40(c)', 'Table 31(c)', 'Table-31(c)', 'Table 29(c)', 'Table-29(c)', 'Table 27(c)', 'Table-27(c)', /.*(?:40|31|29|27)\s*\(c\).*/i]);
  if (t40c) {
    const rows = XLSX.utils.sheet_to_json(t40c, { header: 1 });
    let day = 1;
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r[0] === undefined || r[0] === null || r[0] === '' || (typeof r[0] === 'string' && r[0].toLowerCase().includes('total'))) continue;
      const iexAvg = num(r[3]);
      if (iexAvg !== null) {
        marketData.push({ category: 'PRICE', product: 'RTM', exchange: 'IEX', metric: 'Daily Price', val: iexAvg, unit: 'Rs/kWh', day_of_month: day });
        day++;
      }
    }
  }

  // 6. DSM Day-wise (title is constant across years; table number is not)
  const t42 = findSheetByTitle(workbook, /VOLUME AND CHARGES UNDER DSM/i);
  if (t42) {
    const rows = XLSX.utils.sheet_to_json(t42, { header: 1 });
    let dsmAvgSum = 0, dsmCount = 0, minDsm = Infinity, maxDsm = -Infinity;
    let day = 1;
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r[0] === undefined || r[0] === null || r[0] === '' || (typeof r[0] === 'string' && r[0].toLowerCase().includes('total'))) continue;
      const dsmVol = num(r[1]);
      const minCharge = num(r[2]);
      const maxCharge = num(r[3]);
      const avgCharge = num(r[4]);
      if (avgCharge !== null) {
        dsmAvgSum += avgCharge;
        dsmCount++;
        if (minCharge !== null && minCharge < minDsm) minDsm = minCharge;
        if (maxCharge !== null && maxCharge > maxDsm) maxDsm = maxCharge;
        marketData.push({ category: 'DSM', product: 'DSM', exchange: 'GRID', metric: 'Daily Avg Charge', val: avgCharge, unit: 'Rs/kWh', day_of_month: day });
        if (dsmVol !== null) {
          marketData.push({ category: 'DSM', product: 'DSM', exchange: 'GRID', metric: 'Daily Volume', val: dsmVol, unit: 'MU', day_of_month: day });
        }
        day++;
      }
    }
    if (dsmCount > 0) {
      summary.dsm_avg_charge = +(dsmAvgSum / dsmCount).toFixed(4);
      summary.dsm_min_charge = minDsm !== Infinity ? minDsm : null;
      summary.dsm_max_charge = maxDsm !== -Infinity ? maxDsm : null;
    }
  }

  // 7. REC (title is constant across years; table number is not): bid depth,
  // what traded and at what price, on each exchange and through traders.
  const t45 = findSheetByTitle(workbook, /RENEWABLE ENERGY CERTIFICATES/i);
  if (t45) {
    const rec = parseRecTable(XLSX.utils.sheet_to_json(t45, { header: 1, defval: null }));
    marketData.push(...rec.marketData);
    summary.rec_iex_volume = rec.volume.IEX || 0;
    summary.rec_pxil_volume = rec.volume.PXIL || 0;
    summary.rec_hpx_volume = rec.volume.HPX || 0;
    summary.rec_iex_avg_price = rec.price.IEX ?? null;
    summary.rec_pxil_avg_price = rec.price.PXIL ?? null;
    summary.rec_hpx_avg_price = rec.price.HPX ?? null;
  }

  // 8. Who traded: licensee shares and the entity-wise volume tables.
  const participants = saveParticipants(workbook, period, logId);
  records += participants;

  // 9. Term-ahead markets by contract type, on each exchange.
  records += saveTermAhead(workbook, period, logId);

  // Insert market data records
  const insertStmt = db.prepare(`
    INSERT INTO cerc_market_data (id, report_period, data_category, product, exchange, metric_name, metric_value, metric_unit, day_of_month, source_table, fetch_log_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const item of marketData) {
    insertStmt.run(
      newId('CMD'),
      period,
      item.category,
      item.product,
      item.exchange || 'ALL',
      item.metric,
      item.val,
      item.unit,
      item.day_of_month || null,
      'EXCEL',
      logId
    );
    records++;
  }

  // Upsert monthly summary
  try {
    db.prepare(`
      INSERT INTO cerc_monthly_summary (
        id, report_period, total_short_term_volume_mu,
        dam_iex_avg_price, dam_pxil_avg_price, dam_hpx_avg_price,
        gdam_iex_avg_price, rtm_iex_avg_price,
        dsm_avg_charge, dsm_min_charge, dsm_max_charge,
        rec_iex_volume, rec_iex_avg_price,
        rec_pxil_volume, rec_pxil_avg_price,
        rec_hpx_volume, rec_hpx_avg_price,
        bilateral_volume_mu, trading_margin_avg, fetch_log_id
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?
      )
      ON CONFLICT(report_period) DO UPDATE SET
        total_short_term_volume_mu = excluded.total_short_term_volume_mu,
        dam_iex_avg_price = excluded.dam_iex_avg_price,
        dam_pxil_avg_price = excluded.dam_pxil_avg_price,
        dam_hpx_avg_price = excluded.dam_hpx_avg_price,
        gdam_iex_avg_price = excluded.gdam_iex_avg_price,
        rtm_iex_avg_price = excluded.rtm_iex_avg_price,
        dsm_avg_charge = excluded.dsm_avg_charge,
        dsm_min_charge = excluded.dsm_min_charge,
        dsm_max_charge = excluded.dsm_max_charge,
        rec_iex_volume = excluded.rec_iex_volume,
        rec_iex_avg_price = excluded.rec_iex_avg_price,
        rec_pxil_volume = excluded.rec_pxil_volume,
        rec_pxil_avg_price = excluded.rec_pxil_avg_price,
        rec_hpx_volume = excluded.rec_hpx_volume,
        rec_hpx_avg_price = excluded.rec_hpx_avg_price,
        bilateral_volume_mu = excluded.bilateral_volume_mu,
        fetch_log_id = excluded.fetch_log_id
    `).run(
      newId('CMS'),
      period,
      summary.total_short_term_volume_mu,
      summary.dam_iex_avg_price,
      summary.dam_pxil_avg_price,
      summary.dam_hpx_avg_price,
      summary.gdam_iex_avg_price,
      summary.rtm_iex_avg_price,
      summary.dsm_avg_charge,
      summary.dsm_min_charge,
      summary.dsm_max_charge,
      summary.rec_iex_volume,
      summary.rec_iex_avg_price,
      summary.rec_pxil_volume,
      summary.rec_pxil_avg_price,
      summary.rec_hpx_volume,
      summary.rec_hpx_avg_price,
      summary.bilateral_volume_mu,
      summary.trading_margin_avg,
      logId
    );
  } catch (summaryErr) {
    console.warn(`[CERC Scraper] Error updating monthly summary:`, summaryErr.message);
  }

  return records;
}

// Every attempt at a period is logged, found or not; autoSeedDecision counts them.
function openFetchLog(period) {
  const [yearStr, monthStr] = period.split('-');
  const { excelUrl, pdfUrl } = buildCercUrls(yearStr, monthStr);
  const logId = newId('CERC');
  db.prepare(`
    INSERT INTO cerc_fetch_log (id, report_period, report_year, report_month, excel_url, pdf_url, status, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING', datetime('now'))
  `).run(logId, period, parseInt(yearStr, 10), parseInt(monthStr, 10), excelUrl, pdfUrl);
  return logId;
}

function failFetchLog(logId, period, err) {
  db.prepare(`UPDATE cerc_fetch_log SET status = 'FAILED', error_message = ? WHERE id = ?`).run(err.message, logId);
  pushNotification({
    role: 'SJVN_ADMIN',
    type: 'CERC_SCRAPER',
    message: `CERC Scraper FAILED for ${period}: ${err.message}.`,
  });
}

/**
 * Download step: brings a month CERC has published into the local folder. Only
 * for a month with no report on disk. False when CERC has not published it yet.
 */
async function downloadCercReport(period) {
  const [yearStr, monthStr] = period.split('-');
  const { excelUrl, pdfUrl } = buildCercUrls(yearStr, monthStr);
  const { excelPath, pdfPath } = reportPaths(period);
  if (!(await downloadFile(excelUrl, excelPath))) return false;
  if (!fs.existsSync(pdfPath)) {
    try {
      await downloadFile(pdfUrl, pdfPath);
    } catch (e) {
      console.warn(`[CERC Scraper] Could not download PDF for ${period}`);
    }
  }
  return true;
}

/**
 * Parse-and-store step: reads the month's report on disk into the market tables.
 * Touches the database only — never the network, never the file.
 */
function storeCercReport(period, logId = openFetchLog(period)) {
  const { excelPath, pdfPath } = reportPaths(period);
  try {
    if (!fs.existsSync(excelPath)) throw new Error(`No report on disk at ${excelPath}`);
    const excelSize = fs.statSync(excelPath).size;

    db.prepare(`
      UPDATE cerc_fetch_log SET status = 'DOWNLOADED', local_excel_path = ?, local_pdf_path = ? WHERE id = ?
    `).run(excelPath, fs.existsSync(pdfPath) ? pdfPath : null, logId);

    // Store in documents table safely (created_by NULL to avoid foreign key errors)
    try {
      const docId = uuidv4();
      db.prepare(`
        INSERT INTO documents (id, contract_id, document_type, category, title, created_by)
        VALUES (?, NULL, 'CERC_REPORT', 'RECORD', ?, NULL)
      `).run(docId, `CERC MMC Report ${period}`);

      const versionId = uuidv4();
      db.prepare(`
        INSERT INTO document_versions (id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type, verification_status, created_by)
        VALUES (?, ?, 1, ?, ?, ?, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'NOT_REQUIRED', NULL)
      `).run(versionId, docId, excelPath, `MMC_Report_${period}.xlsx`, excelSize);

      db.prepare(`UPDATE cerc_fetch_log SET document_id = ? WHERE id = ?`).run(docId, logId);
    } catch (docErr) {
      console.warn(`[CERC Scraper] Warning inserting doc record:`, docErr.message);
    }

    const recordsCreated = parseAndSaveExcel(excelPath, period, logId);

    db.prepare(`
      UPDATE cerc_fetch_log SET status = 'PROCESSED', records_created = ?, processed_at = datetime('now') WHERE id = ?
    `).run(recordsCreated, logId);

    pushNotification({
      role: 'TRADING_USER',
      type: 'CERC_SCRAPER',
      message: `CERC MMC Report processed for ${period} (${recordsCreated} records imported)`,
    });

    return { logId, status: 'PROCESSED', recordsCreated };
  } catch (err) {
    failFetchLog(logId, period, err);
    throw err;
  }
}

// Reads a month into the market tables, first downloading it from CERC only when
// there is no report for it on disk. To take up a revised report, replace the
// file on disk and fetch the month again.
async function fetchCercReport(period) {
  if (fs.existsSync(reportPaths(period).excelPath)) return storeCercReport(period);

  const logId = openFetchLog(period);
  let found;
  try {
    found = await downloadCercReport(period);
  } catch (err) {
    failFetchLog(logId, period, err);
    throw err;
  }
  if (!found) {
    console.log(`[CERC Scraper] Excel file not found (404) for ${period}`);
    db.prepare(`UPDATE cerc_fetch_log SET status = 'FAILED', error_message = 'Excel file not found (404)' WHERE id = ?`).run(logId);
    return { logId, status: 'NOT_FOUND' };
  }
  return { ...storeCercReport(period, logId), fetched: 1 };
}

async function scanForNewReports() {
  console.log('[CERC Scraper] ═══════ Scanning for new reports ═══════');
  const now = new Date();
  
  const candidatePeriods = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    candidatePeriods.push(`${yyyy}-${mm}`);
  }
  
  let fetchedCount = 0;
  for (const period of candidatePeriods) {
    const existing = db.prepare(`SELECT id, status FROM cerc_fetch_log WHERE report_period = ? ORDER BY fetched_at DESC LIMIT 1`).get(period);
    if (existing && ['PROCESSED', 'DOWNLOADED'].includes(existing.status)) {
      continue;
    }
    try {
      console.log(`[CERC Scraper] Checking ${period}...`);
      const result = await fetchCercReport(period);
      if (result.status === 'PROCESSED') {
        fetchedCount++;
      }
    } catch (err) {
      console.error(`[CERC Scraper] Error on ${period}:`, err.message);
    }
  }
  console.log('[CERC Scraper] ═══════ Scan complete ═══════');
  return { fetched: fetchedCount };
}

function getCercFetchLog(filters = {}) {
  let sql = `SELECT * FROM cerc_fetch_log WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.report_period) { sql += ' AND report_period = ?'; params.push(filters.report_period); }
  sql += ' ORDER BY fetched_at DESC LIMIT 100';
  return db.prepare(sql).all(...params);
}

function getCercStatus() {
  const latest = db.prepare(`
    SELECT * FROM cerc_fetch_log ORDER BY fetched_at DESC LIMIT 1
  `).get();

  const totalProcessed = db.prepare(`
    SELECT COUNT(*) as cnt FROM cerc_fetch_log WHERE status = 'PROCESSED'
  `).get();

  const totalFailed = db.prepare(`
    SELECT COUNT(*) as cnt FROM cerc_fetch_log WHERE status = 'FAILED'
  `).get();

  return {
    latest_fetch: latest || null,
    total_processed: totalProcessed?.cnt || 0,
    total_failed: totalFailed?.cnt || 0,
  };
}

// A period that keeps failing to produce a summary would otherwise be retried on
// every boot, and each retry logs a failure and notifies the admins. After this
// many attempts it is left alone until the cooldown passes — some CERC months
// simply do not carry the tables this parser needs, and re-reading them on every
// restart buys nothing.
const AUTOSEED_MAX_ATTEMPTS = 3;
const AUTOSEED_COOLDOWN_HOURS = 24 * 7;

// Whether to try this period now, and why not when the answer is no.
function autoSeedDecision(period) {
  if (db.prepare(`SELECT id FROM cerc_monthly_summary WHERE report_period = ?`).get(period)) {
    return { seed: false, reason: 'already seeded' };
  }
  const row = db.prepare(`
    SELECT COUNT(*) AS attempts,
           MAX(COALESCE(fetched_at, created_at)) AS last_attempt
    FROM cerc_fetch_log WHERE report_period = ?
  `).get(period);
  if (!row || row.attempts < AUTOSEED_MAX_ATTEMPTS) return { seed: true };

  const last = row.last_attempt ? new Date(`${String(row.last_attempt).replace(' ', 'T')}Z`) : null;
  const hoursSince = last ? (Date.now() - last.getTime()) / 36e5 : Infinity;
  if (hoursSince < AUTOSEED_COOLDOWN_HOURS) {
    return {
      seed: false,
      reason: `${row.attempts} failed attempt(s), next retry in ${Math.ceil(AUTOSEED_COOLDOWN_HOURS - hoursSince)}h`,
    };
  }
  return { seed: true };
}

// Seeds from the reports on disk and nothing else: boot never reaches
// cercind.gov.in. Months with no report on disk are the scheduled scan's job.
async function autoSeedLocalReports() {
  try {
    console.log('[CERC Scraper] Checking for local reports to auto-seed...');
    if (!fs.existsSync(CERC_DOWNLOAD_DIR)) return;
    const dirs = fs.readdirSync(CERC_DOWNLOAD_DIR).sort();
    let skipped = 0;
    for (const d of dirs) {
      if (!/^\d{4}-\d{2}$/.test(d)) continue;
      if (!fs.existsSync(reportPaths(d).excelPath)) continue;
      const decision = autoSeedDecision(d);
      if (!decision.seed) {
        if (decision.reason !== 'already seeded') {
          console.log(`[CERC Scraper] Skipping ${d} — ${decision.reason}`);
          skipped++;
        }
        continue;
      }
      console.log(`[CERC Scraper] Auto-seeding local report for ${d}...`);
      try {
        storeCercReport(d);
        console.log(`[CERC Scraper] Auto-seeded local report for ${d}`);
      } catch (e) {
        console.warn(`[CERC Scraper] Auto-seed failed for ${d}:`, e.message);
      }
    }
    if (skipped) console.log(`[CERC Scraper] ${skipped} period(s) in retry cooldown`);
    const repaired = repairLocalVolumes();
    if (repaired) console.log(`[CERC Scraper] Re-read ${repaired} local report(s) seeded before their volumes, participants, term-ahead markets or REC bid depth were read`);
  } catch (err) {
    console.warn(`[CERC Scraper] autoSeedLocalReports error:`, err.message);
  }
}

export const cercScraper = {
  buildCercUrls,
  autoSeedDecision,
  fetchCercReport,
  downloadCercReport,
  storeCercReport,
  parseAndSaveExcel,
  scanForNewReports,
  getCercFetchLog,
  getCercStatus,
  autoSeedLocalReports,
  repairLocalVolumes,
  parseVolumeTable,
};
