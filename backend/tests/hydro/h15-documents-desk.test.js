import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { signToken } from '../../src/middleware/auth.js';
import { auth, makeUser, makeEntity } from '../helpers/reia.js';

// Hydro QA run 15 (18-Oct-2026): each desk takes in and reviews its own
// vertical's papers and edits its own vertical's stakeholders.

const as = (u) => auth(signToken(u));
const pdf = (text) => new Promise((resolve) => {
  const doc = new PDFDocument(); const chunks = [];
  doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.text(text); doc.end();
});
const upload = async (u, fields) => {
  let r = request(app).post('/api/documents/upload').set(as(u));
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', await pdf(`QA-H15 ${Math.random()} ${fields.title}`), { filename: 'p.pdf', contentType: 'application/pdf' });
};
const kyc = (e, x = {}) => ({ entity_id: e.id, document_type: 'PAN_CARD', category: 'VERIFY', title: 'PAN card', ...x });

let reiaCo, hydroCo, reia, reia2, hydro, hydro2, thermal;
beforeEach(() => {
  db.prepare('DELETE FROM document_requests').run();
  db.prepare('DELETE FROM document_versions').run();
  db.prepare('DELETE FROM documents').run();
  reiaCo = makeEntity('SELLER', { name: 'Alpha Solar' });
  hydroCo = makeEntity('BUYER', { name: 'HPSEBL' });
  db.prepare(`UPDATE entities SET verticals = 'REIA' WHERE id = ?`).run(reiaCo.id);
  db.prepare(`UPDATE entities SET verticals = 'HYDRO' WHERE id = ?`).run(hydroCo.id);
  reia = makeUser('REIA_USER'); reia2 = makeUser('REIA_ADMIN');
  hydro = makeUser('COMMERCIAL_ADMIN'); hydro2 = makeUser('COMMERCIAL');
  thermal = makeUser('THERMAL_USER');
});

describe('The Hydro desk', () => {
  it('reviews its own stakeholders\' papers only', async () => {
    const r = await upload(reia, kyc(reiaCo));
    expect((await request(app).post(`/api/documents/${r.body.version_id}/reject`).set(as(hydro2)).send({ reason_code: 'NOT_LEGIBLE' })).status).toBe(403);
    const h = await upload(hydro, kyc(hydroCo));
    expect(h.status, JSON.stringify(h.body)).toBe(200);
    expect((await request(app).post(`/api/documents/${h.body.version_id}/verify`).set(as(thermal)).send({})).status).toBe(403);
    expect((await request(app).post(`/api/documents/${h.body.version_id}/verify`).set(as(hydro2)).send({})).status).toBe(200);
  });

  it('sees its own vertical in the queue and KYC report, whatever it asks for', async () => {
    await upload(reia, kyc(reiaCo)); await upload(hydro, kyc(hydroCo));
    const q = await request(app).get('/api/documents/queue').set(as(hydro2));
    expect(q.body.map((d) => d.entity_id)).toEqual([hydroCo.id]);
    const k = await request(app).get('/api/documents/kyc-report').set(as(hydro2));
    expect(k.body.map((e) => e.entity_id)).not.toContain(reiaCo.id);
    expect((await request(app).get('/api/documents/kyc-report?vertical=REIA').set(as(hydro2))).body).toEqual([]);
  });

  it('scans in and asks for its own stakeholders\' papers only', async () => {
    expect((await upload(hydro, kyc(reiaCo))).status).toBe(403);
    expect((await upload(hydro, kyc({ id: 'ENT-NOPE' }))).status).toBe(400);
    expect((await upload(hydro, kyc(hydroCo, { expiry_date: '2026-13-45' }))).status).toBe(400);
    expect((await request(app).post('/api/documents/requests').set(as(hydro)).send({ entity_id: reiaCo.id, document_type: 'CIN' })).status).toBe(403);
    const ask = await request(app).post('/api/documents/requests').set(as(reia)).send({ entity_id: reiaCo.id, document_type: 'CIN' });
    expect((await request(app).post(`/api/documents/requests/${ask.body.id}/cancel`).set(as(hydro)).send({})).status).toBe(403);
  });

  it('does not edit a REIA stakeholder', async () => {
    const r = await request(app).put(`/api/entities/${reiaCo.id}`).set(as(hydro)).send({ name: 'Renamed by Hydro' });
    expect(r.status).toBe(403);
    expect(db.prepare('SELECT name FROM entities WHERE id = ?').get(reiaCo.id).name).toBe('Alpha Solar');
    const logo = await request(app).post(`/api/entities/${reiaCo.id}/logo`).set(as(hydro))
      .attach('logo', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { filename: 'l.png', contentType: 'image/png' });
    expect(logo.status).toBe(403);
  });
});
