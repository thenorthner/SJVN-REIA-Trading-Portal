import db from '../db/index.js';
import { computeCoverage, computeRequiredAmount, securityBreakdown, isLiveToday } from '../paymentSecurityEngine.js';
import { ACTIVE_STATUSES, INSTRUMENTS_BY_SIDE } from '../paymentSecurityConstants.js';

/**
 * Where each contract stands against its own timeline and obligations.
 *
 * The platform knows when a contract runs from and to, when the project was
 * commissioned, what security it requires and what has been lodged, and whether
 * its counterparty's statutory approvals are in order. Nothing put those beside
 * each other, so the questions a contract manager actually asks — which PPAs
 * expire this quarter, which are live without their guarantee, whose licences
 * lapsed — had no screen to ask them of.
 *
 * Each contract gets a list of checks with a plain state: OK, DUE (something to
 * do, nothing broken yet), BREACH (live and not compliant) or NOT_APPLICABLE.
 * A contract that is not live (draft, terminated, expired) is listed as
 * NOT_LIVE and kept out of the compliance counts.
 *
 * Held to the rest of the platform (17-Oct-2026 audit): the security figures
 * are the Payment Security engine's — it called three PSAs under-secured while
 * this desk called them "none required" — counting only live instruments of the
 * paying side, net of draws; a PSA's commissioning is its source plants'; an
 * approval counts once verified, as on the Document Desk; and a blacklisted or
 * unapproved counterparty on a live contract is a breach.
 */

const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const NOTICE_MAX = 3650;

/** Why a notice window cannot be used, or null. */
export function noticeProblem(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > NOTICE_MAX) return `expiry_notice_days must be a whole number of days from 1 to ${NOTICE_MAX}`;
  return null;
}

const DAY = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Days from today to a date on record — negative once it has passed. */
export function daysUntil(date) {
  if (!date) return null;
  const then = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(then.getTime())) return null;
  return Math.round((startOfDay(then) - startOfDay(new Date())) / DAY);
}

const LIVE_STATUSES = ['ACTIVE', 'AMENDED', 'NEARING_EXPIRY', 'RENEWED'];

function check(code, label, state, detail, dueInDays = null) {
  return { code, label, state, detail, due_in_days: dueInDays };
}

/**
 * @param {object} contract  a row from contracts
 * @param {object} context   pre-fetched security and approval rows
 */
