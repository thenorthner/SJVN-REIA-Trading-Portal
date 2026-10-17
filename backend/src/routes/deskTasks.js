/** D4: the root-cause tasks resolved disputes leave on the Energy Data and Contract Compliance desks. */
import { Router } from 'express';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { listDeskTasks, closeDeskTask } from '../services/deskTasks.js';

const router = Router();
router.use(requireAuth);

router.get('/', requireRole(...ROLE_GROUPS.REIA_ALL), (req, res) => {
  res.json(listDeskTasks({ desk: req.query.desk || null, status: req.query.status || 'OPEN', contractId: req.query.contract_id || null }));
});

router.post('/:id/close', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  try { res.json(closeDeskTask(req.params.id, { status: req.body?.status || 'DONE', note: req.body?.note, user: req.user })); } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
});

export default router;
