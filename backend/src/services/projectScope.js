/**
 * Project-wise authorisation on the REIA desk (Target #2, Phase C).
 *
 * A REIA maker, checker or approver works on ALL projects — the default, so
 * nothing changes for anyone until an administrator says otherwise — or on the
 * SELECTED contracts assigned to them in user_project_assignments. Everyone
 * else (Finance, Management, the administrators, audit, the station desks and
 * the counterparties, who have their own scoping) is not touched here.
 *
 * Enforced in two places, once for every REIA route rather than route by route:
 *   - guard: a request that names a contract — `contract_id` in the query or
 *     body, or any id in the path that belongs to a contract's record (an
 *     invoice, a security instrument, a reconciliation, a dispute …) — is
 *     refused 403 when that contract is outside the user's projects;
 *   - filter: a list answered to such a user loses the rows of other projects.
 * Totals on dashboards are not re-computed per project (see the governance doc).
 *
 * Coverage: every live REIA project must have at least one maker, one checker
 * and one approver who can act on it. A project without is listed on the
 * assignment screen and alerted daily, because a scoped desk can otherwise
 * stall with nobody able to take the next step.
 */
import db from '../db/index.js';
import { newId, logAudit, notifyRoles } from '../util.js';
import { verticalOfContract } from './stationScope.js';

export const REIA_TIERS = ['REIA_MAKER', 'REIA_CHECKER', 'REIA_APPROVER'];
const CLOSED = ['EXPIRED', 'TERMINATED', 'CLOSED'];

/** null = every project; otherwise the Set of contract ids the user may act on. */
function ownProjects(userId) {
  const row = db.prepare('SELECT project_scope FROM users WHERE id = ?').get(userId);
  if (!row || row.project_scope !== 'SELECTED') return null;
  return new Set(db.prepare(`
    SELECT contract_id FROM user_project_assignments WHERE user_id = ? AND revoked_at IS NULL
  `).all(userId).map((r) => r.contract_id));
}

export function projectsOf(user) {
  if (!user || !REIA_TIERS.includes(user.role)) return null;
  const acting = user.acting;
  // Break-glass is for when nobody can act: it is not narrowed to projects.
  if (acting?.kind === 'BG') return null;
  // Under an additional charge the delegate works on the delegator's projects,
  // narrowed to the ones the charge names, if it names any.
  if (acting?.kind === 'DLG') {
    const theirs = ownProjects(acting.for_user_id);
    if (!acting.contract_ids) return theirs;
    const named = new Set(acting.contract_ids);
    return theirs ? new Set([...named].filter((c) => theirs.has(c))) : named;
  }
  return ownProjects(user.id);
}

// Every table whose rows belong to a contract, read once from the schema.
let owners = null;
function ownerTables() {
  if (owners) return owners;
  owners = db.prepare(`
    SELECT m.name FROM sqlite_master m
    WHERE m.type = 'table'
      AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) p WHERE p.name = 'contract_id')
      AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) p WHERE p.name = 'id')
  `).all().map((r) => r.name);
  return owners;
}

/** The contract a route id belongs to: the contract itself, or the owner of the record. */
export function contractOf(id) {
  const key = String(id || '');
  if (key.length < 4) return null;
  if (db.prepare('SELECT 1 FROM contracts WHERE id = ?').get(key)) return key;
  for (const t of ownerTables()) {
    try {
      const r = db.prepare(`SELECT contract_id FROM ${t} WHERE id = ?`).get(key);
      if (r?.contract_id) return r.contract_id;
    } catch { /* not a table this id can be in */ }
  }
  // A dispute reaches its contract through the invoice it is about.
  try {
    const d = db.prepare('SELECT i.contract_id FROM disputes d JOIN invoices i ON i.id = d.invoice_id WHERE d.id = ?').get(key);
    if (d?.contract_id) return d.contract_id;
  } catch { /* no disputes table */ }
  return null;
}

const refusal = (contractId) => {
  const c = db.prepare('SELECT contract_no FROM contracts WHERE id = ?').get(contractId);
  return `${c?.contract_no || 'This project'} is not one of your assigned projects. Ask the SJVN Administrator to assign it to you.`;
};

/**
 * Express middleware for /api. `resolveUser` reads the signed-in user from the
 * token, since this runs ahead of the routers' own requireAuth.
 */
