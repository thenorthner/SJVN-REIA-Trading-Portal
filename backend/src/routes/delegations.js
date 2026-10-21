import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, PLATFORM_ADMINS, canonicalRole } from '../middleware/auth.js';
import { newId, logAudit, notifyRoles, pushNotification } from '../util.js';

/**
 * Target #2, Phase D — so strict four-eyes and project scope never freeze a desk.
 *
 * Additional charge: the administrator records, for dated days, who holds an
 * absent officer's charge. The delegate then switches to "acting for" them
 * (middleware/auth.js applyActing) and works in their role on their projects.
 *
 * Break-glass: an officer asks for a role they do not hold, for a few hours,
 * when nobody who holds it can act. It opens only when two different people
 * approve — at least one from Management, neither of them the requester — and
 * closes by itself. Every change made under it is its own audit row.
 */
const router = Router();
router.use(requireAuth);

// The desk roles that can be handed over. Never an administrator's: they do not transact.
export const DELEGABLE_ROLES = [
  'REIA_MAKER', 'REIA_CHECKER', 'REIA_APPROVER',
  'COMMERCIAL_ADMIN', 'COMMERCIAL', 'COMMERCIAL_USER', 'THERMAL_ADMIN', 'THERMAL_USER',
  'TRADING_USER', 'TRADING_ADMIN', 'FINANCE_USER', 'MANAGEMENT',
];
const BG_APPROVERS = ['MANAGEMENT', ...PLATFORM_ADMINS];
const READERS = [...PLATFORM_ADMINS, 'MANAGEMENT', 'COMPLIANCE_AUDITOR'];
const MAX_CHARGE_DAYS = 90;
const MAX_BG_HOURS = 72;

const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, fn) => {
  try { res.json(fn()); } catch (err) {
    if (!err.status) console.error('[DELEGATION]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
};
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));
const internalUser = (id) => db.prepare('SELECT id, name, role, is_active, linked_entity_id FROM users WHERE id = ?').get(String(id || ''));
const realRole = (u) => u.real?.role || u.role;
const realName = (u) => u.real?.name || u.name;

// ── What the signed-in officer may act as ───────────────────────────────────
router.get('/mine', (req, res) => send(res, () => {
  const charges = db.prepare(`
    SELECT d.id, d.role, d.valid_from, d.valid_to, d.contract_ids_json, u.name AS for_name
    FROM role_delegations d JOIN users u ON u.id = d.delegator_id
    WHERE d.delegate_id = ? AND d.revoked_at IS NULL AND ? BETWEEN d.valid_from AND d.valid_to
    ORDER BY d.valid_to
  `).all(req.user.id, istToday());
  const grants = db.prepare(`
    SELECT id, role, expires_at FROM break_glass_grants
    WHERE user_id = ? AND status = 'ACTIVE' AND expires_at > datetime('now') ORDER BY expires_at
  `).all(req.user.id);
  return {
    acting: req.user.acting || null,
    real_role: realRole(req.user),
    options: [
      ...charges.map((c) => ({ value: `DLG:${c.id}`, kind: 'DLG', role: c.role, for_name: c.for_name, until: c.valid_to, projects: c.contract_ids_json ? JSON.parse(c.contract_ids_json).length : null })),
      ...grants.map((g) => ({ value: `BG:${g.id}`, kind: 'BG', role: g.role, until: g.expires_at })),
    ],
  };
}));

// ── Additional charge ───────────────────────────────────────────────────────
router.get('/', requireRole(...READERS), (req, res) => send(res, () => db.prepare(`
  SELECT d.*, a.name AS delegator_name, b.name AS delegate_name, b.role AS delegate_role, c.name AS created_by_name,
    CASE WHEN d.revoked_at IS NOT NULL THEN 'REVOKED'
         WHEN ? < d.valid_from THEN 'UPCOMING'
         WHEN ? > d.valid_to THEN 'ENDED' ELSE 'IN_FORCE' END AS state
  FROM role_delegations d
  JOIN users a ON a.id = d.delegator_id JOIN users b ON b.id = d.delegate_id LEFT JOIN users c ON c.id = d.created_by
  ORDER BY d.created_at DESC LIMIT 500
`).all(istToday(), istToday())));

