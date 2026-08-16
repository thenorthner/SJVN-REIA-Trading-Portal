import db from '../db/index.js';
import { newId } from '../util.js';
import { getEffectiveRate } from './rateMaster.js';
import { withPosition, refreshLot } from './recLedger.js';

// The desk side of the REC ledger: taking an exchange bid from submitted to
// executed, and moving the certificates that the execution actually traded.
//
// rec_bids recorded what was offered on IEX/PXIL and stopped there. Nothing
// consumed the inventory in rec_ledger when a sell bid cleared, so the bid book
// could show 20,000 certificates sold while the ledger still held all of them.
// Everything here exists to keep those two in step.

const GST_RATE = 0.18;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const rupees = (v) => Number(num(v).toFixed(2));

/**
 * REC types that a lot of the given technology can settle.
 *
 * The ledger stores a technology ('Solar', 'Hydro', …) while a bid is placed
 * for a market instrument ('Solar REC', 'Non-Solar (Hydro)'). Solar generation
 * backs solar certificates; everything else backs non-solar, with hydro
 * additionally able to settle a hydro-specific instrument.
 */
export function lotMatchesRecType(lot, recType) {
  if (!recType) return true;
  const tech = String(lot.technology || '').toLowerCase();
  const want = String(recType).toLowerCase();
  // 'non-solar' contains 'solar', so a bare substring test reads non-solar stock
  // as solar and lets a solar sale draw from it. Exclude the negation first.
  const isSolar = tech.includes('solar') && !tech.includes('non-solar');
  const isHydro = tech.includes('hydro');
  if (want.includes('solar') && !want.includes('non-solar')) return isSolar;
  if (want.includes('hydro')) return isHydro;
  if (want.includes('non-solar')) return !isSolar;
  return true;
}

/**
 * The generating technology behind a market instrument.
 *
 * The ledger records what generated the certificates; a bid names the product
 * traded. Storing the product in the technology column would make a bought lot
 * unmatchable against the very instrument it was bought as.
 */
export function technologyForRecType(recType) {
  const want = String(recType || '').toLowerCase();
  if (want.includes('hydro')) return 'Hydro';
  if (want.includes('non-solar')) return 'Non-Solar';
  if (want.includes('solar')) return 'Solar';
  return null;
}

/**
 * Certificates actually available to sell, oldest vintage first.
 *
 * Only an issued lot holds anything — an application that the Central Agency
 * has not acted on yet is not inventory, which withPosition already encodes.
 */
export function availableLots(recType = null) {
  return db.prepare(`
    SELECT * FROM rec_ledger
    WHERE status IN ('ISSUED','LISTED','SOLD')
      AND issuance_date IS NOT NULL
    ORDER BY vintage_month ASC, issuance_date ASC, created_at ASC
  `).all()
    .map(withPosition)
    .filter((l) => l.held_qty > 0 && lotMatchesRecType(l, recType));
}

/** The desk's sellable position, per REC type. */
export function inventoryPosition(recType = null) {
  const lots = availableLots(recType);
  return {
    rec_type: recType,
    lots: lots.length,
    held_qty: lots.reduce((a, l) => a + l.held_qty, 0),
    held_cost: lots.reduce((a, l) => a + l.held_cost, 0),
    oldest_vintage: lots[0]?.vintage_month ?? null,
    breakdown: lots.map((l) => ({
      lot_id: l.id, rec_no: l.rec_no, vintage_month: l.vintage_month,
      technology: l.technology, held_qty: l.held_qty,
      issue_cost_per_rec: l.issue_cost_per_rec, holding_age_days: l.holding_age_days,
    })),
  };
}

/**
 * Certificates already spoken for by bids that are live on the exchange.
 *
 * A submitted or approved sell bid has not drawn its stock yet — execution does
 * that — but the certificates behind it are committed. Ignoring them lets the
 * desk bid the same lot out twice and only discover it when the second
 * execution fails, by which point both bids are sitting on the exchange.
 */
export function committedQty(recType = null, excludeBidId = null) {
  const rows = db.prepare(`
    SELECT id, rec_type, quantity FROM rec_bids
    WHERE side = 'Sell' AND status IN ('SUBMITTED','APPROVED')
  `).all();
  return rows
    .filter((r) => r.id !== excludeBidId)
    .filter((r) => !recType || String(r.rec_type) === String(recType))
    .reduce((a, r) => a + (Number(r.quantity) || 0), 0);
}

/**
 * What the desk may actually offer: certificates held, less those already
 * committed to open bids.
 */
export function sellableInventory(recType = null, excludeBidId = null) {
  const position = inventoryPosition(recType);
  const committed = committedQty(recType, excludeBidId);
  return {
    ...position,
    committed_qty: committed,
    sellable_qty: Math.max(0, position.held_qty - committed),
  };
}

