/**
 * SJVN's own users on the platform.
 *
 * A seller's admin could add, re-level and switch off the company's people, and
 * SJVN's administrators could do the same for any company — but for SJVN's own
 * staff there was nothing: an officer who joined, moved desks or left was dealt
 * with in the database. This is that register.
 *
 * Who may do what:
 *   IT Super Admin      everyone;
 *   SJVN Administrator  everyone except IT Super Admins;
 *   REIA Administrator  the REIA desk's users;
 *   Trading Administrator  the trading desk's users.
 * Nobody acts on their own account, and the platform is never left without an
 * active administrator.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { requireAuth, canonicalRole } from '../middleware/auth.js';
import { newId, pushNotification } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { passwordComplaint, lockoutState, clearLoginAttempts } from './auth.js';
import { generatePassword } from './team.js';
import { betaRows } from '../services/reiaBeta.js';

const router = Router();
router.use(requireAuth);

const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, fn) => {
  try {
    res.json(fn());
  } catch (err) {
    if (!err.status) console.error('[STAFF]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
};
const audit = (req, action, entityId, extra = {}) => {
  try {
    secureLogAudit(req, { action, module: 'STAFF', entityType: 'user', entityId, ...extra });
  } catch (err) {
    console.error('[STAFF] audit failed', err.message);
  }
};
const text = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** SJVN's roles, most senior first, with what each is for. */
export const STAFF_ROLES = {
  IT_SUPER_ADMIN: { label: 'IT Super Administrator', desk: 'Administration', does: 'Runs the platform: users, system settings, masters and the audit trail. Reads every desk; enters no transactions.' },
  SJVN_ADMIN: { label: 'SJVN Administrator', desk: 'Administration', does: 'Masters, counterparty onboarding, SJVN\'s and the companies\' users, broadcasts and the audit trail. Reads every desk; enters no transactions.' },
  MANAGEMENT: { label: 'Management', desk: 'Management', does: 'Dashboards and reports across the verticals, and the approvals reserved for management. Does not enter data.' },
  COMMERCIAL_ADMIN: { label: 'Commercial Administrator (Hydro)', desk: 'Hydro', does: 'Hydro station billing, PAF, allocations, PTC billing, claims, ledgers and desk operations.' },
  THERMAL_ADMIN: { label: 'Thermal Administrator', desk: 'Thermal', does: 'Thermal station billing and its stakeholders, and manages the thermal desk\'s users.' },
  THERMAL_USER: { label: 'Thermal Desk', desk: 'Thermal', does: 'Thermal stakeholders, station data and billing.' },
  REIA_APPROVER: { label: 'REIA Approver (HOD)', desk: 'REIA', does: 'Final sanction on the REIA desk: the last approval level of invoices, deciding disputes, and the approvals reserved for the HOD. Does not enter data.' },
  REIA_CHECKER: { label: 'REIA Checker', desk: 'REIA', does: 'Scrutinises what the maker prepared — validates, approves the first level, verifies documents or sends back with observations. Does not prepare: a maker away is covered by an additional charge.' },
  REIA_MAKER: { label: 'REIA Maker', desk: 'REIA', does: 'Prepares: contracts, energy data, bills, disputes, payment security and reconciliation with sellers and buyers.' },
  FINANCE_USER: { label: 'Finance', desk: 'Finance', does: 'Payments and their confirmation against the bank, releases, TDS certificates and the SAP hand-over.' },
  TRADING_ADMIN: { label: 'Trading Administrator', desk: 'Trading', does: 'Everything the trading desk does, and manages the trading desk\'s users.' },
  TRADING_USER: { label: 'Trading Desk', desk: 'Trading', does: 'Bids, exchange contracts, scheduling, trading clients and their settlement.' },
  COMPLIANCE_AUDITOR: { label: 'Compliance / Audit', desk: 'Audit', does: 'Reads everything, including the audit trail. Changes nothing.' },
};
const ROLES = Object.keys(STAFF_ROLES);
const TOP = ['IT_SUPER_ADMIN', 'SJVN_ADMIN'];
/**
 * Which roles the holder of a role may add, change and switch off. Only the
 * platform administrators (Target #2 Phase B): a desk head who checks the
 * desk's transactions does not also create the people who make them. The desk
 * heads' former power over their desk's users is the SJVN Administrator's now.
 */
