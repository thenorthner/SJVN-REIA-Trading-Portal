import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { OPEN_STATUSES } from '../disputesConstants.js';

const router = Router();
router.use(requireAuth);

// Cross-module executive aggregates (every counterparty's financials rolled
// up together). Hiding the nav link is not enough — the endpoint itself must
// reject seller/buyer users, including their L1/L2/L3 sub-users.
const EXECUTIVE_ROLES = ['SJVN_ADMIN', 'MANAGEMENT', 'FINANCE_USER', 'IT_SUPER_ADMIN'];

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

  res.json({
    kpis: {
      activeContracts, contractedCapacity, energySupplied, billedEnergy,
      pendingApprovals, pendingDisputes, reconciliationExceptions, expiringSecurities,
      totalInvoices: totalInvoices.c, totalInvoiceValue: totalInvoices.s,
      receivables, payables, paymentsReceived, paymentsDisbursed, overdue,
    },
    byStatus, byProjectType, monthlyBilling,
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
router.get('/trading/realtime', (req, res) => {
  // Open positions (bids submitted but not cleared/rejected)
  const openBids = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(quantum_mw),0) q FROM bids WHERE status IN ('SUBMITTED', 'DRAFT')`).get();
  
  // Active Limits vs Utilized (simulating utilized from open bids)
  const clientLimits = db.prepare(`
    SELECT tc.name, tc.exposure_limit, COALESCE(SUM(b.quantum_mw * b.price_per_unit), 0) as utilized
    FROM trading_clients tc
    LEFT JOIN bids b ON b.client_id = tc.id AND b.status IN ('SUBMITTED', 'CLEARED')
    WHERE tc.status = 'ACTIVE'
    GROUP BY tc.id
  `).all();

  // Exchange wise open positions
  const exchangeExposure = db.prepare(`
    SELECT exchange, COUNT(*) as bid_count, COALESCE(SUM(quantum_mw),0) as total_mw
    FROM bids WHERE status IN ('SUBMITTED', 'PARTIALLY_CLEARED')
    GROUP BY exchange
  `).all();

  res.json({
    open_positions: { count: openBids.c, quantum_mw: openBids.q },
    client_limits: clientLimits,
    exchange_exposure: exchangeExposure,
    live_rates: { IEX: 4.25, PXIL: 4.10, HPX: 4.30 } // Mock live rates
  });
});

// 2. Daily / Settlement View
router.get('/trading/daily', (req, res) => {
  // Today's summary
  const totalBids = db.prepare(`SELECT COUNT(*) c FROM bids WHERE date(created_at) = date('now')`).get().c;
  const clearedBids = db.prepare(`SELECT COUNT(*) c FROM bids WHERE status IN ('CLEARED','PARTIALLY_CLEARED') AND date(created_at) = date('now')`).get().c;
  
  const quantumBid = db.prepare(`SELECT COALESCE(SUM(quantum_mw),0) s FROM bids WHERE date(created_at) = date('now')`).get().s;
  const quantumCleared = db.prepare(`SELECT COALESCE(SUM(cleared_quantum_mw),0) s FROM bids WHERE date(created_at) = date('now')`).get().s;
  
  const clearRatio = totalBids > 0 ? (clearedBids / totalBids) * 100 : 0;

  // Realized vs Unrealized P&L
  const realizedPl = db.prepare(`SELECT COALESCE(SUM(trading_margin),0) s FROM trading_invoices WHERE status = 'PAID' AND date(created_at) = date('now')`).get().s;
  const unrealizedPl = db.prepare(`SELECT COALESCE(SUM(quantum_mw * 0.05),0) s FROM bids WHERE status = 'CLEARED' AND date(created_at) = date('now')`).get().s; // Assuming 0.05 margin

  // Rejection reasons (Mocked based on NO_BID/REJECTED)
  const rejectedBids = db.prepare(`SELECT status, COUNT(*) c FROM bids WHERE status IN ('REJECTED', 'NO_BID') AND date(created_at) = date('now') GROUP BY status`).all();

  res.json({
    daily_summary: { totalBids, clearedBids, quantumBid, quantumCleared, clearRatio },
    pnl: { realized: realizedPl, unrealized: unrealizedPl },
    rejected_analysis: rejectedBids
  });
});

// 3. Periodic / Trend View
router.get('/trading/periodic', (req, res) => {
  // Monthly volume trend
  const volumeTrend = db.prepare(`
    SELECT strftime('%Y-%m', bid_date) as month, COALESCE(SUM(quantum_mw),0) as bid_mw, COALESCE(SUM(cleared_quantum_mw),0) as cleared_mw
    FROM bids GROUP BY month ORDER BY month DESC LIMIT 6
  `).all();

  // Client-wise profitability (trading margin)
  const clientProfitability = db.prepare(`
    SELECT tc.name as client_name, COALESCE(SUM(ti.trading_margin),0) as total_margin
    FROM trading_clients tc
    LEFT JOIN trading_invoices ti ON ti.client_id = tc.id
    GROUP BY tc.id ORDER BY total_margin DESC LIMIT 5
  `).all();

  // Product wise
  const byProduct = db.prepare(`
    SELECT product, COALESCE(SUM(cleared_quantum_mw),0) as cleared_mw
    FROM bids WHERE status IN ('CLEARED', 'PARTIALLY_CLEARED') GROUP BY product
  `).all();

  res.json({
    volume_trend: volumeTrend.reverse(),
    client_profitability: clientProfitability,
    product_mix: byProduct
  });
});

// 3C. Consolidated Executive Dashboard
router.get('/consolidated', requireRole(...EXECUTIVE_ROLES), (req, res) => {
  // 1. Single Source of Truth Aggregations
  const reiaReceivables = db.prepare(`SELECT COALESCE(SUM(total_amount),0) s FROM invoices WHERE direction = 'SJVN_TO_BUYER' AND status NOT IN ('PAID','CANCELLED')`).get().s;
  const reiaPayables = db.prepare(`SELECT COALESCE(SUM(total_amount),0) s FROM invoices WHERE direction = 'SELLER_TO_SJVN' AND status NOT IN ('PAID','CANCELLED')`).get().s;
  const reiaOverdue = db.prepare(`SELECT COALESCE(SUM(total_amount),0) s FROM invoices WHERE direction = 'SJVN_TO_BUYER' AND status NOT IN ('PAID','CANCELLED') AND due_date < date('now')`).get().s;
  
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

  const overallProfitability = tradingMargin; // Trading margin acts as profitability proxy
  const totalPortfolioValue = reiaBilledValue + tradingRevenue;

  // 5. Executive Summary Generation
  let summary = `Portfolio capacity stands at ${reiaContractedCapacity} MW towards the 20 GW goal. `;
  if (revenueTrend > 0) summary += `Billing is up ${revenueTrend.toFixed(1)}% MoM. `;
  else if (revenueTrend < 0) summary += `Billing is down ${Math.abs(revenueTrend).toFixed(1)}% MoM. `;
  
  if (totalUnresolvedExposure > 500000) summary += `Attention required: High unresolved exposure of ₹${(totalUnresolvedExposure/1e7).toFixed(2)} Cr across modules. `;
  else summary += `Financial exposure is well contained within limits.`;

  res.json({
    portfolio: {
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
      targetCapacity: 20000 // 20 GW target
    },
  });
});

export default router;
