import XLSX from 'xlsx';
import db from '../db/index.js';
import { newId } from '../util.js';
import { resolveEntityByName, addAlias } from './entityResolver.js';
import { recordTds } from './tdsLedger.js';

// --- helpers --------------------------------------------------------------

// The ledger writes dates either as an Excel serial number or as DD/MM/YYYY text.
//
// Every numeric cell in this workbook is day/month swapped: the dates were typed
// as DD/MM/YYYY into a workbook reading MM/DD/YYYY, so "01/04/2026" (1 April) was
// stored as the serial for 4 January. That mis-read only succeeds silently when
// the day is <= 12 — - anything above that Excel could not parse as a month and
// kept as text, which is exactly the split seen here (every numeric cell decodes
// to a day <= 12, every text cell has a day > 12). So a numeric cell is decoded
// and then swapped back; text cells are already correct DD/MM/YYYY.
function parseLedgerDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;   // holds the true day
    const day = d.getUTCDate();          // holds the true month
    // Only swap when the decoded day is a valid month, i.e. the mis-read case.
    if (day <= 12) {
      return `${year}-${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}`;
    }
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // DD/MM/YYYY on the schedule sheets, DD.MM.YYYY on the billing sheets,
  // DD-MM-YYYY on the energy payment sheet.
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

// A well-formed ISO date, or null — used where a cell may hold free text such as
// "Payment Recevied on next day of scheduling of power" instead of a date.
function isoDateOrNull(v) {
  const d = parseLedgerDate(v);
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

// The authoritative application date is encoded in the application number as
// SJVN<DD><MM><YY>. The FROM DATE cell agrees once the day/month swap above is
// undone, but the number needs no repair so it stays the primary source.
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

    // Per-buyer approved energy — the volume basis for contribution reporting,
    // since the day-wise schedule is kept at contract level.
    const contractedMwh = Number(mwh.reduce((a, b) => a + b, 0).toFixed(3));

    db.prepare(`
      INSERT INTO bilateral_transactions (
        id, client_id, counterparty, loi_contract_ref, oa_type, quantum_mw, contracted_mwh,
        tariff_per_unit, purchase_rate_per_unit, sale_rate_per_unit, trading_margin_per_unit,
        open_access_status, start_date, end_date, status, noar_status,
        noar_application_no, noar_region, noar_contract_no
      ) VALUES (?, ?, ?, ?, 'STOA', ?, ?, ?, ?, ?, 0.03, 'APPROVED', ?, ?, 'ACTIVE', 'APPROVED', ?, 'WR', ?)
    `).run(newId('BIL'), clientId, seller, loi, peakMw, contractedMwh, sale, purchase, sale, start, end,
      apps[apps.length - 1]?.[2] || null, apps[apps.length - 1]?.[3] || null);
    report.bilaterals_created++;
    report.applications_covered += apps.length;
  }
}

// --- Application_Ledger -> effective-dated ISTS rates ----------------------

