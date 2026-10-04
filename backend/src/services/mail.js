/**
 * In-portal mail — one person writing to another inside the platform.
 *
 * Nothing here leaves the portal: there is no SMTP and no SMS, so what is
 * written stays on SJVN's server. A message is stored once and each person who
 * has it gets a mailbox row (mail_boxes) carrying their own read, archived and
 * deleted state.
 *
 * A message carries two bodies: the formatted one the reader sees, cleaned
 * here down to a short list of tags, and a plain one that search and previews
 * read. A blind copy is a mailbox row like any other, but only its sender —
 * and the person blind-copied, for their own row — is ever told of it.
 *
 * Who may write to whom:
 *
 *   SJVN staff    anyone with an active login
 *   counterparty  SJVN staff, and colleagues in their own company — never
 *   (seller,      another company. Sellers, buyers and trading clients are
 *   buyer,        competitors or customers of one another, and the portal
 *   client)       must not become a way to find or reach each other.
 *
 * The same rule decides who appears in the address book, so a counterparty
 * never even sees another company's names.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sanitizeHtml from 'sanitize-html';
import { load } from 'cheerio';
import db from '../db/index.js';
import { newId, pushNotification } from '../util.js';
import { SELLER_ROLES, BUYER_ROLES } from '../middleware/auth.js';
import { TRADING_CLIENT_ROLES, tradingClientIdFor } from './tradingClientScope.js';

export const MAX_RECIPIENTS = 50;
export const MAX_SUBJECT = 200;
export const MAX_BODY = 20000;
export const MAX_BODY_HTML = 100000;
export const MAX_SIGNATURE = 2000;
export const MAX_CARRIED_ATTACHMENTS = 20;
export const MAX_DRAFT_FILES = 5;
export const MAX_BULK = 500;
export const TRASH_DAYS = 30;

const EXTERNAL_ROLES = [...SELLER_ROLES, ...BUYER_ROLES, ...TRADING_CLIENT_ROLES];

export const isExternal = (user) => EXTERNAL_ROLES.includes(user?.role);

const fail = (status, message) => Object.assign(new Error(message), { status });

// What the editor can produce, and nothing else: no scripts, styles, images or
// frames, and links only to the web or a mail address.
const HTML_RULES = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'ol', 'ul', 'li', 'blockquote', 'a', 'h1', 'h2', 'h3',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'], li: ['class'], p: ['class'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
  },
  allowedClasses: { li: [/^ql-indent-[1-8]$/], p: [/^ql-indent-[1-8]$/] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }) },
};

export const cleanHtml = (html) => sanitizeHtml(String(html || ''), HTML_RULES).trim();

/** The words of a formatted body, one block to a line. */
export const htmlToText = (html) => load(
  String(html || '').replace(/<\/(p|li|h[1-3]|blockquote|tr)>|<br\s*\/?>/gi, '$&\n').replace(/<\/t[dh]>/gi, '$& '),
).text().replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/**
 * The two bodies of a message from whatever was sent: a formatted body is
 * cleaned and its words become the plain one; a plain body stands alone.
 */
function bodiesOf({ body, bodyHtml }) {
  const html = bodyHtml ? cleanHtml(bodyHtml) : '';
  if (html.length > MAX_BODY_HTML) throw fail(400, 'Message is too long');
  const text = html ? htmlToText(html) : String(body || '').trim();
  return { text, html: html && text ? html : null };
}

