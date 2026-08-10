import { Router } from 'express';
import db from '../db/index.js';
import { receivablesOutstanding, payablesOutstanding, overdueReceivable, overdueCount } from '../services/outstanding.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { OPEN_STATUSES } from '../disputesConstants.js';
import { buildTradingProfitabilitySummary } from './reports.js';
import { utilizedExposure } from './bids.js';

const router = Router();
router.use(requireAuth);

// Cross-module executive aggregates (every counterparty's financials rolled
// up together). Hiding the nav link is not enough — the endpoint itself must
// reject seller/buyer users, including their L1/L2/L3 sub-users.
const EXECUTIVE_ROLES = ROLE_GROUPS.EXECUTIVE;

// M. REIA dashboards
router.get('/reia', (req, res) => {
  const activeContracts = db.prepare(`SELECT COUNT(*) c FROM contracts WHERE status = 'ACTIVE'`).get().c;
  const contractedCapacity = db.prepare(`SELECT COALESCE(SUM(capacity_mw),0) s FROM contracts WHERE status = 'ACTIVE'`).get().s;
  const energySupplied = db.prepare(`SELECT COALESCE(SUM(energy_mwh),0) s FROM energy_data`).get().s;
  const billedEnergy = db.prepare(`SELECT COALESCE(SUM(energy_mwh),0) s FROM invoices`).get().s;
  const pendingApprovals = db.prepare(`SELECT COUNT(*) c FROM invoices WHERE status = 'UNDER_APPROVAL'`).get().c;
  const pendingDisputes = db.prepare(`SELECT COUNT(*) c FROM disputes WHERE status IN (${OPEN_STATUSES.map(() => '?').join(',')})`).get(...OPEN_STATUSES).c;
  const reconciliationExceptions = db.prepare(`SELECT COUNT(*) c FROM reconciliations WHERE status IN ('NEEDS_REVIEW','DISPUTED','REOPENED')`).get().c;

  const totalInvoices = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total_amount),0) s FROM invoices`).get();
  const receivables = receivablesOutstanding();
  const payables = payablesOutstanding();
  const paymentsReceived = db.prepare(`
    SELECT COALESCE(SUM(p.amount),0) s FROM payments p
    JOIN invoices i ON i.id = p.invoice_id WHERE i.direction = 'SJVN_TO_BUYER'
  `).get().s;
  const paymentsDisbursed = db.prepare(`
    SELECT COALESCE(SUM(p.amount),0) s FROM payments p
    JOIN invoices i ON i.id = p.invoice_id WHERE i.direction = 'SELLER_TO_SJVN'
  `).get().s;
  const overdue = overdueCount();

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

  // The stakeholder side of this dashboard, which it did not carry: how many
  // counterparties are live, how many are stuck waiting for approval, and what
  // paperwork is about to lapse. A screen about contracts and their parties that
  // could not say how many parties there were.
  const entityCounts = db.prepare(`
    SELECT entity_type, status, COUNT(*) c FROM entities GROUP BY entity_type, status
  `).all();
  const countOf = (type, status) => entityCounts
    .filter((r) => r.entity_type === type && r.status === status)
    .reduce((a, r) => a + r.c, 0);

  const activeSellers = countOf('SELLER', 'APPROVED');
  const activeBuyers = countOf('BUYER', 'APPROVED');
  const pendingEntityApprovals = entityCounts.filter((r) => r.status === 'PENDING').reduce((a, r) => a + r.c, 0);

  // Named for what it counts. `pendingApprovals` is invoices under approval, and
  // sitting beside contract figures it read as counterparties awaiting sign-off.
  const pendingInvoiceApprovals = pendingApprovals;

  // Contract statuses. byStatus is invoice statuses, which on a contracts
  // dashboard was answering a question nobody asked of it.
  const contractsByStatus = db.prepare(`
    SELECT status, COUNT(*) c FROM contracts GROUP BY status ORDER BY c DESC
  `).all();

  const contractsNearingExpiry = db.prepare(`
    SELECT COUNT(*) c FROM contracts
    WHERE tenure_end IS NOT NULL
      AND date(tenure_end) BETWEEN date('now') AND date('now','+30 days')
      AND status NOT IN ('TERMINATED','CLOSED','EXPIRED')
  `).get().c;

  // Read from document_versions, where uploads actually land, and only the
  // current version of each — a superseded licence's expiry is history.
  const documentsExpiringSoon = db.prepare(`
    SELECT d.document_type, d.title, v.expiry_date, e.name AS entity_name,
           CAST(julianday(v.expiry_date) - julianday('now') AS INTEGER) AS days_remaining
    FROM document_versions v
    JOIN documents d ON d.id = v.document_id
    LEFT JOIN entities e ON e.id = d.entity_id
    WHERE v.expiry_date IS NOT NULL
      AND v.version_number = (SELECT MAX(version_number) FROM document_versions WHERE document_id = d.id)
      AND date(v.expiry_date) <= date('now','+60 days')
    ORDER BY v.expiry_date
  `).all();

  res.json({
    kpis: {
      activeContracts, contractedCapacity, energySupplied, billedEnergy,
      pendingApprovals, pendingInvoiceApprovals, pendingDisputes, reconciliationExceptions, expiringSecurities,
      activeSellers, activeBuyers, pendingEntityApprovals,
      contractsNearingExpiry, documentsExpiringSoon: documentsExpiringSoon.length,
      totalInvoices: totalInvoices.c, totalInvoiceValue: totalInvoices.s,
      receivables, payables, paymentsReceived, paymentsDisbursed, overdue,
    },
    byStatus, contractsByStatus, byProjectType, monthlyBilling,
    documentsExpiring: documentsExpiringSoon,
  });
});

// Mock integration health for Trading Dashboard
router.get('/trading/health', (req, res) => {
  // Simulating API integration health
  res.json({
    status: 'ONLINE',
    last_sync: new Date().toISOString(),
    exchanges: {
      IEX: { status: 'ONLINE', delay_ms: 120 },
      PXIL: { status: 'ONLINE', delay_ms: 150 },
      HPX: { status: 'DELAYED', delay_ms: 8500 }
    }
  });
});

// 1. Real-Time / Intraday View
export function buildTradingRealtime() {
  // Open positions (bids submitted but not cleared/rejected)
  const openBids = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(quantum_mw),0) q FROM bids WHERE status IN ('SUBMITTED', 'DRAFT')`).get();
  
  // Limits vs utilisation, valued the same way the limit check in bids.js
  // values it. This query used to carry its own MW x price formula, which is
  // not money and disagreed with what enforcement actually blocks on.
  const clientLimits = db.prepare(`
    SELECT id, name, exposure_limit FROM trading_clients WHERE status = 'ACTIVE'
  `).all().map((c) => ({
    name: c.name,
    exposure_limit: c.exposure_limit,
    utilized: Math.round(utilizedExposure(c.id)),
  }));

  // Exchange wise open positions
  const exchangeExposure = db.prepare(`
    SELECT exchange, COUNT(*) as bid_count, COALESCE(SUM(quantum_mw),0) as total_mw
    FROM bids WHERE status IN ('SUBMITTED', 'PARTIALLY_CLEARED')
    GROUP BY exchange
  `).all();

  // Latest recorded market clearing price per exchange. This used to be three
  // hardcoded numbers, which is fine on a demo screen but cannot go into a
  // report — a stated rate has to be traceable to a record.
  const latestRates = db.prepare(`
    SELECT exchange, ROUND(AVG(mcp_rate), 2) rate, MAX(rate_date) as_of
    FROM market_rates
    WHERE rate_date = (SELECT MAX(rate_date) FROM market_rates)
    GROUP BY exchange
  `).all();

  return {
    open_positions: { count: openBids.c, quantum_mw: openBids.q },
    client_limits: clientLimits,
    exchange_exposure: exchangeExposure,
    live_rates: Object.fromEntries(latestRates.map((r) => [r.exchange, r.rate])),
    rates_as_of: latestRates[0]?.as_of || null,
  };
}
router.get('/trading/realtime', (_req, res) => res.json(buildTradingRealtime()));

