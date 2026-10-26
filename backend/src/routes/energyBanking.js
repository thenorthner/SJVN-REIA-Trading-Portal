import { Router } from 'express';
import { requireAuth, requireRole, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import db from '../db/index.js';
import {
  newDoc, header, kpiBand, sectionTitle, table, notes as footNotes, pageNumbers, M, CONTENT_W, INK, MUTED, nowLabel,
} from '../scripts/reportPdfKit.js';
import { logAudit } from '../util.js';
import { bankEnergy, drawBanked, settleExpiredBanking, bankedPosition } from '../services/energyBanking.js';

const router = Router();
router.use(requireAuth);

const BANK_READ = [...ROLE_GROUPS.REIA_ALL];
// Phase B.2: the maker banks and draws energy; settling a closed cycle is the checker's.
const BANK_WRITE = [...ROLE_GROUPS.REIA_MAKE];
const BANK_SETTLE = [...ROLE_GROUPS.REIA_CHECK];

// The developer's banking statement for a PPA (SM3): per cycle, what was
// banked, drawn back, settled in money and lapsed, and what is still in the
// bank. SJVN's desks read any contract; a seller reads only its own.
export function bankingStatement(contractId) {
  const contract = db.prepare(`SELECT c.*, s.name AS seller_name, s.pan_no, s.gst_no FROM contracts c
    LEFT JOIN entities s ON s.id = c.seller_id WHERE c.id = ?`).get(contractId);
  if (!contract) throw Object.assign(new Error('Contract not found'), { status: 404 });
  const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
  const cycles = db.prepare(`
    SELECT cycle, MAX(cycle_ends_on) AS cycle_ends_on,
           SUM(banked_mwh) AS banked, SUM(drawn_mwh) AS drawn, SUM(settled_mwh) AS settled, SUM(settlement_amount) AS amount,
           SUM(CASE WHEN status IN ('OPEN','DRAWN') THEN banked_mwh - drawn_mwh ELSE 0 END) AS balance,
           SUM(CASE WHEN status IN ('SETTLED','EXPIRED') THEN MAX(banked_mwh - drawn_mwh - settled_mwh, 0) ELSE 0 END) AS lapsed,
           (SELECT GROUP_CONCAT(DISTINCT i.invoice_no) FROM energy_banking b2 JOIN invoices i ON i.id = b2.settlement_invoice_id
             WHERE b2.contract_id = energy_banking.contract_id AND b2.cycle = energy_banking.cycle) AS settlement_invoice_no
    FROM energy_banking WHERE contract_id = ? GROUP BY cycle ORDER BY cycle_ends_on
  `).all(contractId).map((c) => ({
    cycle: c.cycle, cycle_ends_on: c.cycle_ends_on, banked_mwh: r3(c.banked), drawn_mwh: r3(c.drawn), settled_mwh: r3(c.settled),
    lapsed_mwh: r3(c.lapsed), balance_mwh: r3(c.balance), settled_amount: Math.round((Number(c.amount) || 0) * 100) / 100,
    settlement_invoice_no: c.settlement_invoice_no || null,
  }));
  const months = db.prepare(`SELECT period_month, cycle, banked_mwh, drawn_mwh, status FROM energy_banking
    WHERE contract_id = ? ORDER BY period_month, created_at`).all(contractId);
  const sum = (k) => r3(cycles.reduce((t, c) => t + c[k], 0));
  return {
    contract: { id: contract.id, contract_no: contract.contract_no, seller_id: contract.seller_id, seller_name: contract.seller_name, pan_no: contract.pan_no, gst_no: contract.gst_no },
    cycles, months,
    totals: { banked_mwh: sum('banked_mwh'), drawn_mwh: sum('drawn_mwh'), settled_mwh: sum('settled_mwh'), lapsed_mwh: sum('lapsed_mwh'), balance_mwh: sum('balance_mwh'), settled_amount: Math.round(cycles.reduce((t, c) => t + c.settled_amount, 0) * 100) / 100 },
  };
}

function mayReadBanking(user, contract) {
  if (BANK_READ.includes(user?.role)) return true;
  return counterpartySide(user) === 'SELLER' && user.linked_entity_id && user.linked_entity_id === contract.seller_id;
}

router.get('/:contractId/statement', (req, res) => {
  try {
    const st = bankingStatement(req.params.contractId);
    if (!mayReadBanking(req.user, st.contract)) return res.status(403).json({ error: 'Not your contract' });
    res.json(st);
  } catch (err) { res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' }); }
});

router.get('/:contractId/statement.pdf', (req, res) => {
  let st;
  try { st = bankingStatement(req.params.contractId); } catch (err) {
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
  if (!mayReadBanking(req.user, st.contract)) return res.status(403).json({ error: 'Not your contract' });
  const mu = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  const title = 'Energy Banking Statement';
  const ctx = { vertical: 'REIA', title, subtitle: `${st.contract.seller_name || ''}  ·  ${st.contract.contract_no}` };
  const doc = newDoc(res, `${title} — ${st.contract.contract_no}`, `banking-statement-${st.contract.contract_no}.pdf`.replace(/[^\w.-]+/g, '-'));
  header(doc, { ...ctx, generatedAt: nowLabel() });
  let y = 84;
  doc.font('Helvetica').fontSize(8.5);
  for (const [k, v] of [['Developer', st.contract.seller_name || '—'], ['PAN / GSTIN', `${st.contract.pan_no || '—'}  /  ${st.contract.gst_no || '—'}`], ['PPA', st.contract.contract_no], ['Account with', 'SJVN Limited']]) {
    doc.fillColor(MUTED).text(k, M, y, { width: 90 });
    doc.fillColor(INK).text(v, M + 95, y, { width: CONTENT_W - 95 });
    y += 14;
  }
  y = kpiBand(doc, y + 6, [
    { label: 'Banked', value: `${mu(st.totals.banked_mwh)} MWh` },
    { label: 'Drawn back', value: `${mu(st.totals.drawn_mwh)} MWh` },
    { label: 'Settled / lapsed', value: `${mu(st.totals.settled_mwh)} / ${mu(st.totals.lapsed_mwh)} MWh` },
    { label: 'In the bank', value: `${mu(st.totals.balance_mwh)} MWh` },
  ]);
  y = sectionTitle(doc, y, 'By cycle');
  const rest = CONTENT_W - 60 - 60 - 5 * 62;
  y = table(doc, y, [
    { label: 'Cycle', w: 60, value: (r) => r.cycle },
    { label: 'Ends on', w: 60, value: (r) => r.cycle_ends_on },
    { label: 'Banked', w: 62, align: 'right', value: (r) => mu(r.banked_mwh) },
    { label: 'Drawn', w: 62, align: 'right', value: (r) => mu(r.drawn_mwh) },
    { label: 'Settled', w: 62, align: 'right', value: (r) => mu(r.settled_mwh) },
    { label: 'Lapsed', w: 62, align: 'right', value: (r) => mu(r.lapsed_mwh) },
    { label: 'Balance', w: 62, align: 'right', value: (r) => mu(r.balance_mwh) },
    { label: 'Settlement', w: rest, value: (r) => (r.settlement_invoice_no ? `${r.settlement_invoice_no} (Rs ${Number(r.settled_amount).toLocaleString('en-IN')})` : '') },
  ], st.cycles, ctx, { fontSize: 7, rowH: 15 });
  footNotes(doc, y + 10, [
    'Quantities in MWh. Energy left in the bank when its cycle ends is settled in money at the settlement percentage of its tariff; the rest lapses.',
    'Generated from the SJVN portal. It reflects the records as they stood when it was generated and is not a signed confirmation of balance.',
  ]);
  pageNumbers(doc);
  doc.end();
});

// What is still banked for a contract, by cycle.
router.get('/:contractId', requireRole(...BANK_READ), (req, res) => {
  res.json(bankedPosition(req.params.contractId));
});

// Credit energy the buyer could not take to the seller's bank.
router.post('/', requireRole(...BANK_WRITE), (req, res) => {
  try {
    // Named fields only: the service's own clock is not the request's to set.
    const { contract_id, cycle, period_month, banked_mwh, tariff_per_unit, cycle_ends_on } = req.body || {};
    const row = bankEnergy({ contract_id, cycle, period_month, banked_mwh, tariff_per_unit, cycle_ends_on, createdBy: req.user?.id });
    logAudit({ req, user: req.user, action: 'BANK_ENERGY', module: 'REIA', entityType: 'energy_banking', entityId: row.id, details: req.body });
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Draw banked energy back out within the cycle.
router.post('/draw', requireRole(...BANK_WRITE), (req, res) => {
  try {
    const { contract_id, cycle, draw_mwh } = req.body || {};
    const result = drawBanked({ contract_id, cycle, draw_mwh, createdBy: { name: req.user?.name, id: req.user?.id } });
    logAudit({ req, user: req.user, action: 'DRAW_BANKED', module: 'REIA', entityType: 'energy_banking', entityId: req.body.contract_id, details: req.body });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Settle cycles that closed with energy unused. Also runs on a schedule.
// Only a cycle that has actually closed: the sweep took any "as of", so naming
// 2099 cashed out a cycle still running.
router.post('/settle', requireRole(...BANK_SETTLE), (req, res) => {
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const asOf = req.body?.as_of;
  if (asOf !== undefined && asOf !== null && asOf !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(asOf))) return res.status(400).json({ error: 'as_of must be a date (YYYY-MM-DD)' });
    if (String(asOf) > today) return res.status(400).json({ error: `as_of ${asOf} is in the future; only cycles that have closed by today are settled.` });
  }
  const result = settleExpiredBanking(asOf || today);
  logAudit({ req, user: req.user, action: 'SETTLE_BANKING', module: 'REIA', entityType: 'energy_banking', entityId: 'sweep', details: result });
  res.json(result);
});

export default router;
