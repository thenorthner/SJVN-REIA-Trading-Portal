import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';
import { getParam } from '../mastersService.js';
import {
  withPosition, getTransactions, refreshLot, issuableEnergy, certificatesFor,
  multiplierFor, multiplierTable, issuanceFeePerRec, tradingSessions,
} from '../services/recLedger.js';
import { restateBidFromTransactions } from '../services/recTrading.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.TRADING_ALL, 'COMPLIANCE_AUDITOR'])];
const WRITE = ROLE_GROUPS.TRADING_WRITE;
const STATUSES = ['APPLIED', 'ISSUED', 'LISTED', 'SOLD', 'REDEEMED', 'CANCELLED'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const today = () => new Date().toISOString().slice(0, 10);

router.get('/', requireRole(...READ), (req, res) => {
  const { source, vintage_month, status, technology, position } = req.query;
  let sql = 'SELECT * FROM rec_ledger WHERE 1=1';
  const params = [];
  if (source) { sql += ' AND source = ?'; params.push(source); }
  if (vintage_month) { sql += ' AND vintage_month = ?'; params.push(vintage_month); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (technology) { sql += ' AND technology = ?'; params.push(technology); }
  sql += ' ORDER BY vintage_month DESC, created_at DESC';

  let rows = db.prepare(sql).all(...params).map(withPosition);
  // Position is derived, so it has to be filtered after enrichment.
  if (position) rows = rows.filter((r) => r.position === position);
  res.json(rows);
});

/** Inventory position and realised economics across the portfolio. */
router.get('/summary', requireRole(...READ), (req, res) => {
  const rows = db.prepare("SELECT * FROM rec_ledger WHERE status != 'CANCELLED'").all().map(withPosition);
  const sum = (f) => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0);

  const issued = sum((r) => (r.issuance_date ? r.issued_qty : 0));
  const sold = sum((r) => r.sold_qty);
  const redeemed = sum((r) => r.redeemed_qty);
  const held = sum((r) => r.held_qty);
  const revenue = sum((r) => r.realised_revenue);

  const byTech = {};
  for (const r of rows) {
    const key = r.technology || r.source || 'Unspecified';
    byTech[key] = byTech[key] || { technology: key, issued: 0, held: 0, sold: 0, revenue: 0 };
    byTech[key].issued += r.issued_qty;
    byTech[key].held += r.held_qty;
    byTech[key].sold += r.sold_qty;
    byTech[key].revenue += r.realised_revenue;
  }

  // Ageing buckets on the unsold position — RECs no longer lapse, so the
  // question is how long stock has been waiting for a session, not when it dies.
  const aging = { '0-90': 0, '91-180': 0, '181-365': 0, '365+': 0 };
  for (const r of rows) {
    if (r.held_qty <= 0) continue;
    const d = r.holding_age_days ?? 0;
    if (d <= 90) aging['0-90'] += r.held_qty;
    else if (d <= 180) aging['91-180'] += r.held_qty;
    else if (d <= 365) aging['181-365'] += r.held_qty;
    else aging['365+'] += r.held_qty;
  }

  const lastSale = db.prepare(`
    SELECT rate_per_rec, trade_date, platform FROM rec_transactions
    WHERE txn_type='SALE' ORDER BY trade_date DESC, created_at DESC LIMIT 1
  `).get();

  res.json({
    total_lots: rows.length,
    total_recs: sum((r) => r.issued_qty),
    issued_recs: issued,
    sold_recs: sold,
    redeemed_recs: redeemed,
    held_recs: held,
    pending_recs: sum((r) => (r.position === 'NOT_ISSUED' ? r.applied_qty : 0)),
    rec_revenue: Math.round(revenue),
    profit_from_rec: Math.round(sum((r) => r.profit)),
    held_cost: Math.round(sum((r) => r.held_cost)),
    avg_realisation: sold > 0 ? Math.round((revenue / sold) * 100) / 100 : 0,
    // Marking held stock at the last cleared price is the only defensible
    // valuation now that there is no regulated floor price.
    held_value_at_last_price: lastSale ? Math.round(held * Number(lastSale.rate_per_rec)) : 0,
    last_traded_rate: lastSale?.rate_per_rec ?? null,
    last_traded_date: lastSale?.trade_date ?? null,
    by_technology: Object.values(byTech).sort((a, b) => b.issued - a.issued),
    aging,
    next_sessions: tradingSessions(today(), 3),
  });
});

/** Certificate multipliers and the issuance-cost default, for the UI. */
router.get('/reference', requireRole(...READ), (req, res) => {
  res.json({
    multipliers: multiplierTable(),
    issuance_fee_per_rec: issuanceFeePerRec(),
    next_sessions: tradingSessions(today(), 6),
    // Regulatory price bands per certificate. The bidding screen hard-coded a
    // single 0-2500 range for RECs and applied nothing at all to ESCerts, whose
    // bands are set separately by BEE.
    price_bands: getParam('certificate_price_bands', { REC: {}, ESCERT: {} }),
  });
});

/** Validated injection not yet converted into certificates. */
router.get('/issuable', requireRole(...READ), (req, res) => {
  res.json(issuableEnergy(req.query.vintage_month));
});

router.get('/:id', requireRole(...READ), (req, res) => {
  const row = db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'REC lot not found' });
  res.json({ ...withPosition(row), transactions: getTransactions(row.id) });
});

