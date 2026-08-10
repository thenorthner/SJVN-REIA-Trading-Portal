import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { runStakeholderAlerts } from '../../src/stakeholderEngine.js';

let reia;
beforeEach(() => { resetReia(); reia = tokenFor('REIA_USER'); });

describe('S19 A change of bank account is not the live one until it is verified', () => {
  // Editing bank details wrote them straight onto the entity. The record dropped
  // to PENDING and the penny-drop flag reset, but the account money would be
  // paid into had already changed — and the payout path looked at neither
  // signal. Redirecting a generator's payments took one edit.
  let ent;
  beforeEach(() => {
    ent = makeEntity('SELLER');
    db.prepare(`UPDATE entities SET status='APPROVED', is_penny_drop_verified=1,
                bank_name='SBI', account_no='11112222', ifsc_code='SBIN0001' WHERE id = ?`).run(ent.id);
  });

  const changeBank = (over = {}) => request(app).put(`/api/entities/${ent.id}`).set(auth(reia))
    .send({ bank_name: 'HDFC Bank', account_no: '99998888', ifsc_code: 'HDFC0009', ...over });
  const row = () => db.prepare('SELECT * FROM entities WHERE id = ?').get(ent.id);

  it('leaves the verified account live while the change waits', async () => {
    await changeBank();
    expect(row().account_no, 'the new account went live before anyone verified it').toBe('11112222');
    expect(JSON.parse(row().pending_bank_json).account_no).toBe('99998888');
  });

  it('keeps the live account verified, since it did not change', async () => {
    await changeBank();
    expect(row().is_penny_drop_verified, 'clearing this stranded payouts against details nobody changed').toBe(1);
  });

  it('sends the record back for re-approval', async () => {
    await changeBank();
    expect(row().status).toBe('PENDING');
  });

  it('promotes the change once the penny drop clears', async () => {
    await changeBank();
    const r = await request(app).post(`/api/entities/${ent.id}/penny-drop`).set(auth(reia)).send({});
    expect(r.status).toBe(200);
    expect(row().account_no, 'a verified change never became the live account').toBe('99998888');
    expect(row().pending_bank_json).toBeNull();
    expect(row().is_penny_drop_verified).toBe(1);
  });

  it('records what the account was and what it became', async () => {
    await changeBank();
    await request(app).post(`/api/entities/${ent.id}/penny-drop`).set(auth(reia)).send({});
    const a = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'BANK_CHANGE_VERIFIED'`).get(ent.id);
    expect(a, 'promoting an account to live left no trail').toBeTruthy();
    expect(String(a.before_value ?? a.beforeValue ?? '')).toContain('11112222');
    expect(String(a.after_value ?? a.afterValue ?? '')).toContain('99998888');
  });

  it('leaves non-bank edits applying as before', async () => {
    await request(app).put(`/api/entities/${ent.id}`).set(auth(reia)).send({ credit_rating: 'AA' });
    expect(row().credit_rating).toBe('AA');
    expect(row().pending_bank_json).toBeNull();
  });
});

describe('S19 Money does not move to an unverified account', () => {
  let ent, contract, inv;
  beforeEach(() => {
    ent = makeEntity('SELLER');
    db.prepare(`UPDATE entities SET status='APPROVED', is_penny_drop_verified=1, account_no='11112222' WHERE id = ?`).run(ent.id);
    contract = makeContract({ status: 'ACTIVE', seller_id: ent.id });
    inv = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 100000 });
  });

  const release = () => request(app).post(`/api/invoices/${inv.id}/release-to-generator`).set(auth(reia))
    .send({ amount: 50000, source: 'OWN_FUND', reference: 'T' });

  it('releases to a verified account', async () => {
    const r = await release();
    expect(r.status, 'the guard blocked a legitimate payout').toBeLessThan(400);
  });

  it('refuses while a change of account is awaiting verification', async () => {
    await request(app).put(`/api/entities/${ent.id}`).set(auth(reia)).send({ account_no: '99998888' });
    const r = await release();
    expect(r.status, 'money was released while the account was in dispute').toBe(400);
    expect(r.body.error).toMatch(/penny-drop/i);
    expect(db.prepare('SELECT COUNT(*) c FROM payments WHERE invoice_id = ?').get(inv.id).c).toBe(0);
  });

  it('refuses when the account was never verified at all', async () => {
    db.prepare('UPDATE entities SET is_penny_drop_verified = 0 WHERE id = ?').run(ent.id);
    const r = await release();
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/verif/i);
  });

  it('releases again once the change has been verified', async () => {
    await request(app).put(`/api/entities/${ent.id}`).set(auth(reia)).send({ account_no: '99998888' });
    await request(app).post(`/api/entities/${ent.id}/penny-drop`).set(auth(reia)).send({});
    const r = await release();
    expect(r.status, 'a verified account still could not be paid').toBeLessThan(400);
  });
});

describe('S19 The stakeholder sweep actually runs', () => {
  // Every pushNotification call in the sweep passed positional arguments to a
  // function taking an object, so type and message arrived undefined and the
  // insert failed NOT NULL. The first alert of every run threw, the cascade died
  // there, and nothing after it ran. Not one notification had ever been written,
  // and the caller's try/catch made an hourly exception look like a no-op.
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

  it('completes without throwing', () => {
    makeContract({ status: 'ACTIVE', tenure_end: day(45) });
    expect(() => runStakeholderAlerts()).not.toThrow();
  });

  it('actually writes the renewal alert', () => {
    const c = makeContract({ status: 'ACTIVE', tenure_end: day(45) });
    runStakeholderAlerts();
    const n = db.prepare(`SELECT * FROM notifications WHERE type = 'CONTRACT_EXPIRING' AND message LIKE ?`).get(`%${c.contract_no}%`);
    expect(n, 'no renewal alert was delivered').toBeTruthy();
    expect(n.role).toBe('REIA_USER');
  });

  it('carries on past a contract it cannot process', () => {
    // The whole failure was one bad item killing everything behind it, so what
    // matters is that the second contract is reached — asserted on these two
    // rows rather than on the sweep's total, which counts every contract in the
    // database and would answer to fixtures this test did not create.
    const a = makeContract({ status: 'ACTIVE', tenure_end: day(30) });
    const b = makeContract({ status: 'ACTIVE', tenure_end: day(60) });
    runStakeholderAlerts();
    for (const c of [a, b]) {
      expect(db.prepare('SELECT status FROM contracts WHERE id = ?').get(c.id).status,
        `${c.contract_no} was never reached — the sweep stopped early`).toBe('NEARING_EXPIRY');
    }
  });

  it('expires a contract that is already past its end date', () => {
    const c = makeContract({ status: 'ACTIVE', tenure_end: day(-5) });
    runStakeholderAlerts();
    expect(db.prepare('SELECT status FROM contracts WHERE id = ?').get(c.id).status,
      'a contract past its end date needed two passes and stayed billable between them').toBe('EXPIRED');
  });

  it('does not repeat the same alert on the next hourly run', () => {
    makeContract({ status: 'ACTIVE', tenure_end: day(45) });
    runStakeholderAlerts();
    const after1 = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE type = 'CONTRACT_EXPIRING'`).get().c;
    runStakeholderAlerts();
    const after2 = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE type = 'CONTRACT_EXPIRING'`).get().c;
    expect(after2, 'an hourly sweep would send the same alert 24 times a day').toBe(after1);
  });

  it('records the state a contract moved from', () => {
    const c = makeContract({ status: 'ACTIVE', tenure_end: day(45) });
    runStakeholderAlerts();
    const a = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'STATUS_NEARING_EXPIRY'`).get(c.id);
    expect(a).toBeTruthy();
    // the audit layer stores values JSON-encoded
    expect(String(a.before_value ?? a.beforeValue ?? '')).toContain('ACTIVE');
  });
});
