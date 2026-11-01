import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { catalogForEntityType, summarizeApprovals } from '../regulatoryApprovals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// SJVN_DB_PATH lets the test suite point at a throwaway database. Without it the
// tests would run against — and mutate — the real platform.db.
//
// tests/setup.js sets that variable, but it is only loaded when vitest is run
// from backend/ where its config lives. Run from the repository root, vitest
// finds no config, skips the setup file, and every DELETE in the suite lands on
// the real database. That is not a hypothetical — it has happened, and it
// emptied 56 tables. So refuse to open the real file under a test runner rather
// than trusting the caller's working directory.
if (process.env.VITEST && !process.env.SJVN_DB_PATH) {
  throw new Error(
    'Refusing to open the real platform.db from a test run: SJVN_DB_PATH is unset, '
    + 'which means tests/setup.js did not load. Run vitest from the backend/ directory '
    + '(npm test), or set SJVN_DB_PATH to a throwaway file.',
  );
}
const dbPath = process.env.SJVN_DB_PATH || path.join(__dirname, 'platform.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// A writer holds the file for the length of its transaction. Without a busy
// timeout every reader that arrives during one throws SQLITE_BUSY immediately,
// which surfaces as a 500 on a page that would have succeeded a millisecond
// later. Five seconds is far longer than any statement here takes, so it turns
// a spurious error into a short wait. Backups and the sqlite3 CLI take the
// same lock, so this matters as soon as anything but the server touches the file.
db.pragma('busy_timeout = 5000');
// WAL's own recommendation: the write is durable at the OS level on commit, and
// only an operating-system crash (not a process crash, and not a restart) can
// lose the last transactions. FULL costs an fsync per commit for a guarantee
// that a UPS-backed server does not need.
db.pragma('synchronous = NORMAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

function localId(prefix) {
  // Same width as util.js newId, and for the same reason: eight hex characters
  // collide inside one table at a scale this platform reaches.
  return `${prefix}-${uuidv4().replace(/-/g, '').slice(0, 16)}`;
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

/** Allow RETURNED_BY_CHECKER status in payment_intimations table. */
function migratePaymentIntimationsCheck() {
  const meta = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='payment_intimations'`).get();
  if (!meta || !meta.sql || meta.sql.includes('RETURNED_BY_CHECKER')) return;
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE payment_intimations_mig (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      contract_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      amount REAL NOT NULL,
      tds_amount REAL NOT NULL DEFAULT 0,
      tds_section TEXT,
      other_deduction REAL NOT NULL DEFAULT 0,
      deduction_note TEXT,
      payment_date TEXT NOT NULL,
      confirmed_date TEXT,
      mode TEXT,
      reference TEXT NOT NULL,
      proof_version_id TEXT,
      remarks TEXT,
      exceeds_balance INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('PENDING_CHECKER','SUBMITTED','CONFIRMED','REJECTED','WITHDRAWN','RETURNED_BY_CHECKER')),
      prepared_by TEXT,
      approved_by TEXT,
      approved_at TEXT,
      decided_by TEXT,
      decided_at TEXT,
      decision_note TEXT,
      payment_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO payment_intimations_mig SELECT * FROM payment_intimations;
    DROP TABLE payment_intimations;
    ALTER TABLE payment_intimations_mig RENAME TO payment_intimations;
    CREATE INDEX IF NOT EXISTS idx_payment_intimations_invoice ON payment_intimations(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_payment_intimations_status ON payment_intimations(status);
  `);
  db.pragma('foreign_keys = ON');
}

migratePaymentIntimationsCheck();

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

// One spelling per technology. Bulk loads stored SOLAR / HYBRID and the form
// Solar / Hybrid, so the project-type filter, the CUF rules and every
// technology total split the same contracts in two.
function migrateProjectTypeCase() {
  const canonical = { SOLAR: 'Solar', WIND: 'Wind', HYBRID: 'Hybrid', FDRE: 'FDRE', PEAKPOWER: 'PeakPower', HYDRO: 'Hydro', PSP: 'PSP', STORAGE: 'Storage', BESS: 'Storage' };
  const fix = db.prepare('UPDATE contracts SET project_type = ? WHERE upper(project_type) = ? AND project_type != ?');
  for (const [upper, name] of Object.entries(canonical)) fix.run(name, upper, name);
}
migrateProjectTypeCase();

// Add the frequency-linked DSM columns to bilateral_schedules on existing DBs.
// Blocks recorded before the slab master existed keep their stored penalty and
// simply have no frequency or slab against them.
function migrateBilateralScheduleDsm() {
  const cols = db.prepare('PRAGMA table_info(bilateral_schedules)').all().map((c) => c.name);
  const add = (col, type) => {
    if (!cols.includes(col)) db.exec(`ALTER TABLE bilateral_schedules ADD COLUMN ${col} ${type}`);
  };
  add('grid_frequency_hz', 'REAL');
  add('dsm_slab_id', 'TEXT');
  add('dsm_rate_paise_per_kwh', 'REAL');
  add('dsm_basis', 'TEXT');
}
migrateBilateralScheduleDsm();

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

// Add the 35+ detailed form fields and order details table for the Bilateral UI
function migrateBilateralDetailedForm() {
  const cols = db.prepare('PRAGMA table_info(bilateral_transactions)').all().map(c => c.name);
  if (!cols.includes('contract_type')) {
    const fields = [
      "contract_type TEXT DEFAULT 'Bilateral'", "transaction_type TEXT", "loa_no TEXT", "ppa_no TEXT",
      "type_of_contract TEXT", "product TEXT", "supplier_name TEXT", "supplier_id TEXT", "supplier_sldc TEXT",
      "supplier_region TEXT", "injecting_point TEXT", "procurer_name TEXT", "procurer_id TEXT", "procurer_sldc TEXT",
      "procurer_region TEXT", "drawal_point TEXT", "route TEXT", "alternate_route TEXT", "is_renewable TEXT DEFAULT 'Yes'",
      "billing_type TEXT", "remarks TEXT", "compensation REAL", "late_payment_surcharge REAL", "rebate REAL",
      'client_registration_fee REAL', 'application_fee REAL', 'ists_charges_bearer TEXT',
      'state_transmission_charges_bearer TEXT', 'distribution_wheeling_bearer TEXT', 'rldc_operating_bearer TEXT',
      'state_operating_bearer TEXT', 'dis_operating_bearer TEXT', 'noar_application_bearer TEXT', 'sldc_consent_bearer TEXT'
    ];
    for (const f of fields) {
      db.exec(`ALTER TABLE bilateral_transactions ADD COLUMN ${f}`);
    }
    
    // Also recreate the table to drop the NOT NULL constraint on client_id safely
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('PRAGMA legacy_alter_table=ON');
    try {
      rebuildTableFromSchema('bilateral_transactions');
    } finally {
      db.exec('PRAGMA legacy_alter_table=OFF');
      db.exec('PRAGMA foreign_keys=ON');
    }
  }

  // Ensure the order details table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS bilateral_order_details (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL REFERENCES bilateral_transactions(id) ON DELETE CASCADE,
      date_from TEXT,
      date_to TEXT,
      time_from TEXT,
      time_to TEXT,
      rate_type TEXT,
      rate REAL,
      quantum REAL,
      variation TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
try {
  migrateBilateralDetailedForm();
} catch (e) {
  console.error('Bilateral detailed form migration failed:', e.message);
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
  // Bids submitted before this column existed are told apart by the receipt
  // the stub hands back; anything else is left unknown rather than guessed.
  if (!cols.includes('submission_mode')) {
    db.exec('ALTER TABLE bids ADD COLUMN submission_mode TEXT');
    db.exec(`UPDATE bids SET submission_mode = 'STUB' WHERE exchange_receipt_ref LIKE 'IEX-STUB-%'`);
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

// Credit limit per trading client, and which side (BUY/SELL) a bid is on.
// The side was never stored, so the generator-buy clause could not be re-checked
// at submit and a buyer's committed funds could not be told from a seller's
// offers. Older bids keep a NULL side and are left out of the funds check.
function migrateBidFunds() {
  const clientCols = db.prepare('PRAGMA table_info(trading_clients)').all().map((c) => c.name);
  if (!clientCols.includes('credit_limit')) {
    db.exec('ALTER TABLE trading_clients ADD COLUMN credit_limit REAL NOT NULL DEFAULT 0');
  }
  const bidCols = db.prepare('PRAGMA table_info(bids)').all().map((c) => c.name);
  if (!bidCols.includes('bid_type')) {
    db.exec("ALTER TABLE bids ADD COLUMN bid_type TEXT CHECK (bid_type IN ('BUY','SELL'))");
  }
}
migrateBidFunds();

// Bank receipts that credit a client's pre-payment. A receipt is told apart by
// its UTR (one credit per UTR, however many times a statement is re-pasted),
// and the client it was applied to and when are kept on the row so a receipt
// can never be credited twice. The virtual account number is how the bank
// names the client on a receipt.
function migrateBankReceipts() {
  const txCols = db.prepare('PRAGMA table_info(bank_transactions)').all().map((c) => c.name);
  if (!txCols.includes('client_id')) db.exec('ALTER TABLE bank_transactions ADD COLUMN client_id TEXT');
  if (!txCols.includes('applied_at')) db.exec('ALTER TABLE bank_transactions ADD COLUMN applied_at TEXT');
  if (!txCols.includes('created_by')) db.exec('ALTER TABLE bank_transactions ADD COLUMN created_by TEXT');
  const clientCols = db.prepare('PRAGMA table_info(trading_clients)').all().map((c) => c.name);
  if (!clientCols.includes('virtual_account_no')) db.exec('ALTER TABLE trading_clients ADD COLUMN virtual_account_no TEXT');
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_transactions_utr ON bank_transactions (utr_no)');
  } catch (e) {
    // Existing rows already share a UTR; the endpoint still refuses repeats itself.
    console.warn('bank_transactions UTR index not created:', e.message);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_clients_van ON trading_clients (virtual_account_no) WHERE virtual_account_no IS NOT NULL');
}
migrateBankReceipts();

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
  // Which verticals a counterparty is registered under (REIA / HYDRO / THERMAL,
  // comma-separated), and the who-when-why of a blacklisting.
  if (!refreshed.includes('verticals')) {
    db.exec(`ALTER TABLE entities ADD COLUMN verticals TEXT NOT NULL DEFAULT 'REIA'`);
  }
  if (!refreshed.includes('blacklist_reason')) {
    db.exec(`
      ALTER TABLE entities ADD COLUMN blacklist_reason TEXT;
      ALTER TABLE entities ADD COLUMN blacklisted_by TEXT;
      ALTER TABLE entities ADD COLUMN blacklisted_at TEXT;
    `);
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
        '2014-05-13', 'TWO_PART', 2.425, '2014-05-13', '2049-05-12', 'MONTHLY', 'Net 45 days', 'ACTIVE',
        1.0, 13, 36000000, 7846038000, 1878080, 83
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
    CREATE TABLE IF NOT EXISTS custom_clearance_types (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      applies_to TEXT NOT NULL DEFAULT 'BOTH' CHECK (applies_to IN ('SELLER','BUYER','BOTH')),
      is_mandatory INTEGER NOT NULL DEFAULT 0,
      help TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

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
  // Rs/kWh for energy beyond the annual saleable design energy (A13 on the
  // bill). NJHPS prices it at the same rate as A12; Rampur does not, so it
  // cannot be assumed equal.
  add('ecr_excess_rate', 'ALTER TABLE contracts ADD COLUMN ecr_excess_rate REAL');
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

/**
 * Hydro station bill lifecycle columns.
 *
 * The bill table shipped computing and saving a bill; approval and the due date
 * that drives the beneficiary ledger came later, so an existing database needs
 * them added rather than recreated.
 */
/**
 * Rampur's tariff constants, from the station's own provisional bill.
 *
 * The demo seed carried placeholders for RHPS that were wrong in five places at
 * once, and every one of them moves money: the AFC was 4,320,000,000 against an
 * actual 7,846,038,000, the auxiliary consumption 1.2% against 1.0%, the NAPAF
 * 85% against 83%, the design energy 1,878,000 MWh against 1,878,080, and the
 * free energy to the home state 12% against 13%. Reading them off the August
 * 2026 bill reproduces that bill to the paisa.
 *
 * Rampur also prices energy beyond the annual design energy at 1.300 Rs/kWh
 * where the rate up to it is 2.425 — unlike NJHPS, where the two are equal — so
 * the excess rate is carried on the contract rather than assumed.
 *
 * The seed only INSERTs OR IGNOREs, so a database that already has the row
 * keeps the placeholders unless they are corrected here.
 */
function migrateRampurTariffConstants() {
  // Runs once. Filling the excess rate on every boot would put 1.300 back each
  // time the desk cleared it, so a deliberate edit could never stick.
  const MARKER = 'migration.rampur_tariff_constants';
  if (db.prepare('SELECT 1 FROM platform_meta WHERE key = ?').get(MARKER)) return;

  const row = db.prepare(
    `SELECT id, annual_afc, ecr_excess_rate FROM contracts WHERE contract_no = 'PPA/SJVN/RHPS/001'`,
  ).get();
  if (!row) return;
  // Only the known-placeholder AFC is corrected, so a desk that has since
  // entered its own figures is not overwritten.
  if (Number(row.annual_afc) === 4320000000) {
    db.prepare(`
      UPDATE contracts SET annual_afc = 7846038000, annual_design_energy_mwh = 1878080,
        normative_aux = 1.0, free_energy_home_state = 13, napaf_percent = 83,
        tariff_per_unit = 2.425, ecr_excess_rate = 1.300
      WHERE id = ?
    `).run(row.id);
  } else if (row.ecr_excess_rate == null) {
    db.prepare('UPDATE contracts SET ecr_excess_rate = 1.300 WHERE id = ?').run(row.id);
  }
  db.prepare(`INSERT INTO platform_meta (key, value) VALUES (?, '1')`).run(MARKER);
}

/**
 * Let a hydro bill also be a claim or a trading bill.
 *
 * Additional charges, tax collected at source and power trading are all billed
 * on documents of their own, which are approved, released, despatched and paid
 * exactly like a monthly tariff bill — so they are rows in the same table
 * rather than parallel ones, and bill_kind has to admit them. SQLite cannot
 * ALTER a CHECK, so the table is rebuilt from schema.sql the way invoices is.
 */
function migrateHydroBillClaimKinds() {
  const t = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='hydro_station_bills'",
  ).get();
  if (!t || t.sql.includes("'PTC'")) return;

  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('PRAGMA legacy_alter_table=ON'); // keep RENAME from touching other tables' FKs
  try {
    rebuildTableFromSchema('hydro_station_bills');
  } finally {
    db.exec('PRAGMA legacy_alter_table=OFF');
    db.exec('PRAGMA foreign_keys=ON');
  }
}

try {
  migrateHydroBillClaimKinds();
} catch (e) {
  console.error('Hydro bill claim-kind migration failed:', e.message);
}

/**
 * Admit ARREAR and SUPPLEMENTARY hydro bills. Same rebuild as above; the unique
 * index is put back by hand because the rebuild leaves the old one on the
 * renamed table, where it is dropped with it.
 */
function migrateHydroArrearKinds() {
  const t = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='hydro_station_bills'",
  ).get();
  if (!t || t.sql.includes("'ARREAR'")) return;

  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('PRAGMA legacy_alter_table=ON');
  try {
    rebuildTableFromSchema('hydro_station_bills');
    db.exec('DROP INDEX IF EXISTS idx_hydro_bill_station_month');
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hydro_bill_station_month
      ON hydro_station_bills (contract_id, billing_month, bill_kind)
      WHERE bill_kind NOT IN ('REVISION','ARREAR','SUPPLEMENTARY','TCS','PTC') AND status <> 'CANCELLED'`);
  } finally {
    db.exec('PRAGMA legacy_alter_table=OFF');
    db.exec('PRAGMA foreign_keys=ON');
  }
}

try {
  migrateHydroArrearKinds();
} catch (e) {
  console.error('Hydro arrear-kind migration failed:', e.message);
}

/**
 * TCS is claimed per beneficiary, and a station sells through PTC in several
 * trades, so a month has several bills of each; the one-live-bill-per-month
 * index refused the second with a raw constraint error (Hydro QA runs 12, 13).
 */
function migrateHydroTcsIndex() {
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_hydro_bill_station_month'").get();
  if (!idx || idx.sql.includes("'PTC'")) return;
  db.exec('DROP INDEX IF EXISTS idx_hydro_bill_station_month');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hydro_bill_station_month
    ON hydro_station_bills (contract_id, billing_month, bill_kind)
    WHERE bill_kind NOT IN ('REVISION','ARREAR','SUPPLEMENTARY','TCS','PTC') AND status <> 'CANCELLED'`);
}
try {
  migrateHydroTcsIndex();
} catch (e) {
  console.error('Hydro TCS index migration failed:', e.message);
}

// A posted month takes a further FI posting for bills issued after it, so only
// a waiting (PREPARED) posting is one per month now (Hydro QA run 14).
try {
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_hydro_fi_posting_period'").get();
  if (idx && !idx.sql.includes("= 'PREPARED'")) {
    db.exec('DROP INDEX idx_hydro_fi_posting_period');
    db.exec(`CREATE UNIQUE INDEX idx_hydro_fi_posting_period
      ON hydro_fi_postings (contract_id, period_month, bill_category) WHERE status = 'PREPARED'`);
  }
} catch (e) {
  console.error('Hydro FI posting index migration failed:', e.message);
}

/**
 * Approved debit and credit notes are handed to Finance under a NOTES category;
 * they never were, so Finance's sale stood overstated by every credit note
 * (Hydro QA run 14). The category CHECK grows by a value and a line can point
 * at a note instead of a bill, so both tables are rebuilt from schema.sql. Their
 * indexes go with the renamed copies and are put back by hand.
 */
function migrateHydroFiNotes() {
  const t = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='hydro_fi_postings'").get();
  if (!t) return;
  const lineCols = db.prepare('PRAGMA table_info(hydro_fi_posting_lines)').all().map((c) => c.name);
  const needPostings = !t.sql.includes("'NOTES'");
  const needLines = lineCols.length && !lineCols.includes('note_id');
  if (!needPostings && !needLines) return;

  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('PRAGMA legacy_alter_table=ON'); // keep RENAME from touching other tables' FKs
  try {
    db.transaction(() => {
      if (needPostings) rebuildTableFromSchema('hydro_fi_postings');
      if (needLines) rebuildTableFromSchema('hydro_fi_posting_lines');
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hydro_fi_posting_period
        ON hydro_fi_postings (contract_id, period_month, bill_category) WHERE status = 'PREPARED'`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_hydro_fi_lines_posting
        ON hydro_fi_posting_lines (posting_id)`);
    })();
  } finally {
    db.exec('PRAGMA legacy_alter_table=OFF');
    db.exec('PRAGMA foreign_keys=ON');
  }
}

try {
  migrateHydroFiNotes();
} catch (e) {
  console.error('Hydro FI notes migration failed:', e.message);
}

// CERC bills coal on its GCV as received less a storage-loss norm (85 kCal/kg);
// the tariff carries that norm so an order can change it (Thermal QA run 1).
try {
  const cols = db.prepare('PRAGMA table_info(thermal_station_tariffs)').all().map((c) => c.name);
  if (cols.length && !cols.includes('gcv_storage_loss_kcal')) {
    db.exec('ALTER TABLE thermal_station_tariffs ADD COLUMN gcv_storage_loss_kcal REAL NOT NULL DEFAULT 85');
  }
} catch (e) {
  console.error('Thermal tariff storage-loss migration failed:', e.message);
}

// A thermal bill keeps the month's fuel inputs and the norms it was computed
// on, so it can be reprinted, revised or put on an arrear without guessing.
try {
  const cols = db.prepare('PRAGMA table_info(hydro_station_bills)').all().map((c) => c.name);
  if (cols.length && !cols.includes('thermal_inputs_json')) {
    db.exec('ALTER TABLE hydro_station_bills ADD COLUMN thermal_inputs_json TEXT');
  }
} catch (e) {
  console.error('Thermal bill column migration failed:', e.message);
}

function migrateHydroBillLifecycle() {
  const has = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='hydro_station_bills'`).get();
  if (!has) return;
  const cols = db.prepare('PRAGMA table_info(hydro_station_bills)').all().map((c) => c.name);
  if (!cols.includes('approval_status')) {
    db.exec(`ALTER TABLE hydro_station_bills ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'NOT_SENT'`);
  }
  if (!cols.includes('due_date')) {
    db.exec('ALTER TABLE hydro_station_bills ADD COLUMN due_date TEXT');
  }
  const lineCols = db.prepare('PRAGMA table_info(hydro_bill_lines)').all().map((c) => c.name);
  if (!lineCols.includes('deducted_scheduled_energy_kwh')) {
    db.exec('ALTER TABLE hydro_bill_lines ADD COLUMN actual_scheduled_energy_kwh REAL NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE hydro_bill_lines ADD COLUMN deducted_scheduled_energy_kwh REAL NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE hydro_bill_lines ADD COLUMN is_regulated INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('urs_nr_kwh')) {
    db.exec('ALTER TABLE hydro_station_bills ADD COLUMN urs_nr_kwh REAL NOT NULL DEFAULT 0');
  }
  // Release, print and despatch tracking.
  if (!cols.includes('dispatch_invoice_no')) {
    for (const [c, t] of [
      ['released_at', 'TEXT'], ['released_by', 'TEXT'], ['printed_at', 'TEXT'],
      ['print_count', 'INTEGER NOT NULL DEFAULT 0'], ['dispatch_invoice_no', 'TEXT'],
      ['courier_tracking_no', 'TEXT'], ['dispatch_date', 'TEXT'], ['receipt_date', 'TEXT'],
      ['dispatched_at', 'TEXT'], ['dispatched_by', 'TEXT'],
    ]) {
      db.exec(`ALTER TABLE hydro_station_bills ADD COLUMN ${c} ${t}`);
    }
  }
  if (!cols.includes('final_approver_id')) {
    db.exec('ALTER TABLE hydro_station_bills ADD COLUMN final_approver_id TEXT');
    db.exec('ALTER TABLE hydro_station_bills ADD COLUMN final_approver_name TEXT');
  }
}

try {
  migrateHydroBillLifecycle();
} catch (e) {
  console.error('Hydro bill lifecycle migration failed:', e.message);
}

try {
  migrateCercHydroContractSchema();
} catch (e) {
  console.error('CERC hydro contract migration failed:', e.message);
}

try {
  migrateRampurTariffConstants();
} catch (e) {
  console.error('Rampur tariff constants migration failed:', e.message);
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
      source TEXT NOT NULL DEFAULT 'BILATERAL' CHECK (source IN ('BILATERAL','EXCHANGE','MANUAL','REIA')),
      bilateral_id TEXT,
      contract_id TEXT,
      ppa_id TEXT,
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

/**
 * The REIA desk's PPA/PSA trades go on Form-IV as lines of their own (31-Oct-2026,
 * per the REIA workflow: the REIA team prepares and submits the return). The
 * line table admits source REIA and records the PSA and PPA behind the line;
 * SQLite cannot alter a CHECK, so the table is rebuilt from schema.sql.
 */
function migrateFormIvReiaLines() {
  const t = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cerc_form_iv_lines'").get();
  if (!t || t.sql.includes("'REIA'")) return;
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('PRAGMA legacy_alter_table=ON'); // keep RENAME from touching other tables' FKs
  try {
    rebuildTableFromSchema('cerc_form_iv_lines');
    db.exec('CREATE INDEX IF NOT EXISTS idx_form_iv_lines_form ON cerc_form_iv_lines (form_id, line_no)');
  } finally {
    db.exec('PRAGMA legacy_alter_table=OFF');
    db.exec('PRAGMA foreign_keys=ON');
  }
}

try {
  migrateFormIvReiaLines();
} catch (e) {
  console.error('Form-IV REIA lines migration failed:', e.message);
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
  add('jmr_reference', 'ALTER TABLE rec_ledger ADD COLUMN jmr_reference TEXT');
  add('jmr_date', 'ALTER TABLE rec_ledger ADD COLUMN jmr_date TEXT');
  add('application_no', 'ALTER TABLE rec_ledger ADD COLUMN application_no TEXT');
  add('registry_stage', 'ALTER TABLE rec_ledger ADD COLUMN registry_stage TEXT');
  add('next_follow_up_date', 'ALTER TABLE rec_ledger ADD COLUMN next_follow_up_date TEXT');

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

/** Deemed generation: recorded on the period and billed as its own leg. */
function migrateDeemedGeneration() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  const add = (table, col, ddl) => {
    if (!tables.includes(table)) return;
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl};`);
  };
  add('energy_data', 'deemed_generation_mwh', 'REAL NOT NULL DEFAULT 0');
  add('invoices', 'deemed_energy_mwh', 'REAL NOT NULL DEFAULT 0');
  add('invoices', 'deemed_charges', 'REAL NOT NULL DEFAULT 0');
}

try {
  migrateDeemedGeneration();
} catch (e) {
  console.error('Deemed generation migration failed:', e.message);
}

/**
 * Why a flagged energy period was locked anyway.
 *
 * Locking is what makes a period billable, so a lock over a validation flag is a
 * decision someone has to own. These record who overrode it and on what grounds.
 */
function migrateEnergyLockOverride() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (!tables.includes('energy_data')) return;
  const cols = db.prepare('PRAGMA table_info(energy_data)').all().map((c) => c.name);
  if (!cols.includes('lock_override_reason')) db.exec(`ALTER TABLE energy_data ADD COLUMN lock_override_reason TEXT`);
  if (!cols.includes('lock_override_by')) db.exec(`ALTER TABLE energy_data ADD COLUMN lock_override_by TEXT`);
  if (!cols.includes('locked_at')) db.exec(`ALTER TABLE energy_data ADD COLUMN locked_at TEXT`);
}

try {
  migrateEnergyLockOverride();
} catch (e) {
  console.error('Energy lock override migration failed:', e.message);
}

/**
 * When a bill was actually put in front of the counterparty.
 *
 * The dispute window runs from presentation, but nothing recorded presentation,
 * so it was measured from row creation — an invoice that sat in draft spent its
 * counterparty's window before they had ever seen it. Backfilled from the first
 * delivery where one exists, so history keeps whatever truth it has.
 */
function migrateInvoiceIssuedAt() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (!tables.includes('invoices')) return;
  const cols = db.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name);
  if (cols.includes('issued_at')) return;

  db.exec(`ALTER TABLE invoices ADD COLUMN issued_at TEXT`);
  if (tables.includes('invoice_deliveries')) {
    db.exec(`
      UPDATE invoices SET issued_at = (
        SELECT MIN(d.created_at) FROM invoice_deliveries d WHERE d.invoice_id = invoices.id
      ) WHERE issued_at IS NULL
    `);
  }
  // An invoice already past approval was presented at some point; the best
  // remaining evidence is when it was last touched.
  db.exec(`
    UPDATE invoices SET issued_at = COALESCE(updated_at, created_at)
    WHERE issued_at IS NULL AND status IN ('SENT','DISPUTED','PARTIALLY_PAID','PAID')
  `);
}

