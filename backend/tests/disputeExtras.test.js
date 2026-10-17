import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia, auditFor } from './helpers/reia.js';

// A dispute as a matter with money and time on it: whose move it is, what the
// amount is earning in surcharge, the submitter's answer to the resolution,
// several bills disputed for one cause, and the whole file as a dossier.

let reia, seller, otherSeller, alpha, beta, contract;
const as = (u) => auth(signToken(u));
const get = (u, p) => request(app).get(`/api/dispute-extras${p}`).set(as(u));
const post = (u, p, body) => request(app).post(`/api/dispute-extras${p}`).set(as(u)).send(body);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

function bill(no, period = '2026-06', extra = {}) {
  return makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', invoice_no: no, billing_period: period, total_amount: 1000000, energy_charges: 1000000, due_date: day(-40), ...extra });
}
async function raise(inv, amount = 100000, u = seller) {
  const r = await request(app).post('/api/disputes').set(as(u)).send({ invoice_id: inv.id, reason_code: 'TARIFF_RATE_ERROR', charge_line: 'energy_charges', disputed_amount: amount, issue_description: 'Wrong tariff applied' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
const resolve = (id, body) => request(app).post(`/api/disputes/${id}/resolve`).set(as(reia)).send({ resolution_notes: 'Checked against the PPA', ...body });
const underReview = (id) => request(app).post(`/api/disputes/${id}/transition`).set(as(reia)).send({ status: 'UNDER_REVIEW' });

beforeEach(() => {
  resetReia();
  alpha = makeEntity('SELLER', { name: 'Alpha Solar' });
  beta = makeEntity('SELLER', { name: 'Beta Wind' });
  contract = makeContract({ seller_id: alpha.id });
  db.prepare('UPDATE contracts SET lps_annual_pct = 18.25 WHERE id = ?').run(contract.id);
  reia = makeUser('REIA_USER', { name: 'Riya REIA' });
  seller = makeUser('SELLER', { name: 'Arun Alpha', linked_entity_id: alpha.id });
  otherSeller = makeUser('SELLER', { name: 'Bina Beta', linked_entity_id: beta.id });
});

describe('the clock', () => {
  it('says whose move it is and how long they have, and when the time has run out', async () => {
    const d = await raise(bill('A/1'));
    const fresh = (await get(seller, `/${d.id}`)).body;
    expect(fresh.sla).toMatchObject({ stage: 'RESOLVE', owner: 'SJVN', breached: false });
    expect(fresh.sla.days_left).toBe(15);
    expect(fresh.sla.label).toMatch(/SJVN has 15 days left to resolve/);
    expect((await get(reia, `/${d.id}`)).body.awaiting_me).toBe(true);
    expect(fresh.awaiting_me).toBe(false);

    db.prepare(`UPDATE disputes SET sla_resolve_due = datetime('now', '-3 days') WHERE id = ?`).run(d.id);
    const late = (await get(seller, `/${d.id}`)).body.sla;
    expect(late).toMatchObject({ breached: true, overdue: true });
    expect(late.label).toMatch(/ran out 3 days ago/);
    expect((await get(seller, '/overview')).body.totals).toMatchObject({ open: 1, open_amount: 100000, breached: 1 });
    expect((await get(otherSeller, `/${d.id}`)).status).toBe(403);
    expect((await get(otherSeller, '/overview')).body.disputes).toEqual([]);
  });
});

describe('the surcharge', () => {
  it('runs on the amount in question from the bill’s due date, at the contract’s rate', async () => {
    const d = await raise(bill('A/1'), 100000);
    const e = (await get(seller, `/${d.id}`)).body.lps_estimate;
    // Rs 1,00,000 at 18.25% a year is Rs 50 a day; forty days late.
    expect(e).toMatchObject({ base: 100000, rate_pct: 18.25, days: 40, per_day: 50, amount: 2000, running: true });
    expect((await get(seller, '/overview')).body.totals).toMatchObject({ lps_running: 2000, lps_per_day: 50 });

    const notDue = await raise(bill('A/2', '2026-07', { due_date: day(10) }), 100000);
    expect((await get(seller, `/${notDue.id}`)).body.lps_estimate).toMatchObject({ days: 0, amount: 0, per_day: 0, not_yet_due: true });
  });
});

describe('answering the resolution', () => {
  it('closes the dispute when the submitter accepts it', async () => {
    const d = await raise(bill('A/1'));
    expect((await post(seller, `/${d.id}/respond`, { response: 'ACCEPT' })).status).toBe(400);   // nothing to answer yet
    await underReview(d.id);
    expect((await resolve(d.id, { outcome: 'REJECTED' })).status).toBe(200);

    const waiting = (await get(seller, `/${d.id}`)).body;
    expect(waiting).toMatchObject({ status: 'RESOLVED_REJECTED', awaiting_me: true });
    expect(waiting.sla).toMatchObject({ stage: 'RESPONSE', owner: 'SUBMITTER' });
    expect(waiting.can.respond).toBe(true);
    expect((await post(reia, `/${d.id}/respond`, { response: 'ACCEPT' })).status).toBe(403);
    expect((await post(otherSeller, `/${d.id}/respond`, { response: 'ACCEPT' })).status).toBe(403);

    const ok = await post(seller, `/${d.id}/respond`, { response: 'ACCEPT' });
    expect(ok.body).toMatchObject({ status: 'CLOSED' });
    expect(ok.body.resolution).toMatchObject({ response: 'ACCEPTED', response_by: 'Arun Alpha' });
    expect((await post(seller, `/${d.id}/respond`, { response: 'ACCEPT' })).status).toBe(400);
    expect(auditFor(d.id).map((a) => a.action)).toContain('DISPUTE_RESOLUTION_ACCEPTED');
  });

  it('keeps it alive when the submitter contests it, until SJVN records how it ended', async () => {
    const d = await raise(bill('A/1'), 100000);
    await underReview(d.id);
    await resolve(d.id, { outcome: 'PARTIAL_CREDIT', accepted_amount: 30000 });

    expect((await post(seller, `/${d.id}/respond`, { response: 'ESCALATE', forum: 'ARBITRATION' })).status).toBe(400);            // needs reasons
    expect((await post(seller, `/${d.id}/respond`, { response: 'ESCALATE', forum: 'THE_MOON', note: 'x' })).status).toBe(400);
    expect((await post(seller, `/${d.id}/respond`, { response: 'ESCALATE', forum: 'ARBITRATION', note: 'x', contested_amount: 90000 })).status).toBe(400);
    const c = await post(seller, `/${d.id}/respond`, { response: 'ESCALATE', forum: 'ARBITRATION', note: 'Tariff schedule B applies' });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.sla).toMatchObject({ stage: 'CONTESTED' });
    expect(c.body.resolution).toMatchObject({ response: 'CONTESTED', forum: 'ARBITRATION', contested_amount: 70000 });
    // The surcharge runs on what is still argued.
    expect(c.body.lps_estimate).toMatchObject({ base: 70000, running: true });
    expect((await get(reia, '/overview')).body.totals.contested).toBe(1);

    expect((await post(seller, `/${d.id}/conclude`, { note: 'x' })).status).toBe(403);
    expect((await post(reia, `/${d.id}/conclude`, {})).status).toBe(400);
    const done = await post(reia, `/${d.id}/conclude`, { note: 'Arbitral award dated 1 Sept: claim allowed in part' });
    expect(done.body).toMatchObject({ status: 'CLOSED' });
    expect(done.body.resolution.escalation_outcome).toMatch(/Arbitral award/);
  });

  it('lets the submitter withdraw an open dispute', async () => {
    const inv = bill('A/1');
    const d = await raise(inv, 100000);
    // A seller disputes its own bill to be paid more; nothing SJVN owes it is held back.
    expect(db.prepare('SELECT disputed_amount FROM invoices WHERE id = ?').get(inv.id).disputed_amount).toBe(0);
    expect((await post(seller, `/${d.id}/withdraw`, {})).status).toBe(400);
    expect((await post(reia, `/${d.id}/withdraw`, { note: 'x' })).status).toBe(403);
    const w = await post(seller, `/${d.id}/withdraw`, { note: 'Raised on the wrong bill' });
    expect(w.body).toMatchObject({ status: 'CLOSED' });
    expect(w.body.resolution.response).toBe('WITHDRAWN');
    expect(db.prepare('SELECT disputed_amount FROM invoices WHERE id = ?').get(inv.id).disputed_amount).toBe(0);
  });
});

describe('groups', () => {
  it('tie one company’s disputes on several bills together', async () => {
    const a = await raise(bill('A/1', '2026-04'), 100000);
    const b = await raise(bill('A/2', '2026-05'), 150000);
    const c2 = makeContract({ seller_id: beta.id });
    const other = await request(app).post('/api/disputes').set(as(otherSeller)).send({
      invoice_id: makeInvoice({ contract_id: c2.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 1000, energy_charges: 1000 }).id,
      reason_code: 'TARIFF_RATE_ERROR', charge_line: 'energy_charges', disputed_amount: 10,
    });

    expect((await post(seller, '/link', { ids: [a.id], title: 'x' })).status).toBe(400);
    expect((await post(seller, '/link', { ids: [a.id, b.id] })).status).toBe(400);
    expect((await post(seller, '/link', { ids: [a.id, other.body.id], title: 'x' })).status).toBe(403);
    expect((await post(reia, '/link', { ids: [a.id, other.body.id], title: 'x' })).status).toBe(400);   // two companies

    const g = await post(seller, '/link', { ids: [a.id, b.id], title: 'Tariff applied at the old rate, Apr–May' });
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    expect(g.body).toMatchObject({ title: 'Tariff applied at the old rate, Apr–May', total: 250000 });
    expect(g.body.ref).toMatch(/^DSG\/\d{4}\/\d{4}$/);
    expect(g.body.disputes.map((x) => x.invoice_no)).toEqual(['A/1', 'A/2']);

    // A third joins the same group.
    const c = await raise(bill('A/3', '2026-06'), 50000);
    const again = await post(seller, '/link', { ids: [b.id, c.id], title: 'Tariff applied at the old rate, Apr–Jun' });
    expect(again.body.ref).toBe(g.body.ref);
    expect((await get(seller, `/${a.id}`)).body.group).toMatchObject({ total: 300000, title: 'Tariff applied at the old rate, Apr–Jun' });
  });
});

describe('the dossier', () => {
  it('is the whole file as one document, with the evidence beside it, for the parties only', async () => {
    const d = await raise(bill('A/1'));
    await request(app).post(`/api/disputes/${d.id}/evidence`).set(as(seller)).attach('file', Buffer.from('meter log'), 'meter-log.txt');
    await request(app).post(`/api/disputes/${d.id}/comments`).set(as(seller)).send({ body: 'Schedule B, clause 4 applies.' });
    await request(app).post(`/api/disputes/${d.id}/comments`).set(as(reia)).send({ body: 'Internal: check with finance', is_internal: true });

    const pdf = await get(seller, `/${d.id}/dossier.pdf`).buffer().parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');

    const zip = await get(reia, `/${d.id}/dossier.zip`).buffer().parse(binary);
    expect(zip.status).toBe(200);
    expect(zip.body.slice(0, 2).toString()).toBe('PK');
    expect(zip.body.includes(Buffer.from('evidence/E-01_meter-log.txt'))).toBe(true);
    expect(zip.body.includes(Buffer.from(`dossier-${d.dispute_no.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`))).toBe(true);
    expect((await get(otherSeller, `/${d.id}/dossier.zip`)).status).toBe(403);
    expect(auditFor(d.id).map((a) => a.action)).toContain('DISPUTE_DOSSIER_EXPORTED');
  });
});
