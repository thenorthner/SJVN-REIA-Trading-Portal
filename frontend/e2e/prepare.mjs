// Runs before the browser suite's server starts (see playwright.config.js):
// builds the UI the server will serve, and seeds a fresh database for it.
//
// It deletes and recreates E2E_DATA_DIR, so it refuses to run unless that folder
// is the suite's own and the database path points inside it — started any other
// way it could otherwise be aimed at the real platform.db.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { build } from 'vite';
import { ADMIN, LOGIN_USER, ENTITIES, CONTRACTS, INVOICE, UNRELATED_DOCUMENT } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '..');
const backendDir = path.resolve(frontendDir, '../backend');
const DATA = process.env.E2E_DATA_DIR;
const DB_PATH = process.env.SJVN_DB_PATH;

if (!DATA || path.resolve(DATA) !== path.join(here, '.data') || !DB_PATH || !path.resolve(DB_PATH).startsWith(path.join(here, '.data'))) {
  console.error('prepare.mjs: run the browser suite with `npm run test:e2e`; E2E_DATA_DIR / SJVN_DB_PATH do not point at e2e/.data.');
  process.exit(1);
}

fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });

await build({
  root: frontendDir,
  logLevel: 'warn',
  build: { outDir: process.env.CLIENT_DIR, emptyOutDir: true },
});

// The project's own demo seed first — a user for every role, contracts, invoices
// and the trading desks — so every screen has something on it to press. It runs
// in its own process (it exits early on a database that already has users) and
// offline, like the server.
const seeded = spawnSync(process.execPath, ['--require', path.join(here, 'offline.cjs'), path.join(backendDir, 'src/db/seed.js')], {
  env: process.env, cwd: DATA, encoding: 'utf8',
});
if (seeded.status !== 0) {
  console.error(seeded.stdout, seeded.stderr);
  throw new Error('the demo seed (backend/src/db/seed.js) failed on the browser suite database');
}

// Then the suite's own fixtures, which the specs look for by name.
const { default: db } = await import(pathToFileURL(path.join(backendDir, 'src/db/index.js')).href);
const require = createRequire(path.join(backendDir, 'package.json'));
const bcrypt = require('bcryptjs');

/** Insert only the columns the table has, so a schema change does not break the seed. */
function insert(table, row) {
  const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  const keys = Object.keys(row).filter((k) => present.has(k));
  db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => row[k]));
}

db.transaction(() => {
  for (const u of [ADMIN, LOGIN_USER]) {
    insert('users', {
      id: u.id, name: u.name, email: u.email, role: u.role,
      password_hash: bcrypt.hashSync(u.password, 8), is_active: 1,
    });
  }
  for (const e of Object.values(ENTITIES)) {
    insert('entities', { ...e, status: 'APPROVED', capacity_mw: 100, pan_no: null, gst_no: null });
  }
  for (const c of Object.values(CONTRACTS)) {
    insert('contracts', { billing_cycle: 'MONTHLY', payment_terms_days: 45, status: 'ACTIVE', version: 1, ...c });
  }
  insert('invoices', INVOICE);
  // The demo seed's trading-client login is not linked to a client, so its whole
  // portal answers "not linked yet". Link it to a seeded client so the portal has
  // an account to show.
  db.prepare("UPDATE users SET linked_entity_id = (SELECT id FROM trading_clients ORDER BY id LIMIT 1) WHERE email = 'client@abctrading.in'").run();
  insert('documents', {
    id: UNRELATED_DOCUMENT.id, entity_id: null, contract_id: null, document_type: UNRELATED_DOCUMENT.document_type,
    category: 'RECORD', title: UNRELATED_DOCUMENT.title, status: 'ACTIVE', created_by: ADMIN.id,
  });
  // A real file behind it, so opening it works and is not mistaken for a fault.
  const docFile = path.join(DATA, 'cerc-mmc-2026-02.pdf');
  fs.writeFileSync(docFile, '%PDF-1.4\n% e2e fixture: CERC MMC report 2026-02\n');
  insert('document_versions', {
    id: `DV-${UNRELATED_DOCUMENT.id}`, document_id: UNRELATED_DOCUMENT.id, version_number: 1,
    file_path: docFile, file_name: 'cerc-mmc-2026-02.pdf', file_size_bytes: fs.statSync(docFile).size,
    mime_type: 'application/pdf', verification_status: 'NOT_REQUIRED', created_by: ADMIN.id,
  });
})();

db.close();
console.log(`[e2e] UI built into ${process.env.CLIENT_DIR}; database seeded at ${DB_PATH}`);