function checksFor(contract, { approvals, counterparty, sources }, expiryNoticeDays) {
  const live = LIVE_STATUSES.includes(contract.status);
  const out = [];

  // 1. Is the contract inside its own tenure?
  const toEnd = daysUntil(contract.tenure_end);
  const toStart = daysUntil(contract.tenure_start);
  if (!live) {
    out.push(check('TENURE', 'Contract tenure', 'NOT_APPLICABLE', `Contract is ${contract.status}`, toEnd));
  } else if (toEnd == null) {
    out.push(check('TENURE', 'Contract tenure', 'BREACH', 'No tenure end on record', null));
  } else if (toEnd < 0) {
    out.push(check('TENURE', 'Contract tenure', 'BREACH', `Ended ${Math.abs(toEnd)} days ago and still ${contract.status}`, toEnd));
  } else if (toEnd <= expiryNoticeDays) {
    out.push(check('TENURE', 'Contract tenure', 'DUE', `Ends in ${toEnd} days`, toEnd));
  } else if (toStart != null && toStart > 0) {
    out.push(check('TENURE', 'Contract tenure', 'DUE', `Starts in ${toStart} days`, toStart));
  } else {
    out.push(check('TENURE', 'Contract tenure', 'OK', `Ends in ${toEnd} days`, toEnd));
  }

  // 2. Commissioning. A contract billing energy without a COD on record is a
  //    contract nobody can prove is commissioned, and energy accounted for a
  //    month before the COD is energy from a plant not yet in operation. A PSA
  //    has no plant of its own: it is commissioned when its source plants are.
  const hasEnergy = contract.energy_months > 0;
  const codMonth = contract.cod_date ? String(contract.cod_date).slice(0, 7) : null;
  if (contract.contract_type === 'PSA') {
    if (!sources.length) {
      out.push(check('COD', 'Commercial operation', live ? 'DUE' : 'NOT_APPLICABLE', 'No source PPA mapped, so no plant to be commissioned'));
    } else {
      const pending = sources.filter((p) => !p.cod_date || daysUntil(p.cod_date) > 0);
      out.push(pending.length
        ? check('COD', 'Commercial operation', live ? 'DUE' : 'NOT_APPLICABLE', `Source plant not yet commissioned: ${pending.map((p) => `${p.contract_no}${p.cod_date ? ` (COD ${p.cod_date})` : ' (no COD on record)'}`).join(', ')}`)
        : check('COD', 'Commercial operation', 'OK', `Source plant${sources.length > 1 ? 's' : ''} commissioned: ${sources.map((p) => `${p.contract_no} (${p.cod_date})`).join(', ')}`));
    }
  } else if (contract.cod_date) {
    const toCod = daysUntil(contract.cod_date);
    if (hasEnergy && contract.first_energy_month && contract.first_energy_month < codMonth) {
      out.push(check('COD', 'Commercial operation', live ? 'BREACH' : 'DUE',
        `Energy accounted from ${contract.first_energy_month}, before the COD of ${contract.cod_date}`, toCod));
    } else {
      out.push(toCod > 0
        ? check('COD', 'Commercial operation', 'DUE', `Scheduled in ${toCod} days`, toCod)
        : check('COD', 'Commercial operation', 'OK', `Commissioned ${Math.abs(toCod)} days ago`, toCod));
    }
  } else if (hasEnergy) {
    out.push(check('COD', 'Commercial operation', live ? 'BREACH' : 'DUE', `${contract.energy_months} month(s) of energy accounted with no COD on record`));
  } else {
    out.push(check('COD', 'Commercial operation', live ? 'DUE' : 'NOT_APPLICABLE', 'No COD on record'));
  }

  // 3. Commissioned capacity against what was contracted.
  const contracted = Number(contract.capacity_mw) || 0;
  const commissioned = Number(contract.commissioned_capacity_mw) || 0;
  if (contract.contract_type === 'PSA') {
    out.push(check('CAPACITY', 'Commissioned capacity', 'NOT_APPLICABLE', 'A PSA is supplied from its source plants\' capacity'));
  } else if (!live || contracted <= 0) {
    out.push(check('CAPACITY', 'Commissioned capacity', 'NOT_APPLICABLE', 'Not a live contract with a capacity'));
  } else if (commissioned <= 0) {
    out.push(check('CAPACITY', 'Commissioned capacity', 'DUE', `Nothing commissioned against ${contracted} MW`));
  } else if (commissioned + 0.0001 < contracted) {
    out.push(check('CAPACITY', 'Commissioned capacity', 'DUE', `${commissioned} of ${contracted} MW commissioned`));
  } else if (commissioned > contracted + 0.0001) {
    // Billing measures against commissioned capacity, so MW beyond the contract
    // would be billed and judged as if contracted.
    out.push(check('CAPACITY', 'Commissioned capacity', 'DUE', `${commissioned} MW commissioned against ${contracted} MW contracted`));
  } else {
    out.push(check('CAPACITY', 'Commissioned capacity', 'OK', `${commissioned} MW commissioned`));
  }

  // 4. Security, as the Payment Security engine sees it: only instruments of
  //    the paying side that are in force today count, net of what has been
  //    drawn; a PSA is measured against its exposure as well as its stated
  //    requirement. The desk used to add up limits of any instrument, lapsed or
  //    drawn, against requirement rows alone.
  const breakdown = securityBreakdown(contract.id);
  const held = breakdown.counted;
  const isPsa = contract.contract_type === 'PSA';
  const cover = isPsa ? computeCoverage(contract.id) : null;
  const required = isPsa ? Math.max(cover.required_amount, cover.exposure) : computeRequiredAmount(contract.id);
  const sideTypes = INSTRUMENTS_BY_SIDE[isPsa ? 'BUYER' : 'SELLER'];
  const liveInstruments = db.prepare(`
    SELECT * FROM payment_security WHERE contract_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
      AND mechanism_type IN (${sideTypes.map(() => '?').join(',')})
  `).all(contract.id, ...ACTIVE_STATUSES, ...sideTypes).filter((r) => isLiveToday(r));
  const soonest = liveInstruments.map((r) => daysUntil(r.validity_end)).filter((d) => d != null).sort((a, b) => a - b)[0];
  const lapsedNote = breakdown.lapsed ? ` (${rupees(breakdown.lapsed)} in lapsed instruments not counted)` : '';
  if (required <= 0 && held <= 0 && !breakdown.lapsed) {
    out.push(check('SECURITY', 'Payment security', 'NOT_APPLICABLE', 'None required and none lodged'));
  } else if (breakdown.lapsed > 0 && held + 0.5 < Math.max(required, breakdown.lapsed)) {
    // A lapsed instrument nobody has replaced: whatever the row still says, it
    // is not security today.
    const lapsedDays = db.prepare(`
      SELECT MAX(validity_end) v FROM payment_security WHERE contract_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
        AND mechanism_type IN (${sideTypes.map(() => '?').join(',')}) AND validity_end IS NOT NULL AND validity_end < date('now')
    `).get(contract.id, ...ACTIVE_STATUSES, ...sideTypes)?.v;
    const ago = lapsedDays ? Math.abs(daysUntil(lapsedDays)) : null;
    out.push(check('SECURITY', 'Payment security', live ? 'BREACH' : 'DUE',
      `${rupees(breakdown.lapsed)} lapsed${ago != null ? ` ${ago} days ago` : ''} and not replaced; ${rupees(held)} in force${required > 0 ? ` against ${rupees(required)} required` : ''}`,
      ago != null ? -ago : null));
  } else if (required > 0 && held + 0.5 < required) {
    out.push(check('SECURITY', 'Payment security', live ? 'BREACH' : 'DUE',
      `${rupees(held)} in force against ${rupees(required)} required${isPsa && cover.exposure > cover.required_amount ? ' (the bills it has to cover)' : ''}${lapsedNote}`));
  } else if (soonest != null && soonest <= expiryNoticeDays) {
    out.push(check('SECURITY', 'Payment security', 'DUE', `${rupees(held)} in force; an instrument expires in ${soonest} days`, soonest));
  } else {
    out.push(check('SECURITY', 'Payment security', 'OK', `${rupees(held)} in force${required > 0 ? ` against ${rupees(required)} required` : ''}${lapsedNote}`));
  }

  // 5. The counterparty's standing and statutory approvals — the checks
  //    onboarding exists to make, which do not stop mattering once a contract
  //    is signed. An approval counts once verified, as on the Document Desk:
  //    one only submitted is waiting on SJVN, not in order.
  // SJVN's own stations (Nathpa Jhakri, Rampur) sell through the platform but
  // are not developers: developer KYC and statutory approvals do not apply to
  // them (decided 17-Oct-2026).
  if (counterparty?.is_sjvn_own) {
    out.push(check('APPROVALS', 'Counterparty standing', 'NOT_APPLICABLE', `${counterparty.name} is SJVN's own station — developer KYC does not apply`));
    return out;
  }
  if (counterparty?.is_blacklisted) {
    out.push(check('APPROVALS', 'Counterparty standing', live ? 'BREACH' : 'DUE',
      `${counterparty.name} is blacklisted${counterparty.blacklist_reason ? `: ${counterparty.blacklist_reason}` : ''}`));
  } else if (counterparty && counterparty.status !== 'APPROVED') {
    out.push(check('APPROVALS', 'Counterparty standing', live ? 'BREACH' : 'DUE',
      `${counterparty.name}'s onboarding is ${String(counterparty.status || 'not started').replace(/_/g, ' ').toLowerCase()}, not approved`));
  }
  const mandatory = approvals.filter((a) => a.is_mandatory && a.status !== 'NOT_APPLICABLE');
  const expired = mandatory.filter((a) => a.status === 'EXPIRED' || (a.valid_until && daysUntil(a.valid_until) < 0));
  const missing = mandatory.filter((a) => !expired.includes(a) && !['VERIFIED', 'SUBMITTED'].includes(a.status));
  const awaiting = mandatory.filter((a) => !expired.includes(a) && a.status === 'SUBMITTED');
  const expiring = mandatory.filter((a) => a.status === 'VERIFIED' && a.valid_until && daysUntil(a.valid_until) >= 0 && daysUntil(a.valid_until) <= expiryNoticeDays);
  if (!approvals.some((a) => a.is_mandatory)) {
    out.push(check('APPROVALS', 'Statutory approvals', 'NOT_APPLICABLE', 'None recorded for this counterparty'));
  } else if (expired.length) {
    out.push(check('APPROVALS', 'Statutory approvals', live ? 'BREACH' : 'DUE',
      `${expired.length} lapsed: ${expired.map((a) => a.label).join(', ')}`));
  } else if (missing.length) {
    out.push(check('APPROVALS', 'Statutory approvals', live ? 'BREACH' : 'DUE',
      `${missing.length} of ${mandatory.length} not provided: ${missing.map((a) => a.label).join(', ')}`));
  } else if (awaiting.length) {
    out.push(check('APPROVALS', 'Statutory approvals', 'DUE',
      `${awaiting.length} submitted, awaiting verification: ${awaiting.map((a) => a.label).join(', ')}`));
  } else if (expiring.length) {
    const first = Math.min(...expiring.map((a) => daysUntil(a.valid_until)));
    out.push(check('APPROVALS', 'Statutory approvals', 'DUE',
      `${expiring.map((a) => a.label).join(', ')} expire${expiring.length === 1 ? 's' : ''} within ${first} days`, first));
  } else {
    out.push(check('APPROVALS', 'Statutory approvals', 'OK', `${mandatory.length} verified`));
  }

  return out;
}