try {
  migrateInvoiceIssuedAt();
} catch (e) {
  console.error('Invoice issued_at migration failed:', e.message);
}

/**
 * Who raised an invoice, as an id rather than a display name.
 *
 * Segregation of duties asks whether the person approving is the person who
 * raised it, and the only thing recorded was created_by — a display name, which
 * the check then compared against a user id. A name is never equal to an id, so
 * the control never fired once. created_by stays as it is because screens print
 * it; the identity the check needs goes in its own column.
 *
 * Backfilled by matching the stored name against the user register, so the
 * control covers bills raised before this existed rather than only new ones.
 */
function migrateInvoiceCreatedById() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (!tables.includes('invoices')) return;
  const cols = db.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name);
  if (!cols.includes('created_by_id')) db.exec(`ALTER TABLE invoices ADD COLUMN created_by_id TEXT`);

  if (!tables.includes('users')) return;
  // Only where the name resolves to exactly one user — an ambiguous name must
  // not be turned into a confident identity claim on an audit control.
  db.exec(`
    UPDATE invoices SET created_by_id = (
      SELECT u.id FROM users u
      WHERE u.name = invoices.created_by
        AND (SELECT COUNT(*) FROM users u2 WHERE u2.name = invoices.created_by) = 1
    )
    WHERE created_by_id IS NULL AND created_by IS NOT NULL
  `);
}

try {
  migrateInvoiceCreatedById();
} catch (e) {
  console.error('Invoice created_by_id migration failed:', e.message);
}

/**
 * A proposed change of bank account, held off the live record until verified.
 *
 * Editing a counterparty's bank details wrote them straight onto the entity. The
 * record dropped to PENDING and the penny-drop flag reset, but the account money
 * would be paid into had already changed — and nothing on the payout path looked
 * at either signal, so the next release went to the new, unverified account.
 * Redirecting a generator's payments took one edit.
 *
 * The proposal now waits here while the live columns keep paying the account
 * that was actually verified.
 */
function migrateEntityPendingBank() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (!tables.includes('entities')) return;
  const cols = db.prepare('PRAGMA table_info(entities)').all().map((c) => c.name);
  if (!cols.includes('pending_bank_json')) db.exec(`ALTER TABLE entities ADD COLUMN pending_bank_json TEXT`);
  if (!cols.includes('pending_bank_requested_by')) db.exec(`ALTER TABLE entities ADD COLUMN pending_bank_requested_by TEXT`);
  if (!cols.includes('pending_bank_requested_at')) db.exec(`ALTER TABLE entities ADD COLUMN pending_bank_requested_at TEXT`);
}

try {
  migrateEntityPendingBank();
} catch (e) {
  console.error('Entity pending-bank migration failed:', e.message);
}

/**
 * The date an amended contract's new terms start applying.
 *
 * Amending a contract built the new version and switched to it in the same
 * breath: the revised tariff was live the instant someone typed it, with no
 * approval in between and no date attached, so there was nothing to say whether
 * it applied from the regulator's order or from the afternoon it was entered.
 * An effective_date passed in was silently dropped — there was nowhere to put it.
 */
function migrateAmendmentEffectiveFrom() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (tables.includes('contracts')) {
    const cols = db.prepare('PRAGMA table_info(contracts)').all().map((c) => c.name);
    if (!cols.includes('amendment_effective_from')) {
      db.exec(`ALTER TABLE contracts ADD COLUMN amendment_effective_from TEXT`);
    }
  }
  if (tables.includes('contract_amendments')) {
    const cols = db.prepare('PRAGMA table_info(contract_amendments)').all().map((c) => c.name);
    if (!cols.includes('effective_from')) {
      db.exec(`ALTER TABLE contract_amendments ADD COLUMN effective_from TEXT`);
    }
    if (!cols.includes('new_contract_id')) {
      db.exec(`ALTER TABLE contract_amendments ADD COLUMN new_contract_id TEXT`);
    }
  }
}

try {
  migrateAmendmentEffectiveFrom();
} catch (e) {
  console.error('Amendment effective-date migration failed:', e.message);
}

/**
 * Room for the signatory in the contact list.
 *
 * contact_type allowed COMMERCIAL, TECHNICAL, DISPUTE and EMERGENCY, so the
 * authorised signatory — the person who actually binds the counterparty, and the
 * one onboarding asks for by name — had nowhere to go. The entity carries
 * signatory_name and signatory_designation as flat fields, which holds a name
 * but not an email or a phone, so there was no way to reach them.
 *
 * SQLite cannot alter a CHECK constraint, so the table is rebuilt. Its rows are
 * carried across first and the count is compared before the old one is dropped —
 * losing contacts here would silently break invoice delivery, which resolves its
 * recipient from exactly this table.
 */
