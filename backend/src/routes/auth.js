import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { signToken, requireAuth, canonicalRole } from '../middleware/auth.js';
import { logAudit, pushNotification } from '../util.js';

const router = Router();

// Enrich the auth payload with the user's own entity branding (logo + name) so
// Seller/Buyer portals can white-label the shell with their own identity.
function withBranding(u) {
  const base = {
    id: u.id, name: u.name, email: u.email, role: canonicalRole(u.role),
    linked_entity_id: u.linked_entity_id || null,
  };
  // Set when an admin issued the password, so the portal makes the holder choose their own.
  try {
    base.must_change_password = !!db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(u.id)?.must_change_password;
  } catch { base.must_change_password = false; }
  if (base.linked_entity_id) {
    const ent = db.prepare('SELECT id, name, logo_url, category, entity_type, status FROM entities WHERE id = ?').get(base.linked_entity_id);
    if (ent) base.entity = { id: ent.id, name: ent.name, logo_url: ent.logo_url, category: ent.category, entity_type: ent.entity_type, status: ent.status };
  }
  return base;
}

// Repeated failed sign-ins on one account are locked out for a while, so a
// password cannot be found by guessing at it. Attempts are held in memory rather
// than in the database: the counter only has to outlive a burst, and writing a
// row per failed guess is its own denial of service.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const failedLogins = new Map();   // email -> { count, firstAt, lockedUntil }

export function lockoutState(email) {
  const rec = failedLogins.get(email);
  if (!rec) return { locked: false };
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) {
    return { locked: true, retryInSeconds: Math.ceil((rec.lockedUntil - Date.now()) / 1000) };
  }
  if (rec.lockedUntil && rec.lockedUntil <= Date.now()) {
    failedLogins.delete(email);   // the lockout has run out
  }
  return { locked: false };
}

function noteFailedLogin(email) {
  const rec = failedLogins.get(email) || { count: 0, firstAt: Date.now() };
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_ATTEMPTS) rec.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
  failedLogins.set(email, rec);
  return rec;
}