// The ledger prices every application's ISTS leg, and CTUIL revises that tariff
// on a monthly (27th-to-26th) cycle — so the applications themselves record the
// rate history. Derive rate = ISTS amount / approved MWh per application, take
// the dominant rate per date (a few applications run over other corridors at a
// different tariff and would otherwise fragment the series), then compress runs
// of equal rates into effective-dated windows.
function importIstsRates(workbook, report) {
  // Already imported once — the seed is idempotent, not a re-derivation.
  if (db.prepare(`SELECT 1 FROM rate_master WHERE charge_name = 'ISTS' AND created_by = 'LEDGER_IMPORT' LIMIT 1`).get()) {
    report.ists_rates_skipped++;
    return;
  }

  const al = rows(workbook, 'Application_Ledger');
  const data = al.slice(2).filter(r => r[2] && String(r[2]).startsWith('SJVN'));

  // Group at 1 decimal — the ledger stores ISTS amounts as whole rupees, so the
  // derived ratio wobbles in the second decimal and finer grouping would split
  // one tariff into many windows. The window's stored rate is then refined to the
  // median of its full-precision ratios, which prices back to the rupee.
  // ISTS is billed per transmission corridor, so the series is derived per region
  // (taken from the application number) rather than as one national rate.
  const perRegion = {};
  for (const r of data) {
    const mwh = Number(r[9]);
    const ists = Number(r[14]);
    const d = applicationDate(r[2], r[6]);
    if (!(mwh > 0) || !Number.isFinite(ists) || !(ists > 0) || !d) continue;
    const region = (String(r[2]).match(/SJVN\d{6}([A-Z]{2})/) || [])[1] || 'WR';
    const exact = ists / mwh;
    const key = Number(exact.toFixed(1));
    perRegion[region] = perRegion[region] || {};
    const perDate = perRegion[region];
    perDate[d] = perDate[d] || {};
    perDate[d][key] = perDate[d][key] || { n: 0, exact: [] };
    perDate[d][key].n++;
    perDate[d][key].exact.push(exact);
  }

  const windows = [];
  for (const [region, perDate] of Object.entries(perRegion)) {
    const dominant = {};
    for (const [d, buckets] of Object.entries(perDate)) {
      const [key, bucket] = Object.entries(buckets).sort((a, b) => b[1].n - a[1].n)[0];
      dominant[d] = { key: Number(key), exact: bucket.exact };
    }
    const regionWindows = [];
    for (const d of Object.keys(dominant).sort()) {
      const last = regionWindows[regionWindows.length - 1];
      if (last && last.key === dominant[d].key) {
        last.to = d;
        last.exact.push(...dominant[d].exact);
      } else {
        regionWindows.push({ region, key: dominant[d].key, from: d, to: d, exact: [...dominant[d].exact] });
      }
    }
    // Refine each window's rate to the median of the ratios observed in it.
    for (const w of regionWindows) {
      const sorted = w.exact.slice().sort((a, b) => a - b);
      w.rate = Number(sorted[Math.floor(sorted.length / 2)].toFixed(2));
    }
    // The last window of each region stays open-ended.
    regionWindows.forEach((w, i) => { w.open = i === regionWindows.length - 1; });
    windows.push(...regionWindows);
  }
  if (!windows.length) return;

  const insert = db.prepare(`
    INSERT INTO rate_master (id, rate_category, charge_name, region, rate_value, unit, effective_from, effective_to, note, is_active, created_by)
    VALUES (?, 'ISTS', 'ISTS', ?, ?, 'Rs/MWh', ?, ?, ?, 1, 'LEDGER_IMPORT')
  `);
  for (const w of windows) {
    insert.run(newId('RATE'), w.region, w.rate, w.from, w.open ? null : w.to,
      `Derived from ISET ledger applications (${w.region} corridor)`);
    report.ists_rates_created++;
  }

  // Close the seeded baseline the day before the ledger history starts, so the
  // two series do not overlap.
  const firstFrom = windows.map((w) => w.from).sort()[0];
  const prevDay = new Date(new Date(firstFrom).getTime() - 86400000).toISOString().slice(0, 10);
  db.prepare(`
    UPDATE rate_master SET effective_to = ?
    WHERE charge_name = 'ISTS' AND created_by = 'SYSTEM_SEED' AND effective_to IS NULL
  `).run(prevDay);
}

// --- Daily Schedule -> schedule_deviations ---------------------------------

