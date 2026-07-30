import crypto from 'crypto';
import db from './db/index.js';
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
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY rowid ASC').all();
  
  if (logs.length === 0) return { isValid: true, message: 'Chain is empty.' };

  let expectedPrevHash = 'GENESIS_HASH';

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    
    if (log.prev_hash !== expectedPrevHash) {
      return { isValid: false, brokenAtIndex: i, brokenLogId: log.id, message: `Broken chain link at index ${i} (ID: ${log.id}). Prev hash mismatch.` };
    }

    // Re-hash straight from the stored columns via the same builder the writer
    // used — no parsing or re-stringifying, so the bytes are identical.
    const recalculatedHash = computeHash(auditHashPayload({
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
      prevHash: log.prev_hash,
    }));

    if (recalculatedHash !== log.curr_hash) {
      return { isValid: false, brokenAtIndex: i, brokenLogId: log.id, message: `Tampering detected at index ${i} (ID: ${log.id}). Payload hash mismatch.` };
    }

    expectedPrevHash = log.curr_hash;
  }

  return { isValid: true, message: 'Chain integrity verified. All logs are tamper-free.' };
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
export function rebuildAuditChain() {
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY rowid ASC').all();
  // Update by the primary key, not rowid: SELECT * does not return the implicit
  // rowid column, so WHERE rowid = ? would bind undefined and change nothing.
  const upd = db.prepare('UPDATE audit_logs SET prev_hash = ?, curr_hash = ? WHERE id = ?');
  let prevHash = 'GENESIS_HASH';
  db.transaction(() => {
    for (const log of rows) {
      const currHash = computeHash(auditHashPayload({
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
      }));
      upd.run(prevHash, currHash, log.id);
      prevHash = currHash;
    }
  })();
  return { rebuilt: rows.length };
}

/** Rebuild the chain once if — and only if — it does not currently verify. */
export function repairAuditChainIfBroken() {
  const before = verifyLogIntegrity();
  if (before.isValid) return { rebuilt: 0, wasValid: true };
  const { rebuilt } = rebuildAuditChain();
  return { rebuilt, wasValid: false, nowValid: verifyLogIntegrity().isValid };
}

/**
 * Detects Segregation of Duties (SoD) violations.
 * Specifically checks if the same user created AND approved the same entity/invoice/contract.
 */
export function detectSoDViolations() {
  // Single-quoted literals: SQLite reads double quotes as identifiers first and
  // errors with "no such column: CREATE" once the DQS-as-string misfeature is off.
  const logs = db.prepare("SELECT * FROM audit_logs WHERE action IN ('CREATE', 'APPROVE', 'VERIFY')").all();
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