export function projectScopeGuard(resolveUser) {
  return (req, res, next) => {
    const user = resolveUser(req);
    const mine = projectsOf(user);
    if (!mine) return next();

    const named = [req.query?.contract_id, req.body?.contract_id].filter(Boolean).map(String);
    // Path segments after /api/<module>; the module name itself is never an id.
    const segments = String(req.path || '').split('/').filter(Boolean).slice(1);
    for (const seg of segments) {
      if (!/[-_]/.test(seg) && !/\d/.test(seg)) continue; // words like "approve", "summary"
      const c = contractOf(decodeURIComponent(seg));
      if (c) named.push(c);
    }
    const outside = named.find((c) => !mine.has(c) && db.prepare('SELECT 1 FROM contracts WHERE id = ?').get(c));
    if (outside) return res.status(403).json({ error: refusal(outside), code: 'PROJECT_NOT_ASSIGNED' });

    if (req.method === 'GET') {
      const json = res.json.bind(res);
      res.json = (body) => json(withinProjects(body, mine));
    } else if (req.method === 'POST' && /^\/contracts\/?$/.test(req.path)) {
      // A scoped officer who raises a contract is given it, or they could not see it.
      const json = res.json.bind(res);
      res.json = (body) => {
        if (res.statusCode < 300 && body?.id) assign(user.id, [body.id], { by: user, keep: true });
        return json(body);
      };
    }
    return next();
  };
}

const rowContract = (r) => {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return undefined;
  if ('contract_id' in r) return r.contract_id;
  if ('contract_no' in r && 'id' in r && ('seller_id' in r || 'contract_type' in r)) return r.id; // a contract row
  return undefined;
};
const keep = (mine) => (r) => {
  const c = rowContract(r);
  return c === undefined || c === null || mine.has(c);
};

/** A list body with other projects' rows taken out (top-level arrays, and arrays one level in). */
export function withinProjects(body, mine) {
  if (Array.isArray(body)) return body.filter(keep(mine));
  if (body && typeof body === 'object') {
    const c = rowContract(body);
    if (c && !mine.has(c)) return body; // a single record was already refused by the guard
    let changed = null;
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v) && v.some((x) => rowContract(x) !== undefined)) {
        changed = changed || { ...body };
        changed[k] = v.filter(keep(mine));
      }
    }
    return changed || body;
  }
  return body;
}

/** Live REIA projects: contracts that are not a hydro/thermal station and not closed. */
export function reiaProjects() {
  return db.prepare(`
    SELECT c.id, c.contract_no, c.contract_type, c.project_type, c.capacity_mw, c.status,
           s.name AS seller_name, b.name AS buyer_name
    FROM contracts c
    LEFT JOIN entities s ON s.id = c.seller_id
    LEFT JOIN entities b ON b.id = c.buyer_id
    WHERE c.status NOT IN (${CLOSED.map(() => '?').join(',')})
    ORDER BY c.contract_no
  `).all(...CLOSED).filter((c) => !verticalOfContract(c.id));
}

/**
 * Who can act on each project, by tier, and which projects have a tier nobody
 * covers. An approver is a REIA approver or Management (level 3 of a bill is
 * either), and Management is never scoped.
 */
