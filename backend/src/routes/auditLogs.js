import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { verifyLogIntegrity, detectSoDViolations, secureLogAudit } from '../auditEngine.js';

const router = Router();
router.use(requireAuth);

// 1. List logs (Restricted to Auditors or relevant admins)
router.get('/', requireRole(...ROLE_GROUPS.AUDITOR), (req, res) => {
  const { module, entity_id, action_type, user_id, trace_id, from_date, to_date, limit = 500 } = req.query;
  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];

  if (module) { sql += ' AND module = ?'; params.push(module); }
  if (entity_id) { sql += ' AND entity_id = ?'; params.push(entity_id); }
  if (action_type) { sql += ' AND action = ?'; params.push(action_type); }
  if (user_id) { sql += ' AND user_id = ?'; params.push(user_id); }
  if (trace_id) { sql += ' AND trace_id = ?'; params.push(trace_id); }
  if (from_date) { sql += ' AND created_at >= ?'; params.push(from_date); }
  if (to_date) { sql += ' AND created_at <= ?'; params.push(to_date); }

  sql += ' ORDER BY rowid DESC LIMIT ?';
  params.push(parseInt(limit, 10));

  res.json(db.prepare(sql).all(...params));
});

// 2. Fetch specific log for diff viewer
router.get('/:id', requireRole(...ROLE_GROUPS.AUDITOR), (req, res) => {
  const log = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(req.params.id);
  if (!log) return res.status(404).json({ error: 'Audit log not found' });
  res.json(log);
});

// 3. Verify Integrity Chain
router.post('/verify-integrity', requireRole(...ROLE_GROUPS.AUDITOR), (req, res) => {
  const result = verifyLogIntegrity();
  
  // Log this sensitive check
  secureLogAudit(req, {
    action: 'INTEGRITY_CHECK',
    module: 'SYSTEM',
    reason: 'Manual execution of cryptographic integrity check.',
    details: { result }
  });

  res.json(result);
});

// 4. Detect SoD Violations
router.get('/violations/sod', requireRole(...ROLE_GROUPS.AUDITOR), (req, res) => {
  const violations = detectSoDViolations();
  res.json(violations);
});

// 5. Log Data Export (Called explicitly from frontend when user downloads reports)
router.post('/log-export', (req, res) => {
  const { module, details } = req.body;
  secureLogAudit(req, {
    action: 'DATA_EXPORT',
    module: module || 'SYSTEM',
    reason: 'User exported data to local device.',
    details
  });
  res.json({ success: true });
});

export default router;
