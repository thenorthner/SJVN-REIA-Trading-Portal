import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity, makeContract, auditFor } from './helpers/reia.js';

// The working side of a contract: milestones with dates that mean something,
// requests the counterparty raises and SJVN decides, and notices either way —
// each kept to the contract's own parties.

let reia, reia2, finance, seller, otherSeller, buyer, alpha, beta, discom, contract;
const as = (u) => auth(signToken(u));
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const ws = (u, id = contract.id) => request(app).get(`/api/contract-workspace/${id}`).set(as(u));
const post = (u, path, body) => request(app).post(`/api/contract-workspace${path}`).set(as(u)).send(body);

beforeEach(() => {
  for (const t of ['contract_notices', 'contract_requests', 'contract_milestones']) db.prepare(`DELETE FROM ${t}`).run();
  alpha = makeEntity('SELLER', { name: 'Alpha Solar' });
  beta = makeEntity('SELLER', { name: 'Beta Wind' });
  discom = makeEntity('BUYER', { name: 'State DISCOM' });
  contract = makeContract({ seller_id: alpha.id, buyer_id: discom.id });
  db.prepare(`UPDATE contracts SET pbg_amount = 5000000, pbg_type = 'BG', pbg_expiry = ? WHERE id = ?`).run(day(12), contract.id);
  reia = makeUser('REIA_USER', { name: 'Riya REIA' });
  reia2 = makeUser('REIA_ADMIN', { name: 'Ravi REIA' });
  finance = makeUser('FINANCE_USER', { name: 'Farhan Finance' });
  seller = makeUser('SELLER', { name: 'Arun Alpha', linked_entity_id: alpha.id });
  otherSeller = makeUser('SELLER', { name: 'Bina Beta', linked_entity_id: beta.id });
  buyer = makeUser('BUYER', { name: 'Devi DISCOM', linked_entity_id: discom.id });
});

describe('who may open a contract’s working file', () => {
  it('is its own parties and SJVN', async () => {
    expect((await ws(seller)).status).toBe(200);
    expect((await ws(buyer)).body.side).toBe('BUYER');
    expect((await ws(reia)).body).toMatchObject({ side: 'SJVN', can_manage: true, can_make: true, can_check: false });
    // Phase B.2: the checker decides what the maker set up.
    expect((await ws(reia2)).body).toMatchObject({ can_make: false, can_check: true });
    expect((await ws(finance)).body.can_manage).toBe(false);
    expect((await ws(otherSeller)).status).toBe(404);
    expect((await ws(makeUser('TRADING_CLIENT', { name: 'Trader' }))).status).toBe(404);
  });
});

