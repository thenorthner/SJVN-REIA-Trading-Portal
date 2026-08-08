import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { catalogForEntityType, summarizeApprovals } from '../regulatoryApprovals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// SJVN_DB_PATH lets the test suite point at a throwaway database. Without it the
// tests would run against — and mutate — the real platform.db.
const dbPath = process.env.SJVN_DB_PATH || path.join(__dirname, 'platform.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

function localId(prefix) {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}

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
  if (!conCols.includes('payment_terms_days')) {
    db.exec(`
      ALTER TABLE contracts ADD COLUMN payment_terms_days INTEGER;
      ALTER TABLE contracts ADD COLUMN rebate_pct REAL;
      ALTER TABLE contracts ADD COLUMN rebate_days INTEGER;
      ALTER TABLE contracts ADD COLUMN rebate_basis TEXT DEFAULT 'BILL_DATE';
      ALTER TABLE contracts ADD COLUMN lps_annual_pct REAL;
      ALTER TABLE contracts ADD COLUMN lps_grace_days INTEGER DEFAULT 0;
    `);
  }
}
migrateBillingSchema();

/**
 * Rebuild a table from schema.sql, preserving data by explicit column names.
 * Must run with legacy_alter_table=ON so the RENAME does NOT rewrite FK/trigger
 * references in *other* tables (which would leave them pointing at the _old copy).
 */
function rebuildTableFromSchema(name) {
  const cols = db.prepare(`PRAGMA table_info(${name})`).all().map((c) => `"${c.name}"`).join(', ');
  db.exec(`ALTER TABLE ${name} RENAME TO ${name}_old`);
  db.exec(schema); // recreates `name` fresh; all other tables are IF NOT EXISTS no-ops
  db.exec(`INSERT INTO ${name} (${cols}) SELECT ${cols} FROM ${name}_old`);
  db.exec(`DROP TABLE ${name}_old`);
}

/**
 * Relax invoices.invoice_type CHECK to allow 'ARREAR', and self-heal any table
 * whose FK was accidentally rewritten to reference a dropped `invoices_old`.
 * SQLite can't ALTER a CHECK, so the table is rebuilt from schema.sql.
 */
function migrateInvoiceArrearType() {
  const inv = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='invoices'").get();
  const needsArrear = inv && !inv.sql.includes("'ARREAR'");
  const broken = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%invoices_old%'").all();
  if (!needsArrear && broken.length === 0) return; // fresh/healthy DB

  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('PRAGMA legacy_alter_table=ON'); // keep RENAME from touching other tables' FKs
  try {
    if (needsArrear) rebuildTableFromSchema('invoices');
    for (const t of broken) rebuildTableFromSchema(t.name); // repair FK → invoices_old
  } finally {
    db.exec('PRAGMA legacy_alter_table=OFF');
    db.exec('PRAGMA foreign_keys=ON');
  }
}
migrateInvoiceArrearType();

/**
 * Update contracts schema to support multi-version amendments:
 * - contract_no uniqueness becomes UNIQUE(contract_no, version)
 * - status CHECK includes 'AMENDED'
 */
function migrateContractVersionSchema() {
  const c = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='contracts'").get();
  const needsFix = c && (c.sql.includes('contract_no TEXT UNIQUE') || !c.sql.includes('UNIQUE(contract_no, version)') || !c.sql.includes("'AMENDED'"));
  if (!needsFix) return;

  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('PRAGMA legacy_alter_table=ON');
  try {
    rebuildTableFromSchema('contracts');
  } finally {
    db.exec('PRAGMA legacy_alter_table=OFF');
    db.exec('PRAGMA foreign_keys=ON');
  }
}
migrateContractVersionSchema();

// Add release_source to payments (generator pay-out source) on existing DBs.
function migratePaymentReleaseSource() {
  const cols = db.prepare('PRAGMA table_info(payments)').all().map((c) => c.name);
  if (!cols.includes('release_source')) {
    db.exec('ALTER TABLE payments ADD COLUMN release_source TEXT');
  }
}
migratePaymentReleaseSource();

// Add other_charges_json (pass-through charges) to invoices on existing DBs.
function migrateInvoiceOtherCharges() {
  const cols = db.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name);
  if (!cols.includes('other_charges_json')) {
    db.exec('ALTER TABLE invoices ADD COLUMN other_charges_json TEXT');
  }
}
migrateInvoiceOtherCharges();

// Add NOAR contract fields (+ standing clearance) to bilateral_transactions.
function migrateBilateralNoar() {
  const cols = db.prepare('PRAGMA table_info(bilateral_transactions)').all().map((c) => c.name);
  if (!cols.includes('noar_status')) {
    db.exec(`
      ALTER TABLE bilateral_transactions ADD COLUMN is_standing_clearance INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE bilateral_transactions ADD COLUMN noar_contract_no TEXT;
      ALTER TABLE bilateral_transactions ADD COLUMN noar_status TEXT NOT NULL DEFAULT 'NOT_INITIATED';
    `);
  }
  // The create form, the INSERT and the list filter were all written against
  // these columns, but they were never added to the table — so creating a
  // bilateral deal failed outright and Total Losses rendered as NaN.
  if (!cols.includes('oa_type')) {
    db.exec(`
      ALTER TABLE bilateral_transactions ADD COLUMN oa_type TEXT NOT NULL DEFAULT 'STOA';
      ALTER TABLE bilateral_transactions ADD COLUMN loss_injection_state REAL NOT NULL DEFAULT 0;
      ALTER TABLE bilateral_transactions ADD COLUMN loss_inter_state REAL NOT NULL DEFAULT 0;
      ALTER TABLE bilateral_transactions ADD COLUMN loss_drawee_state REAL NOT NULL DEFAULT 0;
    `);
  }
  // Grid India can send an application back; the desk fixes it and resubmits.
  if (!cols.includes('noar_rejection_reason')) {
    db.exec(`
      ALTER TABLE bilateral_transactions ADD COLUMN noar_rejection_category TEXT;
      ALTER TABLE bilateral_transactions ADD COLUMN noar_rejection_reason TEXT;
      ALTER TABLE bilateral_transactions ADD COLUMN noar_resubmit_count INTEGER NOT NULL DEFAULT 0;
    `);
  }
  // Last SLA state an alert was raised for, so the hourly sweep notifies on a
  // change rather than re-sending the same warning every run.
  if (!cols.includes('noar_sla_alerted_state')) {
    db.exec("ALTER TABLE bilateral_transactions ADD COLUMN noar_sla_alerted_state TEXT");
  }
  // Transition history for open-access approval tracking. Deliberately not
  // backfilled: transactions that already moved before this table existed have
  // no real transition times, and inventing them would misreport turnaround.
  db.exec(`
    CREATE TABLE IF NOT EXISTS noar_status_timeline (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL REFERENCES bilateral_transactions(id),
      status_from TEXT,
      status_to TEXT NOT NULL,
      noar_contract_no TEXT,
      changed_by TEXT,
      note TEXT,
      changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_noar_timeline_txn ON noar_status_timeline(transaction_id, changed_at);
  `);
}
migrateBilateralNoar();

// Split the single tariff into purchase rate, sale rate and trading margin.
// The legacy tariff_per_unit was the rate billed to the buyer (the sale rate),
// so back-fill sale_rate = tariff, apply the standard ₹0.03/kWh ISET margin, and
// derive purchase_rate = sale - margin. Existing readers still use tariff_per_unit.
function migrateBilateralMargin() {
  // Added column-by-column so a partial upgrade (e.g. an earlier run that only
  // got the first ALTER in) still completes on the next boot rather than failing
  // on a duplicate-column error.
  const addColumn = (name, ddl) => {
    const cols = db.prepare('PRAGMA table_info(bilateral_transactions)').all().map((c) => c.name);
    if (!cols.includes(name)) db.exec(`ALTER TABLE bilateral_transactions ADD COLUMN ${name} ${ddl};`);
  };
  addColumn('purchase_rate_per_unit', 'REAL');
  addColumn('sale_rate_per_unit', 'REAL');
  addColumn('trading_margin_per_unit', 'REAL NOT NULL DEFAULT 0.03');
  addColumn('contracted_mwh', 'REAL');
  addColumn('noar_application_no', 'TEXT');
  addColumn('noar_region', "TEXT DEFAULT 'WR'");
  db.exec(`
    UPDATE bilateral_transactions
       SET sale_rate_per_unit = tariff_per_unit,
           purchase_rate_per_unit = ROUND(tariff_per_unit - 0.03, 4)
     WHERE sale_rate_per_unit IS NULL;
  `);
}
try {
  migrateBilateralMargin();
} catch (e) {
  console.error('Bilateral margin migration failed:', e.message);
}

