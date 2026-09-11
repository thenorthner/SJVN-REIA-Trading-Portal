import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import db from './db/index.js';
import { computeDueDateWorking } from './services/workingCalendar.js';

/**
 * Primary key for a new row.
 *
 * This took the first 8 hex characters of a UUID — 32 bits, about 4.3 billion
 * values. That sounds like plenty and is not: by the birthday bound a single
 * table has an even chance of holding two identical ids by around 77,000 rows,
 * and is essentially certain to by 200,000. These are PRIMARY KEY columns, so
 * the collision does not show up as a duplicate row — the INSERT is rejected
 * and whatever the user was doing fails.
 *
 * audit_logs makes that concrete: a row per action, never pruned, and the
 * insert happens inside the route's own transaction. Once that table passes
 * roughly 77,000 rows — months of ordinary use — raising an invoice or
 * approving a contract starts failing at random, more and more often as the
 * history grows, for a reason that looks like nothing to do with invoices.
 *
 * Sixteen characters is 64 bits: an even chance of a collision needs about five
 * billion rows in one table, which this platform will not reach. Ids already
 * issued are eight characters long and can never equal a sixteen-character one,
 * so old and new rows coexist safely.
 */
export const newId = (prefix) => `${prefix}-${uuidv4().replace(/-/g, '').slice(0, 16)}`;

// ── Invoice verification (QR-code authenticity) ──────────────────────────────
// A short HMAC of the invoice id. Printed into the QR so the public /verify
// page can prove the scanned bill was genuinely issued by this platform and
// was not forged. Uses the same secret as auth tokens.
const VERIFY_SECRET = process.env.JWT_SECRET || 'sjvn-dev-secret-change-me';

export function invoiceVerifyToken(invoiceId) {
  return crypto.createHmac('sha256', VERIFY_SECRET).update(`invoice:${invoiceId}`).digest('hex').slice(0, 16);
}

export function verifyInvoiceToken(invoiceId, token) {
  if (!token) return false;
  const expected = invoiceVerifyToken(invoiceId);
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');

import { secureLogAudit } from './auditEngine.js';

export function logAudit({ req, user, action, module, entityType, entityId, beforeValue, afterValue, reason, details }) {
  secureLogAudit(req || { user }, {
    action,
    module,
    entityType,
    entityId,
    beforeValue,
    afterValue,
    reason,
    details
  });
}

export function pushNotification({ userId = null, role = null, type, message }) {
  const stmt = db.prepare(`
    INSERT INTO notifications (id, user_id, role, type, message)
    VALUES (@id, @userId, @role, @type, @message)
  `);
  stmt.run({ id: newId('NTF'), userId, role, type, message });
}

/**
 * The next document number in a series — invoices, debit and credit notes,
 * generator bills, hydro station bills, DSM settlements.
 *
 * This drew six random digits, which is 900,000 possible numbers per series per
 * year. Nine of the columns it feeds are declared UNIQUE, so a repeat is not a
 * cosmetic duplicate: the INSERT is rejected, the request fails with a 500, and
 * the invoice simply does not get raised. And a repeat is not a remote
 * possibility — by the birthday bound, a series issuing 1,000 documents in a
 * year has already about a 42% chance of having drawn the same number twice,
 * and 2,000 documents makes it about 89%. One caller had noticed and wrapped
 * the call in a retry loop; the other eleven had not.
 *
 * So the number comes from a register instead, through the same atomic
 * read-and-increment already used for the SJVN invoice series. Two documents
 * cannot be handed the same number, and the numbers now run in order, which is
 * what an auditor expects of a document series anyway.
 *
 * The sequence starts at 1 and is padded to six digits, so the numbers it
 * issues (000001 upward) cannot collide with the ones already issued by the old
 * random draw, which were all 100000 or above.
 */
export function genInvoiceNo(prefix = 'INV') {
  const year = new Date().getFullYear();
  const seq = nextInvoiceSeq(prefix, String(year));
  return `${prefix}/${year}/${String(seq).padStart(6, '0')}`;
}

// Short uppercase code for a client, used inside the SJVN invoice number. Takes
// the first meaningful word so "Kreate Energy India Pvt Ltd" -> "KREATE" and
// "ABC Trading Client" -> "ABC". Legal-form words are skipped.
export function deriveClientCode(clientName) {
  const SKIP = new Set(['MS', 'THE']);
  const words = String(clientName || 'CLIENT')
    .replace(/^\s*m\/s\.?\s*/i, ' ')          // drop a leading "M/s" honorific first
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    // Keep only real words: skip legal honorifics and stray single letters left
    // behind by punctuation (e.g. the "S" from "M/s").
    .split(/\s+/)
    .filter(w => w.length > 1 && !SKIP.has(w));
  return (words[0] || 'CLIENT').slice(0, 12);
}

// Normalise a billing period to YYYYMM: accepts "2026-05", "202605", a Date, or
// an ISO date string.
function toYyyyMm(period) {
  if (!period) return new Date().toISOString().slice(0, 7).replace('-', '');
  const s = String(period);
  const m = s.match(/(\d{4})[-/]?(\d{2})/);
  if (m) return `${m[1]}${m[2]}`;
  return new Date().toISOString().slice(0, 7).replace('-', '');
}

// Atomically take the next number in a per-series, per-client register. The read
// and increment run in one transaction so concurrent invoice generation can never
// hand out the same sequence twice.
function nextInvoiceSeq(seriesType, clientCode) {
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT id, next_seq FROM invoice_counters WHERE series_type = ? AND client_code = ?').get(seriesType, clientCode);
    if (!row) {
      db.prepare('INSERT INTO invoice_counters (id, series_type, client_code, next_seq) VALUES (?, ?, ?, ?)').run(newId('ICN'), seriesType, clientCode, 2);
      return 1;
    }
    db.prepare('UPDATE invoice_counters SET next_seq = next_seq + 1 WHERE id = ?').run(row.id);
    return row.next_seq;
  });
  return tx();
}

