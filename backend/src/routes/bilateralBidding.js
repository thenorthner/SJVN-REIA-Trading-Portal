import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, genApplicationNo } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';

const router = Router();
router.use(requireAuth);

const APPLICATION_TYPES = [
  'Fresh',
  'Advance',
  'Revision',
  'Curtailment',
  'Cancellation',
  'Standing Clearance',
];
const GENERATING_SOURCES = [
  'Hydro',
  'Thermal',
  'Solar',
  'Wind',
  'Hybrid',
  'Gas',
  'Nuclear',
  'Other',
];

function parseJson(raw, fallback = []) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function withDetails(row) {
  if (!row) return row;
  return {
    ...row,
    generating_sources: parseJson(row.generating_sources_json, []),
    schedule_details: parseJson(row.schedule_json, []),
    declaration_accepted: Boolean(row.declaration_accepted),
  };
}

router.get('/meta', requireRole(...ROLE_GROUPS.TRADING_ALL), (_req, res) => {
  res.json({
    application_types: APPLICATION_TYPES,
    generating_sources: GENERATING_SOURCES,
    access_types: ['GNA', 'T-GNA'],
  });
});

router.get('/', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM bilateral_biddings WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params).map(withDetails));
});

router.get('/:id', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const row = db.prepare('SELECT * FROM bilateral_biddings WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(withDetails(row));
});

