import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { TRADING_CLIENT_ROLES, clientScope, mayUseClient } from '../services/tradingClientScope.js';

const router = Router();
router.use(requireAuth);

const norm = (s) => String(s || '').trim().toLowerCase();
const isDemoName = (name) => /(^test[_\s-])|(weak buyer)/i.test(String(name || '').trim());

const withDetails = (client) => {
  if (!client) return null;
  client.signatories = db.prepare('SELECT * FROM trading_client_signatories WHERE client_id = ? ORDER BY created_at DESC').all(client.id);
  client.exchanges = db.prepare('SELECT * FROM trading_client_exchanges WHERE client_id = ? ORDER BY created_at DESC').all(client.id);
  if (client.entity_id) {
    client.entity_details = db.prepare('SELECT name, pan_no, gst_no FROM entities WHERE id = ?').get(client.entity_id);
  }
  return client;
};

// Who may read the register: the trading desk, and the REIA desk, which runs a
// trading client's reconciliation statement. A trading client's own office
// reads its own row. It answered every signed-in login, so a seller or buyer
// could read each client's exposure limit and risk rating.
const REGISTER_READ = [...new Set([...ROLE_GROUPS.TRADING_ALL, ...ROLE_GROUPS.REIA_ALL, ...TRADING_CLIENT_ROLES])];

// 1. List clients
router.get('/', requireRole(...REGISTER_READ), (req, res) => {
  const { status, client_type, include_demo } = req.query;
  const own = clientScope(req.user, 'id');
  let sql = `SELECT * FROM trading_clients WHERE 1=1${own.sql}`;
  const params = [...own.params];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (client_type) { sql += ' AND client_type = ?'; params.push(client_type); }
  sql += ' ORDER BY CASE status WHEN \'ACTIVE\' THEN 0 WHEN \'SUSPENDED\' THEN 1 ELSE 2 END, name ASC, created_at DESC';
  let rows = db.prepare(sql).all(...params);
  if (include_demo !== 'true' && status === 'ACTIVE') {
    rows = rows.filter((r) => !isDemoName(r.name));
  }
  res.json(rows);
});

// 2. Get specific client
router.get('/:id', requireRole(...REGISTER_READ), (req, res) => {
  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id);
  if (!client || !mayUseClient(req.user, client.id)) return res.status(404).json({ error: 'Client not found' });
  res.json(withDetails(client));
});

const CLIENT_TYPES = ['GENERATOR', 'DISCOM', 'TRADER', 'C&I', 'OTHER'];
const RISK_RATINGS = ['LOW', 'MEDIUM', 'HIGH'];

// 3. Create client
router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body;

  // Validate before the INSERT so a bad field is a 400 naming it, not a 500
  // carrying a raw SQLite constraint message.
  const errors = [];
  if (!String(b.name || '').trim()) errors.push('name is required');
  if (!CLIENT_TYPES.includes(b.client_type)) errors.push(`client_type must be one of: ${CLIENT_TYPES.join(', ')}`);
  if (b.risk_rating && !RISK_RATINGS.includes(b.risk_rating)) errors.push(`risk_rating must be one of: ${RISK_RATINGS.join(', ')}`);
  const limit = Number(b.exposure_limit ?? 0);
  if (!Number.isFinite(limit) || limit < 0) errors.push('exposure_limit must be a non-negative number');
  const credit = Number(b.credit_limit ?? 0);
  if (!Number.isFinite(credit) || credit < 0) errors.push('credit_limit must be a non-negative number');
  const van = String(b.virtual_account_no || '').trim() || null;
  if (van && db.prepare('SELECT 1 FROM trading_clients WHERE UPPER(virtual_account_no) = UPPER(?)').get(van)) errors.push('That virtual account number already belongs to another client');
  if (b.entity_id && !db.prepare('SELECT 1 FROM entities WHERE id = ?').get(b.entity_id)) errors.push('entity_id does not exist');
  const duplicate = db.prepare(`
    SELECT id FROM trading_clients
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND status = 'ACTIVE'
    LIMIT 1
  `).get(String(b.name || '').trim());
  if (duplicate) errors.push('An active trading client with this name already exists');
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const id = newId('TCL');
  db.prepare(`
    INSERT INTO trading_clients (id, entity_id, name, client_type, noc_valid_till, ppa_ref, exposure_limit, credit_limit, virtual_account_no, risk_rating, status, documents)
    VALUES (@id, @entity_id, @name, @client_type, @noc_valid_till, @ppa_ref, @exposure_limit, @credit_limit, @virtual_account_no, @risk_rating, 'ACTIVE', @documents)
  `).run({
    id,
    entity_id: b.entity_id || null,
    name: String(b.name).trim(),
    client_type: b.client_type,
    noc_valid_till: b.noc_valid_till || null,
    ppa_ref: b.ppa_ref || null,
    exposure_limit: limit,
    credit_limit: credit,
    virtual_account_no: van,
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
  const creditLimit = Number(merged.credit_limit ?? 0);
  if (!Number.isFinite(creditLimit) || creditLimit < 0) return res.status(400).json({ error: 'credit_limit must be a non-negative number' });
  merged.credit_limit = creditLimit;
  merged.virtual_account_no = String(merged.virtual_account_no || '').trim() || null;
  if (merged.virtual_account_no && db.prepare('SELECT 1 FROM trading_clients WHERE UPPER(virtual_account_no) = UPPER(?) AND id != ?').get(merged.virtual_account_no, existing.id)) {
    return res.status(400).json({ error: 'That virtual account number already belongs to another client' });
  }
  const duplicate = db.prepare(`
    SELECT id FROM trading_clients
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id != ? AND status = 'ACTIVE'
    LIMIT 1
  `).get(String(merged.name || '').trim(), existing.id);
  if (duplicate) return res.status(400).json({ error: 'Another active trading client already uses this name' });
  db.prepare(`
    UPDATE trading_clients SET name=@name, client_type=@client_type, noc_valid_till=@noc_valid_till,
      ppa_ref=@ppa_ref, exposure_limit=@exposure_limit, credit_limit=@credit_limit, virtual_account_no=@virtual_account_no, risk_rating=@risk_rating, status=@status
    WHERE id=@id
  `).run(merged);
  
  secureLogAudit(req, { action: 'UPDATE', module: 'TRADING', entityType: 'trading_client', entityId: existing.id, before: existing, after: merged });
  res.json(withDetails(db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id)));
});

// Pre-payment balance moves: a receipt adds to it, a refund or write-back takes from it.
// Only this endpoint writes the balance, so every change carries who, how much and why.
router.post('/:id/prepayment', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const amount = Math.round(Number(req.body.amount) * 100) / 100;
  const reason = String(req.body.reason || '').trim();
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'amount must be a non-zero number (negative to take money off)' });
  if (!reason) return res.status(400).json({ error: 'A reason or receipt reference is required' });
  const next = Math.round((Number(client.pre_payment_balance) + amount) * 100) / 100;
  if (next < 0) return res.status(400).json({ error: `Balance would go negative (now ₹${client.pre_payment_balance})` });
  db.prepare('UPDATE trading_clients SET pre_payment_balance = ? WHERE id = ?').run(next, client.id);
  secureLogAudit(req, { action: 'PREPAYMENT_ADJUST', module: 'TRADING', entityType: 'trading_client', entityId: client.id, details: { amount, reason, before: client.pre_payment_balance, after: next } });
  res.json(withDetails(db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(client.id)));
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