const MANAGES = {
  IT_SUPER_ADMIN: ROLES,
  SJVN_ADMIN: ROLES.filter((r) => r !== 'IT_SUPER_ADMIN'),
};

/** What each role reaches, section by section, as the navigation and the routes enforce it. */
const ACCESS = [
  ['Hydro billing — PAF, station billing, allocations, ledgers', { IT_SUPER_ADMIN: 'Read', SJVN_ADMIN: 'Read', MANAGEMENT: 'Read', COMMERCIAL_ADMIN: 'Full', FINANCE_USER: 'Read', COMPLIANCE_AUDITOR: 'Read' }],
  ['Thermal billing — stations, stakeholders, billing', { IT_SUPER_ADMIN: 'Read', SJVN_ADMIN: 'Read', MANAGEMENT: 'Read', THERMAL_ADMIN: 'Full', THERMAL_USER: 'Full', FINANCE_USER: 'Read' }],
  ['REIA billing & settlement — contracts, energy, invoices, disputes, security', { IT_SUPER_ADMIN: 'Read', SJVN_ADMIN: 'Read', MANAGEMENT: 'Approve', REIA_APPROVER: 'Approve', REIA_CHECKER: 'Check', REIA_MAKER: 'Prepare', FINANCE_USER: 'Read', COMPLIANCE_AUDITOR: 'Read' }],
  ['Payments — recording, confirming a buyer\'s payment, releases', { REIA_MAKER: 'Record', FINANCE_USER: 'Full' }],
  ['Power trading — bids, exchange, clients', { SJVN_ADMIN: 'Read', MANAGEMENT: 'Read', FINANCE_USER: 'Read', TRADING_ADMIN: 'Full', TRADING_USER: 'Full' }],
  ['Masters — banks, parameters, losses, holidays, lookups, document types', { IT_SUPER_ADMIN: 'Full', SJVN_ADMIN: 'Full' }],
  ['Companies\' users — reset or switch off a company admin', { IT_SUPER_ADMIN: 'Full', SJVN_ADMIN: 'Full' }],
  ['SJVN\'s own users — this page', { IT_SUPER_ADMIN: 'Full', SJVN_ADMIN: 'All but IT admins' }],
  ['Audit trail', { IT_SUPER_ADMIN: 'Read', SJVN_ADMIN: 'Read', COMPLIANCE_AUDITOR: 'Read' }],
].map(([what, by]) => ({ what, by }));

function scopeOf(user) {
  const manages = MANAGES[user.role];
  if (!manages) throw fail(403, 'Only an administrator manages SJVN\'s users');
  // A desk's administrator sees its own desk; the platform's administrators see everyone.
  const sees = TOP.includes(user.role) ? ROLES : [user.role, ...manages];
  return { manages, sees, top: TOP.includes(user.role) };
}
const isStaff = (u) => !!u && !u.linked_entity_id && ROLES.includes(u.role);
function memberFor(scope, id) {
  const m = db.prepare('SELECT * FROM users WHERE id = ?').get(String(id || ''));
  if (!isStaff(m) || !scope.sees.includes(m.role)) throw fail(404, 'User not found');
  return m;
}
const canManage = (scope, m, me) => scope.manages.includes(m.role) && m.id !== me.id;
const activeAdmins = (exceptId) => db.prepare(`SELECT COUNT(*) n FROM users WHERE role IN ('IT_SUPER_ADMIN','SJVN_ADMIN') AND is_active = 1 AND linked_entity_id IS NULL AND id <> ?`).get(exceptId || '').n;

