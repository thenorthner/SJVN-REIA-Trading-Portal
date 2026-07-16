/**
 * REA Scraper Service
 * 
 * Automated pipeline for discovering, downloading, parsing, and storing
 * Regional Energy Account data from RPC websites.
 * 
 * Steps:
 * 1. Discover new months from RPC listing page
 * 2. Check against rea_fetch_log to avoid reprocessing
 * 3. Download PDF and store locally
 * 4. Parse PDF using Python script
 * 5. Match stations to contracts
 * 6. Save energy_data records
 * 7. Link source PDF as document
 * 8. Handle exceptions and notify
 */

import { db } from '../db/index.js';
import { newId, logAudit, pushNotification } from '../util.js';
import { RPC_SOURCES, mmyyToYYYYMM, yyyymmToMMYY } from '../config/rpcSources.js';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { load as cheerioLoad } from 'cheerio';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REA_DOWNLOAD_DIR = path.join(__dirname, '../../rea_downloads');
const SCRIPTS_DIR = path.join(__dirname, '../scripts');

// Ensure download directory exists
if (!fs.existsSync(REA_DOWNLOAD_DIR)) {
  fs.mkdirSync(REA_DOWNLOAD_DIR, { recursive: true });
}

// ──────────────────────────────────────────────
// Step 1: Discover available months from listing page
// ──────────────────────────────────────────────
async function discoverAvailableMonths(rpcKey) {
  const config = RPC_SOURCES[rpcKey];
  if (!config) throw new Error(`Unknown RPC source: ${rpcKey}`);

  console.log(`[REA Scraper] Fetching listing page for ${rpcKey}: ${config.listing_url}`);
  
  const response = await fetch(config.listing_url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${config.listing_url}: HTTP ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerioLoad(html);
  
  // Parse dropdown options
  const months = [];
  $(`select[name="${config.dropdown_name}"] option`).each((_, el) => {
    const value = $(el).attr('value');
    const label = $(el).text().trim();
    if (value && value.length === 4) {
      months.push({
        mmyy: value,
        period: mmyyToYYYYMM(value),
        label,
      });
    }
  });

  console.log(`[REA Scraper] Found ${months.length} months on ${rpcKey} listing page`);
  return months;
}

// ──────────────────────────────────────────────
// Step 2: Find months not yet processed
// ──────────────────────────────────────────────
function findNewMonths(rpcKey, availableMonths, dataType = 'PROVISIONAL') {
  const processed = db.prepare(`
    SELECT period_month FROM rea_fetch_log 
    WHERE rpc_source = ? AND data_type = ? AND status IN ('DOWNLOADED','PARSED','PROCESSED')
  `).all(rpcKey, dataType).map(r => r.period_month);
  
  return availableMonths.filter(m => !processed.includes(m.period));
}

// ──────────────────────────────────────────────
// Step 3: Download PDF
// ──────────────────────────────────────────────
async function downloadPdf(rpcKey, period, dataType = 'PROVISIONAL') {
  const config = RPC_SOURCES[rpcKey];
  const mmyy = yyyymmToMMYY(period);
  
  const pdfUrl = dataType === 'PROVISIONAL' 
    ? config.provisional_url(mmyy) 
    : config.final_url(mmyy);

  // Create directory for this RPC+month
  const dir = path.join(REA_DOWNLOAD_DIR, rpcKey, period);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const fileName = `REA_${rpcKey}_${period}_${dataType}.pdf`;
  const filePath = path.join(dir, fileName);

  console.log(`[REA Scraper] Downloading ${pdfUrl} → ${filePath}`);

  const response = await fetch(pdfUrl);
  if (!response.ok) {
    if (response.status === 404) {
      console.log(`[REA Scraper] ${pdfUrl} not found (404) — month not yet published`);
      return null; // Not an error, just not published yet
    }
    throw new Error(`Download failed: HTTP ${response.status} for ${pdfUrl}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  console.log(`[REA Scraper] Downloaded ${buffer.length} bytes → ${fileName}`);

  // Create rea_fetch_log entry
  const logId = newId('REA');
  db.prepare(`
    INSERT INTO rea_fetch_log (id, rpc_source, period_month, data_type, pdf_url, local_file_path, status)
    VALUES (?, ?, ?, ?, ?, ?, 'DOWNLOADED')
  `).run(logId, rpcKey, period, dataType, pdfUrl, filePath);

  // Also store in documents system for audit trail
  try {
    const docId = uuidv4();
    db.prepare(`
      INSERT INTO documents (id, contract_id, document_type, category, title, created_by)
      VALUES (?, NULL, 'REA_SOURCE', 'RECORD', ?, 'SYSTEM')
    `).run(docId, `REA ${rpcKey} ${period} ${dataType}`);

    const versionId = uuidv4();
    db.prepare(`
      INSERT INTO document_versions (id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type, verification_status, created_by)
      VALUES (?, ?, 1, ?, ?, ?, 'application/pdf', 'NOT_REQUIRED', 'SYSTEM')
    `).run(versionId, docId, filePath, fileName, buffer.length);

    // Link document to fetch log
    db.prepare(`UPDATE rea_fetch_log SET document_id = ? WHERE id = ?`).run(docId, logId);
  } catch (docErr) {
    console.error('[REA Scraper] Warning: Failed to save document record:', docErr.message);
  }

  return { logId, filePath, fileName, pdfUrl };
}

// ──────────────────────────────────────────────
// Step 4: Parse PDF using Python script
// ──────────────────────────────────────────────
function parsePdf(filePath, rpcKey) {
  return new Promise((resolve, reject) => {
    const config = RPC_SOURCES[rpcKey];
    const scriptPath = path.join(SCRIPTS_DIR, config.parser_script);

    exec(`python3 "${scriptPath}" "${filePath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('[REA Scraper] Parser error:', stderr || error.message);
        reject(new Error(`Parser failed: ${stderr || error.message}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        if (!result.success) {
          reject(new Error(result.error || 'Parser returned failure'));
          return;
        }
        resolve(result.data);
      } catch (parseErr) {
        console.error('[REA Scraper] Invalid JSON from parser:', stdout?.slice(0, 200));
        reject(new Error('Parser returned invalid JSON'));
      }
    });
  });
}

// ──────────────────────────────────────────────
// Step 5: Match stations to contracts and save
// ──────────────────────────────────────────────
function processAndSave(logId, parsedData, rpcKey, period, dataType) {
  let recordsCreated = 0;

  for (const station of parsedData) {
    // Try to find matching contract by station name hint
    // Look for a contract whose seller entity name matches the station hint
    const contract = db.prepare(`
      SELECT c.* FROM contracts c
      JOIN entities e ON e.id = c.seller_id
      WHERE (e.name LIKE ? OR e.name LIKE ?)
      AND c.status IN ('ACTIVE','SIGNED')
      AND c.tenure_start <= ? AND c.tenure_end >= ?
      ORDER BY c.tenure_start DESC
      LIMIT 1
    `).get(
      `%${station.station_name}%`,
      `%${station.station_id?.replace('_', ' ')}%`,
      period + '-01',
      period + '-01'
    );

    if (!contract) {
      console.warn(`[REA Scraper] No matching contract for station: ${station.station_name} (period: ${period})`);
      
      // Push notification about orphan data
      pushNotification({
        role: 'REIA_USER',
        type: 'REA_SCRAPER',
        message: `REA data for "${station.station_name}" (${period}) — no matching contract found. Manual mapping required.`,
      });
      continue;
    }

    // Check if energy_data already exists for this contract+period+type
    const existing = db.prepare(`
      SELECT id FROM energy_data 
      WHERE contract_id = ? AND period_month = ? AND data_type = ? AND source = 'REA'
    `).get(contract.id, period, dataType);

    if (existing) {
      console.log(`[REA Scraper] Energy data already exists for ${contract.contract_no} / ${period} — skipping`);
      continue;
    }

    // Create energy_data record
    const edId = newId('ENG');
    db.prepare(`
      INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, availability_percent, status)
      VALUES (?, ?, ?, ?, 'REA', ?, NULL, ?, 'DRAFT')
    `).run(edId, contract.id, period, dataType, station.energy_mwh, station.availability_percent);

    logAudit({ req: null, user: { id: 'SYSTEM', name: 'REA Scraper' }, action: 'CREATE', module: 'REIA', entityType: 'energy_data', entityId: edId, details: { source: 'REA_SCRAPER', rpc: rpcKey, station: station.station_name } });

    // Auto-validate
    try {
      let baseCuf = 0.22;
      if (contract.project_type === 'Wind') baseCuf = 0.30;
      if (contract.project_type === 'Hydro') baseCuf = 0.65;

      const expected = contract.capacity_mw * 24 * 30 * baseCuf;
      const deviationPct = Math.abs(station.energy_mwh - expected) / expected * 100;
      
      const tolerance = contract.project_type === 'Hydro' ? 80 : 30;
      const flagged = deviationPct > tolerance;
      
      db.prepare(`UPDATE energy_data SET status = ?, deviation_notes = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(
          flagged ? 'DISPUTED' : 'VALIDATED',
          `Auto-validated by REA Scraper. Deviation ${deviationPct.toFixed(1)}% vs expected ${expected.toFixed(0)} MWh (${(baseCuf * 100).toFixed(0)}% CUF) - Tolerance: ${tolerance}%`,
          edId
        );
    } catch (valErr) {
      console.error('[REA Scraper] Auto-validation failed:', valErr.message);
    }

    recordsCreated++;
    console.log(`[REA Scraper] Saved: ${contract.contract_no} / ${period} = ${station.energy_mwh} MWh`);
  }

  // Update fetch log
  db.prepare(`
    UPDATE rea_fetch_log SET status = 'PROCESSED', records_created = ?, processed_at = datetime('now') WHERE id = ?
  `).run(recordsCreated, logId);

  return recordsCreated;
}

// ──────────────────────────────────────────────
// Full cycle orchestrator for a single RPC
// ──────────────────────────────────────────────
async function runFullCycle(rpcKey) {
  const startTime = Date.now();
  const results = { rpc: rpcKey, newMonths: 0, downloaded: 0, parsed: 0, records: 0, errors: [] };

  try {
    // Step 1: Discover available months
    const availableMonths = await discoverAvailableMonths(rpcKey);
    
    // Step 2: Find new (unprocessed) months
    const newMonths = findNewMonths(rpcKey, availableMonths, 'PROVISIONAL');
    results.newMonths = newMonths.length;

    if (newMonths.length === 0) {
      console.log(`[REA Scraper] ${rpcKey}: No new months to process`);
      return results;
    }

    console.log(`[REA Scraper] ${rpcKey}: Found ${newMonths.length} new month(s): ${newMonths.map(m => m.period).join(', ')}`);

    // Process each new month
    for (const month of newMonths) {
      try {
        // Step 3: Download PDF
        const download = await downloadPdf(rpcKey, month.period, 'PROVISIONAL');
        if (!download) continue; // 404, not yet published
        results.downloaded++;

        // Step 4: Parse PDF
        const parsedData = await parsePdf(download.filePath, rpcKey);
        db.prepare(`UPDATE rea_fetch_log SET status = 'PARSED' WHERE id = ?`).run(download.logId);
        results.parsed++;

        // Step 5: Match & Save
        const count = processAndSave(download.logId, parsedData, rpcKey, month.period, 'PROVISIONAL');
        results.records += count;

      } catch (monthErr) {
        console.error(`[REA Scraper] Error processing ${rpcKey}/${month.period}:`, monthErr.message);
        results.errors.push({ month: month.period, error: monthErr.message });

        // Mark as failed in fetch log if entry exists
        db.prepare(`
          UPDATE rea_fetch_log SET status = 'FAILED', error_message = ? WHERE rpc_source = ? AND period_month = ? AND data_type = 'PROVISIONAL'
        `).run(monthErr.message, rpcKey, month.period);
      }
    }

    // Success notification
    if (results.records > 0) {
      pushNotification({
        role: 'REIA_USER',
        type: 'REA_SCRAPER',
        message: `✅ REA Scraper: ${results.records} new energy record(s) imported from ${rpcKey} for ${newMonths.map(m => m.period).join(', ')}`,
      });
    }

  } catch (err) {
    console.error(`[REA Scraper] Fatal error for ${rpcKey}:`, err.message);
    results.errors.push({ month: 'ALL', error: err.message });

    // Alert notification for scraper failure
    pushNotification({
      role: 'SJVN_ADMIN',
      type: 'REA_SCRAPER',
      message: `⚠️ REA Scraper FAILED for ${rpcKey}: ${err.message}. Please check manually or use manual upload.`,
    });
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[REA Scraper] ${rpcKey} cycle completed in ${duration}s — ${results.records} records, ${results.errors.length} errors`);
  return results;
}

// ──────────────────────────────────────────────
// Run all configured RPC sources
// ──────────────────────────────────────────────
async function runAllSources() {
  console.log('[REA Scraper] ═══════ Starting scheduled scan ═══════');
  const allResults = [];

  for (const rpcKey of Object.keys(RPC_SOURCES)) {
    try {
      const result = await runFullCycle(rpcKey);
      allResults.push(result);
    } catch (err) {
      console.error(`[REA Scraper] Unhandled error for ${rpcKey}:`, err);
      allResults.push({ rpc: rpcKey, error: err.message });
    }
  }

  console.log('[REA Scraper] ═══════ Scan complete ═══════');
  return allResults;
}

// ──────────────────────────────────────────────
// Manual trigger for a specific RPC + month
// ──────────────────────────────────────────────
async function triggerManual(rpcKey, periodMonth, dataType = 'PROVISIONAL') {
  const config = RPC_SOURCES[rpcKey];
  if (!config) throw new Error(`Unknown RPC source: ${rpcKey}`);

  // Check if already processed
  const existing = db.prepare(`
    SELECT * FROM rea_fetch_log WHERE rpc_source = ? AND period_month = ? AND data_type = ? AND status = 'PROCESSED'
  `).get(rpcKey, periodMonth, dataType);

  if (existing) {
    throw new Error(`${rpcKey}/${periodMonth}/${dataType} already processed (log: ${existing.id})`);
  }

  // Delete any failed previous attempt
  db.prepare(`
    DELETE FROM rea_fetch_log WHERE rpc_source = ? AND period_month = ? AND data_type = ? AND status = 'FAILED'
  `).run(rpcKey, periodMonth, dataType);

  // Download
  const download = await downloadPdf(rpcKey, periodMonth, dataType);
  if (!download) throw new Error(`PDF not found (404) for ${rpcKey}/${periodMonth}`);

  // Parse
  const parsedData = await parsePdf(download.filePath, rpcKey);
  db.prepare(`UPDATE rea_fetch_log SET status = 'PARSED' WHERE id = ?`).run(download.logId);

  // Save
  const count = processAndSave(download.logId, parsedData, rpcKey, periodMonth, dataType);

  pushNotification({
    role: 'REIA_USER',
    type: 'REA_SCRAPER',
    message: `✅ Manual REA import: ${count} record(s) from ${rpcKey} for ${periodMonth}`,
  });

  return { logId: download.logId, records: count, parsedStations: parsedData.length };
}

// ──────────────────────────────────────────────
// Query helpers for API
// ──────────────────────────────────────────────
function getFetchLog(filters = {}) {
  let sql = `SELECT * FROM rea_fetch_log WHERE 1=1`;
  const params = [];
  if (filters.rpc_source) { sql += ' AND rpc_source = ?'; params.push(filters.rpc_source); }
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  sql += ' ORDER BY fetched_at DESC LIMIT 100';
  return db.prepare(sql).all(...params);
}

function getStatus() {
  // For each RPC, get latest fetch status
  const sources = {};
  for (const rpcKey of Object.keys(RPC_SOURCES)) {
    const latest = db.prepare(`
      SELECT * FROM rea_fetch_log 
      WHERE rpc_source = ? 
      ORDER BY fetched_at DESC 
      LIMIT 1
    `).get(rpcKey);

    const totalProcessed = db.prepare(`
      SELECT COUNT(*) as cnt FROM rea_fetch_log WHERE rpc_source = ? AND status = 'PROCESSED'
    `).get(rpcKey);

    const totalFailed = db.prepare(`
      SELECT COUNT(*) as cnt FROM rea_fetch_log WHERE rpc_source = ? AND status = 'FAILED'
    `).get(rpcKey);

    sources[rpcKey] = {
      name: RPC_SOURCES[rpcKey].name,
      latest_fetch: latest || null,
      total_processed: totalProcessed?.cnt || 0,
      total_failed: totalFailed?.cnt || 0,
    };
  }
  return sources;
}

export const reaScraper = {
  discoverAvailableMonths,
  findNewMonths,
  downloadPdf,
  parsePdf,
  processAndSave,
  runFullCycle,
  runAllSources,
  triggerManual,
  getFetchLog,
  getStatus,
};