export function contractCompliance({ status = null, expiryNoticeDays = 90 } = {}) {
  const where = ["c.status NOT IN ('CLOSED')"];
  const params = [];
  if (status) { where.push('c.status = ?'); params.push(status); }

  const contracts = db.prepare(`
    SELECT
      c.*,
      s.name AS seller_name, b.name AS buyer_name,
      (SELECT COUNT(DISTINCT e.period_month) FROM energy_data e WHERE e.contract_id = c.id AND e.status != 'DRAFT') AS energy_months,
      (SELECT MIN(e.period_month) FROM energy_data e WHERE e.contract_id = c.id AND e.status != 'DRAFT') AS first_energy_month
    FROM contracts c
    LEFT JOIN entities s ON s.id = c.seller_id
    LEFT JOIN entities b ON b.id = c.buyer_id
    WHERE ${where.join(' AND ')}
    ORDER BY c.tenure_end
  `).all(...params);

  const approvalRows = db.prepare(`
    SELECT entity_id, label, status, is_mandatory, valid_until FROM entity_regulatory_approvals
  `).all();
  const entities = new Map(db.prepare('SELECT id, name, status, is_blacklisted, blacklist_reason, is_sjvn_own FROM entities').all().map((e) => [e.id, e]));
  const sourceRows = db.prepare(`
    SELECT a.psa_id, p.contract_no, p.cod_date FROM contract_allocations a JOIN contracts p ON p.id = a.ppa_id
    WHERE a.effective_to IS NULL OR a.effective_to >= date('now')
  `).all();
  const sourceMap = sourceRows.reduce((map, r) => {
    if (!map.has(r.psa_id)) map.set(r.psa_id, []);
    if (!map.get(r.psa_id).some((x) => x.contract_no === r.contract_no)) map.get(r.psa_id).push(r);
    return map;
  }, new Map());
  const approvalMap = approvalRows.reduce((map, r) => {
    if (!map.has(r.entity_id)) map.set(r.entity_id, []);
    map.get(r.entity_id).push(r);
    return map;
  }, new Map());

  const rows = contracts.map((c) => {
    const counterpartyId = c.contract_type === 'PPA' ? c.seller_id : c.buyer_id;
    const checks = checksFor(c, {
      approvals: approvalMap.get(counterpartyId) || [],
      counterparty: entities.get(counterpartyId) || null,
      sources: sourceMap.get(c.id) || [],
    }, expiryNoticeDays);
    const live = LIVE_STATUSES.includes(c.status);

    const breaches = checks.filter((k) => k.state === 'BREACH');
    const due = checks.filter((k) => k.state === 'DUE');
    return {
      contract_id: c.id,
      contract_no: c.contract_no,
      contract_type: c.contract_type,
      project_type: c.project_type,
      counterparty: c.contract_type === 'PPA' ? c.seller_name : c.buyer_name,
      status: c.status,
      tenure_start: c.tenure_start,
      tenure_end: c.tenure_end,
      days_to_expiry: daysUntil(c.tenure_end),
      cod_date: c.cod_date,
      capacity_mw: c.capacity_mw,
      commissioned_capacity_mw: c.commissioned_capacity_mw,
      checks,
      breach_count: breaches.length,
      due_count: due.length,
      // A draft or a terminated contract is not out of compliance; it is not
      // live. It used to land in "Action due" and fill that count.
      state: !live ? 'NOT_LIVE' : breaches.length ? 'BREACH' : due.length ? 'DUE' : 'OK',
    };
  });

  // Worst first: a live contract out of compliance is the thing to look at.
  const order = { BREACH: 0, DUE: 1, OK: 2, NOT_LIVE: 3 };
  rows.sort((a, b) => (order[a.state] - order[b.state])
    || (a.days_to_expiry ?? 1e9) - (b.days_to_expiry ?? 1e9));

  return {
    expiry_notice_days: expiryNoticeDays,
    totals: {
      contracts: rows.length,
      breach: rows.filter((r) => r.state === 'BREACH').length,
      due: rows.filter((r) => r.state === 'DUE').length,
      ok: rows.filter((r) => r.state === 'OK').length,
      not_live: rows.filter((r) => r.state === 'NOT_LIVE').length,
      expiring_within_notice: rows.filter((r) => r.state !== 'NOT_LIVE' && r.days_to_expiry != null && r.days_to_expiry >= 0 && r.days_to_expiry <= expiryNoticeDays).length,
    },
    contracts: rows,
  };
}
