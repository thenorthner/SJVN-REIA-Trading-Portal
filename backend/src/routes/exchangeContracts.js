import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import {
  computeExchangeSettlement,
  buildExchangeInvoice,
  refreshExchangeContractStatus,
  bidsForContract,
  EXCHANGE_BILL_TYPES,
} from '../services/exchangeSettlement.js';
import { raiseInvoice, billingObjection } from '../services/billingRegister.js';

const router = Router();
router.use(requireAuth);

function parseSchedule(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function withDetails(row) {
  if (!row) return row;
  return {
    ...row,
    schedule_details: parseSchedule(row.schedule_json),
  };
}

function validateBody(b, { partial = false } = {}) {
  const errors = [];
  const need = (cond, msg) => { if (cond) errors.push(msg); };

  if (!partial || b.start_date !== undefined) need(!b.start_date, 'start_date is required');
  if (!partial || b.end_date !== undefined) need(!b.end_date, 'end_date is required');
  if (b.start_date && b.end_date && b.end_date < b.start_date) {
    errors.push('end_date cannot be before start_date');
  }

  const side = b.side || b.buyer_seller;
  if (!partial || b.side !== undefined || b.buyer_seller !== undefined) {
    need(!['Buyer', 'Seller'].includes(side), 'side must be Buyer or Seller');
  }

  const carryOver = b.carry_over ?? 'No';
  if (!partial || b.carry_over !== undefined) {
    need(!['Yes', 'No'].includes(carryOver), 'carry_over must be Yes or No');
  }

  const isRenewable = b.is_renewable ?? 'No';
  if (!partial || b.is_renewable !== undefined) {
    need(!['Yes', 'No'].includes(isRenewable), 'is_renewable must be Yes or No');
  }

  if (!partial || b.portfolio_id !== undefined) need(!String(b.portfolio_id || '').trim(), 'portfolio_id is required');
  if (!partial || b.loa_no !== undefined) need(!String(b.loa_no || '').trim(), 'loa_no is required');
  if (!partial || b.client_name !== undefined || b.client_id !== undefined) {
    need(!String(b.client_name || b.client_id || '').trim(), 'client_name is required');
  }
  if (!partial || b.product !== undefined) need(!String(b.product || '').trim(), 'product is required');
  if (!partial || b.bidding_type !== undefined) need(!String(b.bidding_type || '').trim(), 'bidding_type is required');
  if (!partial || b.billing_type !== undefined) need(!String(b.billing_type || '').trim(), 'billing_type is required');

  const schedule = Array.isArray(b.schedule_details) ? b.schedule_details
    : (Array.isArray(b.order_details) ? b.order_details : null);
  if (!partial || schedule !== null) {
    const rows = schedule || [];
    need(!rows.length, 'at least one schedule row is required');
    for (const [i, row] of rows.entries()) {
      if (!row.date_from || !row.date_to) errors.push(`schedule row ${i + 1}: date from/to required`);
      if (!row.time_from || !row.time_to) errors.push(`schedule row ${i + 1}: hours from/to required`);
      if (row.rate === '' || row.rate == null || !Number.isFinite(Number(row.rate))) {
        errors.push(`schedule row ${i + 1}: rate is required`);
      }
      if (row.quantum === '' || row.quantum == null || !Number.isFinite(Number(row.quantum)) || Number(row.quantum) <= 0) {
        errors.push(`schedule row ${i + 1}: quantum must be a positive number`);
      }
    }
  }

  if (b.client_id && !db.prepare('SELECT 1 FROM trading_clients WHERE id = ?').get(b.client_id)) {
    errors.push('client_id does not exist');
  }

  return {
    errors,
    side,
    carryOver,
    isRenewable,
    schedule: schedule || [],
  };
}

function resolveClient(b) {
  let clientName = String(b.client_name || '').trim();
  let sldc = b.concerned_sldc || null;
  let region = b.region || null;
  if (b.client_id) {
    const client = db.prepare('SELECT name, sldc_name FROM trading_clients WHERE id = ?').get(b.client_id);
    if (client) {
      if (!clientName) clientName = client.name;
      if (!sldc) sldc = client.sldc_name || null;
    }
  }
  return { clientName, sldc, region };
}

function numOrNull(v) {
  return v !== '' && v != null ? Number(v) : null;
}

router.get('/', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { status, client_id, q } = req.query;
  let sql = 'SELECT * FROM exchange_contracts WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (client_id) { sql += ' AND client_id = ?'; params.push(client_id); }
  if (q) {
    sql += ` AND (
      loa_no LIKE ? OR ppa_no LIKE ? OR client_name LIKE ? OR portfolio_id LIKE ? OR id LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withDetails));
});

router.get('/:id', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const row = db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(withDetails(row));
});

router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const { errors, side, carryOver, isRenewable, schedule } = validateBody(b);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const { clientName, sldc, region } = resolveClient(b);
  const id = newId('EXC');
  // A new agreement opens at DRAFT and is moved to ACTIVE by the first bid that
  // goes live under it (see refreshExchangeContractStatus). Creating it ACTIVE
  // made the column say nothing — every contract read ACTIVE from the moment it
  // was typed in, whether or not it was ever traded.
  db.prepare(`
    INSERT INTO exchange_contracts (
      id, contract_type, portfolio_id, loa_no, ppa_no, start_date, end_date,
      compensation, late_payment_surcharge, rebate,
      side, carry_over, client_id, client_name, concerned_sldc, region,
      product, bidding_type, is_renewable, billing_type,
      bank_guarantee, bank_guarantee_validity, client_registration_fee,
      trading_margin, application_fee, remarks, schedule_json, status, created_by
    ) VALUES (
      ?, 'Exchange', ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, 'DRAFT', ?
    )
  `).run(
    id,
    String(b.portfolio_id).trim(),
    String(b.loa_no).trim(),
    b.ppa_no ? String(b.ppa_no).trim() : null,
    b.start_date,
    b.end_date,
    numOrNull(b.compensation),
    numOrNull(b.late_payment_surcharge),
    numOrNull(b.rebate),
    side,
    carryOver,
    b.client_id || null,
    clientName,
    sldc,
    region,
    String(b.product).trim(),
    String(b.bidding_type).trim(),
    isRenewable,
    String(b.billing_type).trim(),
    numOrNull(b.bank_guarantee),
    b.bank_guarantee_validity || null,
    numOrNull(b.client_registration_fee),
    numOrNull(b.trading_margin),
    numOrNull(b.application_fee),
    b.remarks ? String(b.remarks).trim() : null,
    JSON.stringify(schedule),
    req.user?.id || null,
  );

  secureLogAudit(req, {
    action: 'CREATE_EXCHANGE_CONTRACT',
    module: 'TRADING',
    entityType: 'exchange_contract',
    entityId: id,
    details: { portfolio_id: b.portfolio_id, product: b.product, side },
  });

  res.status(201).json(withDetails(db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(id)));
});

router.put('/:id', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const b = { ...existing, ...req.body, schedule_details: req.body?.schedule_details ?? req.body?.order_details ?? parseSchedule(existing.schedule_json) };
  // Prefer explicit body fields over merged schedule from JSON when body sent schedule.
  if (Array.isArray(req.body?.schedule_details)) b.schedule_details = req.body.schedule_details;
  else if (Array.isArray(req.body?.order_details)) b.schedule_details = req.body.order_details;

  const { errors, side, carryOver, isRenewable, schedule } = validateBody(b);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const { clientName, sldc, region } = resolveClient(b);

  db.prepare(`
    UPDATE exchange_contracts SET
      portfolio_id = ?, loa_no = ?, ppa_no = ?, start_date = ?, end_date = ?,
      compensation = ?, late_payment_surcharge = ?, rebate = ?,
      side = ?, carry_over = ?, client_id = ?, client_name = ?, concerned_sldc = ?, region = ?,
      product = ?, bidding_type = ?, is_renewable = ?, billing_type = ?,
      bank_guarantee = ?, bank_guarantee_validity = ?, client_registration_fee = ?,
      trading_margin = ?, application_fee = ?, remarks = ?, schedule_json = ?
    WHERE id = ?
  `).run(
    String(b.portfolio_id).trim(),
    String(b.loa_no).trim(),
    b.ppa_no ? String(b.ppa_no).trim() : null,
    b.start_date,
    b.end_date,
    numOrNull(b.compensation),
    numOrNull(b.late_payment_surcharge),
    numOrNull(b.rebate),
    side,
    carryOver,
    b.client_id || null,
    clientName,
    sldc,
    region,
    String(b.product).trim(),
    String(b.bidding_type).trim(),
    isRenewable,
    String(b.billing_type).trim(),
    numOrNull(b.bank_guarantee),
    b.bank_guarantee_validity || null,
    numOrNull(b.client_registration_fee),
    numOrNull(b.trading_margin),
    numOrNull(b.application_fee),
    b.remarks ? String(b.remarks).trim() : null,
    JSON.stringify(schedule),
    req.params.id,
  );

  secureLogAudit(req, {
    action: 'UPDATE_EXCHANGE_CONTRACT',
    module: 'TRADING',
    entityType: 'exchange_contract',
    entityId: req.params.id,
    details: { portfolio_id: b.portfolio_id, product: b.product, side },
  });

  res.json(withDetails(db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(req.params.id)));
});

/* ─────────── Settlement and billing ───────────
 *
 * The desk's last two steps on the exchange side: settle what the market
 * actually cleared for a supply period, then raise the bills for it. Both read
 * the same computation, so the preview and the invoice cannot disagree.
 */

/** The cleared bids this contract settles against. */
router.get('/:id/bids', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const contract = db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Not found' });
  res.json(bidsForContract(contract, req.query.from || null, req.query.to || null));
});

/** Settled position for a supply period — preview only, writes nothing. */
router.get('/:id/settlement', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { from, to, bill_type } = req.query;
  try {
    if (bill_type) {
      if (!EXCHANGE_BILL_TYPES.includes(bill_type)) {
        return res.status(400).json({ error: `bill_type must be one of: ${EXCHANGE_BILL_TYPES.join(', ')}` });
      }
      return res.json(buildExchangeInvoice({
        contract_id: req.params.id,
        bill_type,
        from: from || null,
        to: to || null,
        options: { gst_applicable: req.query.gst_applicable === 'true', bearer: req.query.bearer },
      }));
    }
    res.json(computeExchangeSettlement({ contract_id: req.params.id, from: from || null, to: to || null }));
  } catch (err) {
    res.status(/not found/i.test(err.message) ? 404 : 400).json({ error: err.message });
  }
});

/** Bills already raised against this contract. */
router.get('/:id/invoices', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const contract = db.prepare('SELECT id FROM exchange_contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Not found' });
  res.json(db.prepare(`
    SELECT * FROM view_bill_invoices
    WHERE exchange_contract_id = ? AND status != 'CANCELLED'
    ORDER BY invoice_date DESC, invoice_no DESC
  `).all(contract.id));
});

/**
 * Raise an exchange bill into the View Bills register.
 *
 * The register was previously written only by its seed, so the ISET exchange
 * invoice screens showed samples no live trade had produced. A bill raised here
 * carries its cleared quantum, the price the market cleared at, and the
 * itemised breakup back to the bid blocks behind it.
 */
router.post('/:id/invoices', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const contract = db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Not found' });

  if (!EXCHANGE_BILL_TYPES.includes(b.bill_type)) {
    return res.status(400).json({ error: `bill_type must be one of: ${EXCHANGE_BILL_TYPES.join(', ')}` });
  }
  if (b.from && b.to && b.to < b.from) {
    return res.status(400).json({ error: 'to cannot be before from' });
  }
  // A cancelled agreement is not billable.
  if (contract.status === 'CANCELLED') {
    return res.status(400).json({ error: 'This contract is CANCELLED and cannot be billed' });
  }

  let priced;
  try {
    priced = buildExchangeInvoice({
      contract_id: contract.id,
      bill_type: b.bill_type,
      from: b.from || null,
      to: b.to || null,
      options: {
        gst_applicable: b.gst_applicable,
        tds_rate: b.tds_rate,
        bearer: b.bearer,
        client_name: b.client_name,
        injection_state: b.injection_state,
        drawal_state: b.drawal_state,
        ists_rate: b.ists_rate,
      },
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const objection = billingObjection(priced, { allow_zero_volume: b.allow_zero_volume });
  if (objection) return res.status(400).json(objection);

  const invoice = raiseInvoice({
    bill_type: b.bill_type,
    priced,
    exchange_contract_id: contract.id,
    client_id: contract.client_id,
    client_code: b.client_code,
    invoice_date: b.invoice_date,
    credit_days: b.credit_days,
    remarks: b.remarks,
  });

  // A cleared market result is final by nature — unlike a bilateral schedule
  // there is no later meter reading to restate it.
  refreshExchangeContractStatus(contract.id);

  secureLogAudit(req, {
    action: 'GENERATE_EXCHANGE_INVOICE',
    module: 'TRADING',
    entityType: 'view_bill_invoice',
    entityId: invoice.id,
    details: {
      exchange_contract_id: contract.id,
      bill_type: b.bill_type,
      invoice_no: invoice.invoice_no,
      invoice_amount: invoice.invoice_amount,
      quantum_mwh: invoice.quantum_mwh,
    },
  });

  res.status(201).json({ ...invoice, line_items: priced.line_items, warnings: priced.warnings });
});

export default router;