router.post('/', requireRole(...PLATFORM_ADMINS), (req, res) => send(res, () => {
  const { delegator_id: from, delegate_id: to, valid_from: start, valid_to: end } = req.body || {};
  const reason = String(req.body?.reason || '').trim();
  const a = internalUser(from);
  const b = internalUser(to);
  if (!a || !a.is_active || a.linked_entity_id) throw fail(400, 'Choose the officer who is away');
  if (!b || !b.is_active || b.linked_entity_id) throw fail(400, 'Choose the officer who will hold the charge');
  if (a.id === b.id) throw fail(400, 'An officer cannot hold their own charge');
  const role = canonicalRole(a.role);
  if (!DELEGABLE_ROLES.includes(role)) throw fail(400, `${a.name}'s role is not one that is handed over`);
  if (PLATFORM_ADMINS.includes(b.role)) throw fail(400, 'An administrator does not transact, so cannot hold a desk charge');
  if (!isDate(start) || !isDate(end)) throw fail(400, 'Give the first and last day of the charge (YYYY-MM-DD)');
  if (end < start) throw fail(400, 'The charge ends before it starts');
  if (end < istToday()) throw fail(400, 'The charge would already be over');
  if ((Date.parse(end) - Date.parse(start)) / 86400000 + 1 > MAX_CHARGE_DAYS) throw fail(400, `A charge runs for at most ${MAX_CHARGE_DAYS} days; record a new one to extend it`);
  if (reason.length < 5) throw fail(400, 'Say why (leave, tour, training …) and the office order, if any');
  let contracts = null;
  if (Array.isArray(req.body?.contract_ids) && req.body.contract_ids.length) {
    contracts = [...new Set(req.body.contract_ids.map(String))];
    const known = new Set(db.prepare(`SELECT id FROM contracts WHERE id IN (${contracts.map(() => '?').join(',')})`).all(...contracts).map((r) => r.id));
    const unknown = contracts.filter((c) => !known.has(c));
    if (unknown.length) throw fail(400, `Not a contract: ${unknown.join(', ')}`);
  }
  const id = newId('DLG');
  db.prepare(`
    INSERT INTO role_delegations (id, delegator_id, delegate_id, role, contract_ids_json, valid_from, valid_to, reason, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, a.id, b.id, role, contracts ? JSON.stringify(contracts) : null, start, end, reason, req.user.id);
  logAudit({ req, user: req.user, action: 'ADDITIONAL_CHARGE_GIVEN', module: 'GOVERNANCE', entityType: 'role_delegation', entityId: id, afterValue: { delegator: a.name, delegate: b.name, role, from: start, to: end, contracts }, reason });
  const msg = `${b.name} holds ${a.name}'s charge (${role.replace(/_/g, ' ').toLowerCase()}) from ${start} to ${end}${contracts ? ` on ${contracts.length} project(s)` : ''}.`;
  pushNotification({ userId: b.id, type: 'ADDITIONAL_CHARGE', message: `${msg} Switch to "acting for ${a.name}" from the top bar to act.`, link: '/settings/delegations' });
  pushNotification({ userId: a.id, type: 'ADDITIONAL_CHARGE', message: msg, link: '/settings/delegations' });
  return db.prepare('SELECT * FROM role_delegations WHERE id = ?').get(id);
}));

router.post('/:id/revoke', requireRole(...PLATFORM_ADMINS), (req, res) => send(res, () => {
  const d = db.prepare('SELECT * FROM role_delegations WHERE id = ?').get(req.params.id);
  if (!d) throw fail(404, 'Charge not found');
  if (d.revoked_at) throw fail(400, 'This charge was already withdrawn');
  db.prepare(`UPDATE role_delegations SET revoked_at = datetime('now'), revoked_by = ? WHERE id = ?`).run(req.user.id, d.id);
  logAudit({ req, user: req.user, action: 'ADDITIONAL_CHARGE_WITHDRAWN', module: 'GOVERNANCE', entityType: 'role_delegation', entityId: d.id, reason: String(req.body?.reason || '').trim() || null });
  pushNotification({ userId: d.delegate_id, type: 'ADDITIONAL_CHARGE', message: 'An additional charge you held was withdrawn; you work as yourself again.' });
  return { id: d.id, revoked: true };
}));

// ── Break-glass ─────────────────────────────────────────────────────────────
const grantRow = (id) => db.prepare(`
  SELECT g.*, u.name AS user_name, u.role AS user_role FROM break_glass_grants g JOIN users u ON u.id = g.user_id WHERE g.id = ?
`).get(id);

// Lazily close grants whose time is up, so every list reads true.
const expireOld = () => db.prepare(`UPDATE break_glass_grants SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at <= datetime('now')`).run();

router.get('/break-glass', (req, res) => send(res, () => {
  expireOld();
  const sees = [...READERS].includes(realRole(req.user));
  const rows = db.prepare(`
    SELECT g.*, u.name AS user_name, u.role AS user_role FROM break_glass_grants g JOIN users u ON u.id = g.user_id
    ${sees ? '' : 'WHERE g.user_id = ?'} ORDER BY g.created_at DESC LIMIT 300
  `).all(...(sees ? [] : [req.user.id]));
  const me = req.user.id;
  return rows.map((g) => ({
    ...g,
    can_approve: g.status === 'REQUESTED' && BG_APPROVERS.includes(realRole(req.user)) && g.user_id !== me && g.approver1_id !== me
      && !(g.approver1_id && g.approver1_role !== 'MANAGEMENT' && realRole(req.user) !== 'MANAGEMENT'),
  }));
}));

router.post('/break-glass', (req, res) => send(res, () => {
  if (req.user.acting) throw fail(400, 'Ask for break-glass as yourself, not while acting for someone');
  const me = internalUser(req.user.id);
  if (!me || me.linked_entity_id || PLATFORM_ADMINS.includes(me.role) || me.role === 'COMPLIANCE_AUDITOR') {
    throw fail(403, 'Break-glass is for SJVN desk officers');
  }
  const role = canonicalRole(String(req.body?.role || '').toUpperCase());
  if (!DELEGABLE_ROLES.includes(role)) throw fail(400, 'Choose the desk role you need');
  if (role === canonicalRole(me.role)) throw fail(400, 'You already hold that role');
  const hours = Math.round(Number(req.body?.hours) || 0);
  if (hours < 1 || hours > MAX_BG_HOURS) throw fail(400, `Ask for between 1 and ${MAX_BG_HOURS} hours`);
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 15) throw fail(400, 'Say what cannot wait, and why nobody who holds the role can act (at least 15 characters)');
  if (db.prepare("SELECT 1 FROM break_glass_grants WHERE user_id = ? AND role = ? AND status IN ('REQUESTED','ACTIVE') AND (expires_at IS NULL OR expires_at > datetime('now'))").get(me.id, role)) {
    throw fail(409, 'You already have a request or an open grant for that role');
  }
  const id = newId('BGG');
  db.prepare('INSERT INTO break_glass_grants (id, user_id, role, hours, reason) VALUES (?, ?, ?, ?, ?)').run(id, me.id, role, hours, reason);
  logAudit({ req, user: req.user, action: 'BREAK_GLASS_REQUESTED', module: 'GOVERNANCE', entityType: 'break_glass_grant', entityId: id, afterValue: { role, hours }, reason });
  notifyRoles(BG_APPROVERS, { type: 'BREAK_GLASS', message: `${me.name} asks for break-glass access as ${role.replace(/_/g, ' ').toLowerCase()} for ${hours} h: ${reason}`, link: '/settings/delegations' });
  return grantRow(id);
}));