export function coverage() {
  const users = db.prepare(`
    SELECT id, name, role, project_scope FROM users
    WHERE is_active = 1 AND linked_entity_id IS NULL AND role IN ('REIA_MAKER','REIA_CHECKER','REIA_APPROVER','MANAGEMENT')
  `).all();
  const assigned = new Map();
  for (const a of db.prepare('SELECT user_id, contract_id FROM user_project_assignments WHERE revoked_at IS NULL').all()) {
    if (!assigned.has(a.contract_id)) assigned.set(a.contract_id, new Set());
    assigned.get(a.contract_id).add(a.user_id);
  }
  const tierOf = (role) => (role === 'REIA_MAKER' ? 'maker' : role === 'REIA_CHECKER' ? 'checker' : 'approver');
  let charges = [];
  try {
    charges = db.prepare(`
      SELECT d.delegator_id, d.delegate_id, d.role, d.contract_ids_json, a.name AS delegator_name, a.project_scope AS delegator_scope, b.name AS delegate_name
      FROM role_delegations d JOIN users a ON a.id = d.delegator_id JOIN users b ON b.id = d.delegate_id
      WHERE d.revoked_at IS NULL AND b.is_active = 1 AND date('now', '+330 minutes') BETWEEN d.valid_from AND d.valid_to
        AND d.role IN ('REIA_MAKER','REIA_CHECKER','REIA_APPROVER')
    `).all().map((d) => ({ ...d, contract_ids: d.contract_ids_json ? JSON.parse(d.contract_ids_json) : null }));
  } catch { /* no delegations table on an older database */ }
  const projects = reiaProjects().map((p) => {
    const who = { maker: [], checker: [], approver: [] };
    for (const u of users) {
      const all = u.role === 'MANAGEMENT' || u.project_scope !== 'SELECTED';
      if (all || assigned.get(p.id)?.has(u.id)) who[tierOf(u.role)].push({ id: u.id, name: u.name, role: u.role, scope: all ? 'ALL' : 'SELECTED' });
    }
    // An officer holding another's charge today covers that officer's tier on
    // that officer's projects (Target #2 Phase D).
    for (const d of charges) {
      const theirs = d.delegator_scope === 'SELECTED' ? (assigned.get(p.id)?.has(d.delegator_id) ?? false) : true;
      const named = !d.contract_ids || d.contract_ids.includes(p.id);
      if (theirs && named) who[tierOf(d.role)].push({ id: d.delegate_id, name: `${d.delegate_name} for ${d.delegator_name}`, role: d.role, scope: 'CHARGE' });
    }
    const missing = Object.entries(who).filter(([, list]) => list.length === 0).map(([tier]) => tier);
    return { ...p, who, missing, covered: missing.length === 0 };
  });
  return { projects, uncovered: projects.filter((p) => !p.covered) };
}

/**
 * Set a user's scope and projects. `keep` adds to the current set instead of
 * replacing it. Returns the projects this change left without a tier.
 */
export function assign(userId, contractIds, { by, scope, keep: add = false } = {}) {
  const before = new Set(coverage().uncovered.map((p) => p.id));
  const wanted = new Set((contractIds || []).map(String));
  db.transaction(() => {
    if (scope) db.prepare('UPDATE users SET project_scope = ? WHERE id = ?').run(scope, userId);
    const current = db.prepare('SELECT id, contract_id FROM user_project_assignments WHERE user_id = ? AND revoked_at IS NULL').all(userId);
    const have = new Set(current.map((r) => r.contract_id));
    if (!add) {
      for (const r of current) {
        if (!wanted.has(r.contract_id)) {
          db.prepare(`UPDATE user_project_assignments SET revoked_at = datetime('now'), revoked_by = ? WHERE id = ?`).run(by?.id || null, r.id);
        }
      }
    }
    for (const c of wanted) {
      if (!have.has(c)) {
        db.prepare('INSERT INTO user_project_assignments (id, user_id, contract_id, assigned_by) VALUES (?, ?, ?, ?)').run(newId('UPA'), userId, c, by?.id || null);
      }
    }
  })();
  const after = coverage().uncovered;
  return after.filter((p) => !before.has(p.id));
}

/** Daily: tell the administrators which projects nobody can move (once a day per project set). */
export function alertUncoveredProjects() {
  const { uncovered } = coverage();
  if (!uncovered.length) return 0;
  const list = uncovered.map((p) => `${p.contract_no} (no ${p.missing.join(', ')})`).join('; ');
  const message = `${uncovered.length} REIA project(s) have nobody to act at a tier: ${list}. Assign users under Administration → Project Assignments.`;
  const said = db.prepare(`SELECT 1 FROM notifications WHERE type = 'PROJECT_COVERAGE' AND message = ? AND created_at > datetime('now', '-1 day')`).get(message);
  if (said) return 0;
  notifyRoles(['SJVN_ADMIN', 'IT_SUPER_ADMIN'], { type: 'PROJECT_COVERAGE', message, link: '/admin/project-assignments' });
  logAudit({ req: null, user: null, action: 'PROJECT_COVERAGE_ALERT', module: 'GOVERNANCE', entityType: 'contract', entityId: null, details: { uncovered: uncovered.map((p) => ({ contract_no: p.contract_no, missing: p.missing })) } });
  return uncovered.length;
}
