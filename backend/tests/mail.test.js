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
  db.prepare('DELETE FROM mail_draft_files').run();
  db.prepare('DELETE FROM mail_drafts').run();
  db.prepare('DELETE FROM mail_settings').run();
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

// A PDF with its trailer: an attachment that is only a header is refused as unreadable.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\nstartxref\n9\n%%EOF');
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
    expect((await get(sellerA, '/api/mail?box=TRASH')).body).toHaveLength(1);
    await request(app).delete(`/api/mail/${r.body.id}?forever=1`).set(auth(tok(sellerA)));
    expect((await get(sellerA, '/api/mail?box=TRASH')).body).toHaveLength(0);
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
    // A switched-off account is now refused at the door, before the mail routes are reached.
    expect((await get(finance, '/api/mail?box=INBOX')).status).toBe(401);
    expect((await send(reia, { to: [finance.id], subject: 's', body: 'b' })).status).toBe(403);
  });
});

describe('attachments', () => {
  it('travels with the message and opens only for people who have it', async () => {
    const r = await request(app).post('/api/mail').set(auth(tok(reia)))
      .field('to', JSON.stringify([finance.id]))
      .field('subject', 'Bill copy')
      .field('body', 'Attached')
      .attach('files', PDF, 'bill.pdf');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const att = r.body.messages[0].attachments[0];
    expect(att.filename).toBe('bill.pdf');

    const dl = await get(finance, `/api/mail/attachments/${att.id}`);
    expect(dl.status).toBe(200);
    expect((await get(sellerA, `/api/mail/attachments/${att.id}`)).status).toBe(404);
  });
});

describe('blind copies', () => {
  it('delivers to the person blind-copied and tells no other recipient', async () => {
    const r = await send(reia, { to: [finance.id], bcc: [sellerA.id], subject: 'Quiet', body: 'x' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await get(sellerA, '/api/mail?box=INBOX')).body).toHaveLength(1);

    const kinds = (as) => get(as, `/api/mail/${r.body.id}`)
      .then((x) => x.body.messages[0].recipients.map((p) => `${p.kind}:${p.name}`));
    expect(await kinds(finance)).toEqual(['TO:Farhan Finance']);
    expect(await kinds(reia)).toEqual(['TO:Farhan Finance', 'BCC:Arun Alpha']);
    expect(await kinds(sellerA)).toEqual(['TO:Farhan Finance', 'BCC:Arun Alpha']);
    expect((await get(finance, '/api/mail?box=INBOX')).body[0].recipients.map((p) => p.kind)).toEqual(['TO']);
  });

  it('holds a blind copy to the same rule on who may be written to', async () => {
    expect((await send(sellerA, { to: [reia.id], bcc: [sellerB.id], subject: 's', body: 'b' })).status).toBe(403);
  });
});

