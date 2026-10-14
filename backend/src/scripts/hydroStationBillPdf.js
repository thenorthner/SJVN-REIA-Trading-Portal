/**
 * The printed hydro station bill — the document SJVN's Commercial & System
 * Operation Department despatches to the beneficiaries.
 *
 * It is four sheets, and the order is the order the desk reads them in:
 *
 *   1  the station's own charges, block by block (A, C, E, EE)
 *   2  the weighted average capacity allocation the charges were split on
 *   3  the NRLDC fees POSOCO levied, passed through beneficiary by beneficiary
 *   4  the beneficiary-wise breakup of capacity and energy charges
 *
 * Sheet 4 is the one a beneficiary checks first and the one it disputes, so the
 * columns are laid out exactly as the issued bill lays them out — including the
 * A/B/C..I column letters, which is how a query about "column H" is phrased.
 */
import {
  M, CONTENT_W, NAVY, INK, MUTED,
  roundedRect, header, sectionTitle, table, notes, pageNumbers, newDoc,
} from './reportPdfKit.js';

const n1 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 }));
const n3 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
const pct6 = (v) => (v == null ? '—' : `${Number(v).toFixed(6)}`);
const money0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

/**
 * One line of a block: its code, what it means, and its value.
 *
 * The code column is narrow and fixed because the codes are what the bill is
 * argued in — "A12 is wrong", not "the energy charge rate is wrong".
 */
function blockRows(doc, y, ctx, rows) {
  return table(doc, y, [
    { label: 'Code', w: 42, value: (r) => r.code || ' ' },
    { label: 'Particulars', w: CONTENT_W - 42 - 120, value: (r) => r.label },
    { label: 'Value', w: 120, align: 'right', value: (r) => r.value, colour: (r) => (r.strong ? NAVY : INK) },
  ], rows, ctx, { fontSize: 6.8, rowH: 12.5 });
}

