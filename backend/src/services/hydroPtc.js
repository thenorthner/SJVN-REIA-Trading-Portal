/**
 * Power trading bills raised off a hydro station.
 *
 * A trading bill is a different animal from a tariff bill: there is no
 * availability, no design energy and no beneficiary allocation. SJVN sells a
 * quantum to one exchange counterparty over a date range, and what it is owed
 * is what the sale grossed less what the trade cost:
 *
 *   net = gross sale - trading expense
 *
 * Everything after the bill is raised — release, despatch, the beneficiary
 * account, payments, reversals — is the machinery the tariff bills already use,
 * so a trading bill is a hydro_station_bills row of kind PTC with one line for
 * the counterparty, and only the trade's own figures live in hydro_ptc_bills.
 */
import db from '../db/index.js';
import { newId, genInvoiceNo } from '../util.js';
import { financialYearOf } from './hydroStationBill.js';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const kwh = (v) => Math.round((Number(v) || 0) * 10) / 10;

/**
 * What the trade nets out to.
 *
 * Separate from raising the bill so the desk can see the figure before it
 * commits to one — the manual's "consolidate" step, which computes the net and
 * changes nothing.
 */
export function consolidate({ grossSale, tradingExpense }) {
  const gross = money(grossSale);
  const expense = money(tradingExpense ?? 0);

  if (!Number.isFinite(gross) || gross <= 0) {
    throw Object.assign(new Error('gross_sale must be a positive figure'), { status: 400 });
  }
  if (!Number.isFinite(expense) || expense < 0) {
    throw Object.assign(new Error('trading_expense cannot be negative'), { status: 400 });
  }
  // An expense larger than the sale would make the counterparty owe nothing and
  // SJVN owe them, which a sale bill cannot express — it is a loss to be
  // settled another way, not a bill to be raised.
  if (expense > gross) {
    throw Object.assign(
      new Error(`Trading expense (${expense}) exceeds the gross sale (${gross}) — this trade made a loss and cannot be billed as a sale`),
      { status: 400 },
    );
  }
  return { gross_sale: gross, trading_expense: expense, net_amount: money(gross - expense) };
}