router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body;
  if (!b.vintage_month) return res.status(400).json({ error: 'vintage_month (YYYY-MM) is required' });

  const technology = b.technology || b.source || null;
  const multiplier = b.certificate_multiplier != null ? Number(b.certificate_multiplier) : multiplierFor(technology);
  const energyMwh = b.energy_mwh != null ? Number(b.energy_mwh) : null;

  // Quantity follows from injected energy × multiplier whenever the energy is
  // known, so the lot can't drift away from what was actually injected.
  const quantity = energyMwh > 0
    ? certificatesFor(energyMwh, technology)
    : parseInt(b.quantity, 10);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Provide either energy_mwh or a positive quantity of RECs' });
  }

  const status = STATUSES.includes(b.status) ? b.status : 'APPLIED';
  if (status !== 'APPLIED' && !b.issuance_date) {
    return res.status(400).json({ error: 'issuance_date is required once the lot is issued' });
  }

  const id = newId('REC');
  const seq = (db.prepare('SELECT COUNT(*) c FROM rec_ledger').get().c || 0) + 1;
  const rec_no = b.rec_no
    || `REC/${String(technology || 'GEN').replace(/[^A-Za-z0-9]+/g, '').toUpperCase()}/${b.vintage_month}/${String(seq).padStart(4, '0')}`;

  db.prepare(`
    INSERT INTO rec_ledger (id, rec_no, source, technology, certificate_multiplier, energy_mwh, contract_id,
      vintage_month, quantity, status, application_date, issuance_date, registry_ref,
      issue_cost_per_rec, sale_rate_per_rec, sale_amount, notes, created_by)
    VALUES (@id, @rec_no, @source, @technology, @certificate_multiplier, @energy_mwh, @contract_id,
      @vintage_month, @quantity, @status, @application_date, @issuance_date, @registry_ref,
      @issue_cost_per_rec, 0, 0, @notes, @created_by)
  `).run({
    id, rec_no,
    source: b.source || null,
    technology,
    certificate_multiplier: multiplier,
    energy_mwh: energyMwh,
    contract_id: b.contract_id || null,
    vintage_month: b.vintage_month,
    quantity,
    status,
    application_date: b.application_date || null,
    issuance_date: b.issuance_date || null,
    registry_ref: b.registry_ref || null,
    issue_cost_per_rec: b.issue_cost_per_rec != null ? Number(b.issue_cost_per_rec) : issuanceFeePerRec(),
    notes: b.notes || null,
    created_by: req.user.name,
  });

  logAudit({ req, user: req.user, action: 'CREATE', module: 'TRADING', entityType: 'rec_lot', entityId: id, details: b });
  res.status(201).json({ ...withPosition(db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(id)), transactions: [] });
});

