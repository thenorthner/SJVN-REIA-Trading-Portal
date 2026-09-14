import db from '../db/index.js';
import { resolvePeriod, dueDateFor } from './cercFormIv.js';

/**
 * The CERC filing calendar: every period that should have a return, and where
 * each one stands.
 *
 * The Form-IV register answers "what have we prepared" — which is a different
 * question from "what do we owe the Commission". A month nobody started has no
 * row, so a register alone shows a clean sheet for exactly the months that are
 * the problem. This walks the calendar instead: from the first month the platform
 * has trading data for up to the last completed period, and marks each one
 * filed, prepared, drafted, or missing, with its deadline and whether that
 * deadline has passed.
 */

const iso = (d) => d.toISOString().slice(0, 10);
const monthKey = (d) => iso(d).slice(0, 7);

/** The financial year a month belongs to: April to March, named 2026-27. */
export function financialYear(month) {
  const [y, m] = String(month).split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Every month from `first` to `last` inclusive, as YYYY-MM. */
function monthsBetween(first, last) {
  const out = [];
  const [fy, fm] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  let y = fy;
  let m = fm;
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** The earliest month the platform has anything to report on. */
function earliestReportableMonth() {
  const candidates = [
    db.prepare("SELECT MIN(substr(delivery_date, 1, 7)) AS m FROM bids WHERE delivery_date IS NOT NULL").get()?.m,
    db.prepare("SELECT MIN(substr(start_date, 1, 7)) AS m FROM bilateral_transactions WHERE start_date IS NOT NULL").get()?.m,
    db.prepare('SELECT MIN(period) AS m FROM cerc_form_iv').get()?.m,
  ].filter(Boolean).map((m) => String(m).slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m));
  return candidates.length ? candidates.sort()[0] : null;
}

export function cercCompliance({ from = null, to = null, asOf = new Date() } = {}) {
  // Only completed periods are owed: this month is not late until it ends.
  const lastComplete = monthKey(new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 0)));
  const first = from || earliestReportableMonth();
  const last = to || lastComplete;

  if (!first) {
    return {
      from: null, to: lastComplete, today: iso(asOf),
      totals: { expected: 0, submitted: 0, prepared: 0, draft: 0, missing: 0, overdue: 0, open_breaches: 0 },
      monthly: [], annual: [],
      note: 'Nothing has been traded yet, so no return is owed.',
    };
  }

  const filings = db.prepare('SELECT * FROM cerc_form_iv').all();
  const byPeriod = new Map(filings.map((f) => [`${f.period_type}|${f.period}`, f]));
  const todayIso = iso(asOf);

  const describe = (periodType, period) => {
    const bounds = resolvePeriod(periodType, period);
    const filing = byPeriod.get(`${periodType}|${period}`) || null;
    const due = filing?.due_date || dueDateFor(bounds.to);
    const status = filing ? filing.status : 'MISSING';
    const overdue = status !== 'SUBMITTED' && !!due && due < todayIso;
    return {
      period_type: periodType,
      period,
      period_from: bounds.from,
      period_to: bounds.to,
      due_date: due,
      status,
      overdue,
      days_past_due: overdue
        ? Math.floor((new Date(`${todayIso}T00:00:00Z`) - new Date(`${due}T00:00:00Z`)) / 86400000)
        : 0,
      form_no: filing?.form_no || null,
      submission_date: filing?.submission_date || null,
      reference_no: filing?.reference_no || null,
      total_volume_mu: filing?.total_volume_mu ?? null,
      trading_margin: filing?.trading_margin ?? null,
      line_count: filing?.line_count ?? null,
      // Transactions over the CERC margin cap: the thing a filing can be on time
      // and still be in trouble about.
      breach_count: filing?.breach_count ?? 0,
    };
  };

  const monthly = monthsBetween(first, last <= lastComplete ? last : lastComplete)
    .map((period) => describe('MONTHLY', period))
    .reverse();

  // A financial year is owed once it has ended.
  const years = [...new Set(monthly.map((m) => financialYear(m.period)))];
  const annual = years
    .filter((fy) => {
      const endYear = Number(fy.split('-')[0]) + 1;
      return `${endYear}-03` <= lastComplete;
    })
    .map((fy) => describe('ANNUAL', fy))
    .sort((a, b) => b.period.localeCompare(a.period));

  const all = [...monthly, ...annual];
  const count = (status) => all.filter((r) => r.status === status).length;

  return {
    from: monthly.length ? monthly[monthly.length - 1].period : null,
    to: monthly.length ? monthly[0].period : null,
    today: todayIso,
    totals: {
      expected: all.length,
      submitted: count('SUBMITTED'),
      prepared: count('PREPARED'),
      draft: count('DRAFT'),
      missing: count('MISSING'),
      overdue: all.filter((r) => r.overdue).length,
      open_breaches: all.reduce((a, r) => a + (r.breach_count || 0), 0),
    },
    monthly,
    annual,
    note: null,
  };
}