/** Where attachments are kept. Overridable so a test run keeps its own. */
export function attachmentDir() {
  const dir = process.env.SJVN_MAIL_DIR
    || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../uploads/mail');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The company a user belongs to, for the address book. SJVN staff have none. A
 * trading client's login may point at the client's own id or at the entity
 * behind it — both conventions are in the data — so both are looked up.
 */
const COMPANY_SQL = `COALESCE(e.name, (
  SELECT t.name FROM trading_clients t
  WHERE t.id = u.linked_entity_id OR t.entity_id = u.linked_entity_id LIMIT 1))`;
const USER_JOIN = `
  LEFT JOIN entities e ON e.id = u.linked_entity_id`;

/** What a user reads as their company: SJVN for staff, or the counterparty's name. */
const companyLabel = (u) => u.company || (isExternal(u) ? 'No company linked' : 'SJVN');

/**
 * Which company a counterparty login belongs to, as one comparable key, or
 * null for SJVN staff and for a login linked to no company. Two logins with
 * no company are not colleagues — an unlinked account reaches SJVN only.
 */
function companyKey(u) {
  if (!isExternal(u)) return null;
  if (TRADING_CLIENT_ROLES.includes(u.role)) {
    const id = tradingClientIdFor(u);
    return id ? `TC:${id}` : null;
  }
  return u.linked_entity_id ? `E:${u.linked_entity_id}` : null;
}

const sameCompany = (a, b) => {
  const ka = companyKey(a);
  return !!ka && ka === companyKey(b);
};

/** May `sender` write to `target`? Both are users rows. */
export function canWrite(sender, target) {
  if (!target || !target.is_active) return false;
  if (target.id === sender.id) return false;
  if (!isExternal(sender)) return true;
  if (!isExternal(target)) return true;
  return sameCompany(sender, target);
}

/** The people `user` may write to, filtered by a search string. */
export function directory(user, q = '') {
  const like = `%${String(q || '').trim().toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.linked_entity_id, u.is_active, ${COMPANY_SQL} AS company
    FROM users u ${USER_JOIN}
    WHERE u.is_active = 1 AND u.id <> ?
      AND (lower(u.name) LIKE ? OR lower(u.email) LIKE ? OR lower(COALESCE(${COMPANY_SQL}, 'SJVN')) LIKE ?)
    ORDER BY u.name
    LIMIT 500
  `).all(user.id, like, like, like);
  // SJVN staff first, then each company's people together.
  return rows
    .filter((t) => canWrite(user, t))
    .map((t) => ({ id: t.id, name: t.name, email: t.email, role: t.role, company: companyLabel(t), external: isExternal(t) }))
    .sort((x, y) => (x.external - y.external) || (x.external ? x.company.localeCompare(y.company) : 0) || x.name.localeCompare(y.name))
    .slice(0, 200)
    .map(({ external, ...rest }) => rest);
}

