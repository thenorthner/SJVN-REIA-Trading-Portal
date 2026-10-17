/**
 * Structured invoice verification for a developer's own bill to SJVN — per the
 * REIA Dashboard doc:
 *   Technical  : REA, Energy, Tariff, Capacity, CUF, COD, Curtailment, Change-in-Law
 *   Commercial : Energy Charges, Change in Law, Compensation Event,
 *                Liquidated Damages, Previous Adjustment → Net Invoice
 *
 * A template is auto-derived from the contract + locked energy (so most
 * technical checks are pre-answered); the REIA verifier then confirms or
 * overrides and fills the manual items and commercial adjustments.
 *
 * The checklist used to gate nothing and take anything (17-Oct-2026 audit): a
 * bill billed at ₹3.10 on a ₹2.88 PPA went through all three approval levels
 * with its tariff check FAILED, a failed check could be cleared without a word,
 * and DSM pool bills and SJVN's own computed bills filled the queue with tariff
 * "failures". It is now held to the bill it describes: an override of a failed
 * automatic check needs a reason and lapses if the figures under it change, the
 * build-up must come to what the bill says, and approval waits for VERIFIED.
 */
import db from '../db/index.js';
import { resolveTariff } from './tariffStructure.js';
import { cufYearPosition } from './cufPenalty.js';
import { billableCapacityMw } from '../util.js';
import { raisedBySeller } from './counterpartyScope.js';

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
const LABEL = Object.fromEntries(TECHNICAL_KEYS.map((t) => [t.key, t.label]));

export const CHECK_STATUSES = ['VERIFIED', 'PENDING', 'FAILED', 'NA'];
// Only what can genuinely not arise on a bill may be marked not applicable: a
// month with no curtailment, a bill with no change-in-law claim. The energy, the
// rate and the plant's capacity apply to every bill.
const NA_ALLOWED = new Set(['CURTAILMENT_CHECKED', 'CHANGE_IN_LAW_VERIFIED']);
// The adjustments the verifier records. Energy charges and the bill's other
// lines are the bill's own and are never taken from the request.
const COMMERCIAL_INPUTS = ['change_in_law', 'compensation_event', 'liquidated_damages', 'previous_adjustment'];
const NON_NEGATIVE = new Set(['compensation_event', 'liquidated_damages']);
// Where a developer's bill is waiting on SJVN: sent in, and not yet decided.
export const OPEN_FOR_VERIFICATION = ['SUBMITTED', 'UNDER_APPROVAL'];
// Past the desk's decision. A bill decided without a completed checklist (seeded,
// or approved before approval waited for one) can still be verified after the
// fact; once it reads VERIFIED it is closed like any other.
export const DECIDED = ['APPROVED', 'SENT', 'PARTIALLY_PAID', 'DISPUTED', 'PAID'];

/** Whether the checklist can be worked on this bill now, and whether that is after the fact. */
export function verificationWindow(invoice) {
  if (OPEN_FOR_VERIFICATION.includes(invoice.status)) return { editable: true, retrospective: false };
  if (DECIDED.includes(invoice.status) && invoice.verification_status !== 'VERIFIED') return { editable: true, retrospective: true };
  return { editable: false, retrospective: false };
}

const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/** Whether the checklist applies: a developer's own bill, not SJVN's computation or a DSM pool bill. */
export function verifiable(invoice) {
  return raisedBySeller(invoice);
}

function lockedEnergy(invoice) {
  if (invoice.energy_data_id) {
    const row = db.prepare(`SELECT * FROM energy_data WHERE id = ? AND status = 'LOCKED'`).get(invoice.energy_data_id);
    if (row) return row;
  }
  return db.prepare(`SELECT * FROM energy_data WHERE contract_id = ? AND period_month = ? AND status = 'LOCKED'
      ORDER BY (data_type = 'FINAL') DESC, created_at DESC LIMIT 1`).get(invoice.contract_id, invoice.billing_period);
}