function totalStrip(doc, y, label, value) {
  roundedRect(doc, M, y, CONTENT_W, 20, 2, NAVY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
  doc.text(label, M + 8, y + 6, { width: CONTENT_W - 140, lineBreak: false });
  doc.text(value, M + CONTENT_W - 140, y + 6, { width: 132, align: 'right', lineBreak: false });
  return y + 26;
}

/**
 * Build the whole bill into an open PDFKit document.
 *
 * Kept separate from the streaming wrapper so the same pages can be rendered to
 * a buffer for an email attachment without a response object in hand.
 */
/**
 * An arrear or supplementary bill: no station blocks to print, only what is
 * billed and why — and for an arrear, the month-by-month working behind it,
 * since that is what a beneficiary will check the figure against.
 */
function drawAdjustmentBill(doc, { bill, lines, arrearMonths = [] }) {
  const isArrear = bill.bill_kind === 'ARREAR';
  const ctx = {
    vertical: 'Commercial & System Operation Department',
    title: `${isArrear ? 'Arrear' : 'Supplementary'} bill — ${bill.station_name}`,
    subtitle: `${bill.bill_no}  ·  ${isArrear ? `${monthLabel(bill.arrear_from_month)} to ${monthLabel(bill.arrear_to_month)}` : monthLabel(bill.billing_month)}`
      + (bill.rea_reference ? `  ·  ${bill.rea_reference}` : ''),
    generatedAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
  };
  header(doc, ctx);
  let y = 84;
  y = sectionTitle(doc, y, isArrear ? 'Why this arrear arises' : 'What this bill is for');
  doc.font('Helvetica').fontSize(8).fillColor(INK).text(bill.revision_reason || '—', M, y, { width: CONTENT_W });
  y = doc.y + 10;

  if (isArrear && arrearMonths.length) {
    y = sectionTitle(doc, y, 'Month-wise working (revised tariff applied to the energy, availability and allocation already billed)');
    y = table(doc, y, [
      { label: 'Month', w: 70, value: (r) => monthLabel(r.billing_month) },
      { label: 'Billed on', w: 95, value: (r) => r.basis_bill_no },
      { label: 'Already billed (Rs)', w: 95, align: 'right', value: (r) => money0(r.previously_billed) },
      { label: 'On revised tariff (Rs)', w: 100, align: 'right', value: (r) => money0(r.revised_amount) },
      { label: 'Capacity diff.', w: 75, align: 'right', value: (r) => money0(r.capacity_differential) },
      { label: 'Arrear (Rs)', w: CONTENT_W - 435, align: 'right', value: (r) => money0(r.differential) },
    ], arrearMonths, ctx, { fontSize: 7 });
    y += 8;
  }

  y = sectionTitle(doc, y, 'Beneficiary-wise');
  y = table(doc, y, [
    { label: 'Sr', w: 28, value: (r) => r.sr_no },
    { label: 'Beneficiary', w: 190, value: (r) => r.beneficiary_name },
    { label: isArrear ? 'Capacity charge diff. (Rs)' : 'Share %', w: 110, align: 'right', value: (r) => (isArrear ? money0(r.capacity_charge) : Number(r.pct_proportionate).toFixed(4)) },
    { label: isArrear ? 'Energy charge diff. (Rs)' : '', w: 110, align: 'right', value: (r) => (isArrear ? money0(r.energy_charge_total) : ' ') },
    { label: 'Amount (Rs)', w: CONTENT_W - 438, align: 'right', value: (r) => money0(r.total_charges) },
  ], lines, ctx, { fontSize: 7 });
  y += 4;
  const total = Number(bill.total_charges);
  y = totalStrip(doc, y, total < 0 ? 'Total credit to the beneficiaries (Rs)' : 'Total amount payable (Rs)', money0(Math.abs(total)));
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
    .text(`Rupees ${rupeesInWords(Math.abs(total))} only.`, M, y, { width: CONTENT_W });
  y = doc.y + 6;
  notes(doc, y, [
    isArrear
      ? 'An amount shown negative is a credit: it is set against the beneficiary\'s open bills on issue.'
      : 'Payable within the period allowed by the PPA; late payment attracts surcharge as per the LPS Rules.',
    'Bill authenticated electronically on approval; physical signature not required.',
  ]);
}

/**
 * A thermal station's bill: the tariff and norms, the month's fuel and the
 * energy charge rate worked from them, the two charges, and the beneficiary
 * split. One sheet for the station, one for the beneficiaries.
 */
function drawThermalBill(doc, { bill, lines }) {
  const t = JSON.parse(bill.thermal_inputs_json || '{}');
  const tariff = t.tariff || {};
  const fuel = t.fuel || {};
  const kind = String(bill.bill_kind || 'PROVISIONAL').toLowerCase();
  const ctx = {
    vertical: 'Commercial Department — Thermal',
    title: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} bill for energy supply from ${bill.station_name}`,
    subtitle: `${bill.bill_no}  ·  ${monthLabel(bill.billing_month)}  ·  F.Y. ${bill.financial_year}${tariff.order_ref ? `  ·  ${tariff.order_ref}` : ''}`,
    generatedAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
  };
  header(doc, ctx);
  let y = 84;
  y = sectionTitle(doc, y, 'Tariff and norms (CERC)');
  y = blockRows(doc, y, ctx, [
    { code: 'T1', label: 'Annual Fixed Charges (AFC)', value: money0(tariff.annual_afc) },
    { code: 'T2', label: 'Normative Annual Plant Availability Factor (NAPAF), %', value: `${tariff.napaf_percent ?? '—'}` },
    { code: 'T3', label: 'Gross Station Heat Rate (GHR), kCal/kWh', value: `${tariff.gross_heat_rate ?? '—'}` },
    { code: 'T4', label: 'Normative Auxiliary Energy Consumption (AUX), %', value: `${tariff.aux_pct ?? '—'}` },
    { code: 'T5', label: 'Specific Secondary Fuel Oil Consumption (SFC), ml/kWh', value: `${tariff.sfc_ml_per_kwh ?? 0}` },
    { code: 'T6', label: 'Calorific value of secondary fuel (CVSF), kCal/ml', value: `${tariff.cv_secondary_kcal_per_ml ?? '—'}` },
  ]);
  y += 8;
  y = sectionTitle(doc, y, 'Fuel for the month and the energy charge rate');
  y = blockRows(doc, y, ctx, [
    { code: 'F1', label: 'Gross calorific value of coal (CVPF), kCal/kg', value: `${fuel.gcv_kcal_per_kg ?? '—'}` },
    { code: 'F2', label: 'Landed price of coal (LPPF), Rs/tonne', value: money0(fuel.coal_rs_per_tonne) },
    { code: 'F3', label: 'Landed price of secondary fuel oil, Rs/kL', value: money0(fuel.oil_rs_per_kl) },
    { code: 'ECR', label: 'ECR = [(GHR - SFC x CVSF) x LPPF / CVPF + SFC x LPSFi] x 100 / (100 - AUX), Rs/kWh', value: `${bill.a12_ecr}`, strong: true },
  ]);
  y += 8;
  y = sectionTitle(doc, y, 'Charges for the month');
  y = blockRows(doc, y, ctx, [
    { code: 'C1', label: 'Plant Availability Factor achieved in the month (PAFM), %', value: `${bill.c1_pafm_pct}` },
    { code: 'C2', label: `Capacity charge = AFC x NDM/NDY x PAFM/NAPAF  (${bill.a8_days_in_month}/${bill.a9_days_in_year} days)`, value: money0(bill.c5_total_capacity_charge) },
    { code: 'E1', label: 'Ex-bus scheduled energy, kWh', value: n1(bill.e1_ex_bus_scheduled_kwh) },
    { code: 'EC', label: 'Energy charge = ECR x E1', value: money0(bill.ee1_energy_charge) },
  ]);
  y += 4;
  y = totalStrip(doc, y, 'Total Charges in Rupees  (C2 + EC)', money0(bill.total_charges));
  if (Number(bill.nrldc_total_fee) > 0) {
    y = blockRows(doc, y, ctx, [{ code: '', label: 'RLDC fees & charges (billed through, outside the total above)', value: money0(bill.nrldc_total_fee) }]);
  }
  notes(doc, y + 4, [t.not_modelled || '', 'Bill authenticated electronically on approval; physical signature not required.'].filter(Boolean));

  doc.addPage();
  header(doc, { ...ctx, title: `Beneficiary-wise breakup — ${bill.station_name}` });
  y = 84;
  y = table(doc, y, [
    { label: 'Sr', w: 26, value: (r) => r.sr_no },
    { label: 'Beneficiary', w: 150, value: (r) => r.beneficiary_name },
    { label: 'Share %', w: 55, align: 'right', value: (r) => Number(r.pct_proportionate).toFixed(4) },
    { label: 'Capacity charge', w: 95, align: 'right', value: (r) => money0(r.capacity_charge) },
    { label: 'Energy (kWh)', w: 90, align: 'right', value: (r) => n1(r.saleable_energy_kwh) },
    { label: 'Energy charge', w: 95, align: 'right', value: (r) => money0(r.energy_charge_total) },
    { label: 'Total (Rs)', w: CONTENT_W - 511, align: 'right', value: (r) => money0(r.total_charges) },
  ], lines, ctx, { fontSize: 7 });
}

export function drawHydroStationBill(doc, { bill, lines, contract, arrearMonths }) {
  if (['ARREAR', 'SUPPLEMENTARY'].includes(bill.bill_kind)) {
    drawAdjustmentBill(doc, { bill, lines, arrearMonths });
    pageNumbers(doc);
    return;
  }
  if (bill.thermal_inputs_json) {
    drawThermalBill(doc, { bill, lines });
    pageNumbers(doc);
    return;
  }
  const kind = String(bill.bill_kind || 'PROVISIONAL').toLowerCase();
  const ctx = {
    vertical: 'Commercial & System Operation Department',
    title: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} bill for energy supply from ${bill.station_name}`,
    subtitle: `${bill.bill_no}  ·  ${bill.billing_month}  ·  F.Y. ${bill.financial_year}`
      + (bill.rea_reference ? `  ·  ${bill.rea_reference}` : ''),
    generatedAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
  };

  // ───────────────────────── Sheet 1 — the station's charges ────────────────
  header(doc, ctx);
  let y = 84;

  y = sectionTitle(doc, y, 'Bill parameters');
  y = blockRows(doc, y, ctx, [
    { code: 'A1', label: 'Annual Fixed Charges "AFC" as approved by CERC', value: money0(bill.a1_afc) },
    { code: 'A2', label: 'Annual Design Energy (DE) in MWH', value: n3(bill.a2_design_energy_mwh) },
    { code: 'A3', label: 'Normative Auxiliary Consumption in % (AUX)', value: `${bill.a3_aux_pct}` },
    { code: 'A4', label: 'Free Energy for Home State, in % (FEHS)', value: `${bill.a4_fehs_pct}` },
    { code: 'A5', label: 'Annual Ex-bus Design Energy [ DE X (100-AUX)/100 ] in MWH', value: n3(bill.a5_ex_bus_design_energy_mwh) },
    { code: 'A6', label: 'Annual Ex-bus Saleable Design Energy [ DE X (100-AUX) X (100-FEHS)/10000 ] MWH', value: n3(bill.a6_ex_bus_saleable_design_energy_mwh) },
    { code: 'A7', label: 'Installed Capacity (IC) in MW', value: bill.a7_installed_capacity_mw == null ? '—' : n1(bill.a7_installed_capacity_mw) },
    { code: 'A8', label: 'Number of Days in the month (NDM)', value: String(bill.a8_days_in_month) },
    { code: 'A9', label: 'Number of Days in the year (NDY)', value: String(bill.a9_days_in_year) },
    { code: 'A11', label: 'Normative Annual Plant Availability Factor, % (NAPAF)', value: `${bill.a11_napaf_pct}` },
    { code: 'A12', label: 'Energy Charge Rate (ECR) upto Annual Ex-bus Saleable Design Energy', value: `${bill.a12_ecr}` },
    { code: 'A13', label: 'Energy Charge Rate for energy in excess of it', value: `${bill.a13_ecr_excess}` },
  ]);
  y += 8;

  y = sectionTitle(doc, y, 'Capacity charges (inclusive of incentive)');
  y = blockRows(doc, y, ctx, [
    { code: 'C1', label: 'Plant Availability Factor achieved during the month (PAFM)', value: `${bill.c1_pafm_pct}` },
    { code: 'C2', label: 'Capacity Charge (inclusive of incentive) for the month', value: money0(bill.c2_capacity_charge) },
    { code: 'C3', label: 'Beta Factor as per REA (0 to 1)', value: bill.c3_beta_factor == null ? 'not certified' : Number(bill.c3_beta_factor).toFixed(3) },
    { code: 'C4', label: 'Incentive on account of Beta Factor {3% x Beta x 0.5 x AFC / 12}', value: money0(bill.c4_beta_incentive) },
    { code: 'C5', label: 'Total Capacity Charges including Beta incentive', value: money0(bill.c5_total_capacity_charge), strong: true },
  ]);
  y += 8;

  y = sectionTitle(doc, y, 'Energy details');
  const energyRows = [
    { code: 'E1', label: 'Ex-bus Scheduled Energy for the month in kwh', value: n1(bill.e1_ex_bus_scheduled_kwh) },
    { code: 'E2', label: 'Free Power to the Home State as per REA in kwh', value: n1(bill.e2_free_power_kwh) },
    { code: 'E3', label: 'Ex-bus Saleable Scheduled Energy for the month in kwh  [E1 - E2]', value: n1(bill.e3_saleable_scheduled_kwh) },
    { code: 'E4', label: 'Ex-bus Scheduled Energy (cumulative) up to this month', value: n1(bill.e4_cum_scheduled_kwh) },
    { code: 'E5', label: 'Free Power to the Home State (cumulative) up to this month', value: n1(bill.e5_cum_free_power_kwh) },
    { code: 'E6', label: 'Ex-bus Saleable Scheduled Energy (cumulative)  [E4 - E5]', value: n1(bill.e6_cum_saleable_kwh) },
    { code: 'E7', label: 'Energy in excess of Annual Ex-bus Saleable Design Energy, this month', value: n1(bill.e7_excess_kwh) },
    { code: 'E8', label: 'Energy upto Annual Ex-bus Saleable Design Energy  [E3 - E7]', value: n1(bill.e8_upto_design_kwh) },
  ];
  // The regulated energy only appears on a month that had any, exactly as the
  // issued bill only carries the row when power was actually regulated.
  if (Number(bill.urs_nr_kwh) > 0) {
    energyRows.push(
      { code: 'URS', label: 'Un-requisitioned surplus — regulated, billed to no beneficiary', value: n1(bill.urs_nr_kwh) },
      { code: '', label: 'Saleable energy actually billed  [E3 - URS]', value: n1(Number(bill.e3_saleable_scheduled_kwh) - Number(bill.urs_nr_kwh)), strong: true },
    );
  }
  y = blockRows(doc, y, ctx, energyRows);
  y += 8;

  y = sectionTitle(doc, y, 'Energy charges');
  y = blockRows(doc, y, ctx, [
    { code: 'EE1', label: 'Energy Charges upto the Saleable Design Energy  [E8 x A12]', value: money0(bill.ee1_energy_charge) },
    { code: 'EE2', label: 'Energy Charges for energy in excess of it  [E7 x A13]', value: money0(bill.ee2_excess_energy_charge) },
  ]);
  y += 4;
  y = totalStrip(doc, y, 'Total Charges in Rupees  (C5 + EE1 + EE2)', money0(bill.total_charges));

  if (Number(bill.nrldc_total_fee) > 0) {
    y = blockRows(doc, y, ctx, [{
      code: '',
      label: 'NRLDC Fees & Charges issued by POSOCO (billed through, outside the total above)',
      value: money0(bill.nrldc_total_fee),
    }]);
    y += 6;
  }

  // A revision states what was already billed and what is being billed now, so
  // the differential is arguable without the earlier bill in hand.
  if (bill.prev_total_charges != null) {
    y = sectionTitle(doc, y, 'Revision');
    y = blockRows(doc, y, ctx, [
      { code: 'A', label: `Already billed as per the earlier bill${bill.revises_bill_no ? ` (${bill.revises_bill_no})` : ''}`, value: money0(bill.prev_total_charges) },
      { code: 'B', label: 'Revised total for the month', value: money0(bill.total_charges) },
      { code: 'C', label: 'Differential amount to be billed  [B - A]', value: money0(bill.differential_amount), strong: true },
    ]);
    if (bill.revision_reason) {
      y = notes(doc, y + 4, [`Reason for revision: ${bill.revision_reason}`]);
    }
  }

  // ───────────────────── Sheet 2 — the allocation the split used ────────────
  doc.addPage();
  header(doc, ctx);
  y = 84;
  y = sectionTitle(doc, y, `Weighted average % capacity allocation to beneficiaries of ${bill.station_name}`,
    `Free energy to the home state: ${bill.a4_fehs_pct}%`);
  y = table(doc, y, [
    { label: '#', w: 22, value: (r) => r.sr_no },
    { label: 'Beneficiary', w: 150, value: (r) => r.beneficiary_name + (r.parent_state ? ` (${r.parent_state})` : '') },
    { label: 'Incl. free power', w: 84, align: 'right', value: (r) => pct6(r.pct_incl_free) },
    { label: 'As per REA', w: 84, align: 'right', value: (r) => pct6(r.pct_rea) },
    { label: `Excl. ${bill.a4_fehs_pct}% free`, w: 84, align: 'right', value: (r) => pct6(r.pct_excl_free) },
    { label: 'Proportionate', w: CONTENT_W - 22 - 150 - 84 * 3, align: 'right', value: (r) => pct6(r.pct_proportionate) },
  ], lines, ctx, { fontSize: 7 });
  const sum = (k) => lines.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  y = totalStrip(doc, y + 2,
    `Total  —  REA ${sum('pct_rea').toFixed(6)}%   ·   excl. free ${sum('pct_excl_free').toFixed(6)}%`,
    `${sum('pct_proportionate').toFixed(6)}%`);
  y = notes(doc, y, [
    'Charges are apportioned on the proportionate percentage, which is the allocation net of free power scaled back to 100%.',
    `The home state carries the ${bill.a4_fehs_pct}% free energy, so its share alone is reduced before the remainder is scaled.`,
  ]);

  // ───────────────────── Sheet 3 — NRLDC fees passed through ────────────────
  if (Number(bill.nrldc_total_fee) > 0) {
    doc.addPage();
    header(doc, ctx);
    y = 84;
    y = sectionTitle(doc, y, `Beneficiary-wise breakup of NRLDC fees & charges of ${bill.station_name}`,
      `For the month of ${bill.billing_month}`);
    y = table(doc, y, [
      { label: '#', w: 26, value: (r) => r.sr_no },
      { label: 'Beneficiary', w: 190, value: (r) => r.beneficiary_name },
      { label: 'Wtd. avg. % as per REA', w: 120, align: 'right', value: (r) => pct6(r.pct_rea) },
      { label: 'Amount payable (Rs.)', w: CONTENT_W - 26 - 190 - 120, align: 'right', value: (r) => money0(r.nrldc_fee) },
    ], lines, ctx, { fontSize: 7.5 });
    y = totalStrip(doc, y + 2,
      `Total  —  NRLDC fees issued by POSOCO  ${money0(bill.nrldc_total_fee)}`,
      money0(sum('nrldc_fee')));
    y = notes(doc, y, [
      'NRLDC fees are levied on the station and passed through unchanged; they are split on the REA percentage, which includes free power, so the home state carries its full share.',
    ]);
  }

  // ─────────────── Sheet 4 — beneficiary-wise capacity & energy ─────────────
  doc.addPage();
  header(doc, ctx);
  y = 84;
  const regulated = lines.some((l) => Number(l.deducted_scheduled_energy_kwh) > 0);
  y = sectionTitle(doc, y,
    `Beneficiary-wise breakup of capacity & energy charges of ${bill.station_name}`,
    `For the month of ${bill.billing_month}`);

  // Widths are given as shares and scaled to the page, so adding the two
  // regulation columns cannot quietly squeeze the last one down to nothing —
  // which is what makes every row wrap and the sheet run to three pages.
  const spec = [
    { label: '#', share: 4, value: (r) => r.sr_no },
    { label: 'Beneficiary', share: 22, value: (r) => r.beneficiary_name },
    { label: 'A\nWtd %', share: 10, align: 'right', value: (r) => pct6(r.pct_proportionate) },
    { label: 'B\nCapacity chgs', share: 15, align: 'right', value: (r) => money0(r.capacity_charge) },
    ...(regulated ? [
      { label: 'Scheduled', share: 13, align: 'right', value: (r) => n1(r.actual_scheduled_energy_kwh) },
      { label: 'Deducted', share: 12, align: 'right', value: (r) => n1(r.deducted_scheduled_energy_kwh), colour: (r) => (Number(r.deducted_scheduled_energy_kwh) > 0 ? '#b91c1c' : INK) },
    ] : []),
    { label: regulated ? 'C\nBilled kwh' : 'C\nSaleable kwh', share: 14, align: 'right', value: (r) => n1(r.saleable_energy_kwh) },
    { label: 'D\nUpto design', share: 14, align: 'right', value: (r) => n1(r.energy_upto_design_kwh) },
    { label: 'E\nIn excess', share: 11, align: 'right', value: (r) => n1(r.energy_excess_kwh) },
    { label: 'H\nEnergy chgs', share: 15, align: 'right', value: (r) => money0(r.energy_charge_total) },
    { label: 'I = B + H\nTotal', share: 16, align: 'right', value: (r) => money0(r.total_charges) },
  ];
  const totalShare = spec.reduce((a, c) => a + c.share, 0);
  const cols = spec.map((c, i) => ({ ...c, w: Math.floor((CONTENT_W * c.share) / totalShare) }));
  // Give the rounding remainder to the last column so the row fills the page
  // exactly rather than leaving a ragged edge.
  cols[cols.length - 1].w = CONTENT_W - cols.slice(0, -1).reduce((a, c) => a + c.w, 0);

  y = table(doc, y, cols, lines, ctx, { fontSize: 6.5, rowH: 17 });
  y = totalStrip(doc, y + 2,
    `Total  —  capacity ${money0(sum('capacity_charge'))}  +  energy ${money0(sum('energy_charge_total'))}`,
    money0(sum('total_charges')));

  y = notes(doc, y, [
    `Energy charge rate: Rs ${bill.a12_ecr}/kwh upto the annual saleable design energy`
    + (bill.a13_ecr_excess !== bill.a12_ecr ? `, Rs ${bill.a13_ecr_excess}/kwh beyond it.` : ' and beyond it.'),
    ...(regulated ? ['A regulated beneficiary is billed only for the energy left after its deduction; its capacity charge is unchanged, since that is paid for availability rather than for energy taken.'] : []),
    ...(Number(bill.nrldc_total_fee) > 0 ? ['NRLDC fees are billed separately and are not included in the totals above.'] : []),
  ]);

  // Signature block, as the issued bill carries it.
  y += 10;
  const colW = CONTENT_W / 3;
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5);
  ['Prepared by', 'Checked by', 'Issued by'].forEach((label, i) => {
    const who = [bill.prepared_by, bill.checked_by, bill.issued_by][i];
    doc.fillColor(INK).font('Helvetica-Bold').text(label, M + colW * i, y, { width: colW - 10, lineBreak: false });
    doc.fillColor(MUTED).font('Helvetica').text(who || '', M + colW * i, y + 12, { width: colW - 10, lineBreak: false });
    doc.text('Signature:', M + colW * i, y + 26, { width: colW - 10, lineBreak: false });
  });
  y += 46;

  if (bill.dispatch_invoice_no || bill.courier_tracking_no || bill.dispatch_date) {
    y = notes(doc, y, [
      `Despatched${bill.dispatch_date ? ` on ${bill.dispatch_date}` : ''}`
      + (bill.dispatch_invoice_no ? ` under invoice ${bill.dispatch_invoice_no}` : '')
      + (bill.courier_tracking_no ? `, courier tracking ${bill.courier_tracking_no}` : '')
      + (bill.receipt_date ? `, received ${bill.receipt_date}` : '') + '.',
    ]);
  }

  pageNumbers(doc);
}

