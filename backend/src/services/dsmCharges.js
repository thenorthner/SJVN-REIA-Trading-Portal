import db from '../db/index.js';
import { newId } from '../util.js';

// Frequency-linked deviation (DSM) charges.
//
// Until now a block's deviation was priced by a placeholder in the bilateral
// route — |deviation MW| x 60 — a number with no regulatory basis that still
// reached the energy bill as "Deviation (DSM) charges". This module replaces it
// with the real shape of the mechanism: the charge depends on which side of its
// schedule the block landed and on the grid frequency during that block, read
// off effective-dated slabs the desk maintains in dsm_charge_slabs.
//
// What this module deliberately does NOT do is invent slab values. The notified
// CERC / SERC slabs are not in this repository, so the seed lays out the band
// structure with the rates left empty and unverified, and the calculator refuses
// to price a block against an unverified or empty slab. An unpriced block comes
// back as zero with a reason code, never as a plausible-looking rupee figure.

const BLOCK_HOURS = 0.25;
const PAISE_PER_RUPEE = 100;

// The band that the deviation settlement framework treats as normal operation
// sits either side of 50 Hz; the seeded structure splits the range there and
// leaves the finer sub-bands of the notification to be added by the desk.
const NORMAL_BAND = { low: 49.95, high: 50.05 };
const BASELINE_EFFECTIVE_FROM = '2023-01-01';

const SEED_NOTE =
  'Band structure only — enter the rate from the notified CERC / SERC deviation '
  + 'settlement slab and mark the row verified before it can price a bill.';

const SEED_SLABS = [
  { slab_name: 'Over-injection, frequency above normal band', deviation_side: 'OVER', freq_from_hz: NORMAL_BAND.high, freq_to_hz: null, settlement_sign: 1 },
  { slab_name: 'Over-injection, frequency in normal band', deviation_side: 'OVER', freq_from_hz: NORMAL_BAND.low, freq_to_hz: NORMAL_BAND.high, settlement_sign: -1 },
  { slab_name: 'Over-injection, frequency below normal band', deviation_side: 'OVER', freq_from_hz: null, freq_to_hz: NORMAL_BAND.low, settlement_sign: -1 },
  { slab_name: 'Under-injection, frequency above normal band', deviation_side: 'UNDER', freq_from_hz: NORMAL_BAND.high, freq_to_hz: null, settlement_sign: 1 },
  { slab_name: 'Under-injection, frequency in normal band', deviation_side: 'UNDER', freq_from_hz: NORMAL_BAND.low, freq_to_hz: NORMAL_BAND.high, settlement_sign: 1 },
  { slab_name: 'Under-injection, frequency below normal band', deviation_side: 'UNDER', freq_from_hz: null, freq_to_hz: NORMAL_BAND.low, settlement_sign: 1 },
];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Lay out the band structure once, with no rates in it.
 *
 * Idempotent: a slab_name that already has a row is left alone, so a desk that
 * has entered and verified its rates never has them reset on restart.
 */
export function seedDsmSlabs() {
  const exists = db.prepare('SELECT 1 FROM dsm_charge_slabs WHERE slab_name = ? LIMIT 1');
  const insert = db.prepare(`
    INSERT INTO dsm_charge_slabs
      (id, slab_name, deviation_side, freq_from_hz, freq_to_hz, charge_basis, charge_value,
       reference_price_key, cap_paise_per_kwh, settlement_sign, effective_from, effective_to,
       is_verified, source_note, is_active, created_by)
    VALUES (?, ?, ?, ?, ?, 'FLAT', NULL, NULL, NULL, ?, ?, NULL, 0, ?, 1, 'SYSTEM_SEED')
  `);
  const tx = db.transaction(() => {
    for (const s of SEED_SLABS) {
      if (exists.get(s.slab_name)) continue;
      insert.run(newId('DSMS'), s.slab_name, s.deviation_side, s.freq_from_hz, s.freq_to_hz,
        s.settlement_sign, BASELINE_EFFECTIVE_FROM, SEED_NOTE);
    }
  });
  tx();
}

/** Which side of its schedule a block landed on. */
export function deviationSide(deviationMwh) {
  const d = num(deviationMwh);
  if (d > 0) return 'OVER';
  if (d < 0) return 'UNDER';
  return null;
}

/**
 * The slab in force for a side and frequency on a date.
 *
 * Bands are half-open [from, to): a frequency exactly on a boundary belongs to
 * the band above it, so 50.05 Hz is "above the normal band" and not both. A slab
 * naming the side explicitly beats a BOTH slab covering the same band.
 */