router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const errors = [];

  if (!String(b.applicant || '').trim()) errors.push('applicant is required');
  if (!String(b.seller_name || '').trim()) errors.push('seller_name is required');
  if (!String(b.buyer_name || '').trim()) errors.push('buyer_name is required');
  if (!String(b.seller_contract_id || b.seller_contract_no || '').trim()) {
    errors.push('seller_side_contract is required');
  }
  if (!String(b.buyer_contract_id || b.buyer_contract_no || '').trim()) {
    errors.push('buyer_side_contract is required');
  }
  if (!['Yes', 'No'].includes(b.under_gtam || 'No')) errors.push('under_gtam must be Yes or No');
  if (!['GNA', 'T-GNA'].includes(b.access_type || 'T-GNA')) errors.push('access_type must be GNA or T-GNA');
  if (!['Yes', 'No'].includes(b.accept_partial || 'No')) errors.push('accept_partial must be Yes or No');
  if (!APPLICATION_TYPES.includes(b.application_type)) {
    errors.push(`application_type must be one of: ${APPLICATION_TYPES.join(', ')}`);
  }
  if (!String(b.route || '').trim()) errors.push('route is required');

  const sources = Array.isArray(b.generating_sources)
    ? b.generating_sources.map((s) => String(s).trim()).filter(Boolean)
    : [];
  if (!sources.length) errors.push('at least one generating source is required');

  const schedule = Array.isArray(b.schedule_details) ? b.schedule_details : [];
  if (!schedule.length) errors.push('at least one schedule row is required');
  for (const [i, row] of schedule.entries()) {
    if (!row.date_from || !row.date_to) errors.push(`schedule row ${i + 1}: date from/to required`);
    if (row.date_from && row.date_to && row.date_to < row.date_from) {
      errors.push(`schedule row ${i + 1}: date to cannot be before date from`);
    }
    if (!row.time_from || !row.time_to) errors.push(`schedule row ${i + 1}: hours from/to required`);
    if (row.capacity === '' || row.capacity == null || !Number.isFinite(Number(row.capacity)) || Number(row.capacity) <= 0) {
      errors.push(`schedule row ${i + 1}: capacity must be a positive number`);
    }
  }

  if (!b.declaration_accepted) {
    errors.push('declaration must be accepted before submit');
  }

  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const id = newId('BBD');
  db.prepare(`
    INSERT INTO bilateral_biddings (
      id, applicant,
      seller_name, seller_id, seller_injecting_point, seller_utility, seller_sldc, seller_region,
      seller_contract_id, seller_contract_no,
      buyer_name, buyer_id, buyer_drawal_point, buyer_utility, buyer_sldc, buyer_region,
      buyer_contract_id, buyer_contract_no,
      under_gtam, access_type, accept_partial, application_type, route, alternate_route,
      generating_sources_json, schedule_json, csv_filename, declaration_accepted, status, created_by
    ) VALUES (
      ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, 1, 'SUBMITTED', ?
    )
  `).run(
    id,
    String(b.applicant).trim(),
    String(b.seller_name).trim(),
    b.seller_id || null,
    b.seller_injecting_point || null,
    b.seller_utility || null,
    b.seller_sldc || null,
    b.seller_region || null,
    b.seller_contract_id || null,
    b.seller_contract_no || null,
    String(b.buyer_name).trim(),
    b.buyer_id || null,
    b.buyer_drawal_point || null,
    b.buyer_utility || null,
    b.buyer_sldc || null,
    b.buyer_region || null,
    b.buyer_contract_id || null,
    b.buyer_contract_no || null,
    b.under_gtam || 'No',
    b.access_type || 'T-GNA',
    b.accept_partial || 'No',
    b.application_type,
    String(b.route).trim(),
    b.alternate_route || null,
    JSON.stringify(sources),
    JSON.stringify(schedule.map((r) => ({
      date_from: r.date_from,
      date_to: r.date_to,
      time_from: r.time_from,
      time_to: r.time_to,
      capacity: Number(r.capacity),
    }))),
    b.csv_filename || null,
    req.user?.id || null,
  );

  secureLogAudit(req, {
    action: 'CREATE_BILATERAL_BIDDING',
    module: 'TRADING',
    entityType: 'bilateral_bidding',
    entityId: id,
    details: {
      application_type: b.application_type,
      seller_contract_no: b.seller_contract_no,
      buyer_contract_no: b.buyer_contract_no,
      rows: schedule.length,
    },
  });

  // Mirror onto Bilateral Applications list (ISET Format Generation → Applications).
  let application = null;
  try {
    const applicationDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const region = String(b.seller_region || b.buyer_region || 'NR').toUpperCase().slice(0, 2) || 'NR';
    const applicationId = genApplicationNo(applicationDate.slice(0, 10), region);
    const appId = newId('BAP');
    db.prepare(`
      INSERT INTO bilateral_applications (
        id, application_id, application_date, applicant, seller_name, buyer_name,
        bidding_id, seller_contract_no, buyer_contract_no, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?)
    `).run(
      appId,
      applicationId,
      applicationDate,
      String(b.applicant || 'SJVN Limited').trim(),
      String(b.seller_name).trim(),
      String(b.buyer_name).trim(),
      id,
      b.seller_contract_no || null,
      b.buyer_contract_no || null,
      req.user?.id || null,
    );
    application = db.prepare('SELECT * FROM bilateral_applications WHERE id = ?').get(appId);
  } catch (err) {
    console.warn('[Bilateral Bidding] application mirror failed:', err.message);
  }

  const created = withDetails(db.prepare('SELECT * FROM bilateral_biddings WHERE id = ?').get(id));
  res.status(201).json({ ...created, application });
});

/**
 * Turn a submitted format-generation application into a bilateral contract.
 *
 * Everything the application already states — the parties, their SLDCs and
 * regions, the route, and the schedule's span and peak capacity — is carried
 * across. The commercial terms are not: the ISET format-generation form has no
 * rate on it, so the desk supplies the sale rate here rather than the contract
 * being created at zero and silently billing nothing.
 */
