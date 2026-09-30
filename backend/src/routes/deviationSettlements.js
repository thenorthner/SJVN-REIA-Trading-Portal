import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, genInvoiceNo, buildBillingFamilyRef, directionForContract, computeDueDate } from '../util.js';
import { getParamNumber } from '../mastersService.js';
import { scrapeLatestDSM } from '../services/nrpcScraper.js';
import { settledLakh, settlementRupees, luToMwh } from '../services/nrpcDsa.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR'])];
const WRITE = ROLE_GROUPS.REIA_WRITE;

function withContract(row) {
  if (!row) return row;
  const c = db.prepare('SELECT contract_no, contract_type, project_type FROM contracts WHERE id = ?').get(row.contract_id);
  let invoice_status = null;
  if (row.invoice_id) {
    invoice_status = db.prepare('SELECT status FROM invoices WHERE id = ?').get(row.invoice_id)?.status || null;
  }
  let dsa = null;
  if (row.dsa_account_id) {
    dsa = db.prepare(`
      SELECT week_code, revision, financial_year, week_start, week_end, issued_date, due_date, status
      FROM nrpc_dsa_accounts WHERE id = ?
    `).get(row.dsa_account_id) || null;
  }
  return {
    ...row,
    contract_no: c?.contract_no,
    project_type: c?.project_type,
    invoice_status,
    // An estimate is worth labelling wherever the row is shown.
    is_estimate: row.source !== 'NRPC_DSA',
    dsa_statement: dsa,
    // A statement that has since been revised: the figure on this row is no
    // longer the operative one.
    dsa_superseded: dsa ? dsa.status === 'SUPERSEDED' : false,
  };
}

/**
 * The manual estimate: (actual − scheduled) MWh × rate (₹/MWh),
 * +recoverable / −payable.
 *
 * This is an estimate and not a settlement. NRPC prices each 15-minute block
 * against the grid frequency in that block, so no single rate reproduces the
 * published figure, and the direction does not always follow the deviation —
 * over the archive Nathpa Jhakri settles against the direction of its own
 * deviation on 88 of 1715 days. Rows priced this way are marked source
 * 'MANUAL' and should be replaced by the statement once it is published; see
 * POST /from-dsa.
 */
function computeNet(scheduled, actual, rate) {
  const dev = Math.round(((Number(actual) || 0) - (Number(scheduled) || 0)) * 1000) / 1000;
  const amount = Math.round(dev * (Number(rate) || 0));
  return { deviation_mwh: dev, deviation_amount: amount };
}

/**
 * Catch a DSM rate entered in the wrong unit.
 *
 * deviation_rate is ₹/MWh, while every tariff field on a contract is ₹/kWh. The
 * two differ by a thousand and nothing on the way in said which was wanted, so
 * entering 2.00 for a ₹2/kWh rate produced a ₹6 charge where ₹6,000 was meant —
 * small enough to be paid without anyone querying it. NRPC DSM rates run in the
 * hundreds to thousands of ₹/MWh, so a non-zero rate below the floor is a unit
 * slip rather than a real price.
 */
function implausibleRate(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r === 0) return null;
  const floor = getParamNumber('dsm_rate_min_per_mwh', 50);
  if (Math.abs(r) >= floor) return null;
  return {
    error: `deviation_rate is ₹/MWh, not ₹/kWh — ${r} would be well below any real DSM rate. Did you mean ${r * 1000}?`,
    given_rate_per_mwh: r,
    likely_intended_per_mwh: r * 1000,
    minimum_plausible_per_mwh: floor,
  };
}

/**
 * Create a SUPPLEMENTARY invoice for a DSM row and link it back.
 * Caller must validate eligibility; runs inside its own transaction.
 */
