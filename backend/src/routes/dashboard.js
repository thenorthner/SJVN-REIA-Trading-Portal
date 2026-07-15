import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { OPEN_STATUSES } from '../disputesConstants.js';

const router = Router();
router.use(requireAuth);

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

// Power Trading dashboards
router.get('/trading', (req, res) => {
  const totalBids = db.prepare(`SELECT COUNT(*) c FROM bids`).get().c;
  const clearedBids = db.prepare(`SELECT COUNT(*) c FROM bids WHERE status IN ('CLEARED','PARTIALLY_CLEARED')`).get().c;
  const totalQuantumBid = db.prepare(`SELECT COALESCE(SUM(quantum_mw),0) s FROM bids`).get().s;
  const totalQuantumCleared = db.prepare(`SELECT COALESCE(SUM(cleared_quantum_mw),0) s FROM bids`).get().s;
  const activeClients = db.prepare(`SELECT COUNT(*) c FROM trading_clients WHERE status = 'ACTIVE'`).get().c;
  const activeBilateral = db.prepare(`SELECT COUNT(*) c FROM bilateral_transactions WHERE status = 'ACTIVE'`).get().c;
  const pendingOpenAccess = db.prepare(`SELECT COUNT(*) c FROM bilateral_transactions WHERE open_access_status = 'PENDING'`).get().c;

  const tradingMarginTotal = db.prepare(`SELECT COALESCE(SUM(trading_margin),0) s FROM trading_invoices`).get().s;
  const totalTradingRevenue = db.prepare(`SELECT COALESCE(SUM(total_amount),0) s FROM trading_invoices`).get().s;
  const totalTradingReceived = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM trading_payments`).get().s;

  const byExchange = db.prepare(`
    SELECT exchange, COUNT(*) bids, COALESCE(SUM(quantum_mw),0) quantum, COALESCE(SUM(cleared_quantum_mw),0) cleared
    FROM bids GROUP BY exchange
  `).all();
  const byProduct = db.prepare(`
    SELECT product, COUNT(*) bids, COALESCE(SUM(quantum_mw),0) quantum, COALESCE(SUM(cleared_quantum_mw),0) cleared
    FROM bids GROUP BY product
  `).all();
  const byClient = db.prepare(`
    SELECT tc.name as client_name, COUNT(b.id) bids, COALESCE(SUM(b.cleared_quantum_mw),0) cleared
    FROM trading_clients tc LEFT JOIN bids b ON b.client_id = tc.id GROUP BY tc.id
  `).all();

  res.json({
    kpis: {
      totalBids, clearedBids, totalQuantumBid, totalQuantumCleared, activeClients,
      activeBilateral, pendingOpenAccess, tradingMarginTotal, totalTradingRevenue, totalTradingReceived,
    },
    byExchange, byProduct, byClient,
  });
});

// 3C. Consolidated Executive Dashboard
router.get('/consolidated', (req, res) => {
  const reiaReceivables = db.prepare(`
    SELECT COALESCE(SUM(total_amount),0) s FROM invoices WHERE direction = 'SJVN_TO_BUYER' AND status NOT IN ('PAID','CANCELLED')
  `).get().s;
  const reiaPayables = db.prepare(`
    SELECT COALESCE(SUM(total_amount),0) s FROM invoices WHERE direction = 'SELLER_TO_SJVN' AND status NOT IN ('PAID','CANCELLED')
  `).get().s;
  const reiaContractedCapacity = db.prepare(`SELECT COALESCE(SUM(capacity_mw),0) s FROM contracts WHERE status = 'ACTIVE'`).get().s;
  const reiaBilledValue = db.prepare(`SELECT COALESCE(SUM(total_amount),0) s FROM invoices`).get().s;
  const reiaOpenDisputes = db.prepare(`SELECT COUNT(*) c FROM disputes WHERE status IN (${OPEN_STATUSES.map(() => '?').join(',')})`).get(...OPEN_STATUSES).c;
  const reiaReconExceptions = db.prepare(`SELECT COUNT(*) c FROM reconciliations WHERE status IN ('NEEDS_REVIEW','DISPUTED','REOPENED')`).get().c;

  const tradingRevenue = db.prepare(`SELECT COALESCE(SUM(total_amount),0) s FROM trading_invoices`).get().s;
  const tradingMargin = db.prepare(`SELECT COALESCE(SUM(trading_margin),0) s FROM trading_invoices`).get().s;
  const tradingOutstanding = db.prepare(`SELECT COALESCE(SUM(total_amount),0) s FROM trading_invoices WHERE status != 'PAID'`).get().s;
  const tradingClearedQuantum = db.prepare(`SELECT COALESCE(SUM(cleared_quantum_mw),0) s FROM bids`).get().s;

  const overallProfitability = tradingMargin; // trading margin acts as SJVN's profitability proxy in this demo

  res.json({
    portfolio: {
      reiaContractedCapacity,
      reiaBilledValue,
      reiaReceivables,
      reiaPayables,
      reiaOpenDisputes,
      reiaReconExceptions,
      tradingRevenue,
      tradingMargin,
      tradingOutstanding,
      tradingClearedQuantum,
      overallProfitability,
      totalPortfolioValue: reiaBilledValue + tradingRevenue,
    },
  });
});

export default router;
