import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, devices } from '@playwright/test';

// Browser tests for the screens themselves. The API suite (backend/tests) proves
// the server answers correctly; it cannot see a form that never sends a required
// field, a table running out of its box, or a PDF with a blank page. These run
// the real UI against a real server and look.
//
// The server here is the production shape: the backend serving a fresh build of
// the front end on one port, as it does when deployed. It runs on its own port
// with its own throwaway database, evidence folder, backups, CERC folder and
// outbox under e2e/.data, and without backend/.env — so a run never touches the
// development database, your uploads, the tracked CERC reports, or a live SMTP /
// IEX / PXIL account.

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, 'e2e/.data');
const PORT = Number(process.env.E2E_PORT) || 4100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  // One server and one database, and several specs change it (an amendment, an
  // upload), so they run one at a time rather than racing each other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'e2e/.report', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    // A missing element fails in seconds instead of waiting out the test.
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Signs in and raises the dispute, evidence and reconciliation the specs read.
    { name: 'setup', testMatch: /fixtures\.setup\.js/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: /fixtures\.setup\.js/,
      use: {
        ...devices['Desktop Chrome'],
        // A common office laptop. The intern's screenshots came from a screen
        // about this size, and it is where a wide table first runs out of room.
        viewport: { width: 1366, height: 768 },
        storageState: path.join(DATA, 'admin-state.json'),
      },
    },
    // The button audit (e2e/audit, AUDIT_PLAN.md): every screen as every role,
    // every button pressed. Long, so it runs on its own: npm run test:audit.
    {
      name: 'audit',
      dependencies: ['setup'],
      testMatch: /audit\/.*\.audit\.js$/,
      // No trace or screenshot: a screen's test presses hundreds of things, and
      // a trace of that is too large to write reliably. The audit's own rows
      // say what each press did.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 }, trace: 'off', screenshot: 'off' },
    },
  ],
  webServer: {
    // prepare.mjs builds the UI into e2e/.dist and seeds a fresh database; the
    // server then runs from e2e/.data so its outbox lands there too.
    // offline.cjs cuts the server off from the internet: no button pressed in a
    // test can reach CERC, IEX, PXIL, NOAR or a mail relay.
    command: `node e2e/prepare.mjs && cd "${DATA}" && node --require "${path.join(here, 'e2e/offline.cjs')}" "${path.join(here, '../backend/src/server.js')}"`,
    url: `${BASE_URL}/api/health`,
    // Always a fresh server and database: a leftover one would carry the last
    // run's amendments and uploads into this one.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: process.env.E2E_SERVER_LOG ? 'pipe' : 'ignore',
    stderr: 'pipe',
    env: {
      SJVN_SKIP_DOTENV: '1',
      NODE_ENV: 'test',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      JWT_SECRET: 'e2e-only-secret',
      E2E_DATA_DIR: DATA,
      SJVN_DB_PATH: path.join(DATA, 'e2e.db'),
      SJVN_DISPUTE_DOC_DIR: path.join(DATA, 'dispute-evidence'),
      SJVN_REC_DOC_DIR: path.join(DATA, 'rec-lots'),
      SJVN_BACKUP_DIR: path.join(DATA, 'backups'),
      // Empty on purpose: boot then seeds no CERC reports, so the database holds
      // only what e2e/prepare.mjs put in it, and anything the suite fetches from
      // CERC lands here rather than in backend/cerc_downloads.
      SJVN_CERC_DIR: path.join(DATA, 'cerc'),
      CLIENT_DIR: path.join(here, 'e2e/.dist'),
    },
  },
});