function createDsmInvoice(row, contract, { invoice_no: overrideNo, dispatch_date, created_by }) {
  const amount = Math.round(Number(row.deviation_amount) || 0);
  const direction = directionForContract(contract);
  const billingFamilyRef = buildBillingFamilyRef(contract.contract_no, row.period_month, direction);
  const invoiceId = newId('INV');
  const invoice_no = overrideNo
    || genInvoiceNo(contract.contract_type === 'PPA' ? 'DSM-PPA' : 'DSM-PSA');
  const billDate = dispatch_date || new Date().toISOString().split('T')[0];
  const due_date = computeDueDate(billDate, contract, getParamNumber('default_payment_terms_days', 30));

  const signLabel = amount >= 0 ? 'recoverable' : 'payable';
  const fromStatement = row.source === 'NRPC_DSA';
  const breakdown = [
    {
      code: 'DSM',
      label: `DSM ${row.dsm_no} · Week ${row.week_no}${row.entry_type === 'REVISED' ? ' (R)' : ''}`,
      value: null,
    },
    { code: 'SCH', label: 'Scheduled (MWh)', value: Number(row.scheduled_mwh) || 0 },
    { code: 'ACT', label: 'Actual (MWh)', value: Number(row.actual_mwh) || 0 },
    { code: 'DEV', label: 'Deviation (MWh)', value: Number(row.deviation_mwh) || 0 },
    // A statement-backed bill shows its source, not a rate: NRPC prices each
    // block against frequency and publishes no rate, so quoting one would
    // suggest the total was derived from it.
    fromStatement
      ? { code: 'SRC', label: `Per NRPC Deviation Settlement Account · ${row.dsa_entity_name}`, value: null }
      : { code: 'RATE', label: 'DSM rate (₹/MWh) — estimate', value: Number(row.deviation_rate) || 0 },
    { code: 'AMT', label: `Net DSM amount (${signLabel})`, value: amount },
    { code: 'TOTAL', label: 'Supplementary Bill Total', value: amount },
  ];

  const run = db.transaction(() => {
    db.prepare(`
      INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
        tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees,
        transmission_charges, lps, penalty, trading_margin, taxes,
        other_adjustments, total_amount, invoice_breakdown_json, disputed_amount, due_date, status,
        parent_invoice_id, billing_family_ref, energy_data_id, created_by)
      VALUES (@id, @invoice_no, @contract_id, 'SUPPLEMENTARY', @direction, @billing_period, 0,
        0, @energy_charges, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
        0, @total_amount, @invoice_breakdown_json, 0, @due_date, 'DRAFT',
        NULL, @billing_family_ref, NULL, @created_by)
    `).run({
      id: invoiceId,
      invoice_no,
      contract_id: contract.id,
      direction,
      billing_period: row.period_month,
      energy_charges: amount,
      total_amount: amount,
      invoice_breakdown_json: JSON.stringify(breakdown),
      due_date,
      billing_family_ref: billingFamilyRef,
      created_by,
    });
    db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, ?)').run(
      newId('APR'), invoiceId, 'PENDING',
    );
    db.prepare(`
      UPDATE deviation_settlements
      SET status='DISPATCHED', invoice_no=?, invoice_id=?, dispatch_date=?, updated_at=datetime('now')
      WHERE id=?
    `).run(invoice_no, invoiceId, billDate, row.id);
  });
  run();

  return { invoiceId, invoice_no, dispatch_date: billDate, amount };
}

// List — filter by contract / period / status
router.get('/', requireRole(...READ), (req, res) => {
  const { contract_id, period_month, status } = req.query;
  let sql = 'SELECT * FROM deviation_settlements WHERE 1=1';
  const params = [];
  if (contract_id) { sql += ' AND contract_id = ?'; params.push(contract_id); }
  if (period_month) { sql += ' AND period_month = ?'; params.push(period_month); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY period_month DESC, week_no DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withContract));
});

/**
 * Fetch the latest NRPC weekly deviation account for a plant.
 *
 * Not built — answers 501 so the client can say so plainly. 501 rather than 500
 * because nothing failed: the pipeline does not exist yet. See nrpcScraper.js
 * for what has to be settled first.
 */
router.get('/scrape', requireRole(...WRITE), async (req, res) => {
  const result = await scrapeLatestDSM(req.query.plant_code);
  if (!result.success) {
    return res.status(501).json({ error: result.message, reason: result.reason });
  }
  res.json(result);
});

/**
 * Summary totals for a period.
 *
 * A week can hold both a PRIMARY row and a REVISED one — a revision replaces
 * what it revises, it does not add to it — so only the operative row per
 * (contract, period, week) is counted. Summing both double-counted every
 * revised week.
 */
