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

  const payloadToHash = {
    traceId, sessionId, ipAddress, userId, userName, userRole,
    action, module, entityType, entityId, beforeValue, afterValue, reason, details, prevHash
  };

  // Remove undefined properties before hashing
  Object.keys(payloadToHash).forEach(key => payloadToHash[key] === undefined && delete payloadToHash[key]);

  const currHash = computeHash(payloadToHash);

  const stmt = db.prepare(`
    INSERT INTO audit_logs (
      id, trace_id, session_id, ip_address, user_id, user_name, user_role,
      action, module, entity_type, entity_id, before_value, after_value, reason, details,
      prev_hash, curr_hash
    ) VALUES (
      @id, @traceId, @sessionId, @ipAddress, @userId, @userName, @userRole,
      @action, @module, @entityType, @entityId, @beforeValue, @afterValue, @reason, @details,
      @prevHash, @currHash
    )
  `);

  stmt.run({
    id: newId('AUD'),
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
    currHash
  });
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

    const payloadToHash = {
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
      beforeValue: log.before_value ? JSON.parse(log.before_value) : null,
      afterValue: log.after_value ? JSON.parse(log.after_value) : null,
      reason: log.reason,
      details: log.details ? JSON.parse(log.details) : null,
      prevHash: log.prev_hash
    };

    // Keep it exactly the same as during stringify (nulls are stringified as nulls in JSON, while undefineds are stripped)
    Object.keys(payloadToHash).forEach(key => payloadToHash[key] === undefined && delete payloadToHash[key]);

    const recalculatedHash = computeHash(payloadToHash);

    if (recalculatedHash !== log.curr_hash) {
      return { isValid: false, brokenAtIndex: i, brokenLogId: log.id, message: `Tampering detected at index ${i} (ID: ${log.id}). Payload hash mismatch.` };
    }

    expectedPrevHash = log.curr_hash;
  }

  return { isValid: true, message: 'Chain integrity verified. All logs are tamper-free.' };
}

/**
 * Detects Segregation of Duties (SoD) violations.
 * Specifically checks if the same user created AND approved the same entity/invoice/contract.
 */
export function detectSoDViolations() {
  const logs = db.prepare('SELECT * FROM audit_logs WHERE action IN ("CREATE", "APPROVE", "VERIFY")').all();
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
