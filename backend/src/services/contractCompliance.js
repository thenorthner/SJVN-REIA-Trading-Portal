import db from '../db/index.js';

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
 */

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
function checksFor(contract, { security, requirements, approvals }, expiryNoticeDays) {
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
  //    contract nobody can prove is commissioned.
  const hasEnergy = contract.energy_months > 0;
  if (contract.cod_date) {
    const toCod = daysUntil(contract.cod_date);
    out.push(toCod > 0
      ? check('COD', 'Commercial operation', 'DUE', `Scheduled in ${toCod} days`, toCod)
      : check('COD', 'Commercial operation', 'OK', `Commissioned ${Math.abs(toCod)} days ago`, toCod));
  } else if (hasEnergy) {
    out.push(check('COD', 'Commercial operation', 'BREACH', `${contract.energy_months} month(s) of energy accounted with no COD on record`));
  } else {
    out.push(check('COD', 'Commercial operation', live ? 'DUE' : 'NOT_APPLICABLE', 'No COD on record'));
  }

  // 3. Commissioned capacity against what was contracted.
  const contracted = Number(contract.capacity_mw) || 0;
  const commissioned = Number(contract.commissioned_capacity_mw) || 0;
  if (!live || contracted <= 0) {
    out.push(check('CAPACITY', 'Commissioned capacity', 'NOT_APPLICABLE', 'Not a live contract with a capacity'));
  } else if (commissioned <= 0) {
    out.push(check('CAPACITY', 'Commissioned capacity', 'DUE', `Nothing commissioned against ${contracted} MW`));
  } else if (commissioned + 0.0001 < contracted) {
    out.push(check('CAPACITY', 'Commissioned capacity', 'DUE', `${commissioned} of ${contracted} MW commissioned`));
  } else {
    out.push(check('CAPACITY', 'Commissioned capacity', 'OK', `${commissioned} MW commissioned`));
  }

  // 4. The security the contract itself requires, against what is lodged.
  const required = requirements.reduce((a, r) => a + (Number(r.min_amount) || 0), 0);
  const held = security.reduce((a, s) => a + (Number(s.limit_amount) || 0), 0);
  const soonest = security
    .map((s) => daysUntil(s.validity_end))
    .filter((d) => d != null)
    .sort((a, b) => a - b)[0];
  if (!requirements.length && !security.length) {
    out.push(check('SECURITY', 'Payment security', 'NOT_APPLICABLE', 'None required and none lodged'));
  } else if (required > 0 && held + 0.5 < required) {
    out.push(check('SECURITY', 'Payment security', live ? 'BREACH' : 'DUE',
      `${held} lodged against ${required} required`));
  } else if (soonest != null && soonest < 0) {
    out.push(check('SECURITY', 'Payment security', live ? 'BREACH' : 'DUE', `An instrument expired ${Math.abs(soonest)} days ago`, soonest));
  } else if (soonest != null && soonest <= expiryNoticeDays) {
    out.push(check('SECURITY', 'Payment security', 'DUE', `An instrument expires in ${soonest} days`, soonest));
  } else {
    out.push(check('SECURITY', 'Payment security', 'OK', held ? `${held} lodged` : 'Nothing required'));
  }

  // 5. The counterparty's statutory approvals — the checks onboarding exists to
  //    make, which do not stop mattering once a contract is signed.
  const mandatory = approvals.filter((a) => a.is_mandatory);
  // NOT_APPLICABLE is a decision, not an omission; EXPIRED and REJECTED are.
  const missing = mandatory.filter((a) => !['VERIFIED', 'SUBMITTED', 'NOT_APPLICABLE'].includes(a.status));
  const expired = mandatory.filter((a) => a.status === 'EXPIRED' || (a.valid_until && daysUntil(a.valid_until) < 0));
  if (!mandatory.length) {
    out.push(check('APPROVALS', 'Statutory approvals', 'NOT_APPLICABLE', 'None recorded for this counterparty'));
  } else if (expired.length) {
    out.push(check('APPROVALS', 'Statutory approvals', live ? 'BREACH' : 'DUE',
      `${expired.length} lapsed: ${expired.map((a) => a.label).join(', ')}`));
  } else if (missing.length) {
    out.push(check('APPROVALS', 'Statutory approvals', live ? 'BREACH' : 'DUE',
      `${missing.length} outstanding: ${missing.map((a) => a.label).join(', ')}`));
  } else {
    out.push(check('APPROVALS', 'Statutory approvals', 'OK', `${mandatory.length} in order`));
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
      (SELECT COUNT(*) FROM energy_data e WHERE e.contract_id = c.id AND e.status != 'DRAFT') AS energy_months
    FROM contracts c
    LEFT JOIN entities s ON s.id = c.seller_id
    LEFT JOIN entities b ON b.id = c.buyer_id
    WHERE ${where.join(' AND ')}
    ORDER BY c.tenure_end
  `).all(...params);

  const securityRows = db.prepare(`
    SELECT contract_id, limit_amount, validity_end, status FROM payment_security
    WHERE status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED')
  `).all();
  const requirementRows = db.prepare('SELECT contract_id, min_amount FROM security_requirements').all();
  const approvalRows = db.prepare(`
    SELECT entity_id, label, status, is_mandatory, valid_until FROM entity_regulatory_approvals
  `).all();

  const byContract = (rows) => rows.reduce((map, r) => {
    if (!map.has(r.contract_id)) map.set(r.contract_id, []);
    map.get(r.contract_id).push(r);
    return map;
  }, new Map());
  const securityMap = byContract(securityRows);
  const requirementMap = byContract(requirementRows);
  const approvalMap = approvalRows.reduce((map, r) => {
    if (!map.has(r.entity_id)) map.set(r.entity_id, []);
    map.get(r.entity_id).push(r);
    return map;
  }, new Map());

  const rows = contracts.map((c) => {
    const counterpartyId = c.contract_type === 'PPA' ? c.seller_id : c.buyer_id;
    const checks = checksFor(c, {
      security: securityMap.get(c.id) || [],
      requirements: requirementMap.get(c.id) || [],
      approvals: approvalMap.get(counterpartyId) || [],
    }, expiryNoticeDays);

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
      state: breaches.length ? 'BREACH' : due.length ? 'DUE' : 'OK',
    };
  });

  // Worst first: a live contract out of compliance is the thing to look at.
  const order = { BREACH: 0, DUE: 1, OK: 2 };
  rows.sort((a, b) => (order[a.state] - order[b.state])
    || (a.days_to_expiry ?? 1e9) - (b.days_to_expiry ?? 1e9));

  return {
    expiry_notice_days: expiryNoticeDays,
    totals: {
      contracts: rows.length,
      breach: rows.filter((r) => r.state === 'BREACH').length,
      due: rows.filter((r) => r.state === 'DUE').length,
      ok: rows.filter((r) => r.state === 'OK').length,
      expiring_within_notice: rows.filter((r) => r.days_to_expiry != null && r.days_to_expiry >= 0 && r.days_to_expiry <= expiryNoticeDays).length,
    },
    contracts: rows,
  };
}