function usersById(ids) {
  if (!ids.length) return [];
  return db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.linked_entity_id, u.is_active, ${COMPANY_SQL} AS company
    FROM users u ${USER_JOIN}
    WHERE u.id IN (${ids.map(() => '?').join(',')})
  `).all(...ids);
}

const asList = (v) => {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.map(String);
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    return String(v).split(',').map((s) => s.trim()).filter(Boolean);
  }
};

/**
 * Send a message.
 *
 * A reply keeps its thread, and may only be written by someone who has the
 * message being replied to — otherwise a reply would be a way to attach to a
 * conversation one was never part of.
 */
export function sendMessage(sender, {
  to, cc, bcc, subject, body, bodyHtml, replyTo = null, files = [], forwardAttachments, draftId = null,
}) {
  const toIds = [...new Set(asList(to))];
  const ccIds = [...new Set(asList(cc))].filter((id) => !toIds.includes(id));
  const bccIds = [...new Set(asList(bcc))].filter((id) => !toIds.includes(id) && !ccIds.includes(id));
  const allIds = [...toIds, ...ccIds, ...bccIds];
  if (!toIds.length) throw fail(400, 'Choose at least one person to send to');
  if (allIds.length > MAX_RECIPIENTS) {
    throw fail(400, `A message can go to at most ${MAX_RECIPIENTS} people`);
  }

  const cleanSubject = String(subject || '').trim();
  const { text: cleanBody, html: cleanBodyHtml } = bodiesOf({ body, bodyHtml });
  if (!cleanSubject) throw fail(400, 'A message needs a subject');
  if (cleanSubject.length > MAX_SUBJECT) throw fail(400, `Subject is limited to ${MAX_SUBJECT} characters`);
  if (!cleanBody) throw fail(400, 'A message needs a body');
  if (cleanBody.length > MAX_BODY) throw fail(400, `Message is limited to ${MAX_BODY} characters`);

  const found = usersById(allIds);
  const byId = new Map(found.map((u) => [u.id, u]));
  const refused = allIds.filter((id) => !canWrite(sender, byId.get(id)));
  if (refused.length) {
    throw fail(403, `You cannot write to ${refused.length === 1 ? 'one of the people chosen' : `${refused.length} of the people chosen`}`);
  }

  let threadId = null;
  let parentId = null;
  if (replyTo) {
    const parent = db.prepare(`
      SELECT m.id, m.thread_id FROM mail_messages m
      JOIN mail_boxes b ON b.message_id = m.id AND b.user_id = ?
      WHERE m.id = ?
    `).get(sender.id, replyTo);
    if (!parent) throw fail(404, 'The message being replied to was not found');
    threadId = parent.thread_id;
    parentId = parent.id;
  }

  // A forward carries the original's files: the sender must have them, and the
  // stored file is shared rather than copied.
  const carriedIds = [...new Set(asList(forwardAttachments))];
  if (carriedIds.length > MAX_CARRIED_ATTACHMENTS) {
    throw fail(400, `At most ${MAX_CARRIED_ATTACHMENTS} attachments can be forwarded`);
  }
  const carried = carriedIds.map((aid) => attachmentFor(sender, aid));
  // Files already uploaded to the draft this message was written as.
  const draftFiles = draftId ? db.prepare(`
    SELECT f.* FROM mail_draft_files f JOIN mail_drafts d ON d.id = f.draft_id
    WHERE d.id = ? AND d.user_id = ? ORDER BY f.created_at, f.rowid
  `).all(String(draftId), sender.id) : [];

  const id = newId('MSG');
  db.transaction(() => {
    db.prepare(`
      INSERT INTO mail_messages (id, thread_id, parent_id, sender_id, subject, body, body_html)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, threadId || id, parentId, sender.id, cleanSubject, cleanBody, cleanBodyHtml);

    const box = db.prepare(`
      INSERT INTO mail_boxes (id, message_id, user_id, box, recipient_kind, read_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    box.run(newId('MBX'), id, sender.id, 'SENT', null, new Date().toISOString());
    for (const uid of toIds) box.run(newId('MBX'), id, uid, 'INBOX', 'TO', null);
    for (const uid of ccIds) box.run(newId('MBX'), id, uid, 'INBOX', 'CC', null);
    for (const uid of bccIds) box.run(newId('MBX'), id, uid, 'INBOX', 'BCC', null);

    const att = db.prepare(`
      INSERT INTO mail_attachments (id, message_id, filename, stored_name, mime_type, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const f of files) {
      att.run(newId('MAT'), id, f.originalname || f.filename, f.filename, f.mimetype || null, f.size || 0);
    }
    for (const a of [...draftFiles, ...carried]) {
      att.run(newId('MAT'), id, a.filename, a.stored_name, a.mime_type, a.size_bytes);
    }

    // What was a draft is now a message.
    // Its files now belong to the message, so only the rows go — not the files.
    if (draftId) {
      db.prepare('DELETE FROM mail_draft_files WHERE draft_id IN (SELECT id FROM mail_drafts WHERE id = ? AND user_id = ?)')
        .run(String(draftId), sender.id);
      db.prepare('DELETE FROM mail_drafts WHERE id = ? AND user_id = ?').run(String(draftId), sender.id);
    }
  })();

  // The bell tells them something arrived; the message itself stays in Mail.
  for (const uid of allIds) {
    try {
      pushNotification({ userId: uid, type: 'MAIL', message: `New mail from ${sender.name}: ${cleanSubject}` });
    } catch { /* the message is already delivered; the bell is a courtesy */ }
  }

  return getMessage(sender, id, { markRead: false });
}

/**
 * Who a message went to, as `viewer` may see it.
 *
 * SJVN staff can put two companies on one message. A counterparty reading it
 * sees SJVN and its own company only — the other companies are left off the
 * list as if they had been blind-copied, so the portal never tells one seller
 * or buyer who else SJVN is writing to.
 *
 * A blind copy is shown to the person who sent the message, and to the person
 * blind-copied as their own row only. The sender is also told when each
 * person first opened it.
 */
function recipientsOf(viewer, messageIds) {
  if (!messageIds.length) return new Map();
  const rows = db.prepare(`
    SELECT b.message_id, b.recipient_kind, b.opened_at, m.sender_id, u.id, u.name, u.email, u.role, u.linked_entity_id,
           ${COMPANY_SQL} AS company
    FROM mail_boxes b JOIN mail_messages m ON m.id = b.message_id
    JOIN users u ON u.id = b.user_id ${USER_JOIN}
    WHERE b.box = 'INBOX' AND b.message_id IN (${messageIds.map(() => '?').join(',')})
    ORDER BY b.recipient_kind DESC, u.name
  `).all(...messageIds);
  const external = isExternal(viewer);
  const map = new Map();
  for (const r of rows) {
    if (r.recipient_kind === 'BCC' && viewer.id !== r.sender_id && viewer.id !== r.id) continue;
    if (external && r.id !== viewer.id && isExternal(r) && !sameCompany(viewer, r)) continue;
    if (!map.has(r.message_id)) map.set(r.message_id, []);
    map.get(r.message_id).push({
      id: r.id, name: r.name, email: r.email, company: companyLabel(r), kind: r.recipient_kind,
      // Who has opened it is for the person who sent it, and nobody else.
      ...(viewer.id === r.sender_id ? { opened_at: r.opened_at } : {}),
    });
  }
  return map;
}

