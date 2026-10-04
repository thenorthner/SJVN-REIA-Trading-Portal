import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { sweepBoards } from '../src/services/alertBoard.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from './helpers/reia.js';

// The notification board: an alert can be stood down by one person without
// leaving anyone else's board, what the board showed is remembered after it
// clears, and a person is sent only the alerts they asked for.

let reia, finance, seller, sellerCo, contract;
const as = (u) => auth(signToken(u));
const board = (u) => request(app).get('/api/alerts/board').set(as(u)).then((r) => r.body);
const alertOn = (b, key) => b.alerts.find((a) => a.id === key);
const overdue = (overrides = {}) => makeInvoice({ contract_id: contract.id, status: 'SENT', due_date: '2020-01-01', ...overrides });

beforeEach(() => {
  resetReia();
  for (const t of ['board_acknowledgements', 'board_alert_episodes', 'board_preferences', 'broadcast_messages', 'notification_deliveries']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  sellerCo = makeEntity('SELLER', { name: 'Alpha Solar' });
  contract = makeContract({ seller_id: sellerCo.id });
  reia = makeUser('REIA_USER', { name: 'Riya REIA' });
  finance = makeUser('FINANCE_USER', { name: 'Farhan Finance' });
  seller = makeUser('SELLER', { name: 'Arun Alpha', linked_entity_id: sellerCo.id });
});

describe('acknowledging', () => {
  it('takes an alert off one person’s board and out of their counts, and nobody else’s', async () => {
    overdue();
    const before = await board(reia);
    expect(alertOn(before, 'overdue-payments')).toMatchObject({ count: 1, group: 'BILLING', acknowledged: false });
    expect(before.summary.critical).toBe(1);

    const acked = await request(app).post('/api/alerts/board/ack').set(as(reia)).send({ kind: 'ALERT', key: 'overdue-payments' });
    expect(acked.status, JSON.stringify(acked.body)).toBe(200);
    expect(alertOn(acked.body, 'overdue-payments').acknowledged).toBe(true);
    expect(acked.body.summary).toMatchObject({ critical: 0, acknowledged: 1, total_items: 0 });

    expect(alertOn(await board(finance), 'overdue-payments').acknowledged).toBe(false);
    expect(alertOn(await board(seller), 'overdue-payments').acknowledged).toBe(false);
  });

  it('brings the alert back when it gets worse, and can be undone', async () => {
    overdue();
    await request(app).post('/api/alerts/board/ack').set(as(reia)).send({ kind: 'ALERT', key: 'overdue-payments' });
    overdue();
    expect(alertOn(await board(reia), 'overdue-payments')).toMatchObject({ count: 2, acknowledged: false });

    await request(app).post('/api/alerts/board/ack').set(as(reia)).send({ kind: 'ALERT', key: 'overdue-payments' });
    const undone = await request(app).post('/api/alerts/board/unack').set(as(reia)).send({ kind: 'ALERT', key: 'overdue-payments' });
    expect(alertOn(undone.body, 'overdue-payments').acknowledged).toBe(false);
  });

  it('does not carry over to a later occurrence of the same alert', async () => {
    const inv = overdue();
    await request(app).post('/api/alerts/board/ack').set(as(reia)).send({ kind: 'ALERT', key: 'overdue-payments' });
    db.prepare(`UPDATE invoices SET status = 'PAID' WHERE id = ?`).run(inv.id);
    expect(alertOn(await board(reia), 'overdue-payments')).toBeUndefined();
    overdue();
    expect(alertOn(await board(reia), 'overdue-payments')).toMatchObject({ count: 1, acknowledged: false });
  });

  it('works on a pinned message, and refuses what is not on the board', async () => {
    const b = await request(app).post('/api/alerts/broadcasts').set(as(reia)).send({ title: 'Freeze', message: 'Billing freeze on 31st', severity: 'WARNING' });
    const acked = await request(app).post('/api/alerts/board/ack').set(as(finance)).send({ kind: 'BROADCAST', key: b.body.id });
    expect(acked.body.broadcasts[0].acknowledged).toBe(true);
    expect(acked.body.summary.warning).toBe(0);
    expect((await board(reia)).broadcasts[0].acknowledged).toBe(false);

    expect((await request(app).post('/api/alerts/board/ack').set(as(reia)).send({ kind: 'ALERT', key: 'overdue-payments' })).status).toBe(404);
    expect((await request(app).post('/api/alerts/board/ack').set(as(reia)).send({ kind: 'NOPE', key: 'x' })).status).toBe(400);
  });
});

describe('history', () => {
  const history = (u, q = '') => request(app).get(`/api/alerts/history${q}`).set(as(u)).then((r) => r.body);

  it('keeps an alert after it clears, with how long it lasted and how bad it got', async () => {
    const a = overdue();
    await board(reia);
    overdue();
    await board(reia);
    db.prepare(`UPDATE invoices SET status = 'PAID'`).run();
    await board(reia);

    const h = await history(reia);
    const row = h.items.find((i) => i.item_key === 'overdue-payments');
    expect(row).toMatchObject({ kind: 'ALERT', severity: 'CRITICAL', grp: 'BILLING', peak_count: 2 });
    expect(row.ended_at).toBeTruthy();
    expect((await history(reia, '?status=open')).items).toHaveLength(0);
    expect((await history(reia, '?status=resolved&group=BILLING&severity=CRITICAL&q=overdue')).total).toBe(1);
    expect((await history(reia, '?group=DISPUTES')).total).toBe(0);
    expect(a.id).toBeTruthy();
  });

  it('is a board’s own: a company sees its history, not SJVN’s or another company’s', async () => {
    overdue();
    const other = makeContract();
    makeInvoice({ contract_id: other.id, status: 'SENT', due_date: '2020-01-01' });
    sweepBoards();

    const mine = (await history(seller)).items.find((i) => i.item_key === 'overdue-payments');
    expect(mine.peak_count).toBe(1);
    const staff = (await history(reia)).items.find((i) => i.item_key === 'overdue-payments');
    expect(staff.peak_count).toBe(2);
  });

  it('includes pinned messages, and comes a page at a time', async () => {
    for (const t of ['One', 'Two', 'Three']) {
      await request(app).post('/api/alerts/broadcasts').set(as(reia)).send({ title: t, message: 'm', audience: t === 'Three' ? 'BUYERS' : 'ALL' });
    }
    const first = await history(reia, '?limit=2');
    expect(first).toMatchObject({ total: 3, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect((await history(reia, '?limit=2&offset=2')).items).toHaveLength(1);
    // A message for buyers only is not part of a seller's history.
    expect((await history(seller)).items.map((i) => i.title).sort()).toEqual(['One', 'Two']);

    const gone = first.items[0];
    await request(app).delete(`/api/alerts/broadcasts/${gone.id}`).set(as(reia));
    expect((await history(reia, '?status=resolved')).items.map((i) => i.id)).toEqual([gone.id]);
  });
});

describe('email and SMS preferences', () => {
  const prefs = (u, body) => request(app).put('/api/alerts/preferences').set(as(u)).send(body);
  const sentTo = (u) => db.prepare(`SELECT * FROM notification_deliveries WHERE address = ? AND channel = 'EMAIL'`).all(u.email);
  const settle = () => new Promise((r) => setTimeout(r, 150));

  it('default to sending nothing, and are each person’s own', async () => {
    expect((await request(app).get('/api/alerts/preferences').set(as(reia))).body).toMatchObject({ email_min: 'NONE', sms_min: 'NONE' });
    expect((await prefs(reia, { email_min: 'CRITICAL' })).body).toMatchObject({ email_min: 'CRITICAL', sms_min: 'NONE' });
    expect((await request(app).get('/api/alerts/preferences').set(as(finance))).body.email_min).toBe('NONE');
    expect((await prefs(reia, { email_min: 'LOUD' })).status).toBe(400);
  });

  it('send a new alert once, to those who asked for that severity', async () => {
    await prefs(reia, { email_min: 'CRITICAL' });
    await prefs(finance, { email_min: 'INFO' });

    // A warning: finance asked for everything, REIA for critical only.
    makeInvoice({ contract_id: contract.id, status: 'SENT', due_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) });
    sweepBoards();
    await settle();
    expect(sentTo(reia)).toHaveLength(0);
    expect(sentTo(finance).map((d) => d.subject)).toEqual(['SJVN alert — Attention: Payments due this week']);
    // The seller never asked.
    expect(sentTo(seller)).toHaveLength(0);

    overdue();
    sweepBoards();
    await settle();
    expect(sentTo(reia).map((d) => d.subject)).toEqual(['SJVN alert — Critical: Overdue payments']);

    // Still on the board an hour later: nothing more is sent.
    sweepBoards();
    await board(reia);
    await settle();
    expect(sentTo(reia)).toHaveLength(1);
    expect(sentTo(finance)).toHaveLength(2);
  });
});
