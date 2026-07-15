import db from './db/index.js';
import { newId, pushNotification } from './util.js';
import { payableNow, OPEN_STATUSES as OPEN_DISPUTE_STATUSES } from './disputesConstants.js';
import {
  INVOCATION_OVERDUE_DAYS,
  DEFAULT_MONTHS_COVER,
  ALERT_CASCADE_DAYS,
  ACTIVE_STATUSES,
  WATERFALL_DEFAULTS,
  genInstrumentNo,
  genInvocationNo,
  refreshAvailable,
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
    const avg = trailingMonthlyBilledAvg(contractId);
    const required = Math.max(avg * DEFAULT_MONTHS_COVER, 0);
    ids.push(upsert('LC', null, required || Math.round((c.capacity_mw || 0) * 24 * 30 * 0.25 * (c.tariff_per_unit || 3) * 1.1), DEFAULT_MONTHS_COVER, true, WATERFALL_DEFAULTS.LC));
    ids.push(upsert('CORPUS_FUND', null, Math.round(required * 0.1), 0, false, WATERFALL_DEFAULTS.CORPUS_FUND));
  }
  if (c.contract_type === 'PPA') {
    if (c.emd_amount) ids.push(upsert('BANK_GUARANTEE', 'EMD', c.emd_amount, 0, false, WATERFALL_DEFAULTS.BANK_GUARANTEE));
    if (c.pbg_amount) ids.push(upsert('BANK_GUARANTEE', 'PBG', c.pbg_amount, 0, false, WATERFALL_DEFAULTS.BANK_GUARANTEE + 5));
  }
  return db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(contractId);
}

export function trailingMonthlyBilledAvg(contractId, months = 3) {
  const rows = db.prepare(`
    SELECT billing_period, SUM(total_amount) as total
    FROM invoices
    WHERE contract_id = ? AND status NOT IN ('CANCELLED','DRAFT')
    GROUP BY billing_period
    ORDER BY billing_period DESC
    LIMIT ?
  `).all(contractId, months);
  if (!rows.length) return 0;
  return rows.reduce((s, r) => s + (r.total || 0), 0) / rows.length;
}

