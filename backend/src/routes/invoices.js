import { Router } from 'express';
import { complianceBlock } from './invoiceCompliance.js';
import { createIntimation } from './buyerBills.js';
import { resolveTariff } from '../services/tariffStructure.js';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS, SELLER_ROLES, BUYER_ROLES, counterpartySide } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, genInvoiceNo, buildBillingFamilyRef, directionForContract, computeDueDate, resolvePaymentTermsDays, contractRebatePct, billableCapacityMw, invalidDecision } from '../util.js';
import { payableNow, lpsBaseAmount, tieredRebatePct, daysBetween } from '../disputesConstants.js';
import { invoiceLpsAsOf, lpsTermsFor, invoiceBalance } from '../services/invoiceLps.js';
import { payerStateForInvoice } from '../services/workingCalendar.js';
import { getParamNumber, getParam } from '../mastersService.js';
import { resolveBetaRow } from '../services/betaFactor.js';
import { sendSms } from '../services/smsService.js';
import { channelsFor, dispatch } from '../services/notificationService.js';
import { allocationsInForce, sourcesForPsa } from '../services/allocations.js';
import { contractVisibleTo, invoicePresentedTo, authoredBy, billPresentedOn, presentedSql, raisedBySellerSql, raisedBySeller } from '../services/counterpartyScope.js';
import { asOfFrom, isProjection } from '../services/clock.js';
import { computeCercHydroBill } from '../services/cercHydroBilling.js';
import { computeCufPenalty } from '../services/cufPenalty.js';
import { computePeakAvailabilityPenalty } from '../services/peakAvailability.js';
import {
  compareSellerToSystem,
  findSystemCounterpart,
  persistValidation,
} from '../services/sellerInvoiceMatch.js';
import {
  buildTemplate as buildVerificationTemplate,
  mergeSaved as mergeSavedVerification,
  rollupStatus as rollupVerification,
} from '../services/invoiceVerification.js';

const router = Router();
router.use(requireAuth);

/** Statuses safe to cancel (pre-settlement / pre-dispatch). */
const CANCELABLE_STATUSES = ['DRAFT', 'SUBMITTED', 'REJECTED', 'PENDING_L2', 'UNDER_APPROVAL'];
const OPEN_DISPUTE_STATUSES = ['RAISED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'INFO_REQUESTED', 'ESCALATED'];

function paidTotalFor(invoiceId) {
  return db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)),0) s FROM payments WHERE invoice_id = ?').get(invoiceId).s;
}

// Developer (PPA / SELLER_TO_SJVN) invoice pipeline per the REIA Dashboard doc:
// Submitted → Under Verification → Commercial Verification → Finance Approval →
// Approved → Payment Released. Derived from existing signals (verification,
// approval status, payment) so every invoice reflects a real stage.
const DEV_STAGES = ['SUBMITTED', 'UNDER_VERIFICATION', 'COMMERCIAL_VERIFICATION', 'FINANCE_APPROVAL', 'APPROVED', 'PAYMENT_RELEASED'];
function computeDevStage(inv) {
  if (inv.status === 'PAID') return 'PAYMENT_RELEASED';
  if (['APPROVED', 'SENT', 'PARTIALLY_PAID'].includes(inv.status)) return 'APPROVED';
  if (['UNDER_APPROVAL', 'PENDING_L2'].includes(inv.status)) return 'FINANCE_APPROVAL';
  if (inv.verification_status === 'VERIFIED') return 'COMMERCIAL_VERIFICATION';
  if (['IN_PROGRESS', 'FAILED'].includes(inv.verification_status)) return 'UNDER_VERIFICATION';
  return 'SUBMITTED';
}

// Pass-through "other charges" (transmission / RLDC-SLDC / CTU-STU / open access /
// scheduling). Rebate is NOT allowed on these (PSA Art. 6.4).
const OTHER_CHARGE_TYPES = {
  TRANSMISSION: 'Transmission / wheeling charges',
  RLDC_SLDC: 'RLDC / SLDC charges',
  CTU_STU: 'CTU / STU charges',
  OPEN_ACCESS: 'Open access charges',
  SCHEDULING: 'Scheduling & system operation charges',
  OTHER: 'Other pass-through charges',
};
const SEGREGATION_REFUSAL =
  'Segregation of duties: this invoice was raised by you (Maker). It must be approved by the designated authority: Manager (Commercial & Billing) — Sunil (Commercial Admin) / Meera (REIA Admin).';

/**
 * Whether this user raising and clearing the same bill would be one person
 * moving money end to end — the control every audit of a billing system looks
 * for first, and the one that matters most here because approval is what makes
 * a bill payable.
 *
 * Returns the refusal to give, or null when the two are genuinely different
 * people. It used to compare created_by — a display name — against the user's
 * id, which are never equal, so it never refused anyone: the creator of an
 * invoice could approve their own to APPROVED without objection.
 *
 * Identity comes from created_by_id. Bills raised before that column existed
 * were backfilled from the user register, and for anything still without one we
 * fall back to the recorded name. The fallback can in principle catch two
 * different people who share a name, and that is the direction to err in: being
 * asked for a second approver costs someone a message, while letting the maker
 * clear their own bill is the failure the control exists to prevent.
 */
/**
 * How many approvals a bill of this size needs.
 *
 * Every invoice took exactly two levels, inserted unconditionally, so a 3,500
 * bill and a 1.75 crore bill were routed identically — the levels existed but
 * carried no information about how much was at stake.
 *
 * The bands come from the invoice_approval_levels master so the amounts are
 * SJVN's to set rather than mine to invent. Each entry is { above, levels },
 * read as "a bill above this amount needs this many": the highest band whose
 * threshold the bill clears wins, and anything below the lowest takes
 * min_levels. The default keeps two levels for everything except small bills,
 * so nothing already in flight is loosened by this change — the only bills that
 * move are the ones under the first threshold, which drop to one.
 */
const DEFAULT_APPROVAL_BANDS = [{ above: 1000000, levels: 3 }, { above: 100000, levels: 2 }];

function approvalLevelsFor(inv) {
  const amount = Math.abs(Number(inv?.total_amount) || 0);
  const minLevels = Math.max(1, Number(getParamNumber('invoice_approval_min_levels', 1)) || 1);

  let bands = getParam('invoice_approval_levels', null);
  if (typeof bands === 'string') { try { bands = JSON.parse(bands); } catch { bands = null; } }
  if (!Array.isArray(bands) || !bands.length) bands = DEFAULT_APPROVAL_BANDS;

  const sorted = bands
    .filter((b) => Number.isFinite(Number(b?.above)) && Number.isFinite(Number(b?.levels)))
    .sort((a, b) => Number(b.above) - Number(a.above));

  for (const b of sorted) {
    if (amount > Number(b.above)) return Math.max(minLevels, Math.round(Number(b.levels)));
  }
  return minLevels;
}

/** Whether each approval level of a bill has to be decided by a different person. */
const distinctApprovers = () => String(getParam('invoice_approval_distinct_approvers', '0')) === '1';

// Validation outcomes that mean the seller's bill and the system's own figure do not agree.
// NO_COUNTERPART is no longer a blocker — when a seller submits their bill, SJVN can directly verify and approve it.
const UNRESOLVED_VALIDATION = ['PARTIAL', 'MISMATCH'];

/**
 * Whether a found validation problem is still outstanding on this invoice.
 */
function unresolvedValidation(inv, user) {
  if (user && ['IT_SUPER_ADMIN', 'SJVN_ADMIN'].includes(user.role)) return null;
  if (!inv?.validation_status) return null;
  if (!UNRESOLVED_VALIDATION.includes(inv.validation_status)) return null;
  return `This seller invoice does not agree with the system's own figure (${inv.validation_status}). Correct it and re-validate, or waive the validation with a recorded reason, before approving.`;
}

function makerCheckerConflict(inv, user) {
  if (!inv || !user) return null;
  // Super admins, SJVN admins, and REIA/Commercial admins have administrative override authority across all levels
  if (['IT_SUPER_ADMIN', 'SJVN_ADMIN', 'REIA_ADMIN', 'COMMERCIAL_ADMIN'].includes(user.role)) return null;
  if (inv.created_by_id && user.id) {
    return inv.created_by_id === user.id ? SEGREGATION_REFUSAL : null;
  }
  // No id recorded: fall back to created_by, which is matched against both the
  // name and the id because rows predating created_by_id were written by
  // whichever path raised them and are not consistent about which they hold.
  if (inv.created_by && (inv.created_by === user.name || inv.created_by === user.id)) {
    return SEGREGATION_REFUSAL;
  }
  return null;
}

function parseOtherCharges(inv) {
  try { return JSON.parse(inv.other_charges_json || '[]'); } catch { return []; }
}
function otherChargesSum(inv) {
  return parseOtherCharges(inv).reduce((a, c) => a + (Number(c.amount) || 0), 0);
}

function withContract(inv, asOf = new Date()) {
  if (!inv) return inv;
  const contract = db.prepare('SELECT contract_no, contract_type, project_type, lps_annual_pct, lps_grace_days FROM contracts WHERE id = ?').get(inv.contract_id);
  const settled = ['PAID', 'CANCELLED', 'DRAFT'].includes(inv.status);

  // What is still owed on the bill today. payable_now below is the whole bill
  // as it stands (total − rebate + surcharge − disputed) and never came down as
  // money arrived, so the screens showed "Payable Now 12,00,000" on a bill with
  // 51,000 already settled against it — and disagreed with the buyer's own
  // "Left to pay", which did the subtraction. One figure, worked in one place.
  const { paid, accrued, lps_to_date: lpsToDate, balance } = invoiceBalance(inv, asOf);

  // Calendar days past the due date. days_overdue is the days surcharge was
  // charged for, which leaves out the payer's holidays when the masters say so
  // — right for the sum, wrong as an answer to "how late is this bill".
  let daysPastDue = 0;
  if (!settled && inv.due_date && balance > 0) {
    const due = new Date(`${String(inv.due_date).slice(0, 10)}T00:00:00Z`);
    const day = new Date(asOf);
    const today = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    if (Number.isFinite(due.getTime())) daysPastDue = Math.max(0, Math.round((today - due.getTime()) / 86400000));
  }
  const terms = lpsTermsFor(inv.contract_id);

  return {
    ...inv,
    contract_no: contract?.contract_no,
    project_type: contract?.project_type,
    ...payableNow(inv),
    paid_total: paid,
    lps_to_date: lpsToDate,
    balance_due: balance,
    accrued_lps: accrued.lps,
    days_overdue: accrued.days_overdue,
    days_past_due: daysPastDue,
    lps_annual_pct: terms.annualPct,
    lps_grace_days: terms.graceDays,
    raised_by_seller: raisedBySeller(inv),
    // A credit note raised when a dispute was upheld. The bill it answers has
    // already come down by the same amount, so a total that adds both counts the credit twice.
    is_dispute_credit: !!db.prepare('SELECT 1 FROM disputes WHERE supplementary_invoice_id = ?').get(inv.id),
    dev_stage: inv.direction === 'SELLER_TO_SJVN' ? computeDevStage(inv) : null,
    dev_stages: inv.direction === 'SELLER_TO_SJVN' ? DEV_STAGES : null,
    other_charges: parseOtherCharges(inv),
  };
}

/**
 * Every rejection a bill has had, oldest first. Resubmitting resets the level
 * rows for the new round, and the reason the bill was sent back went with them
 * — the one thing the next approver most wants to read.
 */
function approvalHistory(invoiceId) {
  return db.prepare(`
    SELECT created_at, user_name, details FROM audit_logs
    WHERE entity_type = 'invoice' AND entity_id = ? AND action = 'APPROVAL_REJECTED'
    ORDER BY rowid ASC LIMIT 50
  `).all(invoiceId).map((r) => {
    let d = {};
    try { d = JSON.parse(r.details || '{}') || {}; } catch { /* a row without readable details still happened */ }
    return { decision: 'REJECTED', level: Number(d.level) || null, comments: d.comments || null, by: r.user_name, at: r.created_at };
  });
}

// A counterparty acts only on bills under its own company's contracts. The
// routes that move or validate an invoice took its id and acted for any seller
// who asked, including one billing under a different company's PPA.
function ownsInvoice(user, inv) {
  const contract = db.prepare('SELECT seller_id, buyer_id FROM contracts WHERE id = ?').get(inv.contract_id);
  return contractVisibleTo(user, contract);
}

// E/F. Billing & Invoicing + Seller Invoice Management - list
router.get('/', (req, res) => {
  const { status, contract_id, direction, billing_period } = req.query;
  let sql, params = [];
  
  // Counterparties see only bills that have actually been issued to them, on
  // the same bar the send route uses for distribution.
  if (req.user.role.startsWith('SELLER')) {
    sql = `
      SELECT i.* FROM invoices i JOIN contracts c ON i.contract_id = c.id
      WHERE c.seller_id = ?
        AND (
          ${raisedBySellerSql('i')}
          OR (
            ${presentedSql('i')}
            AND NOT EXISTS (
              SELECT 1 FROM invoices s
              WHERE s.contract_id = i.contract_id
                AND s.billing_period = i.billing_period
                AND s.id != i.id
                AND ${raisedBySellerSql('s')}
                AND s.status != 'CANCELLED'
            )
          )
        )
    `;
    params.push(req.user.linked_entity_id);
  } else if (req.user.role.startsWith('BUYER')) {
    sql = `SELECT i.* FROM invoices i JOIN contracts c ON i.contract_id = c.id WHERE c.buyer_id = ? AND i.direction = 'SJVN_TO_BUYER' AND ${presentedSql('i')}`;
    params.push(req.user.linked_entity_id);
  } else {
    sql = 'SELECT i.* FROM invoices i WHERE 1=1';
  }
  
  if (status) { sql += ' AND i.status = ?'; params.push(status); }
  if (contract_id) { sql += ' AND i.contract_id = ?'; params.push(contract_id); }
  if (direction) { sql += ' AND i.direction = ?'; params.push(direction); }
  if (billing_period) { sql += ' AND i.billing_period = ?'; params.push(billing_period); }
  sql += ' ORDER BY i.created_at DESC';
  // Not .map(withContract): map passes the row's index as the second argument,
  // which withContract reads as its as-of date. Every row was aged to 1 January
  // 1970, so no bill in a list was ever overdue and the overdue chip never showed.
  res.json(db.prepare(sql).all(...params).map((inv) => withContract(inv)));
});

/**
 * Payments against the bills the caller can see, newest first — the ledger the
 * counterparty payment screens show. They used to fetch every invoice one by one
 * for its payments: a request per bill and, now that a counterparty opening a
 * bill is recorded, a false "opened" entry per bill.
 */
router.get('/payments', (req, res) => {
  const { contract_id, direction } = req.query;
  const where = [];
  const params = [];
  const side = counterpartySide(req.user);
  if (side === 'SELLER') {
    where.push(`c.seller_id = ? AND (${raisedBySellerSql('i')} OR (${presentedSql('i')} AND NOT EXISTS (SELECT 1 FROM invoices s WHERE s.contract_id = i.contract_id AND s.billing_period = i.billing_period AND s.id != i.id AND ${raisedBySellerSql('s')} AND s.status != 'CANCELLED')))`);
    params.push(req.user.linked_entity_id);
  } else if (side === 'BUYER') {
    where.push(`c.buyer_id = ? AND i.direction = 'SJVN_TO_BUYER' AND ${presentedSql('i')}`);
    params.push(req.user.linked_entity_id);
  }
  if (contract_id) { where.push('i.contract_id = ?'); params.push(String(contract_id)); }
  if (direction) { where.push('i.direction = ?'); params.push(String(direction)); }
  res.json(db.prepare(`
    SELECT p.*, i.invoice_no, i.billing_period, i.direction, i.contract_id, c.contract_no
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    JOIN contracts c ON c.id = i.contract_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY p.payment_date DESC, p.rowid DESC
  `).all(...params));
});

import fs from 'fs';
import path from 'path';
import { generateInvoicePdf, generateInvoicePdfBuffer } from '../scripts/invoicePdf.js';
import { sendMail, formatInvoiceEmail, getMailConfig } from '../services/mailService.js';
import { sendMessage, attachmentDir } from '../services/mail.js';

