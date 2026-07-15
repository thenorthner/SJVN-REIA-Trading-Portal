import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';

const router = Router();
router.use(requireAuth);

const withDetails = (client) => {
  if (!client) return null;
  client.signatories = db.prepare('SELECT * FROM trading_client_signatories WHERE client_id = ? ORDER BY created_at DESC').all(client.id);
  client.exchanges = db.prepare('SELECT * FROM trading_client_exchanges WHERE client_id = ? ORDER BY created_at DESC').all(client.id);
  if (client.entity_id) {
    client.entity_details = db.prepare('SELECT name, pan_no, gst_no FROM entities WHERE id = ?').get(client.entity_id);
  }
  return client;
};

// 1. List clients
router.get('/', (req, res) => {
  const { status, client_type } = req.query;
  let sql = 'SELECT * FROM trading_clients WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (client_type) { sql += ' AND client_type = ?'; params.push(client_type); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// 2. Get specific client
router.get('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(withDetails(client));
});

// 3. Create client
router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body;
  const id = newId('TCL');
  db.prepare(`
    INSERT INTO trading_clients (id, entity_id, name, client_type, noc_valid_till, ppa_ref, exposure_limit, risk_rating, status, documents)
    VALUES (@id, @entity_id, @name, @client_type, @noc_valid_till, @ppa_ref, @exposure_limit, @risk_rating, 'ACTIVE', @documents)
  `).run({
    id,
    entity_id: b.entity_id || null,
    name: b.name,
    client_type: b.client_type,
    noc_valid_till: b.noc_valid_till || null,
    ppa_ref: b.ppa_ref || null,
    exposure_limit: b.exposure_limit || 0,
    risk_rating: b.risk_rating || 'MEDIUM',
    documents: b.documents ? JSON.stringify(b.documents) : null,
  });
  
  secureLogAudit(req, { action: 'CREATE', module: 'TRADING', entityType: 'trading_client', entityId: id, details: b });
  res.status(201).json(withDetails(db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(id)));
});

// 4. Update basic details (including NOC and Limits)
router.put('/:id', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });
  
  const merged = { ...existing, ...req.body };
  db.prepare(`
    UPDATE trading_clients SET name=@name, client_type=@client_type, noc_valid_till=@noc_valid_till,
      ppa_ref=@ppa_ref, exposure_limit=@exposure_limit, risk_rating=@risk_rating, status=@status
    WHERE id=@id
  `).run(merged);
  
  secureLogAudit(req, { action: 'UPDATE', module: 'TRADING', entityType: 'trading_client', entityId: existing.id, before: existing, after: merged });
  res.json(withDetails(db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id)));
});

// 5. Suspend / Blacklist workflow
router.post('/:id/suspend', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const { reason } = req.body;
  const existing = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id);
  db.prepare(`UPDATE trading_clients SET status = 'SUSPENDED', suspension_reason = ? WHERE id = ?`).run(reason, req.params.id);
  
  const after = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id);
  secureLogAudit(req, { action: 'SUSPEND', module: 'TRADING', entityType: 'trading_client', entityId: existing.id, before: existing, after, reason });
  res.json(withDetails(after));
});

// 6. Manage Signatories
router.post('/:id/signatories', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const id = newId('SIG');
  const b = req.body;
  db.prepare(`INSERT INTO trading_client_signatories (id, client_id, name, designation, contact_info) VALUES (?, ?, ?, ?, ?)`).run(
    id, req.params.id, b.name, b.designation, b.contact_info
  );
  secureLogAudit(req, { action: 'ADD_SIGNATORY', module: 'TRADING', entityType: 'trading_client', entityId: req.params.id, details: b });
  res.json(withDetails(db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id)));
});

router.delete('/:id/signatories/:sigId', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  db.prepare(`UPDATE trading_client_signatories SET is_active = 0 WHERE id = ? AND client_id = ?`).run(req.params.sigId, req.params.id);
  secureLogAudit(req, { action: 'REMOVE_SIGNATORY', module: 'TRADING', entityType: 'trading_client', entityId: req.params.id, details: { sigId: req.params.sigId } });
  res.json(withDetails(db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id)));
});

// 7. Manage Exchange Memberships
router.post('/:id/exchanges', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const id = newId('TCX');
  const b = req.body;
  db.prepare(`INSERT INTO trading_client_exchanges (id, client_id, exchange, registration_id) VALUES (?, ?, ?, ?)`).run(
    id, req.params.id, b.exchange, b.registration_id
  );
  secureLogAudit(req, { action: 'ADD_EXCHANGE', module: 'TRADING', entityType: 'trading_client', entityId: req.params.id, details: b });
  res.json(withDetails(db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id)));
});

router.delete('/:id/exchanges/:excId', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  db.prepare(`UPDATE trading_client_exchanges SET is_active = 0 WHERE id = ? AND client_id = ?`).run(req.params.excId, req.params.id);
  secureLogAudit(req, { action: 'REMOVE_EXCHANGE', module: 'TRADING', entityType: 'trading_client', entityId: req.params.id, details: { excId: req.params.excId } });
  res.json(withDetails(db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id)));
});

export default router;
