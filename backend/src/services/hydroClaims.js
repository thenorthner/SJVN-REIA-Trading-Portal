/**
 * Claims a hydro station raises besides its monthly energy bill.
 *
 * Two kinds, and they are shaped quite differently:
 *
 *   ADDITIONAL  auxiliary consumption beyond the normative allowance, foreign
 *               exchange rate variation, and similar tariff-order items. They
 *               accrue month by month as entries and are then claimed together
 *               on one bill, apportioned across the beneficiaries the same way
 *               capacity charges are — because they are a cost of the station,
 *               not of any one party's energy.
 *
 *   TCS         tax collected at source. Charged on money actually received
 *               from one beneficiary, so it is never apportioned: the claim is
 *               against that beneficiary alone and carries the receipt it was
 *               computed on.
 *
 * Both become rows in hydro_station_bills so they inherit the whole lifecycle
 * already built around it — approval, release, print, despatch, ledger posting
 * and payment — rather than growing a parallel one that would drift from it.
 */
import db from '../db/index.js';
import { newId, genInvoiceNo } from '../util.js';
import { getAllocations, apportion, financialYearOf } from './hydroStationBill.js';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

export const CHARGE_TYPES = ['AUX_CONSUMPTION', 'FERV', 'OTHER'];

export const CHARGE_TYPE_LABELS = {
  AUX_CONSUMPTION: 'Auxiliary consumption beyond the normative allowance',
  FERV: 'Foreign exchange rate variation',
  OTHER: 'Other charges permitted by the tariff order',
};

/** A bill number that is free, so the UNIQUE index cannot bite on insert. */
function freeBillNo(prefix) {
  let no = genInvoiceNo(prefix);
  for (let i = 0; i < 10 && db.prepare('SELECT 1 FROM hydro_station_bills WHERE bill_no = ?').get(no); i += 1) {
    no = genInvoiceNo(prefix);
  }
  return no;
}

/**
 * The columns a claim bill has to fill that only a monthly bill really uses.
 *
 * A claim has no availability, no design energy and no energy charge rate, and
 * saying so with zeroes is honest: bill_kind already says what the row is, and
 * the printed claim never shows the A, C or E blocks.
 */
function emptyBillBlocks(contract) {
  return {
    a1_afc: 0, a2_design_energy_mwh: 0, a3_aux_pct: 0,
    a4_fehs_pct: Number(contract.free_energy_home_state) || 0,
    a5_ex_bus_design_energy_mwh: 0, a6_ex_bus_saleable_design_energy_mwh: 0,
    a7_installed_capacity_mw: contract.capacity_mw ?? null,
    a8_days_in_month: 0, a9_days_in_year: 0, a11_napaf_pct: 0,
    a12_ecr: 0, a13_ecr_excess: 0,
    c1_pafm_pct: 0, c2_capacity_charge: 0, c3_beta_factor: null,
    c4_beta_incentive: 0, c4_beta_note: null, c5_total_capacity_charge: 0,
    e1_ex_bus_scheduled_kwh: 0, e2_free_power_kwh: 0, e3_saleable_scheduled_kwh: 0,
    e4_cum_scheduled_kwh: 0, e5_cum_free_power_kwh: 0, e6_cum_saleable_kwh: 0,
    e7_excess_kwh: 0, e8_upto_design_kwh: 0, urs_nr_kwh: 0,
    ee1_energy_charge: 0, ee2_excess_energy_charge: 0, nrldc_total_fee: 0,
  };
}

