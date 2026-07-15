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

export default db;