function lastDayOf(period) {
  const [y, m] = String(period).split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(d).padStart(2, '0')}`;
}

/** Auto-derive the technical + commercial checklist for an invoice. */
export function buildTemplate(invoice) {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(invoice.contract_id) || {};
  const locked = lockedEnergy(invoice);
  const anyEnergy = locked || db.prepare('SELECT * FROM energy_data WHERE contract_id = ? AND period_month = ? ORDER BY created_at DESC LIMIT 1')
    .get(invoice.contract_id, invoice.billing_period);
  const billedMwh = Number(invoice.energy_mwh) || 0;
  const auto = {};
  const hints = {};

  // REA / energy account: billing runs on locked energy only — and a month's
  // figure cannot be final before the month is over. Adani's October 2026 bill
  // (seed data) carried 42,500 MWh locked on 2 October, two days in, when the
  // 250 MW plant could have made at most 12,000 MWh; the check passed it.
  const capacity = billableCapacityMw(contract);
  const monthEnd = lastDayOf(invoice.billing_period);
  const lockedOn = locked?.created_at ? String(locked.created_at).slice(0, 10) : null;
  const early = lockedOn && lockedOn < monthEnd;
  auto.REA_UPLOADED = locked ? (early ? 'FAILED' : 'VERIFIED') : (anyEnergy ? 'PENDING' : 'FAILED');
  hints.REA_UPLOADED = locked
    ? `${locked.source} · LOCKED · ${locked.energy_mwh} MWh`
      + (early ? ` — recorded on ${lockedOn}, before the month ended on ${monthEnd}`
        + (capacity > 0 ? ` (at most ${Math.round(capacity * 24 * Number(lockedOn.slice(-2))).toLocaleString('en-IN')} MWh could have been generated by then)` : '') : '')
    : (anyEnergy ? `${anyEnergy.source} · ${anyEnergy.status} — not locked yet` : 'No energy on file for the month');

  // Energy: what the bill claims against the locked figure — and against SJVN's
  // own computation where one exists. It used to wait on the latter alone, so a
  // month SJVN had not computed stayed PENDING with the locked figure on file.
  if (invoice.validation_status === 'MISMATCH') {
    auto.ENERGY_VERIFIED = 'FAILED';
    hints.ENERGY_VERIFIED = 'Does not match SJVN\'s computed bill';
  } else if (locked) {
    // Energy banked from the month is billed when drawn or settled, not here.
    const banked = invoice.invoice_type === 'SUPPLEMENTARY' ? 0 : Number(db.prepare('SELECT COALESCE(SUM(banked_mwh), 0) s FROM energy_banking WHERE contract_id = ? AND period_month = ?').get(invoice.contract_id, invoice.billing_period).s) || 0;
    const lockedMwh = Math.round(((Number(locked.energy_mwh) || 0) - banked) * 1000) / 1000;
    auto.ENERGY_VERIFIED = Math.abs(billedMwh - lockedMwh) <= 0.001 ? 'VERIFIED' : 'FAILED';
    hints.ENERGY_VERIFIED = `Billed ${billedMwh} MWh vs locked ${lockedMwh} MWh${banked ? ` (${locked.energy_mwh} less ${banked} banked)` : ''}`;
  } else {
    auto.ENERGY_VERIFIED = 'PENDING';
    hints.ENERGY_VERIFIED = `Billed ${billedMwh} MWh; no locked figure to check it against yet`;
  }

  // Tariff: the rate the contract's structure gives for this period (an
  // escalating contract's base rate failed every year after the first), and the
  // energy charges must be that energy at that rate.
  const tariff = resolveTariff(contract, invoice.billing_period);
  const rate = Number(invoice.tariff_per_unit) || 0;
  const rateOk = Math.abs(rate - tariff.rate) <= 0.00005;
  const expectedCharges = Math.round(billedMwh * 1000 * rate);
  const chargesOk = Math.abs(expectedCharges - (Number(invoice.energy_charges) || 0)) <= 1;
  auto.TARIFF_VERIFIED = rateOk && chargesOk ? 'VERIFIED' : 'FAILED';
  hints.TARIFF_VERIFIED = `Invoice ₹${rate}/unit vs contract ₹${tariff.rate}/unit (${tariff.label})`
    + (chargesOk ? '' : ` · energy charges ${rupees(invoice.energy_charges)} ≠ ${billedMwh} MWh × ₹${rate} = ${rupees(expectedCharges)}`);

  // Capacity: a judgement, except that a plant cannot deliver more than its
  // capacity round the clock.
  const hours = 24 * Number(lastDayOf(invoice.billing_period).slice(-2));
  const ceiling = capacity * hours;
  auto.CAPACITY_VERIFIED = capacity > 0 && billedMwh > ceiling ? 'FAILED' : 'PENDING';
  hints.CAPACITY_VERIFIED = capacity > 0
    ? `Capacity ${capacity} MW · at most ${Math.round(ceiling).toLocaleString('en-IN')} MWh in the month`
    : 'No capacity on contract';

  // CUF: an annual obligation, settled by SJVN's year-end true-up note, so a
  // developer's monthly bill is not expected to deduct it. The check confirms
  // the month's energy is accounted and shows the contract-year position.
  const cuf = cufYearPosition(contract, invoice.billing_period, { capacityMw: capacity, tariffPerUnit: tariff.rate });
  if (!cuf.applicable) {
    auto.CUF_COMPLIANCE = 'NA';
    hints.CUF_COMPLIANCE = 'No CUF obligation for this technology';
  } else if (cuf.cuf_percent == null) {
    auto.CUF_COMPLIANCE = 'PENDING';
    hints.CUF_COMPLIANCE = 'No energy accounted for the contract year yet';
  } else {
    auto.CUF_COMPLIANCE = 'VERIFIED';
    hints.CUF_COMPLIANCE = cuf.label;
  }

  // COD: on or before the last day of the month billed (the 28th failed a plant
  // commissioned on the 30th).
  auto.COD_COMPLIANCE = contract.cod_date
    ? (contract.cod_date <= lastDayOf(invoice.billing_period) ? 'VERIFIED' : 'FAILED')
    : 'PENDING';
  hints.COD_COMPLIANCE = contract.cod_date ? `COD ${contract.cod_date}` : 'No COD date on contract';

  auto.CURTAILMENT_CHECKED = 'PENDING';
  hints.CURTAILMENT_CHECKED = 'Confirm any curtailment/backing-down instructions';
  auto.CHANGE_IN_LAW_VERIFIED = 'PENDING';
  hints.CHANGE_IN_LAW_VERIFIED = 'Confirm any change-in-law claims';

  const technical = TECHNICAL_KEYS.map((t) => ({
    key: t.key, label: t.label, status: auto[t.key], auto: auto[t.key], hint: hints[t.key] || '', note: '',
  }));

  // The build-up starts from the bill itself — its energy charges, the lines it
  // carries besides (transmission, taxes, surcharge, …) and its own adjustment —
  // so an untouched checklist comes to exactly the bill. It used to leave the
  // other lines out, and any bill with a transmission charge showed a "gap".
  const total = Math.round(Number(invoice.total_amount) || 0);
  const energyCharges = Math.round(Number(invoice.energy_charges) || 0);
  const previous = Math.round(Number(invoice.other_adjustments) || 0);
  const commercial = {
    energy_charges: energyCharges,
    other_bill_lines: total - energyCharges - previous,
    change_in_law: 0,
    compensation_event: 0,
    liquidated_damages: 0,
    previous_adjustment: previous,
  };
  commercial.net_invoice = netOf(commercial);

  return { technical, commercial };
}

function netOf(c) {
  return Math.round((Number(c.energy_charges) || 0) + (Number(c.other_bill_lines) || 0)
    + (Number(c.change_in_law) || 0) + (Number(c.compensation_event) || 0)
    - (Number(c.liquidated_damages) || 0) + (Number(c.previous_adjustment) || 0));
}

/**
 * Overlay saved values on a fresh template (keeps auto-hints current).
 *
 * A decision holds only against the automatic result it was taken on: if the
 * figures under a check have changed since, the check goes back to what it now
 * reads, with a note saying so. A failed automatic check stays failed unless it
 * was cleared, with a reason, against that same failure.
 */
export function mergeSaved(template, saved) {
  if (!saved) return template;
  const byKey = {};
  (saved.technical || []).forEach((i) => { if (i && i.key) byKey[i.key] = i; });
  const technical = template.technical.map((t) => {
    const s = byKey[t.key];
    if (!s || !CHECK_STATUSES.includes(s.status)) return t;
    const note = typeof s.note === 'string' ? s.note : '';
    const takenOn = s.auto;
    if (takenOn !== undefined && takenOn !== t.auto) {
      return { ...t, note: `Earlier decision (${s.status}) set aside: the automatic check now reads ${t.auto}.` };
    }
    if (t.auto === 'FAILED' && s.status !== 'FAILED' && !(takenOn === 'FAILED' && note.trim())) {
      return { ...t, note };
    }
    return { ...t, status: s.status, note };
  });
  const commercial = { ...template.commercial };
  for (const k of COMMERCIAL_INPUTS) {
    const v = Number(saved.commercial?.[k]);
    if (saved.commercial && saved.commercial[k] !== undefined && Number.isFinite(v)) commercial[k] = Math.round(v);
  }
  commercial.net_invoice = netOf(commercial);
  return { technical, commercial };
}

/**
 * Check what the verifier sent and turn it into the checklist to store.
 * Returns { error } or { checklist }.
 */
export function acceptSubmission(template, body = {}) {
  if (body.technical !== undefined && !Array.isArray(body.technical)) return { error: 'technical must be a list of checks' };
  const sent = {};
  for (const item of body.technical || []) {
    if (!item || !LABEL[item.key]) return { error: `Unknown check: ${item?.key ?? '(none)'}` };
    if (!CHECK_STATUSES.includes(item.status)) {
      return { error: `${LABEL[item.key]}: status must be one of ${CHECK_STATUSES.join(', ')}` };
    }
    if (item.note != null && typeof item.note !== 'string') return { error: `${LABEL[item.key]}: the note must be text` };
    sent[item.key] = { status: item.status, note: String(item.note || '').trim().slice(0, 500) };
  }

  const technical = [];
  for (const t of template.technical) {
    const s = sent[t.key];
    if (!s) { technical.push({ key: t.key, status: t.auto, auto: t.auto, note: '' }); continue; }
    if (s.status === 'NA' && !NA_ALLOWED.has(t.key) && t.auto !== 'NA') {
      return { error: `${t.label} applies to every bill and cannot be marked not applicable.` };
    }
    if (t.auto === 'FAILED' && s.status !== 'FAILED' && s.note.length < 5) {
      return { error: `${t.label} failed its automatic check (${t.hint}). Say why you are clearing it.` };
    }
    technical.push({ key: t.key, status: s.status, auto: t.auto, note: s.note });
  }

  const raw = body.commercial || {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'commercial must be an object' };
  const commercial = {};
  for (const k of COMMERCIAL_INPUTS) {
    if (raw[k] === undefined || raw[k] === null || raw[k] === '') continue;
    const v = Number(raw[k]);
    if (!Number.isFinite(v)) return { error: `${k.replace(/_/g, ' ')} must be a number` };
    if (NON_NEGATIVE.has(k) && v < 0) return { error: `${k.replace(/_/g, ' ')} cannot be negative` };
    commercial[k] = Math.round(v);
  }
  return { checklist: { technical, commercial } };
}

/** The build-up's figure against the bill's; anything but zero means the bill is wrong. */
export function commercialGap(invoice, commercial) {
  // Damages the verifier assessed are recovered by their own note (V4), not by
  // the developer rewriting its bill: what such a note covers is not a gap.
  const recovered = invoice?.id ? Number(db.prepare(`
    SELECT COALESCE(SUM(amount), 0) s FROM debit_credit_notes
    WHERE invoice_id = ? AND source_kind = 'VERIFICATION_LD' AND status IN ('DRAFT', 'ISSUED', 'SETTLED')
  `).get(invoice.id).s) || 0 : 0;
  return Math.round((Number(commercial?.net_invoice) || 0) + recovered - Math.round(Number(invoice.total_amount) || 0));
}

/** Overall status: VERIFIED when every technical item is VERIFIED or NA and the build-up meets the bill. */
export function rollupStatus(technical, gap = 0) {
  const items = technical || [];
  if (!items.length) return 'PENDING';
  if (items.some((i) => i.status === 'FAILED') || Math.abs(gap) >= 1) return 'FAILED';
  if (items.every((i) => ['VERIFIED', 'NA'].includes(i.status))) return 'VERIFIED';
  return 'IN_PROGRESS';
}

/**
 * Where a bill's verification stands now, worked out from the figures as they
 * are rather than read off the stored status. A bill nobody has looked at is
 * "not started" unless an automatic check has already failed it.
 */
export function liveVerification(invoice) {
  let saved = null;
  try { saved = invoice.verification_json ? JSON.parse(invoice.verification_json) : null; } catch { /* ignore */ }
  const checklist = mergeSaved(buildTemplate(invoice), saved);
  const gap = commercialGap(invoice, checklist.commercial);
  const rolled = rollupStatus(checklist.technical, gap);
  const status = saved ? rolled : (rolled === 'FAILED' ? 'FAILED' : 'PENDING');
  return { ...checklist, commercial_gap: gap, verification_status: status, started: !!saved };
}

/** Why a developer's bill cannot be approved yet on its verification, or null. */
export function verificationBlock(invoice) {
  if (!verifiable(invoice)) return null;
  const live = liveVerification(invoice);
  if (live.started && live.verification_status === 'VERIFIED') return null;
  if (!live.started) return 'Verify this bill first: nobody has worked through its verification checklist yet.';
  const failed = live.technical.filter((t) => t.status === 'FAILED').map((t) => t.label);
  const open = live.technical.filter((t) => t.status === 'PENDING').map((t) => t.label);
  const parts = [];
  if (failed.length) parts.push(`failed: ${failed.join(', ')}`);
  if (live.commercial_gap) parts.push(`the build-up and the bill differ by ${rupees(Math.abs(live.commercial_gap))}`);
  if (open.length) parts.push(`still open: ${open.join(', ')}`);
  return `This bill's verification is not complete (${parts.join('; ')}). Complete it, or send the bill back to the developer.`;
}
