import crypto from 'crypto';
import db from './db/index.js';
import { getMeta, setMeta } from './db/meta.js';
import { newId } from './util.js';

/**
 * Creates a cryptographic hash for an audit log entry.
 */
function computeHash(payload) {
  const dataString = JSON.stringify(payload);
  return crypto.createHash('sha256').update(dataString).digest('hex');
}

/**
 * The exact object that gets hashed, built from the values *as they are
 * persisted* (JSON strings or null in the columns). Write and verify both go
 * through this one function, so the two can never serialize the payload
 * differently — which was the original defect: the writer dropped undefined
 * keys and stored empty values as null, while the verifier re-added them as
 * null, so every record failed re-hashing.
 *
 * Everything here is a scalar column value with nulls kept as-is; there are no
 * undefined-vs-null games because there is nothing to parse or re-stringify.
 */
function auditHashPayload(r) {
  return {
    traceId: r.traceId,
    sessionId: r.sessionId,
    ipAddress: r.ipAddress,
    userId: r.userId,
    userName: r.userName,
    userRole: r.userRole,
    action: r.action,
    module: r.module,
    entityType: r.entityType,
    entityId: r.entityId,
    beforeValue: r.beforeValue,
    afterValue: r.afterValue,
    reason: r.reason,
    details: r.details,
    prevHash: r.prevHash,
  };
}

/**
 * The same payload, rebuilt from a stored row. Verification and repair both go
 * through this, so neither can drift from the writer's field list.
 */
function payloadFromRow(log, prevHash = log.prev_hash) {
  return auditHashPayload({
    traceId: log.trace_id,
    sessionId: log.session_id,
    ipAddress: log.ip_address,
    userId: log.user_id,
    userName: log.user_name,
    userRole: log.user_role,
    action: log.action,
    module: log.module,
    entityType: log.entity_type,
    entityId: log.entity_id,
    beforeValue: log.before_value,
    afterValue: log.after_value,
    reason: log.reason,
    details: log.details,
    prevHash,
  });
}

/**
 * Secures and logs an audit entry with cryptographic hash chaining.
 * 
 * @param {Object} req - Express request object (contains traceId, user, ip)
 * @param {Object} params - The log details
 */
export function secureLogAudit(req, { action, module, entityType, entityId, beforeValue, afterValue, reason, details }) {
  // Fetch the last hash in the chain
  const lastRow = db.prepare('SELECT curr_hash FROM audit_logs ORDER BY rowid DESC LIMIT 1').get();
  const prevHash = lastRow?.curr_hash || 'GENESIS_HASH';

  const user = req?.user;
  const userId = user?.id || null;
  const userName = user?.name || 'SYSTEM';
  const userRole = user?.role || 'SYSTEM';
  
  const traceId = req?.traceId || newId('TRC');
  const sessionId = req?.sessionID || null;
  const ipAddress = req?.ip || null;

  // Build the persisted forms first, then hash exactly those. Hashing the raw
  // inputs while storing a transformed version is what made empty-string values
  // unverifiable — the stored row could no longer reproduce the hash.
  const stored = {
    traceId,
    sessionId,
    ipAddress,
    userId,
    userName,
    userRole,
    action,
    module,
    entityType: entityType || null,
    entityId: entityId || null,
    beforeValue: beforeValue ? JSON.stringify(beforeValue) : null,
    afterValue: afterValue ? JSON.stringify(afterValue) : null,
    reason: reason || null,
    details: details ? JSON.stringify(details) : null,
    prevHash,
  };

  const currHash = computeHash(auditHashPayload(stored));

  db.prepare(`
    INSERT INTO audit_logs (
      id, trace_id, session_id, ip_address, user_id, user_name, user_role,
      action, module, entity_type, entity_id, before_value, after_value, reason, details,
      prev_hash, curr_hash
    ) VALUES (
      @id, @traceId, @sessionId, @ipAddress, @userId, @userName, @userRole,
      @action, @module, @entityType, @entityId, @beforeValue, @afterValue, @reason, @details,
      @prevHash, @currHash
    )
  `).run({ id: newId('AUD'), ...stored, currHash });
}

/**
 * Verifies the integrity of the entire audit log chain.
 * Returns an object { isValid: boolean, brokenAtIndex: number|null, message: string }
 */