function migrateContactTypes() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (!tables.includes('entity_contacts')) return;

  const ddl = db.prepare(`SELECT sql FROM sqlite_master WHERE name='entity_contacts'`).get()?.sql || '';
  if (ddl.includes('AUTHORIZED_SIGNATORY')) return;

  const before = db.prepare('SELECT COUNT(*) c FROM entity_contacts').get().c;
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE entity_contacts_new (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL REFERENCES entities(id),
        contact_type TEXT NOT NULL CHECK (contact_type IN (
          'COMMERCIAL','TECHNICAL','DISPUTE','EMERGENCY','AUTHORIZED_SIGNATORY','FINANCE','GRIEVANCE'
        )),
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        is_primary INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO entity_contacts_new (id, entity_id, contact_type, name, email, phone, is_primary)
        SELECT id, entity_id, contact_type, name, email, phone, is_primary FROM entity_contacts;
    `);
    const after = db.prepare('SELECT COUNT(*) c FROM entity_contacts_new').get().c;
    if (after !== before) throw new Error(`contact rebuild would lose rows (${before} → ${after})`);
    db.exec(`DROP TABLE entity_contacts; ALTER TABLE entity_contacts_new RENAME TO entity_contacts;`);
  })();
  db.pragma('foreign_keys = ON');
}

try {
  migrateContactTypes();
} catch (e) {
  console.error('Contact-type migration failed:', e.message);
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
  const cols = db.prepare('PRAGMA table_info(trading_debit_credit_notes)').all().map((c) => c.name);
  if (!cols.includes('view_bill_invoice_id')) {
    db.exec('ALTER TABLE trading_debit_credit_notes ADD COLUMN view_bill_invoice_id TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_trading_notes_view_bill ON trading_debit_credit_notes(view_bill_invoice_id, billing_period)');
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
 * Debit / credit notes as documents of their own (V2).
 *
 * A note used to be folded straight into the invoice's total the moment it was
 * raised: no approval, no tax, the issued bill rewritten, and a debit note
 * surcharged from the old bill's due date. V2 adds a DRAFT state that needs a
 * second person to issue, the tax on the note, and links to what the note
 * became (its own supplementary invoice, or the amount applied as a credit).
 * Rows already on file are kept as LEGACY and behave exactly as before.
 */
function migrateNotesV2() {
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='debit_credit_notes'").get()?.sql || '';
  if (!ddl || ddl.includes("'REJECTED'")) return;
  const oldCols = db.prepare('PRAGMA table_info(debit_credit_notes)').all().map((c) => c.name);
  const keep = ['id', 'note_no', 'note_type', 'invoice_id', 'contract_id', 'period_month', 'reason_code',
    'amount', 'reason', 'status', 'issued_date', 'settled_date', 'created_by', 'created_at', 'updated_at']
    .filter((c) => oldCols.includes(c));
  db.exec('PRAGMA foreign_keys=OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE debit_credit_notes_v2 (
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
        taxable_amount REAL,
        tax_amount REAL NOT NULL DEFAULT 0,
        tax_label TEXT,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','SETTLED','CANCELLED','REJECTED')),
        model TEXT NOT NULL DEFAULT 'V2' CHECK (model IN ('LEGACY','V2')),
        supp_invoice_id TEXT REFERENCES invoices(id),
        applied_amount REAL NOT NULL DEFAULT 0,
        due_date TEXT,
        issued_date TEXT,
        settled_date TEXT,
        created_by TEXT,
        created_by_id TEXT,
        approved_by TEXT,
        approved_by_id TEXT,
        approved_at TEXT,
        rejected_reason TEXT,
        cancel_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.exec(`
      INSERT INTO debit_credit_notes_v2 (${keep.join(', ')}, taxable_amount, model)
      SELECT ${keep.join(', ')}, amount, 'LEGACY' FROM debit_credit_notes;
      DROP TABLE debit_credit_notes;
      ALTER TABLE debit_credit_notes_v2 RENAME TO debit_credit_notes;
    `);
  })();
  db.exec('PRAGMA foreign_keys=ON');
  console.log('[MIGRATE] debit_credit_notes: V2 (draft/approval, tax, own documents); existing notes kept as LEGACY');
}

try {
  migrateNotesV2();
} catch (e) {
  console.error('Debit/credit note V2 migration failed:', e.message);
}

/**
 * Trading debit / credit notes as documents of their own (V2).
 *
 * They were a register: raised straight to ISSUED by one person, with no tax
 * and no reach into the client's ledger, so a debit note nobody chased was
 * never owed anywhere. V2 gives them the same shape as the REIA notes — a
 * draft that a second person issues, the tax on the note, and a client-ledger
 * entry when it is issued. Rows already on file become LEGACY: issued, but
 * never posted to the ledger.
 */
function migrateTradingNotesV2() {
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='trading_debit_credit_notes'").get()?.sql || '';
  if (!ddl || ddl.includes("'REJECTED'")) return;
  const oldCols = db.prepare('PRAGMA table_info(trading_debit_credit_notes)').all().map((c) => c.name);
  const keep = ['id', 'note_no', 'note_type', 'client_id', 'trading_invoice_id', 'view_bill_invoice_id',
    'billing_period', 'delivery_date', 'reason_code', 'quantum_mwh', 'rate_per_unit', 'amount',
    'broker_reference', 'reason', 'status', 'issued_date', 'settled_date', 'cancelled_reason',
    'created_by', 'created_at', 'updated_at'].filter((c) => oldCols.includes(c));
  db.exec('PRAGMA foreign_keys=OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE trading_notes_v2 (
        id TEXT PRIMARY KEY,
        note_no TEXT UNIQUE NOT NULL,
        note_type TEXT NOT NULL CHECK (note_type IN ('DEBIT','CREDIT')),
        client_id TEXT NOT NULL REFERENCES trading_clients(id),
        trading_invoice_id TEXT REFERENCES trading_invoices(id),
        view_bill_invoice_id TEXT,
        billing_period TEXT NOT NULL,
        delivery_date TEXT,
        reason_code TEXT NOT NULL DEFAULT 'SCHEDULE_SHORTFALL_PURCHASE' CHECK (reason_code IN (
          'SCHEDULE_SHORTFALL_PURCHASE','SCHEDULE_EXCESS_RETURN','BROKER_MANUAL_INVOICE',
          'OBLIGATION_PAYMENT_MISMATCH','RATE_REVISION','EXCHANGE_FEE_ADJUSTMENT','DSM_ADJUSTMENT','OTHER'
        )),
        quantum_mwh REAL,
        rate_per_unit REAL,
        amount REAL NOT NULL,
        taxable_amount REAL,
        tax_amount REAL NOT NULL DEFAULT 0,
        tax_label TEXT,
        broker_reference TEXT,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','SETTLED','CANCELLED','REJECTED')),
        model TEXT NOT NULL DEFAULT 'V2' CHECK (model IN ('LEGACY','V2')),
        ledger_entry_id TEXT,
        issued_date TEXT,
        settled_date TEXT,
        cancelled_reason TEXT,
        rejected_reason TEXT,
        created_by TEXT,
        created_by_id TEXT,
        approved_by TEXT,
        approved_by_id TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.exec(`
      INSERT INTO trading_notes_v2 (${keep.join(', ')}, taxable_amount, model)
      SELECT ${keep.join(', ')}, amount, 'LEGACY' FROM trading_debit_credit_notes;
      DROP TABLE trading_debit_credit_notes;
      ALTER TABLE trading_notes_v2 RENAME TO trading_debit_credit_notes;
      CREATE INDEX IF NOT EXISTS idx_trading_notes_client ON trading_debit_credit_notes (client_id, billing_period);
      CREATE INDEX IF NOT EXISTS idx_trading_notes_view_bill ON trading_debit_credit_notes (view_bill_invoice_id, billing_period);
    `);
  })();
  db.exec('PRAGMA foreign_keys=ON');
  console.log('[MIGRATE] trading_debit_credit_notes: V2 (draft/approval, tax, client ledger); existing notes kept as LEGACY');
}

try {
  migrateTradingNotesV2();
} catch (e) {
  console.error('Trading note V2 migration failed:', e.message);
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

/**
 * Settlement provenance on the View Bills register.
 *
 * The bilateral bills were previously all hand-entered, so a row carried no link
 * back to the transaction it billed. Generated bills need that link, plus the
 * quantum, rate and itemised breakup they were priced from.
 */
function migrateViewBillSettlementColumns() {
  const cols = db.prepare('PRAGMA table_info(view_bill_invoices)').all().map((c) => c.name);
  const additions = [
    ['bilateral_id', 'TEXT'],
    ['quantum_mwh', 'REAL'],
    ['rate_per_unit', 'REAL'],
    ['gst_amount', 'REAL'],
    ['breakup_json', 'TEXT'],
    ['settlement_basis', 'TEXT'],
    ['generated_from', 'TEXT'],
    ['supersedes_invoice_id', 'TEXT'],
    ['superseded_by_invoice_id', 'TEXT'],
    ['cancel_reason', 'TEXT'],
    ['bilateral_buyer', 'TEXT'],
  ];
  for (const [name, type] of additions) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE view_bill_invoices ADD COLUMN ${name} ${type}`);
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_view_bill_bilateral ON view_bill_invoices(bilateral_id, bill_type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_view_bill_supersede ON view_bill_invoices(supersedes_invoice_id, superseded_by_invoice_id)');
}

try {
  migrateViewBillSettlementColumns();
} catch (e) {
  console.error('View Bills settlement-column migration failed:', e.message);
}

/**
 * Link a format-generation application to the contract it became.
 *
 * Bidding, applications and contracts were three unconnected tables, so an
 * approved application had no way to say which bilateral transaction it turned
 * into — and the desk had to retype the whole thing.
 */
function migrateBilateralApplicationContractLink() {
  for (const table of ['bilateral_biddings', 'bilateral_applications']) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes('transaction_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN transaction_id TEXT`);
    }
  }
}

try {
  migrateBilateralApplicationContractLink();
} catch (e) {
  console.error('Bilateral application-contract link migration failed:', e.message);
}

/**
 * File an exchange bid under the client agreement it was placed for, and let a
 * generated bill point back at that agreement.
 *
 * bids carried a client and a product but no contract, so cleared volume could
 * not be rolled up to the agreement it settles against. Bids placed before this
 * column existed are matched by client, product and delivery date instead.
 */
function migrateExchangeSettlementLinks() {
  const bidCols = db.prepare('PRAGMA table_info(bids)').all().map((c) => c.name);
  if (!bidCols.includes('contract_id')) {
    db.exec('ALTER TABLE bids ADD COLUMN contract_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_bids_contract ON bids(contract_id, delivery_date)');
  }
  const invCols = db.prepare('PRAGMA table_info(view_bill_invoices)').all().map((c) => c.name);
  if (!invCols.includes('exchange_contract_id')) {
    db.exec('ALTER TABLE view_bill_invoices ADD COLUMN exchange_contract_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_view_bill_exchange ON view_bill_invoices(exchange_contract_id, bill_type)');
  }
}

try {
  migrateExchangeSettlementLinks();
} catch (e) {
  console.error('Exchange settlement-link migration failed:', e.message);
}

/**
 * Join ISET Exchange Bidding / Bidding Latest to the DAM `bids` table the
 * settlement engine actually reads. Without these columns the ISET form was a
 * separate story from Manage Bids and View Bills.
 */
