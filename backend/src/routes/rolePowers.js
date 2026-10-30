/**
 * Role powers — the matrix of what each of SJVN's roles may do, and the
 * administrators' changes to it (see src/services/rolePowers.js).
 *
 * The administrators change it; Compliance / Audit reads it. A change needs a
 * reason (and may cite the office order behind it), takes effect at once, is
 * written to the tamper-evident audit trail with its before and after, and is
 * told to the role's users and to the administrators.
 *
 * The administrators may also make a role: a name, what it is for, the role it
 * works like, and the combination of powers it holds — each power beyond its
 * base held to the same rules as a single change. It is then a column like any
 * other, assignable to officers on SJVN Users, and retired (never deleted) once
 * nobody holds it.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { secureLogAudit } from '../auditEngine.js';
import { pushNotification } from '../util.js';
import { STAFF_ROLES } from './staff.js';
import { REIA_BETA } from '../services/reiaBeta.js';
import {
  POWERS, POWER_ROLES, EDITORS, KINDS, routesOf, defaultHolding, holding, overrideOf, changeBlock, applyChange, powerOf, forgetOverrides,
  ROLE_BASES, customRole, customRoles, isCustomRole, newRoleProblems, createCustomRole, updateCustomRole, retireCustomRole, needsOf,
} from '../services/rolePowers.js';

const router = Router();
router.use(requireAuth, requireRole(...EDITORS, 'COMPLIANCE_AUDITOR'));

const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, fn) => {
  try {
    res.json(fn());
  } catch (err) {
    if (!err.status) console.error('[ROLE-POWERS]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong', ...(err.problems ? { problems: err.problems } : {}) });
  }
};
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

// The REIA beta shows the REIA desk alone: no other desk's powers or roles.
const OTHER_DESK_ROLE = /^(TRADING|COMMERCIAL|THERMAL|HYDRO)/;
const deskShown = (r) => !REIA_BETA || !OTHER_DESK_ROLE.test(r);
const madeShown = (c) => deskShown(c.base_role);
const shownRoles = () => [...POWER_ROLES.filter(deskShown), ...customRoles().filter(madeShown).map((c) => c.code)];
const shownBases = () => ROLE_BASES.filter(deskShown);
const shownPowers = () => POWERS.filter((p) => !REIA_BETA || !p.desk);
const roleLabels = () => ({
  ...Object.fromEntries(POWER_ROLES.map((r) => [r, STAFF_ROLES[r]?.label || r])),
  ...Object.fromEntries(customRoles().map((c) => [c.code, c.label])),
});
const STATE_WORDS = { all: 'holds it', some: 'holds part of it', none: 'does not hold it' };

const nameOf = (id) => (id ? db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || null : null);
const activeUsers = (role) => db.prepare('SELECT COUNT(*) n FROM users WHERE role = ? AND is_active = 1 AND linked_entity_id IS NULL').get(role).n;

/** A change offered for a cell: null when it does not apply, else whether it is allowed and why not. */
const offer = (me, key, role, give, labels) => {
  const why = changeBlock(me, key, role, give, labels);
  return { ok: !why, why };
};

