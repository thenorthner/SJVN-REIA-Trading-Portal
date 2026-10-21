/**
 * A counterparty company's own users on the portal.
 *
 * routes/users.js could add a user and switch one on or off, and that was all:
 * no way to correct a name, move someone from maker to checker, or get a person
 * back in after a forgotten password, and nothing stopping an admin from
 * switching off their own account. This is the team as the company's admin
 * actually has to run it.
 *
 * Who may do what:
 *   the Company Admin (role SELLER / BUYER) manages everyone else;
 *   an Approver (L3) manages makers and checkers;
 *   a maker or checker sees the team and may correct their own contact details.
 * The Company Admin's own account is the company's registration with SJVN, so it
 * is never switched off or re-roled from here.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../db/index.js';
import { requireAuth, counterpartySide } from '../middleware/auth.js';
import { newId, pushNotification } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { getParamNumber } from '../mastersService.js';
import { passwordComplaint, lockoutState, clearLoginAttempts } from './auth.js';

const router = Router();
router.use(requireAuth);

// Companies' teams are managed by the platform administrators only (Target #2
// Phase B); the REIA checker held this before and no longer creates users.
const SJVN_ADMINS = ['SJVN_ADMIN', 'IT_SUPER_ADMIN'];
const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, fn) => {
  try {
    res.json(fn());
  } catch (err) {
    if (!err.status) console.error('[TEAM]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
};
const audit = (req, action, entityId, extra = {}) => {
  try {
    secureLogAudit(req, { action, module: 'TEAM', entityType: 'user', entityId, ...extra });
  } catch (err) {
    console.error('[TEAM] audit failed', err.message);
  }
};
const text = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const nowSeconds = () => Math.floor(Date.now() / 1000);

export const ROLE_INFO = {
  ADMIN: { label: 'Company Admin', level: 4, does: 'Runs the company\'s account with SJVN: manages the team, and can do everything a checker can.' },
  L3: { label: 'Level 3 — Approver', level: 3, does: 'Approves and submits to SJVN, and manages makers and checkers.' },
  L2: { label: 'Level 2 — Checker', level: 2, does: 'Reviews what a maker prepared, then approves and submits it to SJVN.' },
  L1: { label: 'Level 1 — Maker', level: 1, does: 'Prepares invoices and documents and sends them to a checker. Cannot submit to SJVN alone.' },
};
const tierOf = (role) => (/_L([123])$/.exec(role || '') ? `L${/_L([123])$/.exec(role)[1]}` : 'ADMIN');

/** What each level may do, as the portal actually enforces it — in the words of the side reading it. */
const matrix = (rows) => rows.map(([what, l1, l2, l3, admin]) => ({ what, L1: l1, L2: l2, L3: l3, ADMIN: admin }));
const PERMISSIONS = {
  SELLER: matrix([
    ['See contracts, energy data, invoices, payments and disputes', true, true, true, true],
    ['Prepare an invoice or upload a document', true, true, true, true],
    ['Approve a maker\'s draft and submit it to SJVN', false, true, true, true],
    ['Submit KYC documents for SJVN\'s verification', false, true, true, true],
    ['Raise a dispute, sign a reconciliation, request a release', true, true, true, true],
    ['Add makers and checkers, reset their passwords, switch them off', false, false, true, true],
    ['Add or change an Approver (Level 3)', false, false, false, true],
  ]),
  BUYER: matrix([
    ['See PSAs, allocated energy, bills, payments and disputes', true, true, true, true],
    ['Prepare a payment intimation or upload a document', true, true, true, true],
    ['Send a payment intimation to SJVN Finance (a maker\'s needs a checker first)', false, true, true, true],
    ['Submit KYC documents and file a TDS certificate (Form 16A)', false, true, true, true],
    ['Raise a dispute, sign a reconciliation, request a release', true, true, true, true],
    ['Add makers and checkers, reset their passwords, switch them off', false, false, true, true],
    ['Add or change an Approver (Level 3)', false, false, false, true],
  ]),
};
const ROLE_DOES = {
  SELLER: {},
  BUYER: {
    L2: 'Reviews what a maker prepared — a payment intimation, a document — and sends it to SJVN.',
    L1: 'Prepares payment intimations and documents and sends them to a checker. Cannot send them to SJVN alone.',
  },
};

// ── Whose team, and what the caller may do in it ────────────────────────────