// Bring the bids table up to what the exchange-bid workflow actually writes:
// gate closure / approval / no-bid fields, and the OCF carry-forward leg columns.
// bid_blocks and bid_events were referenced by the routes but never existed.
function migrateBidsWorkflow() {
  const cols = db.prepare('PRAGMA table_info(bids)').all().map((c) => c.name);
  if (!cols.includes('approval_status')) {
    db.exec(`
      ALTER TABLE bids ADD COLUMN gate_closure_time TEXT;
      ALTER TABLE bids ADD COLUMN is_no_bid INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE bids ADD COLUMN no_bid_reason TEXT;
      ALTER TABLE bids ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'PENDING';
      ALTER TABLE bids ADD COLUMN exchange_receipt_ref TEXT;
    `);
  }
  if (!cols.includes('ocf_leg')) {
    db.exec('ALTER TABLE bids ADD COLUMN ocf_leg INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS bid_blocks (
      id TEXT PRIMARY KEY,
      bid_id TEXT NOT NULL REFERENCES bids(id),
      time_block TEXT NOT NULL,
      quantum_mw REAL NOT NULL DEFAULT 0,
      price_per_unit REAL NOT NULL DEFAULT 0,
      cleared_quantum_mw REAL NOT NULL DEFAULT 0,
      cleared_price REAL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bid_events (
      id TEXT PRIMARY KEY,
      bid_id TEXT NOT NULL REFERENCES bids(id),
      actor_id TEXT,
      event_type TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
migrateBidsWorkflow();

// Multi-channel notifications: a per-channel delivery log, and a phone column
// on users so internal recipients can receive SMS once numbers are captured.
function migrateNotificationDelivery() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY,
      notification_id TEXT REFERENCES notifications(id),
      event TEXT,
      channel TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS')),
      recipient_name TEXT,
      address TEXT NOT NULL,
      subject TEXT,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','FAILED','SKIPPED')),
      provider TEXT,
      provider_ref TEXT,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notif_deliveries_status ON notification_deliveries(status, channel);
  `);
  // subject/body were added after the first cut of the table; keep both retry
  // content faithful on databases created before this line.
  const delCols = db.prepare('PRAGMA table_info(notification_deliveries)').all().map((c) => c.name);
  if (!delCols.includes('subject')) db.exec('ALTER TABLE notification_deliveries ADD COLUMN subject TEXT');
  if (!delCols.includes('body')) db.exec('ALTER TABLE notification_deliveries ADD COLUMN body TEXT');
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('phone')) db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
}
migrateNotificationDelivery();

// Financial ledgers are append-only: a wrong entry is reversed by an opposing
// entry, never erased. These columns link a reversal back to what it undoes.
function migrateLedgerReversals() {
  const noar = db.prepare('PRAGMA table_info(noar_wallet_txns)').all().map((c) => c.name);
  if (noar.length && !noar.includes('reverses_txn_id')) {
    db.exec('ALTER TABLE noar_wallet_txns ADD COLUMN reverses_txn_id TEXT');
  }
  const rec = db.prepare('PRAGMA table_info(rec_transactions)').all().map((c) => c.name);
  if (rec.length && !rec.includes('reverses_txn_id')) {
    db.exec('ALTER TABLE rec_transactions ADD COLUMN reverses_txn_id TEXT');
  }
}
migrateLedgerReversals();

// system_parameters.category is a CHECK list, so a new category needs a table
// rebuild — SQLite cannot alter a CHECK in place. Without this the TRADING
// parameters are silently dropped by the INSERT OR IGNORE seeder.
function migrateSystemParamCategories() {
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='system_parameters'").get()?.sql;
  if (!ddl || ddl.includes("'TRADING'")) return;
  db.exec(`
    PRAGMA foreign_keys=OFF;
    BEGIN;
    CREATE TABLE system_parameters_new (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN ('REGULATORY','BILLING','GENERAL','TRADING')),
      param_key TEXT NOT NULL UNIQUE,
      param_value TEXT NOT NULL,
      data_type TEXT NOT NULL DEFAULT 'NUMBER' CHECK (data_type IN ('NUMBER','TEXT','PERCENT','JSON')),
      unit TEXT,
      description TEXT,
      effective_from TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO system_parameters_new SELECT * FROM system_parameters;
    DROP TABLE system_parameters;
    ALTER TABLE system_parameters_new RENAME TO system_parameters;
    COMMIT;
    PRAGMA foreign_keys=ON;
  `);
}
migrateSystemParamCategories();

function migrateRBACSchema() {
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  // Already on RBAC users schema — never re-run destructive rename migration
  if (userCols.includes('is_active')) return;

  const entityCols = db.prepare('PRAGMA table_info(entities)').all().map((c) => c.name);
  if (!entityCols.includes('address')) {
    db.exec(`
      ALTER TABLE entities ADD COLUMN address TEXT;
      ALTER TABLE entities ADD COLUMN bank_name TEXT;
      ALTER TABLE entities ADD COLUMN account_no TEXT;
      ALTER TABLE entities ADD COLUMN ifsc_code TEXT;
      ALTER TABLE entities ADD COLUMN branch_address TEXT;
    `);
  }

  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec(`
      ALTER TABLE users RENAME TO old_users;
      ALTER TABLE invoices RENAME TO old_invoices;
    `);
    db.exec(schema);
    db.exec(`
      INSERT INTO users (id, name, email, password_hash, role, linked_entity_id, is_active, created_at)
      SELECT id, name, email, password_hash, role, linked_entity_id, COALESCE(is_active, 1), created_at FROM old_users;

      INSERT INTO invoices (
        id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh, tariff_per_unit,
        energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees, transmission_charges,
        total_amount, invoice_breakdown_json, lps, penalty, trading_margin, taxes, other_adjustments,
        disputed_amount, due_date, status, version, parent_invoice_id, created_by, created_at, updated_at
      )
      SELECT
        id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh, tariff_per_unit,
        energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees, transmission_charges,
        total_amount, invoice_breakdown_json, lps, penalty, trading_margin, taxes, other_adjustments,
        disputed_amount, due_date, status, version, parent_invoice_id, created_by, created_at, updated_at
      FROM old_invoices;

      DROP TABLE old_users;
      DROP TABLE old_invoices;
    `);
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}

/** Repair tables whose FK still points at temporary old_users from a failed RBAC migration. */
function migrateFixStaleUserForeignKeys() {
  function sqlFor(table) {
    return db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table)?.sql || '';
  }
  const needsDocs = sqlFor('documents').includes('old_users');
  const needsVersions = sqlFor('document_versions').includes('old_users');
  const needsAlerts = sqlFor('price_alerts').includes('old_users');
  if (!needsDocs && !needsVersions && !needsAlerts) return;

  db.exec('PRAGMA foreign_keys=OFF');
  try {
    if (needsDocs || needsVersions) {
      const docRows = needsDocs ? db.prepare('SELECT * FROM documents').all() : [];
      const verRows = needsVersions ? db.prepare('SELECT * FROM document_versions').all() : [];

      db.exec('DROP TABLE IF EXISTS document_versions');
      db.exec('DROP TABLE IF EXISTS documents');

      db.exec(`
        CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          entity_id TEXT REFERENCES entities(id),
          contract_id TEXT REFERENCES contracts(id),
          document_type TEXT NOT NULL,
          category TEXT NOT NULL CHECK (category IN ('VERIFY', 'RECORD')),
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
          created_by TEXT REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      const insDoc = db.prepare(`
        INSERT INTO documents (id, entity_id, contract_id, document_type, category, title, status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of docRows) {
        insDoc.run(
          r.id, r.entity_id, r.contract_id, r.document_type, r.category, r.title,
          r.status || 'ACTIVE', r.created_by, r.created_at
        );
      }

      db.exec(`
        CREATE TABLE document_versions (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL REFERENCES documents(id),
          version_number INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_size_bytes INTEGER NOT NULL,
          mime_type TEXT NOT NULL,
          verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'NOT_REQUIRED')),
          verification_notes TEXT,
          verified_by TEXT REFERENCES users(id),
          verified_at TEXT,
          expiry_date TEXT,
          created_by TEXT REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(document_id, version_number)
        )
      `);
      const insVer = db.prepare(`
        INSERT INTO document_versions (
          id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type,
          verification_status, verification_notes, verified_by, verified_at, expiry_date, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of verRows) {
        insVer.run(
          r.id, r.document_id, r.version_number, r.file_path, r.file_name, r.file_size_bytes, r.mime_type,
          r.verification_status, r.verification_notes, r.verified_by, r.verified_at, r.expiry_date, r.created_by, r.created_at
        );
      }
    }

    if (needsAlerts) {
      const rows = db.prepare('SELECT * FROM price_alerts').all();
      db.exec('DROP TABLE IF EXISTS price_alerts');
      db.exec(`
        CREATE TABLE price_alerts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          product TEXT NOT NULL,
          condition TEXT NOT NULL CHECK (condition IN ('ABOVE','BELOW')),
          threshold_price REAL NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      const ins = db.prepare(`
        INSERT INTO price_alerts (id, user_id, product, condition, threshold_price, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of rows) ins.run(r.id, r.user_id, r.product, r.condition, r.threshold_price, r.is_active, r.created_at);
    }
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}

try {
  migrateRBACSchema();
} catch (e) {
  console.error('RBAC migration failed:', e.message);
  try { db.exec('PRAGMA foreign_keys=ON'); } catch (_) { /* ignore */ }
}

try {
  migrateFixStaleUserForeignKeys();
} catch (e) {
  console.error('User FK repair failed:', e.message);
}

/** Repair invoice child tables still pointing at dropped old_invoices. */
function migrateFixStaleInvoiceForeignKeys() {
  function sqlFor(table) {
    return db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table)?.sql || '';
  }
  function recreate(table, createDdl) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    db.exec(`DROP TABLE IF EXISTS ${table}`);
    db.exec(createDdl);
    if (!rows.length) return;
    const placeholders = cols.map(() => '?').join(',');
    const ins = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);
    for (const r of rows) ins.run(...cols.map((c) => r[c]));
  }

  const needsApprovals = sqlFor('invoice_approvals').includes('old_invoices');
  const needsMapping = sqlFor('invoice_mapping').includes('old_invoices');
  const needsPayments = sqlFor('payments').includes('old_invoices');
  const needsDisputes = sqlFor('disputes').includes('old_invoices');
  if (!needsApprovals && !needsMapping && !needsPayments && !needsDisputes) return;

  db.exec('PRAGMA foreign_keys=OFF');
  try {
    if (needsApprovals) {
      recreate('invoice_approvals', `
        CREATE TABLE invoice_approvals (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL REFERENCES invoices(id),
          level INTEGER NOT NULL,
          approver_name TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
          comments TEXT,
          acted_at TEXT
        )
      `);
    }
    if (needsMapping) {
      recreate('invoice_mapping', `
        CREATE TABLE invoice_mapping (
          buyer_invoice_id TEXT NOT NULL REFERENCES invoices(id),
          seller_invoice_id TEXT NOT NULL REFERENCES invoices(id),
          PRIMARY KEY (buyer_invoice_id, seller_invoice_id)
        )
      `);
    }
    if (needsPayments) {
      recreate('payments', `
        CREATE TABLE payments (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL REFERENCES invoices(id),
          amount REAL NOT NULL,
          payment_date TEXT NOT NULL,
          mode TEXT,
          reference TEXT,
          deduction REAL NOT NULL DEFAULT 0,
          remarks TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    }
    if (needsDisputes) {
      recreate('disputes', `
        CREATE TABLE disputes (
          id TEXT PRIMARY KEY,
          dispute_no TEXT UNIQUE NOT NULL,
          invoice_id TEXT NOT NULL REFERENCES invoices(id),
          raised_by_role TEXT NOT NULL CHECK (raised_by_role IN ('BUYER','SELLER')),
          raised_by_user_id TEXT,
          reason_code TEXT NOT NULL,
          charge_line TEXT NOT NULL,
          issue_description TEXT NOT NULL,
          disputed_amount REAL NOT NULL,
          supporting_docs TEXT,
          status TEXT NOT NULL DEFAULT 'RAISED',
          assigned_to TEXT,
          acknowledged_at TEXT,
          acknowledged_by TEXT,
          resolved_at TEXT,
          resolved_by TEXT,
          resolution_outcome TEXT,
          resolution_notes TEXT,
          accepted_amount REAL NOT NULL DEFAULT 0,
          credit_amount REAL NOT NULL DEFAULT 0,
          lps_on_resolution REAL NOT NULL DEFAULT 0,
          before_total REAL,
          after_total REAL,
          supplementary_invoice_id TEXT,
          sla_ack_due TEXT,
          sla_resolve_due TEXT,
          sla_breached_at TEXT,
          escalated_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    }
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}

try {
  migrateFixStaleInvoiceForeignKeys();
} catch (e) {
  console.error('Invoice FK repair failed:', e.message);
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
  // Authorized signatory / digital signature columns (added later)
  const refreshed = db.pragma('table_info(entities)').map(c => c.name);
  if (!refreshed.includes('signature_url')) {
    db.exec(`ALTER TABLE entities ADD COLUMN signature_url TEXT`);
  }
  if (!refreshed.includes('signatory_name')) {
    db.exec(`ALTER TABLE entities ADD COLUMN signatory_name TEXT`);
  }
  if (!refreshed.includes('signatory_designation')) {
    db.exec(`ALTER TABLE entities ADD COLUMN signatory_designation TEXT`);
  }
}

try {
  migrateEntityCorporateDetails();
} catch (e) {
  console.error('Failed to migrate entity corporate details:', e);
}

/** Provisional↔Final Billing Family Reference columns + backfill. */
function migrateBillingTrailSchema() {
  const engCols = db.prepare('PRAGMA table_info(energy_data)').all().map((c) => c.name);
  if (!engCols.includes('billing_family_ref')) {
    db.exec(`ALTER TABLE energy_data ADD COLUMN billing_family_ref TEXT`);
  }
  if (!engCols.includes('supersedes_energy_id')) {
    db.exec(`ALTER TABLE energy_data ADD COLUMN supersedes_energy_id TEXT`);
  }

  const invCols = db.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name);
  if (!invCols.includes('billing_family_ref')) {
    db.exec(`ALTER TABLE invoices ADD COLUMN billing_family_ref TEXT`);
  }
  if (!invCols.includes('energy_data_id')) {
    db.exec(`ALTER TABLE invoices ADD COLUMN energy_data_id TEXT`);
  }

  // Backfill BFR on energy rows missing it (PPA energy → S2S)
  const energyMissing = db.prepare(`
    SELECT ed.id, ed.period_month, c.contract_no
    FROM energy_data ed
    JOIN contracts c ON c.id = ed.contract_id
    WHERE ed.billing_family_ref IS NULL OR ed.billing_family_ref = ''
  `).all();
  const updEng = db.prepare(`UPDATE energy_data SET billing_family_ref = ? WHERE id = ?`);
  for (const row of energyMissing) {
    const safe = String(row.contract_no || 'UNKNOWN').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase() || 'UNKNOWN';
    updEng.run(`BFR/${safe}/${row.period_month}/S2S`, row.id);
  }

  // Link FINAL energy → provisional (same contract+period) when supersedes missing
  const finals = db.prepare(`
    SELECT id, contract_id, period_month FROM energy_data
    WHERE data_type = 'FINAL' AND (supersedes_energy_id IS NULL OR supersedes_energy_id = '')
  `).all();
  const findProv = db.prepare(`
    SELECT id FROM energy_data
    WHERE contract_id = ? AND period_month = ? AND data_type = 'PROVISIONAL'
    ORDER BY created_at ASC LIMIT 1
  `);
  const updSup = db.prepare(`UPDATE energy_data SET supersedes_energy_id = ? WHERE id = ?`);
  for (const f of finals) {
    const prov = findProv.get(f.contract_id, f.period_month);
    if (prov) updSup.run(prov.id, f.id);
  }

  // Backfill invoice BFR
  const invMissing = db.prepare(`
    SELECT i.id, i.billing_period, i.direction, c.contract_no
    FROM invoices i
    JOIN contracts c ON c.id = i.contract_id
    WHERE i.billing_family_ref IS NULL OR i.billing_family_ref = ''
  `).all();
  const updInv = db.prepare(`UPDATE invoices SET billing_family_ref = ? WHERE id = ?`);
  for (const row of invMissing) {
    const safe = String(row.contract_no || 'UNKNOWN').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase() || 'UNKNOWN';
    const dir = row.direction === 'SJVN_TO_BUYER' ? 'S2B' : 'S2S';
    updInv.run(`BFR/${safe}/${row.billing_period}/${dir}`, row.id);
  }
}

try {
  migrateBillingTrailSchema();
} catch (e) {
  console.error('Billing trail migration failed:', e.message);
}

/** Ensure master-data tables exist on upgraded DBs (CREATE IF NOT EXISTS via schema already ran). */
function migrateMasterDataSchema() {
  // schema.sql already creates tables; this is a no-op safety check + soft migration for older DBs
  const needed = ['bank_master', 'system_parameters', 'document_type_master', 'lookup_master'];
  const existing = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name));
  if (needed.every((t) => existing.has(t))) return;
  // Re-exec relevant DDL from schema if any missing (schema already ran CREATE IF NOT EXISTS above)
}