export function verifyLogIntegrity() {
  // Streamed, not collected. `.all()` here built one JavaScript object per audit
  // row — every column, including the before/after JSON blobs — and held the
  // whole table in memory at once. The audit log grows with every action taken
  // on the platform and is never pruned, so that cost has no ceiling: the check
  // gets slower and heavier for ever, and eventually cannot run at all on the
  // chain it is meant to protect. `.iterate()` walks the same rows one at a
  // time, so memory stays flat however long the chain gets.
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY rowid ASC').iterate();

  let expectedPrevHash = 'GENESIS_HASH';
  let i = 0;

  for (const log of rows) {
    if (log.prev_hash !== expectedPrevHash) {
      return { isValid: false, brokenAtIndex: i, brokenLogId: log.id, message: `Broken chain link at index ${i} (ID: ${log.id}). Prev hash mismatch.` };
    }

    // Re-hash straight from the stored columns via the same builder the writer
    // used — no parsing or re-stringifying, so the bytes are identical.
    if (computeHash(payloadFromRow(log)) !== log.curr_hash) {
      return { isValid: false, brokenAtIndex: i, brokenLogId: log.id, message: `Tampering detected at index ${i} (ID: ${log.id}). Payload hash mismatch.` };
    }

    expectedPrevHash = log.curr_hash;
    i += 1;
  }

  if (i === 0) return { isValid: true, message: 'Chain is empty.' };
  return { isValid: true, message: 'Chain integrity verified. All logs are tamper-free.' };
}

/**
 * Verify only the newest `limit` links.
 *
 * A full verification is O(the entire history) and belongs behind the audit
 * screen, where someone has asked for it and can wait. This is the version
 * cheap enough to run on every boot: it re-hashes a bounded window and checks
 * that each row links to the one before it. It cannot prove the whole chain —
 * it does not reach back to genesis — but it catches what is worth catching at
 * start-up, which is something having written to the table directly since the
 * last run.
 */
export function verifyRecentIntegrity(limit = 200) {
  const recent = db.prepare(
    'SELECT * FROM audit_logs ORDER BY rowid DESC LIMIT ?',
  ).all(limit).reverse();

  if (recent.length === 0) return { isValid: true, checked: 0, message: 'Chain is empty.' };

  for (let i = 0; i < recent.length; i++) {
    const log = recent[i];
    if (computeHash(payloadFromRow(log)) !== log.curr_hash) {
      return { isValid: false, checked: recent.length, brokenLogId: log.id, message: `Tampering detected in the last ${recent.length} entries (ID: ${log.id}).` };
    }
    // The first row of the window has no predecessor inside the window.
    if (i > 0 && log.prev_hash !== recent[i - 1].curr_hash) {
      return { isValid: false, checked: recent.length, brokenLogId: log.id, message: `Broken chain link in the last ${recent.length} entries (ID: ${log.id}).` };
    }
  }
  return { isValid: true, checked: recent.length, message: `Last ${recent.length} entries verified.` };
}

/**
 * One-time repair of a chain whose hashes were written by the earlier,
 * inconsistent logic (raw-input hashing vs transformed storage). It re-links
 * and re-hashes every record from the *stored* columns using the current
 * builder, making an authentic-but-unverifiable chain verify again.
 *
 * This does not conceal tampering: it recomputes hashes from whatever the rows
 * currently hold, so if a row's data had actually been altered, the rebuilt
 * hash simply certifies the altered data — it cannot restore the original. It
 * exists only to retire hashes produced by a code bug, and is guarded to run
 * only when the chain does not already verify.
 */
export function rebuildAuditChain({ batchSize = 2000 } = {}) {
  // Walked a page at a time rather than loaded whole. Streaming with `.iterate()`
  // is not available here because this writes to the very table it is reading,
  // and SQLite leaves it undefined which rows a scan still visits once it has
  // been modified underneath. Paging by rowid is deterministic: each page is a
  // finished read before any of its updates are applied.
  const BATCH = batchSize;
  const page = db.prepare('SELECT rowid AS _rowid, * FROM audit_logs WHERE rowid > ? ORDER BY rowid ASC LIMIT ?');
  // Update by the primary key, not rowid: SELECT * does not return the implicit
  // rowid column, so WHERE rowid = ? would bind undefined and change nothing.
  const upd = db.prepare('UPDATE audit_logs SET prev_hash = ?, curr_hash = ? WHERE id = ?');

  let prevHash = 'GENESIS_HASH';
  let after = 0;
  let rebuilt = 0;

  db.transaction(() => {
    for (;;) {
      const rows = page.all(after, BATCH);
      if (rows.length === 0) break;
      for (const log of rows) {
        const currHash = computeHash(payloadFromRow(log, prevHash));
        upd.run(prevHash, currHash, log.id);
        prevHash = currHash;
        rebuilt += 1;
      }
      after = rows[rows.length - 1]._rowid;
    }
  })();
  return { rebuilt };
}

/**
 * Key recording that the one-time repair below has already been carried out on
 * this database.
 */
