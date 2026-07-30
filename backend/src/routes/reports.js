import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { generateBillingReportPdf } from '../scripts/billingReportPdf.js';
import { generateEnergyReportPdf } from '../scripts/energyReportPdf.js';
import { generateDisputeReportPdf } from '../scripts/disputeReportPdf.js';
import { generateReconReportPdf } from '../scripts/reconReportPdf.js';
import { generateContractReportPdf } from '../scripts/contractReportPdf.js';
import { generateReiaDashboardPdf } from '../scripts/reiaDashboardReportPdf.js';
import { generateMarketAnalyticsPdf, generateTradingProfitabilityPdf, generateTradingDashboardPdf } from '../scripts/tradingReportsPdf.js';
import { buildTradingRealtime, buildTradingDaily, buildTradingPeriodic, buildConsolidatedPortfolio } from './dashboard.js';
import { generateActivityReportPdf, generateRegulatoryReportPdf, generateAuditReportPdf, generateMisReportPdf } from '../scripts/governanceReportsPdf.js';
import { verifyLogIntegrity, detectSoDViolations, secureLogAudit } from '../auditEngine.js';
import { getParamNumber } from '../mastersService.js';
import { OPEN_STATUSES, REASON_LABELS, SLA_LONG_PENDING_DAYS } from '../disputesConstants.js';
import { OPEN_RECON_STATUSES } from '../reconciliationConstants.js';

const router = Router();
router.use(requireAuth);

