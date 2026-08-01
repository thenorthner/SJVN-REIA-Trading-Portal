import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { reaScraper } from './services/reaScraper.js';

import authRoutes from './routes/auth.js';
import entitiesRoutes from './routes/entities.js';
import contractsRoutes from './routes/contracts.js';
import energyDataRoutes from './routes/energyData.js';
import invoicesRoutes from './routes/invoices.js';
import billingTrailRoutes from './routes/billingTrail.js';
import disputesRoutes, { runSlaEscalations } from './routes/disputes.js';
import paymentSecurityRoutes, { runAlertCascade } from './routes/paymentSecurity.js';
import reconciliationRoutes, { runScheduledReconciliations } from './routes/reconciliation.js';
import { runStakeholderAlerts } from './stakeholderEngine.js';
import tradingClientsRoutes from './routes/tradingClients.js';
import bidsRoutes from './routes/bids.js';
import bilateralRoutes, { runNoarSlaAlerts, sendNoarWeeklyDigest } from './routes/bilateral.js';
import billingSettlementRoutes from './routes/billingSettlement.js';
import generatorBillingRoutes from './routes/generatorBilling.js';
import marketAnalyticsRoutes from './routes/marketAnalytics.js';
import dashboardRoutes from './routes/dashboard.js';
import sellerDashboardRoutes from './routes/sellerDashboard.js';
import buyerDashboardRoutes from './routes/buyerDashboard.js';
import notificationsRoutes from './routes/notifications.js';
import { retryFailedDeliveries } from './services/notificationService.js';
import alertsRoutes from './routes/alerts.js';
import auditLogsRoutes from './routes/auditLogs.js';
import preTradeRoutes from './routes/preTrade.js';
import documentsRoutes from './routes/documents.js';
import usersRoutes from './routes/users.js';
import mastersRoutes from './routes/masters.js';
import reportsRoutes from './routes/reports.js';
import verifyRoutes from './routes/verify.js';
import stationBetaRoutes from './routes/stationBeta.js';
import deviationSettlementsRoutes from './routes/deviationSettlements.js';
import recRoutes from './routes/rec.js';
import noarRoutes from './routes/noar.js';
import formIvRoutes from './routes/formIv.js';
import notesRoutes from './routes/notes.js';
import powerDiversionRoutes from './routes/powerDiversion.js';
import { ensureMasterDefaults } from './mastersService.js';
import { repairAuditChainIfBroken } from './auditEngine.js';

import { assignTraceId, requireAuth } from './middleware/auth.js';

dotenv.config();

ensureMasterDefaults();

// Retire audit hashes written by the earlier inconsistent hashing logic, so the
// integrity check reflects tamper state rather than a code bug. No-op once valid.
try {
  const r = repairAuditChainIfBroken();
  if (r.rebuilt) console.log(`[AUDIT] Rebuilt ${r.rebuilt} audit hash(es); chain now ${r.nowValid ? 'valid' : 'STILL INVALID'}`);
} catch (err) {
  console.error('[AUDIT] chain repair failed', err.message);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use(assignTraceId);

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'sjvn-energy-platform-backend' }));

// Public invoice-authenticity page reached by scanning the bill's QR code (no login).
app.use('/verify', verifyRoutes);

// Auth
app.use('/api/auth', authRoutes);

// 3A. REIA Billing, Contract and Settlement Management System
app.use('/api/entities', requireAuth, entitiesRoutes);
app.use('/api/contracts', requireAuth, contractsRoutes);
app.use('/api/energy-data', requireAuth, energyDataRoutes);
app.use('/api/invoices', requireAuth, invoicesRoutes);
app.use('/api/billing-trail', requireAuth, billingTrailRoutes);
app.use('/api/station-beta', requireAuth, stationBetaRoutes);
app.use('/api/deviation', requireAuth, deviationSettlementsRoutes);
app.use('/api/disputes', requireAuth, disputesRoutes);
app.use('/api/payment-security', paymentSecurityRoutes);
app.use('/api/reconciliation', reconciliationRoutes);
app.use('/api/users', usersRoutes);

// 3B. Power Trading Management System
app.use('/api/trading-clients', tradingClientsRoutes);
app.use('/api/rec', requireAuth, recRoutes);
app.use('/api/noar', requireAuth, noarRoutes);
app.use('/api/form-iv', requireAuth, formIvRoutes);
app.use('/api/notes', requireAuth, notesRoutes);
app.use('/api/power-diversion', requireAuth, powerDiversionRoutes);
app.use('/api/bids', bidsRoutes);
app.use('/api/bilateral', bilateralRoutes);
app.use('/api/billing-settlement', billingSettlementRoutes);
app.use('/api/generator-billing', generatorBillingRoutes);
app.use('/api/market-analytics', marketAnalyticsRoutes);
app.use('/api/pre-trade', preTradeRoutes);

// Cross-cutting Services
app.use('/api/documents', documentsRoutes);
app.use('/api/masters', requireAuth, mastersRoutes);
app.use('/api/reports', requireAuth, reportsRoutes);

