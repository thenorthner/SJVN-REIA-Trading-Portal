import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { catalogForEntityType, summarizeApprovals } from '../regulatoryApprovals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'platform.db');

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
  const hasNjhps = db.prepare(`SELECT id FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  if (hasNjhps) {
    const hasBeta = db.prepare(`
      SELECT id FROM station_beta WHERE contract_id = ? AND period_month = '2026-05'
    `).get(hasNjhps.id);
    if (!hasBeta) {
      db.prepare(`
        INSERT INTO station_beta (
          id, contract_id, period_month, beta_value, station_code, station_name,
          source, certified_on, notes, created_by
        ) VALUES (?, ?, '2026-05', 1.00, 'NJHPS', 'NATHPA JHAKRI', 'NRPC', '2026-06-19',
          'NRPC Average Monthly Frequency Response Performance – May 2026', 'SYSTEM')
      `).run('BETA-NJHPS-2026-05', hasNjhps.id);
    }
    return;
  }

  // Create demo seller + hydro PPA if entities table is usable
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

    // If INSERT OR IGNORE skipped due to different id, resolve by contract_no
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
  } catch (e) {
    console.warn('NJHPS beta demo seed skipped:', e.message);
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

export default db;