const REPORT_READ = [...new Set([...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR'])];
// Power Trading reports additionally reach the trading desk — REPORT_READ is
// built from the REIA groups and would otherwise lock TRADING_USER out of its
// own module's reports.
const TRADING_REPORT_READ = [...new Set([...REPORT_READ, ...ROLE_GROUPS.TRADING_ALL])];

/** Shared month-wise billing aggregation used by JSON + PDF endpoints. */
export function buildBillingSummary({ from, to } = {}) {
  const where = [`status != 'CANCELLED'`];
  const params = [];
  if (from) { where.push('billing_period >= ?'); params.push(from); }
  if (to) { where.push('billing_period <= ?'); params.push(to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const invRows = db.prepare(`
    SELECT billing_period,
      SUM(CASE WHEN direction = 'SJVN_TO_BUYER' THEN total_amount ELSE 0 END) AS sales_billed,
      SUM(CASE WHEN direction = 'SELLER_TO_SJVN' THEN total_amount ELSE 0 END) AS purchase_billed,
      SUM(COALESCE(trading_margin, 0)) AS trading_margin,
      SUM(CASE WHEN direction = 'SELLER_TO_SJVN' THEN COALESCE(rebate, 0) ELSE 0 END) AS rebate_saved,
      SUM(CASE WHEN direction = 'SJVN_TO_BUYER' THEN COALESCE(lps, 0) ELSE 0 END) AS lps_receivable,
      SUM(CASE WHEN direction = 'SELLER_TO_SJVN' THEN COALESCE(lps, 0) ELSE 0 END) AS lps_payable,
      SUM(CASE WHEN direction = 'SJVN_TO_BUYER' THEN 1 ELSE 0 END) AS sales_count,
      SUM(CASE WHEN direction = 'SELLER_TO_SJVN' THEN 1 ELSE 0 END) AS purchase_count,
      SUM(COALESCE(energy_mwh, 0)) AS energy_mwh
    FROM invoices
    ${whereSql}
    GROUP BY billing_period
  `).all(...params);

  const payWhere = [`i.status != 'CANCELLED'`];
  const payParams = [];
  if (from) { payWhere.push('i.billing_period >= ?'); payParams.push(from); }
  if (to) { payWhere.push('i.billing_period <= ?'); payParams.push(to); }
  const payRows = db.prepare(`
    SELECT i.billing_period,
      SUM(CASE WHEN i.direction = 'SJVN_TO_BUYER' THEN p.amount + COALESCE(p.deduction, 0) ELSE 0 END) AS collected,
      SUM(CASE WHEN i.direction = 'SELLER_TO_SJVN' THEN p.amount + COALESCE(p.deduction, 0) ELSE 0 END) AS paid_out
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE ${payWhere.join(' AND ')}
    GROUP BY i.billing_period
  `).all(...payParams);

  const payMap = Object.fromEntries(payRows.map((r) => [r.billing_period, r]));

  const months = invRows
    .map((r) => {
      const pay = payMap[r.billing_period] || { collected: 0, paid_out: 0 };
      const sales_billed = Math.round(r.sales_billed || 0);
      const purchase_billed = Math.round(r.purchase_billed || 0);
      const trading_margin = Math.round(r.trading_margin || 0);
      const rebate_saved = Math.round(r.rebate_saved || 0);
      const lps_receivable = Math.round(r.lps_receivable || 0);
      const lps_payable = Math.round(r.lps_payable || 0);
      const collected = Math.round(pay.collected || 0);
      const paid_out = Math.round(pay.paid_out || 0);
      const gross_margin = sales_billed - purchase_billed;
      const net_profit = gross_margin + rebate_saved + lps_receivable - lps_payable;
      return {
        billing_period: r.billing_period,
        sales_billed,
        purchase_billed,
        gross_margin,
        trading_margin,
        rebate_saved,
        lps_receivable,
        lps_payable,
        net_profit,
        collected,
        paid_out,
        outstanding_receivable: Math.max(0, sales_billed - collected),
        outstanding_payable: Math.max(0, purchase_billed - paid_out),
        sales_count: r.sales_count || 0,
        purchase_count: r.purchase_count || 0,
        energy_mwh: Math.round((r.energy_mwh || 0) * 100) / 100,
      };
    })
    .sort((a, b) => a.billing_period.localeCompare(b.billing_period));

  const totals = months.reduce((acc, m) => {
    for (const k of [
      'sales_billed', 'purchase_billed', 'gross_margin', 'trading_margin', 'rebate_saved',
      'lps_receivable', 'lps_payable', 'net_profit', 'collected', 'paid_out',
      'outstanding_receivable', 'outstanding_payable', 'sales_count', 'purchase_count', 'energy_mwh',
    ]) {
      acc[k] = (acc[k] || 0) + m[k];
    }
    return acc;
  }, {});

  return {
    from: from || (months[0]?.billing_period ?? null),
    to: to || (months[months.length - 1]?.billing_period ?? null),
    month_count: months.length,
    months,
    totals,
  };
}

/**
 * GET /api/reports/billing-summary?from=YYYY-MM&to=YYYY-MM
 */
router.get('/billing-summary', requireRole(...REPORT_READ), (req, res) => {
  try {
    res.json(buildBillingSummary({ from: req.query.from, to: req.query.to }));
  } catch (err) {
    console.error('Billing summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/billing-summary/pdf?from=YYYY-MM&to=YYYY-MM
 * Professional landscape PDF — not a screenshot.
 */
router.get('/billing-summary/pdf', requireRole(...REPORT_READ), (req, res) => {
  try {
    const report = buildBillingSummary({ from: req.query.from, to: req.query.to });
    secureLogAudit(req, { action: 'EXPORT_PDF', module: 'REPORTS', entityType: 'BILLING_SUMMARY', details: `Downloaded billing summary for ${req.query.from || 'all'} to ${req.query.to || 'all'}` });
    generateBillingReportPdf(report, { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('Billing report PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

/**
 * Energy Data & Validation — one row per contract × period (prov + final joined).
 */
export function buildEnergySummary({ from, to, contract_id } = {}) {
  const where = ['1=1'];
  const params = [];
  if (from) { where.push('ed.period_month >= ?'); params.push(from); }
  if (to) { where.push('ed.period_month <= ?'); params.push(to); }
  if (contract_id) { where.push('ed.contract_id = ?'); params.push(contract_id); }

  const raw = db.prepare(`
    SELECT ed.*, c.contract_no, c.project_type, c.capacity_mw
    FROM energy_data ed
    JOIN contracts c ON c.id = ed.contract_id
    WHERE ${where.join(' AND ')}
    ORDER BY ed.period_month ASC, c.contract_no ASC, ed.data_type ASC, ed.created_at ASC
  `).all(...params);

  // Group by contract_id + period_month
  const map = new Map();
  for (const ed of raw) {
    const key = `${ed.contract_id}||${ed.period_month}`;
    if (!map.has(key)) {
      map.set(key, {
        contract_id: ed.contract_id,
        contract_no: ed.contract_no,
        project_type: ed.project_type,
        capacity_mw: ed.capacity_mw,
        period_month: ed.period_month,
        provisional_mwh: null,
        final_mwh: null,
        delta_mwh: null,
        cuf_percent: null,
        availability_percent: null,
        source: null,
        provisional_status: null,
        final_status: null,
        status_label: null,
        billing_family_ref: null,
        provisional_id: null,
        final_id: null,
      });
    }
    const row = map.get(key);
    if (ed.data_type === 'PROVISIONAL') {
      const take = !row.provisional_id
        || (ed.status === 'LOCKED' && row.provisional_status !== 'LOCKED');
      if (take) {
        row.provisional_mwh = ed.energy_mwh;
        row.provisional_status = ed.status;
        row.provisional_id = ed.id;
        if (row.final_mwh == null) {
          row.cuf_percent = ed.cuf_percent;
          row.availability_percent = ed.availability_percent;
          row.source = ed.source;
          row.billing_family_ref = ed.billing_family_ref || row.billing_family_ref;
        }
      }
    } else if (ed.data_type === 'FINAL') {
      row.final_mwh = ed.energy_mwh;
      row.final_status = ed.status;
      row.final_id = ed.id;
      row.cuf_percent = ed.cuf_percent ?? row.cuf_percent;
      row.availability_percent = ed.availability_percent ?? row.availability_percent;
      row.source = ed.source || row.source;
      row.billing_family_ref = ed.billing_family_ref || row.billing_family_ref;
    }
  }

  const rows = [...map.values()].map((r) => {
    if (r.provisional_mwh != null && r.final_mwh != null) {
      r.delta_mwh = Math.round((r.final_mwh - r.provisional_mwh) * 100) / 100;
    }
    // Status label: prefer final status, else provisional
    const st = r.final_status || r.provisional_status || '—';
    if (r.final_mwh != null && r.provisional_mwh != null) {
      r.status_label = `${st} · Prov+Final`;
    } else if (r.final_mwh != null) {
      r.status_label = `${st} · Final only`;
    } else {
      r.status_label = `${st} · Prov only`;
    }
    return r;
  });

  // Status counts across raw records
  let locked = 0, validated = 0, draft = 0, disputed = 0;
  for (const ed of raw) {
    if (ed.status === 'LOCKED') locked += 1;
    else if (ed.status === 'VALIDATED') validated += 1;
    else if (ed.status === 'DRAFT') draft += 1;
    else if (ed.status === 'DISPUTED') disputed += 1;
  }

  let provisional_mwh = 0, final_mwh = 0, provisional_count = 0, final_count = 0;
  let awaiting_final = 0;
  const cufs = [];
  const avails = [];
  for (const r of rows) {
    if (r.provisional_mwh != null) { provisional_mwh += r.provisional_mwh; provisional_count += 1; }
    if (r.final_mwh != null) { final_mwh += r.final_mwh; final_count += 1; }
    if (r.provisional_mwh != null && r.final_mwh == null) awaiting_final += 1;
    if (r.cuf_percent != null) cufs.push(r.cuf_percent);
    if (r.availability_percent != null) avails.push(r.availability_percent);
  }

  const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);

  return {
    from: from || (rows[0]?.period_month ?? null),
    to: to || (rows[rows.length - 1]?.period_month ?? null),
    row_count: rows.length,
    rows,
    totals: {
      provisional_mwh: Math.round(provisional_mwh * 100) / 100,
      final_mwh: Math.round(final_mwh * 100) / 100,
      delta_mwh: Math.round((final_mwh - provisional_mwh) * 100) / 100,
      provisional_count,
      final_count,
      locked,
      validated,
      draft,
      disputed,
      awaiting_final,
      avg_cuf: avg(cufs),
      avg_availability: avg(avails),
    },
  };
}

router.get('/energy-summary', requireRole(...REPORT_READ), (req, res) => {
  try {
    res.json(buildEnergySummary({
      from: req.query.from,
      to: req.query.to,
      contract_id: req.query.contract_id,
    }));
  } catch (err) {
    console.error('Energy summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/energy-summary/pdf', requireRole(...REPORT_READ), (req, res) => {
  try {
    const report = buildEnergySummary({ from: req.query.from, to: req.query.to, contract_id: req.query.contract_id });
    secureLogAudit(req, { action: 'EXPORT_PDF', module: 'REPORTS', entityType: 'ENERGY_SUMMARY', details: 'Downloaded energy summary' });
    generateEnergyReportPdf(report, { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('Energy report PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

/** Disputes raised within from/to months (YYYY-MM on created_at). */
export function buildDisputeSummary({ from, to, status } = {}) {
  const where = ['1=1'];
  const params = [];
  if (from) { where.push(`substr(d.created_at, 1, 7) >= ?`); params.push(from); }
  if (to) { where.push(`substr(d.created_at, 1, 7) <= ?`); params.push(to); }
  if (status) { where.push('d.status = ?'); params.push(status); }

  const raw = db.prepare(`
    SELECT d.*, i.invoice_no, i.billing_period, c.contract_no
    FROM disputes d
    JOIN invoices i ON i.id = d.invoice_id
    JOIN contracts c ON c.id = i.contract_id
    WHERE ${where.join(' AND ')}
    ORDER BY d.created_at DESC
  `).all(...params);

  const now = Date.now();
  const rows = raw.map((d) => {
    const age_days = Math.floor((now - new Date(d.created_at).getTime()) / 86400000);
    const reason = REASON_LABELS[d.reason_code] || d.reason_code;
    return {
      dispute_no: d.dispute_no,
      raised_month: String(d.created_at || '').slice(0, 7),
      invoice_no: d.invoice_no,
      contract_no: d.contract_no,
      raised_by_role: d.raised_by_role,
      reason_code: d.reason_code,
      reason_short: reason.length > 28 ? `${reason.slice(0, 26)}…` : reason,
      disputed_amount: d.disputed_amount || 0,
      status: d.status,
      age_days,
      sla_flag: (d.sla_breached_at || d.status === 'ESCALATED') ? 'BREACH' : 'OK',
      outcome: d.resolution_outcome || (d.credit_amount ? `Credit ${d.credit_amount}` : '—'),
      credit_amount: d.credit_amount || 0,
    };
  });

  const openRows = rows.filter((r) => OPEN_STATUSES.includes(r.status));
  const aging = { '0_7': 0, '8_15': 0, '16_30': 0, '30_plus': 0 };
  let financial_exposure = 0;
  let sla_breached = 0;
  let long_pending = 0;
  for (const r of openRows) {
    financial_exposure += r.disputed_amount || 0;
    if (r.sla_flag === 'BREACH') sla_breached += 1;
    if (r.age_days >= SLA_LONG_PENDING_DAYS) long_pending += 1;
    if (r.age_days <= 7) aging['0_7'] += 1;
    else if (r.age_days <= 15) aging['8_15'] += 1;
    else if (r.age_days <= 30) aging['16_30'] += 1;
    else aging['30_plus'] += 1;
  }

  const by_reason = {};
  for (const d of raw) {
    if (!by_reason[d.reason_code]) by_reason[d.reason_code] = { reason_code: d.reason_code, count: 0, amount: 0 };
    by_reason[d.reason_code].count += 1;
    by_reason[d.reason_code].amount += d.disputed_amount || 0;
  }
  const byReasonList = Object.values(by_reason).sort((a, b) => b.count - a.count);
  const top = byReasonList[0];

  const resolved_count = raw.filter((d) =>
    ['RESOLVED_ACCEPTED', 'RESOLVED_REJECTED', 'CLOSED'].includes(d.status)
  ).length;
  const credit_total = raw.reduce((s, d) => s + (d.credit_amount || 0), 0);

  const months = raw.map((d) => String(d.created_at || '').slice(0, 7)).filter(Boolean).sort();

  return {
    from: from || months[0] || null,
    to: to || months[months.length - 1] || null,
    row_count: rows.length,
    rows,
    by_reason: byReasonList,
    totals: {
      open_count: openRows.length,
      financial_exposure: Math.round(financial_exposure),
      sla_breached,
      long_pending,
      resolved_count,
      credit_total: Math.round(credit_total),
      aging,
      top_reason_label: top ? (REASON_LABELS[top.reason_code] || top.reason_code) : null,
      top_reason_count: top?.count || 0,
    },
  };
}

router.get('/dispute-summary', requireRole(...REPORT_READ), (req, res) => {
  try {
    res.json(buildDisputeSummary({ from: req.query.from, to: req.query.to, status: req.query.status }));
  } catch (err) {
    console.error('Dispute summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/dispute-summary/pdf', requireRole(...REPORT_READ), (req, res) => {
  try {
    const report = buildDisputeSummary(req.query);
    secureLogAudit(req, { action: 'EXPORT_PDF', module: 'REPORTS', entityType: 'DISPUTE_SUMMARY', details: 'Downloaded dispute summary' });
    generateDisputeReportPdf(report, { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('Recon report PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

/** Reconciliations filtered by period (YYYY-MM). */
export function buildReconSummary({ from, to, status } = {}) {
  const where = ['1=1'];
  const params = [];
  if (from) { where.push('r.period >= ?'); params.push(from); }
  if (to) { where.push('r.period <= ?'); params.push(to); }
  if (status) { where.push('r.status = ?'); params.push(status); }

  const raw = db.prepare(`
    SELECT r.*,
      c.contract_no,
      COALESCE(es.name, eb.name, tc.name, '') as party_name
    FROM reconciliations r
    LEFT JOIN contracts c ON c.id = r.contract_id
    LEFT JOIN entities es ON es.id = c.seller_id
    LEFT JOIN entities eb ON eb.id = c.buyer_id
    LEFT JOIN trading_clients tc ON tc.id = r.trading_client_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.period DESC, r.created_at DESC
  `).all(...params);

  const now = Date.now();
  const rows = raw.map((r) => {
    const age_days = Math.floor((now - new Date(r.created_at).getTime()) / 86400000);
    const both = r.sjvn_ack_at && r.counterparty_ack_at;
    const one = r.sjvn_ack_at || r.counterparty_ack_at;
    return {
      recon_no: r.recon_no,
      period: r.period,
      contract_no: r.contract_no || r.party_name || (r.scope === 'TRADING_CLIENT' ? 'Trading' : '—'),
      data_basis: r.data_basis,
      auto_match_pct: r.auto_match_pct || 0,
      items_exception: r.items_exception || 0,
      items_auto_matched: r.items_auto_matched || 0,
      unreconciled_amount: r.unreconciled_amount || 0,
      status: r.status,
      age_days,
      signoff: both ? 'Both' : (one ? 'Partial' : 'Pending'),
    };
  });

  const open = raw.filter((r) => OPEN_RECON_STATUSES.includes(r.status));
  const aging = { '0_7': 0, '8_15': 0, '16_30': 0, '30_plus': 0 };
  let unreconciled_amount = 0;
  for (const r of open) {
    unreconciled_amount += r.unreconciled_amount || 0;
    const days = Math.floor((now - new Date(r.created_at).getTime()) / 86400000);
    if (days <= 7) aging['0_7'] += 1;
    else if (days <= 15) aging['8_15'] += 1;
    else if (days <= 30) aging['16_30'] += 1;
    else aging['30_plus'] += 1;
  }

  const avgAuto = raw.length
    ? raw.reduce((s, r) => s + (r.auto_match_pct || 0), 0) / raw.length
    : 0;

  const periods = raw.map((r) => r.period).filter(Boolean).sort();

  return {
    from: from || periods[0] || null,
    to: to || periods[periods.length - 1] || null,
    row_count: rows.length,
    rows,
    totals: {
      avg_auto_match_pct: Math.round(avgAuto * 10) / 10,
      needs_review: raw.filter((r) => r.status === 'NEEDS_REVIEW').length,
      pending_signoff: raw.filter((r) => r.status === 'PENDING_SIGN_OFF').length,
      disputed: raw.filter((r) => r.status === 'DISPUTED').length,
      agreed: raw.filter((r) => r.status === 'AGREED').length,
      closed: raw.filter((r) => r.status === 'CLOSED').length,
      unreconciled_amount: Math.round(unreconciled_amount),
      items_exception: raw.reduce((s, r) => s + (r.items_exception || 0), 0),
      items_auto_matched: raw.reduce((s, r) => s + (r.items_auto_matched || 0), 0),
      aging,
      open_count: open.length,
    },
  };
}

router.get('/recon-summary', requireRole(...REPORT_READ), (req, res) => {
  try {
    res.json(buildReconSummary({ from: req.query.from, to: req.query.to, status: req.query.status }));
  } catch (err) {
    console.error('Recon summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/recon-summary/pdf', requireRole(...REPORT_READ), (req, res) => {
  try {
    const report = buildReconSummary({ from: req.query.from, to: req.query.to, status: req.query.status });
    generateReconReportPdf(report, { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('Recon report PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

/** Contract portfolio register (+ optional filters). */
export function buildContractSummary({ contract_type, status, project_type, q } = {}) {
  const where = ['1=1'];
  const params = [];
  if (contract_type) { where.push('c.contract_type = ?'); params.push(contract_type); }
  if (status) { where.push('c.status = ?'); params.push(status); }
  if (project_type) { where.push('c.project_type = ?'); params.push(project_type); }
  if (q) { where.push('c.contract_no LIKE ?'); params.push(`%${q}%`); }

  const raw = db.prepare(`
    SELECT c.*,
      es.name as seller_name,
      eb.name as buyer_name
    FROM contracts c
    LEFT JOIN entities es ON es.id = c.seller_id
    LEFT JOIN entities eb ON eb.id = c.buyer_id
    WHERE ${where.join(' AND ')}
    ORDER BY c.contract_type, c.contract_no
  `).all(...params);

  const rows = raw.map((c) => ({
    contract_no: c.contract_no,
    contract_type: c.contract_type,
    party: c.contract_type === 'PPA' ? (c.seller_name || '—') : (c.buyer_name || '—'),
    project_type: c.project_type,
    capacity_mw: c.capacity_mw,
    commissioned_capacity_mw: c.commissioned_capacity_mw,
    tariff_per_unit: c.tariff_per_unit,
    tenure: `${(c.tenure_start || '').slice(0, 7)} → ${(c.tenure_end || '').slice(0, 7)}`,
    pbg_amount: c.pbg_amount,
    status: c.status,
  }));

  const active = raw.filter((c) => c.status === 'ACTIVE');
  const techs = [...new Set(active.map((c) => c.project_type).filter(Boolean))];
  const by_project_type = db.prepare(`
    SELECT project_type, COUNT(*) as contracts, COALESCE(SUM(capacity_mw),0) as capacity
    FROM contracts WHERE status = 'ACTIVE'
    ${contract_type ? 'AND contract_type = ?' : ''}
    GROUP BY project_type
  `).all(...(contract_type ? [contract_type] : []));

  const pipelineStatuses = ['DRAFT', 'UNDER_NEGOTIATION', 'SIGNED', 'PENDING_REGULATORY_APPROVAL'];
  const filterBits = [];
  if (contract_type) filterBits.push(contract_type);
  if (status) filterBits.push(status);
  if (project_type) filterBits.push(project_type);
  if (q) filterBits.push(`q=${q}`);

  return {
    filter_label: filterBits.length ? filterBits.join(' · ') : 'All contracts',
    row_count: rows.length,
    rows,
    by_project_type,
    totals: {
      active: active.length,
      ppa_active: active.filter((c) => c.contract_type === 'PPA').length,
      psa_active: active.filter((c) => c.contract_type === 'PSA').length,
      active_capacity_mw: active.reduce((s, c) => s + (c.capacity_mw || 0), 0),
      commissioned_mw: active.reduce((s, c) => s + (c.commissioned_capacity_mw || 0), 0),
      pbg_total: raw.reduce((s, c) => s + (c.pbg_amount || 0), 0),
      nearing_expiry: raw.filter((c) => c.status === 'NEARING_EXPIRY').length,
      pipeline: raw.filter((c) => pipelineStatuses.includes(c.status)).length,
      terminated: raw.filter((c) => c.status === 'TERMINATED').length,
      expired: raw.filter((c) => c.status === 'EXPIRED').length,
      tech_count: techs.length,
      tech_list: techs.slice(0, 4).join(', ') || '—',
    },
  };
}

router.get('/contract-summary', requireRole(...REPORT_READ), (req, res) => {
  try {
    res.json(buildContractSummary({
      contract_type: req.query.contract_type,
      status: req.query.status,
      project_type: req.query.project_type,
      q: req.query.q,
    }));
  } catch (err) {
    console.error('Contract summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/contract-summary/pdf', requireRole(...REPORT_READ), (req, res) => {
  try {
    const report = buildContractSummary({
      contract_type: req.query.contract_type,
      status: req.query.status,
      project_type: req.query.project_type,
      q: req.query.q,
    });
    generateContractReportPdf(report, { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('Contract report PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

/** Live REIA dashboard snapshot (same metrics as /api/dashboard/reia). */
export function buildReiaDashboardSummary() {
  const activeContracts = db.prepare(`SELECT COUNT(*) c FROM contracts WHERE status = 'ACTIVE'`).get().c;
  const contractedCapacity = db.prepare(`SELECT COALESCE(SUM(capacity_mw),0) s FROM contracts WHERE status = 'ACTIVE'`).get().s;
  const energySupplied = db.prepare(`SELECT COALESCE(SUM(energy_mwh),0) s FROM energy_data`).get().s;
  const billedEnergy = db.prepare(`SELECT COALESCE(SUM(energy_mwh),0) s FROM invoices`).get().s;
  const pendingApprovals = db.prepare(`SELECT COUNT(*) c FROM invoices WHERE status = 'UNDER_APPROVAL'`).get().c;
  const pendingDisputes = db.prepare(`SELECT COUNT(*) c FROM disputes WHERE status IN (${OPEN_STATUSES.map(() => '?').join(',')})`).get(...OPEN_STATUSES).c;
  const reconciliationExceptions = db.prepare(`SELECT COUNT(*) c FROM reconciliations WHERE status IN ('NEEDS_REVIEW','DISPUTED','REOPENED')`).get().c;
  const totalInvoices = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total_amount),0) s FROM invoices`).get();
  const receivables = db.prepare(`
    SELECT COALESCE(SUM(total_amount),0) s FROM invoices
    WHERE direction = 'SJVN_TO_BUYER' AND status NOT IN ('PAID','CANCELLED')
  `).get().s;
  const payables = db.prepare(`
    SELECT COALESCE(SUM(total_amount),0) s FROM invoices
    WHERE direction = 'SELLER_TO_SJVN' AND status NOT IN ('PAID','CANCELLED')
  `).get().s;
  const paymentsReceived = db.prepare(`
    SELECT COALESCE(SUM(p.amount),0) s FROM payments p
    JOIN invoices i ON i.id = p.invoice_id WHERE i.direction = 'SJVN_TO_BUYER'
  `).get().s;
  const paymentsDisbursed = db.prepare(`
    SELECT COALESCE(SUM(p.amount),0) s FROM payments p
    JOIN invoices i ON i.id = p.invoice_id WHERE i.direction = 'SELLER_TO_SJVN'
  `).get().s;
  const overdue = db.prepare(`
    SELECT COUNT(*) c FROM invoices WHERE status NOT IN ('PAID','CANCELLED') AND due_date IS NOT NULL AND due_date < date('now')
  `).get().c;
  const byStatus = db.prepare(`SELECT status, COUNT(*) c FROM invoices GROUP BY status`).all();
  const byProjectType = db.prepare(`
    SELECT c.project_type, COUNT(*) contracts, COALESCE(SUM(c.capacity_mw),0) capacity
    FROM contracts c WHERE c.status = 'ACTIVE' GROUP BY c.project_type
  `).all();
  const monthlyBilling = db.prepare(`
    SELECT billing_period, COALESCE(SUM(total_amount),0) total, COALESCE(SUM(energy_mwh),0) energy
    FROM invoices GROUP BY billing_period ORDER BY billing_period
  `).all();
  const expiringSecurities = db.prepare(`
    SELECT COUNT(*) c FROM payment_security
    WHERE status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED')
      AND validity_end IS NOT NULL
      AND julianday(validity_end) - julianday('now') BETWEEN 0 AND 60
  `).get().c;

  return {
    kpis: {
      activeContracts, contractedCapacity, energySupplied, billedEnergy,
      pendingApprovals, pendingDisputes, reconciliationExceptions, expiringSecurities,
      totalInvoices: totalInvoices.c, totalInvoiceValue: totalInvoices.s,
      receivables, payables, paymentsReceived, paymentsDisbursed, overdue,
    },
    byStatus,
    byProjectType,
    monthlyBilling,
  };
}

router.get('/reia-dashboard', requireRole(...REPORT_READ), (req, res) => {
  try {
    res.json(buildReiaDashboardSummary());
  } catch (err) {
    console.error('REIA dashboard summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/reia-dashboard/pdf', requireRole(...REPORT_READ), (req, res) => {
  try {
    const report = buildReiaDashboardSummary();
    generateReiaDashboardPdf(report, { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('REIA dashboard PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

export default router;

// ─── Power Trading: Market Rates & Analytics ──────────────────────────────
/**
 * Exchange price behaviour over a window, plus how SJVN's own cleared bids
 * compared with the market clearing price on the same day.
 */
export function buildMarketAnalyticsSummary({ from, to, exchange, product } = {}) {
  const latest = db.prepare('SELECT MAX(rate_date) d FROM market_rates').get()?.d;
  const end = to || latest;
  const start = from || (end ? new Date(new Date(end) - 29 * 864e5).toISOString().slice(0, 10) : null);

  const where = ['rate_date BETWEEN ? AND ?'];
  const params = [start, end];
  if (exchange) { where.push('exchange = ?'); params.push(exchange); }
  if (product) { where.push('product = ?'); params.push(product); }
  const w = `WHERE ${where.join(' AND ')}`;

  const stats = (extraCols = '') => `
    SELECT COUNT(*) observations, ROUND(AVG(mcp_rate),2) avg_rate,
           ROUND(MIN(mcp_rate),2) min_rate, ROUND(MAX(mcp_rate),2) max_rate,
           ROUND(COALESCE(SUM(volume_mw),0),0) total_volume_mw ${extraCols}
    FROM market_rates ${w}`;

  const overall = db.prepare(stats()).get(...params);

  // Same-length window immediately before, for a like-for-like comparison.
  const days = Math.max(1, Math.round((new Date(end) - new Date(start)) / 864e5) + 1);
  const prevEnd = new Date(new Date(start) - 864e5).toISOString().slice(0, 10);
  const prevStart = new Date(new Date(prevEnd) - (days - 1) * 864e5).toISOString().slice(0, 10);
  const prevParams = [prevStart, prevEnd, ...params.slice(2)];
  const previous = db.prepare(stats()).get(...prevParams);

  const byExchange = db.prepare(`
    SELECT exchange, COUNT(*) observations, ROUND(AVG(mcp_rate),2) avg_rate,
           ROUND(MIN(mcp_rate),2) min_rate, ROUND(MAX(mcp_rate),2) max_rate,
           ROUND(COALESCE(SUM(volume_mw),0),0) total_volume_mw
    FROM market_rates ${w} GROUP BY exchange ORDER BY avg_rate ASC`).all(...params);

  const byProduct = db.prepare(`
    SELECT product, COUNT(*) observations, ROUND(AVG(mcp_rate),2) avg_rate,
           ROUND(MIN(mcp_rate),2) min_rate, ROUND(MAX(mcp_rate),2) max_rate,
           ROUND(COALESCE(SUM(volume_mw),0),0) total_volume_mw
    FROM market_rates ${w} GROUP BY product ORDER BY avg_rate ASC`).all(...params);

  // Forecast accuracy: MAPE over rows that actually carry a forecast.
  const fc = db.prepare(`
    SELECT COUNT(*) n, ROUND(AVG(ABS(mcp_rate - forecast_rate) / NULLIF(mcp_rate,0)) * 100, 2) mape
    FROM market_rates ${w} AND forecast_rate IS NOT NULL AND mcp_rate > 0`).get(...params);

  const daily = db.prepare(`
    SELECT rate_date, ROUND(AVG(mcp_rate),2) avg_rate,
           ROUND(MIN(mcp_rate),2) min_rate, ROUND(MAX(mcp_rate),2) max_rate,
           ROUND(COALESCE(SUM(volume_mw),0),0) volume_mw
    FROM market_rates ${w} GROUP BY rate_date ORDER BY rate_date DESC LIMIT 40`).all(...params);

  // SJVN's own execution against the market on the same delivery date.
  const execution = db.prepare(`
    SELECT b.exchange, b.product, b.delivery_date,
           ROUND(SUM(blk.cleared_quantum_mw),2) cleared_mw,
           ROUND(SUM(blk.cleared_quantum_mw * blk.cleared_price) / NULLIF(SUM(blk.cleared_quantum_mw),0), 2) avg_cleared_price,
           (SELECT ROUND(AVG(mr.mcp_rate),2) FROM market_rates mr
             WHERE mr.exchange = b.exchange AND mr.product = b.product AND mr.rate_date = b.delivery_date) market_mcp
    FROM bids b JOIN bid_blocks blk ON b.id = blk.bid_id
    WHERE blk.cleared_quantum_mw > 0
    GROUP BY b.exchange, b.product, b.delivery_date
    ORDER BY b.delivery_date DESC LIMIT 25`).all()
    .map((r) => ({ ...r, vs_market: r.market_mcp ? Math.round((r.avg_cleared_price - r.market_mcp) * 100) / 100 : null }));

  const changePct = previous.avg_rate ? Math.round(((overall.avg_rate - previous.avg_rate) / previous.avg_rate) * 10000) / 100 : null;

  return {
    window: { start_date: start, end_date: end, days },
    filters: { exchange: exchange || null, product: product || null },
    overall,
    previous: { window: { start_date: prevStart, end_date: prevEnd }, ...previous, change_percent: changePct },
    by_exchange: byExchange,
    by_product: byProduct,
    forecast_accuracy: { observations_with_forecast: fc.n, mape_percent: fc.mape },
    cheapest_exchange: byExchange[0] || null,
    costliest_exchange: byExchange[byExchange.length - 1] || null,
    daily,
    execution,
  };
}

router.get('/market-analytics', requireRole(...TRADING_REPORT_READ), (req, res) => {
  res.json(buildMarketAnalyticsSummary(req.query));
});

router.get('/market-analytics/pdf', requireRole(...TRADING_REPORT_READ), (req, res) => {
  try {
    const report = buildMarketAnalyticsSummary(req.query);
    secureLogAudit(req, { action: 'EXPORT_PDF', module: 'REPORTS', entityType: 'MARKET_ANALYTICS', details: 'Downloaded market analytics report' });
    generateMarketAnalyticsPdf(report, { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('Market analytics PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

// ─── Power Trading: Financial & Profitability ─────────────────────────────
/**
 * Trading P&L built from the underlying deals rather than from
 * trading_invoices, which is empty — summing it would report zero across the
 * board. Each stream states the basis it is measured on, because they differ:
 * REC and exchange figures are realised, bilateral is contracted.
 */
export function buildTradingProfitabilitySummary({ from, to } = {}) {
  const dateWhere = (col) => {
    const w = []; const p = [];
    if (from) { w.push(`${col} >= ?`); p.push(from); }
    if (to) { w.push(`${col} <= ?`); p.push(to); }
    return { sql: w.length ? `AND ${w.join(' AND ')}` : '', params: p };
  };

  // REC — realised: sales booked against the lot's issuance cost.
  const recD = dateWhere('t.trade_date');
  const rec = db.prepare(`
    SELECT COALESCE(SUM(t.amount),0) revenue,
           COALESCE(SUM(t.quantity),0) qty,
           COALESCE(SUM(t.quantity * COALESCE(l.issue_cost_per_rec,0)),0) cost
    FROM rec_transactions t JOIN rec_ledger l ON l.id = t.lot_id
    WHERE t.txn_type = 'SALE' ${recD.sql}`).get(...recD.params);
  const recMargin = rec.revenue - rec.cost;

  // Exchange — realised: what actually cleared, valued as energy.
  const bidD = dateWhere('b.delivery_date');
  const exch = db.prepare(`
    SELECT b.product, COUNT(DISTINCT b.id) bids,
           ROUND(SUM(blk.cleared_quantum_mw),2) cleared_mw,
           ROUND(SUM(blk.cleared_quantum_mw * blk.cleared_price),2) value_per_mw_unit,
           ROUND(SUM(blk.cleared_quantum_mw * (blk.cleared_price - blk.price_per_unit)),2) price_gain_per_mw_unit
    FROM bids b JOIN bid_blocks blk ON b.id = blk.bid_id
    WHERE blk.cleared_quantum_mw > 0 ${bidD.sql}
    GROUP BY b.product ORDER BY cleared_mw DESC`).all(...bidD.params);

  // Bilateral — contracted: schedules are not yet captured, so this is the
  // margin the contract implies over its term, not delivered margin.
  const bilD = dateWhere('start_date');
  const bilateral = db.prepare(`
    SELECT id, counterparty, oa_type, quantum_mw, tariff_per_unit, purchase_rate_per_unit,
           start_date, end_date,
           ROUND((tariff_per_unit - COALESCE(purchase_rate_per_unit, tariff_per_unit)), 4) margin_per_unit
    FROM bilateral_transactions
    WHERE status != 'CANCELLED' ${bilD.sql}
    ORDER BY start_date DESC`).all(...bilD.params)
    .map((r) => {
      const days = Math.max(0, Math.round((new Date(r.end_date) - new Date(r.start_date)) / 864e5) + 1);
      const energyKwh = Number(r.quantum_mw) * 1000 * 24 * days;
      return { ...r, term_days: days, contracted_margin: Math.round(energyKwh * r.margin_per_unit) };
    });
  const bilateralMargin = bilateral.reduce((a, r) => a + r.contracted_margin, 0);

  // Open access charges are a direct cost of running bilateral trades.
  const oaD = dateWhere('txn_date');
  const oaByCategory = db.prepare(`
    SELECT COALESCE(category,'OTHER') category, ROUND(SUM(amount),2) amount, COUNT(*) txns
    FROM noar_wallet_txns WHERE txn_type = 'CHARGE' ${oaD.sql}
    GROUP BY category ORDER BY amount DESC`).all(...oaD.params);
  const oaTotal = oaByCategory.reduce((a, r) => a + r.amount, 0);

  const byClient = db.prepare(`
    SELECT tc.name client_name,
           COUNT(DISTINCT bt.id) bilateral_deals,
           ROUND(SUM(bt.quantum_mw),2) contracted_mw
    FROM trading_clients tc JOIN bilateral_transactions bt ON bt.client_id = tc.id
    WHERE bt.status != 'CANCELLED'
    GROUP BY tc.id ORDER BY contracted_mw DESC LIMIT 10`).all();

  return {
    window: { from: from || null, to: to || null },
    streams: [
      { stream: 'REC trading', basis: 'Realised', revenue: Math.round(rec.revenue), cost: Math.round(rec.cost), margin: Math.round(recMargin) },
      { stream: 'Bilateral (open access)', basis: 'Contracted', revenue: null, cost: Math.round(oaTotal), margin: Math.round(bilateralMargin - oaTotal) },
    ],
    rec: { ...rec, revenue: Math.round(rec.revenue), cost: Math.round(rec.cost), margin: Math.round(recMargin) },
    exchange: { products: exch, cleared_mw: exch.reduce((a, r) => a + (r.cleared_mw || 0), 0) },
    bilateral: { deals: bilateral.length, contracted_margin: bilateralMargin, rows: bilateral.slice(0, 20) },
    open_access_charges: { total: Math.round(oaTotal), by_category: oaByCategory },
    by_client: byClient,
    net_margin: Math.round(recMargin + bilateralMargin - oaTotal),
    // Stated rather than silently assumed — the invoice ledger is empty.
    caveats: [
      'trading_invoices holds no records, so billed revenue and invoiced trading margin are not part of these figures.',
      'Bilateral margin is contracted (tariff less purchase rate over the contract term), not delivered — block-wise schedules are not yet captured.',
      'Exchange figures cover cleared bids only; open bids are excluded.',
    ],
  };
}

router.get('/trading-profitability', requireRole(...TRADING_REPORT_READ), (req, res) => {
  res.json(buildTradingProfitabilitySummary(req.query));
});

router.get('/trading-profitability/pdf', requireRole(...TRADING_REPORT_READ), (req, res) => {
  try {
    const report = buildTradingProfitabilitySummary(req.query);
    secureLogAudit(req, { action: 'EXPORT_PDF', module: 'REPORTS', entityType: 'TRADING_PROFITABILITY', details: 'Downloaded trading profitability report' });
    generateTradingProfitabilityPdf(report, { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('Trading profitability PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

// ─── Power Trading: Dashboard snapshot ────────────────────────────────────
/** The three trading dashboard views captured as one report. */
export function buildTradingDashboardSummary() {
  return {
    realtime: buildTradingRealtime(),
    daily: buildTradingDaily(),
    periodic: buildTradingPeriodic(),
  };
}

router.get('/trading-dashboard', requireRole(...TRADING_REPORT_READ), (req, res) => {
  res.json(buildTradingDashboardSummary());
});

router.get('/trading-dashboard/pdf', requireRole(...TRADING_REPORT_READ), (req, res) => {
  try {
    generateTradingDashboardPdf(buildTradingDashboardSummary(), { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('Trading dashboard PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

// ─── Activity report ──────────────────────────────────────────────────────
// Who did what, when. Restricted to audit and management roles: this is
// per-person activity data, not a general operational report.
const ACTIVITY_READ = [...new Set([...ROLE_GROUPS.AUDITOR, 'MANAGEMENT'])];

/**
 * Activity across modules over a window.
 *
 * Sign-ins are counted separately from business actions throughout. LOGIN is
 * roughly half of all events, so folding it in would make every distribution
 * a report about logging in.
 */
export function buildActivitySummary({ from, to, module, user_id } = {}) {
  const where = ['1=1'];
  const params = [];
  if (from) { where.push('date(created_at) >= ?'); params.push(from); }
  if (to) { where.push('date(created_at) <= ?'); params.push(to); }
  if (module) { where.push('module = ?'); params.push(module); }
  if (user_id) { where.push('user_id = ?'); params.push(user_id); }
  const w = `WHERE ${where.join(' AND ')}`;
  const business = "AND action <> 'LOGIN'";

  const totals = db.prepare(`
    SELECT COUNT(*) events,
           COALESCE(SUM(CASE WHEN action = 'LOGIN' THEN 1 ELSE 0 END), 0) sign_ins,
           COALESCE(SUM(CASE WHEN action <> 'LOGIN' THEN 1 ELSE 0 END), 0) business_actions,
           COUNT(DISTINCT user_id) distinct_users,
           MIN(date(created_at)) first_day, MAX(date(created_at)) last_day
    FROM audit_logs ${w}`).get(...params);

  const byModule = db.prepare(`
    SELECT module, COUNT(*) events,
           COALESCE(SUM(CASE WHEN action <> 'LOGIN' THEN 1 ELSE 0 END), 0) business_actions,
           COUNT(DISTINCT user_id) users
    FROM audit_logs ${w} GROUP BY module ORDER BY events DESC`).all(...params);

  const byUser = db.prepare(`
    SELECT COALESCE(user_name, user_id, '(system)') user_name,
           COALESCE(user_role, '—') user_role,
           COUNT(*) events,
           COALESCE(SUM(CASE WHEN action <> 'LOGIN' THEN 1 ELSE 0 END), 0) business_actions,
           COUNT(DISTINCT module) modules_touched,
           MAX(created_at) last_seen
    FROM audit_logs ${w} GROUP BY user_id ORDER BY business_actions DESC, events DESC LIMIT 20`).all(...params);

  const topActions = db.prepare(`
    SELECT action, module, COUNT(*) count
    FROM audit_logs ${w} ${business} GROUP BY action, module ORDER BY count DESC LIMIT 20`).all(...params);

  const daily = db.prepare(`
    SELECT date(created_at) day, COUNT(*) events,
           COALESCE(SUM(CASE WHEN action = 'LOGIN' THEN 1 ELSE 0 END), 0) sign_ins,
           COALESCE(SUM(CASE WHEN action <> 'LOGIN' THEN 1 ELSE 0 END), 0) business_actions,
           COUNT(DISTINCT user_id) users
    FROM audit_logs ${w} GROUP BY day ORDER BY day DESC LIMIT 40`).all(...params);

  const recent = db.prepare(`
    SELECT created_at, COALESCE(user_name, '(system)') user_name, COALESCE(user_role,'—') user_role,
           module, action, entity_type, entity_id
    FROM audit_logs ${w} ${business} ORDER BY rowid DESC LIMIT 60`).all(...params);

  const busiest = [...daily].sort((a, b) => b.business_actions - a.business_actions)[0] || null;

  return {
    window: { from: from || totals.first_day, to: to || totals.last_day },
    filters: { module: module || null, user_id: user_id || null },
    totals,
    busiest_day: busiest,
    by_module: byModule,
    by_user: byUser,
    top_actions: topActions,
    daily,
    recent,
  };
}

router.get('/activity', requireRole(...ACTIVITY_READ), (req, res) => {
  res.json(buildActivitySummary(req.query));
});

router.get('/activity/pdf', requireRole(...ACTIVITY_READ), (req, res) => {
  try {
    generateActivityReportPdf(buildActivitySummary(req.query), { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('Activity report PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

// ─── Regulatory report ────────────────────────────────────────────────────
/**
 * Regulatory approval completeness per counterparty, plus the CERC filing and
 * trading-margin-cap position.
 *
 * Approval validity is reported on what is actually captured: valid_until is
 * not populated on any record today, so the report says so instead of showing
 * an empty expiry table, which would read as "nothing is expiring".
 */
export function buildRegulatorySummary({ entity_id } = {}) {
  const where = entity_id ? 'WHERE r.entity_id = ?' : '';
  const params = entity_id ? [entity_id] : [];

  const byEntity = db.prepare(`
    SELECT e.id, e.name, e.entity_type,
           COUNT(r.id) total,
           -- Mandatory but marked not applicable is neither required nor
           -- outstanding, so it is excluded from the denominator. Counting it
           -- as outstanding made the headline disagree with the action list.
           COALESCE(SUM(CASE WHEN r.is_mandatory = 1 AND r.status <> 'NOT_APPLICABLE' THEN 1 ELSE 0 END), 0) mandatory,
           COALESCE(SUM(CASE WHEN r.is_mandatory = 1 AND r.status = 'VERIFIED' THEN 1 ELSE 0 END), 0) mandatory_verified,
           COALESCE(SUM(CASE WHEN r.status = 'NOT_APPLICABLE' THEN 1 ELSE 0 END), 0) not_applicable
    FROM entities e JOIN entity_regulatory_approvals r ON r.entity_id = e.id
    ${where}
    GROUP BY e.id ORDER BY e.entity_type, e.name`).all(...params)
    .map((r) => ({
      ...r,
      mandatory_outstanding: r.mandatory - r.mandatory_verified,
      completeness_pct: r.mandatory ? Math.round((r.mandatory_verified / r.mandatory) * 1000) / 10 : null,
    }));

  const byStatus = db.prepare(`
    SELECT r.status, COUNT(*) count FROM entity_regulatory_approvals r ${where}
    GROUP BY r.status ORDER BY count DESC`).all(...params);

  // The actionable list: mandatory and not yet verified.
  const gaps = db.prepare(`
    SELECT e.name entity_name, e.entity_type, r.approval_code, r.label, r.status,
           r.issued_by, r.reference_no, r.valid_until
    FROM entity_regulatory_approvals r JOIN entities e ON e.id = r.entity_id
    ${where ? `${where} AND` : 'WHERE'} r.is_mandatory = 1 AND r.status <> 'VERIFIED' AND r.status <> 'NOT_APPLICABLE'
    ORDER BY e.entity_type, e.name, r.sort_order`).all(...params);

  const today = new Date().toISOString().slice(0, 10);
  const withValidity = db.prepare(`
    SELECT COUNT(*) n FROM entity_regulatory_approvals r
    ${where ? `${where} AND` : 'WHERE'} r.valid_until IS NOT NULL AND r.valid_until <> ''`).get(...params).n;
  const expiring = db.prepare(`
    SELECT e.name entity_name, r.label, r.valid_until, r.status
    FROM entity_regulatory_approvals r JOIN entities e ON e.id = r.entity_id
    ${where ? `${where} AND` : 'WHERE'} r.valid_until IS NOT NULL AND r.valid_until <> ''
      AND date(r.valid_until) <= date('now', '+90 days')
    ORDER BY r.valid_until ASC`).all(...params);

  // CERC Form-IV filings, with the margin cap that applied.
  const capLow = getParamNumber('cerc_margin_cap_low', 0.04);
  const capHigh = getParamNumber('cerc_margin_cap_high', 0.07);
  const capThreshold = getParamNumber('cerc_margin_cap_price_threshold', 3);
  const filings = db.prepare(`
    SELECT form_no, period_type, period, status, due_date, submission_date,
           total_volume_mu, total_revenue, trading_margin, avg_margin_per_unit,
           line_count, breach_count
    FROM cerc_form_iv ORDER BY period DESC`).all()
    .map((f) => ({
      ...f,
      is_overdue: f.status !== 'SUBMITTED' && f.due_date && f.due_date < today,
      days_to_due: f.due_date ? Math.round((new Date(f.due_date) - new Date(today)) / 864e5) : null,
    }));

  return {
    filters: { entity_id: entity_id || null },
    totals: {
      entities: byEntity.length,
      approvals: byEntity.reduce((a, r) => a + r.total, 0),
      mandatory: byEntity.reduce((a, r) => a + r.mandatory, 0),
      mandatory_verified: byEntity.reduce((a, r) => a + r.mandatory_verified, 0),
      mandatory_outstanding: byEntity.reduce((a, r) => a + r.mandatory_outstanding, 0),
      filings_overdue: filings.filter((f) => f.is_overdue).length,
      margin_cap_breaches: filings.reduce((a, f) => a + (f.breach_count || 0), 0),
    },
    by_entity: byEntity,
    by_status: byStatus,
    gaps,
    validity: {
      records_with_expiry: withValidity,
      expiring_within_90_days: expiring,
      // Stated so an empty list is not mistaken for a clean bill of health.
      note: withValidity === 0
        ? 'No approval record carries a validity date yet, so expiry and renewal cannot be tracked from this data.'
        : null,
    },
    cerc: {
      margin_cap: { low: capLow, high: capHigh, price_threshold: capThreshold },
      filings,
    },
  };
}

router.get('/regulatory', requireRole(...TRADING_REPORT_READ), (req, res) => {
  res.json(buildRegulatorySummary(req.query));
});

router.get('/regulatory/pdf', requireRole(...TRADING_REPORT_READ), (req, res) => {
  try {
    generateRegulatoryReportPdf(buildRegulatorySummary(req.query), { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('Regulatory report PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

// ─── Audit report ─────────────────────────────────────────────────────────
// Control assurance rather than activity volume: chain integrity, segregation
// of duties, and the privileged actions an auditor would want to see. Same
// restricted audience as the Activity report.
const PRIVILEGED_ACTION_LIKE = ['%DELETE%', '%REVERSE%', '%CANCEL%', '%OVERRIDE%', '%WAIVE%', '%DEACTIVATE%'];

export function buildAuditSummary({ from, to } = {}) {
  const where = ['1=1'];
  const params = [];
  if (from) { where.push('date(created_at) >= ?'); params.push(from); }
  if (to) { where.push('date(created_at) <= ?'); params.push(to); }
  const w = `WHERE ${where.join(' AND ')}`;

  const integrity = verifyLogIntegrity();
  const sod = detectSoDViolations();

  const totalEvents = db.prepare(`SELECT COUNT(*) c FROM audit_logs ${w}`).get(...params).c;

  // Privileged actions — anything that removes or overturns a record.
  const privClause = PRIVILEGED_ACTION_LIKE.map(() => 'action LIKE ?').join(' OR ');
  const privileged = db.prepare(`
    SELECT action, module, COUNT(*) count
    FROM audit_logs ${w} AND (${privClause})
    GROUP BY action, module ORDER BY count DESC`).all(...params, ...PRIVILEGED_ACTION_LIKE);
  const privilegedRecent = db.prepare(`
    SELECT created_at, COALESCE(user_name,'(system)') user_name, COALESCE(user_role,'—') user_role,
           module, action, entity_type, entity_id, reason
    FROM audit_logs ${w} AND (${privClause})
    ORDER BY rowid DESC LIMIT 40`).all(...params, ...PRIVILEGED_ACTION_LIKE);
  const privilegedTotal = privileged.reduce((a, r) => a + r.count, 0);

  // Financial reversals specifically — the append-only-ledger corrections.
  const reversals = db.prepare(`
    SELECT created_at, COALESCE(user_name,'(system)') user_name, module, action, entity_id, reason
    FROM audit_logs ${w} AND (action LIKE '%REVERSE%')
    ORDER BY rowid DESC LIMIT 25`).all(...params);

  const exports = db.prepare(`
    SELECT COUNT(*) c FROM audit_logs ${w} AND (action LIKE '%EXPORT%')`).get(...params).c;

  return {
    window: { from: from || null, to: to || null },
    integrity: {
      is_valid: integrity.isValid,
      message: integrity.message,
      broken_at_index: integrity.brokenAtIndex ?? null,
      broken_log_id: integrity.brokenLogId ?? null,
      records_checked: totalEvents,
    },
    segregation_of_duties: {
      violation_count: sod.length,
      violations: sod.slice(0, 40),
    },
    privileged: {
      total: privilegedTotal,
      by_action: privileged,
      recent: privilegedRecent,
    },
    reversals,
    export_events: exports,
  };
}

router.get('/audit', requireRole(...ACTIVITY_READ), (req, res) => {
  res.json(buildAuditSummary(req.query));
});

router.get('/audit/pdf', requireRole(...ACTIVITY_READ), (req, res) => {
  try {
    secureLogAudit(req, { action: 'EXPORT_PDF', module: 'REPORTS', entityType: 'AUDIT_REPORT', details: 'Downloaded security audit report' });
    generateAuditReportPdf(buildAuditSummary(req.query), { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('Audit report PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

// ─── Internal MIS report ──────────────────────────────────────────────────
// One management pack across both verticals for the executive audience the
// Consolidated Dashboard serves. Every figure is drawn from the same builders
// the individual reports use, so the pack cannot disagree with them.
export function buildMisSummary() {
  const p = buildConsolidatedPortfolio();
  const billing = buildBillingSummary();
  const profitability = buildTradingProfitabilitySummary();
  const regulatory = buildRegulatorySummary();

  const capacityPct = p.targetCapacity ? Math.round((p.reiaContractedCapacity / p.targetCapacity) * 1000) / 10 : null;

  // Cross-module risk items worth a management eye, each with its live count.
  const risks = [
    { item: 'Overdue receivables (REIA)', value: p.reiaOverdue, kind: 'money' },
    { item: 'Disputed amount (REIA)', value: p.reiaDisputedAmount, kind: 'money' },
    { item: 'Open disputes', value: p.reiaOpenDisputes, kind: 'count' },
    { item: 'Reconciliation exceptions', value: p.reiaReconExceptions, kind: 'count' },
    { item: 'Trading outstanding', value: p.tradingOutstanding, kind: 'money' },
    { item: 'Regulatory approvals outstanding', value: regulatory.totals.mandatory_outstanding, kind: 'count' },
    { item: 'CERC filings overdue', value: regulatory.totals.filings_overdue, kind: 'count' },
    { item: 'Margin cap breaches', value: regulatory.totals.margin_cap_breaches, kind: 'count' },
  ];

  return {
    generated_for: 'SJVN Management',
    executive_summary: p.executiveSummary,
    portfolio: {
      total_value: p.totalPortfolioValue,
      contracted_capacity_mw: p.reiaContractedCapacity,
      target_capacity_mw: p.targetCapacity,
      capacity_pct: capacityPct,
      overall_profitability: p.overallProfitability,
      data_completeness_pct: p.dataCompleteness,
    },
    reia: {
      billed_value: p.reiaBilledValue,
      receivables: p.reiaReceivables,
      payables: p.reiaPayables,
      overdue: p.reiaOverdue,
      collected: billing.totals.collected || 0,
      net_profit: billing.totals.net_profit || 0,
      months: billing.month_count,
    },
    trading: {
      net_margin: profitability.net_margin,
      cleared_quantum_mw: p.tradingClearedQuantum,
      streams: profitability.streams,
      open_access_charges: profitability.open_access_charges.total,
    },
    risk: {
      total_unresolved_exposure: p.totalUnresolvedExposure,
      security_coverage_pct: p.coverageRatio,
      items: risks,
    },
    // Stated so the pack is honest about where the platform still has no data.
    caveats: [
      p.tradingRevenue === 0 ? 'Trading revenue is billed via ISET, not this platform yet — trading figures are margin-based, not invoiced.' : null,
      ...profitability.caveats,
    ].filter(Boolean),
  };
}

router.get('/mis', requireRole(...ROLE_GROUPS.EXECUTIVE), (req, res) => {
  res.json(buildMisSummary());
});

router.get('/mis/pdf', requireRole(...ROLE_GROUPS.EXECUTIVE), (req, res) => {
  try {
    generateMisReportPdf(buildMisSummary(), { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('MIS report PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});
