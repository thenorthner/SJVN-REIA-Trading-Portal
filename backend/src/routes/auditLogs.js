import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// N. Auditability and Traceability
router.get('/', requireRole(...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { module, entity_id } = req.query;
  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];
  if (module) { sql += ' AND module = ?'; params.push(module); }
  if (entity_id) { sql += ' AND entity_id = ?'; params.push(entity_id); }
  sql += ' ORDER BY created_at DESC LIMIT 300';
  res.json(db.prepare(sql).all(...params));
});

export default router;
