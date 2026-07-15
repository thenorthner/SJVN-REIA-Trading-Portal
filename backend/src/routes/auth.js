import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { logAudit } from '../util.js';

const router = Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken(user);
  logAudit({ req: typeof req !== "undefined" ? req : null, user, action: 'LOGIN', module: 'AUTH', entityType: 'user', entityId: user.id });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.get('/users', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, is_active, created_at FROM users').all();
  res.json(users);
});

export default router;
