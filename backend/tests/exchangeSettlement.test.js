import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { seedRateMaster } from '../src/services/rateMaster.js';
import {
  summariseClearedBids,
  bidsForContract,
  computeExchangeSettlement,
  buildExchangeInvoice,
  exchangeFeeFor,
  refreshExchangeContractStatus,
} from '../src/services/exchangeSettlement.js';

const CONTRACT = 'EXC-SETTLE-TEST';
const CLIENT = 'TCL-SETTLE-TEST';

/** Re-create the contract with different terms. Leaves any bids in place. */
function makeContract(over = {}) {
  db.prepare('UPDATE bids SET contract_id = NULL WHERE contract_id = ?').run(CONTRACT);
  db.prepare('DELETE FROM exchange_contracts WHERE id = ?').run(CONTRACT);
  const row = {
    id: CONTRACT,
    portfolio_id: 'PF-1',
    loa_no: 'EXC/LOA/001',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    side: 'Buyer',
    client_id: CLIENT,
    client_name: 'New Delhi Municipal Council',
    concerned_sldc: 'Delhi',
    region: 'NR',
    product: 'DAM',
    bidding_type: 'Single',
    billing_type: 'Weekly',
    trading_margin: 0.03,
    status: 'DRAFT',
    ...over,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO exchange_contracts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c]));
  return row;
}

const getContract = () => db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(CONTRACT);