function attachmentsOf(messageIds) {
  if (!messageIds.length) return new Map();
  const rows = db.prepare(`
    SELECT id, message_id, filename, mime_type, size_bytes FROM mail_attachments
    WHERE message_id IN (${messageIds.map(() => '?').join(',')})
    ORDER BY created_at
  `).all(...messageIds);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.message_id)) map.set(r.message_id, []);
    map.get(r.message_id).push({ id: r.id, filename: r.filename, mime_type: r.mime_type, size_bytes: r.size_bytes });
  }
  return map;
}

/**
 * A folder of the user's mail.
 *
 *   INBOX    received, not archived
 *   SENT     written by them
 *   ARCHIVE  received and archived
 *   STARRED  anything of theirs they have starred
 *   TRASH    what they deleted, until it is restored, emptied, or TRASH_DAYS old
 */
const FOLDER_SQL = {
  INBOX: "b.box = 'INBOX' AND b.deleted_at IS NULL AND b.archived_at IS NULL",
  SENT: "b.box = 'SENT' AND b.deleted_at IS NULL",
  ARCHIVE: "b.box = 'INBOX' AND b.deleted_at IS NULL AND b.archived_at IS NOT NULL",
  STARRED: 'b.deleted_at IS NULL AND b.starred_at IS NOT NULL',
  TRASH: 'b.deleted_at IS NOT NULL',
};

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

export function listBox(user, { box = 'INBOX', q = '', limit = 100, offset = 0, unread = false, sort = 'newest' } = {}) {
  const folder = String(box || 'INBOX').toUpperCase();
  if (!FOLDER_SQL[folder]) throw fail(400, `box must be one of ${Object.keys(FOLDER_SQL).join(', ')}`);
  const like = `%${String(q || '').trim().toLowerCase()}%`;
  const onlyUnread = folder !== 'SENT' && truthy(unread);
  const dir = String(sort).toLowerCase() === 'oldest' ? 'ASC' : 'DESC';

  // The trash empties itself of what has sat in it long enough.
  if (folder === 'TRASH') {
    db.prepare(`
      UPDATE mail_boxes SET purged_at = datetime('now')
      WHERE user_id = ? AND purged_at IS NULL AND deleted_at IS NOT NULL
        AND deleted_at < datetime('now', '-${TRASH_DAYS} days')
    `).run(user.id);
  }

  const rows = db.prepare(`
    SELECT m.id, m.thread_id, m.subject, substr(m.body, 1, 160) AS preview, m.created_at,
           b.box, b.read_at, b.archived_at, b.starred_at, b.deleted_at,
           s.id AS sender_id, s.name AS sender_name, s.email AS sender_email,
           (SELECT COUNT(*) FROM mail_attachments a WHERE a.message_id = m.id) AS attachment_count
    FROM mail_boxes b
    JOIN mail_messages m ON m.id = b.message_id
    JOIN users s ON s.id = m.sender_id
    WHERE b.user_id = ? AND b.purged_at IS NULL
      AND ${FOLDER_SQL[folder]}
      ${onlyUnread ? "AND b.box = 'INBOX' AND b.read_at IS NULL" : ''}
      AND (lower(m.subject) LIKE ? OR lower(m.body) LIKE ? OR lower(s.name) LIKE ?)
    ORDER BY m.created_at ${dir}, m.rowid ${dir}
    LIMIT ? OFFSET ?
  `).all(user.id, like, like, like, Math.min(Math.max(Number(limit) || 100, 1), 1000), Math.max(Number(offset) || 0, 0));

  const recips = recipientsOf(user, rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    is_read: !!r.read_at,
    is_starred: !!r.starred_at,
    recipients: recips.get(r.id) || [],
  }));
}

