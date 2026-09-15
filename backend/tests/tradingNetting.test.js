import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId, seedInvoiceCounters } from '../src/util.js';
import { seedRateMaster } from '../src/services/rateMaster.js';
import { createTradingInvoice } from '../src/services/tradingInvoice.js';
import { tokenFor, auth } from './helpers/reia.js';

// Netting a client's bills against what SJVN owes it. The form used to take
// both totals as typed numbers and debit the difference on top of the bills
// already debited; both sides now come from records, and the set-off lands on
// the bills themselves.

const CLIENT = 'TCL-NET-TEST';
const PERIOD = '2026-09';
let desk;

function bill({ amount, status = 'SENT', period = PERIOD, ledger = true }) {
  const inv = createTradingInvoice(
    { client_id: CLIENT, invoice_kind: 'EXCHANGE', billing_period: period, sjvn_margin: amount, gst_applicable: false, tds_section: 'NONE' },
    { postLedger: ledger },
  );
  db.prepare('UPDATE trading_invoices SET status = ? WHERE id = ?').run(status, inv.id);
  return inv;
}

/** A Seller exchange contract with one cleared day: `mw` × 24 h at `price` Rs/kWh. */
function sellerContract({ side = 'Seller', mw = 10, price = 4, margin = 0.03, date = '2026-09-10' } = {}) {
  const id = newId('EXC');
  db.prepare(`
    INSERT INTO exchange_contracts (id, portfolio_id, start_date, end_date, side, client_id, client_name, product, trading_margin, status)
    VALUES (?, 'PF-NET', '2026-09-01', '2026-09-30', ?, ?, 'Net Test Client', 'DAM', ?, 'ACTIVE')
  `).run(id, side, CLIENT, margin);
  const bidId = newId('BID');
  db.prepare(`
    INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, quantum_mw, price_per_unit, cleared_quantum_mw, contract_id, status, created_by)
    VALUES (?, ?, 'IEX', 'DAM', ?, ?, ?, ?, ?, ?, 'CLEARED', 'SYSTEM')
  `).run(bidId, CLIENT, date, date, mw, price, mw, id);
  // Cleared in each of the day's 96 quarter-hour blocks.
  const insertBlock = db.prepare(`
    INSERT INTO bid_blocks (id, bid_id, time_block, quantum_mw, price_per_unit, cleared_quantum_mw, cleared_price, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'CLEARED')
  `);
  const t = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  for (let m = 0; m < 1440; m += 15) insertBlock.run(newId('BLK'), bidId, `${t(m)}-${t(m + 15)}`, mw, price, mw, price);
  return id;
}

