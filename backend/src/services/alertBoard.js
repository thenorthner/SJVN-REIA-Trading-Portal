/**
 * The notification board: what needs attention right now, worked out live from
 * the books, plus the three things a live figure cannot do for itself —
 *
 *   remember   each alert is logged as an episode from the moment it first
 *              shows to the moment it clears, so last month's board can still
 *              be read (board_alert_episodes);
 *   stand down a person can acknowledge an alert or a pinned message. It leaves
 *              their own board — nobody else's — and comes back if it gets worse;
 *   reach out  a person can ask for alerts of a chosen severity to be sent to
 *              them by email or SMS when they first appear.
 *
 * A board belongs to a scope: SJVN staff share one, and each seller or buyer
 * company has its own, built only from its own contracts.
 */
import { contractVerticalSql } from './verticals.js';
import db from '../db/index.js';
import { newId } from '../util.js';
import { ROLE_GROUPS, PLATFORM_ADMINS } from '../middleware/auth.js';
import { deliverDirect } from './notificationService.js';
import { getSmsConfig, templateIdFor } from './smsService.js';
import { invoiceBalance } from './invoiceLps.js';
import { raisedBySellerSql } from './counterpartyScope.js';
import { outstandingOf } from './hydroLedger.js';

export const GROUPS = {
  BILLING: 'Billing & Payments',
  HYDRO: 'Hydro & Thermal Stations',
  SECURITY: 'Payment Security',
  RECONCILIATION: 'Reconciliation',
  DISPUTES: 'Disputes',
  CONTRACTS: 'Contracts',
  BROADCAST: 'Messages',
};
const SEVERITIES = ['CRITICAL', 'WARNING', 'INFO'];
// A preference names the least severe alert worth sending: CRITICAL sends only
// critical ones, INFO sends everything, NONE sends nothing.
const LEVELS = ['NONE', 'CRITICAL', 'WARNING', 'INFO'];
const RANK = { CRITICAL: 1, WARNING: 2, INFO: 3 };
export const ALERT_EVENT = 'BOARD_ALERT';

const fail = (status, message) => Object.assign(new Error(message), { status });

export const COUNTERPARTY_ROLES = ['SELLER', 'SELLER_L1', 'SELLER_L2', 'SELLER_L3', 'BUYER', 'BUYER_L1', 'BUYER_L2', 'BUYER_L3'];
export const BOARD_READ = [...new Set([
  ...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.HYDRO_THERMAL_ALL, ...ROLE_GROUPS.TRADING_ALL, 'COMPLIANCE_AUDITOR',
  ...COUNTERPARTY_ROLES,
])];
// Broadcasts stay with the SJVN / IT administrators (Target #2 Phase B) as well as the desks.
export const BOARD_WRITE = [...new Set([
  ...ROLE_GROUPS.REIA_WRITE, ...ROLE_GROUPS.HYDRO_THERMAL_WRITE, ...PLATFORM_ADMINS,
])];

/** Safe single-row query — returns {} if the table is missing on this DB. */
export function safeGet(sql, ...params) {
  try { return db.prepare(sql).get(...params) || {}; } catch { return {}; }
}
export function safeAll(sql, ...params) {
  try { return db.prepare(sql).all(...params) || []; } catch { return []; }
}

/**
 * Who is looking at the board decides (a) which rows count — counterparties
 * only ever see their own contracts' figures — and (b) where alert cards link,
 * since sellers/buyers navigate inside their own portal, not /reia.
 */
export function scopeFor(user) {
  const role = user?.role || '';
  if (role.startsWith('SELLER')) {
    return { kind: 'SELLER', entityId: user.linked_entity_id || null, prefix: '/seller', audiences: ['ALL', 'SELLERS'] };
  }
  if (role.startsWith('BUYER')) {
    return { kind: 'BUYER', entityId: user.linked_entity_id || null, prefix: '/buyer', audiences: ['ALL', 'BUYERS'] };
  }
  if (['COMMERCIAL_ADMIN', 'COMMERCIAL'].includes(role)) {
    return { kind: 'COMMERCIAL', entityId: null, prefix: '/hydro-thermal', audiences: null };
  }
  return { kind: 'INTERNAL', entityId: null, prefix: '/reia', audiences: null };
}

/**
 * Builds live alert feed for Hydro and Thermal generating stations.
 * Includes station bill approvals, drafts, beneficiary overdue ledger debits,
 * dues this week, provisional Delhi splits, and tariff parameter readiness.
 */
