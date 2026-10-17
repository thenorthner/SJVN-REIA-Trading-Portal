import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { buildContractReconItems } from '../../src/reconciliationEngine.js';

// Found by the end-to-end golden run of September 2026 (17-Oct-2026): the
// buyer's bill was raised before the developer's invoice, as it usually is, so
// the two were never linked and the buyer's payment could never be passed on to
// the generator; "realised" counted a credit note and SJVN's own margin as money
// received; and a developer bill settled with an early-payment rebate showed the
// rebate on reconciliation as a gap that could never close.

const M = '2026-09';
let fin, sellerCo, ppa, psa;
const pay = (inv, amount, over = {}) => db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode, deduction) VALUES (?, ?, ?, '2026-10-17', ?, ?)`)
  .run(newId('PAY'), inv.id, amount, over.mode || 'RTGS', over.deduction || 0);
const release = (inv, amount) => request(app).post(`/api/invoices/${inv.id}/release-to-generator`).set(auth(fin))
  .send({ amount, source: 'DISCOM_REALIZATION', reference: 'S57' });

beforeEach(() => {
  resetReia();
  fin = tokenFor('FINANCE_USER');
  sellerCo = makeEntity('SELLER');
  db.prepare(`UPDATE entities SET is_penny_drop_verified = 1 WHERE id = ?`).run(sellerCo.id);
  ppa = makeContract({ contract_type: 'PPA', seller_id: sellerCo.id, tariff_per_unit: 2.88, tenure_start: '2026-04-01' });
  psa = makeContract({ contract_type: 'PSA', tariff_per_unit: 2.95, tenure_start: '2026-04-01' });
  db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 100, '2026-04-01')`).run(newId('CAL'), ppa.id, psa.id);
});

describe('S57 Passing the buyer\'s money on to the generator', () => {
  it('finds the buyer\'s bill without a link, and passes on only the generator\'s part of real receipts', async () => {
    // PSA bill raised first: ₹2,30,40,000 energy + ₹5,60,000 margin.
    const bs = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'PARTIALLY_PAID', billing_period: M, energy_charges: 23040000, trading_margin: 560000, total_amount: 23600000 });
    pay(bs, 10000000);
    pay(bs, 0, { mode: 'CREDIT_NOTE', deduction: 20000 }); // a credit is not money in
    const dev = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: M, energy_mwh: 8000, energy_charges: 23040000, total_amount: 23040000, invoice_breakdown_json: '' });
    // ₹1 crore × 2,30,40,000 / 2,36,00,000 = ₹97,62,712.
    const over = await release(dev, 10000000);
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/Only 97,62,712 realized/);
    expect((await release(dev, 9762712)).status).toBe(201);
  });
});

describe('S57 A rebate is not a gap', () => {
  it('reconciles a developer bill settled with its early-payment rebate', () => {
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, ?, 'FINAL', 'JMR', 8000, 'LOCKED')`).run(newId('ENG'), ppa.id, M);
    const dev = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'PAID', billing_period: M, energy_mwh: 8000, energy_charges: 23040000, total_amount: 23040000, invoice_breakdown_json: '' });
    db.prepare('UPDATE invoices SET rebate = 345600 WHERE id = ?').run(dev.id); // 1.5 %
    pay(dev, 23040000 - 345600);
    const fin = buildContractReconItems({ contractId: ppa.id, period: M }).items.find((i) => i.item_type === 'FINANCIAL_THREE_WAY');
    expect(fin).toMatchObject({ variance: 0, match_status: 'EXACT' });
    expect(fin.notes).toMatch(/after ₹3,45,600 rebate/);
  });
});