// 2. Daily / Settlement View
export function buildTradingDaily() {
  // Today's summary
  const totalBids = db.prepare(`SELECT COUNT(*) c FROM bids WHERE date(created_at) = date('now')`).get().c;
  const clearedBids = db.prepare(`SELECT COUNT(*) c FROM bids WHERE status IN ('CLEARED','PARTIALLY_CLEARED') AND date(created_at) = date('now')`).get().c;
  
  const quantumBid = db.prepare(`SELECT COALESCE(SUM(quantum_mw),0) s FROM bids WHERE date(created_at) = date('now')`).get().s;
  const quantumCleared = db.prepare(`SELECT COALESCE(SUM(cleared_quantum_mw),0) s FROM bids WHERE date(created_at) = date('now')`).get().s;
  
  const clearRatio = totalBids > 0 ? (clearedBids / totalBids) * 100 : 0;

  const realizedPl = db.prepare(`SELECT COALESCE(SUM(trading_margin),0) s FROM trading_invoices WHERE status = 'PAID' AND date(created_at) = date('now')`).get().s;
  // Gain against the bid price on what cleared today, valued as energy. This
  // was quantum_mw * 0.05 — a flat assumed margin, not a measurement.
  const unrealizedPl = db.prepare(`
    SELECT COALESCE(SUM(blk.cleared_quantum_mw * 1000 * 0.25 * (blk.cleared_price - blk.price_per_unit)), 0) s
    FROM bids b JOIN bid_blocks blk ON b.id = blk.bid_id
    WHERE blk.cleared_quantum_mw > 0 AND date(b.created_at) = date('now')
  `).get().s;

  const rejectedBids = db.prepare(`SELECT status, COUNT(*) c FROM bids WHERE status IN ('REJECTED', 'NO_BID') AND date(created_at) = date('now') GROUP BY status`).all();

  return {
    daily_summary: { totalBids, clearedBids, quantumBid, quantumCleared, clearRatio },
    pnl: { realized: realizedPl, unrealized: Math.round(unrealizedPl) },
    rejected_analysis: rejectedBids,
  };
}
router.get('/trading/daily', (_req, res) => res.json(buildTradingDaily()));

