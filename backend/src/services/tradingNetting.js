// Netting a trading client's receivables against what SJVN owes the same client.
//
// The desk used to type two totals into a form and the server wrote the
// difference into the client's ledger as a new debit or credit. Nothing tied
// either figure to a bill, the same period could be netted twice, and a net
// receivable was debited on top of the invoices already debited for it — the
// client came out owing the same money twice.
//
// Both sides are read from records now. What the client owes is the unpaid
// balance of its issued bills for the period. What SJVN owes it is the proceeds
// of its Seller exchange contracts cleared in that period, less the desk's
// margin — the same settlement the exchange energy bill is priced from. The
// smaller of the two is set off: allocated to the bills oldest first as
// SET_OFF payments, so each bill shows what cleared it, and credited to the
// ledger for the bills the ledger carries.
//
// Bilateral seller proceeds are not netted here. A bilateral transaction does
// not record which side of it a trading client is on, so there is no record to
// read the payable from — the preview says so rather than leaving it out quietly.

import db from '../db/index.js';
import { newId } from '../util.js';
import { computeExchangeSettlement } from './exchangeSettlement.js';

const OPEN_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE'];
const SET_OFF_MODE = 'SET_OFF';
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export class NettingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function periodBounds(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || ''))) {
    throw new NettingError(400, 'period must be a month, YYYY-MM');
  }
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

const referenceFor = (period) => `NET-${period}`;

/** What would be set off for a client and month — reads, writes nothing. */
export function nettingPosition({ client_id, period }) {
  const client = db.prepare('SELECT id, name FROM trading_clients WHERE id = ?').get(client_id);
  if (!client) throw new NettingError(404, 'Trading client not found');
  const { from, to } = periodBounds(period);

  const bills = db.prepare(`
    SELECT i.id, i.invoice_no, i.invoice_kind, i.status, i.total_amount, i.net_payable, i.created_at,
           COALESCE((SELECT SUM(p.amount) FROM trading_payments p WHERE p.trading_invoice_id = i.id), 0) AS paid,
           EXISTS (SELECT 1 FROM client_ledgers l WHERE l.reference_id = i.id AND l.transaction_type = 'INVOICE') AS on_ledger
    FROM trading_invoices i
    WHERE i.client_id = ? AND i.billing_period = ?
    ORDER BY i.created_at, i.rowid
  `).all(client.id, period);

  const open = bills
    .filter((b) => OPEN_STATUSES.includes(b.status))
    .map((b) => {
      // A bill is settled at net_payable: the client remits net of TDS.
      const due = b.net_payable != null ? b.net_payable : b.total_amount;
      return {
        invoice_id: b.id, invoice_no: b.invoice_no, invoice_kind: b.invoice_kind, status: b.status,
        due: round2(due), paid: round2(b.paid), outstanding: round2(due - b.paid), on_ledger: Boolean(b.on_ledger),
      };
    })
    .filter((b) => b.outstanding > 0);

  const contracts = db.prepare(`
    SELECT id, loa_no, product, start_date, end_date FROM exchange_contracts
    WHERE client_id = ? AND side = 'Seller' AND status != 'CANCELLED'
      AND start_date <= ? AND end_date >= ?
    ORDER BY start_date
  `).all(client.id, to, from);

  const payables = contracts.map((c) => {
    const s = computeExchangeSettlement({
      contract_id: c.id,
      from: c.start_date > from ? c.start_date : from,
      to: c.end_date < to ? c.end_date : to,
    });
    return {
      contract_id: c.id,
      loa_no: c.loa_no,
      product: c.product,
      cleared_mwh: s.cleared.cleared_mwh,
      energy_value: round2(s.money.energy_value),
      margin_retained: round2(s.money.trading_margin),
      // On a Seller contract the client's position is the proceeds less margin.
      amount: round2(s.money.client_energy_position),
      warnings: s.warnings,
    };
  }).filter((p) => p.amount > 0);

  const receivable = round2(open.reduce((a, b) => a + b.outstanding, 0));
  const payable = round2(payables.reduce((a, p) => a + p.amount, 0));
  const setOff = round2(Math.min(receivable, payable));

  const done = db.prepare(`
    SELECT p.reference, MIN(p.payment_date) AS netted_on, ROUND(SUM(p.amount), 2) AS amount
    FROM trading_payments p JOIN trading_invoices i ON i.id = p.trading_invoice_id
    WHERE i.client_id = ? AND p.mode = ? AND p.reference = ?
    GROUP BY p.reference
  `).get(client.id, SET_OFF_MODE, referenceFor(period));

  return {
    client_id: client.id,
    client_name: client.name,
    period,
    reference: referenceFor(period),
    receivable: { total: receivable, invoices: open, drafts_not_counted: bills.filter((b) => b.status === 'DRAFT').length },
    payable: { total: payable, contracts: payables },
    set_off: setOff,
    after: { client_owes: round2(receivable - setOff), sjvn_owes: round2(payable - setOff) },
    already_netted: done || null,
    not_included: 'Bilateral seller proceeds: a bilateral transaction does not record which side the client is on.',
  };
}

