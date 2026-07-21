import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { generateBillingReportPdf } from '../scripts/billingReportPdf.js';
import { generateEnergyReportPdf } from '../scripts/energyReportPdf.js';
import { generateDisputeReportPdf } from '../scripts/disputeReportPdf.js';
import { generateReconReportPdf } from '../scripts/reconReportPdf.js';
import { generateContractReportPdf } from '../scripts/contractReportPdf.js';
import { generateReiaDashboardPdf } from '../scripts/reiaDashboardReportPdf.js';
import { OPEN_STATUSES, REASON_LABELS, SLA_LONG_PENDING_DAYS } from '../disputesConstants.js';
import { OPEN_RECON_STATUSES } from '../reconciliationConstants.js';

const router = Router();
router.use(requireAuth);

const REPORT_READ = [...new Set([...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR'])];

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
    const report = buildEnergySummary({
      from: req.query.from,
      to: req.query.to,
      contract_id: req.query.contract_id,
    });
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
    const report = buildDisputeSummary({ from: req.query.from, to: req.query.to, status: req.query.status });
    generateDisputeReportPdf(report, { generatedBy: req.user?.name || req.user?.email }, res);
  } catch (err) {
    console.error('Dispute report PDF error:', err);
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
