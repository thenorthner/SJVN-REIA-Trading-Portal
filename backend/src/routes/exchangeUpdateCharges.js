import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';

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

/** Default load rates (ISET-style placeholders) when master has nothing. */
const DEFAULT_LOAD = {
  'ISTS Transmission Charges': { seller: { qty: 0, rate: 0 }, buyer: { qty: 1, rate: 450 } },
  'State Transmission Charges': { seller: { qty: 1, rate: 238.4 }, buyer: { qty: 1, rate: 382.54 } },
  'Distribution Wheeling Charges': { seller: { qty: 0, rate: 0 }, buyer: { qty: 0, rate: 0 } },
  'RLDC Operating Charges': { seller: { qty: 0, rate: 0 }, buyer: { qty: 1, rate: 1000 } },
  'State Operating Charges': { seller: { qty: 1, rate: 1000 }, buyer: { qty: 1, rate: 1000 } },
  'DIS Operating Charges': { seller: { qty: 0, rate: 0 }, buyer: { qty: 0, rate: 0 } },
  'NOAR Application Fees': { seller: { qty: 0, rate: 0 }, buyer: { qty: 1, rate: 5000 } },
  'SLDC Application Fees': { seller: { qty: 1, rate: 2000 }, buyer: { qty: 0, rate: 0 } },
  'SLDC Consent Fees': { seller: { qty: 0, rate: 0 }, buyer: { qty: 1, rate: 5000 } },
};

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

function buildLoadedCharges(source = 'DEFAULT') {
  return CHARGE_HEADS.map((head) => {
    const def = DEFAULT_LOAD[head] || { seller: { qty: 0, rate: 0 }, buyer: { qty: 0, rate: 0 } };
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
      applicable_date: new Date().toISOString().slice(0, 10),
      trader: 0,
      source,
    };
  });
}

router.get('/meta', requireRole(...ROLE_GROUPS.TRADING_ALL), (_req, res) => {
  res.json({ charge_heads: CHARGE_HEADS });
});

/** Lookup NOAR / application context for the Update Charges header. */
router.get('/lookup', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const applicationId = String(req.query.application_id || '').trim();
  if (!applicationId) return res.status(400).json({ error: 'application_id is required' });

  const app = db.prepare('SELECT * FROM exchange_applications WHERE application_id = ?').get(applicationId);
  const contract = db.prepare(`
    SELECT * FROM exchange_contracts
    WHERE loa_no = ? OR ppa_no = ? OR id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(applicationId, applicationId, applicationId);

  const bilateral = db.prepare(`
    SELECT * FROM bilateral_transactions
    WHERE noar_application_no = ? OR noar_contract_no = ? OR loi_contract_ref = ? OR id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(applicationId, applicationId, applicationId, applicationId);

  const saved = db.prepare(`
    SELECT * FROM exchange_charge_updates WHERE application_id = ? ORDER BY updated_at DESC LIMIT 1
  `).get(applicationId);

  let meta = {
    application_id: applicationId,
    application_date: app?.application_date || contract?.created_at || '',
    applicant_name: app?.portfolio_id || contract?.client_name || '',
    seller_name: contract?.side === 'Seller' ? contract?.client_name : (bilateral?.counterparty || ''),
    sell_side_contract: contract?.side === 'Seller' ? (contract?.loa_no || '') : (bilateral?.loi_contract_ref || ''),
    buyer_name: contract?.side === 'Buyer' ? contract?.client_name : '',
    purchase_side_contract: contract?.side === 'Buyer' ? (contract?.loa_no || '') : '',
    from_date: contract?.start_date || bilateral?.start_date || '',
    to_date: contract?.end_date || bilateral?.end_date || '',
    noar_approval_id: bilateral?.noar_contract_no || '',
    sldc_approval_id: '',
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

  if (!app && !contract && !bilateral && !saved) {
    return res.json({ ...meta, found: false, charges: CHARGE_HEADS.map(emptyChargeRow) });
  }
  res.json({
    ...meta,
    found: true,
    charges: meta.charges || CHARGE_HEADS.map(emptyChargeRow),
  });
});

router.get('/load', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const source = String(req.query.source || 'DEFAULT').toUpperCase() === 'NOAR' ? 'NOAR' : 'DEFAULT';
  // NOAR vs default currently share the same rate pack; NOAR path is tagged for audit UX.
  res.json({ source, charges: buildLoadedCharges(source) });
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
