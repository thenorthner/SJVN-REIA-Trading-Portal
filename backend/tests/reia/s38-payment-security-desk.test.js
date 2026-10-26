import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { signToken } from '../../src/middleware/auth.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// The payment security desk, as reading it for its first end-to-end test found
// it: a refused release that revived a lapsed guarantee, a release that could
// never be approved once it had been asked for too early, a waterfall that
// filed a notice for a draw of nothing, and a demand sent to every buyer on the
// platform.

let reia, checker, finance, sellerCo, buyerCo, otherBuyerCo, ppa, psa, seller, buyer, otherBuyer;

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const get = (path, who = reia) => request(app).get(path).set(auth(who));
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const row = (id) => db.prepare('SELECT * FROM payment_security WHERE id = ?').get(id);
const notesFor = (user) => db.prepare('SELECT message FROM notifications WHERE user_id = ?').all(user.id).map((n) => n.message);

function instrument(contract, over = {}) {
  const id = newId('PSC');
  const r = {
    id, instrument_no: `PS/T/${id.slice(-6)}`, contract_id: contract.id, mechanism_type: 'LC', is_revolving: 1,
    limit_amount: 1000000, utilized_amount: 0, waterfall_priority: 10, issuing_bank: 'SBI',
    validity_start: day(-30), validity_end: day(300), status: 'ACTIVE', ...over,
  };
  r.available_amount = r.limit_amount - r.utilized_amount;
  const keys = Object.keys(r);
  db.prepare(`INSERT INTO payment_security (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => r[k]));
  return row(id);
}
const create = (over = {}) => post('/api/payment-security', {
  contract_id: psa.id, mechanism_type: 'LC', limit_amount: 1000000, issuing_bank: 'SBI', bank_reference_no: `LC-${Math.random()}`, validity_start: day(-1), validity_end: day(300), ...over,
});
const bill = (contract, over = {}) => makeInvoice({
  contract_id: contract.id, direction: contract.contract_type === 'PSA' ? 'SJVN_TO_BUYER' : 'SELLER_TO_SJVN',
  status: 'SENT', total_amount: 400000, energy_charges: 400000, due_date: day(-45), ...over,
});

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER', { name: 'Riya REIA' });
  // Phase B.2: the checker moves a demand on, draws and decides a release.
  checker = tokenFor('REIA_CHECKER', { name: 'Chetan Checker' });
  finance = tokenFor('FINANCE_USER');
  sellerCo = makeEntity('SELLER');
  buyerCo = makeEntity('BUYER');
  otherBuyerCo = makeEntity('BUYER');
  ppa = makeContract({ contract_type: 'PPA', seller_id: sellerCo.id });
  psa = makeContract({ contract_type: 'PSA', buyer_id: buyerCo.id });
  db.prepare('UPDATE contracts SET buyer_id = NULL WHERE id = ?').run(ppa.id);
  db.prepare('UPDATE contracts SET seller_id = NULL WHERE id = ?').run(psa.id);
  seller = makeUser('SELLER', { linked_entity_id: sellerCo.id });
  buyer = makeUser('BUYER', { linked_entity_id: buyerCo.id });
  otherBuyer = makeUser('BUYER', { linked_entity_id: otherBuyerCo.id });
});

describe('Recording an instrument', () => {
  it('is held to a real contract, a real amount and dates that run forwards', async () => {
    expect((await create({ contract_id: 'CON-nowhere' })).status, 'an unknown contract came back as a server error').toBe(404);
    expect((await create({ limit_amount: 0 })).status).toBe(400);
    expect((await create({ limit_amount: -5 })).status).toBe(400);
    expect((await create({ mechanism_type: 'PROMISE' })).status).toBe(400);
    const dates = await create({ validity_start: '2027-01-01', validity_end: '2026-12-01' });
    expect(dates.status).toBe(400);
    expect(dates.body.error).toMatch(/cannot end before it starts/);
    expect((await create({ mechanism_type: 'BANK_GUARANTEE', bg_subtype: 'SURETY' })).status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) c FROM payment_security').get().c).toBe(0);
  });

  it('answers a number already in use in words, and files a lapsed one as lapsed', async () => {
    const first = await create({ instrument_no: 'PS/LC/QA/1' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const twin = await create({ instrument_no: 'PS/LC/QA/1' });
    expect(twin.status, 'a duplicate number came back as a server error').toBe(409);
    expect(twin.body.error).toMatch(/already on record/);

    const old = await create({ validity_start: day(-400), validity_end: day(-10) });
    expect(old.status).toBe(201);
    expect(old.body.status).toBe('EXPIRED');
  });
});

describe('Invoking the waterfall from the desk', () => {
  it("draws the seller's guarantee on a PPA without being told whose default it is", async () => {
    // The form names no side and the route assumed the buyer's, so on a PPA —
    // where the only cover is the seller's guarantee — it drew nothing.
    const bg = instrument(ppa, { mechanism_type: 'BANK_GUARANTEE', bg_subtype: 'PBG', is_revolving: 0, waterfall_priority: 20 });
    const r = await post('/api/payment-security/invocations', { contract_id: ppa.id, amount: 250000, reason: 'PBG invoked: commissioning missed the scheduled date' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'NOTICE_ISSUED', amount: 250000, payment_security_id: bg.id });
    expect(row(bg.id)).toMatchObject({ utilized_amount: 250000, status: 'PARTIALLY_UTILIZED' });
    const letter = JSON.parse(r.body.demand_letter_json);
    expect(letter).toMatchObject({ side: 'SELLER', amount: 250000 });
    expect(letter.subject, 'the letter named the contract by its internal id').toContain(ppa.contract_no);
  });

  it("does not take SJVN's own unpaid bill to a seller for the seller's default", async () => {
    // A seller's invoice SJVN is late in paying is money SJVN owes. With no
    // amount typed it was read as the overdue amount and drawn from the
    // seller's own guarantee.
    const bg = instrument(ppa, { mechanism_type: 'BANK_GUARANTEE', bg_subtype: 'PBG', is_revolving: 0, waterfall_priority: 20 });
    bill(ppa);                                          // SELLER_TO_SJVN, sent, 45 days past due
    const r = await post('/api/payment-security/invocations', { contract_id: ppa.id });
    expect(r.status, "the seller's guarantee was drawn for SJVN's own overdue payable").toBe(400);
    expect(r.body.error).toMatch(/Enter the amount/);
    expect(row(bg.id).utilized_amount).toBe(0);
    // Nor does it hold up the release of that guarantee.
    expect((await get(`/api/security-desk/instruments/${bg.id}`, signToken(seller))).body.release_check).toMatchObject({ clear: true, outstanding_dues: 0 });
  });

  it('files no notice, and tells nobody, when there is nothing to draw', async () => {
    bill(psa);
    const r = await post('/api/payment-security/invocations', { contract_id: psa.id, amount: 100000 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/No demand notice was raised/);
    expect(db.prepare('SELECT COUNT(*) c FROM security_invocations').get().c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM notifications').get().c, 'a demand for nothing was announced').toBe(0);
  });

  it('asks for an amount in words, and takes only what is overdue when none is given', async () => {
    instrument(psa);
    expect((await post('/api/payment-security/invocations', { contract_id: psa.id, amount: 0 })).body.error).toMatch(/more than zero/);
    const none = await post('/api/payment-security/invocations', { contract_id: psa.id });
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/overdue by 30 days/);
    expect((await post('/api/payment-security/invocations', { contract_id: 'CON-nowhere', amount: 5 })).status).toBe(404);

    // A bill still in approval and one SJVN rejected are not money owed.
    bill(psa, { status: 'UNDER_APPROVAL' });
    bill(psa, { status: 'REJECTED', billing_period: '2026-05' });
    expect((await post('/api/payment-security/invocations', { contract_id: psa.id })).status, 'cover was invoked for a bill never presented').toBe(400);

    const sent = bill(psa, { billing_period: '2026-06' });
    const due = await post('/api/payment-security/invocations', { contract_id: psa.id });
    expect(due.status, JSON.stringify(due.body)).toBe(201);
    expect(due.body.amount).toBe(400000);
    expect(JSON.parse(due.body.demand_letter_json).invoice_nos).toEqual([sent.invoice_no]);
  });

  it("tells the buyer whose letter of credit it is, and no other buyer", async () => {
    const lc = instrument(psa);
    bill(psa);
    const r = await post('/api/payment-security/invocations', { contract_id: psa.id, amount: 300000 });
    expect(r.status).toBe(201);
    expect(notesFor(buyer).join(' ')).toContain(lc.instrument_no);
    expect(notesFor(otherBuyer), 'a buyer with no part in it was told to replenish').toEqual([]);
    expect(db.prepare(`SELECT COUNT(*) c FROM notifications WHERE role = 'BUYER'`).get().c).toBe(0);
  });

  it('moves a demand forwards only', async () => {
    instrument(psa);
    bill(psa);
    const inv = (await post('/api/payment-security/invocations', { contract_id: psa.id, amount: 300000 })).body;
    const move = (status) => post(`/api/payment-security/invocations/${inv.id}/transition`, { status }, checker);
    const skip = await move('FUNDS_RECEIVED');
    expect(skip.status, 'funds were recorded on a demand never lodged with the bank').toBe(400);
    expect(skip.body.error).toMatch(/cannot move/);
    expect((await move('CLAIMED')).status).toBe(200);
    expect((await move('FUNDS_RECEIVED')).status).toBe(200);
    expect((await move('NOTICE_ISSUED')).status, 'a demand already paid was put back to a notice').toBe(400);
    expect((await move('REJECTED')).status).toBe(400);
  });

  it('shows a demand letter only on the instruments it drew', async () => {
    const lc = instrument(psa, { limit_amount: 100000 });
    const pool = instrument(psa, { mechanism_type: 'CORPUS_FUND', is_revolving: 0, waterfall_priority: 40 });
    const untouched = instrument(psa, { mechanism_type: 'BANK_GUARANTEE', is_revolving: 0, waterfall_priority: 20 });
    bill(psa);
    await post('/api/payment-security/invocations', { contract_id: psa.id, amount: 300000 });
    expect((await get(`/api/payment-security/${lc.id}`)).body.invocations).toHaveLength(1);
    expect((await get(`/api/payment-security/${pool.id}`)).body.invocations, 'the second instrument drawn showed no demand').toHaveLength(1);
    expect((await get(`/api/payment-security/${untouched.id}`)).body.invocations).toHaveLength(0);
    // And the buyer sees its own draw on the pooled instrument, not the whole demand.
    const mine = (await get(`/api/security-desk/instruments/${pool.id}`, signToken(buyer))).body.invocations;
    expect(mine).toHaveLength(1);
    expect(mine[0].amount).toBe(200000);
  });
});

describe('Drawing on an instrument', () => {
  it('is only possible while it is in force', async () => {
    const draw = (ps, amount = 1000) => post(`/api/payment-security/${ps.id}/utilize`, { amount, reason: 'Drawn for the test default' }, checker);
    for (const status of ['DRAFT', 'RELEASED', 'CLOSED', 'EXPIRED']) {
      const r = await draw(instrument(psa, { status }));
      expect(r.status, `a draw was taken on an instrument that is ${status}`).toBe(400);
      expect(r.body.error).toMatch(/cannot be drawn on/);
    }
    // A release asked for is not a release given: it is still SJVN's security.
    expect((await draw(instrument(psa, { status: 'RELEASE_PENDING' }))).status).toBe(200);
    const lapsed = await draw(instrument(psa, { validity_end: day(-2) }));
    expect(lapsed.status).toBe(400);
    expect(lapsed.body.error).toMatch(/expired on/);

    const live = instrument(psa);
    const over = await draw(live, 2000000);
    expect(over.body.error).toMatch(/Only ₹10,00,000 is available/);
    expect((await draw(live, 0)).body.error).toMatch(/more than zero/);
    expect((await draw(live, 250000)).status).toBe(200);
    expect(row(live.id)).toMatchObject({ utilized_amount: 250000, status: 'PARTIALLY_UTILIZED' });
  });

  it('says in rupees what can be put back', async () => {
    const ps = instrument(psa, { utilized_amount: 400000, status: 'PARTIALLY_UTILIZED' });
    const r = await post(`/api/payment-security/${ps.id}/replenish`, { amount: 900000 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Only ₹4,00,000 has been drawn/);
    expect(r.body.error).not.toMatch(/\/renew/);
    // A buyer reinstating its own letter of credit is at least reported to the desk.
    expect((await post(`/api/payment-security/${ps.id}/replenish`, { amount: 400000 }, signToken(buyer))).status).toBe(200);
    expect(db.prepare(`SELECT message FROM notifications WHERE role = 'REIA_MAKER'`).all().map((n) => n.message).join(' ')).toMatch(/reinstated/);
  });
});

describe('What the first end-to-end run found', () => {
  it('tells the owner of every draw, with dates and money as people write them', async () => {
    // Only a draw that left a revolving LC short was announced.
    const plain = instrument(psa, { is_revolving: 0 });
    await post(`/api/payment-security/${plain.id}/utilize`, { amount: 100000, reason: 'Drawn for the test default' }, checker);
    expect(notesFor(buyer).join(' ')).toMatch(/₹1,00,000 has been drawn on .* leaving ₹9,00,000\./);
    expect(notesFor(otherBuyer)).toEqual([]);

    const soon = instrument(psa, { validity_end: day(5) });
    await post('/api/payment-security/alerts/run');
    const alert = db.prepare('SELECT message FROM security_alerts WHERE payment_security_id = ?').get(soon.id).message;
    expect(alert, 'the date went out as 2026-10-12').not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(alert).toMatch(/on \d{1,2} [A-Z][a-z]{2} \d{4}$/);
  });

  it('does not take the same override twice', async () => {
    const mgmt = signToken(makeUser('MANAGEMENT'));
    const body = { contract_id: psa.id, reason: 'LC enhancement with the bank', valid_until: day(1) };
    // Management's call, not the desk's (17-Oct-2026), and never open-ended.
    expect((await post('/api/payment-security/overrides', body)).status).toBe(403);
    expect((await post('/api/payment-security/overrides', { ...body, valid_until: undefined }, mgmt)).status).toBe(400);
    expect((await post('/api/payment-security/overrides', { ...body, valid_until: day(120) }, mgmt)).status).toBe(400);
    expect((await post('/api/payment-security/overrides', body, mgmt)).status).toBe(201);
    const twin = await post('/api/payment-security/overrides', body, mgmt);
    expect(twin.status).toBe(409);
    expect(db.prepare('SELECT COUNT(*) c FROM security_adequacy_overrides WHERE contract_id = ?').get(psa.id).c).toBe(1);
  });

  it('shows nothing available on an instrument that was refused or released', async () => {
    const gone = instrument(psa, { status: 'CLOSED' });
    expect((await get('/api/payment-security')).body.find((r) => r.id === gone.id).available_amount).toBe(0);
  });
});

describe('Releasing an instrument', () => {
  const ask = (ps, who = signToken(buyer)) => post(`/api/payment-security/${ps.id}/release-request`, { reason: 'PSA has run its term' }, who);
  const decide = (rel, body, who = checker) => post(`/api/payment-security/releases/${rel.id}/act`, body, who);

  it('is decided on the position today, not the one stamped when it was asked for', async () => {
    const ps = instrument(psa);
    const owed = bill(psa);
    const rel = (await ask(ps)).body;
    expect(rel).toMatchObject({ status: 'PENDING', checklist_no_dues: 0 });

    const early = await decide(rel, { decision: 'APPROVED' });
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/₹4,00,000 is still outstanding/);
    expect(row(ps.id).status).toBe('RELEASE_PENDING');

    // The bill is paid. While the PSA runs, the LC is its cover and stays.
    db.prepare(`UPDATE invoices SET status = 'PAID' WHERE id = ?`).run(owed.id);
    const live = await decide(rel, { decision: 'APPROVED' }, finance);
    expect(live.status).toBe(400);
    expect(live.body.error).toMatch(/still active.*Accept a replacement/);
    // The PSA has run its term: once Finance has signed off, the desk releases it.
    db.prepare(`UPDATE contracts SET status = 'EXPIRED' WHERE id = ?`).run(psa.id);
    expect((await decide(rel, { decision: 'APPROVED' }, finance)).body.error).toMatch(/Finance has not signed off/);
    expect((await post(`/api/payment-security/releases/${rel.id}/finance-signoff`, {}, reia)).status).toBe(403);
    expect((await post(`/api/payment-security/releases/${rel.id}/finance-signoff`, {}, finance)).status).toBe(200);
    expect((await decide(rel, { decision: 'APPROVED' }, finance)).status, 'Finance signed off and released it too').toBe(403);
    const queue = (await get('/api/payment-security/releases')).body;
    expect(queue[0].position, 'the queue did not say the request had become clear').toMatchObject({ clear: true, outstanding_dues: 0 });
    const ok = await decide(rel, { decision: 'APPROVED' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'RELEASED', checklist_no_dues: 1 });
    expect(row(ps.id).status).toBe('RELEASED');
    expect(notesFor(buyer).join(' ')).toMatch(/has been released by SJVN/);
    expect((await decide(rel, { decision: 'APPROVED' })).body.error).toMatch(/already been approved/);
  });

  it('is not held up by a bill nobody has been sent, and the counterparty is told the same', async () => {
    const ps = instrument(psa);
    bill(psa, { status: 'DRAFT' });
    bill(psa, { status: 'UNDER_APPROVAL', billing_period: '2026-05' });
    const seen = (await get(`/api/security-desk/instruments/${ps.id}`, signToken(buyer))).body.release_check;
    expect(seen).toMatchObject({ clear: true, outstanding_dues: 0, open_disputes: 0 });
    const rel = (await ask(ps)).body;
    db.prepare(`UPDATE contracts SET status = 'EXPIRED' WHERE id = ?`).run(psa.id);
    await post(`/api/payment-security/releases/${rel.id}/finance-signoff`, {}, finance);
    const r = await decide(rel, { decision: 'APPROVED' });
    expect(r.status, 'the buyer was told the way was clear and the desk was then refused').toBe(200);
  });

  it('is held up by an open dispute', async () => {
    const ps = instrument(psa);
    const inv = bill(psa, { status: 'PAID' });
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, deduction) VALUES (?, ?, 400000, date('now'), 0)`).run(newId('PAY'), inv.id);
    const raised = await post('/api/disputes', {
      invoice_id: inv.id, reason_code: 'ENERGY_DATA_MISMATCH', charge_line: 'energy_charges', disputed_amount: 1000, issue_description: 'metering gap',
    }, signToken(buyer));
    expect(raised.status, JSON.stringify(raised.body)).toBe(201);
    const rel = (await ask(ps)).body;
    const r = await decide(rel, { decision: 'APPROVED' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/1 dispute is still open/);
    expect(r.body.error, 'a bill paid in full was counted as money owed').not.toMatch(/outstanding/);
  });

  it('when refused, says why and puts the instrument back where it stood', async () => {
    const drawn = instrument(psa, { utilized_amount: 300000, status: 'PARTIALLY_UTILIZED' });
    const lapsed = instrument(ppa, { mechanism_type: 'BANK_GUARANTEE', bg_subtype: 'EMD', is_revolving: 0, validity_end: day(-5), status: 'EXPIRED' });
    const relDrawn = (await ask(drawn)).body;
    const relLapsed = (await ask(lapsed, signToken(seller))).body;

    const silent = await decide(relDrawn, { decision: 'REJECTED' });
    expect(silent.status, 'a release was refused without a word of why').toBe(400);
    expect(silent.body.error).toMatch(/Say why/);

    const no = await decide(relDrawn, { decision: 'REJECTED', note: 'Two bills are still in reconciliation' });
    expect(no.body).toMatchObject({ status: 'REJECTED', decision_note: 'Two bills are still in reconciliation' });
    expect(row(drawn.id).status, 'a half-drawn instrument came back as whole').toBe('PARTIALLY_UTILIZED');
    expect(notesFor(buyer).join(' ')).toMatch(/refused the release — Two bills/);
    expect(db.prepare(`SELECT COUNT(*) c FROM security_events WHERE payment_security_id = ? AND event_type = 'RELEASE_REJECTED'`).get(drawn.id).c).toBe(1);

    await decide(relLapsed, { decision: 'REJECTED', note: 'Performance period not over' });
    expect(row(lapsed.id).status, 'a lapsed guarantee came back from a refused release as in force').toBe('EXPIRED');
    expect(notesFor(seller).join(' ')).toMatch(/Performance period not over/);
    expect(notesFor(buyer).join(' ')).not.toMatch(/Performance period/);
  });
});