function matrix(req) {
  const me = req.user.role;
  const editor = EDITORS.includes(me);
  const labels = roleLabels();
  const roles = shownRoles();
  const powers = shownPowers().map((p) => {
    const cells = {};
    for (const r of roles) {
      const state = holding(p.key, r);
      const o = overrideOf(p.key, r);
      cells[r] = {
        state,
        default: defaultHolding(p.key, r),
        changed: !!o,
        ...(o ? { by: nameOf(o.changed_by), at: o.changed_at, reason: o.reason, reference: o.reference } : {}),
        give: editor && state !== 'all' ? offer(me, p.key, r, true, labels) : null,
        take: editor && state !== 'none' ? offer(me, p.key, r, false, labels) : null,
        reset: editor && o ? resetBlock(me, p.key, r) : null,
      };
    }
    return {
      key: p.key, area: p.area, label: p.label, does: p.does, kind: p.kind, kind_label: KINDS[p.kind], fixed: p.fixed || null,
      actions: routesOf(p.key).length, needs: needsOf(p), givable: !p.holders && !p.fixed && p.kind !== 'governance', cells,
    };
  });
  return {
    can_edit: editor,
    me,
    roles: roles.map((r) => (isCustomRole(r) ? madeRoleView(r, labels, editor) : { role: r, label: labels[r], desk: STAFF_ROLES[r]?.desk || '', users: activeUsers(r) })),
    bases: shownBases().map((r) => ({ role: r, label: labels[r], desk: STAFF_ROLES[r]?.desk || '', does: STAFF_ROLES[r]?.does || '' })),
    areas: [...new Set(powers.map((p) => p.area))],
    kinds: KINDS,
    powers,
    changed: powers.reduce((n, p) => n + Object.values(p.cells).filter((c) => c.changed).length, 0),
  };
}

function madeRoleView(code, labels, editor) {
  const c = customRole(code);
  const users = activeUsers(code);
  return {
    role: code, label: c.label, desk: 'Roles made here', users, custom: true,
    base: c.base_role, base_label: labels[c.base_role] || c.base_role, description: c.description,
    made_by: nameOf(c.created_by), made_at: c.created_at, reason: c.reason, reference: c.reference,
    updated_by: nameOf(c.updated_by), updated_at: c.updated_at,
    retire: editor ? (users ? { ok: false, why: `${users} active officer${users === 1 ? ' holds' : 's hold'} this role — give ${users === 1 ? 'them' : 'each'} another role on SJVN Users first` } : { ok: true, why: null }) : null,
  };
}

function resetBlock(me, key, role) {
  if (!overrideOf(key, role)) return { ok: false, why: 'This role already has the power as the platform gives it' };
  if (role === me) return { ok: false, why: 'Nobody changes their own role\'s powers — another administrator has to' };
  if (role === 'IT_SUPER_ADMIN') return { ok: false, why: 'The IT Super Administrator\'s powers are not changed from this screen' };
  return { ok: true, why: null };
}

function checkReason(b) {
  const reason = text(b.reason, 500);
  if (reason.length < 15) throw fail(400, 'Say why, in a sentence (at least 15 characters) — it goes on the record');
  return { reason, reference: text(b.reference, 80) || null };
}

function record(req, { action, p, role, before, after, reason, reference }) {
  const labels = roleLabels();
  const users = activeUsers(role);
  secureLogAudit(req, {
    action,
    module: 'ROLE_POWERS',
    entityType: 'role_power',
    entityId: `${role}/${p.key}`,
    beforeValue: { holding: before },
    afterValue: { holding: after },
    reason,
    details: { power: p.key, power_label: p.label, role, role_label: labels[role], reference, actions: routesOf(p.key).length, users_affected: users },
  });
  const verb = after === 'none' ? `took away the power "${p.label}" from` : after === before ? `confirmed the power "${p.label}" for` : `gave the power "${p.label}" to`;
  const why = `${reason}${reference ? ` (ref. ${reference})` : ''}`;
  pushNotification({ role, type: 'ROLE_POWERS', message: `${req.user.name} ${verb} your role, ${labels[role]}: ${why}. It applies at once; reload the portal to see your menu change.`, link: null });
  for (const admin of EDITORS) {
    if (admin === role) continue;
    pushNotification({ role: admin, type: 'ROLE_POWERS', message: `${req.user.name} ${verb} ${labels[role]} (${users} active user${users === 1 ? '' : 's'}): ${why}.`, link: '/admin/role-powers' });
  }
}

router.get('/', (req, res) => send(res, () => matrix(req)));

