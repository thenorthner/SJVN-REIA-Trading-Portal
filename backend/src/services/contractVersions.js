import db from '../db/index.js';
import { resolveTariff } from './tariffStructure.js';

// The versions of a contract, and which one is in force when (1-Nov-2026).
//
// An amendment is a new contracts row — version n+1, parent_contract_id the
// first version — that applies from its amendment_effective_from once it has
// been activated. The version before it stays the agreement for everything
// earlier, and until activation the amendment changes nothing. Billing asked
// none of this: it priced whichever row was picked, and every version carries
// the same contract number, so a month could be billed on both versions, on
// the terms of the wrong one, and a revision dated mid-month was never split.

/** A version that went live. Pending, draft and terminated versions bill nothing. */
export const LIVE_VERSION_STATUSES = ['ACTIVE', 'NEARING_EXPIRY', 'EXPIRED', 'RENEWED', 'AMENDED'];

const byId = (id) => db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);

/** Every version of the contract this row belongs to, oldest first. */
export function contractFamily(contractOrId) {
  const c = typeof contractOrId === 'string' ? byId(contractOrId) : contractOrId;
  if (!c) return [];
  const root = c.parent_contract_id || c.id;
  return db.prepare('SELECT * FROM contracts WHERE id = ? OR parent_contract_id = ? ORDER BY version, created_at').all(root, root);
}

export function familyIds(contractOrId) {
  const ids = contractFamily(contractOrId).map((v) => v.id);
  return ids.length ? ids : [typeof contractOrId === 'string' ? contractOrId : contractOrId?.id].filter(Boolean);
}

/**
 * The version in force on a day: the latest live version that had taken effect
 * by then. A later version dated earlier than the one before it (a second order
 * reaching further back) displaces that one from its own date.
 */
export function versionOn(family, date) {
  let pick = null;
  for (const v of family) {
    if (!LIVE_VERSION_STATUSES.includes(v.status)) continue;
    const from = pick && v.amendment_effective_from ? String(v.amendment_effective_from).slice(0, 10) : '0000-01-01';
    if (from <= date) pick = v;
  }
  return pick;
}

const daysIn = (periodMonth) => {
  const [y, m] = String(periodMonth).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * The parts of a month and the version each is on: one part in most months,
 * more where a revision took effect inside it. A part with no version is a
 * stretch no live version covers.
 */
export function versionSegments(contractOrId, periodMonth) {
  const family = contractFamily(contractOrId);
  const segs = [];
  for (let d = 1; d <= daysIn(periodMonth); d += 1) {
    const date = `${periodMonth}-${String(d).padStart(2, '0')}`;
    const v = versionOn(family, date);
    const last = segs[segs.length - 1];
    if (last && (last.version?.id ?? null) === (v?.id ?? null)) {
      last.to = date;
      last.days += 1;
    } else {
      segs.push({ version: v, from: date, to: date, days: 1 });
    }
  }
  return segs;
}

/** The version that governs a month: the one in force on its first day. */
export function governingVersion(contractOrId, periodMonth) {
  return versionSegments(contractOrId, periodMonth)[0]?.version || null;
}

/**
 * How a month's energy divides across its parts: by the energy delivered in
 * each, where the month's 15-minute data is in for every day, and otherwise by
 * days. Metered energy is the settlement basis; days are the fallback when no
 * daily figure exists.
 */
function segmentShares(segs, energyContractIds, periodMonth) {
  const days = daysIn(periodMonth);
  const ids = [...new Set(energyContractIds || [])];
  if (ids.length) {
    const perDay = db.prepare(`
      SELECT block_date d, SUM(COALESCE(actual_mwh, 0)) mwh FROM energy_blocks
      WHERE contract_id IN (${ids.map(() => '?').join(',')}) AND period_month = ? GROUP BY block_date
    `).all(...ids, periodMonth);
    const total = perDay.reduce((t, r) => t + r.mwh, 0);
    if (perDay.length === days && total > 0) {
      return {
        basis: 'ENERGY',
        shares: segs.map((s) => perDay.filter((r) => r.d >= s.from && r.d <= s.to).reduce((t, r) => t + r.mwh, 0) / total),
      };
    }
  }
  return { basis: 'DAYS', shares: segs.map((s) => s.days / days) };
}

const fmtDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * The tariff a month is billed on, across the versions in force in it. Where
 * one version covers the month this is resolveTariff on that version. Where a
 * revision took effect inside it, each part is priced at its own version's rate
 * and the month's rate is their weighted sum — energy × that rate is exactly
 * the sum of each part's energy × its rate — and a fixed charge is pro-rated
 * by days. `rate` keeps full precision for pricing; `parts` describe the split.
 */
export function tariffForMonth(contract, periodMonth, energyContractIds = []) {
  const segs = versionSegments(contract, periodMonth).filter((s) => s.version);
  if (segs.length <= 1) return { ...resolveTariff(segs[0]?.version || contract, periodMonth), parts: null };
  const { basis, shares } = segmentShares(segs, energyContractIds, periodMonth);
  const days = daysIn(periodMonth);
  const parts = segs.map((s, i) => {
    const t = resolveTariff(s.version, periodMonth);
    const span = s.from === s.to ? fmtDay(s.from) : `${Number(s.from.slice(8))}–${fmtDay(s.to)}`;
    return {
      version: s.version.version, contract_id: s.version.id, from: s.from, to: s.to, days: s.days, share: shares[i], tariff: t,
      label: `${span} (${s.days} day${s.days === 1 ? '' : 's'}, ${(shares[i] * 100).toFixed(1)}% of the month's energy${basis === 'DAYS' ? ' by days' : ''}) — version ${s.version.version}: ${t.label}`,
    };
  });
  const rate = parts.reduce((t, p) => t + p.share * p.tariff.rate, 0);
  const fixed = Math.round(parts.reduce((t, p) => t + (p.days / days) * (p.tariff.fixed_charge || 0), 0));
  return {
    type: 'SPLIT', rate, fixed_charge: fixed, contract_year: parts[0].tariff.contract_year, basis, parts,
    label: `Tariff revised within ${periodMonth}: ${parts.map((p) => `₹${p.tariff.rate} ${p.from === parts[0].from ? 'to' : 'from'} ${fmtDay(p.from === parts[0].from ? p.to : p.from)}`).join(', ')} — ₹${Number(rate.toFixed(6))}/unit for the month`,
  };
}
