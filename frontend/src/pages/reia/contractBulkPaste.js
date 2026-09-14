/**
 * Read a contract sheet pasted (or opened) out of the bulk template.
 *
 * The desk has the signed contracts in a spreadsheet; the fastest honest path
 * from there to here is the template's own columns, in its own order or not. The
 * header row is what names the columns, so a file with the columns rearranged
 * still loads, and a column the loader does not read is named rather than
 * silently dropped — the API says the same thing, but saying it before the round
 * trip is kinder.
 */

export const BULK_COLUMNS = [
  'contract_no', 'contract_type', 'project_type', 'seller_id', 'buyer_id',
  'capacity_mw', 'commissioned_capacity_mw', 'cod_date',
  'tariff_per_unit', 'tenure_start', 'tenure_end', 'billing_cycle',
  'emd_amount', 'pbg_amount',
];

const NUMERIC = new Set(['capacity_mw', 'commissioned_capacity_mw', 'tariff_per_unit', 'emd_amount', 'pbg_amount']);

/**
 * Split a line into cells: on tabs when it has them, commas otherwise.
 *
 * Commas inside quotes belong to the value, not between values — a spreadsheet
 * writes 5000000 as "5,000,000" — so a plain split would tear that amount into
 * three cells and shift every column after it.
 */
function cells(line) {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      // A doubled quote inside a quoted field is one literal quote.
      if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  out.push(cell.trim());
  return out;
}

/** Strip the surrounding quotes a spreadsheet adds to a field it exported. */
const unquote = (v) => v.replace(/^"(.*)"$/s, '$1').trim();

export function parseContractBulk(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { rows: [], errors: [], unknownColumns: [], header: [] };

  const header = cells(lines[0]).map((h) => unquote(h).toLowerCase().replace(/\s+/g, '_'));
  const known = header.filter((h) => BULK_COLUMNS.includes(h));
  if (known.length === 0) {
    return {
      rows: [],
      errors: [`The first line must name the columns. None of "${header.join(', ')}" is a column the loader reads.`],
      unknownColumns: header,
      header,
    };
  }
  const unknownColumns = header.filter((h) => h && !BULK_COLUMNS.includes(h));

  const rows = [];
  const errors = [];
  lines.slice(1).forEach((raw, i) => {
    const line = i + 2; // the line the reader sees in the file
    const values = cells(raw).map(unquote);
    if (values.every((v) => v === '')) return;
    const row = {};
    header.forEach((column, idx) => {
      if (!BULK_COLUMNS.includes(column)) return;
      const value = values[idx] ?? '';
      if (value === '') return;
      row[column] = NUMERIC.has(column) ? Number(value.replace(/,/g, '')) : value;
    });
    const badNumber = Object.keys(row).find((k) => NUMERIC.has(k) && !Number.isFinite(row[k]));
    if (badNumber) {
      errors.push(`Line ${line}: ${badNumber} is not a number`);
      return;
    }
    if (Object.keys(row).length === 0) {
      errors.push(`Line ${line}: no values in any column the loader reads`);
      return;
    }
    rows.push(row);
  });

  return { rows, errors, unknownColumns, header };
}
