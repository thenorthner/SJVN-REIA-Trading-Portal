/**
 * The REC Order screen from the uploaded obligation report. The report was
 * being uploaded and kept, and the settlement was still typed in field by field
 * from the same numbers. Only what the report states is handed over.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import XLSX from 'xlsx';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';

let trader;
const HEADER = ['Trade Date', 'Instrument', 'Side', 'Quantity', 'Price (Rs/REC)', 'Trade Value', 'Exchange Fee', 'GST', 'Net Amount', 'Counterparty', 'Reference No'];

function workbook(rows, header = HEADER) {
  const ws = XLSX.utils.aoa_to_sheet([['Indian Energy Exchange Limited'], [], header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Obligation Report');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const upload = (file, name = 'obligation.xlsx') => request(app).post('/api/rec-obligations/upload')
  .set(auth(trader)).attach('file', file, name);
const draft = (date, platform) => request(app).get('/api/rec-obligations/settlement-draft')
  .query({ trade_date: date, ...(platform ? { platform } : {}) }).set(auth(trader));

beforeEach(() => {
  db.prepare('DELETE FROM rec_obligation_lines').run();
  db.prepare('DELETE FROM rec_obligation_uploads').run();
  trader = tokenFor('TRADING_USER');
});

describe('Settlement draft from the obligation report', () => {
  it('hands over the session\'s sale as the report states it', async () => {
    expect((await upload(workbook([
      ['11/03/2026', 'Non-Solar', 'Sell', 500, 350, 175000, 875, 157.5, 173967.5, 'Alpha Discom', 'IEX-REC-0001'],
      ['11/03/2026', 'Solar', 'Buy', 200, 1000, 200000, 400, 72, 200472, 'Beta Power', 'IEX-REC-0002'],
    ]))).status).toBe(201);

    const r = await draft('2026-03-11');
    expect(r.status).toBe(200);
    expect(r.body.fields).toEqual({
      total_recs_sold: 500,
      discovered_rate: 350,
      trade_obligation: 175000,
      exchange_fees: 875,
      net_revenue: 173967.5,
      gst_on_trade_obligation: null,
      gst_on_exchange_fees: null,
      buyer_name: 'Alpha Discom',
    });
    expect(r.body.not_stated).toEqual(['gst_on_trade_obligation', 'gst_on_exchange_fees']);
    expect(r.body.notes[0]).toMatch(/GST of ₹157.5, taken off the sale with the fee, without saying how much is on the obligation/);
    // The purchase on the same session is not a sale and is not in it.
    expect(r.body.lines).toBe(1);
    expect(r.body.files).toEqual(['obligation.xlsx']);
  });

  it('does not split GST the report does not split, even when the sums would allow one', async () => {
    // ₹31,500 on the obligation and ₹157.5 on the fee, taken off together: value
    // less fee less GST is still the net, so the arithmetic cannot tell this
    // from GST that was all on the fee.
    await upload(workbook([
      ['11/03/2026', 'Non-Solar', 'Sell', 500, 350, 175000, 875, 31657.5, 142467.5, 'Alpha Discom', 'R1'],
    ]));
    const r = await draft('2026-03-11');
    expect(r.body.fields.gst_on_exchange_fees).toBeNull();
    expect(r.body.fields.gst_on_trade_obligation).toBeNull();
    expect(r.body.notes[0]).toMatch(/GST of ₹31657.5, taken off the sale with the fee/);
  });

  it('does not read a split out of a net the platform worked out itself', async () => {
    const header = HEADER.filter((h) => h !== 'Net Amount');
    await upload(workbook([
      ['11/03/2026', 'Non-Solar', 'Sell', 500, 350, 175000, 875, 157.5, 'Alpha Discom', 'R1'],
    ], header));
    const r = await draft('2026-03-11');
    // The net is value − fee − GST by construction, so it shows nothing about
    // whether the GST came off the sale.
    expect(r.body.fields.gst_on_exchange_fees).toBeNull();
    expect(r.body.notes[0]).not.toMatch(/taken off the sale/);
    expect(r.body.notes.join(' ')).toMatch(/Worked out on upload rather than stated by the exchange: net_amount/);
  });

  it('says so when a session cleared at more than one price, or to more than one buyer', async () => {
    await upload(workbook([
      ['11/03/2026', 'Non-Solar', 'Sell', 100, 350, 35000, 175, 31.5, 34793.5, 'Alpha Discom', 'R1'],
      ['11/03/2026', 'Non-Solar', 'Sell', 100, 360, 36000, 180, 32.4, 35787.6, 'Gamma Power', 'R2'],
    ]));
    const r = await draft('2026-03-11');
    expect(r.body.fields).toMatchObject({ total_recs_sold: 200, discovered_rate: 355, trade_obligation: 71000, buyer_name: null });
    expect(r.body.notes.join(' ')).toMatch(/cleared at 2 prices; the discovered rate is the value-weighted average/);
    expect(r.body.notes.join(' ')).toMatch(/went to 2 buyers \(Alpha Discom, Gamma Power\)/);
  });

  it('says plainly when there is nothing to settle', async () => {
    const none = await draft('2026-03-11');
    expect(none.status).toBe(404);
    expect(none.body.message).toMatch(/No IEX obligation report uploaded so far covers 2026-03-11/);

    await upload(workbook([['11/03/2026', 'Solar', 'Buy', 200, 1000, 200000, 400, 72, 200472, 'Beta Power', 'R9']]));
    const buysOnly = await draft('2026-03-11');
    expect(buysOnly.body.message).toMatch(/carries only purchases/);

    expect((await draft('11-03-2026')).status).toBe(400);
    expect((await draft('2026-03-11', 'NYSE')).status).toBe(400);
  });
});