// ─────────────────────────── The beneficiary's own bill ──────────────────────

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', below100(n % 100)].filter(Boolean).join(' ');

/** An amount as a cheque writes it: crore, lakh, thousand — and the paise. */
export function rupeesInWords(amount) {
  const paiseTotal = Math.round(Math.abs(Number(amount) || 0) * 100);
  let rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  const parts = [];
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000); rupees %= 100000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  // Above 99 crore the crores are themselves counted in hundreds and thousands.
  if (crore) parts.push(`${crore >= 1000 ? `${below100(Math.floor(crore / 1000))} Thousand ` : ''}${below1000(crore % 1000)}`.trim() + ' Crore');
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rupees) parts.push(below1000(rupees));
  const words = parts.length ? parts.join(' ') : 'Zero';
  return `Rupees ${words}${paise ? ` and ${below100(paise)} Paise` : ''} Only`;
}

/** "2026-09" as a bill names its month: "September 2026". */
export function monthLabel(month) {
  const [y, m] = String(month).split('-').map(Number);
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];
  return names[m - 1] ? `${names[m - 1]} ${y}` : String(month);
}

/**
 * One beneficiary's bill, on one page.
 *
 * The station bill is the working: the whole station's charges and how they
 * divide. What a beneficiary pays against is its own row of that — so this
 * page states the station figures the row was worked from, the beneficiary's
 * share, and the one amount payable, in figures and in words. Every number on
 * it is taken from the station bill's own line; nothing is worked out again
 * here, so the two cannot disagree.
 */
