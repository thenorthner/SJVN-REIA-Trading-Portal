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
const CERC_DOWNLOAD_DIR = path.join(__dirname, '../../cerc_downloads');

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

async function downloadFile(url, destPath) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
          console.log(`[CERC Scraper] Remote returned 404, but found cached local file: ${destPath}`);
          return fs.statSync(destPath).size;
        }
        return false;
      }
      throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    return buffer.length;
  } catch (err) {
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
      console.log(`[CERC Scraper] Network fetch failed (${err.message}), using cached local file: ${destPath}`);
      return fs.statSync(destPath).size;
    }
    throw err;
  }
}

function num(val) {
  if (val === null || val === undefined || val === '-' || val === ' - ' || val === '' || val === 'NA' || val === 'N/A') return null;
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, '').trim());
  return isNaN(n) ? null : n;
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
  const t1Sheet = workbook.Sheets['Table-1'] || workbook.Sheets['Table 1'];
  if (t1Sheet) {
    const rows = XLSX.utils.sheet_to_json(t1Sheet, { header: 1 });
    let currentExchange = null;
    for (const r of rows) {
      const label = String(r[1] || '').trim();
      const val = num(r[2]);
      if (label.toLowerCase().includes('bilateral')) {
        summary.bilateral_volume_mu = val || 0;
        marketData.push({ category: 'VOLUME', product: 'BILATERAL', exchange: 'ALL', metric: 'Volume', val, unit: 'MU' });
      } else if (label.toLowerCase().includes('total short-term')) {
        summary.total_short_term_volume_mu = val || 0;
      } else if (label.toLowerCase().includes('(i) iex') || label.toLowerCase().includes('iex')) {
        currentExchange = 'IEX';
      } else if (label.toLowerCase().includes('(ii)pxil') || label.toLowerCase().includes('pxil')) {
        currentExchange = 'PXIL';
      } else if (label.toLowerCase().includes('(iii)hpx') || label.toLowerCase().includes('hpx')) {
        currentExchange = 'HPX';
      } else if (label.includes('DAM') && currentExchange) {
        marketData.push({ category: 'VOLUME', product: 'DAM', exchange: currentExchange, metric: 'Volume', val, unit: 'MU' });
      } else if (label.includes('RTM') && currentExchange) {
        marketData.push({ category: 'VOLUME', product: 'RTM', exchange: currentExchange, metric: 'Volume', val, unit: 'MU' });
      } else if (label.includes('GDAM') && currentExchange) {
        marketData.push({ category: 'VOLUME', product: 'GDAM', exchange: currentExchange, metric: 'Volume', val, unit: 'MU' });
      } else if (label.includes('HP-DAM') && currentExchange) {
        marketData.push({ category: 'VOLUME', product: 'HP-DAM', exchange: currentExchange, metric: 'Volume', val, unit: 'MU' });
      } else if (label.toLowerCase().includes('through dsm')) {
        marketData.push({ category: 'VOLUME', product: 'DSM', exchange: 'GRID', metric: 'Volume', val, unit: 'MU' });
      }
    }
  }

  // 2. Sheet "Table-3 to 26": Exchange Prices
  const t3Sheet = workbook.Sheets['Table-3 to 26'];
  if (t3Sheet) {
    const rows = XLSX.utils.sheet_to_json(t3Sheet, { header: 1 });
    let currentTable = '';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const title = String(r[0] || '');
      if (title.startsWith('Table-') || title.startsWith('Table ')) {
        currentTable = title;
      }

      if (currentTable.includes('Table-5:') || currentTable.includes('Table 5:')) { // DAM Prices
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
      } else if (currentTable.includes('Table-6:') || currentTable.includes('Table 6:')) { // GDAM Prices
        if (r[1] === 'Minimum' || r[1] === 'Maximum' || r[1] === 'Weighted Average') {
          const metric = r[1];
          const iex = num(r[2]), pxil = num(r[3]), hpx = num(r[4]);
          if (iex !== null) marketData.push({ category: 'PRICE', product: 'GDAM', exchange: 'IEX', metric, val: iex, unit: 'Rs/kWh' });
          if (pxil !== null) marketData.push({ category: 'PRICE', product: 'GDAM', exchange: 'PXIL', metric, val: pxil, unit: 'Rs/kWh' });
          if (hpx !== null) marketData.push({ category: 'PRICE', product: 'GDAM', exchange: 'HPX', metric, val: hpx, unit: 'Rs/kWh' });
          if (metric === 'Weighted Average') summary.gdam_iex_avg_price = iex;
        }
      } else if ((currentTable.includes('Table-8:') || currentTable.includes('Table-7:')) && currentTable.includes('REAL TIME MARKET')) { // RTM Prices
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

  // 3. Daily trend: Table 40(a) DAM daily
  const t40a = workbook.Sheets['Table 40(a)'] || workbook.Sheets['Table-40(a)'];
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

  // 4. Daily trend: Table 40(b) GDAM daily
  const t40b = workbook.Sheets['Table 40(b)'] || workbook.Sheets['Table-40(b)'];
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

  // 5. Daily trend: Table 40(c) RTM daily
  const t40c = workbook.Sheets['Table 40(c)'] || workbook.Sheets['Table-40(c)'];
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

  // 6. Table 42: DSM Day-wise
  const t42 = workbook.Sheets['Table 42'] || workbook.Sheets['Table-42'];
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

  // 7. Table 45: REC
  const t45 = workbook.Sheets['Table 45'] || workbook.Sheets['Table-45'];
  if (t45) {
    const rows = XLSX.utils.sheet_to_json(t45, { header: 1 });
    for (const r of rows) {
      const label = String(r[1] || '').trim();
      if (label.includes('Traded Volume')) {
        summary.rec_iex_volume = num(r[2]) || 0;
        summary.rec_pxil_volume = num(r[3]) || 0;
        summary.rec_hpx_volume = num(r[4]) || 0;
        marketData.push({ category: 'REC', product: 'REC', exchange: 'IEX', metric: 'Traded Volume', val: summary.rec_iex_volume, unit: 'MWh' });
        marketData.push({ category: 'REC', product: 'REC', exchange: 'PXIL', metric: 'Traded Volume', val: summary.rec_pxil_volume, unit: 'MWh' });
        marketData.push({ category: 'REC', product: 'REC', exchange: 'HPX', metric: 'Traded Volume', val: summary.rec_hpx_volume, unit: 'MWh' });
      } else if (label.includes('Weighted average Price') || label.includes('Price')) {
        summary.rec_iex_avg_price = num(r[2]);
        summary.rec_pxil_avg_price = num(r[3]);
        summary.rec_hpx_avg_price = num(r[4]);
        if (summary.rec_iex_avg_price !== null) marketData.push({ category: 'REC', product: 'REC', exchange: 'IEX', metric: 'Weighted Avg Price', val: summary.rec_iex_avg_price, unit: 'Rs/MWh' });
        if (summary.rec_pxil_avg_price !== null) marketData.push({ category: 'REC', product: 'REC', exchange: 'PXIL', metric: 'Weighted Avg Price', val: summary.rec_pxil_avg_price, unit: 'Rs/MWh' });
        if (summary.rec_hpx_avg_price !== null) marketData.push({ category: 'REC', product: 'REC', exchange: 'HPX', metric: 'Weighted Avg Price', val: summary.rec_hpx_avg_price, unit: 'Rs/MWh' });
      }
    }
  }

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

async function fetchCercReport(period) {
  const [yearStr, monthStr] = period.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  
  const { excelUrl, pdfUrl } = buildCercUrls(yearStr, monthStr);
  
  const dir = path.join(CERC_DOWNLOAD_DIR, period);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  const excelPath = path.join(dir, `MMC_Report_${period}.xlsx`);
  const pdfPath = path.join(dir, `MMC_Report_${period}.pdf`);
  
  const logId = newId('CERC');
  db.prepare(`
    INSERT INTO cerc_fetch_log (id, report_period, report_year, report_month, excel_url, pdf_url, status, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING', datetime('now'))
  `).run(logId, period, year, month, excelUrl, pdfUrl);

  try {
    const excelSize = await downloadFile(excelUrl, excelPath);
    if (!excelSize) {
      console.log(`[CERC Scraper] Excel file not found (404) for ${period}`);
      db.prepare(`UPDATE cerc_fetch_log SET status = 'FAILED', error_message = 'Excel file not found (404)' WHERE id = ?`).run(logId);
      return { logId, status: 'NOT_FOUND' };
    }
    
    let pdfSize = 0;
    try {
      pdfSize = await downloadFile(pdfUrl, pdfPath);
    } catch (e) {
      console.warn(`[CERC Scraper] Could not download PDF for ${period}`);
    }
    
    db.prepare(`
      UPDATE cerc_fetch_log SET status = 'DOWNLOADED', local_excel_path = ?, local_pdf_path = ? WHERE id = ?
    `).run(excelPath, pdfSize ? pdfPath : null, logId);
    
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
    
    return { logId, status: 'PROCESSED', recordsCreated, fetched: 1 };
  } catch (err) {
    db.prepare(`UPDATE cerc_fetch_log SET status = 'FAILED', error_message = ? WHERE id = ?`).run(err.message, logId);
    
    pushNotification({
      role: 'SJVN_ADMIN',
      type: 'CERC_SCRAPER',
      message: `CERC Scraper FAILED for ${period}: ${err.message}.`,
    });
    throw err;
  }
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
async function autoSeedLocalReports() {
  try {
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM cerc_monthly_summary`).get();
    if (count && count.cnt > 0) return;
    
    console.log('[CERC Scraper] Checking for local reports to auto-seed...');
    if (fs.existsSync(CERC_DOWNLOAD_DIR)) {
      const dirs = fs.readdirSync(CERC_DOWNLOAD_DIR);
      for (const d of dirs) {
        if (/^\d{4}-\d{2}$/.test(d)) {
          console.log(`[CERC Scraper] Auto-seeding local report for ${d}...`);
          try {
            await fetchCercReport(d);
            console.log(`[CERC Scraper] Auto-seeded local report for ${d}`);
          } catch (e) {
            console.warn(`[CERC Scraper] Auto-seed failed for ${d}:`, e.message);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[CERC Scraper] autoSeedLocalReports error:`, err.message);
  }
}

export const cercScraper = {
  buildCercUrls,
  fetchCercReport,
  scanForNewReports,
  getCercFetchLog,
  getCercStatus,
  autoSeedLocalReports,
};
