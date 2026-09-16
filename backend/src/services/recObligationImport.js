/**
 * IEX REC obligation report → the REC purchase and sale ledger.
 *
 * CP-83-85 §5 step 6: "Upload the IEX obligation report to create and maintain
 * a ledger of REC purchase and sale data." Until now the desk keyed the session
 * figures in by hand on the REC Order Report, so the only record of what a
 * session actually obliged SJVN to pay or receive was a retyped one.
 *
 * WHAT THIS DOES NOT ASSUME: nobody here has seen the exchange's file yet — it
 * arrives after a session, and its column headings are not published in any
 * document SJVN holds. So the parser is driven by column NAMES, not positions:
 * it recognises a set of spellings for each field, tells the caller exactly
 * which columns it mapped and which it ignored, and refuses a sheet whose
 * essential columns it cannot find rather than reading whatever sits in the
 * third column and calling it a price. When the real file turns up, the fix is
 * a spelling added to SYNONYMS, not a rewrite.
 *
 * Amounts that the report does not carry are computed and named as computed
 * (`derived_fields`), so a figure the exchange stated is never confused on
 * screen with one this platform worked out.
 */
import crypto from 'crypto';
import XLSX from 'xlsx';
import db from '../db/index.js';
import { newId } from '../util.js';

export class ObligationImportError extends Error {}

/** Column spellings, in the order they are tried. Lower-cased, punctuation stripped. */
const SYNONYMS = {
  trade_date: ['trade date', 'session date', 'transaction date', 'date of trade', 'deal date', 'date'],
  settlement_date: ['settlement date', 'pay in date', 'payin date', 'pay out date', 'payout date', 'due date'],
  instrument: ['instrument', 'instrument name', 'certificate type', 'rec type', 'product', 'product name', 'contract'],
  side: ['side', 'buy sell', 'buy or sell', 'transaction type', 'trade type', 'nature of transaction', 'obligation type'],
  quantity: ['quantity', 'qty', 'no of recs', 'number of recs', 'rec quantity', 'certificates', 'total quantity', 'traded quantity'],
  buy_quantity: ['buy quantity', 'buy qty', 'purchase quantity', 'purchased qty', 'qty bought'],
  sell_quantity: ['sell quantity', 'sell qty', 'sale quantity', 'sold qty', 'qty sold'],
  price_per_rec: ['price', 'rate', 'price per rec', 'rate per rec', 'clearing price', 'discovered price', 'discovered rate', 'mcp'],
  trade_value: ['trade value', 'traded value', 'gross amount', 'obligation amount', 'trade obligation', 'value', 'amount', 'basic amount', 'base amount'],
  exchange_fee: ['exchange fee', 'exchange fees', 'transaction fee', 'transaction charges', 'trading fee', 'exchange charges'],
  gst: ['gst', 'gst amount', 'tax', 'tax amount', 'igst', 'cgst sgst'],
  net_amount: ['net amount', 'net obligation', 'net payable', 'net receivable', 'total amount', 'total obligation', 'net payable receivable', 'final obligation'],
  member_code: ['member code', 'member id', 'participant id', 'portfolio', 'portfolio id', 'portfolio code', 'member'],
  counterparty: ['counterparty', 'counter party', 'buyer name', 'seller name', 'buyer', 'seller'],
  reference_no: ['reference no', 'reference', 'trade id', 'trade no', 'order id', 'obligation no', 'transaction id', 'deal id'],
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Is this a real spreadsheet, or text the reader would otherwise interpret?
 *
 * An .xlsx is a zip ("PK"), an .xls an OLE compound file. Anything else is
 * CSV-ish text, and for CSV the reader MUST be given `raw: true`: left to
 * itself it reads "11/03/2026" as month-first and turns it into the serial for
 * 3 November, while "25/03/2026" has no eleventh month to fall into and stays
 * text. One file would then carry both readings, and a session's certificates
 * would be dated eight months from where they belong. A real .xlsx needs no
 * such guard — its date cells carry their own type.
 */
function isSpreadsheet(buffer) {
  if (!buffer || buffer.length < 8) return false;
  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b;                       // PK — xlsx/ods
  const ole = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11; // legacy xls
  return zip || ole;
}

/** Numbers arrive as "1,23,456.00", "₹ 1234", "(500)" for a negative, or a number. */
export function parseAmount(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[₹$,\s]/g, '');
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (s.startsWith('-')) { sign = -1; s = s.slice(1); }
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : null;
}

