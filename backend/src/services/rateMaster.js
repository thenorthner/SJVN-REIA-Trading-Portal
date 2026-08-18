import db from '../db/index.js';
import { newId } from '../util.js';

// Baseline open-access charges taken from the ISET Power Trading Ledger. ISTS is
// the CTUIL inter-state tariff (revised periodically — the ledger shows values
// from ₹359 to ₹509/MWh over the year, so the seed is a representative baseline
// that later revisions supersede via effective_to). STU charges are per state,
// RLDC/SLDC operating charges are per day, and the NOAR portal fee is flat.
const BASELINE_EFFECTIVE_FROM = '2023-01-01';
const SEED_RATES = [
  { rate_category: 'ISTS', charge_name: 'ISTS', region: 'ALL', rate_value: 379.0, unit: 'Rs/MWh', note: 'CTUIL inter-state tariff (baseline; revised periodically)' },
  { rate_category: 'STU', charge_name: 'West Bengal STU', region: 'WEST_BENGAL', rate_value: 238.4, unit: 'Rs/MWh' },
  { rate_category: 'STU', charge_name: 'Delhi STU', region: 'DELHI', rate_value: 382.54, unit: 'Rs/MWh' },
  // Remaining desk states. Names must match supplier_sldc / procurer_sldc /
  // concerned_sldc exactly (`Himachal Pradesh`, not HP) so OA billing picks them
  // up. Baselines — confirm against the current SERC order before a live bill.
  { rate_category: 'STU', charge_name: 'Haryana STU', region: 'HARYANA', rate_value: 268.5, unit: 'Rs/MWh' },
  { rate_category: 'STU', charge_name: 'Punjab STU', region: 'PUNJAB', rate_value: 291.2, unit: 'Rs/MWh' },
  { rate_category: 'STU', charge_name: 'Gujarat STU', region: 'GUJARAT', rate_value: 214.8, unit: 'Rs/MWh' },
  { rate_category: 'STU', charge_name: 'Sikkim STU', region: 'SIKKIM', rate_value: 248.6, unit: 'Rs/MWh' },
  { rate_category: 'STU', charge_name: 'Himachal Pradesh STU', region: 'HIMACHAL_PRADESH', rate_value: 327.4, unit: 'Rs/MWh' },
  { rate_category: 'RLDC', charge_name: 'ERLDC', region: 'EAST', rate_value: 1000, unit: 'Rs/day' },
  { rate_category: 'RLDC', charge_name: 'NRLDC', region: 'NORTH', rate_value: 1000, unit: 'Rs/day' },
  { rate_category: 'RLDC', charge_name: 'RLDC Fee', region: 'ALL', rate_value: 1000, unit: 'Rs/day' },
  { rate_category: 'SLDC', charge_name: 'West Bengal SLDC', region: 'WEST_BENGAL', rate_value: 1000, unit: 'Rs/day' },
  { rate_category: 'SLDC', charge_name: 'Delhi SLDC', region: 'DELHI', rate_value: 1000, unit: 'Rs/day' },
  { rate_category: 'SLDC', charge_name: 'Haryana SLDC', region: 'HARYANA', rate_value: 1000, unit: 'Rs/day' },
  { rate_category: 'SLDC', charge_name: 'Punjab SLDC', region: 'PUNJAB', rate_value: 1000, unit: 'Rs/day' },
  { rate_category: 'SLDC', charge_name: 'Gujarat SLDC', region: 'GUJARAT', rate_value: 1000, unit: 'Rs/day' },
  { rate_category: 'SLDC', charge_name: 'Sikkim SLDC', region: 'SIKKIM', rate_value: 1000, unit: 'Rs/day' },
  { rate_category: 'SLDC', charge_name: 'Himachal Pradesh SLDC', region: 'HIMACHAL_PRADESH', rate_value: 1000, unit: 'Rs/day' },
  { rate_category: 'NOAR_FEE', charge_name: 'NOAR Application Fee', region: 'ALL', rate_value: 5000, unit: 'Rs/application' },
  // Charged once per open-access application by the drawal-state SLDC for its
  // consent; billed on its own invoice in the ISET register.
  { rate_category: 'SLDC', charge_name: 'SLDC Consent Fee', region: 'ALL', rate_value: 5000, unit: 'Rs/application' },
  // Power-exchange fees, levied on cleared volume. These are baselines at the
  // published transaction fee — each exchange revises its own, so they are held
  // here as effective-dated rows the desk edits rather than constants in code.
  { rate_category: 'EXCHANGE_FEE', charge_name: 'IEX Transaction Fee', region: 'ALL', rate_value: 20, unit: 'Rs/MWh', note: 'Baseline Rs 0.02/kWh — confirm against the current IEX circular' },
  { rate_category: 'EXCHANGE_FEE', charge_name: 'PXIL Transaction Fee', region: 'ALL', rate_value: 20, unit: 'Rs/MWh', note: 'Baseline Rs 0.02/kWh — confirm against the current PXIL circular' },
  { rate_category: 'EXCHANGE_FEE', charge_name: 'HPX Transaction Fee', region: 'ALL', rate_value: 20, unit: 'Rs/MWh', note: 'Baseline Rs 0.02/kWh — confirm against the current HPX circular' },
  // REC trading fee, charged per certificate traded on the exchange. Held here
  // rather than in code so the desk can revise it when the circular changes.
  { rate_category: 'EXCHANGE_FEE', charge_name: 'REC Trading Fee', region: 'ALL', rate_value: 2, unit: 'Rs/REC', note: 'Baseline Rs 2 per certificate — confirm against the current exchange circular' },
];

