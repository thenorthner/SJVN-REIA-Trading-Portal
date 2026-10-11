import { db } from '../db/index.js';
import { newId } from '../util.js';
import _xlsx from 'xlsx';
const XLSX = _xlsx.default || _xlsx;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CEA_DOWNLOAD_DIR = process.env.SJVN_CEA_DIR || path.join(__dirname, '../../cea_downloads');

if (!fs.existsSync(CEA_DOWNLOAD_DIR)) {
  fs.mkdirSync(CEA_DOWNLOAD_DIR, { recursive: true });
}

// Map short month names to numerical month
const MONTH_MAP = {
  "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
  "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12
};

async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath)) {
    console.log(`[Dev] Bypassing fetch since mock file exists at ${destPath}`);
    return false; // let the caller rely on the local file
  }
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 0 && buffer.slice(0, 100).toString().toLowerCase().includes('<!doctype html')) {
      console.warn(`URL returned HTML instead of Excel, likely a captcha wall: ${url}`);
      return false;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buffer, { flag: 'w' });
    return buffer.length;
  } catch (err) {
    console.warn(`Failed to download ${url}:`, err.message);
    return false;
  }
}

function extractTableData(sheet, startRow = 1) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const data = [];
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    data.push(row);
  }
  return data;
}

export function processCapacityBuffer(buffer, periodStr) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = extractTableData(sheet, 5); // skipping headers
  
  const insertCap = db.prepare('INSERT OR IGNORE INTO cea_installed_capacity (id, month_year, state, sector, capacity_mw) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const r of rows) {
      const state = String(r[0]).trim();
      const sector = String(r[1] || 'ALL').trim();
      const capacity = parseFloat(r[2]) || 0;
      if (state && state !== 'undefined') {
        insertCap.run(newId('CAP'), periodStr, state, sector, capacity);
      }
    }
  })();
}

export function processSupplyBuffer(buffer, periodStr) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = extractTableData(sheet, 4); // skipping headers
  
  const insertSup = db.prepare('INSERT OR IGNORE INTO cea_power_supply (id, month_year, state, energy_req, energy_avail, peak_demand, peak_met) VALUES (?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const r of rows) {
      const state = String(r[0]).trim();
      const req = parseFloat(r[1]) || 0;
      const avail = parseFloat(r[2]) || 0;
      const demand = parseFloat(r[3]) || 0;
      const met = parseFloat(r[4]) || 0;
      if (state && state !== 'undefined') {
        insertSup.run(newId('SUP'), periodStr, state, req, avail, demand, met);
      }
    }
  })();
}

export async function runCeaScraper() {
  console.log('[CEA Scraper] Starting routine check for new reports...');
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  
  const periodsToTry = [
    { m: month, y: year },
    { m: month === 1 ? 12 : month - 1, y: month === 1 ? year - 1 : year }
  ];

  for (const p of periodsToTry) {
    const mStr = String(p.m).padStart(2, '0');
    const periodStr = `${p.y}-${mStr}`;
    
    // Check if already scraped
    const exists = db.prepare('SELECT id FROM cea_scraped_reports WHERE month=? AND year=?').get(p.m, p.y);
    if (exists) {
      console.log(`[CEA Scraper] Report for ${periodStr} already scraped. Skipping.`);
      continue;
    }

    console.log(`[CEA Scraper] Searching reports for ${periodStr}...`);
    // Attempting to download Installed Capacity
    const capacityUrl = `https://cea.nic.in/wp-content/uploads/${p.y}/${mStr}/Installed_Capacity_State_wise.xlsx`;
    const supplyUrl = `https://cea.nic.in/wp-content/uploads/${p.y}/${mStr}/Power_Supply_Position.xlsx`;
    
    const capPath = path.join(CEA_DOWNLOAD_DIR, `capacity_${periodStr}.xlsx`);
    const supPath = path.join(CEA_DOWNLOAD_DIR, `supply_${periodStr}.xlsx`);
    
    const downloadedCap = await downloadFile(capacityUrl, capPath);
    const downloadedSup = await downloadFile(supplyUrl, supPath);
    
    if (downloadedCap || fs.existsSync(capPath)) {
      console.log(`[CEA Scraper] Parsing Installed Capacity for ${periodStr}`);
      const buffer = fs.readFileSync(capPath);
      processCapacityBuffer(buffer, periodStr);
      
      // Record success
      db.prepare('INSERT OR IGNORE INTO cea_scraped_reports (id, month, year, category, file_path) VALUES (?, ?, ?, ?, ?)')
        .run(newId('CSR'), p.m, p.y, 'INSTALLED_CAPACITY', capPath);
    }

    if (downloadedSup || fs.existsSync(supPath)) {
      console.log(`[CEA Scraper] Parsing Power Supply Position for ${periodStr}`);
      const buffer = fs.readFileSync(supPath);
      processSupplyBuffer(buffer, periodStr);
      
      // Record success
      db.prepare('INSERT OR IGNORE INTO cea_scraped_reports (id, month, year, category, file_path) VALUES (?, ?, ?, ?, ?)')
        .run(newId('CSR'), p.m, p.y, 'POWER_SUPPLY', supPath);
    }
  }
  
  console.log('[CEA Scraper] Routine check complete.');
}
