/**
 * Payment security, contract by contract (Batch 1, 17-Oct-2026).
 *
 * S1  Requirement vs held: what each live contract asks its paying side to
 *     lodge (LC and funds from a buyer, PBG / EMD from a seller), what is in
 *     force today, and the gap, with a request to the counterparty to make it up.
 * S4  Revolving LCs after a draw: how long since the draw, against the
 *     reinstatement period (lc_reinstatement_days), late ones flagged.
 * S5  The release checklist: contract ended or milestone met, no dues, no
 *     disputes, replacement cover in place, Finance sign-off.
 */
import db from '../db/index.js';
import { getParamNumber } from '../mastersService.js';
import { newId, pushNotification } from '../util.js';
import {
  computeCoverage, computeRequiredAmount, releasePosition, releaseWhileLive, isLiveToday, trailingMonthlyBilledAvg,
} from '../paymentSecurityEngine.js';
import { INSTRUMENTS_BY_SIDE, ACTIVE_STATUSES, refreshAvailable } from '../paymentSecurityConstants.js';

const LIVE_CONTRACT = ['SIGNED', 'PENDING_REGULATORY_APPROVAL', 'ACTIVE', 'AMENDED', 'NEARING_EXPIRY'];
const DEFAULT_MONTHS_COVER = 1.1;
const money = (v) => Math.round(Number(v) || 0);
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const daysSince = (d) => (d ? Math.floor((Date.parse(`${today()}T00:00:00Z`) - Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`)) / 86400000) : null);

/** The heads a requirement row and an instrument are matched on. */
const headOf = (mechanism, subtype) => (mechanism === 'BANK_GUARANTEE' ? `BANK_GUARANTEE:${subtype || 'PBG'}` : mechanism);
const HEAD_LABEL = {
  LC: 'Letter of credit', 'BANK_GUARANTEE:PBG': 'Performance guarantee (PBG)', 'BANK_GUARANTEE:EMD': 'Earnest money (EMD)',
  'BANK_GUARANTEE:OTHER_BG': 'Other guarantee', PAYMENT_SECURITY_FUND: 'Payment security fund', CORPUS_FUND: 'Corpus fund', OTHER: 'Other',
};

/** S1: one contract's requirement against what it holds, head by head. */
export function requirementVsHeld(contract) {
  const side = contract.contract_type === 'PPA' ? 'SELLER' : 'BUYER';
  const allowed = INSTRUMENTS_BY_SIDE[side];
  const avg = trailingMonthlyBilledAvg(contract.id);
  const reqs = db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(contract.id)
    .filter((r) => allowed.includes(r.mechanism_type));
  const instruments = db.prepare(`
    SELECT * FROM payment_security WHERE contract_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
  `).all(contract.id, ...ACTIVE_STATUSES).filter((r) => allowed.includes(r.mechanism_type));

  const heads = new Map();
  const head = (key) => {
    if (!heads.has(key)) heads.set(key, { head: key, label: HEAD_LABEL[key] || key, required: 0, held: 0, unconfirmed: 0, instruments: [] });
    return heads.get(key);
  };
  for (const r of reqs) {
    const h = head(headOf(r.mechanism_type, r.bg_subtype));
    h.required += r.mechanism_type === 'LC' || r.months_cover > 0
      ? Math.max(Number(r.min_amount) || 0, avg * (Number(r.months_cover) || DEFAULT_MONTHS_COVER))
      : Number(r.min_amount) || 0;
  }
  for (const i of instruments) {
    const h = head(headOf(i.mechanism_type, i.bg_subtype));
    const live = isLiveToday(i);
    const amount = live ? refreshAvailable(i) : 0;
    h.held += amount;
    if (live && !i.verified_at) h.unconfirmed += amount;
    h.instruments.push({ id: i.id, instrument_no: i.instrument_no, available: money(amount), validity_end: i.validity_end, live, confirmed: !!i.verified_at });
  }
  const rows = [...heads.values()].map((h) => ({
    ...h, required: money(h.required), held: money(h.held), unconfirmed: money(h.unconfirmed), gap: money(Math.max(0, h.required - h.held)),
  }));
  const cov = computeCoverage(contract.id);
  const lastAsk = db.prepare(`SELECT created_at, actor_name FROM security_events WHERE contract_id = ? AND event_type = 'SHORTFALL_REQUESTED' ORDER BY created_at DESC LIMIT 1`).get(contract.id);
  return {
    contract_id: contract.id,
    contract_no: contract.contract_no,
    contract_type: contract.contract_type,
    paying_side: side,
    counterparty: side === 'BUYER' ? contract.buyer_name : contract.seller_name,
    heads: rows,
    required_total: money(computeRequiredAmount(contract.id)),
    held_total: cov.available_security,
    exposure: cov.exposure,
    benchmark: cov.benchmark,
    gap_total: money(rows.reduce((t, r) => t + r.gap, 0)),
    shortfall_vs_exposure: cov.shortfall,
    adequate: cov.adequate,
    last_requested: lastAsk || null,
  };
}

export function securityBoard() {
  const contracts = db.prepare(`
    SELECT c.*, s.name AS seller_name, b.name AS buyer_name FROM contracts c
    LEFT JOIN entities s ON s.id = c.seller_id LEFT JOIN entities b ON b.id = c.buyer_id
    WHERE c.status IN (${LIVE_CONTRACT.map(() => '?').join(',')})
      AND COALESCE(c.project_type, '') NOT IN ('Hydro', 'HYDRO', 'PSP', 'Thermal', 'THERMAL')
    ORDER BY c.contract_type DESC, c.contract_no
  `).all(...LIVE_CONTRACT);
  const rows = contracts.map(requirementVsHeld).filter((r) => r.heads.length);
  rows.sort((a, b) => b.gap_total - a.gap_total || a.contract_no.localeCompare(b.contract_no));
  return {
    rows,
    totals: {
      contracts: rows.length,
      with_gap: rows.filter((r) => r.gap_total > 0).length,
      gap: money(rows.reduce((t, r) => t + r.gap_total, 0)),
      unconfirmed: money(rows.reduce((t, r) => t + r.heads.reduce((u, h) => u + h.unconfirmed, 0), 0)),
    },
  };
}

/** S4: revolving letters of credit drawn on and not yet restored. */
export function reinstatementTracker() {
  const window = getParamNumber('lc_reinstatement_days', 7);
  const out = [];
  // Buyers' LCs in SJVN's favour.
  const buyerLcs = db.prepare(`
    SELECT ps.*, c.contract_no FROM payment_security ps JOIN contracts c ON c.id = ps.contract_id
    WHERE ps.mechanism_type = 'LC' AND ps.is_revolving = 1 AND COALESCE(ps.utilized_amount, 0) > 0
      AND ps.status IN (${ACTIVE_STATUSES.map(() => '?').join(',')}, 'INVOKED')
  `).all(...ACTIVE_STATUSES);
  for (const lc of buyerLcs) {
    const drawn = db.prepare(`SELECT created_at FROM security_events WHERE payment_security_id = ? AND event_type IN ('UTILIZE', 'INVOKE', 'INVOKED') ORDER BY created_at DESC LIMIT 1`).get(lc.id)?.created_at
      || lc.updated_at;
    out.push({ kind: 'BUYER_LC', id: lc.id, instrument_no: lc.instrument_no, contract_no: lc.contract_no, drawn: money(lc.utilized_amount), limit: money(lc.limit_amount), drawn_on: String(drawn).slice(0, 10) });
  }
  // SJVN's own LCs in sellers' favour.
  const sjvnLcs = db.prepare(`
    SELECT l.*, c.contract_no FROM sjvn_lcs l JOIN contracts c ON c.id = l.contract_id
    WHERE l.status = 'ACTIVE' AND l.is_revolving = 1 AND COALESCE(l.utilized_amount, 0) > 0
  `).all();
  for (const lc of sjvnLcs) {
    const drawn = db.prepare(`SELECT created_at, details FROM sjvn_lc_events WHERE lc_id = ? AND event_type = 'DRAWN' ORDER BY created_at DESC LIMIT 1`).get(lc.id);
    let drawOn = drawn?.created_at;
    try { drawOn = JSON.parse(drawn?.details || '{}').draw_date || drawOn; } catch { /* the event date stands */ }
    out.push({ kind: 'SJVN_LC', id: lc.id, instrument_no: lc.lc_no, contract_no: lc.contract_no, drawn: money(lc.utilized_amount), limit: money(lc.amount), drawn_on: String(drawOn || lc.updated_at).slice(0, 10) });
  }
  return {
    window_days: window,
    rows: out.map((r) => {
      const days = daysSince(r.drawn_on);
      return { ...r, days_since_draw: days, overdue: days != null && days > window, due_by: new Date(Date.parse(`${r.drawn_on}T00:00:00Z`) + window * 86400000).toISOString().slice(0, 10) };
    }).sort((a, b) => (b.days_since_draw || 0) - (a.days_since_draw || 0)),
  };
}

/** S5: where a release request stands on each item of its checklist. */
export function releaseChecklist(rel) {
  const ps = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(rel.payment_security_id);
  const position = releasePosition(rel.contract_id);
  const live = ps ? releaseWhileLive(ps) : { allowed: true };
  const items = [
    { key: 'TERM', label: 'Contract ended, or the milestone that frees it met (COD for a PBG)', ok: live.allowed && live.reason !== 'replacement cover in place' ? true : live.allowed ? null : false, detail: live.allowed ? live.reason : `${live.contract_no} is still ${String(live.contract_status || '').toLowerCase().replace(/_/g, ' ')}` },
    { key: 'NO_DUES', label: 'Nothing outstanding on the contract', ok: !(position.outstanding_dues > 0), detail: position.outstanding_dues > 0 ? `₹${position.outstanding_dues.toLocaleString('en-IN')} outstanding` : null },
    { key: 'NO_DISPUTES', label: 'No dispute open', ok: position.open_disputes === 0, detail: position.open_disputes ? `${position.open_disputes} open` : null },
    { key: 'REPLACEMENT', label: 'Replacement cover in place (where the contract runs on)', ok: live.allowed, detail: live.allowed ? null : `₹${Math.max(0, live.left || 0).toLocaleString('en-IN')} would be left against ₹${(live.needed || 0).toLocaleString('en-IN')} needed` },
    { key: 'FINANCE', label: 'Finance sign-off', ok: !!rel.finance_signoff_at, detail: rel.finance_signoff_at ? `${rel.finance_signoff_by}, ${String(rel.finance_signoff_at).slice(0, 10)}` : null },
  ];
  // The term and replacement items answer the same question two ways: either
  // the contract no longer needs the cover, or something else now gives it.
  const termOrReplacement = live.allowed;
  return { items, ready: termOrReplacement && items.filter((i) => ['NO_DUES', 'NO_DISPUTES', 'FINANCE'].includes(i.key)).every((i) => i.ok) };
}

/**
 * S4: tell the desk and Finance once about each LC still not restored after
 * the reinstatement period (one alert per draw, keyed on the draw date).
 */
export function alertLateReinstatements() {
  const { rows, window_days: window } = reinstatementTracker();
  let sent = 0;
  for (const r of rows.filter((x) => x.overdue)) {
    const key = `REINSTATEMENT_LATE:${r.drawn_on}`;
    if (db.prepare('SELECT 1 FROM security_alerts WHERE payment_security_id = ? AND alert_type = ?').get(r.id, key)) continue;
    const message = `${r.instrument_no} (${r.contract_no}): ₹${r.drawn.toLocaleString('en-IN')} drawn on ${r.drawn_on} is still not reinstated after ${r.days_since_draw} days (period ${window} days).${r.kind === 'BUYER_LC' ? ' Ask the buyer to have its bank restore the letter of credit.' : ' Have SJVN\'s bank restore it.'}`;
    for (const role of ['REIA_MAKER', 'REIA_CHECKER', 'FINANCE_USER']) pushNotification({ role, type: 'SECURITY', message });
    db.prepare('INSERT INTO security_alerts (id, payment_security_id, alert_type, sent_to, message) VALUES (?, ?, ?, ?, ?)')
      .run(newId('SAL'), r.id, key, 'REIA desk, Finance', message);
    sent += 1;
  }
  return { sent };
}
