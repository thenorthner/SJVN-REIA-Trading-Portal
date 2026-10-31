import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// The flag is read when the modules load, so it is set before the imports.
vi.hoisted(() => { process.env.REIA_BETA = '1'; });

const { app } = await import('../../src/server.js');
const { default: db } = await import('../../src/db/index.js');
const { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } = await import('../helpers/reia.js');
const { buildAnnexures } = await import('../../src/services/cercAnnexures.js');
const { cercCompliance } = await import('../../src/services/cercCompliance.js');

// The REIA beta shows Form-IV to the REIA desk (31-Oct-2026), as the REIA
// workflow has it prepare and file the return. The beta reads the desk's own
// PPA/PSA sales alone: a bilateral line the trading desk put on a return stays
// in the database but is not shown, totalled or filed in the beta.

const maker = () => tokenFor('REIA_MAKER');

function reiaSale() {
  const developer = makeEntity('SELLER', { name: 'QA Beta Solar Pvt Ltd' });
  const discom = makeEntity('BUYER', { name: 'QA Beta Discom Ltd' });
  const sjvn = makeEntity('BUYER', { name: 'SJVN Beta' });
  const ppa = makeContract({ contract_no: 'PPA/QA/BETA', contract_type: 'PPA', seller_id: developer.id, buyer_id: sjvn.id, tariff_per_unit: 2.75, tenure_start: '2026-04-01', tenure_end: '2051-03-31' });
  const psa = makeContract({ contract_no: 'PSA/QA/BETA', contract_type: 'PSA', seller_id: sjvn.id, buyer_id: discom.id, tariff_per_unit: 2.82, tenure_start: '2026-04-01', tenure_end: '2051-03-31' });
  db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES ('ALLOC-BETA', ?, ?, 100, '2026-04-01')`).run(ppa.id, psa.id);
  makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', billing_period: '2026-09', energy_mwh: 8000, tariff_per_unit: 2.82, status: 'APPROVED' });
}

/** A line the trading desk put on the return, as its bilateral trades come in. */
function bilateralLine(formId) {
  db.prepare(`INSERT INTO cerc_form_iv_lines (id, form_id, line_no, source, seller_name, buyer_name, period_from, period_to,
      quantum_mu, purchase_rate, sale_rate, trading_margin_per_unit, compliance_status)
    VALUES ('FIVL-BILAT', ?, 9, 'BILATERAL', 'QA Trade Seller', 'QA Trade Buyer', '2026-09-01', '2026-09-30', 5, 4.37, 4.4, 0.03, 'COMPLIANT')`).run(formId);
}

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM cerc_form_iv_lines').run();
  db.prepare('DELETE FROM cerc_form_iv').run();
  try { db.prepare('DELETE FROM bids').run(); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM bilateral_transactions').run(); } catch { /* ignore */ }
});

describe('S71 Form-IV in the REIA beta', () => {
  it('shows and totals the REIA lines alone, and a regenerate leaves the trading desk\'s line where it is', async () => {
    reiaSale();
    const made = await request(app).post('/api/form-iv').set(auth(maker())).send({ period_type: 'MONTHLY', period: '2026-09' });
    expect(made.status).toBe(201);
    bilateralLine(made.body.id);

    const shown = await request(app).get(`/api/form-iv/${made.body.id}`).set(auth(maker()));
    expect(shown.body.lines.map((l) => l.source)).toEqual(['REIA']);
    expect(shown.body).toMatchObject({ total_volume_mu: 8, line_count: 1 });

    const list = await request(app).get('/api/form-iv').set(auth(maker()));
    expect(list.body[0]).toMatchObject({ total_volume_mu: 8, line_count: 1 });
    const summary = await request(app).get('/api/form-iv/summary').set(auth(maker()));
    expect(summary.body.total_volume_mu).toBe(8);

    await request(app).post(`/api/form-iv/${made.body.id}/generate`).set(auth(maker()));
    expect(db.prepare("SELECT COUNT(*) n FROM cerc_form_iv_lines WHERE source = 'BILATERAL'").get().n).toBe(1);

    expect(cercCompliance({ from: '2026-09', to: '2026-09', asOf: new Date('2026-10-31') }).monthly[0].total_volume_mu).toBe(8);
  });

  it('files on IV-D and IV-E alone, with no licensee wording or trading margin', async () => {
    reiaSale();
    const built = buildAnnexures('MONTHLY', '2026-09');
    expect(built.annexures.map((a) => a.code)).toEqual(['IV-D', 'IV-E']);
    expect(built.annexures[0].rows).toHaveLength(1);
    expect(JSON.stringify(built.annexures)).not.toMatch(/Trading/);

    const made = await request(app).post('/api/form-iv').set(auth(maker())).send({ period_type: 'MONTHLY', period: '2026-09' });
    const csv = await request(app).get(`/api/form-iv/${made.body.id}/export`).set(auth(maker()));
    expect(csv.text).toMatch(/SJVN Margin/);
    expect(csv.text).not.toMatch(/[Tt]rading/);
  });
});