/** Raise the trading bill. */
export function createPtcBill({
  contract, billingMonth, exchangeBeneficiary, fromDate, toDate, dueDate = null,
  energyKwh = 0, grossSale, tradingExpense = 0, remarks = null,
  preparedBy = null, createdBy = null,
}) {
  if (!/^\d{4}-\d{2}$/.test(String(billingMonth || ''))) {
    throw Object.assign(new Error('billing_month must be YYYY-MM'), { status: 400 });
  }
  if (!exchangeBeneficiary) {
    throw Object.assign(new Error('exchange_beneficiary is required'), { status: 400 });
  }
  if (!fromDate || !toDate) {
    throw Object.assign(new Error('from_date and to_date are required'), { status: 400 });
  }
  if (toDate < fromDate) {
    throw Object.assign(
      new Error(`The trade cannot end on ${toDate}, before it began on ${fromDate}`),
      { status: 400 },
    );
  }
  if (dueDate && dueDate < toDate) {
    throw Object.assign(
      new Error(`Payment cannot fall due on ${dueDate}, before the trade ends on ${toDate}`),
      { status: 400 },
    );
  }

  const calc = consolidate({ grossSale, tradingExpense });
  const energy = kwh(energyKwh);
  if (energy < 0) throw Object.assign(new Error('energy cannot be negative'), { status: 400 });

  let billNo = genInvoiceNo('HPTC');
  for (let i = 0; i < 10 && db.prepare('SELECT 1 FROM hydro_station_bills WHERE bill_no = ?').get(billNo); i += 1) {
    billNo = genInvoiceNo('HPTC');
  }

  const id = newId('HSB');
  db.transaction(() => {
    db.prepare(`
      INSERT INTO hydro_station_bills (
        id, bill_no, contract_id, station_name, billing_month, financial_year,
        bill_kind, rea_reference, revision_reason, due_date,
        a1_afc, a2_design_energy_mwh, a3_aux_pct, a4_fehs_pct,
        a5_ex_bus_design_energy_mwh, a6_ex_bus_saleable_design_energy_mwh,
        a7_installed_capacity_mw, a8_days_in_month, a9_days_in_year, a11_napaf_pct,
        a12_ecr, a13_ecr_excess,
        c1_pafm_pct, c2_capacity_charge, c3_beta_factor, c4_beta_incentive, c5_total_capacity_charge,
        e1_ex_bus_scheduled_kwh, e2_free_power_kwh, e3_saleable_scheduled_kwh,
        e4_cum_scheduled_kwh, e5_cum_free_power_kwh, e6_cum_saleable_kwh,
        e7_excess_kwh, e8_upto_design_kwh, urs_nr_kwh,
        ee1_energy_charge, ee2_excess_energy_charge, total_charges, nrldc_total_fee,
        prepared_by, created_by
      ) VALUES (
        ?, ?, ?, ?, ?, ?, 'PTC', ?, ?, ?,
        0, 0, 0, 0, 0, 0, ?, 0, 0, 0, 0, 0,
        0, 0, NULL, 0, 0,
        ?, 0, ?, 0, 0, 0, 0, ?, 0,
        0, 0, ?, 0,
        ?, ?
      )
    `).run(
      id, billNo, contract.id, contract.station_name || contract.contract_no,
      billingMonth, financialYearOf(billingMonth),
      `Trade ${fromDate} to ${toDate}`,
      remarks || `Power traded to ${exchangeBeneficiary}`,
      dueDate,
      contract.capacity_mw ?? null,
      // The traded quantum is the energy on this bill; there is no free power
      // and no design-energy cap on a trade, so E3 and E8 are simply the same.
      energy, energy, energy,
      calc.net_amount,
      preparedBy, createdBy,
    );

    // One line, for the counterparty. Nothing is apportioned: a trade is with
    // one party, not with the station's beneficiaries.
    db.prepare(`
      INSERT INTO hydro_bill_lines (
        id, bill_id, sr_no, beneficiary_name, beneficiary_id, parent_state,
        pct_incl_free, pct_rea, pct_excl_free, pct_proportionate,
        capacity_charge, saleable_energy_kwh, energy_upto_design_kwh, energy_excess_kwh,
        actual_scheduled_energy_kwh, deducted_scheduled_energy_kwh, is_regulated,
        energy_charge_upto, energy_charge_excess, energy_charge_total, nrldc_fee, total_charges
      ) VALUES (?, ?, 1, ?, NULL, NULL, NULL, 100, 100, 100, 0, ?, ?, 0, ?, 0, 0, ?, 0, ?, 0, ?)
    `).run(
      newId('HBL'), id, exchangeBeneficiary,
      energy, energy, energy,
      calc.net_amount, calc.net_amount, calc.net_amount,
    );

    db.prepare(`
      INSERT INTO hydro_ptc_bills (
        id, bill_id, contract_id, exchange_beneficiary, from_date, to_date, due_date,
        energy_kwh, gross_sale, trading_expense, net_amount, remarks, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId('HPT'), id, contract.id, exchangeBeneficiary, fromDate, toDate, dueDate,
      energy, calc.gross_sale, calc.trading_expense, calc.net_amount, remarks, createdBy,
    );
  })();

  return {
    id,
    bill_no: billNo,
    bill_kind: 'PTC',
    billing_month: billingMonth,
    exchange_beneficiary: exchangeBeneficiary,
    from_date: fromDate,
    to_date: toDate,
    due_date: dueDate,
    energy_kwh: energy,
    ...calc,
  };
}

/** Trading bills raised on a station, newest first. */
export function listPtcBills(contractId, { billingMonth = null } = {}) {
  return db.prepare(`
    SELECT p.*, b.bill_no, b.billing_month, b.status, b.approval_status,
           b.released_at, b.dispatched_at, b.total_charges
    FROM hydro_ptc_bills p
    JOIN hydro_station_bills b ON b.id = p.bill_id
    WHERE p.contract_id = ? AND (? IS NULL OR b.billing_month = ?)
    ORDER BY p.from_date DESC, p.created_at DESC
  `).all(contractId, billingMonth, billingMonth);
}
