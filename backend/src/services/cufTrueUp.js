import db from '../db/index.js';
import { newId, logAudit, pushNotification, billableCapacityMw } from '../util.js';
import { cufYearPosition, contractYearBounds } from './cufPenalty.js';
import { resolveTariff } from './tariffStructure.js';
import { lastCompleteMonth } from './energyRules.js';
import { supersededByDeveloperSql } from './outstanding.js';

/**
 * The year-end CUF true-up.
 *
 * CUF is assessed over the contract year (decided 17-Oct-2026), not month by
 * month. Once a contract year is over and every month of it is locked, its
 * shortfall is priced once — energy against what the commissioned capacity
 * could make over the year, at the year-end tariff (or the master rate) — and
 * settled by a CREDIT note: on a PPA, SJVN owes the generator less; on a PSA,
 * the shortfall passes through and the buyer owes SJVN less, as the monthly
 * deduction used to do on both.
 *
 * The note is raised as a DRAFT against the year's last presented bill and goes
 * through the notes desk like any other: someone other than its maker approves
 * it, and on approval it is applied against what is open on that bill, the rest
 * staying on the note as credit for the contract's other bills. One live
 * true-up per contract year.
 */

const TRUE_UP_PREFIX = 'CUF true-up';
const PRESENTED = ['APPROVED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'DISPUTED'];
const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra });

function contractYearPeriod(contract, contractYear) {
  const start = String(contract.tenure_start || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start)) return null;
  const [y, m] = start.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + (contractYear - 1) * 12, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The live true-up note already raised for a contract year, if any. */
export function existingTrueUp(contractId, contractYear) {
  return db.prepare(`
    SELECT * FROM debit_credit_notes
    WHERE contract_id = ? AND reason_code = 'LIQUIDATED_DAMAGES' AND reason LIKE ?
      AND status IN ('DRAFT', 'ISSUED', 'SETTLED')
    ORDER BY created_at DESC LIMIT 1
  `).get(contractId, `${TRUE_UP_PREFIX}, contract year ${contractYear} %`);
}

/** The bill a contract year's true-up is set against: its last presented bill. */
function anchorBill(contract, bounds) {
  const direction = contract.contract_type === 'PSA' ? 'SJVN_TO_BUYER' : 'SELLER_TO_SJVN';
  return db.prepare(`
    SELECT i.* FROM invoices i
    WHERE i.contract_id = ? AND i.direction = ? AND i.billing_period BETWEEN ? AND ?
      AND i.status IN (${PRESENTED.map(() => '?').join(',')})
      AND i.invoice_no NOT LIKE 'DSM-%' AND i.invoice_type IN ('PROVISIONAL', 'FINAL')
      AND ${supersededByDeveloperSql('i')}
    ORDER BY i.billing_period DESC, (i.invoice_type = 'FINAL') DESC, i.created_at DESC
    LIMIT 1
  `).get(contract.id, direction, bounds.year_start, bounds.year_end, ...PRESENTED);
}

/** Where a contract year stands for its true-up. */
export function trueUpPosition(contract, contractYear) {
  const periodInYear = contractYearPeriod(contract, contractYear);
  if (!periodInYear) throw err(400, `${contract.contract_no} has no tenure start, so its contract years cannot be counted.`);
  const bounds = contractYearBounds(contract, periodInYear);
  const position = cufYearPosition(contract, bounds.year_end, {
    upTo: lastCompleteMonth(),
    capacityMw: billableCapacityMw(contract),
    tariffPerUnit: resolveTariff(contract, bounds.year_end).rate || contract.tariff_per_unit,
  });
  const note = existingTrueUp(contract.id, contractYear);
  const anchor = anchorBill(contract, bounds);
  let state;
  if (!position.applicable) state = 'NOT_APPLICABLE';
  else if (!position.year_over) state = 'IN_PROGRESS';
  else if (!position.complete) state = 'AWAITING_ENERGY';
  else if (!position.penalty) state = 'MET';
  else if (note) state = 'NOTE_RAISED';
  else state = 'DUE';
  return {
    ...position,
    contract_id: contract.id,
    contract_no: contract.contract_no,
    contract_type: contract.contract_type,
    state,
    note: note ? { id: note.id, note_no: note.note_no, status: note.status, amount: note.amount } : null,
    anchor_invoice: anchor ? { id: anchor.id, invoice_no: anchor.invoice_no, billing_period: anchor.billing_period, status: anchor.status } : null,
  };
}

