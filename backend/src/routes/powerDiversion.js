import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, billableCapacityMw } from '../util.js';
import { daysInMonth } from '../services/cercHydroBilling.js';
import { applyInvoicePayment, buyerOutstanding } from './invoices.js';
import { notifyCounterparty } from '../paymentSecurityEngine.js';

// Power diversion (PSA Art. 6.6): when a buyer defaults on payment or does not
// requisition its power, SJVN sells that power elsewhere and sets the proceeds
// against the buyer's dues.
//
// Held to what it is (17-Oct-2026 audit). A negative rate and negative expenses
// were taken (a "sale" of minus ₹3 lakh); 9 lakh MWh in a 50 MW month, in 2030,
// came out as ₹360 crore of gain; recovery was two calls from the browser — a
// waterfall across every bill the buyer has on any PSA, whatever it could
// place, then "mark recovered" with any figure (₹99,999 crore, twice) — and a
// recovered diversion could still be cancelled.

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE, 'COMPLIANCE_AUDITOR'])];
const WRITE = ROLE_GROUPS.REIA_WRITE;
const REASONS = ['PAYMENT_DEFAULT', 'NON_REQUISITION'];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// The exchange price ceiling (₹/MWh) a diverted sale cannot have cleared above.
const RATE_CEILING = 20000;
const OPEN_BILL = `i.direction = 'SJVN_TO_BUYER' AND i.status IN ('SENT','PARTIALLY_PAID','DISPUTED')`;
const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

function withNames(row) {
  if (!row) return row;
  const c = db.prepare('SELECT contract_no FROM contracts WHERE id = ?').get(row.contract_id);
  const b = row.buyer_id ? db.prepare('SELECT name FROM entities WHERE id = ?').get(row.buyer_id) : null;
  return { ...row, contract_no: c?.contract_no, buyer_name: b?.name };
}

router.get('/', requireRole(...READ), (req, res) => {
  const { contract_id, buyer_id, status } = req.query;
  let sql = 'SELECT * FROM power_diversions WHERE 1=1';
  const params = [];
  if (contract_id) { sql += ' AND contract_id = ?'; params.push(contract_id); }
  if (buyer_id) { sql += ' AND buyer_id = ?'; params.push(buyer_id); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY period_month DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withNames));
});

router.get('/summary', requireRole(...READ), (req, res) => {
  const row = db.prepare(`SELECT COUNT(*) total,
    COALESCE(SUM(quantum_mwh),0) total_mwh,
    COALESCE(SUM(sale_amount),0) total_sale,
    COALESCE(SUM(CASE WHEN net_gain>0 THEN net_gain ELSE 0 END),0) total_gain,
    COALESCE(SUM(CASE WHEN net_gain<0 THEN -net_gain ELSE 0 END),0) total_deficit,
    COALESCE(SUM(applied_amount),0) total_recovered
    FROM power_diversions WHERE status != 'CANCELLED'`).get();
  res.json(row);
});

/** What the buyer owes on this PSA that is past its due date. */
function overdueOn(contractId) {
  return db.prepare(`
    SELECT COUNT(*) n, COALESCE(SUM(i.total_amount), 0) amount FROM invoices i
    WHERE i.contract_id = ? AND ${OPEN_BILL} AND i.due_date IS NOT NULL AND i.due_date < ?
  `).get(contractId, istToday());
}

router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body || {};
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(b.contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.contract_type !== 'PSA') return res.status(400).json({ error: 'Power diversion applies to PSA (buyer) contracts' });
  const period = String(b.period_month || '');
  if (!MONTH.test(period)) return res.status(400).json({ error: 'period_month must be a month, YYYY-MM' });
  if (period > istToday().slice(0, 7)) return res.status(400).json({ error: `${period} has not started; power is diverted when the buyer fails to take or pay for it, not ahead of time.` });
  if (contract.tenure_start && period < String(contract.tenure_start).slice(0, 7)) {
    return res.status(400).json({ error: `${period} is before ${contract.contract_no} starts (${contract.tenure_start}).` });
  }
  if (!REASONS.includes(b.reason)) return res.status(400).json({ error: `reason must be one of ${REASONS.join(', ')}` });

  const quantum = Number(b.quantum_mwh);
  const rate = Number(b.sale_rate_per_mwh);
  const expensesIn = b.expenses === undefined || b.expenses === null || b.expenses === '' ? 0 : Number(b.expenses);
  if (!Number.isFinite(quantum) || quantum <= 0) return res.status(400).json({ error: 'quantum_mwh must be positive' });
  if (!Number.isFinite(rate) || rate <= 0) return res.status(400).json({ error: 'sale_rate_per_mwh must be a positive ₹/MWh figure' });
  if (rate > RATE_CEILING) return res.status(400).json({ error: `₹${rate.toLocaleString('en-IN')}/MWh is above the exchange price ceiling (₹${RATE_CEILING.toLocaleString('en-IN')}/MWh). The rate is per MWh.` });
  if (!Number.isFinite(expensesIn) || expensesIn < 0) return res.status(400).json({ error: 'expenses must be zero or more' });
  // A PSA can only divert what its capacity could deliver in the month.
  const ceiling = billableCapacityMw(contract) * 24 * daysInMonth(period);
  const already = db.prepare(`SELECT COALESCE(SUM(quantum_mwh), 0) s FROM power_diversions WHERE contract_id = ? AND period_month = ? AND status != 'CANCELLED'`).get(contract.id, period).s;
  if (ceiling > 0 && quantum + already > ceiling + 1e-6) {
    return res.status(400).json({ error: `${contract.contract_no} can deliver at most ${Math.round(ceiling).toLocaleString('en-IN')} MWh in ${period}${already ? ` and ${already} MWh is already diverted` : ''}; ${quantum} MWh more cannot have been.` });
  }
  // A payment default needs something unpaid past its date on this PSA.
  if (b.reason === 'PAYMENT_DEFAULT') {
    const due = overdueOn(contract.id);
    if (!due.n) {
      return res.status(400).json({ error: `${contract.contract_no} has no bill past its due date, so the buyer is not in payment default. If the buyer did not schedule the power, record it as not requisitioned.` });
    }
  }

  const sale_amount = Math.round(quantum * rate);
  const expenses = Math.round(expensesIn);
  const net_gain = sale_amount - expenses;

  const id = newId('PDV');
  const seq = (db.prepare('SELECT COUNT(*) c FROM power_diversions').get().c || 0) + 1;
  db.prepare(`
    INSERT INTO power_diversions (id, diversion_no, contract_id, buyer_id, period_month, reason,
      quantum_mwh, exchange_platform, sale_rate_per_mwh, sale_amount, expenses, net_gain, notes, created_by)
    VALUES (@id, @diversion_no, @contract_id, @buyer_id, @period_month, @reason,
      @quantum_mwh, @exchange_platform, @sale_rate_per_mwh, @sale_amount, @expenses, @net_gain, @notes, @created_by)
  `).run({
    id, diversion_no: `PDV/${period}/${String(seq).padStart(3, '0')}`,
    contract_id: contract.id, buyer_id: contract.buyer_id, period_month: period, reason: b.reason,
    quantum_mwh: quantum, exchange_platform: b.exchange_platform || null, sale_rate_per_mwh: rate,
    sale_amount, expenses, net_gain, notes: b.notes ? String(b.notes).slice(0, 500) : null, created_by: req.user.name,
  });
  logAudit({ req, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'power_diversion', entityId: id, details: b });
  // The buyer is told its power has gone elsewhere, and on what ground.
  notifyCounterparty(contract.id, 'BUYER', 'POWER_DIVERTED',
    `${quantum.toLocaleString('en-IN')} MWh of ${contract.contract_no} for ${period} was sold on the exchange (${b.reason === 'PAYMENT_DEFAULT' ? 'payment default' : 'power not requisitioned'}). Net proceeds ${rupees(net_gain)}.`);
  res.status(201).json(withNames(db.prepare('SELECT * FROM power_diversions WHERE id = ?').get(id)));
});