// Day-wise availability vs requested vs actually scheduled, with the shortfall
// attributed to whichever side defaulted. Monthly subtotal rows are interleaved
// with the daily rows and are skipped.
function importDailySchedule(workbook, report) {
  const ds = rows(workbook, 'Daily Schedule');
  const contractRef = String(ds[0]?.[1] || 'NVVN_Kreate_200MW').trim();
  // The schedule covers the whole LOA, not one buyer, so it is deliberately not
  // attached to a single bilateral — doing so would credit one buyer with the
  // entire contract's energy. The seller is recorded on the row instead.
  const counterparty = db.prepare(`
    SELECT counterparty FROM bilateral_transactions
    WHERE loi_contract_ref LIKE 'NVVN%' LIMIT 1
  `).get()?.counterparty || null;

  const upsert = db.prepare(`
    INSERT INTO schedule_deviations (id, bilateral_id, contract_ref, counterparty, schedule_date, availability_mwh,
      requested_mwh, scheduled_mwh, buyer_default_mwh, seller_default_mwh, remark, source)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LEDGER_IMPORT')
    ON CONFLICT(contract_ref, schedule_date) DO UPDATE SET
      counterparty = excluded.counterparty,
      availability_mwh = excluded.availability_mwh,
      requested_mwh = excluded.requested_mwh,
      scheduled_mwh = excluded.scheduled_mwh,
      buyer_default_mwh = excluded.buyer_default_mwh,
      seller_default_mwh = excluded.seller_default_mwh,
      remark = excluded.remark
  `);

  // The sheet is in date order, which lets a mistyped year be caught: the ledger
  // has a "14/07/2027" sitting between 13/07/2026 and 15/07/2026. If a date jumps
  // implausibly far from the previous row but lands adjacent once given the
  // previous row's year, it is a typo — correct it and record the repair.
  const DAY = 86400000;
  let prev = null;
  for (const r of ds.slice(2)) {
    const label = r[0];
    if (label == null || label === '') continue;
    if (typeof label === 'string' && /total/i.test(label)) continue;   // monthly subtotal
    let date = parseLedgerDate(label);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    if (prev) {
      const gap = (new Date(date) - new Date(prev)) / DAY;
      if (gap > 60 || gap < 0) {
        const retry = `${prev.slice(0, 4)}${date.slice(4)}`;
        const retryGap = (new Date(retry) - new Date(prev)) / DAY;
        if (retryGap >= 0 && retryGap <= 60) {
          report.date_repairs.push({ sheet: 'Daily Schedule', found: date, used: retry });
          date = retry;
        }
      }
    }
    prev = date;

    const requested = Number(r[2]) || 0;
    const scheduled = Number(r[3]) || 0;
    if (!requested && !scheduled) continue;
    upsert.run(newId('SDV'), contractRef, counterparty, date,
      Number(r[1]) || 0, requested, scheduled, Number(r[4]) || 0, Number(r[5]) || 0,
      r[6] ? String(r[6]) : null);
    report.schedule_days_imported++;
  }
}

// --- Application_Ledger -> actual open-access charges ----------------------

// What each application was actually charged, so an estimate can be reconciled
// against it. The OA Bills sheet would be the natural source but holds a single
// clean row — the rest carry #REF! formula errors — whereas the Application
// Ledger prices all 428 of them.
function importOaActuals(workbook, report) {
  const al = rows(workbook, 'Application_Ledger');
  const data = al.slice(2).filter(r => r[2] && String(r[2]).startsWith('SJVN'));

  const upsert = db.prepare(`
    INSERT INTO oa_application_charges (id, application_no, approval_no, buyer, application_date,
      approved_mwh, ists_actual, application_fee_actual, rldc_fee_actual, total_actual, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LEDGER_IMPORT')
    ON CONFLICT(application_no) DO UPDATE SET
      approval_no = excluded.approval_no, buyer = excluded.buyer,
      application_date = excluded.application_date, approved_mwh = excluded.approved_mwh,
      ists_actual = excluded.ists_actual, application_fee_actual = excluded.application_fee_actual,
      rldc_fee_actual = excluded.rldc_fee_actual, total_actual = excluded.total_actual
  `);

  for (const r of data) {
    const appNo = String(r[2]).trim();
    const ists = Number(r[14]) || 0;
    const appFee = Number(r[15]) || 0;
    const rldc = Number(r[16]) || 0;
    if (!(ists > 0)) continue;   // a handful of rows carry no charge detail
    upsert.run(newId('OAC'), appNo, r[3] ? String(r[3]).trim() : null,
      r[5] ? String(r[5]).trim() : null, applicationDate(r[2], r[6]),
      Number(r[9]) || 0, ists, appFee, rldc, ists + appFee + rldc);
    report.oa_actuals_imported++;
  }
}

// --- ENERGY PAYMENT -> energy_settlements ----------------------------------