router.get('/:id/pdf', async (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(inv.contract_id);
  const seller = db.prepare('SELECT * FROM entities WHERE id = ?').get(contract.seller_id);
  const buyer = db.prepare('SELECT * FROM entities WHERE id = ?').get(contract.buyer_id);

  // Counterparties may only download their own invoices (same scoping as the list).
  if (req.user.role.startsWith('SELLER') && contract.seller_id !== req.user.linked_entity_id) {
    return res.status(403).json({ error: 'You can only download your own invoices' });
  }
  if (req.user.role.startsWith('BUYER') && contract.buyer_id !== req.user.linked_entity_id) {
    return res.status(403).json({ error: 'You can only download your own invoices' });
  }
  // The rule the detail view already applies: a bill SJVN has not finished
  // approving is not yet the counterparty's to read — and the PDF is the bill.
  if (!invoicePresentedTo(req.user, inv) && !authoredBy(req.user, inv)) return res.status(404).json({ error: 'Invoice not found' });

  // Who took a copy of which bill, and when — the access history the buyer-portal
  // scope asks for. The counterparty's views are recorded on GET /:id.
  logAudit({
    req, action: 'DOWNLOAD_INVOICE_PDF', module: 'REIA', entityType: 'invoice', entityId: inv.id,
    details: { invoice_no: inv.invoice_no },
  });

  // Hydro/PSP PPA bills carry a beneficiary-allocation page — how the plant's
  // charges split across the DISCOMs allocated to it (per REA / NRPC order),
  // using the allocation effective for the billing month.
  let beneficiaries = [];
  if (['Hydro', 'PSP'].includes(contract?.project_type) && contract.contract_type === 'PPA') {
    const pStart = `${inv.billing_period}-01`;
    const pEnd = `${inv.billing_period}-31`;
    const rows = db.prepare(`
      SELECT b.name AS name, ca.allocation_percent AS allocation_percent
      FROM contract_allocations ca
      JOIN contracts s ON s.id = ca.psa_id
      LEFT JOIN entities b ON b.id = s.buyer_id
      WHERE ca.ppa_id = ?
        AND ca.effective_from <= ?
        AND (ca.effective_to IS NULL OR ca.effective_to >= ?)
      ORDER BY ca.allocation_percent DESC
    `).all(contract.id, pEnd, pStart);
    const total = Number(inv.total_amount) || 0;
    beneficiaries = rows.map((x) => ({ ...x, share: Math.round(total * (Number(x.allocation_percent) || 0) / 100) }));
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Invoice_${String(inv.invoice_no).replace(/[^\w.-]+/g, '_')}.pdf`);

  try {
    await generateInvoicePdf(inv, contract, seller, buyer, res, beneficiaries);
  } catch (err) {
    console.error('PDF Generation Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate PDF', details: err.message });
    }
  }
});

// Preview a buyer's outstanding position (for the waterfall payment modal).
// Must be declared before '/:id' so it isn't captured as an invoice id.
router.get('/buyer-outstanding', requireRole(...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE), (req, res) => {
  const { buyer_id } = req.query;
  if (!buyer_id) return res.status(400).json({ error: 'buyer_id is required' });
  const items = buyerOutstanding(buyer_id).map((x) => ({
    invoice_no: x.inv.invoice_no, billing_period: x.inv.billing_period, lps: x.lps, principal: x.principal, due: x.lps + x.principal,
  }));
  res.json({
    items,
    total_lps: items.reduce((a, i) => a + i.lps, 0),
    total_principal: items.reduce((a, i) => a + i.principal, 0),
    total_due: items.reduce((a, i) => a + i.due, 0),
  });
});

// Registered above '/:id', or the router reads "upload-template" as an
// invoice id and answers 404.
router.get('/upload-template', requireRole(...SELLER_ROLES, ...ROLE_GROUPS.REIA_WRITE), (_req, res) => {
  const lines = [
    INVOICE_UPLOAD_COLUMNS.join(','),
    'PPA/SOLAR/001,2026-08,,FINAL,1250.5,3.15,3939075,0,0,0,0,0,0',
    'PPA/WIND/002,2026-08,SELLER/2026/08/02,FINAL,880,3.40,2992000,15000,0,0,0,0,0',
  ];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=seller_invoice_template.csv');
  res.send(lines.join('\n'));
});

router.get('/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  // Same scoping the list has always applied. Without it the id in the URL was
  // the only thing keeping a counterparty out of someone else's bill — and the
  // payload carries the totals, payments and open disputes with it.
  const contract = db.prepare('SELECT seller_id, buyer_id FROM contracts WHERE id = ?').get(inv.contract_id);
  if (!contractVisibleTo(req.user, contract)) return res.status(404).json({ error: 'Invoice not found' });
  // A bill SJVN has not finished approving is not yet the counterparty's to read.
  if (!invoicePresentedTo(req.user, inv) && !authoredBy(req.user, inv)) return res.status(404).json({ error: 'Invoice not found' });

  // Scope G's access history: when the counterparty actually opened its bill.
  // SJVN's own reads are not recorded — the desk opens a bill many times in the
  // ordinary course, and those rows would bury the ones that matter. The desk
  // gets the history back; the counterparty does not.
  const isCounterparty = req.user.role.startsWith('SELLER') || req.user.role.startsWith('BUYER');
  if (isCounterparty) {
    logAudit({
      req, action: 'VIEW_INVOICE', module: 'REIA', entityType: 'invoice', entityId: inv.id,
      details: { invoice_no: inv.invoice_no },
    });
  }
  const access_log = isCounterparty ? undefined : db.prepare(`
    SELECT created_at, user_name, user_role, action FROM audit_logs
    WHERE entity_type = 'invoice' AND entity_id = ? AND action IN ('VIEW_INVOICE', 'DOWNLOAD_INVOICE_PDF')
    ORDER BY rowid DESC LIMIT 100
  `).all(inv.id);

function enrichApprovals(approvals) {
  const l1Users = db.prepare("SELECT name FROM users WHERE role IN ('REIA_ADMIN', 'COMMERCIAL_ADMIN', 'SJVN_ADMIN') AND is_active = 1").all().map(u => u.name);
  const l2Users = db.prepare("SELECT name FROM users WHERE role = 'FINANCE_USER' AND is_active = 1").all().map(u => u.name);
  const l3Users = db.prepare("SELECT name FROM users WHERE role IN ('MANAGEMENT', 'IT_SUPER_ADMIN', 'SJVN_ADMIN') AND is_active = 1").all().map(u => u.name);

  const LEVEL_CONFIG = {
    1: {
      stage_title: 'Commercial Review & Verification',
      designation: 'Manager (Commercial & Billing)',
      candidates: l1Users.length ? l1Users : ['Sunil (Commercial Admin)', 'Meera (REIA Admin)'],
    },
    2: {
      stage_title: 'Finance Concurrence',
      designation: 'DGM / Senior Manager (Finance)',
      candidates: l2Users.length ? l2Users : ['Vikas (Finance)'],
    },
    3: {
      stage_title: 'Final Administrative Sanction',
      designation: 'Head of Commercial / CGM',
      candidates: l3Users.length ? l3Users : ['Divyankur (Management)', 'Admin User'],
    },
  };

  return approvals.map((a) => {
    const cfg = LEVEL_CONFIG[a.level] || {
      stage_title: `Level ${a.level} Review`,
      designation: 'Designated Authority',
      candidates: [],
    };
    return {
      ...a,
      stage_title: cfg.stage_title,
      designation: cfg.designation,
      designated_names: cfg.candidates.join(' / '),
    };
  });
}

  const rawApprovals = db.prepare('SELECT * FROM invoice_approvals WHERE invoice_id = ? ORDER BY level').all(req.params.id);
  const approvals = enrichApprovals(rawApprovals);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date').all(req.params.id);
  const disputes = db.prepare('SELECT * FROM disputes WHERE invoice_id = ? ORDER BY created_at DESC').all(req.params.id);

  // For developer (PPA) invoices, expose how much DISCOM realization is available
  // to fund a pay-when-paid release, net of what's already been released from it.
  let generator_realization = null;
  if (inv.direction === 'SELLER_TO_SJVN') {
    const { realized, linked_psa } = generatorRealization(inv.id);
    const fromRealization = db.prepare(
      "SELECT COALESCE(SUM(amount + COALESCE(deduction,0)),0) s FROM payments WHERE invoice_id = ? AND release_source = 'DISCOM_REALIZATION'"
    ).get(inv.id).s;
    generator_realization = { linked_psa, realized, released_from_realization: Math.round(fromRealization), available: Math.max(0, realized - Math.round(fromRealization)) };
  }
  // ?as_of=YYYY-MM-DD projects the surcharge position forward without touching
  // anything — what this bill costs the payer if it is still unpaid on that day.
  let asOf;
  try { asOf = asOfFrom(req); } catch (err) { return res.status(err.status || 400).json({ error: err.message }); }

  // The parent bill by the number a person knows it by, not its row id.
  const parent = inv.parent_invoice_id
    ? db.prepare('SELECT invoice_no FROM invoices WHERE id = ?').get(inv.parent_invoice_id) : null;

  res.json({
    ...withContract(inv, asOf),
    parent_invoice_no: parent?.invoice_no || null,
    approvals, approval_history: approvalHistory(inv.id), approval_rules: { distinct_approvers: distinctApprovers() },
    payments, disputes, generator_realization, access_log,
    ...(isProjection(req) ? { projected_as_of: asOf.toISOString().slice(0, 10) } : {}),
  });
});

// Automated invoice generation based on contract + locked energy data
// Supports two billing modes:
//   1. CERC Hydro (Capacity + Energy + Incentive - Free Power + NRLDC)
//   2. Simple RE (Energy * Tariff) for Solar/Wind/Hybrid
// A refusal that carries the status the route should answer with.
function refuse(status, payload) {
  const err = new Error(payload.error || 'Request refused');
  err.status = status;
  err.payload = payload;
  return err;
}

// Build and persist one invoice for a contract and period. Extracted from the
// route so a PPA can fan out into one invoice per PSA without duplicating any
// of the pricing. Refusals throw with a status the caller turns into a response.
function generateInvoiceFor({ contract_id, period_month, invoice_type, seller_invoice_ids }, req) {

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) throw refuse(404, { error: 'Contract not found' });

  // A contract is only billable once it is live. Billing one still in
  // negotiation or awaiting regulatory approval raises a demand the counterparty
  // has no obligation to meet.
  const BILLABLE_STATUSES = ['ACTIVE', 'NEARING_EXPIRY', 'EXPIRED', 'RENEWED', 'AMENDED'];
  if (!BILLABLE_STATUSES.includes(contract.status)) {
    throw refuse(400, {
      error: `Cannot bill a contract in status ${contract.status} — it must be ACTIVE first.`,
    });
  }

  // Nothing is billable before commercial operation, whatever energy was
  // recorded during testing and commissioning.
  if (contract.cod_date && period_month) {
    const periodEnd = `${period_month}-31`;
    if (String(contract.cod_date) > periodEnd) {
      throw refuse(400, {
        error: `Cannot bill ${period_month}: it ends before the commercial operation date (${contract.cod_date}).`,
      });
    }
  }

  // Nor before the contract itself begins. The COD check above only fires
  // where a COD is recorded; a contract without one answered a month years
  // before its tenure with "no energy data found", as though data were missing.
  if (contract.tenure_start && period_month) {
    const periodEnd = `${period_month}-31`;
    if (String(contract.tenure_start) > periodEnd) {
      throw refuse(400, {
        error: `Cannot bill ${period_month}: the contract only starts on ${contract.tenure_start}.`,
        tenure_start: contract.tenure_start,
      });
    }
  }

  // And nothing is billable after the contract has run out. EXPIRED is a
  // billable status on purpose — a final or revised bill for a period the
  // contract did cover often lands after it has ended — but nothing checked the
  // period itself, so a contract that ended in July 2026 would raise an invoice
  // for January 2031 as readily as for its last month.
  //
  // The bound is on the period, not on today: a period that started before the
  // contract ended is fair to bill whenever the paperwork catches up. A period
  // beginning after the end date was never covered by anything.
  if (contract.tenure_end && period_month) {
    const periodStart = `${period_month}-01`;
    if (periodStart > String(contract.tenure_end)) {
      throw refuse(400, {
        error: `Cannot bill ${period_month}: the contract ran to ${contract.tenure_end} and did not cover this period.`,
        tenure_end: contract.tenure_end,
      });
    }
  }

  // If PSA, resolve its source PPAs via the allocations in force for this period.
  //
  // This used to select on psa_id alone and take whichever row came back first,
  // with no date filter and no ordering — so allocations were written with
  // effective dates the billing never read. A re-split could not change a bill,
  // and a PSA whose share had ended went on being billed it.
  //
  // The allocation in force on the first day of the period governs the whole
  // period. A change dated mid-month therefore applies from the following
  // month's bill: monthly billing has one allocation per bill, and pro-rating a
  // month across two splits is a pricing decision nobody has made.
  //
  // A PSA can draw from several PPAs at once — a DISCOM's PSA is often backed by
  // more than one developer — and it then took only the latest of them, billing
  // the buyer for part of what it received. Every source in force is billed:
  // energy = Σ (each PPA's energy for the month × this PSA's share of it).
  let sources = [{ ppa_id: contract_id, allocation_percent: 100 }];
  let psaUnallocated = false;
  if (contract.contract_type === 'PSA') {
    const inForce = sourcesForPsa(contract_id, period_month);
    if (inForce.length) {
      sources = inForce;
    } else {
      // Allocated at some point but not for this period: the share has ended or
      // has not started. Refusing beats falling back to the PSA's own contract
      // id, which produced "no energy data found" and read like missing data.
      const any = db.prepare('SELECT COUNT(*) c FROM contract_allocations WHERE psa_id = ?').get(contract_id).c;
      if (any > 0) {
        throw refuse(400, {
          error: `This PSA holds no allocation for ${period_month} — its share of the PPA had ended or had not yet started.`,
          period_month,
        });
      }
      // Never allocated at all. Its own energy rows are still tried below, for
      // a PSA whose energy is recorded on it directly.
      psaUnallocated = true;
    }
  }
  const multiSource = sources.length > 1;
  const alloc_percent = sources[0].allocation_percent;

  const pickEnergy = db.prepare(`
    SELECT * FROM energy_data WHERE contract_id = ? AND period_month = ?
    ORDER BY
      CASE WHEN ? = 'FINAL' THEN (data_type = 'FINAL') ELSE (data_type = 'PROVISIONAL') END DESC,
      (data_type = 'FINAL') DESC,
      -- of two sources for the month, the one that was locked
      (status = 'LOCKED') DESC,
      created_at DESC
    LIMIT 1
  `);
  const supplies = sources.map((source) => ({
    source,
    energy: pickEnergy.get(source.ppa_id, period_month, invoice_type || 'PROVISIONAL'),
  }));

  if (multiSource) {
    // Billing the sources that have reported and leaving out the one that has
    // not would send the buyer a bill for part of the month that reads as whole.
    const missing = supplies.filter((s) => !s.energy).map((s) => s.source.ppa_contract_no);
    if (missing.length) {
      throw refuse(400, {
        error: `${contract.contract_no} draws from ${sources.length} PPAs, and ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no energy for ${period_month}. A PSA is billed for its whole supply or not at all — upload that energy, then generate again.`,
        missing_source_ppas: missing,
      });
    }
  }
  let energy = supplies[0].energy;

  if (!energy && psaUnallocated) {
    // The commonest reason a PSA cannot be billed, and "no energy data" sent
    // people to look for a file that was never missing.
    throw refuse(400, {
      error: `${contract.contract_no} is not linked to any PPA — it holds no allocation, so there is no energy to bill it for. Open the source PPA under Contracts (PPA/PSA), allocate this PSA its share, then generate again.`,
      reason: 'PSA_NOT_ALLOCATED',
    });
  }
  if (!energy) throw refuse(400, { error: 'No energy data found for this contract (or parent PPA)/period. Upload energy data first.' });

  const resolvedType = invoice_type || (supplies.every((s) => s.energy.data_type === 'FINAL') ? 'FINAL' : 'PROVISIONAL');

  // One bill of a kind per contract and month. Nothing checked, so a second
  // click on Generate — or a second person on the same morning — raised the same
  // month twice, each one a demand on the counterparty. A correction to a bill
  // that exists is a supplementary, which says so; a bill raised in error is
  // cancelled first, with its reason.
  const twin = db.prepare(`
    SELECT invoice_no, status FROM invoices
    WHERE contract_id = ? AND billing_period = ? AND direction = ? AND invoice_type = ?
      AND status != 'CANCELLED' AND TRIM(COALESCE(invoice_breakdown_json, '')) != ''
    ORDER BY created_at DESC LIMIT 1
  `).get(contract_id, period_month, directionForContract(contract), resolvedType);
  if (twin) {
    throw refuse(409, {
      error: `${contract.contract_no} already has a ${resolvedType} bill for ${period_month} — ${twin.invoice_no} (${twin.status.replace(/_/g, ' ')}). Cancel that one first, or raise a Supplementary for a correction.`,
      existing_invoice_no: twin.invoice_no,
    });
  }

  // A provisional bill may run on provisional energy — that is what makes it
  // provisional. It may not run on energy validation actively flagged. Only a
  // FINAL bill used to check anything here, so a flagged period was billed
  // provisionally and the validation result changed nothing. Locking it over the
  // flag is still open to whoever owns that call; it just has to be an owned one.
  //
  // Checked before the not-LOCKED refusal below: both would refuse a flagged
  // FINAL period, but "failed validation, here is what" is the answer worth
  // giving over "not locked", which leaves the reader to go and find out why.
  // Each source is held to this on its own: one flagged or unlocked PPA is
  // enough to stop a bill that draws on it, and the message names which.
  for (const { source, energy: e } of supplies) {
    const whose = multiSource ? `${source.ppa_contract_no}: ` : '';
    if (e.status === 'DISPUTED') {
      throw refuse(400, {
        error: `${whose}This period failed energy validation — correct and re-validate it, or lock it with a recorded reason before billing.`,
        energy_status: e.status,
        validation_note: e.deviation_notes,
      });
    }
    if (resolvedType === 'FINAL' && e.status !== 'LOCKED') {
      throw refuse(400, { error: `${whose}Cannot generate FINAL invoice because energy data is not LOCKED.` });
    }
    if (resolvedType === 'FINAL' && e.data_type !== 'FINAL') {
      throw refuse(400, { error: `${whose}Cannot generate FINAL invoice: no FINAL energy row for this period (provisional must remain separate).` });
    }
  }

  // A hydro bill's capacity charge and Beta incentive rest on one station's
  // availability and its NRPC certificate; there is no rule here for blending
  // stations into one bill, so one is not invented.
  if (multiSource && ['Hydro', 'PSP'].includes(contract.project_type)) {
    throw refuse(400, {
      error: `${contract.contract_no} is a hydro PSA drawing from ${sources.length} stations (${sources.map((s) => s.ppa_contract_no).join(', ')}). A hydro bill is worked on one station's availability and Beta — bill it from one source PPA.`,
    });
  }

  // ──── Billing Calculation Engine ────
  // tariff_per_unit is ₹/kWh (per "unit"); energy is in MWh → convert MWh→kWh (×1000).
  const UNITS_PER_MWH = 1000;
  const shareOf = (mwh, pct) => ((Number(mwh) || 0) * pct) / 100;
  const allocated_energy_mwh = multiSource
    ? Math.round(supplies.reduce((t, s) => t + shareOf(s.energy.energy_mwh, s.source.allocation_percent), 0) * 1e6) / 1e6
    : (energy.energy_mwh * alloc_percent) / 100;
  const allocated_units_kwh = allocated_energy_mwh * UNITS_PER_MWH;
  const breakdown = [];
  let capacityCharges = 0;
  let incentiveCharges = 0;
  let freePowerDeduction = 0;
  let nrldcFees = 0;
  let energyCharges = 0;

  // PSA bills draw energy from the parent PPA — surface that linkage explicitly.
  if (contract.contract_type === 'PSA' && !multiSource && alloc_percent !== 100) {
    breakdown.push({ code: 'SRC', label: `Source PPA Energy (${period_month})`, value: energy.energy_mwh });
    breakdown.push({ code: 'ALLOC', label: `Allocation to this PSA (${alloc_percent}%)`, value: allocated_energy_mwh });
  }
  // With several sources, each one's energy and this PSA's share of it, so the
  // bill shows where every MWh of the total came from.
  if (multiSource) {
    for (const { source, energy: e } of supplies) {
      const ref = { ppa_id: source.ppa_id, ppa_contract_no: source.ppa_contract_no, energy_data_id: e.id };
      breakdown.push({ code: 'SRC', label: `Source ${source.ppa_contract_no} energy (${period_month}, ${e.data_type.toLowerCase()})`, value: e.energy_mwh, format: 'mwh', ...ref });
      breakdown.push({
        code: 'ALLOC',
        label: `${source.ppa_contract_no} share to this PSA (${source.allocation_percent}%)`,
        value: Math.round(shareOf(e.energy_mwh, source.allocation_percent) * 1e6) / 1e6,
        format: 'mwh',
        allocation_percent: source.allocation_percent,
        ...ref,
      });
    }
    // What the downstream lines read off "the" energy row is, for a combined
    // supply, each plant's figure weighted by the MW of it this PSA takes —
    // the availability of the supply as a whole. A figure one plant did not
    // report leaves the combined one unknown rather than guessed.
    const weighted = (field) => {
      let num = 0;
      let den = 0;
      for (const { source, energy: e } of supplies) {
        const w = (source.allocation_percent * (Number(source.ppa_capacity_mw) || 0)) / 100;
        if (e[field] == null || e[field] === '' || !(w > 0)) return null;
        num += Number(e[field]) * w;
        den += w;
      }
      return den > 0 ? Math.round((num / den) * 100) / 100 : null;
    };
    energy = {
      id: null,
      cuf_percent: weighted('cuf_percent'),
      availability_percent: weighted('availability_percent'),
      peak_availability_percent: weighted('peak_availability_percent'),
      lock_override_reason: null,
    };
  }

  const isHydro = ['Hydro', 'PSP'].includes(contract.project_type);
  let appliedTariff = contract.tariff_per_unit;
  let transmissionCharges = 0;
  let deemedEnergyMwh = 0;
  let deemedCharges = 0;

  if (isHydro && (contract.annual_afc || contract.capacity_charges_total || contract.annual_design_energy_mwh)) {
    // ──── CERC Hydro Billing (NJHPS-style) ────
    const betaRow = resolveBetaRow(contract, period_month);
    const hydro = computeCercHydroBill({
      contract,
      periodMonth: period_month,
      exBusEnergyMwh: allocated_energy_mwh,
      pafmPercent: energy.availability_percent,
      betaValue: betaRow?.beta_value,
    });

    capacityCharges = hydro.capacityCharges;
    energyCharges = hydro.energyCharges;
    incentiveCharges = hydro.incentiveCharges;
    freePowerDeduction = 0; // saleable already excludes free power
    appliedTariff = hydro.ecr;

    breakdown.push({ code: 'A1', label: 'Annual Fixed Charges (AFC)', value: hydro.afc, format: 'currency' });
    if (hydro.de) breakdown.push({ code: 'A2', label: 'Annual Design Energy (DE) MWh', value: hydro.de, format: 'mwh' });
    breakdown.push({ code: 'A3', label: `Normative Auxiliary (AUX)`, value: hydro.aux, format: 'pct' });
    breakdown.push({ code: 'A4', label: `Free Energy Home State (FEHS)`, value: hydro.fehs, format: 'pct' });
    breakdown.push({ code: 'A11', label: 'NAPAF %', value: hydro.napaf, format: 'pct' });
    breakdown.push({ code: 'A12', label: `Energy Charge Rate (ECR) ₹/kWh`, value: hydro.ecr, format: 'ecr' });

    breakdown.push({ code: 'C2', label: hydro.capacityLabel, value: capacityCharges });
    breakdown.push({
      code: 'C3',
      label: betaRow
        ? `Beta Factor β ${Number(betaRow.beta_value).toFixed(2)}${betaRow.station_code ? ` (${betaRow.station_code})` : ''}${betaRow.certified_on ? ` · certified ${betaRow.certified_on}` : ''}`
        : 'Beta Factor β — pending NRPC certificate',
      value: betaRow ? Number(betaRow.beta_value) : 0,
      format: 'beta',
    });
    breakdown.push({
      code: 'C4',
      label: `Incentive on account of Beta — ${hydro.beta.reason}`,
      value: incentiveCharges,
    });
    breakdown.push({
      code: 'C5',
      label: 'Total Capacity Charges (incl. Beta Incentive)',
      value: capacityCharges + incentiveCharges,
    });

    breakdown.push({ code: 'E1', label: 'Ex-bus Scheduled Energy (MWh)', value: hydro.e1 });
    breakdown.push({ code: 'E2', label: `Free Power Home State (${hydro.fehs}%)`, value: hydro.freeMwh });
    breakdown.push({ code: 'E3', label: 'Ex-bus Saleable Scheduled Energy (MWh)', value: hydro.saleableMwh });
    breakdown.push({
      code: 'EE1',
      label: `Energy Charges (${hydro.saleableMwh} MWh × ₹${hydro.ecr}/kWh)`,
      value: energyCharges,
    });

    const nrldcPerMw = getParamNumber('nrldc_fee_per_mw', 100);
    // Per MW of capacity actually in service, not of capacity still being built.
    nrldcFees = Math.round(billableCapacityMw(contract) * nrldcPerMw);
    if (nrldcFees) breakdown.push({ code: 'NR', label: 'NRLDC/SLDC Fees', value: nrldcFees });

  } else {
    // ──── Simple RE Billing (Solar/Wind/Hybrid) ────
    // The rate comes from the contract's tariff structure, so an escalating or
    // two-part contract is billed on its actual terms rather than its base rate.
    const tariff = resolveTariff(contract, period_month);
    appliedTariff = tariff.rate;
    energyCharges = Math.round(allocated_units_kwh * tariff.rate);
    breakdown.push({ code: 'E1', label: 'Total Energy (MWh)', value: allocated_energy_mwh });
    if (tariff.type !== 'FLAT') breakdown.push({ code: 'TS', label: tariff.label, value: tariff.rate, format: 'ecr' });
    breakdown.push({ code: 'EE1', label: `Energy Charges (${allocated_energy_mwh} MWh × ₹${tariff.rate}/unit)`, value: energyCharges });
    // Deemed generation: energy the seller stood ready to deliver but the buyer
    // or grid could not take. It is paid for at the same rate, on its own line,
    // so it is never mistaken for energy that actually flowed.
    const deemedShareMwh = supplies.reduce((t, s) => t + shareOf(s.energy.deemed_generation_mwh, s.source.allocation_percent), 0);
    if (deemedShareMwh > 0) {
      deemedEnergyMwh = Number(deemedShareMwh.toFixed(3));
      deemedCharges = Math.round(deemedEnergyMwh * UNITS_PER_MWH * tariff.rate);
      breakdown.push({
        code: 'DG',
        label: `Deemed Generation (${deemedEnergyMwh} MWh × ₹${tariff.rate}/unit) — not delivered, payable under PPA`,
        value: deemedCharges,
      });
    }
    if (tariff.fixed_charge > 0) {
      // The fixed leg of a two-part tariff is a capacity charge, shown separately
      // from the energy it is billed alongside.
      capacityCharges = tariff.fixed_charge;
      breakdown.push({ code: 'C1', label: `Fixed / Capacity Charge (${tariff.label})`, value: capacityCharges });
    }
  }

  // Transmission / wheeling: contract override → master default (₹/MWh)
  const txPerMwh = (contract.transmission_charge_per_mwh != null && contract.transmission_charge_per_mwh !== '')
    ? Number(contract.transmission_charge_per_mwh)
    : getParamNumber('transmission_charge_per_mwh', 0);
  transmissionCharges = txPerMwh > 0 ? Math.round(allocated_energy_mwh * txPerMwh) : 0;
  if (transmissionCharges) {
    breakdown.push({ code: 'TX', label: `Transmission / Wheeling (₹${txPerMwh}/MWh)`, value: transmissionCharges });
  }

  // Trading Margin: per-contract override (contracts.trading_margin_per_mwh) else global billing master default (₹70/MWh).
  const marginPerMwh = (contract.trading_margin_per_mwh != null && contract.trading_margin_per_mwh !== '')
    ? Number(contract.trading_margin_per_mwh)
    : getParamNumber('trading_margin_per_mwh', 70);
  const tradingMargin = contract.contract_type === 'PSA' ? Math.round(allocated_energy_mwh * marginPerMwh) : 0;
  if (tradingMargin) {
    const isOverride = contract.trading_margin_per_mwh != null && contract.trading_margin_per_mwh !== '';
    breakdown.push({ code: 'TM', label: `Trading Margin (₹${marginPerMwh}/MWh${isOverride ? ', contract-specific' : ''})`, value: tradingMargin });
  }

  // GST on the taxable service component (trading margin). Sale of electricity
  // itself is GST-exempt (HSN 2716), so energy & capacity charges are never
  // taxed. Default rate is 0 → no GST line, matching real energy bills.
  const gstRate = getParamNumber('gst_rate_percent', 0);
  const gstAmount = gstRate > 0 ? Math.round(tradingMargin * gstRate / 100) : 0;
  if (gstAmount) {
    breakdown.push({ code: 'GST', label: `GST @ ${gstRate}% (on trading margin; energy is exempt)`, value: gstAmount });
  }

  // CUF shortfall penalty (Solar/Wind/Hybrid only — Hydro capacity already uses PAFM/NAPAF).
  const cufPen = computeCufPenalty({
    contract,
    periodMonth: period_month,
    energyMwh: allocated_energy_mwh,
    // cufPenalty already prefers commissioned capacity when it is left to work
    // it out; passing contracted capacity here overrode that and judged the
    // plant on MW it has not commissioned.
    capacityMw: billableCapacityMw(contract),
    cufPercent: energy.cuf_percent,
    tariffPerUnit: appliedTariff || contract.tariff_per_unit,
  });
  const cufPenalty = cufPen.penalty || 0;
  if (cufPen.applicable && cufPen.breakdown && cufPenalty > 0) {
    breakdown.push(cufPen.breakdown);
  } else if (cufPen.applicable && cufPen.label && cufPenalty === 0 && cufPen.actualCuf != null) {
    breakdown.push({
      code: 'PEN',
      label: cufPen.label,
      value: 0,
    });
  }

  // Peak availability shortfall. A peak-power or FDRE PSA buys energy when the
  // system needs it, and states the availability the project must hold inside
  // its peak window. Nothing is charged unless the contract carries that
  // obligation, so an ordinary PPA is not silently given one.
  const peakPen = computePeakAvailabilityPenalty({
    contract,
    periodMonth: period_month,
    capacityMw: billableCapacityMw(contract),
    peakAvailabilityPercent: energy.peak_availability_percent,
    tariffPerUnit: appliedTariff || contract.tariff_per_unit,
  });
  if (peakPen.breakdown) {
    breakdown.push(peakPen.breakdown);
  } else if (peakPen.label) {
    breakdown.push({ code: 'PEAKPEN', label: peakPen.label, value: 0 });
  }
  const penalty = cufPenalty + (peakPen.penalty || 0);

  const grossTotal = capacityCharges + energyCharges + deemedCharges + incentiveCharges + tradingMargin + nrldcFees + transmissionCharges + gstAmount - freePowerDeduction - penalty;
  breakdown.push({ code: 'GROSS', label: 'Gross Amount (before provisional true-up)', value: grossTotal });

  const direction = directionForContract(contract);
  const billingFamilyRef = buildBillingFamilyRef(contract.contract_no, period_month, direction);

  let otherAdjustments = 0;
  let parentInvoiceId = null;
  let alreadyPaid = 0;

  if (resolvedType === 'FINAL') {
    const provInvoices = db.prepare(`
      SELECT * FROM invoices
      WHERE contract_id = ? AND billing_period = ? AND direction = ?
        AND invoice_type = 'PROVISIONAL' AND status != 'CANCELLED'
      ORDER BY created_at ASC
    `).all(contract_id, period_month, direction);

    if (provInvoices.length) {
      parentInvoiceId = provInvoices[0].id;
      const ids = provInvoices.map((i) => i.id);
      const placeholders = ids.map(() => '?').join(',');
      alreadyPaid = db.prepare(`
        SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)), 0) AS paid
        FROM payments WHERE invoice_id IN (${placeholders})
      `).get(...ids).paid || 0;
      otherAdjustments = -Math.round(alreadyPaid);
      breakdown.push({
        code: 'ADJ',
        label: `Less: already paid on provisional (${provInvoices.map((i) => i.invoice_no).join(', ')})`,
        value: otherAdjustments,
      });
    }
  }

  const total = grossTotal + otherAdjustments;
  breakdown.push({ code: 'TOTAL', label: 'Net Payable Amount', value: total });

  // A bill raised on energy that was locked over a validation flag says so. The
  // counterparty is being asked to pay against a figure the system itself
  // questioned, and the dispute window is short — they should not have to find
  // that out from the audit log.
  for (const { source, energy: e } of supplies) {
    if (!e.lock_override_reason) continue;
    breakdown.push({
      code: 'NOTE',
      label: `Energy ${multiSource ? `of ${source.ppa_contract_no} ` : ''}for this period was locked over a validation flag — ${e.lock_override_reason}`,
      value: 0,
    });
  }

  const id = newId('INV');
  const invoice = {
    id,
    invoice_no: genInvoiceNo(contract.contract_type === 'PPA' ? 'INV-PPA' : 'INV-PSA'),
    contract_id,
    invoice_type: resolvedType,
    direction,
    billing_period: period_month,
    energy_mwh: allocated_energy_mwh,
    tariff_per_unit: appliedTariff,
    energy_charges: energyCharges,
    capacity_charges: capacityCharges,
    incentive_charges: incentiveCharges,
    free_power_deduction: freePowerDeduction,
    nrldc_fees: nrldcFees,
    transmission_charges: transmissionCharges,
    deemed_energy_mwh: deemedEnergyMwh,
    deemed_charges: deemedCharges,
    lps: 0,
    penalty,
    trading_margin: tradingMargin,
    taxes: gstAmount,
    other_adjustments: otherAdjustments,
    total_amount: total,
    invoice_breakdown_json: JSON.stringify(breakdown),
    disputed_amount: 0,
    // Due date = bill date (today) + the contract's payment terms. Falls back to
    // the global master default when the contract carries no structured terms.
    due_date: computeDueDate(new Date(), contract, getParamNumber('default_payment_terms_days', 30)),
    status: 'DRAFT',
    parent_invoice_id: parentInvoiceId,
    billing_family_ref: billingFamilyRef,
    energy_data_id: energy.id,
  };
  
  db.prepare(`
    INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
      tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees,
      transmission_charges, deemed_energy_mwh, deemed_charges, lps, penalty, trading_margin, taxes,
      other_adjustments, total_amount, invoice_breakdown_json, disputed_amount, due_date, status,
      parent_invoice_id, billing_family_ref, energy_data_id, created_by, created_by_id)
    VALUES (@id, @invoice_no, @contract_id, @invoice_type, @direction, @billing_period, @energy_mwh,
      @tariff_per_unit, @energy_charges, @capacity_charges, @incentive_charges, @free_power_deduction, @nrldc_fees,
      @transmission_charges, @deemed_energy_mwh, @deemed_charges, @lps, @penalty, @trading_margin, @taxes,
      @other_adjustments, @total_amount, @invoice_breakdown_json, @disputed_amount, @due_date, @status,
      @parent_invoice_id, @billing_family_ref, @energy_data_id, @created_by, @created_by_id)
  `).run({ ...invoice, created_by: req.user.name, created_by_id: req.user?.id ?? null });

  // Map to seller invoices (Many-to-Many)
  if (seller_invoice_ids && Array.isArray(seller_invoice_ids)) {
    const insertMapping = db.prepare('INSERT INTO invoice_mapping (buyer_invoice_id, seller_invoice_id) VALUES (?, ?)');
    for (const sid of seller_invoice_ids) {
      insertMapping.run(id, sid);
    }
  }

  logAudit({
    req: typeof req !== "undefined" ? req : null,
    user: req.user,
    action: 'GENERATE',
    module: 'REIA',
    entityType: 'invoice',
    entityId: id,
    details: { ...invoice, already_paid: alreadyPaid },
  });
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
}