function scopeOf(req) {
  const u = req.user;
  const side = counterpartySide(u);
  if (side) {
    if (!u.linked_entity_id) throw fail(403, 'Your account is not linked to a company');
    const tier = tierOf(u.role);
    return { entityId: u.linked_entity_id, side, tier, internal: false, manages: tier === 'ADMIN' ? ['L1', 'L2', 'L3'] : tier === 'L3' ? ['L1', 'L2'] : [] };
  }
  if (SJVN_ADMINS.includes(u.role)) {
    const entityId = text(req.query.entity_id || req.body?.entity_id, 80);
    if (!entityId) throw fail(400, 'Say which company\'s team — pass entity_id');
    const ent = db.prepare('SELECT entity_type FROM entities WHERE id = ?').get(entityId);
    if (!ent) throw fail(404, 'Company not found');
    // The company's own admin account has nobody above it inside the company:
    // only SJVN can get its holder back in, or switch it off when they leave.
    return { entityId, side: ent.entity_type, tier: 'SJVN', internal: true, manages: ['L1', 'L2', 'L3', 'ADMIN'] };
  }
  throw fail(403, 'Not authorized');
}

function memberFor(scope, id) {
  const m = db.prepare('SELECT * FROM users WHERE id = ?').get(String(id || ''));
  if (!m || m.linked_entity_id !== scope.entityId || !counterpartySide(m)) throw fail(404, 'Team member not found');
  return m;
}
const canManage = (scope, member, me) => scope.manages.includes(tierOf(member.role)) && member.id !== me.id;

export function generatePassword() {
  // Readable when dictated over the phone: no 0/O, 1/l/I.
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const pick = (set, n) => Array.from(crypto.randomBytes(n), (b) => set[b % set.length]).join('');
  return `${pick(letters, 4)}-${pick(digits, 4)}-${pick(letters, 4)}`;
}

function tellAdmins(scope, exceptId, message) {
  try {
    const admins = db.prepare(`SELECT id, role FROM users WHERE linked_entity_id = ? AND is_active = 1`).all(scope.entityId)
      .filter((u) => ['ADMIN', 'L3'].includes(tierOf(u.role)) && counterpartySide(u) && u.id !== exceptId);
    for (const a of admins) pushNotification({ userId: a.id, type: 'TEAM', message });
  } catch { /* the change stands; the bell is a courtesy */ }
}

// ── The team ────────────────────────────────────────────────────────────────

function view(scope, m, me, signIns) {
  const tier = tierOf(m.role);
  const s = signIns.get(m.id) || {};
  const lock = lockoutState(m.email);
  const manage = canManage(scope, m, me);
  return {
    id: m.id, name: m.name, email: m.email, phone: m.phone || '', designation: m.designation || '',
    role: m.role, tier, role_label: ROLE_INFO[tier].label,
    is_active: !!m.is_active, is_me: m.id === me.id, is_owner: tier === 'ADMIN',
    created_at: m.created_at,
    created_by_name: m.created_by ? db.prepare('SELECT name FROM users WHERE id = ?').get(m.created_by)?.name || null : null,
    last_login_at: s.last_login || null,
    logins_30d: s.logins_30d || 0,
    last_activity_at: s.last_activity || null,
    never_signed_in: !s.last_login,
    must_change_password: !!m.must_change_password,
    locked: !!lock.locked,
    locked_minutes: lock.locked ? Math.ceil(lock.retryInSeconds / 60) : 0,
    deactivated_at: m.deactivated_at, deactivation_reason: m.deactivation_reason,
    deactivated_by_name: m.deactivated_by ? db.prepare('SELECT name FROM users WHERE id = ?').get(m.deactivated_by)?.name || null : null,
    can: {
      edit: manage || m.id === me.id,
      role: manage && tier !== 'ADMIN',
      deactivate: manage && !!m.is_active,
      reactivate: manage && !m.is_active,
      reset_password: manage && !!m.is_active,
      unlock: manage && !!lock.locked,
    },
  };
}

