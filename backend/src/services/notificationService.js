/**
 * Central notification dispatch — one call fans a notification out to in-app,
 * email and SMS according to a per-event channel policy, and records every
 * channel attempt in notification_deliveries.
 *
 * The existing pushNotification() (util.js) stays as the in-app-only path for
 * the many callers that only need the bell. dispatch() is the richer entry
 * point for events that should also reach people by email or SMS.
 */
import db from '../db/index.js';
import { newId } from '../util.js';
import { getParam } from '../mastersService.js';
import { sendMail } from './mailService.js';
import { sendSms } from './smsService.js';

const DEFAULT_POLICY = { DEFAULT: ['INAPP'] };
const MAX_ATTEMPTS = 4;

/** Channels configured for an event type, falling back to DEFAULT (in-app only). */
export function channelsFor(event) {
  const policy = getParam('notification_channel_policy', null) || DEFAULT_POLICY;
  const list = policy[event] || policy.DEFAULT || ['INAPP'];
  return Array.isArray(list) ? list : ['INAPP'];
}

/** Everyone this notification should reach, as {name, email, phone}. */
function resolveRecipients({ userId, role, entityId, to }) {
  // Explicit recipient wins — used for counterparty-facing alerts.
  if (to) return [{ name: to.name || null, email: to.email || null, phone: to.phone || null }];

  if (entityId) {
    const e = db.prepare('SELECT name, corporate_email AS email, corporate_phone AS phone FROM entities WHERE id = ?').get(entityId);
    return e ? [e] : [];
  }
  if (userId) {
    const u = db.prepare('SELECT name, email, phone FROM users WHERE id = ?').get(userId);
    return u ? [u] : [];
  }
  if (role) {
    return db.prepare('SELECT name, email, phone FROM users WHERE role = ? AND is_active = 1').all(role);
  }
  return [];
}