/**
 * A LIKE pattern for a breakdown line that ends in exactly this reason — the
 * line is written as "<label> — <reason>" and stored as JSON, so the reason is
 * matched in its JSON form and up to the closing quote.
 */
function reasonLike(reason) {
  const json = JSON.stringify(String(reason).trim()).slice(1, -1);
  return `%— ${json.replace(/[\\%_]/g, '\\$&')}"%`;
}

// Arrear bill — a manual recovery bill for a past period (charges missed / under-billed
// earlier, e.g. retrospective tariff order, delayed adjustment). Mirrors SAP bill type 'A'.

router.post('/generate', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { contract_id, period_month, split_by_allocation } = req.body;

  try {
    // A PPA can be billed out to each PSA it feeds rather than as one invoice.
    // Every invoice raised this way carries the same billing family reference, so
    // the set is traceable back to the one PPA period it came from.
    if (split_by_allocation) {
      const ppa = db.prepare(`SELECT * FROM contracts WHERE id = ? AND contract_type = 'PPA'`).get(contract_id);
      if (!ppa) return res.status(404).json({ error: 'PPA not found — split_by_allocation applies to a PPA' });

      const allocations = allocationsInForce(ppa.id, period_month);
      if (!allocations.length) {
        return res.status(400).json({ error: `No PSA allocation is in force for ${period_month}.` });
      }

      const familyRef = buildBillingFamilyRef(ppa.contract_no, period_month, 'SJVN_TO_BUYER');
      const raised = [];
      const failed = [];
      const alreadyBilled = [];
      db.transaction(() => {
        for (const alloc of allocations) {
          try {
            const inv = generateInvoiceFor({ ...req.body, contract_id: alloc.psa_id }, req);
            // Tie every invoice in the set to the source PPA period.
            db.prepare('UPDATE invoices SET billing_family_ref = ? WHERE id = ?').run(familyRef, inv.id);
            raised.push({ ...inv, billing_family_ref: familyRef, allocation_percent: alloc.allocation_percent });
          } catch (err) {
            if (!err.status) throw err;
            // A PSA fed by several PPAs gets one bill for the month covering all
            // of them. If another of its PPAs has already billed it, this PPA's
            // share is on that bill — it is done, not failed.
            const existing = err.status === 409 && err.payload?.existing_invoice_no
              && sourcesForPsa(alloc.psa_id, period_month).length > 1
              && db.prepare('SELECT invoice_breakdown_json FROM invoices WHERE invoice_no = ?').get(err.payload.existing_invoice_no);
            const covers = existing && (() => {
              try { return JSON.parse(existing.invoice_breakdown_json).some((l) => l.code === 'ALLOC' && l.ppa_id === ppa.id); } catch { return false; }
            })();
            if (covers) {
              alreadyBilled.push({ psa_id: alloc.psa_id, psa_contract_no: alloc.psa_contract_no, invoice_no: err.payload.existing_invoice_no });
              continue;
            }
            failed.push({ psa_id: alloc.psa_id, error: err.payload?.error || err.message });
          }
        }
        // All or nothing: a partial fan-out would bill some buyers for a period
        // and silently leave others unbilled.
        if (failed.length) throw refuse(400, { error: 'Could not bill every PSA for this period', failed });
        if (!raised.length) {
          throw refuse(409, {
            error: `Every PSA ${ppa.contract_no} supplies is already billed for ${period_month} — ${alreadyBilled.map((a) => `${a.psa_contract_no} on ${a.invoice_no}`).join(', ')}.`,
            already_billed: alreadyBilled,
          });
        }
      })();

      return res.status(201).json({ billing_family_ref: familyRef, invoices: raised, count: raised.length, already_billed: alreadyBilled });
    }

    res.status(201).json(generateInvoiceFor(req.body, req));
  } catch (err) {
    if (err.status) return res.status(err.status).json(err.payload);
    throw err;
  }
});

