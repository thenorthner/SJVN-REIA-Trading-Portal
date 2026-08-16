import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import {
  BILL_TYPES, ALL_BILL_TYPES, priceBill, raiseInvoice, billingObjection,
} from '../services/billingRegister.js';

// The Bill section's own API: one client-first way in to all six bills.
//
// Each desk can already raise its own bills from its own contract screen, but
// the Generate Bill screen works the other way round — pick a client, pick what
// to bill them for, and let the platform find the contract and the engine. That
// screen had no backend at all, so it listed hardcoded clients and logged the
// form to the console.

const router = Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The bill types, with what each needs, for the form to build itself from. */
router.get('/meta', requireRole(...ROLE_GROUPS.TRADING_ALL), (_req, res) => {
  res.json({
    bill_types: ALL_BILL_TYPES.map((code) => ({ code, ...BILL_TYPES[code] })),
    contract_kinds: ['BILATERAL', 'EXCHANGE'],
  });
});

/** Every counterparty that holds a contract of either kind. */
router.get('/clients', requireRole(...ROLE_GROUPS.TRADING_ALL), (_req, res) => {
  const rows = db.prepare(`
    SELECT client_name AS name, client_id, 'EXCHANGE' AS kind FROM exchange_contracts
      WHERE client_name IS NOT NULL AND status != 'CANCELLED'
    UNION
    SELECT COALESCE(procurer_name, counterparty) AS name, client_id, 'BILATERAL' AS kind
      FROM bilateral_transactions WHERE status != 'CANCELLED'
  `).all();

  const byName = new Map();
  for (const r of rows) {
    if (!r.name) continue;
    if (!byName.has(r.name)) byName.set(r.name, { name: r.name, client_id: r.client_id || null, kinds: new Set() });
    const entry = byName.get(r.name);
    entry.kinds.add(r.kind);
    // A counterparty billed under a trading client anywhere is billed under it
    // everywhere, so keep the first id we find rather than losing it.
    if (!entry.client_id && r.client_id) entry.client_id = r.client_id;
  }
  res.json([...byName.values()]
    .map((e) => ({ ...e, kinds: [...e.kinds].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name)));
});

/**
 * The contracts a given bill type can be raised against, for one client.
 *
 * The bill type decides which register is searched — a bilateral energy bill
 * settles a bilateral transaction, an exchange margin bill settles an exchange
 * agreement — so the form never has to know that itself.
 */
router.get('/contracts', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { bill_type, client_name, client_id } = req.query;
  if (bill_type && !BILL_TYPES[bill_type]) {
    return res.status(400).json({ error: `bill_type must be one of: ${ALL_BILL_TYPES.join(', ')}` });
  }
  const kind = bill_type ? BILL_TYPES[bill_type].kind : null;
  const out = [];

  if (!kind || kind === 'BILATERAL') {
    let sql = `SELECT id, counterparty, procurer_name, client_id, loa_no, loi_contract_ref, ppa_no,
                      start_date, end_date, open_access_status, schedule_status, status
               FROM bilateral_transactions WHERE status != 'CANCELLED'`;
    const params = [];
    if (client_id) { sql += ' AND client_id = ?'; params.push(client_id); }
    else if (client_name) { sql += ' AND (procurer_name = ? OR counterparty = ?)'; params.push(client_name, client_name); }
    sql += ' ORDER BY start_date DESC';
    for (const r of db.prepare(sql).all(...params)) {
      out.push({
        kind: 'BILATERAL',
        contract_id: r.id,
        label: r.loa_no || r.loi_contract_ref || r.id,
        client_name: r.procurer_name || r.counterparty,
        client_id: r.client_id,
        ppa_no: r.ppa_no,
        start_date: r.start_date,
        end_date: r.end_date,
        // An energy bill is only raisable once the portal has granted access.
        billable: ['APPROVED', 'PARTIAL'].includes(r.open_access_status),
        state: `open access ${r.open_access_status} · schedule ${r.schedule_status}`,
      });
    }
  }

  if (!kind || kind === 'EXCHANGE') {
    let sql = `SELECT id, client_name, client_id, loa_no, ppa_no, product, side,
                      start_date, end_date, status
               FROM exchange_contracts WHERE status != 'CANCELLED'`;
    const params = [];
    if (client_id) { sql += ' AND client_id = ?'; params.push(client_id); }
    else if (client_name) { sql += ' AND client_name = ?'; params.push(client_name); }
    sql += ' ORDER BY start_date DESC';
    for (const r of db.prepare(sql).all(...params)) {
      out.push({
        kind: 'EXCHANGE',
        contract_id: r.id,
        label: r.loa_no || r.id,
        client_name: r.client_name,
        client_id: r.client_id,
        ppa_no: r.ppa_no,
        start_date: r.start_date,
        end_date: r.end_date,
        billable: true,
        state: `${r.product} ${r.side} · ${r.status}`,
      });
    }
  }

  res.json(out);
});

