import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import {
  mapIsetProduct,
  parseBidIds,
  planFromLatestDetails,
  materialiseIsetBids,
} from '../services/exchangeIsetToBids.js';

const router = Router();
router.use(requireAuth);

const PRODUCT_TYPES = ['DAM', 'GDAM', 'HPDAM', 'RTM', 'TAM', 'GTAM', 'Daily', 'Weekly', 'Monthly'];
const BID_TYPES = ['single', 'block', 'linked block', 'differential'];

function parseDetails(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function genTransactionId() {
  const part = () => Math.random().toString(36).slice(2, 6);
  const n = Date.now().toString().slice(-8);
  return `V${part()}-${part()}-${part()}${n}`;
}

function inferExchange(contract) {
  const pf = String(contract?.portfolio_id || '').toUpperCase();
  if (pf.startsWith('PX')) return 'PXIL';
  if (pf.startsWith('HPX')) return 'HPX';
  return 'IEX';
}

/** One report line per PQData entry (or one line per bid detail if no PQ rows). */
function flattenReport(row) {
  const details = parseDetails(row.details_json);
  const bidIds = parseBidIds(row.bid_ids);
  const lines = [];
  let sl = 0;
  for (const detail of details) {
    const pqList = Array.isArray(detail.pq_data) && detail.pq_data.length
      ? detail.pq_data
      : [{ rate: '', quantity: '', bid_reference: '', block_id: '' }];
    for (const pq of pqList) {
      sl += 1;
      lines.push({
        sl_no: sl,
        transaction_id: row.transaction_id,
        product_type: row.product_type,
        bid_type: row.bid_type,
        delivery_date: row.delivery_date,
        asset_id: row.asset_id,
        bid_area_id: row.bid_area_id,
        user_id: row.user_id,
        participant_id: row.participant_id,
        portfolio_id: row.portfolio_id,
        initiated_by: row.initiated_by,
        session: row.session || '',
        from_period_id: detail.from_period_id || '',
        to_period_id: detail.to_period_id || '',
        buy_sell: detail.buy_sell || '',
        ocf_opted: detail.ocf_opted || '',
        premium_discount_price: detail.premium_discount_price ?? 0,
        max_ocf_quantity: detail.max_ocf_quantity ?? 0,
        rate_price: pq.rate ?? '',
        quantity_mwh: pq.quantity ?? '',
        bid_reference: pq.bid_reference || '',
        block_id: pq.block_id || '',
        status: row.status,
        status_message: row.status_message,
        created_at: row.created_at,
        submission_id: row.id,
        client_name: row.client_name,
        client_ref_no: row.client_ref_no,
        dam_bid_id: bidIds[0] || null,
        bid_ids: bidIds,
      });
    }
  }
  return lines;
}

router.get('/report', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { q, product_type, bid_type } = req.query;
  let sql = 'SELECT * FROM exchange_bidding_latest WHERE 1=1';
  const params = [];
  if (product_type) { sql += ' AND product_type = ?'; params.push(product_type); }
  if (bid_type) { sql += ' AND bid_type = ?'; params.push(bid_type); }
  sql += ' ORDER BY created_at DESC';
  let lines = db.prepare(sql).all(...params).flatMap(flattenReport);
  lines = lines.map((line, i) => ({ ...line, sl_no: i + 1 }));
  if (q) {
    const needle = String(q).toLowerCase();
    lines = lines.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(needle)));
    lines = lines.map((line, i) => ({ ...line, sl_no: i + 1 }));
  }
  res.json(lines);
});

router.get('/', requireRole(...ROLE_GROUPS.TRADING_ALL), (_req, res) => {
  const rows = db.prepare('SELECT * FROM exchange_bidding_latest ORDER BY created_at DESC').all();
  res.json(rows.map((r) => ({ ...r, details: parseDetails(r.details_json), bid_ids: parseBidIds(r.bid_ids) })));
});

router.get('/:id', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const row = db.prepare('SELECT * FROM exchange_bidding_latest WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({
    ...row,
    details: parseDetails(row.details_json),
    report_lines: flattenReport(row),
    bid_ids: parseBidIds(row.bid_ids),
  });
});