/**
 * The next number in any document series, taken from the same register.
 *
 * `seriesType` names the series (a prefix such as 'DSP' or 'RCN'); `scope`
 * separates registers that restart independently — normally the year.
 *
 * Exposed because several modules mint their own document numbers and every one
 * of them writes into a column declared UNIQUE. A number drawn at random is a
 * failed INSERT waiting to happen; a number drawn from here cannot repeat.
 */
export function nextSeriesNo(seriesType, scope) {
  return nextInvoiceSeq(seriesType, String(scope));
}

// Continue the ISET ledger's real registers: the last issued Kreate numbers were
// ENERGY 145 and OA 265, so the next generated invoices pick up at 146 / 266.
// Idempotent — only seeds a counter that does not exist yet.
export function seedInvoiceCounters() {
  const seeds = [
    { series_type: 'ENERGY', client_code: 'KREATE', next_seq: 146 },
    { series_type: 'OA', client_code: 'KREATE', next_seq: 266 },
  ];
  const has = db.prepare('SELECT 1 FROM invoice_counters WHERE series_type = ? AND client_code = ?');
  const ins = db.prepare('INSERT INTO invoice_counters (id, series_type, client_code, next_seq) VALUES (?, ?, ?, ?)');
  for (const s of seeds) {
    if (!has.get(s.series_type, s.client_code)) ins.run(newId('ICN'), s.series_type, s.client_code, s.next_seq);
  }
}

// NOAR open-access application number: SJVN<DDMMYY><REGION><SEQ>, e.g.
// SJVN010426WR2354 — 1 April 2026, Western Region, running serial 2354. The
// serial is a single register per region that runs on across dates (the ledger
// goes 2354 to 2850 over four months), so it is counted the same way invoice
// numbers are. The ledger's last issued number was WR2850, so a fresh register
// picks up at 2851.
const NOAR_SERIES = 'NOAR_APP';
const NOAR_SEED = { WR: 2851 };

