/**
 * Additive REC-desk demo seed.
 *
 * Extra lots, bid lifecycle (submit → approve → execute), settlement orders,
 * and ESCert bid-entry rows. Existing REC-SEED-00x lots from seed.js are left
 * in place; INSERT OR IGNORE keeps a second run a no-op.
 */
import db from './index.js';
import { ensureMasterDefaults } from '../mastersService.js';
import { refreshLot } from '../services/recLedger.js';
import { executeRecBid, settleRecSale } from '../services/recTrading.js';
import { seedRateMaster } from '../services/rateMaster.js';

function iso(offsetDays = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function ym(offsetMonths = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
  return d.toISOString().slice(0, 7);
}

function userId(email) {
  return db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id || null;
}

function insertLot(lot) {
  db.prepare(`
    INSERT OR IGNORE INTO rec_ledger (
      id, rec_no, source, technology, certificate_multiplier, energy_mwh,
      contract_id, vintage_month, quantity, status, application_date, issuance_date,
      registry_ref, issue_cost_per_rec, sale_rate_per_rec, sale_amount, created_by
    ) VALUES (
      @id, @rec_no, @source, @technology, @multiplier, @energy_mwh,
      @contract_id, @vintage, @quantity, @status, @applied, @issued,
      @registry, @cost, 0, 0, 'Shreya (Trading Ops)'
    )
  `).run(lot);
}

function insertBid(row) {
  db.prepare(`
    INSERT OR IGNORE INTO rec_bids (
      id, client_id, entity_name, entity_id, exchange, portfolio_code, rec_type,
      price, quantity, side, status, notional, approved_by, executed_quantity,
      discovered_rate, trade_date, rec_order_id, reject_reason, created_by, created_at
    ) VALUES (
      @id, @client_id, @entity_name, @entity_id, @exchange, @portfolio_code, @rec_type,
      @price, @quantity, @side, 'SUBMITTED', @notional, NULL, NULL,
      NULL, NULL, NULL, NULL, @created_by, @created_at
    )
  `).run(row);
  return db.prepare('SELECT * FROM rec_bids WHERE id = ?').get(row.id);
}

function bookSaleOrder({ bid, result, buyer, invoiceNo, actor }) {
  const s = result.settlement || settleRecSale({
    quantity: result.executed_quantity,
    discovered_rate: result.discovered_rate,
    trade_date: result.trade_date,
  });
  const orderId = `RCO-SEED-${bid.id.replace('RCB-SEED-', '')}`;
  db.prepare(`
    INSERT OR IGNORE INTO rec_orders (
      id, trade_date, rec_placed_for_sale, bid_rate, total_recs_sold, discovered_rate,
      trade_obligation, gst_on_trade_obligation, exchange_fees, gst_on_exchange_fees, net_revenue,
      buyer_name, invoice_no, recs_bought, base_amount, tax_amount, total_amount,
      status, generated_from, bid_id, created_by
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'SUBMITTED', 'SETTLEMENT', ?, ?
    )
  `).run(
    orderId, result.trade_date, bid.quantity, bid.price,
    s.total_recs_sold, s.discovered_rate,
    s.trade_obligation, s.gst_on_trade_obligation, s.exchange_fees, s.gst_on_exchange_fees, s.net_revenue,
    buyer, invoiceNo, bid.id, actor,
  );
  db.prepare('UPDATE rec_bids SET rec_order_id = ? WHERE id = ?').run(orderId, bid.id);
}

export function seedRecDesk() {
  seedRateMaster();
  ensureMasterDefaults();

  const trader = userId('trading@sjvn.in');
  const checker = userId('admin@sjvn.in');
  const ppa = db.prepare("SELECT id FROM contracts WHERE contract_no = 'PPA/SJVN/2024/001'").get();
  const njhps = db.prepare("SELECT id FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'").get();

  const clients = {
    ndmc: { id: 'TCL-EX-NDMC', name: 'New Delhi Municipal Council' },
    hppc: { id: 'TCL-EX-HPPC', name: 'Haryana Power Purchase Centre' },
    pspcl: { id: 'TCL-EX-PSPCL', name: 'Punjab State Power Corporation Ltd' },
    guvnl: { id: 'TCL-EX-GUVNL', name: 'Gujarat Urja Vikas Nigam Ltd' },
  };

  insertLot({
    id: 'REC-SEED-007', rec_no: 'REC/HYDRO/2026-07/0007', source: 'NJHPS (Nathpa Jhakri)',
    technology: 'Hydro', multiplier: 1.5, energy_mwh: 4800, contract_id: njhps?.id || null,
    vintage: ym(-1), quantity: 7200, status: 'ISSUED',
    applied: iso(-35), issued: iso(-22), registry: 'GI/REC/ISS/2026/01044', cost: 4,
  });
  insertLot({
    id: 'REC-SEED-008', rec_no: 'REC/SOLAR/2026-07/0008', source: 'Charanka Solar Park (CSPP)',
    technology: 'Solar', multiplier: 1, energy_mwh: 16200, contract_id: ppa?.id || null,
    vintage: ym(-1), quantity: 16200, status: 'ISSUED',
    applied: iso(-32), issued: iso(-18), registry: 'GI/REC/ISS/2026/01088', cost: 4,
  });
  insertLot({
    id: 'REC-SEED-009', rec_no: 'REC/HYDRO/2026-08/0009', source: 'RHPS (Rampur)',
    technology: 'Hydro', multiplier: 1.5, energy_mwh: 3900, contract_id: null,
    vintage: ym(0), quantity: 5850, status: 'APPLIED',
    applied: iso(-8), issued: null, registry: null, cost: 4,
  });
  ['REC-SEED-007', 'REC-SEED-008', 'REC-SEED-009'].forEach((id) => {
    try { refreshLot(id); } catch { /* lot may not exist on a bare schema */ }
  });

  const bid = (over) => ({
    exchange: 'IEX', portfolio_code: 'IEXREC001', created_by: trader, created_at: iso(-10) + ' 10:15:00',
    ...over,
    notional: Number((over.price * over.quantity).toFixed(2)),
  });

  const solarSell = insertBid(bid({
    id: 'RCB-SEED-SOLAR-X1', client_id: clients.hppc.id, entity_name: clients.hppc.name, entity_id: clients.hppc.id,
    rec_type: 'Solar REC', side: 'Sell', price: 370, quantity: 4000, portfolio_code: 'IEXNDMC123',
    created_at: iso(-12) + ' 10:05:00',
  }));
  const hydroSell = insertBid(bid({
    id: 'RCB-SEED-HYDRO-X1', client_id: clients.pspcl.id, entity_name: clients.pspcl.name, entity_id: clients.pspcl.id,
    rec_type: 'Hydro REC', side: 'Sell', price: 410, quantity: 1500, portfolio_code: 'IEXPSPCL061',
    created_at: iso(-9) + ' 11:20:00',
  }));
  const windSell = insertBid(bid({
    id: 'RCB-SEED-WIND-X1', client_id: clients.guvnl.id, entity_name: clients.guvnl.name, entity_id: clients.guvnl.id,
    rec_type: 'Non-Solar REC', side: 'Sell', price: 350, quantity: 2000, exchange: 'PXIL',
    portfolio_code: 'PXADANI204', created_at: iso(-7) + ' 14:40:00',
  }));
  const solarBuy = insertBid(bid({
    id: 'RCB-SEED-SOLAR-B1', client_id: clients.pspcl.id, entity_name: clients.pspcl.name, entity_id: clients.pspcl.id,
    rec_type: 'Solar REC', side: 'Buy', price: 365, quantity: 800, portfolio_code: 'IEXPSPCL061',
    created_at: iso(-6) + ' 09:50:00',
  }));

  const executeIfSubmitted = (row, { qty, rate, date, buyer, invoice }) => {
    if (!row || row.status === 'EXECUTED') return;
    db.prepare("UPDATE rec_bids SET status = 'APPROVED', approved_by = ? WHERE id = ?")
      .run(checker, row.id);
    const fresh = db.prepare('SELECT * FROM rec_bids WHERE id = ?').get(row.id);
    const result = executeRecBid({
      bid: fresh,
      executed_quantity: qty ?? fresh.quantity,
      discovered_rate: rate,
      trade_date: date,
      buyer,
      actor: trader,
    });
    if (fresh.side === 'Sell') {
      bookSaleOrder({ bid: fresh, result, buyer, invoiceNo: invoice, actor: trader });
    }
  };

  try {
    if (solarSell?.status === 'SUBMITTED') {
      executeIfSubmitted(solarSell, {
        qty: 4000, rate: 368, date: iso(-5), buyer: clients.hppc.name,
        invoice: 'SJVN/REC/HPPC/202608/1',
      });
    }
  } catch (e) {
    console.warn('REC solar sell execution skipped:', e.message);
  }
  try {
    if (hydroSell?.status === 'SUBMITTED') {
      executeIfSubmitted(hydroSell, {
        qty: 1500, rate: 405, date: iso(-4), buyer: clients.pspcl.name,
        invoice: 'SJVN/REC/PSPCL/202608/1',
      });
    }
  } catch (e) {
    console.warn('REC hydro sell execution skipped:', e.message);
  }
  try {
    if (windSell?.status === 'SUBMITTED') {
      executeIfSubmitted(windSell, {
        qty: 2000, rate: 352, date: iso(-3), buyer: clients.guvnl.name,
        invoice: 'SJVN/REC/GUVNL/202608/1',
      });
    }
  } catch (e) {
    console.warn('REC wind sell execution skipped:', e.message);
  }
  try {
    if (solarBuy?.status === 'SUBMITTED') {
      executeIfSubmitted(solarBuy, {
        qty: 800, rate: 362, date: iso(-2), buyer: clients.pspcl.name,
      });
    }
  } catch (e) {
    console.warn('REC solar buy execution skipped:', e.message);
  }

  // Live desk: trading user can approve these (raised by admin) then execute.
  insertBid(bid({
    id: 'RCB-SEED-SOLAR-LIVE', client_id: clients.ndmc.id, entity_name: clients.ndmc.name, entity_id: clients.ndmc.id,
    rec_type: 'Solar REC', side: 'Sell', price: 375, quantity: 2500, portfolio_code: 'IEXNDMC123',
    created_by: checker, created_at: iso(-1) + ' 10:12:00',
  }));
  insertBid(bid({
    id: 'RCB-SEED-HYDRO-LIVE', client_id: clients.hppc.id, entity_name: clients.hppc.name, entity_id: clients.hppc.id,
    rec_type: 'Hydro REC', side: 'Sell', price: 400, quantity: 800, portfolio_code: 'IEXHPPC088',
    created_by: checker, created_at: iso(0) + ' 09:40:00',
  }));
  insertBid(bid({
    id: 'RCB-SEED-SOLAR-BUY-LIVE', client_id: clients.ndmc.id, entity_name: clients.ndmc.name, entity_id: clients.ndmc.id,
    rec_type: 'Solar REC', side: 'Buy', price: 360, quantity: 500, portfolio_code: 'IEXNDMC123',
    created_by: checker, created_at: iso(0) + ' 11:05:00',
  }));

  const approved = insertBid(bid({
    id: 'RCB-SEED-NS-READY', client_id: clients.guvnl.id, entity_name: clients.guvnl.name, entity_id: clients.guvnl.id,
    rec_type: 'Non-Solar REC', side: 'Sell', price: 348, quantity: 1200, exchange: 'IEX',
    portfolio_code: 'IEXGUVNL110', created_at: iso(-2) + ' 16:20:00',
  }));
  if (approved && approved.status === 'SUBMITTED') {
    db.prepare("UPDATE rec_bids SET status = 'APPROVED', approved_by = ? WHERE id = ?")
      .run(checker, approved.id);
  }

  const rejected = insertBid(bid({
    id: 'RCB-SEED-SOLAR-REJ', client_id: clients.hppc.id, entity_name: clients.hppc.name, entity_id: clients.hppc.id,
    rec_type: 'Solar REC', side: 'Sell', price: 2200, quantity: 500, portfolio_code: 'IEXHPPC088',
    created_at: iso(-8) + ' 13:00:00',
  }));
  if (rejected && rejected.status === 'SUBMITTED') {
    db.prepare("UPDATE rec_bids SET status = 'REJECTED', approved_by = ?, reject_reason = ? WHERE id = ?")
      .run(checker, 'Bid not aligned with last discovered session; resubmit closer to ₹370.', rejected.id);
  }

  const cancelled = insertBid(bid({
    id: 'RCB-SEED-HYDRO-CXL', client_id: clients.pspcl.id, entity_name: clients.pspcl.name, entity_id: clients.pspcl.id,
    rec_type: 'Hydro REC', side: 'Buy', price: 390, quantity: 300, portfolio_code: 'IEXPSPCL061',
    created_at: iso(-11) + ' 15:30:00',
  }));
  if (cancelled && cancelled.status === 'SUBMITTED') {
    db.prepare("UPDATE rec_bids SET status = 'CANCELLED' WHERE id = ?").run(cancelled.id);
  }

  const insEsc = db.prepare(`
    INSERT OR IGNORE INTO escert_orders (
      id, client_id, entity_name, entity_id, exchange, portfolio_code, rec_type,
      price, quantity, side, status, notional, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insEsc.run('ESC-SEED-001', clients.hppc.id, clients.hppc.name, clients.hppc.id,
    'IEX', 'IEXHPPC088', 'PAT Cycle 4', 1850, 400, 'Buy', 'SUBMITTED', 740000, trader, iso(-4) + ' 10:20:00');
  insEsc.run('ESC-SEED-002', clients.pspcl.id, clients.pspcl.name, clients.pspcl.id,
    'IEX', 'IEXPSPCL061', 'ESCERT', 2100, 250, 'Sell', 'APPROVED', 525000, trader, iso(-3) + ' 12:10:00');
  insEsc.run('ESC-SEED-003', clients.guvnl.id, clients.guvnl.name, clients.guvnl.id,
    'PXIL', 'PXGUVNL01', 'PAT Cycle 3', 1600, 180, 'Buy', 'EXECUTED', 288000, trader, iso(-10) + ' 09:00:00');
  insEsc.run('ESC-SEED-004', clients.ndmc.id, clients.ndmc.name, clients.ndmc.id,
    'IEX', 'IEXNDMC123', 'PAT Cycle 4', 900, 100, 'Sell', 'REJECTED', 90000, trader, iso(-6) + ' 16:45:00');

  const lots = db.prepare("SELECT COUNT(*) c FROM rec_ledger WHERE id LIKE 'REC-SEED-%'").get().c;
  const bids = db.prepare("SELECT status, COUNT(*) c FROM rec_bids WHERE id LIKE 'RCB-SEED-%' GROUP BY status").all();
  const orders = db.prepare("SELECT COUNT(*) c FROM rec_orders WHERE id LIKE 'RCO-SEED-%'").get().c;
  console.log('REC desk seeded:', {
    lots,
    bids: Object.fromEntries(bids.map((r) => [r.status, r.c])),
    settlement_orders: orders,
    escert: db.prepare("SELECT COUNT(*) c FROM escert_orders WHERE id LIKE 'ESC-SEED-%'").get().c,
  });
}
