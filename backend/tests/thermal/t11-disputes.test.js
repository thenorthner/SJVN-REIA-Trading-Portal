import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { makeUser, makeContract, auth } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { insertDoc } from '../../src/services/hydroLedger.js';
import { INSERT_BILL, emptyBillBlocks } from '../../src/services/hydroClaims.js';

// Thermal QA run 11 (19-Oct-2026): disputes per desk, reasons per station, audit per vertical.

let thermalDesk; let hydroDesk; let thermal; let hydro; let thDoc; let hyDoc;
const bill = (c) => {
  const id = `HSB-T11-${c.id}`;
  db.prepare(INSERT_BILL).run({
    id, bill_no: `HB/T11/${c.id}`, contract_id: c.id, station_name: 'S', billing_month: '2026-09', financial_year: '2026-2027',
    bill_kind: 'PROVISIONAL', rea_reference: null, revision_reason: null, ...emptyBillBlocks(c),
    total_charges: 1000000, prepared_by: null, created_by: null,
  });
  db.prepare(`UPDATE hydro_station_bills SET status = 'ISSUED' WHERE id = ?`).run(id);
  return insertDoc({ doc_no: `PB/T11/${c.id}`, contract_id: c.id, beneficiary_name: 'BIHAR', doc_type: 'PB', bill_id: id, amount: 1000000, doc_date: '2026-10-01', due_date: '2026-11-15' });
};
beforeAll(() => {
  thermal = makeContract({ project_type: 'Thermal' }); hydro = makeContract({ project_type: 'Hydro' });
  thermalDesk = signToken(makeUser('THERMAL_USER')); hydroDesk = signToken(makeUser('COMMERCIAL_ADMIN'));
  thDoc = bill(thermal); hyDoc = bill(hydro);
});
const raise = (t, doc, reason) => request(app).post('/api/hydro-desk/disputes').set(auth(t))
  .send({ ledger_doc_id: doc.id, reason_code: reason, description: 'disputed for the test', disputed_amount: 1000 });

describe('Disputes on a thermal station', () => {
  it('take the coal station\'s reasons, not free power', async () => {
    expect((await raise(thermalDesk, thDoc, 'FREE_POWER')).status).toBe(400);
    const r = await request(app).get(`/api/hydro-desk/disputes/reasons?contract_id=${thermal.id}`).set(auth(thermalDesk));
    expect(r.body.map((x) => x.value)).toContain('FUEL_GCV_PRICE');
    const ok = await raise(thermalDesk, thDoc, 'FUEL_GCV_PRICE');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const a = db.prepare(`SELECT module FROM audit_logs WHERE action = 'HYDRO_DISPUTE_RAISED' AND entity_id = ?`).get(ok.body.id);
    expect(a.module).toBe('THERMAL');
  });

  it('are listed and counted to the thermal desk only', async () => {
    await raise(hydroDesk, hyDoc, 'BETA_INCENTIVE');
    const list = await request(app).get('/api/hydro-desk/disputes').set(auth(hydroDesk));
    expect(list.body.some((d) => d.contract_id === thermal.id)).toBe(false);
    const stats = await request(app).get('/api/hydro-desk/disputes/stats').set(auth(thermalDesk));
    const own = db.prepare(`SELECT COUNT(*) n FROM hydro_disputes d JOIN contracts c ON c.id = d.contract_id WHERE c.project_type = 'Thermal'`).get().n;
    expect(stats.body.total).toBe(own);
  });
});