export function seedApplicationCounters() {
  const has = db.prepare('SELECT 1 FROM invoice_counters WHERE series_type = ? AND client_code = ?');
  const ins = db.prepare('INSERT INTO invoice_counters (id, series_type, client_code, next_seq) VALUES (?, ?, ?, ?)');
  for (const [region, seq] of Object.entries(NOAR_SEED)) {
    if (!has.get(NOAR_SERIES, region)) ins.run(newId('ICN'), NOAR_SERIES, region, seq);
  }
}

export function genApplicationNo(applicationDate, region = 'WR') {
  const d = applicationDate ? new Date(applicationDate) : new Date();
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid application date: ${applicationDate}`);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(d.getUTCFullYear()).slice(-2);
  const reg = String(region || 'WR').toUpperCase();
  const seq = nextInvoiceSeq(NOAR_SERIES, reg);
  return `SJVN${dd}${mm}${yy}${reg}${seq}`;
}

// The code a trading client bills under. An explicit short_code on the linked
// entity wins — the desk calls Gujarat Alkalies "GACL", not "GUJARAT", and the
// first word of a legal name is often not the trading name. Falls back to
// deriving one from the name.
export function clientCodeFor(clientId) {
  const row = db.prepare(`
    SELECT tc.name AS client_name, e.short_code
    FROM trading_clients tc
    LEFT JOIN entities e ON e.id = tc.entity_id
    WHERE tc.id = ?
  `).get(clientId);
  if (!row) return null;
  const code = row.short_code && String(row.short_code).trim();
  return code ? code.toUpperCase().slice(0, 12) : deriveClientCode(row.client_name);
}

// The official SJVN invoice number: SJVN/{ENERGY|OA|MARGIN}/{CLIENT}/{YYYYMM}/{SEQ}
// e.g. SJVN/ENERGY/KREATE/202605/144. seriesType selects the register; each
// series keeps its own running sequence per client (see invoice_counters).
export function genSjvnInvoiceNo(seriesType, clientName, billingPeriod) {
  const series = String(seriesType || 'ENERGY').toUpperCase();
  const clientCode = deriveClientCode(clientName);
  const period = toYyyyMm(billingPeriod);
  const seq = nextInvoiceSeq(series, clientCode);
  return `SJVN/${series}/${clientCode}/${period}/${seq}`;
}

/** Sanitize contract_no for use inside Billing Family Reference paths. */
export function sanitizeContractNo(contractNo) {
  return String(contractNo || 'UNKNOWN')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase() || 'UNKNOWN';
}

/** Map invoice direction to BFR suffix. */
export function directionCode(direction) {
  return direction === 'SJVN_TO_BUYER' ? 'S2B' : 'S2S';
}

/**
 * Stable Billing Family Reference linking provisional energy → invoice → payments → final.
 * Format: BFR/{CONTRACT_NO}/{YYYY-MM}/{S2S|S2B}
 */
export function buildBillingFamilyRef(contractNo, periodMonth, direction = 'SELLER_TO_SJVN') {
  return `BFR/${sanitizeContractNo(contractNo)}/${periodMonth}/${directionCode(direction)}`;
}

/** Direction implied by contract type (PPA = seller bills, PSA = SJVN→buyer). */
export function directionForContract(contract) {
  return contract?.contract_type === 'PSA' ? 'SJVN_TO_BUYER' : 'SELLER_TO_SJVN';
}

/* ─────────── Structured billing-rule helpers ───────────
 * The contract carries machine-readable fields (payment_terms_days, rebate_pct,
 * rebate_days, rebate_basis, lps_annual_pct, lps_grace_days). These helpers turn
 * them into due dates, rebate eligibility and human-readable strings so the
 * billing engine and the UI stay in sync.
 */

/** Payment-terms days: structured field → legacy text regex → default (30). */
export function resolvePaymentTermsDays(contract, fallback = 30) {
  if (contract?.payment_terms_days != null && contract.payment_terms_days !== '') {
    return Number(contract.payment_terms_days);
  }
  const m = String(contract?.payment_terms || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : fallback;
}

/** Add whole days to a date and return an ISO YYYY-MM-DD string. */
export function addDays(baseDate, days) {
  const d = baseDate ? new Date(baseDate) : new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().split('T')[0];
}

/**
 * Due date = bill date + payment terms, on the payer's working calendar.
 *
 * `state` is the paying party's state; without it only weekly offs and national
 * holidays apply. Which counting convention is used comes from the
 * due_date_counting_mode parameter — see services/workingCalendar.js.
 *
 * Returns just the date, so existing callers are unaffected. Use
 * computeDueDateDetailed when the invoice needs to explain the date it shows.
 */
/**
 * The capacity a contract should actually be billed and judged on.
 *
 * A plant commissioned in phases has contracted capacity it is not yet
 * generating from. commissioned_capacity_mw records that, and until now nothing
 * read it: energy validation benchmarked expected output against the full
 * contracted MW, so a 10 MW plant filing a month's output for 25 MW passed as
 * clean, and the bill went out on it.
 *
 * Falls back to contracted capacity, which is the right answer for the ordinary
 * case where the whole plant is live and the column is simply not set.
 */
/**
 * The decision on an approve/reject endpoint, or a refusal.
 *
 * Every route taking one branched as `if (decision === 'REJECTED') { reject }
 * else { approve }`, so anything that was not exactly that string approved:
 * a lowercase "rejected", a typo, a field left out of the body. On the invoice
 * approval route that meant a bill going APPROVED while its own approval row
 * recorded the rejection someone had actually sent — the two disagreeing inside
 * one request. Approving by default is the wrong default for a control whose
 * entire job is to be an explicit act.
 *
 * Returns null when the value is good, or a message naming what was allowed.
 */
export function invalidDecision(decision, allowed = ['APPROVED', 'REJECTED']) {
  if (decision === undefined || decision === null || String(decision).trim() === '') {
    return `decision is required and must be one of: ${allowed.join(', ')}`;
  }
  if (!allowed.includes(decision)) {
    return `"${decision}" is not a decision. Use one of: ${allowed.join(', ')}`;
  }
  return null;
}

export function billableCapacityMw(contract) {
  const commissioned = Number(contract?.commissioned_capacity_mw);
  if (Number.isFinite(commissioned) && commissioned > 0) return commissioned;
  return Number(contract?.capacity_mw) || 0;
}

export function computeDueDate(billDate, contract, fallback = 30, state = null) {
  return computeDueDateDetailed(billDate, contract, fallback, state).due_date;
}

export function computeDueDateDetailed(billDate, contract, fallback = 30, state = null) {
  const terms = resolvePaymentTermsDays(contract, fallback);
  return computeDueDateWorking(billDate, terms, state);
}

/**
 * Early-payment rebate % this contract grants if paid by `payDate`.
 * Deadline = (rebate_basis === 'DUE_DATE' ? dueDate : billDate) + rebate_days.
 * Returns null when the contract defines no structured rebate (caller can fall
 * back to global master params).
 */
export function contractRebatePct(contract, { billDate, dueDate, payDate }) {
  const pct = Number(contract?.rebate_pct);
  if (!pct || pct <= 0) return null;
  const days = Number(contract?.rebate_days || 0);
  const ref = contract?.rebate_basis === 'DUE_DATE' ? dueDate : billDate;
  if (!ref) return null;
  const deadline = new Date(addDays(ref, days) + 'T23:59:59');
  return new Date(payDate) <= deadline ? pct : 0;
}

/** Human strings kept in sync with the structured fields (for display / PDF). */
export function humanizePaymentTerms(days) {
  return days ? `Net ${days} days from bill date` : '';
}
export function humanizeRebateRule({ rebate_pct, rebate_days, rebate_basis }) {
  if (!rebate_pct) return '';
  const ref = rebate_basis === 'DUE_DATE' ? 'due date' : 'bill date';
  return `${rebate_pct}% if paid within ${rebate_days || 0} days from ${ref}`;
}
export function humanizeLpsRule({ lps_annual_pct, lps_grace_days }) {
  if (!lps_annual_pct) return '';
  const grace = lps_grace_days ? `, ${lps_grace_days}-day grace` : '';
  return `${lps_annual_pct}% per annum on overdue amount${grace}`;
}