function health(members) {
  const active = members.filter((m) => m.is_active);
  const makers = active.filter((m) => m.tier === 'L1');
  const checkers = active.filter((m) => ['L2', 'L3'].includes(m.tier));
  const out = [];
  if (!makers.length && !checkers.length) {
    out.push({ level: 'amber', text: 'Only the Company Admin is on the portal, so everything sent to SJVN is prepared and submitted by one person. Add a maker and a checker to have each submission seen by two people.' });
  } else if (makers.length && !checkers.length) {
    out.push({ level: 'amber', text: 'There is a maker but no checker or approver. What a maker prepares can only be approved by the Company Admin — if the admin is away, nothing can be submitted to SJVN.' });
  } else if (!makers.length && checkers.length) {
    out.push({ level: 'blue', text: 'There is no maker. Checkers and the admin submit to SJVN directly, without a second person reviewing.' });
  }
  const stale = active.filter((m) => m.never_signed_in && !m.is_owner && (Date.now() - new Date(`${String(m.created_at).replace(' ', 'T')}Z`).getTime()) > 7 * 86400000);
  if (stale.length) out.push({ level: 'blue', text: `${stale.map((m) => m.name).join(', ')} ${stale.length === 1 ? 'has' : 'have'} never signed in, more than a week after being added. Switch off an account nobody is using.` });
  const locked = active.filter((m) => m.locked);
  if (locked.length) out.push({ level: 'red', text: `${locked.map((m) => m.name).join(', ')} ${locked.length === 1 ? 'is' : 'are'} locked out after repeated wrong passwords.` });
  return out;
}

function team(req) {
  const scope = scopeOf(req);
  const rows = db.prepare('SELECT * FROM users WHERE linked_entity_id = ? ORDER BY is_active DESC, created_at').all(scope.entityId)
    .filter((u) => counterpartySide(u));
  const ids = rows.map((r) => r.id);
  const signIns = new Map();
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    // A sign-in is recorded before there is a session, so it carries the account
    // in entity_id, not user_id.
    for (const r of db.prepare(`
      SELECT entity_id AS user_id, MAX(created_at) AS last_login,
        SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS logins_30d
      FROM audit_logs WHERE action = 'LOGIN' AND entity_id IN (${marks}) GROUP BY entity_id
    `).all(...ids)) signIns.set(r.user_id, r);
    for (const r of db.prepare(`SELECT user_id, MAX(created_at) AS last_activity FROM audit_logs WHERE user_id IN (${marks}) GROUP BY user_id`).all(...ids)) {
      signIns.set(r.user_id, { ...(signIns.get(r.user_id) || {}), last_activity: r.last_activity });
    }
  }
  const members = rows.map((m) => view(scope, m, req.user, signIns));
  const order = { ADMIN: 0, L3: 1, L2: 2, L1: 3 };
  members.sort((a, b) => (b.is_active - a.is_active) || (order[a.tier] - order[b.tier]) || a.name.localeCompare(b.name));
  const active = members.filter((m) => m.is_active);
  const seatLimit = getParamNumber('counterparty_max_team_members', 15);
  const prefix = scope.side === 'SELLER' ? 'SELLER' : 'BUYER';
  return {
    entity: db.prepare('SELECT id, name, entity_type FROM entities WHERE id = ?').get(scope.entityId) || { id: scope.entityId },
    my_tier: scope.tier,
    can_manage: scope.manages.length > 0,
    assignable_roles: scope.manages.filter((t) => t !== 'ADMIN').map((t) => ({ value: `${prefix}_${t}`, tier: t, label: ROLE_INFO[t].label, does: ROLE_DOES[scope.side]?.[t] || ROLE_INFO[t].does })).reverse(),
    members,
    totals: {
      active: active.length, inactive: members.length - active.length,
      makers: active.filter((m) => m.tier === 'L1').length,
      checkers: active.filter((m) => m.tier === 'L2').length,
      approvers: active.filter((m) => m.tier === 'L3').length,
      never_signed_in: active.filter((m) => m.never_signed_in).length,
      seat_limit: seatLimit, seats_left: Math.max(0, seatLimit - active.length),
    },
    health: health(members),
    roles: ROLE_INFO,
    permissions: PERMISSIONS[scope.side] || PERMISSIONS.SELLER,
  };
}

// GET /companies — for SJVN's admins: whose team to open.
router.get('/companies', (req, res) => send(res, () => {
  if (!SJVN_ADMINS.includes(req.user.role)) throw fail(403, 'Not authorized');
  return db.prepare(`
    SELECT e.id, e.name, e.entity_type, e.status, e.logo_url,
      (SELECT COUNT(*) FROM users u WHERE u.linked_entity_id = e.id AND u.is_active = 1) AS active_users,
      (SELECT COUNT(*) FROM users u WHERE u.linked_entity_id = e.id) AS users
    FROM entities e ORDER BY e.entity_type DESC, e.name
  `).all();
}));

