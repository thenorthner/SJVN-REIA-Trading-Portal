import db from '../db/index.js';
import { parseBidIds } from './exchangeIsetToBids.js';

const FILED = ['SUBMITTED', 'CLEARED', 'PARTIALLY_CLEARED'];

function appDate(app) {
  return String(app.application_date || '').slice(0, 10);
}

/** Contract this application files under: same portfolio + product, window containing the date. */
export function contractForApplication(app) {
  if (app.contract_id) {
    const linked = db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(app.contract_id);
    if (linked) return linked;
  }
  const date = appDate(app);
  const rows = db.prepare(`
    SELECT * FROM exchange_contracts
    WHERE portfolio_id = ? AND product = ?
    ORDER BY start_date DESC
  `).all(app.portfolio_id, app.product);
  if (!rows.length) return null;
  if (date) {
    const inWindow = rows.find((c) => (!c.start_date || c.start_date <= date) && (!c.end_date || c.end_date >= date));
    if (inWindow) return inWindow;
  }
  return rows[0];
}

function bidSummary(row) {
  return {
    id: row.id,
    status: row.status,
    approval_status: row.approval_status,
    delivery_date: row.delivery_date,
    quantum_mw: row.quantum_mw,
    cleared_quantum_mw: row.cleared_quantum_mw,
    product: row.product,
    exchange: row.exchange,
    contract_id: row.contract_id,
  };
}

export function bidsForApplication(app, contract = null) {
  const stored = parseBidIds(app.bid_ids);
  if (stored.length) {
    const rows = stored.map((id) => db.prepare('SELECT * FROM bids WHERE id = ?').get(id)).filter(Boolean);
    if (rows.length) return rows.map(bidSummary);
  }
  const c = contract || contractForApplication(app);
  const date = appDate(app);
  if (!c || !date) return [];
  const rows = db.prepare(`
    SELECT * FROM bids
    WHERE is_no_bid = 0
      AND product = ?
      AND exchange = ?
      AND delivery_date = ?
      AND (
        contract_id = ?
        OR (contract_id IS NULL AND client_id = ?)
      )
    ORDER BY created_at
  `).all(app.product, app.exchange, date, c.id, c.client_id);
  return rows.map(bidSummary);
}

export function withLinkedBids(app) {
  const contract = contractForApplication(app);
  const bids = bidsForApplication(app, contract);
  return {
    ...app,
    contract_id: app.contract_id || contract?.id || null,
    contract_label: contract?.loa_no || contract?.ppa_no || null,
    bid_ids: bids.map((b) => b.id),
    bids,
    linked_bid_count: bids.length,
  };
}

function persist(appId, patch) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  vals.push(appId);
  db.prepare(`UPDATE exchange_applications SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return db.prepare('SELECT * FROM exchange_applications WHERE id = ?').get(appId);
}

/**
 * PX1 attaches the exchange contract. PX2 attaches the DAM-desk bids for that
 * delivery date. Exchange Request / Approval follow those bids rather than a
 * disconnected DONE flag.
 */
export function applyApplicationStep(app, step, requestedStatus = 'DONE') {
  const status = String(requestedStatus || 'DONE').toUpperCase();
  const contract = contractForApplication(app);

  if (step === 'px1') {
    if (!contract) {
      throw new Error(`No exchange contract for portfolio ${app.portfolio_id} / ${app.product}`);
    }
    return persist(app.id, { contract_id: contract.id, px1_status: status });
  }

  if (step === 'px2') {
    if (!contract) {
      throw new Error(`PX1 a contract first — none found for ${app.portfolio_id} / ${app.product}`);
    }
    const bids = bidsForApplication({ ...app, contract_id: contract.id }, contract);
    if (!bids.length) {
      throw new Error(`No ${app.product} bid on ${app.exchange} for ${appDate(app)} under ${contract.loa_no || contract.id}`);
    }
    return persist(app.id, {
      contract_id: contract.id,
      bid_ids: JSON.stringify(bids.map((b) => b.id)),
      px1_status: app.px1_status === 'PENDING' ? 'DONE' : app.px1_status,
      px2_status: status,
    });
  }

  if (step === 'exchange_request') {
    const bids = bidsForApplication(app, contract);
    if (!bids.length) {
      throw new Error('PX2 a bid first — this application is not linked to any DAM-desk bid');
    }
    const filed = bids.filter((b) => FILED.includes(b.status) || b.approval_status === 'APPROVED');
    if (!filed.length) {
      throw new Error(`Linked bid ${bids[0].id} is ${bids[0].status} — not yet filed with the exchange`);
    }
    return persist(app.id, { exchange_request_status: status });
  }

  if (step === 'exchange_approval') {
    const bids = bidsForApplication(app, contract);
    if (!bids.length) {
      throw new Error('PX2 a bid first — this application is not linked to any DAM-desk bid');
    }
    const rejected = bids.every((b) => b.status === 'REJECTED' || b.approval_status === 'REJECTED');
    const cleared = bids.some((b) => ['CLEARED', 'PARTIALLY_CLEARED'].includes(b.status) || b.approval_status === 'APPROVED');
    const next = rejected ? 'REJECTED' : (cleared ? 'APPROVED' : status);
    return persist(app.id, { exchange_approval_status: next });
  }

  throw new Error(`step must be one of: px1, px2, exchange_request, exchange_approval`);
}