/** Excel serial, DD/MM/YYYY, DD-MM-YYYY, or an ISO date — to ISO, else null. */
export function parseSheetDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Excel's day 1 is 1900-01-01 with the 1900 leap-year bug, so day 0 is 1899-12-30.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,})[ -](\d{2,4})$/);
  if (m) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mi = months.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) {
      const year = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${year}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
  }
  return null;
}

/** "Sell" / "Sale" / "S" / "Pay-out" → SELL; "Buy" / "Purchase" / "Pay-in" → BUY. */
export function parseSide(v) {
  const s = norm(v);
  if (!s) return null;
  if (/^(s|sell|sale|sold|sales|sell side|pay out|payout|receivable)/.test(s)) return 'SELL';
  if (/^(b|buy|purchase|bought|buy side|pay in|payin|payable)/.test(s)) return 'BUY';
  return null;
}

/** Solar and non-solar price and redeem differently, so the two are never merged. */
export function parseInstrument(v) {
  const s = norm(v);
  if (!s) return null;
  if (/non[\s-]?solar/.test(s)) return 'NON_SOLAR';
  if (/solar/.test(s)) return 'SOLAR';
  return String(v).trim().toUpperCase().slice(0, 40);
}

/**
 * Find the header row and map its columns.
 *
 * The exchange's reports carry a title block above the table, so the header is
 * not row 1. The header is the first row in which at least three columns are
 * recognised AND a quantity column is among them — a title row can accidentally
 * contain the word "date", but not a table's worth of field names.
 */
function locateHeader(grid) {
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const mapping = mapColumns(grid[i]);
    const known = Object.keys(mapping.byField).length;
    const hasQty = mapping.byField.quantity != null
      || mapping.byField.buy_quantity != null
      || mapping.byField.sell_quantity != null;
    if (known >= 3 && hasQty) return { headerRow: i, ...mapping };
  }
  return null;
}

function mapColumns(row) {
  const byField = {};
  const mapped = [];
  const ignored = [];
  (row || []).forEach((cell, idx) => {
    const n = norm(cell);
    if (!n) return;
    let hit = null;
    for (const [field, spellings] of Object.entries(SYNONYMS)) {
      if (spellings.includes(n)) { hit = field; break; }
    }
    // A looser pass for headings that carry a unit, e.g. "Quantity (RECs)" or
    // "Price (Rs/REC)" — the unit is noise, the field name is what matters.
    if (!hit) {
      for (const [field, spellings] of Object.entries(SYNONYMS)) {
        if (spellings.some((sp) => n.startsWith(`${sp} `))) { hit = field; break; }
      }
    }
    if (hit && byField[hit] == null) {
      byField[hit] = idx;
      mapped.push({ column: String(cell).trim(), field: hit });
    } else {
      ignored.push(String(cell).trim());
    }
  });
  return { byField, mapped, ignored };
}

/**
 * Read one obligation report into normalised lines.
 * @param {Buffer} buffer  the uploaded file (.xlsx / .xls / .csv)
 */
