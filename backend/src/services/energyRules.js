// What a month's energy figure has to satisfy before it is held against a
// contract — one set of rules for every way a figure comes in: typed on the
// desk, imported from a JMR / SEA / RLDC table, or read off an REA.
//
// The manual form checked a few of these and the file import none: an import
// wrote a future month, a negative figure and more energy than the plant could
// physically make, all straight into the register.

import db from '../db/index.js';
import { billableCapacityMw } from '../util.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const hoursInMonth = (period) => {
  const [y, m] = String(period).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate() * 24;
};

export const isHydro = (contract) => ['HYDRO', 'PSP'].includes(String(contract?.project_type || '').trim().toUpperCase());

/** The last month that has ended — a month still running has no energy account yet. */
export function lastCompleteMonth(today = new Date()) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The most a plant can deliver in a month: its capacity for every hour of it.
 * A hydro station may run on its overload capability (CERC allows declared
 * capacity up to about 110%), so it gets that headroom; nothing else does.
 */
export function maxEnergyMwh(contract, period) {
  const mw = billableCapacityMw(contract);
  if (!(mw > 0) || !MONTH.test(String(period))) return null;
  return round(mw * hoursInMonth(period) * (isHydro(contract) ? 1.1 : 1), 3);
}

export function cufFor(contract, period, energyMwh) {
  const mw = billableCapacityMw(contract);
  if (!(mw > 0) || !MONTH.test(String(period))) return null;
  return round((Number(energyMwh) / (mw * hoursInMonth(period))) * 100);
}

/**
 * Every problem with a figure, in words. `r` holds period_month, energy_mwh and
 * optionally deemed_generation_mwh, cuf_percent, availability_percent,
 * peak_availability_percent. Returns { errors, cuf } — cuf being the CUF the
 * energy works out to, which is what is stored when none was given.
 */
export function energyRowProblems(contract, r, { today = new Date() } = {}) {
  const errors = [];
  const add = (m) => errors.push(m);
  const no = contract?.contract_no || 'This contract';
  if (!contract) return { errors: ['Contract not found.'], cuf: null };

  if (['DRAFT', 'UNDER_NEGOTIATION'].includes(contract.status)) {
    add(`${no} is still ${contract.status.replace(/_/g, ' ')} — energy is recorded against a signed contract.`);
  }

  const period = String(r.period_month || '');
  if (!MONTH.test(period)) {
    add('The period is a month, written YYYY-MM.');
  } else {
    const last = lastCompleteMonth(today);
    if (period > last) {
      add(period.slice(0, 7) === `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`
        ? `${period} has not ended yet — its energy account can only be recorded once the month is over (latest: ${last}).`
        : `${period} has not begun — energy cannot be recorded for a future month (latest: ${last}).`);
    }
    const from = String(contract.tenure_start || '').slice(0, 7);
    const to = String(contract.tenure_end || '').slice(0, 7);
    if ((from && period < from) || (to && period > to)) add(`${no} runs from ${from || '—'} to ${to || '—'}; ${period} is outside it.`);
    if (contract.status === 'TERMINATED' && contract.termination_date && period > String(contract.termination_date).slice(0, 7)) {
      add(`${no} was terminated on ${contract.termination_date}; ${period} is after it.`);
    }
  }

  // A PSA's energy is its share of the source PPA's — recording it directly
  // counted the same MWh twice, once on each side.
  if (contract.contract_type === 'PSA' && MONTH.test(period)) {
    const fed = db.prepare(`
      SELECT c.contract_no FROM contract_allocations a JOIN contracts c ON c.id = a.ppa_id
      WHERE a.psa_id = ? AND a.effective_from <= ? AND COALESCE(a.effective_to, '9999-12-31') >= ?
      LIMIT 1
    `).get(contract.id, `${period}-31`, `${period}-01`);
    if (fed) add(`${no} draws its energy from ${fed.contract_no} for ${period} — record the energy on the PPA; the PSA's share follows from the allocation.`);
  }

  const e = Number(r.energy_mwh);
  if (r.energy_mwh === '' || r.energy_mwh == null || !Number.isFinite(e) || e < 0) add('Energy must be a number of MWh, zero or more.');
  const deemed = r.deemed_generation_mwh === '' || r.deemed_generation_mwh == null ? 0 : Number(r.deemed_generation_mwh);
  if (!Number.isFinite(deemed) || deemed < 0) add('Deemed generation must be a number of MWh, zero or more.');

  const max = maxEnergyMwh(contract, period);
  if (max != null && Number.isFinite(e) && e + (Number.isFinite(deemed) ? deemed : 0) > max) {
    add(`${round(e + deemed, 3)} MWh is more than ${no} can make in ${period}: ${billableCapacityMw(contract)} MW × ${hoursInMonth(period)} h${isHydro(contract) ? ' × 110% overload' : ''} = ${max} MWh.`);
  }

  const availMax = isHydro(contract) ? 120 : 100;
  for (const [key, label, top] of [['availability_percent', 'Availability', availMax], ['peak_availability_percent', 'Peak-window availability', 100]]) {
    if (r[key] == null || r[key] === '') continue;
    const v = Number(r[key]);
    if (!Number.isFinite(v) || v < 0 || v > top) add(`${label} for ${no} must be between 0% and ${top}%${top > 100 ? ' (a hydro station\'s PAF can exceed 100%)' : ''} — got ${r[key]}.`);
  }

  // CUF is what the energy and the capacity make it. A typed CUF that says
  // otherwise was stored as given, so 8,200 MWh could sit beside "90%".
  const cuf = Number.isFinite(e) ? cufFor(contract, period, e) : null;
  if (r.cuf_percent != null && r.cuf_percent !== '') {
    const given = Number(r.cuf_percent);
    if (!Number.isFinite(given) || given < 0 || given > 100) add('CUF is a percentage between 0 and 100.');
    else if (cuf != null && Math.abs(given - cuf) > 0.5) add(`The CUF given (${given}%) does not match the energy: ${e} MWh on ${billableCapacityMw(contract)} MW over ${hoursInMonth(period)} h is ${cuf}%.`);
  }

  return { errors, cuf };
}

/**
 * G4: a month whose energy equals the previous month's to the decimal is far
 * more likely a copied reading than a coincidence (hydro September repeated
 * August's figure exactly). Returns the previous month's row when it matches.
 */
export function duplicateOfPreviousMonth(row) {
  if (!row || !(Number(row.energy_mwh) > 0)) return null;
  const [y, m] = String(row.period_month).split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const prevMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
  const p = db.prepare(`
    SELECT id, period_month, energy_mwh, source, status FROM energy_data
    WHERE contract_id = ? AND period_month = ? AND status != 'DRAFT'
    ORDER BY (status = 'LOCKED') DESC, (data_type = 'FINAL') DESC, created_at DESC LIMIT 1
  `).get(row.contract_id, prevMonth);
  return p && Math.abs(Number(p.energy_mwh) - Number(row.energy_mwh)) < 0.0005 ? p : null;
}
