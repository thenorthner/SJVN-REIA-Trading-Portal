/**
 * Structured invoice verification for developer (PPA / SELLER_TO_SJVN) bills —
 * per the REIA Dashboard doc:
 *   Technical  : REA, Energy, Tariff, Capacity, CUF, COD, Curtailment, Change-in-Law
 *   Commercial : Energy Charges, Change in Law, Compensation Event,
 *                Liquidated Damages, Previous Adjustment → Net Invoice
 *
 * A template is auto-derived from the contract + energy data (so most technical
 * checks are pre-answered); the REIA verifier then confirms/overrides and fills
 * the manual items and commercial adjustments.
 */
import db from '../db/index.js';
import { getParamNumber } from '../mastersService.js';

const TECHNICAL_KEYS = [
  { key: 'REA_UPLOADED', label: 'REA Uploaded' },
  { key: 'ENERGY_VERIFIED', label: 'Energy Verified' },
  { key: 'TARIFF_VERIFIED', label: 'Tariff Verified' },
  { key: 'CAPACITY_VERIFIED', label: 'Contract Capacity Verified' },
  { key: 'CUF_COMPLIANCE', label: 'CUF Compliance' },
  { key: 'COD_COMPLIANCE', label: 'COD Compliance' },
  { key: 'CURTAILMENT_CHECKED', label: 'Curtailment Checked' },
  { key: 'CHANGE_IN_LAW_VERIFIED', label: 'Change in Law Verified' },
];

function cufBaseline(projectType) {
  const map = {
    Solar: 'solar_base_cuf_pct', Wind: 'wind_base_cuf_pct',
    Hybrid: 'hybrid_base_cuf_pct', Hydro: 'hydro_base_cuf_pct', PSP: 'hydro_base_cuf_pct',
  };
  return getParamNumber(map[projectType] || 'solar_base_cuf_pct', 20);
}

/** Auto-derive the technical + commercial checklist for an invoice. */
export function buildTemplate(invoice) {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(invoice.contract_id) || {};
  const energy = invoice.energy_data_id
    ? db.prepare('SELECT * FROM energy_data WHERE id = ?').get(invoice.energy_data_id)
    : db.prepare(`SELECT * FROM energy_data WHERE contract_id = ? AND period_month = ?
        ORDER BY (status='LOCKED') DESC, (data_type='FINAL') DESC, created_at DESC LIMIT 1`)
        .get(invoice.contract_id, invoice.billing_period);

  const auto = {};
  const tariffMatch = Number(invoice.tariff_per_unit) === Number(contract.tariff_per_unit);
  const codOk = contract.cod_date && contract.cod_date <= `${invoice.billing_period}-28`;
  const cufBase = cufBaseline(contract.project_type);
  const cufOk = energy?.cuf_percent != null ? Number(energy.cuf_percent) >= cufBase * 0.5 : null;

  auto.REA_UPLOADED = energy ? (['REA', 'RLDC', 'SLDC'].includes(energy.source) || energy.status === 'LOCKED' ? 'VERIFIED' : 'PENDING') : 'FAILED';
  auto.ENERGY_VERIFIED = invoice.validation_status === 'MATCHED' ? 'VERIFIED'
    : (invoice.validation_status === 'MISMATCH' ? 'FAILED' : (energy ? 'PENDING' : 'FAILED'));
  auto.TARIFF_VERIFIED = tariffMatch ? 'VERIFIED' : 'FAILED';
  auto.CAPACITY_VERIFIED = contract.capacity_mw ? 'PENDING' : 'PENDING';
  auto.CUF_COMPLIANCE = cufOk === null ? 'PENDING' : (cufOk ? 'VERIFIED' : 'FAILED');
  auto.COD_COMPLIANCE = codOk ? 'VERIFIED' : (contract.cod_date ? 'FAILED' : 'PENDING');
  auto.CURTAILMENT_CHECKED = 'PENDING';
  auto.CHANGE_IN_LAW_VERIFIED = 'PENDING';

  const hints = {
    REA_UPLOADED: energy ? `${energy.source} · ${energy.status} · ${energy.energy_mwh} MWh` : 'No energy data found',
    ENERGY_VERIFIED: invoice.validation_status ? `Match: ${invoice.validation_status}` : 'Run seller-vs-system validation',
    TARIFF_VERIFIED: `Invoice ₹${invoice.tariff_per_unit} vs contract ₹${contract.tariff_per_unit}/unit`,
    CAPACITY_VERIFIED: contract.capacity_mw ? `Contract capacity ${contract.capacity_mw} MW` : 'No capacity on contract',
    CUF_COMPLIANCE: energy?.cuf_percent != null ? `CUF ${energy.cuf_percent}% vs baseline ~${cufBase}%` : 'CUF not reported',
    COD_COMPLIANCE: contract.cod_date ? `COD ${contract.cod_date}` : 'No COD date on contract',
    CURTAILMENT_CHECKED: 'Confirm any curtailment/backing-down instructions',
    CHANGE_IN_LAW_VERIFIED: 'Confirm any change-in-law claims',
  };

  const technical = TECHNICAL_KEYS.map((t) => ({
    key: t.key, label: t.label, status: auto[t.key], hint: hints[t.key] || '', note: '',
  }));

  const commercial = {
    energy_charges: Math.round(Number(invoice.energy_charges) || 0),
    change_in_law: 0,
    compensation_event: 0,
    liquidated_damages: 0,
    previous_adjustment: Math.round(Number(invoice.other_adjustments) || 0),
  };
  commercial.net_invoice = commercial.energy_charges + commercial.change_in_law
    + commercial.compensation_event - commercial.liquidated_damages + commercial.previous_adjustment;

  return { technical, commercial };
}

/** Overlay saved values on a fresh template (keeps auto-hints current). */
export function mergeSaved(template, saved) {
  if (!saved) return template;
  const byKey = {};
  (saved.technical || []).forEach((i) => { byKey[i.key] = i; });
  const technical = template.technical.map((t) => byKey[t.key]
    ? { ...t, status: byKey[t.key].status ?? t.status, note: byKey[t.key].note ?? '' }
    : t);
  const commercial = { ...template.commercial, ...(saved.commercial || {}) };
  commercial.net_invoice = (Number(commercial.energy_charges) || 0) + (Number(commercial.change_in_law) || 0)
    + (Number(commercial.compensation_event) || 0) - (Number(commercial.liquidated_damages) || 0)
    + (Number(commercial.previous_adjustment) || 0);
  return { technical, commercial };
}

/** Overall status: VERIFIED when every technical item is VERIFIED or NA. */
export function rollupStatus(technical) {
  const items = technical || [];
  if (!items.length) return 'PENDING';
  if (items.some((i) => i.status === 'FAILED')) return 'FAILED';
  if (items.every((i) => ['VERIFIED', 'NA'].includes(i.status))) return 'VERIFIED';
  return 'IN_PROGRESS';
}