router.get('/', (req, res) => send(res, () => team(req)));

function roleFor(scope, asked) {
  const role = text(asked, 20).toUpperCase();
  const prefix = scope.side === 'SELLER' ? 'SELLER' : 'BUYER';
  const tier = /_L[123]$/.test(role) && role.startsWith(`${prefix}_`) ? tierOf(role) : null;
  if (!tier) throw fail(400, 'Choose an access level');
  if (tier === 'ADMIN' || !scope.manages.includes(tier)) throw fail(403, `You cannot give someone the ${ROLE_INFO[tier].label} level`);
  return role;
}
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

// POST / — add a member. The password is one the admin gives or one generated
// here; either way the member must choose their own at first sign-in.
router.post('/', (req, res) => send(res, () => {
  const scope = scopeOf(req);
  if (!scope.manages.length) throw fail(403, 'Only the Company Admin or an Approver can add team members');
  const b = req.body || {};
  const name = text(b.name);
  if (name.length < 2) throw fail(400, 'Enter the member\'s full name');
  const email = cleanEmail(b.email);
  const role = roleFor(scope, b.role);
  const phone = cleanPhone(b.phone);
  if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(email)) throw fail(409, 'That email address already has an account on the portal');
  const limit = getParamNumber('counterparty_max_team_members', 15);
  const active = db.prepare('SELECT COUNT(*) n FROM users WHERE linked_entity_id = ? AND is_active = 1').get(scope.entityId).n;
  if (active >= limit) throw fail(400, `Your company already has ${active} active users, which is the most allowed (${limit}). Switch off one that is no longer needed.`);
  const generated = !b.password;
  const password = generated ? generatePassword() : String(b.password);
  const complaint = passwordComplaint(password);
  if (complaint) throw fail(400, complaint);

  const id = newId('USR');
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, linked_entity_id, phone, designation, must_change_password, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, name, email, bcrypt.hashSync(password, 10), role, scope.entityId, phone, text(b.designation) || null, req.user.id);
  audit(req, 'TEAM_MEMBER_ADDED', id, { afterValue: { name, email, role } });
  tellAdmins(scope, req.user.id, `${req.user.name} added ${name} to the team as ${ROLE_INFO[tierOf(role)].label}.`);
  // The password is shown once, to the person who has to pass it on.
  return { id, temporary_password: password, generated, team: team(req) };
}));

// PATCH /:id — contact details, and the access level.
router.patch('/:id', (req, res) => send(res, () => {
  const scope = scopeOf(req);
  const m = memberFor(scope, req.params.id);
  const self = m.id === req.user.id;
  const manage = canManage(scope, m, req.user);
  if (!manage && !self) throw fail(403, 'You cannot change this member');
  const b = req.body || {};
  const next = {
    name: b.name !== undefined ? text(b.name) : m.name,
    phone: b.phone !== undefined ? cleanPhone(b.phone) : m.phone,
    designation: b.designation !== undefined ? text(b.designation) || null : m.designation,
    role: m.role,
  };
  if (next.name.length < 2) throw fail(400, 'Enter the member\'s full name');
  if (b.role !== undefined && b.role !== m.role) {
    if (self) throw fail(403, 'You cannot change your own access level');
    if (!manage) throw fail(403, 'You cannot change this member\'s access level');
    if (tierOf(m.role) === 'ADMIN') throw fail(400, 'The Company Admin account keeps its level');
    next.role = roleFor(scope, b.role);
  }
  const roleChanged = next.role !== m.role;
  const before = { name: m.name, phone: m.phone, designation: m.designation, role: m.role };
  if (JSON.stringify(before) === JSON.stringify(next)) throw fail(400, 'Nothing was changed');

  // A token carries the role it was issued with, so a change of level ends the
  // member's sessions and takes effect at their next sign-in.
  db.prepare('UPDATE users SET name = ?, phone = ?, designation = ?, role = ?, sessions_revoked_at = CASE WHEN ? THEN ? ELSE sessions_revoked_at END WHERE id = ?')
    .run(next.name, next.phone, next.designation, next.role, roleChanged ? 1 : 0, nowSeconds(), m.id);
  audit(req, roleChanged ? 'TEAM_ROLE_CHANGED' : 'TEAM_MEMBER_UPDATED', m.id, { beforeValue: before, afterValue: next });
  if (roleChanged) {
    pushNotification({ userId: m.id, type: 'TEAM', message: `Your access level was changed to ${ROLE_INFO[tierOf(next.role)].label} by ${req.user.name}. Sign in again to use it.` });
    tellAdmins(scope, req.user.id, `${req.user.name} changed ${next.name} from ${ROLE_INFO[tierOf(m.role)].label} to ${ROLE_INFO[tierOf(next.role)].label}.`);
  }
  return team(req);
}));