try {
  migrateMasterDataSchema();
} catch (e) {
  console.error('Master data migration failed:', e.message);
}

/** Per-contract trading margin override column (₹/MWh) + invoices.rebate column. */
function migrateContractMarginSchema() {
  const cols = db.prepare('PRAGMA table_info(contracts)').all().map((c) => c.name);
  if (!cols.includes('trading_margin_per_mwh')) {
    db.exec(`ALTER TABLE contracts ADD COLUMN trading_margin_per_mwh REAL`);
  }
  const invCols = db.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name);
  if (!invCols.includes('rebate')) {
    db.exec(`ALTER TABLE invoices ADD COLUMN rebate REAL NOT NULL DEFAULT 0`);
  }
}

try {
  migrateContractMarginSchema();
} catch (e) {
  console.error('Contract margin migration failed:', e.message);
}

/** Ensure station_beta table exists on upgraded DBs. */
function migrateStationBetaSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS station_beta (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id),
      period_month TEXT NOT NULL,
      beta_value REAL NOT NULL CHECK (beta_value >= 0 AND beta_value <= 1),
      station_code TEXT,
      station_name TEXT,
      source TEXT NOT NULL DEFAULT 'NRPC',
      certified_on TEXT,
      document_id TEXT REFERENCES documents(id),
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(contract_id, period_month)
    )
  `);

  // Soft-seed NJHPS hydro + May 2026 β=1.00 on existing DBs (idempotent).
  try {
    const sellerId = 'SEL-NJHPS';
    const existingSeller = db.prepare(`SELECT id FROM entities WHERE id = ?`).get(sellerId)
      || db.prepare(`SELECT id FROM entities WHERE name LIKE '%Nathpa Jhakri%'`).get();
    let sid = existingSeller?.id;
    if (!sid) {
      sid = sellerId;
      db.prepare(`
        INSERT INTO entities (
          id, entity_type, category, name, pan_no, gst_no, capacity_mw, technology,
          contracted_capacity_mw, bank_name, account_no, ifsc_code, branch_address,
          is_penny_drop_verified, status, address, corporate_email
        ) VALUES (
          ?, 'SELLER', 'RE Generator', 'SJVN Nathpa Jhakri HEP', 'AABCS1234D', '02AABCS1234D1Z5',
          1500, 'Hydro', 1500, 'SBI', '112233445566', 'SBIN0001234', 'Shimla',
          1, 'APPROVED', 'Jhakri, Himachal Pradesh', 'billing@sjvn.nic.in'
        )
      `).run(sid);
    }

    const cid = 'CON-NJHPS-001';
    db.prepare(`
      INSERT OR IGNORE INTO contracts (
        id, contract_no, contract_type, seller_id, project_type, capacity_mw, commissioned_capacity_mw,
        cod_date, tariff_type, tariff_per_unit, tenure_start, tenure_end, billing_cycle, payment_terms, status,
        normative_aux, free_energy_home_state, capacity_charges_total
      ) VALUES (
        ?, 'PPA/SJVN/NJHPS/001', 'PPA', ?, 'Hydro', 1500, 1500,
        '2004-05-06', 'TWO_PART', 1.25, '2004-05-06', '2039-05-05', 'MONTHLY', 'Net 45 days', 'ACTIVE',
        1.2, 12, 85000000
      )
    `).run(cid, sid);

    const con = db.prepare(`SELECT id FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
    if (con) {
      db.prepare(`
        UPDATE contracts SET normative_aux = COALESCE(normative_aux, 1.2),
          free_energy_home_state = COALESCE(free_energy_home_state, 12),
          capacity_charges_total = COALESCE(capacity_charges_total, 85000000)
        WHERE id = ?
      `).run(con.id);

      const hasBeta = db.prepare(`
        SELECT id FROM station_beta WHERE contract_id = ? AND period_month = '2026-05'
      `).get(con.id);
      if (!hasBeta) {
        db.prepare(`
          INSERT INTO station_beta (
            id, contract_id, period_month, beta_value, station_code, station_name,
            source, certified_on, notes, created_by
          ) VALUES (?, ?, '2026-05', 1.00, 'NJHPS', 'NATHPA JHAKRI', 'NRPC', '2026-06-19',
            'NRPC Average Monthly Frequency Response Performance – May 2026', 'SYSTEM')
        `).run('BETA-NJHPS-2026-05', con.id);
      }
    }

    // Seed Rampur HEP (412 MW) entity + PPA for NRPC REA & CERC multi-station billing
    const rhpsSellerId = 'SEL-RHPS';
    const existingRhpsSeller = db.prepare(`SELECT id FROM entities WHERE id = ?`).get(rhpsSellerId)
      || db.prepare(`SELECT id FROM entities WHERE name LIKE '%Rampur%'`).get();
    let rhpsSid = existingRhpsSeller?.id;
    if (!rhpsSid) {
      rhpsSid = rhpsSellerId;
      db.prepare(`
        INSERT INTO entities (
          id, entity_type, category, name, pan_no, gst_no, capacity_mw, technology,
          contracted_capacity_mw, bank_name, account_no, ifsc_code, branch_address,
          is_penny_drop_verified, status, address, corporate_email
        ) VALUES (
          ?, 'SELLER', 'RE Generator', 'SJVN Rampur HEP', 'AABCS1234E', '02AABCS1234D1Z6',
          412, 'Hydro', 412, 'SBI', '112233445577', 'SBIN0001234', 'Shimla',
          1, 'APPROVED', 'Rampur Bushahr, Himachal Pradesh', 'rampur.billing@sjvn.nic.in'
        )
      `).run(rhpsSid);
    }

    const rhpsCid = 'CON-RHPS-001';
    db.prepare(`
      INSERT OR IGNORE INTO contracts (
        id, contract_no, contract_type, seller_id, project_type, capacity_mw, commissioned_capacity_mw,
        cod_date, tariff_type, tariff_per_unit, tenure_start, tenure_end, billing_cycle, payment_terms, status,
        normative_aux, free_energy_home_state, capacity_charges_total, annual_afc, annual_design_energy_mwh, napaf_percent
      ) VALUES (
        ?, 'PPA/SJVN/RHPS/001', 'PPA', ?, 'Hydro', 412, 412,
        '2014-05-13', 'TWO_PART', 1.85, '2014-05-13', '2049-05-12', 'MONTHLY', 'Net 45 days', 'ACTIVE',
        1.2, 12, 36000000, 4320000000, 1878000, 85
      )
    `).run(rhpsCid, rhpsSid);
  } catch (e) {
    console.warn('NJHPS/RHPS beta demo seed skipped:', e.message);
  }
}

