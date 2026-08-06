import XLSX from 'xlsx';
import db from '../db/index.js';
import { newId } from '../util.js';
import { resolveEntityByName, addAlias } from './entityResolver.js';
import { recordTds } from './tdsLedger.js';

// --- helpers --------------------------------------------------------------

// The ledger writes dates either as an Excel serial number or as DD/MM/YYYY.
function parseLedgerDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

// The authoritative application date is encoded in the application number as
// SJVN<DD><MM><YY>. Some FROM DATE cells hold a wrong Excel serial (they decode
// to January though the application is clearly April+), so the number wins and
// the cell is only a fallback.
function applicationDate(appNo, fallbackCell) {
  const m = String(appNo || '').match(/SJVN(\d{2})(\d{2})(\d{2})/);
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  return parseLedgerDate(fallbackCell);
}

function rows(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false })
    .filter(r => r.some(c => c !== null && String(c).trim() !== ''));
}

// A buyer whose category looks like a state utility is a DISCOM; everything else
// in this ledger is a commercial & industrial consumer.
function clientTypeFor(name) {
  return /board|electricity|discom|power corporation|vidyut/i.test(name) ? 'DISCOM' : 'C&I';
}

// Resolve a buyer name to an entity (creating one + alias if unknown), then
// ensure it has a trading_client, and return that trading_client id.
function ensureBuyerClient(buyerName, report) {
  let entityId = resolveEntityByName(buyerName);
  if (!entityId) {
    entityId = newId('BUY');
    db.prepare(`INSERT INTO entities (id, entity_type, category, name, status) VALUES (?, 'BUYER', ?, ?, 'APPROVED')`)
      .run(entityId, clientTypeFor(buyerName), buyerName);
    addAlias(entityId, buyerName, 'IMPORT');
    report.entities_created++;
  } else {
    // Register this spelling against the resolved entity so future lookups hit.
    addAlias(entityId, buyerName, 'IMPORT');
  }
  let tc = db.prepare('SELECT id FROM trading_clients WHERE entity_id = ?').get(entityId);
  if (!tc) {
    const entity = db.prepare('SELECT name FROM entities WHERE id = ?').get(entityId);
    const tcId = newId('TCL');
    db.prepare(`INSERT INTO trading_clients (id, entity_id, name, client_type, status) VALUES (?, ?, ?, ?, 'ACTIVE')`)
      .run(tcId, entityId, entity.name, clientTypeFor(entity.name));
    report.clients_created++;
    return tcId;
  }
  return tc.id;
}

// Representative sale rate for the imported deals: the mean of the ENERGY PAYMENT
// sheet's daily sale rates (the applications carry no per-unit rate of their own).
function representativeRate(workbook) {
  const ep = rows(workbook, 'ENERGY PAYMENT ');
  const sales = ep.slice(2).map(r => r[13]).filter(x => typeof x === 'number' && x > 0);
  if (!sales.length) return { sale: 3.17, purchase: 3.14 };
  const avg = sales.reduce((a, b) => a + b, 0) / sales.length;
  const sale = Math.round(avg * 1000) / 1000;
  return { sale, purchase: Math.round((sale - 0.03) * 1000) / 1000 };
}

// --- Application_Ledger -> buyers + bilateral deals ------------------------

function importApplications(workbook, report) {
  const al = rows(workbook, 'Application_Ledger');
  // Row 0 is a Seller/Buyer super-header, row 1 the column labels; data starts at 2.
  const data = al.slice(2).filter(r => r[2] && String(r[2]).startsWith('SJVN'));
  const { sale, purchase } = representativeRate(workbook);

  // Group applications by buyer.
  const byBuyer = new Map();
  for (const r of data) {
    const buyer = String(r[5] || '').trim();
    if (!buyer) continue;
    if (!byBuyer.has(buyer)) byBuyer.set(buyer, []);
    byBuyer.get(buyer).push(r);
  }

  const loi = data[0]?.[1] || 'NVVN_Kreate_200MW';
  const sellerRaw = data[0]?.[4] || 'NTPC Renewable Energy Limited';
  const sellerEntityId = resolveEntityByName(sellerRaw);
  const seller = sellerEntityId
    ? db.prepare('SELECT name FROM entities WHERE id = ?').get(sellerEntityId).name
    : sellerRaw;

  for (const [buyer, apps] of byBuyer) {
    const clientId = ensureBuyerClient(buyer, report);
    // Collapse GACL's four spellings: one deal per resolved client. Skip if the
    // client already has a deal under this LOA (idempotent re-import).
    const existing = db.prepare('SELECT id FROM bilateral_transactions WHERE client_id = ? AND loi_contract_ref = ?').get(clientId, loi);
    if (existing) { report.bilaterals_skipped++; continue; }

    const mwh = apps.map(r => Number(r[9]) || 0);          // APPROVED MWH per application
    const peakMw = Math.max(1, Math.round(Math.max(...mwh) / 24));
    // Date comes from the application number (SJVN DDMMYY), the authoritative source.
    const dates = apps.map(r => applicationDate(r[2], r[6])).filter(Boolean).sort();
    const start = dates[0], end = dates[dates.length - 1];

    db.prepare(`
      INSERT INTO bilateral_transactions (
        id, client_id, counterparty, loi_contract_ref, oa_type, quantum_mw,
        tariff_per_unit, purchase_rate_per_unit, sale_rate_per_unit, trading_margin_per_unit,
        open_access_status, start_date, end_date, status, noar_status, noar_contract_no
      ) VALUES (?, ?, ?, ?, 'STOA', ?, ?, ?, ?, 0.03, 'APPROVED', ?, ?, 'ACTIVE', 'APPROVED', ?)
    `).run(newId('BIL'), clientId, seller, loi, peakMw, sale, purchase, sale, start, end, apps[apps.length - 1]?.[3] || null);
    report.bilaterals_created++;
    report.applications_covered += apps.length;
  }
}

// --- April/May TDS sheets -> tds_ledger ------------------------------------

function importTds(workbook, report) {
  for (const [sheet, period] of [['April TDS 2026', '2026-04'], ['May TDS 2026', '2026-05']]) {
    const tds = rows(workbook, sheet);
    // Row 0 is the header; data starts at row 1.
    for (const r of tds.slice(1)) {
      const appNo = r[1] ? String(r[1]).trim() : null;
      const party = r[3] ? String(r[3]).trim() : null;
      const taxable = Number(r[5]);
      if (!party || !Number.isFinite(taxable)) continue;
      const rate = Number(r[6]);   // fraction as stored (0.1 = 10%)
      // Idempotent: skip if this exact deduction is already recorded.
      const dup = db.prepare('SELECT 1 FROM tds_ledger WHERE reference_no IS ? AND vendor_name = ? AND taxable_amount = ? AND period = ?')
        .get(appNo, party, taxable, period);
      if (dup) { report.tds_skipped++; continue; }
      recordTds({
        vendorName: party, rate: Number.isFinite(rate) ? rate : undefined,
        taxableAmount: taxable, referenceType: 'OA_APPLICATION', referenceNo: appNo, period,
        note: 'Imported from ledger ' + sheet,
      });
      report.tds_created++;
    }
  }
}

// --- entry point ----------------------------------------------------------

export function importTradingLedger(filePath) {
  const workbook = XLSX.readFile(filePath);
  const report = {
    entities_created: 0, clients_created: 0,
    bilaterals_created: 0, bilaterals_skipped: 0, applications_covered: 0,
    tds_created: 0, tds_skipped: 0,
  };
  const run = db.transaction(() => {
    importApplications(workbook, report);
    importTds(workbook, report);
  });
  run();
  return report;
}
