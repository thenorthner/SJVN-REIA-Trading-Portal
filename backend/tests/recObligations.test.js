/**
 * The IEX obligation report, uploaded (CP-83-85 §5 step 6).
 *
 * Nobody has seen the exchange's real file yet, so what these tests hold the
 * parser to is not one layout but the behaviour that keeps an unknown layout
 * honest: read columns by name, say which ones were ignored, refuse a sheet it
 * cannot recognise instead of reading the third column as a price, and never
 * present a figure it computed as one the exchange stated.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import XLSX from 'xlsx';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth } from './helpers/reia.js';
import { parseSheetDate, parseAmount, parseSide } from '../src/services/recObligationImport.js';

let trader;
let viewer;
let LOT;

/** A workbook in the shape a session report takes: a title block, then a table. */
function workbook(rows, {
  header = ['Trade Date', 'Instrument', 'Side', 'Quantity', 'Price (Rs/REC)', 'Trade Value', 'Exchange Fee', 'GST', 'Net Amount', 'Settlement Date', 'Reference No'],
  title = [['Indian Energy Exchange Limited'], ['REC Obligation Report — Member: SJVN LIMITED'], []],
  sheetName = 'Obligation Report',
} = {}) {
  const ws = XLSX.utils.aoa_to_sheet([...title, header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const SELL_ROW = ['11/03/2026', 'Non-Solar', 'Sell', 500, 350, 175000, 875, 157.5, 173967.5, '13/03/2026', 'IEX-REC-0001'];
const BUY_ROW = ['11/03/2026', 'Solar', 'Buy', 200, 1000, 200000, 400, 72, 200472, '13/03/2026', 'IEX-REC-0002'];

beforeEach(() => {
  db.prepare('DELETE FROM rec_obligation_lines').run();
  db.prepare('DELETE FROM rec_obligation_uploads').run();
  db.prepare("DELETE FROM rec_transactions WHERE reference = 'OBLIGATION-TEST'").run();
  db.prepare("DELETE FROM rec_ledger WHERE rec_no LIKE 'REC-OBL-TEST%'").run();
  trader = tokenFor('TRADING_USER');
  viewer = tokenFor('MANAGEMENT');

  LOT = newId('REC');
  db.prepare(`
    INSERT INTO rec_ledger (id, rec_no, source, vintage_month, quantity, status, issuance_date)
    VALUES (?, 'REC-OBL-TEST-1', 'Charanka CSPP', '2026-01', 1000, 'ISSUED', '2026-02-10')
  `).run(LOT);
});

/** Book a sale against the lot, the way the desk does when a session clears. */
function bookSale({ quantity = 500, rate = 350, date = '2026-03-11', platform = 'IEX' } = {}) {
  db.prepare(`
    INSERT INTO rec_transactions (id, lot_id, txn_no, txn_type, quantity, rate_per_rec, amount, trade_date, platform, reference)
    VALUES (?, ?, ?, 'SALE', ?, ?, ?, ?, ?, 'OBLIGATION-TEST')
  `).run(newId('RTX'), LOT, `RTX/${Math.random().toString(36).slice(2, 8)}`, quantity, rate, quantity * rate, date, platform);
}

const post = (file, fields = {}, who = trader) => {
  const req = request(app).post('/api/rec-obligations/upload').set(auth(who));
  Object.entries(fields).forEach(([k, v]) => req.field(k, String(v)));
  return req.attach('file', file, fields.filename || 'obligation.xlsx');
};
const get = (path, who = viewer) => request(app).get(path).set(auth(who));

describe('reading the file', () => {
  it('reads dates, amounts and sides in the shapes a sheet uses', () => {
    expect(parseSheetDate(45727)).toBe('2025-03-11');       // Excel serial
    expect(parseSheetDate('11/03/2026')).toBe('2026-03-11'); // DD/MM/YYYY
    expect(parseSheetDate('11-Mar-2026')).toBe('2026-03-11');
    expect(parseSheetDate('2026-03-11T00:00:00')).toBe('2026-03-11');
    expect(parseSheetDate('session two')).toBeNull();

    expect(parseAmount('1,75,000.50')).toBe(175000.5);
    expect(parseAmount('₹ 350')).toBe(350);
    expect(parseAmount('(500)')).toBe(-500);   // accounting negative
    expect(parseAmount('n/a')).toBeNull();

    expect(parseSide('Sale')).toBe('SELL');
    expect(parseSide('Pay-in')).toBe('BUY');
    expect(parseSide('maybe')).toBeNull();
  });

  it('finds the table under a title block and says which columns it used', async () => {
    const r = await post(workbook([SELL_ROW, BUY_ROW]));
    expect(r.status).toBe(201);
    expect(r.body.sheet).toBe('Obligation Report');
    expect(r.body.lines_read).toBe(2);
    const fields = r.body.columns_mapped.map((c) => c.field);
    expect(fields).toContain('trade_date');
    expect(fields).toContain('price_per_rec');   // matched through "Price (Rs/REC)"
    expect(fields).toContain('net_amount');
  });

  it('reads a CSV day-first, so 11/03 is March and not November', async () => {
    // The reader, left to itself, turns "11/03/2026" into the serial for 3
    // November and leaves "25/03/2026" as text, because there is no eleventh
    // month for it to fall into. One file would carry both readings.
    const csv = Buffer.from([
      'Indian Energy Exchange Limited',
      '',
      'Trade Date,Instrument,Side,Quantity,Price',
      '11/03/2026,Non-Solar,Sell,500,350',
      '25/03/2026,Non-Solar,Sell,100,340',
      '',
    ].join('\r\n'), 'utf8');

    const r = await post(csv, { filename: 'obligation.csv' });
    expect(r.status).toBe(201);
    expect(r.body.lines.map((l) => l.trade_date)).toEqual(['2026-03-11', '2026-03-25']);
    // Quantities survive being read as text rather than numbers.
    expect(r.body.totals.sold_qty).toBe(600);
  });

  it('refuses a sheet it cannot recognise instead of reading it positionally', async () => {
    const junk = workbook(
      [['some', 'rows', 'of', 'nothing']],
      { header: ['Alpha', 'Beta', 'Gamma', 'Delta'], title: [] },
    );
    const r = await post(junk);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/No obligation table was recognised/);
    expect(db.prepare('SELECT COUNT(*) c FROM rec_obligation_lines').get().c).toBe(0);
  });

  it('names the columns it ignored rather than dropping them silently', async () => {
    const header = ['Trade Date', 'Instrument', 'Side', 'Quantity', 'Price', 'Clearing Member Remarks'];
    const r = await post(workbook([['11/03/2026', 'Non-Solar', 'Sell', 500, 350, 'settled']], { header }));
    expect(r.status).toBe(201);
    expect(r.body.columns_ignored).toContain('Clearing Member Remarks');
  });

  it('leaves out a row it cannot read as a trade, and says how many', async () => {
    const r = await post(workbook([
      SELL_ROW,
      ['carried forward', '', '', '', '', '', '', '', '', '', ''],
      ['Total', '', '', 500, '', 175000, '', '', '', '', ''],
    ]));
    expect(r.body.lines_read).toBe(1);
    expect(r.body.skipped).toHaveLength(1);           // the "carried forward" line
    expect(r.body.warnings.join(' ')).toMatch(/could not be read as trades/);
  });

  it('takes the side from split buy and sell quantity columns when there is no side column', async () => {
    const header = ['Session Date', 'Certificate Type', 'Buy Qty', 'Sell Qty', 'Price', 'Trade Value'];
    const r = await post(workbook([
      ['11/03/2026', 'Non-Solar', 0, 500, 350, 175000],
      ['11/03/2026', 'Solar', 200, 0, 1000, 200000],
    ], { header }));
    expect(r.status).toBe(201);
    expect(r.body.lines.map((l) => l.side)).toEqual(['SELL', 'BUY']);
    expect(r.body.totals).toMatchObject({ sold_qty: 500, bought_qty: 200 });
  });
});

describe('what it computes, and what it does not pretend', () => {
  it('works out value and net when the report omits them, and names them as derived', async () => {
    const header = ['Trade Date', 'Instrument', 'Side', 'Quantity', 'Price', 'Exchange Fee', 'GST'];
    const r = await post(workbook([['11/03/2026', 'Non-Solar', 'Sell', 500, 350, 875, 157.5]], { header }));
    const line = r.body.lines[0];
    expect(line.trade_value).toBe(175000);
    // A sale receives the value less what the exchange takes.
    expect(line.net_amount).toBe(173967.5);
    expect(line.derived_fields).toEqual(['trade_value', 'net_amount']);
  });

  it('does not mark a figure as derived when the report stated it', async () => {
    const r = await post(workbook([SELL_ROW]));
    expect(r.body.lines[0].derived_fields).toEqual([]);
  });

  it('adds the exchange fee onto a purchase instead of taking it off', async () => {
    const header = ['Trade Date', 'Instrument', 'Side', 'Quantity', 'Price', 'Exchange Fee', 'GST'];
    const r = await post(workbook([['11/03/2026', 'Solar', 'Buy', 200, 1000, 400, 72]], { header }));
    expect(r.body.lines[0].net_amount).toBe(200472);
  });
});

describe('the ledger it maintains', () => {
  it('holds purchases and sales, and adds them up', async () => {
    await post(workbook([SELL_ROW, BUY_ROW]));
    const r = await get('/api/rec-obligations/ledger');
    expect(r.status).toBe(200);
    expect(r.body.lines).toHaveLength(2);
    expect(r.body.summary).toMatchObject({
      sold_qty: 500, bought_qty: 200, sale_value: 175000, purchase_value: 200000, session_count: 1,
    });
    // Sales bring money in, purchases take it out.
    expect(r.body.summary.net_amount).toBe(Math.round((173967.5 - 200472) * 100) / 100);
    expect(r.body.summary.by_instrument).toMatchObject({
      NON_SOLAR: { sold_qty: 500, bought_qty: 0 },
      SOLAR: { sold_qty: 0, bought_qty: 200 },
    });
  });

  it('refuses the identical file twice', async () => {
    const file = workbook([SELL_ROW]);
    expect((await post(file)).status).toBe(201);
    const again = await post(file);
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already uploaded/);
    expect(db.prepare('SELECT COUNT(*) c FROM rec_obligation_lines').get().c).toBe(1);
  });

  it('updates the trade a corrected report restates instead of duplicating it', async () => {
    await post(workbook([SELL_ROW]));
    const corrected = [...SELL_ROW];
    corrected[8] = 173000;   // net amount restated, same reference number
    const r = await post(workbook([corrected]), { filename: 'obligation-rev1.xlsx' });

    expect(r.body.lines_created).toBe(0);
    expect(r.body.lines_updated).toBe(1);
    const rows = db.prepare('SELECT net_amount FROM rec_obligation_lines').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].net_amount).toBe(173000);
  });

  it('shows a dry run without writing anything', async () => {
    const r = await post(workbook([SELL_ROW, BUY_ROW]), { dry_run: 'true' });
    expect(r.status).toBe(200);
    expect(r.body.lines_read).toBe(2);
    expect(r.body.upload_id).toBeNull();
    expect(db.prepare('SELECT COUNT(*) c FROM rec_obligation_uploads').get().c).toBe(0);
  });

  it('withdraws an upload without touching what a later report restated', async () => {
    const first = await post(workbook([SELL_ROW]));
    // A later report restates that trade and adds another.
    await post(workbook([SELL_ROW, BUY_ROW]), { filename: 'session-2.xlsx' });

    const del = await request(app).delete(`/api/rec-obligations/uploads/${first.body.upload_id}`).set(auth(trader));
    expect(del.status).toBe(200);
    expect(del.body.lines_removed).toBe(0);   // both lines belong to the later report now
    expect(db.prepare('SELECT COUNT(*) c FROM rec_obligation_lines').get().c).toBe(2);
  });
});

