import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, genInvoiceNo } from '../util.js';
import { payableNow, lpsBaseAmount } from '../disputesConstants.js';

const router = Router();
router.use(requireAuth);

function withContract(inv) {
  if (!inv) return inv;
  const contract = db.prepare('SELECT contract_no, contract_type, project_type FROM contracts WHERE id = ?').get(inv.contract_id);
  return { ...inv, contract_no: contract?.contract_no, project_type: contract?.project_type, ...payableNow(inv) };
}

// E/F. Billing & Invoicing + Seller Invoice Management - list
router.get('/', (req, res) => {
  const { status, contract_id, direction, billing_period } = req.query;
  let sql, params = [];
  
  if (req.user.role === 'SELLER') {
    sql = 'SELECT i.* FROM invoices i JOIN contracts c ON i.contract_id = c.id WHERE c.seller_id = ?';
    params.push(req.user.linked_entity_id);
  } else if (req.user.role === 'BUYER') {
    sql = 'SELECT i.* FROM invoices i JOIN contracts c ON i.contract_id = c.id WHERE c.buyer_id = ?';
    params.push(req.user.linked_entity_id);
  } else {
    sql = 'SELECT * FROM invoices WHERE 1=1';
  }
  
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (contract_id) { sql += ' AND contract_id = ?'; params.push(contract_id); }
  if (direction) { sql += ' AND direction = ?'; params.push(direction); }
  if (billing_period) { sql += ' AND billing_period = ?'; params.push(billing_period); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withContract));
});

router.get('/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const approvals = db.prepare('SELECT * FROM invoice_approvals WHERE invoice_id = ? ORDER BY level').all(req.params.id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date').all(req.params.id);
  const disputes = db.prepare('SELECT * FROM disputes WHERE invoice_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...withContract(inv), approvals, payments, disputes });
});

// Automated invoice generation based on contract + locked energy data
router.post('/generate', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { contract_id, period_month, invoice_type, seller_invoice_ids } = req.body;
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  // If this is a PSA, it might not have its own energy data directly. We must find its parent PPA via allocations.
  let ppa_id = contract_id;
  let alloc_percent = 100;
  if (contract.contract_type === 'PSA') {
    const alloc = db.prepare('SELECT ppa_id, allocation_percent FROM contract_allocations WHERE psa_id = ?').get(contract_id);
    if (alloc) {
      ppa_id = alloc.ppa_id;
      alloc_percent = alloc.allocation_percent;
    }
  }

  const energy = db.prepare(`
    SELECT * FROM energy_data WHERE contract_id = ? AND period_month = ?
    ORDER BY (data_type = 'FINAL') DESC LIMIT 1
  `).get(ppa_id, period_month);
  
  if (!energy) return res.status(400).json({ error: 'No energy data found for this contract (or parent PPA)/period. Upload energy data first.' });

  if (invoice_type === 'FINAL' && energy.status !== 'LOCKED') {
    return res.status(400).json({ error: 'Cannot generate FINAL invoice because energy data is not LOCKED.' });
  }

  // Calculate base energy charges (split for PSAs)
  const allocated_energy_mwh = (energy.energy_mwh * alloc_percent) / 100;
  let energyCharges = Math.round(allocated_energy_mwh * contract.tariff_per_unit);
  
  // If seller_invoice_ids are provided, we should ensure the combined sum aligns, but for now we take the energy data directly
  // Trading Margin is 7 paise per unit (0.07 * 1000 = 70 per MWh) for SJVN's commission on PSAs
  const tradingMargin = contract.contract_type === 'PSA' ? Math.round(allocated_energy_mwh * 70) : 0;
  
  // Penalty for CUF shortfall can be added if availability/CUF < required
  const penalty = 0; // Configurable penalty

  const total = energyCharges + tradingMargin - penalty;

  const id = newId('INV');
  const invoice = {
    id,
    invoice_no: genInvoiceNo(contract.contract_type === 'PPA' ? 'INV-PPA' : 'INV-PSA'),
    contract_id,
    invoice_type: invoice_type || (energy.data_type === 'FINAL' ? 'FINAL' : 'PROVISIONAL'),
    direction: contract.contract_type === 'PPA' ? 'SELLER_TO_SJVN' : 'SJVN_TO_BUYER',
    billing_period: period_month,
    energy_mwh: allocated_energy_mwh,
    tariff_per_unit: contract.tariff_per_unit,
    energy_charges: energyCharges,
    transmission_charges: 0,
    rebate: 0,
    lps: 0,
    penalty,
    trading_margin: tradingMargin,
    taxes: 0,
    other_adjustments: 0,
    total_amount: total,
    disputed_amount: 0,
    due_date: null,
    status: 'DRAFT',
  };
  
  db.prepare(`
    INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
      tariff_per_unit, energy_charges, transmission_charges, rebate, lps, penalty, trading_margin, taxes,
      other_adjustments, total_amount, disputed_amount, due_date, status, created_by)
    VALUES (@id, @invoice_no, @contract_id, @invoice_type, @direction, @billing_period, @energy_mwh,
      @tariff_per_unit, @energy_charges, @transmission_charges, @rebate, @lps, @penalty, @trading_margin, @taxes,
      @other_adjustments, @total_amount, @disputed_amount, @due_date, @status, @created_by)
  `).run({ ...invoice, created_by: req.user.name });

  // Map to seller invoices (Many-to-Many)
  if (seller_invoice_ids && Array.isArray(seller_invoice_ids)) {
    const insertMapping = db.prepare('INSERT INTO invoice_mapping (buyer_invoice_id, seller_invoice_id) VALUES (?, ?)');
    for (const sid of seller_invoice_ids) {
      insertMapping.run(id, sid);
    }
  }

  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'GENERATE', module: 'REIA', entityType: 'invoice', entityId: id, details: invoice });
  res.status(201).json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
});

