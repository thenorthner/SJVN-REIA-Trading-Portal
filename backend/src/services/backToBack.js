/**
 * Back-to-back check on a PSA bill (feature B1, 17-Oct-2026).
 *
 * SJVN buys under the PPA and sells the same energy under the PSA, keeping
 * only its trading margin. A PSA bill is right when, source by source, the
 * MWh it charges are the PPA's month times this PSA's share, the rate it
 * passes through is what the generator is paid, and the spread between the
 * two is the margin — no more and no less. The double margin on
 * INV-PSA/2026/000001 would have shown here on day one.
 *
 * For each source PPA it reads the PPA bill that stands for the month: the
 * developer's own invoice once presented, else SJVN's computed bill; never a
 * cancelled one or one wholly reversed by credit notes.
 */
import db from '../db/index.js';
import { sourcesForPsa } from './allocations.js';
import { getParamNumber } from '../mastersService.js';

const MWH_TOLERANCE = 0.01;      // MWh
const SPREAD_TOLERANCE = 1;      // ₹/MWh
const round = (v, d = 2) => Math.round((Number(v) || 0) * 10 ** d) / 10 ** d;

// SJVN's own computed bill counts from its draft (so a wrong figure shows
// early); a developer's draft is the developer's, not yet in.
const STANDING = `status NOT IN ('CANCELLED', 'REJECTED')
  AND NOT (status = 'DRAFT' AND TRIM(COALESCE(invoice_breakdown_json, '')) = '')
  AND COALESCE((SELECT SUM(n.amount) FROM debit_credit_notes n WHERE n.invoice_id = invoices.id AND n.note_type = 'CREDIT'
    AND n.model = 'V2' AND n.status IN ('ISSUED', 'SETTLED')), 0) < total_amount - 0.005`;

/** The PPA bill that stands for a month: the developer's own, else SJVN's. */
export function standingPpaBill(ppaId, period) {
  return db.prepare(`
    SELECT * FROM invoices
    WHERE contract_id = ? AND billing_period = ? AND direction = 'SELLER_TO_SJVN'
      AND invoice_type IN ('PROVISIONAL', 'FINAL') AND invoice_no NOT LIKE 'DSM-%' AND ${STANDING}
    ORDER BY (TRIM(COALESCE(invoice_breakdown_json, '')) = '') DESC, (invoice_type = 'FINAL') DESC, created_at DESC
    LIMIT 1
  `).get(ppaId, period);
}

/** ₹/MWh a bill charges for its energy. */
function ratePerMwh(bill) {
  const mwh = Number(bill?.energy_mwh) || 0;
  if (bill?.tariff_per_unit > 0) return Number(bill.tariff_per_unit) * 1000;
  return mwh > 0 ? (Number(bill.energy_charges) || 0) / mwh : null;
}

function breakdownOf(bill) {
  try { return JSON.parse(bill.invoice_breakdown_json || '[]'); } catch { return []; }
}

