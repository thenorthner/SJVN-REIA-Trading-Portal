/**
 * K2: clearance expiry (Batch 4, 17-Oct-2026). A verified clearance with a
 * validity date — grid connectivity, licence, environmental clearance, COD
 * certificate and the like — is flagged to the onboarding desk and to the
 * company 60, 30 and 7 days before it lapses, once at each step, and moves to
 * EXPIRED on the day after its validity ends, so the compliance register and
 * the approval gate read it as lapsed.
 */
import db from '../db/index.js';
import { newId, pushNotification, logAudit } from '../util.js';

export const EXPIRY_STEPS = [60, 30, 7];
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const daysTo = (d) => Math.floor((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86400000);

export function runClearanceExpiry() {
  let expired = 0;
  let reminded = 0;
  const rows = db.prepare(`
    SELECT a.*, e.name AS entity_name FROM entity_regulatory_approvals a JOIN entities e ON e.id = a.entity_id
    WHERE a.status = 'VERIFIED' AND a.valid_until IS NOT NULL AND a.valid_until <> ''
  `).all();
  for (const a of rows) {
    const left = daysTo(String(a.valid_until).slice(0, 10));
    if (left < 0) {
      db.prepare(`UPDATE entity_regulatory_approvals SET status = 'EXPIRED', updated_at = datetime('now') WHERE id = ? AND status = 'VERIFIED'`).run(a.id);
      logAudit({ user: { id: null, name: 'system', role: 'SYSTEM' }, action: 'CLEARANCE_EXPIRED', module: 'REIA', entityType: 'entity', entityId: a.entity_id, details: { approval: a.approval_code, valid_until: a.valid_until } });
      const msg = `${a.entity_name}: ${a.label} lapsed on ${a.valid_until} and is now marked expired. Upload the renewed one.`;
      for (const role of ['REIA_USER', 'REIA_ADMIN']) pushNotification({ role, type: 'CLEARANCE_EXPIRY', message: msg });
      for (const u of db.prepare('SELECT id FROM users WHERE linked_entity_id = ? AND is_active = 1').all(a.entity_id)) pushNotification({ userId: u.id, type: 'CLEARANCE_EXPIRY', message: msg });
      expired += 1;
      continue;
    }
    const step = EXPIRY_STEPS.slice().sort((x, y) => x - y).find((s) => left <= s);
    if (step == null) continue;
    const key = `CLEARANCE:${a.id}:${a.valid_until}:${step}`;
    if (db.prepare('SELECT 1 FROM clearance_alerts WHERE alert_key = ?').get(key)) continue;
    const msg = `${a.entity_name}: ${a.label} lapses on ${a.valid_until} — ${left} day${left === 1 ? '' : 's'} left. Have it renewed and uploaded.`;
    for (const role of ['REIA_USER', 'REIA_ADMIN']) pushNotification({ role, type: 'CLEARANCE_EXPIRY', message: msg });
    for (const u of db.prepare('SELECT id FROM users WHERE linked_entity_id = ? AND is_active = 1').all(a.entity_id)) pushNotification({ userId: u.id, type: 'CLEARANCE_EXPIRY', message: msg });
    db.prepare('INSERT INTO clearance_alerts (id, approval_id, alert_key, days_left) VALUES (?, ?, ?, ?)').run(newId('CLA'), a.id, key, left);
    reminded += 1;
  }
  return { expired, reminded };
}

/** What is lapsing soon, for the onboarding desk's board. */
export function clearancesExpiring(withinDays = 60) {
  return db.prepare(`
    SELECT a.id, a.entity_id, e.name AS entity_name, a.approval_code, a.label, a.valid_until, a.status FROM entity_regulatory_approvals a
    JOIN entities e ON e.id = a.entity_id
    WHERE a.valid_until IS NOT NULL AND a.valid_until <> '' AND a.status IN ('VERIFIED', 'EXPIRED') AND a.valid_until <= date(?, '+' || ? || ' days')
    ORDER BY a.valid_until
  `).all(today(), withinDays).map((r) => ({ ...r, days_left: daysTo(String(r.valid_until).slice(0, 10)) }));
}
