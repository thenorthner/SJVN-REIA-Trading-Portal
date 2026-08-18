import db from '../db/index.js';
import { newId } from '../util.js';

// The grid/government agencies SJVN withholds TDS against, with the real PANs from
// the ISET ledger's TDS sheets. Delhi STU and Delhi SLDC share one PAN (Delhi
// Transco), as do the two West Bengal entities — that is how the ledger records
// them. Open-access / transmission charges attract Section 194C at 10%.
const VENDOR_SEED = [
  { name: 'CTUIL', pan: 'AAJCC2026N', category: 'CTU' },
  { name: 'GRID-INDIA', pan: 'AAFCP2086B', category: 'RLDC' },
  { name: 'RLDC-Fee', pan: 'AAFCP2086B', category: 'RLDC' },
  { name: 'Delhi STU', pan: 'AABCD6342A', category: 'STU' },
  { name: 'West Bengal STU', pan: 'AAACW6952G', category: 'STU' },
  { name: 'Delhi SLDC', pan: 'AABCD6342A', category: 'SLDC' },
  { name: 'West Bengal SLDC', pan: 'AAACW6952G', category: 'SLDC' },
  // Desk states beyond the ISET TDS sheet. PAN is filled once the agency's
  // 194C line is confirmed; the name still has to match the rate-master charge.
  { name: 'Haryana STU', pan: null, category: 'STU' },
  { name: 'Haryana SLDC', pan: null, category: 'SLDC' },
  { name: 'Punjab STU', pan: null, category: 'STU' },
  { name: 'Punjab SLDC', pan: null, category: 'SLDC' },
  { name: 'Gujarat STU', pan: null, category: 'STU' },
  { name: 'Gujarat SLDC', pan: null, category: 'SLDC' },
  { name: 'Sikkim STU', pan: null, category: 'STU' },
  { name: 'Sikkim SLDC', pan: null, category: 'SLDC' },
  { name: 'Himachal Pradesh STU', pan: null, category: 'STU' },
  { name: 'Himachal Pradesh SLDC', pan: null, category: 'SLDC' },
];

export function seedTdsVendors() {
  const exists = db.prepare('SELECT 1 FROM tds_vendors WHERE name = ?');
  const insert = db.prepare(`
    INSERT INTO tds_vendors (id, name, pan, category, default_section, default_rate, is_active)
    VALUES (?, ?, ?, ?, '194C', 0.10, 1)
  `);
  const tx = db.transaction(() => {
    for (const v of VENDOR_SEED) {
      if (!exists.get(v.name)) insert.run(newId('TDSV'), v.name, v.pan, v.category);
    }
  });
  tx();
}

export function listVendors() {
  return db.prepare('SELECT * FROM tds_vendors WHERE is_active = 1 ORDER BY category, name').all();
}

// Record a TDS deduction. When a known vendor is named, its PAN and default
// section/rate fill in anything the caller left out. tds_amount is always derived
// from taxable_amount x rate so the register can never carry an inconsistent pair.
export function recordTds({ vendorName, vendorId, section, rate, taxableAmount, referenceType, referenceNo, period, deductedDate, note, createdBy }) {
  let vendor = null;
  if (vendorId) vendor = db.prepare('SELECT * FROM tds_vendors WHERE id = ?').get(vendorId);
  if (!vendor && vendorName) vendor = db.prepare('SELECT * FROM tds_vendors WHERE name = ?').get(vendorName);

  const name = vendorName || vendor?.name;
  if (!name) throw new Error('vendorName or a valid vendorId is required');
  const pan = vendor?.pan || null;
  const sec = section || vendor?.default_section || '194C';
  const rt = rate != null ? Number(rate) : (vendor?.default_rate ?? 0.10);
  const taxable = Number(taxableAmount) || 0;
  const tds = Math.round(taxable * rt);

  const id = newId('TDS');
  db.prepare(`
    INSERT INTO tds_ledger (id, vendor_id, vendor_name, vendor_pan, section, rate, taxable_amount, tds_amount,
      reference_type, reference_no, period, deducted_date, status, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DEDUCTED', ?, ?)
  `).run(id, vendor?.id || null, name, pan, sec, rt, taxable, tds,
    referenceType || 'MANUAL', referenceNo || null, period || null, deductedDate || new Date().toISOString().slice(0, 10), note || null, createdBy || null);
  return db.prepare('SELECT * FROM tds_ledger WHERE id = ?').get(id);
}

