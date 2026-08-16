import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';

const router = Router();
router.use(requireAuth);

const REQUIRED = [
  'transaction_code', 'user_id', 'password', 'nor', 'tm_id',
  'reference_no', 'tac_id', 'order_type', 'product_code',
  'quantity', 'price', 'delivery_date_from', 'delivery_date_to',
  'from_time', 'to_time', 'side',
];

function sanitize(row) {
  if (!row) return row;
  const { password: _p, ...rest } = row;
  return rest;
}

router.get('/', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { status, q } = req.query;
  let sql = 'SELECT * FROM pxil_orders WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (q) {
    sql += ' AND (reference_no LIKE ? OR product_code LIKE ? OR order_type LIKE ? OR tac_id LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY created_at DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params).map(sanitize));
});

router.get('/:id', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const row = db.prepare('SELECT * FROM pxil_orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'PXIL order not found' });
  res.json(sanitize(row));
});

router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const errors = [];

  for (const key of REQUIRED) {
    if (b[key] === undefined || b[key] === null || String(b[key]).trim() === '') {
      errors.push(`${key} is required`);
    }
  }

  if (b.side && !['Seller', 'Buyer'].includes(b.side)) {
    errors.push('side must be Seller or Buyer');
  }

  const quantity = Number(b.quantity);
  const price = Number(b.price);
  if (!Number.isFinite(quantity) || quantity <= 0) errors.push('quantity must be a positive number');
  if (!Number.isFinite(price) || price < 0) errors.push('price must be a non-negative number');

  const from = String(b.delivery_date_from || '');
  const to = String(b.delivery_date_to || '');
  if (from && to && from > to) errors.push('delivery_date_from must be on or before delivery_date_to');

  const ref = String(b.reference_no || '').trim();
  if (ref) {
    const dup = db.prepare('SELECT id FROM pxil_orders WHERE reference_no = ?').get(ref);
    if (dup) errors.push(`reference_no ${ref} already exists`);
  }

  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  // Password is required for PXIL session auth but never persisted.
  const id = newId('PXL');
  db.prepare(`
    INSERT INTO pxil_orders (
      id, transaction_code, user_id, nor, tm_id,
      reference_no, tac_id, order_type, product_code,
      quantity, price, delivery_date_from, delivery_date_to,
      from_time, to_time, side, status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', ?)
  `).run(
    id,
    String(b.transaction_code).trim(),
    String(b.user_id).trim(),
    String(b.nor).trim(),
    String(b.tm_id).trim(),
    ref,
    String(b.tac_id).trim(),
    String(b.order_type).trim(),
    String(b.product_code).trim(),
    quantity,
    price,
    from,
    to,
    String(b.from_time).trim(),
    String(b.to_time).trim(),
    b.side,
    req.user?.id || null,
  );

  secureLogAudit(req, {
    action: 'CREATE_PXIL_ORDER',
    module: 'TRADING',
    entityType: 'pxil_order',
    entityId: id,
    details: { reference_no: ref, product_code: b.product_code, side: b.side, quantity, price },
  });

  res.status(201).json(sanitize(db.prepare('SELECT * FROM pxil_orders WHERE id = ?').get(id)));
});

router.post('/:id/place-bid', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM pxil_orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'PXIL order not found' });
  if (row.status === 'BID_PLACED') {
    return res.status(400).json({ error: 'Bid already placed for this order' });
  }
  if (row.status !== 'CREATED') {
    return res.status(400).json({ error: `Cannot place bid when status is ${row.status}` });
  }

  db.prepare(`
    UPDATE pxil_orders
    SET status = 'BID_PLACED', bid_placed_at = datetime('now')
    WHERE id = ?
  `).run(row.id);

  secureLogAudit(req, {
    action: 'PLACE_PXIL_BID',
    module: 'TRADING',
    entityType: 'pxil_order',
    entityId: row.id,
    details: { reference_no: row.reference_no },
  });

  res.json(sanitize(db.prepare('SELECT * FROM pxil_orders WHERE id = ?').get(row.id)));
});

export function seedPxilOrders() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM pxil_orders').get().c;
  if (count > 0) return;

  const samples = [
    { reference_no: 'c005027767002423', quantity: 250, price: 1000, from_time: '11:00', to_time: '00:00', created_at: '2024-10-25 07:32:00' },
    { reference_no: 'c005027767002422', quantity: 450, price: 3250, from_time: '11:00', to_time: '11:15', created_at: '2024-10-25 07:32:00' },
    { reference_no: 'c005027767002421', quantity: 450, price: 3250, from_time: '11:00', to_time: '11:15', created_at: '2024-10-25 07:31:00' },
    { reference_no: 'c005027767002420', quantity: 450, price: 3250, from_time: '11:00', to_time: '11:15', created_at: '2024-10-25 07:31:00' },
    { reference_no: 'c005027767002419', quantity: 450, price: 3250, from_time: '11:00', to_time: '11:15', created_at: '2024-10-25 07:30:00' },
    { reference_no: 'c005027767002418', quantity: 450, price: 3250, from_time: '11:00', to_time: '11:30', created_at: '2024-10-25 07:29:00' },
    { reference_no: 'c005027767002417', quantity: 450, price: 3250, from_time: '11:00', to_time: '11:15', created_at: '2024-10-25 07:28:00' },
  ];

  const insert = db.prepare(`
    INSERT INTO pxil_orders (
      id, transaction_code, user_id, nor, tm_id,
      reference_no, tac_id, order_type, product_code,
      quantity, price, delivery_date_from, delivery_date_to,
      from_time, to_time, side, status, created_by, created_at
    ) VALUES (
      @id, @transaction_code, @user_id, @nor, @tm_id,
      @reference_no, @tac_id, @order_type, @product_code,
      @quantity, @price, @delivery_date_from, @delivery_date_to,
      @from_time, @to_time, @side, 'CREATED', NULL, @created_at
    )
  `);

  const tx = db.transaction(() => {
    for (const s of samples) {
      insert.run({
        id: newId('PXL'),
        transaction_code: 'PXIL-TXN-SEED',
        user_id: 'sjvn.trader',
        nor: 'NOR-001',
        tm_id: 'TM-SJVN-01',
        reference_no: s.reference_no,
        tac_id: 'TAC-RTM-01',
        order_type: 'NORMAL',
        product_code: 'RTM',
        quantity: s.quantity,
        price: s.price,
        delivery_date_from: '2024-10-26',
        delivery_date_to: '2024-10-26',
        from_time: s.from_time,
        to_time: s.to_time,
        side: 'Seller',
        created_at: s.created_at,
      });
    }
  });
  tx();
}

export default router;