export function getEffectiveSlab({ side, frequencyHz, onDate } = {}) {
  if (!side || frequencyHz == null || !Number.isFinite(Number(frequencyHz))) return null;
  const f = Number(frequencyHz);
  const d = onDate || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT * FROM dsm_charge_slabs
    WHERE is_active = 1
      AND deviation_side IN (?, 'BOTH')
      AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to >= ?)
      AND (freq_from_hz IS NULL OR freq_from_hz <= ?)
      AND (freq_to_hz IS NULL OR freq_to_hz > ?)
    ORDER BY effective_from DESC
  `).all(side, d, d, f, f);
  if (!rows.length) return null;
  return rows.find((r) => r.deviation_side === side) || rows[0];
}

/**
 * The reference price a PCT_OF_REFERENCE slab is priced off, in paise/kWh.
 *
 * DAM_ACP reads the day's day-ahead clearing price out of market_rates, which
 * holds it in Rs/kWh. An unknown key, or a date the exchange price has not been
 * loaded for, returns null — the block then goes unpriced rather than being
 * charged off a stale or guessed price.
 */
export function getReferencePrice(key, onDate) {
  if (!key) return null;
  if (key !== 'DAM_ACP') return null;
  const row = db.prepare(`
    SELECT AVG(mcp_rate) AS rate FROM market_rates
    WHERE product = 'DAM' AND rate_date = ?
  `).get(onDate);
  const rate = row?.rate;
  return Number.isFinite(rate) && rate > 0 ? rate * PAISE_PER_RUPEE : null;
}

/**
 * Price one 15-minute block's deviation.
 *
 * Returns the rupee amount together with the basis it was arrived at, so an
 * unpriced block is always distinguishable from a genuinely free one:
 *
 *   CERC_SLAB            priced off slab_id at rate_paise_per_kwh
 *   NO_DEVIATION         the block met its schedule; nothing to charge
 *   NO_FREQUENCY         no grid frequency recorded against the block
 *   NO_SLAB              no slab covers that side and frequency on that date
 *   SLAB_UNVERIFIED      a slab covers it, but its rate is unentered or unverified
 *   NO_REFERENCE_PRICE   a percentage slab covers it, but its reference price is unavailable
 *
 * Everything but CERC_SLAB and NO_DEVIATION carries a warning and a zero amount.
 */
export function computeDsmCharge({ deviationMwh, frequencyHz = null, onDate = null, referencePricePaisePerKwh = null } = {}) {
  const deviation = num(deviationMwh);
  const unpriced = (basis, warning) => ({
    amount: 0,
    basis,
    slab_id: null,
    slab_name: null,
    rate_paise_per_kwh: null,
    deviation_mwh: Number(deviation.toFixed(4)),
    warning,
  });

  const side = deviationSide(deviation);
  if (!side) return { ...unpriced('NO_DEVIATION', null), warning: null };
  if (frequencyHz == null || !Number.isFinite(Number(frequencyHz))) {
    return unpriced('NO_FREQUENCY', 'Block has no grid frequency recorded, so its deviation could not be priced');
  }

  const slab = getEffectiveSlab({ side, frequencyHz, onDate });
  if (!slab) {
    return unpriced('NO_SLAB', `No DSM slab covers ${side} deviation at ${frequencyHz} Hz on ${onDate || 'today'}`);
  }
  if (!slab.is_verified || slab.charge_value == null) {
    return unpriced('SLAB_UNVERIFIED', `Slab '${slab.slab_name}' has no verified rate entered, so its deviation was left unpriced`);
  }

  let ratePaise;
  if (slab.charge_basis === 'FLAT') {
    ratePaise = num(slab.charge_value);
  } else {
    const reference = referencePricePaisePerKwh != null
      ? num(referencePricePaisePerKwh)
      : getReferencePrice(slab.reference_price_key, onDate);
    if (!reference) {
      return unpriced('NO_REFERENCE_PRICE', `Slab '${slab.slab_name}' prices off ${slab.reference_price_key || 'a reference price'}, which is unavailable for ${onDate || 'today'}`);
    }
    ratePaise = reference * (num(slab.charge_value) / 100);
  }
  if (slab.cap_paise_per_kwh != null) {
    ratePaise = Math.min(ratePaise, num(slab.cap_paise_per_kwh));
  }

  // The charge is levied on the size of the deviation; which way the money moves
  // is the slab's sign, so a credit comes back negative.
  const kwh = Math.abs(deviation) * 1000;
  const amount = Math.round((kwh * ratePaise / PAISE_PER_RUPEE) * num(slab.settlement_sign));

  return {
    amount,
    basis: 'CERC_SLAB',
    slab_id: slab.id,
    slab_name: slab.slab_name,
    rate_paise_per_kwh: Number(ratePaise.toFixed(4)),
    deviation_mwh: Number(deviation.toFixed(4)),
    warning: null,
  };
}

/** Same calculation from a block's MW deviation rather than its energy. */
export function computeDsmChargeFromMw({ deviationMw, ...rest } = {}) {
  return computeDsmCharge({ deviationMwh: num(deviationMw) * BLOCK_HOURS, ...rest });
}