function migrateIsetBiddingToDamBids() {
  const add = (table, name, ddl) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (cols.length && !cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  };
  add('bids', 'source_kind', 'TEXT');
  add('bids', 'source_id', 'TEXT');
  add('exchange_biddings', 'bid_ids', 'TEXT');
  add('exchange_bidding_latest', 'bid_ids', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bids_source ON bids(source_kind, source_id)');
}

try {
  migrateIsetBiddingToDamBids();
} catch (e) {
  console.error('ISET bidding → DAM bids migration failed:', e.message);
}

/**
 * Join a REC exchange bid to the certificates it moved.
 *
 * rec_bids recorded what was offered and then stopped — there was nowhere to
 * record what the session cleared, at what rate, or which ledger lots the
 * certificates came out of. Without that the bid book and the REC inventory
 * could disagree indefinitely.
 */
function migrateRecTradingLinks() {
  const add = (table, columns) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    for (const [name, type] of columns) {
      if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  };
  add('rec_bids', [
    ['approved_by', 'TEXT'],
    ['executed_quantity', 'INTEGER'],
    ['discovered_rate', 'REAL'],
    ['trade_date', 'TEXT'],
    ['rec_order_id', 'TEXT'],
    ['reject_reason', 'TEXT'],
  ]);
  add('rec_transactions', [['bid_id', 'TEXT']]);
  add('rec_orders', [['bid_id', 'TEXT'], ['generated_from', 'TEXT']]);
  // Rows that predate the column came from the seed or were keyed in by hand;
  // either way no execution stands behind them.
  db.prepare("UPDATE rec_orders SET generated_from = 'MANUAL' WHERE generated_from IS NULL AND bid_id IS NULL").run();
  db.prepare("UPDATE rec_orders SET generated_from = 'SETTLEMENT' WHERE generated_from IS NULL AND bid_id IS NOT NULL").run();
  db.exec('CREATE INDEX IF NOT EXISTS idx_rec_txn_bid ON rec_transactions(bid_id)');
}

try {
  migrateRecTradingLinks();
} catch (e) {
  console.error('REC trading-link migration failed:', e.message);
}

/**
 * PX1/PX2 used to be disconnected DONE flags. Persist the contract and the
 * DAM-desk bid ids they actually filed so Applications can join `bids`.
 */
function migrateExchangeApplicationBids() {
  const cols = db.prepare('PRAGMA table_info(exchange_applications)').all().map((c) => c.name);
  if (!cols.length) return;
  if (!cols.includes('contract_id')) db.exec('ALTER TABLE exchange_applications ADD COLUMN contract_id TEXT');
  if (!cols.includes('bid_ids')) db.exec('ALTER TABLE exchange_applications ADD COLUMN bid_ids TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ex_apps_contract ON exchange_applications(contract_id)');
}

try {
  migrateExchangeApplicationBids();
} catch (e) {
  console.error('Exchange application → bids migration failed:', e.message);
}

function migratePxilSettlementLinks() {
  const cols = db.prepare('PRAGMA table_info(pxil_orders)').all().map((c) => c.name);
  if (!cols.length) return;
  if (!cols.includes('client_id')) db.exec('ALTER TABLE pxil_orders ADD COLUMN client_id TEXT');
  if (!cols.includes('contract_id')) db.exec('ALTER TABLE pxil_orders ADD COLUMN contract_id TEXT');
  if (!cols.includes('bid_ids')) db.exec('ALTER TABLE pxil_orders ADD COLUMN bid_ids TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_pxil_orders_contract ON pxil_orders(contract_id, delivery_date_from)');
}

try {
  migratePxilSettlementLinks();
} catch (e) {
  console.error('PXIL settlement-link migration failed:', e.message);
}

/**
 * Widen users.role to the trading client's maker and checker.
 *
 * users.role is a CHECK constraint, and SQLite will not alter one — the table has
 * to be rebuilt. An existing database would otherwise refuse the two new roles
 * with "CHECK constraint failed", which reads like a bug in the screen that
 * created the user. Rebuilt only when the constraint is actually the old one.
 */
function migrateTradingClientMakerChecker() {
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql;
  if (!ddl || ddl.includes('TRADING_CLIENT_MAKER')) return;

  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const rows = db.prepare('SELECT * FROM users').all();
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('DROP TABLE IF EXISTS users_role_migration');
    db.exec(`
      CREATE TABLE users_role_migration (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN (
          'IT_SUPER_ADMIN','REIA_ADMIN','TRADING_ADMIN','FINANCE_USER',
          'MANAGEMENT','SELLER_L1','SELLER_L2','SELLER_L3','BUYER_L1','BUYER_L2','BUYER_L3','COMPLIANCE_AUDITOR',
          'TRADING_CLIENT','TRADING_CLIENT_MAKER','TRADING_CLIENT_CHECKER',
          'SJVN_ADMIN', 'SELLER', 'BUYER', 'REIA_USER', 'TRADING_USER'
        )),
        linked_entity_id TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    if (rows.length) {
      const keep = cols.filter((c) => [
        'id', 'name', 'email', 'password_hash', 'role', 'linked_entity_id', 'is_active', 'created_at',
      ].includes(c));
      const ins = db.prepare(`
        INSERT INTO users_role_migration (${keep.join(',')}) VALUES (${keep.map(() => '?').join(',')})
      `);
      const copy = db.transaction(() => { for (const r of rows) ins.run(...keep.map((c) => r[c])); });
      copy();
    }
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_role_migration RENAME TO users');
    console.log(`[MIGRATE] users.role widened for trading-client maker/checker (${rows.length} user(s) carried over)`);
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}

try {
  migrateTradingClientMakerChecker();
} catch (e) {
  console.error('Trading-client maker/checker role migration failed:', e.message);
}

/**
 * Widen users.role to include COMMERCIAL_ADMIN, COMMERCIAL_USER, and COMMERCIAL.
 * Hydro & Thermal billing is managed by the Commercial desk, separate from REIA.
 */
function migrateCommercialRole() {
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql;
  if (!ddl || ddl.includes('COMMERCIAL_USER')) return;

  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const rows = db.prepare('SELECT * FROM users').all();
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('DROP TABLE IF EXISTS users_role_migration');
    db.exec(`
      CREATE TABLE users_role_migration (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN (
          'IT_SUPER_ADMIN','REIA_ADMIN','TRADING_ADMIN','FINANCE_USER',
          'MANAGEMENT','SELLER_L1','SELLER_L2','SELLER_L3','BUYER_L1','BUYER_L2','BUYER_L3','COMPLIANCE_AUDITOR',
          'TRADING_CLIENT','TRADING_CLIENT_MAKER','TRADING_CLIENT_CHECKER',
          'COMMERCIAL_ADMIN','COMMERCIAL_USER','COMMERCIAL',
          'SJVN_ADMIN', 'SELLER', 'BUYER', 'REIA_USER', 'TRADING_USER'
        )),
        linked_entity_id TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    if (rows.length) {
      const keep = cols.filter((c) => [
        'id', 'name', 'email', 'password_hash', 'role', 'linked_entity_id', 'is_active', 'created_at',
      ].includes(c));
      const ins = db.prepare(`
        INSERT INTO users_role_migration (${keep.join(',')}) VALUES (${keep.map(() => '?').join(',')})
      `);
      const copy = db.transaction(() => { for (const r of rows) ins.run(...keep.map((c) => r[c])); });
      copy();
    }
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_role_migration RENAME TO users');
    console.log(`[MIGRATE] users.role widened for Commercial desk roles (${rows.length} user(s) carried over)`);
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}

function seedCommercialUsers() {
  try {
    // Ensure existing commercial users are consolidated under COMMERCIAL_ADMIN
    db.prepare(`UPDATE users SET role = 'COMMERCIAL_ADMIN', name = 'Sunil (Commercial Admin)' WHERE email IN ('commercial@sjvn.in', 'commercial.admin@sjvn.in')`).run();
    db.prepare(`UPDATE users SET role = 'COMMERCIAL_ADMIN' WHERE role = 'COMMERCIAL_USER'`).run();

    const existing = db.prepare("SELECT id FROM users WHERE email = 'commercial@sjvn.in'").get();
    const hash = bcrypt.hashSync('password123', 8);
    if (!existing) {
      db.prepare(`
        INSERT INTO users (id, name, email, password_hash, role, linked_entity_id, is_active)
        VALUES ('USR-COMMERCIAL-01', 'Sunil (Commercial Admin)', 'commercial@sjvn.in', ?, 'COMMERCIAL_ADMIN', NULL, 1)
      `).run(hash);
      console.log('[SEED] commercial@sjvn.in seeded as COMMERCIAL_ADMIN');
    }
    // A second officer on the hydro desk. A bill cannot be approved by whoever
    // raised it, so with one login the approval chain could never be finished.
    if (!db.prepare("SELECT id FROM users WHERE email = 'hydro.hod@sjvn.in'").get()) {
      db.prepare(`
        INSERT INTO users (id, name, email, password_hash, role, linked_entity_id, is_active)
        VALUES ('USR-HYDRO-HOD-01', 'Meera (Hydro HoD — Approver)', 'hydro.hod@sjvn.in', ?, 'COMMERCIAL', NULL, 1)
      `).run(hash);
      console.log('[SEED] hydro.hod@sjvn.in seeded as COMMERCIAL (approver)');
    }
  } catch (e) {
    console.error('Failed to seed commercial users:', e.message);
  }
}

try {
  migrateCommercialRole();
  seedCommercialUsers();
} catch (e) {
  console.error('Commercial role migration failed:', e.message);
}

/**
 * Widen users.role for the Thermal desk. Thermal billing has its own logins,
 * apart from the Commercial (hydro) desk, so each sees only its own section.
 */
function migrateThermalRole() {
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql;
  if (!ddl || ddl.includes('THERMAL_ADMIN')) return;

  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const rows = db.prepare('SELECT * FROM users').all();
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('DROP TABLE IF EXISTS users_role_migration');
    db.exec(`
      CREATE TABLE users_role_migration (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN (
          'IT_SUPER_ADMIN','REIA_ADMIN','TRADING_ADMIN','FINANCE_USER',
          'MANAGEMENT','SELLER_L1','SELLER_L2','SELLER_L3','BUYER_L1','BUYER_L2','BUYER_L3','COMPLIANCE_AUDITOR',
          'TRADING_CLIENT','TRADING_CLIENT_MAKER','TRADING_CLIENT_CHECKER',
          'COMMERCIAL_ADMIN','COMMERCIAL_USER','COMMERCIAL',
          'THERMAL_ADMIN','THERMAL_USER',
          'SJVN_ADMIN', 'SELLER', 'BUYER', 'REIA_USER', 'TRADING_USER'
        )),
        linked_entity_id TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    if (rows.length) {
      const keep = cols.filter((c) => [
        'id', 'name', 'email', 'password_hash', 'role', 'linked_entity_id', 'is_active', 'created_at',
      ].includes(c));
      const ins = db.prepare(`
        INSERT INTO users_role_migration (${keep.join(',')}) VALUES (${keep.map(() => '?').join(',')})
      `);
      const copy = db.transaction(() => { for (const r of rows) ins.run(...keep.map((c) => r[c])); });
      copy();
    }
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_role_migration RENAME TO users');
    console.log(`[MIGRATE] users.role widened for Thermal desk roles (${rows.length} user(s) carried over)`);
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}

function seedThermalUsers() {
  // The thermal desk's administrator, and a second officer on the desk so a
  // bill can be raised by one and approved by the other.
  const users = [
    ['USR-THERMAL-01', 'Ravi (Thermal Admin)', 'thermal@sjvn.in', 'THERMAL_ADMIN'],
    ['USR-THERMAL-02', 'Anil (Thermal Desk)', 'thermal.desk@sjvn.in', 'THERMAL_USER'],
  ];
  for (const [id, name, email, role] of users) {
    try {
      if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) continue;
      db.prepare(`
        INSERT INTO users (id, name, email, password_hash, role, linked_entity_id, is_active)
        VALUES (?, ?, ?, ?, ?, NULL, 1)
      `).run(id, name, email, bcrypt.hashSync('password123', 8), role);
      console.log(`[SEED] ${email} seeded as ${role}`);
    } catch (e) {
      console.error(`Failed to seed ${email}:`, e.message);
    }
  }
}

try {
  migrateThermalRole();
  seedThermalUsers();
} catch (e) {
  console.error('Thermal role migration failed:', e.message);
}

/**
 * Widen document_versions.verification_status to support DRAFT for Seller Maker/Checker.
 */
function migrateDocumentVersionsStatus() {
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='document_versions'").get()?.sql;
  if (!ddl || ddl.includes("'DRAFT'")) return;

  const cols = db.prepare('PRAGMA table_info(document_versions)').all().map((c) => c.name);
  const rows = db.prepare('SELECT * FROM document_versions').all();
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('DROP TABLE IF EXISTS document_versions_migration');
    db.exec(`
      CREATE TABLE document_versions_migration (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id),
        version_number INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size_bytes INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('DRAFT', 'PENDING', 'VERIFIED', 'REJECTED', 'NOT_REQUIRED')),
        verification_notes TEXT,
        verified_by TEXT REFERENCES users(id),
        verified_at TEXT,
        expiry_date TEXT,
        created_by TEXT REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(document_id, version_number)
      )
    `);
    if (rows.length) {
      const keep = cols.filter((c) => [
        'id', 'document_id', 'version_number', 'file_path', 'file_name',
        'file_size_bytes', 'mime_type', 'verification_status', 'verification_notes',
        'verified_by', 'verified_at', 'expiry_date', 'created_by', 'created_at'
      ].includes(c));
      const ins = db.prepare(`
        INSERT INTO document_versions_migration (${keep.join(', ')})
        VALUES (${keep.map(() => '?').join(', ')})
      `);
      const copy = db.transaction(() => { for (const r of rows) ins.run(...keep.map((c) => r[c])); });
      copy();
    }
    db.exec('DROP TABLE document_versions');
    db.exec('ALTER TABLE document_versions_migration RENAME TO document_versions');
    console.log(`[MIGRATE] document_versions.verification_status widened for DRAFT (${rows.length} version(s) carried over)`);
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}

try {
  migrateDocumentVersionsStatus();
} catch (e) {
  console.error('Document versions DRAFT status migration failed:', e.message);
}

/** The peak-window obligation on a contract, and what each month reported. */
function migratePeakAvailabilityColumns() {
  const add = (table, column, type) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.length || cols.includes(column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  add('contracts', 'peak_window_start', 'TEXT');
  add('contracts', 'peak_window_end', 'TEXT');
  add('contracts', 'min_peak_availability_percent', 'REAL');
  add('contracts', 'peak_penalty_per_mwh', 'REAL');
  add('energy_data', 'peak_availability_percent', 'REAL');
  // The home state's free power as the REA accounts it (table D2). A hydro
  // bill's E2 is this figure, which differs from FEHS% of E1 by rounding.
  add('energy_data', 'free_energy_mwh', 'REAL');
}

try {
  migratePeakAvailabilityColumns();
} catch (e) {
  console.error('Peak availability migration failed:', e.message);
}

/**
 * REC obligation upload: replace an earlier shape of the table.
 *
 * A database created while the obligation report was being designed can carry a
 * `rec_obligation_uploads` keyed on `file_hash` with a `rec_obligation_rows`
 * beside it. `CREATE TABLE IF NOT EXISTS` leaves such a table alone, so the
 * current code would query columns that are not there. The old tables are
 * replaced only while they are empty — with anything in them, the shapes are
 * left as they are and the mismatch is reported rather than data thrown away.
 */
function migrateRecObligationSchema() {
  const has = (t) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
  if (!has('rec_obligation_uploads')) return;
  const cols = db.prepare('PRAGMA table_info(rec_obligation_uploads)').all().map((c) => c.name);
  if (cols.includes('content_sha256')) return;

  const count = (t) => (has(t) ? db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c : 0);
  const held = count('rec_obligation_uploads') + count('rec_obligation_rows') + count('rec_obligation_lines');
  if (held > 0) {
    console.error('[MIGRATE] rec_obligation_uploads is in an older shape and holds rows — leaving it alone. The REC obligation upload will fail until it is migrated by hand.');
    return;
  }

  db.exec(`
    DROP TABLE IF EXISTS rec_obligation_rows;
    DROP TABLE IF EXISTS rec_obligation_lines;
    DROP TABLE IF EXISTS rec_obligation_uploads;
  `);
  db.exec(schema);
  console.log('[MIGRATE] rec_obligation_uploads: replaced an empty table of the earlier shape');
}

try {
  migrateRecObligationSchema();
} catch (e) {
  console.error('REC obligation migration failed:', e.message);
}

/**
 * Let a reconciliation line say it could not be checked.
 *
 * The tax and SAP lines had no system to check against, so they compared the
 * platform's own figure with itself and reported an exact match on every run.
 * They now record NOT_CONNECTED instead, which the CHECK constraint on an
 * existing database does not allow — hence the rebuild. Nothing is
 * reclassified: rows already stored keep whatever they were written with.
 */
function migrateReconItemsNotConnected() {
  const cols = db.prepare("PRAGMA table_info(recon_items)").all();
  if (!cols.length) return;
  const sql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'recon_items'",
  ).get()?.sql || '';
  if (sql.includes('NOT_CONNECTED')) return;

  db.exec(`
    CREATE TABLE recon_items_new (
      id TEXT PRIMARY KEY,
      reconciliation_id TEXT NOT NULL REFERENCES reconciliations(id),
      item_type TEXT NOT NULL CHECK (item_type IN (
        'ENERGY_THREE_WAY','FINANCIAL_THREE_WAY','TAX','PERFORMANCE','PENALTY',
        'INTERNAL_SAP','TRADING_BID_CLEAR_BILL','CARRY_FORWARD','DISPUTE_REF'
      )),
      label TEXT,
      metered_value REAL,
      billed_value REAL,
      paid_value REAL,
      sap_reference_amount REAL,
      variance REAL NOT NULL DEFAULT 0,
      variance_pct REAL,
      unit TEXT,
      match_status TEXT NOT NULL CHECK (match_status IN (
        'EXACT','AUTO_MATCHED','EXCEPTION','CARRIED','OVERRIDDEN','NOT_CONNECTED'
      )),
      pattern_flag INTEGER NOT NULL DEFAULT 0,
      dispute_id TEXT,
      invoice_id TEXT,
      override_reason TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO recon_items_new SELECT
      id, reconciliation_id, item_type, label, metered_value, billed_value, paid_value,
      sap_reference_amount, variance, variance_pct, unit, match_status, pattern_flag,
      dispute_id, invoice_id, override_reason, notes, created_at
    FROM recon_items;

    DROP TABLE recon_items;
    ALTER TABLE recon_items_new RENAME TO recon_items;
  `);
  console.log('[MIGRATE] recon_items: match_status can now record NOT_CONNECTED');
}

try {
  migrateReconItemsNotConnected();
} catch (e) {
  console.error('recon_items NOT_CONNECTED migration failed:', e.message);
}

/**
 * Give deviation_settlements a provenance, and stop it insisting on a rate.
 *
 * The table was built around one idea: that a week's settlement is
 * (actual − scheduled) × a rate. Measured against NRPC's own published
 * accounts that does not hold — each 15-minute block is priced against the
 * grid frequency in that block, so no single rate reproduces the figure, and
 * the direction does not even follow the deviation. Over the archive, Nathpa
 * Jhakri settles against the direction of its own deviation on 88 of 1715
 * days; Rampur on 33.
 *
 * So a row now says where its amount came from. A NRPC_DSA row carries the
 * figure the statement published, converted once in nrpcDsa.js, and has no
 * rate at all — hence deviation_rate becoming nullable, which is the reason
 * this is a table rebuild rather than three ALTERs. A MANUAL row keeps the old
 * behaviour, and is an estimate until the statement arrives.
 *
 * Existing rows are carried across as MANUAL, which is what they were.
 */
function migrateDeviationSettlementsProvenance() {
  const cols = db.prepare("PRAGMA table_info(deviation_settlements)").all();
  if (!cols.length) return;                       // table not created yet
  if (cols.some((c) => c.name === 'source')) return;  // already migrated

  db.exec(`
    CREATE TABLE deviation_settlements_new (
      id TEXT PRIMARY KEY,
      dsm_no TEXT UNIQUE NOT NULL,
      contract_id TEXT NOT NULL REFERENCES contracts(id),
      plant_code TEXT,
      plant_name TEXT,
      period_month TEXT NOT NULL,
      week_no INTEGER NOT NULL,
      week_date TEXT,
      entry_type TEXT NOT NULL DEFAULT 'PRIMARY' CHECK (entry_type IN ('PRIMARY','REVISED')),
      -- Where the amount came from. MANUAL rows are computed from a rate and
      -- are an estimate; NRPC_DSA rows carry the published figure.
      source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','NRPC_DSA')),
      dsa_account_id TEXT REFERENCES nrpc_dsa_accounts(id),
      dsa_entity_name TEXT,
      scheduled_mwh REAL NOT NULL DEFAULT 0,
      actual_mwh REAL NOT NULL DEFAULT 0,
      deviation_mwh REAL NOT NULL DEFAULT 0,
      -- Null on a NRPC_DSA row: the statement prices per block against
      -- frequency and publishes no rate, and a zero here would read as one.
      deviation_rate REAL,
      deviation_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','CALCULATED','SUBMITTED','DISPATCHED','CANCELLED')),
      invoice_no TEXT,
      dispatch_date TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      invoice_id TEXT,
      UNIQUE(contract_id, period_month, week_no, entry_type)
    );

    INSERT INTO deviation_settlements_new
      (id, dsm_no, contract_id, plant_code, plant_name, period_month, week_no, week_date,
       entry_type, source, scheduled_mwh, actual_mwh, deviation_mwh, deviation_rate,
       deviation_amount, status, invoice_no, dispatch_date, notes, created_by,
       created_at, updated_at, invoice_id)
    SELECT id, dsm_no, contract_id, plant_code, plant_name, period_month, week_no, week_date,
       entry_type, 'MANUAL', scheduled_mwh, actual_mwh, deviation_mwh, deviation_rate,
       deviation_amount, status, invoice_no, dispatch_date, notes, created_by,
       created_at, updated_at, invoice_id
    FROM deviation_settlements;

    DROP TABLE deviation_settlements;
    ALTER TABLE deviation_settlements_new RENAME TO deviation_settlements;

    CREATE INDEX IF NOT EXISTS idx_deviation_settlements_dsa
      ON deviation_settlements(dsa_account_id, dsa_entity_name);
  `);
  console.log('[MIGRATE] deviation_settlements: added source/dsa provenance, deviation_rate now nullable');
}

/**
 * NRPC weekly Deviation Settlement Account (DSA) store.
 *
 * Holds the statement exactly as published — LU for energy, Rs Lakh for money,
 * and the document's own sign, where positive means the entity owes the pool.
 * Nothing here is converted into the units or the sign convention of
 * deviation_settlements; that mapping is a separate, reviewed step, and keeping
 * the raw figures lets a stored week be diffed against the PDF line by line.
 *
 * A statement can be reissued. Rather than overwrite, each ingest is its own
 * account row and the earlier one for that week is marked SUPERSEDED, so the
 * history of what NRPC said, and when, survives.
 */
function migrateNrpcDsaSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nrpc_dsa_accounts (
      id TEXT PRIMARY KEY,
      week_code TEXT,
      -- 'R1', 'R2', 'Corrigendum' — null for an original statement.
      revision TEXT,
      week_no INTEGER NOT NULL,
      financial_year TEXT NOT NULL,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      issued_date TEXT,
      due_date TEXT,
      source_kind TEXT NOT NULL DEFAULT 'UPLOAD'
        CHECK (source_kind IN ('ARCHIVE','UPLOAD')),
      source_url TEXT,
      file_name TEXT,
      file_sha256 TEXT NOT NULL UNIQUE,
      file_bytes INTEGER,
      -- Where the statement PDF itself is kept. An auditor asking why a bill
      -- says what it says wants the document, not a digest of it.
      local_file_path TEXT,
      entity_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','SUPERSEDED')),
      superseded_by TEXT REFERENCES nrpc_dsa_accounts(id),
      created_by TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_nrpc_dsa_accounts_week
      ON nrpc_dsa_accounts(financial_year, week_no, status);
    CREATE INDEX IF NOT EXISTS idx_nrpc_dsa_accounts_span
      ON nrpc_dsa_accounts(week_start, week_end);

    CREATE TABLE IF NOT EXISTS nrpc_dsa_entity_days (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES nrpc_dsa_accounts(id) ON DELETE CASCADE,
      entity_name TEXT NOT NULL,
      entry_date TEXT NOT NULL,
      schedule_lu REAL,
      actual_lu REAL,
      devi_amt_lakh REAL,
      -- Null, not zero, wherever the statement prints no such column. Which
      -- columns exist varies by era and by entity: the sustained-deviation and
      -- additional-deviation charges below were dropped after WK-27 of 2022-23,
      -- and the inter-regional exchanges carry no nuclear-station adjustment
      -- and so publish neither ADJ nor NET DEVI in any era.
      sus_devi REAL,
      sus_amount_lakh REAL,
      add_devi_lakh REAL,
      adj_lakh REAL,
      net_devi_lakh REAL,
      UNIQUE (account_id, entity_name, entry_date)
    );

    CREATE INDEX IF NOT EXISTS idx_nrpc_dsa_days_entity
      ON nrpc_dsa_entity_days(entity_name, entry_date);

    -- The Total line the statement prints for each entity, kept as published
    -- rather than recomputed, so a parse can be checked against the document.
    CREATE TABLE IF NOT EXISTS nrpc_dsa_entity_totals (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES nrpc_dsa_accounts(id) ON DELETE CASCADE,
      entity_name TEXT NOT NULL,
      schedule_lu REAL,
      actual_lu REAL,
      devi_amt_lakh REAL,
      sus_devi REAL,
      sus_amount_lakh REAL,
      add_devi_lakh REAL,
      adj_lakh REAL,
      net_devi_lakh REAL,
      UNIQUE (account_id, entity_name)
    );

    CREATE INDEX IF NOT EXISTS idx_nrpc_dsa_totals_entity
      ON nrpc_dsa_entity_totals(entity_name);
  `);
}

try {
  migrateNrpcDsaSchema();
} catch (e) {
  console.error('NRPC DSA migration failed:', e.message);
}

try {
  migrateDeviationSettlementsProvenance();
} catch (e) {
  console.error('deviation_settlements provenance migration failed:', e.message);
}

/**
 * Let a week carry every revision NRPC issues for it.
 *
 * The table allowed one row per (contract, month, week, PRIMARY|REVISED), so
 * once R1 of a week was raised and billed, R2 had nowhere to go — and NRPC does
 * issue R2 and R3. Rows are now unique per statement for published figures and
 * per week for manual estimates, and only while they are live: a cancelled row
 * stays on record instead of being deleted to free its slot.
 */
function migrateDeviationSettlementsRevisions() {
  const t = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'deviation_settlements'").get();
  if (!t || !/UNIQUE\s*\(\s*contract_id\s*,\s*period_month\s*,\s*week_no\s*,\s*entry_type\s*\)/i.test(t.sql)) return;
  const cols = db.prepare('PRAGMA table_info(deviation_settlements)').all().map((c) => c.name);
  if (!cols.includes('source')) return; // provenance first
  const keep = ['id', 'dsm_no', 'contract_id', 'plant_code', 'plant_name', 'period_month', 'week_no', 'week_date', 'entry_type', 'source',
    'dsa_account_id', 'dsa_entity_name', 'scheduled_mwh', 'actual_mwh', 'deviation_mwh', 'deviation_rate', 'deviation_amount', 'status',
    'invoice_no', 'dispatch_date', 'notes', 'created_by', 'created_at', 'updated_at', 'invoice_id'].filter((c) => cols.includes(c));
  db.exec(`
    CREATE TABLE deviation_settlements_new (
      id TEXT PRIMARY KEY,
      dsm_no TEXT UNIQUE NOT NULL,
      contract_id TEXT NOT NULL REFERENCES contracts(id),
      plant_code TEXT,
      plant_name TEXT,
      period_month TEXT NOT NULL,
      week_no INTEGER NOT NULL,
      week_date TEXT,
      entry_type TEXT NOT NULL DEFAULT 'PRIMARY' CHECK (entry_type IN ('PRIMARY','REVISED')),
      source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','NRPC_DSA')),
      dsa_account_id TEXT REFERENCES nrpc_dsa_accounts(id),
      dsa_entity_name TEXT,
      scheduled_mwh REAL NOT NULL DEFAULT 0,
      actual_mwh REAL NOT NULL DEFAULT 0,
      deviation_mwh REAL NOT NULL DEFAULT 0,
      deviation_rate REAL,
      deviation_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','CALCULATED','SUBMITTED','DISPATCHED','CANCELLED')),
      invoice_no TEXT,
      dispatch_date TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      invoice_id TEXT
    );
    INSERT INTO deviation_settlements_new (${keep.join(', ')}) SELECT ${keep.join(', ')} FROM deviation_settlements;
    DROP TABLE deviation_settlements;
    ALTER TABLE deviation_settlements_new RENAME TO deviation_settlements;
    CREATE INDEX IF NOT EXISTS idx_deviation_settlements_dsa ON deviation_settlements(dsa_account_id, dsa_entity_name);
    CREATE INDEX IF NOT EXISTS idx_deviation_settlements_week ON deviation_settlements(contract_id, period_month, week_no);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_deviation_manual_week ON deviation_settlements(contract_id, period_month, week_no, entry_type)
      WHERE source = 'MANUAL' AND status <> 'CANCELLED';
    CREATE UNIQUE INDEX IF NOT EXISTS ux_deviation_statement ON deviation_settlements(contract_id, dsa_account_id)
      WHERE source = 'NRPC_DSA' AND status <> 'CANCELLED';
  `);
  console.log('[MIGRATE] deviation_settlements: one row per statement revision, cancelled rows kept');
}

try {
  migrateDeviationSettlementsRevisions();
} catch (e) {
  console.error('deviation_settlements revisions migration failed:', e.message);
}

/**
 * A week of a station another RPC settles, entered from that RPC's printed
 * statement (RPC_STATEMENT). A thermal station in the Eastern Region is on
 * ERPC's account, which the NRPC import never holds, so its weeks could only
 * be estimates and never billed (Thermal QA run 15).
 */
function migrateDeviationRpcStatement() {
  const t = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'deviation_settlements'").get();
  if (!t || t.sql.includes("'RPC_STATEMENT'") || !t.sql.includes("'NRPC_DSA'")) return;
  const cols = db.prepare('PRAGMA table_info(deviation_settlements)').all().map((c) => c.name);
  const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'deviation_settlements' AND sql IS NOT NULL").all().map((r) => r.sql);
  db.exec(`
    CREATE TABLE deviation_settlements_new (${t.sql.slice(t.sql.indexOf('(') + 1, t.sql.lastIndexOf(')'))
      .replace("CHECK (source IN ('MANUAL','NRPC_DSA'))", "CHECK (source IN ('MANUAL','NRPC_DSA','RPC_STATEMENT'))")});
    INSERT INTO deviation_settlements_new (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM deviation_settlements;
    DROP TABLE deviation_settlements;
    ALTER TABLE deviation_settlements_new RENAME TO deviation_settlements;
  `);
  for (const sql of indexes) db.exec(sql.replace(/^CREATE (UNIQUE )?INDEX /i, (m) => `${m}IF NOT EXISTS `));
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_deviation_rpc_week ON deviation_settlements(contract_id, period_month, week_no, entry_type)
    WHERE source = 'RPC_STATEMENT' AND status <> 'CANCELLED'`);
  console.log('[MIGRATE] deviation_settlements: RPC_STATEMENT source for weeks settled outside NRPC');
}
try {
  migrateDeviationRpcStatement();
} catch (e) {
  console.error('deviation_settlements RPC statement migration failed:', e.message);
}

// Water charges, security expenses and capital spares are claimed outside the
// AFC (CERC Tariff Regulations); the charge list held only the hydro items
// (Thermal QA run 16).
function migrateAdditionalChargeTypes() {
  const t = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'hydro_additional_charges'").get();
  if (!t || t.sql.includes("'WATER_CHARGES'") || !t.sql.includes("'AUX_CONSUMPTION','FERV','OTHER'")) return;
  const cols = db.prepare('PRAGMA table_info(hydro_additional_charges)').all().map((c) => c.name);
  const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'hydro_additional_charges' AND sql IS NOT NULL").all().map((r) => r.sql);
  db.exec(`
    CREATE TABLE hydro_additional_charges_new (${t.sql.slice(t.sql.indexOf('(') + 1, t.sql.lastIndexOf(')'))
      .replace("'AUX_CONSUMPTION','FERV','OTHER'", "'AUX_CONSUMPTION','WATER_CHARGES','SECURITY_EXPENSES','CAPITAL_SPARES','FERV','OTHER'")});
    INSERT INTO hydro_additional_charges_new (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM hydro_additional_charges;
    DROP TABLE hydro_additional_charges;
    ALTER TABLE hydro_additional_charges_new RENAME TO hydro_additional_charges;
  `);
  for (const sql of indexes) db.exec(sql.replace(/^CREATE (UNIQUE )?INDEX /i, (m) => `${m}IF NOT EXISTS `));
}
try {
  migrateAdditionalChargeTypes();
} catch (e) {
  console.error('Additional charge types migration failed:', e.message);
}

/**
 * Mail, second pass: a formatted body beside the plain one, and blind copies.
 * BCC is a new value of a CHECKed column, so mail_boxes is rebuilt in place.
 */
function migrateMailRichTextAndBcc() {
  const cols = db.pragma('table_info(mail_messages)').map((c) => c.name);
  if (!cols.length) return;
  if (!cols.includes('body_html')) db.exec('ALTER TABLE mail_messages ADD COLUMN body_html TEXT');

  const ddl = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_boxes'"
  ).get()?.sql || '';
  if (ddl.includes("'BCC'")) return;

  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.transaction(() => {
      const before = db.prepare('SELECT COUNT(*) c FROM mail_boxes').get().c;
      db.exec(`
        CREATE TABLE mail_boxes_new (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id),
          box TEXT NOT NULL CHECK (box IN ('INBOX','SENT')),
          recipient_kind TEXT CHECK (recipient_kind IN ('TO','CC','BCC')),
          read_at TEXT,
          archived_at TEXT,
          deleted_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (message_id, user_id, box)
        );
        INSERT INTO mail_boxes_new (id, message_id, user_id, box, recipient_kind, read_at, archived_at, deleted_at, created_at)
          SELECT id, message_id, user_id, box, recipient_kind, read_at, archived_at, deleted_at, created_at FROM mail_boxes;
      `);
      const after = db.prepare('SELECT COUNT(*) c FROM mail_boxes_new').get().c;
      if (after !== before) throw new Error(`mail_boxes rebuild would lose rows (${before} → ${after})`);
      db.exec(`
        DROP TABLE mail_boxes;
        ALTER TABLE mail_boxes_new RENAME TO mail_boxes;
        CREATE INDEX IF NOT EXISTS idx_mail_boxes_user ON mail_boxes (user_id, box, deleted_at);
      `);
    })();
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
  console.log('[MIGRATE] mail_boxes: blind copies allowed');
}

try {
  migrateMailRichTextAndBcc();
} catch (e) {
  console.error('Mail rich-text / BCC migration failed:', e.message);
}

/** Buyer bills: the buyer's acknowledgement that a bill reached it. */
function migrateBuyerBillAck() {
  const cols = db.pragma('table_info(invoices)').map((c) => c.name);
  if (!cols.length) return;
  for (const col of ['buyer_ack_at', 'buyer_ack_by']) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE invoices ADD COLUMN ${col} TEXT`);
  }
}