/** Read the form's body into the shape both engines take. */
function billRequest(b) {
  return {
    bill_type: b.bill_type,
    contract_id: b.contract_id,
    from: b.from || b.start_date || null,
    to: b.to || b.end_date || null,
    options: {
      gst_applicable: b.gst_applicable,
      tds_rate: b.tds_rate,
      bearer: b.bearer,
      amount: b.amount,
      client_name: b.client_name,
      injection_state: b.injection_state,
      drawal_state: b.drawal_state,
      ists_rate: b.ists_rate,
      // The form's "Whether LPS" switch. Off means the contract's late payment
      // surcharge is left off this bill rather than silently carried onto it.
      include_lps: b.lps === 'Yes' || b.include_lps === true,
    },
  };
}

function validatePeriod(b) {
  for (const [k, v] of [['from', b.from], ['to', b.to]]) {
    if (v && !DATE_RE.test(v)) return `${k} must be YYYY-MM-DD`;
  }
  if (b.from && b.to && b.to < b.from) return 'to cannot be before from';
  return null;
}

/** Price a bill without writing it — what the form shows before Generate. */
router.post('/preview', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const b = req.body || {};
  if (!BILL_TYPES[b.bill_type]) {
    return res.status(400).json({ error: `bill_type must be one of: ${ALL_BILL_TYPES.join(', ')}` });
  }
  if (!b.contract_id) return res.status(400).json({ error: 'contract_id is required' });
  const bad = validatePeriod(b);
  if (bad) return res.status(400).json({ error: bad });

  try {
    const priced = priceBill(billRequest(b));
    // Report what would stop this being raised, without refusing the preview —
    // the desk needs to see the numbers to understand why.
    res.json({ ...priced, objection: billingObjection(priced, { allow_zero_volume: b.allow_zero_volume }) });
  } catch (err) {
    res.status(/not found/i.test(err.message) ? 404 : 400).json({ error: err.message });
  }
});

