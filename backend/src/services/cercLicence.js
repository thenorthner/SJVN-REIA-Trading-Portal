/**
 * The two things a trading licence owes the Commission every year that are not
 * a return: the annual licence fee, and proof the licensee still has the net
 * worth its category requires.
 *
 * Neither comes out of trade data, so both are recorded by hand against the
 * financial year and this works out where each year stands:
 *
 *  - The licence fee for a financial year is payable by 30 April of that year
 *    (CERC Payment of Fees Regulations). The amount is fixed by licence
 *    category, not computed from volume — volume decides the category. It is a
 *    master parameter because the Commission revises the schedule.
 *  - Net worth must stay at or above the category minimum. The figure recorded
 *    here is the one on the auditor's certificate.
 *
 * Held to what was recorded (17-Oct-2026 audit): a year read "Paid" on any
 * payment date — one in the future, ₹1 against ₹40 lakh, or one paid five
 * months late — and "Meets minimum" on a certificate as on 2019. A payment now
 * reads paid, paid late or short; a certificate older than the last two
 * balance-sheet dates is stale; dates in the future, and years beyond the next,
 * are refused.
 */
import db from '../db/index.js';
import { getParam, getParamNumber } from '../mastersService.js';
import { financialYear } from './cercCompliance.js';

const FY_RE = /^(\d{4})-(\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d) => d.toISOString().slice(0, 10);

const fyOfStartYear = (y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;

function assertFy(fy, today) {
  const m = FY_RE.exec(String(fy || ''));
  if (!m || Number(m[2]) !== (Number(m[1]) + 1) % 100) {
    throw new Error('Financial year must look like 2026-27');
  }
  const start = Number(m[1]);
  const current = Number(financialYear(today.slice(0, 7)).slice(0, 4));
  // The tracker lists up to the current year, and the fee for the next one may
  // be paid ahead of it; anything later was stored and never shown.
  if (start > current + 1) throw new Error(`FY ${fy} is beyond the next financial year (${fyOfStartYear(current + 1)}).`);
  if (start < 2000) throw new Error(`FY ${fy} is before this licence's records could start.`);
  return start;
}

/** Energy on the Form-IV returns of a financial year, in MU — the volume the category limit is read against. */
function tradedVolumeMu(startYear) {
  const annual = db.prepare("SELECT total_volume_mu FROM cerc_form_iv WHERE period_type = 'ANNUAL' AND period = ?")
    .get(fyOfStartYear(startYear));
  if (annual) return annual.total_volume_mu;
  const monthly = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(total_volume_mu), 0) AS v FROM cerc_form_iv
    WHERE period_type = 'MONTHLY' AND period >= ? AND period <= ?
  `).get(`${startYear}-04`, `${startYear + 1}-03`);
  return monthly.n ? monthly.v : null;
}

function firstStartYear() {
  const candidates = [
    db.prepare("SELECT MIN(substr(delivery_date, 1, 7)) AS m FROM bids WHERE delivery_date IS NOT NULL").get()?.m,
    db.prepare("SELECT MIN(substr(start_date, 1, 7)) AS m FROM bilateral_transactions WHERE start_date IS NOT NULL").get()?.m,
  ].filter((m) => /^\d{4}-\d{2}$/.test(String(m || '')));
  const stored = db.prepare('SELECT MIN(fy) AS fy FROM cerc_licence_compliance').get()?.fy;
  const years = candidates.map((m) => Number(financialYear(m).slice(0, 4)));
  if (stored) years.push(Number(stored.slice(0, 4)));
  return years.length ? Math.min(...years) : null;
}

export function licenceCompliance({ asOf = new Date() } = {}) {
  const today = iso(asOf);
  const currentStart = Number(financialYear(today.slice(0, 7)).slice(0, 4));
  const first = Math.min(firstStartYear() ?? currentStart, currentStart);

  const feeDue = getParamNumber('cerc_licence_fee_lakh', 40) * 1e5;
  const minNetWorth = getParamNumber('cerc_min_net_worth_cr', 50);
  const stored = new Map(db.prepare('SELECT * FROM cerc_licence_compliance').all().map((r) => [r.fy, r]));

  const years = [];
  for (let y = currentStart; y >= first; y -= 1) {
    const fy = fyOfStartYear(y);
    const row = stored.get(fy) || {};
    const dueDate = `${y}-04-30`;
    const shortBy = row.fee_paid_on ? Math.max(0, Math.round(feeDue - (Number(row.fee_amount) || 0))) : 0;
    const daysLate = row.fee_paid_on && row.fee_paid_on > dueDate
      ? Math.floor((new Date(`${row.fee_paid_on}T00:00:00Z`) - new Date(`${dueDate}T00:00:00Z`)) / 86400000)
      : 0;
    let feeStatus;
    if (!row.fee_paid_on) feeStatus = dueDate < today ? 'OVERDUE' : 'DUE';
    else if (shortBy > 0) feeStatus = 'SHORT';
    else if (daysLate > 0) feeStatus = 'PAID_LATE';
    else feeStatus = 'PAID';
    // The certificate for a year is on the last audited balance sheet: 31 March
    // before the year, or the one before that while the audit is still out.
    const staleBefore = `${y - 1}-03-31`;
    let netWorthStatus;
    if (row.net_worth_cr == null) netWorthStatus = 'PENDING';
    else if (!row.net_worth_as_on || row.net_worth_as_on < staleBefore) netWorthStatus = 'STALE';
    else netWorthStatus = row.net_worth_cr >= minNetWorth ? 'COMPLIANT' : 'SHORTFALL';

    years.push({
      fy,
      is_current: y === currentStart,
      fee_due_date: dueDate,
      fee_amount_due: feeDue,
      fee_amount: row.fee_amount ?? null,
      fee_paid_on: row.fee_paid_on || null,
      fee_reference: row.fee_reference || null,
      fee_status: feeStatus,
      fee_short_by: shortBy,
      fee_days_late: daysLate,
      fee_days_past_due: (feeStatus === 'OVERDUE' || feeStatus === 'SHORT') && dueDate < today
        ? Math.floor((new Date(`${today}T00:00:00Z`) - new Date(`${dueDate}T00:00:00Z`)) / 86400000)
        : 0,
      min_net_worth_cr: minNetWorth,
      net_worth_cr: row.net_worth_cr ?? null,
      net_worth_as_on: row.net_worth_as_on || null,
      certificate_ref: row.certificate_ref || null,
      certificate_filed_on: row.certificate_filed_on || null,
      net_worth_status: netWorthStatus,
      net_worth_stale_before: staleBefore,
      // The year before is the volume this year's category was judged on.
      prev_fy_volume_mu: tradedVolumeMu(y - 1),
      volume_mu: tradedVolumeMu(y),
      notes: row.notes || null,
      updated_by: row.updated_by || null,
      updated_at: row.updated_at || null,
    });
  }

  // The fee for the year about to start falls due inside the year that is ending.
  const nextDue = `${currentStart + 1}-04-30`;
  const daysToNext = Math.floor((new Date(`${nextDue}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);

  return {
    today,
    category: getParam('cerc_licence_category', 'I') || 'I',
    licensee: getParam('cerc_licensee_name', 'SJVN Limited') || 'SJVN Limited',
    licence_details: getParam('cerc_licence_details', '') || '',
    fee_amount_due: feeDue,
    min_net_worth_cr: minNetWorth,
    next_fee: { fy: fyOfStartYear(currentStart + 1), due_date: nextDue, days_left: daysToNext },
    totals: {
      // A part-paid fee past its date is as unpaid as one never paid.
      fee_overdue: years.filter((r) => r.fee_status === 'OVERDUE' || (r.fee_status === 'SHORT' && r.fee_due_date < today)).length,
      fee_paid_late: years.filter((r) => r.fee_status === 'PAID_LATE').length,
      net_worth_pending: years.filter((r) => r.net_worth_status === 'PENDING' || r.net_worth_status === 'STALE').length,
      net_worth_shortfall: years.filter((r) => r.net_worth_status === 'SHORTFALL').length,
    },
    years,
  };
}

