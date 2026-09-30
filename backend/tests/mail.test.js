import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity } from './helpers/reia.js';

// In-portal mail: what one person writes lands in the other's inbox, and a
// seller, buyer or trading client can reach SJVN and their own colleagues —
// never another company, and never learn who else SJVN wrote to.

let reia, finance, sellerA, sellerA2, sellerB, companyA, companyB;
const tok = (u) => signToken(u);

beforeEach(() => {
  db.prepare('DELETE FROM mail_attachments').run();
  db.prepare('DELETE FROM mail_boxes').run();
  db.prepare('DELETE FROM mail_messages').run();
  companyA = makeEntity('SELLER', { name: 'Alpha Solar' });
  companyB = makeEntity('SELLER', { name: 'Beta Wind' });
  reia = makeUser('REIA_USER', { name: 'Riya REIA' });
  finance = makeUser('FINANCE_USER', { name: 'Farhan Finance' });
  sellerA = makeUser('SELLER', { name: 'Arun Alpha', linked_entity_id: companyA.id });
  sellerA2 = makeUser('SELLER_L1', { name: 'Asha Alpha', linked_entity_id: companyA.id });
  sellerB = makeUser('SELLER', { name: 'Bina Beta', linked_entity_id: companyB.id });
});

const send = (from, body) => request(app).post('/api/mail').set(auth(tok(from))).send(body);
const get = (as, url) => request(app).get(url).set(auth(tok(as)));