// Record the challan against a deduction: it moves DEDUCTED -> DEPOSITED.
export function recordChallan(id, { challanNo, challanDate, paidToGovtDate }) {
  const row = db.prepare('SELECT * FROM tds_ledger WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare(`
    UPDATE tds_ledger SET challan_no = ?, challan_date = ?, paid_to_govt_date = ?, status = 'DEPOSITED'
    WHERE id = ?
  `).run(challanNo, challanDate || null, paidToGovtDate || challanDate || null, id);
  return db.prepare('SELECT * FROM tds_ledger WHERE id = ?').get(id);
}

// Outstanding TDS still to be deposited, grouped by vendor.
export function pendingByVendor() {
  return db.prepare(`
    SELECT vendor_name, vendor_pan, COUNT(*) AS deductions, ROUND(SUM(tds_amount), 2) AS tds_pending
    FROM tds_ledger
    WHERE status = 'DEDUCTED'
    GROUP BY vendor_name, vendor_pan
    ORDER BY tds_pending DESC
  `).all();
}

// Form-26Q-style rollup: total deducted / deposited / pending by vendor and PAN
// for a period (or all periods when period is null).
export function summary(period) {
  const where = period ? 'WHERE period = ?' : '';
  const params = period ? [period] : [];
  return db.prepare(`
    SELECT vendor_name, vendor_pan, section,
           COUNT(*) AS deductions,
           ROUND(SUM(taxable_amount), 2) AS taxable_total,
           ROUND(SUM(tds_amount), 2) AS tds_total,
           ROUND(SUM(CASE WHEN status = 'DEPOSITED' THEN tds_amount ELSE 0 END), 2) AS tds_deposited,
           ROUND(SUM(CASE WHEN status = 'DEDUCTED' THEN tds_amount ELSE 0 END), 2) AS tds_pending
    FROM tds_ledger
    ${where}
    GROUP BY vendor_name, vendor_pan, section
    ORDER BY tds_total DESC
  `).all(...params);
}

// Section 194Q applies to the energy SJVN sells, and deducting it correctly needs
// the buyer's PAN on file — without one the deduction is at the higher
// non-PAN rate under 206AA. The ISET ledger carries PANs only for the grid
// agencies SJVN pays, never for the buyers it bills, so this reports which
// counterparties still need one rather than inventing it.
export function panComplianceGaps() {
  const rows = db.prepare(`
    SELECT e.id, e.name, e.entity_type, e.pan_no, e.gst_no,
           (SELECT COUNT(*) FROM bilateral_transactions b
             JOIN trading_clients tc ON tc.id = b.client_id
            WHERE tc.entity_id = e.id) AS deals
    FROM entities e
    WHERE e.entity_type = 'BUYER'
    ORDER BY deals DESC, e.name
  `).all();

  const missing = rows.filter((r) => !r.pan_no);
  return {
    buyers: rows.length,
    with_pan: rows.length - missing.length,
    missing_pan: missing.length,
    compliance_pct: rows.length ? Number((((rows.length - missing.length) / rows.length) * 100).toFixed(1)) : 100,
    // Buyers actually trading are the ones that matter for 194Q.
    trading_without_pan: missing.filter((r) => r.deals > 0).length,
    items: rows.map((r) => ({
      entity_id: r.id, name: r.name, deals: r.deals,
      pan: r.pan_no || null, gst: r.gst_no || null,
      has_pan: !!r.pan_no,
      tds_rate_applicable: r.pan_no ? 0.001 : 0.05,   // 194Q 0.1%, or 206AA 5% without a PAN
      note: r.pan_no ? null : 'No PAN on file — 194Q deduction would fall under 206AA at the higher rate',
    })),
  };
}