router.post('/arrear', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { contract_id, arrear_period, amount, taxes, reason } = req.body;
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const amt = Number(amount);
  if (!arrear_period) return res.status(400).json({ error: 'arrear_period (YYYY-MM being recovered) is required' });
  if (!Number.isFinite(amt) || amt === 0) return res.status(400).json({ error: 'A non-zero arrear amount is required' });
  // An arrear recovers money; it took −100 and raised a negative bill. Money
  // owed back to the counterparty is a credit note or a negative supplementary.
  if (amt < 0) return res.status(400).json({ error: 'An arrear bill recovers an amount, so it cannot be negative. For money owed back, raise a credit note or a negative Supplementary.' });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(arrear_period))) return res.status(400).json({ error: 'arrear_period must be YYYY-MM' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason for the arrear is required' });

  const taxAmt = Number(taxes) || 0;
  if (taxAmt < 0) return res.status(400).json({ error: 'Taxes on an arrear cannot be negative' });
  const total = Math.round(amt + taxAmt);
  const direction = directionForContract(contract);

  // The same arrear, to the rupee and the word, is a second click rather than a
  // second claim.
  const sameArrear = db.prepare(`
    SELECT invoice_no FROM invoices
    WHERE contract_id = ? AND billing_period = ? AND invoice_type = 'ARREAR' AND status != 'CANCELLED'
      AND total_amount = ? AND invoice_breakdown_json LIKE ? ESCAPE '\\'
  `).get(contract_id, arrear_period, total, reasonLike(reason));
  if (sameArrear) {
    return res.status(409).json({
      error: `This arrear is already raised as ${sameArrear.invoice_no} — same contract, period, amount and reason. Cancel that one first if it was raised in error.`,
      existing_invoice_no: sameArrear.invoice_no,
    });
  }
  const billingFamilyRef = buildBillingFamilyRef(contract.contract_no, arrear_period, direction);
  const id = newId('INV');
  const breakdown = [
    { code: 'ARR', label: `Arrear recovery for ${arrear_period} — ${reason.trim()}`, value: Math.round(amt) },
  ];
  if (taxAmt) breakdown.push({ code: 'TAX', label: 'Taxes / GST on arrear', value: Math.round(taxAmt) });
  breakdown.push({ code: 'GROSS', label: 'Arrear Bill Total', value: total });

  db.prepare(`
    INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
      tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees,
      transmission_charges, lps, penalty, trading_margin, taxes,
      other_adjustments, total_amount, invoice_breakdown_json, disputed_amount, due_date, status,
      parent_invoice_id, billing_family_ref, energy_data_id, created_by, created_by_id)
    VALUES (@id, @invoice_no, @contract_id, 'ARREAR', @direction, @billing_period, 0,
      0, @energy_charges, 0, 0, 0, 0,
      0, 0, 0, 0, @taxes,
      0, @total_amount, @invoice_breakdown_json, 0, @due_date, 'DRAFT',
      NULL, @billing_family_ref, NULL, @created_by, @created_by_id)
  `).run({
    id,
    invoice_no: genInvoiceNo(contract.contract_type === 'PPA' ? 'ARR-PPA' : 'ARR-PSA'),
    contract_id,
    direction,
    billing_period: arrear_period,
    energy_charges: Math.round(amt),
    taxes: taxAmt,
    total_amount: total,
    invoice_breakdown_json: JSON.stringify(breakdown),
    due_date: computeDueDate(new Date(), contract, getParamNumber('default_payment_terms_days', 30)),
    billing_family_ref: billingFamilyRef,
    created_by: req.user.name,
    created_by_id: req.user?.id ?? null,
  });
  db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, ?)').run(newId('APR'), id, 'PENDING');
  logAudit({ req, user: req.user, action: 'GENERATE_ARREAR', module: 'REIA', entityType: 'invoice', entityId: id, details: { contract_id, arrear_period, amount: amt, taxes: taxAmt, reason } });
  pushNotification({ role: 'REIA_USER', type: 'ARREAR_RAISED', message: `Arrear bill raised for ${contract.contract_no} (${arrear_period}): ₹${total.toLocaleString('en-IN')}` });
  res.status(201).json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
});

// Explicit supplementary-bill triggers per the REIA workflow (Supplementary
// Billing): Change in Law / Revised REA / Transmission Charges / LPS. Legacy
// codes are kept so older supplementary invoices still validate.
const SUPP_REASONS = [
  'REVISED_REA',
  'CHANGE_IN_LAW',
  'TRANSMISSION_CHARGES',
  'LPS',
  'BETA_TRUE_UP',
  'OTHER',
  // legacy aliases
  'TARIFF_REVISION',
  'ENERGY_REVISION',
  'LPS_ADJUSTMENT',
];

/**
 * Manual Supplementary invoice — tariff revision / change-in-law / energy revision / etc.
 * Distinct from dispute auto-credit supplementary (which still uses its own path).
 */
router.post('/supplementary', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const {
    contract_id,
    billing_period,
    amount,
    taxes,
    reason_code,
    reason,
    parent_invoice_id,
    transmission_charges,
  } = req.body;

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!billing_period || !/^\d{4}-\d{2}$/.test(billing_period)) {
    return res.status(400).json({ error: 'billing_period (YYYY-MM) is required' });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt === 0) {
    return res.status(400).json({ error: 'A non-zero adjustment amount is required' });
  }
  const code = reason_code || 'OTHER';
  if (!SUPP_REASONS.includes(code)) {
    return res.status(400).json({ error: `reason_code must be one of: ${SUPP_REASONS.join(', ')}` });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'A reason description is required' });
  }
  if (code === 'OTHER' && String(reason).trim().length < 5) {
    return res.status(400).json({ error: 'Please provide a clearer reason for OTHER' });
  }

  let parentId = parent_invoice_id || null;
  if (parentId) {
    const parent = db.prepare('SELECT * FROM invoices WHERE id = ? AND contract_id = ?').get(parentId, contract_id);
    if (!parent) return res.status(400).json({ error: 'parent_invoice_id not found for this contract' });
  }

  const taxAmt = Number(taxes) || 0;
  const txAmt = Number(transmission_charges) || 0;
  const total = Math.round(amt + taxAmt + txAmt);
  const direction = directionForContract(contract);
  const billingFamilyRef = buildBillingFamilyRef(contract.contract_no, billing_period, direction);

  const sameSupp = db.prepare(`
    SELECT invoice_no FROM invoices
    WHERE contract_id = ? AND billing_period = ? AND invoice_type = 'SUPPLEMENTARY' AND status != 'CANCELLED'
      AND total_amount = ? AND invoice_breakdown_json LIKE ? ESCAPE '\\'
  `).get(contract_id, billing_period, total, reasonLike(reason));
  if (sameSupp) {
    return res.status(409).json({
      error: `This supplementary is already raised as ${sameSupp.invoice_no} — same contract, period, amount and reason. Cancel that one first if it was raised in error.`,
      existing_invoice_no: sameSupp.invoice_no,
    });
  }

  const id = newId('INV');
  const reasonLabel = {
    REVISED_REA: 'Revised / amended REA true-up',
    CHANGE_IN_LAW: 'Change in Law',
    TRANSMISSION_CHARGES: 'Transmission / wheeling charges',
    LPS: 'Late Payment Surcharge',
    BETA_TRUE_UP: 'Frequency response β true-up',
    OTHER: 'Other adjustment',
    // legacy aliases
    TARIFF_REVISION: 'Tariff revision',
    ENERGY_REVISION: 'Energy revision / true-up',
    LPS_ADJUSTMENT: 'LPS adjustment',
  }[code] || 'Adjustment';

  const breakdown = [
    { code: 'SUPP', label: `${reasonLabel} — ${String(reason).trim()}`, value: Math.round(amt) },
  ];
  if (txAmt) breakdown.push({ code: 'TX', label: 'Transmission / wheeling on adjustment', value: Math.round(txAmt) });
  if (taxAmt) breakdown.push({ code: 'TAX', label: 'Taxes / GST on adjustment', value: Math.round(taxAmt) });
  breakdown.push({ code: 'TOTAL', label: 'Supplementary Bill Total', value: total });

  db.prepare(`
    INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
      tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees,
      transmission_charges, lps, penalty, trading_margin, taxes,
      other_adjustments, total_amount, invoice_breakdown_json, disputed_amount, due_date, status,
      parent_invoice_id, billing_family_ref, energy_data_id, created_by, created_by_id)
    VALUES (@id, @invoice_no, @contract_id, 'SUPPLEMENTARY', @direction, @billing_period, 0,
      0, @energy_charges, 0, 0, 0, 0,
      @transmission_charges, 0, 0, 0, @taxes,
      0, @total_amount, @invoice_breakdown_json, 0, @due_date, 'DRAFT',
      @parent_invoice_id, @billing_family_ref, NULL, @created_by, @created_by_id)
  `).run({
    id,
    invoice_no: genInvoiceNo(contract.contract_type === 'PPA' ? 'SUPP-PPA' : 'SUPP-PSA'),
    contract_id,
    direction,
    billing_period,
    energy_charges: Math.round(amt),
    transmission_charges: Math.round(txAmt),
    taxes: taxAmt,
    total_amount: total,
    invoice_breakdown_json: JSON.stringify(breakdown),
    due_date: computeDueDate(new Date(), contract, getParamNumber('default_payment_terms_days', 30)),
    parent_invoice_id: parentId,
    billing_family_ref: billingFamilyRef,
    created_by: req.user.name,
    created_by_id: req.user?.id ?? null,
  });
  db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, ?)').run(newId('APR'), id, 'PENDING');
  logAudit({
    req, user: req.user, action: 'GENERATE_SUPPLEMENTARY', module: 'REIA', entityType: 'invoice', entityId: id,
    details: { contract_id, billing_period, amount: amt, taxes: taxAmt, reason_code: code, reason },
  });
  pushNotification({
    role: 'REIA_USER',
    type: 'SUPPLEMENTARY_RAISED',
    message: `Supplementary bill for ${contract.contract_no} (${billing_period}): ₹${total.toLocaleString('en-IN')} — ${reasonLabel}`,
  });
  res.status(201).json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
});