describe('formatted messages', () => {
  it('keeps the formatting, drops anything that could run, and stays searchable', async () => {
    const r = await send(reia, {
      to: [finance.id], subject: 'Rich',
      body_html: '<p>Pay <strong>today</strong></p><script>alert(1)</script><img src=x onerror=alert(1)>'
        + '<p onclick="x()">see <a href="javascript:alert(1)">this</a> and <a href="https://sjvn.nic.in">that</a></p>',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const m = r.body.messages[0];
    expect(m.body_html).toContain('<strong>today</strong>');
    expect(m.body_html).not.toMatch(/script|onerror|onclick|javascript:|<img/i);
    expect(m.body_html).toContain('rel="noopener noreferrer"');
    expect(m.body).toContain('Pay today');
    expect((await get(finance, '/api/mail?box=INBOX&q=pay today')).body).toHaveLength(1);
  });

  it('refuses a formatted message with nothing written in it', async () => {
    expect((await send(reia, { to: [finance.id], subject: 's', body_html: '<p><br></p>' })).status).toBe(400);
  });
});

describe('unread filter and order', () => {
  it('lists only what has not been opened, oldest or newest first', async () => {
    const a = await send(reia, { to: [finance.id], subject: 'First', body: 'x' });
    await send(reia, { to: [finance.id], subject: 'Second', body: 'x' });
    expect((await get(finance, '/api/mail?box=INBOX&sort=oldest')).body.map((m) => m.subject)).toEqual(['First', 'Second']);
    await get(finance, `/api/mail/${a.body.id}`);
    expect((await get(finance, '/api/mail?box=INBOX&unread=1')).body.map((m) => m.subject)).toEqual(['Second']);
  });
});

describe('forwarding', () => {
  it('carries the original attachments to the new reader, and only ones the sender has', async () => {
    const r = await request(app).post('/api/mail').set(auth(tok(reia)))
      .field('to', JSON.stringify([finance.id])).field('subject', 'Bill').field('body', 'Attached')
      .attach('files', PDF, 'bill.pdf');
    const att = r.body.messages[0].attachments[0];

    const fwd = await send(finance, { to: [sellerA.id], subject: 'Fwd: Bill', body: 'See below', forward_attachments: [att.id] });
    expect(fwd.status, JSON.stringify(fwd.body)).toBe(201);
    const copy = (await get(sellerA, `/api/mail/${fwd.body.id}`)).body.messages[0].attachments[0];
    expect(copy.filename).toBe('bill.pdf');
    expect(copy.id).not.toBe(att.id);
    expect((await get(sellerA, `/api/mail/attachments/${copy.id}`)).status).toBe(200);
    // The forward is its own conversation: the original stays closed to the new reader.
    expect((await get(sellerA, `/api/mail/${r.body.id}`)).status).toBe(404);

    const steal = await send(sellerB, { to: [reia.id], subject: 'x', body: 'y', forward_attachments: [att.id] });
    expect(steal.status).toBe(404);
  });
});

describe('drafts', () => {
  const as = (u) => auth(tok(u));

  it('keeps a half-written message, saves over it, and drops it once sent', async () => {
    const made = await request(app).post('/api/mail/drafts').set(as(reia)).send({ subject: 'Half' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const saved = await request(app).put(`/api/mail/drafts/${made.body.id}`).set(as(reia))
      .send({ to: [finance.id], bcc: [sellerA.id], subject: 'Whole', body_html: '<p>Done</p>' });
    expect(saved.body).toMatchObject({ subject: 'Whole', body: 'Done' });
    expect(saved.body.to.map((p) => p.name)).toEqual(['Farhan Finance']);
    expect(saved.body.bcc.map((p) => p.name)).toEqual(['Arun Alpha']);

    expect((await get(reia, '/api/mail/drafts')).body).toHaveLength(1);
    expect((await get(reia, '/api/mail/unread-count')).body.drafts).toBe(1);
    // Nothing has reached anyone yet.
    expect((await get(finance, '/api/mail?box=INBOX')).body).toHaveLength(0);

    const sent = await send(reia, { to: [finance.id], subject: 'Whole', body_html: '<p>Done</p>', draft_id: made.body.id });
    expect(sent.status).toBe(201);
    expect((await get(reia, '/api/mail/drafts')).body).toHaveLength(0);
  });

  it("is its author's alone", async () => {
    const made = await request(app).post('/api/mail/drafts').set(as(reia)).send({ subject: 'Mine' });
    expect((await get(finance, `/api/mail/drafts/${made.body.id}`)).status).toBe(404);
    expect((await request(app).put(`/api/mail/drafts/${made.body.id}`).set(as(finance)).send({ subject: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/api/mail/drafts/${made.body.id}`).set(as(finance))).status).toBe(404);
    expect((await request(app).delete(`/api/mail/drafts/${made.body.id}`).set(as(reia))).status).toBe(200);
  });
});

describe('signature', () => {
  it('is kept per person', async () => {
    const put = await request(app).put('/api/mail/settings').set(auth(tok(reia))).send({ signature: 'Riya\nREIA Cell, SJVN' });
    expect(put.body.signature).toBe('Riya\nREIA Cell, SJVN');
    expect((await get(reia, '/api/mail/settings')).body.signature).toBe('Riya\nREIA Cell, SJVN');
    expect((await get(finance, '/api/mail/settings')).body.signature).toBe('');
  });
});

describe('trash', () => {
  const as = (u) => auth(tok(u));

  it('holds a deleted message until it is restored', async () => {
    const r = await send(reia, { to: [finance.id], subject: 'Oops', body: 'x' });
    await request(app).delete(`/api/mail/${r.body.id}`).set(as(finance));
    expect((await get(finance, '/api/mail/unread-count')).body.unread).toBe(0);
    const opened = await get(finance, `/api/mail/${r.body.id}`);
    expect(opened.body).toMatchObject({ trashed: true });

    expect((await request(app).post(`/api/mail/${r.body.id}/restore`).set(as(finance))).status).toBe(200);
    expect((await get(finance, '/api/mail?box=INBOX')).body.map((m) => m.subject)).toEqual(['Oops']);
    expect((await get(finance, '/api/mail?box=TRASH')).body).toHaveLength(0);
  });

  it('empties itself of what has been there too long', async () => {
    const r = await send(reia, { to: [finance.id], subject: 'Old', body: 'x' });
    await request(app).delete(`/api/mail/${r.body.id}`).set(as(finance));
    db.prepare(`UPDATE mail_boxes SET deleted_at = datetime('now', '-31 days') WHERE user_id = ?`).run(finance.id);
    expect((await get(finance, '/api/mail?box=TRASH')).body).toHaveLength(0);
    expect((await request(app).post(`/api/mail/${r.body.id}/restore`).set(as(finance))).status).toBe(404);
    // The sender's copy is untouched.
    expect((await get(reia, `/api/mail/${r.body.id}`)).status).toBe(200);
  });
});

describe('stars, bulk actions and pages', () => {
  const as = (u) => auth(tok(u));

  it('stars a message for one person only', async () => {
    const r = await send(reia, { to: [finance.id, sellerA.id], subject: 'Keep', body: 'x' });
    await request(app).post(`/api/mail/${r.body.id}/star`).set(as(finance)).send({ starred: true });
    expect((await get(finance, '/api/mail?box=STARRED')).body.map((m) => m.subject)).toEqual(['Keep']);
    expect((await get(finance, '/api/mail?box=INBOX')).body[0].is_starred).toBe(true);
    expect((await get(sellerA, '/api/mail?box=STARRED')).body).toHaveLength(0);
    await request(app).post(`/api/mail/${r.body.id}/star`).set(as(finance)).send({ starred: false });
    expect((await get(finance, '/api/mail?box=STARRED')).body).toHaveLength(0);
  });

  it('acts on many messages at once, passing over ones that are not theirs', async () => {
    const a = await send(reia, { to: [finance.id], subject: 'A', body: 'x' });
    const b = await send(reia, { to: [finance.id], subject: 'B', body: 'x' });
    const other = await send(reia, { to: [sellerA.id], subject: 'Not yours', body: 'x' });
    const bulk = (action, ids) => request(app).post('/api/mail/bulk').set(as(finance)).send({ action, ids });

    const read = await bulk('read', [a.body.id, b.body.id, other.body.id]);
    expect(read.body).toMatchObject({ done: 2, unread: 0 });
    expect((await get(sellerA, '/api/mail/unread-count')).body.unread).toBe(1);

    await bulk('trash', [a.body.id, b.body.id]);
    expect((await get(finance, '/api/mail?box=INBOX')).body).toHaveLength(0);
    await bulk('restore', [a.body.id]);
    await bulk('purge', [b.body.id]);
    expect((await get(finance, '/api/mail?box=INBOX')).body.map((m) => m.subject)).toEqual(['A']);
    expect((await get(finance, '/api/mail?box=TRASH')).body).toHaveLength(0);
    expect((await bulk('explode', [a.body.id])).status).toBe(400);
  });

  it('pages through a folder', async () => {
    for (const s of ['1', '2', '3']) await send(reia, { to: [finance.id], subject: s, body: 'x' });
    const page = (q) => get(finance, `/api/mail?box=INBOX&sort=oldest&${q}`).then((r) => r.body.map((m) => m.subject));
    expect(await page('limit=2')).toEqual(['1', '2']);
    expect(await page('limit=2&offset=2')).toEqual(['3']);
  });
});

describe('read receipts', () => {
  it('tell the sender who has opened it, survive mark-unread, and tell nobody else', async () => {
    const r = await send(reia, { to: [finance.id, sellerA.id], subject: 'Seen?', body: 'x' });
    await get(finance, `/api/mail/${r.body.id}`);
    await request(app).post(`/api/mail/${r.body.id}/read`).set(auth(tok(finance))).send({ read: false });

    const mine = (await get(reia, `/api/mail/${r.body.id}`)).body.messages[0].recipients;
    expect(mine.find((p) => p.id === finance.id).opened_at).toBeTruthy();
    expect(mine.find((p) => p.id === sellerA.id).opened_at).toBeNull();

    const theirs = (await get(sellerA, `/api/mail/${r.body.id}`)).body.messages[0].recipients;
    expect(theirs.every((p) => !('opened_at' in p))).toBe(true);
  });
});

describe('draft attachments', () => {
  const as = (u) => auth(tok(u));

  it('stay on the draft and go out with the message', async () => {
    const d = await request(app).post('/api/mail/drafts').set(as(reia)).send({ subject: 'With file' });
    const up = await request(app).post(`/api/mail/drafts/${d.body.id}/files`).set(as(reia))
      .attach('files', PDF, 'a.pdf').attach('files', Buffer.from('b'), 'b.txt');
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.files.map((f) => f.filename)).toEqual(['a.pdf', 'b.txt']);

    const off = await request(app).delete(`/api/mail/drafts/${d.body.id}/files/${up.body.files[1].id}`).set(as(reia));
    expect(off.body.files.map((f) => f.filename)).toEqual(['a.pdf']);
    expect((await get(reia, `/api/mail/drafts/${d.body.id}`)).body.files).toHaveLength(1);
    // Not anyone else's to add to.
    expect((await request(app).post(`/api/mail/drafts/${d.body.id}/files`).set(as(finance))
      .attach('files', Buffer.from('x'), 'x.txt')).status).toBe(404);

    const sent = await send(reia, { to: [finance.id], subject: 'With file', body: 'See attached', draft_id: d.body.id });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const att = sent.body.messages[0].attachments;
    expect(att.map((a) => a.filename)).toEqual(['a.pdf']);
    expect((await get(finance, `/api/mail/attachments/${att[0].id}`)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) c FROM mail_draft_files').get().c).toBe(0);
  });
});

describe('tables', () => {
  it('are kept in a formatted message', async () => {
    const r = await send(reia, {
      to: [finance.id], subject: 'Table',
      body_html: '<table style="x"><tbody><tr><td data-row="r1">Plant</td><td>MU</td></tr><tr><td>NJHPS</td><td>12.5</td></tr></tbody></table>',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const m = r.body.messages[0];
    expect(m.body_html).toContain('<table><tbody><tr><td>Plant</td><td>MU</td></tr>');
    expect(m.body).toContain('NJHPS 12.5');
  });
});