// Both sides of the same day's energy on one row: what was paid to the seller and
// what was billed to the buyer. Importing it is what makes the trading margin
// checkable per day instead of only as an average.
function importEnergySettlements(workbook, report) {
  const ep = rows(workbook, 'ENERGY PAYMENT ');
  const contractRef = db.prepare(`
    SELECT loi_contract_ref FROM bilateral_transactions WHERE loi_contract_ref LIKE 'NVVN%' LIMIT 1
  `).get()?.loi_contract_ref || 'NVVN_Kreate_200MW';

  const upsert = db.prepare(`
    INSERT INTO energy_settlements (id, contract_ref, settlement_date, energy_kwh,
      purchase_rate, purchase_amount, purchase_tds, sale_rate, sale_amount, sale_tds,
      margin_rate, margin_amount, net_receivable, actual_receipt, receipt_difference, receipt_date, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LEDGER_IMPORT')
    ON CONFLICT(contract_ref, settlement_date) DO UPDATE SET
      energy_kwh = excluded.energy_kwh,
      purchase_rate = excluded.purchase_rate, purchase_amount = excluded.purchase_amount,
      purchase_tds = excluded.purchase_tds,
      sale_rate = excluded.sale_rate, sale_amount = excluded.sale_amount, sale_tds = excluded.sale_tds,
      margin_rate = excluded.margin_rate, margin_amount = excluded.margin_amount,
      net_receivable = excluded.net_receivable, actual_receipt = excluded.actual_receipt,
      receipt_difference = excluded.receipt_difference, receipt_date = excluded.receipt_date
  `);

  // Same date-ordered year-typo repair as the schedule sheet: this one carries a
  // "27-04-2027" among the April 2026 rows.
  const DAY = 86400000;
  let prev = null;
  for (const r of ep.slice(2)) {
    const purchaseRate = Number(r[3]);
    const saleRate = Number(r[13]);
    if (!Number.isFinite(purchaseRate) || !Number.isFinite(saleRate)) continue;
    let date = parseLedgerDate(r[1]);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    if (prev) {
      const gap = (new Date(date) - new Date(prev)) / DAY;
      if (gap > 60 || gap < 0) {
        const retry = `${prev.slice(0, 4)}${date.slice(4)}`;
        const retryGap = (new Date(retry) - new Date(prev)) / DAY;
        if (retryGap >= 0 && retryGap <= 60) {
          report.date_repairs.push({ sheet: 'ENERGY PAYMENT', found: date, used: retry });
          date = retry;
        }
      }
    }
    prev = date;

    const kwh = Number(r[2]) || 0;
    const marginRate = Number((saleRate - purchaseRate).toFixed(4));
    upsert.run(newId('ESL'), contractRef, date, kwh,
      purchaseRate, Number(r[4]) || 0, Number(r[5]) || 0,
      saleRate, Number(r[14]) || 0, Number(r[15]) || 0,
      marginRate, Number((kwh * marginRate).toFixed(2)),
      Number(r[17]) || 0, Number(r[18]) || 0, Number(r[19]) || 0, isoDateOrNull(r[20]));
    report.energy_settlements_imported++;
  }
}

// --- Bills issued / received -> cashflow_entries ---------------------------