try {
  migrateStationBetaSchema();
} catch (e) {
  console.error('Station beta migration failed:', e.message);
}

/** Stakeholder regulatory approval checklist table + backfill for existing entities. */
function migrateRegulatoryApprovalsSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_regulatory_approvals (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL REFERENCES entities(id),
      approval_code TEXT NOT NULL,
      label TEXT NOT NULL,
      is_mandatory INTEGER NOT NULL DEFAULT 1,
      applies_to TEXT NOT NULL DEFAULT 'BOTH',
      doc_type TEXT,
      status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN (
        'NOT_STARTED','NOT_APPLICABLE','SUBMITTED','VERIFIED','EXPIRED','REJECTED'
      )),
      reference_no TEXT,
      issued_by TEXT,
      issued_on TEXT,
      valid_until TEXT,
      notes TEXT,
      document_id TEXT,
      verified_by TEXT,
      verified_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(entity_id, approval_code)
    )
  `);

  const entities = db.prepare('SELECT id, entity_type FROM entities').all();
  const ins = db.prepare(`
    INSERT OR IGNORE INTO entity_regulatory_approvals (
      id, entity_id, approval_code, label, is_mandatory, applies_to, doc_type, status, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NOT_STARTED', ?)
  `);
  const updSummary = db.prepare('UPDATE entities SET regulatory_approvals = ? WHERE id = ?');
  for (const e of entities) {
    const catalog = catalogForEntityType(e.entity_type);
    for (const item of catalog) {
      ins.run(localId('REG'), e.id, item.code, item.label, item.is_mandatory ? 1 : 0, item.applies_to, item.doc_type, item.sort_order);
    }
    const rows = db.prepare('SELECT * FROM entity_regulatory_approvals WHERE entity_id = ?').all(e.id);
    updSummary.run(summarizeApprovals(rows).summary_text, e.id);
  }
}

try {
  migrateRegulatoryApprovalsSchema();
} catch (e) {
  console.error('Regulatory approvals migration failed:', e.message);
}

/** CERC hydro params: annual AFC, design energy, NAPAF, transmission ₹/MWh. */
function migrateCercHydroContractSchema() {
  const cols = db.prepare('PRAGMA table_info(contracts)').all().map((c) => c.name);
  const add = (name, sql) => {
    if (!cols.includes(name)) db.exec(sql);
  };
  add('annual_afc', 'ALTER TABLE contracts ADD COLUMN annual_afc REAL');
  add('annual_design_energy_mwh', 'ALTER TABLE contracts ADD COLUMN annual_design_energy_mwh REAL');
  add('napaf_percent', 'ALTER TABLE contracts ADD COLUMN napaf_percent REAL');
  add('transmission_charge_per_mwh', 'ALTER TABLE contracts ADD COLUMN transmission_charge_per_mwh REAL');

  // Soft-upgrade NJHPS demo contract to real CERC parameters (idempotent).
  const njhps = db.prepare(`SELECT id FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  if (njhps) {
    db.prepare(`
      UPDATE contracts SET
        annual_afc = COALESCE(annual_afc, 14615741000),
        annual_design_energy_mwh = COALESCE(annual_design_energy_mwh, 6612000),
        napaf_percent = COALESCE(napaf_percent, 87),
        normative_aux = COALESCE(normative_aux, 1.2),
        free_energy_home_state = COALESCE(free_energy_home_state, 12),
        capacity_charges_total = COALESCE(capacity_charges_total, ROUND(14615741000.0 / 12)),
        tariff_type = 'TWO_PART'
      WHERE id = ?
    `).run(njhps.id);
  }
}

