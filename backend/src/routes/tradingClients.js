import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';

const router = Router();
router.use(requireAuth);

// Client / generator / DISCOM / trader / counterparty management for power trading
router.get('/', (req, res) => {
  const { status, client_type } = req.query;
  let sql = 'SELECT * FROM trading_clients WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (client_type) { sql += ' AND client_type = ?'; params.push(client_type); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client);
});

router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body;
  const id = newId('TCL');
  db.prepare(`
    INSERT INTO trading_clients (id, name, client_type, noc_valid_till, ppa_ref, pre_payment_balance, margin_available, status, documents)
    VALUES (@id, @name, @client_type, @noc_valid_till, @ppa_ref, @pre_payment_balance, @margin_available, 'ACTIVE', @documents)
  `).run({
    id,
    name: b.name,
    client_type: b.client_type,
    noc_valid_till: b.noc_valid_till ?? null,
    ppa_ref: b.ppa_ref ?? null,
    pre_payment_balance: b.pre_payment_balance || 0,
    margin_available: b.margin_available || 0,
    documents: b.documents ? JSON.stringify(b.documents) : null,
  });
  logAudit({ user: req.user, action: 'CREATE', module: 'TRADING', entityType: 'trading_client', entityId: id, details: b });
  res.status(201).json(db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(id));
});

router.put('/:id', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });
  const merged = { ...existing, ...req.body };
  db.prepare(`
    UPDATE trading_clients SET name=@name, client_type=@client_type, noc_valid_till=@noc_valid_till,
      ppa_ref=@ppa_ref, pre_payment_balance=@pre_payment_balance, margin_available=@margin_available, status=@status
    WHERE id=@id
  `).run(merged);
  logAudit({ user: req.user, action: 'UPDATE', module: 'TRADING', entityType: 'trading_client', entityId: existing.id, details: req.body });
  res.json(db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id));
});

export default router;