router.post('/break-glass/:id/approve', (req, res) => send(res, () => {
  expireOld();
  const g = grantRow(req.params.id);
  if (!g) throw fail(404, 'Request not found');
  const role = realRole(req.user);
  if (req.user.acting) throw fail(403, 'Approve as yourself, not while acting for someone');
  if (!BG_APPROVERS.includes(role)) throw fail(403, 'Break-glass is approved by Management or the SJVN / IT administrator');
  if (g.status !== 'REQUESTED') throw fail(400, `This request is ${g.status.toLowerCase()}`);
  if (g.user_id === req.user.id) throw fail(403, 'Nobody approves their own break-glass');
  if (g.approver1_id === req.user.id) throw fail(403, 'A second, different approver is needed');
  if (!g.approver1_id) {
    db.prepare(`UPDATE break_glass_grants SET approver1_id = ?, approver1_name = ?, approver1_role = ?, approved1_at = datetime('now') WHERE id = ?`)
      .run(req.user.id, realName(req.user), role, g.id);
    logAudit({ req, user: req.user, action: 'BREAK_GLASS_APPROVED_FIRST', module: 'GOVERNANCE', entityType: 'break_glass_grant', entityId: g.id });
    return { ...grantRow(g.id), message: 'Recorded. A second approver is needed before it opens.' };
  }
  if (g.approver1_role !== 'MANAGEMENT' && role !== 'MANAGEMENT') {
    throw fail(403, 'One of the two approvals must come from Management');
  }
  db.prepare(`
    UPDATE break_glass_grants SET approver2_id = ?, approver2_name = ?, approver2_role = ?, approved2_at = datetime('now'),
      status = 'ACTIVE', activated_at = datetime('now'), expires_at = datetime('now', ?) WHERE id = ?
  `).run(req.user.id, realName(req.user), role, `+${g.hours} hours`, g.id);
  const open = grantRow(g.id);
  logAudit({ req, user: req.user, action: 'BREAK_GLASS_OPENED', module: 'GOVERNANCE', entityType: 'break_glass_grant', entityId: g.id, afterValue: { user: g.user_name, role: g.role, expires_at: open.expires_at } });
  pushNotification({ userId: g.user_id, type: 'BREAK_GLASS', message: `Your break-glass access as ${g.role.replace(/_/g, ' ').toLowerCase()} is open until ${open.expires_at} UTC. Switch to it from the top bar; everything you do under it is flagged.`, link: '/settings/delegations' });
  notifyRoles(['COMPLIANCE_AUDITOR', 'SJVN_ADMIN'], { type: 'BREAK_GLASS', message: `Break-glass opened: ${g.user_name} as ${g.role} for ${g.hours} h, approved by ${g.approver1_name} and ${realName(req.user)}. Reason: ${g.reason}`, link: '/settings/delegations' });
  return open;
}));