/**
 * Set a diversion's net proceeds against the buyer's dues on that PSA, surcharge
 * first and oldest bill first (PSA Art. 6.3), in one step. What is applied is
 * what there was to apply it to; the rest is reported, not claimed.
 */
router.post('/:id/recover', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM power_diversions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Diversion not found' });
  if (row.status !== 'RECORDED') return res.status(400).json({ error: `${row.diversion_no} is ${row.status.toLowerCase()}; it can be recovered once.` });
  if (!(row.net_gain > 0)) return res.status(400).json({ error: `${row.diversion_no} made no net gain (${rupees(row.net_gain)}), so there is nothing to set against the dues.` });
  const items = buyerOutstanding(row.buyer_id, row.contract_id);
  if (!items.length) return res.status(400).json({ error: `Nothing is outstanding on this PSA to set ${rupees(row.net_gain)} against.` });

  const payDate = istToday();
  let remaining = row.net_gain;
  const toLps = new Map();
  const toPrincipal = new Map();
  for (const it of items) { if (remaining <= 0) break; const a = Math.min(remaining, it.lps); if (a > 0) { toLps.set(it.inv.id, a); remaining -= a; } }
  for (const it of items) { if (remaining <= 0) break; const a = Math.min(remaining, it.principal); if (a > 0) { toPrincipal.set(it.inv.id, a); remaining -= a; } }

  const allocations = [];
  db.transaction(() => {
    for (const it of items) {
      const lpsPart = Math.round((toLps.get(it.inv.id) || 0) * 100) / 100;
      const principalPart = Math.round((toPrincipal.get(it.inv.id) || 0) * 100) / 100;
      const a = Math.round((lpsPart + principalPart) * 100) / 100;
      if (!(a > 0)) continue;
      const updated = applyInvoicePayment(it.inv, { amount: a, payment_date: payDate, mode: 'POWER_DIVERSION', reference: row.diversion_no, deduction: 0, lps_component: lpsPart }, req);
      allocations.push({ invoice_no: it.inv.invoice_no, to_lps: lpsPart, to_principal: principalPart, allocated: a, status: updated.status });
    }
    const applied = Math.round(row.net_gain - remaining);
    db.prepare("UPDATE power_diversions SET status = 'RECOVERED', applied_amount = ?, updated_at = datetime('now') WHERE id = ? AND status = 'RECORDED'")
      .run(applied, row.id);
  })();
  const unapplied = Math.round(remaining);
  logAudit({ req, user: req.user, action: 'RECOVER', module: 'REIA', entityType: 'power_diversion', entityId: row.id, details: { net_gain: row.net_gain, unapplied, allocations } });
  res.json({ ...withNames(db.prepare('SELECT * FROM power_diversions WHERE id = ?').get(row.id)), allocations, unapplied });
});

router.delete('/:id', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM power_diversions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Diversion not found' });
  // Money already set against the buyer's bills stands on those bills.
  if (row.status !== 'RECORDED') return res.status(400).json({ error: `${row.diversion_no} is ${row.status.toLowerCase()} and cannot be cancelled.` });
  db.prepare("UPDATE power_diversions SET status='CANCELLED', updated_at=datetime('now') WHERE id=?").run(row.id);
  logAudit({ req, user: req.user, action: 'CANCEL', module: 'REIA', entityType: 'power_diversion', entityId: row.id });
  res.json({ ok: true });
});

export default router;