/** Record the Central Agency's issuance against an applied lot. */
router.post('/:id/issue', requireRole(...WRITE), (req, res) => {
  const lot = db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(req.params.id);
  if (!lot) return res.status(404).json({ error: 'REC lot not found' });
  if (lot.status === 'CANCELLED') return res.status(409).json({ error: 'This lot is cancelled.' });
  if (lot.issuance_date) return res.status(409).json({ error: 'This lot has already been issued.' });

  const b = req.body;
  const issuance_date = b.issuance_date || today();
  if (!DATE_RE.test(issuance_date)) return res.status(400).json({ error: 'issuance_date must be YYYY-MM-DD' });

  // The Central Agency can issue fewer certificates than applied for when the
  // SLDC injection report differs from the entity's claim.
  const quantity = b.quantity != null ? parseInt(b.quantity, 10) : lot.quantity;
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Issued quantity must be positive' });

  db.prepare(`
    UPDATE rec_ledger SET status='ISSUED', issuance_date=?, quantity=?, registry_ref=?,
      issue_cost_per_rec=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    issuance_date, quantity, b.registry_ref || lot.registry_ref,
    b.issue_cost_per_rec != null ? Number(b.issue_cost_per_rec) : lot.issue_cost_per_rec,
    lot.id,
  );

  logAudit({ req, user: req.user, action: 'ISSUE', module: 'TRADING', entityType: 'rec_lot', entityId: lot.id, details: b });
  res.json({ ...refreshLot(lot.id), transactions: getTransactions(lot.id) });
});

/** Record a sale tranche or an RPO redemption against the held position. */
router.post('/:id/transactions', requireRole(...WRITE), (req, res) => {
  const lot = db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(req.params.id);
  if (!lot) return res.status(404).json({ error: 'REC lot not found' });
  if (lot.status === 'CANCELLED') return res.status(409).json({ error: 'This lot is cancelled.' });
  if (!lot.issuance_date) return res.status(409).json({ error: 'Certificates must be issued before they can be sold or redeemed.' });

  const b = req.body;
  const txn_type = b.txn_type === 'REDEMPTION' ? 'REDEMPTION' : 'SALE';
  const quantity = parseInt(b.quantity, 10);
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'quantity must be a positive number of RECs' });
  if (!b.trade_date || !DATE_RE.test(b.trade_date)) return res.status(400).json({ error: 'trade_date (YYYY-MM-DD) is required' });

  const position = withPosition(lot);
  if (quantity > position.held_qty) {
    return res.status(400).json({ error: `Only ${position.held_qty} REC(s) are held on this lot; cannot dispose of ${quantity}.` });
  }

  const rate = txn_type === 'SALE' ? Number(b.rate_per_rec) || 0 : 0;
  if (txn_type === 'SALE' && rate <= 0) return res.status(400).json({ error: 'rate_per_rec must be greater than zero for a sale' });

  const id = newId('RECT');
  const seq = (db.prepare('SELECT COUNT(*) c FROM rec_transactions').get().c || 0) + 1;

  db.prepare(`
    INSERT INTO rec_transactions (id, lot_id, txn_no, txn_type, quantity, rate_per_rec, amount,
      trade_date, platform, buyer, obligated_entity, reference, notes, created_by)
    VALUES (@id, @lot_id, @txn_no, @txn_type, @quantity, @rate_per_rec, @amount,
      @trade_date, @platform, @buyer, @obligated_entity, @reference, @notes, @created_by)
  `).run({
    id, lot_id: lot.id,
    txn_no: `RECT/${String(seq).padStart(5, '0')}`,
    txn_type, quantity, rate_per_rec: rate,
    amount: Math.round(quantity * rate),
    trade_date: b.trade_date,
    platform: txn_type === 'SALE' ? (b.platform || null) : null,
    buyer: txn_type === 'SALE' ? (b.buyer || null) : null,
    obligated_entity: txn_type === 'REDEMPTION' ? (b.obligated_entity || null) : null,
    reference: b.reference || null,
    notes: b.notes || null,
    created_by: req.user.name,
  });

  logAudit({ req, user: req.user, action: txn_type, module: 'TRADING', entityType: 'rec_lot', entityId: lot.id, details: b });
  res.status(201).json({ ...refreshLot(lot.id), transactions: getTransactions(lot.id) });
});

/**
 * Reverse a REC sale or redemption by booking the offsetting entry.
 *
 * Posted as the same txn_type with negative quantity and amount, so every
 * SUM-based position and revenue figure nets out without special-casing —
 * and the certificates that actually moved stay on the record, which a
 * registry reconciliation needs.
 */
router.post('/transactions/:txnId/reverse', requireRole(...WRITE), (req, res) => {
  const txn = db.prepare('SELECT * FROM rec_transactions WHERE id = ?').get(req.params.txnId);
  if (!txn) return res.status(404).json({ error: 'REC transaction not found' });
  if (txn.reverses_txn_id) return res.status(400).json({ error: 'A reversal cannot itself be reversed' });

  const already = db.prepare('SELECT id FROM rec_transactions WHERE reverses_txn_id = ?').get(txn.id);
  if (already) return res.status(409).json({ error: `Already reversed by ${already.id}` });

  const id = newId('RECTXN');
  db.prepare(`
    INSERT INTO rec_transactions (id, lot_id, txn_no, txn_type, quantity, rate_per_rec, amount,
      trade_date, platform, buyer, obligated_entity, reference, notes, created_by, reverses_txn_id, bid_id)
    VALUES (@id, @lot_id, @txn_no, @txn_type, @quantity, @rate_per_rec, @amount,
      @trade_date, @platform, @buyer, @obligated_entity, @reference, @notes, @created_by, @reverses_txn_id, @bid_id)
  `).run({
    id,
    lot_id: txn.lot_id,
    // The reversal belongs to the same bid as the tranche it undoes, so the two
    // net out when the bid is restated. Without it the negative entry is
    // invisible to the restatement and the bid keeps reporting the full sale.
    bid_id: txn.bid_id || null,
    txn_no: `${txn.txn_no}-REV`,
    txn_type: txn.txn_type,
    quantity: -Number(txn.quantity || 0),
    rate_per_rec: txn.rate_per_rec,
    amount: -Number(txn.amount || 0),
    trade_date: new Date().toISOString().slice(0, 10),
    platform: txn.platform || null,
    buyer: txn.buyer || null,
    obligated_entity: txn.obligated_entity || null,
    reference: txn.reference || null,
    notes: `Reversal of ${txn.txn_no}${req.body?.reason ? ` — ${req.body.reason}` : ''}`,
    created_by: req.user.name,
    reverses_txn_id: txn.id,
  });

  // A tranche booked by an exchange execution carries the bid it came from, so
  // reversing it has to restate that bid and the REC order it settled into —
  // otherwise the revenue register keeps reporting a sale that was undone.
  const restated = txn.bid_id ? restateBidFromTransactions(txn.bid_id) : null;

  logAudit({ req, user: req.user, action: 'REVERSE_TXN', module: 'TRADING', entityType: 'rec_lot', entityId: txn.lot_id, details: { reversal_id: id, reversed: txn.id, reason: req.body?.reason, restated } });
  res.status(201).json({ ...refreshLot(txn.lot_id), transactions: getTransactions(txn.lot_id), restated });
});

router.put('/:id', requireRole(...WRITE), (req, res) => {
  const lot = db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(req.params.id);
  if (!lot) return res.status(404).json({ error: 'REC lot not found' });

  const b = req.body;
  const position = withPosition(lot);
  const quantity = b.quantity != null ? parseInt(b.quantity, 10) : lot.quantity;
  // Shrinking a lot below what has already left it would corrupt the position.
  if (quantity < position.sold_qty + position.redeemed_qty) {
    return res.status(400).json({
      error: `Quantity cannot be less than the ${position.sold_qty + position.redeemed_qty} REC(s) already sold or redeemed.`,
    });
  }

  const technology = b.technology ?? lot.technology;
  db.prepare(`
    UPDATE rec_ledger SET source=?, technology=?, certificate_multiplier=?, energy_mwh=?, contract_id=?,
      vintage_month=?, quantity=?, application_date=?, issuance_date=?, registry_ref=?,
      issue_cost_per_rec=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    b.source ?? lot.source, technology,
    b.certificate_multiplier != null ? Number(b.certificate_multiplier) : multiplierFor(technology),
    b.energy_mwh != null ? Number(b.energy_mwh) : lot.energy_mwh,
    b.contract_id ?? lot.contract_id,
    b.vintage_month ?? lot.vintage_month, quantity,
    b.application_date ?? lot.application_date, b.issuance_date ?? lot.issuance_date,
    b.registry_ref ?? lot.registry_ref,
    b.issue_cost_per_rec != null ? Number(b.issue_cost_per_rec) : lot.issue_cost_per_rec,
    b.notes ?? lot.notes, lot.id,
  );

  logAudit({ req, user: req.user, action: 'UPDATE', module: 'TRADING', entityType: 'rec_lot', entityId: lot.id, details: b });
  res.json({ ...refreshLot(lot.id), transactions: getTransactions(lot.id) });
});

router.delete('/:id', requireRole(...WRITE), (req, res) => {
  const lot = db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(req.params.id);
  if (!lot) return res.status(404).json({ error: 'REC lot not found' });

  const position = withPosition(lot);
  if (position.sold_qty > 0 || position.redeemed_qty > 0) {
    return res.status(409).json({ error: 'Certificates from this lot have already been sold or redeemed — it cannot be cancelled.' });
  }

  db.prepare("UPDATE rec_ledger SET status='CANCELLED', updated_at=datetime('now') WHERE id=?").run(lot.id);
  logAudit({ req, user: req.user, action: 'CANCEL', module: 'TRADING', entityType: 'rec_lot', entityId: lot.id });
  res.json({ ok: true });
});

export default router;
