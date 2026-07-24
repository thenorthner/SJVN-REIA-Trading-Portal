import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, genInvoiceNo, buildBillingFamilyRef, directionForContract, computeDueDate } from '../util.js';
import { getParamNumber } from '../mastersService.js';

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
  return {
    ...row,
    contract_no: c?.contract_no,
    project_type: c?.project_type,
    invoice_status,
  };
}

/** Net deviation = (actual − scheduled) MWh × rate (₹/MWh). +recoverable / −payable. */
function computeNet(scheduled, actual, rate) {
  const dev = Math.round(((Number(actual) || 0) - (Number(scheduled) || 0)) * 1000) / 1000;
  const amount = Math.round(dev * (Number(rate) || 0));
  return { deviation_mwh: dev, deviation_amount: amount };
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
  const breakdown = [
    {
      code: 'DSM',
      label: `DSM ${row.dsm_no} · Week ${row.week_no}${row.entry_type === 'REVISED' ? ' (R)' : ''}`,
      value: null,
    },
    { code: 'SCH', label: 'Scheduled (MWh)', value: Number(row.scheduled_mwh) || 0 },
    { code: 'ACT', label: 'Actual (MWh)', value: Number(row.actual_mwh) || 0 },
    { code: 'DEV', label: 'Deviation (MWh)', value: Number(row.deviation_mwh) || 0 },
    { code: 'RATE', label: 'DSM rate (₹/MWh)', value: Number(row.deviation_rate) || 0 },
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

// Summary totals for a period (for dashboards / settlement)
router.get('/summary', requireRole(...READ), (req, res) => {
  const { contract_id, period_month } = req.query;
  let sql = `SELECT COUNT(*) weeks, COALESCE(SUM(deviation_amount),0) net_amount,
             COALESCE(SUM(CASE WHEN deviation_amount>0 THEN deviation_amount ELSE 0 END),0) recoverable,
             COALESCE(SUM(CASE WHEN deviation_amount<0 THEN deviation_amount ELSE 0 END),0) payable
             FROM deviation_settlements WHERE status != 'CANCELLED'`;
  const params = [];
  if (contract_id) { sql += ' AND contract_id = ?'; params.push(contract_id); }
  if (period_month) { sql += ' AND period_month = ?'; params.push(period_month); }
  res.json(db.prepare(sql).get(...params));
});

router.get('/:id', requireRole(...READ), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  res.json(withContract(row));
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
  const { deviation_mwh, deviation_amount } = computeNet(
    b.scheduled_mwh ?? row.scheduled_mwh, b.actual_mwh ?? row.actual_mwh, b.deviation_rate ?? row.deviation_rate);
  db.prepare(`
    UPDATE deviation_settlements SET plant_code=?, plant_name=?, week_date=?, scheduled_mwh=?, actual_mwh=?,
      deviation_mwh=?, deviation_rate=?, deviation_amount=?, notes=?, status='CALCULATED', updated_at=datetime('now')
    WHERE id=?
  `).run(
    b.plant_code ?? row.plant_code, b.plant_name ?? row.plant_name, b.week_date ?? row.week_date,
    Number(b.scheduled_mwh ?? row.scheduled_mwh) || 0, Number(b.actual_mwh ?? row.actual_mwh) || 0,
    deviation_mwh, Number(b.deviation_rate ?? row.deviation_rate) || 0, deviation_amount,
    b.notes ?? row.notes, req.params.id,
  );
  logAudit({ req, user: req.user, action: 'UPDATE', module: 'REIA', entityType: 'deviation_settlement', entityId: req.params.id, details: b });
  res.json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id)));
});

// Submit for dispatch
router.post('/:id/submit', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
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