// Seed once. Idempotent: a charge_name that already has any row is left alone so
// operator edits and later revisions are never clobbered on restart.
export function seedRateMaster() {
  const exists = db.prepare('SELECT 1 FROM rate_master WHERE charge_name = ? LIMIT 1');
  const insert = db.prepare(`
    INSERT INTO rate_master (id, rate_category, charge_name, region, rate_value, unit, effective_from, effective_to, note, is_active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, 'SYSTEM_SEED')
  `);
  const tx = db.transaction(() => {
    for (const r of SEED_RATES) {
      if (exists.get(r.charge_name)) continue;
      insert.run(newId('RATE'), r.rate_category, r.charge_name, r.region, r.rate_value, r.unit, BASELINE_EFFECTIVE_FROM, r.note || null);
    }
  });
  tx();
}

// The rate in force for a charge on a given date. Picks the row whose validity
// window contains the date, most recent effective_from winning when two overlap.
//
// ISTS is priced per transmission corridor — the ledger shows the same day billed
// at 390.12/MWh in the Western Region, 508.92 in the Northern and 419.01 in the
// Eastern — so a region may be given. A rate held for that region wins; otherwise
// the lookup falls back to a region-agnostic ('ALL') row.
export function getEffectiveRate(chargeName, onDate, region) {
  const d = onDate || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT * FROM rate_master
    WHERE charge_name = ? AND is_active = 1
      AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY effective_from DESC
  `).all(chargeName, d, d);
  if (!rows.length) return null;
  if (region) {
    const exact = rows.find((r) => r.region === region);
    if (exact) return exact;
  }
  return rows.find((r) => r.region === 'ALL' || r.region == null) || rows[0];
}

// Insert a revision: closes the current open row's window the day before the new
// one starts, then inserts the new rate. Keeps history intact and non-overlapping.
export function reviseRate({ chargeName, newValue, effectiveFrom, createdBy, note }) {
  const current = getEffectiveRate(chargeName, effectiveFrom);
  const tx = db.transaction(() => {
    if (current && (current.effective_to == null || current.effective_to >= effectiveFrom)) {
      const prevDay = new Date(new Date(effectiveFrom).getTime() - 86400000).toISOString().slice(0, 10);
      db.prepare('UPDATE rate_master SET effective_to = ? WHERE id = ?').run(prevDay, current.id);
    }
    const base = current || {};
    const id = newId('RATE');
    db.prepare(`
      INSERT INTO rate_master (id, rate_category, charge_name, region, rate_value, unit, effective_from, effective_to, note, is_active, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?)
    `).run(id, base.rate_category || 'OTHER', chargeName, base.region || null, newValue, base.unit || 'Rs/MWh', effectiveFrom, note || null, createdBy || null);
    return id;
  });
  return tx();
}
