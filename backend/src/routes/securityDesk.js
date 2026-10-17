/**
 * The paperwork side of payment security.
 *
 * routes/paymentSecurity.js keeps the money: limits, draws, coverage, the
 * invocation waterfall. This is what a guarantee is as a document that a bank
 * issued and can change:
 *
 *   expiry      how close each instrument is to lapsing, and a reminder to the
 *               counterparty that holds the other end of it
 *   SFMS        the bank's own advice to SJVN's bank (MT760 for an issue, MT767
 *               for an amendment) — the thing that makes a guarantee real
 *   vault       the scanned guarantee or e-BG itself
 *   amendments  each change the bank made after issue, in order, so the record
 *               reads Original -> Amendment 1 -> Amendment 2
 *   SJVN's LCs  the other direction: the letter of credit SJVN opens in a
 *               seller's favour under a PPA
 *
 * A counterparty submits; SJVN takes it on record. Nothing a counterparty types
 * here counts as cover until SJVN has accepted it.
 */
import { Router } from 'express';
import XLSX from 'xlsx';
import db from '../db/index.js';
import { requireAuth, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { newId, pushNotification, nextSeriesNo } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { getParamNumber } from '../mastersService.js';
import {
  recordSecurityEvent, syncInstrumentAvailable, computeCoverage, trailingMonthlyBilledAvg, estimatedMonthlyBill, releasePosition,
} from '../paymentSecurityEngine.js';
import { genInstrumentNo, WATERFALL_DEFAULTS, dayInWords, datesInWords } from '../paymentSecurityConstants.js';

const router = Router();
router.use(requireAuth);

const INTERNAL_READ = [...new Set([...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR'])];
const canManage = (user) => ROLE_GROUPS.REIA_WRITE.includes(user?.role);
/** Opening and amending SJVN's own letters of credit is Finance's work as much as the desk's. */
const canManageLc = (user) => canManage(user) || user?.role === 'FINANCE_USER';
const sideOf = (user) => counterpartySide(user) || (INTERNAL_READ.includes(user?.role) ? 'SJVN' : null);

const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, fn) => {
  try {
    res.json(fn());
  } catch (err) {
    if (!err.status) console.error('[SECURITY-DESK]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
};
const audit = (req, action, entityType, entityId, extra = {}) => {
  try {
    secureLogAudit(req, { action, module: 'REIA', entityType, entityId, ...extra });
  } catch (err) {
    console.error('[SECURITY-DESK] audit failed', err.message);
  }
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const daysUntil = (iso) => Math.round((new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) - new Date(`${today()}T00:00:00Z`)) / 86400000);
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const dayOrNull = (v, label) => {
  const s = text(v, 10);
  if (!s) return null;
  if (!DAY.test(s)) throw fail(400, `${label} must be a date (YYYY-MM-DD)`);
  return s;
};
const money = (v, label) => {
  const n = Number(v);
  if (!(n > 0)) throw fail(400, `${label} must be more than zero`);
  return Math.round(n * 100) / 100;
};
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const LIVE = ['ACTIVE', 'PARTIALLY_UTILIZED', 'RENEWED', 'RELEASE_PENDING'];
export const SFMS_TYPES = {
  MT760: 'MT760 / IFN 760 COV — guarantee issued',
  MT767: 'MT767 / IFN 767 COV — guarantee amended',
  MT700: 'MT700 — letter of credit issued',
  MT707: 'MT707 — letter of credit amended',
  OTHER: 'Other bank confirmation',
};
const warnDays = () => getParamNumber('security_expiry_warn_days', 60);
const criticalDays = () => getParamNumber('security_expiry_critical_days', 30);

// ── Who may see what ────────────────────────────────────────────────────────

function contractFor(user, contractId) {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(String(contractId || ''));
  if (!c) throw fail(404, 'Contract not found');
  const side = sideOf(user);
  if (!side) throw fail(403, 'Not authorized');
  if (side === 'SELLER' && c.seller_id !== user.linked_entity_id) throw fail(403, 'This is not your contract');
  if (side === 'BUYER' && c.buyer_id !== user.linked_entity_id) throw fail(403, 'This is not your contract');
  return { contract: c, side };
}

function instrumentFor(user, id) {
  const ps = db.prepare(`
    SELECT ps.*, c.contract_no, c.contract_type FROM payment_security ps
    JOIN contracts c ON c.id = ps.contract_id WHERE ps.id = ?
  `).get(String(id || ''));
  if (!ps) throw fail(404, 'Instrument not found');
  const { contract, side } = contractFor(user, ps.contract_id);
  return { ps, contract, side };
}

/** A file already uploaded against this contract. */
function docOf(contractId, versionId) {
  if (!versionId) return null;
  const v = db.prepare(`
    SELECT v.id FROM document_versions v JOIN documents d ON d.id = v.document_id
    WHERE v.id = ? AND d.contract_id = ?
  `).get(String(versionId), contractId);
  if (!v) throw fail(400, 'The attached file is not one of this contract\'s documents');
  return v.id;
}

function fileName(versionId) {
  if (!versionId) return null;
  try {
    return db.prepare('SELECT file_name FROM document_versions WHERE id = ?').get(versionId)?.file_name || null;
  } catch { return null; }
}

function notifySide(contract, toSide, rawMessage) {
  const message = datesInWords(rawMessage);
  try {
    if (toSide === 'SJVN') {
      for (const role of ROLE_GROUPS.REIA_WRITE) pushNotification({ role, type: 'SECURITY', message });
      return;
    }
    const entityId = toSide === 'SELLER' ? contract.seller_id : contract.buyer_id;
    if (!entityId) return;
    for (const u of db.prepare('SELECT id FROM users WHERE linked_entity_id = ? AND is_active = 1').all(entityId)) {
      pushNotification({ userId: u.id, type: 'SECURITY', message });
    }
  } catch { /* what was done stands; the bell is a courtesy */ }
}
const counterpartyOf = (contract) => (contract.seller_id ? 'SELLER' : contract.buyer_id ? 'BUYER' : null);

// ── How an instrument reads ─────────────────────────────────────────────────

function expiryOf(row) {
  if (!row.validity_end) return { days: null, level: 'NONE', label: 'No expiry date on record' };
  const days = daysUntil(row.validity_end);
  if (row.status === 'EXPIRED' || days < 0) {
    return { days, level: 'EXPIRED', label: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago` };
  }
  const label = days === 0 ? 'Expires today' : `${days} day${days === 1 ? '' : 's'} to expiry`;
  if (days <= criticalDays()) return { days, level: 'CRITICAL', label };
  if (days <= warnDays()) return { days, level: 'WARN', label };
  return { days, level: 'OK', label };
}

function amendmentView(a) {
  const changes = [];
  if (a.new_validity_end && a.new_validity_end !== a.old_validity_end) {
    changes.push({ field: 'VALIDITY', text: `Validity ${a.old_validity_end || '—'} → ${a.new_validity_end}` });
  }
  if (a.new_limit != null && Number(a.new_limit) !== Number(a.old_limit)) {
    changes.push({
      field: 'AMOUNT',
      text: `Amount ${rupees(a.old_limit)} → ${rupees(a.new_limit)} (${Number(a.new_limit) > Number(a.old_limit) ? 'increased' : 'reduced'})`,
    });
  }
  if (a.new_claim_deadline && a.new_claim_deadline !== a.old_claim_deadline) {
    changes.push({ field: 'CLAIM', text: `Claim period ${a.old_claim_deadline || '—'} → ${a.new_claim_deadline}` });
  }
  return { ...a, changes, document_name: fileName(a.document_version_id) };
}

function amendmentsOf(psId) {
  return db.prepare(`
    SELECT * FROM security_amendments WHERE payment_security_id = ?
    ORDER BY CASE WHEN seq IS NULL THEN 1 ELSE 0 END, seq, created_at, rowid
  `).all(psId).map(amendmentView);
}

function instrumentView(ps, { withChain = false } = {}) {
  const live = LIVE.includes(ps.status) || ps.status === 'EXPIRED';
  const expiry = live ? expiryOf(ps) : { days: ps.validity_end ? daysUntil(ps.validity_end) : null, level: 'NONE', label: '' };
  const amendments = amendmentsOf(ps.id);
  const accepted = amendments.filter((a) => a.status === 'ACCEPTED');
  const pending = amendments.find((a) => a.status === 'PENDING') || null;
  const out = {
    id: ps.id,
    instrument_no: ps.instrument_no,
    contract_id: ps.contract_id,
    contract_no: ps.contract_no,
    contract_type: ps.contract_type,
    mechanism_type: ps.mechanism_type,
    bg_subtype: ps.bg_subtype,
    is_revolving: ps.is_revolving,
    limit_amount: ps.limit_amount,
    utilized_amount: ps.utilized_amount || 0,
    available_amount: Math.max(0, (ps.limit_amount || 0) - (ps.utilized_amount || 0)),
    issuing_bank: ps.issuing_bank,
    issuing_branch: ps.issuing_branch,
    issuing_ifsc: ps.issuing_ifsc,
    bank_reference_no: ps.bank_reference_no,
    beneficiary: ps.beneficiary,
    issue_date: ps.issue_date,
    validity_start: ps.validity_start,
    validity_end: ps.validity_end,
    claim_deadline: ps.claim_deadline,
    status: ps.status,
    rejection_note: ps.rejection_note,
    submitted_by_side: ps.submitted_by_side,
    submitted_by_name: ps.submitted_by_side && ps.entity_id ? (db.prepare('SELECT name FROM entities WHERE id = ?').get(ps.entity_id)?.name || null) : null,
    is_ebg: !!ps.is_ebg,
    ebg_reference: ps.ebg_reference,
    expiry,
    sfms: {
      confirmed: !!ps.verified_at,
      message_type: ps.sfms_message_type,
      message_label: SFMS_TYPES[ps.sfms_message_type] || null,
      date: ps.sfms_date,
      reference: ps.sfms_reference || ps.bank_confirmation_ref,
      sender_ifsc: ps.sfms_sender_ifsc,
      recorded_at: ps.verified_at,
      recorded_by: ps.verified_by,
    },
    document: ps.document_version_id ? { version_id: ps.document_version_id, file_name: fileName(ps.document_version_id) } : null,
    amendment_count: accepted.length,
    pending_amendment: pending,
    // An extension is wanted when the instrument is running out and nothing is already with SJVN.
    needs_extension: ['WARN', 'CRITICAL', 'EXPIRED'].includes(expiry.level) && !pending,
  };
  if (!withChain) return out;

  const first = accepted[0];
  const chain = [{
    step: 'Original',
    seq: 0,
    date: ps.issue_date || ps.validity_start || String(ps.created_at || '').slice(0, 10),
    limit: ps.original_limit_amount ?? (first ? first.old_limit : ps.limit_amount),
    validity_end: ps.original_validity_end ?? (first ? first.old_validity_end : ps.validity_end),
    changes: [],
    document: out.document,
    reference: ps.bank_reference_no,
  }, ...accepted.map((a) => ({
    step: `Amendment ${a.seq}`,
    seq: a.seq,
    id: a.id,
    date: a.amendment_date || String(a.decided_at || a.created_at || '').slice(0, 10),
    limit: a.new_limit ?? a.old_limit,
    validity_end: a.new_validity_end ?? a.old_validity_end,
    changes: a.changes,
    reason: a.reason,
    reference: a.amendment_ref,
    sfms_message_type: a.sfms_message_type,
    sfms_date: a.sfms_date,
    sfms_reference: a.sfms_reference,
    document: a.document_version_id ? { version_id: a.document_version_id, file_name: a.document_name } : null,
    raised_by_name: a.raised_by_name,
    raised_by_side: a.raised_by_side,
  }))];
  return { ...out, chain, amendments };
}

// ── Taking an amendment on record ───────────────────────────────────────────

/**
 * Apply a bank amendment to an instrument and write it into the chain.
 *
 * Every route that changes a guarantee's validity or value goes through here —
 * the desk accepting a counterparty's submission, the desk recording one itself,
 * the older /renew, and a PBG renewal approved from the contract workspace — so
 * the amendment trail has no gaps whichever door the change came in by.
 */
export function takeAmendmentOnRecord(ps, {
  amendmentId = null, newLimit = null, newValidityEnd = null, newClaimDeadline = null, amendmentRef = null, amendmentDate = null,
  reason = null, documentVersionId = null, sfms = {}, user = null, side = 'SJVN', note = null,
} = {}) {
  const limit = newLimit != null ? Number(newLimit) : null;
  if (limit != null && limit < (ps.utilized_amount || 0)) {
    throw fail(400, `${rupees(ps.utilized_amount)} has already been drawn on this instrument — its value cannot be amended below that`);
  }
  const seq = (db.prepare(`SELECT COALESCE(MAX(seq), 0) AS n FROM security_amendments WHERE payment_security_id = ? AND status = 'ACCEPTED'`).get(ps.id).n) + 1;
  const validity = newValidityEnd || ps.validity_end;
  const finalLimit = limit ?? ps.limit_amount;
  const revive = validity && validity >= today() && [...LIVE, 'EXPIRED'].includes(ps.status);
  const status = revive ? ((ps.utilized_amount || 0) > 0 ? 'PARTIALLY_UTILIZED' : 'ACTIVE') : ps.status;

  if (amendmentId) {
    db.prepare(`
      UPDATE security_amendments SET status = 'ACCEPTED', seq = ?, decision_note = ?, decided_by = ?, decided_at = datetime('now'),
        sfms_message_type = COALESCE(?, sfms_message_type), sfms_date = COALESCE(?, sfms_date), sfms_reference = COALESCE(?, sfms_reference)
      WHERE id = ?
    `).run(seq, note, user?.name || 'system', sfms.message_type || null, sfms.date || null, sfms.reference || null, amendmentId);
  } else {
    amendmentId = newId('SAM');
    db.prepare(`
      INSERT INTO security_amendments (id, payment_security_id, contract_id, seq, amendment_ref, amendment_date,
        old_limit, new_limit, old_validity_end, new_validity_end, old_claim_deadline, new_claim_deadline, reason, document_version_id,
        sfms_message_type, sfms_date, sfms_reference, status, decision_note, raised_by, raised_by_name, raised_by_side, decided_by, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACCEPTED', ?, ?, ?, ?, ?, datetime('now'))
    `).run(amendmentId, ps.id, ps.contract_id, seq, amendmentRef, amendmentDate || today(),
      ps.limit_amount, limit, ps.validity_end, newValidityEnd, ps.claim_deadline, newClaimDeadline, reason, documentVersionId,
      sfms.message_type || null, sfms.date || null, sfms.reference || null, note, user?.id || null, user?.name || 'system', side, user?.name || 'system');
  }

  db.prepare(`
    UPDATE payment_security SET
      original_limit_amount = COALESCE(original_limit_amount, limit_amount),
      original_validity_end = COALESCE(original_validity_end, validity_end),
      limit_amount = ?, validity_end = ?, claim_deadline = COALESCE(?, claim_deadline),
      renewal_status = 'RENEWED', status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(finalLimit, validity, newClaimDeadline, status, ps.id);
  syncInstrumentAvailable(ps.id);

  // The reminders already sent were about the old expiry date.
  db.prepare(`DELETE FROM security_alerts WHERE payment_security_id = ? AND alert_type IN ('EXPIRY', 'EXPIRY_CP')`).run(ps.id);

  if (ps.mechanism_type === 'BANK_GUARANTEE' && ps.bg_subtype === 'PBG') {
    // Only the date: pbg_amount is what the contract asks for, not what one instrument is worth.
    db.prepare(`UPDATE contracts SET pbg_expiry = ?, updated_at = datetime('now') WHERE id = ?`).run(validity, ps.contract_id);
  }
  recordSecurityEvent({
    instrumentId: ps.id, contractId: ps.contract_id, user, eventType: 'AMENDMENT_ACCEPTED',
    details: { seq, limit_before: ps.limit_amount, limit_after: finalLimit, validity_before: ps.validity_end, validity_after: validity },
  });
  return { id: amendmentId, seq };
}

// ── SJVN's letters of credit ────────────────────────────────────────────────

/** What the PPA asks SJVN to keep open: a share of the average monthly bill. */
function lcRequired(contract) {
  // The hydro contracts are SJVN's own stations selling to beneficiaries under
  // the CERC tariff; there is no outside seller for SJVN to secure payment to.
  if (String(contract.project_type || '').toLowerCase() === 'hydro') return 0;
  const monthly = trailingMonthlyBilledAvg(contract.id) || estimatedMonthlyBill(contract) || 0;
  return Math.round(monthly * getParamNumber('ppa_lc_cover_pct', 100) / 100);
}

function lcView(lc, { withEvents = false } = {}) {
  const expiry = lc.status === 'ACTIVE' ? expiryOf(lc) : { days: null, level: 'NONE', label: '' };
  const out = {
    ...lc,
    available_amount: Math.max(0, (lc.amount || 0) - (lc.utilized_amount || 0)),
    expiry,
    live: lc.status === 'ACTIVE' && expiry.level !== 'EXPIRED',
    document: lc.document_version_id ? { version_id: lc.document_version_id, file_name: fileName(lc.document_version_id) } : null,
    sfms_label: SFMS_TYPES[lc.sfms_message_type] || null,
  };
  if (withEvents) {
    out.events = db.prepare('SELECT * FROM sjvn_lc_events WHERE lc_id = ? ORDER BY created_at, rowid').all(lc.id)
      .map((e) => ({ ...e, details: e.details ? JSON.parse(e.details) : null }));
  }
  return out;
}

/** Everything SJVN has open in the seller's favour on a PPA — what the requirement is measured against. */
function lcOpenOn(contractId) {
  return db.prepare(`SELECT l.*, c.contract_no FROM sjvn_lcs l JOIN contracts c ON c.id = l.contract_id WHERE l.contract_id = ?`).all(contractId)
    .map((l) => lcView(l)).filter((l) => l.live).reduce((sum, l) => sum + l.available_amount, 0);
}

function lcEvent(lcId, user, type, details) {
  db.prepare('INSERT INTO sjvn_lc_events (id, lc_id, event_type, details, actor_name) VALUES (?, ?, ?, ?, ?)')
    .run(newId('LCE'), lcId, type, details ? JSON.stringify(details) : null, user?.name || 'system');
}

function lcFor(user, id) {
  const lc = db.prepare(`SELECT l.*, c.contract_no FROM sjvn_lcs l JOIN contracts c ON c.id = l.contract_id WHERE l.id = ?`).get(String(id || ''));
  if (!lc) throw fail(404, 'Letter of credit not found');
  const { contract, side } = contractFor(user, lc.contract_id);
  if (side === 'BUYER') throw fail(403, 'Not authorized');
  return { lc, contract, side };
}

// ── What the caller holds, at a glance ──────────────────────────────────────

function scopeSql(user) {
  const side = sideOf(user);
  if (!side) throw fail(403, 'Not authorized');
  if (side === 'SELLER') return { side, where: ' AND c.seller_id = ?', params: [user.linked_entity_id] };
  if (side === 'BUYER') return { side, where: ' AND c.buyer_id = ?', params: [user.linked_entity_id] };
  return { side, where: '', params: [] };
}

function overview(user) {
  const { side, where, params } = scopeSql(user);
  const instruments = db.prepare(`
    SELECT ps.*, c.contract_no, c.contract_type FROM payment_security ps
    JOIN contracts c ON c.id = ps.contract_id WHERE 1 = 1${where}
    ORDER BY CASE WHEN ps.validity_end IS NULL THEN 1 ELSE 0 END, ps.validity_end
  `).all(...params).map((r) => instrumentView(r));

  const lcs = side === 'BUYER' ? [] : db.prepare(`
    SELECT l.*, c.contract_no FROM sjvn_lcs l JOIN contracts c ON c.id = l.contract_id WHERE 1 = 1${where}
    ORDER BY l.validity_end
  `).all(...params).map((r) => lcView(r));

  // Per contract: what the contract asks for against what is actually held.
  const contracts = db.prepare(`
    SELECT c.* FROM contracts c WHERE c.status NOT IN ('DRAFT', 'CLOSED', 'TERMINATED')${where} ORDER BY c.contract_no
  `).all(...params).map((c) => {
    const mine = instruments.filter((i) => i.contract_id === c.id && LIVE.includes(i.status) && i.expiry.level !== 'EXPIRED');
    const held = (sub) => mine.filter((i) => i.mechanism_type === 'BANK_GUARANTEE' && i.bg_subtype === sub).reduce((s, i) => s + (i.limit_amount || 0), 0);
    const lcOpen = lcs.filter((l) => l.contract_id === c.id && l.live).reduce((s, l) => s + l.available_amount, 0);
    const lcNeed = c.contract_type === 'PPA' ? lcRequired(c) : 0;
    // The other way round on a PSA: the letter of credit the buyer is to give SJVN.
    const given = mine.filter((i) => i.mechanism_type === 'LC').reduce((s, i) => s + (i.available_amount || 0), 0);
    let givenNeed = 0;
    if (c.contract_type === 'PSA') { try { givenNeed = computeCoverage(c.id).required_amount || 0; } catch { givenNeed = 0; } }
    return {
      lc_given_required: Math.round(givenNeed), lc_given_held: Math.round(given), lc_given_shortfall: Math.max(0, Math.round(givenNeed - given)),
      id: c.id, contract_no: c.contract_no, contract_type: c.contract_type,
      pbg_required: c.pbg_amount || 0, pbg_held: held('PBG'), pbg_shortfall: Math.max(0, (c.pbg_amount || 0) - held('PBG')),
      emd_required: c.emd_amount || 0, emd_held: held('EMD'),
      lc_required: lcNeed, lc_open: lcOpen, lc_shortfall: Math.max(0, lcNeed - lcOpen),
    };
  });

  const live = instruments.filter((i) => LIVE.includes(i.status));
  const totals = {
    held: live.filter((i) => i.expiry.level !== 'EXPIRED').reduce((s, i) => s + (i.limit_amount || 0), 0),
    count: live.length,
    expiring: live.filter((i) => ['WARN', 'CRITICAL'].includes(i.expiry.level)).length,
    critical: live.filter((i) => i.expiry.level === 'CRITICAL').length,
    expired: instruments.filter((i) => i.expiry.level === 'EXPIRED' && [...LIVE, 'EXPIRED'].includes(i.status)).length,
    awaiting_sfms: live.filter((i) => !i.sfms.confirmed).length,
    pending_amendments: instruments.filter((i) => i.pending_amendment).length,
    pending_submissions: instruments.filter((i) => i.status === 'DRAFT' && i.submitted_by_side).length,
    lc_open: lcs.filter((l) => l.live).reduce((s, l) => s + l.available_amount, 0),
    lc_required: contracts.reduce((s, c) => s + c.lc_required, 0),
    lc_shortfall: contracts.reduce((s, c) => s + c.lc_shortfall, 0),
    pbg_shortfall: contracts.reduce((s, c) => s + c.pbg_shortfall, 0),
    lc_given_shortfall: contracts.reduce((s, c) => s + c.lc_given_shortfall, 0),
  };
  return {
    side,
    thresholds: { warn_days: warnDays(), critical_days: criticalDays() },
    instruments, lcs, contracts, totals,
    can_manage: canManage(user), can_manage_lc: canManageLc(user),
  };
}

router.get('/meta', (req, res) => send(res, () => ({
  sfms_types: SFMS_TYPES,
  thresholds: { warn_days: warnDays(), critical_days: criticalDays() },
  lc_cover_pct: getParamNumber('ppa_lc_cover_pct', 100),
})));

router.get('/overview', (req, res) => send(res, () => overview(req.user)));

// GET /register.xlsx — everything the caller can see, as a workbook.
router.get('/register.xlsx', (req, res) => {
  try {
    const o = overview(req.user);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(o.instruments.map((i) => ({
      Instrument: i.instrument_no, Contract: i.contract_no, Type: i.mechanism_type, Subtype: i.bg_subtype || '',
      'Bank reference': i.bank_reference_no || '', Bank: i.issuing_bank || '', Branch: i.issuing_branch || '',
      'Amount (Rs)': i.limit_amount, 'Drawn (Rs)': i.utilized_amount, 'Issue date': i.issue_date || '', 'Valid from': i.validity_start || '',
      'Valid until': i.validity_end || '', 'Claim until': i.claim_deadline || '', 'Days to expiry': i.expiry.days ?? '',
      Status: String(i.status).replace(/_/g, ' '), 'SFMS confirmed': i.sfms.confirmed ? 'Yes' : 'No', 'SFMS message': i.sfms.message_type || '',
      'SFMS date': i.sfms.date || '', 'SFMS reference': i.sfms.reference || '', 'e-BG': i.is_ebg ? 'Yes' : 'No',
      Amendments: i.amendment_count, 'Document on file': i.document ? 'Yes' : 'No',
    }))), 'Instruments');
    const amendments = o.instruments.flatMap((i) => amendmentsOf(i.id).map((a) => ({
      Instrument: i.instrument_no, 'Amendment no.': a.seq ?? '', Status: a.status, 'Bank amendment ref': a.amendment_ref || '',
      'Amendment date': a.amendment_date || '', Change: a.changes.map((c) => c.text).join('; '), Reason: a.reason || '',
      'SFMS message': a.sfms_message_type || '', 'SFMS reference': a.sfms_reference || '', 'Submitted by': a.raised_by_name || '',
      'Decided by': a.decided_by || '', 'Decided at': a.decided_at || '',
    })));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(amendments.length ? amendments : [{ Instrument: 'No amendments on record' }]), 'Amendments');
    if (o.side !== 'BUYER') {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(o.lcs.length ? o.lcs.map((l) => ({
        'LC no.': l.lc_no, Contract: l.contract_no, 'Issuing bank': l.issuing_bank || '', 'Advising bank': l.advising_bank || '',
        Revolving: l.is_revolving ? 'Yes' : 'No', 'Amount (Rs)': l.amount, 'Drawn (Rs)': l.utilized_amount, 'Issue date': l.issue_date || '',
        'Valid until': l.validity_end || '', Status: l.status, 'SFMS message': l.sfms_message_type || '', 'SFMS reference': l.sfms_reference || '',
      })) : [{ 'LC no.': 'No letters of credit on record' }]), 'SJVN LCs');
    }
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="payment-security-register-${today()}.xlsx"`);
    res.send(buf);
  } catch (err) {
    if (!err.status) console.error('[SECURITY-DESK]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
});

// ── Instruments ─────────────────────────────────────────────────────────────

function detail(user, id) {
  const { ps, contract, side } = instrumentFor(user, id);
  const position = releasePosition(ps.contract_id);
  // Every invocation that drew on it — the waterfall names only the first
  // instrument it reached on the row, so the second one drawn was told nothing.
  const invocations = db.prepare(`
    SELECT id, invocation_no, amount, status, created_at, payment_security_id, waterfall_used FROM security_invocations
    WHERE contract_id = ? ORDER BY created_at DESC, rowid DESC
  `).all(ps.contract_id).map((inv) => {
    let draws = [];
    try { draws = JSON.parse(inv.waterfall_used || '[]'); } catch { draws = []; }
    const mine = draws.find((w) => w.id === ps.id);
    if (!mine && inv.payment_security_id !== ps.id) return null;
    return { id: inv.id, invocation_no: inv.invocation_no, amount: mine ? mine.amount : inv.amount, status: inv.status, created_at: inv.created_at };
  }).filter(Boolean);
  return {
    ...instrumentView(ps, { withChain: true }),
    side,
    can_manage: canManage(user),
    counterparty_side: counterpartyOf(contract),
    events: db.prepare('SELECT id, event_type, actor_name, details, created_at FROM security_events WHERE payment_security_id = ? ORDER BY created_at, rowid').all(ps.id),
    releases: db.prepare('SELECT * FROM security_releases WHERE payment_security_id = ? ORDER BY created_at DESC').all(ps.id),
    invocations,
    // What a release would be checked against, so nobody asks for one that cannot be given.
    release_check: { ...position, can_request: [...LIVE, 'EXPIRED'].includes(ps.status) },
  };
}

router.get('/instruments/:id', (req, res) => send(res, () => detail(req.user, req.params.id)));

// POST /instruments — a counterparty submits a guarantee it has had issued. It
// sits as a draft, counting for nothing, until SJVN accepts it.
router.post('/instruments', (req, res) => send(res, () => {
  const b = req.body || {};
  const { contract, side } = contractFor(req.user, b.contract_id);
  if (side === 'SJVN') throw fail(400, 'SJVN records an instrument from the Payment Security desk');
  const isSeller = side === 'SELLER';
  const subtype = isSeller ? (['EMD', 'PBG', 'OTHER_BG'].includes(b.bg_subtype) ? b.bg_subtype : null) : null;
  if (isSeller && !subtype) throw fail(400, 'Say whether this is an EMD, a performance guarantee (PBG) or another guarantee');
  const amount = money(b.amount, 'Amount');
  const bankRef = text(b.bank_reference_no, 80);
  if (!bankRef) throw fail(400, `The bank's ${isSeller ? 'guarantee' : 'letter of credit'} number is needed`);
  const bank = text(b.issuing_bank, 160);
  if (!bank) throw fail(400, 'The issuing bank is needed');
  const validityEnd = dayOrNull(b.validity_end, 'Valid until');
  if (!validityEnd) throw fail(400, 'Valid until is needed');
  if (validityEnd < today()) throw fail(400, 'This instrument has already expired');
  const validityStart = dayOrNull(b.validity_start, 'Valid from');
  const claim = dayOrNull(b.claim_deadline, 'Claim period');
  if (claim && claim < validityEnd) throw fail(400, 'The claim period cannot end before the validity does');
  const doc = docOf(contract.id, b.document_version_id);
  if (!doc) throw fail(400, 'Attach the scanned guarantee or the e-BG');
  if (db.prepare(`SELECT 1 FROM payment_security WHERE contract_id = ? AND bank_reference_no = ? AND status != 'CLOSED'`).get(contract.id, bankRef)) {
    throw fail(409, `${bankRef} is already on record for this contract`);
  }

  const id = newId('PSC');
  const mechanism = isSeller ? 'BANK_GUARANTEE' : 'LC';
  db.prepare(`
    INSERT INTO payment_security (
      id, instrument_no, contract_id, entity_id, mechanism_type, bg_subtype, is_revolving, limit_amount, utilized_amount,
      available_amount, required_amount, waterfall_priority, issuing_bank, issuing_branch, issuing_ifsc, bank_reference_no,
      beneficiary, issue_date, validity_start, validity_end, claim_deadline, status, remarks, is_ebg, ebg_reference,
      document_version_id, submitted_by, submitted_by_side
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'SJVN Limited', ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)
  `).run(
    id, genInstrumentNo(isSeller ? subtype : 'LC'), contract.id, req.user.linked_entity_id, mechanism, subtype, isSeller ? 0 : 1, amount,
    amount, computeCoverage(contract.id).required_amount || 0, WATERFALL_DEFAULTS[mechanism] ?? 100, bank, text(b.issuing_branch, 160) || null,
    text(b.issuing_ifsc, 11).toUpperCase() || null, bankRef, dayOrNull(b.issue_date, 'Issue date'), validityStart, validityEnd, claim,
    text(b.remarks, 1000) || null, b.is_ebg ? 1 : 0, text(b.ebg_reference, 80) || null, doc, req.user.id, side,
  );
  recordSecurityEvent({ instrumentId: id, contractId: contract.id, user: req.user, eventType: 'SUBMITTED', details: { bank_reference_no: bankRef, amount, validity_end: validityEnd } });
  audit(req, 'SECURITY_SUBMITTED', 'payment_security', id, { afterValue: { bank_reference_no: bankRef, amount, validity_end: validityEnd, bg_subtype: subtype } });
  notifySide(contract, 'SJVN', `${contract.contract_no}: ${req.user.name} has submitted ${subtype || 'a letter of credit'} ${bankRef} for ${rupees(amount)}, valid until ${validityEnd}. It awaits acceptance.`);
  return detail(req.user, id);
}));

function sfmsFrom(b, { required = false } = {}) {
  const reference = text(b.sfms_reference, 80);
  if (!reference) {
    if (required) throw fail(400, 'The SFMS reference / UTR of the bank\'s advice is needed');
    return {};
  }
  const type = SFMS_TYPES[b.sfms_message_type] ? b.sfms_message_type : null;
  if (!type) throw fail(400, 'Say which SFMS message the bank sent');
  const date = dayOrNull(b.sfms_date, 'SFMS message date');
  if (!date) throw fail(400, 'The date of the SFMS message is needed');
  if (date > today()) throw fail(400, 'The SFMS message date cannot be in the future');
  return { message_type: type, date, reference, sender_ifsc: text(b.sfms_sender_ifsc, 11).toUpperCase() || null };
}

function writeSfms(ps, sfms, user, bankRef) {
  db.prepare(`
    UPDATE payment_security SET sfms_message_type = ?, sfms_date = ?, sfms_reference = ?, sfms_sender_ifsc = ?,
      bank_confirmation_ref = ?, bank_reference_no = COALESCE(?, bank_reference_no),
      verified_at = datetime('now'), verified_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(sfms.message_type, sfms.date, sfms.reference, sfms.sender_ifsc, sfms.reference, bankRef || null, user.name, ps.id);
  recordSecurityEvent({ instrumentId: ps.id, contractId: ps.contract_id, user, eventType: 'VERIFIED', details: sfms });
}

// POST /instruments/:id/sfms — SJVN records the advice its bank received.
router.post('/instruments/:id/sfms', (req, res) => send(res, () => {
  if (!canManage(req.user)) throw fail(403, 'Only the REIA desk records a bank confirmation');
  const { ps, contract } = instrumentFor(req.user, req.params.id);
  const sfms = sfmsFrom(req.body || {}, { required: true });
  writeSfms(ps, sfms, req.user, text(req.body.bank_reference_no, 80));
  audit(req, 'SECURITY_SFMS_RECORDED', 'payment_security', ps.id, { afterValue: sfms });
  const cp = counterpartyOf(contract);
  if (cp) notifySide(contract, cp, `${ps.instrument_no}: SJVN has received the bank's SFMS advice (${sfms.message_type}, ref ${sfms.reference}, dated ${sfms.date}).`);
  return detail(req.user, ps.id);
}));

// POST /instruments/:id/decide — accept or refuse a counterparty's submission.
router.post('/instruments/:id/decide', (req, res) => send(res, () => {
  if (!canManage(req.user)) throw fail(403, 'Only the REIA desk accepts an instrument');
  const { ps, contract } = instrumentFor(req.user, req.params.id);
  if (ps.status !== 'DRAFT') throw fail(400, 'This instrument is not awaiting acceptance');
  const decision = String(req.body.decision || '').toUpperCase();
  if (!['ACCEPTED', 'REJECTED'].includes(decision)) throw fail(400, 'decision must be ACCEPTED or REJECTED');
  const note = text(req.body.note, 1000);
  if (decision === 'REJECTED' && !note) throw fail(400, 'Say why the instrument is refused');
  const sfms = decision === 'ACCEPTED' ? sfmsFrom(req.body || {}) : {};
  // One that ran out while it waited is not taken on as cover.
  if (decision === 'ACCEPTED' && ps.validity_end && String(ps.validity_end).slice(0, 10) < today()) {
    throw fail(400, `${ps.bank_reference_no || ps.instrument_no} expired on ${dayInWords(ps.validity_end)} while it awaited acceptance. Refuse it and ask for the extended instrument.`);
  }

  db.transaction(() => {
    if (decision === 'REJECTED') {
      db.prepare(`UPDATE payment_security SET status = 'CLOSED', rejection_note = ?, updated_at = datetime('now') WHERE id = ?`).run(note, ps.id);
    } else {
      db.prepare(`UPDATE payment_security SET status = 'ACTIVE', rejection_note = NULL, updated_at = datetime('now') WHERE id = ?`).run(ps.id);
      if (sfms.reference) writeSfms(ps, sfms, req.user);
      syncInstrumentAvailable(ps.id);
    }
    recordSecurityEvent({ instrumentId: ps.id, contractId: ps.contract_id, user: req.user, eventType: `SUBMISSION_${decision}`, details: { note: note || undefined } });
  })();
  audit(req, `SECURITY_SUBMISSION_${decision}`, 'payment_security', ps.id, { beforeValue: { status: 'DRAFT' }, afterValue: { status: decision }, reason: note || undefined });
  if (ps.submitted_by_side) {
    notifySide(contract, ps.submitted_by_side, `${ps.instrument_no} (${ps.bank_reference_no || 'guarantee'}) has been ${decision === 'ACCEPTED' ? 'accepted and taken on record' : 'refused'} by SJVN${note ? ` — ${note}` : ''}.`);
  }
  return detail(req.user, ps.id);
}));

// POST /instruments/:id/document — put the scanned guarantee or e-BG on the instrument.
router.post('/instruments/:id/document', (req, res) => send(res, () => {
  const { ps, side } = instrumentFor(req.user, req.params.id);
  if (side === 'SJVN' && !canManage(req.user)) throw fail(403, 'Not authorized');
  const doc = docOf(ps.contract_id, req.body.document_version_id);
  if (!doc) throw fail(400, 'Attach a file');
  // Once SJVN has accepted the instrument the copy on file is the one it accepted.
  if (side !== 'SJVN' && ps.document_version_id && ps.status !== 'DRAFT') {
    throw fail(400, 'The copy on file is the one SJVN took on record. Submit an amendment if the bank has changed the instrument.');
  }
  db.prepare(`UPDATE payment_security SET document_version_id = ?, is_ebg = ?, ebg_reference = COALESCE(?, ebg_reference), updated_at = datetime('now') WHERE id = ?`)
    .run(doc, req.body.is_ebg ? 1 : (ps.is_ebg || 0), text(req.body.ebg_reference, 80) || null, ps.id);
  recordSecurityEvent({ instrumentId: ps.id, contractId: ps.contract_id, user: req.user, eventType: 'DOCUMENT_ATTACHED', details: { version_id: doc } });
  audit(req, 'SECURITY_DOCUMENT_ATTACHED', 'payment_security', ps.id, { afterValue: { document_version_id: doc } });
  return detail(req.user, ps.id);
}));

// ── Amendments ──────────────────────────────────────────────────────────────

// POST /instruments/:id/amendments — an extension or change the bank has made.
router.post('/instruments/:id/amendments', (req, res) => send(res, () => {
  const { ps, contract, side } = instrumentFor(req.user, req.params.id);
  if (side === 'SJVN' && !canManage(req.user)) throw fail(403, 'Not authorized');
  if (![...LIVE, 'EXPIRED'].includes(ps.status)) throw fail(400, `An instrument that is ${ps.status.toLowerCase().replace(/_/g, ' ')} cannot be amended`);
  if (db.prepare(`SELECT 1 FROM security_amendments WHERE payment_security_id = ? AND status = 'PENDING'`).get(ps.id)) {
    throw fail(409, 'An amendment on this instrument is already awaiting SJVN');
  }
  const b = req.body || {};
  const newValidity = dayOrNull(b.new_validity_end, 'New validity');
  const newLimit = b.new_limit != null && b.new_limit !== '' ? money(b.new_limit, 'New amount') : null;
  const newClaim = dayOrNull(b.new_claim_deadline, 'New claim period');
  const validityChanged = newValidity && newValidity !== ps.validity_end;
  const limitChanged = newLimit != null && newLimit !== Number(ps.limit_amount);
  const claimChanged = newClaim && newClaim !== ps.claim_deadline;
  if (!validityChanged && !limitChanged && !claimChanged) throw fail(400, 'Say what the bank changed: the validity, the amount or the claim period');
  if (validityChanged && newValidity < today()) throw fail(400, 'The new validity is already in the past');
  if (validityChanged && ps.validity_end && newValidity < ps.validity_end && side !== 'SJVN') {
    throw fail(400, 'A guarantee\'s validity can be extended here, not shortened');
  }
  const finalValidity = validityChanged ? newValidity : ps.validity_end;
  if (newClaim && finalValidity && newClaim < finalValidity) throw fail(400, 'The claim period cannot end before the validity does');
  if (limitChanged && newLimit < (ps.utilized_amount || 0)) throw fail(400, `${rupees(ps.utilized_amount)} has already been drawn — the amount cannot go below that`);
  const reason = text(b.reason, 1000);
  if (!reason) throw fail(400, 'Say why the instrument was amended');
  const doc = docOf(ps.contract_id, b.document_version_id);
  if (side !== 'SJVN' && !doc) throw fail(400, 'Attach the bank\'s amendment / extension letter');
  const amendmentDate = dayOrNull(b.amendment_date, 'Amendment date') || today();
  const ref = text(b.amendment_ref, 80) || null;
  const sfms = sfmsFrom(b);
  const fields = {
    newLimit: limitChanged ? newLimit : null, newValidityEnd: validityChanged ? newValidity : null, newClaimDeadline: claimChanged ? newClaim : null,
    amendmentRef: ref, amendmentDate, reason, documentVersionId: doc,
  };

  let id;
  if (side === 'SJVN') {
    // The desk has the bank's letter in hand; it goes straight on record.
    id = db.transaction(() => takeAmendmentOnRecord(ps, { ...fields, sfms, user: req.user, side: 'SJVN' }).id)();
    audit(req, 'SECURITY_AMENDMENT_RECORDED', 'security_amendments', id, { afterValue: fields });
    const cp = counterpartyOf(contract);
    if (cp) notifySide(contract, cp, `${ps.instrument_no}: SJVN has recorded an amendment — ${amendmentView(db.prepare('SELECT * FROM security_amendments WHERE id = ?').get(id)).changes.map((c) => c.text).join('; ')}.`);
  } else {
    id = newId('SAM');
    db.prepare(`
      INSERT INTO security_amendments (id, payment_security_id, contract_id, amendment_ref, amendment_date, old_limit, new_limit,
        old_validity_end, new_validity_end, old_claim_deadline, new_claim_deadline, reason, document_version_id,
        sfms_message_type, sfms_date, sfms_reference, status, raised_by, raised_by_name, raised_by_side)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `).run(id, ps.id, ps.contract_id, ref, amendmentDate, ps.limit_amount, fields.newLimit, ps.validity_end, fields.newValidityEnd,
      ps.claim_deadline, fields.newClaimDeadline, reason, doc, sfms.message_type || null, sfms.date || null, sfms.reference || null,
      req.user.id, req.user.name, side);
    recordSecurityEvent({ instrumentId: ps.id, contractId: ps.contract_id, user: req.user, eventType: 'AMENDMENT_SUBMITTED', details: fields });
    audit(req, 'SECURITY_AMENDMENT_SUBMITTED', 'security_amendments', id, { afterValue: fields });
    const what = amendmentView(db.prepare('SELECT * FROM security_amendments WHERE id = ?').get(id)).changes.map((c) => c.text).join('; ');
    notifySide(contract, 'SJVN', `${contract.contract_no}: ${req.user.name} has submitted an amendment to ${ps.instrument_no} — ${what}. It awaits acceptance.`);
  }
  return detail(req.user, ps.id);
}));

function amendmentFor(user, id) {
  const a = db.prepare('SELECT * FROM security_amendments WHERE id = ?').get(String(id || ''));
  if (!a) throw fail(404, 'Amendment not found');
  return { a, ...instrumentFor(user, a.payment_security_id) };
}

// POST /amendments/:id/decide — SJVN takes it on record, or refuses it.
router.post('/amendments/:id/decide', (req, res) => send(res, () => {
  if (!canManage(req.user)) throw fail(403, 'Only the REIA desk decides an amendment');
  const { a, ps, contract } = amendmentFor(req.user, req.params.id);
  if (a.status !== 'PENDING') throw fail(400, `This amendment has already been ${a.status.toLowerCase()}`);
  const decision = String(req.body.decision || '').toUpperCase();
  if (!['ACCEPTED', 'REJECTED'].includes(decision)) throw fail(400, 'decision must be ACCEPTED or REJECTED');
  const note = text(req.body.note, 1000);
  if (decision === 'REJECTED' && !note) throw fail(400, 'Say why the amendment is refused');

  if (decision === 'ACCEPTED') {
    const sfms = sfmsFrom(req.body || {});
    db.transaction(() => takeAmendmentOnRecord(ps, {
      amendmentId: a.id, newLimit: a.new_limit, newValidityEnd: a.new_validity_end, newClaimDeadline: a.new_claim_deadline,
      sfms, user: req.user, note: note || null,
    }))();
  } else {
    db.prepare(`UPDATE security_amendments SET status = 'REJECTED', decision_note = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`)
      .run(note, req.user.name, a.id);
    recordSecurityEvent({ instrumentId: ps.id, contractId: ps.contract_id, user: req.user, eventType: 'AMENDMENT_REJECTED', details: { note } });
  }
  audit(req, `SECURITY_AMENDMENT_${decision}`, 'security_amendments', a.id, { beforeValue: { status: 'PENDING' }, afterValue: { status: decision }, reason: note || undefined });
  if (a.raised_by_side && a.raised_by_side !== 'SJVN') {
    notifySide(contract, a.raised_by_side, `${ps.instrument_no}: your amendment has been ${decision === 'ACCEPTED' ? 'accepted and taken on record' : 'refused'} by SJVN${note ? ` — ${note}` : ''}.`);
  }
  return detail(req.user, ps.id);
}));

// POST /amendments/:id/withdraw — by the side that submitted it, while it is still open.
router.post('/amendments/:id/withdraw', (req, res) => send(res, () => {
  const { a, ps, side } = amendmentFor(req.user, req.params.id);
  if (a.status !== 'PENDING') throw fail(400, `This amendment has already been ${a.status.toLowerCase()}`);
  if (a.raised_by_side !== side) throw fail(403, 'Only the side that submitted an amendment can withdraw it');
  db.prepare(`UPDATE security_amendments SET status = 'WITHDRAWN', decided_by = ?, decided_at = datetime('now') WHERE id = ?`).run(req.user.name, a.id);
  recordSecurityEvent({ instrumentId: ps.id, contractId: ps.contract_id, user: req.user, eventType: 'AMENDMENT_WITHDRAWN', details: null });
  audit(req, 'SECURITY_AMENDMENT_WITHDRAWN', 'security_amendments', a.id, {});
  return detail(req.user, ps.id);
}));

// ── SJVN's letters of credit ────────────────────────────────────────────────

router.get('/lcs/:id', (req, res) => send(res, () => {
  const { lc, contract } = lcFor(req.user, req.params.id);
  return { ...lcView(lc, { withEvents: true }), required_amount: lcRequired(contract), open_on_contract: lcOpenOn(contract.id), can_manage_lc: canManageLc(req.user) };
}));

router.post('/lcs', (req, res) => send(res, () => {
  if (!canManageLc(req.user)) throw fail(403, 'Only the REIA desk or Finance records a letter of credit');
  const b = req.body || {};
  const { contract } = contractFor(req.user, b.contract_id);
  if (contract.contract_type !== 'PPA' || !contract.seller_id) throw fail(400, 'SJVN opens a letter of credit in a seller\'s favour under a PPA');
  const amount = money(b.amount, 'Amount');
  const bank = text(b.issuing_bank, 160);
  if (!bank) throw fail(400, 'The issuing bank is needed');
  const validityEnd = dayOrNull(b.validity_end, 'Valid until');
  if (!validityEnd) throw fail(400, 'Valid until is needed');
  const lcNo = text(b.lc_no, 80) || `LC/SJVN/${new Date().getFullYear()}/${String(nextSeriesNo('SJVN-LC', new Date().getFullYear())).padStart(5, '0')}`;
  if (db.prepare('SELECT 1 FROM sjvn_lcs WHERE lc_no = ?').get(lcNo)) throw fail(409, `${lcNo} is already on record`);
  const sfms = sfmsFrom(b);
  const id = newId('SLC');
  db.prepare(`
    INSERT INTO sjvn_lcs (id, lc_no, contract_id, entity_id, issuing_bank, issuing_branch, advising_bank, is_revolving, amount,
      issue_date, validity_end, sfms_message_type, sfms_date, sfms_reference, document_version_id, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, lcNo, contract.id, contract.seller_id, bank, text(b.issuing_branch, 160) || null, text(b.advising_bank, 160) || null,
    b.is_revolving === false || b.is_revolving === 0 ? 0 : 1, amount, dayOrNull(b.issue_date, 'Issue date'), validityEnd,
    sfms.message_type || null, sfms.date || null, sfms.reference || null, docOf(contract.id, b.document_version_id), text(b.remarks, 1000) || null, req.user.name);
  lcEvent(id, req.user, 'OPENED', { amount, validity_end: validityEnd });
  audit(req, 'SJVN_LC_OPENED', 'sjvn_lcs', id, { afterValue: { lc_no: lcNo, amount, validity_end: validityEnd } });
  notifySide(contract, 'SELLER', `${contract.contract_no}: SJVN has opened letter of credit ${lcNo} in your favour for ${rupees(amount)}, valid until ${validityEnd}.`);
  return { ...lcView(db.prepare('SELECT l.*, c.contract_no FROM sjvn_lcs l JOIN contracts c ON c.id = l.contract_id WHERE l.id = ?').get(id), { withEvents: true }), required_amount: lcRequired(contract), open_on_contract: lcOpenOn(contract.id) };
}));

// POST /lcs/:id/amend — value, validity, the bank's advice or the copy on file.
router.post('/lcs/:id/amend', (req, res) => send(res, () => {
  if (!canManageLc(req.user)) throw fail(403, 'Only the REIA desk or Finance amends a letter of credit');
  const { lc, contract } = lcFor(req.user, req.params.id);
  if (lc.status !== 'ACTIVE') throw fail(400, 'This letter of credit is closed');
  const b = req.body || {};
  const amount = b.amount != null && b.amount !== '' ? money(b.amount, 'Amount') : lc.amount;
  const validityEnd = dayOrNull(b.validity_end, 'Valid until') || lc.validity_end;
  const utilized = b.utilized_amount != null && b.utilized_amount !== '' ? Number(b.utilized_amount) : lc.utilized_amount;
  if (!(utilized >= 0) || utilized > amount) throw fail(400, 'The amount drawn must be between zero and the value of the letter of credit');
  const sfms = sfmsFrom(b);
  const doc = docOf(contract.id, b.document_version_id) || lc.document_version_id;
  const changes = {};
  if (amount !== lc.amount) changes.amount = { from: lc.amount, to: amount };
  if (validityEnd !== lc.validity_end) changes.validity_end = { from: lc.validity_end, to: validityEnd };
  if (utilized !== lc.utilized_amount) changes.utilized_amount = { from: lc.utilized_amount, to: utilized };
  if (sfms.reference) changes.sfms = sfms;
  if (doc !== lc.document_version_id) changes.document = true;
  if (!Object.keys(changes).length) throw fail(400, 'Nothing was changed');
  db.prepare(`
    UPDATE sjvn_lcs SET amount = ?, validity_end = ?, utilized_amount = ?, document_version_id = ?,
      sfms_message_type = COALESCE(?, sfms_message_type), sfms_date = COALESCE(?, sfms_date), sfms_reference = COALESCE(?, sfms_reference),
      updated_at = datetime('now') WHERE id = ?
  `).run(amount, validityEnd, utilized, doc, sfms.message_type || null, sfms.date || null, sfms.reference || null, lc.id);
  db.prepare(`DELETE FROM security_alerts WHERE payment_security_id = ? AND alert_type = 'LC_EXPIRY'`).run(lc.id);
  lcEvent(lc.id, req.user, 'AMENDED', { ...changes, note: text(b.note, 500) || undefined });
  audit(req, 'SJVN_LC_AMENDED', 'sjvn_lcs', lc.id, { afterValue: changes });
  if (changes.amount || changes.validity_end) {
    notifySide(contract, 'SELLER', `${lc.lc_no}: SJVN has amended the letter of credit in your favour — now ${rupees(amount)}, valid until ${validityEnd}.`);
  }
  return { ...lcView(db.prepare('SELECT l.*, c.contract_no FROM sjvn_lcs l JOIN contracts c ON c.id = l.contract_id WHERE l.id = ?').get(lc.id), { withEvents: true }), required_amount: lcRequired(contract), open_on_contract: lcOpenOn(contract.id) };
}));

router.post('/lcs/:id/close', (req, res) => send(res, () => {
  if (!canManageLc(req.user)) throw fail(403, 'Only the REIA desk or Finance closes a letter of credit');
  const { lc, contract } = lcFor(req.user, req.params.id);
  if (lc.status !== 'ACTIVE') throw fail(400, 'This letter of credit is already closed');
  const note = text(req.body.note, 500);
  if (!note) throw fail(400, 'Say why the letter of credit is being closed');
  db.prepare(`UPDATE sjvn_lcs SET status = 'CLOSED', updated_at = datetime('now') WHERE id = ?`).run(lc.id);
  lcEvent(lc.id, req.user, 'CLOSED', { note });
  audit(req, 'SJVN_LC_CLOSED', 'sjvn_lcs', lc.id, { reason: note });
  notifySide(contract, 'SELLER', `${lc.lc_no}: SJVN has closed the letter of credit in your favour — ${note}.`);
  return { ok: true };
}));

// ── Reminders ───────────────────────────────────────────────────────────────

/**
 * Tell the party that has to act that an instrument is running out.
 *
 * The existing cascade tells SJVN's own desk and management. The guarantee is
 * the counterparty's to extend, though, and it heard nothing until SJVN moved to
 * encash. One reminder per threshold crossed, none while an amendment is already
 * with SJVN. SJVN's own letters of credit remind its own desk.
 */
export function remindExpiringSecurity() {
  let sent = 0;
  const steps = [...new Set([warnDays(), criticalDays(), 15, 7, 0])].sort((a, b) => a - b);
  const already = db.prepare('SELECT 1 FROM security_alerts WHERE payment_security_id = ? AND alert_type = ? AND days_before = ?');
  const log = db.prepare('INSERT INTO security_alerts (id, payment_security_id, contract_id, alert_type, days_before, sent_to, message) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const stepFor = (days) => steps.find((s) => days <= s);

  const instruments = db.prepare(`
    SELECT ps.*, c.contract_no, c.seller_id, c.buyer_id FROM payment_security ps JOIN contracts c ON c.id = ps.contract_id
    WHERE ps.status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED') AND ps.validity_end IS NOT NULL
  `).all();
  for (const ps of instruments) {
    const days = daysUntil(ps.validity_end);
    const step = stepFor(days);
    if (step == null || days < 0) continue;
    if (already.get(ps.id, 'EXPIRY_CP', step)) continue;
    if (db.prepare(`SELECT 1 FROM security_amendments WHERE payment_security_id = ? AND status = 'PENDING'`).get(ps.id)) continue;
    const cp = counterpartyOf(ps);
    if (!cp) continue;
    const message = `${ps.instrument_no} (${ps.contract_no}) expires ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}, on ${ps.validity_end}. Have the bank extend it and submit the extension under Payment Security — a guarantee that lapses may be encashed.`;
    notifySide(ps, cp, message);
    // Looser thresholds are marked too, so a first run does not send one reminder per step.
    for (const s of steps.filter((x) => x >= step)) {
      if (!already.get(ps.id, 'EXPIRY_CP', s)) log.run(newId('PSA'), ps.id, ps.contract_id, 'EXPIRY_CP', s, cp, message);
    }
    sent += 1;
  }

  const lcs = db.prepare(`
    SELECT l.*, c.contract_no FROM sjvn_lcs l JOIN contracts c ON c.id = l.contract_id
    WHERE l.status = 'ACTIVE' AND l.validity_end IS NOT NULL
  `).all();
  for (const lc of lcs) {
    const days = daysUntil(lc.validity_end);
    const step = stepFor(days);
    if (step == null || days < 0) continue;
    if (already.get(lc.id, 'LC_EXPIRY', step)) continue;
    const message = `Letter of credit ${lc.lc_no} in the seller's favour (${lc.contract_no}) expires ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}, on ${lc.validity_end}. Renew it to keep the PPA's payment security in place.`;
    for (const role of [...ROLE_GROUPS.REIA_WRITE, 'FINANCE_USER']) pushNotification({ role, type: 'SECURITY', message: datesInWords(message) });
    for (const s of steps.filter((x) => x >= step)) {
      if (!already.get(lc.id, 'LC_EXPIRY', s)) log.run(newId('PSA'), lc.id, lc.contract_id, 'LC_EXPIRY', s, 'SJVN', message);
    }
    sent += 1;
  }
  return { sent };
}

router.post('/reminders/run', (req, res) => send(res, () => {
  if (!canManage(req.user)) throw fail(403, 'Not authorized');
  return remindExpiringSecurity();
}));

export default router;