function drawBeneficiaryPage(doc, { bill, lines }, line) {
  const kind = String(bill.bill_kind || 'PROVISIONAL').toLowerCase();
  const Kind = `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  const ref = `${bill.bill_no}/${String(line.sr_no).padStart(2, '0')}`;
  const ctx = {
    vertical: 'Commercial & System Operation Department',
    title: `${Kind} bill for energy supply from ${bill.station_name}`,
    subtitle: `${ref}  ·  ${monthLabel(bill.billing_month)}  ·  F.Y. ${bill.financial_year}`
      + (bill.rea_reference ? `  ·  ${bill.rea_reference}` : ''),
    generatedAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
  };
  header(doc, ctx);
  let y = 84;

  // Who it is for, and which bill it is a part of.
  roundedRect(doc, M, y, CONTENT_W, 46, 3, '#eef2f8');
  doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('BILL TO', M + 10, y + 8, { lineBreak: false });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13)
    .text(line.beneficiary_name + (line.parent_state ? ` (${line.parent_state})` : ''), M + 10, y + 19, { width: CONTENT_W - 220, lineBreak: false });
  doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('BILL NO.', M + CONTENT_W - 200, y + 8, { width: 190, align: 'right', lineBreak: false });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(ref, M + CONTENT_W - 200, y + 19, { width: 190, align: 'right', lineBreak: false });
  doc.fillColor(MUTED).font('Helvetica').fontSize(7)
    .text(`Station bill ${bill.bill_no}, sr. no. ${line.sr_no} of ${lines.length}`, M + CONTENT_W - 200, y + 33, { width: 190, align: 'right', lineBreak: false });
  y += 58;

  y = sectionTitle(doc, y, `Station charges for ${monthLabel(bill.billing_month)}`, 'As per the station bill, sheet 1');
  y = blockRows(doc, y, ctx, [
    { code: 'A1', label: 'Annual Fixed Charges "AFC" as approved by CERC', value: money0(bill.a1_afc) },
    { code: 'A11', label: 'Normative Annual Plant Availability Factor, % (NAPAF)', value: `${bill.a11_napaf_pct}` },
    { code: 'C1', label: 'Plant Availability Factor achieved during the month (PAFM)', value: `${bill.c1_pafm_pct}` },
    { code: 'C5', label: 'Total Capacity Charges of the station including Beta incentive', value: money0(bill.c5_total_capacity_charge) },
    { code: 'E3', label: 'Ex-bus Saleable Scheduled Energy of the station for the month in kwh', value: n1(bill.e3_saleable_scheduled_kwh) },
    { code: 'A12', label: 'Energy Charge Rate (ECR) upto Annual Ex-bus Saleable Design Energy, Rs/kwh', value: `${bill.a12_ecr}` },
    { code: 'A13', label: 'Energy Charge Rate for energy in excess of it, Rs/kwh', value: `${bill.a13_ecr_excess}` },
  ]);
  y += 8;

  y = sectionTitle(doc, y, 'Weighted average % capacity allocation', 'As per the station bill, sheet 2');
  y = blockRows(doc, y, ctx, [
    { code: '', label: 'Allocation as per REA, %', value: pct6(line.pct_rea) },
    { code: '', label: `Allocation excluding ${bill.a4_fehs_pct}% free power to the home state, %`, value: pct6(line.pct_excl_free) },
    { code: 'A', label: 'Proportionate allocation on which the charges are apportioned, %', value: pct6(line.pct_proportionate), strong: true },
  ]);
  y += 8;

  y = sectionTitle(doc, y, 'Charges payable', 'As per the station bill, beneficiary-wise breakup');
  const regulated = Number(line.deducted_scheduled_energy_kwh) > 0;
  y = blockRows(doc, y, ctx, [
    { code: 'B', label: 'Capacity charges  [C5 x A]', value: money0(line.capacity_charge) },
    ...(regulated ? [
      { code: '', label: 'Energy scheduled in kwh', value: n1(line.actual_scheduled_energy_kwh) },
      { code: '', label: 'Energy deducted on regulation in kwh', value: n1(line.deducted_scheduled_energy_kwh) },
    ] : []),
    { code: 'C', label: regulated ? 'Energy billed in kwh' : 'Saleable energy in kwh  [E3 x A]', value: n1(line.saleable_energy_kwh) },
    { code: 'D', label: 'Energy upto the Annual Ex-bus Saleable Design Energy in kwh', value: n1(line.energy_upto_design_kwh) },
    { code: 'E', label: 'Energy in excess of it in kwh', value: n1(line.energy_excess_kwh) },
    { code: 'F', label: 'Energy charges upto the design energy  [D x A12]', value: money0(line.energy_charge_upto) },
    { code: 'G', label: 'Energy charges for energy in excess  [E x A13]', value: money0(line.energy_charge_excess) },
    { code: 'H', label: 'Total energy charges  [F + G]', value: money0(line.energy_charge_total) },
  ]);
  y += 4;
  y = totalStrip(doc, y, 'Amount payable in Rupees  (B + H)', money0(line.total_charges));
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8)
    .text(rupeesInWords(line.total_charges), M, y, { width: CONTENT_W });
  y = doc.y + 8;

  if (Number(line.nrldc_fee) > 0) {
    y = blockRows(doc, y, ctx, [{
      code: '', label: 'NRLDC Fees & Charges issued by POSOCO (billed through, outside the amount above)', value: money0(line.nrldc_fee),
    }]);
    y += 6;
  }

  y = notes(doc, y, [
    `This bill is the beneficiary's part of station bill ${bill.bill_no} for ${bill.station_name}; the station total is Rs ${money0(bill.total_charges)}.`,
    bill.c3_beta_factor == null
      ? 'The Beta factor for the month has not yet been certified; the incentive on it, if any, will be billed on certification.'
      : `Beta factor as per REA: ${Number(bill.c3_beta_factor).toFixed(3)}.`,
    ...(kind === 'provisional' ? ['Provisional, on the provisional Regional Energy Account; subject to revision on the final account.'] : []),
    ...(bill.status === 'DRAFT' ? ['DRAFT — not issued.'] : []),
  ]);

  y += 12;
  const colW = CONTENT_W / 3;
  ['Prepared by', 'Checked by', 'Issued by'].forEach((label, i) => {
    const who = [bill.prepared_by, bill.checked_by, bill.issued_by][i];
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.5).text(label, M + colW * i, y, { width: colW - 10, lineBreak: false });
    doc.fillColor(MUTED).font('Helvetica').text(who || '', M + colW * i, y + 12, { width: colW - 10, lineBreak: false });
    doc.text('Signature:', M + colW * i, y + 26, { width: colW - 10, lineBreak: false });
  });
}