try {
  migrateBuyerBillAck();
} catch (e) {
  console.error('Buyer bill acknowledgement migration failed:', e.message);
}

/** Team management: who a member is, why an account was switched off, and when its sessions were ended. */
function migrateTeamMembers() {
  const cols = db.pragma('table_info(users)').map((c) => c.name);
  if (!cols.length) return;
  for (const [col, type] of [['designation', 'TEXT'], ['must_change_password', 'INTEGER NOT NULL DEFAULT 0'], ['sessions_revoked_at', 'INTEGER'],
    ['deactivated_at', 'TEXT'], ['deactivated_by', 'TEXT'], ['deactivation_reason', 'TEXT'], ['created_by', 'TEXT'],
    // Target #2 Phase C: ALL projects, or only those in user_project_assignments.
    ['project_scope', "TEXT NOT NULL DEFAULT 'ALL'"]]) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
  }
}

try {
  migrateTeamMembers();
} catch (e) {
  console.error('Team member migration failed:', e.message);
}

/** Payment security: the bank's own reference, the SFMS advice, the scanned instrument, and what it was before any amendment. */
function migrateSecurityDesk() {
  const cols = db.pragma('table_info(payment_security)').map((c) => c.name);
  if (!cols.length) return;
  for (const [col, type] of [['bank_reference_no', 'TEXT'], ['issuing_branch', 'TEXT'], ['issuing_ifsc', 'TEXT'], ['issue_date', 'TEXT'],
    ['sfms_message_type', 'TEXT'], ['sfms_date', 'TEXT'], ['sfms_reference', 'TEXT'], ['sfms_sender_ifsc', 'TEXT'],
    ['is_ebg', 'INTEGER NOT NULL DEFAULT 0'], ['ebg_reference', 'TEXT'], ['document_version_id', 'TEXT'],
    ['submitted_by', 'TEXT'], ['submitted_by_side', 'TEXT'], ['rejection_note', 'TEXT'],
    ['original_limit_amount', 'REAL'], ['original_validity_end', 'TEXT']]) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE payment_security ADD COLUMN ${col} ${type}`);
  }
}

try {
  migrateSecurityDesk();
} catch (e) {
  console.error('Payment security desk migration failed:', e.message);
}

/**
 * Security "instruments" the system made up. Activating a contract raised an
 * ACTIVE instrument for its whole requirement — bank "To be confirmed", no
 * reference, no document — and it counted as cover. Those nobody has drawn on
 * or confirmed are closed here with the reason; the requirement itself stays on
 * the contract and shows as a shortfall until the real instrument is recorded.
 */
function migrateSecurityPlaceholders() {
  const cols = db.pragma('table_info(payment_security)').map((c) => c.name);
  if (!cols.includes('rejection_note')) return;
  db.prepare(`
    UPDATE payment_security SET status = 'CLOSED',
      rejection_note = 'Placeholder raised automatically from the contract requirement — no instrument was lodged. The requirement stands; record the instrument when it is furnished.',
      updated_at = datetime('now')
    WHERE issuing_bank = 'To be confirmed' AND remarks LIKE 'Auto-synced from contract requirement%'
      AND verified_at IS NULL AND COALESCE(utilized_amount, 0) = 0 AND status IN ('ACTIVE', 'RENEWED')
  `).run();
}

try {
  migrateSecurityPlaceholders();
} catch (e) {
  console.error('Security placeholder migration failed:', e.message);
}

/**
 * Form-IV monthly returns are due by the 15th of the following month (decided
 * 17-Oct-2026); returns already started carried period end + 30 days. Restated
 * from the period, so the register and the calendar give one date.
 */
function migrateFormIvMonthlyDueDates() {
  const cols = db.pragma('table_info(cerc_form_iv)').map((c) => c.name);
  if (!cols.includes('due_date')) return;
  db.prepare(`
    UPDATE cerc_form_iv SET due_date = date(period || '-01', '+1 month', '+14 days')
    WHERE period_type = 'MONTHLY' AND period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'
      AND COALESCE(due_date, '') <> date(period || '-01', '+1 month', '+14 days')
  `).run();
}

try {
  migrateFormIvMonthlyDueDates();
} catch (e) {
  console.error('Form-IV due date migration failed:', e.message);
}

/**
 * REIA Finance postings: one batch waiting per month and category, but a posted
 * month may take further batches for bills raised after it was booked — the
 * documents already on a live posting are still left out of each new one. The
 * index allowed one live posting per month, so those bills could never be booked.
 */
function migrateReiaFiPostingIndex() {
  const idx = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_reia_fi_posting_period'`).get();
  if (!idx || /status\s*=\s*'PREPARED'/.test(idx.sql || '')) return;
  db.exec(`
    DROP INDEX idx_reia_fi_posting_period;
    CREATE UNIQUE INDEX idx_reia_fi_posting_period ON reia_fi_postings (period_month, category) WHERE status = 'PREPARED';
  `);
}

try {
  migrateReiaFiPostingIndex();
} catch (e) {
  console.error('REIA FI posting index migration failed:', e.message);
}

/** Disputes: groups, the submitter's answer to a resolution, and where a contested one went. */
function migrateDisputeResponses() {
  const cols = db.pragma('table_info(disputes)').map((c) => c.name);
  if (!cols.length) return;
  for (const [col, type] of [['group_ref', 'TEXT'], ['group_title', 'TEXT'], ['resolution_response', 'TEXT'], ['resolution_response_by', 'TEXT'],
    ['resolution_response_at', 'TEXT'], ['resolution_response_note', 'TEXT'], ['escalation_forum', 'TEXT'], ['contested_amount', 'REAL'], ['escalation_outcome', 'TEXT'],
    // When SJVN asked the party for information (its clock stands still meanwhile), the
    // credit or debit note an accepted claim became, and what a forum awarded.
    ['info_requested_at', 'TEXT'], ['resolution_note_id', 'TEXT'], ['awarded_amount', 'REAL']]) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE disputes ADD COLUMN ${col} ${type}`);
  }
}

try {
  migrateDisputeResponses();
} catch (e) {
  console.error('Dispute response migration failed:', e.message);
}

/** Reconciliation: each side's signature as recorded, the auditor's certificate and the signed copies. */
function migrateReconSignoff() {
  const cols = db.pragma('table_info(reconciliations)').map((c) => c.name);
  if (!cols.length) return;
  for (const col of ['sjvn_sign_json', 'counterparty_sign_json', 'counterparty_cert_json', 'signed_copies_json']) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE reconciliations ADD COLUMN ${col} TEXT`);
  }
}

try {
  migrateReconSignoff();
} catch (e) {
  console.error('Reconciliation sign-off migration failed:', e.message);
}

/** Payments: what a deduction is made of, and the rebate the payment earned. */
function migratePaymentBreakup() {
  const cols = db.pragma('table_info(payments)').map((c) => c.name);
  if (!cols.length) return;
  for (const [col, type] of [['tds_amount', 'REAL'], ['tds_section', 'TEXT'], ['deduction_note', 'TEXT'], ['rebate_amount', 'REAL']]) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE payments ADD COLUMN ${col} ${type}`);
  }
}

try {
  migratePaymentBreakup();
} catch (e) {
  console.error('Payment breakup migration failed:', e.message);
}

/** Invoices: the e-invoice reference, the signed copy and the hard copy's journey. */
function migrateInvoiceCompliance() {
  const cols = db.pragma('table_info(invoices)').map((c) => c.name);
  if (!cols.length) return;
  for (const col of ['irn', 'irn_ack_no', 'irn_ack_date', 'irn_signed_qr', 'irn_checks_json', 'irn_recorded_by', 'irn_recorded_at',
    'signed_version_id', 'signed_info_json', 'hardcopy_courier', 'hardcopy_docket_no', 'hardcopy_dispatched_on',
    'hardcopy_received_on', 'hardcopy_received_by', 'hardcopy_note']) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE invoices ADD COLUMN ${col} TEXT`);
  }
}