describe('milestones', () => {
  it('are set by SJVN, and read as pending, delayed or achieved from their dates', async () => {
    expect((await post(seller, `/${contract.id}/milestones/standard`)).status).toBe(403);
    const made = await post(reia, `/${contract.id}/milestones/standard`);
    expect(made.body.map((m) => m.milestone_type)).toEqual(['FINANCIAL_CLOSURE', 'SCOD', 'COD']);
    const [fc, scod] = made.body;

    await request(app).patch(`/api/contract-workspace/milestones/${fc.id}`).set(as(reia)).send({ due_date: day(-10) });
    const after = await request(app).patch(`/api/contract-workspace/milestones/${scod.id}`).set(as(reia)).send({ due_date: day(20) });
    expect(after.body.find((m) => m.id === fc.id)).toMatchObject({ status: 'DELAYED', delay_days: 10 });
    expect(after.body.find((m) => m.id === scod.id)).toMatchObject({ status: 'PENDING', due_soon: true, days_to_due: 20 });

    expect((await request(app).patch(`/api/contract-workspace/milestones/${fc.id}`).set(as(reia)).send({ achieved_date: day(5) })).status).toBe(400);
    const done = await request(app).patch(`/api/contract-workspace/milestones/${fc.id}`).set(as(reia)).send({ achieved_date: day(-3) });
    expect(done.body.find((m) => m.id === fc.id)).toMatchObject({ status: 'ACHIEVED', delay_days: 7 });
    expect((await post(reia, `/${contract.id}/milestones`, { milestone_type: 'SCOD' })).status).toBe(400);
  });

  it('can be reported by the counterparty, and count only once SJVN confirms', async () => {
    const [fc] = (await post(reia, `/${contract.id}/milestones/standard`)).body;
    const rep = await post(seller, `/milestones/${fc.id}/report`, { achieved_date: day(-2), note: 'Sanction letter attached' });
    expect(rep.body.find((m) => m.id === fc.id)).toMatchObject({ status: 'REPORTED', achieved_date: null });
    expect((await post(seller, `/milestones/${fc.id}/confirm`, {})).status).toBe(403);
    expect((await post(otherSeller, `/milestones/${fc.id}/report`, { achieved_date: day(-2) })).status).toBe(404);

    const no = await post(reia2, `/milestones/${fc.id}/confirm`, { accept: false, note: 'Letter is conditional' });
    expect(no.body.find((m) => m.id === fc.id)).toMatchObject({ status: 'PENDING', reported_date: null });

    await post(seller, `/milestones/${fc.id}/report`, { achieved_date: day(-1) });
    const yes = await post(reia2, `/milestones/${fc.id}/confirm`, {});
    expect(yes.body.find((m) => m.id === fc.id)).toMatchObject({ status: 'ACHIEVED', achieved_date: day(-1) });
    expect(auditFor(fc.id).map((a) => a.action)).toEqual(expect.arrayContaining(['MILESTONE_REPORTED', 'MILESTONE_CONFIRMED']));
  });
});

describe('requests', () => {
  it('extend a milestone only when SJVN approves, keeping the date first agreed', async () => {
    const ms = (await post(reia, `/${contract.id}/milestones/standard`)).body;
    const scod = ms.find((m) => m.milestone_type === 'SCOD');
    await request(app).patch(`/api/contract-workspace/milestones/${scod.id}`).set(as(reia)).send({ due_date: day(30) });

    expect((await post(reia, `/${contract.id}/requests`, { request_type: 'OTHER', subject: 's', description: 'd' })).status).toBe(400);
    expect((await post(seller, `/${contract.id}/requests`, { request_type: 'MILESTONE_EXTENSION', milestone_id: scod.id, requested_date: day(10), description: 'x' })).status).toBe(400);
    const raised = await post(seller, `/${contract.id}/requests`, {
      request_type: 'MILESTONE_EXTENSION', milestone_id: scod.id, requested_date: day(120), ground: 'FORCE_MAJEURE', description: 'Flood at site',
    });
    expect(raised.status, JSON.stringify(raised.body)).toBe(200);
    const id = raised.body[0].id;
    expect(raised.body[0]).toMatchObject({ status: 'PENDING', raised_by_side: 'SELLER' });
    // The date does not move on the asking.
    expect((await ws(seller)).body.milestones.find((m) => m.id === scod.id).due_date).toBe(day(30));
    // The buyer on the same contract does not read the seller's request.
    expect((await ws(buyer)).body.requests).toEqual([]);

    expect((await post(seller, `/requests/${id}/decide`, { decision: 'APPROVED' })).status).toBe(403);
    // Phase B.2: the maker who keeps the milestones does not decide the request.
    expect((await post(reia, `/requests/${id}/decide`, { decision: 'APPROVED', approved_date: day(90) })).status).toBe(403);
    expect((await post(reia2, `/requests/${id}/decide`, { decision: 'REJECTED' })).status).toBe(400);
    const ok = await post(reia2, `/requests/${id}/decide`, { decision: 'APPROVED', approved_date: day(90), note: 'Ninety days granted' });
    expect(ok.body[0]).toMatchObject({ status: 'APPROVED', approved_date: day(90) });
    expect((await ws(seller)).body.milestones.find((m) => m.id === scod.id)).toMatchObject({ due_date: day(90), original_due_date: day(30), extended: true });
    expect((await post(reia2, `/requests/${id}/decide`, { decision: 'REJECTED', note: 'x' })).status).toBe(400);
  });

  it('take a renewed guarantee on record', async () => {
    const before = (await ws(seller)).body.guarantee;
    expect(before).toMatchObject({ state: 'EXPIRING', days_to_expiry: 12 });
    expect((await post(seller, `/${contract.id}/requests`, { request_type: 'PBG_RENEWAL', requested_date: day(400), description: 'Renewed' })).status).toBe(400);

    db.prepare(`INSERT INTO documents (id, contract_id, document_type, category, title) VALUES ('D1', ?, 'PBG_COPY', 'VERIFY', 'PBG')`).run(contract.id);
    db.prepare(`INSERT INTO document_versions (id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type) VALUES ('V1', 'D1', 1, '/nowhere', 'pbg.pdf', 10, 'application/pdf')`).run();
    const raised = await post(seller, `/${contract.id}/requests`, { request_type: 'PBG_RENEWAL', requested_date: day(400), amount: 6000000, bank: 'SBI', description: 'Renewed for a year', attachment_version_id: 'V1' });
    expect(raised.status, JSON.stringify(raised.body)).toBe(200);
    await post(reia2, `/requests/${raised.body[0].id}/decide`, { decision: 'APPROVED' });
    expect((await ws(seller)).body.guarantee).toMatchObject({ state: 'VALID', expiry: day(400), amount: 6000000 });
  });

  it('can be withdrawn by the side that raised them', async () => {
    const raised = await post(seller, `/${contract.id}/requests`, { request_type: 'AMENDMENT', subject: 'Change delivery point', description: 'Substation moved' });
    const id = raised.body[0].id;
    expect((await post(buyer, `/requests/${id}/withdraw`)).status).toBe(404);
    expect((await post(seller, `/requests/${id}/withdraw`)).body[0].status).toBe('WITHDRAWN');
    expect((await post(reia2, `/requests/${id}/decide`, { decision: 'APPROVED' })).status).toBe(400);
  });
});

