import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia, auditFor } from './helpers/reia.js';
import { remindExpiringSecurity } from '../src/routes/securityDesk.js';

// A guarantee as a document a bank issued and can change: how close it is to
// lapsing, the bank's SFMS advice, the scanned copy, each amendment in order,
// and the letter of credit SJVN opens the other way.

let reia, checker, finance, seller, otherSeller, alpha, beta, contract;
const as = (u) => auth(signToken(u));
const get = (u, p) => request(app).get(`/api/security-desk${p}`).set(as(u));
const post = (u, p, body) => request(app).post(`/api/security-desk${p}`).set(as(u)).send(body);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let docSeq = 0;
function doc(contractId = contract.id) {
  docSeq += 1;
  db.prepare(`INSERT INTO documents (id, contract_id, document_type, category, title) VALUES (?, ?, 'BANK_GUARANTEE', 'RECORD', 'BG')`).run(`D${docSeq}`, contractId);
  db.prepare(`INSERT INTO document_versions (id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type) VALUES (?, ?, 1, '/nowhere', ?, 10, 'application/pdf')`)
    .run(`V${docSeq}`, `D${docSeq}`, `bg-${docSeq}.pdf`);
  return `V${docSeq}`;
}

function instrument(extra = {}) {
  const id = `PS-${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    id, instrument_no: `PS/PBG/${id}`, contract_id: contract.id, entity_id: alpha.id, mechanism_type: 'BANK_GUARANTEE', bg_subtype: 'PBG',
    limit_amount: 5000000, available_amount: 5000000, issuing_bank: 'State Bank of India', validity_start: day(-300), validity_end: day(200), status: 'ACTIVE', ...extra,
  };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO payment_security (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
  return db.prepare('SELECT * FROM payment_security WHERE id = ?').get(id);
}
const submission = (extra = {}) => ({
  contract_id: contract.id, bg_subtype: 'PBG', amount: 5000000, bank_reference_no: 'SBI/BG/0001', issuing_bank: 'State Bank of India',
  validity_start: day(0), validity_end: day(365), claim_deadline: day(395), document_version_id: doc(), ...extra,
});

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM document_versions').run();
  alpha = makeEntity('SELLER', { name: 'Alpha Solar' });
  beta = makeEntity('SELLER', { name: 'Beta Wind' });
  contract = makeContract({ seller_id: alpha.id, pbg_amount: 5000000 });
  reia = makeUser('REIA_USER', { name: 'Riya REIA' });
  // Phase B.2: the checker accepts instruments and amendments and closes an LC.
  checker = makeUser('REIA_ADMIN', { name: 'Chetan Checker' });
  finance = makeUser('FINANCE_USER', { name: 'Farid Finance' });
  seller = makeUser('SELLER', { name: 'Arun Alpha', linked_entity_id: alpha.id });
  otherSeller = makeUser('SELLER', { name: 'Bina Beta', linked_entity_id: beta.id });
});

describe('expiry', () => {
  it('grades each instrument by how close it is to lapsing and totals what needs attention', async () => {
    instrument({ validity_end: day(200) });
    instrument({ validity_end: day(45) });
    const red = instrument({ validity_end: day(10) });
    instrument({ validity_end: day(-5), status: 'EXPIRED' });

    const o = (await get(seller, '/overview')).body;
    expect(o.instruments.map((i) => i.expiry.level).sort()).toEqual(['CRITICAL', 'EXPIRED', 'OK', 'WARN']);
    expect(o.totals).toMatchObject({ expiring: 2, critical: 1, expired: 1, awaiting_sfms: 3 });
    const r = o.instruments.find((i) => i.id === red.id);
    expect(r.expiry).toMatchObject({ days: 10, label: '10 days to expiry' });
    expect(r.needs_extension).toBe(true);
    // The contract asks for 50 lakh of PBG; the lapsed one does not count toward it.
    expect(o.contracts[0]).toMatchObject({ pbg_required: 5000000, pbg_held: 15000000, pbg_shortfall: 0 });

    expect((await get(otherSeller, '/overview')).body.instruments).toEqual([]);
    expect((await get(otherSeller, `/instruments/${red.id}`)).status).toBe(403);
  });

  it('reminds the counterparty once per threshold, and not while an extension is with SJVN', async () => {
    const ps = instrument({ validity_end: day(20) });
    expect(remindExpiringSecurity().sent).toBe(1);
    const bell = db.prepare(`SELECT message FROM notifications WHERE user_id = ?`).all(seller.id);
    expect(bell).toHaveLength(1);
    expect(bell[0].message).toMatch(/expires in 20 days/);
    expect(remindExpiringSecurity().sent).toBe(0);

    // Closer in, a new threshold is crossed — but an extension is already pending.
    db.prepare('UPDATE payment_security SET validity_end = ? WHERE id = ?').run(day(6), ps.id);
    await post(seller, `/instruments/${ps.id}/amendments`, { new_validity_end: day(370), reason: 'COD delayed', document_version_id: doc() });
    expect(remindExpiringSecurity().sent).toBe(0);
  });
});

describe('extension and amendment', () => {
  it('takes a counterparty extension on record only when SJVN accepts it, and numbers it in the chain', async () => {
    const ps = instrument({ validity_end: day(20), claim_deadline: day(50) });
    const body = { new_validity_end: day(385), new_claim_deadline: day(415), reason: 'SCOD extended by six months', amendment_ref: 'SBI/AMD/1', document_version_id: doc() };

    expect((await post(seller, `/instruments/${ps.id}/amendments`, { ...body, document_version_id: null })).body.error).toMatch(/Attach the bank/);
    expect((await post(seller, `/instruments/${ps.id}/amendments`, { ...body, new_validity_end: day(5), new_claim_deadline: null })).body.error).toMatch(/extended here, not shortened/);
    expect((await post(seller, `/instruments/${ps.id}/amendments`, { reason: 'x', document_version_id: doc() })).body.error).toMatch(/Say what the bank changed/);
    expect((await post(otherSeller, `/instruments/${ps.id}/amendments`, body)).status).toBe(403);

    const sub = await post(seller, `/instruments/${ps.id}/amendments`, body);
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.pending_amendment).toMatchObject({ status: 'PENDING', raised_by_side: 'SELLER' });
    expect(sub.body.validity_end).toBe(day(20)); // nothing changes yet
    expect(sub.body.needs_extension).toBe(false);
    expect((await post(seller, `/instruments/${ps.id}/amendments`, body)).status).toBe(409);
    const amendmentId = sub.body.pending_amendment.id;

    expect((await post(seller, `/amendments/${amendmentId}/decide`, { decision: 'ACCEPTED' })).status).toBe(403);
    expect((await post(checker, `/amendments/${amendmentId}/decide`, { decision: 'REJECTED' })).body.error).toMatch(/Say why/);
    const ok = await post(checker, `/amendments/${amendmentId}/decide`, { decision: 'ACCEPTED', sfms_message_type: 'MT767', sfms_date: day(0), sfms_reference: 'SBINH26280000123' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ validity_end: day(385), claim_deadline: day(415), amendment_count: 1, pending_amendment: null });
    expect(ok.body.expiry.level).toBe('OK');
    expect(ok.body.chain.map((c) => c.step)).toEqual(['Original', 'Amendment 1']);
    expect(ok.body.chain[0]).toMatchObject({ validity_end: day(20), limit: 5000000 });
    expect(ok.body.chain[1]).toMatchObject({ validity_end: day(385), reference: 'SBI/AMD/1', sfms_reference: 'SBINH26280000123' });
    expect(ok.body.chain[1].changes.map((c) => c.field)).toEqual(['VALIDITY', 'CLAIM']);
    // The contract's own PBG expiry follows the guarantee.
    expect(db.prepare('SELECT pbg_expiry FROM contracts WHERE id = ?').get(contract.id).pbg_expiry).toBe(day(385));
    expect(auditFor(amendmentId).map((a) => a.action)).toEqual(expect.arrayContaining(['SECURITY_AMENDMENT_SUBMITTED', 'SECURITY_AMENDMENT_ACCEPTED']));
    expect(db.prepare(`SELECT message FROM notifications WHERE user_id = ? ORDER BY rowid DESC`).get(seller.id).message).toMatch(/accepted and taken on record/);
  });

  it('records a second amendment that raises the value, refuses one below what is drawn, and lets a refused or withdrawn one leave no mark', async () => {
    const ps = instrument({ validity_end: day(100), utilized_amount: 1000000 });
    // The desk records one itself: straight on record.
    const first = await post(reia, `/instruments/${ps.id}/amendments`, { new_validity_end: day(400), reason: 'Bank letter received' });
    expect(first.body.amendment_count).toBe(1);

    expect((await post(seller, `/instruments/${ps.id}/amendments`, { new_limit: 500000, reason: 'Reduced', document_version_id: doc() })).body.error).toMatch(/already been drawn/);
    const up = await post(seller, `/instruments/${ps.id}/amendments`, { new_limit: 7500000, reason: 'Capacity enhanced', document_version_id: doc() });
    const refused = await post(checker, `/amendments/${up.body.pending_amendment.id}/decide`, { decision: 'REJECTED', note: 'Letter is unsigned' });
    expect(refused.body).toMatchObject({ limit_amount: 5000000, amendment_count: 1 });
    expect(refused.body.amendments.find((a) => a.status === 'REJECTED').decision_note).toBe('Letter is unsigned');

    const again = await post(seller, `/instruments/${ps.id}/amendments`, { new_limit: 7500000, reason: 'Capacity enhanced', document_version_id: doc() });
    expect((await post(checker, `/amendments/${again.body.pending_amendment.id}/withdraw`, {})).status).toBe(403);
    expect((await post(seller, `/amendments/${again.body.pending_amendment.id}/withdraw`, {})).body.pending_amendment).toBeNull();

    const third = await post(seller, `/instruments/${ps.id}/amendments`, { new_limit: 7500000, reason: 'Capacity enhanced', document_version_id: doc() });
    const done = await post(checker, `/amendments/${third.body.pending_amendment.id}/decide`, { decision: 'ACCEPTED' });
    expect(done.body).toMatchObject({ limit_amount: 7500000, available_amount: 6500000, status: 'PARTIALLY_UTILIZED' });
    expect(done.body.chain.map((c) => [c.step, c.limit, c.validity_end])).toEqual([
      ['Original', 5000000, day(100)], ['Amendment 1', 5000000, day(400)], ['Amendment 2', 7500000, day(400)],
    ]);
    expect(done.body.chain[2].changes[0].text).toMatch(/increased/);
  });

  it('puts the older renew route into the same chain and brings an expired guarantee back', async () => {
    const ps = instrument({ validity_end: day(-3), status: 'EXPIRED' });
    const r = await request(app).post(`/api/payment-security/${ps.id}/renew`).set(as(reia)).send({ validity_end: day(300) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = (await get(seller, `/instruments/${ps.id}`)).body;
    expect(d).toMatchObject({ status: 'ACTIVE', validity_end: day(300), amendment_count: 1 });
    expect(d.chain[0].validity_end).toBe(day(-3));
  });
});

describe('SFMS and the document', () => {
  it('shows the bank\'s advice once SJVN records it', async () => {
    const ps = instrument();
    expect((await get(seller, `/instruments/${ps.id}`)).body.sfms.confirmed).toBe(false);
    expect((await post(seller, `/instruments/${ps.id}/sfms`, { sfms_message_type: 'MT760', sfms_date: day(0), sfms_reference: 'X' })).status).toBe(403);
    expect((await post(reia, `/instruments/${ps.id}/sfms`, { sfms_message_type: 'MT760', sfms_date: day(0) })).body.error).toMatch(/SFMS reference/);
    expect((await post(reia, `/instruments/${ps.id}/sfms`, { sfms_message_type: 'MT760', sfms_date: day(3), sfms_reference: 'X' })).body.error).toMatch(/future/);
    const r = await post(reia, `/instruments/${ps.id}/sfms`, { sfms_message_type: 'MT760', sfms_date: day(-1), sfms_reference: 'SBINH26270000456', sfms_sender_ifsc: 'sbin0001234', bank_reference_no: 'SBI/BG/77' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const seen = (await get(seller, `/instruments/${ps.id}`)).body;
    expect(seen.sfms).toMatchObject({ confirmed: true, message_type: 'MT760', date: day(-1), reference: 'SBINH26270000456', sender_ifsc: 'SBIN0001234', recorded_by: 'Riya REIA' });
    expect(seen.bank_reference_no).toBe('SBI/BG/77');
    // The money side reads the same confirmation.
    expect(db.prepare('SELECT bank_confirmation_ref, verified_at FROM payment_security WHERE id = ?').get(ps.id)).toMatchObject({ bank_confirmation_ref: 'SBINH26270000456' });
  });

  it('keeps the scanned guarantee on the instrument, and only a file of that contract', async () => {
    const ps = instrument();
    const elsewhere = makeContract({ seller_id: beta.id });
    expect((await post(seller, `/instruments/${ps.id}/document`, { document_version_id: doc(elsewhere.id) })).body.error).toMatch(/not one of this contract/);
    const v = doc();
    const r = await post(seller, `/instruments/${ps.id}/document`, { document_version_id: v, is_ebg: true, ebg_reference: 'NESL-EBG-991' });
    expect(r.body.document).toMatchObject({ version_id: v });
    expect(r.body).toMatchObject({ is_ebg: true, ebg_reference: 'NESL-EBG-991' });
    // The copy SJVN holds is not swapped by the counterparty afterwards.
    expect((await post(seller, `/instruments/${ps.id}/document`, { document_version_id: doc() })).body.error).toMatch(/took on record/);
    expect((await post(reia, `/instruments/${ps.id}/document`, { document_version_id: doc() })).status).toBe(200);
  });
});

describe('a guarantee submitted by the seller', () => {
  it('counts for nothing until SJVN accepts it', async () => {
    expect((await post(seller, '/instruments', submission({ document_version_id: null })).catch((e) => e)).body.error).toMatch(/Attach the scanned/);
    expect((await post(seller, '/instruments', submission({ validity_end: day(-1), claim_deadline: null }))).body.error).toMatch(/already expired/);
    expect((await post(otherSeller, '/instruments', submission())).status).toBe(403);

    const s = await post(seller, '/instruments', submission());
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body).toMatchObject({ status: 'DRAFT', bg_subtype: 'PBG', mechanism_type: 'BANK_GUARANTEE', submitted_by_side: 'SELLER', bank_reference_no: 'SBI/BG/0001' });
    expect((await post(seller, '/instruments', submission())).status).toBe(409);
    let o = (await get(seller, '/overview')).body;
    expect(o.totals).toMatchObject({ held: 0, pending_submissions: 1 });
    expect(o.contracts[0].pbg_shortfall).toBe(5000000);

    expect((await post(seller, `/instruments/${s.body.id}/decide`, { decision: 'ACCEPTED' })).status).toBe(403);
    const ok = await post(checker, `/instruments/${s.body.id}/decide`, { decision: 'ACCEPTED', sfms_message_type: 'MT760', sfms_date: day(0), sfms_reference: 'SBINH1' });
    expect(ok.body).toMatchObject({ status: 'ACTIVE' });
    expect(ok.body.sfms.confirmed).toBe(true);
    o = (await get(seller, '/overview')).body;
    expect(o.totals).toMatchObject({ held: 5000000, pending_submissions: 0, awaiting_sfms: 0 });
    expect(o.contracts[0].pbg_shortfall).toBe(0);

    const second = await post(seller, '/instruments', submission({ bank_reference_no: 'SBI/BG/0002' }));
    const no = await post(checker, `/instruments/${second.body.id}/decide`, { decision: 'REJECTED', note: 'Beneficiary name is wrong' });
    expect(no.body).toMatchObject({ status: 'CLOSED', rejection_note: 'Beneficiary name is wrong' });
  });

  it('will not take a second release request while one is open', async () => {
    const ps = instrument();
    expect((await get(seller, `/instruments/${ps.id}`)).body.release_check).toMatchObject({ clear: true, can_request: true });
    const rel = (p) => request(app).post(`/api/payment-security/${p}/release-request`).set(as(seller)).send({ reason: 'COD achieved' });
    expect((await rel(ps.id)).status).toBe(201);
    const again = await rel(ps.id);
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already with SJVN/);
  });
});

describe('SJVN\'s letter of credit in the seller\'s favour', () => {
  it('is opened by the desk or Finance, seen by that seller only, and measured against the monthly bill', async () => {
    makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', invoice_no: 'A/1', billing_period: '2026-08', total_amount: 4000000, energy_charges: 4000000 });
    const body = { contract_id: contract.id, lc_no: 'PNB/LC/55', issuing_bank: 'Punjab National Bank', amount: 3000000, issue_date: day(-10), validity_end: day(40), sfms_message_type: 'MT700', sfms_date: day(-10), sfms_reference: 'PUNBH1' };
    expect((await post(seller, '/lcs', body)).status).toBe(403);
    const made = await post(finance, '/lcs', body);
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    expect(made.body).toMatchObject({ lc_no: 'PNB/LC/55', available_amount: 3000000, required_amount: 4000000 });
    expect((await post(reia, '/lcs', body)).status).toBe(409);

    const o = (await get(seller, '/overview')).body;
    expect(o.lcs).toHaveLength(1);
    expect(o.lcs[0].expiry.level).toBe('WARN');
    expect(o.contracts[0]).toMatchObject({ lc_required: 4000000, lc_open: 3000000, lc_shortfall: 1000000 });
    expect(o.totals).toMatchObject({ lc_open: 3000000, lc_shortfall: 1000000 });
    expect((await get(otherSeller, '/overview')).body.lcs).toEqual([]);
    expect((await get(otherSeller, `/lcs/${made.body.id}`)).status).toBe(403);
    expect(db.prepare(`SELECT message FROM notifications WHERE user_id = ?`).get(seller.id).message).toMatch(/opened letter of credit PNB\/LC\/55/);

    expect((await post(seller, `/lcs/${made.body.id}/amend`, { amount: 1 })).status).toBe(403);
    expect((await post(reia, `/lcs/${made.body.id}/amend`, {})).body.error).toMatch(/Nothing was changed/);
    const amended = await post(reia, `/lcs/${made.body.id}/amend`, { amount: 4500000, validity_end: day(400), note: 'Enhanced at renewal' });
    expect(amended.body).toMatchObject({ amount: 4500000, validity_end: day(400) });
    expect(amended.body.events.map((e) => e.event_type)).toEqual(['OPENED', 'AMENDED']);
    expect((await get(seller, '/overview')).body.contracts[0].lc_shortfall).toBe(0);

    expect((await post(checker, `/lcs/${made.body.id}/close`, {})).body.error).toMatch(/Say why/);
    expect((await post(checker, `/lcs/${made.body.id}/close`, { note: 'PPA terminated' })).status).toBe(200);
    expect((await get(seller, '/overview')).body.totals.lc_open).toBe(0);
  });

  it('never counts as security SJVN holds', async () => {
    await post(reia, '/lcs', { contract_id: contract.id, issuing_bank: 'PNB', amount: 9000000, validity_end: day(300) });
    expect((await get(seller, '/overview')).body.totals.held).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM payment_security').get().n).toBe(0);
  });
});

describe('the register', () => {
  it('downloads what the caller can see as a workbook', async () => {
    instrument();
    const r = await get(seller, '/register.xlsx').buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(r.status).toBe(200);
    expect(r.body.slice(0, 2).toString()).toBe('PK');
  });
});
