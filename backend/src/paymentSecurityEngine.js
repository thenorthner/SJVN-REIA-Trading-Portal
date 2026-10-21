import db from './db/index.js';
import { newId, pushNotification } from './util.js';
import { payableNow, OPEN_STATUSES as OPEN_DISPUTE_STATUSES } from './disputesConstants.js';
import { baselineCufFor, getParamNumber } from './mastersService.js';
import { ROLE_GROUPS } from './middleware/auth.js';
import {
  INVOCATION_OVERDUE_DAYS,
  DEFAULT_MONTHS_COVER,
  ALERT_CASCADE_DAYS,
  ACTIVE_STATUSES,
  WATERFALL_DEFAULTS,
  INSTRUMENTS_BY_SIDE,
  genInstrumentNo,
  genInvocationNo,
  refreshAvailable,
  dayInWords,
} from './paymentSecurityConstants.js';

export function recordSecurityEvent({ instrumentId = null, contractId = null, user, eventType, details }) {
  db.prepare(`
    INSERT INTO security_events (id, payment_security_id, contract_id, actor_id, actor_name, event_type, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    newId('PSE'),
    instrumentId,
    contractId,
    user?.id ?? null,
    user?.name ?? 'system',
    eventType,
    details ? JSON.stringify(details) : null
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const daysUntil = (iso) => Math.round((new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) - new Date(`${today()}T00:00:00Z`)) / 86400000);

/**
 * Tell the party on one side of a contract, and nobody else.
 *
 * A demand on one buyer's letter of credit went to every user with the role
 * BUYER — every other DISCOM on the platform was told to replenish security it
 * had not been asked for, and a seller whose guarantee was invoked was told
 * nothing at all.
 */
export function notifyCounterparty(contractId, side, type, message) {
  try {
    const c = db.prepare('SELECT seller_id, buyer_id FROM contracts WHERE id = ?').get(contractId);
    const entityId = side === 'SELLER' ? c?.seller_id : c?.buyer_id;
    if (!entityId) return 0;
    const users = db.prepare('SELECT id FROM users WHERE linked_entity_id = ? AND is_active = 1').all(entityId);
    for (const u of users) pushNotification({ userId: u.id, type, message });
    return users.length;
  } catch { return 0; }
}

/** The REIA desk — every role that can act on security, not REIA_MAKER alone. */
export function notifyDesk(type, message, extraRoles = []) {
  try {
    for (const role of new Set([...ROLE_GROUPS.REIA_WRITE, ...extraRoles])) pushNotification({ role, type, message });
  } catch { /* what was done stands; the bell is a courtesy */ }
}

/**
 * The status an instrument stands at on its own facts: lapsed, drawn in part,
 * drawn in full, or whole. What it goes back to when a hold on it is lifted.
 */
export function standingStatus(row, asOf = today()) {
  if (row.validity_end && String(row.validity_end).slice(0, 10) < asOf) return 'EXPIRED';
  const used = Number(row.utilized_amount) || 0;
  if (used <= 0) return 'ACTIVE';
  return used >= (Number(row.limit_amount) || 0) ? 'INVOKED' : 'PARTIALLY_UTILIZED';
}

export function syncInstrumentAvailable(id) {
  const row = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(id);
  if (!row) return null;
  const available = refreshAvailable(row);
  let status = row.status;
  if (['ACTIVE', 'PARTIALLY_UTILIZED', 'RENEWED', 'INVOKED'].includes(status)) {
    if (row.utilized_amount <= 0 && ['INVOKED', 'PARTIALLY_UTILIZED'].includes(status)) status = 'ACTIVE';
    else if (row.utilized_amount > 0 && row.utilized_amount < row.limit_amount) status = 'PARTIALLY_UTILIZED';
    else if (row.utilized_amount >= row.limit_amount) status = 'INVOKED';
  }
  db.prepare(`UPDATE payment_security SET available_amount = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(available, status, id);
  return db.prepare('SELECT * FROM payment_security WHERE id = ?').get(id);
}

/** Upsert security requirements from contract EMD/PBG/PSA rules */
/**
 * One month's billing for a contract that has not billed yet.
 *
 * capacity_mw x hours x capacity factor gives MWh; tariff_per_unit is rupees per
 * kWh. The conversion between them was missing, so the estimate came out a
 * thousandfold short: a 50 MW PSA at Rs 4.00/kWh was secured for Rs 39,600
 * against a first bill of Rs 3.66 crore, and a new buyer was effectively
 * unsecured for as long as it took the first invoice to land.
 */
export function estimatedMonthlyBill(contract) {
  const HOURS_PER_MONTH = 24 * 30;
  const KWH_PER_MWH = 1000;
  const capacityMw = Number(contract?.commissioned_capacity_mw) > 0
    ? Number(contract.commissioned_capacity_mw)
    : Number(contract?.capacity_mw) || 0;
  const energyMwh = capacityMw * HOURS_PER_MONTH * baselineCufFor(contract?.project_type);
  const tariffPerKwh = Number(contract?.tariff_per_unit) || 3;
  return Math.round(energyMwh * KWH_PER_MWH * tariffPerKwh);
}

export function syncRequirementsFromContract(contractId) {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  if (!c) return [];

  const existing = db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(contractId);
  const byKey = (t, sub) => existing.find((e) => e.mechanism_type === t && (e.bg_subtype || null) === (sub || null));

  const upsert = (mech, bgSubtype, minAmount, monthsCover, revolving, priority) => {
    const found = byKey(mech, bgSubtype);
    if (found) {
      db.prepare(`
        UPDATE security_requirements SET min_amount = ?, months_cover = ?, is_revolving = ?,
          waterfall_priority = ?, updated_at = datetime('now') WHERE id = ?
      `).run(minAmount, monthsCover, revolving ? 1 : 0, priority, found.id);
      return found.id;
    }
    const id = newId('SRQ');
    db.prepare(`
      INSERT INTO security_requirements (
        id, contract_id, mechanism_type, bg_subtype, min_amount, months_cover,
        validity_rule, waterfall_priority, is_revolving
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, contractId, mech, bgSubtype, minAmount, monthsCover,
      c.pbg_expiry ? `Expire by ${c.pbg_expiry}` : 'Contract tenure',
      priority, revolving ? 1 : 0
    );
    return id;
  };

  const ids = [];
  if (c.contract_type === 'PSA') {
    // What one month of this contract is worth, and so how much cover it needs.
    // Measured from billing history once there is any; estimated from the
    // contract itself before the first bill — which is exactly when the letter
    // of credit has to be in place, since supply starts before any payment
    // record exists.
    const avg = trailingMonthlyBilledAvg(contractId);
    const monthlyBill = avg || estimatedMonthlyBill(c);
    const required = Math.round(Math.max(monthlyBill * DEFAULT_MONTHS_COVER, 0));

    ids.push(upsert('LC', null, required, DEFAULT_MONTHS_COVER, true, WATERFALL_DEFAULTS.LC));
    // The corpus was sized off the history-based figure alone, so on a contract
    // with no history it came out at zero — an instrument that secured nothing.
    ids.push(upsert('CORPUS_FUND', null, Math.round(required * 0.1), 0, false, WATERFALL_DEFAULTS.CORPUS_FUND));
  }
  // An EMD or a performance guarantee is an amount someone entered on the
  // contract because it was actually furnished. These were read on a PPA and
  // ignored on a PSA, so a buyer contract carrying a ten lakh EMD and a fifty
  // lakh PBG derived no requirement for either and the instruments were never
  // raised — the figures sat on the contract meaning nothing.
  if (c.emd_amount) ids.push(upsert('BANK_GUARANTEE', 'EMD', c.emd_amount, 0, false, WATERFALL_DEFAULTS.BANK_GUARANTEE));
  if (c.pbg_amount) ids.push(upsert('BANK_GUARANTEE', 'PBG', c.pbg_amount, 0, false, WATERFALL_DEFAULTS.BANK_GUARANTEE + 5));
  return db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(contractId);
}

export function trailingMonthlyBilledAvg(contractId, months = 3) {
  // A rejected bill is replaced by the one raised after it; counted, the month
  // it belongs to came out at twice its size and the cover sized off it with it.
  const rows = db.prepare(`
    SELECT billing_period, SUM(total_amount) as total
    FROM invoices
    WHERE contract_id = ? AND status NOT IN ('CANCELLED','DRAFT','REJECTED')
    GROUP BY billing_period
    ORDER BY billing_period DESC
    LIMIT ?
  `).all(contractId, months);
  if (!rows.length) return 0;
  return rows.reduce((s, r) => s + (r.total || 0), 0) / rows.length;
}

export function computeRequiredAmount(contractId) {
  // What the paying side must lodge (decided 17-Oct-2026): on a PSA the
  // buyer's letter of credit and funds, on a PPA the seller's guarantees. A
  // guarantee row copied onto a PSA was added to what the buyer had to cover.
  const side = db.prepare('SELECT contract_type FROM contracts WHERE id = ?').get(contractId)?.contract_type === 'PPA' ? 'SELLER' : 'BUYER';
  const reqs = db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(contractId)
    .filter((r) => INSTRUMENTS_BY_SIDE[side].includes(r.mechanism_type));
  const avg = trailingMonthlyBilledAvg(contractId);
  let required = 0;
  for (const r of reqs) {
    if (r.mechanism_type === 'LC' || r.months_cover > 0) {
      required += Math.max(r.min_amount || 0, avg * (r.months_cover || DEFAULT_MONTHS_COVER));
    } else {
      required += r.min_amount || 0;
    }
  }
  if (!reqs.length) {
    const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
    if (c?.contract_type === 'PSA') required = Math.max(avg * DEFAULT_MONTHS_COVER, 0);
    else required = (c?.emd_amount || 0) + (c?.pbg_amount || 0);
  }
  return Math.round(required);
}

/**
 * A bill is money owed once it has been approved and presented, and until it is
 * paid. One still in approval has been presented to nobody, and one rejected is
 * not payable at all — both used to count as dues, so cover was measured against
 * money nobody had been asked for and a letter of credit could be invoked for a
 * bill SJVN had itself turned down.
 *
 * And it is money owed to SJVN. A seller's invoice on SJVN is the other way
 * round: counted here, SJVN being late in paying a seller made the seller's own
 * guarantee look short, held up its release, and — with no amount typed —
 * would have drawn on that guarantee for SJVN's own unpaid bill.
 */
const OWED_STATUSES = ['APPROVED', 'SENT', 'PARTIALLY_PAID', 'DISPUTED'];
const OWED_SQL = `status IN (${OWED_STATUSES.map((s) => `'${s}'`).join(',')}) AND direction = 'SJVN_TO_BUYER'`;

export function outstandingDues(contractId) {
  const invoices = db.prepare(`
    SELECT * FROM invoices
    WHERE contract_id = ? AND ${OWED_SQL}
  `).all(contractId);
  return invoices.reduce((s, inv) => {
    const paid = db.prepare(`SELECT COALESCE(SUM(amount + COALESCE(deduction,0)),0) s FROM payments WHERE invoice_id = ?`).get(inv.id).s;
    const due = payableNow(inv).payable_now - paid;
    return s + Math.max(0, due);
  }, 0);
}

export function projectedNextBill(contractId) {
  return trailingMonthlyBilledAvg(contractId, 3);
}

/**
 * What stands between an instrument and its release: money still owed on the
 * contract, and disputes still open on its bills.
 *
 * Three places asked this and each had its own answer. The counterparty was
 * told nothing was outstanding, the request was stamped clear when it was
 * raised, and the desk's Release button then refused it — for a draft bill
 * nobody had presented, or because the stamp was a week old. One answer,
 * worked out at the moment it is asked.
 */
/**
 * Whether an instrument may come back while its contract is still running
 * (decided 17-Oct-2026). Security exists for the life of the contract, so a
 * live contract keeps it unless:
 *  - it is a seller's performance guarantee and the plant is fully
 *    commissioned (SECI-model PPAs return the PBG after COD), or
 *  - what stays on the contract still meets its requirement and exposure
 *    without this instrument (a replacement has been accepted).
 */
const LIVE_CONTRACT = ['SIGNED', 'PENDING_REGULATORY_APPROVAL', 'ACTIVE', 'AMENDED', 'NEARING_EXPIRY'];
export function releaseWhileLive(ps) {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(ps.contract_id);
  if (!contract || !LIVE_CONTRACT.includes(contract.status)) return { allowed: true, reason: 'contract ended' };
  if (ps.mechanism_type === 'BANK_GUARANTEE' && contract.contract_type === 'PPA'
      && contract.cod_date && Number(contract.commissioned_capacity_mw) >= Number(contract.capacity_mw)) {
    return { allowed: true, reason: 'plant fully commissioned' };
  }
  const cov = computeCoverage(ps.contract_id);
  const own = isLiveToday(ps) ? refreshAvailable(ps) : 0;
  const counts = INSTRUMENTS_BY_SIDE[contract.contract_type === 'PPA' ? 'SELLER' : 'BUYER'].includes(ps.mechanism_type);
  const left = cov.available_security - (counts ? own : 0);
  if (left >= cov.benchmark && cov.benchmark > 0) return { allowed: true, reason: 'replacement cover in place' };
  return {
    allowed: false,
    left: Math.round(left),
    needed: cov.benchmark,
    contract_no: contract.contract_no,
    contract_status: contract.status,
  };
}

export function releasePosition(contractId) {
  const outstanding = Math.round(outstandingDues(contractId) || 0);
  const openDisputes = db.prepare(`
    SELECT COUNT(*) c FROM disputes d JOIN invoices i ON i.id = d.invoice_id
    WHERE i.contract_id = ? AND d.status IN (${OPEN_DISPUTE_STATUSES.map(() => '?').join(',')})
  `).get(contractId, ...OPEN_DISPUTE_STATUSES).c;
  return { outstanding_dues: outstanding, open_disputes: openDisputes, clear: !(outstanding > 0) && openDisputes === 0 };
}

/**
 * Whether an instrument is still standing behind this contract today.
 *
 * Cover was counted from status alone, so an instrument whose validity had run
 * out went on counting until some sweep happened to relabel it — the same
 * mistake as billing a contract on its status rather than its dates. A
 * guarantee that expired last month is not security this month, whatever the
 * row still says.
 */
/** Today on the desk's calendar (IST). An instrument starting today did not count until 05:30, when UTC caught up. */
export const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export function isLiveToday(row, asOf = istToday()) {
  if (!ACTIVE_STATUSES.includes(row.status)) return false;
  if (row.validity_end && String(row.validity_end) < asOf) return false;
  if (row.validity_start && String(row.validity_start) > asOf) return false;
  return true;
}

/**
 * Security on a contract, split by whether the bank has confirmed it.
 *
 * The verify endpoint records a bank confirmation reference and nothing ever
 * required it, so an instrument someone had simply typed in counted as cover in
 * full — a five crore letter of credit that no bank had heard of made a contract
 * look secured.
 *
 * Reported separately rather than silently dropped. On this database one
 * instrument of thirty-seven carries a confirmation, so refusing to count the
 * rest would show every contract as uncovered overnight and block scheduling on
 * work that is genuinely secured but not yet recorded as such. What counts
 * toward adequacy is settled by security_require_bank_confirmation, which starts
 * off; the split is visible either way, so the position can be seen before the
 * rule is turned on.
 */
export function securityBreakdown(contractId) {
  // Only what answers for this contract's paying side: a buyer's letter of
  // credit and contract funds on a PSA, a seller's guarantee and contract funds on a
  // PPA. A PSA counted bank guarantees as payment cover that the waterfall would
  // never draw for a buyer's default.
  const c = db.prepare('SELECT contract_type FROM contracts WHERE id = ?').get(contractId);
  const types = INSTRUMENTS_BY_SIDE[c?.contract_type === 'PPA' ? 'SELLER' : 'BUYER'];
  const rows = db.prepare(`
    SELECT * FROM payment_security
    WHERE contract_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
      AND mechanism_type IN (${types.map(() => '?').join(',')})
  `).all(contractId, ...ACTIVE_STATUSES, ...types);

  let verified = 0;
  let unverified = 0;
  let lapsed = 0;
  for (const r of rows) {
    const amount = refreshAvailable(r);
    if (!isLiveToday(r)) { lapsed += amount; continue; }
    if (r.verified_at) verified += amount;
    else unverified += amount;
  }
  return {
    verified: Math.round(verified),
    unverified: Math.round(unverified),
    lapsed: Math.round(lapsed),
    counted: Math.round(requireBankConfirmation() ? verified : verified + unverified),
  };
}

function requireBankConfirmation() {
  return getParamNumber('security_require_bank_confirmation', 0) === 1;
}

export function availableSecurity(contractId) {
  return securityBreakdown(contractId).counted;
}

export function computeCoverage(contractId) {
  const available = availableSecurity(contractId);
  const outstanding = outstandingDues(contractId);
  const projected = projectedNextBill(contractId);
  const exposure = outstanding + projected;
  const required = computeRequiredAmount(contractId);
  // Measured against the larger of what the contract requires (e.g. LC for
  // 1.1 months' billing) and what is actually at risk (decided 17-Oct-2026):
  // one month's cover read "adequate" against a 1.1-month requirement.
  const benchmark = Math.max(exposure, required || 0);
  const ratio = benchmark > 0 ? available / benchmark : (available > 0 ? 99 : 0);
  const breakdown = securityBreakdown(contractId);
  return {
    contract_id: contractId,
    available_security: Math.round(available),
    // What that figure is made of, so an apparently covered contract can be seen
    // to be resting on instruments nobody has confirmed or that have lapsed.
    verified_security: breakdown.verified,
    unverified_security: breakdown.unverified,
    lapsed_security_excluded: breakdown.lapsed,
    outstanding_dues: Math.round(outstanding),
    projected_next_bill: Math.round(projected),
    exposure: Math.round(exposure),
    required_amount: required,
    benchmark: Math.round(benchmark),
    coverage_ratio: Number(ratio.toFixed(3)),
    adequate: ratio >= 1,
    shortfall: Math.max(0, Math.round(Math.max(exposure, required) - available)),
  };
}

export function hasValidOverride(contractId) {
  const ov = db.prepare(`
    SELECT * FROM security_adequacy_overrides
    WHERE contract_id = ? AND (valid_until IS NULL OR valid_until >= date('now'))
    ORDER BY created_at DESC LIMIT 1
  `).get(contractId);
  return ov || null;
}

/** Adequacy for PSA buyer contracts linked to entity, or trading via optional contract */
export function checkAdequacy({ contractId = null, buyerEntityId = null } = {}) {
  let contracts = [];
  if (contractId) {
    const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
    if (c) contracts = [c];
  } else if (buyerEntityId) {
    contracts = db.prepare(`SELECT * FROM contracts WHERE buyer_id = ? AND status = 'ACTIVE'`).all(buyerEntityId);
  }
  // PPA seller security doesn't block buyer scheduling; only PSA payment cover matters for schedule gate
  const psa = contracts.filter((c) => c.contract_type === 'PSA');
  if (!psa.length) {
    return { adequate: true, reason: 'No PSA contracts in scope', coverages: [] };
  }
  // CC4: a PSA put on hold by hand stops scheduling and bidding for its buyer.
  const held = psa.filter((c) => c.on_hold);
  if (held.length) {
    return {
      adequate: false, coverages: [], held: held.map((c) => c.contract_no),
      error: `Scheduling/bidding stopped: ${held.map((c) => `${c.contract_no} is on hold (${c.hold_reason})`).join('; ')}.`,
    };
  }
  const coverages = psa.map((c) => computeCoverage(c.id));
  const weak = coverages.filter((c) => !c.adequate);
  if (!weak.length) return { adequate: true, coverages };
  const override = weak.map((w) => hasValidOverride(w.contract_id)).find(Boolean);
  if (override) {
    return { adequate: true, overridden: true, override, coverages, weak };
  }
  return {
    adequate: false,
    coverages,
    weak,
    error: `Payment security inadequate for ${weak.map((w) => w.contract_id).join(', ')} (coverage < 1.0). Replenish LC/corpus or seek override.`,
  };
}

export function checkPortfolioAdequacy() {
  const psas = db.prepare(`SELECT id FROM contracts WHERE contract_type = 'PSA' AND status = 'ACTIVE'`).all();
  const coverages = psas.map((c) => computeCoverage(c.id));
  const weak = coverages.filter((c) => !c.adequate && !hasValidOverride(c.contract_id));
  if (!weak.length) return { adequate: true, coverages };
  return {
    adequate: false,
    coverages,
    weak,
    error: `Scheduling/bidding blocked: payment security inadequate on ${weak.length} PSA contract(s). Shortfall total ₹${weak.reduce((s, w) => s + w.shortfall, 0).toLocaleString('en-IN')}.`,
  };
}

export function evaluateInvocationEligibility(contractId) {
  const overdue = db.prepare(`
    SELECT * FROM invoices
    WHERE contract_id = ? AND ${OWED_SQL}
      AND due_date IS NOT NULL
      AND julianday('now') - julianday(due_date) >= ?
  `).all(contractId, INVOCATION_OVERDUE_DAYS);

  const owed = overdue.reduce((s, inv) => {
    const paid = db.prepare(`SELECT COALESCE(SUM(amount + COALESCE(deduction,0)),0) s FROM payments WHERE invoice_id = ?`).get(inv.id).s;
    return s + Math.max(0, payableNow(inv).payable_now - paid);
  }, 0);
  // Less what is already demanded from a bank and not yet back. The same
  // overdue bill could be invoked again while the first notice was with the
  // bank, and again after the money came in.
  const demanded = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) s FROM security_invocations
    WHERE contract_id = ? AND status IN ('NOTICE_ISSUED', 'CLAIMED')
  `).get(contractId).s;
  const amount = Math.max(0, owed - demanded);

  return {
    eligible: overdue.length > 0 && amount > 0,
    overdue_invoices: overdue.map((i) => i.id),
    amount: Math.round(amount),
    overdue_amount: Math.round(owed),
    already_demanded: Math.round(demanded),
    rule_days: INVOCATION_OVERDUE_DAYS,
  };
}

export function invokeWaterfall(contractId, amount, invoiceIds = [], user = { name: 'system' }, side = 'BUYER') {
  // Only the instruments that answer for this side's default, drawn dedicated
  // first and pooled last.
  const eligibleTypes = INSTRUMENTS_BY_SIDE[side] || INSTRUMENTS_BY_SIDE.BUYER;
  const instruments = db.prepare(`
    SELECT * FROM payment_security
    WHERE contract_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
      AND available_amount > 0
      AND mechanism_type IN (${eligibleTypes.map(() => '?').join(',')})
    ORDER BY waterfall_priority ASC, created_at ASC
  `).all(contractId, ...ACTIVE_STATUSES, ...eligibleTypes)
    // A guarantee whose validity has run out cannot be drawn on, whatever the
    // row still says. The status column only catches up when a sweep relabels
    // it, and a demand issued against a lapsed instrument is one the bank will
    // refuse — after the money was already counted as recovered.
    .filter((r) => isLiveToday(r));

  invoiceIds = Array.isArray(invoiceIds) ? invoiceIds : [];
  let remaining = amount;
  const used = [];
  for (const inst of instruments) {
    if (remaining <= 0) break;
    const avail = refreshAvailable(inst);
    const draw = Math.min(avail, remaining);
    if (draw <= 0) continue;
    db.prepare(`UPDATE payment_security SET utilized_amount = utilized_amount + ?, updated_at = datetime('now') WHERE id = ?`)
      .run(draw, inst.id);
    syncInstrumentAvailable(inst.id);
    remaining -= draw;
    used.push({ id: inst.id, instrument_no: inst.instrument_no, type: inst.mechanism_type, amount: draw });
    recordSecurityEvent({
      instrumentId: inst.id,
      contractId,
      user,
      eventType: 'UTILIZE',
      details: { amount: draw, via: 'waterfall' },
    });
  }

  // A notice that drew nothing is a demand on the file for something that never
  // happened, and a "replenish" sent to a counterparty for a draw of nothing.
  if (!used.length) return null;

  const contract = db.prepare('SELECT contract_no FROM contracts WHERE id = ?').get(contractId);
  const contractNo = contract?.contract_no || contractId;
  const invoiceNos = invoiceIds.length
    ? db.prepare(`SELECT invoice_no FROM invoices WHERE id IN (${invoiceIds.map(() => '?').join(',')})`).all(...invoiceIds).map((r) => r.invoice_no)
    : [];
  const drawn = amount - remaining;
  const invId = newId('SIV');
  const letter = {
    to: 'Issuing Bank / Counterparty',
    subject: `Demand for payment under security — ${contractNo}`,
    side,
    amount: drawn,
    requested: amount,
    shortfall_uncovered: remaining,
    invoices: invoiceIds,
    invoice_nos: invoiceNos,
    waterfall: used,
    issued_at: new Date().toISOString(),
  };

  const invocationNo = genInvocationNo();
  db.prepare(`
    INSERT INTO security_invocations (
      id, invocation_no, contract_id, payment_security_id, amount, invoice_ids, status,
      demand_letter_json, waterfall_used, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, 'NOTICE_ISSUED', ?, ?, ?)
  `).run(
    invId,
    invocationNo,
    contractId,
    used[0].id,
    drawn,
    JSON.stringify(invoiceIds),
    JSON.stringify(letter),
    JSON.stringify(used),
    user?.name ?? 'system'
  );

  const rupees = `₹${drawn.toLocaleString('en-IN')}`;
  const from = used.map((u) => u.instrument_no).join(', ');
  notifyDesk('SECURITY_INVOCATION', `${invocationNo}: ${rupees} drawn on ${from} under ${contractNo}${remaining > 0 ? ` — ₹${remaining.toLocaleString('en-IN')} of the demand is not covered by any security` : ''}.`);
  notifyCounterparty(contractId, side, 'SECURITY_REPLENISH_DEMAND',
    `${contractNo}: SJVN has invoked your payment security — ${rupees} drawn on ${from} (notice ${invocationNo}).${side === 'BUYER' ? ' Have the letter of credit reinstated.' : ''}`);

  return db.prepare('SELECT * FROM security_invocations WHERE id = ?').get(invId);
}

export function runAlertCascade() {
  let sent = 0;
  const instruments = db.prepare(`
    SELECT ps.*, c.contract_no FROM payment_security ps
    JOIN contracts c ON c.id = ps.contract_id
    WHERE ps.status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED')
      AND ps.validity_end IS NOT NULL
  `).all();

  const already = db.prepare(`SELECT id FROM security_alerts WHERE payment_security_id = ? AND alert_type = 'EXPIRY' AND days_before = ?`);
  for (const ps of instruments) {
    const daysLeft = daysUntil(ps.validity_end);
    // Only the tightest threshold crossed speaks. An instrument first seen five
    // days from expiry used to be announced four times in one run — a reminder,
    // an urgent, an escalation and a final warning, all saying the same thing.
    const crossed = ALERT_CASCADE_DAYS.filter((d) => daysLeft <= d);
    if (!crossed.length) continue;
    const d = Math.min(...crossed);
    if (already.get(ps.id, d)) continue;

    let role = 'REIA_MAKER';
    let prefix = 'Reminder';
    if (d <= 30) { role = 'REIA_MAKER'; prefix = 'Urgent'; }
    if (d <= 15) { role = 'MANAGEMENT'; prefix = 'Escalation'; }
    if (d <= 7) { role = 'MANAGEMENT'; prefix = 'Final warning'; }
    if (d === 0) { role = 'MANAGEMENT'; prefix = daysLeft < 0 ? 'Expired' : 'Expires today'; }

    const days = (n) => `${n} day${n === 1 ? '' : 's'}`;
    const when = daysLeft < 0 ? `expired ${days(-daysLeft)} ago, on ${dayInWords(ps.validity_end)}`
      : daysLeft === 0 ? `expires today, ${dayInWords(ps.validity_end)}`
        : `expires in ${days(daysLeft)}, on ${dayInWords(ps.validity_end)}`;
    const message = `${prefix}: ${ps.instrument_no} (${ps.contract_no}) ${when}`;
    db.prepare(`
      INSERT INTO security_alerts (id, payment_security_id, contract_id, alert_type, days_before, sent_to, message)
      VALUES (?, ?, ?, 'EXPIRY', ?, ?, ?)
    `).run(newId('PSA'), ps.id, ps.contract_id, d, role, message);
    pushNotification({ role, type: 'SECURITY_EXPIRY', message });
    if (d <= 7) {
      pushNotification({
        role: 'TRADING_USER',
        type: 'SECURITY_SCHEDULING_HOLD',
        message: `Potential scheduling hold: ${ps.instrument_no} (${ps.contract_no}) ${when}`,
      });
    }
    sent += 1;
  }

  // Coverage red flags per PSA
  const psas = db.prepare(`SELECT id, contract_no FROM contracts WHERE contract_type = 'PSA' AND status = 'ACTIVE'`).all();
  for (const c of psas) {
    const cov = computeCoverage(c.id);
    if (cov.coverage_ratio >= 1) continue;
    const exists = db.prepare(`
      SELECT id FROM security_alerts
      WHERE contract_id = ? AND alert_type = 'COVERAGE' AND date(created_at) = date('now')
    `).get(c.id);
    if (exists) continue;
    const message = `Coverage red-flag ${c.contract_no}: ratio ${cov.coverage_ratio} (shortfall ₹${cov.shortfall.toLocaleString('en-IN')})`;
    db.prepare(`
      INSERT INTO security_alerts (id, payment_security_id, contract_id, alert_type, days_before, sent_to, message)
      VALUES (?, NULL, ?, 'COVERAGE', NULL, 'MANAGEMENT', ?)
    `).run(newId('PSA'), c.id, message);
    pushNotification({ role: 'MANAGEMENT', type: 'SECURITY_COVERAGE', message });
    pushNotification({ role: 'REIA_MAKER', type: 'SECURITY_COVERAGE', message });
    sent += 1;
  }

  // Mark expired
  const expired = db.prepare(`
    UPDATE payment_security SET status = 'EXPIRED', updated_at = datetime('now')
    WHERE status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED')
      AND validity_end IS NOT NULL AND date(validity_end) < date('now')
  `).run().changes;

  return { sent, expired };
}

/**
 * The requirement a contract sets, and nothing more.
 *
 * This used to raise an ACTIVE instrument for the full requirement — bank "To
 * be confirmed", no reference, no document — the moment a contract went live.
 * It counted as cover and the waterfall drew on it: a demand notice went out
 * against a letter of credit no bank had issued. What a contract asks for is a
 * requirement; it is held when the instrument is actually furnished, and the
 * desk's register shows the shortfall until then.
 */
export function createInstrumentsFromRequirements(contractId) {
  syncRequirementsFromContract(contractId);
  return [];
}

export { genInstrumentNo, genInvocationNo, refreshAvailable, ACTIVE_STATUSES };
