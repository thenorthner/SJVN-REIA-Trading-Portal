/**
 * Delhi SLDC's State Energy Account — where Delhi's share of a station is
 * divided among its licensees.
 *
 * NRPC's Regional Energy Account gives Delhi one entitlement per station. The
 * bill is raised on BRPL, BYPL and TPDDL separately, and the figures it needs —
 * to the same six decimals — are in Annexure-2 of the account Delhi SLDC issues
 * a few days into the following month. On Nathpa Jhakri, TPDDL and BYPL hold
 * fixed shares and BRPL takes whatever is left of Delhi's entitlement, so the
 * three do not move in proportion and cannot be scaled from an earlier sheet.
 *
 * The site lists its accounts through the same JSON its own page reads; an
 * account is fetched once and kept beside the REA PDFs.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { reaScraper } from './reaScraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOAD_DIR = path.join(__dirname, '../../rea_downloads/DELHI_SLDC');

const HOST = 'https://delhisldc.org';
const LISTING_URL = `${HOST}/app-api/energy-accounting-report?type=I`;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json,application/pdf,*/*;q=0.8',
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** "2026-08" as the site writes it: "August 2026". */
export function seaMonthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * The account to read for a month, out of the site's listing.
 *
 * A month collects several papers — the provisional account, its amendments,
 * the open-access account, the inter-discom bill. Only the provisional State
 * Energy Account and its amendments carry Annexure-2, and the newest of those
 * is the one in force.
 */
export function pickSeaForMonth(rows, month) {
  const label = seaMonthLabel(month).toLowerCase();
  const candidates = (rows || []).filter((r) => String(r.EA_MONTH || '').trim().toLowerCase() === label
    && /provisional\s+state\s+energy\s+account/i.test(r.EA_FOR || '')
    && /\.pdf$/i.test(r.EA_FILENAME || ''));
  candidates.sort((a, b) => String(b.EA_DURATION || '').localeCompare(String(a.EA_DURATION || ''))
    || String(b.EA_ID || '').localeCompare(String(a.EA_ID || '')));
  return candidates[0] || null;
}

// A month's account does not change once read, except by an amendment — which
// arrives under a new file name and so misses this cache.
const parsed = new Map();

/**
 * The Delhi licensees' entitlement in each station for a month.
 *
 * Returns null while the account has not been published, which is the ordinary
 * state of things for the first days of a month. Throws only when the site
 * answered and what it gave could not be used.
 */
export async function delhiSeaForMonth(month) {
  const res = await fetch(LISTING_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`Delhi SLDC listing answered HTTP ${res.status}`);
  const listing = await res.json();
  const row = pickSeaForMonth(listing?.rows, month);
  if (!row) return null;

  const key = `${month}:${row.EA_FILENAME}`;
  if (parsed.has(key)) return parsed.get(key);

  const dir = path.join(DOWNLOAD_DIR, month);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, row.EA_FILENAME.replace(/[^A-Za-z0-9._ ()-]/g, '_'));
  const url = `${HOST}/Resources/${encodeURIComponent(row.EA_FILENAME)}`;
  if (!fs.existsSync(filePath)) {
    const pdf = await fetch(url, { headers: HEADERS });
    if (!pdf.ok) throw new Error(`Delhi SLDC account answered HTTP ${pdf.status} for ${row.EA_FILENAME}`);
    fs.writeFileSync(filePath, Buffer.from(await pdf.arrayBuffer()));
  }

  const out = await reaScraper.parsePdf(filePath, 'NRPC', { mode: 'delhi_sea' });
  // The listing says which month an account is for; the account says so too.
  // Reading July's split onto August's bill is the mistake this refuses.
  if (out.period && out.period !== month) {
    throw new Error(`Delhi SLDC lists "${row.EA_FOR}" under ${seaMonthLabel(month)}, but the account is for ${out.period}`);
  }
  const result = { month, title: row.EA_FOR, file: row.EA_FILENAME, url, stations: out.data || {} };
  parsed.set(key, result);
  return result;
}