function cleanEmail(v) {
  const email = text(v, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw fail(400, 'Enter a valid email address');
  return email;
}
function cleanPhone(v) {
  const phone = text(v, 20);
  if (phone && !/^\+?[0-9 -]{10,15}$/.test(phone)) throw fail(400, 'Enter a valid phone number');
  return phone || null;
}
function roleFor(scope, asked) {
  // A screen still offering the old REIA role names gets the roles they became.
  const role = canonicalRole(text(asked, 30).toUpperCase());
  if (!STAFF_ROLES[role]) throw fail(400, 'Choose a role');
  if (!scope.manages.includes(role)) throw fail(403, `You cannot give someone the ${STAFF_ROLES[role].label} role`);
  return role;
}

function view(scope, m, me, signIns) {
  const s = signIns.get(m.id) || {};
  const lock = lockoutState(m.email);
  const manage = canManage(scope, m, me);
  const name = (id) => (id ? db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || null : null);
  return {
    id: m.id, name: m.name, email: m.email, phone: m.phone || '', designation: m.designation || '',
    role: m.role, role_label: STAFF_ROLES[m.role].label, desk: STAFF_ROLES[m.role].desk,
    is_active: !!m.is_active, is_me: m.id === me.id, is_admin: TOP.includes(m.role),
    created_at: m.created_at, created_by_name: name(m.created_by),
    last_login_at: s.last_login || null, logins_30d: s.logins_30d || 0, never_signed_in: !s.last_login,
    must_change_password: !!m.must_change_password,
    locked: !!lock.locked, locked_minutes: lock.locked ? Math.ceil(lock.retryInSeconds / 60) : 0,
    deactivated_at: m.deactivated_at, deactivation_reason: m.deactivation_reason, deactivated_by_name: name(m.deactivated_by),
    can: {
      edit: manage || m.id === me.id, role: manage,
      deactivate: manage && !!m.is_active, reactivate: manage && !m.is_active,
      reset_password: manage && !!m.is_active, unlock: manage && !!lock.locked,
    },
  };
}

function health(members) {
  const active = members.filter((m) => m.is_active);
  const out = [];
  const admins = active.filter((m) => m.is_admin);
  if (admins.length === 1) out.push({ level: 'amber', text: `${admins[0].name} is the only active administrator. If that account is locked or its holder is away, nobody can add a user or reset a password. Give a second officer the administrator role.` });
  for (const [role, why] of [
    ['FINANCE_USER', 'nobody in Finance to confirm buyers\' payments or file TDS certificates'],
    // Phase B.2: the REIA desk's three tiers each do what the others may not.
    ['REIA_MAKER', 'nobody on the REIA desk to raise bills, record energy data or take documents in'],
    ['REIA_CHECKER', 'nobody on the REIA desk to approve a bill\'s first level, validate energy data or verify documents'],
    ['REIA_APPROVER', 'no REIA approver to sign a bill\'s last level or decide disputes (Management can, if it is told)'],
  ]) {
    if (!active.some((m) => m.role === role) && members.some((m) => m.role === role)) out.push({ level: 'red', text: `Every ${STAFF_ROLES[role].label} account is switched off — there is ${why}.` });
  }
  const stale = active.filter((m) => m.never_signed_in && (Date.now() - new Date(`${String(m.created_at).replace(' ', 'T')}Z`).getTime()) > 7 * 86400000);
  if (stale.length) out.push({ level: 'blue', text: `${stale.map((m) => m.name).join(', ')} ${stale.length === 1 ? 'has' : 'have'} never signed in, more than a week after being added. Switch off an account nobody is using.` });
  const locked = active.filter((m) => m.locked);
  if (locked.length) out.push({ level: 'red', text: `${locked.map((m) => m.name).join(', ')} ${locked.length === 1 ? 'is' : 'are'} locked out after repeated wrong passwords.` });
  return out;
}

function staff(req) {
  const scope = scopeOf(req.user);
  const rows = db.prepare(`SELECT * FROM users WHERE linked_entity_id IS NULL AND role IN (${scope.sees.map(() => '?').join(',')})`).all(...scope.sees);
  const ids = rows.map((r) => r.id);
  const signIns = new Map();
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    for (const r of db.prepare(`
      SELECT entity_id AS user_id, MAX(created_at) AS last_login,
        SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS logins_30d
      FROM audit_logs WHERE action = 'LOGIN' AND entity_id IN (${marks}) GROUP BY entity_id
    `).all(...ids)) signIns.set(r.user_id, r);
  }
  const members = rows.map((m) => view(scope, m, req.user, signIns))
    .sort((a, b) => (b.is_active - a.is_active) || (ROLES.indexOf(a.role) - ROLES.indexOf(b.role)) || a.name.localeCompare(b.name));
  const active = members.filter((m) => m.is_active);
  const desks = [...new Set(scope.sees.map((r) => STAFF_ROLES[r].desk))];
  return {
    can_manage: true, sees_everyone: scope.top,
    assignable_roles: scope.manages.map((r) => ({ value: r, label: STAFF_ROLES[r].label, does: STAFF_ROLES[r].does, desk: STAFF_ROLES[r].desk })),
    members,
    totals: {
      active: active.length, inactive: members.length - active.length,
      admins: active.filter((m) => m.is_admin).length,
      never_signed_in: active.filter((m) => m.never_signed_in).length,
      by_desk: desks.map((d) => ({ desk: d, count: active.filter((m) => m.desk === d).length })),
    },
    health: health(members),
    roles: scope.sees.map((r) => ({ role: r, ...STAFF_ROLES[r], count: active.filter((m) => m.role === r).length })),
    access: ACCESS, role_order: ROLES.filter((r) => scope.sees.includes(r)),
  };
}