try {
  migrateCercHydroContractSchema();
} catch (e) {
  console.error('CERC hydro contract migration failed:', e.message);
}

function migrateInvoiceDeliveriesSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_deliveries (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      channel TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS','PORTAL')),
      recipient TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('SENT','FAILED','SIMULATED')),
      mode TEXT,
      detail_json TEXT,
      sent_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

try {
  migrateInvoiceDeliveriesSchema();
} catch (e) {
  console.error('Invoice deliveries migration failed:', e.message);
}

/** DSM → invoice wire: link deviation_settlements to REIA invoices. */
function migrateDsmInvoiceLink() {
  const cols = db.prepare('PRAGMA table_info(deviation_settlements)').all().map((c) => c.name);
  const add = (name, sql) => {
    if (!cols.includes(name)) db.exec(sql);
  };
  add('invoice_id', 'ALTER TABLE deviation_settlements ADD COLUMN invoice_id TEXT');
}

try {
  migrateDsmInvoiceLink();
} catch (e) {
  console.error('DSM invoice link migration failed:', e.message);
}

/** Contractual min CUF % for Solar/Wind/Hybrid performance penalty. */
function migrateMinCufContractSchema() {
  const cols = db.prepare('PRAGMA table_info(contracts)').all().map((c) => c.name);
  if (!cols.includes('min_cuf_percent')) {
    db.exec('ALTER TABLE contracts ADD COLUMN min_cuf_percent REAL');
  }
  // Soft-set demo solar PPA to 22% if blank (matches seeded energy CUF story).
  const solar = db.prepare(`SELECT id FROM contracts WHERE contract_no = 'PPA/SJVN/2024/001'`).get();
  if (solar) {
    db.prepare(`
      UPDATE contracts SET min_cuf_percent = COALESCE(min_cuf_percent, 22)
      WHERE id = ?
    `).run(solar.id);
  }
}

try {
  migrateMinCufContractSchema();
} catch (e) {
  console.error('Min CUF contract migration failed:', e.message);
}

/** Cancel + seller-invoice validation columns on invoices. */
function migrateInvoiceCancelAndValidationSchema() {
  const cols = db.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name);
  const add = (name, sql) => {
    if (!cols.includes(name)) db.exec(sql);
  };
  add('cancel_reason', 'ALTER TABLE invoices ADD COLUMN cancel_reason TEXT');
  add('cancelled_at', 'ALTER TABLE invoices ADD COLUMN cancelled_at TEXT');
  add('cancelled_by', 'ALTER TABLE invoices ADD COLUMN cancelled_by TEXT');
  add('validation_status', 'ALTER TABLE invoices ADD COLUMN validation_status TEXT');
  add('validation_json', 'ALTER TABLE invoices ADD COLUMN validation_json TEXT');
  add('validated_at', 'ALTER TABLE invoices ADD COLUMN validated_at TEXT');
  add('validated_by', 'ALTER TABLE invoices ADD COLUMN validated_by TEXT');
  // Structured technical + commercial verification checklist (REIA Dashboard).
  add('verification_status', 'ALTER TABLE invoices ADD COLUMN verification_status TEXT');
  add('verification_json', 'ALTER TABLE invoices ADD COLUMN verification_json TEXT');
  add('verified_at', 'ALTER TABLE invoices ADD COLUMN verified_at TEXT');
  add('verified_by', 'ALTER TABLE invoices ADD COLUMN verified_by TEXT');
}

try {
  migrateInvoiceCancelAndValidationSchema();
} catch (e) {
  console.error('Invoice cancel/validation migration failed:', e.message);
}