/** Raise the year's true-up credit note as a DRAFT for approval. */
export function raiseTrueUp({ contractId, contractYear, user, req = null }) {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  if (!contract) throw err(404, 'Contract not found');
  const year = Number(contractYear);
  if (!Number.isInteger(year) || year < 1) throw err(400, 'contract_year must be a whole number from 1');
  const pos = trueUpPosition(contract, year);
  const span = `${pos.year_start} → ${pos.year_end}`;
  if (pos.state === 'NOT_APPLICABLE') throw err(400, `${contract.contract_no} is ${contract.project_type}: it carries no CUF obligation.`);
  if (pos.state === 'IN_PROGRESS') throw err(400, `Contract year ${year} (${span}) is not over yet; it is assessed once ${pos.year_end} is.`);
  if (pos.state === 'AWAITING_ENERGY') {
    throw err(400, `Contract year ${year} cannot be assessed until every month is locked. Not locked: ${pos.months_missing.join(', ')}.`, { months_missing: pos.months_missing });
  }
  if (pos.state === 'MET') throw err(400, `${contract.contract_no} met its CUF for contract year ${year}: ${pos.cuf_percent}% against ${pos.min_cuf_percent}%. Nothing to true up.`);
  if (pos.state === 'NOTE_RAISED') throw err(409, `The true-up for contract year ${year} is already raised — ${pos.note.note_no} (${pos.note.status}).`);
  if (!pos.anchor_invoice) throw err(400, `No bill was presented on ${contract.contract_no} in contract year ${year} (${span}) to set the credit against.`);

  const anchor = db.prepare('SELECT * FROM invoices WHERE id = ?').get(pos.anchor_invoice.id);
  const reason = `${TRUE_UP_PREFIX}, contract year ${year} (${span}): CUF ${pos.cuf_percent}% against the minimum ${pos.min_cuf_percent}% `
    + `on ${pos.possible_mwh.toLocaleString('en-IN')} MWh possible — ${pos.shortfall_mwh.toLocaleString('en-IN')} MWh short × ₹${pos.rate_per_mwh.toLocaleString('en-IN')}/MWh`;
  const id = newId('DCN');
  db.prepare(`
    INSERT INTO debit_credit_notes (id, note_no, note_type, invoice_id, contract_id, period_month,
      reason_code, amount, taxable_amount, tax_amount, reason, status, model, created_by, created_by_id)
    VALUES (?, ?, 'CREDIT', ?, ?, ?, 'LIQUIDATED_DAMAGES', ?, ?, 0, ?, 'DRAFT', 'V2', ?, ?)
  `).run(id, `DRAFT-${id}`, anchor.id, contract.id, pos.year_end, pos.penalty, pos.penalty, reason, user.name, user.id || null);
  // The note may exceed the bill it is set against: on approval it is applied up
  // to what is open there, and the rest stays on the note for the contract's
  // other bills — a year's shortfall is not capped at one month's bill.
  logAudit({
    req, user, action: 'RAISE_CUF_TRUE_UP', module: 'REIA', entityType: 'debit_credit_note', entityId: id,
    details: { contract_no: contract.contract_no, contract_year: year, cuf_percent: pos.cuf_percent, min_cuf_percent: pos.min_cuf_percent, shortfall_mwh: pos.shortfall_mwh, amount: pos.penalty, invoice_no: anchor.invoice_no },
  });
  pushNotification({ role: 'FINANCE_USER', type: 'DC_NOTE_FOR_APPROVAL', message: `CUF true-up credit note of Rs.${pos.penalty.toLocaleString('en-IN')} on ${contract.contract_no} (contract year ${year}) awaits approval` });
  return { ...trueUpPosition(contract, year), raised_note_id: id };
}