const REPAIR_MARKER = 'audit_chain_repaired_v1';

/**
 * Rebuild the chain once if — and only if — it does not currently verify.
 *
 * Runs at most once per database, and this matters for two separate reasons.
 *
 * The first is that it used to run on every boot, and a full verification reads
 * the entire audit history before the server binds its port. The audit log
 * grows with every action and is never pruned, so start-up got slower for ever.
 * Far enough along, boot outlives the health check update.sh waits on, and a
 * perfectly good release gets rolled back for a reason nobody would look for in
 * the deploy. Once the marker is set this function reads no audit rows at all.
 *
 * The second is about what the repair is for. It exists to retire hashes
 * written by the earlier inconsistent hashing logic — a code defect, fixed
 * once. Beyond that, a chain that stops verifying means somebody has written to
 * the table, and rebuilding it then is the wrong response: it re-certifies
 * whatever the rows now say and leaves the chain looking untouched. After the
 * repair has run, a broken chain stays broken and visible, which is the whole
 * point of keeping one.
 */
export function repairAuditChainIfBroken() {
  if (getMeta(REPAIR_MARKER)) return { rebuilt: 0, wasValid: true, skipped: true };

  const before = verifyLogIntegrity();
  if (before.isValid) {
    setMeta(REPAIR_MARKER, new Date().toISOString());
    return { rebuilt: 0, wasValid: true };
  }

  const { rebuilt } = rebuildAuditChain();
  const nowValid = verifyLogIntegrity().isValid;
  // Only claim the repair is done if it actually worked. If it did not, the
  // next boot tries again rather than recording a fix that never happened.
  if (nowValid) setMeta(REPAIR_MARKER, new Date().toISOString());
  return { rebuilt, wasValid: false, nowValid };
}

/**
 * Detects Segregation of Duties (SoD) violations.
 * Specifically checks if the same user created AND approved the same entity/invoice/contract.
 */
export function detectSoDViolations({ pageSize = 2000 } = {}) {
  // Single-quoted literals: SQLite reads double quotes as identifiers first and
  // errors with "no such column: CREATE" once the DQS-as-string misfeature is off.
  // Paged by rowid, and only the six columns this actually reads — `SELECT *`
  // pulled the before/after JSON blobs of every create and approval ever
  // recorded into memory in order to look at an entity id.
  //
  // Paged by rowid on purpose, and the `+` in front of `action` is load-bearing.
  // This walk has to arrive in insertion order, because the rule it checks is
  // "the same person created this and then approved it" — an approval read
  // before its create proves nothing. Left to itself SQLite satisfies
  // `action IN (...)` through the index on `action` and then sorts the matches
  // back into rowid order through a temporary B-tree, which materialises the
  // result set and undoes the point of paging. A leading `+` is SQLite's own
  // way of saying "do not use an index for this term": the query then walks the
  // primary key, which is already in the order wanted, and filters as it goes.
  const PAGE = pageSize;
  const pageStmt = db.prepare(`
    SELECT rowid AS _rowid, entity_id, action, user_id, user_name, module, created_at
    FROM audit_logs
    WHERE rowid > ? AND +action IN ('CREATE', 'APPROVE', 'VERIFY')
    ORDER BY rowid ASC LIMIT ?
  `);
  function* pagedLogs() {
    let after = 0;
    for (;;) {
      const rows = pageStmt.all(after, PAGE);
      if (rows.length === 0) return;
      yield* rows;
      after = rows[rows.length - 1]._rowid;
    }
  }
  const logs = pagedLogs();
  const violations = [];
  
  // Map of entityId -> { CREATE: userId, APPROVE: userId }
  const trackers = {};

  for (const log of logs) {
    if (!log.entity_id) continue;
    if (!trackers[log.entity_id]) trackers[log.entity_id] = {};
    
    if (log.action === 'CREATE') {
      trackers[log.entity_id].creator = log.user_id;
      trackers[log.entity_id].creatorName = log.user_name;
    } else if (log.action === 'APPROVE' || log.action === 'VERIFY') {
      trackers[log.entity_id].approver = log.user_id;
      trackers[log.entity_id].approverName = log.user_name;
      trackers[log.entity_id].module = log.module;
      
      // SoD Check
      if (trackers[log.entity_id].creator === trackers[log.entity_id].approver && trackers[log.entity_id].creator !== null) {
        violations.push({
          entityId: log.entity_id,
          module: log.module,
          userId: trackers[log.entity_id].creator,
          userName: trackers[log.entity_id].creatorName,
          timestamp: log.created_at,
          message: `User ${trackers[log.entity_id].creatorName} created and approved the same record.`
        });
      }
    }
  }

  return violations;
}
