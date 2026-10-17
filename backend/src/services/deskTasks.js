/**
 * D4: a dispute's root cause sent back to the desk that owns it (Batch 5,
 * 17-Oct-2026).
 *
 * When SJVN accepts a dispute — in full or in part — the bill was wrong, and a
 * credit note fixes only the bill. If the cause was the energy figure, the
 * Energy Data desk gets a task to correct the record (and audit the source it
 * came from); if it was the tariff or rate, the Contract Compliance desk gets a
 * task to review the PPA/PSA tariff on record. A rejected dispute leaves no
 * task: the bill stood. One task per dispute and type, so a re-resolution does
 * not raise a second one.
 */
import db from '../db/index.js';
import { newId, pushNotification, logAudit } from '../util.js';

export const ROOT_CAUSE_TASKS = {
  ENERGY_DATA_MISMATCH: { desk: 'ENERGY_DATA', task_type: 'ENERGY_CORRECTION', label: 'Correct and audit the energy record' },
  TARIFF_RATE_ERROR: { desk: 'CONTRACT_COMPLIANCE', task_type: 'TARIFF_REVIEW', label: 'Review the tariff on record' },
};
export const DESK_ROLES = {
  ENERGY_DATA: ['REIA_USER', 'REIA_ADMIN'],
  CONTRACT_COMPLIANCE: ['REIA_ADMIN', 'SJVN_ADMIN'],
};

/** Raise the root-cause task for a dispute SJVN accepted; null when none applies. */
export function raiseRootCauseTask(dispute, invoice, { outcome, accepted = 0, user = null } = {}) {
  const rule = ROOT_CAUSE_TASKS[dispute.reason_code];
  if (!rule || !['FULL_CREDIT', 'PARTIAL_CREDIT'].includes(outcome)) return null;
  const existing = db.prepare('SELECT * FROM desk_tasks WHERE source_kind = ? AND source_id = ? AND task_type = ?').get('DISPUTE', dispute.id, rule.task_type);
  if (existing) return existing;
  const contract = db.prepare('SELECT id, contract_no, contract_type, tariff_per_unit FROM contracts WHERE id = ?').get(invoice.contract_id);
  const period = invoice.billing_period || null;
  const amount = `₹${Number(accepted || 0).toLocaleString('en-IN')}`;
  const title = rule.task_type === 'ENERGY_CORRECTION'
    ? `Energy for ${contract?.contract_no || invoice.contract_id} ${period || ''} was billed wrong — correct the record`
    : `Tariff on ${contract?.contract_no || invoice.contract_id} was applied wrong — review the PPA/PSA rate`;
  const detail = rule.task_type === 'ENERGY_CORRECTION'
    ? `Dispute ${dispute.dispute_no} on ${invoice.invoice_no} was accepted (${outcome === 'FULL_CREDIT' ? 'in full' : 'in part'}, ${amount}) for an energy mismatch. Re-check the locked figure against the JMR / SEA / REA it came from, correct or supersede it, and note what source was wrong so the next month is billed right.`
    : `Dispute ${dispute.dispute_no} on ${invoice.invoice_no} was accepted (${outcome === 'FULL_CREDIT' ? 'in full' : 'in part'}, ${amount}) for a tariff/rate error. Compare the rate on record (₹${contract?.tariff_per_unit ?? '—'}/kWh) and any escalation or amendment with the signed ${contract?.contract_type || 'contract'}, and correct the contract master before the next bill.`;
  const seq = (db.prepare('SELECT COUNT(*) n FROM desk_tasks').get().n || 0) + 1;
  const id = newId('DTK');
  db.prepare(`INSERT INTO desk_tasks (id, task_no, desk, task_type, source_kind, source_id, contract_id, invoice_id, period_month, title, detail)
    VALUES (?, ?, ?, ?, 'DISPUTE', ?, ?, ?, ?, ?, ?)`)
    .run(id, `TASK/${new Date().getFullYear()}/${String(seq).padStart(4, '0')}`, rule.desk, rule.task_type, dispute.id, invoice.contract_id, invoice.id, period, title, detail);
  for (const role of DESK_ROLES[rule.desk]) pushNotification({ role, type: 'DESK_TASK', message: `${rule.label}: ${title}` });
  logAudit({ user: user || { id: null, name: 'system', role: 'SYSTEM' }, action: 'ROOT_CAUSE_TASK_RAISED', module: 'REIA', entityType: 'dispute', entityId: dispute.id, details: { task_id: id, desk: rule.desk, task_type: rule.task_type } });
  return db.prepare('SELECT * FROM desk_tasks WHERE id = ?').get(id);
}

export function listDeskTasks({ desk = null, status = 'OPEN', contractId = null } = {}) {
  const where = ['1=1'];
  const params = [];
  if (desk) { where.push('t.desk = ?'); params.push(desk); }
  if (status && status !== 'ALL') { where.push('t.status = ?'); params.push(status); }
  if (contractId) { where.push('t.contract_id = ?'); params.push(contractId); }
  const rows = db.prepare(`
    SELECT t.*, c.contract_no, i.invoice_no, d.dispute_no, d.reason_code FROM desk_tasks t
    LEFT JOIN contracts c ON c.id = t.contract_id LEFT JOIN invoices i ON i.id = t.invoice_id
    LEFT JOIN disputes d ON d.id = t.source_id AND t.source_kind = 'DISPUTE'
    WHERE ${where.join(' AND ')} ORDER BY (t.status = 'OPEN') DESC, t.created_at DESC
  `).all(...params);
  return { rows, totals: { open: rows.filter((r) => r.status === 'OPEN').length } };
}

export function closeDeskTask(id, { status = 'DONE', note, user }) {
  const t = db.prepare('SELECT * FROM desk_tasks WHERE id = ?').get(id);
  if (!t) throw Object.assign(new Error('Task not found'), { status: 404 });
  if (t.status !== 'OPEN') throw Object.assign(new Error(`${t.task_no} is already ${t.status.toLowerCase()}`), { status: 409 });
  if (!['DONE', 'DROPPED'].includes(status)) throw Object.assign(new Error('status must be DONE or DROPPED'), { status: 400 });
  const text = String(note || '').trim();
  if (text.length < 10) throw Object.assign(new Error('Say what was done (or why it is dropped) in a sentence — at least 10 characters.'), { status: 400 });
  if (!DESK_ROLES[t.desk].includes(user?.role) && !['SJVN_ADMIN', 'IT_SUPER_ADMIN'].includes(user?.role)) {
    throw Object.assign(new Error('This task belongs to another desk'), { status: 403 });
  }
  db.prepare(`UPDATE desk_tasks SET status = ?, close_note = ?, closed_by = ?, closed_at = datetime('now') WHERE id = ?`).run(status, text, user.name, id);
  logAudit({ user, action: `DESK_TASK_${status}`, module: 'REIA', entityType: 'desk_task', entityId: id, details: { note: text } });
  return db.prepare('SELECT * FROM desk_tasks WHERE id = ?').get(id);
}
