/**
 * In-portal mail — one person writing to another inside the platform.
 *
 * Nothing here leaves the portal: there is no SMTP and no SMS, so what is
 * written stays on SJVN's server. A message is stored once and each person who
 * has it gets a mailbox row (mail_boxes) carrying their own read, archived and
 * deleted state.
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
import db from '../db/index.js';
import { newId, pushNotification } from '../util.js';
import { SELLER_ROLES, BUYER_ROLES } from '../middleware/auth.js';
import { TRADING_CLIENT_ROLES, tradingClientIdFor } from './tradingClientScope.js';

export const MAX_RECIPIENTS = 50;
export const MAX_SUBJECT = 200;
export const MAX_BODY = 20000;

const EXTERNAL_ROLES = [...SELLER_ROLES, ...BUYER_ROLES, ...TRADING_CLIENT_ROLES];

export const isExternal = (user) => EXTERNAL_ROLES.includes(user?.role);

const fail = (status, message) => Object.assign(new Error(message), { status });

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
export function sendMessage(sender, { to, cc, subject, body, replyTo = null, files = [] }) {
  const toIds = [...new Set(asList(to))];
  const ccIds = [...new Set(asList(cc))].filter((id) => !toIds.includes(id));
  if (!toIds.length) throw fail(400, 'Choose at least one person to send to');
  if (toIds.length + ccIds.length > MAX_RECIPIENTS) {
    throw fail(400, `A message can go to at most ${MAX_RECIPIENTS} people`);
  }

  const cleanSubject = String(subject || '').trim();
  const cleanBody = String(body || '').trim();
  if (!cleanSubject) throw fail(400, 'A message needs a subject');
  if (cleanSubject.length > MAX_SUBJECT) throw fail(400, `Subject is limited to ${MAX_SUBJECT} characters`);
  if (!cleanBody) throw fail(400, 'A message needs a body');
  if (cleanBody.length > MAX_BODY) throw fail(400, `Message is limited to ${MAX_BODY} characters`);

  const found = usersById([...toIds, ...ccIds]);
  const byId = new Map(found.map((u) => [u.id, u]));
  const refused = [...toIds, ...ccIds].filter((id) => !canWrite(sender, byId.get(id)));
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

  const id = newId('MSG');
  db.transaction(() => {
    db.prepare(`
      INSERT INTO mail_messages (id, thread_id, parent_id, sender_id, subject, body)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, threadId || id, parentId, sender.id, cleanSubject, cleanBody);

    const box = db.prepare(`
      INSERT INTO mail_boxes (id, message_id, user_id, box, recipient_kind, read_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    box.run(newId('MBX'), id, sender.id, 'SENT', null, new Date().toISOString());
    for (const uid of toIds) box.run(newId('MBX'), id, uid, 'INBOX', 'TO', null);
    for (const uid of ccIds) box.run(newId('MBX'), id, uid, 'INBOX', 'CC', null);

    const att = db.prepare(`
      INSERT INTO mail_attachments (id, message_id, filename, stored_name, mime_type, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const f of files) {
      att.run(newId('MAT'), id, f.originalname || f.filename, f.filename, f.mimetype || null, f.size || 0);
    }
  })();

  // The bell tells them something arrived; the message itself stays in Mail.
  for (const uid of [...toIds, ...ccIds]) {
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
 */
