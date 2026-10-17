/**
 * G5: the developer scorecard (Batch 5, 17-Oct-2026).
 *
 * One line per PPA (plant) and a roll-up per developer, from records SJVN
 * already keeps:
 *
 *   generation   actual MWh against the target — the PPA's minimum CUF on the
 *                possible energy of the months counted (certified curtailment
 *                already taken out) — as an achievement %;
 *   disputes     how many of its bills were disputed, and how many still open;
 *   billing      average days from a bill reaching SJVN (hard copy received,
 *                else issued, else entered) to its last payment, on paid bills;
 *   compliance   share of the contract-compliance checks that are OK, of those
 *                that apply.
 *
 * The score blends them (generation 50, compliance 30, disputes 20). It is an
 * indicator for review meetings, not a contractual rating.
 */
import db from '../db/index.js';
import { generationPerformance } from './generationPerformance.js';
import { contractCompliance } from './contractCompliance.js';
import { OPEN_STATUSES } from '../disputesConstants.js';

const r = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

function disputeCounts(contractId) {
  return db.prepare(`
    SELECT COUNT(*) total, SUM(CASE WHEN d.status IN (${OPEN_STATUSES.map(() => '?').join(',')}) THEN 1 ELSE 0 END) open
    FROM disputes d JOIN invoices i ON i.id = d.invoice_id WHERE i.contract_id = ?
  `).get(...OPEN_STATUSES, contractId);
}

function paymentCycle(contractId) {
  const rows = db.prepare(`
    SELECT COALESCE(i.hardcopy_received_on, substr(i.issued_at, 1, 10), substr(i.created_at, 1, 10)) AS start_on,
           (SELECT MAX(p.payment_date) FROM payments p WHERE p.invoice_id = i.id AND COALESCE(p.mode, '') <> 'CREDIT_NOTE') AS paid_on
    FROM invoices i WHERE i.contract_id = ? AND i.direction = 'SELLER_TO_SJVN' AND i.status = 'PAID' AND i.invoice_no NOT LIKE 'DSM-%'
  `).all(contractId).filter((x) => x.start_on && x.paid_on);
  if (!rows.length) return { bills: 0, avg_days: null };
  const days = rows.map((x) => Math.max(0, Math.round((Date.parse(`${x.paid_on}T00:00:00Z`) - Date.parse(`${x.start_on}T00:00:00Z`)) / 86400000)));
  return { bills: rows.length, avg_days: r(days.reduce((a, b) => a + b, 0) / days.length, 1) };
}

export function developerScorecard({ from = null, to = null } = {}) {
  const gen = generationPerformance({ from, to });
  const compliance = new Map(contractCompliance({}).contracts.map((c) => [c.contract_id, c]));
  const ppas = new Map(db.prepare(`SELECT c.id, c.contract_no, c.seller_id, e.name AS seller_name FROM contracts c LEFT JOIN entities e ON e.id = c.seller_id WHERE c.contract_type = 'PPA'`).all().map((c) => [c.id, c]));

  const plants = gen.projects.filter((p) => ppas.has(p.contract_id)).map((p) => {
    const c = ppas.get(p.contract_id);
    const targetMwh = p.min_cuf_percent > 0 ? (p.possible_mwh * p.min_cuf_percent) / 100 : null;
    const achievement = targetMwh ? (p.energy_mwh / targetMwh) * 100 : null;
    const d = disputeCounts(p.contract_id);
    const pay = paymentCycle(p.contract_id);
    const cc = compliance.get(p.contract_id);
    const applicable = (cc?.checks || []).filter((k) => k.state !== 'NOT_APPLICABLE');
    const complianceScore = applicable.length ? (applicable.filter((k) => k.state === 'OK').length / applicable.length) * 100 : null;
    const disputeScore = Math.max(0, 100 - 20 * (Number(d.total) || 0));
    const parts = [[achievement == null ? null : Math.min(100, achievement), 50], [complianceScore, 30], [disputeScore, 20]].filter(([v]) => v != null);
    const weight = parts.reduce((a, [, w]) => a + w, 0);
    const score = weight ? parts.reduce((a, [v, w]) => a + v * w, 0) / weight : null;
    return {
      contract_id: p.contract_id, contract_no: p.contract_no, developer_id: c.seller_id, developer: c.seller_name || p.seller_name,
      project_type: p.project_type, capacity_mw: p.capacity_mw, months: p.months,
      energy_mwh: p.energy_mwh, target_mwh: r(targetMwh), achievement_pct: r(achievement, 1),
      cuf_percent: p.period_cuf_percent, min_cuf_percent: p.min_cuf_percent,
      disputes: Number(d.total) || 0, disputes_open: Number(d.open) || 0,
      paid_bills: pay.bills, avg_payment_days: pay.avg_days,
      compliance_score: r(complianceScore, 0), compliance_state: cc?.state || null,
      score: r(score, 0), grade: score == null ? null : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D',
    };
  });

  const byDev = new Map();
  for (const p of plants) {
    const key = p.developer_id || p.developer;
    if (!byDev.has(key)) byDev.set(key, { developer_id: p.developer_id, developer: p.developer, plants: 0, capacity_mw: 0, energy_mwh: 0, target_mwh: 0, disputes: 0, disputes_open: 0, pay_days: [], scores: [] });
    const g = byDev.get(key);
    g.plants += 1; g.capacity_mw += Number(p.capacity_mw) || 0; g.energy_mwh += p.energy_mwh; g.target_mwh += p.target_mwh || 0;
    g.disputes += p.disputes; g.disputes_open += p.disputes_open;
    if (p.avg_payment_days != null) g.pay_days.push([p.avg_payment_days, p.paid_bills]);
    if (p.score != null) g.scores.push([p.score, Number(p.capacity_mw) || 1]);
  }
  const developers = [...byDev.values()].map((g) => {
    const billCount = g.pay_days.reduce((a, [, n]) => a + n, 0);
    const capW = g.scores.reduce((a, [, w]) => a + w, 0);
    return {
      developer_id: g.developer_id, developer: g.developer, plants: g.plants, capacity_mw: r(g.capacity_mw),
      energy_mwh: r(g.energy_mwh), target_mwh: r(g.target_mwh), achievement_pct: g.target_mwh ? r((g.energy_mwh / g.target_mwh) * 100, 1) : null,
      disputes: g.disputes, disputes_open: g.disputes_open,
      avg_payment_days: billCount ? r(g.pay_days.reduce((a, [d, n]) => a + d * n, 0) / billCount, 1) : null,
      score: capW ? r(g.scores.reduce((a, [s, w]) => a + s * w, 0) / capW, 0) : null,
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return { from, to, judged_up_to: gen.judged_up_to, weights: { generation: 50, compliance: 30, disputes: 20 }, plants: plants.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)), developers };
}
