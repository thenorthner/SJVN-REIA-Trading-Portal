/**
 * Read a sheet pasted (or opened) out of a template.
 *
 * The header row names the columns, so a file with them rearranged still loads,
 * and a column the loader does not read is named rather than silently dropped.
 * Tab-separated when it has tabs — that is what Excel puts on the clipboard —
 * comma-separated otherwise, with quotes and the commas inside them respected, so
 * "5,000,000" is one amount and not three cells.
 *
 * Shared by the contract loader and the seller invoice loader: the two sheets
 * differ only in which columns they carry.
 */

/** Split a line into cells: tabs when present, otherwise quote-aware commas. */
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

/**
 * @param {string} text        the pasted sheet
 * @param {object} spec
 * @param {string[]} spec.columns  the columns the loader reads
 * @param {string[]} [spec.numeric] which of those are numbers
 * @returns {{rows: object[], errors: string[], unknownColumns: string[], header: string[]}}
 */
export function parseSheet(text, { columns, numeric = [] }) {
  const known = new Set(columns);
  const isNumeric = new Set(numeric);
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { rows: [], errors: [], unknownColumns: [], header: [] };

  const header = cells(lines[0]).map((h) => unquote(h).toLowerCase().replace(/\s+/g, '_'));
  if (!header.some((h) => known.has(h))) {
    return {
      rows: [],
      errors: [`The first line must name the columns. None of "${header.join(', ')}" is a column the loader reads.`],
      unknownColumns: header,
      header,
    };
  }
  const unknownColumns = header.filter((h) => h && !known.has(h));

  const rows = [];
  const errors = [];
  lines.slice(1).forEach((raw, i) => {
    const line = i + 2; // the line the reader sees in the file
    const values = cells(raw).map(unquote);
    if (values.every((v) => v === '')) return;

    const row = {};
    header.forEach((column, idx) => {
      if (!known.has(column)) return;
      const value = values[idx] ?? '';
      if (value === '') return;
      row[column] = isNumeric.has(column) ? Number(value.replace(/,/g, '')) : value;
    });

    const badNumber = Object.keys(row).find((k) => isNumeric.has(k) && !Number.isFinite(row[k]));
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