/** Market Rates & Analytics: per-exchange rate detail + event/factor context tables. */
function migrateMarketAnalyticsSchema() {
  const cols = db.prepare('PRAGMA table_info(market_rates)').all().map((c) => c.name);
  const add = (name, sql) => {
    if (!cols.includes(name)) db.exec(sql);
  };
  add('exchange', 'ALTER TABLE market_rates ADD COLUMN exchange TEXT');
  add('volume_mw', 'ALTER TABLE market_rates ADD COLUMN volume_mw REAL');
  add('min_rate', 'ALTER TABLE market_rates ADD COLUMN min_rate REAL');
  add('max_rate', 'ALTER TABLE market_rates ADD COLUMN max_rate REAL');
  add('avg_rate', 'ALTER TABLE market_rates ADD COLUMN avg_rate REAL');
  add('time_block', 'ALTER TABLE market_rates ADD COLUMN time_block TEXT');
  add('data_source', 'ALTER TABLE market_rates ADD COLUMN data_source TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_market_rates_lookup ON market_rates (rate_date, exchange, product);

    CREATE TABLE IF NOT EXISTS market_events (
      id TEXT PRIMARY KEY,
      event_date TEXT NOT NULL,
      event_type TEXT NOT NULL,
      description TEXT,
      impact_level TEXT NOT NULL DEFAULT 'LOW' CHECK (impact_level IN ('HIGH','MEDIUM','LOW')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS market_factors (
      id TEXT PRIMARY KEY,
      factor_date TEXT NOT NULL,
      weather_index REAL,
      renewable_forecast_mw REAL,
      coal_price_index REAL,
      demand_forecast_mw REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Pre-existing rows predate the exchange split — treat them as IEX daily.
  db.exec(`
    UPDATE market_rates SET exchange = 'IEX' WHERE exchange IS NULL;
    UPDATE market_rates SET time_block = 'DAILY' WHERE time_block IS NULL;
  `);
}

try {
  migrateMarketAnalyticsSchema();
} catch (e) {
  console.error('Market analytics migration failed:', e.message);
}

/** NOAR wallet: link Open Access charges to the bilateral deal / client they belong to. */
function migrateNoarWalletSchema() {
  const cols = db.prepare('PRAGMA table_info(noar_wallet_txns)').all().map((c) => c.name);
  const add = (name, sql) => {
    if (!cols.includes(name)) db.exec(sql);
  };
  add('bilateral_id', 'ALTER TABLE noar_wallet_txns ADD COLUMN bilateral_id TEXT');
  add('client_id', 'ALTER TABLE noar_wallet_txns ADD COLUMN client_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_noar_txn_date ON noar_wallet_txns (txn_date, created_at)');
}

try {
  migrateNoarWalletSchema();
} catch (e) {
  console.error('NOAR wallet migration failed:', e.message);
}

/** CERC Form-IV: transaction-wise lines + header roll-up and filing deadline. */
function migrateFormIvSchema() {
  const cols = db.prepare('PRAGMA table_info(cerc_form_iv)').all().map((c) => c.name);
  const add = (name, sql) => {
    if (!cols.includes(name)) db.exec(sql);
  };
  add('total_purchase_cost', 'ALTER TABLE cerc_form_iv ADD COLUMN total_purchase_cost REAL NOT NULL DEFAULT 0');
  add('avg_margin_per_unit', 'ALTER TABLE cerc_form_iv ADD COLUMN avg_margin_per_unit REAL NOT NULL DEFAULT 0');
  add('line_count', 'ALTER TABLE cerc_form_iv ADD COLUMN line_count INTEGER NOT NULL DEFAULT 0');
  add('breach_count', 'ALTER TABLE cerc_form_iv ADD COLUMN breach_count INTEGER NOT NULL DEFAULT 0');
  add('due_date', 'ALTER TABLE cerc_form_iv ADD COLUMN due_date TEXT');
  add('generated_at', 'ALTER TABLE cerc_form_iv ADD COLUMN generated_at TEXT');
  add('submitted_by', 'ALTER TABLE cerc_form_iv ADD COLUMN submitted_by TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS cerc_form_iv_lines (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL REFERENCES cerc_form_iv(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'BILATERAL' CHECK (source IN ('BILATERAL','EXCHANGE','MANUAL')),
      bilateral_id TEXT,
      seller_name TEXT NOT NULL,
      buyer_name TEXT NOT NULL,
      contract_ref TEXT,
      period_from TEXT NOT NULL,
      period_to TEXT NOT NULL,
      quantum_mu REAL NOT NULL DEFAULT 0,
      purchase_rate REAL NOT NULL DEFAULT 0,
      sale_rate REAL NOT NULL DEFAULT 0,
      trading_margin_per_unit REAL NOT NULL DEFAULT 0,
      margin_cap REAL,
      compliance_status TEXT NOT NULL DEFAULT 'COMPLIANT'
        CHECK (compliance_status IN ('COMPLIANT','BREACH','EXEMPT')),
      exempt_reason TEXT,
      remarks TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_form_iv_lines_form ON cerc_form_iv_lines (form_id, line_no);
  `);

  // Trading margin can only be derived once both legs of the trade are known;
  // the table originally stored only the sale-side tariff.
  const btCols = db.prepare('PRAGMA table_info(bilateral_transactions)').all().map((c) => c.name);
  if (!btCols.includes('purchase_rate_per_unit')) {
    db.exec('ALTER TABLE bilateral_transactions ADD COLUMN purchase_rate_per_unit REAL');
  }
}

try {
  migrateFormIvSchema();
} catch (e) {
  console.error('Form-IV migration failed:', e.message);
}

/** REC: per-tranche disposals + issuance provenance on the lot. */
function migrateRecSchema() {
  const cols = db.prepare('PRAGMA table_info(rec_ledger)').all().map((c) => c.name);
  const add = (name, sql) => {
    if (!cols.includes(name)) db.exec(sql);
  };
  add('energy_mwh', 'ALTER TABLE rec_ledger ADD COLUMN energy_mwh REAL');
  add('technology', 'ALTER TABLE rec_ledger ADD COLUMN technology TEXT');
  add('certificate_multiplier', 'ALTER TABLE rec_ledger ADD COLUMN certificate_multiplier REAL NOT NULL DEFAULT 1');
  add('contract_id', 'ALTER TABLE rec_ledger ADD COLUMN contract_id TEXT');
  add('registry_ref', 'ALTER TABLE rec_ledger ADD COLUMN registry_ref TEXT');
  add('sold_qty', 'ALTER TABLE rec_ledger ADD COLUMN sold_qty INTEGER NOT NULL DEFAULT 0');
  add('redeemed_qty', 'ALTER TABLE rec_ledger ADD COLUMN redeemed_qty INTEGER NOT NULL DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS rec_transactions (
      id TEXT PRIMARY KEY,
      lot_id TEXT NOT NULL REFERENCES rec_ledger(id),
      txn_no TEXT UNIQUE NOT NULL,
      txn_type TEXT NOT NULL CHECK (txn_type IN ('SALE','REDEMPTION')),
      quantity INTEGER NOT NULL,
      rate_per_rec REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      trade_date TEXT NOT NULL,
      platform TEXT,
      buyer TEXT,
      obligated_entity TEXT,
      reference TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_rec_txn_lot ON rec_transactions (lot_id, trade_date);
  `);

  // Lots created before the tranche ledger carried the whole sale on the lot
  // row. Fold that into a transaction so realised revenue has one source.
  const legacy = db.prepare(`
    SELECT * FROM rec_ledger
    WHERE sale_amount > 0 AND sold_qty = 0
      AND id NOT IN (SELECT lot_id FROM rec_transactions)
  `).all();
  for (const lot of legacy) {
    db.prepare(`
      INSERT INTO rec_transactions (id, lot_id, txn_no, txn_type, quantity, rate_per_rec, amount,
        trade_date, platform, buyer, reference, created_by)
      VALUES (?, ?, ?, 'SALE', ?, ?, ?, ?, ?, ?, 'Migrated from lot sale fields', ?)
    `).run(
      `RECTXN-MIG-${lot.id}`, lot.id, `RECT/MIG/${lot.id}`, lot.quantity,
      lot.sale_rate_per_rec, lot.sale_amount,
      lot.trade_date || lot.issuance_date || lot.vintage_month + '-01',
      lot.trade_platform, lot.buyer, lot.created_by,
    );
    db.prepare('UPDATE rec_ledger SET sold_qty = ? WHERE id = ?').run(lot.quantity, lot.id);
  }
}

try {
  migrateRecSchema();
} catch (e) {
  console.error('REC migration failed:', e.message);
}

/**
 * Generator billing: record how the Energy Charge Rate was arrived at, and stop
 * the same station-month being billed twice.
 *
 * ECR used to be free-typed with no tie back to AFC, so a bill could recover the
 * capacity half of AFC and an unrelated energy amount. design_energy_mu lets the
 * rate be derived instead, and ecr_source records which path a bill took.
 */
function migrateGeneratorBillingSchema() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (!tables.includes('generator_bills')) return;

  const cols = db.prepare('PRAGMA table_info(generator_bills)').all().map((c) => c.name);
  if (!cols.includes('design_energy_mu')) {
    db.exec(`
      ALTER TABLE generator_bills ADD COLUMN design_energy_mu REAL;
      ALTER TABLE generator_bills ADD COLUMN ecr_source TEXT NOT NULL DEFAULT 'MANUAL';
    `);
  }

  // One bill per station + beneficiary + month. Existing duplicates would make
  // the index fail, so report them and leave the data alone rather than losing a
  // bill to a migration.
  const dupes = db.prepare(`
    SELECT station_name, beneficiary_id, billing_month, COUNT(*) AS n
    FROM generator_bills
    GROUP BY station_name, beneficiary_id, billing_month
    HAVING n > 1
  `).all();
  if (dupes.length) {
    console.warn(`[GEN-BILL] ${dupes.length} duplicate station-month bill(s) present; unique index not created. Resolve them, then restart.`);
    return;
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_generator_bills_station_month
      ON generator_bills (station_name, beneficiary_id, billing_month);
  `);
}

try {
  migrateGeneratorBillingSchema();
} catch (e) {
  console.error('Generator billing migration failed:', e.message);
}

/**
 * TDS withholding on trading invoices. Energy sales attract Section 194Q (0.1%
 * of gross value); open-access / transmission charges attract 194C (10%). These
 * columns let the desk record the deduction on the invoice itself so the buyer's
 * net remittance and the desk's TDS liability both reconcile against the ISET
 * ledger. Added column-by-column so a partial upgrade still completes.
 */
function migrateTradingInvoiceTds() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (!tables.includes('trading_invoices')) return;
  const addColumn = (name, ddl) => {
    const cols = db.prepare(`PRAGMA table_info(trading_invoices)`).all().map((c) => c.name);
    if (!cols.includes(name)) db.exec(`ALTER TABLE trading_invoices ADD COLUMN ${name} ${ddl};`);
  };
  addColumn('tds_section', `TEXT NOT NULL DEFAULT 'NONE'`);
  addColumn('tds_rate', `REAL NOT NULL DEFAULT 0`);
  addColumn('tds_amount', `REAL NOT NULL DEFAULT 0`);
  addColumn('net_payable', `REAL`);
  // Back-fill net_payable for rows that predate the column: with no TDS recorded,
  // the buyer remits the full invoice, so net_payable = total_amount.
  db.exec(`UPDATE trading_invoices SET net_payable = total_amount WHERE net_payable IS NULL;`);
}

try {
  migrateTradingInvoiceTds();
} catch (e) {
  console.error('Trading invoice TDS migration failed:', e.message);
}

/**
 * Make trading_invoices a union of the two invoice shapes it actually stores:
 * the bilateral energy bill and the trading-desk settlement bill (EXCHANGE /
 * BILATERAL, with fee legs). The settlement endpoint inserted trade_date,
 * exchange_fee, etc. and an 'EXCHANGE' kind that the original CHECK and column
 * set rejected, so it failed on every call. SQLite can't ALTER a CHECK, so the
 * table is rebuilt from schema.sql (which now carries the wider CHECK, the fee
 * columns, and a nullable rate_per_unit).
 */
function migrateTradingInvoiceSettlementModel() {
  const ti = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='trading_invoices'").get();
  const needsWiden = ti && !ti.sql.includes("'EXCHANGE'");
  const broken = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%trading_invoices_old%'").all();
  if (!needsWiden && broken.length === 0) return; // already migrated / fresh DB

  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('PRAGMA legacy_alter_table=ON'); // keep RENAME from rewriting other tables' FKs (e.g. trading_payments)
  try {
    if (needsWiden) rebuildTableFromSchema('trading_invoices');
    for (const t of broken) rebuildTableFromSchema(t.name); // repair any FK left pointing at _old
  } finally {
    db.exec('PRAGMA legacy_alter_table=OFF');
    db.exec('PRAGMA foreign_keys=ON');
  }
}

try {
  migrateTradingInvoiceSettlementModel();
} catch (e) {
  console.error('Trading invoice settlement-model migration failed:', e.message);
}

/**
 * The day-wise schedule is contract-wide rather than per buyer, so the seller is
 * recorded on the row itself instead of being reached through a bilateral link.
 * Adds that column to databases created before it existed.
 */
function migrateEntityShortCode() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (!tables.includes('entities')) return;
  const cols = db.prepare(`PRAGMA table_info(entities)`).all().map((c) => c.name);
  if (!cols.includes('short_code')) db.exec('ALTER TABLE entities ADD COLUMN short_code TEXT;');
}

/**
 * Correct the security waterfall order. It was seeded with pooled funds ahead of
 * dedicated instruments, so a buyer's default drew down the shared corpus before
 * that buyer's own letter of credit — spending cover that protects every other
 * contract. Rows still on the old defaults are moved to the new ones; anything
 * deliberately set to something else is left alone.
 */
function migrateWaterfallPriority() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (!tables.includes('payment_security')) return;
  const OLD = { CORPUS_FUND: 10, PAYMENT_SECURITY_FUND: 20, LC: 30, BANK_GUARANTEE: 40 };
  const NEW = { LC: 10, BANK_GUARANTEE: 20, PAYMENT_SECURITY_FUND: 30, CORPUS_FUND: 40 };
  const stmt = db.prepare('UPDATE payment_security SET waterfall_priority = ? WHERE mechanism_type = ? AND waterfall_priority = ?');
  for (const [type, oldValue] of Object.entries(OLD)) stmt.run(NEW[type], type, oldValue);
}

try {
  migrateWaterfallPriority();
} catch (e) {
  console.error('Waterfall priority migration failed:', e.message);
}

try {
  migrateEntityShortCode();
} catch (e) {
  console.error('Entity short-code migration failed:', e.message);
}

function migrateScheduleDeviationCounterparty() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (!tables.includes('schedule_deviations')) return;
  const cols = db.prepare(`PRAGMA table_info(schedule_deviations)`).all().map((c) => c.name);
  if (!cols.includes('counterparty')) db.exec('ALTER TABLE schedule_deviations ADD COLUMN counterparty TEXT;');
  if (!cols.includes('alerted_at')) db.exec('ALTER TABLE schedule_deviations ADD COLUMN alerted_at TEXT;');
}

try {
  migrateScheduleDeviationCounterparty();
} catch (e) {
  console.error('Schedule deviation counterparty migration failed:', e.message);
}

/**
 * SLDC Standing Clearance (Open Access NOC) parameters, per trading client.
 *
 * These drive the bid compliance checks for clauses 21-24 and 26 of the HP SLDC
 * standing clearance. They were hard-coded in the bidding screen against one
 * asset (Naitwar Mori HPS), which meant every client was validated against that
 * one plant's 24 MW ceiling and one plant's expiry date.
 *
 * noc_valid_till already existed on this table and stays the expiry field.
 * Generator status is read from client_type rather than duplicated here.
 *
 * Renewals overwrite the row; there is no clearance history yet. If SJVN needs
 * to show which clearance a past trade was executed under, this becomes its own
 * table with a validity range per row.
 */
function migrateStandingClearanceSchema() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (!tables.includes('trading_clients')) return;

  // Added column by column rather than behind a single sentinel, so a later
  // addition still lands on a database that already took the earlier ones.
  const addColumn = (table, name, ddl) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl};`);
  };

  addColumn('trading_clients', 'sldc_name', 'TEXT');
  addColumn('trading_clients', 'standing_clearance_no', 'TEXT');
  addColumn('trading_clients', 'noar_id', 'TEXT');
  addColumn('trading_clients', 'tgna_approved_mw', 'REAL');
  addColumn('trading_clients', 'max_ramp_rate_mw_per_min', 'REAL');
  addColumn('trading_clients', 'periphery_loss_percent', 'REAL');
  addColumn('trading_clients', 'operating_charge_per_day', 'REAL');
  addColumn('trading_clients', 'regional_tx_charge_per_mw_block', 'REAL');
  addColumn('trading_clients', 'state_tx_charge_per_mwh', 'REAL');
  addColumn('trading_clients', 'clearance_approver', 'TEXT');
  addColumn('trading_clients', 'clearance_approver_designation', 'TEXT');

  // The bidding screen has always asked whether a bid is quoted EX-BUS (plant
  // terminal) or at the regional periphery, but never stored the answer. The
  // T-GNA check needs it, so persist it on the bid.
  addColumn('bids', 'bid_on', "TEXT NOT NULL DEFAULT 'EX-BUS'");
}

try {
  migrateStandingClearanceSchema();
} catch (e) {
  console.error('Standing clearance migration failed:', e.message);
}

/**
 * Working-day calendar: weekly offs plus national and state holidays.
 *
 * Payment due dates and late-payment surcharge both have to respect the paying
 * party's non-working days — a bill cannot fall due on a day the counterparty's
 * office is shut, and surcharge should not accrue for it either. Each state
 * keeps its own list, so holidays carry a scope.
 *
 * SJVN publishes these to beneficiaries, so the table is the source for both
 * the calculation and the notice that goes out.
 */
function migrateWorkingCalendarSchema() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);

  const addColumn = (table, name, ddl) => {
    if (!tables.includes(table)) return;
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl};`);
  };

  // Which state's calendar applies to this counterparty. Null means the
  // national list only — no state holidays are assumed for an entity whose
  // state was never captured.
  addColumn('entities', 'state', 'TEXT');
  addColumn('trading_clients', 'state', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS holidays (
      id TEXT PRIMARY KEY,
      holiday_date TEXT NOT NULL,
      name TEXT NOT NULL,
      -- NATIONAL applies to everyone; STATE only to the named state.
      scope TEXT NOT NULL DEFAULT 'NATIONAL' CHECK (scope IN ('NATIONAL','STATE')),
      state TEXT,
      holiday_type TEXT NOT NULL DEFAULT 'PUBLIC'
        CHECK (holiday_type IN ('PUBLIC','RESTRICTED','BANK','LOCAL')),
      remarks TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One entry per date per scope. A national and a state holiday can share a
    -- date; two identical state entries cannot.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_date_scope
      ON holidays (holiday_date, scope, COALESCE(state, ''));

    CREATE INDEX IF NOT EXISTS idx_holidays_lookup
      ON holidays (holiday_date, is_active);
  `);
}

