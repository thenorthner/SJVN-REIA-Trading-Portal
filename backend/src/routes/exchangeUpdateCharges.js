import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { getEffectiveRate } from '../services/rateMaster.js';

const router = Router();
router.use(requireAuth);

const CHARGE_HEADS = [
  'ISTS Transmission Charges',
  'State Transmission Charges',
  'Distribution Wheeling Charges',
  'RLDC Operating Charges',
  'State Operating Charges',
  'DIS Operating Charges',
  'NOAR Application Fees',
  'SLDC Application Fees',
  'SLDC Consent Fees',
];

function emptyChargeRow(head) {
  return {
    charge_head: head,
    seller_qty: 0,
    seller_rate: 0,
    seller_amount: 0,
    buyer_qty: 0,
    buyer_rate: 0,
    buyer_amount: 0,
    applicable_date: '',
    trader: 0,
  };
}

function rateValue(name, onDate) {
  const row = getEffectiveRate(name, onDate);
  const n = row ? Number(row.rate_value) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function charged(qty, rate) {
  const q = rate > 0 ? qty : 0;
  const r = q > 0 ? rate : 0;
  return { qty: q, rate: r };
}

/**
 * Charge pack off the rate master for this corridor. Qty is 1 when a rate
 * exists, 0 otherwise — the desk can still edit before Save. No ISET placeholders.
 */
export function buildLoadedCharges({
  sellerState = null, buyerState = null, onDate = null, source = 'RATE_MASTER',
} = {}) {
  const date = onDate || new Date().toISOString().slice(0, 10);
  const ists = rateValue('ISTS', date);
  const sellerStu = sellerState ? rateValue(`${sellerState} STU`, date) : 0;
  const buyerStu = buyerState ? rateValue(`${buyerState} STU`, date) : 0;
  const sellerSldc = sellerState ? rateValue(`${sellerState} SLDC`, date) : 0;
  const buyerSldc = buyerState ? rateValue(`${buyerState} SLDC`, date) : 0;
  const rldc = rateValue('RLDC Fee', date);
  const noar = rateValue('NOAR Application Fee', date);
  const consent = rateValue('SLDC Consent Fee', date);

  const pack = {
    'ISTS Transmission Charges': { seller: charged(0, 0), buyer: charged(1, ists) },
    'State Transmission Charges': { seller: charged(1, sellerStu), buyer: charged(1, buyerStu) },
    'Distribution Wheeling Charges': { seller: charged(0, 0), buyer: charged(0, 0) },
    'RLDC Operating Charges': { seller: charged(0, 0), buyer: charged(1, rldc) },
    'State Operating Charges': { seller: charged(1, sellerSldc), buyer: charged(1, buyerSldc) },
    'DIS Operating Charges': { seller: charged(0, 0), buyer: charged(0, 0) },
    'NOAR Application Fees': { seller: charged(0, 0), buyer: charged(1, noar) },
    // No separate "SLDC application" head in the master — the state's SLDC
    // operating charge is what the ISET form used to hardcode at ₹2000.
    'SLDC Application Fees': { seller: charged(1, sellerSldc), buyer: charged(0, 0) },
    'SLDC Consent Fees': { seller: charged(0, 0), buyer: charged(1, consent) },
  };

  return CHARGE_HEADS.map((head) => {
    const def = pack[head] || { seller: { qty: 0, rate: 0 }, buyer: { qty: 0, rate: 0 } };
    const seller_qty = def.seller.qty;
    const seller_rate = def.seller.rate;
    const buyer_qty = def.buyer.qty;
    const buyer_rate = def.buyer.rate;
    return {
      charge_head: head,
      seller_qty,
      seller_rate,
      seller_amount: Number((seller_qty * seller_rate).toFixed(2)),
      buyer_qty,
      buyer_rate,
      buyer_amount: Number((buyer_qty * buyer_rate).toFixed(2)),
      applicable_date: date,
      trader: 0,
      source,
    };
  });
}

export function resolveChargeCorridor(applicationId) {
  const app = db.prepare('SELECT * FROM exchange_applications WHERE application_id = ?').get(applicationId);
  const contract = app
    ? db.prepare(`
        SELECT * FROM exchange_contracts
        WHERE id = ? OR portfolio_id = ? OR loa_no = ? OR ppa_no = ?
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at DESC LIMIT 1
      `).get(app.contract_id, app.portfolio_id, applicationId, applicationId, app.contract_id)
    : db.prepare(`
        SELECT * FROM exchange_contracts
        WHERE loa_no = ? OR ppa_no = ? OR id = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(applicationId, applicationId, applicationId);

  const bilateral = db.prepare(`
    SELECT * FROM bilateral_transactions
    WHERE noar_application_no = ? OR noar_contract_no = ? OR loi_contract_ref = ? OR id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(applicationId, applicationId, applicationId, applicationId);

  let sellerState = bilateral?.supplier_sldc || null;
  let buyerState = bilateral?.procurer_sldc || null;
  if (contract?.concerned_sldc) {
    if (contract.side === 'Seller' && !sellerState) sellerState = contract.concerned_sldc;
    if (contract.side === 'Buyer' && !buyerState) buyerState = contract.concerned_sldc;
  }

  const onDate = String(
    app?.application_date || contract?.start_date || bilateral?.start_date || '',
  ).slice(0, 10) || new Date().toISOString().slice(0, 10);

  return { app, contract, bilateral, sellerState, buyerState, onDate };
}

router.get('/meta', requireRole(...ROLE_GROUPS.TRADING_ALL), (_req, res) => {
  res.json({ charge_heads: CHARGE_HEADS });
});

/** Lookup NOAR / application context for the Update Charges header. */
router.get('/lookup', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const applicationId = String(req.query.application_id || '').trim();
  if (!applicationId) return res.status(400).json({ error: 'application_id is required' });

  const { app, contract, bilateral, sellerState, buyerState, onDate } = resolveChargeCorridor(applicationId);

  const saved = db.prepare(`
    SELECT * FROM exchange_charge_updates WHERE application_id = ? ORDER BY updated_at DESC LIMIT 1
  `).get(applicationId);

  let meta = {
    application_id: applicationId,
    application_date: app?.application_date || contract?.created_at || '',
    applicant_name: app?.portfolio_id || contract?.client_name || '',
    seller_name: contract?.side === 'Seller' ? contract?.client_name : (bilateral?.supplier_name || bilateral?.counterparty || ''),
    sell_side_contract: contract?.side === 'Seller' ? (contract?.loa_no || '') : (bilateral?.loi_contract_ref || ''),
    buyer_name: contract?.side === 'Buyer' ? contract?.client_name : (bilateral?.procurer_name || ''),
    purchase_side_contract: contract?.side === 'Buyer' ? (contract?.loa_no || '') : '',
    from_date: contract?.start_date || bilateral?.start_date || '',
    to_date: contract?.end_date || bilateral?.end_date || '',
    noar_approval_id: bilateral?.noar_contract_no || '',
    sldc_approval_id: '',
    seller_state: sellerState,
    buyer_state: buyerState,
  };

  if (saved) {
    try {
      meta = {
        ...meta,
        noar_approval_id: saved.noar_approval_id || meta.noar_approval_id,
        sldc_approval_id: saved.sldc_approval_id || meta.sldc_approval_id,
        application_date: saved.application_date || meta.application_date,
        applicant_name: saved.applicant_name || meta.applicant_name,
        seller_name: saved.seller_name || meta.seller_name,
        sell_side_contract: saved.sell_side_contract || meta.sell_side_contract,
        buyer_name: saved.buyer_name || meta.buyer_name,
        purchase_side_contract: saved.purchase_side_contract || meta.purchase_side_contract,
        from_date: saved.from_date || meta.from_date,
        to_date: saved.to_date || meta.to_date,
        charges: JSON.parse(saved.charges_json || '[]'),
        saved_id: saved.id,
        updated_at: saved.updated_at,
      };
    } catch { /* keep meta */ }
  }

  const found = !!(app || contract || bilateral || saved);
  const charges = meta.charges
    || (found
      ? buildLoadedCharges({ sellerState, buyerState, onDate, source: 'RATE_MASTER' })
      : CHARGE_HEADS.map(emptyChargeRow));

  res.json({ ...meta, found, charges });
});

router.get('/load', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const sourceTag = String(req.query.source || 'DEFAULT').toUpperCase() === 'NOAR' ? 'NOAR' : 'RATE_MASTER';
  const applicationId = String(req.query.application_id || '').trim();
  let sellerState = null;
  let buyerState = null;
  let onDate = new Date().toISOString().slice(0, 10);
  if (applicationId) {
    const ctx = resolveChargeCorridor(applicationId);
    sellerState = ctx.sellerState;
    buyerState = ctx.buyerState;
    onDate = ctx.onDate;
  }
  res.json({
    source: sourceTag,
    seller_state: sellerState,
    buyer_state: buyerState,
    charges: buildLoadedCharges({ sellerState, buyerState, onDate, source: sourceTag }),
  });
});

