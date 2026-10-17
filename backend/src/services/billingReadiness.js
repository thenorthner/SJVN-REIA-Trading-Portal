/**
 * Billing readiness board (feature B5, 17-Oct-2026).
 *
 * One row per live REIA contract for a month: is its energy locked, has the
 * PPA's own bill come in, is it already billed — and so, is it ready to bill.
 * "Generate all ready" raises the ready ones through the same path as
 * Generate, each in its own transaction, and reports what it could not raise
 * and why.
 */
import db from '../db/index.js';
import { sourcesForPsa } from './allocations.js';
import { standingPpaBill } from './backToBack.js';
import { lastCompleteMonth } from './energyRules.js';

const NOT_REIA = ['Hydro', 'HYDRO', 'PSP', 'Thermal', 'THERMAL'];
const LIVE = ['ACTIVE', 'NEARING_EXPIRY', 'RENEWED', 'AMENDED'];

/** The month's locked energy for a contract, final before provisional. */
function lockedEnergy(contractId, period) {
  return db.prepare(`
    SELECT id, energy_mwh, data_type FROM energy_data WHERE contract_id = ? AND period_month = ? AND status = 'LOCKED'
    ORDER BY (data_type = 'FINAL') DESC, created_at DESC LIMIT 1
  `).get(contractId, period);
}

/** SJVN's own bill for the month that stands: not cancelled, not wholly reversed. */
function standingSystemBill(contract, period) {
  const direction = contract.contract_type === 'PSA' ? 'SJVN_TO_BUYER' : 'SELLER_TO_SJVN';
  return db.prepare(`
    SELECT i.id, i.invoice_no, i.status, i.invoice_type, i.total_amount FROM invoices i
    WHERE i.contract_id = ? AND i.billing_period = ? AND i.direction = ? AND i.invoice_type IN ('PROVISIONAL', 'FINAL')
      AND i.status != 'CANCELLED' AND TRIM(COALESCE(i.invoice_breakdown_json, '')) != '' AND i.invoice_no NOT LIKE 'DSM-%'
      AND COALESCE((SELECT SUM(n.amount) FROM debit_credit_notes n WHERE n.invoice_id = i.id AND n.note_type = 'CREDIT'
        AND n.model = 'V2' AND n.status IN ('ISSUED', 'SETTLED')), 0) < i.total_amount - 0.005
    ORDER BY (i.invoice_type = 'FINAL') DESC, i.created_at DESC LIMIT 1
  `).get(contract.id, period, direction);
}

export function readinessBoard(period = lastCompleteMonth()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period))) throw Object.assign(new Error('period_month must be YYYY-MM'), { status: 400 });
  const open = String(period) > lastCompleteMonth();
  const contracts = db.prepare(`
    SELECT c.*, s.name AS seller_name, b.name AS buyer_name FROM contracts c
    LEFT JOIN entities s ON s.id = c.seller_id LEFT JOIN entities b ON b.id = c.buyer_id
    WHERE c.status IN (${LIVE.map(() => '?').join(',')}) AND COALESCE(c.project_type, '') NOT IN (${NOT_REIA.map(() => '?').join(',')})
      AND COALESCE(c.tenure_start, '0000') <= ? AND COALESCE(c.tenure_end, '9999') >= ?
    ORDER BY c.contract_type DESC, c.contract_no
  `).all(...LIVE, ...NOT_REIA, `${period}-31`, `${period}-01`);

  const rows = contracts.map((c) => {
    let billed = standingSystemBill(c, period);
    let energy;
    let ppaBills = [];
    let blocker = null;
    if (c.contract_type === 'PSA') {
      const sources = sourcesForPsa(c.id, period);
      if (!sources.length) blocker = 'No source PPA allocated for the month';
      const locks = sources.map((s) => ({ ppa_contract_no: s.ppa_contract_no, locked: !!lockedEnergy(s.ppa_id, period) }));
      energy = { locked: sources.length > 0 && locks.every((l) => l.locked), detail: locks };
      ppaBills = sources.map((s) => {
        const b = standingPpaBill(s.ppa_id, period);
        return { ppa_contract_no: s.ppa_contract_no, invoice_no: b?.invoice_no || null, own: b ? !String(b.invoice_breakdown_json || '').trim() : false };
      });
    } else {
      const e = lockedEnergy(c.id, period);
      energy = { locked: !!e, energy_mwh: e?.energy_mwh ?? null, data_type: e?.data_type ?? null };
      const own = db.prepare(`
        SELECT id, invoice_no, status, invoice_type, total_amount FROM invoices WHERE contract_id = ? AND billing_period = ? AND direction = 'SELLER_TO_SJVN'
          AND TRIM(COALESCE(invoice_breakdown_json, '')) = '' AND status NOT IN ('CANCELLED', 'DRAFT', 'REJECTED')
          AND COALESCE((SELECT SUM(n.amount) FROM debit_credit_notes n WHERE n.invoice_id = invoices.id AND n.note_type = 'CREDIT'
            AND n.model = 'V2' AND n.status IN ('ISSUED', 'SETTLED')), 0) < total_amount - 0.005
        ORDER BY created_at DESC LIMIT 1
      `).get(c.id, period);
      ppaBills = [{ ppa_contract_no: c.contract_no, invoice_no: own?.invoice_no || null, own: !!own, status: own?.status || null }];
      // The developer's own invoice is the PPA's bill for the month: there is
      // nothing for SJVN to raise on top of it (a computed bill would only be
      // superseded by it).
      if (!billed && own) billed = { id: own.id, invoice_no: own.invoice_no, status: own.status, invoice_type: own.invoice_type, total_amount: own.total_amount, own: true };
    }
    if (c.cod_date && String(c.cod_date).slice(0, 7) > period) blocker = `Not commissioned until ${c.cod_date}`;
    const ppaBillIn = ppaBills.length > 0 && ppaBills.every((p) => p.invoice_no);
    let state;
    if (billed) state = 'BILLED';
    else if (open) state = 'MONTH_OPEN';
    else if (blocker) state = 'BLOCKED';
    else if (!energy.locked) state = 'WAITING_ENERGY';
    else state = 'READY';
    return {
      contract_id: c.id,
      contract_no: c.contract_no,
      contract_type: c.contract_type,
      project_type: c.project_type,
      counterparty: c.contract_type === 'PSA' ? c.buyer_name : c.seller_name,
      energy,
      ppa_bill_in: ppaBillIn,
      ppa_bills: ppaBills,
      billed: billed || null,
      blocker,
      state,
      // A PSA can be billed before the developer's invoice arrives (the usual
      // order on a busy month); its back-to-back check stays open until it does.
      note: state === 'READY' && c.contract_type === 'PSA' && !ppaBillIn ? 'Source PPA bill not in yet — back-to-back check will wait for it' : null,
    };
  });

  const count = (s) => rows.filter((r) => r.state === s).length;
  return {
    period,
    month_open: open,
    last_billable_month: lastCompleteMonth(),
    totals: { contracts: rows.length, ready: count('READY'), billed: count('BILLED'), waiting_energy: count('WAITING_ENERGY'), blocked: count('BLOCKED') },
    rows,
  };
}