router.post('/change', requireRole(...EDITORS), (req, res) => send(res, () => {
  const b = req.body || {};
  const p = powerOf(text(b.power, 60));
  const role = text(b.role, 40);
  if (!p || !shownPowers().includes(p)) throw fail(404, 'There is no such power');
  if (!shownRoles().includes(role)) throw fail(404, 'There is no such role');
  if (typeof b.give !== 'boolean') throw fail(400, 'Say whether the power is to be given or taken away');
  const block = changeBlock(req.user.role, p.key, role, b.give, roleLabels());
  if (block) throw fail(409, block);
  const { reason, reference } = checkReason(b);
  db.transaction(() => {
    const { before, after } = applyChange({ key: p.key, role, give: b.give, reason, reference, by: req.user.id });
    record(req, { action: b.give ? 'ROLE_POWER_GIVEN' : 'ROLE_POWER_TAKEN', p, role, before, after, reason, reference });
  })();
  return matrix(req);
}));

router.post('/reset', requireRole(...EDITORS), (req, res) => send(res, () => {
  const b = req.body || {};
  const p = powerOf(text(b.power, 60));
  const role = text(b.role, 40);
  if (!p || !shownPowers().includes(p) || !shownRoles().includes(role)) throw fail(404, 'There is no such power or role');
  const block = resetBlock(req.user.role, p.key, role);
  if (!block.ok) throw fail(409, block.why);
  const { reason, reference } = checkReason(b);
  db.transaction(() => {
    const before = holding(p.key, role);
    db.prepare('DELETE FROM role_power_overrides WHERE power_key = ? AND role = ?').run(p.key, role);
    forgetOverrides();
    record(req, { action: 'ROLE_POWER_RESET', p, role, before, after: holding(p.key, role), reason, reference });
  })();
  return matrix(req);
}));

// ── Making a role ───────────────────────────────────────────────────────────