// Seller invoice submission (manual upload)
router.post('/', requireRole('SELLER', ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const b = req.body;
  const id = newId('INV');
  const total = (b.energy_charges || 0) + (b.transmission_charges || 0) + (b.trading_margin || 0) + (b.taxes || 0) - (b.rebate || 0) + (b.lps || 0) + (b.penalty || 0) + (b.other_adjustments || 0);
  
  // Calculate due date (Net 30 days default)
  const contract = db.prepare('SELECT payment_terms FROM contracts WHERE id = ?').get(b.contract_id);
  const termsStr = contract ? contract.payment_terms : '';
  const match = (termsStr || '').match(/\d+/);
  const days = match ? parseInt(match[0], 10) : 30;
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);
  const dueDateStr = dueDate.toISOString().split('T')[0];

  db.prepare(`
    INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
      tariff_per_unit, energy_charges, transmission_charges, rebate, lps, penalty, trading_margin, taxes,
      other_adjustments, total_amount, due_date, status, created_by)
    VALUES (@id, @invoice_no, @contract_id, @invoice_type, @direction, @billing_period, @energy_mwh,
      @tariff_per_unit, @energy_charges, @transmission_charges, @rebate, @lps, @penalty, @trading_margin, @taxes,
      @other_adjustments, @total_amount, @due_date, 'SUBMITTED', @created_by)
  `).run({
    id,
    invoice_no: b.invoice_no || genInvoiceNo('SELLER-INV'),
    contract_id: b.contract_id,
    invoice_type: b.invoice_type || 'FINAL',
    direction: 'SELLER_TO_SJVN',
    billing_period: b.billing_period,
    energy_mwh: b.energy_mwh,
    tariff_per_unit: b.tariff_per_unit,
    energy_charges: b.energy_charges,
    transmission_charges: b.transmission_charges || 0,
    rebate: b.rebate || 0,
    lps: b.lps || 0,
    penalty: b.penalty || 0,
    trading_margin: b.trading_margin || 0,
    taxes: b.taxes || 0,
    other_adjustments: b.other_adjustments || 0,
    total_amount: total,
    due_date: b.due_date || dueDateStr,
    created_by: req.user.name,
  });
  db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, ?)').run(newId('APR'), id, 'PENDING');
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'SUBMIT', module: 'REIA', entityType: 'invoice', entityId: id, details: b });
  pushNotification({ role: 'REIA_USER', type: 'INVOICE_SUBMITTED', message: `Seller invoice ${b.invoice_no || id} submitted for review` });
  res.status(201).json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
});

// G. Invoice Approval Workflow
router.post('/:id/submit-for-approval', requireRole(...ROLE_GROUPS.REIA_WRITE, 'SELLER'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  db.prepare(`UPDATE invoices SET status = 'UNDER_APPROVAL', updated_at = datetime('now') WHERE id = ?`).run(inv.id);
  const existingLevels = db.prepare('SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ?').get(inv.id).c;
  if (existingLevels === 0) {
    db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, ?)').run(newId('APR'), inv.id, 'PENDING');
    db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 2, ?)').run(newId('APR'), inv.id, 'PENDING');
  } else {
    // Reset existing approvals back to PENDING for resubmission
    db.prepare(`UPDATE invoice_approvals SET status = 'PENDING', comments = NULL, acted_at = NULL, approver_name = NULL WHERE invoice_id = ?`).run(inv.id);
  }
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'SUBMIT_FOR_APPROVAL', module: 'REIA', entityType: 'invoice', entityId: inv.id });
  res.json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id));
});

