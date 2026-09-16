import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';
import { followUpQueue } from '../src/services/recRegistry.js';

// REC for the CSPP before issuance (CP-83-85 §5, steps 1–3): the JMR, the NLDC
// REC Registry application, its documents, and the follow-up until issuance.

let trader, finance;

beforeEach(() => {
  for (const t of ['rec_lot_documents', 'rec_lot_events', 'rec_transactions', 'rec_orders', 'rec_bids', 'rec_ledger']) db.prepare(`DELETE FROM ${t}`).run();
  trader = tokenFor('TRADING_USER');
  finance = tokenFor('FINANCE_USER');
});

async function appliedLot() {
  const r = await request(app).post('/api/rec').set(auth(trader)).send({ vintage_month: '2026-08', source: 'CSPP Charanka', technology: 'Solar', energy_mwh: 1250 });
  expect(r.status).toBe(201);
  return r.body;
}
const step = (id, body, token = trader) => request(app).post(`/api/rec/${id}/registry`).set(auth(token)).send(body);

describe('Registry application', () => {
  it('walks JMR → submitted → query → approved, keeping every step on the lot', async () => {
    const lot = await appliedLot();
    expect((await step(lot.id, { stage: 'JMR_RECEIVED', jmr_reference: 'JMR/CSPP/2026-08', jmr_date: '2026-09-03' })).status).toBe(200);
    const submitted = await step(lot.id, { stage: 'SUBMITTED', application_no: 'NLDC/REC/2026/1142', next_follow_up_date: '2099-01-10' });
    expect(submitted.body).toMatchObject({ registry_stage: 'SUBMITTED', application_no: 'NLDC/REC/2026/1142', jmr_reference: 'JMR/CSPP/2026-08', next_follow_up_date: '2099-01-10' });
    expect(submitted.body.application_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await step(lot.id, { stage: 'QUERY_RAISED', note: 'SLDC wants the energy account for August' });
    await step(lot.id, { stage: 'FOLLOW_UP', note: 'Sent the SLDC energy account by email' });
    const approved = await step(lot.id, { stage: 'APPROVED' });

    expect(approved.body.registry_stage).toBe('APPROVED');
    expect(approved.body.registry_events.map((e) => e.stage)).toEqual(['JMR_RECEIVED', 'SUBMITTED', 'QUERY_RAISED', 'FOLLOW_UP', 'APPROVED']);
    expect(approved.body.registry_events[2]).toMatchObject({ note: 'SLDC wants the energy account for August', label: 'Query raised by SLDC / NLDC' });
    // A follow-up records the chase, not a new stage.
    expect(approved.body.registry_events[3].label).toBe('Follow-up');

    const got = await request(app).get(`/api/rec/${lot.id}`).set(auth(finance));
    expect(got.body.registry_events).toHaveLength(5);
  });

  it('asks for what each step cannot happen without', async () => {
    const lot = await appliedLot();
    expect((await step(lot.id, { stage: 'JMR_RECEIVED' })).body.error).toMatch(/JMR reference/);
    expect((await step(lot.id, { stage: 'SUBMITTED' })).body.error).toMatch(/application number/);
    expect((await step(lot.id, { stage: 'FOLLOW_UP', note: 'called' })).status).toBe(409);
    await step(lot.id, { stage: 'SUBMITTED', application_no: 'A-1' });
    expect((await step(lot.id, { stage: 'QUERY_RAISED' })).body.error).toMatch(/what the query is/);
    expect((await step(lot.id, { stage: 'FOLLOW_UP' })).body.error).toMatch(/what the follow-up was/);
    expect((await step(lot.id, { stage: 'SUBMITTED', next_follow_up_date: '2020-01-01' })).body.error).toMatch(/past/);
    expect((await step(lot.id, { stage: 'ISSUED' })).status).toBe(400);
    expect((await step(lot.id, { stage: 'APPROVED' }, finance)).status).toBe(403);
  });

  it('closes the application once the Central Agency issues', async () => {
    const lot = await appliedLot();
    await step(lot.id, { stage: 'SUBMITTED', application_no: 'A-2' });
    const issued = await request(app).post(`/api/rec/${lot.id}/issue`).set(auth(trader)).send({ issuance_date: '2026-09-20', registry_ref: 'REG-99' });
    expect(issued.body.registry_events).toHaveLength(1);
    expect((await step(lot.id, { stage: 'FOLLOW_UP', note: 'late' })).body.error).toMatch(/has been issued/);
  });
});

describe('Follow-up queue', () => {
  it('lists overdue first, then due within the week, then applications nobody has chased', async () => {
    const overdue = await appliedLot();
    const due = await appliedLot();
    const idle = await appliedLot();
    const later = await appliedLot();
    await step(overdue.id, { stage: 'SUBMITTED', application_no: 'A-O', next_follow_up_date: '2099-01-05' });
    await step(due.id, { stage: 'SUBMITTED', application_no: 'A-D', next_follow_up_date: '2099-01-12' });
    await step(later.id, { stage: 'SUBMITTED', application_no: 'A-L', next_follow_up_date: '2099-03-01' });
    db.prepare("UPDATE rec_lot_events SET created_at = '2098-12-01 10:00:00'").run();
    db.prepare("UPDATE rec_ledger SET updated_at = '2098-12-01 10:00:00', created_at = '2098-12-01 10:00:00'").run();

    const queue = followUpQueue({ today: '2099-01-10' });
    expect(queue.map((q) => [q.application_no || q.lot_id === idle.id && 'IDLE', q.reason])).toEqual([
      ['A-O', 'OVERDUE'],
      ['A-D', 'DUE'],
      ['IDLE', 'NO_FOLLOW_UP_SET'],
    ]);
    expect(queue[0]).toMatchObject({ due_in_days: -5, stage_label: 'Application submitted on the NLDC REC Registry' });
    expect((await request(app).get('/api/rec/follow-ups').set(auth(finance))).status).toBe(200);
  });
});

describe('Documents', () => {
  it('keeps the papers against the lot, lists them with it, and serves them back', async () => {
    const lot = await appliedLot();
    const up = await request(app).post(`/api/rec/${lot.id}/documents`).set(auth(trader))
      .field('doc_type', 'JMR').attach('file', Buffer.from('JMR August 2026'), 'jmr-aug.pdf');
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ doc_type: 'JMR', file_name: 'jmr-aug.pdf' });
    expect(fs.existsSync(db.prepare('SELECT stored_path FROM rec_lot_documents WHERE id = ?').get(up.body.id).stored_path)).toBe(true);

    const detail = await request(app).get(`/api/rec/${lot.id}`).set(auth(finance));
    expect(detail.body.documents.map((d) => d.file_name)).toEqual(['jmr-aug.pdf']);
    const dl = await request(app).get(`/api/rec/documents/${up.body.id}/download`).set(auth(finance));
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/jmr-aug\.pdf/);

    const bad = await request(app).post(`/api/rec/${lot.id}/documents`).set(auth(trader))
      .field('doc_type', 'SELFIE').attach('file', Buffer.from('x'), 'x.pdf');
    expect(bad.status).toBe(400);
    expect((await request(app).post(`/api/rec/${lot.id}/documents`).set(auth(finance)).field('doc_type', 'JMR').attach('file', Buffer.from('x'), 'x.pdf')).status).toBe(403);
  });
});
