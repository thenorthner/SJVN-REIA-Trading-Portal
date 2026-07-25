/**
 * CERC Form-IV — periodic return of inter-state trading transactions.
 *
 * Two regulations shape this module:
 *  - The trading licence regulations require the return to be filed
 *    transaction-wise (seller, buyer, quantum, purchase price, sale price,
 *    margin, period) rather than as a single period total.
 *  - The CERC (Fixation of Trading Margin) Regulations, 2010 cap the margin on
 *    short-term inter-state trades at 4 paise/kWh where the sale price is at or
 *    below ₹3/kWh and 7 paise/kWh above it. The cap is tested per transaction,
 *    so a compliant period average does not excuse an individual breach.
 *
 * Trades cleared through a power exchange fall outside the cap; those lines are
 * marked EXEMPT with a reason rather than silently skipped, so the filed form
 * still reconciles to the traded volume.
 */
import db from '../db/index.js';
import { newId } from '../util.js';
import { getParamNumber } from '../mastersService.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const FY_RE = /^(\d{4})-(\d{2})$/;

const MISSING_PURCHASE_REMARK = 'Purchase rate not recorded against the trade';

const round = (v, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((Number(v) || 0) * f) / f;
};

const iso = (d) => d.toISOString().slice(0, 10);

/** Applicable cap in ₹/kWh for a given sale price. */
export function marginCapFor(saleRate) {
  const threshold = getParamNumber('cerc_margin_cap_price_threshold', 3);
  const low = getParamNumber('cerc_margin_cap_low', 0.04);
  const high = getParamNumber('cerc_margin_cap_high', 0.07);
  return Number(saleRate) > threshold ? high : low;
}

/**
 * Resolve a reporting period to its date window.
 * MONTHLY takes `YYYY-MM`; ANNUAL takes an Indian financial year `YYYY-YY`
 * (2026-27 → 1 Apr 2026 to 31 Mar 2027).
 */
