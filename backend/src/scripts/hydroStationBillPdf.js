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
export function drawHydroStationBill(doc, { bill, lines, contract }) {
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

/** Stream the bill to an HTTP response. */
export async function generateHydroStationBillPdf(res, payload) {
  const filename = `${String(payload.bill.bill_no).replace(/[^\w.-]+/g, '_')}.pdf`;
  const doc = newDoc(res, `Hydro station bill ${payload.bill.bill_no}`, filename);
  drawHydroStationBill(doc, payload);
  doc.end();
}
