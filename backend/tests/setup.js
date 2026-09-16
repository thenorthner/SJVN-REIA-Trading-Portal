import fs from 'fs';
import os from 'os';
import path from 'path';

// Point the database at a throwaway file, unique per worker, before any test
// imports src/db/index.js — that module opens its connection at import time.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sjvn-test-'));
process.env.SJVN_DB_PATH = path.join(dir, `platform-${process.env.VITEST_WORKER_ID || '0'}.db`);
// Files a test uploads land beside its database, not in backend/uploads.
process.env.SJVN_REC_DOC_DIR = path.join(dir, 'rec-lots');
process.env.JWT_SECRET = 'test-secret';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';

// The worker exits with the file still open; removing the directory here keeps
// temp space from filling up across runs.
process.on('exit', () => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});
