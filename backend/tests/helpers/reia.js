import db from '../../src/db/index.js';
import { signToken } from '../../src/middleware/auth.js';
import { newId } from '../../src/util.js';

// Shared fixtures for the REIA module tests. Each helper creates the minimum a
// test needs and returns the row, so a test reads as the scenario it describes
// rather than as a pile of inserts.

export function makeUser(role, overrides = {}) {
  const id = overrides.id || newId('USR');
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, linked_entity_id, is_active)
    VALUES (?, ?, ?, 'x', ?, ?, 1)
  `).run(id, overrides.name || `${role} user`, overrides.email || `${id}@test.in`, role, overrides.linked_entity_id || null);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function tokenFor(role, overrides = {}) {
  return signToken(makeUser(role, overrides));
}

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

export function makeEntity(type = 'SELLER', overrides = {}) {
  const id = overrides.id || newId(type === 'SELLER' ? 'SELL' : 'BUY');
  db.prepare(`
    INSERT INTO entities (id, entity_type, category, name, pan_no, gst_no, capacity_mw, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, type, overrides.category || (type === 'SELLER' ? 'RE Generator' : 'DISCOM'),
    overrides.name || `${type} ${id}`, overrides.pan_no || null, overrides.gst_no || null,
    overrides.capacity_mw ?? 100, overrides.status || 'APPROVED');
  return db.prepare('SELECT * FROM entities WHERE id = ?').get(id);
}

export function makeContract(overrides = {}) {
  const id = overrides.id || newId('CON');
  const seller = overrides.seller_id || makeEntity('SELLER').id;
  const buyer = overrides.buyer_id || makeEntity('BUYER').id;
  const cols = {
    id,
    contract_no: overrides.contract_no || `C-${id}`,
    contract_type: overrides.contract_type || 'PPA',
    project_type: overrides.project_type || 'SOLAR',
    seller_id: seller,
    buyer_id: buyer,
    capacity_mw: overrides.capacity_mw ?? 100,
    tariff_per_unit: overrides.tariff_per_unit ?? 3.0,
    tenure_start: overrides.tenure_start || '2026-04-01',
    tenure_end: overrides.tenure_end || '2027-03-31',
    status: overrides.status || 'ACTIVE',
  };
  const present = db.prepare('PRAGMA table_info(contracts)').all().map((c) => c.name);
  const keys = Object.keys(cols).filter((k) => present.includes(k));
  db.prepare(`INSERT INTO contracts (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => cols[k]));
  // Anything else the caller asked for that the table actually has.
  for (const [k, v] of Object.entries(overrides)) {
    if (!keys.includes(k) && present.includes(k)) {
      db.prepare(`UPDATE contracts SET ${k} = ? WHERE id = ?`).run(v, id);
    }
  }
  return db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
}

export function makeInvoice(overrides = {}) {
  const id = overrides.id || newId('INV');
  const contract = overrides.contract_id || makeContract().id;
  const cols = {
    id,
    invoice_no: overrides.invoice_no || `INV-${id}`,
    contract_id: contract,
    invoice_type: overrides.invoice_type || 'FINAL',
    direction: overrides.direction || 'SJVN_TO_BUYER',
    billing_period: overrides.billing_period || '2026-04',
    energy_mwh: overrides.energy_mwh ?? 1000,
    tariff_per_unit: overrides.tariff_per_unit ?? 3.0,
    energy_charges: overrides.energy_charges ?? 3000000,
    total_amount: overrides.total_amount ?? 3000000,
    status: overrides.status || 'DRAFT',
  };
  const present = db.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name);
  const keys = Object.keys(cols).filter((k) => present.includes(k));
  db.prepare(`INSERT INTO invoices (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => cols[k]));
  for (const [k, v] of Object.entries(overrides)) {
    if (!keys.includes(k) && present.includes(k)) {
      db.prepare(`UPDATE invoices SET ${k} = ? WHERE id = ?`).run(v, id);
    }
  }
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
}

/** Columns a table actually has — lets a test say plainly that a field is missing. */
export function columnsOf(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

export function hasTable(name) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name);
}

/** Audit rows written for one entity, newest first. */
export function auditFor(entityId) {
  return db.prepare('SELECT * FROM audit_logs WHERE entity_id = ? ORDER BY rowid DESC').all(entityId);
}

export function resetReia() {
  const order = [
    'invoice_approvals', 'invoice_deliveries', 'payments', 'invoices',
    'dispute_comments', 'dispute_events', 'disputes',
    'recon_items', 'recon_events', 'recon_statements', 'recon_reopen_requests', 'reconciliations',
    'security_events', 'security_invocations', 'security_alerts', 'security_releases', 'payment_security',
    'contract_allocations', 'contract_amendments', 'contract_projects', 'contracts',
    'energy_data', 'entity_audit', 'documents', 'audit_logs', 'notifications',
  ];
  db.pragma('foreign_keys = OFF');
  for (const t of order) {
    if (hasTable(t)) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* leave it */ } }
  }
  db.pragma('foreign_keys = ON');
}