router.post('/:id/deactivate', (req, res) => send(res, () => {
  const scope = scopeOf(req);
  const m = memberFor(scope, req.params.id);
  if (m.id === req.user.id) throw fail(400, 'You cannot switch off your own account');
  if (tierOf(m.role) === 'ADMIN' && !scope.internal) throw fail(400, 'The Company Admin account is the company\'s registration with SJVN and cannot be switched off here');
  if (!canManage(scope, m, req.user)) throw fail(403, 'You cannot switch off this member');
  if (!m.is_active) throw fail(400, 'This account is already switched off');
  const reason = text(req.body?.reason, 300);
  if (!reason) throw fail(400, 'Say why the account is being switched off');
  db.prepare(`UPDATE users SET is_active = 0, deactivated_at = datetime('now'), deactivated_by = ?, deactivation_reason = ?, sessions_revoked_at = ? WHERE id = ?`)
    .run(req.user.id, reason, nowSeconds(), m.id);
  audit(req, 'TEAM_MEMBER_DEACTIVATED', m.id, { beforeValue: { is_active: 1 }, afterValue: { is_active: 0 }, reason });
  tellAdmins(scope, req.user.id, `${req.user.name} switched off ${m.name}'s account — ${reason}.`);
  return team(req);
}));

router.post('/:id/reactivate', (req, res) => send(res, () => {
  const scope = scopeOf(req);
  const m = memberFor(scope, req.params.id);
  if (!canManage(scope, m, req.user)) throw fail(403, 'You cannot switch on this member');
  if (m.is_active) throw fail(400, 'This account is already active');
  const limit = getParamNumber('counterparty_max_team_members', 15);
  const active = db.prepare('SELECT COUNT(*) n FROM users WHERE linked_entity_id = ? AND is_active = 1').get(scope.entityId).n;
  if (active >= limit) throw fail(400, `Your company already has the most active users allowed (${limit})`);
  db.prepare('UPDATE users SET is_active = 1, deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL WHERE id = ?').run(m.id);
  audit(req, 'TEAM_MEMBER_REACTIVATED', m.id, { beforeValue: { is_active: 0 }, afterValue: { is_active: 1 } });
  tellAdmins(scope, req.user.id, `${req.user.name} switched ${m.name}'s account back on.`);
  return team(req);
}));

// POST /:id/reset-password — for a member who is locked out or has forgotten it.
router.post('/:id/reset-password', (req, res) => send(res, () => {
  const scope = scopeOf(req);
  const m = memberFor(scope, req.params.id);
  if (!canManage(scope, m, req.user)) throw fail(403, m.id === req.user.id ? 'Change your own password from the profile menu' : 'You cannot reset this member\'s password');
  if (!m.is_active) throw fail(400, 'Switch the account on before resetting its password');
  const generated = !req.body?.password;
  const password = generated ? generatePassword() : String(req.body.password);
  const complaint = passwordComplaint(password);
  if (complaint) throw fail(400, complaint);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, sessions_revoked_at = ? WHERE id = ?')
    .run(bcrypt.hashSync(password, 10), nowSeconds(), m.id);
  clearLoginAttempts(m.email);
  audit(req, 'TEAM_PASSWORD_RESET', m.id, {});
  return { temporary_password: password, generated, team: team(req) };
}));

router.post('/:id/unlock', (req, res) => send(res, () => {
  const scope = scopeOf(req);
  const m = memberFor(scope, req.params.id);
  if (!canManage(scope, m, req.user)) throw fail(403, 'You cannot unlock this member');
  clearLoginAttempts(m.email);
  audit(req, 'TEAM_MEMBER_UNLOCKED', m.id, {});
  return team(req);
}));

