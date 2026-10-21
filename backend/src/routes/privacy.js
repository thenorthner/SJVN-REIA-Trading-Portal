import { Router } from 'express';
import db from '../db/index.js';
import { newId, logAudit, pushNotification } from '../util.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

/**
 * Data Principal rights under the DPDP Act 2023 (s.11–14): a summary of one's
 * own data, consent withdrawal, and requests for correction, erasure,
 * nomination and grievance redressal — and the Data Protection Officer's queue
 * and the statutory-declaration register behind them.
 */
const router = Router();
router.use(requireAuth);

const DPO_ROLES = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'COMPLIANCE_AUDITOR'];
const TYPES = ['ACCESS', 'CORRECTION', 'ERASURE', 'NOMINATION', 'GRIEVANCE'];
const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'];
const RESOLVE_DAYS = 30;

const PURPOSES = [
  'Renewable energy procurement and sale as REIA (PPA / PSA administration, billing, settlement)',
  'Power trading on exchanges and bilaterally',
  'Billing of SJVN hydro and thermal stations',
  'Payment security, reconciliation and dispute resolution',
  'Statutory filings to CERC, CEA, MNRE, Ministry of Power, tax authorities and auditors',
  'Security logging and audit (CERT-In)',
];
const RETENTION = 'Commercial and financial records: at least 8 years from the end of the financial year (Companies Act 2013 s.128), longer while a dispute, audit or proceeding is open. Security logs: at least 180 days (CERT-In). Accounts are deactivated, not deleted, so past approvals stay attributable.';