// Seller invoice submission (manual upload)
// ── Loading a month of bills from the seller's own sheet ─────────────────────
//
// A generator with twenty PPAs raises twenty bills a month, one form at a time.
// The sheet those numbers already live in is the honest way in — the same shape
// the single form takes, with the contract named the way the seller knows it (its
// contract number, not an id from this database), checked against the same rules,
// and never landing anywhere the form would not.

const INVOICE_UPLOAD_COLUMNS = [
  'contract_no', 'billing_period', 'invoice_no', 'invoice_type',
  'energy_mwh', 'tariff_per_unit', 'energy_charges', 'transmission_charges',
  'rebate', 'lps', 'penalty', 'other_adjustments', 'taxes',
];
const INVOICE_UPLOAD_NUMERIC = [
  'energy_mwh', 'tariff_per_unit', 'energy_charges', 'transmission_charges',
  'rebate', 'lps', 'penalty', 'other_adjustments', 'taxes',
];
const INVOICE_TYPES = ['PROVISIONAL', 'FINAL', 'SUPPLEMENTARY', 'CREDIT_NOTE', 'DEBIT_NOTE'];
const BILLING_PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One row of the sheet, held to the rules the form is held to. */
function checkInvoiceRow(raw, user, contractCache, seenKeys) {
  const errors = [];
  const unknown = Object.keys(raw || {}).filter((k) => !INVOICE_UPLOAD_COLUMNS.includes(k));
  if (unknown.length) errors.push(`unknown column(s): ${unknown.join(', ')} — see /api/invoices/upload-template`);

  const str = (v) => (v == null ? '' : String(v).trim());
  const num = (v) => (v === '' || v == null ? 0 : Number(v));

  const row = {
    contract_no: str(raw.contract_no),
    billing_period: str(raw.billing_period),
    invoice_no: str(raw.invoice_no) || null,
    invoice_type: (str(raw.invoice_type) || 'FINAL').toUpperCase(),
  };
  for (const field of INVOICE_UPLOAD_NUMERIC) row[field] = num(raw[field]);

  if (!row.contract_no) errors.push('contract_no is required');
  if (!BILLING_PERIOD.test(row.billing_period)) errors.push('billing_period must be YYYY-MM');
  if (!INVOICE_TYPES.includes(row.invoice_type)) errors.push(`invoice_type must be one of ${INVOICE_TYPES.join('/')}`);
  for (const field of INVOICE_UPLOAD_NUMERIC) {
    if (!Number.isFinite(row[field])) errors.push(`${field} must be a number`);
    else if (row[field] < 0) errors.push(`${field} cannot be negative`);
  }
  if (Number.isFinite(row.energy_mwh) && row.energy_mwh <= 0) errors.push('energy_mwh must be greater than zero');

  // The contract as the seller names it, and only one the seller may bill on.
  let contract = null;
  if (row.contract_no) {
    if (!contractCache.has(row.contract_no)) {
      contractCache.set(row.contract_no, db.prepare('SELECT * FROM contracts WHERE contract_no = ?').get(row.contract_no) || null);
    }
    contract = contractCache.get(row.contract_no);
    if (!contract) errors.push(`contract ${row.contract_no} not found`);
    else if (!contractVisibleTo(user, contract)) errors.push(`contract ${row.contract_no} is not yours to bill on`);
    else if (contract.status !== 'ACTIVE') errors.push(`contract ${row.contract_no} is ${contract.status}, not ACTIVE`);
  }

  if (row.invoice_no && db.prepare('SELECT id FROM invoices WHERE invoice_no = ?').get(row.invoice_no)) {
    errors.push(`invoice_no ${row.invoice_no} is already on record`);
  }

  // Two bills for the same contract and month in one file is a copy-paste, not a
  // supplementary — a supplementary says so in its type.
  if (contract && BILLING_PERIOD.test(row.billing_period) && row.invoice_type === 'FINAL') {
    const key = `${contract.id}|${row.billing_period}`;
    if (seenKeys.has(key)) errors.push(`a FINAL bill for ${row.contract_no} ${row.billing_period} appears twice in this file`);
    else {
      const existing = db.prepare(`
        SELECT invoice_no FROM invoices
        WHERE contract_id = ? AND billing_period = ? AND direction = 'SELLER_TO_SJVN'
          AND invoice_type = 'FINAL' AND status != 'CANCELLED'
          AND TRIM(COALESCE(invoice_breakdown_json, '')) = ''
      `).get(contract.id, row.billing_period);
      if (existing) errors.push(`${row.contract_no} ${row.billing_period} is already billed by ${existing.invoice_no}`);
    }
  }

  // What the seller says the bill comes to. Left as given rather than recomputed:
  // the energy charge is the seller's claim, and the validation against SJVN's own
  // figure is what the desk reads afterwards.
  row.total_amount = row.energy_charges + row.transmission_charges + row.taxes
    - row.rebate + row.lps + row.penalty + row.other_adjustments;
  if (row.total_amount <= 0) errors.push('the bill totals zero or less');

  return { row, contract, errors };
}

/**
 * Raise a month of bills from a sheet.
 *
 * `dry_run: true` checks and reports without writing. Each bill lands exactly
 * where the form would put it — a maker's (L1) as a DRAFT for its own checker,
 * anyone else's as SUBMITTED — and is validated against SJVN's own figure for
 * that period the same way.
 */
router.post('/upload', requireRole(...SELLER_ROLES, ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const dryRun = !!req.body?.dry_run;
  if (rows.length === 0) return res.status(400).json({ error: 'No rows supplied' });

  const results = { dry_run: dryRun, rows_received: rows.length, successful: 0, failed: 0, errors: [], preview: [], invoices: [] };
  const contractCache = new Map();
  const seenKeys = new Set();
  const accepted = [];

  rows.forEach((raw, idx) => {
    const line = idx + 1;
    const { row, contract, errors } = checkInvoiceRow(raw, req.user, contractCache, seenKeys);
    if (errors.length) {
      results.failed += 1;
      results.errors.push({ row: line, contract_no: row.contract_no || null, error: errors.join('; '), errors });
      return;
    }
    if (row.invoice_type === 'FINAL') seenKeys.add(`${contract.id}|${row.billing_period}`);
    accepted.push({ line, row, contract });
    results.preview.push({
      row: line,
      contract_no: row.contract_no,
      billing_period: row.billing_period,
      invoice_type: row.invoice_type,
      energy_mwh: row.energy_mwh,
      total_amount: row.total_amount,
      status: req.user.role === 'SELLER_L1' ? 'DRAFT' : 'SUBMITTED',
    });
  });

  if (dryRun) {
    results.would_raise = accepted.length;
    return res.json(results);
  }

  const initialStatus = req.user.role === 'SELLER_L1' ? 'DRAFT' : 'SUBMITTED';
  const termsFallback = getParamNumber('default_payment_terms_days', 30);

  for (const { line, row, contract } of accepted) {
    try {
      const id = newId('INV');
      const invoiceNo = row.invoice_no || genInvoiceNo('SELLER-INV');
      db.prepare(`
        INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
          tariff_per_unit, energy_charges, transmission_charges, rebate, lps, penalty, taxes,
          other_adjustments, total_amount, due_date, status, billing_family_ref, created_by, created_by_id)
        VALUES (@id, @invoice_no, @contract_id, @invoice_type, 'SELLER_TO_SJVN', @billing_period, @energy_mwh,
          @tariff_per_unit, @energy_charges, @transmission_charges, @rebate, @lps, @penalty, @taxes,
          @other_adjustments, @total_amount, @due_date, @status, @billing_family_ref, @created_by, @created_by_id)
      `).run({
        id,
        invoice_no: invoiceNo,
        contract_id: contract.id,
        invoice_type: row.invoice_type,
        billing_period: row.billing_period,
        energy_mwh: row.energy_mwh,
        tariff_per_unit: row.tariff_per_unit,
        energy_charges: row.energy_charges,
        transmission_charges: row.transmission_charges,
        rebate: row.rebate,
        lps: row.lps,
        penalty: row.penalty,
        taxes: row.taxes,
        other_adjustments: row.other_adjustments,
        total_amount: row.total_amount,
        due_date: computeDueDate(new Date(), contract, termsFallback),
        status: initialStatus,
        billing_family_ref: buildBillingFamilyRef(contract.contract_no, row.billing_period, 'SELLER_TO_SJVN'),
        created_by: req.user.name,
        created_by_id: req.user?.id ?? null,
      });
      db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, ?)')
        .run(newId('APR'), id, 'PENDING');

      // The same check the form runs: against SJVN's own figure for that period,
      // when there is one.
      let created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
      const counterpart = findSystemCounterpart(created);
      if (counterpart) {
        created = persistValidation(id, compareSellerToSystem(created, counterpart), { userName: req.user.name || 'upload' });
      } else {
        db.prepare("UPDATE invoices SET validation_status = 'PENDING', updated_at = datetime('now') WHERE id = ?").run(id);
        created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
      }

      results.successful += 1;
      results.invoices.push({
        row: line, id, invoice_no: invoiceNo, status: created.status,
        validation_status: created.validation_status, total_amount: created.total_amount,
      });
    } catch (err) {
      results.failed += 1;
      results.errors.push({ row: line, contract_no: row.contract_no, error: err.message, errors: [err.message] });
    }
  }

  logAudit({
    req: typeof req !== 'undefined' ? req : null,
    user: req.user,
    action: 'BULK_UPLOAD_INVOICES',
    module: 'REIA',
    entityType: 'invoice',
    details: { rows_received: rows.length, successful: results.successful, failed: results.failed, status: initialStatus },
  });

  // SJVN hears about bills, not about a maker's drafts.
  if (initialStatus === 'SUBMITTED' && results.successful > 0) {
    pushNotification({
      role: 'REIA_USER',
      type: 'INVOICE_SUBMITTED',
      message: `${results.successful} seller invoice(s) submitted from a template upload`,
    });
  }

  res.status(201).json(results);
});

router.post('/', requireRole(...SELLER_ROLES, ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const b = req.body;
  const id = newId('INV');
  const total = (b.energy_charges || 0) + (b.transmission_charges || 0) + (b.trading_margin || 0) + (b.taxes || 0) - (b.rebate || 0) + (b.lps || 0) + (b.penalty || 0) + (b.other_adjustments || 0);
  
  // Due date = bill date + the contract's structured payment terms (fallback 30d).
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(b.contract_id);
  // A seller bills only on its own PPAs. Nothing checked this, so any seller
  // could raise an invoice against another company's contract.
  if (!contract || !contractVisibleTo(req.user, contract)) return res.status(404).json({ error: 'Contract not found' });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(b.billing_period || ''))) {
    return res.status(400).json({ error: 'billing_period must be YYYY-MM' });
  }
  if (!(total > 0)) return res.status(400).json({ error: 'The bill totals zero or less.' });

  // The seller's own reference is the invoice number, and the number is unique.
  // A repeat reached the database and came back as "UNIQUE constraint failed:
  // invoices.invoice_no" in the middle of the form.
  const ownRef = String(b.invoice_no || '').trim();
  if (ownRef && db.prepare('SELECT 1 FROM invoices WHERE invoice_no = ?').get(ownRef)) {
    return res.status(409).json({ error: `Invoice number ${ownRef} is already on record. Use a different reference, or leave it blank to have one assigned.` });
  }

  // One FINAL bill per contract and month — the rule the sheet upload has always
  // held the seller to, and the form did not.
  const invoiceType = b.invoice_type || 'FINAL';
  if (invoiceType === 'FINAL') {
    const existing = db.prepare(`
      SELECT invoice_no, status FROM invoices
      WHERE contract_id = ? AND billing_period = ? AND direction = 'SELLER_TO_SJVN'
        AND invoice_type = 'FINAL' AND status != 'CANCELLED'
        AND TRIM(COALESCE(invoice_breakdown_json, '')) = ''
    `).get(contract.id, b.billing_period);
    if (existing) {
      return res.status(409).json({
        error: `${contract.contract_no} ${b.billing_period} is already billed by ${existing.invoice_no} (${existing.status.replace(/_/g, ' ')}). ${existing.status === 'REJECTED' ? 'Revise and resubmit that bill' : 'Raise a Supplementary for a correction'} rather than a second FINAL.`,
        existing_invoice_no: existing.invoice_no,
      });
    }
  }

  // What an adjustment is for is the first thing SJVN's desk asks about it.
  const adjustmentRemarks = String(b.adjustment_remarks || '').trim().slice(0, 300);
  if (Number(b.other_adjustments) && !adjustmentRemarks) {
    return res.status(400).json({ error: 'Say what the other adjustment is for.' });
  }

  // The company's maker (L1) prepares a draft, which its checker sends to SJVN
  // through submit-l2 and approve-l2. The company admin and checkers submit directly.
  const initialStatus = req.user.role === 'SELLER_L1' ? 'DRAFT' : 'SUBMITTED';
  const dueDateStr = computeDueDate(new Date(), contract, getParamNumber('default_payment_terms_days', 30));
  const direction = 'SELLER_TO_SJVN';
  const billingFamilyRef = contract
    ? buildBillingFamilyRef(contract.contract_no, b.billing_period, direction)
    : null;

  db.prepare(`
    INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
      tariff_per_unit, energy_charges, transmission_charges, rebate, lps, penalty, trading_margin, taxes,
      other_adjustments, adjustment_remarks, total_amount, due_date, status, billing_family_ref, energy_data_id, parent_invoice_id, created_by, created_by_id)
    VALUES (@id, @invoice_no, @contract_id, @invoice_type, @direction, @billing_period, @energy_mwh,
      @tariff_per_unit, @energy_charges, @transmission_charges, @rebate, @lps, @penalty, @trading_margin, @taxes,
      @other_adjustments, @adjustment_remarks, @total_amount, @due_date, @status, @billing_family_ref, @energy_data_id, @parent_invoice_id, @created_by, @created_by_id)
  `).run({
    id,
    invoice_no: ownRef || genInvoiceNo('SELLER-INV'),
    adjustment_remarks: adjustmentRemarks || null,
    contract_id: b.contract_id,
    invoice_type: invoiceType,
    direction,
    billing_period: b.billing_period,
    energy_mwh: b.energy_mwh,
    tariff_per_unit: b.tariff_per_unit || 0,
    energy_charges: b.energy_charges || 0,
    transmission_charges: b.transmission_charges || 0,
    rebate: b.rebate || 0,
    lps: b.lps || 0,
    penalty: b.penalty || 0,
    trading_margin: b.trading_margin || 0,
    taxes: b.taxes || 0,
    other_adjustments: b.other_adjustments || 0,
    total_amount: total,
    due_date: dueDateStr,
    status: initialStatus,
    billing_family_ref: billingFamilyRef,
    energy_data_id: b.energy_data_id || null,
    parent_invoice_id: b.parent_invoice_id || null,
    created_by: req.user.name,
    created_by_id: req.user?.id ?? null,
  });
  db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, ?)').run(newId('APR'), id, 'PENDING');

  // Auto-validate against system counterpart when one exists for this period.
  let created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  const systemCounterpart = findSystemCounterpart(created);
  if (systemCounterpart) {
    const match = compareSellerToSystem(created, systemCounterpart);
    created = persistValidation(id, match, { userName: req.user.name || 'auto' });
  } else {
    db.prepare(`
      UPDATE invoices SET validation_status = 'PENDING', updated_at = datetime('now') WHERE id = ?
    `).run(id);
    created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  }

  const isDraft = initialStatus === 'DRAFT';
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: isDraft ? 'CREATE' : 'SUBMIT', module: 'REIA', entityType: 'invoice', entityId: id, details: { ...b, validation_status: created.validation_status } });
  // SJVN hears of a maker's draft only when the company's checker sends it on.
  if (!isDraft) pushNotification({ role: 'REIA_USER', type: 'INVOICE_SUBMITTED', message: `Seller invoice ${created.invoice_no} submitted for review` });
  res.status(201).json(created);
});

