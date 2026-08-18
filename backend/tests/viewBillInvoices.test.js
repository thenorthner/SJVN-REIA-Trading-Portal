import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { auth, tokenFor } from './helpers/reia.js';
import { newId } from '../src/util.js';

let trader;
let invoiceId;

beforeEach(() => {
  db.prepare('DELETE FROM trading_debit_credit_notes').run();
  db.prepare('DELETE FROM view_bill_invoices').run();
  db.prepare('DELETE FROM exchange_contracts').run();
  db.prepare('DELETE FROM bilateral_transactions').run();
  db.prepare('DELETE FROM trading_clients').run();

  const entityId = newId('BUY');
  db.prepare(`INSERT INTO entities (id, entity_type, category, name, short_code, status)
              VALUES (?, 'BUYER', 'DISCOM', 'New Delhi Municipal Council', 'NDMC', 'APPROVED')`).run(entityId);
  const clientId = newId('TCL');
  db.prepare(`INSERT INTO trading_clients (id, entity_id, name, client_type, status)
              VALUES (?, ?, 'New Delhi Municipal Council', 'DISCOM', 'ACTIVE')`).run(clientId, entityId);
  const bilateralId = newId('BIL');
  db.prepare(`INSERT INTO bilateral_transactions
    (id, client_id, counterparty, quantum_mw, tariff_per_unit, purchase_rate_per_unit, sale_rate_per_unit, trading_margin_per_unit, start_date, end_date, status, contract_type, open_access_status)
    VALUES (?, ?, 'New Delhi Municipal Council', 100, 4.5, 4.47, 4.5, 0.03, '2026-09-01', '2026-09-30', 'ACTIVE', 'Bilateral', 'APPROVED')
  `).run(bilateralId, clientId);
  invoiceId = newId('VBI');
  db.prepare(`INSERT INTO view_bill_invoices
    (id, bill_type, client_name, invoice_no, invoice_amount, invoice_date, supply_from_date, supply_to_date, status, bilateral_id, quantum_mwh, rate_per_unit, gst_amount, breakup_json, settlement_basis, generated_from)
    VALUES (?, 'BILATERAL_ENERGY', 'New Delhi Municipal Council', 'SJVN/ENERGY/NDMC/202609/999', 225000, '2026-09-08', '2026-09-01', '2026-09-01', 'ACTIVE', ?, 25, 4.5, 0, '{"line_items":[{"description":"Energy charges","amount":225000}]}', 'FINAL', 'SETTLEMENT')
  `).run(invoiceId, bilateralId);
  trader = tokenFor('TRADING_USER');
});

describe('view bill invoices', () => {
  it('raises a debit note against a trading View Bills row', async () => {
    const note = await request(app).post('/api/trading-notes').set(auth(trader)).send({
      view_bill_invoice_id: invoiceId,
      note_type: 'DEBIT',
      billing_period: '2026-09',
      amount: 1200,
      reason_code: 'RATE_REVISION',
      reason: 'Final meter true-up',
    });
    expect(note.status).toBe(201);
    expect(note.body.client_name).toBe('New Delhi Municipal Council');

    const listed = await request(app).get('/api/trading-notes').set(auth(trader)).query({ view_bill_invoice_id: invoiceId });
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
  });

  it('downloads a row-level PDF for the trading invoice', async () => {
    const pdf = await request(app).get(`/api/view-bill-invoices/${invoiceId}/pdf`).set(auth(trader));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
  });
});
