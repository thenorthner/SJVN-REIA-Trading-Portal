import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';

// The hydro desk's view of what the scheduled NRPC scan fetched: every fetch
// with its status and reason, the PDF it saved, and the station figures it read.

const OK_ID = 'REA-TEST-FETCHLOG-OK';
const FAIL_ID = 'REA-TEST-FETCHLOG-FAIL';
const MONTH = '1999-01';
let pdfPath;
let viewer;

beforeAll(() => {
  viewer = tokenFor('MANAGEMENT');
  pdfPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rea-log-')), 'REA_NRPC_1999-01.pdf');
  fs.writeFileSync(pdfPath, '%PDF-1.4 test');
  const ins = db.prepare(`
    INSERT INTO rea_fetch_log (id, rpc_source, period_month, data_type, pdf_url, local_file_path, status, records_created, error_message, fetched_at)
    VALUES (?, 'NRPC', ?, ?, NULL, ?, ?, ?, ?, '1999-02-01 00:00:00')
  `);
  ins.run(OK_ID, MONTH, 'PROVISIONAL', pdfPath, 'PROCESSED', 0, null);
  ins.run(FAIL_ID, MONTH, 'FINAL', null, 'FAILED', 0, 'Table D2 not found in the PDF');
});

afterAll(() => {
  db.prepare('DELETE FROM rea_fetch_log WHERE id IN (?, ?)').run(OK_ID, FAIL_ID);
  fs.rmSync(path.dirname(pdfPath), { recursive: true, force: true });
});

describe('GET /api/hydro-billing/rea-fetch-log', () => {
  it('lists each fetch with its status and fail reason, without the server path', async () => {
    const res = await request(app).get('/api/hydro-billing/rea-fetch-log?rpc=NRPC').set(auth(viewer));
    expect(res.status).toBe(200);
    const ok = res.body.log.find((l) => l.id === OK_ID);
    const failed = res.body.log.find((l) => l.id === FAIL_ID);
    expect(ok).toMatchObject({ status: 'PROCESSED', has_pdf: true });
    expect(ok).not.toHaveProperty('local_file_path');
    expect(Array.isArray(ok.stations)).toBe(true);
    expect(failed).toMatchObject({ status: 'FAILED', has_pdf: false, error_message: 'Table D2 not found in the PDF', stations: [] });
    expect(res.body.status?.latest_fetch?.local_file_path).toBeUndefined();
  });

  it('is not open to a REIA-only user', async () => {
    const res = await request(app).get('/api/hydro-billing/rea-fetch-log').set(auth(tokenFor('REIA_USER')));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/hydro-billing/rea-fetch-log/:logId/pdf', () => {
  it('serves the PDF the scan saved', async () => {
    const res = await request(app).get(`/api/hydro-billing/rea-fetch-log/${OK_ID}/pdf`).set(auth(viewer));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('says so when the fetch has no PDF on the server', async () => {
    const res = await request(app).get(`/api/hydro-billing/rea-fetch-log/${FAIL_ID}/pdf`).set(auth(viewer));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/hydro-billing/rea-scan', () => {
  it('needs a hydro write role', async () => {
    const res = await request(app).post('/api/hydro-billing/rea-scan').set(auth(viewer));
    expect(res.status).toBe(403);
  });
});
