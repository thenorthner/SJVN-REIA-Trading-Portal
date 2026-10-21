import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, PLATFORM_ADMINS } from '../middleware/auth.js';
import { logAudit } from '../util.js';
import { REIA_TIERS, reiaProjects, coverage, assign, projectsOf } from '../services/projectScope.js';

/**
 * Project assignments (Target #2, Phase C): which REIA projects each maker,
 * checker and approver works on. Assigning is the SJVN / IT administrators'
 * (user administration is theirs since Phase B); Management and the auditor may
 * read who covers what.
 */
const router = Router();
router.use(requireAuth);

const READERS = [...PLATFORM_ADMINS, 'MANAGEMENT', 'COMPLIANCE_AUDITOR'];
const SCOPES = ['ALL', 'SELECTED'];

// GET /me — the signed-in officer's own projects, for the desk's banner.
router.get('/me', (req, res) => {
  const mine = projectsOf(req.user);
  if (!mine) return res.json({ scope: 'ALL', projects: [] });
  const rows = mine.size
    ? db.prepare(`SELECT id, contract_no FROM contracts WHERE id IN (${[...mine].map(() => '?').join(',')}) ORDER BY contract_no`).all(...mine)
    : [];
  res.json({ scope: 'SELECTED', projects: rows });
});

router.get('/projects', requireRole(...READERS), (req, res) => res.json(reiaProjects()));

router.get('/coverage', requireRole(...READERS), (req, res) => res.json(coverage()));

router.get('/users', requireRole(...READERS), (req, res) => {
  const users = db.prepare(`
    SELECT id, name, email, role, designation, project_scope FROM users
    WHERE is_active = 1 AND linked_entity_id IS NULL AND role IN (${REIA_TIERS.map(() => '?').join(',')})
    ORDER BY CASE role WHEN 'REIA_APPROVER' THEN 1 WHEN 'REIA_CHECKER' THEN 2 ELSE 3 END, name
  `).all(...REIA_TIERS);
  const byUser = new Map();
  for (const a of db.prepare(`
    SELECT a.user_id, a.contract_id, c.contract_no, a.assigned_at FROM user_project_assignments a
    JOIN contracts c ON c.id = a.contract_id WHERE a.revoked_at IS NULL ORDER BY c.contract_no
  `).all()) {
    if (!byUser.has(a.user_id)) byUser.set(a.user_id, []);
    byUser.get(a.user_id).push({ contract_id: a.contract_id, contract_no: a.contract_no, assigned_at: a.assigned_at });
  }
  res.json(users.map((u) => ({ ...u, projects: byUser.get(u.id) || [] })));
});

// PUT /users/:id { scope: ALL | SELECTED, contract_ids: [...] }
router.put('/users/:id', requireRole(...PLATFORM_ADMINS), (req, res) => {
  const u = db.prepare('SELECT id, name, role, project_scope FROM users WHERE id = ? AND is_active = 1 AND linked_entity_id IS NULL').get(req.params.id);
  if (!u || !REIA_TIERS.includes(u.role)) return res.status(404).json({ error: 'Not a REIA maker, checker or approver' });
  const scope = String(req.body?.scope || '').toUpperCase();
  if (!SCOPES.includes(scope)) return res.status(400).json({ error: 'scope must be ALL or SELECTED' });
  const ids = Array.isArray(req.body?.contract_ids) ? [...new Set(req.body.contract_ids.map(String))] : [];
  const live = new Set(reiaProjects().map((p) => p.id));
  const notProjects = ids.filter((id) => !live.has(id));
  if (notProjects.length) return res.status(400).json({ error: `Not a live REIA project: ${notProjects.join(', ')}` });
  if (scope === 'SELECTED' && ids.length === 0) {
    return res.status(400).json({ error: `Choose at least one project for ${u.name}, or leave them on all projects.` });
  }
  const before = db.prepare('SELECT contract_id FROM user_project_assignments WHERE user_id = ? AND revoked_at IS NULL').all(u.id).map((r) => r.contract_id);
  // On ALL, the list is cleared: a project list that does not apply would only mislead.
  const newlyUncovered = assign(u.id, scope === 'ALL' ? [] : ids, { by: req.user, scope });
  logAudit({
    req, user: req.user, action: 'PROJECT_SCOPE_CHANGED', module: 'GOVERNANCE', entityType: 'user', entityId: u.id,
    beforeValue: { scope: u.project_scope, contract_ids: before }, afterValue: { scope, contract_ids: scope === 'ALL' ? [] : ids },
  });
  res.json({
    user_id: u.id, scope, contract_ids: scope === 'ALL' ? [] : ids,
    newly_uncovered: newlyUncovered.map((p) => ({ id: p.id, contract_no: p.contract_no, missing: p.missing })),
  });
});

export default router;
