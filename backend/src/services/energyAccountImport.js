/**
 * Energy for a month from the accounts that state it: the joint meter reading
 * taken at the station, and the State Energy Account the SLDC issues (REIA
 * scope item D).
 *
 * Only one source had a route in: the NRPC regional energy account, read out of
 * its PDF. Everything else — the JMR, the SEA, an RLDC statement — was typed
 * into the energy screen a figure at a time, with nothing recording which
 * document the figure came from.
 *
 * This takes the account's own table. A month of stations is a table in every
 * one of these documents, and a table can be read exactly, which a scanned
 * page cannot: what is imported is what the account says, row for row, with the
 * document and the row it came from kept against it.
 *
 * UNITS ARE NEVER GUESSED. A state energy account states energy in MUs, a JMR
 * in kWh or MWh, a regional account in lakh units — and the same number means a
 * thousand times more or less depending on which. The unit is declared for the
 * upload, or per row in a "Unit" column; a file that says nothing is refused
 * rather than read at whatever scale looks plausible.
 */
import XLSX from 'xlsx';
import db from '../db/index.js';
import { newId, buildBillingFamilyRef, directionForContract } from '../util.js';

export const ACCOUNT_TYPES = {
  JMR: 'Joint meter reading',
  SEA: 'State energy account (SLDC)',
  RLDC: 'RLDC statement',
};
/** To MWh, which is what energy_data holds. */
export const UNITS = {
  MWH: { label: 'MWh', factor: 1 },
  MU: { label: 'MU (million units)', factor: 1000 },
  KWH: { label: 'kWh', factor: 0.001 },
  LU: { label: 'LU (lakh units)', factor: 100 },
  GWH: { label: 'GWh', factor: 1000 },
};

export class AccountImportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const COLUMNS = [
  ['contract_no', [/contract\s*(no|number|ref)/, /ppa\s*(no|number)/, /agreement\s*no/]],
  ['station', [/station/, /plant/, /generator/, /project/, /source/, /\bisgs\b/]],
  ['beneficiary', [/beneficiary/, /licensee/, /discom/, /buyer/, /counterparty/]],
  ['period_month', [/period/, /month/, /billing\s*month/]],
  ['unit', [/^unit$/, /\bunits?\b\s*$/, /unit\s*of\s*measure/, /\buom\b/]],
  ['energy', [/energy\s*(scheduled|injected|exported|sent\s*out)?/, /scheduled\s*energy/, /export/, /injection/, /\bmwh\b/, /\bmus?\b/, /\bkwh\b/, /quantum/, /^total/]],
  ['availability_percent', [/availability/, /\bpaf\b/, /\bdaf\b/]],
  ['peak_availability_percent', [/peak\s*availability/, /peak\s*paf/]],
  ['cuf_percent', [/\bcuf\b/, /capacity\s*utilisation/, /plf/]],
  ['remarks', [/remark/, /note/]],
];

