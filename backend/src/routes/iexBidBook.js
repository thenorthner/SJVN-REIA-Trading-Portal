import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';

const router = Router();
router.use(requireAuth);

const REPORT_TYPES = ['DAM_SINGLE', 'DAM_BLOCK', 'RTM_SINGLE', 'RTM_BLOCK'];

function parseRow(row) {
  let data = {};
  try { data = JSON.parse(row.row_json || '{}'); } catch { data = {}; }
  return { id: row.id, report_type: row.report_type, ...data, created_at: row.created_at };
}

/** Seed ISET sample DAM block book rows once (idempotent by order_id). */
export function seedIexBidBookSamples() {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM iex_bid_book WHERE report_type = 'DAM_BLOCK'`).get().n;
  if (count > 0) return;

  const samples = [
    {
      order_id: '126072800097760', delivery_date: '29-Jul-2026', asset_id: 'INDIA', bid_area_id: 'E1',
      user_id: 'SJVA1', participant_id: 'N2DL0SJV0000', portfolio_id: 'E1BR0SJV0001', link_order_id: '0',
      order_time: '28-Jul-2026 16:21:34', order_entry_time: '28-Jul-2026 16:20:18', order_type: 'Block Bid',
      from_period_id: '16:30', to_period_id: '23:30', transaction_serial_no: '4', price: '2500.0', quantity: '-930',
      min_quantity: '0', no_sub_bids: '0', total_executed_qty: '9300', avg_trade_price: '768461.0', bid_ref: 'M1',
      linked_bid_ref: '', buy_sell: 'Sell', link_type: '', error: '', initiated_by: 'SYSTEM',
      order_entered_by: 'N2DL0SJV0000', last_updated_time: '28-Jul-2026 18:30:49', ocf_opted: 'No',
      premium_discount_price: '0.0', max_ocf_quantity: '0', ocf_source_bid_category: '', ocf_source_order_id: '0',
      order_status: 'Executed', action: 'Window closed',
    },
    {
      order_id: '126081000165861', delivery_date: '11-Aug-2026', asset_id: 'INDIA', bid_area_id: 'E1',
      user_id: 'SJVA1', participant_id: 'N2DL0SJV0000', portfolio_id: 'E1BR0SJV0001', link_order_id: '0',
      order_time: '11-Aug-2026 03:49:50', order_entry_time: '11-Aug-2026 03:49:50', order_type: 'Block Bid',
      from_period_id: '00:00', to_period_id: '02:00', transaction_serial_no: '1', price: '1900.0', quantity: '-10',
      min_quantity: '0', no_sub_bids: '0', total_executed_qty: '0', avg_trade_price: '0.0', bid_ref: 'SJVA11',
      linked_bid_ref: '', buy_sell: 'Sell', link_type: '', error: 'Market not open for specific Delivery Date.',
      initiated_by: 'SYSTEM', order_entered_by: 'SJVA1', last_updated_time: '11-Aug-2026 03:49:50', ocf_opted: 'No',
      premium_discount_price: '0.0', max_ocf_quantity: '0', ocf_source_bid_category: '', ocf_source_order_id: '0',
      order_status: 'Rejected', action: 'Rejected',
    },
    {
      order_id: '126081100071285', delivery_date: '12-Aug-2026', asset_id: 'INDIA', bid_area_id: 'E1',
      user_id: 'SJVA1', participant_id: 'N2DL0SJV0000', portfolio_id: 'E1BR0SJV0001', link_order_id: '0',
      order_time: '11-Aug-2026 15:49:24', order_entry_time: '11-Aug-2026 15:49:24', order_type: 'Block Bid',
      from_period_id: '17:30', to_period_id: '17:45', transaction_serial_no: '1', price: '2500.0', quantity: '-500',
      min_quantity: '0', no_sub_bids: '0', total_executed_qty: '5000', avg_trade_price: '369056.0', bid_ref: 'SJVA11',
      linked_bid_ref: '', buy_sell: 'Sell', link_type: '', error: '', initiated_by: 'SJVA1',
      order_entered_by: 'SJVA1', last_updated_time: '11-Aug-2026 18:30:16', ocf_opted: 'No',
      premium_discount_price: '0.0', max_ocf_quantity: '0', ocf_source_bid_category: '', ocf_source_order_id: '0',
      order_status: 'Executed', action: 'Window closed',
    },
    {
      order_id: '126081100071286', delivery_date: '12-Aug-2026', asset_id: 'INDIA', bid_area_id: 'E1',
      user_id: 'SJVA1', participant_id: 'N2DL0SJV0000', portfolio_id: 'E1BR0SJV0001', link_order_id: '0',
      order_time: '11-Aug-2026 15:49:24', order_entry_time: '11-Aug-2026 15:49:24', order_type: 'Block Bid',
      from_period_id: '17:45', to_period_id: '23:30', transaction_serial_no: '1', price: '2500.0', quantity: '-900',
      min_quantity: '0', no_sub_bids: '0', total_executed_qty: '9000', avg_trade_price: '917392.0', bid_ref: 'SJVA12',
      linked_bid_ref: '', buy_sell: 'Sell', link_type: '', error: '', initiated_by: 'SJVA1',
      order_entered_by: 'SJVA1', last_updated_time: '11-Aug-2026 18:30:16', ocf_opted: 'No',
      premium_discount_price: '0.0', max_ocf_quantity: '0', ocf_source_bid_category: '', ocf_source_order_id: '0',
      order_status: 'Executed', action: 'Window closed',
    },
  ];

  const insert = db.prepare(`
    INSERT INTO iex_bid_book (id, report_type, order_id, row_json) VALUES (?, 'DAM_BLOCK', ?, ?)
  `);
  const tx = db.transaction((rows) => {
    for (const row of rows) insert.run(newId('IBB'), row.order_id, JSON.stringify(row));
  });
  tx(samples);
}

router.get('/', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const reportType = String(req.query.report_type || '').toUpperCase();
  if (!REPORT_TYPES.includes(reportType)) {
    return res.status(400).json({ error: `report_type must be one of: ${REPORT_TYPES.join(', ')}` });
  }
  const rows = db.prepare(`
    SELECT * FROM iex_bid_book WHERE report_type = ? ORDER BY created_at DESC, id ASC
  `).all(reportType).map(parseRow);
  res.json(rows.map((r, i) => ({ ...r, sl_no: i + 1 })));
});

export default router;
