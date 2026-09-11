/**
 * The ways a deployed server falls over, rather than the ways a calculation is
 * wrong: the health probe a release is rolled back on, the error handler that
 * decides whether a client mistake reads as a platform fault, the upload caps
 * that keep one request from exhausting the disk or the heap, and the database
 * snapshots that are the only second copy of everything the platform knows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from '../src/server.js';
import { db } from '../src/db/index.js';
import { backupDatabase, pruneBackups } from '../src/services/dbBackup.js';
import { tokenFor, auth, makeEntity } from './helpers/reia.js';

describe('health probe', () => {
  it('reports ok while the database answers', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(typeof r.body.uptime_seconds).toBe('number');
  });

  // update.sh treats a failing probe as "the release did not come up" and rolls
  // back. That only works if the probe actually reads the database — a constant
  // 200 tells the deploy a server with an unusable database is healthy.
  it('touches the database rather than answering from a constant', async () => {
    const original = db.prepare;
    db.prepare = () => { throw new Error('database is locked'); };
    try {
      const r = await request(app).get('/api/health');
      expect(r.status).toBe(503);
      expect(r.body.status).toBe('degraded');
    } finally {
      db.prepare = original;
    }
  });
});

describe('error handling at the edge', () => {
  it('answers 400 for a malformed JSON body, not 500', async () => {
    const r = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "a@b.in", ');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/malformed json/i);
  });

  it('answers 413 for an upload past the route limit, not 500', async () => {
    const token = tokenFor('SJVN_ADMIN');
    const entity = makeEntity('SELLER');
    const r = await request(app)
      .post(`/api/entities/${entity.id}/logo`)
      .set(auth(token))
      .attach('logo', Buffer.alloc(6 * 1024 * 1024, 1), 'huge.png');
    expect(r.status).toBe(413);
    expect(r.body.error).toMatch(/too large/i);
  });

  // The message on an unexpected failure is a SQL statement or an absolute
  // path. It belongs in the journal, not in a reply to whoever asked.
  it('does not hand internal failure detail to the client in production', async () => {
    const token = tokenFor('SJVN_ADMIN');
    const originalEnv = process.env.NODE_ENV;
    const originalPrepare = db.prepare;
    process.env.NODE_ENV = 'production';
    db.prepare = () => { throw new Error('SQLITE_ERROR: no such column: secret_internal_column'); };
    try {
      const r = await request(app).get('/api/entities').set(auth(token));
      expect(r.status).toBe(500);
      expect(r.body.error).not.toMatch(/secret_internal_column/);
      expect(r.body.trace_id).toBeTruthy();
    } finally {
      db.prepare = originalPrepare;
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('carries a trace id so a report can be tied to a log line', async () => {
    const r = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{ nonsense');
    expect(r.body.trace_id).toBeTruthy();
    expect(r.body.trace_id).not.toBe('-');
  });
});

describe('database durability settings', () => {
  it('waits on a busy writer instead of failing the request', () => {
    expect(db.pragma('busy_timeout', { simple: true })).toBeGreaterThanOrEqual(1000);
  });

  it('runs in WAL', () => {
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
  });
});

describe('database snapshots', () => {
  let dir;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sjvn-bk-')); });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

  it('writes a snapshot that opens as a valid database', async () => {
    const r = await backupDatabase({ dir, keep: 5 });
    expect(fs.existsSync(r.file)).toBe(true);
    expect(r.bytes).toBeGreaterThan(0);

    // The snapshot stands alone. A -wal or -shm left beside it accumulates one
    // pair per day, and a restore that copies a stale WAL next to a database it
    // does not belong to gets "database disk image is malformed".
    expect(fs.readdirSync(dir).some((n) => n.endsWith('-wal') || n.endsWith('-shm'))).toBe(false);

    // The point of a backup is that it restores. Read a table back out of the
    // copy rather than trusting that a file of the right size is a database.
    const Database = (await import('better-sqlite3')).default;
    const copy = new Database(r.file, { readonly: true });
    try {
      expect(copy.pragma('quick_check', { simple: true })).toBe('ok');
      expect(copy.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='table'`).get().n)
        .toBeGreaterThan(0);
    } finally {
      copy.close();
    }
  });

  it('keeps only the newest snapshots', () => {
    for (const stamp of ['2026-01-01T01-00-00', '2026-01-02T01-00-00', '2026-01-03T01-00-00']) {
      fs.writeFileSync(path.join(dir, `platform-${stamp}.db`), 'x');
    }
    const { removed } = pruneBackups(dir, 2);
    expect(removed).toBeGreaterThan(0);
    expect(fs.readdirSync(dir).filter((n) => /^platform-.*\.db$/.test(n)).length).toBe(2);
  });

  // Retention must never reach past the files this module wrote — an operator's
  // own copy sitting in the directory is not ours to delete.
  it('leaves files it did not write alone', () => {
    fs.writeFileSync(path.join(dir, 'before-schema-change.db'), 'x');
    pruneBackups(dir, 1);
    expect(fs.existsSync(path.join(dir, 'before-schema-change.db'))).toBe(true);
  });
});

describe('document numbering', () => {
  // Nine columns that take these numbers are declared UNIQUE, so a repeat is a
  // failed INSERT and an invoice that never gets raised — not a cosmetic clash.
  it('never issues the same number twice in a series', async () => {
    const { genInvoiceNo } = await import('../src/util.js');
    const seen = new Set();
    for (let i = 0; i < 5000; i++) seen.add(genInvoiceNo('TEST-SERIES'));
    expect(seen.size).toBe(5000);
  });

  it('keeps each series on its own register', async () => {
    const { genInvoiceNo } = await import('../src/util.js');
    const a = genInvoiceNo('SERIES-A');
    const b = genInvoiceNo('SERIES-B');
    expect(a.split('/').pop()).toBe(b.split('/').pop());   // both are the first of their series
    expect(a).not.toBe(b);
  });

  // Numbers already issued by the old random draw were all six digits from
  // 100000 up; the register starts at 1, so it cannot re-issue one of them.
  it('starts below the range the old random numbers used', async () => {
    const { genInvoiceNo } = await import('../src/util.js');
    const first = Number(genInvoiceNo('SERIES-FRESH').split('/').pop());
    expect(first).toBeLessThan(100000);
  });
});