export function parseObligationReport(buffer, { platform = 'IEX' } = {}) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, ...(isSpreadsheet(buffer) ? {} : { raw: true }) });
  } catch (err) {
    throw new ObligationImportError(`That file could not be read as a workbook or CSV (${err.message}).`);
  }
  if (!workbook.SheetNames?.length) throw new ObligationImportError('The file has no sheets.');

  // A sheet named for the report is preferred; otherwise every sheet is tried,
  // because the obligation table is not always the first one in the book.
  const ordered = [...workbook.SheetNames].sort((a, b) => {
    const score = (n) => (/oblig|trade|settle|rec/i.test(n) ? 0 : 1);
    return score(a) - score(b);
  });

  let chosen = null;
  for (const name of ordered) {
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null, blankrows: false });
    const header = locateHeader(grid);
    if (header) { chosen = { name, grid, ...header }; break; }
  }
  if (!chosen) {
    throw new ObligationImportError(
      'No obligation table was recognised in this file. A sheet needs a header row naming at least a quantity '
      + 'column and two others (trade date, price, side, instrument, amount). Nothing was imported.',
    );
  }

  const { byField, mapped, ignored, grid, headerRow, name } = chosen;
  const warnings = [];
  const cell = (row, field) => (byField[field] == null ? null : row[byField[field]]);
  const lines = [];
  const skipped = [];

  for (let i = headerRow + 1; i < grid.length; i++) {
    const row = grid[i];
    if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;

    // Total / footer rows repeat the table's own words instead of carrying data.
    const firstCell = norm(row.find((c) => c != null && String(c).trim() !== ''));
    if (/^(total|grand total|sub total|net total)\b/.test(firstCell)) continue;

    const buyQty = parseAmount(cell(row, 'buy_quantity'));
    const sellQty = parseAmount(cell(row, 'sell_quantity'));
    let side = parseSide(cell(row, 'side'));
    let quantity = parseAmount(cell(row, 'quantity'));

    // Some layouts carry no side column and split quantity into two instead.
    if (!side) {
      if (sellQty) { side = 'SELL'; quantity = quantity ?? sellQty; } else if (buyQty) { side = 'BUY'; quantity = quantity ?? buyQty; }
    }
    if (quantity == null) quantity = side === 'BUY' ? buyQty : sellQty;

    const tradeDate = parseSheetDate(cell(row, 'trade_date'));
    if (!side || quantity == null || !tradeDate) {
      skipped.push({
        row_no: i + 1,
        reason: !tradeDate ? 'no trade date could be read' : (!side ? 'buy or sell could not be read' : 'no quantity'),
        cells: row.slice(0, 8).map((c) => (c == null ? '' : String(c))),
      });
      continue;
    }

    const price = parseAmount(cell(row, 'price_per_rec'));
    let value = parseAmount(cell(row, 'trade_value'));
    const fee = parseAmount(cell(row, 'exchange_fee'));
    const gst = parseAmount(cell(row, 'gst'));
    let net = parseAmount(cell(row, 'net_amount'));
    const derived = [];

    if (value == null && price != null) { value = Math.round(quantity * price * 100) / 100; derived.push('trade_value'); }
    if (net == null && value != null) {
      // A sale receives the value less what the exchange takes; a purchase pays
      // the value plus the same. Either way the fee leaves SJVN.
      const charges = (fee || 0) + (gst || 0);
      net = Math.round((side === 'SELL' ? value - charges : value + charges) * 100) / 100;
      derived.push('net_amount');
    }

    lines.push({
      row_no: i + 1,
      trade_date: tradeDate,
      settlement_date: parseSheetDate(cell(row, 'settlement_date')),
      platform,
      instrument: parseInstrument(cell(row, 'instrument')),
      side,
      quantity,
      price_per_rec: price,
      trade_value: value,
      exchange_fee: fee,
      gst,
      net_amount: net,
      member_code: cell(row, 'member_code') ? String(cell(row, 'member_code')).trim() : null,
      counterparty: cell(row, 'counterparty') ? String(cell(row, 'counterparty')).trim() : null,
      reference_no: cell(row, 'reference_no') ? String(cell(row, 'reference_no')).trim() : null,
      derived_fields: derived,
      raw: row.map((c) => (c == null ? null : c)),
    });
  }

  if (!lines.length) {
    throw new ObligationImportError(
      `The header was recognised on sheet "${name}" but no row under it could be read as a trade. Nothing was imported.`,
    );
  }
  if (byField.price_per_rec == null) warnings.push('No price column was recognised — rates are blank unless a value column gave them.');
  if (byField.instrument == null) warnings.push('No instrument column was recognised — solar and non-solar cannot be told apart in this file.');
  if (skipped.length) warnings.push(`${skipped.length} row(s) under the header could not be read as trades and were left out.`);

  return { sheet: name, columns_mapped: mapped, columns_ignored: ignored, lines, skipped, warnings };
}