/**
 * Plan which lots a sale comes out of, oldest vintage first.
 *
 * FIFO by vintage is what the registry position reads as, and it clears the
 * oldest stock — which is the stock whose holding cost has run longest.
 * Throws rather than partially allocating: a sale that cannot be backed by
 * certificates on hand is not a sale the desk can settle.
 */
export function allocateFifo(quantity, recType = null) {
  const want = parseInt(quantity, 10);
  if (!Number.isFinite(want) || want <= 0) throw new Error('quantity must be a positive whole number of certificates');

  const lots = availableLots(recType);
  const available = lots.reduce((a, l) => a + l.held_qty, 0);
  if (available < want) {
    const err = new Error(
      `Only ${available} certificate(s) held${recType ? ` for ${recType}` : ''}; cannot sell ${want}.`,
    );
    err.available = available;
    throw err;
  }

  const plan = [];
  let left = want;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(left, lot.held_qty);
    plan.push({
      lot_id: lot.id,
      rec_no: lot.rec_no,
      vintage_month: lot.vintage_month,
      quantity: take,
      issue_cost_per_rec: num(lot.issue_cost_per_rec),
    });
    left -= take;
  }
  return plan;
}

/** The exchange's per-certificate trading fee, off the rate master. */
export function recTradingFee(quantity, onDate) {
  const rate = getEffectiveRate('REC Trading Fee', onDate);
  if (!rate) {
    return { rate: null, amount: 0, warning: `No rate found for 'REC Trading Fee' on ${onDate}` };
  }
  return { rate: rate.rate_value, amount: rupees(rate.rate_value * num(quantity)), warning: null };
}

/**
 * Price a REC sale the way the ISET REC Order form settles one.
 *
 * The trade obligation is the discovered rate on the volume that cleared; the
 * exchange's fee and the GST on it are deducted, leaving the net revenue the
 * desk actually receives. GST on the trade obligation is nil by default —
 * certificate sales are not taxed as a supply of goods — but stays overridable.
 */
export function settleRecSale({ quantity, discovered_rate, trade_date, gst_on_trade_obligation = 0, exchange_fees = null }) {
  const qty = num(quantity);
  const rate = num(discovered_rate);
  const tradeObligation = rupees(qty * rate);
  const fee = exchange_fees != null
    ? { rate: null, amount: rupees(exchange_fees), warning: null }
    : recTradingFee(qty, trade_date);
  const gstOnFees = rupees(fee.amount * GST_RATE);
  const gstOnTrade = rupees(gst_on_trade_obligation);

  return {
    total_recs_sold: qty,
    discovered_rate: rate,
    trade_obligation: tradeObligation,
    gst_on_trade_obligation: gstOnTrade,
    exchange_fees: fee.amount,
    exchange_fee_rate: fee.rate,
    gst_on_exchange_fees: gstOnFees,
    net_revenue: rupees(tradeObligation - gstOnTrade - fee.amount - gstOnFees),
    warnings: [fee.warning].filter(Boolean),
  };
}

/**
 * Restate a bid and its REC order from the tranches that survive.
 *
 * Reversing a sale books an offsetting negative tranche against the lot, which
 * puts the certificates back — but the bid still read EXECUTED for its original
 * volume and its REC order still carried the full revenue, so the register
 * overstated what the desk had actually realised. Recomputing from the
 * transactions themselves means the two cannot drift apart again.
 *
 * A bid whose sale is fully reversed goes back to APPROVED: the certificates
 * never left, so it is once more a cleared bid awaiting execution.
 */