export function computeRequiredAmount(contractId) {
  const reqs = db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(contractId);
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

export function outstandingDues(contractId) {
  const invoices = db.prepare(`
    SELECT * FROM invoices
    WHERE contract_id = ? AND status NOT IN ('PAID','CANCELLED','DRAFT')
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

export function availableSecurity(contractId) {
  const rows = db.prepare(`
    SELECT * FROM payment_security
    WHERE contract_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
  `).all(contractId, ...ACTIVE_STATUSES);
  return rows.reduce((s, r) => s + refreshAvailable(r), 0);
}

export function computeCoverage(contractId) {
  const available = availableSecurity(contractId);
  const outstanding = outstandingDues(contractId);
  const projected = projectedNextBill(contractId);
  const exposure = outstanding + projected;
  const required = computeRequiredAmount(contractId);
  const ratio = exposure > 0 ? available / exposure : (available > 0 ? 99 : 0);
  return {
    contract_id: contractId,
    available_security: Math.round(available),
    outstanding_dues: Math.round(outstanding),
    projected_next_bill: Math.round(projected),
    exposure: Math.round(exposure),
    required_amount: required,
    coverage_ratio: Number(ratio.toFixed(3)),
    adequate: ratio >= 1 || (exposure === 0 && available >= required),
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
    WHERE contract_id = ? AND status NOT IN ('PAID','CANCELLED','DRAFT')
      AND due_date IS NOT NULL
      AND julianday('now') - julianday(due_date) >= ?
  `).all(contractId, INVOCATION_OVERDUE_DAYS);

  const amount = overdue.reduce((s, inv) => {
    const paid = db.prepare(`SELECT COALESCE(SUM(amount + COALESCE(deduction,0)),0) s FROM payments WHERE invoice_id = ?`).get(inv.id).s;
    return s + Math.max(0, payableNow(inv).payable_now - paid);
  }, 0);

  return {
    eligible: overdue.length > 0 && amount > 0,
    overdue_invoices: overdue.map((i) => i.id),
    amount: Math.round(amount),
    rule_days: INVOCATION_OVERDUE_DAYS,
  };
}

export function invokeWaterfall(contractId, amount, invoiceIds = [], user = { name: 'system' }) {
  const instruments = db.prepare(`
    SELECT * FROM payment_security
    WHERE contract_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
      AND available_amount > 0
    ORDER BY waterfall_priority ASC, created_at ASC
  `).all(contractId, ...ACTIVE_STATUSES);

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

  const invId = newId('SIV');
  const letter = {
    to: 'Issuing Bank / Counterparty',
    subject: `Demand for payment under security — ${contractId}`,
    amount: amount - remaining,
    requested: amount,
    shortfall_uncovered: remaining,
    invoices: invoiceIds,
    waterfall: used,
    issued_at: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO security_invocations (
      id, invocation_no, contract_id, payment_security_id, amount, invoice_ids, status,
      demand_letter_json, waterfall_used, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, 'NOTICE_ISSUED', ?, ?, ?)
  `).run(
    invId,
    genInvocationNo(),
    contractId,
    used[0]?.id || null,
    amount - remaining,
    JSON.stringify(invoiceIds),
    JSON.stringify(letter),
    JSON.stringify(used),
    user?.name ?? 'system'
  );

  pushNotification({
    role: 'REIA_USER',
    type: 'SECURITY_INVOCATION',
    message: `Invocation started on ${contractId}: ₹${(amount - remaining).toLocaleString('en-IN')} drawn via waterfall`,
  });
  pushNotification({
    role: 'BUYER',
    type: 'SECURITY_REPLENISH_DEMAND',
    message: `Replenish payment security for contract — invocation of ₹${(amount - remaining).toLocaleString('en-IN')}`,
  });

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

  for (const ps of instruments) {
    const daysLeft = Math.ceil(
      (new Date(ps.validity_end).getTime() - Date.now()) / (86400000)
    );
    for (const d of ALERT_CASCADE_DAYS) {
      if (daysLeft > d) continue;
      // send once per (instrument, days_before, type)
      const exists = db.prepare(`
        SELECT id FROM security_alerts
        WHERE payment_security_id = ? AND alert_type = 'EXPIRY' AND days_before = ?
      `).get(ps.id, d);
      if (exists) continue;

      let role = 'REIA_USER';
      let prefix = 'Reminder';
      if (d <= 30) { role = 'REIA_USER'; prefix = 'Urgent'; }
      if (d <= 15) { role = 'MANAGEMENT'; prefix = 'Escalation'; }
      if (d <= 7) { role = 'MANAGEMENT'; prefix = 'Final warning'; }
      if (d === 0) { role = 'MANAGEMENT'; prefix = 'CRITICAL expired/expiry day'; }

      const message = `${prefix}: ${ps.instrument_no} (${ps.contract_no}) expires in ${daysLeft} day(s) on ${ps.validity_end}`;
      db.prepare(`
        INSERT INTO security_alerts (id, payment_security_id, contract_id, alert_type, days_before, sent_to, message)
        VALUES (?, ?, ?, 'EXPIRY', ?, ?, ?)
      `).run(newId('PSA'), ps.id, ps.contract_id, d, role, message);
      pushNotification({ role, type: 'SECURITY_EXPIRY', message });
      if (d <= 7) {
        pushNotification({
          role: 'TRADING_USER',
          type: 'SECURITY_SCHEDULING_HOLD',
          message: `Potential scheduling hold: ${ps.instrument_no} near expiry`,
        });
      }
      sent += 1;
    }
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
    pushNotification({ role: 'REIA_USER', type: 'SECURITY_COVERAGE', message });
    sent += 1;
  }

  // Mark expired
  db.prepare(`
    UPDATE payment_security SET status = 'EXPIRED', updated_at = datetime('now')
    WHERE status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED')
      AND validity_end IS NOT NULL AND date(validity_end) < date('now')
  `).run();

  return { sent };
}

export function createInstrumentsFromRequirements(contractId, user) {
  const reqs = syncRequirementsFromContract(contractId);
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  const created = [];
  for (const r of reqs) {
    const exists = db.prepare(`
      SELECT id FROM payment_security
      WHERE contract_id = ? AND mechanism_type = ? AND COALESCE(bg_subtype,'') = COALESCE(?, '')
        AND status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED','DRAFT')
    `).get(contractId, r.mechanism_type, r.bg_subtype);
    if (exists) continue;

    const required = r.months_cover > 0
      ? Math.max(r.min_amount, trailingMonthlyBilledAvg(contractId) * r.months_cover)
      : r.min_amount;
    const id = newId('PSC');
    const entityId = c.contract_type === 'PSA' ? c.buyer_id : c.seller_id;
    db.prepare(`
      INSERT INTO payment_security (
        id, instrument_no, contract_id, entity_id, mechanism_type, bg_subtype, is_revolving,
        limit_amount, utilized_amount, available_amount, required_amount, waterfall_priority,
        issuing_bank, beneficiary, validity_start, validity_end, status, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, date('now'), ?, 'ACTIVE', ?)
    `).run(
      id,
      genInstrumentNo(r.mechanism_type === 'BANK_GUARANTEE' ? (r.bg_subtype || 'BG') : r.mechanism_type),
      contractId,
      entityId,
      r.mechanism_type,
      r.bg_subtype,
      r.is_revolving ? 1 : 0,
      required,
      required,
      required,
      r.waterfall_priority,
      'To be confirmed',
      'SJVN Limited',
      c.pbg_expiry || '2026-12-31',
      `Auto-synced from contract requirement (${r.mechanism_type})`
    );
    recordSecurityEvent({ instrumentId: id, contractId, user, eventType: 'CREATE', details: { from: 'requirement' } });
    created.push(db.prepare('SELECT * FROM payment_security WHERE id = ?').get(id));
  }
  return created;
}

export { genInstrumentNo, genInvocationNo, refreshAvailable, ACTIVE_STATUSES };