// Both legs of the cash cycle. The buyer's side is what SJVN collects, the
// seller's side is what SJVN pays out; holding them in one register is what
// allows a net position to be shown.
function importCashflow(workbook, report) {
  const upsert = db.prepare(`
    INSERT INTO cashflow_entries (id, direction, invoice_no, invoice_type, party, invoice_date, due_date,
      gross_amount, tds_amount, net_amount, paid_amount, payment_date, payment_note, status, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LEDGER_IMPORT')
    ON CONFLICT(direction, invoice_no) DO UPDATE SET
      gross_amount = excluded.gross_amount, tds_amount = excluded.tds_amount,
      net_amount = excluded.net_amount, paid_amount = excluded.paid_amount,
      payment_date = excluded.payment_date, payment_note = excluded.payment_note,
      due_date = excluded.due_date, status = excluded.status
  `);

  const settle = (paid, net) => {
    if (paid <= 0) return 'OPEN';
    // Treat a rupee of rounding as settled rather than leaving it perpetually open.
    return paid + 1 >= net ? 'SETTLED' : 'PARTIAL';
  };

  // Outward bills raised on the buyer.
  for (const r of rows(workbook, 'Bills issued by SJVN').slice(1)) {
    const invoiceNo = r[1] ? String(r[1]).trim() : null;
    if (!invoiceNo) continue;
    const gross = Number(r[5]) || 0;
    const tds = Number(r[11]) || 0;
    const paid = Number(r[8]) || 0;
    const net = gross - tds;
    upsert.run(newId('CFE'), 'INFLOW', invoiceNo, r[2] ? String(r[2]).trim() : null,
      r[6] ? String(r[6]).trim() : null, isoDateOrNull(r[0]), isoDateOrNull(r[7]),
      gross, tds, net, paid, isoDateOrNull(r[9]),
      isoDateOrNull(r[9]) ? null : (r[9] ? String(r[9]).trim() : null), settle(paid, net));
    report.cashflow_inflows++;
  }

  // Inward bills received from the seller.
  for (const r of rows(workbook, 'Bills received').slice(1)) {
    const invoiceNo = r[1] != null ? String(r[1]).trim() : null;
    if (!invoiceNo) continue;
    const gross = Number(r[6]) || 0;
    const tds = Number(r[13]) || 0;
    const paid = Number(r[9]) || 0;
    const net = gross - tds;
    upsert.run(newId('CFE'), 'OUTFLOW', invoiceNo, 'Vendor Bill',
      r[7] ? String(r[7]).trim() : null, isoDateOrNull(r[0]), isoDateOrNull(r[8]),
      gross, tds, net, paid, isoDateOrNull(r[10]),
      isoDateOrNull(r[10]) ? null : (r[10] ? String(r[10]).trim() : null), settle(paid, net));
    report.cashflow_outflows++;
  }
}

// --- TDS to be paid -> historical liability register -----------------------

// The 2023-24 open-access applications and the tax withheld against each. These
// predate the monthly TDS sheets and carry no challan detail — the challan
// columns in the workbook are empty throughout — so they import as outstanding
// liability, which is precisely the gap the register is meant to close.
function importHistoricalTds(workbook, report) {
  for (const r of rows(workbook, 'TDS to be paid').slice(1)) {
    const party = r[3] ? String(r[3]).trim() : null;
    const taxable = Number(r[6]);
    const appNo = r[1] ? String(r[1]).trim() : null;
    if (!party || !Number.isFinite(taxable) || taxable <= 0) continue;
    // "INTEREST" is a penalty line rather than a vendor payment; it carries no PAN
    // and is not a TDS deduction, so it is left out of the register.
    if (/^interest$/i.test(party)) { report.tds_skipped++; continue; }

    const dup = db.prepare(
      'SELECT 1 FROM tds_ledger WHERE reference_no IS ? AND vendor_name = ? AND taxable_amount = ?'
    ).get(appNo, party, taxable);
    if (dup) { report.tds_skipped++; continue; }

    recordTds({
      vendorName: party,
      taxableAmount: taxable,
      referenceType: 'OA_APPLICATION',
      referenceNo: appNo,
      note: 'Imported from ledger TDS to be paid (2023-24)',
    });
    report.tds_created++;
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
    ists_rates_created: 0, ists_rates_skipped: 0,
    schedule_days_imported: 0, date_repairs: [],
    cashflow_inflows: 0, cashflow_outflows: 0, energy_settlements_imported: 0, oa_actuals_imported: 0,
    tds_created: 0, tds_skipped: 0,
  };
  const run = db.transaction(() => {
    importApplications(workbook, report);
    importIstsRates(workbook, report);
    importDailySchedule(workbook, report);
    importOaActuals(workbook, report);
    importEnergySettlements(workbook, report);
    importCashflow(workbook, report);
    importHistoricalTds(workbook, report);
    importTds(workbook, report);
  });
  run();
  return report;
}
