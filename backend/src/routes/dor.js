import express from 'express';
import db from '../db/index.js';
import { timeBlockNumber } from './isetReports.js';

/**
 * Daily Obligation Report: what the desk actually has on the exchange for a
 * delivery date, block by block.
 *
 * This endpoint used to generate its answer — 96 blocks off a hand-written
 * generation curve, a hardcoded total revenue "for screenshot replica", and a
 * named signatory who does not work here. It answered the same way whatever date
 * was asked for and whatever the desk had actually bid, which makes it worse than
 * an empty screen: a number nobody entered, presented as the day's position.
 *
 * It reads the bids now. A block's obligation is what cleared on it; the rate is
 * the price it cleared at; where nothing cleared the block is there with a zero,
 * because "no obligation in that block" is an answer.
 */
const router = express.Router();

const BLOCK_HOURS = 0.25;

/** "00:00-00:15" → "00:00 - 00:15", which is how the report reads. */
function timeLabel(block) {
  const raw = String(block || '').trim();
  const parts = raw.split('-');
  return parts.length === 2 ? `${parts[0].trim()} - ${parts[1].trim()}` : raw;
}

router.get('/', (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const portfolio = req.query.portfolio ? String(req.query.portfolio) : null;
  const clientId = req.query.client_id ? String(req.query.client_id) : null;

  // The bids that carry an obligation on that delivery date. A portfolio is the
  // exchange's name for a client's account, so it resolves through the contract
  // that carries it.
  const where = ['b.delivery_date = ?', "b.status IN ('SUBMITTED','CLEARED','PARTIALLY_CLEARED')"];
  const params = [date];
  if (clientId) { where.push('b.client_id = ?'); params.push(clientId); }
  if (portfolio) {
    where.push('(ec.portfolio_id = ? OR cep.portfolio_id = ?)');
    params.push(portfolio, portfolio);
  }

  const blocks = db.prepare(`
    SELECT
      bb.time_block, bb.quantum_mw, bb.cleared_quantum_mw, bb.cleared_price, bb.price_per_unit, bb.status,
      b.id AS bid_id, b.exchange, b.product, b.client_id,
      -- The side is the agreement's, not the bid's: a bid under a Seller-side
      -- exchange contract is an injection.
      ec.side AS side
    FROM bid_blocks bb
    JOIN bids b ON b.id = bb.bid_id
    LEFT JOIN exchange_contracts ec ON ec.id = b.contract_id
    LEFT JOIN client_exchange_portfolios cep ON cep.client_id = b.client_id AND cep.exchange = b.exchange
    WHERE ${where.join(' AND ')}
    ORDER BY bb.time_block
  `).all(...params);

  // One row per 15-minute block, whatever number of bids touched it.
  const byBlock = new Map();
  for (const row of blocks) {
    const key = row.time_block;
    if (!byBlock.has(key)) {
      byBlock.set(key, {
        block_no: timeBlockNumber(key),
        time_label: timeLabel(key),
        volume_mw: 0,
        offered_mw: 0,
        mcp: null,
        trade_value: 0,
        bids: [],
      });
    }
    const block = byBlock.get(key);
    const cleared = Number(row.cleared_quantum_mw) || 0;
    // A sell injects, which the report reads as a negative position.
    const isSell = ['SELL', 'SELLER'].includes(String(row.side || '').toUpperCase());
    const signed = isSell ? -cleared : cleared;
    block.volume_mw += signed;
    block.offered_mw += Number(row.quantum_mw) || 0;
    const rate = row.cleared_price != null ? Number(row.cleared_price) : null;
    if (rate != null) block.mcp = rate;
    // Cleared price is Rs/kWh on the bid; the report states value in rupees.
    block.trade_value += cleared * BLOCK_HOURS * (rate ?? 0) * 1000;
    if (!block.bids.includes(row.bid_id)) block.bids.push(row.bid_id);
  }

  const rows = [...byBlock.values()]
    .sort((a, b) => (Number(a.block_no) || 0) - (Number(b.block_no) || 0))
    .map((b) => ({
      ...b,
      volume_mw: Number(b.volume_mw.toFixed(4)),
      offered_mw: Number(b.offered_mw.toFixed(4)),
      trade_value: Number(b.trade_value.toFixed(2)),
      mwh: Number((Math.abs(b.volume_mw) * BLOCK_HOURS).toFixed(5)),
    }));

  const totalMwh = rows.reduce((a, b) => a + b.mwh, 0);
  const totalValue = rows.reduce((a, b) => a + b.trade_value, 0);

  res.json({
    date,
    portfolio,
    client_id: clientId,
    blocks: rows,
    summary: {
      blocks_with_obligation: rows.filter((b) => b.volume_mw !== 0).length,
      total_mwh: Number(totalMwh.toFixed(5)),
      total_revenue: Number(totalValue.toFixed(2)),
      weighted_avg_rate: totalMwh > 0 ? Number((totalValue / totalMwh).toFixed(2)) : 0,
    },
    // The charges that turn a gross position into a payout are raised on the
    // exchange invoice, not held here. Saying so beats inventing them.
    financial_summary: null,
    note: rows.length === 0
      ? `No bid carries an obligation on ${date}${portfolio ? ` for portfolio ${portfolio}` : ''}.`
      : null,
  });
});

export default router;