export function computeHydroAlerts(add, P = '/hydro-thermal') {
  // 1. Hydro station bills awaiting approval (IN_APPROVAL or PENDING)
  const hydroApprovals = safeGet(`
    SELECT COUNT(*) count FROM hydro_station_bills
    WHERE approval_status IN ('IN_APPROVAL', 'PENDING')
  `);
  add({
    key: 'hydro-bills-pending-approval', group: 'HYDRO', category: 'Hydro Bill Approval', severity: 'WARNING',
    title: 'Hydro bills awaiting approval',
    detail: `${hydroApprovals.count} station bill(s) pending in approval workflow`,
    count: hydroApprovals.count || 0, link: `${P}/hydro-billing`,
  });

  // 2. Draft station bills ready for review / submission
  const hydroDrafts = safeGet(`
    SELECT COUNT(*) count FROM hydro_station_bills
    WHERE status = 'DRAFT' AND (approval_status IS NULL OR approval_status = 'NOT_SENT')
  `);
  add({
    key: 'hydro-draft-bills', group: 'HYDRO', category: 'Station Billing', severity: 'INFO',
    title: 'Draft hydro station bills',
    detail: `${hydroDrafts.count} station bill(s) in draft ready for review and submission`,
    count: hydroDrafts.count || 0, link: `${P}/hydro-billing`,
  });

  // 3. Rejected station bills needing revision
  const hydroRejected = safeGet(`
    SELECT COUNT(*) count FROM hydro_station_bills
    WHERE approval_status = 'REJECTED'
  `);
  add({
    key: 'hydro-bills-rejected', group: 'HYDRO', category: 'Hydro Bill Rejected', severity: 'CRITICAL',
    title: 'Hydro bills rejected in approval',
    detail: `${hydroRejected.count} station bill(s) returned / rejected by approver — revision needed`,
    count: hydroRejected.count || 0, link: `${P}/hydro-billing`,
  });

  // 4. Beneficiary overdue ledger debits
  const hydroOverdueRows = safeAll(`
    SELECT d.*, c.contract_no
    FROM hydro_ledger_docs d
    LEFT JOIN contracts c ON c.id = d.contract_id
    WHERE d.status = 'OPEN' AND d.doc_type IN ('PB', 'LPS')
      AND d.due_date IS NOT NULL AND date(d.due_date) < date('now')
  `);
  const hydroOverdueOwing = hydroOverdueRows.map((r) => {
    try { return outstandingOf(r.id); } catch { return Number(r.amount) || 0; }
  }).filter((b) => b > 0);
  add({
    key: 'hydro-beneficiary-overdue', group: 'HYDRO', category: 'Beneficiary Payment Overdue', severity: 'CRITICAL',
    title: 'Hydro beneficiary overdue payments',
    detail: `${hydroOverdueOwing.length} beneficiary bill(s) past due · ₹${Math.round(hydroOverdueOwing.reduce((a, b) => a + b, 0)).toLocaleString('en-IN')} outstanding`,
    count: hydroOverdueOwing.length, link: `${P}/hydro-ledger`,
  });

  // 5. Beneficiary dues coming up this week
  const hydroDueSoonRows = safeAll(`
    SELECT d.*
    FROM hydro_ledger_docs d
    WHERE d.status = 'OPEN' AND d.doc_type IN ('PB', 'LPS')
      AND d.due_date IS NOT NULL AND date(d.due_date) BETWEEN date('now') AND date('now', '+7 day')
  `);
  const hydroDueSoonOwing = hydroDueSoonRows.map((r) => {
    try { return outstandingOf(r.id); } catch { return Number(r.amount) || 0; }
  }).filter((b) => b > 0);
  add({
    key: 'hydro-beneficiary-due-soon', group: 'HYDRO', category: 'Beneficiary Payment Due', severity: 'WARNING',
    title: 'Hydro beneficiary dues this week',
    detail: `${hydroDueSoonOwing.length} beneficiary bill(s) due within 7 days · ₹${Math.round(hydroDueSoonOwing.reduce((a, b) => a + b, 0)).toLocaleString('en-IN')}`,
    count: hydroDueSoonOwing.length, link: `${P}/hydro-ledger`,
  });

  // 6. Provisional Delhi SLDC allocations
  const provisionalDelhi = safeGet(`
    SELECT COUNT(DISTINCT contract_id) count FROM hydro_beneficiary_allocations
    WHERE is_active = 1 AND source_note LIKE '%Delhi split provisional%'
  `);
  add({
    key: 'hydro-delhi-provisional-splits', group: 'HYDRO', category: 'Delhi SLDC Split', severity: 'WARNING',
    title: 'Provisional Delhi SLDC splits',
    detail: `${provisionalDelhi.count} station allocation(s) using provisional Delhi split awaiting SLDC confirmation`,
    count: provisionalDelhi.count || 0, link: `${P}/hydro-billing`,
  });

  // 7. Provisional REA station allocations
  const provisionalRea = safeGet(`
    SELECT COUNT(DISTINCT contract_id) count FROM hydro_beneficiary_allocations
    WHERE is_active = 1 AND source_note LIKE '%Provisional REA%'
  `);
  add({
    key: 'hydro-provisional-rea', group: 'HYDRO', category: 'Provisional REA', severity: 'INFO',
    title: 'Provisional REA allocations active',
    detail: `${provisionalRea.count} station(s) billed on Provisional REA shares — will reconcile upon Final REA`,
    count: provisionalRea.count || 0, link: `${P}/hydro-billing`,
  });

  // 8. Hydro stations missing tariff parameters
  const unreadyStations = safeAll(`
    SELECT id, contract_no FROM contracts
    WHERE project_type = 'Hydro' AND status = 'ACTIVE'
      AND ((annual_afc IS NULL OR annual_afc <= 0) AND (capacity_charges_total IS NULL OR capacity_charges_total <= 0)
        OR napaf_percent IS NULL OR napaf_percent <= 0)
  `);
  add({
    key: 'hydro-stations-unready', group: 'HYDRO', category: 'Tariff Master Readiness', severity: 'WARNING',
    title: 'Hydro stations missing tariff parameters',
    detail: `${unreadyStations.length} hydro station(s) missing AFC / NAPAF required for monthly billing`,
    count: unreadyStations.length, link: `${P}`,
  });

  // 9. Unclaimed additional charges (water cess, electricity duty, etc.)
  const unclaimed = safeGet(`
    SELECT COUNT(*) count, COALESCE(SUM(amount), 0) amount FROM hydro_additional_charges
    WHERE status = 'UNCLAIMED'
  `);
  add({
    key: 'hydro-unclaimed-charges', group: 'HYDRO', category: 'Additional Charges', severity: 'INFO',
    title: 'Unclaimed statutory / additional charges',
    detail: `${unclaimed.count} additional charge(s) (₹${Math.round(Number(unclaimed.amount || 0)).toLocaleString('en-IN')}) waiting to be claimed in next station bill`,
    count: unclaimed.count || 0, link: `${P}/hydro-claims`,
  });
}