/**
 * A seller revising its own bill — a draft, or one SJVN has sent back.
 *
 * "Revise & Resubmit" resubmitted and revised nothing: the bill went back to
 * SJVN at the figure it had just been rejected for. This is the revising. The
 * figures are the seller's claim, as on the form that raised the bill, and are
 * checked against SJVN's own computation again afterwards. Sending it on is
 * still a separate act, by whoever in the company may do that.
 */
router.put('/:id/revise', requireRole(...SELLER_ROLES), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv || !ownsInvoice(req.user, inv) || !raisedBySeller(inv)) return res.status(404).json({ error: 'Invoice not found' });
  if (!['DRAFT', 'REJECTED'].includes(inv.status)) {
    return res.status(400).json({ error: `Only a draft or a bill SJVN has sent back can be revised — this one is ${inv.status.replace(/_/g, ' ')}.` });
  }
  const b = req.body || {};
  const pick = (key) => (b[key] === undefined || b[key] === null || b[key] === '' ? Number(inv[key]) || 0 : Number(b[key]));
  const next = {
    energy_mwh: pick('energy_mwh'),
    tariff_per_unit: pick('tariff_per_unit'),
    energy_charges: pick('energy_charges'),
    transmission_charges: pick('transmission_charges'),
    taxes: pick('taxes'),
    other_adjustments: pick('other_adjustments'),
  };
  for (const [k, v] of Object.entries(next)) {
    if (!Number.isFinite(v)) return res.status(400).json({ error: `${k} must be a number` });
    if (k !== 'other_adjustments' && v < 0) return res.status(400).json({ error: `${k} cannot be negative` });
  }
  if (!(next.energy_mwh > 0)) return res.status(400).json({ error: 'energy_mwh must be greater than zero' });
  const remarks = b.adjustment_remarks === undefined ? (inv.adjustment_remarks || '') : String(b.adjustment_remarks || '').trim().slice(0, 300);
  if (next.other_adjustments && !remarks) return res.status(400).json({ error: 'Say what the other adjustment is for.' });

  const total = next.energy_charges + next.transmission_charges + (Number(inv.trading_margin) || 0) + next.taxes
    - (Number(inv.rebate) || 0) + (Number(inv.lps) || 0) + (Number(inv.penalty) || 0) + next.other_adjustments;
  if (!(total > 0)) return res.status(400).json({ error: 'The bill totals zero or less.' });

  db.prepare(`
    UPDATE invoices SET energy_mwh = @energy_mwh, tariff_per_unit = @tariff_per_unit, energy_charges = @energy_charges,
      transmission_charges = @transmission_charges, taxes = @taxes, other_adjustments = @other_adjustments,
      adjustment_remarks = @remarks, total_amount = @total, version = COALESCE(version, 1) + 1, updated_at = datetime('now')
    WHERE id = @id
  `).run({ ...next, remarks: remarks || null, total, id: inv.id });

  // Against SJVN's figure again: the old result described the old bill.
  let revised = db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id);
  const counterpart = findSystemCounterpart(revised);
  if (counterpart) {
    revised = persistValidation(inv.id, compareSellerToSystem(revised, counterpart), { userName: req.user.name || 'revise' });
  } else {
    db.prepare(`UPDATE invoices SET validation_status = 'PENDING', validation_json = NULL, updated_at = datetime('now') WHERE id = ?`).run(inv.id);
    revised = db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id);
  }

  const figures = (row) => ({
    energy_mwh: row.energy_mwh, tariff_per_unit: row.tariff_per_unit, energy_charges: row.energy_charges,
    transmission_charges: row.transmission_charges, taxes: row.taxes, other_adjustments: row.other_adjustments,
    total_amount: row.total_amount,
  });
  logAudit({
    req, user: req.user, action: 'REVISE', module: 'REIA', entityType: 'invoice', entityId: inv.id,
    beforeValue: figures(inv), afterValue: figures(revised),
    details: { invoice_no: inv.invoice_no, status: inv.status, validation_status: revised.validation_status },
  });
  res.json(withContract(revised));
});