// ── What a member has been doing, and what was done to the team ─────────────

const ACTION_WORDS = {
  LOGIN: 'Signed in', LOGIN_FAILED: 'Failed sign-in', LOGIN_BLOCKED: 'Sign-in blocked (locked out)', PASSWORD_CHANGED: 'Changed their password',
  PASSWORD_CHANGE_FAILED: 'Failed password change', ACCESS_DENIED: 'Tried something their level does not allow',
  TEAM_MEMBER_ADDED: 'Added to the team', TEAM_MEMBER_UPDATED: 'Details corrected', TEAM_ROLE_CHANGED: 'Access level changed',
  TEAM_MEMBER_DEACTIVATED: 'Account switched off', TEAM_MEMBER_REACTIVATED: 'Account switched on', TEAM_PASSWORD_RESET: 'Password reset',
  TEAM_MEMBER_UNLOCKED: 'Unlocked', CREATE: 'Created', UPDATE_STATUS: 'Status changed',
};
const words = (a) => ACTION_WORDS[a.action] || a.action.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

router.get('/history', (req, res) => send(res, () => {
  const scope = scopeOf(req);
  const members = db.prepare('SELECT id, name FROM users WHERE linked_entity_id = ?').all(scope.entityId);
  if (!members.length) return [];
  const names = new Map(members.map((m) => [m.id, m.name]));
  return db.prepare(`
    SELECT id, action, entity_id, user_name, before_value, after_value, reason, created_at FROM audit_logs
    WHERE module = 'TEAM' AND entity_id IN (${members.map(() => '?').join(',')})
    ORDER BY created_at DESC, rowid DESC LIMIT 100
  `).all(...members.map((m) => m.id)).map((a) => {
    const before = parse(a.before_value);
    const after = parse(a.after_value);
    let detail = a.reason || '';
    if (a.action === 'TEAM_ROLE_CHANGED' && before && after) detail = `${ROLE_INFO[tierOf(before.role)].label} → ${ROLE_INFO[tierOf(after.role)].label}`;
    if (a.action === 'TEAM_MEMBER_ADDED' && after) detail = `${ROLE_INFO[tierOf(after.role)].label} · ${after.email}`;
    if (a.action === 'TEAM_MEMBER_UPDATED' && before && after) {
      detail = ['name', 'phone', 'designation'].filter((k) => before[k] !== after[k]).map((k) => `${k}: ${before[k] || '—'} → ${after[k] || '—'}`).join('; ');
    }
    return { id: a.id, action: a.action, what: words(a), member_id: a.entity_id, member_name: names.get(a.entity_id) || '—', by: a.user_name, detail, at: a.created_at };
  });
}));

router.get('/:id/activity', (req, res) => send(res, () => {
  const scope = scopeOf(req);
  const m = memberFor(scope, req.params.id);
  if (!scope.manages.length && m.id !== req.user.id) throw fail(403, 'Only the Company Admin or an Approver can see a member\'s activity');
  return db.prepare(`
    SELECT id, action, module, entity_type, entity_id, ip_address, created_at FROM audit_logs
    WHERE user_id = ? OR (entity_id = ? AND action IN ('LOGIN', 'LOGIN_FAILED')) ORDER BY created_at DESC, rowid DESC LIMIT 60
  `).all(m.id, m.id).map((a) => ({ id: a.id, what: words(a), module: a.module, on: [a.entity_type, a.entity_id].filter(Boolean).join(' '), ip: a.ip_address, at: a.created_at }));
}));

// GET /export.csv — the team as a sheet, for the company's own access review.
router.get('/export.csv', (req, res) => {
  try {
    const t = team(req);
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Name', 'Email', 'Phone', 'Designation', 'Access level', 'Status', 'Added on', 'Added by', 'Last sign-in', 'Sign-ins (30 days)', 'Switched off on', 'Reason'].map(cell).join(',')];
    for (const m of t.members) {
      lines.push([m.name, m.email, m.phone, m.designation, m.role_label, m.is_active ? 'Active' : 'Switched off', m.created_at, m.created_by_name || '',
        m.last_login_at || 'Never', m.logins_30d, m.deactivated_at || '', m.deactivation_reason || ''].map(cell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="team-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${lines.join('\r\n')}`);
  } catch (err) {
    if (!err.status) console.error('[TEAM]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
});

export default router;