/**
 * The beneficiary bills of a station bill — one page each, in the order of the
 * breakup. Pass `lineId` for a single beneficiary's page.
 */
export function drawHydroBeneficiaryBills(doc, payload, lineId = null) {
  const chosen = lineId ? payload.lines.filter((l) => l.id === lineId) : payload.lines;
  const adjustment = ['ARREAR', 'SUPPLEMENTARY'].includes(payload.bill.bill_kind);
  chosen.forEach((line, i) => {
    if (i > 0) doc.addPage();
    // An arrear or supplementary bill has no energy columns to break out, so a
    // beneficiary's copy is the same bill showing its own line and amount.
    if (payload.bill.thermal_inputs_json && !adjustment) {
      // A thermal beneficiary's copy: its own line of the breakup.
      drawThermalBill(doc, {
        bill: {
          ...payload.bill, total_charges: line.total_charges, c5_total_capacity_charge: line.capacity_charge,
          ee1_energy_charge: line.energy_charge_total, e1_ex_bus_scheduled_kwh: line.saleable_energy_kwh, nrldc_total_fee: line.nrldc_fee,
        },
        lines: [line],
      });
    } else if (adjustment) {
      drawAdjustmentBill(doc, {
        bill: { ...payload.bill, total_charges: line.total_charges },
        lines: [line],
        arrearMonths: (payload.arrearMonths || []).map((m) => {
          const own = JSON.parse(m.lines_json || '[]').find((x) => x.beneficiary_name === line.beneficiary_name);
          return { ...m, differential: own?.differential ?? 0, previously_billed: null, revised_amount: null, capacity_differential: null };
        }),
      });
    } else {
      drawBeneficiaryPage(doc, payload, line);
    }
  });
  return chosen.length;
}