/** A cleared bid with one block per entry. */
function makeBid({ date = '2026-09-01', product = 'DAM', exchange = 'IEX', contractId = CONTRACT, blocks, status = 'CLEARED' }) {
  const bidId = newId('BID');
  const totalCleared = blocks.reduce((a, b) => a + (b.cleared ?? 0), 0);
  db.prepare(`
    INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, quantum_mw, price_per_unit,
      cleared_quantum_mw, contract_id, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYSTEM')
  `).run(bidId, CLIENT, exchange, product, date, date,
    blocks.reduce((a, b) => a + b.mw, 0), blocks[0].price, totalCleared, contractId, status);
  for (const b of blocks) {
    db.prepare(`
      INSERT INTO bid_blocks (id, bid_id, time_block, quantum_mw, price_per_unit, cleared_quantum_mw, cleared_price, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newId('BLK'), bidId, b.time_block, b.mw, b.price, b.cleared ?? 0, b.clearedPrice ?? null,
      b.blockStatus ?? ((b.cleared ?? 0) === 0 ? 'UNCLEARED' : (b.cleared >= b.mw ? 'CLEARED' : 'PARTIALLY_CLEARED')));
  }
  return bidId;
}

beforeEach(() => {
  db.prepare('DELETE FROM rate_master').run();
  seedRateMaster();
  // Contracts and bids reference the client, so they go before it does.
  db.prepare('DELETE FROM bid_blocks').run();
  db.prepare('DELETE FROM bid_events').run();
  db.prepare('DELETE FROM bids').run();
  db.prepare('DELETE FROM exchange_contracts WHERE id = ?').run(CONTRACT);
  db.prepare('DELETE FROM trading_clients WHERE id = ?').run(CLIENT);
  db.prepare("INSERT INTO trading_clients (id, name, client_type) VALUES (?, 'New Delhi Municipal Council', 'DISCOM')").run(CLIENT);
  makeContract();
});

describe('summariseClearedBids', () => {
  it('converts cleared 15-minute blocks to MWh at a quarter-hour each', () => {
    makeBid({ blocks: [
      { time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 100, clearedPrice: 4.3 },
      { time_block: '00:15-00:30', mw: 100, price: 4.2, cleared: 100, clearedPrice: 4.3 },
    ] });
    const s = summariseClearedBids(bidsForContract(getContract()));
    expect(s.cleared_mwh).toBe(50);
    expect(s.cleared_blocks).toBe(2);
  });

  it('values energy at the price the market cleared at, not the bid price', () => {
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4.0, cleared: 100, clearedPrice: 4.5 }] });
    const s = summariseClearedBids(bidsForContract(getContract()));
    expect(s.avg_clearing_price).toBe(4.5);
    expect(s.cleared_value).toBe(25 * 1000 * 4.5);
  });

  it('carries only the cleared part of a partially cleared block', () => {
    makeBid({ status: 'PARTIALLY_CLEARED', blocks: [
      { time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 40, clearedPrice: 4.2 },
    ] });
    const s = summariseClearedBids(bidsForContract(getContract()));
    expect(s.cleared_mwh).toBe(10);
    expect(s.bid_mwh).toBe(25);
    expect(s.uncleared_mwh).toBe(15);
  });

  it('leaves an uncleared block out of the settlement entirely', () => {
    makeBid({ status: 'PARTIALLY_CLEARED', blocks: [
      { time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 100, clearedPrice: 4.2 },
      { time_block: '00:15-00:30', mw: 100, price: 4.2, cleared: 0 },
    ] });
    const s = summariseClearedBids(bidsForContract(getContract()));
    expect(s.cleared_mwh).toBe(25);
    expect(s.cleared_blocks).toBe(1);
  });

  it('weights the average price by volume across differently priced blocks', () => {
    makeBid({ blocks: [
      { time_block: '00:00-00:15', mw: 100, price: 4, cleared: 100, clearedPrice: 4.0 },
      { time_block: '00:15-00:30', mw: 300, price: 4, cleared: 300, clearedPrice: 5.0 },
    ] });
    const s = summariseClearedBids(bidsForContract(getContract()));
    // (25 x 4 + 75 x 5) / 100
    expect(s.avg_clearing_price).toBe(4.75);
  });

  it('warns rather than billing zero when a cleared block carries no price', () => {
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 100, clearedPrice: null, blockStatus: 'CLEARED' }] });
    const s = summariseClearedBids(bidsForContract(getContract()));
    expect(s.avg_clearing_price).toBe(4.2);
    expect(s.warnings.some((w) => /cleared without a price/.test(w))).toBe(true);
  });
});

describe('bidsForContract', () => {
  it('picks up a bid filed directly under the contract', () => {
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 50, price: 4, cleared: 50, clearedPrice: 4 }] });
    expect(bidsForContract(getContract())).toHaveLength(1);
  });

  it('matches an older unlinked bid by client, product and delivery window', () => {
    makeBid({ contractId: null, blocks: [{ time_block: '00:00-00:15', mw: 50, price: 4, cleared: 50, clearedPrice: 4 }] });
    expect(bidsForContract(getContract())).toHaveLength(1);
  });

  it('does not pull in an unlinked bid for a different product', () => {
    makeBid({ contractId: null, product: 'RTM', blocks: [{ time_block: '00:00-00:15', mw: 50, price: 4, cleared: 50, clearedPrice: 4 }] });
    expect(bidsForContract(getContract())).toHaveLength(0);
  });

  it('ignores a bid delivered outside the contract window', () => {
    makeBid({ date: '2026-12-01', blocks: [{ time_block: '00:00-00:15', mw: 50, price: 4, cleared: 50, clearedPrice: 4 }] });
    expect(bidsForContract(getContract())).toHaveLength(0);
  });

  it('ignores a bid that never cleared', () => {
    makeBid({ status: 'REJECTED', blocks: [{ time_block: '00:00-00:15', mw: 50, price: 4, cleared: 0 }] });
    expect(bidsForContract(getContract())).toHaveLength(0);
  });

  it('narrows to the supply period when one is given', () => {
    makeBid({ date: '2026-09-01', blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4, cleared: 100, clearedPrice: 4 }] });
    makeBid({ date: '2026-09-15', blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4, cleared: 100, clearedPrice: 4 }] });
    expect(bidsForContract(getContract(), '2026-09-01', '2026-09-07')).toHaveLength(1);
  });
});

describe('computeExchangeSettlement', () => {
  it('adds the margin to the client position on a buy-side contract', () => {
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 100, clearedPrice: 4.5 }] });
    const s = computeExchangeSettlement({ contract_id: CONTRACT });
    expect(s.money.energy_value).toBe(25 * 1000 * 4.5);
    expect(s.money.trading_margin).toBe(25 * 1000 * 0.03);
    expect(s.money.client_energy_position).toBe(s.money.energy_value + s.money.trading_margin);
  });

  it('takes the margin out of the proceeds on a sell-side contract', () => {
    makeContract({ side: 'Seller' });
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 100, clearedPrice: 4.5 }] });
    const s = computeExchangeSettlement({ contract_id: CONTRACT });
    expect(s.money.client_energy_position).toBe(s.money.energy_value - s.money.trading_margin);
  });

  it('prices the exchange transaction fee on cleared volume', () => {
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 100, clearedPrice: 4.5 }] });
    const s = computeExchangeSettlement({ contract_id: CONTRACT });
    expect(s.money.exchange_fee).toBe(25 * 20); // 25 MWh at Rs 20/MWh
  });

  it('refuses to settle a contract that does not exist', () => {
    expect(() => computeExchangeSettlement({ contract_id: 'EXC-nope' })).toThrow(/not found/i);
  });

  it('returns zeroes rather than NaN when nothing cleared', () => {
    const s = computeExchangeSettlement({ contract_id: CONTRACT });
    expect(s.money.energy_value).toBe(0);
    expect(s.cleared.cleared_mwh).toBe(0);
  });
});

describe('exchangeFeeFor', () => {
  it('prices each exchange off its own rate', () => {
    expect(exchangeFeeFor('PXIL', 100, '2026-09-01').amount).toBe(2000);
  });

  it('warns instead of silently charging nothing when the rate is missing', () => {
    const r = exchangeFeeFor('NOSUCH', 100, '2026-09-01');
    expect(r.amount).toBe(0);
    expect(r.warning).toMatch(/No rate found/);
  });
});

describe('buildExchangeInvoice', () => {
  it('bills energy plus margin on a buy-side contract', () => {
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 100, clearedPrice: 4.5 }] });
    const inv = buildExchangeInvoice({ contract_id: CONTRACT, bill_type: 'EXCHANGE_ENERGY' });
    expect(inv.invoice_amount).toBe(25 * 1000 * 4.5 + 25 * 1000 * 0.03);
    expect(inv.tds_rate).toBe(0.1);
    expect(inv.tds_deducted).toBe(Math.round(inv.invoice_amount * 0.001));
  });

  it('shows the margin as a deduction on a sell-side energy bill', () => {
    makeContract({ side: 'Seller' });
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 100, clearedPrice: 4.5 }] });
    const inv = buildExchangeInvoice({ contract_id: CONTRACT, bill_type: 'EXCHANGE_ENERGY' });
    const margin = inv.line_items.find((l) => /margin/i.test(l.description));
    expect(margin.amount).toBeLessThan(0);
    expect(inv.invoice_amount).toBe(25 * 1000 * 4.5 - 25 * 1000 * 0.03);
  });

  it('raises a margin-only bill off the same cleared volume', () => {
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 100, clearedPrice: 4.5 }] });
    const inv = buildExchangeInvoice({ contract_id: CONTRACT, bill_type: 'TRADING_MARGIN' });
    expect(inv.invoice_amount).toBe(750);
    expect(inv.tds_deducted).toBe(0);
  });

  it('bills open access on cleared volume and adds the exchange fee', () => {
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 400, price: 4.2, cleared: 400, clearedPrice: 4.5 }] });
    const inv = buildExchangeInvoice({ contract_id: CONTRACT, bill_type: 'EXCHANGE_OA' });
    expect(inv.line_items.some((l) => /Delhi STU/.test(l.description))).toBe(true);
    expect(inv.line_items.some((l) => /NOAR Application Fee/.test(l.description))).toBe(true);
    const fee = inv.line_items.find((l) => /IEX transaction fee/i.test(l.description));
    expect(fee.amount).toBe(100 * 20); // 100 MWh cleared
  });

  it('leaves GST off unless it is asked for', () => {
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 100, clearedPrice: 4.5 }] });
    const plain = buildExchangeInvoice({ contract_id: CONTRACT, bill_type: 'TRADING_MARGIN' });
    const taxed = buildExchangeInvoice({ contract_id: CONTRACT, bill_type: 'TRADING_MARGIN', options: { gst_applicable: true } });
    expect(plain.gst_amount).toBe(0);
    expect(taxed.gst_amount).toBe(Math.round(750 * 0.18));
  });

  it('rejects a bill type the exchange desk does not raise', () => {
    expect(() => buildExchangeInvoice({ contract_id: CONTRACT, bill_type: 'BILATERAL_ENERGY' }))
      .toThrow(/bill_type must be one of/);
  });
});

describe('refreshExchangeContractStatus', () => {
  it('leaves a contract with no filed bids at DRAFT', () => {
    expect(refreshExchangeContractStatus(CONTRACT, '2026-09-10')).toBe('DRAFT');
  });

  it('turns ACTIVE once a bid has been filed inside the window', () => {
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 100, clearedPrice: 4.5 }] });
    expect(refreshExchangeContractStatus(CONTRACT, '2026-09-10')).toBe('ACTIVE');
  });

  it('reads as COMPLETED once the contract window has passed', () => {
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 100, clearedPrice: 4.5 }] });
    expect(refreshExchangeContractStatus(CONTRACT, '2026-10-15')).toBe('COMPLETED');
  });

  it('never overrides a cancellation', () => {
    makeContract({ status: 'CANCELLED' });
    makeBid({ blocks: [{ time_block: '00:00-00:15', mw: 100, price: 4.2, cleared: 100, clearedPrice: 4.5 }] });
    expect(refreshExchangeContractStatus(CONTRACT, '2026-09-10')).toBe('CANCELLED');
  });
});