router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  if (!String(b.application_id || '').trim()) {
    return res.status(400).json({ error: 'application_id is required' });
  }
  const charges = Array.isArray(b.charges) ? b.charges : [];
  if (!charges.length) return res.status(400).json({ error: 'charges are required' });

  const id = newId('XCU');
  db.prepare(`
    INSERT INTO exchange_charge_updates (
      id, application_id, noar_approval_id, sldc_approval_id, application_date,
      applicant_name, seller_name, sell_side_contract, buyer_name, purchase_side_contract,
      from_date, to_date, charges_json, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(b.application_id).trim(),
    b.noar_approval_id || null,
    b.sldc_approval_id || null,
    b.application_date || null,
    b.applicant_name || null,
    b.seller_name || null,
    b.sell_side_contract || null,
    b.buyer_name || null,
    b.purchase_side_contract || null,
    b.from_date || null,
    b.to_date || null,
    JSON.stringify(charges),
    req.user?.id || null,
  );

  secureLogAudit(req, {
    action: 'UPDATE_EXCHANGE_CHARGES',
    module: 'TRADING',
    entityType: 'exchange_charge_update',
    entityId: id,
    details: { application_id: b.application_id },
  });

  res.status(201).json(db.prepare('SELECT * FROM exchange_charge_updates WHERE id = ?').get(id));
});

export default router;
