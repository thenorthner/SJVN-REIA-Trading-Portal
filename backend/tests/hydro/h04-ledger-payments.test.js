import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeContract } from '../helpers/reia.js';
import { recordPayment } from '../../src/services/hydroLedger.js';

// Hydro QA run 4 (18-Oct-2026): what a payment on a beneficiary's account must
// be, and how far ahead LPS may be charged.

let station;
const pay = (over = {}) => recordPayment({ contractId: station.id, beneficiaryName: 'QA STATE', amount: 1000, paymentDate: '2026-09-01', mode: 'RTGS', rebate: false, ...over });

beforeEach(() => {
  station = makeContract({ project_type: 'Hydro', contract_no: `PPA/SJVN/QA4-${Math.random().toString(36).slice(2, 8)}` });
  db.prepare(`INSERT INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from) VALUES (?, ?, 'QA STATE', 100, '2026-04-01')`).run(newId('HBA'), station.id);
});

describe('A payment on a beneficiary account', () => {
  it('is dated, and not after today', () => {
    expect(() => pay({ paymentDate: '2099-01-01' })).toThrow(/after today/);
    expect(() => pay({ paymentDate: 'yesterday' })).toThrow(/must be a date/);
    expect(pay().doc.amount).toBe(1000);
  });

  it('is for a beneficiary the station bills', () => {
    expect(() => pay({ beneficiaryName: 'NOBODY STATE' })).toThrow(/not a beneficiary of this station/);
    expect(pay({ beneficiaryName: 'qa state' }).doc.amount).toBe(1000);
  });

  it('is recorded once per UTR', () => {
    pay({ reference: 'UTR-QA-1' });
    expect(() => pay({ reference: 'utr-qa-1' })).toThrow(/cannot be recorded twice/);
  });
});

describe('Posting LPS', () => {
  it('charges up to today at the latest', async () => {
    const r = await request(app).post('/api/hydro-billing/ledger/lps').set(auth(tokenFor('COMMERCIAL_ADMIN')))
      .send({ contract_id: station.id, beneficiary: 'QA STATE', as_of: '2099-01-01' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/up to today at the latest/);
  });
});