try {
  migrateInvoiceCompliance();
} catch (e) {
  console.error('Invoice compliance migration failed:', e.message);
}

/** Energy records: the source document, and what the counterparty said to the figure. */
function migrateEnergyResponses() {
  const cols = db.pragma('table_info(energy_data)').map((c) => c.name);
  if (!cols.length) return;
  const add = { source_version_id: 'TEXT', response_status: 'TEXT', response_note: 'TEXT', claimed_mwh: 'REAL', response_version_id: 'TEXT',
    response_by: 'TEXT', response_at: 'TEXT', objection_outcome: 'TEXT', objection_resolution: 'TEXT', objection_resolved_by: 'TEXT', objection_resolved_at: 'TEXT' };
  for (const [col, type] of Object.entries(add)) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE energy_data ADD COLUMN ${col} ${type}`);
  }
}

try {
  migrateEnergyResponses();
} catch (e) {
  console.error('Energy response migration failed:', e.message);
}

/** Documents: why one was sent back, the file's fingerprint, and what was read from it. */
function migrateDocumentVersionChecks() {
  const cols = db.pragma('table_info(document_versions)').map((c) => c.name);
  if (!cols.length) return;
  for (const col of ['rejection_code', 'file_hash', 'extracted_json']) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE document_versions ADD COLUMN ${col} TEXT`);
  }
}

try {
  migrateDocumentVersionChecks();
} catch (e) {
  console.error('Document version checks migration failed:', e.message);
}

/** A pinned message remembers when it was taken down, for the board's history. */
function migrateBroadcastRemovedAt() {
  const cols = db.pragma('table_info(broadcast_messages)').map((c) => c.name);
  if (cols.length && !cols.includes('removed_at')) db.exec('ALTER TABLE broadcast_messages ADD COLUMN removed_at TEXT');
}

try {
  migrateBroadcastRemovedAt();
} catch (e) {
  console.error('Broadcast removed_at migration failed:', e.message);
}

/** Mail, third pass: a star, a trash that can be emptied, and when a message was first opened. */
function migrateMailBoxFlags() {
  const cols = db.pragma('table_info(mail_boxes)').map((c) => c.name);
  if (!cols.length) return;
  for (const col of ['starred_at', 'opened_at', 'purged_at']) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE mail_boxes ADD COLUMN ${col} TEXT`);
  }
  // What was already read was, at the latest, opened then.
  if (!cols.includes('opened_at')) {
    db.exec(`UPDATE mail_boxes SET opened_at = read_at WHERE box = 'INBOX' AND read_at IS NOT NULL`);
  }
}

try {
  migrateMailBoxFlags();
} catch (e) {
  console.error('Mail box-flags migration failed:', e.message);
}

/**
 * Billing, after the first end-to-end test of it: how much of a payment went to
 * surcharge (so a receipt applied surcharge-first can show it did), and what a
 * seller says its "other adjustment" is for.
 */
/**
 * The hourly sweep raised a fresh statement for every provisional period each
 * time it ran. Of the open, untouched statements for one contract and period,
 * the newest is kept; nobody had signed, overridden or disputed the others.
 */
function collapseDuplicateReconciliations() {
  const has = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t);
  if (!has('reconciliations') || !has('recon_items')) return;
  const stale = db.prepare(`
    SELECT r.id FROM reconciliations r
    WHERE r.status NOT IN ('CLOSED','AGREED','DISPUTED') AND r.sjvn_ack_at IS NULL AND r.counterparty_ack_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM recon_items i WHERE i.reconciliation_id = r.id AND (i.match_status = 'OVERRIDDEN' OR i.dispute_id IS NOT NULL))
      AND EXISTS (
        SELECT 1 FROM reconciliations n
        WHERE n.scope = r.scope AND n.period = r.period AND n.period_type = r.period_type
          AND COALESCE(n.contract_id, '') = COALESCE(r.contract_id, '') AND COALESCE(n.trading_client_id, '') = COALESCE(r.trading_client_id, '')
          AND n.status NOT IN ('CLOSED','AGREED') AND n.rowid > r.rowid
      )
  `).all().map((r) => r.id);
  if (!stale.length) return;
  const children = ['recon_items', 'recon_events', 'recon_statements', 'recon_exceptions', 'recon_reopen_requests'].filter(has);
  db.transaction(() => {
    for (const id of stale) {
      for (const t of children) db.prepare(`DELETE FROM ${t} WHERE reconciliation_id = ?`).run(id);
      db.prepare('DELETE FROM reconciliations WHERE id = ?').run(id);
    }
  })();
  console.log(`[MIGRATE] reconciliations: removed ${stale.length} duplicate open statement(s) left by the hourly sweep`);
}

// DBIM v3 s.7.6: the cookie notice now records the categories of a "custom" choice.
function migrateDbimConsentColumns() {
  const cols = db.pragma('table_info(consent_records)').map((c) => c.name);
  if (cols.length && !cols.includes('categories')) db.exec('ALTER TABLE consent_records ADD COLUMN categories TEXT');
}

function migrateBillingQaColumns() {
  const pay = db.pragma('table_info(payments)').map((c) => c.name);
  if (pay.length && !pay.includes('lps_component')) db.exec('ALTER TABLE payments ADD COLUMN lps_component REAL');
  const inv = db.pragma('table_info(invoices)').map((c) => c.name);
  if (inv.length && !inv.includes('adjustment_remarks')) db.exec('ALTER TABLE invoices ADD COLUMN adjustment_remarks TEXT');
  if (inv.length && !inv.includes('status_before_dispute')) db.exec('ALTER TABLE invoices ADD COLUMN status_before_dispute TEXT');
  const apr = db.pragma('table_info(invoice_approvals)').map((c) => c.name);
  if (apr.length && !apr.includes('approver_id')) db.exec('ALTER TABLE invoice_approvals ADD COLUMN approver_id TEXT');
  // Why a release was refused — the counterparty was told "rejected" and nothing more.
  const rel = db.pragma('table_info(security_releases)').map((c) => c.name);
  if (rel.length && !rel.includes('decision_note')) db.exec('ALTER TABLE security_releases ADD COLUMN decision_note TEXT');

  // The credit bill a resolved dispute raises was the one bill of SJVN's with no
  // breakdown, and a bill on a PPA without one reads as the seller's own.
  const disputes = db.pragma('table_info(disputes)').map((c) => c.name);
  if (inv.length && disputes.includes('supplementary_invoice_id')) {
    const rows = db.prepare(`
      SELECT i.id, i.total_amount, i.lps, d.dispute_no, p.invoice_no AS parent_no
      FROM invoices i JOIN disputes d ON d.supplementary_invoice_id = i.id
      LEFT JOIN invoices p ON p.id = i.parent_invoice_id
      WHERE TRIM(COALESCE(i.invoice_breakdown_json, '')) = ''
    `).all();
    const set = db.prepare('UPDATE invoices SET invoice_breakdown_json = ? WHERE id = ?');
    for (const r of rows) {
      const lps = Number(r.lps) || 0;
      set.run(JSON.stringify([
        { code: 'CR', label: `Credit on dispute ${r.dispute_no}${r.parent_no ? ` against ${r.parent_no}` : ''}`, value: (Number(r.total_amount) || 0) - lps },
        ...(lps ? [{ code: 'LPS', label: 'Late payment surcharge on resolution', value: lps }] : []),
        { code: 'TOTAL', label: 'Supplementary (credit) total', value: Number(r.total_amount) || 0 },
      ]), r.id);
    }
  }
}

try {
  migrateBillingQaColumns();
  migrateDbimConsentColumns();
  collapseDuplicateReconciliations();
  const notifCols = db.pragma('table_info(notifications)').map((c) => c.name);
  if (notifCols.length && !notifCols.includes('link')) {
    db.exec('ALTER TABLE notifications ADD COLUMN link TEXT;');
  }
} catch (e) {
  console.error('Billing QA columns migration failed:', e.message);
}

/**
 * Decisions taken on 17-Oct-2026 on the open questions from the REIA QA runs
 * (docs/DECISIONS_2026-10-17.md). New columns, and master defaults that change:
 * a default is moved only where it still holds the old default, and only once,
 * so a value SJVN has set by hand is never overwritten.
 */
function migrateDecisions20261017() {
  const addCol = (table, col, type) => {
    const cols = db.pragma(`table_info(${table})`).map((c) => c.name);
    if (cols.length && !cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  };
  addCol('contracts', 'cuf_shortfall_comp_pct', 'REAL');
  addCol('contracts', 'banking_cycle_basis', 'TEXT');
  addCol('reconciliations', 'finance_ack_at', 'TEXT');
  addCol('invoices', 'verified_by_id', 'TEXT');
  addCol('cerc_form_iv', 'filed_outside', 'INTEGER NOT NULL DEFAULT 0');
  addCol('cerc_licence_compliance', 'fee_late_surcharge_paid', 'REAL');
  addCol('power_diversions', 'advance_id', 'TEXT');
  addCol('entities', 'requested_by_user_id', 'TEXT');
  addCol('recon_exceptions', 'note_id', 'TEXT');
  addCol('energy_data', 'curtailment_hours', 'REAL');
  for (const col of ['forum_case_no', 'forum_filed_on', 'next_hearing']) addCol('disputes', col, 'TEXT');
  addCol('disputes', 'expected_exposure', 'REAL');
  addCol('energy_data', 'curtailment_ref', 'TEXT');
  for (const col of ['claim_submitted_on', 'claim_reference', 'bank_response_due', 'bank_responded_on', 'bank_late_alerted_at', 'outcome_letter_file', 'outcome_letter_name']) addCol('security_invocations', col, 'TEXT');
  addCol('contracts', 'on_hold', 'INTEGER NOT NULL DEFAULT 0');
  addCol('contracts', 'verification_window_days', 'INTEGER');
  for (const col of ['hold_reason', 'hold_set_by', 'hold_set_at']) addCol('contracts', col, 'TEXT');
  addCol('debit_credit_notes', 'source_kind', 'TEXT');
  addCol('debit_credit_notes', 'source_ref', 'TEXT');
  addCol('invoices', 'lps_invoiced', 'REAL NOT NULL DEFAULT 0');
  for (const col of ['finance_signoff_at', 'finance_signoff_by', 'finance_signoff_by_id', 'finance_signoff_note', 'requested_by_id']) addCol('security_releases', col, 'TEXT');
  addCol('power_diversions', 'deficit_note_id', 'TEXT');
  const ownCol = db.pragma('table_info(entities)').map((c) => c.name);
  if (ownCol.length && !ownCol.includes('is_sjvn_own')) {
    db.exec('ALTER TABLE entities ADD COLUMN is_sjvn_own INTEGER NOT NULL DEFAULT 0');
    // SJVN's own hydro stations, registered as sellers so their bills run here.
    db.prepare(`UPDATE entities SET is_sjvn_own = 1 WHERE id IN ('SEL-NJHPS', 'SEL-RHPS')`).run();
  }
  // SJVN's own stations are cost-plus generation on the Hydro desk, not REIA
  // developers: keep them out of the REIA stakeholder register.
  if (ownCol.length) {
    db.prepare(`UPDATE entities SET verticals = 'HYDRO' WHERE is_sjvn_own = 1 AND COALESCE(verticals, 'REIA') = 'REIA'`).run();
  }
  addCol('reconciliations', 'finance_ack_by', 'TEXT');

  // A CHECK list grown by a value: SQLite cannot alter one in place, so the
  // table is rebuilt from its own DDL with the list widened, indexes and all.
  const widenCheck = (table, from, to) => {
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
    if (!ddl || !ddl.includes(from)) return;
    const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table).map((r) => r.sql);
    const newDdl = ddl.replace(from, to).replace(/CREATE TABLE\s+("?)(\w+)\1/i, `CREATE TABLE ${table}__new`);
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(newDdl);
        db.exec(`INSERT INTO ${table}__new SELECT * FROM ${table}`);
        db.exec(`DROP TABLE ${table}`);
        db.exec(`ALTER TABLE ${table}__new RENAME TO ${table}`);
        for (const sql of indexes) db.exec(sql);
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  };
  widenCheck('reia_fi_postings', "CHECK (category IN ('SALE','PURCHASE','CREDIT_NOTE'))", "CHECK (category IN ('SALE','PURCHASE','CREDIT_NOTE','POOL'))");
  // A push SAP never answered is UNKNOWN (28-Oct-2026); the first SAP build
  // created the table without it.
  widenCheck('reia_sap_pushes', "CHECK (status IN ('SENT','FAILED','BOOKED'))", "CHECK (status IN ('UNKNOWN','SENT','FAILED','BOOKED'))");

  const MARK = 'decisions_2026_10_17_defaults';
  const done = db.prepare('SELECT 1 FROM system_parameters WHERE param_key = ?').get(MARK);
  if (done) return;
  const flips = [
    ['invoice_approval_distinct_approvers', '0', '1'],
    ['due_date_counting_mode', 'WORKING_DAYS', 'CALENDAR_ROLL_FORWARD'],
    ['lps_day_count_mode', 'WORKING_DAYS', 'CALENDAR'],
  ];
  const set = db.prepare('UPDATE system_parameters SET param_value = ? WHERE param_key = ? AND param_value = ?');
  db.transaction(() => {
    for (const [key, from, to] of flips) set.run(to, key, from);
    db.prepare(`
      INSERT OR IGNORE INTO system_parameters (id, category, param_key, param_value, data_type, unit, description, effective_from, is_active)
      VALUES (?, 'GENERAL', ?, '1', 'NUMBER', '', 'Marker: the 17-Oct-2026 decision defaults have been applied once.', date('now'), 1)
    `).run(`SP-${MARK}`, MARK);
  })();
}

try {
  migrateDecisions20261017();
} catch (e) {
  console.error('17-Oct-2026 decisions migration failed:', e.message);
}

// Four-eyes on onboarding (thermal QA run 18, 19-Oct-2026): the officer who
// onboarded a company may not approve it. Older records take the officer from
// their creation audit row where one exists, and stay unknown otherwise.
function migrateEntityOnboardedBy() {
  const cols = db.pragma('table_info(entities)').map((c) => c.name);
  if (cols.includes('onboarded_by_user_id')) return;
  db.exec('ALTER TABLE entities ADD COLUMN onboarded_by_user_id TEXT');
  db.prepare(`
    UPDATE entities SET onboarded_by_user_id = (
      SELECT a.user_id FROM audit_logs a
      WHERE a.entity_id = entities.id AND LOWER(a.entity_type) = 'entity'
        AND a.action IN ('ENTITY_CREATED', 'CREATE') AND a.user_id IS NOT NULL
      ORDER BY a.created_at ASC LIMIT 1
    )
  `).run();
}

try {
  migrateEntityOnboardedBy();
} catch (e) {
  console.error('Entity onboarded-by migration failed:', e.message);
}

try {
  db.prepare(`UPDATE contracts SET tariff_structure_json = NULL WHERE tariff_structure_json = '{}' OR tariff_structure_json = '"{}"' OR TRIM(tariff_structure_json) = ''`).run();
} catch (e) {
  // Non-fatal
}

/**
 * Target #2, Phase B (20-Oct-2026): the REIA desk is Maker / Checker /
 * Approver. REIA_USER becomes REIA_MAKER and REIA_ADMIN becomes REIA_CHECKER;
 * REIA_APPROVER (the HOD) is new. The old names stay in the CHECK list so a row
 * written by an older build, or a token issued before this ran, is still read —
 * middleware/auth.js treats them as the new roles — but no account keeps them.
 *
 * The table is rebuilt from its own current DDL, so every column added since
 * (phone, designation, sessions_revoked_at …) is carried over, not just the
 * original eight.
 */
const REIA_ROLE_RENAMES = { REIA_USER: 'REIA_MAKER', REIA_ADMIN: 'REIA_CHECKER' };
function migrateReiaThreeTier() {
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql;
  if (!ddl) return;
  if (!ddl.includes('REIA_APPROVER')) {
    const widened = ddl
      .replace(/CREATE TABLE "?users"?/, 'CREATE TABLE users_role_migration')
      .replace("'REIA_USER'", "'REIA_USER', 'REIA_MAKER', 'REIA_CHECKER', 'REIA_APPROVER'");
    if (!widened.includes('REIA_APPROVER')) throw new Error('users.role CHECK has no REIA_USER to widen from');
    const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    db.exec('PRAGMA foreign_keys=OFF');
    try {
      db.transaction(() => {
        db.exec('DROP TABLE IF EXISTS users_role_migration');
        db.exec(widened);
        db.exec(`INSERT INTO users_role_migration (${cols.join(',')}) SELECT ${cols.join(',')} FROM users`);
        db.exec('DROP TABLE users');
        db.exec('ALTER TABLE users_role_migration RENAME TO users');
      })();
      console.log('[MIGRATE] users.role widened for REIA maker / checker / approver');
    } finally {
      db.exec('PRAGMA foreign_keys=ON');
    }
  }
  for (const [from, to] of Object.entries(REIA_ROLE_RENAMES)) {
    const n = db.prepare('UPDATE users SET role = ? WHERE role = ?').run(to, from).changes;
    if (n) console.log(`[MIGRATE] ${n} ${from} account(s) are now ${to}`);
    // A notification addressed to a role is read by whoever holds that role
    // now; left on the old name it would reach nobody. The audit trail is not
    // touched: it records the role held when the action was taken.
    db.prepare('UPDATE notifications SET role = ? WHERE role = ?').run(to, from);
  }
}

/**
 * The demo REIA approver (HOD), beside the demo maker and checker. Only on a
 * database that already carries the demo REIA accounts — never on one that
 * does not, so no demo login appears on a real installation.
 */
function seedReiaApprover() {
  if (!db.prepare("SELECT 1 FROM users WHERE email = 'reia@sjvn.in'").get()) return;
  if (db.prepare("SELECT 1 FROM users WHERE email = 'reia.approver@sjvn.in'").get()) return;
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, linked_entity_id, is_active)
    VALUES ('USR-REIA-APPROVER', 'Vikram (REIA HOD, Approver)', 'reia.approver@sjvn.in', ?, 'REIA_APPROVER', NULL, 1)
  `).run(bcrypt.hashSync('password123', 8));
  console.log('[SEED] reia.approver@sjvn.in seeded as REIA_APPROVER');
}