// 3. Periodic / Trend View
export function buildTradingPeriodic() {
  // Monthly volume trend
  const volumeTrend = db.prepare(`
    SELECT strftime('%Y-%m', bid_date) as month, COALESCE(SUM(quantum_mw),0) as bid_mw, COALESCE(SUM(cleared_quantum_mw),0) as cleared_mw
    FROM bids GROUP BY month ORDER BY month DESC LIMIT 6
  `).all();

  // Client-wise margin. The invoice ledger holds no records, so the invoiced
  // margin reads zero for every client; fall back to the contracted bilateral
  // margin, which is what the Profitability report measures.
  const clientProfitability = db.prepare(`
    SELECT tc.id, tc.name as client_name, COALESCE(SUM(ti.trading_margin),0) as total_margin
    FROM trading_clients tc
    LEFT JOIN trading_invoices ti ON ti.client_id = tc.id
    GROUP BY tc.id
  `).all().map((c) => {
    if (c.total_margin) return { client_name: c.client_name, total_margin: c.total_margin, basis: 'Invoiced' };
    const contracted = db.prepare(`
      SELECT COALESCE(SUM(
        quantum_mw * 1000 * 24 * (julianday(end_date) - julianday(start_date) + 1)
        * (tariff_per_unit - COALESCE(purchase_rate_per_unit, tariff_per_unit))
      ), 0) m
      FROM bilateral_transactions WHERE client_id = ? AND status != 'CANCELLED'
    `).get(c.id).m;
    return { client_name: c.client_name, total_margin: Math.round(contracted), basis: 'Contracted' };
  }).sort((a, b) => b.total_margin - a.total_margin).slice(0, 5);

  // Product wise
  const byProduct = db.prepare(`
    SELECT product, COALESCE(SUM(cleared_quantum_mw),0) as cleared_mw
    FROM bids WHERE status IN ('CLEARED', 'PARTIALLY_CLEARED') GROUP BY product
  `).all();

  return {
    volume_trend: volumeTrend.reverse(),
    client_profitability: clientProfitability,
    product_mix: byProduct,
  };
}
router.get('/trading/periodic', (_req, res) => res.json(buildTradingPeriodic()));