router.get('/summary', requireRole(...READ), (req, res) => {
  const { contract_id, period_month } = req.query;
  let filters = '';
  const params = [];
  if (contract_id) { filters += ' AND contract_id = ?'; params.push(contract_id); }
  if (period_month) { filters += ' AND period_month = ?'; params.push(period_month); }

  const row = db.prepare(`
    WITH operative AS (
      SELECT deviation_amount, source, week_date,
             ROW_NUMBER() OVER (
               PARTITION BY contract_id, period_month, week_no
               ORDER BY CASE entry_type WHEN 'REVISED' THEN 0 ELSE 1 END, created_at DESC
             ) AS rn
      FROM deviation_settlements
      WHERE status != 'CANCELLED'${filters}
    )
    SELECT COUNT(*) weeks,
           COALESCE(SUM(deviation_amount),0) net_amount,
           COALESCE(SUM(CASE WHEN deviation_amount>0 THEN deviation_amount ELSE 0 END),0) recoverable,
           COALESCE(SUM(CASE WHEN deviation_amount<0 THEN deviation_amount ELSE 0 END),0) payable,
           COALESCE(SUM(CASE WHEN source='NRPC_DSA' THEN 1 ELSE 0 END),0) from_statement,
           COALESCE(SUM(CASE WHEN source<>'NRPC_DSA' THEN 1 ELSE 0 END),0) estimated,
           -- An estimate for a week whose statement has since been imported is
           -- waiting to be replaced; one whose statement has not arrived is
           -- simply not due yet. Only the latter is still to be reconciled.
           COALESCE(SUM(CASE WHEN source<>'NRPC_DSA' AND NOT EXISTS (
             SELECT 1 FROM nrpc_dsa_accounts a
             WHERE a.status = 'ACTIVE'
               AND a.week_start <= operative.week_date
               AND a.week_end   >= operative.week_date
           ) THEN 1 ELSE 0 END),0) pending_reconciliation,
           COALESCE(SUM(CASE WHEN source<>'NRPC_DSA' AND EXISTS (
             SELECT 1 FROM nrpc_dsa_accounts a
             WHERE a.status = 'ACTIVE'
               AND a.week_start <= operative.week_date
               AND a.week_end   >= operative.week_date
           ) THEN 1 ELSE 0 END),0) estimates_replaceable
    FROM operative WHERE rn = 1
  `).get(...params);
  res.json(row);
});

router.get('/:id', requireRole(...READ), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  res.json(withContract(row));
});

/**
 * Create a settlement row from a NRPC Deviation Settlement Account.
 *
 * This is the path that should be used. The amount is the figure NRPC
 * published for that entity in that week, converted once in nrpcDsa.js — no
 * rate is involved and nothing is recomputed here. The row lands CALCULATED
 * for the desk to review; it does not dispatch itself.
 *
 * Body: { contract_id, dsa_account_id, entity_name, plant_code?, plant_name?, notes? }
 */