router.post('/break-glass/:id/reject', (req, res) => send(res, () => {
  const g = grantRow(req.params.id);
  if (!g) throw fail(404, 'Request not found');
  if (!BG_APPROVERS.includes(realRole(req.user)) || req.user.acting) throw fail(403, 'Break-glass is decided by Management or the SJVN / IT administrator');
  if (g.status !== 'REQUESTED') throw fail(400, `This request is ${g.status.toLowerCase()}`);
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) throw fail(400, 'Say why it is refused');
  db.prepare(`UPDATE break_glass_grants SET status = 'REJECTED', rejected_by = ?, rejected_at = datetime('now'), rejection_reason = ? WHERE id = ?`).run(realName(req.user), reason, g.id);
  logAudit({ req, user: req.user, action: 'BREAK_GLASS_REJECTED', module: 'GOVERNANCE', entityType: 'break_glass_grant', entityId: g.id, reason });
  pushNotification({ userId: g.user_id, type: 'BREAK_GLASS', message: `Your break-glass request was refused: ${reason}` });
  return grantRow(g.id);
}));

// Ended early — by the officer who holds it, or by an administrator.
router.post('/break-glass/:id/revoke', (req, res) => send(res, () => {
  const g = grantRow(req.params.id);
  if (!g) throw fail(404, 'Request not found');
  const mine = g.user_id === req.user.id;
  if (!mine && !PLATFORM_ADMINS.includes(realRole(req.user))) throw fail(403, 'Only the holder or an administrator ends it');
  if (!['REQUESTED', 'ACTIVE'].includes(g.status)) throw fail(400, `This grant is already ${g.status.toLowerCase()}`);
  db.prepare(`UPDATE break_glass_grants SET status = 'REVOKED', revoked_by = ?, revoked_at = datetime('now') WHERE id = ?`).run(realName(req.user), g.id);
  logAudit({ req, user: req.user, action: 'BREAK_GLASS_ENDED', module: 'GOVERNANCE', entityType: 'break_glass_grant', entityId: g.id });
  return grantRow(g.id);
}));

export default router;