// Cancel / reverse — REIA only; safe pre-settlement statuses
router.post('/:id/cancel', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  if (inv.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Invoice is already cancelled' });
  }
  if (!CANCELABLE_STATUSES.includes(inv.status)) {
    return res.status(400).json({
      error: `Cannot cancel invoice in status ${inv.status}. Allowed: ${CANCELABLE_STATUSES.join(', ')}`,
    });
  }

  const paid = paidTotalFor(inv.id);
  if (paid > 0) {
    return res.status(400).json({ error: 'Cannot cancel invoice with recorded payments' });
  }

  const openDisputes = db.prepare(`
    SELECT COUNT(*) c FROM disputes
    WHERE invoice_id = ? AND status IN (${OPEN_DISPUTE_STATUSES.map(() => '?').join(',')})
  `).get(inv.id, ...OPEN_DISPUTE_STATUSES).c;
  if (openDisputes > 0) {
    return res.status(400).json({ error: 'Cannot cancel invoice with open disputes — resolve or close them first' });
  }

  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Cancel reason is required' });

  db.prepare(`
    UPDATE invoices SET
      status = 'CANCELLED',
      cancel_reason = ?,
      cancelled_at = datetime('now'),
      cancelled_by = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(reason, req.user.name || req.user.email || null, inv.id);

  // Block further approval progress on cancelled bills
  db.prepare(`
    UPDATE invoice_approvals SET status = 'REJECTED', comments = ?, acted_at = datetime('now'), approver_name = ?
    WHERE invoice_id = ? AND status = 'PENDING'
  `).run(`Cancelled: ${reason}`, req.user.name || 'system', inv.id);

  logAudit({
    req, user: req.user, action: 'CANCEL', module: 'REIA', entityType: 'invoice', entityId: inv.id,
    beforeValue: { status: inv.status },
    afterValue: { status: 'CANCELLED' },
    reason,
  });
  pushNotification({
    role: 'REIA_USER',
    type: 'INVOICE_CANCELLED',
    message: `Invoice ${inv.invoice_no} cancelled by ${req.user.name || 'REIA'}: ${reason}`,
  });

  res.json(withContract(db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id)));
});

// Validate seller invoice vs system-generated counterpart
router.post('/:id/validate', requireRole(...ROLE_GROUPS.REIA_WRITE, ...SELLER_ROLES), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv || !ownsInvoice(req.user, inv)) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Cannot validate a cancelled invoice' });
  }
  if (inv.direction !== 'SELLER_TO_SJVN') {
    return res.status(400).json({ error: 'Validation applies to seller invoices (SELLER_TO_SJVN) only' });
  }

  const result = compareSellerToSystem(inv);
  if (result.status === 'NO_COUNTERPART') {
    const updated = persistValidation(inv.id, result, { userName: req.user.name });
    return res.status(400).json({
      error: 'No system counterpart invoice found for this contract and billing period',
      validation: result,
      invoice: withContract(updated),
    });
  }

  const updated = persistValidation(inv.id, result, { userName: req.user.name });
  logAudit({
    req, user: req.user, action: 'VALIDATE', module: 'REIA', entityType: 'invoice', entityId: inv.id,
    details: { status: result.status, system_invoice_id: result.system_invoice_id },
  });
  res.json({ ...withContract(updated), validation: result });
});

// Waive a mismatch / partial validation (REIA only)
router.post('/:id/validation/waive', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Cannot waive validation on a cancelled invoice' });
  }

  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Waive reason is required' });

  let prior = null;
  try { prior = inv.validation_json ? JSON.parse(inv.validation_json) : null; } catch { /* ignore */ }
  const base = prior && prior.lines
    ? { ...prior, status: 'WAIVED' }
    : { ...compareSellerToSystem(inv), status: 'WAIVED' };

  const updated = persistValidation(inv.id, { ...base, status: 'WAIVED' }, {
    userName: req.user.name,
    waiveReason: reason,
  });

  logAudit({
    req, user: req.user, action: 'VALIDATION_WAIVE', module: 'REIA', entityType: 'invoice', entityId: inv.id,
    reason,
    details: { prior_status: inv.validation_status },
  });
  pushNotification({
    role: 'REIA_USER',
    type: 'INVOICE_VALIDATION_WAIVED',
    message: `Validation waived for ${inv.invoice_no}: ${reason}`,
  });

  let validation = null;
  try { validation = updated.validation_json ? JSON.parse(updated.validation_json) : null; } catch { /* ignore */ }
  res.json({ ...withContract(updated), validation });
});

// ── Structured Verification Checklist (Technical + Commercial) ──────────────
// GET returns the saved checklist overlaid on a fresh auto-derived template so
// the auto-hints (REA/energy/tariff/CUF/COD) stay current.
router.get('/:id/verification', requireRole(...ROLE_GROUPS.REIA_ALL, ...SELLER_ROLES), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const template = buildVerificationTemplate(inv);
  let saved = null;
  try { saved = inv.verification_json ? JSON.parse(inv.verification_json) : null; } catch { /* ignore */ }
  const merged = mergeSavedVerification(template, saved);
  res.json({
    ...merged,
    verification_status: inv.verification_status || rollupVerification(merged.technical),
    verified_at: inv.verified_at, verified_by: inv.verified_by,
  });
});

router.post('/:id/verification', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const template = buildVerificationTemplate(inv);
  // Only accept known technical keys / commercial fields — recompute net server-side.
  const merged = mergeSavedVerification(template, {
    technical: Array.isArray(req.body.technical) ? req.body.technical : [],
    commercial: req.body.commercial || {},
  });
  const status = rollupVerification(merged.technical);
  db.prepare(`UPDATE invoices SET verification_status=?, verification_json=?, verified_at=datetime('now'), verified_by=?, updated_at=datetime('now') WHERE id=?`)
    .run(status, JSON.stringify(merged), req.user.name, inv.id);
  logAudit({ req, user: req.user, action: 'INVOICE_VERIFICATION', module: 'REIA', entityType: 'invoice', entityId: inv.id, details: { status } });
  res.json({ ...merged, verification_status: status, verified_at: new Date().toISOString(), verified_by: req.user.name });
});

// G. Invoice Approval Workflow
// Sending a seller's bill to SJVN is for the company admin and its checkers;
// the maker's draft reaches SJVN through them (submit-l2, then approve-l2).
router.post('/:id/submit-for-approval', requireRole(...ROLE_GROUPS.REIA_WRITE, 'SELLER', 'SELLER_L2', 'SELLER_L3'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv || !ownsInvoice(req.user, inv)) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Cannot submit a cancelled invoice for approval' });
  }
  const allowed = ['DRAFT', 'SUBMITTED', 'REJECTED'];
  if (!allowed.includes(inv.status)) {
    return res.status(400).json({
      error: `Cannot submit invoice in status ${inv.status}. Allowed: ${allowed.join(', ')}`,
    });
  }
  db.prepare(`UPDATE invoices SET status = 'UNDER_APPROVAL', updated_at = datetime('now') WHERE id = ?`).run(inv.id);

  // The chain is sized here, every time, to what the bill is worth now.
  //
  // It used to be sized only where no approval row existed yet — and an arrear,
  // a supplementary and every seller's bill are given one row the moment they
  // are raised. So the bands applied to generated bills alone: a 12,00,000
  // arrear went to APPROVED on a single signature. Whatever rows exist are reset
  // for the new round, the missing levels are added, and any level beyond what
  // the amount calls for is dropped.
  const levels = approvalLevelsFor(inv);
  db.transaction(() => {
    db.prepare(`UPDATE invoice_approvals SET status = 'PENDING', comments = NULL, acted_at = NULL, approver_name = NULL, approver_id = NULL WHERE invoice_id = ?`).run(inv.id);
    const have = new Set(db.prepare('SELECT level FROM invoice_approvals WHERE invoice_id = ?').all(inv.id).map((a) => a.level));
    const ins = db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, ?, ?)');
    for (let lvl = 1; lvl <= levels; lvl += 1) if (!have.has(lvl)) ins.run(newId('APR'), inv.id, lvl, 'PENDING');
    db.prepare('DELETE FROM invoice_approvals WHERE invoice_id = ? AND level > ?').run(inv.id, levels);
  })();
  logAudit({
    req: typeof req !== "undefined" ? req : null, user: req.user, action: 'SUBMIT_FOR_APPROVAL',
    module: 'REIA', entityType: 'invoice', entityId: inv.id,
    details: { total_amount: inv.total_amount, approval_levels: levels },
  });
  res.json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id));
});

router.post('/:id/approvals/:level/act', requireRole(...ROLE_GROUPS.REIA_WRITE, 'FINANCE_USER'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Cannot act on approvals for a cancelled invoice' });
  }
  const { decision, comments } = req.body; // APPROVED | REJECTED
  const badDecision = invalidDecision(decision);
  if (badDecision) return res.status(400).json({ error: badDecision });

  // A bill is approved out of the approval stage and nowhere else. The level
  // rows exist from the moment a bill is raised, and nothing looked at where the
  // bill stood, so a draft nobody had submitted could be approved — on its one
  // creation-time level, whatever its amount. Sending a seller's bill back is
  // the desk's call from the moment it arrives, so a rejection is also taken
  // while the bill is still SUBMITTED.
  const actable = decision === 'REJECTED' ? ['SUBMITTED', 'UNDER_APPROVAL'] : ['UNDER_APPROVAL'];
  if (!actable.includes(inv.status)) {
    const state = inv.status.replace(/_/g, ' ');
    return res.status(400).json({
      error: ['DRAFT', 'SUBMITTED', 'REJECTED', 'PENDING_L2'].includes(inv.status)
        ? `This invoice is ${state} — submit it for approval first.`
        : `This invoice is already ${state}; there is nothing left to ${decision === 'REJECTED' ? 'reject' : 'approve'}.`,
      invoice_status: inv.status,
    });
  }

  const conflict = makerCheckerConflict(inv, req.user);
  if (conflict) return res.status(403).json({ error: conflict });

  // A rejection is how an unresolved mismatch gets sent back, so only clearing
  // it is gated.
  if (req.body?.decision !== 'REJECTED') {
    const unresolved = unresolvedValidation(inv, req.user);
    if (unresolved) return res.status(400).json({ error: unresolved, validation_status: inv.validation_status });
    // Where SJVN has made the signed copy or the IRN mandatory, a bill without it is not approved.
    const missing = complianceBlock(inv);
    if (missing) return res.status(400).json({ error: missing });
  }

  const approval = db.prepare('SELECT * FROM invoice_approvals WHERE invoice_id = ? AND level = ?').get(req.params.id, req.params.level);
  if (!approval) return res.status(404).json({ error: 'Approval step not found' });
  if (approval.status !== 'PENDING') {
    return res.status(400).json({ error: `Level ${approval.level} has already been ${approval.status.toLowerCase()}${approval.approver_name ? ` by ${approval.approver_name}` : ''}.` });
  }
  // Levels are taken in order: level 2 signs what level 1 has passed.
  const next = db.prepare(`SELECT MIN(level) l FROM invoice_approvals WHERE invoice_id = ? AND status = 'PENDING'`).get(req.params.id).l;
  if (next !== approval.level) {
    return res.status(400).json({ error: `Level ${next} has to decide before level ${approval.level}.` });
  }
  // One person per level, where SJVN has switched that on. Several levels are
  // several people's judgement; one person clicking through all of them is one
  // approval recorded three times. Sending a bill back is open to anyone who
  // may approve, including someone who signed an earlier level.
  // Super admins and SJVN admins have administrative override authority across all levels.
  if (decision === 'APPROVED' && distinctApprovers() && !['IT_SUPER_ADMIN', 'SJVN_ADMIN', 'REIA_ADMIN', 'COMMERCIAL_ADMIN'].includes(req.user.role)) {
    const mine = db.prepare(`SELECT level, approver_id, approver_name FROM invoice_approvals WHERE invoice_id = ? AND status = 'APPROVED' ORDER BY level`).all(req.params.id)
      .find((a) => (a.approver_id ? a.approver_id === req.user.id : a.approver_name === req.user.name));
    if (mine) {
      const nextDesignation = approval.level === 2 ? 'DGM / Senior Manager (Finance) — Vikas (Finance)' : 'Head of Commercial / CGM — Divyankur (Management)';
      return res.status(403).json({
        error: `You approved Level ${mine.level} of this bill. Level ${approval.level} requires a distinct designated authority: ${nextDesignation}.`,
      });
    }
  }
  db.prepare(`UPDATE invoice_approvals SET status = ?, approver_name = ?, approver_id = ?, comments = ?, acted_at = datetime('now') WHERE id = ?`)
    .run(decision, req.user.name, req.user.id || null, comments ?? null, approval.id);

  if (decision === 'REJECTED') {
    db.prepare(`UPDATE invoices SET status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
    if (inv.direction === 'SELLER_TO_SJVN') {
      pushNotification({ role: 'SELLER', type: 'INVOICE_REJECTED', message: `Invoice ${inv.invoice_no} was returned by SJVN${comments ? `: ${String(comments).slice(0, 200)}` : ''}` });
    }
  } else {
    const pending = db.prepare(`SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ? AND status = 'PENDING'`).get(req.params.id).c;
    if (pending === 0) {
      db.prepare(`UPDATE invoices SET status = 'APPROVED', updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
      // By its number, and to the party the bill is actually for.
      pushNotification({
        role: inv.direction === 'SJVN_TO_BUYER' ? 'BUYER' : 'SELLER', type: 'INVOICE_APPROVED',
        message: `Invoice ${inv.invoice_no} has been approved by SJVN`,
      });
    }
  }
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: `APPROVAL_${decision}`, module: 'REIA', entityType: 'invoice', entityId: req.params.id, details: { level: req.params.level, comments } });
  res.json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id));
});

// Submit invoice to L2 (Maker)
router.post('/:id/submit-l2', requireRole('SELLER_L1', 'BUYER_L1', ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT id, status, contract_id FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv || !ownsInvoice(req.user, inv)) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status !== 'DRAFT') return res.status(400).json({ error: 'Only DRAFT invoices can be submitted to L2' });

  db.prepare("UPDATE invoices SET status = 'PENDING_L2', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  // logAudit takes one object. Called positionally, as it was here, it wrote no
  // action at all, and the NOT NULL on audit_logs.action turned every hand-off
  // to the checker into a 500.
  logAudit({
    req, user: req.user, action: 'SUBMIT_L2', module: 'REIA', entityType: 'invoice', entityId: inv.id,
    beforeValue: { status: 'DRAFT' }, afterValue: { status: 'PENDING_L2' },
  });
  res.json({ success: true });
});

// Approve invoice from L2 to SJVN (Checker)
// The company admin approves as well as its checkers: a company that has not
// appointed a checker could otherwise never send its maker's draft to SJVN.
router.post('/:id/approve-l2', requireRole('SELLER', 'SELLER_L2', 'SELLER_L3', 'BUYER', 'BUYER_L2', 'BUYER_L3', ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { comments } = req.body || {};
  const inv = db.prepare('SELECT id, contract_id, status, created_by, created_by_id, validation_status FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv || !ownsInvoice(req.user, inv)) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status !== 'PENDING_L2') return res.status(400).json({ error: 'Only PENDING_L2 invoices can be approved by L2' });

  // This route clears an invoice too, so it needs the same separation the
  // levelled approvals have. It had no check at all, which left the maker a
  // second way through even once the levelled one was refusing them.
  const conflict = makerCheckerConflict(inv, req.user);
  if (conflict) return res.status(403).json({ error: conflict });

  const unresolved = unresolvedValidation(inv, req.user);
  if (unresolved) return res.status(400).json({ error: unresolved, validation_status: inv.validation_status });

  db.prepare("UPDATE invoices SET status = 'SUBMITTED', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logAudit({
    req, user: req.user, action: 'APPROVE_L2', module: 'REIA', entityType: 'invoice', entityId: inv.id,
    beforeValue: { status: 'PENDING_L2' }, afterValue: { status: 'SUBMITTED' },
    details: comments ? { comments } : undefined,
  });
  const invoiceNo = db.prepare('SELECT invoice_no FROM invoices WHERE id = ?').get(inv.id)?.invoice_no || inv.id;
  pushNotification({ role: 'REIA_USER', type: 'INVOICE_SUBMITTED', message: `Seller invoice ${invoiceNo} submitted for review` });
  res.json({ success: true });
});

// Distribution — email PDF to counterparty + mark SENT
router.post('/:id/send', requireRole(...ROLE_GROUPS.REIA_WRITE), async (req, res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Cannot send a cancelled invoice' });
    }
    if (!['APPROVED', 'SENT'].includes(inv.status)) {
      return res.status(400).json({ error: 'Invoice must be APPROVED (or already SENT for resend) before distribution' });
    }

    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(inv.contract_id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    const seller = contract.seller_id ? db.prepare('SELECT * FROM entities WHERE id = ?').get(contract.seller_id) : null;
    const buyer = contract.buyer_id ? db.prepare('SELECT * FROM entities WHERE id = ?').get(contract.buyer_id) : null;

    // Counterparty for this bill direction
    const recipientEntity = inv.direction === 'SJVN_TO_BUYER' ? buyer : seller;
    const contacts = recipientEntity
      ? db.prepare(`
          SELECT email, name, phone FROM entity_contacts
          WHERE entity_id = ? AND email IS NOT NULL AND email != ''
          ORDER BY is_primary DESC, contact_type = 'COMMERCIAL' DESC
        `).all(recipientEntity.id)
      : [];

    const overrideTo = (req.body?.to || '').trim();
    const emails = [];
    if (overrideTo) emails.push(overrideTo);
    if (recipientEntity?.corporate_email) emails.push(recipientEntity.corporate_email);
    for (const c of contacts) {
      if (c.email && !emails.includes(c.email)) emails.push(c.email);
    }
    const uniqueEmails = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];

    if (!uniqueEmails.length) {
      return res.status(400).json({
        error: 'No recipient email found. Set corporate email / commercial contact on the counterparty, or pass body.to',
      });
    }

    // Due date at presentation
    let dueDate = inv.due_date;
    if (!dueDate) {
      dueDate = computeDueDate(new Date(), contract, getParamNumber('default_payment_terms_days', 30));
    }

    let beneficiaries = [];
    if (['Hydro', 'PSP'].includes(contract.project_type) && contract.contract_type === 'PPA') {
      const pStart = `${inv.billing_period}-01`;
      const pEnd = `${inv.billing_period}-31`;
      const rows = db.prepare(`
        SELECT b.name AS name, ca.allocation_percent AS allocation_percent
        FROM contract_allocations ca
        JOIN contracts s ON s.id = ca.psa_id
        LEFT JOIN entities b ON b.id = s.buyer_id
        WHERE ca.ppa_id = ?
          AND ca.effective_from <= ?
          AND (ca.effective_to IS NULL OR ca.effective_to >= ?)
        ORDER BY ca.allocation_percent DESC
      `).all(contract.id, pEnd, pStart);
      const total = Number(inv.total_amount) || 0;
      beneficiaries = rows.map((x) => ({ ...x, share: Math.round(total * (Number(x.allocation_percent) || 0) / 100) }));
    }

    const pdfBuffer = await generateInvoicePdfBuffer(inv, contract, seller, buyer, beneficiaries);
    const { subject, text, html } = formatInvoiceEmail({
      invoice: { ...inv, due_date: dueDate },
      contract,
      recipientName: recipientEntity?.name,
    });

    // Deliver to Quick Connect (Operational Mail desk) so counterparties receive invoice + PDF in portal
    let qcDelivered = false;
    try {
      const counterpartyUsers = recipientEntity?.id
        ? db.prepare(`SELECT id FROM users WHERE linked_entity_id = ? AND is_active = 1`).all(recipientEntity.id)
        : [];
      const targetUserIds = counterpartyUsers.length
        ? counterpartyUsers.map(u => u.id)
        : db.prepare(`SELECT id FROM users WHERE role = ? AND is_active = 1`).all(inv.direction === 'SJVN_TO_BUYER' ? 'BUYER_L1' : 'SELLER_L1').map(u => u.id);

      if (targetUserIds.length > 0) {
        const storeFilename = `inv_${inv.id}_${Date.now()}.pdf`;
        const storePath = path.join(attachmentDir(), storeFilename);
        fs.writeFileSync(storePath, pdfBuffer);

        sendMessage(req.user, {
          to: targetUserIds,
          subject,
          body: text,
          bodyHtml: html,
          files: [{
            originalname: `Invoice_${String(inv.invoice_no).replace(/[^\w.-]+/g, '_')}.pdf`,
            filename: storeFilename,
            mimetype: 'application/pdf',
            size: pdfBuffer.length,
          }],
        });
        qcDelivered = true;
      }
    } catch (qcErr) {
      console.warn('Quick Connect invoice delivery:', qcErr.message);
    }

    const mailResult = await sendMail({
      to: uniqueEmails,
      subject,
      text,
      html,
      attachments: [{
        filename: `Invoice_${String(inv.invoice_no).replace(/[^\w.-]+/g, '_')}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });

    if (!mailResult.ok && !qcDelivered) {
      db.prepare(`
        INSERT INTO invoice_deliveries (id, invoice_id, channel, recipient, status, mode, detail_json, sent_by)
        VALUES (?, ?, 'EMAIL', ?, 'FAILED', ?, ?, ?)
      `).run(
        newId('DLV'), inv.id, uniqueEmails.join(', '), mailResult.mode || 'NONE',
        JSON.stringify(mailResult), req.user?.name || null,
      );
      return res.status(502).json({ error: mailResult.error || 'Email delivery failed', delivery: mailResult });
    }

    const deliveryStatus = mailResult.mode === 'FILE_OUTBOX' ? 'SIMULATED' : 'SENT';
    db.prepare(`
      INSERT INTO invoice_deliveries (id, invoice_id, channel, recipient, status, mode, detail_json, sent_by)
      VALUES (?, ?, 'EMAIL', ?, ?, ?, ?, ?)
    `).run(
      newId('DLV'), inv.id, uniqueEmails.join(', '), deliveryStatus, mailResult.mode || (qcDelivered ? 'QUICK_CONNECT' : 'NONE'),
      JSON.stringify({ ...mailResult, quick_connect: qcDelivered }), req.user?.name || null,
    );

    // SMS notice via the shared gateway, but only when the channel policy for
    // INVOICE_SENT actually lists SMS — so it can be silenced from master data.
    // No rupee amount in the text: a notice + portal, not sensitive detail.
    const phone = recipientEntity?.corporate_phone || contacts.find((c) => c.phone)?.phone;
    if (phone && channelsFor('INVOICE_SENT').includes('SMS')) {
      const smsText = `SJVN: Invoice ${inv.invoice_no} is available for payment (due ${dueDate}). View on the portal.`;
      const smsRes = await sendSms({ to: phone, text: smsText, event: 'INVOICE_SENT' });
      db.prepare(`
        INSERT INTO invoice_deliveries (id, invoice_id, channel, recipient, status, mode, detail_json, sent_by)
        VALUES (?, ?, 'SMS', ?, ?, ?, ?, ?)
      `).run(
        // Same reading as the email line above: a message written to the outbox
        // because no gateway is configured has not reached anyone, and logging
        // it as SENT made the two channels disagree about one dispatch.
        newId('DLV'), inv.id, phone,
        smsRes.ok ? (smsRes.mode === 'FILE_OUTBOX' ? 'SIMULATED' : 'SENT') : 'FAILED',
        smsRes.mode, JSON.stringify(smsRes), req.user?.name || null,
      );
    }

    db.prepare(`UPDATE invoices SET status = 'SENT', due_date = ?, issued_at = COALESCE(issued_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`)
      .run(dueDate, inv.id);

    logAudit({
      req, user: req.user, action: 'SEND', module: 'REIA', entityType: 'invoice', entityId: inv.id,
      details: { to: uniqueEmails, mode: mailResult.mode, delivery_status: deliveryStatus },
    });

    const notifyRole = inv.direction === 'SJVN_TO_BUYER' ? 'BUYER' : 'SELLER';
    pushNotification({
      role: notifyRole,
      type: 'INVOICE_SENT',
      message: `Invoice ${inv.invoice_no} has been emailed (${mailResult.mode}) for payment`,
    });

    const deliveries = db.prepare(`
      SELECT * FROM invoice_deliveries WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(inv.id);

    res.json({
      ...withContract(db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id)),
      delivery: mailResult,
      deliveries,
    });
  } catch (err) {
    console.error('Invoice send failed:', err);
    res.status(500).json({ error: err.message || 'Failed to send invoice' });
  }
});

router.get('/:id/deliveries', requireRole(...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR'), (req, res) => {
  const inv = db.prepare('SELECT id FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  res.json(db.prepare(`
    SELECT * FROM invoice_deliveries WHERE invoice_id = ? ORDER BY created_at DESC
  `).all(req.params.id));
});

// Record payment against invoice (H. Payment Tracking)
// DISCOM realization available to fund a generator (developer) pay-out — the
// amount the DISCOM(s) have actually paid on the PSA invoices linked to this
// developer invoice (via invoice_mapping). This is what "pay-when-paid" draws on.
function generatorRealization(devInvoiceId) {
  const psa = db.prepare('SELECT buyer_invoice_id FROM invoice_mapping WHERE seller_invoice_id = ?')
    .all(devInvoiceId).map((r) => r.buyer_invoice_id);
  if (!psa.length) return { linked_psa: 0, realized: 0 };
  const ph = psa.map(() => '?').join(',');
  const realized = db.prepare(`SELECT COALESCE(SUM(amount + COALESCE(deduction,0)),0) s FROM payments WHERE invoice_id IN (${ph})`).get(...psa).s;
  return { linked_psa: psa.length, realized: Math.round(realized) };
}

// Record a payment against an invoice and roll up rebate / LPS / status. Shared
// by buyer payment recording and generator pay-out release.
export function applyInvoicePayment(inv, { amount, payment_date, mode, reference, deduction, release_source, breakup = null, lps_component = null }, req) {
  const id = newId('PAY');
  db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference, deduction, release_source, lps_component) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, inv.id, amount, payment_date, mode ?? null, reference ?? null, deduction || 0, release_source ?? null, lps_component > 0 ? lps_component : null);

  // Advanced Logic: Rebate and LPS
  let newRebate = inv.rebate;
  let newLps = inv.lps;
  const payDate = payment_date ? new Date(payment_date) : new Date();

  // ── Early-payment rebate (PPA / SELLER_TO_SJVN only), per payment ──
  // Buyers (DISCOMs) do NOT get early-payment rebate on PSA invoices.
  // Each payment earns rebate on the part of the bill IT settles, at the rate
  // for the day it arrived. Before, the first payment's date fixed the rate for
  // the whole bill, so a token payment inside five days bought 1.5% off all of
  // it however late the rest came.
  if (inv.direction === 'SELLER_TO_SJVN') {
    const contract = db.prepare('SELECT rebate_pct, rebate_days, rebate_basis FROM contracts WHERE id = ?').get(inv.contract_id);
    // Measured from presentation, not from when the row was created. The rebate
    // is for paying promptly once the bill arrives, and a bill held three weeks
    // in draft reached the seller with its five-day window already spent — the
    // same basis error the dispute window had, and for the same reason: nothing
    // recorded presentation until issued_at existed.
    const billDate = billPresentedOn(inv);
    let pct = contractRebatePct(contract, { billDate, dueDate: inv.due_date, payDate });
    // 2nd: global tiered rebate. 3rd: flat % if paid on/before due date.
    if (pct === null) {
      pct = tieredRebatePct(Math.max(0, daysBetween(new Date(billDate), payDate)), getParam('early_payment_rebate_tiers', null));
    }
    if (pct === null) {
      pct = (inv.due_date && payDate <= new Date(inv.due_date)) ? getParamNumber('early_payment_rebate_pct', 2) : 0;
    }
    if (pct > 0) {
      const gross = Number(inv.total_amount) || 0;
      // Rebate-eligible base excludes pass-through charges, taxes and LPS (PSA Art. 6.4).
      const base = Math.max(0, gross - otherChargesSum(inv) - (Number(inv.taxes) || 0) - (Number(inv.lps) || 0));
      const share = gross > 0 ? base / gross : 0;
      const rate = (pct / 100) * share;
      const paidBefore = db.prepare(
        'SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)),0) s FROM payments WHERE invoice_id = ? AND id != ?',
      ).get(inv.id, id).s;
      // What is left to settle, counting rebate already allowed as settled.
      const open = Math.max(0, gross - (Number(inv.disputed_amount) || 0) - paidBefore - (Number(inv.rebate) || 0));
      const thisPayment = (Number(amount) || 0) + (Number(deduction) || 0);
      // Cash c settles c / (1 - rate) of the bill when it earns `rate`.
      const settles = rate < 1 ? Math.min(open, thisPayment / (1 - rate)) : 0;
      newRebate = Math.round((Number(inv.rebate) || 0) + settles * rate);
    }
  }

  // ── LPS earned to the payment date, day by day on what was unpaid ──
  // Computed from every payment on the bill (this one included), so a late part
  // payment is surcharged for the days it was late and the rest for its own —
  // not the rest alone from the due date, which forgot the first part's days.
  if (inv.due_date) {
    const accrued = invoiceLpsAsOf(inv, payDate);
    if (accrued.lps > (Number(inv.lps) || 0)) newLps = accrued.lps;
  }

  const totalPaid = db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)),0) s FROM payments WHERE invoice_id = ?').get(inv.id).s;
  
  // Effective payable = original total - rebate + lps - disputed (undisputed always due)
  const effectivePayable = payableNow({ ...inv, rebate: newRebate, lps: newLps }).payable_now;
  
  const newStatus = totalPaid >= effectivePayable ? 'PAID' : 'PARTIALLY_PAID';
  
  db.prepare(`UPDATE invoices SET status = ?, rebate = ?, lps = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(newStatus, newRebate, newLps, inv.id);
  // What this payment earned in rebate and what was held back from it, kept on
  // the payment so its advice can say why the cash is less than the bill settled.
  db.prepare('UPDATE payments SET rebate_amount = ?, tds_amount = ?, tds_section = ?, deduction_note = ? WHERE id = ?')
    .run(Math.max(0, newRebate - (Number(inv.rebate) || 0)), breakup?.tds_amount ?? null, breakup?.tds_section ?? null, breakup?.deduction_note ?? null, id);

  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id);
}

// Outstanding position of a buyer's bills, oldest first — surcharge and principal.
//
// Surcharge here is what the bill has earned to date less what has already been
// paid towards it. It used to be the whole accrual every time, with every
// payment taken off principal — so a receipt the waterfall had applied to
// surcharge left the surcharge figure where it was and the principal lower,
// which is the opposite of what PSA Art. 6.3 and the screen both say.
function buyerOutstanding(buyerId) {
  const invs = db.prepare(`
    SELECT i.* FROM invoices i JOIN contracts c ON c.id = i.contract_id
    WHERE c.buyer_id = ? AND i.direction = 'SJVN_TO_BUYER'
      AND i.status IN ('SENT','PARTIALLY_PAID','APPROVED','DISPUTED')
    ORDER BY i.billing_period ASC, i.created_at ASC
  `).all(buyerId);
  return invs.map((inv) => {
    const paid = paidTotalFor(inv.id);
    const lpsPaid = db.prepare('SELECT COALESCE(SUM(lps_component), 0) s FROM payments WHERE invoice_id = ?').get(inv.id).s;
    const earned = Math.max(Number(inv.lps) || 0, invoiceLpsAsOf(inv, new Date()).lps || 0);
    const lps = Math.max(0, earned - lpsPaid);
    const principal = Math.max(0, (inv.total_amount || 0) - (inv.disputed_amount || 0) - (paid - lpsPaid));
    return { inv, lps: Math.round(lps), principal: Math.round(principal) };
  }).filter((x) => x.lps > 0 || x.principal > 0);
}

// Waterfall payment (PSA Art. 6.3): a buyer's lump payment is applied first to
// Late Payment Surcharge (oldest bill first), then to the oldest bill's
// principal and so on. Each payment it records says how much of it was
// surcharge, so the bill, the outstanding position and the next accrual all
// read the same split.
router.post('/waterfall-payment', requireRole(...ROLE_GROUPS.FINANCE, ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { buyer_id, amount, payment_date, reference } = req.body;
  if (!buyer_id) return res.status(400).json({ error: 'buyer_id is required' });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'A positive payment amount is required' });
  const payDate = payment_date || new Date().toISOString().split('T')[0];
  // Today as the desk's calendar has it (IST), so a receipt entered after
  // midnight here is not refused for being tomorrow in UTC.
  const todayIst = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate) || payDate > todayIst) {
    return res.status(400).json({ error: 'The payment date must be a date not in the future' });
  }

  const items = buyerOutstanding(buyer_id);
  if (!items.length) return res.status(400).json({ error: 'No outstanding bills for this buyer' });

  const toLps = new Map();
  const toPrincipal = new Map();
  let remaining = amt;
  // Pass 1: LPS, oldest first.
  for (const it of items) { if (remaining <= 0) break; const a = Math.min(remaining, it.lps); if (a > 0) { toLps.set(it.inv.id, a); remaining -= a; } }
  // Pass 2: principal, oldest first.
  for (const it of items) { if (remaining <= 0) break; const a = Math.min(remaining, it.principal); if (a > 0) { toPrincipal.set(it.inv.id, a); remaining -= a; } }

  const allocations = [];
  const run = db.transaction(() => {
    for (const it of items) {
      const lpsPart = Math.round((toLps.get(it.inv.id) || 0) * 100) / 100;
      const principalPart = Math.round((toPrincipal.get(it.inv.id) || 0) * 100) / 100;
      const a = Math.round((lpsPart + principalPart) * 100) / 100;
      if (!(a > 0)) continue;
      const updated = applyInvoicePayment(it.inv, { amount: a, payment_date: payDate, mode: 'WATERFALL', reference: reference || null, deduction: 0, lps_component: lpsPart }, req);
      allocations.push({
        invoice_no: it.inv.invoice_no, billing_period: it.inv.billing_period, lps_due: it.lps, principal_due: it.principal,
        to_lps: lpsPart, to_principal: principalPart, allocated: a, status: updated.status,
      });
    }
  });
  run();
  logAudit({ req, user: req.user, action: 'WATERFALL_PAYMENT', module: 'REIA', entityType: 'entity', entityId: buyer_id, details: { amount: amt, allocations } });
  res.status(201).json({ received: Math.round(amt * 100) / 100, allocated: Math.round((amt - remaining) * 100) / 100, unallocated: Math.round(remaining * 100) / 100, allocations });
});