router.post('/:id/contract', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const bid = db.prepare('SELECT * FROM bilateral_biddings WHERE id = ?').get(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Not found' });
  if (bid.transaction_id) {
    return res.status(400).json({
      error: `This application was already converted into contract ${bid.transaction_id}`,
      transaction_id: bid.transaction_id,
    });
  }

  const schedule = parseJson(bid.schedule_json, []);
  if (!schedule.length) return res.status(400).json({ error: 'This application carries no schedule rows to build a contract from' });

  const saleRate = Number(b.sale_rate_per_unit);
  if (!Number.isFinite(saleRate) || saleRate <= 0) {
    return res.status(400).json({ error: 'sale_rate_per_unit is required — the format-generation form does not carry a rate' });
  }
  const margin = b.trading_margin_per_unit != null ? Number(b.trading_margin_per_unit) : 0.03;
  if (!Number.isFinite(margin) || margin < 0) return res.status(400).json({ error: 'trading_margin_per_unit must be a non-negative number' });
  if (margin > saleRate) return res.status(400).json({ error: 'trading_margin_per_unit cannot exceed sale_rate_per_unit' });

  // The contract spans the whole application and is sized to its peak block.
  const startDate = schedule.map((r) => r.date_from).filter(Boolean).sort()[0];
  const endDate = schedule.map((r) => r.date_to).filter(Boolean).sort().slice(-1)[0];
  const quantumMw = Math.max(...schedule.map((r) => Number(r.capacity) || 0));
  if (!startDate || !endDate) return res.status(400).json({ error: 'The application schedule has no usable date range' });

  const region = String(b.noar_region || bid.seller_region || bid.buyer_region || 'NR').toUpperCase().slice(0, 2);
  const id = newId('BIL');
  const applicationNo = genApplicationNo(startDate, region);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO bilateral_transactions (
        id, counterparty, loi_contract_ref, oa_type, quantum_mw,
        tariff_per_unit, purchase_rate_per_unit, sale_rate_per_unit, trading_margin_per_unit,
        noar_application_no, noar_region, start_date, end_date,
        contract_type, supplier_name, supplier_id, supplier_sldc, supplier_region, injecting_point,
        procurer_name, procurer_id, procurer_sldc, procurer_region, drawal_point,
        route, alternate_route,
        loss_injection_state, loss_inter_state, loss_drawee_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Bilateral', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      bid.buyer_name,
      bid.buyer_contract_no || bid.seller_contract_no || null,
      b.oa_type || 'STOA',
      quantumMw,
      saleRate,
      Number((saleRate - margin).toFixed(4)),
      saleRate,
      margin,
      applicationNo,
      region,
      startDate,
      endDate,
      bid.seller_name,
      bid.seller_id,
      bid.seller_sldc,
      bid.seller_region,
      bid.seller_injecting_point,
      bid.buyer_name,
      bid.buyer_id,
      bid.buyer_sldc,
      bid.buyer_region,
      bid.buyer_drawal_point,
      bid.route,
      bid.alternate_route,
      Number(b.loss_injection_state) || 0,
      Number(b.loss_inter_state) || 0,
      Number(b.loss_drawee_state) || 0,
    );

    // Each schedule row of the application becomes an order-detail line, so the
    // contract still shows the shape the application was filed in.
    const insertOrder = db.prepare(`
      INSERT INTO bilateral_order_details (id, transaction_id, date_from, date_to, time_from, time_to, rate_type, rate, quantum)
      VALUES (?, ?, ?, ?, ?, ?, 'Fixed', ?, ?)
    `);
    for (const r of schedule) {
      insertOrder.run(newId('BOD'), id, r.date_from, r.date_to, r.time_from, r.time_to, saleRate, Number(r.capacity) || 0);
    }

    db.prepare('UPDATE bilateral_biddings SET transaction_id = ?, status = ? WHERE id = ?').run(id, 'APPROVED', bid.id);
    db.prepare('UPDATE bilateral_applications SET transaction_id = ? WHERE bidding_id = ?').run(id, bid.id);
  })();

  secureLogAudit(req, {
    action: 'CONVERT_BIDDING_TO_CONTRACT',
    module: 'TRADING',
    entityType: 'bilateral_tx',
    entityId: id,
    details: { bidding_id: bid.id, sale_rate_per_unit: saleRate, trading_margin_per_unit: margin, quantum_mw: quantumMw, start_date: startDate, end_date: endDate },
  });

  res.status(201).json(db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(id));
});

export default router;