/**
 * Public Circulars & Statutory Disclosures table (published from /admin/circulars).
 */
function migratePublicCirculars() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS public_circulars (
      id TEXT PRIMARY KEY,
      circular_no TEXT NOT NULL,
      title_en TEXT NOT NULL,
      title_hi TEXT,
      category TEXT NOT NULL CHECK (category IN (
        'REIA_TENDER','CORRIGENDUM','CERC_FORM_IV','POWER_MARKET','REGULATORY_ORDER','GENERAL'
      )),
      issue_date TEXT NOT NULL,
      file_url TEXT,
      file_name TEXT,
      file_size_bytes INTEGER DEFAULT 0,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_public_circulars_active ON public_circulars (is_active, is_pinned, issue_date DESC);
  `);
}

/**
 * SJVN Generation Assets Master table (power plants on National GIS Map).
 */
function migrateGenerationAssets() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hindi_name TEXT,
      type TEXT NOT NULL CHECK (type IN ('HYDRO','THERMAL','SOLAR','WIND','PSP','REIA')),
      capacity TEXT NOT NULL,
      capacity_num REAL NOT NULL,
      config TEXT,
      location TEXT NOT NULL,
      state TEXT NOT NULL,
      state_code TEXT NOT NULL,
      basin TEXT,
      grid TEXT,
      status TEXT NOT NULL,
      status_category TEXT NOT NULL CHECK (status_category IN ('OPERATIONAL','UNDER_CONSTRUCTION','DEVELOPMENT')),
      status_color TEXT DEFAULT '#10b981',
      design_energy TEXT,
      beneficiaries TEXT,
      coords_x REAL NOT NULL,
      coords_y REAL NOT NULL,
      color TEXT,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gen_assets_active ON generation_assets (is_active, type, state_code);
  `);

  const count = db.prepare('SELECT COUNT(*) as c FROM generation_assets').get()?.c || 0;
  if (count === 0) {
    const SEED_GEN_ASSETS = [
      { id: 'NJHPS', name: 'Nathpa Jhakri HPS', hindi_name: 'नाथपा झाकड़ी जलविद्युत स्टेशन', type: 'HYDRO', capacity: '1,500 MW', capacity_num: 1500, config: '6 × 250 MW Francis Turbines', location: 'Shimla & Kinnaur, Himachal Pradesh', state: 'Himachal Pradesh', state_code: 'HP', basin: 'Satluj River Basin', grid: 'Northern Regional Grid (NRPC)', status: 'Operational · Flagship', status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: '6,950 MUs / year', beneficiaries: 'Punjab, Haryana, Delhi, HP, Rajasthan, UP, J&K, Chandigarh', coords_x: 223.4, coords_y: 151.0, color: '#0284c7', description: "India's premier underground hydro station on the Satluj river with one of the world's largest deep desilting chambers." },
      { id: 'RHPS', name: 'Rampur Hydro Station', hindi_name: 'रामपुर जलविद्युत स्टेशन', type: 'HYDRO', capacity: '412 MW', capacity_num: 412, config: '6 × 68.67 MW Francis Cascade', location: 'Shimla & Kullu, Himachal Pradesh', state: 'Himachal Pradesh', state_code: 'HP', basin: 'Satluj River (Tandem Cascade)', grid: 'Northern Regional Grid (NRPC)', status: 'Operational', status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: '1,878 MUs / year', beneficiaries: 'Northern Region Beneficiary States', coords_x: 217.0, coords_y: 153.3, color: '#0284c7', description: 'Eco-friendly cascade utilizing tailrace discharge from Nathpa Jhakri with zero reservoir requirement.' },
      { id: 'LUHRI', name: 'Luhri Hydro Project (Stage-I)', hindi_name: 'लूहरी जलविद्युत परियोजना (चरण-1)', type: 'HYDRO', capacity: '210 MW', capacity_num: 210, config: 'Run-of-River Dam Scheme (2 × 80 MW + 2 × 25 MW)', location: 'Shimla & Kullu, Himachal Pradesh', state: 'Himachal Pradesh', state_code: 'HP', basin: 'Satluj River Basin', grid: 'NRPC Grid Interconnection', status: 'Under Construction', status_category: 'UNDER_CONSTRUCTION', status_color: '#f59e0b', design_energy: '758 MUs / year', beneficiaries: 'Himachal Pradesh & Northern Grid', coords_x: 213.0, coords_y: 155.7, color: '#0284c7', description: 'Key upcoming clean baseload project advancing towards scheduled commissioning on the Satluj.' },
      { id: 'LUHRI_2', name: 'Luhri Hydro Project (Stage-II)', hindi_name: 'लूहरी जलविद्युत परियोजना (चरण-2)', type: 'HYDRO', capacity: '172 MW', capacity_num: 172, config: 'Run-of-River Scheme', location: 'Shimla & Mandi, Himachal Pradesh', state: 'Himachal Pradesh', state_code: 'HP', basin: 'Satluj River Basin', grid: 'NRPC Interconnection', status: 'In Development', status_category: 'DEVELOPMENT', status_color: '#38bdf8', design_energy: '620 MUs / year', beneficiaries: 'Northern Regional Grid Discoms', coords_x: 209.8, coords_y: 154.2, color: '#0284c7', description: 'Downstream cascade project on Satluj optimizing hydroelectric potential between Luhri-I and Sunni Dam.' },
      { id: 'SUNNI', name: 'Sunni Dam Hydro Project', hindi_name: 'सुन्नी बांध जलविद्युत परियोजना', type: 'HYDRO', capacity: '382 MW', capacity_num: 382, config: 'Run-of-the-River with Diurnal Pondage', location: 'Shimla & Mandi, Himachal Pradesh', state: 'Himachal Pradesh', state_code: 'HP', basin: 'Satluj River Basin', grid: 'NRPC Interconnection', status: 'Under Construction', status_category: 'UNDER_CONSTRUCTION', status_color: '#f59e0b', design_energy: '1,382 MUs / year', beneficiaries: 'Northern Grid Discoms', coords_x: 207.4, coords_y: 157.4, color: '#0284c7', description: 'High-head hydro project balancing renewable integration in the Northern Regional Grid.' },
      { id: 'DHAULASIDH', name: 'Dhaulasidh Hydro Project', hindi_name: 'धौलासिद्ध जलविद्युत परियोजना', type: 'HYDRO', capacity: "69.5 MW", capacity_num: 69.5, config: "Run-of-River Scheme", location: 'Hamirpur & Kangra, Himachal Pradesh', state: 'Himachal Pradesh', state_code: 'HP', basin: 'Beas River Basin', grid: 'HP State Grid / NRPC', status: 'Under Construction', status_category: 'UNDER_CONSTRUCTION', status_color: '#f59e0b', design_energy: '247 MUs / year', beneficiaries: 'HP State Electricity Board & Northern Grid', coords_x: 195.5, coords_y: 145.6, color: '#0284c7', description: 'Vital regional hydro project supplying clean peaking energy on the Beas River.' },
      { id: 'JANGI', name: 'Jangi Thopan Powari Hydro Project', hindi_name: 'जंगी थोपन पोवारी जलविद्युत परियोजना', type: 'HYDRO', capacity: '804 MW', capacity_num: 804, config: 'Run-of-River High Head Scheme', location: 'Kinnaur, Himachal Pradesh', state: 'Himachal Pradesh', state_code: 'HP', basin: 'Upper Satluj Basin', grid: 'NRPC / National Grid', status: 'In Development', status_category: 'DEVELOPMENT', status_color: '#38bdf8', design_energy: '3,200 MUs / year', beneficiaries: 'Northern Region States', coords_x: 229.5, coords_y: 147.2, color: '#0284c7', description: 'Major upcoming high-capacity hydro asset on the upper reaches of the Satluj river.' },
      { id: 'NAITWAR', name: 'Naitwar Mori HPS', hindi_name: 'नैटवाड़ मोरी जलविद्युत स्टेशन', type: 'HYDRO', capacity: '60 MW', capacity_num: 60, config: '2 × 30 MW Francis Units', location: 'Uttarkashi, Uttarakhand', state: 'Uttarakhand', state_code: 'UK', basin: 'Tons River (Yamuna Basin)', grid: 'NRPC Grid Connection', status: 'Operational', status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: '265 MUs / year', beneficiaries: 'Uttarakhand Power Corp & Home State', coords_x: 224.9, coords_y: 161.7, color: '#0284c7', description: 'Commissioned run-of-the-river hydroelectric scheme in Uttarakhand with dedicated 220 kV evacuation line.' },
      { id: 'DEVSARI', name: 'Devsari Hydro Electric Project', hindi_name: 'देवसारी जलविद्युत परियोजना', type: 'HYDRO', capacity: '252 MW', capacity_num: 252, config: '3 × 84 MW Underground Francis Turbines', location: 'Chamoli, Uttarakhand', state: 'Uttarakhand', state_code: 'UK', basin: 'Pindar River (Alaknanda Basin)', grid: 'NRPC Interconnection', status: 'In Development', status_category: 'DEVELOPMENT', status_color: '#38bdf8', design_energy: '910 MUs / year', beneficiaries: 'Uttarakhand & Northern Regional Discoms', coords_x: 252.0, coords_y: 176.0, color: '#0284c7', description: 'Environment-friendly run-of-river scheme on Pindar River in Uttarakhand.' },
      { id: 'ARUN_3', name: 'Arun-3 Hydro Electric Project (Cross-Border)', hindi_name: 'अरुण-3 जलविद्युत परियोजना (900 MW नेपाल)', type: 'HYDRO', capacity: '900 MW', capacity_num: 900, config: '4 × 225 MW Vertical Francis Turbines', location: 'Sankhuwasabha, Nepal (Evacuating to Sitamarhi, Bihar)', state: 'Cross-Border (Nepal-India)', state_code: 'NP', basin: 'Arun River Basin', grid: 'ERPC / 400 kV Cross-Border D/C Line to India', status: 'Under Construction · Flagship SAPDC', status_category: 'UNDER_CONSTRUCTION', status_color: '#f59e0b', design_energy: '4,018 MUs / year', beneficiaries: 'Nepal (21.9% free energy), balance to Indian National Grid (ERPC/NRPC)', coords_x: 395.0, coords_y: 228.0, color: '#0284c7', description: "SJVN's premier cross-border venture via SAPDC with dedicated 400 kV D/C transmission corridor into Sitamarhi, Bihar." },
      { id: 'LOWER_ARUN', name: 'Lower Arun Hydro Project', hindi_name: 'लोअर अरुण जलविद्युत परियोजना', type: 'HYDRO', capacity: '669 MW', capacity_num: 669, config: 'Tandem Cascade Scheme below Arun-3', location: 'Sankhuwasabha & Bhojpur, Nepal', state: 'Cross-Border (Nepal-India)', state_code: 'NP', basin: 'Arun River Basin', grid: 'ERPC Interconnection', status: 'In Development · SLPDC', status_category: 'DEVELOPMENT', status_color: '#38bdf8', design_energy: '2,900 MUs / year', beneficiaries: 'Indian Grid & Nepal', coords_x: 402.0, coords_y: 232.0, color: '#0284c7', description: 'Downstream cascade harnessing tailrace outflow of Arun-3 with zero reservoir inundation.' },
      { id: 'BUXAR', name: 'Buxar Thermal Power Plant', hindi_name: 'बक्सर सुपरक्रिटिकल थर्मल पावर प्लांट', type: 'THERMAL', capacity: '1,320 MW', capacity_num: 1320, config: '2 × 660 MW Supercritical Boilers', location: 'Chausa, Buxar, Bihar', state: 'Bihar', state_code: 'BR', basin: 'Ganga Plains (Eastern India)', grid: 'Eastern Regional Grid (ERPC)', status: "Operational · Unit-1 COD Nov 2025, Unit-2 COD Sep 2026", status_category: "OPERATIONAL", status_color: "#10b981", design_energy: '9,828 MUs / year', beneficiaries: 'Bihar Discoms (85%), Eastern Grid', coords_x: 333.0, coords_y: 280.6, color: '#ea580c', description: 'Ultra-modern supercritical coal-fired baseload powerhouse featuring low-emission FGD and high thermal efficiency via STPL.' },
      { id: 'BIKANER', name: 'Bikaner Solar Power Project', hindi_name: 'बीकानेर 1000 MW सौर ऊर्जा पार्क', type: 'SOLAR', capacity: '1,000 MW', capacity_num: 1000, config: 'High-Efficiency Bifacial Solar Modules', location: 'Bikaner, Rajasthan', state: 'Rajasthan', state_code: 'RJ', basin: 'Thar High-Irradiance Zone', grid: 'National ISTS Grid (Northern Grid)', status: 'Operational · CPSU Scheme', status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: '2,450 MUs / year', beneficiaries: 'Pan-India Discoms under MNRE CPSU Scheme', coords_x: 133.7, coords_y: 222.4, color: '#eab308', description: "One of India's largest single-location utility solar projects directly evacuating through 765 kV ISTS network." },
      { id: 'OMKARESHWAR', name: 'Omkareshwar Floating Solar Project', hindi_name: 'ओंकारेश्वर 90 MW फ्लोटिंग सोलर प्लांट', type: 'SOLAR', capacity: '90 MW', capacity_num: 90, config: 'Reservoir Floating Solar PV Array', location: 'Khandwa, Madhya Pradesh', state: 'Madhya Pradesh', state_code: 'MP', basin: 'Narmada River Reservoir', grid: 'WRPC / MPPMCL State Grid', status: 'Operational', status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: '196 MUs / year', beneficiaries: 'MP Power Management Company Ltd (MPPMCL)', coords_x: 182.0, coords_y: 358.0, color: '#eab308', description: 'Landmark floating solar installation on Omkareshwar reservoir conserving land and reducing water evaporation.' },
      { id: 'KHAVDA', name: "Khavda Solar Project", hindi_name: "खावड़ा 200 MW सौर परियोजना", type: 'SOLAR', capacity: "200 MW", capacity_num: 200, config: "Utility-scale solar PV, 200 MW (AC)", location: 'Kutch, Gujarat', state: 'Gujarat', state_code: 'GJ', basin: 'Rann of Kutch Hybrid Zone', grid: 'Western Regional Grid (WRPC / ISTS)', status: 'Under Construction', status_category: 'UNDER_CONSTRUCTION', status_color: '#f59e0b', design_energy: null, beneficiaries: "Gujarat Urja Vikas Nigam Ltd (GUVNL)", coords_x: 60.2, coords_y: 307.1, color: '#eab308', description: "200 MW (AC) at Khavda Solar Park, Kutch, by SJVN Green Energy; the power goes to GUVNL under a PPA." },
      { id: 'RAGHANESDA', name: "Radhanesda Solar Project", hindi_name: "राधनेसडा 100 MW सौर ऊर्जा परियोजना", type: 'SOLAR', capacity: '100 MW', capacity_num: 100, config: 'Ground Mounted Utility Solar', location: 'Banaskantha, Gujarat', state: 'Gujarat', state_code: 'GJ', basin: 'North Gujarat Solar Belt', grid: 'GUVNL / WRPC Network', status: 'Operational', status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: '240 MUs / year', beneficiaries: 'Gujarat Urja Vikas Nigam Ltd (GUVNL)', coords_x: 87.2, coords_y: 299.8, color: '#eab308', description: 'Fully commissioned grid-tied utility project generating reliable green power for Gujarat.' },
      { id: 'CHARANKA', name: 'Charanka Solar Power Station', hindi_name: "चारणका 5.6 MW सौर ऊर्जा केंद्र (पहला सौर संयंत्र)", type: 'SOLAR', capacity: "5.6 MW", capacity_num: 5.6, config: 'Crystalline PV Array (SJVN Maiden Solar)', location: 'Patan, Gujarat', state: 'Gujarat', state_code: 'GJ', basin: 'Patan Solar Park', grid: 'GETCO / GUVNL Grid', status: 'Operational · Pioneer', status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: '8.5 MUs / year', beneficiaries: 'Gujarat Discoms', coords_x: 90.5, coords_y: 308.0, color: '#eab308', description: "SJVN's foundational utility solar installation marking entry into the renewable energy sector." },
      { id: 'DHOLERA', name: 'Dholera Solar Park', hindi_name: 'धोलेरा 100 MW सौर ऊर्जा संयंत्र', type: 'SOLAR', capacity: '100 MW', capacity_num: 100, config: 'Smart Inverter Ground Array', location: 'Dholera SIR, Gujarat', state: 'Gujarat', state_code: 'GJ', basin: 'Gulf of Khambhat Industrial Region', grid: 'WRPC / GUVNL Network', status: 'Awarded 2020 · commissioning not confirmed', status_category: 'UNDER_CONSTRUCTION', status_color: '#f59e0b', design_energy: '228 MUs / year', beneficiaries: 'GUVNL & Western Grid Offtakers', coords_x: 105.1, coords_y: 344.8, color: '#eab308', description: '100 MW won in the GUVNL Dholera tender (2020) at ₹2.80/unit. SJVN reports no commissioning yet, and its FY26 operating total does not include it.' },
      { id: 'PARASAN', name: 'Parasan Solar Power Plant', hindi_name: 'परासन 75 MW सौर ऊर्जा संयंत्र', type: 'SOLAR', capacity: '75 MW', capacity_num: 75, config: 'Fixed Tilt Utility Ground Mount Array', location: 'Jalaun, Uttar Pradesh', state: 'Uttar Pradesh', state_code: 'UP', basin: 'Bundelkhand Sun Corridor', grid: 'UPPCL / NRPC Network', status: 'Operational', status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: '165 MUs / year', beneficiaries: 'Uttar Pradesh Power Corp (UPPCL)', coords_x: 246.4, coords_y: 266.5, color: '#eab308', description: 'Operational solar park energizing the Bundelkhand clean energy transmission highway.' },
      { id: 'GURAH', name: 'Gurah Solar Power Plant', hindi_name: 'गुरहा 75 MW सौर ऊर्जा संयंत्र', type: 'SOLAR', capacity: '75 MW', capacity_num: 75, config: 'High-Efficiency Multi-String Inverter Array', location: 'Jalaun, Uttar Pradesh', state: 'Uttar Pradesh', state_code: 'UP', basin: 'Bundelkhand Clean Energy Highway', grid: 'UPPCL / NRPC Network', status: 'Operational', status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: '165 MUs / year', beneficiaries: 'UPPCL State Discoms', coords_x: 254.0, coords_y: 270.0, color: '#eab308', description: 'Commissioned utility solar station feeding stable renewable power into Uttar Pradesh.' },
      { id: 'GUJRAI', name: 'Gujrai Solar Power Plant', hindi_name: 'गुजराई 50 MW सौर ऊर्जा संयंत्र', type: 'SOLAR', capacity: '50 MW', capacity_num: 50, config: 'Smart Monofacial PV Ground Installation', location: 'Kanpur Dehat, Uttar Pradesh', state: 'Uttar Pradesh', state_code: 'UP', basin: 'Central UP Green Corridor', grid: 'UPPCL Network', status: 'Operational', status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: '110 MUs / year', beneficiaries: 'UPPCL Offtakers', coords_x: 265.0, coords_y: 264.0, color: '#eab308', description: 'Operational solar plant in Kanpur Dehat delivering clean green electrons under long-term PPA.' },
      { id: 'JAMUI', name: 'Jamui Solar Power Project', hindi_name: "जमुई 75 MW सौर ऊर्जा परियोजना", type: 'SOLAR', capacity: "75 MW", capacity_num: 75, config: "Ground-mounted solar PV (SJVN Green Energy)", location: 'Jamui, Bihar', state: 'Bihar', state_code: 'BR', basin: 'South Bihar Green Corridor', grid: 'BSPHCL / Eastern Grid (ERPC)', status: "Operational · COD Aug 2026", status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: "90 MUs (first year)", beneficiaries: 'Bihar State Power Holding Company Ltd (BSPHCL)', coords_x: 372.0, coords_y: 292.0, color: '#eab308', description: "75 MW at Kakanchor, Jamui, built by SJVN Green Energy for the Bihar discoms." },
      { id: 'BANKA', name: 'Banka Solar Power Project', hindi_name: 'बांका 75 MW सौर ऊर्जा परियोजना', type: 'SOLAR', capacity: '75 MW', capacity_num: 75, config: 'Ground Mounted Grid-tied PV Park', location: 'Banka, Bihar', state: 'Bihar', state_code: 'BR', basin: 'Eastern Bihar Renewable Basin', grid: 'BSPHCL / ERPC Network', status: 'Under Construction', status_category: 'UNDER_CONSTRUCTION', status_color: '#f59e0b', design_energy: '165 MUs / year', beneficiaries: 'Bihar State Discoms', coords_x: 388.0, coords_y: 294.0, color: '#eab308', description: 'Under-construction solar project advancing renewable procurement targets in Bihar.' },
      { id: 'DHUBRI', name: 'Dhubri Solar Power Project', hindi_name: "धुबरी 70 MW सौर ऊर्जा परियोजना", type: 'SOLAR', capacity: '70 MW', capacity_num: 70, config: "Ground-mounted solar PV (SJVN Green Energy)", location: 'Dhubri, Assam', state: 'Assam', state_code: 'AS', basin: 'Brahmaputra Valley Corridor', grid: 'NERPC (North-Eastern Regional Grid)', status: "Operational · COD Feb 2026", status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: "141 MUs (first year)", beneficiaries: 'Assam Power Distribution Company Ltd (APDCL)', coords_x: 456.0, coords_y: 272.0, color: '#eab308', description: "Assam's first utility-scale solar plant, built by SJVN Green Energy on land leased from APDCL; APDCL buys the power at ₹3.92/unit." },
      { id: 'KHIRVIRE_WIND', name: 'Khirvire Wind Power Project', hindi_name: 'खिड़विरे 47.6 MW पवन ऊर्जा संयंत्र', type: 'WIND', capacity: '47.6 MW', capacity_num: 47.6, config: '56 × 850 kW Gamesa Wind Turbines', location: 'Ahmednagar, Maharashtra', state: 'Maharashtra', state_code: 'MH', basin: 'Western Ghats Wind Corridor', grid: 'MSEDCL / Western Grid (WRPC)', status: 'Operational', status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: '90 MUs / year', beneficiaries: 'Maharashtra State Electricity Distribution Co (MSEDCL)', coords_x: 145.0, coords_y: 432.0, color: '#10b981', description: "SJVN's high-performing commercial wind farm situated along the high-wind ridgelines of Maharashtra." },
      { id: 'SADLA_WIND', name: 'Sadla Wind Power Project', hindi_name: 'सादला 50 MW पवन ऊर्जा संयंत्र', type: 'WIND', capacity: '50 MW', capacity_num: 50, config: '25 × 2.0 MW Suzlon Wind Turbine Generators', location: 'Surendranagar, Gujarat', state: 'Gujarat', state_code: 'GJ', basin: 'Saurashtra High-Wind Regimes', grid: 'GUVNL / WRPC Network', status: 'Operational', status_category: 'OPERATIONAL', status_color: '#10b981', design_energy: '115 MUs / year', beneficiaries: 'Gujarat Urja Vikas Nigam Ltd (GUVNL)', coords_x: 93.0, coords_y: 332.0, color: '#10b981', description: 'High-availability wind generating asset in Saurashtra feeding green energy into the Western Grid.' },
      { id: 'MAHA_PSP', name: 'Maharashtra Pumped Storage Portfolio', hindi_name: 'महाराष्ट्र 8,100 MW पंप्ड स्टोरेज प्रोजेक्ट्स', type: 'PSP', capacity: '8,100 MW', capacity_num: 8100, config: "5 PSPs: Kolmondapada 800, Sidgarh 1,500, Chornai 2,000, Baitarni 1,800, Jalvara 2,000 MW", location: 'Western Ghats, Maharashtra', state: 'Maharashtra', state_code: 'MH', basin: 'Sahyadri Hydro-Peaking Corridors', grid: 'Western Regional Grid (WRPC)', status: 'In Development · MoU Signed', status_category: 'DEVELOPMENT', status_color: '#8b5cf6', design_energy: null, beneficiaries: 'Govt. of Maharashtra, National Grid Storage Mandate', coords_x: 155.0, coords_y: 450.0, color: '#8b5cf6', description: "MoU with the Govt. of Maharashtra (Water Resources Dept., Sept 2024) for five pumped storage projects; estimated investment ₹48,000 crore." },
      { id: 'DARZO_PSP', name: "Darzo Lui Pumped Storage Project", hindi_name: "दार्ज़ो लुई 2,400 MW पंप्ड स्टोरेज परियोजना", type: 'PSP', capacity: "2,400 MW", capacity_num: 2400, config: 'Reversible Pump Turbine Units', location: "Mizoram", state: 'Mizoram', state_code: 'MZ', basin: "Darzo Nallah (tributary of the Tuipui)", grid: 'NERPC Interconnection', status: "In Development · LoI from Govt. of Mizoram (Jul 2024)", status_category: 'DEVELOPMENT', status_color: '#8b5cf6', design_energy: null, beneficiaries: 'Govt. of Mizoram & North-Eastern Grid', coords_x: 508.0, coords_y: 335.0, color: '#8b5cf6', description: "Letter of Intent from the Govt. of Mizoram in July 2024; estimated cost ₹13,947.50 crore at April 2023 prices." },
      { id: 'REIA_ISTS', name: 'REIA Pan-India Bidding Mandate', hindi_name: 'REIA राष्ट्रीय नवीकरणीय निविदा पोर्टफोलियो', type: 'REIA', capacity: '2,400+ MW', capacity_num: 2400, config: 'Solar · Wind · RTC Hybrid ISTS Tenders', location: 'Pan-India ISTS Sub-stations (RJ, GJ, MP, MH, AP, TN)', state: 'Pan-India (ISTS)', state_code: 'ISTS', basin: 'National Clean Energy Footprint', grid: 'National Transmission Grid (ISTS)', status: 'MNRE Mandate · Active Tendering', status_category: 'OPERATIONAL', status_color: '#3b82f6', design_energy: 'Over 5,800 MUs contracted', beneficiaries: 'Multiple State Discoms & Offtakers nationwide', coords_x: 207.7, coords_y: 327.6, color: '#6366f1', description: 'Designated Renewable Energy Implementing Agency (REIA) by Ministry of Power / MNRE for utility-scale procurement and tariff management.' }
    ];

    const insert = db.prepare(`
      INSERT OR IGNORE INTO generation_assets (
        id, name, hindi_name, type, capacity, capacity_num, config, location,
        state, state_code, basin, grid, status, status_category, status_color,
        design_energy, beneficiaries, coords_x, coords_y, color, description, is_active
      ) VALUES (
        @id, @name, @hindi_name, @type, @capacity, @capacity_num, @config, @location,
        @state, @state_code, @basin, @grid, @status, @status_category, @status_color,
        @design_energy, @beneficiaries, @coords_x, @coords_y, @color, @description, 1
      )
    `);

    const insertMany = db.transaction((assets) => {
      for (const a of assets) insert.run(a);
    });

    insertMany(SEED_GEN_ASSETS);
    console.log(`[SEED] Seeded ${SEED_GEN_ASSETS.length} generation assets into generation_assets table.`);
  }

  // Corrections to the first seed (checked against SJVN's own releases, 22-Oct-2026).
  // A row is touched only while it still holds the figure first seeded, so an
  // administrator's own edit is never overwritten. The 'Jaisalmer Wind Station'
  // was never an SJVN plant: its 47.6 MW is the Khirvire project in Maharashtra.
  const fixes = [
    ['JAMUI', 'capacity_num', 200, { capacity: '75 MW', capacity_num: 75, hindi_name: 'जमुई 75 MW सौर ऊर्जा परियोजना', config: 'Ground-mounted solar PV (SJVN Green Energy)', status: 'Operational · COD Aug 2026', design_energy: '90 MUs (first year)', description: '75 MW at Kakanchor, Jamui, built by SJVN Green Energy for the Bihar discoms.' }],
    ['KHAVDA', 'capacity_num', 700, { name: 'Khavda Solar Project', hindi_name: 'खावड़ा 200 MW सौर परियोजना', capacity: '200 MW', capacity_num: 200, config: 'Utility-scale solar PV, 200 MW (AC)', design_energy: null, beneficiaries: 'Gujarat Urja Vikas Nigam Ltd (GUVNL)', description: '200 MW (AC) at Khavda Solar Park, Kutch, by SJVN Green Energy; the power goes to GUVNL under a PPA.' }],
    ['DARZO_PSP', 'capacity_num', 1500, { name: 'Darzo Lui Pumped Storage Project', hindi_name: 'दार्ज़ो लुई 2,400 MW पंप्ड स्टोरेज परियोजना', capacity: '2,400 MW', capacity_num: 2400, location: 'Mizoram', basin: 'Darzo Nallah (tributary of the Tuipui)', status: 'In Development · LoI from Govt. of Mizoram (Jul 2024)', design_energy: null, description: 'Letter of Intent from the Govt. of Mizoram in July 2024; estimated cost ₹13,947.50 crore at April 2023 prices.' }],
    ['MAHA_PSP', 'config', '5 Closed-loop PSP Stations (Kolleru, Malshej, etc.)', { config: '5 PSPs: Kolmondapada 800, Sidgarh 1,500, Chornai 2,000, Baitarni 1,800, Jalvara 2,000 MW', design_energy: null, description: 'MoU with the Govt. of Maharashtra (Water Resources Dept., Sept 2024) for five pumped storage projects; estimated investment ₹48,000 crore.' }],
    ['CHARANKA', 'capacity_num', 5, { capacity: '5.6 MW', capacity_num: 5.6, hindi_name: 'चारणका 5.6 MW सौर ऊर्जा केंद्र (पहला सौर संयंत्र)' }],
    ['DHAULASIDH', 'capacity_num', 66, { capacity: '69.5 MW', capacity_num: 69.5, config: 'Run-of-River Scheme' }],
    ['BUXAR', 'status_category', 'UNDER_CONSTRUCTION', { status: 'Operational · Unit-1 COD Nov 2025, Unit-2 COD Sep 2026', status_category: 'OPERATIONAL', status_color: '#10b981' }],
    ['DHUBRI', 'status', 'Operational · SGEL-APDCL JV', { hindi_name: 'धुबरी 70 MW सौर ऊर्जा परियोजना', config: 'Ground-mounted solar PV (SJVN Green Energy)', status: 'Operational · COD Feb 2026', design_energy: '141 MUs (first year)', description: "Assam's first utility-scale solar plant, built by SJVN Green Energy on land leased from APDCL; APDCL buys the power at ₹3.92/unit." }],
    ['DHOLERA', 'status', 'Operational', { status: 'Awarded 2020 · commissioning not confirmed', status_category: 'UNDER_CONSTRUCTION', status_color: '#f59e0b', description: '100 MW won in the GUVNL Dholera tender (2020) at ₹2.80/unit. SJVN reports no commissioning yet, and its FY26 operating total does not include it.' }],
    ['RAGHANESDA', 'name', 'Raghanesda Solar Park', { name: 'Radhanesda Solar Project', hindi_name: 'राधनेसडा 100 MW सौर ऊर्जा परियोजना' }],
  ];
  const fixAll = db.transaction(() => {
    for (const [id, col, seeded, to] of fixes) {
      const row = db.prepare(`SELECT ${col} AS v FROM generation_assets WHERE id = ?`).get(id);
      if (!row || row.v !== seeded) continue;
      const cols = Object.keys(to);
      db.prepare(`UPDATE generation_assets SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`).run({ ...to, id });
    }
    db.prepare(`DELETE FROM generation_assets WHERE id = 'JAISALMER_WIND' AND name = 'Jaisalmer Wind Station'`).run();
  });
  fixAll();
}