export function clearLoginAttempts(email) {
  failedLogins.delete(String(email || '').toLowerCase());
}

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const key = String(email).toLowerCase();
  const lock = lockoutState(key);
  if (lock.locked) {
    logAudit({ req, user: { id: null, name: key, role: 'ANONYMOUS' }, action: 'LOGIN_BLOCKED', module: 'AUTH', entityType: 'user', entityId: key, reason: 'account temporarily locked' });
    return res.status(429).json({
      error: `Too many failed sign-in attempts. Try again in ${Math.ceil(lock.retryInSeconds / 60)} minute(s).`,
      retry_after_seconds: lock.retryInSeconds,
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(key);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    const rec = noteFailedLogin(key);
    // A failed sign-in is recorded too — an attack shows up as a run of these,
    // and a log of successes alone would not show it.
    logAudit({ req, user: { id: user?.id || null, name: key, role: user?.role || 'ANONYMOUS' }, action: 'LOGIN_FAILED', module: 'AUTH', entityType: 'user', entityId: user?.id || key, details: { attempt: rec.count } });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  clearLoginAttempts(key);
  const token = signToken(user);
  const previous = previousSession(user.id, req.ip);
  logAudit({ req, user, action: 'LOGIN', module: 'AUTH', entityType: 'user', entityId: user.id });
  if (previous?.concurrent) {
    // CERT-In: a second live session from somewhere else is how a shared or
    // stolen password shows up. The holder is told, and it is on the record.
    logAudit({ req, user, action: 'CONCURRENT_LOGIN_ALERT', module: 'AUTH', entityType: 'user', entityId: user.id, details: { other_ip: previous.ip, other_since: previous.at } });
    try {
      pushNotification({ userId: user.id, type: 'SECURITY', message: `New sign-in from ${req.ip || 'an unknown address'} while a session from ${previous.ip || 'another address'} (since ${previous.at} UTC) was still open. If this was not you, change your password.`, link: '/settings/user-profile#privacy' });
    } catch { /* the audit row is the record that matters */ }
  }
  res.json({
    token,
    user: withBranding(user),
    previous_login: previous,
  });
});

// Sessions last as long as the token (12 h), so a sign-in within that window
// with no sign-out after it is taken as still open.
const SESSION_HOURS = 12;
function previousSession(userId, ip) {
  try {
    const last = db.prepare(`
      SELECT rowid AS rid, ip_address, created_at FROM audit_logs
      WHERE user_id = ? AND module = 'AUTH' AND action = 'LOGIN'
      ORDER BY rowid DESC LIMIT 1
    `).get(userId);
    if (!last) return null;
    const ended = db.prepare(`
      SELECT 1 FROM audit_logs
      WHERE user_id = ? AND module = 'AUTH' AND action IN ('LOGOUT','SESSION_TIMEOUT','SESSIONS_REVOKED') AND rowid > ?
      LIMIT 1
    `).get(userId, last.rid);
    const fresh = Date.parse(`${last.created_at.replace(' ', 'T')}Z`) > Date.now() - SESSION_HOURS * 3_600_000;
    return {
      at: last.created_at,
      ip: last.ip_address || null,
      concurrent: !ended && fresh && !!last.ip_address && !!ip && last.ip_address !== ip,
    };
  } catch (err) {
    console.error('[AUTH] previous-session check failed', err.message);
    return null;
  }
}

// Sign-out is recorded (CERT-In asks for sign-in and sign-out in the logs). The
// token itself expires on its own; the inactivity sign-out sends its reason.
router.post('/logout', requireAuth, (req, res) => {
  const reason = req.body?.reason === 'IDLE_TIMEOUT' ? 'IDLE_TIMEOUT' : 'USER_LOGOUT';
  logAudit({
    req, user: req.user,
    action: reason === 'IDLE_TIMEOUT' ? 'SESSION_TIMEOUT' : 'LOGOUT',
    module: 'AUTH', entityType: 'user', entityId: req.user.id,
    reason: reason === 'IDLE_TIMEOUT' ? 'signed out after inactivity' : null,
  });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  // While acting for someone (additional charge or break-glass) the role is the
  // one handed over; the screen also needs to know whose it is and the officer's own.
  res.json({ user: { ...withBranding(req.user), name: req.user.name, acting: req.user.acting || null, real_role: req.user.real?.role || null } });
});

router.get('/users', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, is_active, created_at FROM users').all();
  res.json(users);
});

// Password rules for a self-service change. Kept deliberately modest — long
// enough to be worth hashing, mixed enough that "password1" is refused — and
// stated in the error text so a rejected change says what to do about it.
const PASSWORD_MIN_LENGTH = 8;

export function passwordComplaint(password) {
  const pw = String(password || '');
  if (pw.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(pw)) return 'Password must contain at least one letter.';
  if (!/[0-9]/.test(pw)) return 'Password must contain at least one digit.';
  return null;
}

/**
 * Change one's own password.
 *
 * The current password is re-checked here even though the caller already holds a
 * valid token: a token left behind on a shared machine should not be enough to
 * lock the real owner out of the account.
 */
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password: currentPassword, new_password: newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'current_password and new_password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    logAudit({ req, user, action: 'PASSWORD_CHANGE_FAILED', module: 'AUTH', entityType: 'user', entityId: user.id, reason: 'current password did not match' });
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const complaint = passwordComplaint(newPassword);
  if (complaint) return res.status(400).json({ error: complaint });

  if (bcrypt.compareSync(newPassword, user.password_hash)) {
    return res.status(400).json({ error: 'New password must be different from the current one' });
  }

  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), user.id);
  // A pending lockout from earlier bad guesses is cleared: the account holder has
  // just proved who they are, and the old password no longer works anyway.
  clearLoginAttempts(String(user.email).toLowerCase());
  logAudit({ req, user, action: 'PASSWORD_CHANGED', module: 'AUTH', entityType: 'user', entityId: user.id });

  // A fresh token so the session continues rather than dropping the user at the
  // sign-in screen straight after a successful change.
  res.json({ success: true, token: signToken(user) });
});

export default router;