const optionalDate = (v, label, today) => {
  if (v == null || v === '') return null;
  if (!DATE_RE.test(String(v)) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) throw new Error(`${label} must be a date (YYYY-MM-DD)`);
  if (today && String(v) > today) throw new Error(`${label} (${v}) is in the future.`);
  return String(v);
};

const optionalAmount = (v, label) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a number, zero or more`);
  return n;
};

/** Record (or correct) what was paid and certified for one financial year. */
export function saveLicenceYear(fy, body, userName, { asOf = new Date() } = {}) {
  const today = iso(asOf);
  assertFy(fy, today);
  const row = {
    fy,
    fee_amount: optionalAmount(body.fee_amount, 'Fee paid'),
    fee_paid_on: optionalDate(body.fee_paid_on, 'Fee payment date', today),
    fee_reference: body.fee_reference ? String(body.fee_reference).trim() : null,
    net_worth_cr: optionalAmount(body.net_worth_cr, 'Net worth'),
    net_worth_as_on: optionalDate(body.net_worth_as_on, 'Net worth date', today),
    certificate_ref: body.certificate_ref ? String(body.certificate_ref).trim() : null,
    certificate_filed_on: optionalDate(body.certificate_filed_on, 'Certificate filing date', today),
    notes: body.notes ? String(body.notes).trim() : null,
    updated_by: userName || null,
  };
  // A payment date with nothing to tie it to cannot be checked later.
  if (row.fee_paid_on && !row.fee_reference) {
    throw new Error('Record the payment reference (UTR / receipt no.) along with the payment date.');
  }
  if (row.fee_paid_on && !(row.fee_amount > 0)) {
    throw new Error('Record the amount paid along with the payment date.');
  }
  if (row.net_worth_cr != null && !row.net_worth_as_on) {
    throw new Error('Record the date the net worth is certified as on (the balance-sheet date).');
  }

  db.prepare(`
    INSERT INTO cerc_licence_compliance (fy, fee_amount, fee_paid_on, fee_reference, net_worth_cr, net_worth_as_on,
      certificate_ref, certificate_filed_on, notes, updated_by, updated_at)
    VALUES (@fy, @fee_amount, @fee_paid_on, @fee_reference, @net_worth_cr, @net_worth_as_on,
      @certificate_ref, @certificate_filed_on, @notes, @updated_by, datetime('now'))
    ON CONFLICT(fy) DO UPDATE SET fee_amount=excluded.fee_amount, fee_paid_on=excluded.fee_paid_on,
      fee_reference=excluded.fee_reference, net_worth_cr=excluded.net_worth_cr,
      net_worth_as_on=excluded.net_worth_as_on, certificate_ref=excluded.certificate_ref,
      certificate_filed_on=excluded.certificate_filed_on, notes=excluded.notes,
      updated_by=excluded.updated_by, updated_at=datetime('now')
  `).run(row);
  return db.prepare('SELECT * FROM cerc_licence_compliance WHERE fy = ?').get(fy);
}
