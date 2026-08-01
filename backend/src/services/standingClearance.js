/**
 * SLDC Standing Clearance (Open Access NOC) compliance for exchange bids.
 *
 * The HP SLDC standing clearance issued to a generator carries hard operating
 * constraints. Clauses 21-24 and 26 are the ones a bidding platform can check:
 *
 *   21  Multi-exchange cap    Combined MW across IEX + PXIL + HPX for the same
 *                             delivery block cannot exceed the cleared T-GNA.
 *   22  T-GNA ceiling         Scheduled MW must stay within the approved MW.
 *   23  Purchase restriction  A generating station may only BUY during a forced
 *                             outage.
 *   24  Ramping limits        Block-to-block MW change must respect the machine's
 *                             ramp rate.
 *   26  Renewal notice        Approach the SLDC at least a week before expiry.
 *
 * These live here rather than in the browser because they are the terms the
 * clearance was granted under, not input hints: a bid posted straight to the API
 * has to face the same checks as one typed into the screen.
 *
 * UNITS: T-GNA is a transmission capacity in MW — an instantaneous power
 * ceiling that applies to each delivery block. It is not a daily energy budget,
 * so block MW is never summed across the day when testing it.
 */
import db from '../db/index.js';
import { getParam, getParamNumber } from '../mastersService.js';

/** Minutes of delivery covered by one bid block of this product. */
const DEFAULT_BLOCK_HOURS = { DAM: 0.25, GDAM: 0.25, GTAM: 0.25, RTM: 0.5 };
function blockMinutes(product) {
  const map = getParam('bid_block_duration_hours', null);
  const n = Number(map && typeof map === 'object' ? map[product] : undefined);
  const hours = Number.isFinite(n) && n > 0 ? n : (DEFAULT_BLOCK_HOURS[product] ?? 0.25);
  return hours * 60;
}