router.post('/from-dsa', requireRole(...WRITE), (req, res) => {
  const b = req.body || {};
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(b.contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!b.dsa_account_id) return res.status(400).json({ error: 'dsa_account_id is required' });
  if (!b.entity_name) return res.status(400).json({ error: 'entity_name is required — the name the statement uses, e.g. NATHPA JHAKRI HEP' });

  const account = db.prepare('SELECT * FROM nrpc_dsa_accounts WHERE id = ?').get(b.dsa_account_id);
  if (!account) return res.status(404).json({ error: 'DSA statement not found' });
  if (account.status === 'SUPERSEDED') {
    return res.status(409).json({
      error: 'That statement has been superseded by a later one for the same week. Use the current statement.',
      superseded_by: account.superseded_by,
    });
  }

  const total = db.prepare(
    'SELECT * FROM nrpc_dsa_entity_totals WHERE account_id = ? AND entity_name = ?',
  ).get(b.dsa_account_id, b.entity_name);
  if (!total) {
    return res.status(404).json({
      error: `The statement for week ${account.week_no} of ${account.financial_year} has no entity named "${b.entity_name}".`,
    });
  }

  // The week a NRPC statement covers is a financial-year week and can straddle
  // a month boundary. It is filed under the month it starts in, so that a week
  // lands in exactly one period.
  const period_month = account.week_start.slice(0, 7);
  const entry_type = account.revision ? 'REVISED' : 'PRIMARY';

  const dup = db.prepare(
    'SELECT id, source FROM deviation_settlements WHERE contract_id=? AND period_month=? AND week_no=? AND entry_type=?',
  ).get(b.contract_id, period_month, account.week_no, entry_type);
  if (dup) {
    return res.status(409).json({
      error: `A ${entry_type} entry for week ${account.week_no} already exists for this contract in ${period_month}.`,
      existing_id: dup.id, existing_source: dup.source,
    });
  }

  const scheduled_mwh = luToMwh(total.schedule_lu) ?? 0;
  const actual_mwh = luToMwh(total.actual_lu) ?? 0;
  const deviation_amount = settlementRupees(total);
  if (deviation_amount == null) {
    return res.status(422).json({ error: 'The statement publishes no settled amount for this entity.' });
  }

  const id = newId('DSM');
  const dsm_no = `DSM/${contract.contract_no?.replace(/[^A-Za-z0-9]+/g, '-')}/${account.financial_year}/W${account.week_no}${account.revision ? `-${account.revision}` : ''}`;
  db.prepare(`
    INSERT INTO deviation_settlements (id, dsm_no, contract_id, plant_code, plant_name, period_month,
      week_no, week_date, entry_type, source, dsa_account_id, dsa_entity_name,
      scheduled_mwh, actual_mwh, deviation_mwh, deviation_rate, deviation_amount, status, notes, created_by)
    VALUES (@id, @dsm_no, @contract_id, @plant_code, @plant_name, @period_month,
      @week_no, @week_date, @entry_type, 'NRPC_DSA', @dsa_account_id, @dsa_entity_name,
      @scheduled_mwh, @actual_mwh, @deviation_mwh, NULL, @deviation_amount, 'CALCULATED', @notes, @created_by)
  `).run({
    id,
    dsm_no,
    contract_id: b.contract_id,
    plant_code: b.plant_code || null,
    plant_name: b.plant_name || b.entity_name,
    period_month,
    week_no: account.week_no,
    week_date: account.week_start,
    entry_type,
    dsa_account_id: account.id,
    dsa_entity_name: b.entity_name,
    scheduled_mwh,
    actual_mwh,
    // Reported for context. It is not what the amount was derived from, and on
    // some weeks its direction disagrees with the settlement's.
    deviation_mwh: Math.round((actual_mwh - scheduled_mwh) * 1000) / 1000,
    deviation_amount,
    notes: b.notes || null,
    created_by: req.user.name,
  });

  logAudit({
    req, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'deviation_settlement',
    entityId: id,
    details: {
      source: 'NRPC_DSA', dsa_account_id: account.id, entity_name: b.entity_name,
      week_no: account.week_no, financial_year: account.financial_year,
      settled_lakh: settledLakh(total), deviation_amount,
    },
  });
  res.status(201).json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(id)));
});

// Create a weekly deviation entry (data provided by NRPC)
router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body;
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(b.contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!b.period_month) return res.status(400).json({ error: 'period_month (YYYY-MM) is required' });
  if (b.week_no == null || b.week_no === '') return res.status(400).json({ error: 'week_no is required' });
  const entry_type = ['PRIMARY', 'REVISED'].includes(b.entry_type) ? b.entry_type : 'PRIMARY';

  const dup = db.prepare(`SELECT id FROM deviation_settlements WHERE contract_id=? AND period_month=? AND week_no=? AND entry_type=?`)
    .get(b.contract_id, b.period_month, Number(b.week_no), entry_type);
  if (dup) return res.status(409).json({ error: `A ${entry_type} entry for week ${b.week_no} already exists this period. Edit it or use REVISED.` });

  const badRate = implausibleRate(b.deviation_rate);
  if (badRate) return res.status(400).json(badRate);

  const { deviation_mwh, deviation_amount } = computeNet(b.scheduled_mwh, b.actual_mwh, b.deviation_rate);
  const id = newId('DSM');
  db.prepare(`
    INSERT INTO deviation_settlements (id, dsm_no, contract_id, plant_code, plant_name, period_month,
      week_no, week_date, entry_type, scheduled_mwh, actual_mwh, deviation_mwh, deviation_rate,
      deviation_amount, status, notes, created_by)
    VALUES (@id, @dsm_no, @contract_id, @plant_code, @plant_name, @period_month,
      @week_no, @week_date, @entry_type, @scheduled_mwh, @actual_mwh, @deviation_mwh, @deviation_rate,
      @deviation_amount, 'CALCULATED', @notes, @created_by)
  `).run({
    id,
    dsm_no: `DSM/${contract.contract_no?.replace(/[^A-Za-z0-9]+/g, '-')}/${b.period_month}/W${b.week_no}${entry_type === 'REVISED' ? '-R' : ''}`,
    contract_id: b.contract_id,
    plant_code: b.plant_code || null,
    plant_name: b.plant_name || null,
    period_month: b.period_month,
    week_no: Number(b.week_no),
    week_date: b.week_date || null,
    entry_type,
    scheduled_mwh: Number(b.scheduled_mwh) || 0,
    actual_mwh: Number(b.actual_mwh) || 0,
    deviation_mwh,
    deviation_rate: Number(b.deviation_rate) || 0,
    deviation_amount,
    notes: b.notes || null,
    created_by: req.user.name,
  });
  logAudit({ req, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'deviation_settlement', entityId: id, details: { ...b, deviation_mwh, deviation_amount } });
  res.status(201).json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(id)));
});