/**
 * Roles an administrator makes on the Role Powers screen (30-Oct-2026) are
 * CUSTOM_<NAME>, which the users.role CHECK has to admit. The table is rebuilt
 * from its own DDL, as for the REIA tiers above, with the one clause added.
 */
function migrateCustomRoles() {
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql;
  if (!ddl || ddl.includes("GLOB 'CUSTOM_*'")) return;
  const widened = ddl
    .replace(/CREATE TABLE "?users"?/, 'CREATE TABLE users_role_migration')
    .replace(/CHECK\s*\(\s*role IN\s*\(/, "CHECK (role GLOB 'CUSTOM_*' OR role IN (");
  if (!widened.includes("GLOB 'CUSTOM_*'")) throw new Error('users.role CHECK not found to widen for made roles');
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.transaction(() => {
      db.exec('DROP TABLE IF EXISTS users_role_migration');
      db.exec(widened);
      db.exec(`INSERT INTO users_role_migration (${cols.join(',')}) SELECT ${cols.join(',')} FROM users`);
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_role_migration RENAME TO users');
    })();
    console.log('[MIGRATE] users.role admits roles made on the Role Powers screen');
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}

try {
  migrateReiaThreeTier();
  migrateCustomRoles();
  seedReiaApprover();
  migratePublicCirculars();
  migrateGenerationAssets();
} catch (e) {
  console.error('Database migration/seed failed:', e.message);
}

export default db;