describe('against the REC ledger', () => {
  it('reports a session the exchange settled that no lot was sold against', async () => {
    const r = await post(workbook([SELL_ROW]));
    expect(r.body.reconciliation.map((d) => d.kind)).toContain('SALE_NOT_BOOKED');
  });

  it('agrees when the desk booked the same quantity at the same rate', async () => {
    bookSale({ quantity: 500, rate: 350 });
    const r = await post(workbook([SELL_ROW]));
    expect(r.body.reconciliation).toEqual([]);
  });

  it('flags a quantity the ledger books differently', async () => {
    bookSale({ quantity: 400, rate: 350 });
    const r = await post(workbook([SELL_ROW]));
    const diff = r.body.reconciliation.find((d) => d.kind === 'QTY_MISMATCH');
    expect(diff).toMatchObject({ report_qty: 500, ledger_qty: 400 });
  });

  it('flags a rate the ledger books differently', async () => {
    bookSale({ quantity: 500, rate: 300 });
    const r = await post(workbook([SELL_ROW]));
    const diff = r.body.reconciliation.find((d) => d.kind === 'RATE_MISMATCH');
    expect(diff).toMatchObject({ report_rate: 350, ledger_rate: 300 });
  });

  it('flags a session missing from the middle of the report it covers', async () => {
    bookSale({ quantity: 500, rate: 350 });                          // 11 March, in the report
    bookSale({ quantity: 100, rate: 360, date: '2026-03-12' });      // 12 March, not in it
    const march13 = ['13/03/2026', 'Non-Solar', 'Sell', 300, 340, 102000, 510, 91.8, 101398.2, '17/03/2026', 'IEX-REC-0003'];
    bookSale({ quantity: 300, rate: 340, date: '2026-03-13' });
    const r = await post(workbook([SELL_ROW, march13]));

    const missing = r.body.reconciliation.find((d) => d.kind === 'BOOKED_NOT_IN_REPORT');
    expect(missing).toMatchObject({ trade_date: '2026-03-12', ledger_qty: 100 });
    // The two sessions the report does cover agree, so they raise nothing.
    expect(r.body.reconciliation).toHaveLength(1);
  });

  it('does not reconcile purchases — they are the record, not a check on one', async () => {
    const r = await post(workbook([BUY_ROW]));
    expect(r.body.reconciliation).toEqual([]);
  });
});

describe('access and shape', () => {
  it('refuses an upload from a read-only role and an empty request', async () => {
    expect((await post(workbook([SELL_ROW]), {}, viewer)).status).toBe(403);
    expect((await request(app).post('/api/rec-obligations/upload').set(auth(trader))).status).toBe(400);
  });

  it('serves a template in the columns the parser understands', async () => {
    const r = await get('/api/rec-obligations/template');
    expect(r.status).toBe(200);
    expect(r.text.split('\n')[0]).toMatch(/Trade Date,Instrument,Side,Quantity/);
  });

  it('keeps each upload readable on its own, with the rows it carried', async () => {
    const up = await post(workbook([SELL_ROW, BUY_ROW]));
    const r = await get(`/api/rec-obligations/uploads/${up.body.upload_id}`);
    expect(r.body.upload).toMatchObject({ platform: 'IEX', line_count: 2, session_from: '2026-03-11' });
    expect(r.body.lines).toHaveLength(2);
    expect(r.body.lines[0].raw[0]).toBe('11/03/2026');   // the row exactly as the sheet held it
  });
});
