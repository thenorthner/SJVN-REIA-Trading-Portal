import db from './db/index.js';
import { newId, logAudit, pushNotification } from './util.js';

// The hourly sweep that ages contracts towards expiry and warns about documents
// and stalled onboarding.
//
// Every pushNotification call in here passed positional arguments to a function
// that takes an object, so `type` and `message` arrived undefined and the insert
// failed its NOT NULL check. The first alert of every run threw, the cascade
// died there, and everything after it — the expiry transitions, the onboarding
// SLA — never ran. Not one notification had ever been written.
//
// The failure was invisible because the caller wraps the sweep in a try/catch
// that logs and moves on, so an hourly exception looked like an hourly no-op.

/**
 * Notify once per subject per day.
 *
 * Sections 2 and 3 have no sent-flag to mark, and this runs every hour, so
 * simply repairing the call would have turned one missed alert into twenty-four
 * duplicates a day. Keyed on type and message because that is what a reader
 * would recognise as the same alert arriving again.
 */
function notifyDaily({ role, type, message }) {
  const dupe = db.prepare(`
    SELECT 1 FROM notifications
    WHERE type = ? AND message = ? AND date(created_at) = date('now')
    LIMIT 1
  `).get(type, message);
  if (dupe) return false;
  pushNotification({ role, type, message });
  return true;
}

/** Run one step, and let the rest of the sweep continue if it fails. */
function guarded(what, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[STAKEHOLDER] ${what} failed:`, err.message);
    return null;
  }
}

export function runStakeholderAlerts() {
  const today = new Date();
  const days = (to, from = today) => Math.ceil((new Date(to) - from) / (1000 * 60 * 60 * 24));
  const counts = { documents: 0, nearingExpiry: 0, expired: 0, slaBreaches: 0 };

  // 1. Document expiry
  for (const doc of db.prepare(`SELECT * FROM entity_documents WHERE validity_end IS NOT NULL AND alert_sent = 0`).all()) {
    guarded(`document ${doc.id}`, () => {
      const left = days(doc.validity_end);
      if (left > 60 || left <= 0) return;
      notifyDaily({
        role: 'REIA_USER', type: 'DOCUMENT_EXPIRING',
        message: `Document ${doc.doc_type} for entity ${doc.entity_id} expires in ${left} day(s) on ${doc.validity_end}.`,
      });
      db.prepare('UPDATE entity_documents SET alert_sent = 1 WHERE id = ?').run(doc.id);
      counts.documents += 1;
    });
  }

  // 2. Contracts approaching and past their end date
  for (const c of db.prepare(`SELECT * FROM contracts WHERE status IN ('ACTIVE','NEARING_EXPIRY')`).all()) {
    guarded(`contract ${c.contract_no}`, () => {
      const left = days(c.tenure_end);

      if (left <= 90 && left > 0 && c.status === 'ACTIVE') {
        db.prepare("UPDATE contracts SET status = 'NEARING_EXPIRY', updated_at = datetime('now') WHERE id = ?").run(c.id);
        notifyDaily({
          role: 'REIA_USER', type: 'CONTRACT_EXPIRING',
          message: `Contract ${c.contract_no} expires in ${left} day(s) on ${c.tenure_end}. Initiate renewal.`,
        });
        logAudit({
          user: { id: 'SYSTEM', name: 'SYSTEM' }, action: 'STATUS_NEARING_EXPIRY', module: 'CONTRACTS',
          entityType: 'contract', entityId: c.id,
          beforeValue: c.status, afterValue: 'NEARING_EXPIRY',
          details: { tenure_end: c.tenure_end, days_remaining: left },
        });
        counts.nearingExpiry += 1;
        return;
      }

      // Past the end date. Reached from ACTIVE too: a contract whose sweep was
      // missed while this was broken would otherwise need one pass to reach
      // NEARING_EXPIRY and another to expire, and sit billable in between.
      if (left <= 0 && ['ACTIVE', 'NEARING_EXPIRY'].includes(c.status)) {
        db.prepare("UPDATE contracts SET status = 'EXPIRED', updated_at = datetime('now') WHERE id = ?").run(c.id);
        notifyDaily({
          role: 'REIA_USER', type: 'CONTRACT_EXPIRED',
          message: `Contract ${c.contract_no} ended on ${c.tenure_end} and is now expired.`,
        });
        logAudit({
          user: { id: 'SYSTEM', name: 'SYSTEM' }, action: 'STATUS_EXPIRED', module: 'CONTRACTS',
          entityType: 'contract', entityId: c.id,
          beforeValue: c.status, afterValue: 'EXPIRED',
          details: { tenure_end: c.tenure_end },
        });
        counts.expired += 1;
      }
    });
  }

  // 3. Onboarding stalled in PENDING
  for (const e of db.prepare(`SELECT * FROM entities WHERE status = 'PENDING'`).all()) {
    guarded(`entity ${e.id}`, () => {
      const waiting = -days(e.created_at);
      if (waiting <= 14) return;
      const sent = notifyDaily({
        role: 'MANAGEMENT', type: 'ONBOARDING_SLA_BREACH',
        message: `${e.name} has been pending approval for ${waiting} day(s).`,
      });
      if (sent) counts.slaBreaches += 1;
    });
  }

  return counts;
}