export function unreadCount(user) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM mail_boxes
    WHERE user_id = ? AND box = 'INBOX' AND read_at IS NULL AND deleted_at IS NULL AND archived_at IS NULL
  `).get(user.id).n;
}

/**
 * One message, with the rest of its conversation — only the parts of the
 * thread this user actually has. Opening it marks it read. A message in the
 * trash can still be opened, on its own, until the trash is emptied.
 */
export function getMessage(user, messageId, { markRead = true } = {}) {
  const mine = db.prepare(`
    SELECT b.*, m.thread_id FROM mail_boxes b JOIN mail_messages m ON m.id = b.message_id
    WHERE b.message_id = ? AND b.user_id = ? AND b.purged_at IS NULL
    ORDER BY (b.box = 'INBOX') DESC LIMIT 1
  `).get(messageId, user.id);
  if (!mine) throw fail(404, 'Message not found');

  if (markRead) {
    db.prepare(`
      UPDATE mail_boxes SET read_at = COALESCE(read_at, datetime('now')), opened_at = COALESCE(opened_at, datetime('now'))
      WHERE message_id = ? AND user_id = ? AND box = 'INBOX'
    `).run(messageId, user.id);
  }

  const thread = db.prepare(`
    SELECT DISTINCT m.id, m.parent_id, m.subject, m.body, m.body_html, m.created_at,
           s.id AS sender_id, s.name AS sender_name, s.email AS sender_email
    FROM mail_messages m
    JOIN mail_boxes b ON b.message_id = m.id AND b.user_id = ? AND b.purged_at IS NULL
    JOIN users s ON s.id = m.sender_id
    WHERE m.thread_id = ? AND (b.deleted_at IS NULL OR m.id = ?)
    ORDER BY m.created_at, m.rowid
  `).all(user.id, mine.thread_id, messageId);

  const ids = thread.map((t) => t.id);
  const recips = recipientsOf(user, ids);
  const atts = attachmentsOf(ids);
  return {
    id: messageId,
    thread_id: mine.thread_id,
    box: mine.box,
    archived: !!mine.archived_at,
    starred: !!mine.starred_at,
    trashed: !!mine.deleted_at,
    messages: thread.map((t) => ({
      ...t, recipients: recips.get(t.id) || [], attachments: atts.get(t.id) || [],
    })),
  };
}

function ownRows(user, messageId) {
  const n = db.prepare(`
    SELECT COUNT(*) AS n FROM mail_boxes WHERE message_id = ? AND user_id = ? AND purged_at IS NULL
  `).get(messageId, user.id).n;
  if (!n) throw fail(404, 'Message not found');
}

export function setRead(user, messageId, read) {
  ownRows(user, messageId);
  db.prepare(`
    UPDATE mail_boxes SET read_at = ${read ? "COALESCE(read_at, datetime('now'))" : 'NULL'}
    WHERE message_id = ? AND user_id = ? AND box = 'INBOX'
  `).run(messageId, user.id);
}

export function setArchived(user, messageId, archived) {
  ownRows(user, messageId);
  db.prepare(`
    UPDATE mail_boxes SET archived_at = ${archived ? "datetime('now')" : 'NULL'}
    WHERE message_id = ? AND user_id = ? AND box = 'INBOX'
  `).run(messageId, user.id);
}

export function setStarred(user, messageId, starred) {
  ownRows(user, messageId);
  db.prepare(`
    UPDATE mail_boxes SET starred_at = ${starred ? "COALESCE(starred_at, datetime('now'))" : 'NULL'}
    WHERE message_id = ? AND user_id = ? AND purged_at IS NULL
  `).run(messageId, user.id);
}

/** Move a message to this person's trash. Everyone else keeps their copy. */
export function removeForUser(user, messageId) {
  ownRows(user, messageId);
  db.prepare(`
    UPDATE mail_boxes SET deleted_at = datetime('now')
    WHERE message_id = ? AND user_id = ? AND deleted_at IS NULL AND purged_at IS NULL
  `).run(messageId, user.id);
}

/** Take a message back out of the trash, to wherever it was. */
export function restoreForUser(user, messageId) {
  ownRows(user, messageId);
  db.prepare(`
    UPDATE mail_boxes SET deleted_at = NULL
    WHERE message_id = ? AND user_id = ? AND purged_at IS NULL
  `).run(messageId, user.id);
}

/**
 * Remove a message from this person's mail for good. The message itself stays
 * on file for everyone else who has it, and for the audit.
 */
export function purgeForUser(user, messageId) {
  ownRows(user, messageId);
  db.prepare(`
    UPDATE mail_boxes SET purged_at = datetime('now'), deleted_at = COALESCE(deleted_at, datetime('now'))
    WHERE message_id = ? AND user_id = ? AND purged_at IS NULL
  `).run(messageId, user.id);
}

const BULK = {
  read: (u, id) => setRead(u, id, true),
  unread: (u, id) => setRead(u, id, false),
  archive: (u, id) => setArchived(u, id, true),
  unarchive: (u, id) => setArchived(u, id, false),
  star: (u, id) => setStarred(u, id, true),
  unstar: (u, id) => setStarred(u, id, false),
  trash: removeForUser,
  restore: restoreForUser,
  purge: purgeForUser,
};

/** One action over many messages. Ids that are not this person's are passed over. */
export function bulkAction(user, ids, action) {
  const fn = BULK[action];
  if (!fn) throw fail(400, `action must be one of ${Object.keys(BULK).join(', ')}`);
  const list = [...new Set(asList(ids))];
  if (!list.length) throw fail(400, 'Choose at least one message');
  if (list.length > MAX_BULK) throw fail(400, `At most ${MAX_BULK} messages at a time`);
  let done = 0;
  db.transaction(() => {
    for (const id of list) {
      try { fn(user, id); done += 1; } catch (err) { if (err.status !== 404) throw err; }
    }
  })();
  return done;
}

/** An attachment, if this user has the message it came with. */
export function attachmentFor(user, attachmentId) {
  const a = db.prepare(`
    SELECT a.* FROM mail_attachments a
    WHERE a.id = ? AND EXISTS (
      SELECT 1 FROM mail_boxes b WHERE b.message_id = a.message_id AND b.user_id = ? AND b.purged_at IS NULL
    )
  `).get(attachmentId, user.id);
  if (!a) throw fail(404, 'Attachment not found');
  return { ...a, path: path.join(attachmentDir(), a.stored_name) };
}

// ── Drafts ──────────────────────────────────────────────────────────────────

const personOf = (u) => ({ id: u.id, name: u.name, email: u.email, company: companyLabel(u) });

/** The people on a draft who can still be written to, in the order chosen. */
function draftPeople(user, json) {
  const ids = asList(json);
  const byId = new Map(usersById(ids).map((u) => [u.id, u]));
  return ids.map((id) => byId.get(id)).filter((u) => u && canWrite(user, u)).map(personOf);
}

function draftView(user, d) {
  const files = [];
  for (const aid of asList(d.forward_attachments)) {
    try {
      const a = attachmentFor(user, aid);
      files.push({ id: a.id, filename: a.filename, size_bytes: a.size_bytes });
    } catch { /* the original is gone from their mail; the draft goes on without it */ }
  }
  return {
    id: d.id,
    subject: d.subject,
    body: d.body,
    body_html: d.body_html,
    preview: d.body.slice(0, 160),
    reply_to: d.reply_to,
    to: draftPeople(user, d.to_ids),
    cc: draftPeople(user, d.cc_ids),
    bcc: draftPeople(user, d.bcc_ids),
    forward_attachments: files,
    files: draftFilesOf(d.id).map((f) => ({ id: f.id, filename: f.filename, size_bytes: f.size_bytes })),
    updated_at: d.updated_at,
  };
}

const draftFilesOf = (draftId) => db.prepare(
  'SELECT * FROM mail_draft_files WHERE draft_id = ? ORDER BY created_at, rowid',
).all(draftId);

const unlinkStored = (storedName) => {
  try { fs.unlinkSync(path.join(attachmentDir(), storedName)); } catch { /* already gone */ }
};

function ownDraft(user, id) {
  const d = db.prepare('SELECT * FROM mail_drafts WHERE id = ? AND user_id = ?').get(String(id), user.id);
  if (!d) throw fail(404, 'Draft not found');
  return d;
}

export function listDrafts(user, { q = '' } = {}) {
  const like = `%${String(q || '').trim().toLowerCase()}%`;
  return db.prepare(`
    SELECT * FROM mail_drafts
    WHERE user_id = ? AND (lower(subject) LIKE ? OR lower(body) LIKE ?)
    ORDER BY updated_at DESC, rowid DESC LIMIT 200
  `).all(user.id, like, like).map((d) => draftView(user, d));
}

export const draftCount = (user) => db.prepare(
  'SELECT COUNT(*) AS n FROM mail_drafts WHERE user_id = ?',
).get(user.id).n;

export const getDraft = (user, id) => draftView(user, ownDraft(user, id));

/**
 * Keep what has been written so far. A draft may be half a message — no
 * recipient, no subject — so nothing is required of it; who it may go to is
 * checked when it is sent.
 */
export function saveDraft(user, id, { to, cc, bcc, subject, body, bodyHtml, replyTo = null, forwardAttachments }) {
  const { text, html } = bodiesOf({ body, bodyHtml });
  const fields = [
    JSON.stringify(asList(to).slice(0, MAX_RECIPIENTS)),
    JSON.stringify(asList(cc).slice(0, MAX_RECIPIENTS)),
    JSON.stringify(asList(bcc).slice(0, MAX_RECIPIENTS)),
    String(subject || '').slice(0, MAX_SUBJECT),
    text.slice(0, MAX_BODY),
    html,
    replyTo ? String(replyTo) : null,
    JSON.stringify(asList(forwardAttachments).slice(0, MAX_CARRIED_ATTACHMENTS)),
  ];
  let draftId = id;
  if (draftId) {
    ownDraft(user, draftId);
    db.prepare(`
      UPDATE mail_drafts SET to_ids = ?, cc_ids = ?, bcc_ids = ?, subject = ?, body = ?, body_html = ?,
        reply_to = ?, forward_attachments = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(...fields, String(draftId), user.id);
  } else {
    draftId = newId('MDR');
    db.prepare(`
      INSERT INTO mail_drafts (to_ids, cc_ids, bcc_ids, subject, body, body_html, reply_to, forward_attachments, id, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...fields, draftId, user.id);
  }
  return getDraft(user, draftId);
}

/** Attach uploaded files to a draft, so they are still there when it is reopened. */
export function addDraftFiles(user, id, files) {
  const d = ownDraft(user, id);
  if (draftFilesOf(d.id).length + files.length > MAX_DRAFT_FILES) {
    throw fail(400, `At most ${MAX_DRAFT_FILES} attachments`);
  }
  const ins = db.prepare(`
    INSERT INTO mail_draft_files (id, draft_id, filename, stored_name, mime_type, size_bytes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const f of files) ins.run(newId('MDF'), d.id, f.originalname || f.filename, f.filename, f.mimetype || null, f.size || 0);
    db.prepare(`UPDATE mail_drafts SET updated_at = datetime('now') WHERE id = ?`).run(d.id);
  })();
  return getDraft(user, d.id);
}