describe('notices', () => {
  it('go one side to the other, are acknowledged by the receiver, and stay between those two', async () => {
    const sent = await post(seller, `/${contract.id}/notices`, { notice_type: 'FORCE_MAJEURE', subject: 'Flood at site', body: 'Works stopped since Monday.', event_date: day(-3) });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const n = sent.body[0];
    expect(n).toMatchObject({ sent_by_side: 'SELLER', counterparty_side: 'SELLER', awaiting: 'SJVN' });
    expect(n.notice_no).toMatch(/\/N\/001$/);

    expect((await ws(buyer)).body.notices).toEqual([]);
    expect((await post(seller, `/notices/${n.id}/acknowledge`)).status).toBe(400);
    expect((await post(finance, `/notices/${n.id}/acknowledge`)).status).toBe(403);
    expect((await post(buyer, `/notices/${n.id}/acknowledge`)).status).toBe(404);
    const ack = await post(reia2, `/notices/${n.id}/acknowledge`);
    expect(ack.body[0]).toMatchObject({ awaiting: null, acknowledged_by_name: 'Ravi REIA' });
    expect((await post(reia2, `/notices/${n.id}/acknowledge`)).status).toBe(400);

    // SJVN must say which party it is writing to when the contract has two.
    expect((await post(reia, `/${contract.id}/notices`, { notice_type: 'DEFAULT', subject: 's', body: 'b' })).status).toBe(400);
    const out = await post(reia, `/${contract.id}/notices`, { notice_type: 'CURE', subject: 'Cure period', body: 'Thirty days.', to_side: 'SELLER', reply_to: n.id, response_due: day(30) });
    expect(out.body[0]).toMatchObject({ sent_by_side: 'SJVN', awaiting: 'SELLER', parent_notice_id: n.id });
    expect((await ws(seller)).body.attention.notices_awaiting_me).toBe(1);
    expect((await ws(reia)).body.attention.notices_awaiting_me).toBe(0);
  });
});