try {
  migrateWorkingCalendarSchema();
} catch (e) {
  console.error('Working calendar migration failed:', e.message);
}

/**
 * Trading-side debit and credit notes.
 *
 * When a promised schedule cannot be met from own generation, the shortfall is
 * bought on the exchange and the broker raises a manual invoice for it. That
 * amount shows on the obligation report but not on the weekly payment report,
 * so the two never reconcile on their own — the note is what carries the
 * difference into settlement.
 *
 * Sign convention follows the REIA notes already in the platform: the amount is
 * always positive and note_type carries the direction. A shortfall bought dear
 * is a DEBIT (more payable); power returned or delivered short later is a
 * CREDIT (less payable).
 *
 * trading_invoice_id is optional on purpose. The broker's invoice is raised
 * outside this platform, so a note often exists before — or without — any
 * matching row of ours.
 */
function migrateTradingNotesSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trading_debit_credit_notes (
      id TEXT PRIMARY KEY,
      note_no TEXT UNIQUE NOT NULL,
      note_type TEXT NOT NULL CHECK (note_type IN ('DEBIT','CREDIT')),
      client_id TEXT NOT NULL REFERENCES trading_clients(id),
      trading_invoice_id TEXT REFERENCES trading_invoices(id),
      billing_period TEXT NOT NULL,
      delivery_date TEXT,
      reason_code TEXT NOT NULL DEFAULT 'SCHEDULE_SHORTFALL_PURCHASE' CHECK (reason_code IN (
        'SCHEDULE_SHORTFALL_PURCHASE',
        'SCHEDULE_EXCESS_RETURN',
        'BROKER_MANUAL_INVOICE',
        'OBLIGATION_PAYMENT_MISMATCH',
        'RATE_REVISION',
        'EXCHANGE_FEE_ADJUSTMENT',
        'DSM_ADJUSTMENT',
        'OTHER'
      )),
      quantum_mwh REAL,
      rate_per_unit REAL,
      amount REAL NOT NULL,
      broker_reference TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','SETTLED','CANCELLED')),
      issued_date TEXT,
      settled_date TEXT,
      cancelled_reason TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_trading_notes_client
      ON trading_debit_credit_notes (client_id, billing_period);
  `);
}

try {
  migrateTradingNotesSchema();
} catch (e) {
  console.error('Trading notes migration failed:', e.message);
}

/**
 * The REIA notes predate market-shortfall settlement, so their reason codes had
 * no way to describe one. SQLite cannot alter a CHECK constraint, so the table
 * is rebuilt with the wider list; existing rows carry over untouched.
 */
function migrateReiaNoteReasonCodes() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (!tables.includes('debit_credit_notes')) return;

  const ddl = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='debit_credit_notes'"
  ).get()?.sql || '';
  if (ddl.includes('SCHEDULE_SHORTFALL_PURCHASE')) return;

  db.exec('PRAGMA foreign_keys=OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE debit_credit_notes_new (
        id TEXT PRIMARY KEY,
        note_no TEXT UNIQUE NOT NULL,
        note_type TEXT NOT NULL CHECK (note_type IN ('DEBIT','CREDIT')),
        invoice_id TEXT NOT NULL REFERENCES invoices(id),
        contract_id TEXT REFERENCES contracts(id),
        period_month TEXT,
        reason_code TEXT NOT NULL DEFAULT 'REVISED_REA' CHECK (reason_code IN
          ('REVISED_REA','CHANGE_IN_LAW','TRANSMISSION_CHARGES','LPS','COMPENSATION_EVENT',
           'LIQUIDATED_DAMAGES','SCHEDULE_SHORTFALL_PURCHASE','SCHEDULE_EXCESS_RETURN','OTHER')),
        amount REAL NOT NULL,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','SETTLED','CANCELLED')),
        issued_date TEXT,
        settled_date TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO debit_credit_notes_new SELECT * FROM debit_credit_notes;
      DROP TABLE debit_credit_notes;
      ALTER TABLE debit_credit_notes_new RENAME TO debit_credit_notes;
    `);
  })();
  db.exec('PRAGMA foreign_keys=ON');
  console.log('[MIGRATE] debit_credit_notes: added market-shortfall reason codes');
}

