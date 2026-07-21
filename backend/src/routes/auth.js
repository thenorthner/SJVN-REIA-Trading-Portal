import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { logAudit } from '../util.js';

const router = Router();

// Enrich the auth payload with the user's own entity branding (logo + name) so
// Seller/Buyer portals can white-label the shell with their own identity.
function withBranding(u) {
  const base = {
    id: u.id, name: u.name, email: u.email, role: u.role,
    linked_entity_id: u.linked_entity_id || null,
  };
  if (base.linked_entity_id) {
    const ent = db.prepare('SELECT id, name, logo_url, category, entity_type FROM entities WHERE id = ?').get(base.linked_entity_id);
    if (ent) base.entity = { id: ent.id, name: ent.name, logo_url: ent.logo_url, category: ent.category, entity_type: ent.entity_type };
  }
  return base;
}

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
    user: withBranding(user),
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: withBranding(req.user) });
});

router.get('/users', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, is_active, created_at FROM users').all();
  res.json(users);
});

export default router;