export function resolvePeriod(periodType, period) {
  const p = String(period || '').trim().replace(/^FY[\s-]*/i, '');
  if (periodType === 'ANNUAL') {
    const m = FY_RE.exec(p);
    if (!m) throw new Error('Annual period must be a financial year like 2026-27');
    const startYear = Number(m[1]);
    return { period: p, from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
  }
  if (!MONTH_RE.test(p)) throw new Error('Monthly period must be YYYY-MM');
  const [y, mo] = p.split('-').map(Number);
  return { period: p, from: `${p}-01`, to: iso(new Date(Date.UTC(y, mo, 0))) };
}

/** Filing deadline = period end + the configured grace days. */
export function dueDateFor(periodTo) {
  const d = new Date(`${periodTo}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + getParamNumber('cerc_form_iv_due_days', 30));
  return iso(d);
}

/** Whole days the trade and the reporting window have in common. */
function overlapDays(aFrom, aTo, bFrom, bTo) {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = aTo < bTo ? aTo : bTo;
  if (from > to) return 0;
  const ms = new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`);
  return Math.floor(ms / 86400000) + 1;
}

/**
 * Round the money fields and re-derive the margin from its two legs.
 *
 * Rates are quoted to paise, so binary floating point noise (3.60 − 3.48 =
 * 0.12000000000000011) must not reach the database — it leaks into the filed
 * CSV and makes an at-the-cap margin look like a breach.
 */
export function normalizeLine(line) {
  const purchase_rate = round(line.purchase_rate, 4);
  const sale_rate = round(line.sale_rate, 4);
  return {
    ...line,
    quantum_mu: round(line.quantum_mu, 4),
    purchase_rate,
    sale_rate,
    trading_margin_per_unit: round(
      line.trading_margin_per_unit != null ? line.trading_margin_per_unit : sale_rate - purchase_rate,
      4,
    ),
    // The data-gap flag is system-owned: drop it once the gap is filled so it
    // doesn't survive into the filed return.
    remarks: purchase_rate > 0 && line.remarks === MISSING_PURCHASE_REMARK ? null : line.remarks,
  };
}

/** Classify a line against the CERC cap. An explicit exemption wins. */
export function evaluateLine(line) {
  if (line.exempt_reason) return { compliance_status: 'EXEMPT', margin_cap: null };
  const cap = marginCapFor(line.sale_rate);
  // Round to paise before comparing — a margin of exactly the cap is compliant,
  // and floating-point noise should not manufacture a breach.
  const margin = round(line.trading_margin_per_unit, 4);
  return {
    compliance_status: margin > round(cap, 4) ? 'BREACH' : 'COMPLIANT',
    margin_cap: cap,
  };
}

/**
 * Derive Form-IV lines from bilateral trades overlapping the period.
 *
 * Quantum is the contracted MW pro-rated over the days that fall inside the
 * window, which is what a licensee reports for a bilateral contract that
 * straddles a period boundary.
 */
export function deriveLines(from, to) {
  const trades = db.prepare(`
    SELECT bt.*, tc.name AS client_name
    FROM bilateral_transactions bt
    LEFT JOIN trading_clients tc ON tc.id = bt.client_id
    WHERE bt.status != 'CANCELLED'
      AND bt.start_date <= ? AND bt.end_date >= ?
    ORDER BY bt.start_date ASC, bt.id ASC
  `).all(to, from);

  return trades.map((t, i) => {
    const days = overlapDays(t.start_date, t.end_date, from, to);
    const mwh = Number(t.quantum_mw) * 24 * days;
    const saleRate = Number(t.tariff_per_unit) || 0;
    const purchaseRate = Number(t.purchase_rate_per_unit) || 0;
    // Without both legs the margin is unknowable; leave it at zero and let the
    // submit gate refuse the filing rather than report a fabricated figure.
    const margin = purchaseRate > 0 ? saleRate - purchaseRate : 0;

    const line = {
      line_no: i + 1,
      source: 'BILATERAL',
      bilateral_id: t.id,
      seller_name: t.client_name || 'Unknown seller',
      buyer_name: t.counterparty,
      contract_ref: t.loi_contract_ref || null,
      period_from: t.start_date > from ? t.start_date : from,
      period_to: t.end_date < to ? t.end_date : to,
      quantum_mu: round(mwh / 1000, 4),
      purchase_rate: round(purchaseRate, 4),
      sale_rate: round(saleRate, 4),
      trading_margin_per_unit: round(margin, 4),
      exempt_reason: null,
      remarks: purchaseRate > 0 ? null : MISSING_PURCHASE_REMARK,
    };
    return { ...line, ...evaluateLine(line) };
  });
}

/** Period totals as they appear on the filed form. */
export function rollUp(lines) {
  let volumeMu = 0;
  let revenue = 0;
  let purchaseCost = 0;
  let marginAmount = 0;

  for (const l of lines) {
    const kwh = Number(l.quantum_mu) * 1e6;
    volumeMu += Number(l.quantum_mu) || 0;
    revenue += kwh * (Number(l.sale_rate) || 0);
    purchaseCost += kwh * (Number(l.purchase_rate) || 0);
    marginAmount += kwh * (Number(l.trading_margin_per_unit) || 0);
  }

  return {
    total_volume_mu: round(volumeMu, 4),
    total_revenue: round(revenue),
    total_purchase_cost: round(purchaseCost),
    trading_margin: round(marginAmount),
    // Volume-weighted so a tiny trade at a wide margin can't skew the average.
    avg_margin_per_unit: volumeMu > 0 ? round(marginAmount / (volumeMu * 1e6), 4) : 0,
    line_count: lines.length,
    breach_count: lines.filter((l) => l.compliance_status === 'BREACH').length,
  };
}

export function getLines(formId) {
  return db.prepare('SELECT * FROM cerc_form_iv_lines WHERE form_id = ? ORDER BY line_no ASC').all(formId);
}

/** Recompute and persist the header totals from whatever lines currently exist. */
export function refreshTotals(formId) {
  const totals = rollUp(getLines(formId));
  db.prepare(`
    UPDATE cerc_form_iv SET total_volume_mu=@total_volume_mu, total_revenue=@total_revenue,
      total_purchase_cost=@total_purchase_cost, trading_margin=@trading_margin,
      avg_margin_per_unit=@avg_margin_per_unit, line_count=@line_count, breach_count=@breach_count,
      updated_at=datetime('now')
    WHERE id=@id
  `).run({ ...totals, id: formId });
  return totals;
}

export function insertLine(formId, line) {
  const normalized = normalizeLine(line);
  const evaluated = { ...normalized, ...evaluateLine(normalized) };
  db.prepare(`
    INSERT INTO cerc_form_iv_lines (id, form_id, line_no, source, bilateral_id, seller_name, buyer_name,
      contract_ref, period_from, period_to, quantum_mu, purchase_rate, sale_rate, trading_margin_per_unit,
      margin_cap, compliance_status, exempt_reason, remarks)
    VALUES (@id, @form_id, @line_no, @source, @bilateral_id, @seller_name, @buyer_name,
      @contract_ref, @period_from, @period_to, @quantum_mu, @purchase_rate, @sale_rate, @trading_margin_per_unit,
      @margin_cap, @compliance_status, @exempt_reason, @remarks)
  `).run({
    id: newId('FIVL'),
    form_id: formId,
    line_no: evaluated.line_no,
    source: evaluated.source || 'MANUAL',
    bilateral_id: evaluated.bilateral_id || null,
    seller_name: evaluated.seller_name,
    buyer_name: evaluated.buyer_name,
    contract_ref: evaluated.contract_ref || null,
    period_from: evaluated.period_from,
    period_to: evaluated.period_to,
    quantum_mu: evaluated.quantum_mu,
    purchase_rate: evaluated.purchase_rate,
    sale_rate: evaluated.sale_rate,
    trading_margin_per_unit: evaluated.trading_margin_per_unit,
    margin_cap: evaluated.margin_cap,
    compliance_status: evaluated.compliance_status,
    exempt_reason: evaluated.exempt_reason || null,
    remarks: evaluated.remarks || null,
  });
}

/**
 * Reasons the form cannot be filed yet. Empty array = ready to submit.
 * A breach is deliberately blocking: filing a return that admits an
 * over-cap margin without recording why invites a CERC show-cause.
 */
export function submissionBlockers(form, lines) {
  const blockers = [];
  if (!lines.length) blockers.push('No transactions on the form — generate from trade data or add a line.');

  const breaches = lines.filter((l) => l.compliance_status === 'BREACH');
  if (breaches.length) {
    blockers.push(
      `${breaches.length} transaction(s) exceed the CERC trading margin cap `
      + `(line ${breaches.map((l) => l.line_no).join(', ')}). Correct the rates or record an exemption reason.`,
    );
  }

  const incomplete = lines.filter((l) => !(l.quantum_mu > 0) || !(l.sale_rate > 0) || !(l.purchase_rate > 0));
  if (incomplete.length) {
    blockers.push(
      `${incomplete.length} transaction(s) are missing quantum, purchase price or sale price `
      + `(line ${incomplete.map((l) => l.line_no).join(', ')}).`,
    );
  }

  if (!form.reference_no) blockers.push('CERC filing reference number is required before marking the form submitted.');
  return blockers;
}

const CSV_HEADERS = [
  'Sl. No.', 'Name of Seller', 'Name of Buyer', 'Contract Reference', 'Period From', 'Period To',
  'Quantum (MU)', 'Purchase Price (Rs/kWh)', 'Sale Price (Rs/kWh)', 'Trading Margin (Rs/kWh)',
  'Applicable Cap (Rs/kWh)', 'Compliance', 'Remarks',
];

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** Form-IV as CSV, with the period totals as a trailing summary block. */
export function toCsv(form, lines) {
  const rows = [
    [`CERC Form-IV — ${form.period_type === 'ANNUAL' ? 'Annual' : 'Monthly'} Return of Inter-State Trading Transactions`],
    [`Form No.`, form.form_no],
    [`Period`, form.period],
    [`Status`, form.status],
    [`Filing Reference`, form.reference_no || '—'],
    [],
    CSV_HEADERS,
    ...lines.map((l) => [
      l.line_no, l.seller_name, l.buyer_name, l.contract_ref || '', l.period_from, l.period_to,
      l.quantum_mu, l.purchase_rate, l.sale_rate, l.trading_margin_per_unit,
      l.margin_cap ?? '', l.compliance_status,
      l.compliance_status === 'EXEMPT' ? (l.exempt_reason || '') : (l.remarks || ''),
    ]),
    [],
    ['Total Volume (MU)', form.total_volume_mu],
    ['Total Purchase Cost (Rs)', form.total_purchase_cost],
    ['Total Sale Revenue (Rs)', form.total_revenue],
    ['Total Trading Margin (Rs)', form.trading_margin],
    ['Weighted Avg Margin (Rs/kWh)', form.avg_margin_per_unit],
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
