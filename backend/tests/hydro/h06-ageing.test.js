import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeContract } from '../helpers/reia.js';
import { insertDoc, receivablesAgeing } from '../../src/services/hydroLedger.js';

// Hydro QA run 6 (18-Oct-2026): the receivables ageing.

let station;
beforeEach(() => {
  station = makeContract({ project_type: 'Hydro', contract_no: `PPA/SJVN/QA6-${Math.random().toString(36).slice(2, 8)}` });
  db.prepare(`INSERT INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from) VALUES (?, ?, 'QA STATE', 100, '2026-04-01')`).run(newId('HBA'), station.id);
  insertDoc({ doc_no: `PB/QA6/${Math.random().toString(36).slice(2, 8)}`, contract_id: station.id, beneficiary_name: 'QA STATE', doc_type: 'PB', amount: 100000, doc_date: '2026-09-01', due_date: '2026-10-15' });
});

describe('Receivables ageing', () => {
  it('refuses an unreadable date rather than failing', async () => {
    const r = await request(app).get(`/api/hydro-billing/receivables?contract_id=${station.id}&as_of=abc`).set(auth(tokenFor('COMMERCIAL_ADMIN')));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/as_of must be a date/);
  });

  it('counts days on India\'s calendar: early on the day after the due date, the bill is a day late', () => {
    // 01:00 IST on 16 Oct is still 15 Oct in UTC.
    const row = receivablesAgeing(station.id, { asOf: new Date('2026-10-15T19:30:00Z') }).rows[0];
    expect(row.days_overdue).toBe(1);
    expect(row.d1_30).toBe(100000);
  });

  it('does not show TDS as the last payment', () => {
    insertDoc({ doc_no: `TDS/QA6/${Math.random().toString(36).slice(2, 8)}`, contract_id: station.id, beneficiary_name: 'QA STATE', doc_type: 'PMT', mode: 'TDS', amount: 1000, doc_date: '2026-10-01' });
    expect(receivablesAgeing(station.id, { asOf: '2026-10-18' }).rows[0].last_payment_date).toBeNull();
  });
});
