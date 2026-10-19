import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { makeUser, makeContract, auth } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { insertDoc, accruedLpsFor } from '../../src/services/hydroLedger.js';

// Thermal QA run 7 (19-Oct-2026): notes listed per desk; no surcharge on a surcharge note.

let thermal; let hydro; let station; let maker; let checker;
beforeAll(() => {
  station = makeContract({ project_type: 'Thermal' });
  hydro = makeContract({ project_type: 'Hydro' });
  maker = makeUser('THERMAL_USER'); checker = makeUser('THERMAL_ADMIN');
  thermal = signToken(maker);
  for (const c of [station, hydro]) {
    insertDoc({ doc_no: `PB/T07/${c.id}`, contract_id: c.id, beneficiary_name: 'BIHAR', doc_type: 'PB', amount: 1000000, doc_date: '2026-07-01', due_date: '2026-12-31' });
    db.prepare(`INSERT INTO hydro_notes (id, note_no, note_type, contract_id, beneficiary_name, amount, reason, remarks, note_date, status)
      VALUES (?, ?, 'CREDIT', ?, 'BIHAR', 1000, 'OTHER', 'test note here', '2026-10-01', 'DRAFT')`).run(`HNT-T07-${c.id}`, `N-${c.id}`, c.id);
  }
});

describe('Notes', () => {
  it('are listed to a desk for its own stations only', async () => {
    const r = await request(app).get('/api/hydro-billing/notes').set(auth(thermal));
    const stations = new Set(r.body.notes.map((n) => n.contract_id));
    expect(stations.has(station.id)).toBe(true);
    expect(stations.has(hydro.id)).toBe(false);
  });

  it('a debit note billing LPS does not itself earn LPS', async () => {
    const raised = await request(app).post('/api/hydro-billing/notes').set(auth(thermal)).send({
      note_type: 'DEBIT', contract_id: station.id, beneficiary_name: 'BIHAR', amount: 100000, reason: 'LPS', remarks: 'LPS on the July bill',
    });
    expect(raised.status, JSON.stringify(raised.body)).toBe(201);
    const ok = await request(app).post(`/api/hydro-billing/notes/${raised.body.id}/approve`).set(auth(signToken(checker))).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    db.prepare(`UPDATE hydro_ledger_docs SET due_date = '2026-08-01' WHERE id = ?`).run(ok.body.ledger_doc.id);
    const lps = accruedLpsFor(station.id, 'BIHAR', { asOf: new Date('2026-10-19') });
    expect(lps.lines.find((l) => l.doc_id === ok.body.ledger_doc.id)).toBeUndefined();
  });
});
