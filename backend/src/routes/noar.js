import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.TRADING_ALL, 'COMPLIANCE_AUDITOR'])];
const WRITE = ROLE_GROUPS.TRADING_WRITE;

const CATEGORIES = ['ISTS', 'RLDC', 'APPLICATION', 'OTHER'];
// Below this the wallet can no longer absorb a typical monthly ISTS bill, so
// PT & BD need to raise a recharge request before the next scheduling window.
const LOW_BALANCE_THRESHOLD = 500000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rewrite `balance_after` for every row in strict chronological order.
 *
 * The running balance can't be derived from "the last row inserted" because a
 * back-dated charge (common — Grid India bills arrive late) lands in the middle
 * of the ledger. Any write recomputes the whole chain so the column always
 * reflects the balance as of that transaction's own date.
 */
function recomputeBalances() {
  const rows = db.prepare(`
    SELECT id, txn_type, amount FROM noar_wallet_txns
    ORDER BY txn_date ASC, created_at ASC, id ASC
  `).all();
  const upd = db.prepare('UPDATE noar_wallet_txns SET balance_after = ? WHERE id = ?');
  let running = 0;
  for (const r of rows) {
    running += r.txn_type === 'RECHARGE' ? Number(r.amount) : -Number(r.amount);
    upd.run(Math.round(running * 100) / 100, r.id);
  }
  return running;
}

/**
 * Next `NOAR/nnnnn`. Derived from the highest existing number rather than a row
 * count, because txn_no is UNIQUE and deleting a row would otherwise hand out a
 * number that is already taken. Non-numeric suffixes (seeded `NOAR/SEED/nnnn`)
 * cast to 0 and are ignored.
 */
function nextTxnNo() {
  const row = db.prepare(`
    SELECT MAX(CAST(substr(txn_no, 6) AS INTEGER)) m
    FROM noar_wallet_txns WHERE txn_no LIKE 'NOAR/%'
  `).get();
  return `NOAR/${String((row?.m || 0) + 1).padStart(5, '0')}`;
}