/**
 * The identity of a trade across re-uploads.
 *
 * A corrected report has to update the line it corrects rather than add a
 * second copy of the same trade. Where the exchange gives a reference number
 * that is the identity; without one, a trade is identified by what makes it
 * distinct — session, side, instrument, quantity and price.
 */
function lineKey(l) {
  const base = l.reference_no
    ? `${l.platform}|${l.reference_no}`
    : `${l.platform}|${l.trade_date}|${l.side}|${l.instrument || '?'}|${l.quantity}|${l.price_per_rec ?? '?'}`;
  return base.toUpperCase();
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * Parse, then land the report.
 *
 * Re-uploading the identical file is refused — it is almost always a double
 * click, and the caller is told which upload it already is. A different file
 * covering the same session updates the trades it repeats.
 */
export function importObligationReport(buffer, { fileName, platform = 'IEX', dryRun = false, actor = null } = {}) {
  const parsed = parseObligationReport(buffer, { platform });
  const digest = sha256(buffer);

  const already = db.prepare('SELECT id, file_name, created_at FROM rec_obligation_uploads WHERE content_sha256 = ?').get(digest);
  if (already && !dryRun) {
    throw new ObligationImportError(
      `This exact file was already uploaded on ${already.created_at} as ${already.file_name}. Nothing was changed.`,
    );
  }

  const dates = parsed.lines.map((l) => l.trade_date).sort();
  const totals = summariseLines(parsed.lines);
  const uploadId = newId('ROB');

  let created = 0;
  let updated = 0;

  if (!dryRun) {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO rec_obligation_uploads (
          id, file_name, content_sha256, platform, sheet_name, session_from, session_to,
          line_count, bought_qty, sold_qty, net_amount, columns_mapped_json,
          columns_ignored_json, warnings_json, skipped_json, uploaded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uploadId, fileName || 'obligation-report', digest, platform, parsed.sheet,
        dates[0] || null, dates[dates.length - 1] || null, parsed.lines.length,
        totals.bought_qty, totals.sold_qty, totals.net_amount,
        JSON.stringify(parsed.columns_mapped), JSON.stringify(parsed.columns_ignored),
        JSON.stringify(parsed.warnings), JSON.stringify(parsed.skipped), actor,
      );

      const find = db.prepare('SELECT id FROM rec_obligation_lines WHERE line_key = ?');
      const ins = db.prepare(`
        INSERT INTO rec_obligation_lines (
          id, upload_id, row_no, trade_date, settlement_date, platform, instrument, side,
          quantity, price_per_rec, trade_value, exchange_fee, gst, net_amount,
          member_code, counterparty, reference_no, derived_fields_json, raw_json, line_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const upd = db.prepare(`
        UPDATE rec_obligation_lines SET
          upload_id = ?, row_no = ?, trade_date = ?, settlement_date = ?, instrument = ?, side = ?,
          quantity = ?, price_per_rec = ?, trade_value = ?, exchange_fee = ?, gst = ?, net_amount = ?,
          member_code = ?, counterparty = ?, reference_no = ?, derived_fields_json = ?, raw_json = ?
        WHERE id = ?
      `);

      for (const l of parsed.lines) {
        const key = lineKey(l);
        const existing = find.get(key);
        const derived = JSON.stringify(l.derived_fields);
        const raw = JSON.stringify(l.raw);
        if (existing) {
          upd.run(
            uploadId, l.row_no, l.trade_date, l.settlement_date, l.instrument, l.side,
            l.quantity, l.price_per_rec, l.trade_value, l.exchange_fee, l.gst, l.net_amount,
            l.member_code, l.counterparty, l.reference_no, derived, raw, existing.id,
          );
          updated += 1;
        } else {
          ins.run(
            newId('ROL'), uploadId, l.row_no, l.trade_date, l.settlement_date, l.platform, l.instrument, l.side,
            l.quantity, l.price_per_rec, l.trade_value, l.exchange_fee, l.gst, l.net_amount,
            l.member_code, l.counterparty, l.reference_no, derived, raw, key,
          );
          created += 1;
        }
      }
    })();
  }

  return {
    ok: true,
    dry_run: dryRun,
    upload_id: dryRun ? null : uploadId,
    file_name: fileName || null,
    platform,
    sheet: parsed.sheet,
    session_from: dates[0] || null,
    session_to: dates[dates.length - 1] || null,
    lines_read: parsed.lines.length,
    lines_created: created,
    lines_updated: updated,
    columns_mapped: parsed.columns_mapped,
    columns_ignored: parsed.columns_ignored,
    skipped: parsed.skipped,
    warnings: parsed.warnings,
    totals,
    lines: parsed.lines,
    reconciliation: reconcile(parsed.lines),
  };
}

export function summariseLines(lines) {
  const s = { bought_qty: 0, sold_qty: 0, purchase_value: 0, sale_value: 0, exchange_fee: 0, gst: 0, net_amount: 0 };
  for (const l of lines) {
    const qty = Number(l.quantity) || 0;
    const value = Number(l.trade_value) || 0;
    if (l.side === 'BUY') { s.bought_qty += qty; s.purchase_value += value; } else { s.sold_qty += qty; s.sale_value += value; }
    s.exchange_fee += Number(l.exchange_fee) || 0;
    s.gst += Number(l.gst) || 0;
    // A purchase is money out, a sale money in, so the net across a report is
    // the sale side less the purchase side.
    s.net_amount += (l.side === 'SELL' ? 1 : -1) * (Number(l.net_amount) || 0);
  }
  for (const k of Object.keys(s)) s[k] = Math.round(s[k] * 100) / 100;
  return s;
}

/**
 * What the exchange says SJVN sold, against what the REC ledger says it sold.
 *
 * The ledger is written when the desk books a sale against a lot; the report is
 * what the exchange settled. They should agree on quantity and rate for the
 * session. Only sales are compared — a REC purchase has no lot to book against,
 * and those lines ARE the purchase record rather than a check on one.
 */
export function reconcile(lines) {
  const items = [];
  const sells = lines.filter((l) => l.side === 'SELL');
  const byDate = new Map();
  for (const l of sells) {
    const k = `${l.trade_date}|${l.platform}`;
    byDate.set(k, (byDate.get(k) || []).concat(l));
  }

  for (const [key, group] of byDate) {
    const [tradeDate, platform] = key.split('|');
    const qty = group.reduce((a, l) => a + (Number(l.quantity) || 0), 0);
    const value = group.reduce((a, l) => a + (Number(l.trade_value) || 0), 0);
    const reportRate = qty ? Math.round((value / qty) * 100) / 100 : null;

    const booked = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) qty, COALESCE(SUM(amount), 0) amount, COUNT(*) n
      FROM rec_transactions
      WHERE txn_type = 'SALE' AND trade_date = ? AND UPPER(COALESCE(platform, '')) = ?
    `).get(tradeDate, String(platform).toUpperCase());

    if (!booked.n) {
      items.push({
        kind: 'SALE_NOT_BOOKED',
        trade_date: tradeDate,
        detail: `${platform} settled ${qty} REC(s) on ${tradeDate}; no sale is booked against any lot for that session`,
        report_qty: qty,
        ledger_qty: 0,
      });
      continue;
    }
    if (Math.abs(booked.qty - qty) > 0.001) {
      items.push({
        kind: 'QTY_MISMATCH',
        trade_date: tradeDate,
        detail: `${platform} settled ${qty} REC(s) on ${tradeDate}; the ledger books ${booked.qty}`,
        report_qty: qty,
        ledger_qty: booked.qty,
      });
    }
    const ledgerRate = booked.qty ? Math.round((booked.amount / booked.qty) * 100) / 100 : null;
    if (reportRate != null && ledgerRate != null && Math.abs(ledgerRate - reportRate) > 0.5) {
      items.push({
        kind: 'RATE_MISMATCH',
        trade_date: tradeDate,
        detail: `${platform} settled at Rs ${reportRate}/REC on ${tradeDate}; the ledger books Rs ${ledgerRate}/REC`,
        report_rate: reportRate,
        ledger_rate: ledgerRate,
      });
    }
  }

  // The other direction: a sale the desk booked for a session the report does
  // not cover at all, which usually means the wrong file was uploaded.
  const covered = new Set(sells.map((l) => `${l.trade_date}|${String(l.platform).toUpperCase()}`));
  const dates = sells.map((l) => l.trade_date).sort();
  if (dates.length) {
    const bookedSessions = db.prepare(`
      SELECT trade_date, UPPER(COALESCE(platform, '')) platform, SUM(quantity) qty
      FROM rec_transactions
      WHERE txn_type = 'SALE' AND trade_date BETWEEN ? AND ?
      GROUP BY trade_date, UPPER(COALESCE(platform, ''))
    `).all(dates[0], dates[dates.length - 1]);
    for (const b of bookedSessions) {
      if (!covered.has(`${b.trade_date}|${b.platform}`)) {
        items.push({
          kind: 'BOOKED_NOT_IN_REPORT',
          trade_date: b.trade_date,
          detail: `The ledger books ${b.qty} REC(s) sold on ${b.platform || 'an unnamed platform'} on ${b.trade_date}, which this report does not cover`,
          report_qty: 0,
          ledger_qty: b.qty,
        });
      }
    }
  }

  return items;
}

/** The purchase and sale ledger itself, newest session first. */
export function obligationLedger({ from, to, side, instrument, platform } = {}) {
  let sql = 'SELECT * FROM rec_obligation_lines WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND trade_date >= ?'; params.push(from); }
  if (to) { sql += ' AND trade_date <= ?'; params.push(to); }
  if (side) { sql += ' AND side = ?'; params.push(String(side).toUpperCase()); }
  if (instrument) { sql += ' AND instrument = ?'; params.push(String(instrument).toUpperCase()); }
  if (platform) { sql += ' AND platform = ?'; params.push(String(platform).toUpperCase()); }
  sql += ' ORDER BY trade_date DESC, side, instrument';
  return db.prepare(sql).all(...params).map(hydrateLine);
}

export function hydrateLine(row) {
  if (!row) return row;
  return {
    ...row,
    derived_fields: JSON.parse(row.derived_fields_json || '[]'),
    raw: JSON.parse(row.raw_json || '[]'),
  };
}

/** Position across everything uploaded: bought, sold, and what it settled to. */
export function obligationSummary(filters = {}) {
  const lines = obligationLedger(filters);
  const totals = summariseLines(lines);
  const sessions = new Set(lines.map((l) => l.trade_date));
  const instruments = {};
  for (const l of lines) {
    const k = l.instrument || 'UNSPECIFIED';
    instruments[k] = instruments[k] || { bought_qty: 0, sold_qty: 0 };
    instruments[k][l.side === 'BUY' ? 'bought_qty' : 'sold_qty'] += Number(l.quantity) || 0;
  }
  return {
    ...totals,
    // Certificates held from purchases that have not been sold on. Negative
    // would mean more sold than bought through the exchange — which is normal
    // for SJVN, whose sales come from its own issued lots, not from purchases.
    net_qty: Math.round((totals.bought_qty - totals.sold_qty) * 100) / 100,
    line_count: lines.length,
    session_count: sessions.size,
    by_instrument: instruments,
  };
}
