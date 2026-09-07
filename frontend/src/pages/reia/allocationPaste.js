/**
 * Read an REA allocation sheet pasted out of a spreadsheet.
 *
 * A desk has the sheet in Excel, so the fastest honest path from there to here
 * is a paste. One beneficiary per line, name and percentage separated by a tab
 * or by two or more spaces — so that "BSES RAJDHANI POWER" survives as one name.
 * A third column, if present, is the state the beneficiary rolls up to.
 * A name ending in * marks the home state that carries the free power.
 */
export function parseAllocationPaste(text) {
  const rows = [];
  const errors = [];
  const lines = String(text || '').split(/\r?\n/);

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/\t|\s{2,}|\s*\|\s*|\s*,\s*/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) {
      errors.push(`Line ${i + 1}: "${line}" — expected a name and a percentage`);
      return;
    }
    // The percentage is the first purely numeric field after the name, so a
    // leading serial number on a pasted row does not get read as the share.
    const numIdx = parts.findIndex((x, j) => j > 0 && /^-?\d+(\.\d+)?%?$/.test(x));
    if (numIdx < 0) {
      errors.push(`Line ${i + 1}: "${line}" — no percentage found`);
      return;
    }
    let name = parts.slice(0, numIdx).join(' ').trim();
    // A pasted sheet often carries its serial number in the first column.
    name = name.replace(/^\d+[.)]?\s+/, '').trim();
    const isHome = /\*\s*$/.test(name);
    if (isHome) name = name.replace(/\*\s*$/, '').trim();
    if (!name) {
      errors.push(`Line ${i + 1}: "${line}" — no beneficiary name`);
      return;
    }
    const pct = Number(parts[numIdx].replace('%', ''));
    if (!Number.isFinite(pct) || pct < 0) {
      errors.push(`Line ${i + 1}: "${parts[numIdx]}" is not a usable percentage`);
      return;
    }
    rows.push({
      sr_no: rows.length + 1,
      beneficiary_name: name,
      parent_state: parts[numIdx + 1] || null,
      pct_rea: pct,
      is_home_state: isHome ? 1 : 0,
    });
  });

  const total = rows.reduce((a, r) => a + r.pct_rea, 0);
  return { rows, errors, total, closesOn100: rows.length > 0 && Math.abs(total - 100) <= 0.01 };
}
