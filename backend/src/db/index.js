import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'platform.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

/** Recreate disputes tables when upgrading from the old 4-status MVP schema. */
function migrateDisputesSchema() {
  const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='disputes'`).get();
  if (!exists) return;
  const cols = db.prepare('PRAGMA table_info(disputes)').all().map((c) => c.name);
  if (cols.includes('dispute_no')) return;

  db.exec(`
    DROP TABLE IF EXISTS dispute_comments;
    DROP TABLE IF EXISTS dispute_events;
    DROP TABLE IF EXISTS disputes;
  `);
  db.exec(schema);
}

/** Recreate reconciliations when upgrading from thin MVP schema. */
function migrateReconciliationSchema() {
  const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='reconciliations'`).get();
  if (!exists) return;
  const cols = db.prepare('PRAGMA table_info(reconciliations)').all().map((c) => c.name);
  if (cols.includes('recon_no')) return;

  db.exec(`
    DROP TABLE IF EXISTS recon_reopen_requests;
    DROP TABLE IF EXISTS recon_statements;
    DROP TABLE IF EXISTS recon_events;
    DROP TABLE IF EXISTS recon_items;
    DROP TABLE IF EXISTS reconciliations;
  `);
  db.exec(schema);
}

migrateDisputesSchema();
migrateReconciliationSchema();

/** Recreate payment security when upgrading from thin MVP schema. */
function migratePaymentSecuritySchema() {
  const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='payment_security'`).get();
  if (!exists) return;
  const cols = db.prepare('PRAGMA table_info(payment_security)').all().map((c) => c.name);
  if (cols.includes('instrument_no')) return;

  db.exec(`
    DROP TABLE IF EXISTS security_adequacy_overrides;
    DROP TABLE IF EXISTS security_releases;
    DROP TABLE IF EXISTS security_alerts;
    DROP TABLE IF EXISTS security_invocations;
    DROP TABLE IF EXISTS security_events;
    DROP TABLE IF EXISTS security_requirements;
    DROP TABLE IF EXISTS payment_security;
  `);
  db.exec(schema);
}

migratePaymentSecuritySchema();

/** Add CERC billing columns to invoices and contracts if upgrading from simple billing schema. */
function migrateBillingSchema() {
  const invCols = db.prepare('PRAGMA table_info(invoices)').all().map(c => c.name);
  if (!invCols.includes('capacity_charges')) {
    db.exec(`
      ALTER TABLE invoices ADD COLUMN capacity_charges REAL DEFAULT 0;
      ALTER TABLE invoices ADD COLUMN incentive_charges REAL DEFAULT 0;
      ALTER TABLE invoices ADD COLUMN free_power_deduction REAL DEFAULT 0;
      ALTER TABLE invoices ADD COLUMN nrldc_fees REAL DEFAULT 0;
      ALTER TABLE invoices ADD COLUMN invoice_breakdown_json TEXT;
    `);
  }

  const conCols = db.prepare('PRAGMA table_info(contracts)').all().map(c => c.name);
  if (!conCols.includes('normative_aux')) {
    db.exec(`
      ALTER TABLE contracts ADD COLUMN normative_aux REAL;
      ALTER TABLE contracts ADD COLUMN free_energy_home_state REAL;
      ALTER TABLE contracts ADD COLUMN capacity_charges_total REAL;
    `);
  }
}
migrateBillingSchema();

function migrateRBACSchema() {
  const cols = db.prepare('PRAGMA table_info(entities)').all().map(c => c.name);
  if (!cols.includes('address')) {
    db.exec(`
      ALTER TABLE entities ADD COLUMN address TEXT;
      ALTER TABLE entities ADD COLUMN bank_name TEXT;
      ALTER TABLE entities ADD COLUMN account_no TEXT;
      ALTER TABLE entities ADD COLUMN ifsc_code TEXT;
      ALTER TABLE entities ADD COLUMN branch_address TEXT;
    `);
  }
  
  db.exec(`
    PRAGMA foreign_keys=off;
    BEGIN TRANSACTION;
    
    ALTER TABLE users RENAME TO old_users;
    ALTER TABLE invoices RENAME TO old_invoices;
  `);
  
  db.exec(schema);
  
  db.exec(`
    INSERT INTO users (id, name, email, password_hash, role, linked_entity_id, is_active, created_at)
    SELECT id, name, email, password_hash, role, linked_entity_id, is_active, created_at FROM old_users;
    
    INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh, tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees, transmission_charges, total_amount, invoice_breakdown_json, lps, penalty, trading_margin, taxes, other_adjustments, disputed_amount, due_date, status, version, parent_invoice_id, created_by, created_at, updated_at)
    SELECT id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh, tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees, transmission_charges, total_amount, invoice_breakdown_json, lps, penalty, trading_margin, taxes, other_adjustments, disputed_amount, due_date, status, version, parent_invoice_id, created_by, created_at, updated_at FROM old_invoices;
    
    DROP TABLE old_users;
    DROP TABLE old_invoices;
    
    COMMIT;
    PRAGMA foreign_keys=on;
  `);
}

try {
  migrateRBACSchema();
} catch (e) {
  if (e.message.includes('old_users')) {
    db.exec('ROLLBACK; PRAGMA foreign_keys=on;').catch(() => {});
  } else {
    db.exec('ROLLBACK; PRAGMA foreign_keys=on;');
  }
}

function migrateEntityCorporateDetails() {
  const columns = db.pragma('table_info(entities)').map(c => c.name);
  if (!columns.includes('logo_url')) {
    db.exec(`
      ALTER TABLE entities ADD COLUMN logo_url TEXT;
      ALTER TABLE entities ADD COLUMN corporate_email TEXT;
      ALTER TABLE entities ADD COLUMN corporate_phone TEXT;
      ALTER TABLE entities ADD COLUMN corporate_website TEXT;
      ALTER TABLE entities ADD COLUMN tan_no TEXT;
    `);
  }
}

try {
  migrateEntityCorporateDetails();
} catch (e) {
  console.error('Failed to migrate entity corporate details:', e);
}

export default db;
