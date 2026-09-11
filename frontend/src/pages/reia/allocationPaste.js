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

/**
 * Read the REA's per-beneficiary scheduled energy, pasted out of table D2.
 *
 * The Regional Energy Account states each beneficiary's energy in Lakh Units,
 * and the bill is in kWh, so the unit is asked for rather than guessed: reading
 * 125.396150 LU as kWh understates that beneficiary by a factor of 100,000, and
 * a silent factor is a worse failure than a wrong one.
 *
 * Same line shape as the allocation sheet — one beneficiary per line, name and
 * figure separated by a tab or two or more spaces, so a multi-word name such as
 * "BSES RAJDHANI POWER" survives intact.
 */
export function parseEnergyPaste(text, { unit = 'LU' } = {}) {
  const factor = unit === 'kWh' ? 1 : 100000;
  const rows = [];
  const errors = [];

  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/\t|\s{2,}|\s*\|\s*/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) {
      errors.push(`Line ${i + 1}: "${line}" — expected a name and an energy figure`);
      return;
    }
    // The figure is the last purely numeric field, so a serial number carried in
    // from the sheet is not mistaken for the energy.
    let numIdx = -1;
    for (let j = parts.length - 1; j > 0; j -= 1) {
      if (/^-?[\d,]+(\.\d+)?$/.test(parts[j])) { numIdx = j; break; }
    }
    if (numIdx < 0) {
      errors.push(`Line ${i + 1}: "${line}" — no energy figure found`);
      return;
    }
    let name = parts.slice(0, numIdx).join(' ').replace(/^\d+[.)]?\s+/, '').trim();
    if (!name) {
      errors.push(`Line ${i + 1}: "${line}" — no beneficiary name`);
      return;
    }
    const value = Number(parts[numIdx].replace(/,/g, ''));
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`Line ${i + 1}: "${parts[numIdx]}" is not a usable energy figure`);
      return;
    }
    rows.push({ beneficiary_name: name, kwh: Math.round(value * factor * 10) / 10 });
  });

  const total = Math.round(rows.reduce((a, r) => a + r.kwh, 0) * 10) / 10;
  return { rows, errors, total, unit };
}