const BUILT_IN_LABELS = () => Object.values(STAFF_ROLES).map((r) => r.label.toLowerCase());
function cleanRoleText(b, code = null) {
  const label = text(b.label, 60).replace(/\s+/g, ' ');
  if (label.length < 3) throw fail(400, 'Give the role a name of at least 3 characters');
  if (!/^[A-Za-z][A-Za-z0-9 ()&/.,'-]*$/.test(label)) throw fail(400, 'Use letters, digits, spaces and ( ) & / . , \' - in the name, starting with a letter');
  const lower = label.toLowerCase();
  if (BUILT_IN_LABELS().includes(lower) || customRoles().some((c) => c.code !== code && c.label.toLowerCase() === lower)) {
    throw fail(409, `There is already a role called "${label}"`);
  }
  const description = text(b.description, 300);
  if (description.length < 15) throw fail(400, 'Say what the role is for, in a sentence (at least 15 characters)');
  return { label, description };
}
const powerList = (v) => [...new Set((Array.isArray(v) ? v : []).map((k) => text(k, 60)))];

function proposal(b) {
  const base = text(b.base, 40);
  if (!shownBases().includes(base)) throw fail(400, 'Choose the role it works like');
  const shown = shownPowers().map((p) => p.key);
  const keys = powerList(b.powers);
  const problems = newRoleProblems({ base, keys, shown, roleLabels: roleLabels() });
  const want = new Set(keys);
  const given = shown.filter((k) => want.has(k) && defaultHolding(k, base) === 'none');
  const taken = shown.filter((k) => !want.has(k) && defaultHolding(k, base) !== 'none');
  return { base, keys, shown, problems, given, taken };
}
const labelsOf = (keys) => keys.map((k) => powerOf(k)?.label || k);

function recordRole(req, { action, code, before, after, reason, reference, details }) {
  secureLogAudit(req, {
    action,
    module: 'ROLE_POWERS',
    entityType: 'role',
    entityId: code,
    beforeValue: before || null,
    afterValue: after || null,
    reason,
    details: { role: code, role_label: after?.label || before?.label, reference: reference || null, ...details },
  });
}
const tellAdmins = (req, message) => {
  for (const admin of EDITORS) pushNotification({ role: admin, type: 'ROLE_POWERS', message, link: '/admin/role-powers' });
};

/** What a role made from this base with these powers would differ by, and what the rules say. Nothing is saved. */
router.post('/roles/check', requireRole(...EDITORS), (req, res) => send(res, () => {
  const { problems, given, taken } = proposal(req.body || {});
  return { problems, given, taken };
}));

router.post('/roles', requireRole(...EDITORS), (req, res) => send(res, () => {
  const b = req.body || {};
  const { label, description } = cleanRoleText(b);
  const { base, keys, shown, problems, given, taken } = proposal(b);
  if (problems.length) {
    const err = fail(409, problems[0].power ? `"${powerOf(problems[0].power)?.label || problems[0].power}": ${problems[0].why}` : problems[0].why);
    err.problems = problems;
    throw err;
  }
  const { reason, reference } = checkReason(b);
  let code;
  db.transaction(() => {
    ({ code } = createCustomRole({ label, description, base, keys, shown, reason, reference, by: req.user.id }));
    const held = shownPowers().filter((p) => holding(p.key, code) !== 'none').map((p) => p.key);
    recordRole(req, {
      action: 'ROLE_CREATED', code, reason, reference,
      after: { label, description, base, powers: held },
      details: { base_label: roleLabels()[base], given: labelsOf(given), taken: labelsOf(taken), powers_held: held.length },
    });
  })();
  tellAdmins(req, `${req.user.name} made the role "${label}" (works like ${roleLabels()[base]}${given.length ? `; given ${given.length} power${given.length === 1 ? '' : 's'} more` : ''}${taken.length ? `; ${taken.length} fewer` : ''}): ${reason}.`);
  return { code, ...matrix(req) };
}));

const madeRoleFor = (code) => {
  const c = customRole(text(code, 60));
  if (!c || c.status !== 'ACTIVE' || !shownRoles().includes(c.code)) throw fail(404, 'There is no such role');
  return c;
};

router.patch('/roles/:code', requireRole(...EDITORS), (req, res) => send(res, () => {
  const c = madeRoleFor(req.params.code);
  const b = req.body || {};
  const { label, description } = cleanRoleText(b, c.code);
  if (label === c.label && description === c.description) throw fail(400, 'Nothing was changed');
  const { reason, reference } = checkReason(b);
  db.transaction(() => {
    updateCustomRole(c.code, { label, description, by: req.user.id });
    recordRole(req, { action: 'ROLE_UPDATED', code: c.code, reason, reference, before: { label: c.label, description: c.description }, after: { label, description } });
  })();
  if (label !== c.label) pushNotification({ role: c.code, type: 'ROLE_POWERS', message: `${req.user.name} renamed your role "${c.label}" to "${label}": ${reason}.`, link: null });
  return matrix(req);
}));

router.post('/roles/:code/retire', requireRole(...EDITORS), (req, res) => send(res, () => {
  const c = madeRoleFor(req.params.code);
  const users = activeUsers(c.code);
  if (users) throw fail(409, `${users} active officer${users === 1 ? ' holds' : 's hold'} this role — give ${users === 1 ? 'them' : 'each'} another role on SJVN Users first`);
  const { reason, reference } = checkReason(req.body || {});
  db.transaction(() => {
    retireCustomRole(c.code, { reason, by: req.user.id });
    recordRole(req, { action: 'ROLE_RETIRED', code: c.code, reason, reference, before: { label: c.label, status: 'ACTIVE' }, after: { label: c.label, status: 'RETIRED' } });
  })();
  tellAdmins(req, `${req.user.name} retired the role "${c.label}": ${reason}.`);
  return matrix(req);
}));

const WHAT = {
  ROLE_POWER_GIVEN: 'Given', ROLE_POWER_TAKEN: 'Taken away', ROLE_POWER_RESET: 'Back to the platform default',
  ROLE_CREATED: 'Role made', ROLE_UPDATED: 'Role renamed or described', ROLE_RETIRED: 'Role retired',
};

router.get('/history', (req, res) => send(res, () => {
  // A made role's record stays readable after it is retired.
  const madeEver = db.prepare('SELECT code, label, base_role FROM custom_roles').all().filter(madeShown);
  const roles = new Set([...shownRoles(), ...madeEver.map((c) => c.code)]);
  const keys = new Set(shownPowers().map((p) => p.key));
  const labels = { ...roleLabels(), ...Object.fromEntries(madeEver.map((c) => [c.code, c.label])) };
  return db.prepare(`
    SELECT id, action, user_name, user_role, before_value, after_value, reason, details, created_at FROM audit_logs
    WHERE module = 'ROLE_POWERS' ORDER BY created_at DESC, rowid DESC LIMIT 300
  `).all().map((a) => {
    const d = parse(a.details) || {};
    const before = parse(a.before_value);
    const after = parse(a.after_value);
    const common = {
      id: a.id, at: a.created_at, by: a.user_name, by_role: STAFF_ROLES[a.user_role]?.label || labels[a.user_role] || a.user_role,
      what: WHAT[a.action] || a.action, role: d.role, role_label: d.role_label || labels[d.role] || d.role,
      reason: a.reason, reference: d.reference || null,
    };
    if (a.action.startsWith('ROLE_') && !a.action.startsWith('ROLE_POWER_')) {
      let change = '';
      if (a.action === 'ROLE_CREATED') {
        change = `Works like ${d.base_label || after?.base}; holds ${d.powers_held ?? after?.powers?.length ?? 0} powers`
          + `${d.given?.length ? ` — given beyond it: ${d.given.join(', ')}` : ''}${d.taken?.length ? ` — not given: ${d.taken.join(', ')}` : ''}`;
      } else if (a.action === 'ROLE_UPDATED') {
        change = before?.label !== after?.label ? `"${before?.label}" → "${after?.label}"` : 'What it is for, reworded';
      } else change = 'Nobody can be given it now';
      return { ...common, power: null, power_label: null, kind: 'role', change };
    }
    return {
      ...common, power: d.power, power_label: d.power_label, kind: 'power',
      from: STATE_WORDS[before?.holding] || '—', to: STATE_WORDS[after?.holding] || '—',
      users_affected: d.users_affected ?? null,
    };
  }).filter((h) => roles.has(h.role) && (h.kind === 'role' || keys.has(h.power)));
}));

router.get('/export.csv', (req, res) => {
  try {
    const m = matrix(req);
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const word = { all: 'Yes', some: 'Partly', none: 'No' };
    const lines = [['Area', 'Power', 'Kind', ...m.roles.map((r) => r.label)].map(cell).join(',')];
    for (const p of m.powers) {
      lines.push([p.area, p.label, p.kind_label, ...m.roles.map((r) => {
        const c = p.cells[r.role];
        return `${word[c.state]}${c.changed ? ` (changed from ${word[c.default]})` : ''}`;
      })].map(cell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="role-powers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${lines.join('\r\n')}`);
  } catch (err) {
    console.error('[ROLE-POWERS]', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

/** The actions a power covers, with who passes each one's gate as the code stands. */
router.get('/:key/actions', (req, res) => send(res, () => {
  const p = powerOf(req.params.key);
  if (!p || !shownPowers().includes(p)) throw fail(404, 'There is no such power');
  const roles = shownRoles();
  return routesOf(p.key).map((r) => ({
    method: r.method, path: r.path,
    decided_by: r.roles ? 'gate' : 'screen',
    roles: r.roles ? r.roles.filter((x) => roles.includes(x)) : null,
  }));
}));

export default router;
