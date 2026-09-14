import { getParamNumber } from '../mastersService.js';
import { daysInMonth } from './cercHydroBilling.js';

/**
 * Peak availability shortfall penalty.
 *
 * A peak-power or FDRE PSA does not only buy energy; it buys energy *when the
 * system needs it*. The contract states a peak window and the availability the
 * project must hold inside it, and pays a penalty on the shortfall. The platform
 * charged a CUF shortfall and had nothing for this, so the peak obligation in
 * those PSAs was not being priced at all.
 *
 * The platform holds monthly energy for REIA contracts, not block-level data, so
 * peak availability is what the regional energy account (or the JMR) reports for
 * the peak window and the desk records against the month — the same way CUF
 * percent is recorded. What is computed here is the money, not the availability.
 *
 *   shortfallPct  = max(0, requiredPeakAvailability − declaredPeakAvailability)
 *   peakHours     = hours in the contract's peak window × days in the month
 *   shortfallMwh  = shortfallPct / 100 × capacityMw × peakHours
 *   penalty       = shortfallMwh × rate
 *
 * The rate is the contract's own peak penalty per MWh, else the master default,
 * else the tariff. Nothing is charged unless the contract carries a peak
 * obligation: a PPA with no peak terms is not silently given one.
 */

/** "18:00" → 18. Returns null for anything that is not a clock time. */
export function parseHour(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const hour = Number(m[1]) + Number(m[2]) / 60;
  return hour >= 0 && hour <= 24 ? hour : null;
}

/** Hours in a peak window, allowing one that crosses midnight (22:00 → 02:00). */
export function peakWindowHours(start, end) {
  const from = parseHour(start);
  const to = parseHour(end);
  if (from == null || to == null) return null;
  if (to === from) return null;
  return to > from ? to - from : 24 - from + to;
}

/**
 * @param {object} args
 * @param {object} args.contract          the contract row
 * @param {string} args.periodMonth       YYYY-MM
 * @param {number} args.capacityMw        the capacity the obligation is measured on
 * @param {number|null} args.peakAvailabilityPercent  what the month's data declares
 * @param {number|null} args.tariffPerUnit
 */
export function computePeakAvailabilityPenalty({
  contract,
  periodMonth,
  capacityMw,
  peakAvailabilityPercent,
  tariffPerUnit,
}) {
  const none = {
    applicable: false,
    penalty: 0,
    requiredPercent: null,
    actualPercent: peakAvailabilityPercent ?? null,
    shortfallPercent: 0,
    shortfallMwh: 0,
    peakHours: null,
    ratePerMwh: 0,
    label: null,
  };

  const required = contract?.min_peak_availability_percent;
  // No peak obligation on this contract is not a shortfall of zero — it is not
  // this contract's kind of obligation at all.
  if (required == null || !Number.isFinite(Number(required)) || Number(required) <= 0) return none;

  const windowHours = peakWindowHours(
    contract.peak_window_start || getParamNumber('peak_window_start', null),
    contract.peak_window_end || getParamNumber('peak_window_end', null),
  );
  if (windowHours == null) {
    return {
      ...none,
      requiredPercent: Number(required),
      label: 'Peak availability obligation on record with no peak window — nothing charged',
    };
  }

  if (peakAvailabilityPercent == null || !Number.isFinite(Number(peakAvailabilityPercent))) {
    return {
      ...none,
      requiredPercent: Number(required),
      peakHours: windowHours,
      label: `Peak availability not reported for ${periodMonth} — nothing charged`,
    };
  }

  const actual = Number(peakAvailabilityPercent);
  const shortfallPercent = Math.max(0, Number(required) - actual);
  const peakHours = windowHours * daysInMonth(periodMonth);
  const shortfallMwh = shortfallPercent / 100 * (Number(capacityMw) || 0) * peakHours;

  const contractRate = Number(contract.peak_penalty_per_mwh);
  const masterRate = getParamNumber('peak_shortfall_penalty_per_mwh', 0);
  const ratePerMwh = Number.isFinite(contractRate) && contractRate > 0
    ? contractRate
    : (masterRate > 0 ? masterRate : (Number(tariffPerUnit) || 0) * 1000);

  const penalty = Math.round(shortfallMwh * ratePerMwh);
  const label = shortfallPercent > 0
    ? `Peak availability shortfall: ${actual}% against ${required}% over ${windowHours}h × ${daysInMonth(periodMonth)} days`
    : `Peak availability met: ${actual}% against ${required}%`;

  return {
    applicable: true,
    penalty,
    requiredPercent: Number(required),
    actualPercent: actual,
    shortfallPercent: Math.round(shortfallPercent * 100) / 100,
    shortfallMwh: Math.round(shortfallMwh * 100) / 100,
    peakHours,
    ratePerMwh,
    label,
    breakdown: penalty > 0
      ? {
        code: 'PEAKPEN',
        label,
        value: penalty,
        detail: {
          required_percent: Number(required),
          actual_percent: actual,
          shortfall_percent: Math.round(shortfallPercent * 100) / 100,
          peak_hours: peakHours,
          shortfall_mwh: Math.round(shortfallMwh * 100) / 100,
          rate_per_mwh: ratePerMwh,
        },
      }
      : null,
  };
}
