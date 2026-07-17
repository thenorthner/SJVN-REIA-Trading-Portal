import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit, newId } from '../util.js';

const router = Router();

// Get all users for the current user's entity
router.get('/', requireAuth, (req, res) => {
  let sql;
  let params = [];
  
  if (['SJVN_ADMIN', 'REIA_ADMIN', 'IT_SUPER_ADMIN'].includes(req.user.role)) {
    // Admins see all users
    sql = 'SELECT id, name, email, role, linked_entity_id, is_active, created_at FROM users';
  } else if (req.user.linked_entity_id) {
    // Entities see their own users
    sql = 'SELECT id, name, email, role, linked_entity_id, is_active, created_at FROM users WHERE linked_entity_id = ?';
    params.push(req.user.linked_entity_id);
  } else {
    // Users with no linked entity who aren't admins see only themselves
    sql = 'SELECT id, name, email, role, linked_entity_id, is_active, created_at FROM users WHERE id = ?';
    params.push(req.user.id);
  }
  
  const users = db.prepare(sql).all(...params);
  res.json(users);
});

// Create a new user (Team Member)
router.post('/', requireAuth, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Validate caller has permission to create users
  const isSuperAdmin = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_ADMIN'].includes(req.user.role);
  const isCompanyAdmin = ['SELLER', 'BUYER', 'SELLER_L3', 'BUYER_L3'].includes(req.user.role);
  
  if (!isSuperAdmin && !isCompanyAdmin) {
    return res.status(403).json({ error: 'Insufficient permissions to add team members' });
  }
  
  // Validate role assignment
  if (isCompanyAdmin && !isSuperAdmin) {
    // Company admins can only create L1/L2 roles for their own type
    const isSeller = req.user.role.startsWith('SELLER');
    const validRoles = isSeller ? ['SELLER_L1', 'SELLER_L2'] : ['BUYER_L1', 'BUYER_L2'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'You can only assign L1 or L2 roles for your entity type' });
    }
  }

  const linked_entity_id = isSuperAdmin ? req.body.linked_entity_id : req.user.linked_entity_id;
  
  try {
    const hash = bcrypt.hashSync(password, 10);
    const userId = newId('USR');
    
    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, linked_entity_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, name, email.toLowerCase(), hash, role, linked_entity_id || null);
    
    logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'CREATE', module: 'AUTH', entityType: 'user', entityId: userId });
    
    res.json({ success: true, id: userId });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user status
router.put('/:id/status', requireAuth, (req, res) => {
  const { is_active } = req.body;
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  
  if (!targetUser) return res.status(404).json({ error: 'User not found' });
  
  const isSuperAdmin = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_ADMIN'].includes(req.user.role);
  const isCompanyAdmin = ['SELLER', 'BUYER', 'SELLER_L3', 'BUYER_L3'].includes(req.user.role);
  
  if (!isSuperAdmin && !(isCompanyAdmin && targetUser.linked_entity_id === req.user.linked_entity_id)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, req.params.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'UPDATE_STATUS', module: 'AUTH', entityType: 'user', entityId: req.params.id, details: { is_active } });
  
  res.json({ success: true });
});

export default router;