/** Raise the bill into the View Bills register. */
router.post('/generate', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const spec = BILL_TYPES[b.bill_type];
  if (!spec) return res.status(400).json({ error: `bill_type must be one of: ${ALL_BILL_TYPES.join(', ')}` });
  if (!b.contract_id) return res.status(400).json({ error: 'contract_id is required' });
  const bad = validatePeriod(b);
  if (bad) return res.status(400).json({ error: bad });

  const contract = spec.kind === 'BILATERAL'
    ? db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(b.contract_id)
    : db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(b.contract_id);
  if (!contract) return res.status(404).json({ error: `No ${spec.kind.toLowerCase()} contract ${b.contract_id}` });

  if (spec.kind === 'BILATERAL' && b.bill_type === 'BILATERAL_ENERGY'
      && !['APPROVED', 'PARTIAL'].includes(contract.open_access_status)) {
    return res.status(400).json({
      error: `Open access is ${contract.open_access_status}; an energy bill can only be raised once it is APPROVED or PARTIAL`,
    });
  }
  if (spec.kind === 'EXCHANGE' && contract.status === 'CANCELLED') {
    return res.status(400).json({ error: 'This contract is CANCELLED and cannot be billed' });
  }

  let priced;
  try {
    priced = priceBill(billRequest(b));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const objection = billingObjection(priced, { allow_zero_volume: b.allow_zero_volume });
  if (objection) return res.status(400).json(objection);

  const invoice = raiseInvoice({
    bill_type: b.bill_type,
    priced,
    bilateral_id: spec.kind === 'BILATERAL' ? contract.id : null,
    exchange_contract_id: spec.kind === 'EXCHANGE' ? contract.id : null,
    client_id: contract.client_id,
    client_code: b.client_code,
    invoice_date: b.invoice_date,
    credit_days: b.credit_days,
    remarks: b.remarks,
  });

  secureLogAudit(req, {
    action: 'GENERATE_BILL',
    module: 'TRADING',
    entityType: 'view_bill_invoice',
    entityId: invoice.id,
    details: {
      bill_type: b.bill_type, kind: spec.kind, contract_id: contract.id,
      invoice_no: invoice.invoice_no, invoice_amount: invoice.invoice_amount,
    },
  });

  res.status(201).json({ ...invoice, line_items: priced.line_items, warnings: priced.warnings });
});

/* ─────────── Bill of Supply ───────────
 *
 * Electricity is outside GST, so a supply of power is billed on a Bill of
 * Supply and not a tax invoice. The entry screen had no backend, so nothing
 * that was typed into it was ever kept.
 */

const n = (v) => (v === '' || v == null ? 0 : Number(v));