/** Stream the beneficiary bills to an HTTP response. */
export async function generateHydroBeneficiaryBillsPdf(res, payload, lineId = null) {
  const one = lineId ? payload.lines.find((l) => l.id === lineId) : null;
  const base = String(payload.bill.bill_no).replace(/[^\w.-]+/g, '_');
  const filename = one
    ? `${base}_${String(one.sr_no).padStart(2, '0')}_${String(one.beneficiary_name).replace(/[^\w.-]+/g, '_')}.pdf`
    : `${base}_beneficiary_bills.pdf`;
  const doc = newDoc(res, `Hydro beneficiary bills ${payload.bill.bill_no}`, filename);
  drawHydroBeneficiaryBills(doc, payload, lineId);
  doc.end();
}

/**
 * One beneficiary's bill as a buffer, for an email attachment: its own page
 * first, then the station bill's sheets it was worked from — so what arrives is
 * the amount and the working behind it in one file.
 */
export async function hydroBeneficiaryBillPdfBuffer(payload, lineId) {
  const { PassThrough } = await import('stream');
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    stream.setHeader = () => {};
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    try {
      const doc = newDoc(stream, `Hydro bill ${payload.bill.bill_no}`, 'bill.pdf');
      drawHydroBeneficiaryBills(doc, payload, lineId);
      doc.addPage();
      drawHydroStationBill(doc, payload);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Stream the bill to an HTTP response. */
export async function generateHydroStationBillPdf(res, payload) {
  const filename = `${String(payload.bill.bill_no).replace(/[^\w.-]+/g, '_')}.pdf`;
  const doc = newDoc(res, `Hydro station bill ${payload.bill.bill_no}`, filename);
  drawHydroStationBill(doc, payload);
  doc.end();
}