function recipientsOf(viewer, messageIds) {
  if (!messageIds.length) return new Map();
  const rows = db.prepare(`
    SELECT b.message_id, b.recipient_kind, u.id, u.name, u.email, u.role, u.linked_entity_id,
           ${COMPANY_SQL} AS company
    FROM mail_boxes b JOIN users u ON u.id = b.user_id ${USER_JOIN}
    WHERE b.box = 'INBOX' AND b.message_id IN (${messageIds.map(() => '?').join(',')})
    ORDER BY b.recipient_kind DESC, u.name
  `).all(...messageIds);
  const external = isExternal(viewer);
  const map = new Map();
  for (const r of rows) {
    if (external && r.id !== viewer.id && isExternal(r) && !sameCompany(viewer, r)) continue;
    if (!map.has(r.message_id)) map.set(r.message_id, []);
    map.get(r.message_id).push({
      id: r.id, name: r.name, email: r.email, company: companyLabel(r), kind: r.recipient_kind,
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
 */
export function listBox(user, { box = 'INBOX', q = '', limit = 100 } = {}) {
  const folder = String(box || 'INBOX').toUpperCase();
  if (!['INBOX', 'SENT', 'ARCHIVE'].includes(folder)) throw fail(400, 'box must be INBOX, SENT or ARCHIVE');
  const like = `%${String(q || '').trim().toLowerCase()}%`;

  const rows = db.prepare(`
    SELECT m.id, m.thread_id, m.subject, substr(m.body, 1, 160) AS preview, m.created_at,
           b.box, b.read_at, b.archived_at,
           s.id AS sender_id, s.name AS sender_name, s.email AS sender_email,
           (SELECT COUNT(*) FROM mail_attachments a WHERE a.message_id = m.id) AS attachment_count
    FROM mail_boxes b
    JOIN mail_messages m ON m.id = b.message_id
    JOIN users s ON s.id = m.sender_id
    WHERE b.user_id = ? AND b.deleted_at IS NULL
      AND b.box = ?
      AND (${folder === 'ARCHIVE' ? 'b.archived_at IS NOT NULL' : folder === 'INBOX' ? 'b.archived_at IS NULL' : '1 = 1'})
      AND (lower(m.subject) LIKE ? OR lower(m.body) LIKE ? OR lower(s.name) LIKE ?)
    ORDER BY m.created_at DESC, m.rowid DESC
    LIMIT ?
  `).all(user.id, folder === 'SENT' ? 'SENT' : 'INBOX', like, like, like, Math.min(Number(limit) || 100, 500));

  const recips = recipientsOf(user, rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    is_read: !!r.read_at,
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
 * thread this user actually has. Opening it marks it read.
 */
export function getMessage(user, messageId, { markRead = true } = {}) {
  const mine = db.prepare(`
    SELECT b.*, m.thread_id FROM mail_boxes b JOIN mail_messages m ON m.id = b.message_id
    WHERE b.message_id = ? AND b.user_id = ? AND b.deleted_at IS NULL
    ORDER BY (b.box = 'INBOX') DESC LIMIT 1
  `).get(messageId, user.id);
  if (!mine) throw fail(404, 'Message not found');

  if (markRead) {
    db.prepare(`
      UPDATE mail_boxes SET read_at = COALESCE(read_at, datetime('now'))
      WHERE message_id = ? AND user_id = ? AND box = 'INBOX'
    `).run(messageId, user.id);
  }

  const thread = db.prepare(`
    SELECT DISTINCT m.id, m.parent_id, m.subject, m.body, m.created_at,
           s.id AS sender_id, s.name AS sender_name, s.email AS sender_email
    FROM mail_messages m
    JOIN mail_boxes b ON b.message_id = m.id AND b.user_id = ? AND b.deleted_at IS NULL
    JOIN users s ON s.id = m.sender_id
    WHERE m.thread_id = ?
    ORDER BY m.created_at, m.rowid
  `).all(user.id, mine.thread_id);

  const ids = thread.map((t) => t.id);
  const recips = recipientsOf(user, ids);
  const atts = attachmentsOf(ids);
  return {
    id: messageId,
    thread_id: mine.thread_id,
    box: mine.box,
    archived: !!mine.archived_at,
    messages: thread.map((t) => ({
      ...t, recipients: recips.get(t.id) || [], attachments: atts.get(t.id) || [],
    })),
  };
}

function ownRows(user, messageId) {
  const n = db.prepare(`
    SELECT COUNT(*) AS n FROM mail_boxes WHERE message_id = ? AND user_id = ? AND deleted_at IS NULL
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

/** Hide a message from this person's mail. Everyone else keeps their copy. */
export function removeForUser(user, messageId) {
  ownRows(user, messageId);
  db.prepare(`
    UPDATE mail_boxes SET deleted_at = datetime('now')
    WHERE message_id = ? AND user_id = ? AND deleted_at IS NULL
  `).run(messageId, user.id);
}

/** An attachment, if this user has the message it came with. */
export function attachmentFor(user, attachmentId) {
  const a = db.prepare(`
    SELECT a.* FROM mail_attachments a
    WHERE a.id = ? AND EXISTS (
      SELECT 1 FROM mail_boxes b WHERE b.message_id = a.message_id AND b.user_id = ? AND b.deleted_at IS NULL
    )
  `).get(attachmentId, user.id);
  if (!a) throw fail(404, 'Attachment not found');
  return { ...a, path: path.join(attachmentDir(), a.stored_name) };
}