describe('what is waiting', () => {
  it('is gathered for SJVN across contracts, and shows on the notification board', async () => {
    const [fc] = (await post(reia, `/${contract.id}/milestones/standard`)).body;
    await request(app).patch(`/api/contract-workspace/milestones/${fc.id}`).set(as(reia)).send({ due_date: day(-5) });
    await post(seller, `/${contract.id}/requests`, { request_type: 'OTHER', subject: 'Site visit', description: 'Please schedule' });
    await post(seller, `/${contract.id}/notices`, { notice_type: 'GENERAL', subject: 'Change of address', body: 'New registered office.' });

    const pending = await request(app).get('/api/contract-workspace/pending').set(as(reia));
    expect(pending.body.requests).toHaveLength(1);
    expect(pending.body.notices).toHaveLength(1);
    expect(pending.body.milestones_delayed[0]).toMatchObject({ delay_days: 5, counterparty: 'Alpha Solar' });
    expect((await request(app).get('/api/contract-workspace/pending').set(as(seller))).status).toBe(403);

    const summary = await request(app).get('/api/contract-workspace/summary').set(as(seller));
    expect(summary.body).toEqual([expect.objectContaining({ contract_id: contract.id, milestones_delayed: 1, requests_pending: 1, pbg_state: 'EXPIRING' })]);
    expect((await request(app).get('/api/contract-workspace/summary').set(as(otherSeller))).body).toEqual([]);

    const board = await request(app).get('/api/alerts/board').set(as(reia));
    const keys = board.body.alerts.filter((a) => a.group === 'CONTRACTS').map((a) => a.id).sort();
    expect(keys).toEqual(['contract-notices', 'contract-requests', 'milestones-delayed', 'pbg-expiring']);
  });
});

describe('on a PSA', () => {
  // SJVN selling to a buyer: no plant behind it, so nothing of the generator's side.
  let psa;
  beforeEach(() => {
    psa = makeContract({ contract_type: 'PSA', seller_id: alpha.id, buyer_id: discom.id, payment_security_type: 'LETTER_OF_CREDIT' });
    db.prepare(`UPDATE contracts SET seller_id = NULL, pbg_amount = 5000000, pbg_expiry = ? WHERE id = ?`).run(day(12), psa.id);
  });

  it('offers no milestones, performance guarantee or generator grounds', async () => {
    const file = (await ws(reia, psa.id)).body;
    expect(file).toMatchObject({ has_project: false, guarantee: null, milestones: [] });
    expect(file.attention.pbg_state).toBeNull();
    expect((await ws(buyer, psa.id)).body).toMatchObject({ request_types: ['AMENDMENT', 'OTHER'], request_grounds: ['FORCE_MAJEURE', 'CHANGE_IN_LAW', 'COMMERCIAL', 'OTHER'] });
    expect((await ws(seller)).body).toMatchObject({ has_project: true, request_types: ['MILESTONE_EXTENSION', 'AMENDMENT', 'PBG_RENEWAL', 'OTHER'] });
  });

  it('refuses project milestones and the requests that hang off them', async () => {
    expect((await post(reia, `/${psa.id}/milestones/standard`)).status).toBe(400);
    expect((await post(reia, `/${psa.id}/milestones`, { milestone_type: 'OTHER', label: 'LC opened' })).status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM contract_milestones WHERE contract_id = ?').get(psa.id).n).toBe(0);

    const ext = await post(buyer, `/${psa.id}/requests`, { request_type: 'MILESTONE_EXTENSION', requested_date: day(40), description: 'More time' });
    expect(ext.status).toBe(400);
    expect(ext.body.error).toMatch(/PSA/);
    expect((await post(buyer, `/${psa.id}/requests`, { request_type: 'OTHER', ground: 'LAND_DELAY', subject: 's', description: 'd' })).status).toBe(400);
    expect((await post(buyer, `/${psa.id}/requests`, { request_type: 'AMENDMENT', ground: 'CHANGE_IN_LAW', subject: 'Revised duty', description: 'New levy' })).status).toBe(200);
  });
});
