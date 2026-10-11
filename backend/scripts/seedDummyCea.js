import _xlsx from 'xlsx';
const XLSX = _xlsx.default || _xlsx;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runCeaScraper } from '../src/services/ceaScraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CEA_DOWNLOAD_DIR = process.env.SJVN_CEA_DIR || path.join(__dirname, '../cea_downloads');

if (!fs.existsSync(CEA_DOWNLOAD_DIR)) {
  fs.mkdirSync(CEA_DOWNLOAD_DIR, { recursive: true });
}

function createDummyCapacity(filename) {
  const ws_data = [
    ['State/UT', 'Sector', 'Capacity (MW)'],
    ['dummy1', 'dummy2', 'dummy3'],
    ['dummy4', 'dummy5', 'dummy6'],
    ['dummy7', 'dummy8', 'dummy9'],
    ['Himachal Pradesh', 'State', 1200.5],
    ['Punjab', 'State', 2500.0],
    ['Haryana', 'State', 3100.8],
    ['Delhi', 'State', 400.2],
    ['Uttarakhand', 'State', 900.5],
  ];
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Capacity");
  XLSX.writeFile(wb, path.join(CEA_DOWNLOAD_DIR, filename));
}

function createDummySupply(filename) {
  const ws_data = [
    ['State/UT', 'Energy Req (MU)', 'Energy Avail (MU)', 'Peak Demand (MW)', 'Peak Met (MW)'],
    ['dummy1', 'dummy2', 'dummy3', 'dummy4', 'dummy5'],
    ['dummy1', 'dummy2', 'dummy3', 'dummy4', 'dummy5'],
    ['Himachal Pradesh', 500, 490, 1000, 990],
    ['Punjab', 1500, 1450, 3000, 2900],
    ['Haryana', 1200, 1180, 2500, 2400],
    ['Delhi', 800, 800, 1500, 1500],
    ['Uttarakhand', 400, 400, 800, 800],
  ];
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Supply");
  XLSX.writeFile(wb, path.join(CEA_DOWNLOAD_DIR, filename));
}

async function main() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  
  const p1 = { m: month, y: year };
  const p2 = { m: month === 1 ? 12 : month - 1, y: month === 1 ? year - 1 : year };

  for (const p of [p1, p2]) {
    const mStr = String(p.m).padStart(2, '0');
    const periodStr = `${p.y}-${mStr}`;
    createDummyCapacity(`capacity_${periodStr}.xlsx`);
    createDummySupply(`supply_${periodStr}.xlsx`);
    console.log(`Created dummy files for ${periodStr}`);
  }

  await runCeaScraper();
  console.log('Scraper finished. Check DB/Dashboard.');
}

main().catch(console.error);
