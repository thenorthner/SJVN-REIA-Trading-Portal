import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import {
  attachmentDir, directory, sendMessage, listBox, unreadCount, getMessage,
  setRead, setArchived, removeForUser, attachmentFor,
} from '../services/mail.js';

// In-portal mail. Every signed-in user has a mailbox; the rules on who may write
// to whom are in services/mail.js.

const router = Router();
router.use(requireAuth);

// The token says who signed in; the users row says who they are now — a
// deactivated login or a changed company must not keep its old reach.
router.use((req, res, next) => {
  const me = db.prepare(`
    SELECT id, name, email, role, linked_entity_id, is_active FROM users WHERE id = ?
  `).get(req.user?.id);
  if (!me || !me.is_active) return res.status(403).json({ error: 'This login is not active' });
  req.mailUser = me;
  next();
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, attachmentDir()),
    filename: (_req, file, cb) => cb(null, `${newId('MAF')}${path.extname(file.originalname || '').slice(0, 12)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

const fail = (res, err) => res.status(err.status || 400).json({ error: err.message });

// GET /mail/directory?q= — the people this user may write to.
router.get('/directory', (req, res) => {
  res.json(directory(req.mailUser, req.query.q));
});

// GET /mail/unread-count
router.get('/unread-count', (req, res) => {
  res.json({ unread: unreadCount(req.mailUser) });
});

// GET /mail?box=INBOX|SENT|ARCHIVE&q=
router.get('/', (req, res) => {
  try {
    res.json(listBox(req.mailUser, { box: req.query.box, q: req.query.q, limit: req.query.limit }));
  } catch (err) {
    fail(res, err);
  }
});

// GET /mail/attachments/:id — only to someone who has the message.
router.get('/attachments/:id', (req, res) => {
  try {
    const a = attachmentFor(req.mailUser, req.params.id);
    if (!fs.existsSync(a.path)) return res.status(404).json({ error: 'Attachment file is missing' });
    res.download(a.path, a.filename);
  } catch (err) {
    fail(res, err);
  }
});

// GET /mail/:id — the message and its conversation; marks it read.
router.get('/:id', (req, res) => {
  try {
    res.json(getMessage(req.mailUser, req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

// POST /mail — send. Multipart when there are attachments, JSON otherwise.
router.post('/', upload.array('files', 5), (req, res) => {
  try {
    const msg = sendMessage(req.mailUser, {
      to: req.body.to,
      cc: req.body.cc,
      subject: req.body.subject,
      body: req.body.body,
      replyTo: req.body.reply_to || null,
      files: req.files || [],
    });
    const sent = msg.messages[msg.messages.length - 1];
    secureLogAudit(req, {
      action: 'MAIL_SENT',
      module: 'MAIL',
      entityType: 'mail_messages',
      entityId: msg.id,
      // Who wrote to whom, and when — not what was said.
      afterValue: {
        to: sent.recipients.map((r) => r.id),
        attachments: sent.attachments.length,
        reply_to: req.body.reply_to || null,
      },
    });
    res.status(201).json(msg);
  } catch (err) {
    // A refused message must not leave its uploads behind.
    for (const f of req.files || []) {
      try { fs.unlinkSync(f.path); } catch { /* already gone */ }
    }
    fail(res, err);
  }
});

// POST /mail/:id/read { read: true|false }
router.post('/:id/read', (req, res) => {
  try {
    setRead(req.mailUser, req.params.id, req.body.read !== false);
    res.json({ ok: true, unread: unreadCount(req.mailUser) });
  } catch (err) {
    fail(res, err);
  }
});

// POST /mail/:id/archive { archived: true|false }
router.post('/:id/archive', (req, res) => {
  try {
    setArchived(req.mailUser, req.params.id, req.body.archived !== false);
    res.json({ ok: true, unread: unreadCount(req.mailUser) });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /mail/:id — removes it from this user's mail only.
router.delete('/:id', (req, res) => {
  try {
    removeForUser(req.mailUser, req.params.id);
    res.json({ ok: true, unread: unreadCount(req.mailUser) });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