describe('sending and receiving', () => {
  it("lands in the recipient's inbox, unread, and in the sender's sent box", async () => {
    const r = await send(reia, { to: [finance.id], subject: 'June posting', body: 'Please check the June sale.' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const inbox = await get(finance, '/api/mail?box=INBOX');
    expect(inbox.body).toHaveLength(1);
    expect(inbox.body[0]).toMatchObject({ subject: 'June posting', sender_name: 'Riya REIA', is_read: false });
    expect((await get(finance, '/api/mail/unread-count')).body.unread).toBe(1);

    const sent = await get(reia, '/api/mail?box=SENT');
    expect(sent.body.map((m) => m.subject)).toEqual(['June posting']);
    expect((await get(reia, '/api/mail?box=INBOX')).body).toHaveLength(0);

    // The bell says it arrived.
    const bell = db.prepare(`SELECT * FROM notifications WHERE user_id = ? AND type = 'MAIL'`).all(finance.id);
    expect(bell).toHaveLength(1);
  });

  it('opening a message marks it read, and it can be marked unread again', async () => {
    const r = await send(reia, { to: [finance.id], subject: 'Hi', body: 'x' });
    const opened = await get(finance, `/api/mail/${r.body.id}`);
    expect(opened.status).toBe(200);
    expect((await get(finance, '/api/mail/unread-count')).body.unread).toBe(0);
    await request(app).post(`/api/mail/${r.body.id}/read`).set(auth(tok(finance))).send({ read: false });
    expect((await get(finance, '/api/mail/unread-count')).body.unread).toBe(1);
  });

  it('keeps a reply in the same conversation', async () => {
    const first = await send(reia, { to: [finance.id], subject: 'Voucher', body: 'Number?' });
    const reply = await send(finance, { to: [reia.id], subject: 'Re: Voucher', body: 'VCH-1', reply_to: first.body.id });
    expect(reply.status).toBe(201);
    const thread = await get(reia, `/api/mail/${reply.body.id}`);
    expect(thread.body.messages.map((m) => m.body)).toEqual(['Number?', 'VCH-1']);
  });

  it('archiving or deleting is one person’s choice and leaves everyone else’s copy alone', async () => {
    const r = await send(reia, { to: [finance.id, sellerA.id], subject: 'Both', body: 'x' });
    await request(app).post(`/api/mail/${r.body.id}/archive`).set(auth(tok(finance))).send({ archived: true });
    expect((await get(finance, '/api/mail?box=INBOX')).body).toHaveLength(0);
    expect((await get(finance, '/api/mail?box=ARCHIVE')).body).toHaveLength(1);

    await request(app).delete(`/api/mail/${r.body.id}`).set(auth(tok(sellerA)));
    expect((await get(sellerA, '/api/mail?box=INBOX')).body).toHaveLength(0);
    expect((await get(sellerA, `/api/mail/${r.body.id}`)).status).toBe(404);
    expect((await get(reia, '/api/mail?box=SENT')).body).toHaveLength(1);
  });

  it('refuses a message with no recipient, subject or body', async () => {
    expect((await send(reia, { to: [], subject: 's', body: 'b' })).status).toBe(400);
    expect((await send(reia, { to: [finance.id], subject: ' ', body: 'b' })).status).toBe(400);
    expect((await send(reia, { to: [finance.id], subject: 's', body: '' })).status).toBe(400);
  });
});

describe('who may write to whom', () => {
  it('lets a counterparty write to SJVN and to its own colleagues', async () => {
    expect((await send(sellerA, { to: [reia.id], subject: 's', body: 'b' })).status).toBe(201);
    expect((await send(sellerA, { to: [sellerA2.id], subject: 's', body: 'b' })).status).toBe(201);
  });

  it('refuses a counterparty writing to another company', async () => {
    const r = await send(sellerA, { to: [sellerB.id], subject: 's', body: 'b' });
    expect(r.status).toBe(403);
    expect((await get(sellerB, '/api/mail?box=INBOX')).body).toHaveLength(0);
  });

  it("keeps other companies out of a counterparty's address book", async () => {
    const book = (await get(sellerA, '/api/mail/directory')).body.map((u) => u.id);
    expect(book).toContain(reia.id);
    expect(book).toContain(sellerA2.id);
    expect(book).not.toContain(sellerB.id);
    expect(book).not.toContain(sellerA.id);

    const staffBook = (await get(reia, '/api/mail/directory')).body.map((u) => u.id);
    expect(staffBook).toEqual(expect.arrayContaining([sellerA.id, sellerB.id, finance.id]));
  });

  it('does not show one company who else SJVN wrote to', async () => {
    const r = await send(reia, { to: [sellerA.id, sellerB.id], cc: [finance.id], subject: 'Tariff', body: 'x' });
    const seenByA = await get(sellerA, `/api/mail/${r.body.id}`);
    const names = seenByA.body.messages[0].recipients.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['Arun Alpha', 'Farhan Finance']));
    expect(names).not.toContain('Bina Beta');

    const seenByStaff = await get(reia, `/api/mail/${r.body.id}`);
    expect(seenByStaff.body.messages[0].recipients.map((x) => x.name)).toContain('Bina Beta');
  });

  it("will not let someone reply into a conversation they were never on", async () => {
    const r = await send(reia, { to: [finance.id], subject: 'Internal', body: 'x' });
    const sneak = await send(sellerA, { to: [reia.id], subject: 'Re', body: 'y', reply_to: r.body.id });
    expect(sneak.status).toBe(404);
    expect((await get(sellerA, `/api/mail/${r.body.id}`)).status).toBe(404);
  });

  it('treats trading-client logins as colleagues whichever way they are linked', async () => {
    const ent = makeEntity('BUYER', { name: 'Gamma Traders' });
    const clientId = `TC-${Math.random().toString(36).slice(2, 10)}`;
    db.prepare(`INSERT INTO trading_clients (id, entity_id, name, client_type) VALUES (?, ?, 'Gamma Traders', 'TRADER')`)
      .run(clientId, ent.id);
    const byClient = makeUser('TRADING_CLIENT_MAKER', { name: 'Gita Gamma', linked_entity_id: clientId });
    const byEntity = makeUser('TRADING_CLIENT_CHECKER', { name: 'Gopal Gamma', linked_entity_id: ent.id });
    expect((await send(byClient, { to: [byEntity.id], subject: 's', body: 'b' })).status).toBe(201);
    const book = (await get(byClient, '/api/mail/directory')).body;
    expect(book.find((u) => u.id === byEntity.id)?.company).toBe('Gamma Traders');
  });

  it('lets an unlinked counterparty login reach SJVN only, and does not call it SJVN', async () => {
    const loose = makeUser('TRADING_CLIENT', { name: 'Loose Login' });
    const loose2 = makeUser('SELLER', { name: 'Loose Seller' });
    expect((await send(loose, { to: [loose2.id], subject: 's', body: 'b' })).status).toBe(403);
    expect((await send(loose, { to: [reia.id], subject: 's', body: 'b' })).status).toBe(201);
    const staffBook = (await get(reia, '/api/mail/directory?q=loose')).body;
    expect(staffBook.map((u) => u.company)).toEqual(['No company linked', 'No company linked']);
  });

  it('refuses a deactivated login', async () => {
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(finance.id);
    expect((await get(finance, '/api/mail?box=INBOX')).status).toBe(403);
    expect((await send(reia, { to: [finance.id], subject: 's', body: 'b' })).status).toBe(403);
  });
});

describe('attachments', () => {
  it('travels with the message and opens only for people who have it', async () => {
    const r = await request(app).post('/api/mail').set(auth(tok(reia)))
      .field('to', JSON.stringify([finance.id]))
      .field('subject', 'Bill copy')
      .field('body', 'Attached')
      .attach('files', Buffer.from('%PDF-1.4 test'), 'bill.pdf');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const att = r.body.messages[0].attachments[0];
    expect(att.filename).toBe('bill.pdf');

    const dl = await get(finance, `/api/mail/attachments/${att.id}`);
    expect(dl.status).toBe(200);
    expect((await get(sellerA, `/api/mail/attachments/${att.id}`)).status).toBe(404);
  });
});