// 3C. Consolidated Executive Dashboard
// Cross-vertical portfolio rollup, shared by the executive dashboard and the
// Internal MIS report so both quote identical figures.
export function buildConsolidatedPortfolio() {
  // 1. Single Source of Truth Aggregations
  const reiaReceivables = receivablesOutstanding();
  const reiaPayables = payablesOutstanding();
  const reiaOverdue = overdueReceivable();
  
  const reiaContractedCapacity = db.prepare(`SELECT COALESCE(SUM(capacity_mw),0) s FROM contracts WHERE status = 'ACTIVE'`).get().s;
  const reiaBilledValue = db.prepare(`SELECT COALESCE(SUM(total_amount),0) s FROM invoices`).get().s;
  const reiaDisputedAmount = db.prepare(`SELECT COALESCE(SUM(disputed_amount),0) s FROM disputes WHERE status NOT IN ('CLOSED', 'RESOLVED_ACCEPTED', 'RESOLVED_REJECTED')`).get().s;
  const reiaOpenDisputes = db.prepare(`SELECT COUNT(*) c FROM disputes WHERE status NOT IN ('CLOSED', 'RESOLVED_ACCEPTED', 'RESOLVED_REJECTED')`).get().c;
  const reiaReconExceptions = db.prepare(`SELECT COUNT(*) c FROM reconciliations WHERE status IN ('NEEDS_REVIEW','DISPUTED','REOPENED')`).get().c;

  const tradingRevenue = db.prepare(`SELECT COALESCE(SUM(total_amount),0) s FROM trading_invoices`).get().s;
  const tradingMargin = db.prepare(`SELECT COALESCE(SUM(trading_margin),0) s FROM trading_invoices`).get().s;
  const tradingOutstanding = db.prepare(`SELECT COALESCE(SUM(total_amount),0) s FROM trading_invoices WHERE status NOT IN ('PAID','SETTLED_VIA_NETTING')`).get().s;
  const tradingClearedQuantum = db.prepare(`SELECT COALESCE(SUM(cleared_quantum_mw),0) s FROM bids`).get().s;

  const activeSecurityAmount = db.prepare(`SELECT COALESCE(SUM(limit_amount),0) s FROM payment_security WHERE status IN ('ACTIVE', 'PARTIALLY_UTILIZED', 'RENEWED')`).get().s;

  // 2. Data Completeness Indicator
  const totalEnergyRecords = db.prepare(`SELECT COUNT(*) c FROM energy_data`).get().c;
  const lockedEnergyRecords = db.prepare(`SELECT COUNT(*) c FROM energy_data WHERE status = 'LOCKED'`).get().c;
  const dataCompleteness = totalEnergyRecords > 0 ? Math.round((lockedEnergyRecords / totalEnergyRecords) * 100) : 100;

  // 3. Trend View (MoM)
  // Simplified approximation: compare current month with previous month based on created_at
  const currMonthInvoices = db.prepare(`SELECT COALESCE(SUM(total_amount),0) s FROM invoices WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`).get().s;
  const prevMonthInvoices = db.prepare(`SELECT COALESCE(SUM(total_amount),0) s FROM invoices WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', '-1 month')`).get().s;
  const revenueTrend = prevMonthInvoices > 0 ? ((currMonthInvoices - prevMonthInvoices) / prevMonthInvoices) * 100 : 0;

  // 4. Cross-Module Risk Rollup
  const totalUnresolvedExposure = reiaDisputedAmount + tradingOutstanding + reiaOverdue;
  const coverageRatio = totalUnresolvedExposure > 0 ? (activeSecurityAmount / totalUnresolvedExposure) * 100 : 100;

  // Same basis as the Financial & Profitability report, so management is not
  // shown two different numbers for the same thing. trading_invoices carries no
  // records, so the invoiced margin alone reads zero however much has traded.
  const overallProfitability = tradingMargin || buildTradingProfitabilitySummary().net_margin;
  const totalPortfolioValue = reiaBilledValue + tradingRevenue;

  // 5. Executive Summary Generation
  let summary = `Portfolio capacity stands at ${reiaContractedCapacity} MW towards the 20 GW goal. `;
  if (revenueTrend > 0) summary += `Billing is up ${revenueTrend.toFixed(1)}% MoM. `;
  else if (revenueTrend < 0) summary += `Billing is down ${Math.abs(revenueTrend).toFixed(1)}% MoM. `;
  
  if (totalUnresolvedExposure > 500000) summary += `Attention required: High unresolved exposure of ₹${(totalUnresolvedExposure/1e7).toFixed(2)} Cr across modules. `;
  else summary += `Financial exposure is well contained within limits.`;

  return {
    reiaContractedCapacity,
    reiaBilledValue,
    reiaReceivables,
    reiaPayables,
    reiaOverdue,
    reiaDisputedAmount,
    reiaOpenDisputes,
    reiaReconExceptions,
    tradingRevenue,
    tradingMargin,
    tradingOutstanding,
    tradingClearedQuantum,
    overallProfitability,
    totalPortfolioValue,
    totalUnresolvedExposure,
    coverageRatio,
    dataCompleteness,
    revenueTrend,
    executiveSummary: summary,
    targetCapacity: 20000, // 20 GW target
  };
}

router.get('/consolidated', requireRole(...EXECUTIVE_ROLES), (req, res) => {
  res.json({ portfolio: buildConsolidatedPortfolio() });
});

export default router;