export function backToBack(psaBill) {
  if (!psaBill || psaBill.direction !== 'SJVN_TO_BUYER' || String(psaBill.invoice_no).startsWith('DSM-')) {
    return { applicable: false, reason: 'Back-to-back applies to a PSA bill for energy.' };
  }
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(psaBill.contract_id);
  if (contract?.contract_type !== 'PSA') return { applicable: false, reason: 'Not a PSA bill.' };
  const period = psaBill.billing_period;
  const sources = sourcesForPsa(contract.id, period);
  if (!sources.length) return { applicable: false, reason: `${contract.contract_no} has no source PPA for ${period}.` };

  const margin = contract.trading_margin_per_mwh != null && contract.trading_margin_per_mwh !== ''
    ? Number(contract.trading_margin_per_mwh) : getParamNumber('trading_margin_per_mwh', 70);
  const lines = breakdownOf(psaBill);
  const allocLines = lines.filter((l) => l.code === 'ALLOC');

  const rows = sources.map((src) => {
    const ppaBill = standingPpaBill(src.ppa_id, period);
    const share = (Number(src.allocation_percent) || 0) / 100;
    // What the PSA bill charges for this source: its ALLOC line where it has
    // one (several sources, or a part share), else the whole bill's MWh.
    const alloc = allocLines.find((l) => l.ppa_id === src.ppa_id) || (sources.length === 1 ? allocLines[0] : null);
    const psaMwh = alloc ? Number(alloc.value) : (sources.length === 1 ? Number(psaBill.energy_mwh) : null);
    const expectedMwh = ppaBill ? round((Number(ppaBill.energy_mwh) || 0) * share, 3) : null;
    const ppaRate = ppaBill ? ratePerMwh(ppaBill) : null;
    const mwhOk = ppaBill && psaMwh != null ? Math.abs(psaMwh - expectedMwh) <= MWH_TOLERANCE : null;
    return {
      ppa_id: src.ppa_id,
      ppa_contract_no: src.ppa_contract_no,
      allocation_percent: Number(src.allocation_percent),
      ppa_bill: ppaBill ? { id: ppaBill.id, invoice_no: ppaBill.invoice_no, status: ppaBill.status, energy_mwh: ppaBill.energy_mwh, own: !(ppaBill.invoice_breakdown_json || '').trim() } : null,
      ppa_mwh: ppaBill ? Number(ppaBill.energy_mwh) : null,
      expected_mwh: expectedMwh,
      psa_mwh: psaMwh,
      mwh_ok: mwhOk,
      ppa_rate_per_mwh: ppaRate != null ? round(ppaRate) : null,
    };
  });

  // The PSA side, per MWh: what passes through (energy charges) and what the
  // buyer pays in all for energy (energy + margin).
  const psaMwh = Number(psaBill.energy_mwh) || 0;
  const passThrough = psaMwh > 0 ? (Number(psaBill.energy_charges) || 0) / psaMwh : null;
  const sellRate = psaMwh > 0 ? ((Number(psaBill.energy_charges) || 0) + (Number(psaBill.trading_margin) || 0)) / psaMwh : null;
  const withBills = rows.filter((r) => r.ppa_rate_per_mwh != null && r.psa_mwh > 0);
  const weight = withBills.reduce((t, r) => t + r.psa_mwh, 0);
  const buyRate = weight > 0 ? withBills.reduce((t, r) => t + r.ppa_rate_per_mwh * r.psa_mwh, 0) / weight : null;
  const spread = sellRate != null && buyRate != null ? sellRate - buyRate : null;
  const complete = rows.every((r) => r.ppa_bill);

  const flags = [];
  for (const r of rows) {
    if (!r.ppa_bill) flags.push(`${r.ppa_contract_no} has no PPA bill for ${period} yet`);
    else if (r.mwh_ok === false) flags.push(`${r.ppa_contract_no}: PSA bills ${r.psa_mwh} MWh, the PPA bill's ${r.ppa_mwh} MWh × ${r.allocation_percent}% is ${r.expected_mwh} MWh`);
  }
  const rateOk = buyRate != null && passThrough != null ? Math.abs(passThrough - buyRate) <= SPREAD_TOLERANCE : null;
  if (rateOk === false) flags.push(`Pass-through ₹${round(passThrough)}/MWh differs from the PPA rate ₹${round(buyRate)}/MWh`);
  const spreadOk = spread != null ? Math.abs(spread - margin) <= SPREAD_TOLERANCE : null;
  if (spreadOk === false) flags.push(`Spread ₹${round(spread)}/MWh is not the ₹${margin}/MWh margin${spread > margin ? ' — the buyer is charged more than the margin' : ' — SJVN earns less than the margin'}`);

  return {
    applicable: true,
    invoice_no: psaBill.invoice_no,
    period,
    margin_per_mwh: margin,
    sources: rows,
    psa_mwh: psaMwh,
    pass_through_per_mwh: passThrough != null ? round(passThrough) : null,
    sell_rate_per_mwh: sellRate != null ? round(sellRate) : null,
    buy_rate_per_mwh: buyRate != null ? round(buyRate) : null,
    spread_per_mwh: spread != null ? round(spread) : null,
    spread_amount: spread != null ? Math.round(spread * psaMwh) : null,
    margin_amount: Math.round(margin * psaMwh),
    rate_ok: rateOk,
    spread_ok: spreadOk,
    state: !complete ? 'INCOMPLETE' : flags.length ? 'MISMATCH' : 'OK',
    flags,
  };
}
