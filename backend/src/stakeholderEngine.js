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
  //
  // Read from document_versions, which is where uploads actually land. The sweep
  // looked at entity_documents — a legacy table written only by an optional
  // array on entity creation, empty in practice — so the licences and clearances
  // going through the real upload-and-verify workflow were never watched at all.
  //
  // Warned at bands rather than every day inside the window: a licence sixty days
  // out does not need a notice every morning for two months, but it does need one
  // that gets more insistent as the date closes.
  const DOC_BANDS = [60, 30, 15, 7];
  const latestVersions = db.prepare(`
    SELECT v.id, v.expiry_date, v.verification_status, d.document_type, d.title, d.entity_id, d.contract_id, e.name AS entity_name
    FROM document_versions v
    JOIN documents d ON d.id = v.document_id
    LEFT JOIN entities e ON e.id = d.entity_id
    WHERE v.expiry_date IS NOT NULL
      AND v.version_number = (SELECT MAX(version_number) FROM document_versions WHERE document_id = d.id)
  `).all();

  for (const doc of latestVersions) {
    guarded(`document ${doc.id}`, () => {
      const left = days(doc.expiry_date);
      if (left > DOC_BANDS[0]) return;
      const owner = doc.entity_name || doc.entity_id || doc.contract_id || 'unattached';
      const what = `${doc.document_type}${doc.title && doc.title !== doc.document_type ? ` (${doc.title})` : ''} for ${owner}`;

      if (left <= 0) {
        if (notifyDaily({
          role: 'REIA_USER', type: 'DOCUMENT_EXPIRED',
          message: `${what} expired on ${doc.expiry_date} and is no longer valid.`,
        })) counts.documents += 1;
        return;
      }
      // The tightest band the remaining days fall inside, so the message changes
      // as it closes and notifyDaily treats each band as its own alert.
      const band = DOC_BANDS.filter((b) => left <= b).pop();
      if (notifyDaily({
        role: 'REIA_USER', type: 'DOCUMENT_EXPIRING',
        message: `${what} expires on ${doc.expiry_date} — ${left} day(s) left (${band}-day notice). Renew it.`,
      })) counts.documents += 1;
    });
  }

  // The legacy table, still swept so anything recorded there is not dropped.
  for (const doc of db.prepare(`SELECT * FROM entity_documents WHERE validity_end IS NOT NULL AND alert_sent = 0`).all()) {
    guarded(`legacy document ${doc.id}`, () => {
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