const norm = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[,\s]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "2026-06", "Jun-26", "June 2026", "06/2026" — all the same month. */
export function parseMonthCell(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  let m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
  m = /^(\d{1,2})[-/](\d{4})$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${String(m[1]).padStart(2, '0')}`;
  m = /^([A-Za-z]{3,})[-'\s/]+(\d{2,4})$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) {
      const y = m[2].length === 2 ? `20${m[2]}` : m[2];
      return `${y}-${String(mi + 1).padStart(2, '0')}`;
    }
  }
  return null;
}

export function unitFactor(name) {
  if (!name) return null;
  // "(in MUs)", "MU", "Energy in MWh" — the unit is a word inside the phrase,
  // not necessarily the phrase itself.
  const s = norm(name).replace(/[()]/g, ' ');
  if (/\bmwh\b|mega\s*watt\s*hour/.test(s)) return { key: 'MWH', ...UNITS.MWH };
  if (/\bgwh\b/.test(s)) return { key: 'GWH', ...UNITS.GWH };
  if (/\bkwh\b|kilo\s*watt\s*hour/.test(s)) return { key: 'KWH', ...UNITS.KWH };
  if (/\bmus?\b|million\s*unit/.test(s)) return { key: 'MU', ...UNITS.MU };
  if (/\blu\b|lakh\s*unit/.test(s)) return { key: 'LU', ...UNITS.LU };
  return null;
}

const isSummaryRow = (row) => row.some((c) => /^(grand\s*)?total\b|^sub\s*total|^note\b|^source\b|^\*/i.test(String(c ?? '').trim()));

/**
 * Read an energy account's table. The unit given here applies to every row that
 * does not carry its own; without either, nothing is read.
 */
export function parseEnergyAccount(buffer, { unit = null, periodMonth = null } = {}) {
  let sheet;
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', raw: true });
    sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true, blankrows: false });
  } catch {
    return { errors: ['The file could not be read as a spreadsheet or CSV.'] };
  }
  if (!sheet?.length) return { errors: ['The file is empty.'] };

  const defaultUnit = unit ? unitFactor(unit) : null;
  if (unit && !defaultUnit) {
    return { errors: [`"${unit}" is not a unit this reads. Use one of ${Object.values(UNITS).map((u) => u.label).join(', ')}.`] };
  }

  const headerIdx = sheet.slice(0, 25).findIndex((r) => {
    const cells = (r || []).map(norm);
    if (cells.filter(Boolean).length < 2) return false;
    const names = cells.some((c) => /station|plant|contract|generator|project/.test(c));
    const energy = cells.some((c) => /energy|mwh|\bmus?\b|kwh|export|injection|scheduled|quantum/.test(c));
    return names && energy;
  });
  if (headerIdx < 0) {
    return { errors: ['No table header found: expected a row naming the station or the contract alongside the energy column.'] };
  }

  const header = (sheet[headerIdx] || []).map(norm);
  const claimed = new Map();
  for (const [field, patterns] of COLUMNS) {
    for (const p of patterns) {
      const i = header.findIndex((h, idx) => h && p.test(h) && !claimed.has(idx));
      if (i >= 0) { claimed.set(i, field); break; }
    }
  }
  const colOf = (field) => {
    for (const [i, f] of claimed) if (f === field) return i;
    return -1;
  };
  if (colOf('energy') < 0) return { errors: ['No energy column: expected a heading such as "Energy (MWh)" or "Scheduled Energy".'] };
  if (colOf('contract_no') < 0 && colOf('station') < 0) {
    return { errors: ['No station or contract column — there is no way to say which contract a row belongs to.'] };
  }

  // A heading such as "Scheduled Energy (in MUs)" states the unit itself, and
  // the document's own word beats a default chosen on the upload form.
  const headingUnit = unitFactor((sheet[headerIdx][colOf('energy')] || '').toString().replace(/.*\(([^)]*)\).*/, '$1'));
  const unitCol = colOf('unit');
  if (!defaultUnit && !headingUnit && unitCol < 0) {
    return {
      errors: ['The unit of the energy column is not stated. Say which unit the file is in, or give it a "Unit" column — '
        + 'the same number is a thousand times bigger in MUs than in MWh.'],
    };
  }

  const rows = [];
  const errors = [];
  sheet.slice(headerIdx + 1).forEach((raw, i) => {
    const rowNo = headerIdx + i + 2;
    if (!raw || raw.every((c) => c == null || c === '')) return;
    if (isSummaryRow(raw)) return;

    const cell = (f) => {
      const c = colOf(f);
      return c < 0 ? null : raw[c];
    };
    const text = (f) => {
      const v = cell(f);
      return v == null || v === '' ? null : String(v).trim();
    };

    const rowUnit = (unitCol >= 0 ? unitFactor(raw[unitCol]) : null) || headingUnit || defaultUnit;
    if (!rowUnit) {
      errors.push(`Row ${rowNo}: "${raw[unitCol] ?? ''}" is not a unit this reads.`);
      return;
    }
    const value = toNumber(cell('energy'));
    if (value == null) {
      errors.push(`Row ${rowNo}: "${cell('energy') ?? ''}" is not an energy figure.`);
      return;
    }
    const month = parseMonthCell(cell('period_month')) || periodMonth;
    if (!month) {
      errors.push(`Row ${rowNo}: no period month, and none was chosen for the upload.`);
      return;
    }

    rows.push({
      row_no: rowNo,
      contract_no: text('contract_no'),
      station: text('station'),
      beneficiary: text('beneficiary'),
      period_month: month,
      energy_value: value,
      unit: rowUnit.key,
      energy_mwh: Number((value * rowUnit.factor).toFixed(3)),
      availability_percent: toNumber(cell('availability_percent')),
      peak_availability_percent: toNumber(cell('peak_availability_percent')),
      cuf_percent: toNumber(cell('cuf_percent')),
      remarks: text('remarks'),
      raw: Object.fromEntries(header.map((h, c) => [sheet[headerIdx][c] || `column ${c + 1}`, raw[c] ?? null])),
    });
  });

  return {
    rows,
    errors,
    mapped_columns: Object.fromEntries([...claimed].map(([i, f]) => [f, sheet[headerIdx][i]])),
    unmapped_columns: header.map((h, i) => (h && !claimed.has(i) ? sheet[headerIdx][i] : null)).filter(Boolean),
    unit_used: (headingUnit || defaultUnit)?.key || 'per row',
    unit_from: headingUnit ? 'the energy column heading' : (defaultUnit ? 'the upload' : 'each row'),
  };
}

/**
 * Which contract each row belongs to. A contract number is taken as given; a
 * station name has to match exactly one contract, because a row matched to the
 * wrong contract bills the wrong party.
 */
export function matchContracts(rows) {
  const contracts = db.prepare(`
    SELECT c.id, c.contract_no, c.seller_id, c.buyer_id, s.name AS seller_name, b.name AS buyer_name
    FROM contracts c
    LEFT JOIN entities s ON s.id = c.seller_id
    LEFT JOIN entities b ON b.id = c.buyer_id
  `).all();
  const byNo = new Map(contracts.map((c) => [norm(c.contract_no), c]));

  return rows.map((row) => {
    if (row.contract_no) {
      const hit = byNo.get(norm(row.contract_no));
      return hit
        ? { ...row, contract_id: hit.id, matched_contract_no: hit.contract_no, matched_on: 'contract number' }
        : { ...row, contract_id: null, match_error: `No contract is numbered "${row.contract_no}".` };
    }
    const needle = norm(row.station);
    if (!needle) return { ...row, contract_id: null, match_error: 'The row names neither a contract nor a station.' };
    const hits = contracts.filter((c) => {
      const hay = `${norm(c.contract_no)} ${norm(c.seller_name)}`;
      return hay.includes(needle) || needle.includes(norm(c.seller_name || ' '));
    });
    if (hits.length === 1) {
      return { ...row, contract_id: hits[0].id, matched_contract_no: hits[0].contract_no, matched_on: 'station name' };
    }
    return {
      ...row,
      contract_id: null,
      match_error: hits.length
        ? `"${row.station}" matches ${hits.length} contracts (${hits.map((h) => h.contract_no).join(', ')}) — give the contract number.`
        : `"${row.station}" matches no contract.`,
    };
  });
}

/** What is already held for the same contract, month and data type. */
function existingRow(contractId, periodMonth, dataType) {
  return db.prepare(`
    SELECT * FROM energy_data
    WHERE contract_id = ? AND period_month = ? AND data_type = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(contractId, periodMonth, dataType);
}

