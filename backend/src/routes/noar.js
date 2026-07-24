import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.TRADING_ALL, 'COMPLIANCE_AUDITOR'])];
const WRITE = ROLE_GROUPS.TRADING_WRITE;

function currentBalance() {
  const row = db.prepare('SELECT balance_after FROM noar_wallet_txns ORDER BY txn_date DESC, created_at DESC LIMIT 1').get();
  return row ? Number(row.balance_after) : 0;
}

router.get('/', requireRole(...READ), (req, res) => {
  const { txn_type, category } = req.query;
  let sql = 'SELECT * FROM noar_wallet_txns WHERE 1=1';
  const params = [];
  if (txn_type) { sql += ' AND txn_type = ?'; params.push(txn_type); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY txn_date DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/summary', requireRole(...READ), (req, res) => {
  const totRecharge = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM noar_wallet_txns WHERE txn_type='RECHARGE'").get().s;
  const totCharge = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM noar_wallet_txns WHERE txn_type='CHARGE'").get().s;
  const byCat = db.prepare("SELECT category, COALESCE(SUM(amount),0) s FROM noar_wallet_txns WHERE txn_type='CHARGE' GROUP BY category").all();
  const cat = {};
  byCat.forEach((r) => { cat[r.category || 'OTHER'] = Math.round(r.s); });
  res.json({
    balance: Math.round(currentBalance()),
    total_recharged: Math.round(totRecharge),
    total_charges: Math.round(totCharge),
    charges_by_category: cat,
  });
});

router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body;
  const txn_type = b.txn_type === 'CHARGE' ? 'CHARGE' : 'RECHARGE';
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
  if (!b.txn_date) return res.status(400).json({ error: 'txn_date is required' });
  const bal = currentBalance();
  const balance_after = txn_type === 'RECHARGE' ? bal + amount : bal - amount;
  if (txn_type === 'CHARGE' && balance_after < 0) {
    return res.status(400).json({ error: `Insufficient NOAR wallet balance (₹${Math.round(bal).toLocaleString('en-IN')}). Recharge first.` });
  }
  const id = newId('NOAR');
  const seq = (db.prepare('SELECT COUNT(*) c FROM noar_wallet_txns').get().c || 0) + 1;
  db.prepare(`
    INSERT INTO noar_wallet_txns (id, txn_no, txn_type, category, amount, balance_after, payee, reference, txn_date, notes, created_by)
    VALUES (@id, @txn_no, @txn_type, @category, @amount, @balance_after, @payee, @reference, @txn_date, @notes, @created_by)
  `).run({
    id, txn_no: `NOAR/${String(seq).padStart(5, '0')}`,
    txn_type,
    category: txn_type === 'CHARGE' ? (b.category || 'OTHER') : null,
    amount, balance_after,
    payee: b.payee || null, reference: b.reference || null,
    txn_date: b.txn_date, notes: b.notes || null, created_by: req.user.name,
  });
  logAudit({ req, user: req.user, action: txn_type, module: 'TRADING', entityType: 'noar_wallet', entityId: id, details: b });
  res.status(201).json(db.prepare('SELECT * FROM noar_wallet_txns WHERE id = ?').get(id));
});

export default router;
