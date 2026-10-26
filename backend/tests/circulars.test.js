import { describe, it, expect } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth, auditFor } from './helpers/reia.js';

// Public circulars & statutory disclosures: the public archive and homepage bar
// read published rows without signing in; only the publishing desks write.

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\nxref\n0 1\ntrailer << /Root 1 0 R >>\nstartxref\n0\n%%EOF\n');
const fields = (over = {}) => ({
  circular_no: `SJVN/TEST/${Date.now()}`,
  title_en: 'Test corrigendum',
  category: 'CORRIGENDUM',
  issue_date: '2026-10-20',
  ...over,
});

function post(token, over = {}, file) {
  const req = request(app).post('/api/circulars/admin').set(auth(token));
  for (const [k, v] of Object.entries(fields(over))) req.field(k, v);
  if (file) req.attach('file', file.buffer, file.name);
  return req;
}

describe('public circulars', () => {
  it('lets a publishing desk publish a PDF, shows it publicly and records it', async () => {
    const token = tokenFor('REIA_CHECKER');
    const res = await post(token, {}, { buffer: PDF, name: 'corr.pdf' });
    expect(res.status).toBe(201);
    const c = res.body.circular;
    expect(c.file_url).toMatch(/^\/uploads\/circulars\/circular_.*\.pdf$/);
    expect(fs.existsSync(path.join(process.cwd(), c.file_url))).toBe(true);
    expect(auditFor(c.id).map((a) => a.action)).toContain('PUBLISH_CIRCULAR');

    const pub = await request(app).get('/api/circulars/public');
    const row = pub.body.circulars.find((r) => r.id === c.id);
    expect(row).toBeTruthy();
    expect(row.created_by).toBeUndefined();

    const del = await request(app).delete(`/api/circulars/admin/${c.id}`).set(auth(token));
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(process.cwd(), c.file_url))).toBe(false);
  });

  it('refuses counterparties and anonymous callers', async () => {
    expect((await post(tokenFor('SELLER'))).status).toBe(403);
    expect((await request(app).get('/api/circulars/admin')).status).toBe(401);
  });

  it('refuses a page dressed as a PDF, a broken PDF and a script link', async () => {
    const token = tokenFor('SJVN_ADMIN');
    const html = await post(token, {}, { buffer: Buffer.from('<script>alert(1)</script>'), name: 'x.html' });
    expect(html.status).toBe(400);
    const fake = await post(token, {}, { buffer: Buffer.from('<script>alert(1)</script>'), name: 'x.pdf' });
    expect(fake.status).toBe(400);
    const js = await post(token, { external_url: 'javascript:alert(1)' });
    expect(js.status).toBe(400);
    const cat = await post(token, { category: 'BILLS' });
    expect(cat.status).toBe(400);
  });

  it('keeps a draft off the public pages, and an edit that omits the flag keeps it a draft', async () => {
    const token = tokenFor('TRADING_ADMIN');
    const res = await post(token, { category: 'CERC_FORM_IV', is_active: '0', is_pinned: '1' });
    expect(res.status).toBe(201);
    const { id } = res.body.circular;

    const isPublic = async () => (await request(app).get('/api/circulars/public')).body.circulars.some((r) => r.id === id);
    expect(await isPublic()).toBe(false);
    expect((await request(app).get('/api/circulars/banner')).body.circular?.id).not.toBe(id);

    const edit = await request(app).put(`/api/circulars/admin/${id}`).set(auth(token)).field('title_en', 'Renamed');
    expect(edit.status).toBe(200);
    expect(edit.body.circular.is_active).toBe(0);
    expect(edit.body.circular.title_en).toBe('Renamed');
    expect(await isPublic()).toBe(false);

    db.prepare('DELETE FROM public_circulars WHERE id = ?').run(id);
  });
});
