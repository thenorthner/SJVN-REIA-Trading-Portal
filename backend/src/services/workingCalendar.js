/**
 * Working-day calendar.
 *
 * A payment cannot fall due on a day the paying party's office is shut, and
 * late-payment surcharge should not accrue for such a day either. Non-working
 * days are the weekly offs plus national holidays plus the holidays of the
 * counterparty's own state — every state keeps a different list, so the same
 * date can be a working day for one beneficiary and not for another.
 *
 * Two counting conventions are supported because contracts differ, and which
 * one applies is a commercial term rather than something to infer:
 *
 *   CALENDAR_ROLL_FORWARD  bill + N calendar days, then moved to the next
 *                          working day if it lands on a closed day
 *   WORKING_DAYS           N working days counted from the bill date
 *
 * On 45-day terms these differ by roughly three weeks, so the mode is a master
 * parameter and never a default buried in code.
 */
import db from '../db/index.js';
import { getParam, getParamNumber } from '../mastersService.js';

/** 0 = Sunday … 6 = Saturday, matching Date#getUTCDay. */
const DEFAULT_WEEKLY_OFF = [0, 6];

export function weeklyOffDays() {
  const raw = getParam('weekly_off_days', null);
  if (Array.isArray(raw)) {
    const clean = raw.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (clean.length) return clean;
  }
  return DEFAULT_WEEKLY_OFF;
}

export function isWeekend(date) {
  const d = parse(date);
  return weeklyOffDays().includes(d.getUTCDay());
}

/**
 * 'CALENDAR_ROLL_FORWARD' | 'WORKING_DAYS'
 *
 * Without the parameter, calendar days rolled forward: the LPS Rules 2022 put
 * the due date at the agreement's term or 45 days from presentation, and the
 * PPA/PSA "Business Day" clause (General Clauses Act s.10) moves only a last
 * day that falls on a closed day. The fallback used to be WORKING_DAYS, three
 * weeks later on 45-day terms than the seeded master says.
 */
export function dueDateMode() {
  const v = String(getParam('due_date_counting_mode', 'CALENDAR_ROLL_FORWARD')).toUpperCase();
  return v === 'WORKING_DAYS' ? 'WORKING_DAYS' : 'CALENDAR_ROLL_FORWARD';
}

/**
 * Whether surcharge skips the payer's non-working days.
 *
 * Off without the parameter: surcharge is for every day the money is late
 * (LPS Rules 2022 r.3), and the seeded master says CALENDAR.
 */
export function lpsCountsWorkingDaysOnly() {
  return String(getParam('lps_day_count_mode', 'CALENDAR')).toUpperCase() === 'WORKING_DAYS';
}

const iso = (d) => d.toISOString().slice(0, 10);

/**
 * Anything date-shaped to a UTC midnight Date.
 *
 * Accepts both a Date and an ISO string because the loops below step with Date
 * objects while callers pass strings; taking only one of the two silently
 * produced Invalid Date.
 */
const parse = (d) => {
  if (d instanceof Date) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
};

/**
 * Active holidays that close a state's offices, as a Set of ISO dates.
 *
 * A restricted (optional) holiday is left out: an employee may take it, but
 * the office and its bank stay open, so no payment period ends early or late
 * for one. The state is matched without regard to case, because entity and
 * holiday rows are typed by different people.
 *
 * Cached per state for the life of the process. Adding a holiday through the
 * masters screen clears it, so a newly entered date takes effect without a
 * restart.
 */
const holidayCache = new Map();

export function clearHolidayCache() {
  holidayCache.clear();
}