router.get('/my-data', (req, res) => {
  const u = db.prepare('SELECT id, name, email, phone, role, linked_entity_id, is_active, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'Account not found' });
  const org = u.linked_entity_id
    ? db.prepare('SELECT id, name, category, entity_type FROM entities WHERE id = ?').get(u.linked_entity_id)
    : null;
  const audit = db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE user_id = ?').get(u.id).c;
  const decl = db.prepare('SELECT COUNT(*) c FROM statutory_declarations WHERE user_id = ?').get(u.id).c;
  const signIns = db.prepare(`
    SELECT action, ip_address, created_at FROM audit_logs
    WHERE user_id = ? AND module = 'AUTH' AND action IN ('LOGIN','LOGOUT','SESSION_TIMEOUT','LOGIN_FAILED')
    ORDER BY rowid DESC LIMIT 10
  `).all(u.id);
  const consents = db.prepare('SELECT purpose, choice, version, created_at FROM consent_records WHERE user_id = ? ORDER BY rowid DESC LIMIT 20').all(u.id);
  logAudit({ req, user: req.user, action: 'DATA_SUMMARY_VIEWED', module: 'PRIVACY', entityType: 'user', entityId: u.id });
  res.json({
    generated_at: new Date().toISOString(),
    profile: { name: u.name, email: u.email, mobile: u.phone || null, role: u.role, active: !!u.is_active, created_at: u.created_at },
    organisation: org,
    activity: { audit_entries: audit, declarations: decl },
    recent_sign_ins: signIns,
    consents,
    purposes: PURPOSES,
    retention: RETENTION,
  });
});

router.post('/consents/withdraw', (req, res) => {
  const { purpose = 'COOKIES' } = req.body || {};
  if (purpose !== 'COOKIES') return res.status(400).json({ error: 'Unknown consent purpose' });
  db.prepare(`INSERT INTO consent_records (id, user_id, purpose, choice, ip_address, user_agent) VALUES (?, ?, ?, 'withdrawn', ?, ?)`)
    .run(newId('CNS'), req.user.id, purpose, req.ip || null, String(req.get('User-Agent') || '').slice(0, 300));
  logAudit({ req, user: req.user, action: 'CONSENT_WITHDRAWN', module: 'PRIVACY', entityType: 'consent', entityId: purpose });
  res.json({ ok: true });
});

router.get('/requests', (req, res) => {
  res.json(db.prepare('SELECT * FROM data_principal_requests WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id));
});

function nextReference() {
  const year = new Date().getFullYear();
  const n = db.prepare("SELECT COUNT(*) c FROM data_principal_requests WHERE reference LIKE ?").get(`DPR/${year}/%`).c + 1;
  return `DPR/${year}/${String(n).padStart(5, '0')}`;
}

router.post('/requests', (req, res) => {
  const { request_type: type, details, nominee_name: nomineeName, nominee_contact: nomineeContact } = req.body || {};
  if (!TYPES.includes(type)) return res.status(400).json({ error: `request_type must be one of ${TYPES.join(', ')}` });
  const text = String(details || '').trim();
  if (text.length < 10) return res.status(400).json({ error: 'Describe the request in at least 10 characters.' });
  if (text.length > 2000) return res.status(400).json({ error: 'Details are limited to 2000 characters.' });
  if (type === 'NOMINATION') {
    if (!String(nomineeName || '').trim()) return res.status(400).json({ error: 'Name the person you nominate.' });
    if (!/^\S+@\S+\.\S+$|^[6-9]\d{9}$/.test(String(nomineeContact || '').trim())) {
      return res.status(400).json({ error: "Give the nominee's e-mail address or 10-digit mobile number." });
    }
  }
  const open = db.prepare("SELECT COUNT(*) c FROM data_principal_requests WHERE user_id = ? AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')").get(req.user.id).c;
  if (open >= 10) return res.status(429).json({ error: 'You already have 10 open requests; wait for them to be answered.' });

  const id = newId('DPR');
  const create = db.transaction(() => {
    const reference = nextReference();
    db.prepare(`
      INSERT INTO data_principal_requests (id, reference, user_id, request_type, details, nominee_name, nominee_contact, due_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
    `).run(id, reference, req.user.id, type, text, type === 'NOMINATION' ? String(nomineeName).trim() : null,
      type === 'NOMINATION' ? String(nomineeContact).trim() : null, `+${RESOLVE_DAYS} days`);
    return reference;
  });
  const reference = create();
  logAudit({ req, user: req.user, action: 'DATA_REQUEST_RAISED', module: 'PRIVACY', entityType: 'data_principal_request', entityId: id, details: { type, reference } });
  for (const role of ['SJVN_ADMIN', 'IT_SUPER_ADMIN']) {
    pushNotification({ role, type: 'PRIVACY_REQUEST', message: `${reference}: ${type.toLowerCase()} request from ${req.user.name}`, link: '/settings/privacy-requests' });
  }
  res.status(201).json({ id, reference });
});

// ── Data Protection Officer ───────────────────────────────────────────────────
router.get('/admin/requests', requireRole(...DPO_ROLES), (req, res) => {
  const where = STATUSES.includes(req.query.status) ? 'WHERE r.status = ?' : '';
  const args = where ? [req.query.status] : [];
  res.json(db.prepare(`
    SELECT r.*, u.name AS user_name, u.email AS user_email
    FROM data_principal_requests r LEFT JOIN users u ON u.id = r.user_id
    ${where} ORDER BY r.created_at DESC LIMIT 1000
  `).all(...args));
});

router.patch('/admin/requests/:id', requireRole('SJVN_ADMIN', 'IT_SUPER_ADMIN'), (req, res) => {
  const row = db.prepare('SELECT * FROM data_principal_requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  const { status, response } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  const text = String(response || '').trim();
  const closing = ['RESOLVED', 'REJECTED'].includes(status);
  if (closing && !text) return res.status(400).json({ error: 'Say what was done, or why the request is refused, before closing it.' });
  if (row.user_id === req.user.id) return res.status(403).json({ error: 'A request cannot be decided by the person who raised it.' });
  db.prepare(`
    UPDATE data_principal_requests
    SET status = ?, response = ?, handled_by = ?, updated_at = datetime('now'),
        closed_at = CASE WHEN ? THEN datetime('now') ELSE NULL END
    WHERE id = ?
  `).run(status, text || row.response, req.user.id, closing ? 1 : 0, row.id);
  logAudit({ req, user: req.user, action: 'DATA_REQUEST_UPDATED', module: 'PRIVACY', entityType: 'data_principal_request', entityId: row.id, beforeValue: { status: row.status }, afterValue: { status } });
  pushNotification({ userId: row.user_id, type: 'PRIVACY_REQUEST', message: `${row.reference} is now ${status.replaceAll('_', ' ').toLowerCase()}`, link: '/settings/user-profile#privacy' });
  res.json(db.prepare('SELECT * FROM data_principal_requests WHERE id = ?').get(row.id));
});

router.get('/admin/declarations', requireRole(...DPO_ROLES), (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 2000);
  const args = [];
  let where = '';
  if (req.query.user_id) { where = 'WHERE user_id = ?'; args.push(String(req.query.user_id)); }
  res.json(db.prepare(`SELECT * FROM statutory_declarations ${where} ORDER BY rowid DESC LIMIT ?`).all(...args, limit));
});

export default router;
