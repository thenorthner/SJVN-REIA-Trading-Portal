// Signing in as each demo role, and the few direct reads and repairs the audit
// makes on the suite's throwaway database.
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { LOGINS, DEMO_PASSWORD } from './routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(here, '../.data/e2e.db');
const require = createRequire(path.join(here, '../../../backend/package.json'));
const Database = require('better-sqlite3');

let db;
function database() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('busy_timeout = 5000');
  }
  return db;
}

const tokens = new Map();

/** A signed-in browser context for a role, the way the app keeps its session. */
export async function contextFor(browser, request, baseURL, role) {
  if (!tokens.has(role)) tokens.set(role, await signIn(request, role));
  const { token, user } = tokens.get(role);
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1366, height: 768 },
    acceptDownloads: true,
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(baseURL).origin,
        localStorage: [
          { name: 'sjvn_token', value: token },
          { name: 'sjvn_user', value: JSON.stringify(user) },
        ],
      }],
    },
  });
  // Nothing the page asks for may leave the machine: fonts, maps, analytics.
  await context.route((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => route.abort());
  // A print button opens the browser's print dialog, which headless Chromium
  // swallows; record the call instead so it counts as the button working.
  await context.addInitScript(() => {
    window.print = () => { window.__auditPrinted = (window.__auditPrinted || 0) + 1; };
  });
  return context;
}

async function signIn(request, role) {
  const email = LOGINS[role];
  if (!email) throw new Error(`no demo login for ${role}`);
  const res = await request.post('/api/auth/login', { data: { email, password: DEMO_PASSWORD } });
  if (!res.ok()) throw new Error(`${role} (${email}) could not sign in: ${res.status()} ${await res.text()}`);
  return res.json();
}

/**
 * Put the demo logins back if a button pressed during the audit deactivated
 * one (a "Deactivate user" on the team screen, say), and forget the old token.
 * Returns the emails that had been switched off.
 */
export function healLogins() {
  const emails = Object.values(LOGINS);
  const off = database().prepare(`SELECT email FROM users WHERE is_active = 0 AND email IN (${emails.map(() => '?').join(',')})`)
    .all(...emails).map((r) => r.email);
  if (off.length) {
    database().prepare(`UPDATE users SET is_active = 1 WHERE email IN (${off.map(() => '?').join(',')})`).run(...off);
  }
  tokens.clear();
  return off;
}

// A real record for each detail page, so /:id routes are opened like any other.
const DETAIL_IDS = {
  '/trading/clients/:id': 'SELECT id FROM trading_clients ORDER BY id LIMIT 1',
  '/compliance/noar/:id': 'SELECT application_no FROM noar_approval_entries ORDER BY rowid LIMIT 1',
  '/invoices/view-bill/:id': "SELECT id FROM view_bill_invoices WHERE bill_type LIKE '%ENERGY%' ORDER BY rowid LIMIT 1",
  '/invoices/open-access/:id': "SELECT id FROM view_bill_invoices WHERE bill_type LIKE '%OA%' ORDER BY rowid LIMIT 1",
  '/trading/exchange/contracts/:id': 'SELECT id FROM exchange_contracts ORDER BY id LIMIT 1',
};

/** The concrete URL to open for a route, or null when there is no record to show. */
export function concretePath(route) {
  if (!route.hasParam) return route.path;
  const sql = DETAIL_IDS[route.path];
  if (!sql) return null;
  const row = database().prepare(sql).get();
  const id = row && Object.values(row)[0];
  return id ? route.path.replace(':id', encodeURIComponent(id)) : null;
}