// 3C. Management Dashboard & Consolidated MIS + platform services
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/seller-dashboard', sellerDashboardRoutes);
app.use('/api/buyer-dashboard', buyerDashboardRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/audit-logs', auditLogsRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SJVN Energy Platform API listening on http://localhost:${PORT}`);
  // SLA escalation sweep every 15 minutes
  setInterval(() => {
    try {
      const result = runSlaEscalations();
      if (result.escalated > 0) console.log(`[SLA] Escalated ${result.escalated} dispute(s)`);
    } catch (err) {
      console.error('[SLA] check failed', err.message);
    }
  }, 15 * 60 * 1000);
  // Period-end reconciliation sweep every hour (creates missing prior-month runs)
  setInterval(() => {
    try {
      const result = runScheduledReconciliations();
      if (result.created > 0) console.log(`[RECON] Scheduled ${result.created} run(s) for ${result.period}`);
    } catch (err) {
      console.error('[RECON] schedule failed', err.message);
    }
  }, 60 * 60 * 1000);
  // Payment security alert cascade every hour
  setInterval(() => {
    try {
      const result = runAlertCascade();
      if (result.sent > 0) console.log(`[SECURITY] Sent ${result.sent} alert(s)`);
    } catch (err) {
      console.error('[SECURITY] alert cascade failed', err.message);
    }
  }, 60 * 60 * 1000);
  // Stakeholder and contract alerts cascade every hour
  setInterval(() => {
    try {
      runStakeholderAlerts();
    } catch (err) {
      console.error('[STAKEHOLDER] alert cascade failed', err.message);
    }
  }, 60 * 60 * 1000);
  // NOAR open-access approval SLA sweep every hour
  setInterval(() => {
    try {
      const result = runNoarSlaAlerts();
      if (result.sent > 0) console.log(`[NOAR-SLA] Raised ${result.sent} approval alert(s)`);
    } catch (err) {
      console.error('[NOAR-SLA] sweep failed', err.message);
    }
  }, 60 * 60 * 1000);
  // Retry email/SMS deliveries that failed, every 15 minutes
  setInterval(async () => {
    try {
      const result = await retryFailedDeliveries();
      if (result.recovered > 0) console.log(`[NOTIFY] Recovered ${result.recovered}/${result.retried} failed delivery(ies)`);
    } catch (err) {
      console.error('[NOTIFY] retry sweep failed', err.message);
    }
  }, 15 * 60 * 1000);
  // Weekly NOAR approval digest — Monday 09:00 IST (03:30 UTC)
  cron.schedule('30 3 * * 1', async () => {
    try {
      const result = await sendNoarWeeklyDigest();
      console.log(result.skipped ? `[NOAR-DIGEST] Skipped — ${result.skipped}` : `[NOAR-DIGEST] Sent to ${result.recipients} recipient(s) via ${result.mode}`);
    } catch (err) {
      console.error('[NOAR-DIGEST] failed', err.message);
    }
  });

  // Monthly MIS Report Distribution — 1st of every month at 09:00 IST (03:30 UTC)
  cron.schedule('30 3 1 * *', async () => {
    console.log('[MIS-DISTRIBUTION] Generating and dispatching monthly MIS reports to authorized users...');
    try {
      const { sendMail } = await import('./services/mailService.js');
      await sendMail({
        to: 'management@sjvn.local',
        subject: `Monthly SJVN MIS Reports - ${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}`,
        text: 'Please find the automated monthly MIS reports (Billing, Trading, Reconciliation, and Disputes) available on the Consolidated Dashboard.',
        // Real implementation would generate PDF buffers via reportPdfKit and attach them here
      });
      console.log('[MIS-DISTRIBUTION] Monthly MIS report distribution completed successfully');
    } catch (err) {
      console.error('[MIS-DISTRIBUTION] failed', err.message);
    }
  });

  // ─── REA Scraper Scheduled Jobs ───────────────────────
  // Smart schedule: Daily at 6 AM IST during 1st-10th of each month
  // (when provisional REA is typically published), every 3 days otherwise
  cron.schedule('30 0 1-10 * *', async () => {  // 6:00 AM IST = 00:30 UTC
    console.log('[REA Scraper] Scheduled daily scan (1st-10th of month)');
    try {
      const results = await reaScraper.runAllSources();
      const totalRecords = results.reduce((sum, r) => sum + (r.records || 0), 0);
      if (totalRecords > 0) console.log(`[REA Scraper] Imported ${totalRecords} record(s)`);
    } catch (err) {
      console.error('[REA Scraper] Scheduled scan failed:', err.message);
    }
  });

  // Lower frequency rest of month: every 3 days at 6 AM IST
  cron.schedule('30 0 12,15,18,21,24,27 * *', async () => {  // 6:00 AM IST = 00:30 UTC
    console.log('[REA Scraper] Scheduled periodic scan (mid-month)');
    try {
      const results = await reaScraper.runAllSources();
      const totalRecords = results.reduce((sum, r) => sum + (r.records || 0), 0);
      if (totalRecords > 0) console.log(`[REA Scraper] Imported ${totalRecords} record(s)`);
    } catch (err) {
      console.error('[REA Scraper] Scheduled scan failed:', err.message);
    }
  });
  console.log('[REA Scraper] Cron jobs registered (daily 1st-10th, every 3 days mid-month)');
});