/**
 * Write the matched rows as energy data. A row whose contract is unmatched, or
 * whose period is already locked, is reported and left alone — an import that
 * quietly skipped half a file would be worse than one that refused it.
 */
export function importEnergyAccount(buffer, {
  accountType = 'JMR', unit = null, periodMonth = null, dataType = 'PROVISIONAL',
  fileName = null, actor = null, dryRun = false,
} = {}) {
  if (!ACCOUNT_TYPES[accountType]) {
    throw new AccountImportError(400, `account_type must be one of ${Object.keys(ACCOUNT_TYPES).join(', ')}`);
  }
  if (!['PROVISIONAL', 'FINAL'].includes(dataType)) {
    throw new AccountImportError(400, 'data_type must be PROVISIONAL or FINAL');
  }
  if (periodMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodMonth)) {
    throw new AccountImportError(400, 'period_month must be YYYY-MM');
  }

  const parsed = parseEnergyAccount(buffer, { unit, periodMonth });
  if (!parsed.rows) return { ok: false, ...parsed };
  if (!parsed.rows.length) {
    return { ok: false, ...parsed, errors: [...(parsed.errors || []), 'No energy row could be read from this file.'] };
  }

  const matched = matchContracts(parsed.rows);
  // The source recorded against the row: the SLDC's account and an RLDC
  // statement are different documents and reconciliation compares them.
  const source = accountType === 'SEA' ? 'SLDC' : accountType;

  const results = [];
  const write = db.transaction(() => {
    for (const row of matched) {
      if (!row.contract_id) {
        results.push({ ...row, action: 'SKIPPED', reason: row.match_error });
        continue;
      }
      const existing = existingRow(row.contract_id, row.period_month, dataType);
      if (existing && existing.status === 'LOCKED') {
        results.push({
          ...row, action: 'SKIPPED',
          reason: `${row.period_month} is already locked on this contract at ${existing.energy_mwh} MWh; a locked month is superseded, not overwritten.`,
        });
        continue;
      }
      if (existing) {
        results.push({
          ...row, action: 'REPLACED', energy_data_id: existing.id,
          was_energy_mwh: existing.energy_mwh,
          changed: Number(existing.energy_mwh) !== row.energy_mwh,
        });
        if (dryRun) continue;
        db.prepare(`
          UPDATE energy_data SET energy_mwh = ?, source = ?,
            availability_percent = COALESCE(?, availability_percent),
            peak_availability_percent = COALESCE(?, peak_availability_percent),
            cuf_percent = COALESCE(?, cuf_percent),
            status = 'DRAFT', updated_at = datetime('now')
          WHERE id = ?
        `).run(
          row.energy_mwh, source, row.availability_percent, row.peak_availability_percent,
          row.cuf_percent, existing.id,
        );
        continue;
      }

      const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id);
      const bfr = buildBillingFamilyRef(contract.contract_no, row.period_month, directionForContract(contract));
      const supersedes = dataType === 'FINAL'
        ? db.prepare(`
            SELECT id FROM energy_data WHERE contract_id = ? AND period_month = ? AND data_type = 'PROVISIONAL'
            ORDER BY created_at ASC LIMIT 1
          `).get(row.contract_id, row.period_month)?.id || null
        : null;
      const id = newId('ENG');
      results.push({ ...row, action: 'CREATED', energy_data_id: id });
      if (dryRun) continue;
      db.prepare(`
        INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh,
          deemed_generation_mwh, cuf_percent, availability_percent, peak_availability_percent,
          status, billing_family_ref, supersedes_energy_id)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'DRAFT', ?, ?)
      `).run(
        id, row.contract_id, row.period_month, dataType, source, row.energy_mwh,
        row.cuf_percent, row.availability_percent, row.peak_availability_percent, bfr, supersedes,
      );
    }
  });
  write();

  const counted = (action) => results.filter((r) => r.action === action).length;
  return {
    ok: true,
    dry_run: !!dryRun,
    account_type: accountType,
    account_label: ACCOUNT_TYPES[accountType],
    source,
    data_type: dataType,
    file_name: fileName,
    imported_by: actor,
    unit_used: parsed.unit_used,
    unit_from: parsed.unit_from,
    mapped_columns: parsed.mapped_columns,
    unmapped_columns: parsed.unmapped_columns,
    rows_read: parsed.rows.length,
    created: counted('CREATED'),
    replaced: counted('REPLACED'),
    skipped: counted('SKIPPED'),
    errors: parsed.errors,
    rows: results,
  };
}

/** A blank account in the shape this reads, for each kind of document. */
export function accountTemplate(accountType = 'JMR') {
  if (!ACCOUNT_TYPES[accountType]) {
    throw new AccountImportError(400, `account_type must be one of ${Object.keys(ACCOUNT_TYPES).join(', ')}`);
  }
  if (accountType === 'JMR') {
    return [
      'Station,Contract No,Period,Unit,Energy Exported,Availability %,Remarks',
      'Nathpa Jhakri HEP,,YYYY-MM,MWh,,,Joint meter reading — main meter',
    ].join('\n') + '\n';
  }
  if (accountType === 'SEA') {
    return [
      'Station,Contract No,Beneficiary,Period,Unit,Scheduled Energy,Remarks',
      'NATHPA JHAKRI,,BRPL,YYYY-MM,MU,,State energy account Annexure — energy scheduled to the licensee',
    ].join('\n') + '\n';
  }
  return [
    'Station,Contract No,Period,Unit,Energy,Availability %,Remarks',
    'Rampur HEP,,YYYY-MM,MU,,,RLDC statement',
  ].join('\n') + '\n';
}