router.get('/', (req, res) => send(res, () => staff(req)));

router.post('/', (req, res) => send(res, () => {
  const scope = scopeOf(req.user);
  const b = req.body || {};
  const name = text(b.name);
  if (name.length < 2) throw fail(400, 'Enter the officer\'s full name');
  const email = cleanEmail(b.email);
  const role = roleFor(scope, b.role);
  const phone = cleanPhone(b.phone);
  if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(email)) throw fail(409, 'That email address already has an account on the portal');
  const generated = !b.password;
  const password = generated ? generatePassword() : String(b.password);
  const complaint = passwordComplaint(password);
  if (complaint) throw fail(400, complaint);
  const id = newId('USR');
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, linked_entity_id, phone, designation, must_change_password, created_by)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 1, ?)
  `).run(id, name, email, bcrypt.hashSync(password, 10), role, phone, text(b.designation) || null, req.user.id);
  audit(req, 'STAFF_USER_ADDED', id, { afterValue: { name, email, role } });
  return { id, temporary_password: password, generated, team: staff(req) };
}));

router.patch('/:id', (req, res) => send(res, () => {
  const scope = scopeOf(req.user);
  const m = memberFor(scope, req.params.id);
  const self = m.id === req.user.id;
  const manage = canManage(scope, m, req.user);
  if (!manage && !self) throw fail(403, 'You cannot change this user');
  const b = req.body || {};
  const next = {
    name: b.name !== undefined ? text(b.name) : m.name,
    phone: b.phone !== undefined ? cleanPhone(b.phone) : m.phone,
    designation: b.designation !== undefined ? text(b.designation) || null : m.designation,
    role: m.role,
  };
  if (next.name.length < 2) throw fail(400, 'Enter the officer\'s full name');
  if (b.role !== undefined && b.role !== m.role) {
    if (self) throw fail(403, 'You cannot change your own role');
    if (!manage) throw fail(403, 'You cannot change this user\'s role');
    next.role = roleFor(scope, b.role);
    if (TOP.includes(m.role) && !TOP.includes(next.role) && m.is_active && activeAdmins(m.id) === 0) {
      throw fail(400, 'This is the only active administrator. Make someone else an administrator first.');
    }
  }
  const roleChanged = next.role !== m.role;
  const before = { name: m.name, phone: m.phone, designation: m.designation, role: m.role };
  if (JSON.stringify(before) === JSON.stringify(next)) throw fail(400, 'Nothing was changed');
  // A token carries the role it was issued with, so a change of role ends the user's sessions.
  db.prepare('UPDATE users SET name = ?, phone = ?, designation = ?, role = ?, sessions_revoked_at = CASE WHEN ? THEN ? ELSE sessions_revoked_at END WHERE id = ?')
    .run(next.name, next.phone, next.designation, next.role, roleChanged ? 1 : 0, nowSeconds(), m.id);
  audit(req, roleChanged ? 'STAFF_ROLE_CHANGED' : 'STAFF_USER_UPDATED', m.id, { beforeValue: before, afterValue: next });
  if (roleChanged) pushNotification({ userId: m.id, type: 'STAFF', message: `Your role was changed to ${STAFF_ROLES[next.role].label} by ${req.user.name}. Sign in again to use it.` });
  return staff(req);
}));

router.post('/:id/deactivate', (req, res) => send(res, () => {
  const scope = scopeOf(req.user);
  const m = memberFor(scope, req.params.id);
  if (m.id === req.user.id) throw fail(400, 'You cannot switch off your own account');
  if (!canManage(scope, m, req.user)) throw fail(403, 'You cannot switch off this user');
  if (!m.is_active) throw fail(400, 'This account is already switched off');
  if (TOP.includes(m.role) && activeAdmins(m.id) === 0) throw fail(400, 'This is the only active administrator and cannot be switched off');
  const reason = text(req.body?.reason, 300);
  if (!reason) throw fail(400, 'Say why the account is being switched off');
  db.prepare(`UPDATE users SET is_active = 0, deactivated_at = datetime('now'), deactivated_by = ?, deactivation_reason = ?, sessions_revoked_at = ? WHERE id = ?`)
    .run(req.user.id, reason, nowSeconds(), m.id);
  audit(req, 'STAFF_USER_DEACTIVATED', m.id, { beforeValue: { is_active: 1 }, afterValue: { is_active: 0 }, reason });
  return staff(req);
}));

router.post('/:id/reactivate', (req, res) => send(res, () => {
  const scope = scopeOf(req.user);
  const m = memberFor(scope, req.params.id);
  if (!canManage(scope, m, req.user)) throw fail(403, 'You cannot switch on this user');
  if (m.is_active) throw fail(400, 'This account is already active');
  db.prepare('UPDATE users SET is_active = 1, deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL WHERE id = ?').run(m.id);
  audit(req, 'STAFF_USER_REACTIVATED', m.id, { beforeValue: { is_active: 0 }, afterValue: { is_active: 1 } });
  return staff(req);
}));

router.post('/:id/reset-password', (req, res) => send(res, () => {
  const scope = scopeOf(req.user);
  const m = memberFor(scope, req.params.id);
  if (!canManage(scope, m, req.user)) throw fail(403, m.id === req.user.id ? 'Change your own password from the profile menu' : 'You cannot reset this user\'s password');
  if (!m.is_active) throw fail(400, 'Switch the account on before resetting its password');
  const password = generatePassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, sessions_revoked_at = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), nowSeconds(), m.id);
  clearLoginAttempts(m.email);
  audit(req, 'STAFF_PASSWORD_RESET', m.id, {});
  return { temporary_password: password, generated: true, team: staff(req) };
}));

router.post('/:id/unlock', (req, res) => send(res, () => {
  const scope = scopeOf(req.user);
  const m = memberFor(scope, req.params.id);
  if (!canManage(scope, m, req.user)) throw fail(403, 'You cannot unlock this user');
  clearLoginAttempts(m.email);
  audit(req, 'STAFF_USER_UNLOCKED', m.id, {});
  return staff(req);
}));

const WORDS = {
  LOGIN: 'Signed in', LOGIN_FAILED: 'Failed sign-in', LOGIN_BLOCKED: 'Sign-in blocked (locked out)', PASSWORD_CHANGED: 'Changed their password',
  PASSWORD_CHANGE_FAILED: 'Failed password change', ACCESS_DENIED: 'Tried something their role does not allow',
  STAFF_USER_ADDED: 'Added', STAFF_USER_UPDATED: 'Details corrected', STAFF_ROLE_CHANGED: 'Role changed', STAFF_USER_DEACTIVATED: 'Account switched off',
  STAFF_USER_REACTIVATED: 'Account switched on', STAFF_PASSWORD_RESET: 'Password reset', STAFF_USER_UNLOCKED: 'Unlocked',
};
const words = (a) => WORDS[a.action] || a.action.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

router.get('/history', (req, res) => send(res, () => {
  const scope = scopeOf(req.user);
  const members = db.prepare(`SELECT id, name FROM users WHERE linked_entity_id IS NULL AND role IN (${scope.sees.map(() => '?').join(',')})`).all(...scope.sees);
  if (!members.length) return [];
  const names = new Map(members.map((m) => [m.id, m.name]));
  return db.prepare(`
    SELECT id, action, entity_id, user_name, before_value, after_value, reason, created_at FROM audit_logs
    WHERE module = 'STAFF' AND entity_id IN (${members.map(() => '?').join(',')}) ORDER BY created_at DESC, rowid DESC LIMIT 150
  `).all(...members.map((m) => m.id)).map((a) => {
    const before = parse(a.before_value);
    const after = parse(a.after_value);
    let detail = a.reason || '';
    if (a.action === 'STAFF_ROLE_CHANGED' && before && after) detail = `${STAFF_ROLES[before.role]?.label || before.role} → ${STAFF_ROLES[after.role]?.label || after.role}`;
    if (a.action === 'STAFF_USER_ADDED' && after) detail = `${STAFF_ROLES[after.role]?.label || after.role} · ${after.email}`;
    if (a.action === 'STAFF_USER_UPDATED' && before && after) detail = ['name', 'phone', 'designation'].filter((k) => before[k] !== after[k]).map((k) => `${k}: ${before[k] || '—'} → ${after[k] || '—'}`).join('; ');
    return { id: a.id, what: words(a), member_name: names.get(a.entity_id) || '—', by: a.user_name, detail, at: a.created_at };
  });
}));

router.get('/:id/activity', (req, res) => send(res, () => {
  const scope = scopeOf(req.user);
  const m = memberFor(scope, req.params.id);
  return db.prepare(`
    SELECT id, action, module, entity_type, entity_id, ip_address, created_at FROM audit_logs
    WHERE user_id = ? OR (entity_id = ? AND action IN ('LOGIN', 'LOGIN_FAILED')) ORDER BY created_at DESC, rowid DESC LIMIT 80
  `).all(m.id, m.id).map((a) => ({ id: a.id, what: words(a), module: a.module, on: [a.entity_type, a.entity_id].filter(Boolean).join(' '), ip: a.ip_address, at: a.created_at }));
}));

router.get('/export.csv', (req, res) => {
  try {
    const t = staff(req);
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Name', 'Email', 'Phone', 'Designation', 'Role', 'Desk', 'Status', 'Added on', 'Added by', 'Last sign-in', 'Sign-ins (30 days)', 'Switched off on', 'Reason'].map(cell).join(',')];
    for (const m of betaRows(t.members)) {
      lines.push([m.name, m.email, m.phone, m.designation, m.role_label, m.desk, m.is_active ? 'Active' : 'Switched off', m.created_at, m.created_by_name || '',
        m.last_login_at || 'Never', m.logins_30d, m.deactivated_at || '', m.deactivation_reason || ''].map(cell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sjvn-users-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${lines.join('\r\n')}`);
  } catch (err) {
    if (!err.status) console.error('[STAFF]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
});

export default router;