router.get('/bill-of-supply', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { q, client_name, from, to, status } = req.query;
  let sql = 'SELECT * FROM bill_of_supply WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  else { sql += " AND status != 'CANCELLED'"; }
  if (client_name) { sql += ' AND client_name = ?'; params.push(client_name); }
  if (from) { sql += ' AND invoice_date >= ?'; params.push(from); }
  if (to) { sql += ' AND invoice_date <= ?'; params.push(to); }
  if (q) {
    sql += ' AND (bill_no LIKE ? OR client_name LIKE ? OR contract_no LIKE ? OR description LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY invoice_date DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/bill-of-supply/:id', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const row = db.prepare('SELECT * FROM bill_of_supply WHERE id = ? OR bill_no = ?').get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/bill-of-supply', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const errors = [];
  if (!String(b.client_name || '').trim()) errors.push('client_name is required');
  if (!b.invoice_date || !DATE_RE.test(b.invoice_date)) errors.push('invoice_date (YYYY-MM-DD) is required');
  if (!b.supply_from_date || !DATE_RE.test(b.supply_from_date)) errors.push('supply_from_date (YYYY-MM-DD) is required');
  if (!b.supply_to_date || !DATE_RE.test(b.supply_to_date)) errors.push('supply_to_date (YYYY-MM-DD) is required');
  if (b.supply_from_date && b.supply_to_date && b.supply_to_date < b.supply_from_date) {
    errors.push('supply_to_date cannot be before supply_from_date');
  }
  const quantity = n(b.quantity);
  const rate = n(b.rate);
  if (!Number.isFinite(quantity) || quantity <= 0) errors.push('quantity must be a positive number');
  if (!Number.isFinite(rate) || rate < 0) errors.push('rate must be a non-negative number');
  const rebate = n(b.rebate_percent);
  if (!Number.isFinite(rebate) || rebate < 0 || rebate > 100) errors.push('rebate_percent must be between 0 and 100');
  if (b.bill_no && db.prepare('SELECT 1 FROM bill_of_supply WHERE bill_no = ?').get(b.bill_no)) {
    errors.push(`bill_no ${b.bill_no} already exists`);
  }
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  // The amount follows from quantity x rate unless the caller states one, and
  // the rebate is applied to whichever amount that is — so the two can never
  // disagree the way two hand-typed figures can.
  const amount = b.amount != null && b.amount !== '' ? n(b.amount) : Number((quantity * rate).toFixed(2));
  const afterRebate = Number((amount * (1 - rebate / 100)).toFixed(2));

  const id = newId('BOS');
  const seq = (db.prepare('SELECT COUNT(*) c FROM bill_of_supply').get().c || 0) + 1;
  const billNo = b.bill_no || `SJVN/BOS/${String(b.invoice_date).slice(0, 7).replace('-', '')}/${String(seq).padStart(4, '0')}`;

  db.prepare(`
    INSERT INTO bill_of_supply (
      id, bill_no, client_id, client_name, seller_name, buyer_name, contract_no, bilateral_id,
      invoice_date, invoice_due_date, supply_from_date, supply_to_date,
      description, hsn_code, quantity, unit, rate, amount, rebate_percent, amount_after_rebate,
      document_id, remarks, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, billNo, b.client_id || null, String(b.client_name).trim(),
    b.seller_name || null, b.buyer_name || null, b.contract_no || null, b.bilateral_id || null,
    b.invoice_date, b.invoice_due_date || null, b.supply_from_date, b.supply_to_date,
    b.description || 'Supply of electrical energy', b.hsn_code || '27160000',
    quantity, b.unit || 'MWh', rate, amount, rebate, afterRebate,
    b.document_id || null, b.remarks || null, req.user?.id || null,
  );

  secureLogAudit(req, {
    action: 'CREATE_BILL_OF_SUPPLY', module: 'TRADING', entityType: 'bill_of_supply', entityId: id,
    details: { bill_no: billNo, client_name: b.client_name, amount, amount_after_rebate: afterRebate },
  });

  res.status(201).json(db.prepare('SELECT * FROM bill_of_supply WHERE id = ?').get(id));
});

router.post('/bill-of-supply/:id/cancel', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM bill_of_supply WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE bill_of_supply SET status = 'CANCELLED' WHERE id = ?").run(row.id);
  secureLogAudit(req, { action: 'CANCEL_BILL_OF_SUPPLY', module: 'TRADING', entityType: 'bill_of_supply', entityId: row.id });
  res.json(db.prepare('SELECT * FROM bill_of_supply WHERE id = ?').get(row.id));
});

/** Report of Supply Bill — the register, in the shape the ISET report renders. */
router.get('/supply-bill-report', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { from, to } = req.query;
  let sql = "SELECT * FROM bill_of_supply WHERE status != 'CANCELLED'";
  const params = [];
  if (from) { sql += ' AND invoice_date >= ?'; params.push(from); }
  if (to) { sql += ' AND invoice_date <= ?'; params.push(to); }
  sql += ' ORDER BY invoice_date DESC';
  const rows = db.prepare(sql).all(...params);

  res.json({
    title: 'Report of Supply Bill',
    columns: [
      { key: 'bill_no', label: 'Bill No.' },
      { key: 'client_name', label: 'Client Name' },
      { key: 'bill_date', label: 'Bill Date' },
      { key: 'supply_from', label: 'Supply From' },
      { key: 'supply_to', label: 'Supply To' },
      { key: 'energy_mwh', label: 'Energy (MWh)' },
      { key: 'amount_rs', label: 'Amount (Rs.)' },
      { key: 'status', label: 'Status' },
    ],
    rows: rows.map((r) => ({
      bill_no: r.bill_no,
      client_name: r.client_name,
      bill_date: r.invoice_date,
      supply_from: r.supply_from_date,
      supply_to: r.supply_to_date,
      energy_mwh: r.quantity,
      amount_rs: r.amount_after_rebate,
      status: r.status,
    })),
    summary: {
      bills: rows.length,
      total_energy_mwh: Number(rows.reduce((a, r) => a + Number(r.quantity || 0), 0).toFixed(3)),
      total_amount: Number(rows.reduce((a, r) => a + Number(r.amount_after_rebate || 0), 0).toFixed(2)),
    },
  });
});

export default router;