/** Ops-desk fallback numbers, for internal alerts where the user has no phone. */
function opsDeskPhones() {
  return String(getParam('ops_desk_phone', '') || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

/** A delivery is a duplicate if the same event+channel+address went out in the
 *  last 60s — guards against a burst (e.g. a sweep) sending twice. */
function isDuplicate(event, channel, address) {
  return !!db.prepare(`
    SELECT 1 FROM notification_deliveries
    WHERE event = ? AND channel = ? AND address = ?
      AND created_at >= datetime('now', '-60 seconds')
    LIMIT 1
  `).get(event, channel, address);
}

function logDelivery({ notificationId, event, channel, name, address, subject, body, status, provider, providerRef, error, attempts, sentAt }) {
  const id = newId('NDL');
  db.prepare(`
    INSERT INTO notification_deliveries
      (id, notification_id, event, channel, recipient_name, address, subject, body, status, provider, provider_ref, error, attempts, sent_at)
    VALUES (@id, @notificationId, @event, @channel, @name, @address, @subject, @body, @status, @provider, @providerRef, @error, @attempts, @sentAt)
  `).run({ id, notificationId, event, channel, name: name || null, address, subject: subject || null, body: body || null, status, provider: provider || null, providerRef: providerRef || null, error: error || null, attempts: attempts || 0, sentAt: sentAt || null });
  return id;
}

async function deliverEmail({ notificationId, event, rcpt, subject, text }) {
  if (!rcpt.email) return;
  if (isDuplicate(event, 'EMAIL', rcpt.email)) return;
  const base = { notificationId, event, channel: 'EMAIL', name: rcpt.name, address: rcpt.email, subject, body: text };
  try {
    const res = await sendMail({ to: rcpt.email, subject, text });
    logDelivery({
      ...base,
      status: res.ok ? 'SENT' : 'FAILED', provider: res.mode, providerRef: res.meta_path || res.messageId,
      error: res.ok ? null : res.error, attempts: 1, sentAt: res.ok ? new Date().toISOString() : null,
    });
  } catch (err) {
    logDelivery({ ...base, status: 'FAILED', error: err.message, attempts: 1 });
  }
}

async function deliverSms({ notificationId, event, name, phone, text }) {
  if (isDuplicate(event, 'SMS', phone)) return;
  const base = { notificationId, event, channel: 'SMS', name, address: phone, body: text };
  try {
    const res = await sendSms({ to: phone, text });
    logDelivery({
      ...base,
      status: res.ok ? 'SENT' : 'FAILED', provider: res.mode, providerRef: res.provider_ref,
      error: res.ok ? null : res.error, attempts: 1, sentAt: res.ok ? new Date().toISOString() : null,
    });
  } catch (err) {
    logDelivery({ ...base, status: 'FAILED', error: err.message, attempts: 1 });
  }
}

/**
 * Send a notification across its configured channels.
 *
 * @param {object} o
 * @param {string} o.event    event type (drives the channel policy)
 * @param {string} [o.message]  in-app / SMS body
 * @param {string} [o.subject]  email subject (defaults to a generic line)
 * @param {string} [o.emailText] email body (defaults to message)
 * @param {string} [o.userId]  internal recipient
 * @param {string} [o.role]    broadcast to a role
 * @param {string} [o.entityId] counterparty recipient (uses corporate contacts)
 * @param {{name?:string,email?:string,phone?:string}} [o.to] explicit recipient
 */
export async function dispatch(o) {
  const channels = channelsFor(o.event);
  const message = o.message || '';

  // In-app first — the record other channels attach to.
  let notificationId = null;
  if (channels.includes('INAPP')) {
    notificationId = newId('NTF');
    db.prepare('INSERT INTO notifications (id, user_id, role, type, message) VALUES (?, ?, ?, ?, ?)')
      .run(notificationId, o.userId || null, o.role || null, o.event, message);
  }

  const wantEmail = channels.includes('EMAIL');
  const wantSms = channels.includes('SMS');
  if (!wantEmail && !wantSms) return { notificationId, deliveries: 0 };

  const recipients = resolveRecipients(o);
  const subject = o.subject || `SJVN: ${o.event.replace(/_/g, ' ').toLowerCase()}`;
  const emailText = o.emailText || message;

  let count = 0;
  for (const rcpt of recipients) {
    if (wantEmail && rcpt.email) { await deliverEmail({ notificationId, event: o.event, rcpt, subject, text: emailText }); count += 1; }
    if (wantSms && rcpt.phone) { await deliverSms({ notificationId, event: o.event, name: rcpt.name, phone: rcpt.phone, text: message }); count += 1; }
  }

  // Internal alert wanted an SMS but nobody had a number — fall back to the
  // ops desk so the desk still hears about it.
  if (wantSms && !recipients.some((r) => r.phone)) {
    for (const phone of opsDeskPhones()) {
      await deliverSms({ notificationId, event: o.event, name: 'Ops desk', phone, text: message });
      count += 1;
    }
  }

  return { notificationId, deliveries: count };
}

/**
 * Retry deliveries that failed, oldest first, up to the attempt cap. Runs on a
 * schedule; also callable manually. Skipped rows and successes are left alone.
 */
export async function retryFailedDeliveries(limit = 50) {
  const rows = db.prepare(`
    SELECT * FROM notification_deliveries
    WHERE status = 'FAILED' AND attempts < ?
    ORDER BY created_at ASC LIMIT ?
  `).all(MAX_ATTEMPTS, limit);

  let retried = 0; let recovered = 0;
  for (const d of rows) {
    // Re-send the exact content the first attempt used, held on the row.
    const res = d.channel === 'EMAIL'
      ? await sendMail({ to: d.address, subject: d.subject || `SJVN: ${d.event}`, text: d.body || '' })
      : await sendSms({ to: d.address, text: d.body || '' });
    retried += 1;
    if (res.ok) recovered += 1;
    db.prepare(`
      UPDATE notification_deliveries
      SET status = ?, attempts = attempts + 1, error = ?, provider = ?, provider_ref = ?, sent_at = ?
      WHERE id = ?
    `).run(res.ok ? 'SENT' : 'FAILED', res.ok ? null : res.error, res.mode, res.provider_ref || res.meta_path || null, res.ok ? new Date().toISOString() : null, d.id);
  }
  return { retried, recovered };
}