const INSERT_BILL = `
  INSERT INTO hydro_station_bills (
    id, bill_no, contract_id, station_name, billing_month, financial_year,
    bill_kind, rea_reference, revision_reason,
    a1_afc, a2_design_energy_mwh, a3_aux_pct, a4_fehs_pct,
    a5_ex_bus_design_energy_mwh, a6_ex_bus_saleable_design_energy_mwh,
    a7_installed_capacity_mw, a8_days_in_month, a9_days_in_year, a11_napaf_pct,
    a12_ecr, a13_ecr_excess,
    c1_pafm_pct, c2_capacity_charge, c3_beta_factor, c4_beta_incentive, c4_beta_note,
    c5_total_capacity_charge,
    e1_ex_bus_scheduled_kwh, e2_free_power_kwh, e3_saleable_scheduled_kwh,
    e4_cum_scheduled_kwh, e5_cum_free_power_kwh, e6_cum_saleable_kwh,
    e7_excess_kwh, e8_upto_design_kwh, urs_nr_kwh,
    ee1_energy_charge, ee2_excess_energy_charge, total_charges, nrldc_total_fee,
    prepared_by, created_by
  ) VALUES (
    @id, @bill_no, @contract_id, @station_name, @billing_month, @financial_year,
    @bill_kind, @rea_reference, @revision_reason,
    @a1_afc, @a2_design_energy_mwh, @a3_aux_pct, @a4_fehs_pct,
    @a5_ex_bus_design_energy_mwh, @a6_ex_bus_saleable_design_energy_mwh,
    @a7_installed_capacity_mw, @a8_days_in_month, @a9_days_in_year, @a11_napaf_pct,
    @a12_ecr, @a13_ecr_excess,
    @c1_pafm_pct, @c2_capacity_charge, @c3_beta_factor, @c4_beta_incentive, @c4_beta_note,
    @c5_total_capacity_charge,
    @e1_ex_bus_scheduled_kwh, @e2_free_power_kwh, @e3_saleable_scheduled_kwh,
    @e4_cum_scheduled_kwh, @e5_cum_free_power_kwh, @e6_cum_saleable_kwh,
    @e7_excess_kwh, @e8_upto_design_kwh, @urs_nr_kwh,
    @ee1_energy_charge, @ee2_excess_energy_charge, @total_charges, @nrldc_total_fee,
    @prepared_by, @created_by
  )
`;

/**
 * A claim's beneficiary line.
 *
 * The amount sits in total_charges alone: an additional charge is neither a
 * capacity charge nor an energy charge, and writing it into one of those would
 * make it add up twice for anything that sums the two. Named parameters,
 * because a positional list of twenty-two columns is a miscount waiting to
 * happen.
 */
const INSERT_LINE = `
  INSERT INTO hydro_bill_lines (
    id, bill_id, sr_no, beneficiary_name, beneficiary_id, parent_state,
    pct_incl_free, pct_rea, pct_excl_free, pct_proportionate,
    capacity_charge, saleable_energy_kwh, energy_upto_design_kwh, energy_excess_kwh,
    actual_scheduled_energy_kwh, deducted_scheduled_energy_kwh, is_regulated,
    energy_charge_upto, energy_charge_excess, energy_charge_total, nrldc_fee, total_charges
  ) VALUES (
    @id, @bill_id, @sr_no, @beneficiary_name, @beneficiary_id, @parent_state,
    @pct_incl_free, @pct_rea, @pct_excl_free, @pct_proportionate,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, @total_charges
  )
`;

// ─────────────────────────────────────────────────────────────────────────────
// Additional charges
// ─────────────────────────────────────────────────────────────────────────────