router.post('/:id/approvals/:level/act', requireRole(...ROLE_GROUPS.REIA_WRITE, 'FINANCE_USER'), (req, res) => {
  const { decision, comments } = req.body; // APPROVED | REJECTED
  const approval = db.prepare('SELECT * FROM invoice_approvals WHERE invoice_id = ? AND level = ?').get(req.params.id, req.params.level);
  if (!approval) return res.status(404).json({ error: 'Approval step not found' });
  db.prepare(`UPDATE invoice_approvals SET status = ?, approver_name = ?, comments = ?, acted_at = datetime('now') WHERE id = ?`)
    .run(decision, req.user.name, comments ?? null, approval.id);

  if (decision === 'REJECTED') {
    db.prepare(`UPDATE invoices SET status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  } else {
    const pending = db.prepare(`SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ? AND status = 'PENDING'`).get(req.params.id).c;
    if (pending === 0) {
      db.prepare(`UPDATE invoices SET status = 'APPROVED', updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
      pushNotification({ role: 'BUYER', type: 'INVOICE_APPROVED', message: `Invoice ${req.params.id} approved and ready for dispatch` });
    }
  }
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: `APPROVAL_${decision}`, module: 'REIA', entityType: 'invoice', entityId: req.params.id, details: { level: req.params.level, comments } });
  res.json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id));
});

// Distribution - mark invoice as sent to buyer
router.post('/:id/send', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status !== 'APPROVED') return res.status(400).json({ error: 'Invoice must be APPROVED before it can be sent' });
  db.prepare(`UPDATE invoices SET status = 'SENT', updated_at = datetime('now') WHERE id = ?`).run(inv.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'SEND', module: 'REIA', entityType: 'invoice', entityId: inv.id });
  pushNotification({ role: 'BUYER', type: 'INVOICE_SENT', message: `Invoice ${inv.invoice_no} has been sent for payment` });
  res.json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id));
});

// Record payment against invoice (H. Payment Tracking)
router.post('/:id/payments', requireRole(...ROLE_GROUPS.FINANCE, 'BUYER'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const { amount, payment_date, mode, reference, deduction } = req.body;
  const id = newId('PAY');
  db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference, deduction) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, inv.id, amount, payment_date, mode ?? null, reference ?? null, deduction || 0);

  // Advanced Logic: Rebate and LPS
  let newRebate = inv.rebate;
  let newLps = inv.lps;
  
  if (inv.due_date) {
    const payDate = new Date(payment_date);
    const dueDate = new Date(inv.due_date);
    const diffTime = payDate - dueDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Rebate: 2% on energy charges if SJVN pays Seller (PPA) early
    // NOTE: Rebate ONLY applies on PPA invoices (Seller -> SJVN).
    // Discoms (Buyers) do NOT get any early payment rebate on PSA invoices.
    if (inv.direction === 'SELLER_TO_SJVN' && diffDays <= 0 && inv.rebate === 0) {
      newRebate = Math.round(inv.energy_charges * 0.02);
    }
    
    // LPS: 15% p.a. on UNDISPUTED amount only for days delayed
    // Disputed portion is excluded from LPS while dispute is open
    if (diffDays > 0) {
      const dailyLpsRate = 0.15 / 365;
      const base = lpsBaseAmount({ ...inv, disputed_amount: inv.disputed_amount });
      const calculatedLps = Math.round(base * dailyLpsRate * diffDays);
      newLps += calculatedLps;
    }
  }

  const totalPaid = db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)),0) s FROM payments WHERE invoice_id = ?').get(inv.id).s;
  
  // Effective payable = original total - rebate + lps - disputed (undisputed always due)
  const effectivePayable = payableNow({ ...inv, rebate: newRebate, lps: newLps }).payable_now;
  
  const newStatus = totalPaid >= effectivePayable ? 'PAID' : 'PARTIALLY_PAID';
  
  db.prepare(`UPDATE invoices SET status = ?, rebate = ?, lps = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(newStatus, newRebate, newLps, inv.id);

  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'PAYMENT_RECORDED', module: 'REIA', entityType: 'invoice', entityId: inv.id, details: req.body });
  res.status(201).json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id));
});

export default router;