/** Builds the live alert feed, restricted to the viewer's own contracts when scoped. */
export function computeAlerts(scope) {
  const alerts = [];
  const add = (a) => { if (a && a.count > 0) alerts.push({ id: a.key, ...a }); };
  const P = scope.prefix;

  if (scope.kind === 'COMMERCIAL') {
    computeHydroAlerts(add, P);
    const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    alerts.sort((a, b) => order[a.severity] - order[b.severity]);
    return alerts;
  }

  // Contract-ownership filters. Internal staff see everything (empty filter);
  // counterparties are pinned to contracts where they are the seller/buyer.
  let contractSub = '';
  let scopeParams = [];
  if (scope.entityId) {
    const col = scope.kind === 'SELLER' ? 'seller_id' : 'buyer_id';
    contractSub = `(SELECT id FROM contracts WHERE ${col} = ?)`;
    scopeParams = [scope.entityId];
  } else {
    // SJVN's own board is the REIA board: the Hydro desk has its alerts above,
    // and a hydro or thermal contract's bills are not REIA's to chase.
    contractSub = `(SELECT c_v.id FROM contracts c_v WHERE ${contractVerticalSql('REIA', 'c_v')})`;
  }
  const invFilter = contractSub ? ` AND contract_id IN ${contractSub}` : '';
  const disputeFilter = contractSub ? ` AND invoice_id IN (SELECT id FROM invoices WHERE contract_id IN ${contractSub})` : '';

  // What is still owed on a set of bills, bill by bill, on the figure the
  // invoice screens show. These two cards summed total_amount, so a bill with
  // 3.83 crore banked against 3.91 crore read as 3.91 crore overdue — and a
  // credit bill for −8,000 counted as an invoice past due.
  const owing = (rows) => rows.map((r) => {
    try { return invoiceBalance(r).balance; } catch { return Number(r.total_amount) || 0; }
  }).filter((b) => b > 0);
  const rupees = (list) => `₹${Math.round(list.reduce((a, b) => a + b, 0)).toLocaleString('en-IN')}`;

  // 1. Overdue payments (past due, still unpaid)
  const overdue = owing(safeAll(`
    SELECT * FROM invoices
    WHERE status IN ('SENT','APPROVED','PARTIALLY_PAID','DISPUTED')
      AND due_date IS NOT NULL AND date(due_date) < date('now')${invFilter}
  `, ...scopeParams));
  add({
    key: 'overdue-payments', group: 'BILLING', category: 'Overdue Payment', severity: 'CRITICAL',
    title: 'Overdue payments',
    detail: `${overdue.length} invoice(s) past due · ${rupees(overdue)} outstanding`,
    count: overdue.length, link: `${P}/invoices`,
  });

  // 2. Payment due dates (falling due in the next 7 days)
  const dueSoon = owing(safeAll(`
    SELECT * FROM invoices
    WHERE status IN ('SENT','APPROVED','PARTIALLY_PAID')
      AND due_date IS NOT NULL
      AND date(due_date) BETWEEN date('now') AND date('now','+7 day')${invFilter}
  `, ...scopeParams));
  add({
    key: 'due-soon', group: 'BILLING', category: 'Payment Due', severity: 'WARNING',
    title: 'Payments due this week',
    detail: `${dueSoon.length} invoice(s) due within 7 days · ${rupees(dueSoon)}`,
    count: dueSoon.length, link: `${P}/invoices`,
  });

  // 3. Invoice approvals pending. A buyer is shown none: a bill still in
  // approval is SJVN's working paper, not yet the buyer's to know about. A
  // seller is shown its own invoices waiting on SJVN, not SJVN's computation of
  // the same months.
  const approvalScope = scope.kind === 'SELLER' ? ` AND ${raisedBySellerSql('invoices')}` : '';
  const approvals = scope.kind === 'BUYER' ? { count: 0 } : safeGet(`
    SELECT COUNT(*) count FROM invoices
    WHERE status IN ('SUBMITTED','UNDER_APPROVAL','PENDING_L2')${invFilter}${approvalScope}
  `, ...scopeParams);
  add({
    key: 'invoice-approvals', group: 'BILLING', category: 'Invoice Approval', severity: 'WARNING',
    title: 'Invoices awaiting approval',
    detail: `${approvals.count} invoice(s) pending in the approval workflow`,
    count: approvals.count || 0, link: `${P}/invoices`,
  });

  // 4. LC / security expiring soon
  const expiring = safeGet(`
    SELECT COUNT(*) count FROM payment_security
    WHERE status = 'ACTIVE' AND validity_end IS NOT NULL
      AND date(validity_end) BETWEEN date('now') AND date('now','+30 day')${invFilter}
  `, ...scopeParams);
  add({
    key: 'security-expiring', group: 'SECURITY', category: 'LC Expiry', severity: 'WARNING',
    title: 'Security instruments expiring',
    detail: `${expiring.count} LC / BG expiring within 30 days — renewal needed`,
    count: expiring.count || 0, link: `${P}/payment-security`,
  });

  // 4b. Security shortfall (cover below requirement)
  const shortfall = safeGet(`
    SELECT COUNT(DISTINCT contract_id) count, COUNT(*) instruments, COALESCE(SUM(required_amount - available_amount),0) gap
    FROM payment_security
    WHERE status = 'ACTIVE' AND required_amount > 0 AND available_amount < required_amount${invFilter}
  `, ...scopeParams);
  add({
    key: 'security-shortfall', group: 'SECURITY', category: 'Security Shortfall', severity: 'CRITICAL',
    title: 'Payment security shortfall',
    detail: `${shortfall.count} contract(s) under-secured${shortfall.instruments > shortfall.count ? ` across ${shortfall.instruments} instruments` : ''} · ₹${Number(shortfall.gap || 0).toLocaleString('en-IN')} gap`,
    count: shortfall.count || 0, link: `${P}/payment-security`,
  });

  // 5. Security mechanism breach (invocation triggered)
  const breach = safeGet(`
    SELECT COUNT(*) count FROM security_invocations
    WHERE status IN ('ELIGIBLE','NOTICE_ISSUED')${invFilter}
  `, ...scopeParams);
  add({
    key: 'security-breach', group: 'SECURITY', category: 'Security Breach', severity: 'CRITICAL',
    title: 'Security mechanism breach',
    detail: `${breach.count} invocation(s) triggered on defaulting contracts`,
    count: breach.count || 0, link: `${P}/payment-security`,
  });

  // 6. Pending claims (invocation claimed, awaiting funds)
  const claims = safeGet(`
    SELECT COUNT(*) count, COALESCE(SUM(amount),0) amount FROM security_invocations
    WHERE status = 'CLAIMED'${invFilter}
  `, ...scopeParams);
  add({
    key: 'pending-claims', group: 'SECURITY', category: 'Pending Claims', severity: 'WARNING',
    title: 'Claims awaiting funds',
    detail: `${claims.count} claim(s) filed · ₹${Number(claims.amount || 0).toLocaleString('en-IN')} to be received`,
    count: claims.count || 0, link: `${P}/payment-security`,
  });

  // 7. Delayed settlements (reconciliations stuck awaiting sign-off)
  const delayed = safeGet(`
    SELECT COUNT(*) count FROM reconciliations
    WHERE status IN ('PENDING_SIGN_OFF','IN_PROGRESS')
      AND date(updated_at) < date('now','-7 day')${invFilter}
  `, ...scopeParams);
  add({
    key: 'delayed-settlements', group: 'RECONCILIATION', category: 'Delayed Settlement', severity: 'WARNING',
    title: 'Delayed settlements',
    detail: `${delayed.count} reconciliation(s) awaiting sign-off for over 7 days`,
    count: delayed.count || 0, link: `${P}/reconciliation`,
  });

  // 8. Reconciliation exceptions
  const reconEx = safeGet(`
    SELECT COUNT(*) count FROM reconciliations
    WHERE status IN ('NEEDS_REVIEW','DISPUTED')${invFilter}
  `, ...scopeParams);
  add({
    key: 'recon-exceptions', group: 'RECONCILIATION', category: 'Reconciliation Exception', severity: 'CRITICAL',
    title: 'Reconciliation exceptions',
    detail: `${reconEx.count} reconciliation(s) with unmatched figures needing review`,
    count: reconEx.count || 0, link: `${P}/reconciliation`,
  });

  // 9. Disputes — open / escalated / recently resolved
  const escalated = safeGet(`SELECT COUNT(*) count FROM disputes WHERE status = 'ESCALATED'${disputeFilter}`, ...scopeParams);
  add({
    key: 'disputes-escalated', group: 'DISPUTES', category: 'Dispute', severity: 'CRITICAL',
    title: 'Escalated disputes',
    detail: `${escalated.count} dispute(s) escalated — SLA breach risk`,
    count: escalated.count || 0, link: `${P}/disputes`,
  });
  const openDisputes = safeGet(`
    SELECT COUNT(*) count FROM disputes
    WHERE status IN ('RAISED','ACKNOWLEDGED','UNDER_REVIEW','INFO_REQUESTED')${disputeFilter}
  `, ...scopeParams);
  add({
    key: 'disputes-open', group: 'DISPUTES', category: 'Dispute', severity: 'WARNING',
    title: 'Open disputes',
    detail: `${openDisputes.count} dispute(s) awaiting resolution`,
    count: openDisputes.count || 0, link: `${P}/disputes`,
  });
  const resolved = safeGet(`
    SELECT COUNT(*) count FROM disputes
    WHERE status IN ('RESOLVED_ACCEPTED','RESOLVED_REJECTED','CLOSED')
      AND resolved_at IS NOT NULL AND date(resolved_at) >= date('now','-7 day')${disputeFilter}
  `, ...scopeParams);
  add({
    key: 'disputes-resolved', group: 'DISPUTES', category: 'Dispute', severity: 'INFO',
    title: 'Recently resolved disputes',
    detail: `${resolved.count} dispute(s) resolved in the last 7 days`,
    count: resolved.count || 0, link: `${P}/disputes`,
  });

  // 10. Contracts — milestones, the performance guarantee, and what is waiting to be answered
  const side = scope.kind === 'INTERNAL' ? 'SJVN' : scope.kind;
  const overdueMilestones = safeGet(`
    SELECT COUNT(*) count FROM contract_milestones
    WHERE achieved_date IS NULL AND reported_date IS NULL AND due_date IS NOT NULL AND date(due_date) < date('now')${invFilter}
  `, ...scopeParams);
  add({
    key: 'milestones-delayed', group: 'CONTRACTS', category: 'Project Milestone', severity: 'CRITICAL',
    title: 'Project milestones delayed',
    detail: `${overdueMilestones.count} milestone(s) past their date and not yet achieved`,
    count: overdueMilestones.count || 0, link: `${P}/contracts`,
  });
  // The guarantee is the seller's; a buyer's board says nothing about it.
  const pbgFilter = scope.kind === 'BUYER' ? ' AND 1 = 0' : contractSub ? ` AND id IN ${contractSub}` : '';
  const pbgParams = scope.kind === 'BUYER' ? [] : scopeParams;
  const pbgExpired = safeGet(`
    SELECT COUNT(*) count FROM contracts
    WHERE pbg_expiry IS NOT NULL AND pbg_expiry <> '' AND date(pbg_expiry) < date('now')
      AND status NOT IN ('TERMINATED','CLOSED','EXPIRED','AMENDED','DRAFT')${pbgFilter}
  `, ...pbgParams);
  add({
    key: 'pbg-expired', group: 'CONTRACTS', category: 'Performance Guarantee', severity: 'CRITICAL',
    title: 'Performance guarantees expired',
    detail: `${pbgExpired.count} contract(s) with a PBG past its expiry`,
    count: pbgExpired.count || 0, link: `${P}/contracts`,
  });
  const pbgExpiring = safeGet(`
    SELECT COUNT(*) count FROM contracts
    WHERE pbg_expiry IS NOT NULL AND pbg_expiry <> '' AND date(pbg_expiry) BETWEEN date('now') AND date('now','+30 day')
      AND status NOT IN ('TERMINATED','CLOSED','EXPIRED','AMENDED','DRAFT')${pbgFilter}
  `, ...pbgParams);
  add({
    key: 'pbg-expiring', group: 'CONTRACTS', category: 'Performance Guarantee', severity: 'WARNING',
    title: 'Performance guarantees expiring',
    detail: `${pbgExpiring.count} PBG(s) expiring within 30 days — renewal needed`,
    count: pbgExpiring.count || 0, link: `${P}/contracts`,
  });
  if (side === 'SJVN') {
    const requests = safeGet(`SELECT COUNT(*) count FROM contract_requests WHERE status = 'PENDING'`);
    add({
      key: 'contract-requests', group: 'CONTRACTS', category: 'Contract Request', severity: 'WARNING',
      title: 'Contract requests awaiting a decision',
      detail: `${requests.count} extension / amendment / guarantee request(s) from counterparties`,
      count: requests.count || 0, link: `${P}/contracts`,
    });
  }
  // A notice waits on whoever it was sent to.
  const notices = safeGet(`
    SELECT COUNT(*) count FROM contract_notices
    WHERE acknowledged_at IS NULL AND ${side === 'SJVN' ? "sent_by_side <> 'SJVN'" : "sent_by_side = 'SJVN' AND counterparty_side = ?"}${invFilter}
  `, ...(side === 'SJVN' ? [] : [side]), ...scopeParams);
  add({
    key: 'contract-notices', group: 'CONTRACTS', category: 'Contractual Notice', severity: 'WARNING',
    title: 'Notices awaiting acknowledgement',
    detail: `${notices.count} contractual notice(s) received and not yet acknowledged`,
    count: notices.count || 0, link: `${P}/contracts`,
  });

  const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  return alerts;
}