export function restateBidFromTransactions(bidId) {
  const bid = db.prepare('SELECT * FROM rec_bids WHERE id = ?').get(bidId);
  if (!bid || bid.side !== 'Sell') return null;

  const agg = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) qty, COALESCE(SUM(amount), 0) amount
    FROM rec_transactions WHERE bid_id = ?
  `).get(bidId);
  const qty = Number(agg.qty) || 0;
  const amount = Number(agg.amount) || 0;
  // Whatever the surviving tranches averaged, which is the rate still realised.
  const rate = qty > 0 ? Number((amount / qty).toFixed(4)) : bid.discovered_rate;

  db.prepare('UPDATE rec_bids SET status = ?, executed_quantity = ? WHERE id = ?')
    .run(qty > 0 ? 'EXECUTED' : 'APPROVED', qty > 0 ? qty : null, bidId);

  if (!bid.rec_order_id) return { bid_id: bidId, executed_quantity: qty };

  const order = db.prepare('SELECT * FROM rec_orders WHERE id = ?').get(bid.rec_order_id);
  if (!order) return { bid_id: bidId, executed_quantity: qty };

  if (qty <= 0) {
    // Nothing was sold in the end, so the settlement is cancelled rather than
    // restated to zero — a zero-value order in the revenue register reads as a
    // trade that happened for nothing.
    db.prepare("UPDATE rec_orders SET status = 'CANCELLED', total_recs_sold = 0, trade_obligation = 0, "
      + 'exchange_fees = 0, gst_on_exchange_fees = 0, net_revenue = 0 WHERE id = ?').run(order.id);
    return { bid_id: bidId, executed_quantity: 0, rec_order_id: order.id, rec_order_status: 'CANCELLED' };
  }

  const s = settleRecSale({ quantity: qty, discovered_rate: rate, trade_date: order.trade_date });
  db.prepare(`
    UPDATE rec_orders SET total_recs_sold = ?, discovered_rate = ?, trade_obligation = ?,
      gst_on_trade_obligation = ?, exchange_fees = ?, gst_on_exchange_fees = ?, net_revenue = ?
    WHERE id = ?
  `).run(
    s.total_recs_sold, s.discovered_rate, s.trade_obligation,
    s.gst_on_trade_obligation, s.exchange_fees, s.gst_on_exchange_fees, s.net_revenue, order.id,
  );
  return { bid_id: bidId, executed_quantity: qty, rec_order_id: order.id, net_revenue: s.net_revenue };
}

/**
 * Execute an approved bid: move the certificates and record the settlement.
 *
 * A sell draws the executed quantity out of the ledger FIFO, booking one sale
 * tranche per lot it came from. A buy is the mirror — the certificates bought
 * enter the ledger as a new issued lot, because they are inventory the desk now
 * holds and can resell.
 *
 * All of it in one transaction: a bid can never read EXECUTED while the
 * certificates behind it stayed put.
 */
export function executeRecBid({ bid, executed_quantity, discovered_rate, trade_date, buyer = null, actor = null }) {
  const qty = parseInt(executed_quantity, 10);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('executed_quantity must be a positive whole number');
  if (qty > bid.quantity) throw new Error(`executed_quantity ${qty} exceeds the ${bid.quantity} bid for`);
  const rate = num(discovered_rate);
  if (rate <= 0) throw new Error('discovered_rate must be greater than zero');

  const settlement = settleRecSale({ quantity: qty, discovered_rate: rate, trade_date });
  // Plan the draw before opening the transaction so an inventory shortfall is
  // reported as a plain error rather than a rolled-back write.
  const plan = bid.side === 'Sell' ? allocateFifo(qty, bid.rec_type) : [];

  const insertTxn = db.prepare(`
    INSERT INTO rec_transactions (id, lot_id, txn_no, txn_type, quantity, rate_per_rec, amount,
      trade_date, platform, buyer, reference, notes, bid_id, created_by)
    VALUES (?, ?, ?, 'SALE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let newLotId = null;
  db.transaction(() => {
    if (bid.side === 'Sell') {
      let seq = (db.prepare('SELECT COUNT(*) c FROM rec_transactions').get().c || 0);
      for (const leg of plan) {
        seq += 1;
        insertTxn.run(
          newId('RECT'), leg.lot_id, `RECT/${String(seq).padStart(5, '0')}`,
          leg.quantity, rate, Math.round(leg.quantity * rate),
          trade_date, bid.exchange, buyer, bid.id, `Exchange sale under bid ${bid.id}`,
          bid.id, actor,
        );
      }
      for (const leg of plan) refreshLot(leg.lot_id);
    } else {
      // Bought certificates are inventory from the moment they settle, so they
      // enter as an issued lot priced at what was paid for them.
      newLotId = newId('REC');
      const seq = (db.prepare('SELECT COUNT(*) c FROM rec_ledger').get().c || 0) + 1;
      db.prepare(`
        INSERT INTO rec_ledger (id, rec_no, source, vintage_month, quantity, status,
          application_date, issuance_date, issue_cost_per_rec, trade_platform, trade_date,
          technology, notes, created_by)
        VALUES (?, ?, ?, ?, ?, 'ISSUED', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newLotId, `REC/BUY/${String(seq).padStart(5, '0')}`,
        `Purchased on ${bid.exchange}`, String(trade_date).slice(0, 7), qty,
        trade_date, trade_date, rate, bid.exchange, trade_date,
        technologyForRecType(bid.rec_type), `Bought under bid ${bid.id} (${bid.rec_type})`, actor,
      );
    }

    db.prepare(`
      UPDATE rec_bids SET status = 'EXECUTED', executed_quantity = ?, discovered_rate = ?, trade_date = ?
      WHERE id = ?
    `).run(qty, rate, trade_date, bid.id);
  })();

  return {
    bid_id: bid.id,
    side: bid.side,
    executed_quantity: qty,
    discovered_rate: rate,
    trade_date,
    allocations: plan,
    lot_created: newLotId,
    settlement,
  };
}
