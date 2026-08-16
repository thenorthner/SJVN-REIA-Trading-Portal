import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { getParam } from '../mastersService.js';

const router = Router();
router.use(requireAuth);

const EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const REC_TYPES = ['PAT Cycle 1', 'PAT Cycle 2', 'PAT Cycle 3', 'PAT Cycle 4', 'ESCERT'];

router.get('/meta', requireRole(...ROLE_GROUPS.TRADING_ALL), (_req, res) => {
  const bands = getParam('certificate_price_bands', { REC: {}, ESCERT: {} });
  res.json({
    exchanges: EXCHANGES,
    rec_types: REC_TYPES,
    price_band: bands?.ESCERT || null,
    // Desk inventory snapshot until registry holdings are wired live.
    registry_available: Number(getParam('escert_registry_available', 4250)) || 4250,
  });
});

router.get('/', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { status, client_id } = req.query;
  let sql = 'SELECT * FROM escert_orders WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (client_id) { sql += ' AND client_id = ?'; params.push(client_id); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const errors = [];

  if (!String(b.entity_name || b.client_id || '').trim()) errors.push('entity_name is required');
  if (!EXCHANGES.includes(b.exchange)) errors.push(`exchange must be one of: ${EXCHANGES.join(', ')}`);
  if (!String(b.portfolio_code || '').trim()) errors.push('portfolio_code is required');
  if (!REC_TYPES.includes(b.rec_type)) errors.push(`rec_type must be one of: ${REC_TYPES.join(', ')}`);
  if (!['Buy', 'Sell'].includes(b.side)) errors.push('side must be Buy or Sell');

  const price = Number(b.price);
  const quantity = Number(b.quantity);
  if (!Number.isFinite(price) || price < 0) errors.push('price must be a non-negative number');
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    errors.push('quantity must be a positive whole number');
  }

  let entityName = String(b.entity_name || '').trim();
  let entityId = b.entity_id || b.client_id || null;
  if (b.client_id) {
    const client = db.prepare('SELECT id, name, status FROM trading_clients WHERE id = ?').get(b.client_id);
    if (!client) errors.push('client_id does not exist');
    else if (client.status === 'SUSPENDED') errors.push('Client is suspended. Bidding not allowed.');
    else {
      if (!entityName) entityName = client.name;
      entityId = client.id;
    }
  }

  // Regulatory floor / forbearance from masters (same band the hub checked).
  const bands = getParam('certificate_price_bands', { REC: {}, ESCERT: {} });
  const band = bands?.ESCERT || {};
  const floor = Number(band.floor);
  const ceiling = band.forbearance == null ? null : Number(band.forbearance);
  if (Number.isFinite(floor) && Number.isFinite(price) && price < floor) {
    errors.push(`Price ₹${price} is below the ESCert floor of ₹${floor}`);
  }
  if (ceiling != null && Number.isFinite(ceiling) && Number.isFinite(price) && price > ceiling) {
    errors.push(`Price ₹${price} exceeds the ESCert forbearance ceiling of ₹${ceiling}`);
  }

  if (b.side === 'Sell') {
    const available = Number(getParam('escert_registry_available', 4250)) || 4250;
    if (quantity > available) {
      errors.push(`Insufficient registry balance: selling ${quantity} but only ${available} ESCerts available`);
    }
  }

  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const id = newId('ESC');
  const notional = Number((price * quantity).toFixed(2));
  db.prepare(`
    INSERT INTO escert_orders (
      id, client_id, entity_name, entity_id, exchange, portfolio_code, rec_type,
      price, quantity, side, status, notional, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?)
  `).run(
    id,
    b.client_id || null,
    entityName,
    entityId,
    b.exchange,
    String(b.portfolio_code).trim(),
    b.rec_type,
    price,
    quantity,
    b.side,
    notional,
    req.user?.id || null,
  );

  secureLogAudit(req, {
    action: 'CREATE_ESCERT_ORDER',
    module: 'TRADING',
    entityType: 'escert_order',
    entityId: id,
    details: { exchange: b.exchange, side: b.side, quantity, price },
  });

  res.status(201).json(db.prepare('SELECT * FROM escert_orders WHERE id = ?').get(id));
});

export default router;