/** Broadcasts visible to this audience. Internal staff see every active message. */
export function activeBroadcasts(audiences) {
  const base = `
    SELECT * FROM broadcast_messages
    WHERE is_active = 1 AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
  `;
  const order = ` ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, created_at DESC`;
  if (!audiences) return safeAll(base + order);
  const marks = audiences.map(() => '?').join(',');
  return safeAll(`${base} AND audience IN (${marks})${order}`, ...audiences);
}


const scopeKey = (scope) => (
  scope.kind === 'INTERNAL'
    ? 'INTERNAL'
    : scope.kind === 'COMMERCIAL'
      ? 'COMMERCIAL'
      : `${scope.kind}:${scope.entityId || 'UNLINKED'}`
);

// ── Episodes: the board's memory ────────────────────────────────────────────

/**
 * Bring the log in line with what the board shows now: open an episode for an
 * alert that has just appeared, update the ones still showing, close the ones
 * that have cleared. Returns the open episodes by alert key, and the alerts
 * that are new this time.
 */
export function syncEpisodes(scope, alerts) {
  const key = scopeKey(scope);
  const open = new Map(db.prepare(`
    SELECT * FROM board_alert_episodes WHERE scope_key = ? AND resolved_at IS NULL
  `).all(key).map((e) => [e.alert_key, e]));
  const fresh = [];

  db.transaction(() => {
    for (const a of alerts) {
      const e = open.get(a.id);
      if (!e) {
        const id = newId('BAE');
        db.prepare(`
          INSERT INTO board_alert_episodes
            (id, scope_key, alert_key, category, grp, severity, title, detail, link, peak_count, last_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, key, a.id, a.category, a.group, a.severity, a.title, a.detail, a.link || null, a.count, a.count);
        open.set(a.id, db.prepare('SELECT * FROM board_alert_episodes WHERE id = ?').get(id));
        fresh.push(a);
      } else if (e.last_count !== a.count || e.detail !== a.detail) {
        db.prepare(`
          UPDATE board_alert_episodes
          SET last_count = ?, peak_count = MAX(peak_count, ?), detail = ?, last_seen_at = datetime('now')
          WHERE id = ?
        `).run(a.count, a.count, a.detail, e.id);
      }
    }
    const showing = new Set(alerts.map((a) => a.id));
    for (const [alertKey, e] of open) {
      if (!showing.has(alertKey)) {
        db.prepare(`UPDATE board_alert_episodes SET resolved_at = datetime('now') WHERE id = ?`).run(e.id);
        open.delete(alertKey);
      }
    }
  })();

  return { open, fresh };
}

// ── Reaching people by email and SMS ────────────────────────────────────────

/** The active logins that share a board. */
function usersInScope(scope) {
  if (scope.kind === 'COMMERCIAL') {
    const roles = ['COMMERCIAL_ADMIN', 'COMMERCIAL'];
    return db.prepare(`
      SELECT id, name, email, phone FROM users
      WHERE is_active = 1 AND role IN (${roles.map(() => '?').join(',')})
    `).all(...roles);
  }
  if (scope.kind === 'INTERNAL') {
    const roles = BOARD_READ.filter((r) => !COUNTERPARTY_ROLES.includes(r) && !['COMMERCIAL_ADMIN', 'COMMERCIAL'].includes(r));
    return db.prepare(`
      SELECT id, name, email, phone FROM users
      WHERE is_active = 1 AND role IN (${roles.map(() => '?').join(',')})
    `).all(...roles);
  }
  if (!scope.entityId) return [];
  return db.prepare(`
    SELECT id, name, email, phone FROM users
    WHERE is_active = 1 AND linked_entity_id = ? AND role LIKE ?
  `).all(scope.entityId, `${scope.kind}%`);
}

const wants = (level, severity) => level !== 'NONE' && RANK[severity] <= RANK[level];

/** Send newly-appeared alerts to the people on this board who asked for them. */
function announce(scope, fresh) {
  if (!fresh.length) return;
  const prefs = new Map(db.prepare('SELECT * FROM board_preferences').all().map((p) => [p.user_id, p]));
  for (const u of usersInScope(scope)) {
    const p = prefs.get(u.id);
    if (!p) continue;
    for (const a of fresh) {
      const email = wants(p.email_min, a.severity);
      const sms = wants(p.sms_min, a.severity);
      if (!email && !sms) continue;
      deliverDirect({
        // One event per alert, so two different alerts in the same sweep are not taken for a repeat.
        event: `${ALERT_EVENT}:${a.id}`,
        smsEvent: ALERT_EVENT,
        rcpt: u,
        email,
        sms,
        subject: `SJVN alert — ${a.severity === 'CRITICAL' ? 'Critical' : a.severity === 'WARNING' ? 'Attention' : 'For information'}: ${a.title}`,
        text: `${a.title}\n${a.detail}\n\nCategory: ${a.category}\nOpen the Notification Board on the SJVN portal for the details.\n\nYou are receiving this because of your notification settings on the board.`,
        smsText: `SJVN alert: ${a.title} - ${a.count} item(s). See the portal.`,
      }).catch((err) => console.error('[BOARD] alert delivery failed', err.message));
    }
  }
}

/** Work out a scope's board, log it, and tell whoever asked to be told. */
function refresh(scope) {
  const alerts = computeAlerts(scope);
  const { open, fresh } = syncEpisodes(scope, alerts);
  announce(scope, fresh);
  return { alerts, open };
}

/**
 * The hourly sweep: every board is brought up to date whether or not anyone
 * is looking at it, so the history has no gaps and an alert that appears
 * overnight still reaches the people who asked to be told.
 */
export function sweepBoards() {
  const scopes = [
    { kind: 'INTERNAL', entityId: null, prefix: '/reia', audiences: null },
    { kind: 'COMMERCIAL', entityId: null, prefix: '/hydro-thermal', audiences: null },
  ];
  const linked = db.prepare(`
    SELECT DISTINCT role, linked_entity_id FROM users
    WHERE is_active = 1 AND linked_entity_id IS NOT NULL AND (role LIKE 'SELLER%' OR role LIKE 'BUYER%')
  `).all();
  const seen = new Set();
  for (const u of linked) {
    const scope = scopeFor(u);
    if (seen.has(scopeKey(scope))) continue;
    seen.add(scopeKey(scope));
    scopes.push(scope);
  }
  for (const scope of scopes) refresh(scope);
  return scopes.length;
}

// ── The board as one person sees it ─────────────────────────────────────────

const acksOf = (user) => db.prepare('SELECT * FROM board_acknowledgements WHERE user_id = ?').all(user.id);

export function buildBoard(user) {
  const scope = scopeFor(user);
  const { alerts, open } = refresh(scope);
  const acks = acksOf(user);
  const alertAck = new Map(acks.filter((a) => a.item_kind === 'ALERT').map((a) => [a.item_key, a]));
  const seenBroadcast = new Set(acks.filter((a) => a.item_kind === 'BROADCAST').map((a) => a.item_key));

  const shown = alerts.map((a) => {
    const episode = open.get(a.id);
    const ack = alertAck.get(a.id);
    // An acknowledgement covers the episode it was given for, up to the count
    // it was given at: a new occurrence, or more of the same, shows again.
    const acknowledged = !!ack && !!episode && ack.episode_id === episode.id && a.count <= ack.acked_count;
    return { ...a, since: episode?.first_seen_at || null, acknowledged };
  });
  const broadcasts = activeBroadcasts(scope.audiences).map((b) => ({ ...b, acknowledged: seenBroadcast.has(b.id) }));

  const live = [...shown, ...broadcasts].filter((x) => !x.acknowledged);
  const summary = {
    critical: live.filter((x) => x.severity === 'CRITICAL').length,
    warning: live.filter((x) => x.severity === 'WARNING').length,
    info: live.filter((x) => x.severity === 'INFO').length,
    total_items: shown.filter((a) => !a.acknowledged).reduce((s, a) => s + a.count, 0),
    acknowledged: shown.filter((a) => a.acknowledged).length + broadcasts.filter((b) => b.acknowledged).length,
  };
  return { broadcasts, alerts: shown, summary, groups: GROUPS, scope: scope.kind, generated_at: new Date().toISOString() };
}

export function acknowledge(user, kind, key) {
  const scope = scopeFor(user);
  const itemKey = String(key || '');
  if (kind === 'ALERT') {
    const alert = computeAlerts(scope).find((a) => a.id === itemKey);
    const episode = alert && db.prepare(`
      SELECT id FROM board_alert_episodes WHERE scope_key = ? AND alert_key = ? AND resolved_at IS NULL
    `).get(scopeKey(scope), itemKey);
    if (!alert || !episode) throw fail(404, 'That alert is no longer on the board');
    db.prepare(`
      INSERT INTO board_acknowledgements (user_id, item_kind, item_key, episode_id, acked_count)
      VALUES (?, 'ALERT', ?, ?, ?)
      ON CONFLICT(user_id, item_kind, item_key) DO UPDATE SET
        episode_id = excluded.episode_id, acked_count = excluded.acked_count, acked_at = datetime('now')
    `).run(user.id, itemKey, episode.id, alert.count);
  } else if (kind === 'BROADCAST') {
    if (!activeBroadcasts(scope.audiences).some((b) => b.id === itemKey)) throw fail(404, 'That message is no longer on the board');
    db.prepare(`
      INSERT INTO board_acknowledgements (user_id, item_kind, item_key) VALUES (?, 'BROADCAST', ?)
      ON CONFLICT(user_id, item_kind, item_key) DO UPDATE SET acked_at = datetime('now')
    `).run(user.id, itemKey);
  } else {
    throw fail(400, 'kind must be ALERT or BROADCAST');
  }
}

export function unacknowledge(user, kind, key) {
  if (!['ALERT', 'BROADCAST'].includes(kind)) throw fail(400, 'kind must be ALERT or BROADCAST');
  db.prepare('DELETE FROM board_acknowledgements WHERE user_id = ? AND item_kind = ? AND item_key = ?')
    .run(user.id, kind, String(key || ''));
}

// ── History ─────────────────────────────────────────────────────────────────

/**
 * What has been on this board: every alert episode, open or cleared, and every
 * pinned message, newest first. A page at a time.
 */
export function boardHistory(user, { q = '', severity = '', group = '', status = '', from = '', to = '', limit = 25, offset = 0 } = {}) {
  const scope = scopeFor(user);
  const where = [];
  const params = [];
  if (severity) {
    if (!SEVERITIES.includes(severity)) throw fail(400, `severity must be one of ${SEVERITIES.join(', ')}`);
    where.push('severity = ?'); params.push(severity);
  }
  if (group) {
    if (!GROUPS[group]) throw fail(400, `group must be one of ${Object.keys(GROUPS).join(', ')}`);
    where.push('grp = ?'); params.push(group);
  }
  if (status === 'open') where.push('ended_at IS NULL');
  else if (status === 'resolved') where.push('ended_at IS NOT NULL');
  else if (status) throw fail(400, 'status must be open or resolved');
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (from) { if (!day.test(from)) throw fail(400, 'from must be YYYY-MM-DD'); where.push('date(started_at) >= ?'); params.push(from); }
  if (to) { if (!day.test(to)) throw fail(400, 'to must be YYYY-MM-DD'); where.push('date(started_at) <= ?'); params.push(to); }
  const text = String(q || '').trim().toLowerCase();
  if (text) {
    where.push('(lower(title) LIKE ? OR lower(detail) LIKE ? OR lower(category) LIKE ?)');
    params.push(`%${text}%`, `%${text}%`, `%${text}%`);
  }

  const audience = scope.audiences ? `AND audience IN (${scope.audiences.map(() => '?').join(',')})` : '';
  const base = `
    SELECT 'ALERT' AS kind, id, alert_key AS item_key, title, detail, category, grp, severity,
           peak_count, last_count, first_seen_at AS started_at, resolved_at AS ended_at, NULL AS posted_by
    FROM board_alert_episodes WHERE scope_key = ?
    UNION ALL
    SELECT 'BROADCAST', id, id, title, message, 'Message', 'BROADCAST', severity, NULL, NULL, created_at,
           CASE WHEN is_active = 0 THEN COALESCE(removed_at, created_at)
                WHEN expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now') THEN expires_at END,
           created_by_name
    FROM broadcast_messages WHERE 1 = 1 ${audience}
  `;
  const baseParams = [scopeKey(scope), ...(scope.audiences || [])];
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const size = Math.min(Math.max(Number(limit) || 25, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${base}) ${filter}`).get(...baseParams, ...params).n;
  const items = db.prepare(`
    SELECT * FROM (${base}) ${filter}
    ORDER BY datetime(started_at) DESC, id DESC LIMIT ? OFFSET ?
  `).all(...baseParams, ...params, size, skip);
  return { items, total, limit: size, offset: skip };
}

// ── Preferences ─────────────────────────────────────────────────────────────

/** Whether an SMS would actually leave: the gateway is live and the alert text is registered with DLT. */
function smsReady() {
  try { return getSmsConfig().live && !!templateIdFor(ALERT_EVENT); } catch { return false; }
}

export function getPreferences(user) {
  const p = db.prepare('SELECT email_min, sms_min FROM board_preferences WHERE user_id = ?').get(user.id);
  const me = db.prepare('SELECT email, phone FROM users WHERE id = ?').get(user.id) || {};
  return {
    email_min: p?.email_min || 'NONE',
    sms_min: p?.sms_min || 'NONE',
    email: me.email || null,
    phone: me.phone || null,
    sms_ready: smsReady(),
  };
}

export function savePreferences(user, { email_min, sms_min }) {
  const cur = getPreferences(user);
  const email = email_min ?? cur.email_min;
  const sms = sms_min ?? cur.sms_min;
  if (!LEVELS.includes(email) || !LEVELS.includes(sms)) throw fail(400, `A level must be one of ${LEVELS.join(', ')}`);
  db.prepare(`
    INSERT INTO board_preferences (user_id, email_min, sms_min) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET email_min = excluded.email_min, sms_min = excluded.sms_min, updated_at = datetime('now')
  `).run(user.id, email, sms);
  return getPreferences(user);
}
