import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { seedRateMaster } from '../src/services/rateMaster.js';
import {
  lotMatchesRecType,
  availableLots,
  inventoryPosition,
  allocateFifo,
  recTradingFee,
  settleRecSale,
  technologyForRecType,
  executeRecBid,
} from '../src/services/recTrading.js';

/** An issued lot holding `qty` certificates of `tech`, vintage `vintage`. */
function makeLot({ vintage, qty, tech = 'Solar', cost = 100, issued = true, status = 'ISSUED' }) {
  const id = newId('REC');
  db.prepare(`
    INSERT INTO rec_ledger (id, rec_no, source, vintage_month, quantity, status,
      application_date, issuance_date, issue_cost_per_rec, technology)
    VALUES (?, ?, 'Test Station', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, `R/${id}`, vintage, qty, status, `${vintage}-01`, issued ? `${vintage}-15` : null, cost, tech);
  return id;
}

function makeBid({ side = 'Sell', qty = 100, price = 2000, recType = 'Solar REC', status = 'APPROVED' }) {
  const id = newId('RBD');
  db.prepare(`
    INSERT INTO rec_bids (id, entity_name, exchange, portfolio_code, rec_type, price, quantity, side, status, notional)
    VALUES (?, 'SJVN Limited', 'IEX', 'PF-1', ?, ?, ?, ?, ?, ?)
  `).run(id, recType, price, qty, side, status, price * qty);
  return db.prepare('SELECT * FROM rec_bids WHERE id = ?').get(id);
}

beforeEach(() => {
  db.prepare('DELETE FROM rate_master').run();
  seedRateMaster();
  db.prepare('DELETE FROM rec_transactions').run();
  db.prepare('DELETE FROM rec_orders').run();
  db.prepare('DELETE FROM rec_bids').run();
  db.prepare('DELETE FROM rec_ledger').run();
});

describe('lotMatchesRecType', () => {
  it('backs a solar certificate with solar generation only', () => {
    expect(lotMatchesRecType({ technology: 'Solar' }, 'Solar REC')).toBe(true);
    expect(lotMatchesRecType({ technology: 'Wind' }, 'Solar REC')).toBe(false);
  });

  it('backs a non-solar certificate with anything that is not solar', () => {
    expect(lotMatchesRecType({ technology: 'Wind' }, 'Non-Solar REC')).toBe(true);
    expect(lotMatchesRecType({ technology: 'Solar' }, 'Non-Solar REC')).toBe(false);
  });

  it('reserves the hydro instrument for hydro generation', () => {
    expect(lotMatchesRecType({ technology: 'Hydro' }, 'Non-Solar (Hydro)')).toBe(true);
    expect(lotMatchesRecType({ technology: 'Wind' }, 'Non-Solar (Hydro)')).toBe(false);
  });

  it('does not read non-solar stock as solar just because the word is inside it', () => {
    // 'non-solar' contains 'solar'; a bare substring test would let a solar sale
    // draw from non-solar certificates.
    expect(lotMatchesRecType({ technology: 'Non-Solar' }, 'Solar REC')).toBe(false);
    expect(lotMatchesRecType({ technology: 'Non-Solar' }, 'Non-Solar REC')).toBe(true);
  });
});

describe('technologyForRecType', () => {
  it('maps a traded instrument back to the generation behind it', () => {
    expect(technologyForRecType('Solar REC')).toBe('Solar');
    expect(technologyForRecType('Non-Solar REC')).toBe('Non-Solar');
    expect(technologyForRecType('Non-Solar (Hydro)')).toBe('Hydro');
  });
});

describe('availableLots and inventoryPosition', () => {
  it('counts only what has actually been issued', () => {
    makeLot({ vintage: '2026-04', qty: 500 });
    makeLot({ vintage: '2026-05', qty: 900, issued: false, status: 'APPLIED' });
    expect(inventoryPosition().held_qty).toBe(500);
  });

  it('orders the position oldest vintage first', () => {
    makeLot({ vintage: '2026-06', qty: 100 });
    makeLot({ vintage: '2026-02', qty: 200 });
    expect(availableLots()[0].vintage_month).toBe('2026-02');
    expect(inventoryPosition().oldest_vintage).toBe('2026-02');
  });

  it('narrows the position to the certificate type asked for', () => {
    makeLot({ vintage: '2026-04', qty: 500, tech: 'Solar' });
    makeLot({ vintage: '2026-04', qty: 300, tech: 'Wind' });
    expect(inventoryPosition('Solar REC').held_qty).toBe(500);
    expect(inventoryPosition('Non-Solar REC').held_qty).toBe(300);
  });

  it('drops a lot once it is fully disposed of', () => {
    const lot = makeLot({ vintage: '2026-04', qty: 100 });
    db.prepare('UPDATE rec_ledger SET sold_qty = 100 WHERE id = ?').run(lot);
    expect(inventoryPosition().held_qty).toBe(0);
  });

  it('reports an empty position rather than failing when nothing is held', () => {
    expect(inventoryPosition().held_qty).toBe(0);
    expect(inventoryPosition().oldest_vintage).toBeNull();
  });
});

describe('allocateFifo', () => {
  it('draws from the oldest vintage first', () => {
    makeLot({ vintage: '2026-05', qty: 300 });
    makeLot({ vintage: '2026-01', qty: 200 });
    const plan = allocateFifo(250);
    expect(plan[0].vintage_month).toBe('2026-01');
    expect(plan[0].quantity).toBe(200);
    expect(plan[1].quantity).toBe(50);
  });

  it('stops at the first lot when it covers the whole sale', () => {
    makeLot({ vintage: '2026-01', qty: 500 });
    makeLot({ vintage: '2026-02', qty: 500 });
    expect(allocateFifo(100)).toHaveLength(1);
  });

  it('refuses to allocate more certificates than are held', () => {
    makeLot({ vintage: '2026-01', qty: 100 });
    expect(() => allocateFifo(150)).toThrow(/Only 100 certificate/);
  });

  it('will not draw a solar sale from non-solar stock', () => {
    makeLot({ vintage: '2026-01', qty: 500, tech: 'Wind' });
    expect(() => allocateFifo(100, 'Solar REC')).toThrow(/Only 0 certificate/);
  });

  it('rejects a nonsensical quantity', () => {
    expect(() => allocateFifo(0)).toThrow(/positive whole number/);
    expect(() => allocateFifo(-5)).toThrow(/positive whole number/);
  });
});

describe('settleRecSale', () => {
  it('nets the exchange fee and its GST out of the trade obligation', () => {
    const s = settleRecSale({ quantity: 1000, discovered_rate: 2400, trade_date: '2026-09-01' });
    expect(s.trade_obligation).toBe(2_400_000);
    expect(s.exchange_fees).toBe(2000);           // 1000 certificates at Rs 2
    expect(s.gst_on_exchange_fees).toBe(360);     // 18% of the fee
    expect(s.net_revenue).toBe(2_400_000 - 2000 - 360);
  });

  it('honours an explicit fee over the rate master', () => {
    const s = settleRecSale({ quantity: 1000, discovered_rate: 2400, trade_date: '2026-09-01', exchange_fees: 5000 });
    expect(s.exchange_fees).toBe(5000);
    expect(s.gst_on_exchange_fees).toBe(900);
  });

  it('warns instead of charging nothing when the fee has no rate', () => {
    db.prepare("DELETE FROM rate_master WHERE charge_name = 'REC Trading Fee'").run();
    const s = settleRecSale({ quantity: 1000, discovered_rate: 2400, trade_date: '2026-09-01' });
    expect(s.exchange_fees).toBe(0);
    expect(s.warnings.some((w) => /REC Trading Fee/.test(w))).toBe(true);
  });

  it('prices the fee per certificate', () => {
    expect(recTradingFee(3000, '2026-09-01').amount).toBe(6000);
  });
});

describe('executeRecBid', () => {
  it('takes the certificates out of the ledger when a sell clears', () => {
    makeLot({ vintage: '2026-01', qty: 400 });
    makeLot({ vintage: '2026-03', qty: 400 });
    const bid = makeBid({ side: 'Sell', qty: 500, price: 2000 });

    const r = executeRecBid({ bid, executed_quantity: 500, discovered_rate: 2400, trade_date: '2026-09-01' });
    expect(r.allocations).toHaveLength(2);
    expect(inventoryPosition().held_qty).toBe(300); // 800 held less 500 sold
    expect(db.prepare('SELECT COUNT(*) n FROM rec_transactions').get().n).toBe(2);
  });

  it('books each tranche at the rate the session discovered, not the bid rate', () => {
    makeLot({ vintage: '2026-01', qty: 500 });
    const bid = makeBid({ side: 'Sell', qty: 100, price: 2000 });
    executeRecBid({ bid, executed_quantity: 100, discovered_rate: 2650, trade_date: '2026-09-01' });
    const txn = db.prepare('SELECT * FROM rec_transactions').get();
    expect(txn.rate_per_rec).toBe(2650);
    expect(txn.amount).toBe(265000);
  });

  it('settles a partial fill on the volume that actually cleared', () => {
    makeLot({ vintage: '2026-01', qty: 500 });
    const bid = makeBid({ side: 'Sell', qty: 400, price: 2000 });
    const r = executeRecBid({ bid, executed_quantity: 150, discovered_rate: 2400, trade_date: '2026-09-01' });
    expect(r.settlement.total_recs_sold).toBe(150);
    expect(inventoryPosition().held_qty).toBe(350);
  });

  it('brings bought certificates into the ledger as a new issued lot', () => {
    const bid = makeBid({ side: 'Buy', qty: 250, price: 1800, recType: 'Non-Solar REC' });
    const r = executeRecBid({ bid, executed_quantity: 250, discovered_rate: 1750, trade_date: '2026-09-01' });
    expect(r.lot_created).toBeTruthy();
    const lot = db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(r.lot_created);
    expect(lot.quantity).toBe(250);
    expect(lot.status).toBe('ISSUED');
    expect(lot.issue_cost_per_rec).toBe(1750);
  });

  it('marks the bid executed with what cleared', () => {
    makeLot({ vintage: '2026-01', qty: 500 });
    const bid = makeBid({ side: 'Sell', qty: 100 });
    executeRecBid({ bid, executed_quantity: 100, discovered_rate: 2400, trade_date: '2026-09-01' });
    const after = db.prepare('SELECT * FROM rec_bids WHERE id = ?').get(bid.id);
    expect(after.status).toBe('EXECUTED');
    expect(after.executed_quantity).toBe(100);
    expect(after.discovered_rate).toBe(2400);
  });

  it('refuses to sell certificates that are not held, and moves nothing', () => {
    makeLot({ vintage: '2026-01', qty: 50 });
    const bid = makeBid({ side: 'Sell', qty: 100 });
    expect(() => executeRecBid({ bid, executed_quantity: 100, discovered_rate: 2400, trade_date: '2026-09-01' }))
      .toThrow(/Only 50 certificate/);
    expect(db.prepare('SELECT COUNT(*) n FROM rec_transactions').get().n).toBe(0);
    expect(db.prepare('SELECT status FROM rec_bids WHERE id = ?').get(bid.id).status).toBe('APPROVED');
  });

  it('will not clear more than was bid for', () => {
    makeLot({ vintage: '2026-01', qty: 900 });
    const bid = makeBid({ side: 'Sell', qty: 100 });
    expect(() => executeRecBid({ bid, executed_quantity: 200, discovered_rate: 2400, trade_date: '2026-09-01' }))
      .toThrow(/exceeds the 100 bid for/);
  });

  it('rejects a zero or negative clearing rate', () => {
    makeLot({ vintage: '2026-01', qty: 500 });
    const bid = makeBid({ side: 'Sell', qty: 100 });
    expect(() => executeRecBid({ bid, executed_quantity: 100, discovered_rate: 0, trade_date: '2026-09-01' }))
      .toThrow(/discovered_rate/);
  });

  it('leaves the lot readable as partially sold after a draw', () => {
    const lotId = makeLot({ vintage: '2026-01', qty: 500 });
    const bid = makeBid({ side: 'Sell', qty: 200 });
    executeRecBid({ bid, executed_quantity: 200, discovered_rate: 2400, trade_date: '2026-09-01' });
    const lot = db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(lotId);
    expect(lot.sold_qty).toBe(200);
    expect(lot.status).toBe('LISTED');
  });

  it('reads the lot as SOLD once nothing is left on it', () => {
    const lotId = makeLot({ vintage: '2026-01', qty: 200 });
    const bid = makeBid({ side: 'Sell', qty: 200 });
    executeRecBid({ bid, executed_quantity: 200, discovered_rate: 2400, trade_date: '2026-09-01' });
    expect(db.prepare('SELECT status FROM rec_ledger WHERE id = ?').get(lotId).status).toBe('SOLD');
  });
});
