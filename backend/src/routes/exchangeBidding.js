import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';

const router = Router();
router.use(requireAuth);

const EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const SEGMENTS = ['Day Ahead', 'Real Time', 'Term Ahead', 'Green', 'Collective'];
const PRODUCT_TYPES = ['DAM', 'GDAM', 'HPDAM', 'RTM', 'TAM', 'GTAM', 'Daily', 'Weekly', 'Monthly'];
const BIDDING_TYPES = ['Single Bid', 'Block Bid', 'Linked Block Bid', 'Differential Bid'];

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
  return { ...row, schedule_details: parseSchedule(row.schedule_json) };
}

router.get('/meta', requireRole(...ROLE_GROUPS.TRADING_ALL), (_req, res) => {
  res.json({ exchanges: EXCHANGES, segments: SEGMENTS, product_types: PRODUCT_TYPES, bidding_types: BIDDING_TYPES });
});

router.get('/', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { client_id, status } = req.query;
  let sql = 'SELECT * FROM exchange_biddings WHERE 1=1';
  const params = [];
  if (client_id) { sql += ' AND client_id = ?'; params.push(client_id); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withDetails));
});

router.get('/:id', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const row = db.prepare('SELECT * FROM exchange_biddings WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(withDetails(row));
});

router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const errors = [];

  if (!String(b.client_name || b.client_id || '').trim()) errors.push('client_name is required');
  if (!String(b.client_ref_no || '').trim()) errors.push('client_ref_no is required');
  if (!EXCHANGES.includes(b.exchange)) errors.push(`exchange must be one of: ${EXCHANGES.join(', ')}`);
  if (!SEGMENTS.includes(b.segment)) errors.push(`segment must be one of: ${SEGMENTS.join(', ')}`);
  if (!String(b.portfolio_id || '').trim()) errors.push('portfolio_id is required');
  if (!PRODUCT_TYPES.includes(b.product_type)) errors.push(`product_type must be one of: ${PRODUCT_TYPES.join(', ')}`);
  if (!BIDDING_TYPES.includes(b.bidding_type)) errors.push(`bidding_type must be one of: ${BIDDING_TYPES.join(', ')}`);
  if (!b.supply_start_date) errors.push('supply_start_date is required');
  if (!b.supply_end_date) errors.push('supply_end_date is required');
  if (b.supply_start_date && b.supply_end_date && b.supply_end_date < b.supply_start_date) {
    errors.push('supply_end_date cannot be before supply_start_date');
  }

  const schedule = Array.isArray(b.schedule_details) ? b.schedule_details : [];
  if (!schedule.length) errors.push('at least one schedule / bid row is required');
  for (const [i, row] of schedule.entries()) {
    if (!row.date_from || !row.date_to) errors.push(`schedule row ${i + 1}: date from/to required`);
    if (!row.time_from || !row.time_to) errors.push(`schedule row ${i + 1}: hours from/to required`);
    if (row.price === '' || row.price == null || !Number.isFinite(Number(row.price)) || Number(row.price) < 0) {
      errors.push(`schedule row ${i + 1}: price must be a non-negative number`);
    }
    if (row.capacity === '' || row.capacity == null || !Number.isFinite(Number(row.capacity)) || Number(row.capacity) <= 0) {
      errors.push(`schedule row ${i + 1}: capacity must be a positive number`);
    }
    if (row.side && !['Buy', 'Sell'].includes(row.side)) {
      errors.push(`schedule row ${i + 1}: Buy/Sell must be Buy or Sell`);
    }
  }

  let clientName = String(b.client_name || '').trim();
  if (b.client_id) {
    const client = db.prepare('SELECT name, status FROM trading_clients WHERE id = ?').get(b.client_id);
    if (!client) errors.push('client_id does not exist');
    else if (client.status === 'SUSPENDED') errors.push('Client is suspended. Bidding not allowed.');
    else if (!clientName) clientName = client.name;
  }

  let contractLabel = b.contract_label || null;
  if (b.contract_id) {
    const contract = db.prepare('SELECT id, loa_no, ppa_no FROM exchange_contracts WHERE id = ?').get(b.contract_id);
    if (!contract) errors.push('contract_id does not exist');
    else contractLabel = contract.loa_no || contract.ppa_no || contract.id;
  } else if (!String(b.contract_label || '').trim() && !b.contract_id) {
    errors.push('contract is required');
  }

  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const id = newId('EXB');
  db.prepare(`
    INSERT INTO exchange_biddings (
      id, client_id, client_name, client_ref_no, exchange, segment, portfolio_id,
      contract_id, contract_label, product_type, bidding_type,
      supply_start_date, supply_end_date, schedule_json, csv_filename, status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?)
  `).run(
    id,
    b.client_id || null,
    clientName,
    String(b.client_ref_no).trim(),
    b.exchange,
    b.segment,
    String(b.portfolio_id).trim(),
    b.contract_id || null,
    contractLabel || String(b.contract_label || '').trim(),
    b.product_type,
    b.bidding_type,
    b.supply_start_date,
    b.supply_end_date,
    JSON.stringify(schedule),
    b.csv_filename || null,
    req.user?.id || null,
  );

  secureLogAudit(req, {
    action: 'CREATE_EXCHANGE_BIDDING',
    module: 'TRADING',
    entityType: 'exchange_bidding',
    entityId: id,
    details: { exchange: b.exchange, product_type: b.product_type, bidding_type: b.bidding_type, rows: schedule.length },
  });

  res.status(201).json(withDetails(db.prepare('SELECT * FROM exchange_biddings WHERE id = ?').get(id)));
});

export default router;