/** Set off the smaller side against the bills, once per client and month. */
export function applyNetting({ client_id, period, today = new Date().toISOString().slice(0, 10) }) {
  const position = nettingPosition({ client_id, period });
  if (position.already_netted) {
    throw new NettingError(409, `${position.client_name} was already netted for ${period} on ${position.already_netted.netted_on} (₹${position.already_netted.amount}).`);
  }
  if (!(position.set_off > 0)) {
    throw new NettingError(422, position.receivable.total <= 0
      ? `${position.client_name} has no unpaid issued bill for ${period} to set off.`
      : `SJVN owes ${position.client_name} nothing for ${period} on a Seller exchange contract, so there is nothing to set off.`);
  }

  const insertPayment = db.prepare(`
    INSERT INTO trading_payments (id, trading_invoice_id, amount, payment_date, mode, reference) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const setStatus = db.prepare('UPDATE trading_invoices SET status = ? WHERE id = ?');
  const allocations = [];

  db.transaction(() => {
    let remaining = position.set_off;
    for (const bill of position.receivable.invoices) {
      if (remaining <= 0) break;
      const take = round2(Math.min(remaining, bill.outstanding));
      insertPayment.run(newId('TPY'), bill.invoice_id, take, today, SET_OFF_MODE, position.reference);
      const status = bill.paid + take >= bill.due - 0.005 ? 'PAID' : 'PARTIALLY_PAID';
      setStatus.run(status, bill.invoice_id);
      allocations.push({ invoice_id: bill.invoice_id, invoice_no: bill.invoice_no, amount: take, status, on_ledger: bill.on_ledger });
      remaining = round2(remaining - take);
    }

    // The ledger carries only the bills posted to it, so it is credited for those.
    const ledgerCredit = round2(allocations.filter((a) => a.on_ledger).reduce((s, a) => s + a.amount, 0));
    if (ledgerCredit > 0) {
      const last = db.prepare(`
        SELECT running_balance FROM client_ledgers WHERE client_id = ? ORDER BY timestamp DESC, rowid DESC LIMIT 1
      `).get(position.client_id)?.running_balance || 0;
      db.prepare(`
        INSERT INTO client_ledgers (id, client_id, transaction_type, reference_id, credit, debit, running_balance, description, timestamp)
        VALUES (?, ?, 'SET_OFF', ?, ?, 0, ?, ?, datetime('now'))
      `).run(
        newId('CLG'), position.client_id, position.reference, ledgerCredit, round2(last - ledgerCredit),
        `Set-off for ${period} against Seller exchange proceeds (${allocations.map((a) => a.invoice_no).join(', ')})`,
      );
    }
  })();

  return { ...position, allocations };
}