// Edit (recomputes net); blocked once dispatched
router.put('/:id', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  if (row.status === 'DISPATCHED') return res.status(400).json({ error: 'Dispatched deviation bills cannot be edited' });
  const b = req.body;
  // A statement-backed row carries the figure NRPC published. Editing the
  // energy or the rate would recompute it from a formula that does not
  // reproduce the settlement, quietly replacing a published number with an
  // estimate. Notes and plant labels are still editable below.
  if (row.source === 'NRPC_DSA') {
    const figureEdits = ['scheduled_mwh', 'actual_mwh', 'deviation_rate'].filter((k) => b[k] !== undefined);
    if (figureEdits.length) {
      return res.status(400).json({
        error: `This row carries the figures NRPC published for ${row.dsa_entity_name}; `
          + `${figureEdits.join(', ')} cannot be edited. Import the revised statement instead.`,
      });
    }
  }
  if (b.deviation_rate !== undefined) {
    const badRate = implausibleRate(b.deviation_rate);
    if (badRate) return res.status(400).json(badRate);
  }
  const { deviation_mwh, deviation_amount } = row.source === 'NRPC_DSA'
    ? { deviation_mwh: row.deviation_mwh, deviation_amount: row.deviation_amount }
    : computeNet(b.scheduled_mwh ?? row.scheduled_mwh, b.actual_mwh ?? row.actual_mwh, b.deviation_rate ?? row.deviation_rate);
  db.prepare(`
    UPDATE deviation_settlements SET plant_code=?, plant_name=?, week_date=?, scheduled_mwh=?, actual_mwh=?,
      deviation_mwh=?, deviation_rate=?, deviation_amount=?, notes=?, status='CALCULATED', updated_at=datetime('now')
    WHERE id=?
  `).run(
    b.plant_code ?? row.plant_code, b.plant_name ?? row.plant_name, b.week_date ?? row.week_date,
    Number(b.scheduled_mwh ?? row.scheduled_mwh) || 0, Number(b.actual_mwh ?? row.actual_mwh) || 0,
    deviation_mwh,
    row.source === 'NRPC_DSA' ? null : (Number(b.deviation_rate ?? row.deviation_rate) || 0),
    deviation_amount,
    b.notes ?? row.notes, req.params.id,
  );
  logAudit({ req, user: req.user, action: 'UPDATE', module: 'REIA', entityType: 'deviation_settlement', entityId: req.params.id, details: b });
  res.json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id)));
});

