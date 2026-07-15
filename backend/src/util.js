import { v4 as uuidv4 } from 'uuid';
import db from './db/index.js';

export const newId = (prefix) => `${prefix}-${uuidv4().slice(0, 8)}`;

import { secureLogAudit } from './auditEngine.js';

export function logAudit({ req, user, action, module, entityType, entityId, beforeValue, afterValue, reason, details }) {
  secureLogAudit(req || { user }, {
    action,
    module,
    entityType,
    entityId,
    beforeValue,
    afterValue,
    reason,
    details
  });
}

export function pushNotification({ userId = null, role = null, type, message }) {
  const stmt = db.prepare(`
    INSERT INTO notifications (id, user_id, role, type, message)
    VALUES (@id, @userId, @role, @type, @message)
  `);
  stmt.run({ id: newId('NTF'), userId, role, type, message });
}

export function genInvoiceNo(prefix = 'INV') {
  const rand = Math.floor(100000 + Math.random() * 900000);
  const year = new Date().getFullYear();
  return `${prefix}/${year}/${rand}`;
}