/** Closing balance = recharges − charges across the whole ledger. */
function currentBalance() {
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN txn_type='RECHARGE' THEN amount ELSE -amount END), 0) bal
    FROM noar_wallet_txns
  `).get();
  return Number(row.bal) || 0;
}

function withRefs(row) {
  if (!row) return row;
  let bilateral_ref = null;
  if (row.bilateral_id) {
    const b = db.prepare('SELECT counterparty, loi_contract_ref FROM bilateral_transactions WHERE id = ?').get(row.bilateral_id);
    if (b) bilateral_ref = b.loi_contract_ref || b.counterparty;
  }
  return { ...row, bilateral_ref };
}

router.get('/', requireRole(...READ), (req, res) => {
  const { txn_type, category, payee, start_date, end_date } = req.query;
  let sql = 'SELECT * FROM noar_wallet_txns WHERE 1=1';
  const params = [];
  if (txn_type) { sql += ' AND txn_type = ?'; params.push(txn_type); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (payee) { sql += ' AND payee = ?'; params.push(payee); }
  if (start_date) {
    if (!DATE_RE.test(start_date)) return res.status(400).json({ error: 'start_date must be YYYY-MM-DD' });
    sql += ' AND txn_date >= ?'; params.push(start_date);
  }
  if (end_date) {
    if (!DATE_RE.test(end_date)) return res.status(400).json({ error: 'end_date must be YYYY-MM-DD' });
    sql += ' AND txn_date <= ?'; params.push(end_date);
  }
  sql += ' ORDER BY txn_date DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withRefs));
});

router.get('/summary', requireRole(...READ), (req, res) => {
  const totRecharge = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM noar_wallet_txns WHERE txn_type='RECHARGE'").get().s;
  const totCharge = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM noar_wallet_txns WHERE txn_type='CHARGE'").get().s;
  const byCat = db.prepare("SELECT category, COALESCE(SUM(amount),0) s FROM noar_wallet_txns WHERE txn_type='CHARGE' GROUP BY category").all();
  const cat = {};
  byCat.forEach((r) => { cat[r.category || 'OTHER'] = Math.round(r.s); });

  const counts = db.prepare(`
    SELECT COUNT(*) total,
           COALESCE(SUM(CASE WHEN txn_type='RECHARGE' THEN 1 ELSE 0 END), 0) recharges,
           COALESCE(SUM(CASE WHEN txn_type='CHARGE' THEN 1 ELSE 0 END), 0) charges
    FROM noar_wallet_txns
  `).get();
  const last = db.prepare('SELECT txn_date, txn_type, amount FROM noar_wallet_txns ORDER BY txn_date DESC, created_at DESC LIMIT 1').get();
  const balance = Math.round(currentBalance());

  // Burn rate over the last 90 days tells PT & BD roughly how long the wallet lasts.
  const burn = db.prepare(`
    SELECT COALESCE(SUM(amount),0) s FROM noar_wallet_txns
    WHERE txn_type='CHARGE' AND txn_date >= date('now','-90 day')
  `).get().s;
  const monthlyBurn = Math.round(burn / 3);

  res.json({
    balance,
    total_recharged: Math.round(totRecharge),
    total_charges: Math.round(totCharge),
    charges_by_category: cat,
    txn_count: counts.total,
    recharge_count: counts.recharges,
    charge_count: counts.charges,
    last_txn_date: last?.txn_date || null,
    low_balance_threshold: LOW_BALANCE_THRESHOLD,
    is_low_balance: balance < LOW_BALANCE_THRESHOLD,
    monthly_burn: monthlyBurn,
    months_of_cover: monthlyBurn > 0 ? Math.round((balance / monthlyBurn) * 10) / 10 : null,
  });
});

/** Month-wise recharge vs charge with the closing balance carried forward. */
router.get('/trend', requireRole(...READ), (req, res) => {
  const rows = db.prepare(`
    SELECT substr(txn_date, 1, 7) month,
           COALESCE(SUM(CASE WHEN txn_type='RECHARGE' THEN amount ELSE 0 END), 0) recharge,
           COALESCE(SUM(CASE WHEN txn_type='CHARGE' THEN amount ELSE 0 END), 0) charge
    FROM noar_wallet_txns
    GROUP BY month
    ORDER BY month ASC
  `).all();
  let running = 0;
  res.json(rows.map((r) => {
    running += Number(r.recharge) - Number(r.charge);
    return {
      month: r.month,
      recharge: Math.round(r.recharge),
      charge: Math.round(r.charge),
      closing_balance: Math.round(running),
    };
  }));
});

router.get('/:id', requireRole(...READ), (req, res) => {
  const row = db.prepare('SELECT * FROM noar_wallet_txns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Transaction not found' });
  res.json(withRefs(row));
});

router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body;
  const txn_type = b.txn_type === 'CHARGE' ? 'CHARGE' : 'RECHARGE';
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
  if (!b.txn_date || !DATE_RE.test(b.txn_date)) return res.status(400).json({ error: 'txn_date (YYYY-MM-DD) is required' });

  const category = txn_type === 'CHARGE' ? (b.category || 'OTHER') : null;
  if (txn_type === 'CHARGE' && !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
  }
  if (b.bilateral_id) {
    const exists = db.prepare('SELECT id FROM bilateral_transactions WHERE id = ?').get(b.bilateral_id);
    if (!exists) return res.status(400).json({ error: 'bilateral_id not found' });
  }

  const bal = currentBalance();
  if (txn_type === 'CHARGE' && bal - amount < 0) {
    return res.status(400).json({ error: `Insufficient NOAR wallet balance (₹${Math.round(bal).toLocaleString('en-IN')}). Recharge first.` });
  }

  const id = newId('NOAR');
  db.transaction(() => {
    db.prepare(`
      INSERT INTO noar_wallet_txns (id, txn_no, txn_type, category, amount, balance_after, payee, reference,
        txn_date, notes, bilateral_id, client_id, created_by)
      VALUES (@id, @txn_no, @txn_type, @category, @amount, 0, @payee, @reference,
        @txn_date, @notes, @bilateral_id, @client_id, @created_by)
    `).run({
      id,
      txn_no: nextTxnNo(),
      txn_type,
      category,
      amount,
      payee: b.payee || null,
      reference: b.reference || null,
      txn_date: b.txn_date,
      notes: b.notes || null,
      bilateral_id: b.bilateral_id || null,
      client_id: b.client_id || null,
      created_by: req.user.name,
    });
    recomputeBalances();
  })();

  logAudit({ req, user: req.user, action: txn_type, module: 'TRADING', entityType: 'noar_wallet', entityId: id, details: b });
  res.status(201).json(withRefs(db.prepare('SELECT * FROM noar_wallet_txns WHERE id = ?').get(id)));
});

/**
 * Delete a transaction (wrongly-keyed entry) and rebuild the balance chain.
 * Refused when removing a recharge would drive any later balance negative.
 */
router.delete('/:id', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM noar_wallet_txns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Transaction not found' });

  if (row.txn_type === 'RECHARGE' && currentBalance() - Number(row.amount) < 0) {
    return res.status(400).json({ error: 'Removing this recharge would leave the wallet overdrawn. Reverse the dependent charges first.' });
  }

  db.transaction(() => {
    db.prepare('DELETE FROM noar_wallet_txns WHERE id = ?').run(req.params.id);
    recomputeBalances();
  })();

  logAudit({ req, user: req.user, action: 'DELETE', module: 'TRADING', entityType: 'noar_wallet', entityId: req.params.id, beforeValue: row });
  res.json({ ok: true, balance: Math.round(currentBalance()) });
});

export default router;