export function holidaySet(state) {
  const key = state ? String(state).trim().toLowerCase() : '__national__';
  if (holidayCache.has(key)) return holidayCache.get(key);

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT holiday_date FROM holidays
      WHERE is_active = 1 AND holiday_type <> 'RESTRICTED'
        AND (scope = 'NATIONAL' OR (scope = 'STATE' AND state = ? COLLATE NOCASE))
    `).all(state ? String(state).trim() : null);
  } catch {
    // Table not migrated yet — treat as no holidays rather than failing a bill.
    rows = [];
  }

  const set = new Set(rows.map((r) => String(r.holiday_date).slice(0, 10)));
  holidayCache.set(key, set);
  return set;
}

/** A working day is not a weekly off and not a holiday for that state. */
export function isWorkingDay(date, state) {
  const d = parse(date);
  if (weeklyOffDays().includes(d.getUTCDay())) return false;
  return !holidaySet(state).has(iso(d));
}

/** Why a date is closed — for showing the reason on screen, not for the maths. */
export function nonWorkingReason(date, state) {
  const d = parse(date);
  if (weeklyOffDays().includes(d.getUTCDay())) {
    return d.getUTCDay() === 0 ? 'Sunday' : 'Saturday';
  }
  const row = db.prepare(`
    SELECT name, scope, state FROM holidays
    WHERE is_active = 1 AND holiday_type <> 'RESTRICTED' AND holiday_date = ?
      AND (scope = 'NATIONAL' OR (scope = 'STATE' AND state = ? COLLATE NOCASE))
    ORDER BY scope DESC LIMIT 1
  `).get(iso(d), state ? String(state).trim() : null);
  return row ? `${row.name}${row.scope === 'STATE' ? ` (${row.state})` : ''}` : null;
}

/** Next working day on or after `date`. Returns `date` itself if it is one. */
export function rollForwardToWorkingDay(date, state) {
  let d = parse(date);
  // A year of closed days would mean the calendar is misconfigured; stop rather
  // than spin.
  for (let i = 0; i < 366; i += 1) {
    if (isWorkingDay(d, state)) return iso(d);
    d = new Date(d.getTime() + 86400000);
  }
  throw new Error(`No working day found within a year of ${iso(parse(date))} for state ${state || 'NATIONAL'}`);
}

/** `n` working days after `date`, skipping the payer's closed days. */
export function addWorkingDays(date, n, state) {
  let d = parse(date);
  let left = Math.max(0, Math.floor(Number(n) || 0));
  let guard = 0;
  while (left > 0) {
    d = new Date(d.getTime() + 86400000);
    if (isWorkingDay(d, state)) left -= 1;
    guard += 1;
    if (guard > 2000) throw new Error('addWorkingDays: calendar appears to have no working days');
  }
  return iso(d);
}

/** Working days strictly after `from`, up to and including `to`. Never negative. */
export function workingDaysBetween(from, to, state) {
  const start = parse(from);
  const end = parse(to);
  if (end <= start) return 0;
  let count = 0;
  let d = new Date(start.getTime() + 86400000);
  while (d <= end) {
    if (isWorkingDay(d, state)) count += 1;
    d = new Date(d.getTime() + 86400000);
  }
  return count;
}

/**
 * Due date for a bill, under whichever convention is configured.
 *
 * Returns the date plus how it was arrived at, so an invoice can show why it is
 * due when it is — "45 days, moved from Sat 15 Mar" is answerable, "23 Mar" on
 * its own is not.
 */
export function computeDueDateWorking(billDate, termsDays, state) {
  const mode = dueDateMode();
  const terms = Math.max(0, Math.floor(Number(termsDays) || 0));

  if (mode === 'WORKING_DAYS') {
    const due = addWorkingDays(billDate, terms, state);
    return { due_date: due, mode, terms_days: terms, state: state || null, shifted_from: null };
  }

  const plain = iso(new Date(parse(billDate).getTime() + terms * 86400000));
  const due = rollForwardToWorkingDay(plain, state);
  return {
    due_date: due,
    mode,
    terms_days: terms,
    state: state || null,
    shifted_from: due === plain ? null : plain,
    shifted_reason: due === plain ? null : nonWorkingReason(plain, state),
  };
}

/** The 28 states and 8 union territories, as holiday rows name them. */
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];
const STATE_ALIASES = {
  'J&K': 'Jammu and Kashmir', 'J & K': 'Jammu and Kashmir', 'NCT OF DELHI': 'Delhi', 'NEW DELHI': 'Delhi',
  ORISSA: 'Odisha', UTTARANCHAL: 'Uttarakhand', PONDICHERRY: 'Puducherry',
};

/** A state as written anywhere ("PUNJAB", "j&k") to its holiday-row name, or null. */
export function stateNamed(text) {
  const t = String(text || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!t) return null;
  return STATE_ALIASES[t] || INDIAN_STATES.find((s) => s.toUpperCase() === t) || null;
}

/**
 * SJVN's own calendar, for the bills SJVN pays: the state of its registered
 * office (Shimla), which is where its bank pays from. A master parameter, so a
 * desk paying from another office can change it.
 */
export function sjvnState() {
  return String(getParam('sjvn_payer_state', 'Himachal Pradesh') || '').trim() || null;
}

/**
 * The state whose calendar governs a bill on `contract` — the payer's.
 *
 * SJVN bills a buyer, so the buyer's state applies; a seller bills SJVN, so
 * SJVN's own state does. This used to take the seller's state for a seller's
 * bill: the party being paid, not the one paying. Without a direction the
 * contract says it — a PSA is SJVN selling, anything else SJVN buying.
 *
 * Falls back to null (national holidays only) when a buyer's state was never
 * captured, which is honest: no state calendar is assumed.
 */
export function payerStateFor(contract, direction = null) {
  if (!contract) return null;
  const dir = direction || (contract.contract_type === 'PSA' ? 'SJVN_TO_BUYER' : 'SELLER_TO_SJVN');
  if (dir !== 'SJVN_TO_BUYER') return sjvnState();
  let buyerId = contract.buyer_id;
  if (buyerId === undefined && contract.id) {
    buyerId = db.prepare('SELECT buyer_id FROM contracts WHERE id = ?').get(contract.id)?.buyer_id;
  }
  if (!buyerId) return null;
  return db.prepare('SELECT state FROM entities WHERE id = ?').get(buyerId)?.state || null;
}

/** The payer's state for an invoice — see payerStateFor. */
export function payerStateForInvoice(invoice) {
  if (!invoice?.contract_id) return null;
  const contract = db.prepare('SELECT id, buyer_id, seller_id, contract_type FROM contracts WHERE id = ?').get(invoice.contract_id);
  if (!contract) return null;
  return payerStateFor(contract, invoice.direction || null);
}

/**
 * Last day of a window of `days` from `from` (a rebate window), on the payer's
 * calendar: counted in calendar days as CERC's tariff regulations and the PSAs
 * write it ("within 5 days of presentation"), and moved to the next working
 * day if it ends on a closed one — the same rule as the due date, so a buyer
 * whose fifth day is a Sunday or its state's holiday can still earn the rebate
 * the next morning.
 */
export function windowEnd(from, days, state) {
  const n = Math.max(0, Math.floor(Number(days) || 0));
  return rollForwardToWorkingDay(iso(new Date(parse(from).getTime() + n * 86400000)), state);
}

/** Whether a payment on `payDate` falls inside that window. */
export function paidWithinWindow(from, days, payDate, state) {
  if (!from || !payDate) return false;
  return iso(parse(payDate)) <= windowEnd(from, days, state);
}

/** Days that count towards surcharge between the due date and `asOf`. */
export function surchargeDays(dueDate, asOf, state) {
  if (!dueDate) return 0;
  if (!lpsCountsWorkingDaysOnly()) {
    const diff = Math.floor((parse(asOf) - parse(dueDate)) / 86400000);
    return Math.max(0, diff);
  }
  return workingDaysBetween(dueDate, asOf, state);
}

export default {
  weeklyOffDays,
  dueDateMode,
  lpsCountsWorkingDaysOnly,
  isWeekend,
  holidaySet,
  clearHolidayCache,
  isWorkingDay,
  nonWorkingReason,
  rollForwardToWorkingDay,
  addWorkingDays,
  workingDaysBetween,
  computeDueDateWorking,
  stateNamed,
  sjvnState,
  payerStateFor,
  payerStateForInvoice,
  windowEnd,
  paidWithinWindow,
  surchargeDays,
};
