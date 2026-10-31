import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { deriveLines } from '../../src/services/cercFormIv.js';
import { buildAnnexures } from '../../src/services/cercAnnexures.js';

// The REIA workflow (section F, CERC Compliance): "The REIA team prepares and
// submits the monthly and annual CERC Form-IV compliance." The return was the
// trading desk's alone and read only bilateral trades; the REIA desk's PPA/PSA
// sales now go on it, the REIA maker prepares it and the REIA checker files it.

let seq = 0;
/** A developer's PPA allocated whole to a discom's PSA, as the REIA desk signs them. */
function backToBack({ ppaTariff = 2.75, psaTariff = 2.82, own = false } = {}) {
  seq += 1;
  const developer = makeEntity('SELLER', { name: `QA Solar ${seq} Pvt Ltd` });
  if (own) db.prepare('UPDATE entities SET is_sjvn_own = 1 WHERE id = ?').run(developer.id);
  const discom = makeEntity('BUYER', { name: `QA Discom ${seq} Ltd` });
  const sjvn = makeEntity('BUYER', { name: `SJVN ${seq}` });
  const ppa = makeContract({ contract_no: `PPA/QA/${seq}`, contract_type: 'PPA', seller_id: developer.id, buyer_id: sjvn.id, tariff_per_unit: ppaTariff, tenure_start: '2026-04-01', tenure_end: '2051-03-31' });
  const psa = makeContract({ contract_no: `PSA/QA/${seq}`, contract_type: 'PSA', seller_id: sjvn.id, buyer_id: discom.id, tariff_per_unit: psaTariff, tenure_start: '2026-04-01', tenure_end: '2051-03-31' });
  db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 100, '2026-04-01')`)
    .run(`ALLOC-${seq}`, ppa.id, psa.id);
  return { developer, discom, ppa, psa };
}
const sale = (psa, over = {}) => makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', billing_period: '2026-09', energy_mwh: 8000, tariff_per_unit: psa.tariff_per_unit, status: 'APPROVED', ...over });
const purchase = (ppa, over = {}) => makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', billing_period: '2026-09', energy_mwh: 8000, tariff_per_unit: ppa.tariff_per_unit, status: 'PAID', ...over });

const SEPT = ['2026-09-01', '2026-09-30'];
const reiaLines = () => deriveLines(...SEPT).filter((l) => l.source === 'REIA');

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM cerc_form_iv').run();
  try { db.prepare('DELETE FROM bids').run(); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM bilateral_transactions').run(); } catch { /* ignore */ }
});

describe('S70 The REIA desk\'s sales on Form-IV', () => {
  it('reports each PSA with the PPA behind it: developer to discom, billed energy, both prices and the margin', () => {
    const { developer, discom, ppa, psa } = backToBack();
    sale(psa);
    purchase(ppa);
    const [line, ...rest] = reiaLines();
    expect(rest).toEqual([]);
    expect(line).toMatchObject({
      seller_name: developer.name, buyer_name: discom.name, contract_ref: `${psa.contract_no} / ${ppa.contract_no}`,
      period_from: '2026-09-01', period_to: '2026-09-30', quantum_mu: 8, purchase_rate: 2.75, sale_rate: 2.82, trading_margin_per_unit: 0.07,
    });
    // A long-term contract: the short-term cap (4 paise on a sale at or below ₹3) does not apply.
    expect(line.compliance_status).toBe('EXEMPT');
    expect(line.exempt_reason).toMatch(/Long-term PPA\/PSA/);
  });

  it('counts a month once, from its final bill, and leaves out drafts, cancelled bills and SJVN\'s own stations', () => {
    const { psa } = backToBack();
    sale(psa, { invoice_type: 'PROVISIONAL', energy_mwh: 7000 });
    sale(psa);
    sale(psa, { energy_mwh: 500, status: 'DRAFT' });
    sale(psa, { energy_mwh: 500, status: 'CANCELLED' });
    const own = backToBack({ own: true });
    sale(own.psa);
    const lines = reiaLines();
    expect(lines.map((l) => l.quantum_mu)).toEqual([8]);
  });

  it('takes the PPA tariff before the developer has billed, and asks for a price when no PPA is allocated', () => {
    const { psa } = backToBack({ ppaTariff: 2.7 });
    sale(psa);
    expect(reiaLines()[0].purchase_rate).toBe(2.7);
    db.prepare('DELETE FROM contract_allocations').run();
    expect(reiaLines()[0]).toMatchObject({ seller_name: 'No PPA allocated', purchase_rate: 0 });
  });

  it('files the line on IV-D, the long-term annexure', () => {
    const { psa, ppa } = backToBack();
    sale(psa);
    purchase(ppa);
    const ivd = buildAnnexures('MONTHLY', '2026-09').annexures.find((a) => a.code === 'IV-D');
    expect(ivd.rows).toHaveLength(1);
    expect(ivd.rows[0]).toMatchObject({ seller_category: 'Generator', buyer_category: 'Distribution Licensee', volume_mu: 8, margin: 0.07 });
  });
});

describe('S70 Who prepares and who files', () => {
  const maker = () => tokenFor('REIA_MAKER');
  const checker = () => tokenFor('REIA_CHECKER');

  it('lets the REIA maker prepare the return and the REIA checker file it, and neither do the other\'s part', async () => {
    const { psa, ppa } = backToBack();
    sale(psa);
    purchase(ppa);

    expect((await request(app).post('/api/form-iv').set(auth(checker())).send({ period_type: 'MONTHLY', period: '2026-09' })).status).toBe(403);
    const made = await request(app).post('/api/form-iv').set(auth(maker())).send({ period_type: 'MONTHLY', period: '2026-09' });
    expect(made.status).toBe(201);
    expect(made.body.lines.map((l) => l.source)).toEqual(['REIA']);
    expect(made.body.blockers).toEqual([expect.stringMatching(/reference number is required/)]);
    expect((await request(app).post(`/api/form-iv/${made.body.id}/generate`).set(auth(maker()))).status).toBe(200);

    const send = (who) => request(app).post(`/api/form-iv/${made.body.id}/submit`).set(auth(who)).send({ reference_no: 'CERC/FIV/2026/09/118' });
    expect((await send(maker())).status).toBe(403);
    const filed = await send(checker());
    expect(filed.status).toBe(200);
    expect(filed.body).toMatchObject({ status: 'SUBMITTED', reference_no: 'CERC/FIV/2026/09/118' });
  });

  it('keeps the regenerated REIA lines in step with the bills', async () => {
    const { psa } = backToBack();
    const bill = sale(psa);
    const made = await request(app).post('/api/form-iv').set(auth(maker())).send({ period_type: 'MONTHLY', period: '2026-09' });
    db.prepare('UPDATE invoices SET energy_mwh = 9000 WHERE id = ?').run(bill.id);
    const again = await request(app).post(`/api/form-iv/${made.body.id}/generate`).set(auth(maker()));
    expect(again.body.lines.map((l) => [l.source, l.quantum_mu])).toEqual([['REIA', 9]]);
  });

  it('lets the rest of the desk read the returns, and keeps the trading desk\'s own access', async () => {
    for (const role of ['REIA_APPROVER', 'MANAGEMENT', 'FINANCE_USER', 'COMPLIANCE_AUDITOR']) {
      expect((await request(app).get('/api/form-iv').set(auth(tokenFor(role)))).status, role).toBe(200);
    }
    expect((await request(app).post('/api/form-iv').set(auth(tokenFor('REIA_APPROVER'))).send({ period_type: 'MONTHLY', period: '2026-08' })).status).toBe(403);
    const trader = tokenFor('TRADING_USER');
    const made = await request(app).post('/api/form-iv').set(auth(trader)).send({ period_type: 'MONTHLY', period: '2026-08', auto_generate: false });
    expect(made.status).toBe(201);
    const line = await request(app).post(`/api/form-iv/${made.body.id}/lines`).set(auth(trader)).send({
      seller_name: 'QA Gen', buyer_name: 'QA Buyer', period_from: '2026-08-01', period_to: '2026-08-31', quantum_mu: 1, purchase_rate: 4.37, sale_rate: 4.4,
    });
    expect(line.status).toBe(201);
    expect((await request(app).post(`/api/form-iv/${made.body.id}/submit`).set(auth(trader)).send({ reference_no: 'CERC/FIV/2026/08/7' })).status).toBe(200);
  });
});