beforeEach(() => {
  for (const t of ['trading_payments', 'client_ledgers', 'trading_invoices', 'bid_blocks', 'bids', 'exchange_contracts', 'invoice_counters']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare('DELETE FROM rate_master').run();
  seedRateMaster();
  seedInvoiceCounters();
  db.prepare("INSERT OR IGNORE INTO trading_clients (id, name, client_type, status) VALUES (?, 'Net Test Client', 'GENERATOR', 'ACTIVE')").run(CLIENT);
  desk = tokenFor('TRADING_USER');
});

const preview = (q = `client_id=${CLIENT}&period=${PERIOD}`, token = desk) => request(app).get(`/api/billing-settlement/netting/preview?${q}`).set(auth(token));
const apply = (body = { client_id: CLIENT, period: PERIOD }, token = desk) => request(app).post('/api/billing-settlement/netting').set(auth(token)).send(body);

describe('Netting preview', () => {
  it('reads what the client owes from its issued bills and what SJVN owes from its Seller proceeds', async () => {
    bill({ amount: 30000 });
    bill({ amount: 20000, status: 'PARTIALLY_PAID' });
    bill({ amount: 99999, status: 'DRAFT' });
    const paid = bill({ amount: 5000, status: 'PAID' });
    db.prepare("INSERT INTO trading_payments (id, trading_invoice_id, amount, payment_date, mode) VALUES (?, ?, 5000, '2026-09-20', 'NEFT')").run(newId('TPY'), paid.id);
    sellerContract({ mw: 10, price: 4 }); // 240 MWh × ₹4.00 = ₹9,60,000 less ₹0.03 margin = ₹9,52,800
    sellerContract({ side: 'Buyer', mw: 50, price: 5 }); // the client buying is not SJVN owing it

    const r = await preview();
    expect(r.status).toBe(200);
    expect(r.body.receivable).toMatchObject({ total: 50000, drafts_not_counted: 1 });
    expect(r.body.receivable.invoices).toHaveLength(2);
    expect(r.body.payable.total).toBe(952800);
    expect(r.body.payable.contracts).toHaveLength(1);
    expect(r.body).toMatchObject({ set_off: 50000, after: { client_owes: 0, sjvn_owes: 902800 }, already_netted: null });
    expect(r.body.not_included).toMatch(/Bilateral/);
  });

  it('is the desk\'s: a client cannot preview or post, and a bad period is refused', async () => {
    expect((await preview(`client_id=${CLIENT}&period=${PERIOD}`, tokenFor('TRADING_CLIENT'))).status).toBe(403);
    expect((await preview(`client_id=${CLIENT}&period=September`)).status).toBe(400);
    expect((await preview('client_id=TCL-NOPE&period=2026-09')).status).toBe(404);
  });
});

describe('Applying a set-off', () => {
  it('clears the bills oldest first, credits the ledger by what it set off, and writes nothing typed in', async () => {
    const older = bill({ amount: 600000 });
    const newer = bill({ amount: 500000 });
    sellerContract({ mw: 10, price: 4 }); // SJVN owes ₹9,52,800
    const before = db.prepare('SELECT running_balance FROM client_ledgers ORDER BY timestamp DESC, rowid DESC LIMIT 1').get().running_balance;
    expect(before).toBe(1100000);

    // Amounts in the body are ignored.
    const r = await apply({ client_id: CLIENT, period: PERIOD, receivables_amount: 1, payables_amount: 99999999 });
    expect(r.status).toBe(200);
    expect(r.body.set_off).toBe(952800);
    expect(r.body.allocations).toEqual([
      expect.objectContaining({ invoice_id: older.id, amount: 600000, status: 'PAID' }),
      expect.objectContaining({ invoice_id: newer.id, amount: 352800, status: 'PARTIALLY_PAID' }),
    ]);
    expect(db.prepare('SELECT status FROM trading_invoices WHERE id = ?').get(older.id).status).toBe('PAID');
    const payments = db.prepare("SELECT amount, mode, reference FROM trading_payments WHERE mode = 'SET_OFF' ORDER BY amount DESC").all();
    expect(payments).toEqual([
      { amount: 600000, mode: 'SET_OFF', reference: 'NET-2026-09' },
      { amount: 352800, mode: 'SET_OFF', reference: 'NET-2026-09' },
    ]);
    const entry = db.prepare("SELECT * FROM client_ledgers WHERE transaction_type = 'SET_OFF'").get();
    expect(entry).toMatchObject({ credit: 952800, debit: 0, running_balance: 147200, reference_id: 'NET-2026-09' });
    expect(db.prepare("SELECT * FROM audit_logs WHERE action = 'NETTING_APPLIED'").get()).toBeTruthy();
  });

  it('nets a month once', async () => {
    bill({ amount: 100000 });
    sellerContract();
    expect((await apply()).status).toBe(200);
    const again = await apply();
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already netted for 2026-09/);
    expect(db.prepare("SELECT COUNT(*) n FROM trading_payments WHERE mode = 'SET_OFF'").get().n).toBe(1);
    expect((await preview()).body.already_netted).toMatchObject({ reference: 'NET-2026-09', amount: 100000 });
  });

  it('says there is nothing to set off rather than writing a zero', async () => {
    bill({ amount: 100000 });
    const noPayable = await apply();
    expect(noPayable.status).toBe(422);
    expect(noPayable.body.error).toMatch(/owes Net Test Client nothing/);

    db.prepare('DELETE FROM trading_invoices').run();
    sellerContract();
    const noReceivable = await apply();
    expect(noReceivable.status).toBe(422);
    expect(noReceivable.body.error).toMatch(/no unpaid issued bill/);
    expect(db.prepare('SELECT COUNT(*) n FROM trading_payments').get().n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) n FROM client_ledgers WHERE transaction_type = 'SET_OFF'").get().n).toBe(0);
  });

  it('settles a bill that never reached the ledger without crediting the ledger for it', async () => {
    const off = bill({ amount: 40000, ledger: false });
    sellerContract();
    const r = await apply();
    expect(r.body.allocations).toEqual([expect.objectContaining({ invoice_id: off.id, amount: 40000, on_ledger: false })]);
    expect(db.prepare("SELECT COUNT(*) n FROM client_ledgers WHERE transaction_type = 'SET_OFF'").get().n).toBe(0);
  });
});
