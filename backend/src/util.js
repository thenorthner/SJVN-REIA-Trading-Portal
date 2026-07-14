import { v4 as uuidv4 } from 'uuid';
import db from './db/index.js';

export const newId = (prefix) => `${prefix}-${uuidv4().slice(0, 8)}`;

export function logAudit({ user, action, module, entityType, entityId, details }) {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (id, user_id, user_name, action, module, entity_type, entity_id, details)
    VALUES (@id, @userId, @userName, @action, @module, @entityType, @entityId, @details)
  `);
  stmt.run({
    id: newId('AUD'),
    userId: user?.id ?? null,
    userName: user?.name ?? 'system',
    action,
    module,
    entityType: entityType ?? null,
    entityId: entityId ?? null,
    details: details ? JSON.stringify(details) : null,
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