describe('The expiry cascade', () => {
  const run = () => post('/api/payment-security/alerts/run');

  it('speaks once for an instrument, at the tightest threshold it has crossed', async () => {
    // Five days out it used to be announced four times in a single run.
    const ps = instrument(psa, { validity_end: day(5) });
    const first = await run();
    // The desk's alert, and the reminder to the buyer that has to extend it.
    expect(first.body.sent).toBe(2);
    expect(first.body.holders_reminded).toBe(1);
    const alerts = db.prepare(`SELECT days_before, message FROM security_alerts WHERE payment_security_id = ? AND alert_type = 'EXPIRY'`).all(ps.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].days_before).toBe(7);
    expect(alerts[0].message).toMatch(/Final warning: .* expires in 5 days, on/);
    expect((await run()).body.sent, 'the same alert was sent again').toBe(0);
  });

  it('says a lapsed one has expired, and marks it', async () => {
    const ps = instrument(psa, { validity_end: day(-3) });
    const r = await run();
    // (The run also flags the PSA's cover, which lapsed with it.)
    expect(r.body.expired).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) c FROM security_alerts WHERE alert_type = 'EXPIRY'`).get().c).toBe(1);
    const alert = db.prepare(`SELECT message FROM security_alerts WHERE payment_security_id = ?`).get(ps.id);
    expect(alert.message, 'an expired instrument was said to expire in minus three days').toMatch(/Expired: .* expired 3 days ago, on/);
    expect(row(ps.id).status).toBe('EXPIRED');
  });
});

describe('Who may read the register', () => {
  it('is SJVN and the party to the contract, and nobody else', async () => {
    const mine = instrument(psa);
    instrument(ppa, { mechanism_type: 'BANK_GUARANTEE', is_revolving: 0 });
    const client = tokenFor('TRADING_CLIENT');
    expect((await get('/api/payment-security', client)).status, 'a trading client was handed every instrument').toBe(403);
    expect((await get('/api/payment-security/expiring?days=400', client)).status).toBe(403);
    expect((await get(`/api/payment-security/${mine.id}`, client)).status).toBe(403);
    expect((await get(`/api/payment-security/adequacy/${psa.id}`, client)).status).toBe(403);
    expect((await get(`/api/payment-security/requirements/${psa.id}`, client)).status).toBe(403);

    const own = await get('/api/payment-security', signToken(buyer));
    expect(own.body.map((r) => r.id)).toEqual([mine.id]);
    expect((await get('/api/payment-security', signToken(otherBuyer))).body).toEqual([]);
    expect((await get(`/api/payment-security/adequacy/${psa.id}`, signToken(otherBuyer))).status).toBe(403);
    expect((await get(`/api/payment-security/adequacy/${psa.id}`, signToken(buyer))).status).toBe(200);

    const auditor = tokenFor('COMPLIANCE_AUDITOR');
    expect((await get('/api/payment-security', auditor)).body).toHaveLength(2);
    expect((await get(`/api/payment-security/${mine.id}`, auditor)).status).toBe(200);
    expect((await get(`/api/payment-security/adequacy/${psa.id}`, tokenFor('TRADING_USER'))).status).toBe(200);
  });
});