export function removeDraftFile(user, id, fileId) {
  const d = ownDraft(user, id);
  const f = db.prepare('SELECT * FROM mail_draft_files WHERE id = ? AND draft_id = ?').get(String(fileId), d.id);
  if (!f) throw fail(404, 'Attachment not found');
  db.prepare('DELETE FROM mail_draft_files WHERE id = ?').run(f.id);
  unlinkStored(f.stored_name);
  return getDraft(user, d.id);
}

/** Throw a draft away, and the files that were only ever on it. */
export function deleteDraft(user, id) {
  const d = ownDraft(user, id);
  const files = draftFilesOf(d.id);
  db.transaction(() => {
    db.prepare('DELETE FROM mail_draft_files WHERE draft_id = ?').run(d.id);
    db.prepare('DELETE FROM mail_drafts WHERE id = ? AND user_id = ?').run(d.id, user.id);
  })();
  for (const f of files) unlinkStored(f.stored_name);
}

// ── Settings ────────────────────────────────────────────────────────────────

export function getSettings(user) {
  const row = db.prepare('SELECT signature FROM mail_settings WHERE user_id = ?').get(user.id);
  return { signature: row?.signature || '' };
}

export function saveSettings(user, { signature }) {
  const text = String(signature ?? '').replace(/\r\n/g, '\n').trim();
  if (text.length > MAX_SIGNATURE) throw fail(400, `A signature is limited to ${MAX_SIGNATURE} characters`);
  db.prepare(`
    INSERT INTO mail_settings (user_id, signature) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET signature = excluded.signature, updated_at = datetime('now')
  `).run(user.id, text);
  return getSettings(user);
}