// Every user of a buyer company may notify a payment, not only its admin — and
// the bill has to be one of that company's. Nothing checked the second, so a
// buyer could record a payment against another company's invoice by its id.
router.post('/:id/payments', requireRole(...ROLE_GROUPS.FINANCE, ...BUYER_ROLES), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv || !ownsInvoice(req.user, inv)) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Cannot record payment against a cancelled invoice' });
  }
  // A bill still being drafted or approved has not been asked for, so a payment
  // against it is a mistyped invoice id far more often than it is a real
  // receipt. It also charged surcharge on a draft, which the invoice itself
  // reported as zero because a DRAFT reads as settled — the record disagreed
  // with itself the moment money touched it.
  if (['DRAFT', 'PENDING_L2', 'SUBMITTED', 'UNDER_APPROVAL', 'REJECTED'].includes(inv.status)) {
    return res.status(400).json({
      error: `This invoice has not been issued yet (${inv.status}), so there is nothing to pay against it. Approve and send it first.`,
      invoice_status: inv.status,
    });
  }
  // A buyer does not settle its own bill. What it sends here is an intimation;
  // the payment is recorded when Finance confirms it against the bank.
  if (counterpartySide(req.user) === 'BUYER') {
    try {
      return res.status(202).json({ intimation: createIntimation(req, inv.id, req.body), invoice: inv });
    } catch (err) {
      if (!err.status) console.error('[INVOICES] intimation failed', err);
      return res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
    }
  }
  const updated = applyInvoicePayment(inv, req.body, req);
  logAudit({ req, user: req.user, action: 'PAYMENT_RECORDED', module: 'REIA', entityType: 'invoice', entityId: inv.id, details: req.body });

  const paid = Number(req.body.amount) || 0;
  dispatch({
    event: 'PAYMENT_RECEIVED', role: 'FINANCE_USER',
    subject: `Payment recorded — ${inv.invoice_no}`,
    message: `SJVN: Payment of Rs ${paid.toLocaleString('en-IN')} recorded against ${inv.invoice_no}. Status now ${updated.status}.`,
  }).catch((err) => console.error('[NOTIFY] PAYMENT_RECEIVED failed', err.message));

  res.status(201).json(updated);
});

// Pay-when-paid: SJVN releases a payment to the generator (developer) against
// their PPA invoice, funded from DISCOM realization / own fund / payment security
// fund. DISCOM_REALIZATION can only draw what the buyer has actually paid.
const RELEASE_SOURCES = ['DISCOM_REALIZATION', 'OWN_FUND', 'PAYMENT_SECURITY_FUND'];
router.post('/:id/release-to-generator', requireRole(...ROLE_GROUPS.FINANCE, ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.direction !== 'SELLER_TO_SJVN') {
    return res.status(400).json({ error: 'Payment release applies only to developer (PPA) invoices' });
  }
  if (inv.status === 'CANCELLED') return res.status(400).json({ error: 'Invoice is cancelled' });
  if (!['APPROVED', 'SENT', 'PARTIALLY_PAID'].includes(inv.status)) {
    return res.status(400).json({ error: 'Invoice must be APPROVED before releasing payment to the generator' });
  }

  // Whose account this is about to land in. Everything above checks the invoice;
  // nothing checked the beneficiary, so a release went through against an
  // account that had just been changed and never verified.
  const beneficiary = db.prepare(`
    SELECT e.id, e.name, e.is_penny_drop_verified, e.pending_bank_json, e.account_no
    FROM contracts c JOIN entities e ON e.id = c.seller_id WHERE c.id = ?
  `).get(inv.contract_id);

  if (beneficiary) {
    if (beneficiary.pending_bank_json) {
      return res.status(400).json({
        error: `${beneficiary.name} has a change of bank account awaiting verification. Verify and re-approve it before releasing payment, so the money goes to a confirmed account.`,
        entity_id: beneficiary.id,
      });
    }
    if (!beneficiary.is_penny_drop_verified) {
      return res.status(400).json({
        error: `${beneficiary.name}'s bank account has not been verified. Verify it against the bank proof before releasing payment.`,
        entity_id: beneficiary.id,
      });
    }
  }

  const { amount, source, payment_date, reference } = req.body;
  if (!RELEASE_SOURCES.includes(source)) {
    return res.status(400).json({ error: `source must be one of ${RELEASE_SOURCES.join(', ')}` });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'A positive release amount is required' });

  // `amount` is the cash that leaves. Tax deducted at source and anything else
  // held back settle the bill too, and are recorded as what they are.
  const tds = Number(req.body.tds_amount) || 0;
  const otherDeduction = Number(req.body.other_deduction) || 0;
  if (tds < 0 || otherDeduction < 0) return res.status(400).json({ error: 'A deduction cannot be negative' });
  const deductionNote = String(req.body.deduction_note || '').trim().slice(0, 200);
  if (otherDeduction > 0 && !deductionNote) return res.status(400).json({ error: 'Say what the other deduction is for' });
  const held = Math.round((tds + otherDeduction) * 100) / 100;

  // Enforce pay-when-paid for the DISCOM-realization source: can only release
  // what the DISCOM(s) have actually paid, net of what was already released from
  // realization.
  if (source === 'DISCOM_REALIZATION') {
    const { realized, linked_psa } = generatorRealization(inv.id);
    if (!linked_psa) return res.status(400).json({ error: 'No PSA (buyer) invoices are mapped to this developer invoice — nothing realized. Use Own Fund or Payment Security Fund.' });
    const alreadyFromRealization = db.prepare(
      "SELECT COALESCE(SUM(amount + COALESCE(deduction,0)),0) s FROM payments WHERE invoice_id = ? AND release_source = 'DISCOM_REALIZATION'"
    ).get(inv.id).s;
    const headroom = realized - alreadyFromRealization;
    if (amt + held > headroom) {
      return res.status(400).json({ error: `Only ${Math.round(headroom).toLocaleString('en-IN')} realized from the DISCOM so far. Release the balance from Own Fund or Payment Security Fund.` });
    }
  }

  const updated = applyInvoicePayment(inv, {
    amount: amt,
    payment_date: payment_date || new Date().toISOString().split('T')[0],
    mode: `RELEASE:${source}`,
    reference: reference || null,
    deduction: held,
    release_source: source,
    breakup: { tds_amount: tds || null, tds_section: tds > 0 ? String(getParam('seller_invoice_tds_section', '194Q')) : null, deduction_note: deductionNote || null },
  }, req);
  logAudit({ req, user: req.user, action: 'RELEASE_TO_GENERATOR', module: 'REIA', entityType: 'invoice', entityId: inv.id, details: { amount: amt, tds_amount: tds, other_deduction: otherDeduction, source, reference } });
  pushNotification({ role: 'SELLER', type: 'PAYMENT_RELEASED', message: `Payment of Rs.${amt.toLocaleString('en-IN')} released for ${inv.invoice_no} (${source.replace(/_/g, ' ').toLowerCase()})` });
  res.status(201).json(updated);
});

// Set the pass-through "other charges" on an invoice (transmission / RLDC-SLDC /
// CTU-STU / open access / scheduling). Replaces the full set; adjusts the invoice
// total by the delta. These are rebate-excluded.
router.post('/:id/other-charges', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  // These change the bill's total. Once it is in approval or past it, that
  // total is what somebody has signed — it stayed editable right up to PAID,
  // which let an approved bill be re-priced without going back for approval.
  if (!['DRAFT', 'PENDING_L2', 'SUBMITTED', 'REJECTED'].includes(inv.status)) {
    return res.status(400).json({
      error: `Charges cannot be edited on a bill that is ${inv.status.replace(/_/g, ' ')}. ${['UNDER_APPROVAL'].includes(inv.status) ? 'Reject it back first, or r' : 'R'}aise a debit or credit note for the difference.`,
      invoice_status: inv.status,
    });
  }
  const input = Array.isArray(req.body.charges) ? req.body.charges : [];
  const charges = [];
  for (const c of input) {
    const type = OTHER_CHARGE_TYPES[c.type] ? c.type : null;
    const amount = Math.round(Number(c.amount) || 0);
    if (!type) return res.status(400).json({ error: `Invalid charge type. Allowed: ${Object.keys(OTHER_CHARGE_TYPES).join(', ')}` });
    if (amount === 0) continue;
    charges.push({ code: type, label: c.label || OTHER_CHARGE_TYPES[type], amount });
  }
  const oldSum = otherChargesSum(inv);
  const newSum = charges.reduce((a, c) => a + c.amount, 0);
  const delta = newSum - oldSum;
  db.prepare(`UPDATE invoices SET other_charges_json = ?, total_amount = COALESCE(total_amount,0) + ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(charges), delta, inv.id);
  logAudit({ req, user: req.user, action: 'SET_OTHER_CHARGES', module: 'REIA', entityType: 'invoice', entityId: inv.id, details: { charges, delta } });
  res.json(withContract(db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id)));
});

export default router;