/** Record a charge the station will claim later. */
export function addCharge({
  contractId, chargeType, periodMonth, amount, remarks = null, createdBy = null,
}) {
  if (!CHARGE_TYPES.includes(chargeType)) {
    throw Object.assign(new Error(`charge_type must be one of ${CHARGE_TYPES.join(', ')}`), { status: 400 });
  }
  if (!/^\d{4}-\d{2}$/.test(String(periodMonth || ''))) {
    throw Object.assign(new Error('period_month must be YYYY-MM'), { status: 400 });
  }
  const amt = money(amount);
  // A negative entry is how a credit is issued — an over-charge in an earlier
  // month is netted off the next claim rather than reversed out of a paid bill.
  if (!Number.isFinite(amt) || amt === 0) {
    throw Object.assign(new Error('amount must be a non-zero figure'), { status: 400 });
  }

  const id = newId('HAC');
  db.prepare(`
    INSERT INTO hydro_additional_charges
      (id, contract_id, charge_type, period_month, amount, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, contractId, chargeType, periodMonth, amt, remarks, createdBy);
  return db.prepare('SELECT * FROM hydro_additional_charges WHERE id = ?').get(id);
}

/** Entries not yet claimed on a bill, oldest month first. */
export function unclaimedCharges(contractId, { upToMonth = null } = {}) {
  const rows = db.prepare(`
    SELECT * FROM hydro_additional_charges
    WHERE contract_id = ? AND claimed_bill_id IS NULL
      AND (? IS NULL OR period_month <= ?)
    ORDER BY period_month, created_at
  `).all(contractId, upToMonth, upToMonth);
  return rows.map((r) => ({ ...r, charge_type_label: CHARGE_TYPE_LABELS[r.charge_type] }));
}

/**
 * Claim the outstanding entries on a bill of their own.
 *
 * The total is apportioned on the same proportionate percentage the capacity
 * charge uses: these are costs of running the station, so they fall where the
 * station's fixed costs fall rather than following anybody's energy.
 */
export function claimAdditionalCharges({
  contract, billingMonth, chargeIds = null, billDate = null, remarks = null,
  preparedBy = null, createdBy = null,
}) {
  if (!/^\d{4}-\d{2}$/.test(String(billingMonth || ''))) {
    throw Object.assign(new Error('billing_month must be YYYY-MM'), { status: 400 });
  }
  let entries = unclaimedCharges(contract.id, { upToMonth: billingMonth });
  if (chargeIds?.length) {
    const wanted = new Set(chargeIds);
    entries = entries.filter((e) => wanted.has(e.id));
    const missing = chargeIds.filter((id) => !entries.some((e) => e.id === id));
    if (missing.length) {
      throw Object.assign(
        new Error(`${missing.length} of the entries asked for are already claimed or do not belong to this station`),
        { status: 400 },
      );
    }
  }
  if (!entries.length) {
    throw Object.assign(
      new Error(`${contract.contract_no} has no unclaimed additional charges up to ${billingMonth}`),
      { status: 400 },
    );
  }

  const total = money(entries.reduce((a, e) => a + Number(e.amount), 0));
  if (total === 0) {
    throw Object.assign(
      new Error('The selected entries net to zero — there is nothing to claim'),
      { status: 400 },
    );
  }

  const allocations = getAllocations(contract.id, billingMonth, Number(contract.free_energy_home_state) || 0);
  if (!allocations.length) {
    throw Object.assign(new Error('No beneficiary allocation is in force for this station and month'), { status: 400 });
  }
  const shares = apportion(total, allocations.map((a) => Number(a.pct_proportionate)));

  const id = newId('HSB');
  const billNo = freeBillNo('HAC');
  const blocks = emptyBillBlocks(contract);
  const byType = entries.reduce((m, e) => {
    m[e.charge_type] = money((m[e.charge_type] || 0) + Number(e.amount));
    return m;
  }, {});
  const summary = Object.entries(byType)
    .map(([t, v]) => `${CHARGE_TYPE_LABELS[t]}: ${v}`)
    .join('; ');

  db.transaction(() => {
    db.prepare(INSERT_BILL).run({
      id,
      bill_no: billNo,
      contract_id: contract.id,
      station_name: contract.station_name || contract.contract_no,
      billing_month: billingMonth,
      financial_year: financialYearOf(billingMonth),
      bill_kind: 'ADDITIONAL',
      rea_reference: billDate ? `Claim raised ${billDate}` : null,
      revision_reason: remarks || summary,
      ...blocks,
      total_charges: total,
      prepared_by: preparedBy,
      created_by: createdBy,
    });

    const insertLine = db.prepare(INSERT_LINE);
    allocations.forEach((a, i) => {
      insertLine.run({
        id: newId('HBL'),
        bill_id: id,
        sr_no: a.sr_no || i + 1,
        beneficiary_name: a.beneficiary_name,
        beneficiary_id: a.beneficiary_id || null,
        parent_state: a.parent_state || null,
        pct_incl_free: a.pct_incl_free ?? null,
        pct_rea: a.pct_rea,
        pct_excl_free: a.pct_excl_free,
        pct_proportionate: a.pct_proportionate,
        total_charges: shares[i],
      });
    });

    const mark = db.prepare(
      `UPDATE hydro_additional_charges SET claimed_bill_id = ?, claimed_at = datetime('now'),
       updated_at = datetime('now') WHERE id = ?`,
    );
    for (const e of entries) mark.run(id, e.id);
  })();

  return {
    id,
    bill_no: billNo,
    bill_kind: 'ADDITIONAL',
    billing_month: billingMonth,
    total_charges: total,
    entries_claimed: entries.length,
    by_charge_type: byType,
    lines: allocations.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TCS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tax collected at source on money received from one beneficiary.
 *
 * The applicable amount defaults to what was received, because that is the
 * usual basis; where the tariff order makes only part of a receipt liable, the
 * desk states that part and the rate applies to it alone.
 */
export function computeTcs({ amountReceived, tcsApplicableAmount, tcsRatePct }) {
  const received = money(amountReceived);
  const base = tcsApplicableAmount == null || tcsApplicableAmount === ''
    ? received : money(tcsApplicableAmount);
  const rate = Number(tcsRatePct);

  if (!(received > 0)) throw Object.assign(new Error('amount_received must be a positive figure'), { status: 400 });
  if (!(base > 0)) throw Object.assign(new Error('The TCS applicable amount must be a positive figure'), { status: 400 });
  if (base > received) {
    throw Object.assign(
      new Error(`The TCS applicable amount (${base}) cannot exceed the amount received (${received})`),
      { status: 400 },
    );
  }
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
    throw Object.assign(new Error('tcs_rate_pct must be between 0 and 100'), { status: 400 });
  }
  return { amount_received: received, tcs_applicable_amount: base, tcs_rate_pct: rate, tcs_amount: money((base * rate) / 100) };
}

/** Raise a TCS claim against one beneficiary, as its own bill. */
export function claimTcs({
  contract, beneficiaryName, billingMonth, paymentDate = null,
  amountReceived, tcsApplicableAmount = null, tcsRatePct,
  remarks = null, preparedBy = null, createdBy = null,
}) {
  if (!beneficiaryName) throw Object.assign(new Error('beneficiary is required'), { status: 400 });
  if (!/^\d{4}-\d{2}$/.test(String(billingMonth || ''))) {
    throw Object.assign(new Error('billing_month must be YYYY-MM'), { status: 400 });
  }

  // The beneficiary has to be one of this station's, or the claim lands on an
  // account that will never see it.
  const allocations = getAllocations(contract.id, billingMonth, Number(contract.free_energy_home_state) || 0);
  const alloc = allocations.find((a) => a.beneficiary_name === beneficiaryName);
  if (!alloc) {
    throw Object.assign(
      new Error(`${beneficiaryName} is not a beneficiary of ${contract.contract_no} for ${billingMonth}`),
      { status: 400 },
    );
  }

  const calc = computeTcs({ amountReceived, tcsApplicableAmount, tcsRatePct });

  const id = newId('HSB');
  const billNo = freeBillNo('HTCS');
  const blocks = emptyBillBlocks(contract);

  db.transaction(() => {
    db.prepare(INSERT_BILL).run({
      id,
      bill_no: billNo,
      contract_id: contract.id,
      station_name: contract.station_name || contract.contract_no,
      billing_month: billingMonth,
      financial_year: financialYearOf(billingMonth),
      bill_kind: 'TCS',
      rea_reference: paymentDate ? `Against payment received ${paymentDate}` : null,
      revision_reason: remarks
        || `TCS at ${calc.tcs_rate_pct}% on ${calc.tcs_applicable_amount} received from ${beneficiaryName}`,
      ...blocks,
      total_charges: calc.tcs_amount,
      prepared_by: preparedBy,
      created_by: createdBy,
    });

    // One line only: TCS is not apportioned, so the claim shows the one party
    // it is against rather than the whole station.
    db.prepare(INSERT_LINE).run({
      id: newId('HBL'),
      bill_id: id,
      sr_no: 1,
      beneficiary_name: beneficiaryName,
      beneficiary_id: alloc.beneficiary_id || null,
      parent_state: alloc.parent_state || null,
      pct_incl_free: alloc.pct_incl_free ?? null,
      pct_rea: alloc.pct_rea,
      pct_excl_free: alloc.pct_excl_free,
      pct_proportionate: alloc.pct_proportionate,
      total_charges: calc.tcs_amount,
    });

    db.prepare(`
      INSERT INTO hydro_tcs_claims
        (id, contract_id, bill_id, beneficiary_name, beneficiary_id, period_month,
         payment_date, amount_received, tcs_applicable_amount, tcs_rate_pct, tcs_amount,
         remarks, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId('HTC'), contract.id, id, beneficiaryName, alloc.beneficiary_id || null,
      billingMonth, paymentDate, calc.amount_received, calc.tcs_applicable_amount,
      calc.tcs_rate_pct, calc.tcs_amount, remarks, createdBy,
    );
  })();

  return { id, bill_no: billNo, bill_kind: 'TCS', beneficiary_name: beneficiaryName, ...calc };
}

/** TCS claimed on a station, newest first. */
export function listTcsClaims(contractId, { periodMonth = null } = {}) {
  return db.prepare(`
    SELECT t.*, b.bill_no, b.status, b.approval_status
    FROM hydro_tcs_claims t
    LEFT JOIN hydro_station_bills b ON b.id = t.bill_id
    WHERE t.contract_id = ? AND (? IS NULL OR t.period_month = ?)
    ORDER BY t.created_at DESC
  `).all(contractId, periodMonth, periodMonth);
}
