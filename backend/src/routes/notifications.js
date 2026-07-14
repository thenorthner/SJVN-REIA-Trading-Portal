import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// L. Notification and Alert System
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? OR role = ? ORDER BY created_at DESC LIMIT 50
  `).all(req.user.id, req.user.role);
  res.json(rows);
});

router.post('/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? OR role = ?').run(req.user.id, req.user.role);
  res.json({ ok: true });
});

export default router;