// Submit for dispatch
router.post('/:id/submit', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  // Without this, a cancelled row could be submitted and then dispatched.
  if (!['DRAFT', 'CALCULATED'].includes(row.status)) {
    return res.status(400).json({
      error: `Only DRAFT or CALCULATED rows can be submitted; this one is ${row.status}.`,
    });
  }
  if (row.source === 'NRPC_DSA' && row.dsa_account_id) {
    const acct = db.prepare('SELECT status, superseded_by FROM nrpc_dsa_accounts WHERE id = ?').get(row.dsa_account_id);
    if (acct?.status === 'SUPERSEDED') {
      return res.status(409).json({
        error: 'The statement behind this row has been superseded. Import the current statement for this week and submit that.',
        superseded_by: acct.superseded_by,
      });
    }
  }
  db.prepare(`UPDATE deviation_settlements SET status='SUBMITTED', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  logAudit({ req, user: req.user, action: 'SUBMIT', module: 'REIA', entityType: 'deviation_settlement', entityId: req.params.id });
  res.json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id)));
});

// Dispatch — creates SUPPLEMENTARY invoice + links invoice_id on DSM
router.post('/:id/dispatch', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  if (row.status === 'CANCELLED') return res.status(400).json({ error: 'Cancelled deviation cannot be dispatched' });
  if (row.status === 'DISPATCHED' && row.invoice_id) {
    return res.status(400).json({ error: 'Already dispatched with a linked invoice', invoice_id: row.invoice_id, invoice_no: row.invoice_no });
  }
  if (row.status !== 'SUBMITTED' && !(row.status === 'DISPATCHED' && !row.invoice_id)) {
    return res.status(400).json({ error: 'Only SUBMITTED deviation records can be dispatched' });
  }
  // An estimate must not become a bill. A manual row is priced by multiplying a
  // deviation by a rate, and NRPC prices each 15-minute block against the grid
  // frequency in it — so the figure is not the settlement, and on some weeks not
  // even its direction. Estimates exist so finance can book a provision while
  // the statement is still a week and a half away; invoicing a beneficiary off
  // one is a different thing entirely.
  if (row.source !== 'NRPC_DSA') {
    return res.status(400).json({
      error: 'This row is a manual estimate, not the published settlement, so it cannot be '
        + 'billed. Import the NRPC Deviation Settlement Account for this week and raise the '
        + 'bill from that.',
      source: row.source,
    });
  }

  const amount = Math.round(Number(row.deviation_amount) || 0);
  if (amount === 0) {
    return res.status(400).json({ error: 'Cannot dispatch DSM with zero deviation amount' });
  }

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  try {
    const { invoice_no, dispatch_date, amount: amt } = createDsmInvoice(row, contract, {
      invoice_no: req.body.invoice_no || null,
      dispatch_date: req.body.dispatch_date || null,
      created_by: req.user.name,
    });
    logAudit({
      req, user: req.user, action: 'DISPATCH', module: 'REIA', entityType: 'deviation_settlement',
      entityId: req.params.id,
      details: { invoice_no, dispatch_date, amount: amt },
    });
    pushNotification({
      role: 'REIA_USER',
      type: 'DSM_DISPATCHED',
      message: `DSM bill ${invoice_no} dispatched (${row.dsm_no}) — REIA supplementary invoice created`,
    });
    res.json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id)));
  } catch (err) {
    console.error('DSM dispatch failed:', err);
    res.status(500).json({ error: err.message || 'Failed to dispatch DSM and create invoice' });
  }
});

/**
 * Backfill: create linked SUPPLEMENTARY invoice for a legacy DISPATCHED DSM
 * that has invoice_no but no invoice_id.
 */
router.post('/:id/link-invoice', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  if (row.invoice_id) {
    return res.status(400).json({ error: 'DSM already linked to an invoice', invoice_id: row.invoice_id, invoice_no: row.invoice_no });
  }
  if (row.status !== 'DISPATCHED') {
    return res.status(400).json({ error: 'link-invoice is for DISPATCHED rows without invoice_id; use /dispatch for SUBMITTED' });
  }
  const amount = Math.round(Number(row.deviation_amount) || 0);
  if (amount === 0) {
    return res.status(400).json({ error: 'Cannot create invoice for zero deviation amount' });
  }

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  try {
    const { invoice_no, dispatch_date, amount: amt } = createDsmInvoice(row, contract, {
      invoice_no: req.body.invoice_no || row.invoice_no || null,
      dispatch_date: req.body.dispatch_date || row.dispatch_date || null,
      created_by: req.user.name,
    });
    logAudit({
      req, user: req.user, action: 'LINK_INVOICE', module: 'REIA', entityType: 'deviation_settlement',
      entityId: req.params.id,
      details: { invoice_no, dispatch_date, amount: amt },
    });
    pushNotification({
      role: 'REIA_USER',
      type: 'DSM_INVOICE_LINKED',
      message: `DSM ${row.dsm_no} linked to supplementary invoice ${invoice_no}`,
    });
    res.json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id)));
  } catch (err) {
    console.error('DSM link-invoice failed:', err);
    res.status(500).json({ error: err.message || 'Failed to link DSM invoice' });
  }
});

router.delete('/:id', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  if (row.status === 'DISPATCHED') return res.status(400).json({ error: 'Dispatched deviation bills cannot be deleted' });
  db.prepare(`UPDATE deviation_settlements SET status='CANCELLED', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  logAudit({ req, user: req.user, action: 'CANCEL', module: 'REIA', entityType: 'deviation_settlement', entityId: req.params.id });
  res.json({ ok: true });
});

export default router;
