/**
 * The 90-day compliance calendar (CC1 + CERC1 + SM4, Batch 5, 17-Oct-2026).
 *
 * One timeline of what falls due in the next N days, from every register that
 * keeps a date: CERC Form-IV returns and the licence fee, payment-security
 * instruments, counterparty clearances, contract ends, energy-banking cycle
 * ends and forum hearings. A CERC return already past its due date and still
 * not filed stays on it, marked overdue, until it is filed.
 */
import db from '../db/index.js';
import { cercCompliance } from './cercCompliance.js';
import { licenceCompliance } from './cercLicence.js';
import { dueDateFor } from './cercFormIv.js';

const LIVE = ['ACTIVE', 'NEARING_EXPIRY', 'RENEWED', 'AMENDED'];
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

export const CALENDAR_KINDS = {
  CERC_FILING: 'CERC Form-IV return',
  LICENCE_FEE: 'CERC licence fee',
  SECURITY_EXPIRY: 'LC / BG expiry',
  CLEARANCE_EXPIRY: 'Clearance expiry',
  CONTRACT_END: 'Contract end',
  BANKING_CYCLE_END: 'Banking cycle end',
  HEARING: 'Forum hearing',
};

export function complianceCalendar({ days = 90, today = istToday() } = {}) {
  const horizon = addDays(today, days);
  const items = [];
  // Overdue for longer than the window itself: counted, not listed, so years of
  // unfiled history do not bury what falls due next.
  const back = addDays(today, -days);
  const older = { count: 0, oldest: null, by_kind: {} };
  const push = (date, kind, title, detail, extra = {}) => {
    const d = String(date).slice(0, 10);
    if (d < back) {
      older.count += 1;
      older.by_kind[kind] = (older.by_kind[kind] || 0) + 1;
      if (!older.oldest || d < older.oldest) older.oldest = d;
      return;
    }
    items.push({ date: d, kind, kind_label: CALENDAR_KINDS[kind], title, detail, days_left: daysBetween(today, d), overdue: d < today, ...extra });
  };
  const inWindow = (d) => d && String(d).slice(0, 10) >= today && String(d).slice(0, 10) <= horizon;

  // CERC returns: every unfiled one due by the horizon (overdue ones included),
  // and the months still running whose return falls due inside it.
  try {
    const cerc = cercCompliance();
    const seen = new Set();
    for (const r of [...(cerc.monthly || []), ...(cerc.annual || [])]) {
      seen.add(`${r.period_type}|${r.period}`);
      if (r.status === 'SUBMITTED' || !r.due_date || r.due_date > horizon) continue;
      push(r.due_date, 'CERC_FILING', `Form-IV ${r.period_type === 'ANNUAL' ? 'annual' : 'monthly'} return — ${r.period}`,
        r.status === 'MISSING' ? 'Not started' : `Return is ${r.status.toLowerCase()}`, { ref: r.period, status: r.status, link: '/trading/form-iv' });
    }
    const filed = new Map(db.prepare(`SELECT period, status FROM cerc_form_iv WHERE period_type = 'MONTHLY'`).all().map((f) => [f.period, f.status]));
    for (let i = 0; i < 4; i += 1) {
      const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + i - 1);
      const ym = d.toISOString().slice(0, 7);
      if (seen.has(`MONTHLY|${ym}`) || filed.get(ym) === 'SUBMITTED') continue;
      const due = dueDateFor(monthEnd(ym), 'MONTHLY');
      if (!inWindow(due)) continue;
      push(due, 'CERC_FILING', `Form-IV monthly return — ${ym}`, filed.has(ym) ? `Return is ${filed.get(ym).toLowerCase()}` : 'Month still running or not started',
        { ref: ym, status: filed.get(ym) || 'UPCOMING', link: '/trading/form-iv' });
    }
  } catch { /* a calendar without the CERC rows is still worth showing */ }

  try {
    for (const y of licenceCompliance().years || []) {
      if (['PAID', 'PAID_LATE'].includes(y.fee_status) || !y.fee_due_date || y.fee_due_date > horizon) continue;
      push(y.fee_due_date, 'LICENCE_FEE', `CERC licence fee — FY ${y.fy}`, `₹${Number(y.fee_amount_due || 0).toLocaleString('en-IN')} payable`, { ref: y.fy, status: y.fee_status, link: '/reia/cerc-compliance?view=licence' });
    }
  } catch { /* licence tracker not set up */ }

  for (const s of db.prepare(`
    SELECT ps.id, ps.instrument_no, ps.mechanism_type, ps.validity_end, ps.limit_amount, c.contract_no, e.name AS party FROM payment_security ps
    JOIN contracts c ON c.id = ps.contract_id LEFT JOIN entities e ON e.id = COALESCE(ps.entity_id, c.buyer_id)
    WHERE ps.status IN ('ACTIVE', 'PARTIALLY_UTILIZED') AND ps.validity_end BETWEEN ? AND ?
  `).all(today, horizon)) {
    push(s.validity_end, 'SECURITY_EXPIRY', `${s.mechanism_type === 'BANK_GUARANTEE' ? 'BG' : s.mechanism_type} ${s.instrument_no} expires`,
      `${s.contract_no}${s.party ? ` · ${s.party}` : ''} · ₹${Number(s.limit_amount || 0).toLocaleString('en-IN')}`, { ref: s.id, link: '/reia/payment-security' });
  }

  for (const a of db.prepare(`
    SELECT a.id, a.label, a.valid_until, e.name FROM entity_regulatory_approvals a JOIN entities e ON e.id = a.entity_id
    WHERE a.status = 'VERIFIED' AND substr(a.valid_until, 1, 10) BETWEEN ? AND ?
  `).all(today, horizon)) {
    push(a.valid_until, 'CLEARANCE_EXPIRY', `${a.label} lapses`, a.name, { ref: a.id, link: '/reia/entities' });
  }

  for (const c of db.prepare(`
    SELECT c.id, c.contract_no, c.contract_type, c.tenure_end, s.name AS seller, b.name AS buyer FROM contracts c
    LEFT JOIN entities s ON s.id = c.seller_id LEFT JOIN entities b ON b.id = c.buyer_id
    WHERE c.status IN (${LIVE.map(() => '?').join(',')}) AND substr(c.tenure_end, 1, 10) BETWEEN ? AND ?
  `).all(...LIVE, today, horizon)) {
    push(c.tenure_end, 'CONTRACT_END', `${c.contract_type} ${c.contract_no} ends`, c.contract_type === 'PSA' ? c.buyer : c.seller, { ref: c.id, link: '/reia/contracts' });
  }

  for (const b of db.prepare(`
    SELECT eb.contract_id, eb.cycle, eb.cycle_ends_on, c.contract_no, ROUND(SUM(eb.banked_mwh - eb.drawn_mwh), 3) AS open_mwh FROM energy_banking eb
    JOIN contracts c ON c.id = eb.contract_id
    WHERE eb.status IN ('OPEN', 'DRAWN') AND eb.cycle_ends_on BETWEEN ? AND ?
    GROUP BY eb.contract_id, eb.cycle, eb.cycle_ends_on
  `).all(today, horizon)) {
    push(b.cycle_ends_on, 'BANKING_CYCLE_END', `Banking cycle ${b.cycle} closes — ${b.contract_no}`, `${b.open_mwh} MWh still banked; unused energy settles in money after this date`,
      { ref: b.contract_id, link: '/reia/energy-banking' });
  }

  for (const d of db.prepare(`SELECT id, dispute_no, next_hearing, forum_case_no, escalation_forum FROM disputes WHERE status <> 'CLOSED' AND next_hearing BETWEEN ? AND ?`).all(today, horizon)) {
    push(d.next_hearing, 'HEARING', `Hearing — ${d.dispute_no}`, [d.escalation_forum, d.forum_case_no].filter(Boolean).join(' · ') || 'Forum hearing', { ref: d.id, link: '/reia/disputes' });
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  const byKind = Object.fromEntries(Object.keys(CALENDAR_KINDS).map((k) => [k, items.filter((i) => i.kind === k).length]));
  return {
    today, horizon, days, items, older_overdue: older, kinds: CALENDAR_KINDS,
    totals: { items: items.length, overdue: items.filter((i) => i.overdue).length, within_7_days: items.filter((i) => !i.overdue && i.days_left <= 7).length, by_kind: byKind },
  };
}
