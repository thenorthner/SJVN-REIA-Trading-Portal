import { Router } from 'express';
import multer from 'multer';
import { firstUnreadablePdf, UNREADABLE_PDF_MESSAGE } from '../services/fileChecks.js';
import path from 'path';
import fs from 'fs';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import {
  attachmentDir, directory, sendMessage, listBox, unreadCount, getMessage,
  setRead, setArchived, setStarred, removeForUser, restoreForUser, purgeForUser, bulkAction, attachmentFor,
  listDrafts, draftCount, getDraft, saveDraft, deleteDraft, addDraftFiles, removeDraftFile,
  getSettings, saveSettings,
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
  res.json({ unread: unreadCount(req.mailUser), drafts: draftCount(req.mailUser) });
});

// GET /mail?box=INBOX|SENT|ARCHIVE|STARRED|TRASH&q=&unread=1&sort=newest|oldest&limit=&offset=
router.get('/', (req, res) => {
  try {
    res.json(listBox(req.mailUser, {
      box: req.query.box, q: req.query.q, limit: req.query.limit, offset: req.query.offset,
      unread: req.query.unread, sort: req.query.sort,
    }));
  } catch (err) {
    fail(res, err);
  }
});

const draftFields = (b) => ({
  to: b.to,
  cc: b.cc,
  bcc: b.bcc,
  subject: b.subject,
  body: b.body,
  bodyHtml: b.body_html,
  replyTo: b.reply_to || null,
  forwardAttachments: b.forward_attachments,
});

// Drafts are the author's own and are not audited: nothing has been sent.
// GET /mail/drafts?q=
router.get('/drafts', (req, res) => {
  res.json(listDrafts(req.mailUser, { q: req.query.q }));
});

// POST /mail/drafts — start one. PUT /mail/drafts/:id — save over it.
router.post('/drafts', (req, res) => {
  try {
    res.status(201).json(saveDraft(req.mailUser, null, draftFields(req.body)));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/drafts/:id', (req, res) => {
  try {
    res.json(getDraft(req.mailUser, req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

router.put('/drafts/:id', (req, res) => {
  try {
    res.json(saveDraft(req.mailUser, req.params.id, draftFields(req.body)));
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/drafts/:id', (req, res) => {
  try {
    deleteDraft(req.mailUser, req.params.id);
    res.json({ ok: true, drafts: draftCount(req.mailUser) });
  } catch (err) {
    fail(res, err);
  }
});

/** An attachment the recipient could not open is refused before the message is. */
function refuseBrokenPdfs(files) {
  const bad = firstUnreadablePdf(files || []);
  if (bad) throw Object.assign(new Error(`${bad} ${UNREADABLE_PDF_MESSAGE}`), { status: 400 });
}

// POST /mail/drafts/:id/files — attach to a draft. DELETE …/files/:fileId — take one off.
router.post('/drafts/:id/files', upload.array('files', 5), (req, res) => {
  try {
    refuseBrokenPdfs(req.files);
    res.status(201).json(addDraftFiles(req.mailUser, req.params.id, req.files || []));
  } catch (err) {
    for (const f of req.files || []) {
      try { fs.unlinkSync(f.path); } catch { /* already gone */ }
    }
    fail(res, err);
  }
});

router.delete('/drafts/:id/files/:fileId', (req, res) => {
  try {
    res.json(removeDraftFile(req.mailUser, req.params.id, req.params.fileId));
  } catch (err) {
    fail(res, err);
  }
});

// POST /mail/bulk { ids: [...], action } — read, unread, archive, unarchive,
// star, unstar, trash, restore or purge, over many messages at once.
router.post('/bulk', (req, res) => {
  try {
    const done = bulkAction(req.mailUser, req.body.ids, req.body.action);
    res.json({ ok: true, done, unread: unreadCount(req.mailUser) });
  } catch (err) {
    fail(res, err);
  }
});

// GET / PUT /mail/settings — this person's signature.
router.get('/settings', (req, res) => {
  res.json(getSettings(req.mailUser));
});

router.put('/settings', (req, res) => {
  try {
    res.json(saveSettings(req.mailUser, { signature: req.body.signature }));
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
    refuseBrokenPdfs(req.files);
    const msg = sendMessage(req.mailUser, {
      to: req.body.to,
      cc: req.body.cc,
      bcc: req.body.bcc,
      subject: req.body.subject,
      body: req.body.body,
      bodyHtml: req.body.body_html,
      replyTo: req.body.reply_to || null,
      files: req.files || [],
      forwardAttachments: req.body.forward_attachments,
      draftId: req.body.draft_id || null,
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

// POST /mail/:id/star { starred: true|false }
router.post('/:id/star', (req, res) => {
  try {
    setStarred(req.mailUser, req.params.id, req.body.starred !== false);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// POST /mail/:id/restore — back out of the trash.
router.post('/:id/restore', (req, res) => {
  try {
    restoreForUser(req.mailUser, req.params.id);
    res.json({ ok: true, unread: unreadCount(req.mailUser) });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /mail/:id — to this user's trash. ?forever=1 — out of their mail for
// good. Either way it is theirs alone; everyone else keeps their copy.
router.delete('/:id', (req, res) => {
  try {
    if (req.query.forever === '1') purgeForUser(req.mailUser, req.params.id);
    else removeForUser(req.mailUser, req.params.id);
    res.json({ ok: true, unread: unreadCount(req.mailUser) });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