try {
  migrateReiaNoteReasonCodes();
} catch (e) {
  console.error('REIA note reason-code migration failed:', e.message);
}

/**
 * REA Scraper fetch log table.
 */
function migrateReaFetchLogSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rea_fetch_log (
      id TEXT PRIMARY KEY,
      rpc_source TEXT NOT NULL,
      period_month TEXT NOT NULL,
      data_type TEXT NOT NULL DEFAULT 'PROVISIONAL'
        CHECK (data_type IN ('PROVISIONAL','FINAL')),
      pdf_url TEXT,
      local_file_path TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','DOWNLOADED','PARSED','PROCESSED','FAILED')),
      records_created INTEGER DEFAULT 0,
      error_message TEXT,
      document_id TEXT REFERENCES documents(id),
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_rea_fetch_log_source
      ON rea_fetch_log(rpc_source, period_month, data_type);
  `);
}

try {
  migrateReaFetchLogSchema();
} catch (e) {
  console.error('REA fetch log migration failed:', e.message);
}

try {
  db.prepare(`UPDATE contracts SET tariff_structure_json = NULL WHERE tariff_structure_json = '{}' OR tariff_structure_json = '"{}"' OR TRIM(tariff_structure_json) = ''`).run();
} catch (e) {
  // Non-fatal
}

export default db;