/** Blocks carry labels like "09:00-09:15"; order them by start time. */
function blockStartMinutes(label) {
  const m = String(label || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return Number(m[1]) * 60 + Number(m[2]);
}

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/**
 * The clearance on record for a client, with its derived state.
 *
 * `state` is one of:
 *   ACTIVE          in force
 *   RENEWAL_DUE     in force, but inside the clause 26 notice window
 *   EXPIRED         lapsed — trading now has no open-access approval behind it
 *   NOT_ON_RECORD   no expiry captured for this client yet
 *
 * NOT_ON_RECORD is deliberately distinct from EXPIRED. Absent paperwork is not
 * evidence of a lapsed clearance, and treating it as one would refuse bids for
 * every client onboarded before the NOC was entered.
 */
export function getClearance(clientId) {
  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(clientId);
  if (!client) return null;

  const noticeDays = getParamNumber('sldc_renewal_notice_days', 7);
  const expiry = client.noc_valid_till ? new Date(client.noc_valid_till) : null;
  const valid = expiry && !Number.isNaN(expiry.getTime());

  let daysLeft = null;
  let state = 'NOT_ON_RECORD';
  if (valid) {
    daysLeft = Math.round((startOfDay(expiry) - startOfDay(new Date())) / 86400000);
    if (daysLeft < 0) state = 'EXPIRED';
    else if (daysLeft <= noticeDays) state = 'RENEWAL_DUE';
    else state = 'ACTIVE';
  }

  return {
    client_id: client.id,
    client_name: client.name,
    is_generator: client.client_type === 'GENERATOR',
    sldc_name: client.sldc_name || null,
    standing_clearance_no: client.standing_clearance_no || null,
    noar_id: client.noar_id || null,
    valid_till: client.noc_valid_till || null,
    tgna_approved_mw: client.tgna_approved_mw ?? null,
    max_ramp_rate_mw_per_min: client.max_ramp_rate_mw_per_min ?? null,
    periphery_loss_percent: client.periphery_loss_percent ?? null,
    operating_charge_per_day: client.operating_charge_per_day ?? null,
    regional_tx_charge_per_mw_block: client.regional_tx_charge_per_mw_block ?? null,
    state_tx_charge_per_mwh: client.state_tx_charge_per_mwh ?? null,
    approver: client.clearance_approver || null,
    approver_designation: client.clearance_approver_designation || null,
    state,
    days_left: daysLeft,
    renewal_notice_days: noticeDays,
  };
}

/**
 * MW already committed on OTHER exchanges for the same delivery date, by block.
 *
 * Only bids that have actually reached the exchange hold transmission capacity.
 * A DRAFT sitting in the platform has not been placed, so it is not counted —
 * the submit route runs this check again, which is where two competing drafts
 * are caught.
 */
const EXCHANGE_HELD_STATUSES = ['SUBMITTED', 'CLEARED', 'PARTIALLY_CLEARED'];

function otherExchangeMwByBlock({ clientId, deliveryDate, exchange, excludeBidId }) {
  const marks = EXCHANGE_HELD_STATUSES.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT bb.time_block AS time_block, SUM(bb.quantum_mw) AS mw
    FROM bid_blocks bb
    JOIN bids b ON b.id = bb.bid_id
    WHERE b.client_id = ?
      AND b.delivery_date = ?
      AND b.exchange <> ?
      AND b.status IN (${marks})
      ${excludeBidId ? 'AND b.id <> ?' : ''}
    GROUP BY bb.time_block
  `).all(...[clientId, deliveryDate, exchange, ...EXCHANGE_HELD_STATUSES, ...(excludeBidId ? [excludeBidId] : [])]);

  const map = new Map();
  rows.forEach((r) => map.set(r.time_block, Number(r.mw) || 0));
  return map;
}

/**
 * Check a bid against the standing clearance.
 *
 * Returns { violations, warnings, clearance }. A violation must stop the bid; a
 * warning is surfaced and the bid proceeds. Clause 26 is a warning inside the
 * notice window — the clause requires the generator to *apply* for renewal a
 * week ahead, not to stop trading — and a violation only once the clearance has
 * actually lapsed.
 */
export function checkBidCompliance({
  client, product, exchange, deliveryDate, type, blocks,
  // Absent bid_on is read as PERIPHERY — that applies no loss reduction, so an
  // unlabelled bid is measured against the cap at full quoted MW rather than
  // being let through on an assumed loss.
  bidOn = 'PERIPHERY', forcedOutage = false, excludeBidId = null,
}) {
  const violations = [];
  const warnings = [];
  const clearance = getClearance(client.id);
  if (!clearance) return { violations, warnings, clearance: null };

  const list = Array.isArray(blocks) ? blocks : [];

  // ── Clause 26: validity ────────────────────────────────────────────────
  if (clearance.state === 'EXPIRED') {
    violations.push({
      clause: 26,
      code: 'CLEARANCE_EXPIRED',
      message: `Standing clearance for ${clearance.client_name} lapsed on ${clearance.valid_till}. Trading cannot continue until ${clearance.sldc_name || 'the SLDC'} issues a renewal.`,
    });
  } else if (clearance.state === 'RENEWAL_DUE') {
    warnings.push({
      clause: 26,
      code: 'CLEARANCE_RENEWAL_DUE',
      message: `Standing clearance expires in ${clearance.days_left} day(s) on ${clearance.valid_till}. Clause 26 requires the renewal declaration to reach ${clearance.sldc_name || 'the SLDC'} at least ${clearance.renewal_notice_days} days before expiry.`,
    });
  } else if (clearance.state === 'NOT_ON_RECORD') {
    warnings.push({
      clause: 26,
      code: 'CLEARANCE_NOT_ON_RECORD',
      message: `No standing clearance is on record for ${clearance.client_name}. Bids are being placed without a recorded open-access approval — capture the NOC against this client.`,
    });
  }

  // ── Clause 23: a generating station may only buy during a forced outage ─
  if (clearance.is_generator && String(type).toUpperCase() === 'BUY' && !forcedOutage) {
    violations.push({
      clause: 23,
      code: 'GENERATOR_BUY_WITHOUT_OUTAGE',
      message: `${clearance.client_name} is a generating station; BUY bids are permitted only while the plant is on forced outage. Record the outage before submitting.`,
    });
  }

  // ── Clauses 21 & 22: T-GNA ceiling, per delivery block ──────────────────
  if (clearance.tgna_approved_mw != null && clearance.tgna_approved_mw > 0) {
    const cap = clearance.tgna_approved_mw;

    // T-GNA is approved at the regional periphery. A bid quoted EX-BUS is power
    // at the plant terminal, which arrives at the periphery reduced by the
    // injection loss — so it is that reduced figure the cap applies to.
    const lossPct = Number(clearance.periphery_loss_percent) || 0;
    const toPeriphery = String(bidOn).toUpperCase() === 'EX-BUS' ? 1 - lossPct / 100 : 1;
    const atPeriphery = (mw) => Math.round(mw * toPeriphery * 1e6) / 1e6;

    const otherMw = deliveryDate
      ? otherExchangeMwByBlock({ clientId: client.id, deliveryDate, exchange, excludeBidId })
      : new Map();

    let worstOwn = null;
    let worstCombined = null;
    list.forEach((b) => {
      const own = atPeriphery(Number(b.quantum_mw) || 0);
      if (own > cap + 1e-9 && (!worstOwn || own > worstOwn.mw)) {
        worstOwn = { mw: own, block: b.time_block };
      }
      const combined = own + (otherMw.get(b.time_block) || 0);
      if (combined > cap + 1e-9 && (!worstCombined || combined > worstCombined.mw)) {
        worstCombined = { mw: combined, block: b.time_block, other: otherMw.get(b.time_block) || 0 };
      }
    });

    if (worstOwn) {
      violations.push({
        clause: 22,
        code: 'TGNA_CEILING_EXCEEDED',
        message: `Block ${worstOwn.block} reaches ${worstOwn.mw} MW at the regional periphery against an approved T-GNA of ${cap} MW.`,
      });
    } else if (worstCombined) {
      // Only report the cross-exchange breach when this bid alone was within cap,
      // otherwise the same block would raise two findings for one cause.
      violations.push({
        clause: 21,
        code: 'TGNA_MULTI_EXCHANGE_EXCEEDED',
        message: `Block ${worstCombined.block} totals ${worstCombined.mw} MW across exchanges (${worstCombined.other} MW already bid elsewhere on ${deliveryDate}) against an approved T-GNA of ${cap} MW.`,
      });
    }
  } else if (list.length) {
    warnings.push({
      clause: 22,
      code: 'TGNA_NOT_CONFIGURED',
      message: `No approved T-GNA quantum is recorded for ${clearance.client_name}, so the clause 21/22 capacity ceiling could not be checked.`,
    });
  }

  // ── Clause 24: ramp rate between consecutive blocks ─────────────────────
  if (clearance.max_ramp_rate_mw_per_min != null && clearance.max_ramp_rate_mw_per_min > 0) {
    const maxDelta = clearance.max_ramp_rate_mw_per_min * blockMinutes(product);
    const ordered = [...list].sort((a, b) => blockStartMinutes(a.time_block) - blockStartMinutes(b.time_block));
    for (let i = 1; i < ordered.length; i += 1) {
      const delta = Math.abs((Number(ordered[i].quantum_mw) || 0) - (Number(ordered[i - 1].quantum_mw) || 0));
      if (delta > maxDelta + 1e-9) {
        violations.push({
          clause: 24,
          code: 'RAMP_RATE_EXCEEDED',
          message: `Ramp from ${ordered[i - 1].time_block} to ${ordered[i].time_block} is ${delta.toFixed(2)} MW; the machine limit is ${maxDelta.toFixed(2)} MW per ${blockMinutes(product)}-minute block at ${clearance.max_ramp_rate_mw_per_min} MW/min.`,
        });
        break; // one ramp finding is enough to send the trader back to the curve
      }
    }
  }

  return { violations, warnings, clearance };
}
