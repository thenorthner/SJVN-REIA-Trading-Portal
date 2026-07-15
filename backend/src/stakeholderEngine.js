import db from './db/index.js';
import { newId, logAudit, pushNotification } from './util.js';

export function runStakeholderAlerts() {
  console.log('Running daily stakeholder/contract alerts cascade...');

  const today = new Date();
  
  // 1. Document Expiry Alerts
  const docs = db.prepare(`SELECT * FROM entity_documents WHERE validity_end IS NOT NULL AND alert_sent = 0`).all();
  for (const doc of docs) {
    const end = new Date(doc.validity_end);
    const diffDays = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 60 && diffDays > 0) {
      pushNotification('REIA_USER', 'DOCUMENT_EXPIRING', `Document ${doc.doc_type} for Entity ${doc.entity_id} expires in ${diffDays} days.`);
      db.prepare('UPDATE entity_documents SET alert_sent = 1 WHERE id = ?').run(doc.id);
    }
  }

  // 2. Contract Renewal/Expiry Alerts
  const contracts = db.prepare(`SELECT * FROM contracts WHERE status IN ('ACTIVE', 'NEARING_EXPIRY')`).all();
  for (const c of contracts) {
    const end = new Date(c.tenure_end);
    const diffDays = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 90 && c.status === 'ACTIVE') {
      db.prepare("UPDATE contracts SET status = 'NEARING_EXPIRY' WHERE id = ?").run(c.id);
      pushNotification('REIA_USER', 'CONTRACT_EXPIRING', `Contract ${c.contract_no} expires in ${diffDays} days. Initiate renewal workflow.`);
      logAudit({ user: { id: 'SYSTEM', name: 'SYSTEM' }, action: 'STATUS_UPDATE', module: 'CONTRACTS', entityType: 'contract', entityId: c.id, details: { newStatus: 'NEARING_EXPIRY' } });
    }
    
    if (diffDays <= 0 && c.status === 'NEARING_EXPIRY') {
      db.prepare("UPDATE contracts SET status = 'EXPIRED' WHERE id = ?").run(c.id);
      pushNotification('REIA_USER', 'CONTRACT_EXPIRED', `Contract ${c.contract_no} has expired. Billing engine will block future invoices.`);
      logAudit({ user: { id: 'SYSTEM', name: 'SYSTEM' }, action: 'STATUS_UPDATE', module: 'CONTRACTS', entityType: 'contract', entityId: c.id, details: { newStatus: 'EXPIRED' } });
    }
  }
  
  // 3. Onboarding SLA Tracking (Flag PENDING > 14 days)
  const pendingEntities = db.prepare("SELECT * FROM entities WHERE status = 'PENDING'").all();
  for (const e of pendingEntities) {
    const created = new Date(e.created_at);
    const diffDays = Math.ceil((today - created) / (1000 * 60 * 60 * 24));
    if (diffDays > 14) {
      pushNotification('MANAGEMENT', 'SLA_BREACH', `Entity ${e.name} onboarding pending for ${diffDays} days.`);
    }
  }
}