router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const errors = [];

  if (!b.client_id) errors.push('client_id is required');
  if (!String(b.client_name || b.client_id || '').trim()) errors.push('client_name is required');
  if (!String(b.client_ref_no || '').trim()) errors.push('client_ref_no is required');
  if (!PRODUCT_TYPES.includes(b.product_type)) errors.push(`product_type must be one of: ${PRODUCT_TYPES.join(', ')}`);
  const bidType = String(b.bid_type || '').toLowerCase();
  if (!BID_TYPES.includes(bidType)) errors.push(`bid_type must be one of: ${BID_TYPES.join(', ')}`);
  if (!b.delivery_date) errors.push('delivery_date is required');
  if (!String(b.asset_id || '').trim()) errors.push('asset_id is required');
  if (!String(b.bid_area_id || '').trim()) errors.push('bid_area_id is required');

  const product = mapIsetProduct(b.product_type);
  if (b.product_type && !product) errors.push(`product_type '${b.product_type}' cannot be filed as a DAM-desk bid`);

  let clientName = String(b.client_name || '').trim();
  if (b.client_id) {
    const client = db.prepare('SELECT name, status FROM trading_clients WHERE id = ?').get(b.client_id);
    if (!client) errors.push('client_id does not exist');
    else if (client.status === 'SUSPENDED') errors.push('Client is suspended. Bidding not allowed.');
    else if (!clientName) clientName = client.name;
  }

  let contractLabel = b.contract_label || null;
  let contract = null;
  if (b.contract_id) {
    contract = db.prepare('SELECT id, loa_no, ppa_no, portfolio_id FROM exchange_contracts WHERE id = ?').get(b.contract_id);
    if (!contract) errors.push('contract_id does not exist');
    else contractLabel = contract.loa_no || contract.ppa_no || contract.id;
  } else {
    errors.push('contract is required');
  }

  const details = Array.isArray(b.details) ? b.details : [];
  if (!details.length) errors.push('at least one bid detail is required');
  for (const [i, d] of details.entries()) {
    if (!d.from_period_id || !d.to_period_id) errors.push(`bid detail ${i + 1}: from/to period required`);
    if (!['Buy', 'Sell', 'B', 'S', 'Buy (B)', 'Sell (S)'].includes(d.buy_sell)) {
      errors.push(`bid detail ${i + 1}: Buy/Sell required`);
    }
    const pq = Array.isArray(d.pq_data) ? d.pq_data : [];
    if (!pq.length) errors.push(`bid detail ${i + 1}: add at least one PQData row (rate & quantity)`);
    for (const [j, p] of pq.entries()) {
      if (p.rate === '' || p.rate == null || !Number.isFinite(Number(p.rate))) {
        errors.push(`bid detail ${i + 1} PQData ${j + 1}: rate/price required`);
      }
      if (p.quantity === '' || p.quantity == null || !Number.isFinite(Number(p.quantity)) || Number(p.quantity) <= 0) {
        errors.push(`bid detail ${i + 1} PQData ${j + 1}: quantity must be positive`);
      }
    }
  }

  const plan = details.length && b.delivery_date
    ? planFromLatestDetails(details, b.delivery_date, { priceUnit: 'auto' })
    : { byDate: new Map(), errors: [] };
  errors.push(...plan.errors);

  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const normalized = details.map((d, di) => {
    let buySell = d.buy_sell;
    if (buySell === 'B' || buySell === 'Buy (B)') buySell = 'Buy';
    if (buySell === 'S' || buySell === 'Sell (S)') buySell = 'Sell';
    return {
      from_period_id: d.from_period_id,
      to_period_id: d.to_period_id,
      buy_sell: buySell,
      ocf_opted: d.ocf_opted || 'No',
      premium_discount_price: Number(d.premium_discount_price) || 0,
      max_ocf_quantity: Number(d.max_ocf_quantity) || 0,
      pq_data: (d.pq_data || []).map((p, pi) => ({
        rate: Number(p.rate),
        quantity: Number(p.quantity),
        bid_reference: p.bid_reference || `${b.initiated_by || b.user_id || 'BID'}${di + 1}${pi + 1}`,
        block_id: p.block_id || '',
      })),
    };
  });

  const id = newId('EXBL');
  const transactionId = b.transaction_id || genTransactionId();
  const actorId = req.user?.id || null;
  const exchange = b.exchange || inferExchange(contract);
  const premium = Number(normalized[0]?.premium_discount_price) || 0;

  try {
    const bidIds = db.transaction(() => {
      db.prepare(`
        INSERT INTO exchange_bidding_latest (
          id, transaction_id, client_id, client_name, client_ref_no, contract_id, contract_label,
          product_type, bid_type, delivery_date, asset_id, bid_area_id, user_id, participant_id,
          portfolio_id, initiated_by, session, details_json, status, status_message, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Success', 'Request Submitted Successfully.', ?)
      `).run(
        id,
        transactionId,
        b.client_id || null,
        clientName,
        String(b.client_ref_no).trim(),
        b.contract_id,
        contractLabel,
        b.product_type,
        bidType,
        b.delivery_date,
        String(b.asset_id).trim(),
        String(b.bid_area_id).trim(),
        b.user_id || null,
        b.participant_id || null,
        b.portfolio_id || null,
        b.initiated_by || null,
        b.session || null,
        JSON.stringify(normalized),
        actorId,
      );

      const created = materialiseIsetBids({
        clientId: b.client_id,
        exchange,
        product,
        contractId: b.contract_id,
        actorId,
        sourceKind: 'ISET_LATEST',
        sourceId: id,
        byDate: plan.byDate,
        bidDate: b.delivery_date,
        premiumDiscount: premium,
        securityOverride: b.security_override_reason,
      });
      db.prepare('UPDATE exchange_bidding_latest SET bid_ids = ? WHERE id = ?').run(JSON.stringify(created), id);
      return created;
    })();

    secureLogAudit(req, {
      action: 'CREATE_EXCHANGE_BIDDING_LATEST',
      module: 'TRADING',
      entityType: 'exchange_bidding_latest',
      entityId: id,
      details: { transaction_id: transactionId, product_type: b.product_type, bid_type: bidType, bid_ids: bidIds },
    });

    const saved = db.prepare('SELECT * FROM exchange_bidding_latest WHERE id = ?').get(id);
    res.status(201).json({
      ...saved,
      details: parseDetails(saved.details_json),
      report_lines: flattenReport(saved),
      bid_ids: parseBidIds(saved.bid_ids),
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to submit bid.' });
  }
});

export default router;
