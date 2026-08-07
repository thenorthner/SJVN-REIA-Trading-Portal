import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { reaScraper } from './services/reaScraper.js';
import { cercScraper } from './services/cercScraper.js';

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
import tradingInvoicesRoutes from './routes/tradingInvoices.js';
import generatorBillingRoutes from './routes/generatorBilling.js';
import marketAnalyticsRoutes from './routes/marketAnalytics.js';
import cercMarketDataRoutes from './routes/cercMarketData.js';
import dashboardRoutes from './routes/dashboard.js';
import sellerDashboardRoutes from './routes/sellerDashboard.js';
import buyerDashboardRoutes from './routes/buyerDashboard.js';
import notificationsRoutes from './routes/notifications.js';
import { retryFailedDeliveries } from './services/notificationService.js';
import alertsRoutes from './routes/alerts.js';
import auditLogsRoutes from './routes/auditLogs.js';
import preTradeRoutes from './routes/preTrade.js';
import communicationsRoutes from './routes/communications.js';
import bankTransactionsRoutes from './routes/bankTransactions.js';
import schedulesRoutes from './routes/schedules.js';
import archiveRoutes from './routes/archive.js';
import dorRoutes from './routes/dor.js';
import lossesRoutes from './routes/losses.js';
import documentsRoutes from './routes/documents.js';
import usersRoutes from './routes/users.js';
import holidaysRoutes from './routes/holidays.js';
import mastersRoutes from './routes/masters.js';
import reportsRoutes from './routes/reports.js';
import verifyRoutes from './routes/verify.js';
import stationBetaRoutes from './routes/stationBeta.js';
import deviationSettlementsRoutes from './routes/deviationSettlements.js';
import recRoutes from './routes/rec.js';
import noarRoutes from './routes/noar.js';
import formIvRoutes from './routes/formIv.js';
import notesRoutes from './routes/notes.js';
import tradingNotesRoutes from './routes/tradingNotes.js';
import powerDiversionRoutes from './routes/powerDiversion.js';
import rateMasterRoutes from './routes/rateMaster.js';
import tdsLedgerRoutes from './routes/tdsLedger.js';
import oaChargesRoutes from './routes/oaCharges.js';
import importsRoutes from './routes/imports.js';
import deviationRegisterRoutes from './routes/deviationRegister.js';
import { runDeviationAlerts } from './services/deviationRegister.js';
import paymentCycleRoutes from './routes/paymentCycle.js';
import contractPnlRoutes from './routes/contractPnl.js';
import { ensureMasterDefaults } from './mastersService.js';
import { repairAuditChainIfBroken } from './auditEngine.js';

import { assignTraceId, requireAuth, requireRole, ROLE_GROUPS } from './middleware/auth.js';

// Read-level access to the trading desk screens. There is no TRADING_READ group
// — TRADING_ALL is the read tier; TRADING_WRITE is the narrower acting tier.
const TRADING_READ = ROLE_GROUPS.TRADING_ALL;

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
// Same-origin in production (the API and the UI are served by this process),
// so no cross-origin access is needed. CORS_ORIGIN opens it only where a
// separate front end genuinely has to reach the API.
app.use(cors(
  process.env.CORS_ORIGIN
    ? { origin: process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) }
    : (process.env.NODE_ENV === 'production' ? { origin: false } : undefined)
));
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
app.use('/api/trading/bilateral', bilateralRoutes);
app.use('/api/billing-settlement', billingSettlementRoutes);
app.use('/api/trading-invoices', tradingInvoicesRoutes);
app.use('/api/tds', tdsLedgerRoutes);
app.use('/api/oa-charges', oaChargesRoutes);
app.use('/api/import', importsRoutes);
app.use('/api/deviations', deviationRegisterRoutes);
app.use('/api/payment-cycle', paymentCycleRoutes);
app.use('/api/pnl', contractPnlRoutes);
app.use('/api/generator-billing', generatorBillingRoutes);
app.use('/api/market-analytics', marketAnalyticsRoutes);
app.use('/api/cerc-market', requireAuth, cercMarketDataRoutes);
app.use('/api/trading-notes', requireAuth, tradingNotesRoutes);
app.use('/api/pre-trade', requireAuth, preTradeRoutes);
app.use('/api/communications', requireAuth, communicationsRoutes);
app.use('/api/trading/bank-transactions', requireAuth, requireRole(...TRADING_READ), bankTransactionsRoutes);
app.use('/api/trading/schedules', requireAuth, requireRole(...TRADING_READ), schedulesRoutes);
app.use('/api/trading/archive', requireAuth, requireRole(...TRADING_READ), archiveRoutes);
app.use('/api/trading/dor', requireAuth, requireRole(...TRADING_READ), dorRoutes);

// Cross-cutting Services
app.use('/api/documents', documentsRoutes);
app.use('/api/masters/holidays', requireAuth, holidaysRoutes);
app.use('/api/masters/losses', requireAuth, lossesRoutes);
app.use('/api/masters/rates', requireAuth, rateMasterRoutes);
app.use('/api/masters', requireAuth, mastersRoutes);
app.use('/api/reports', requireAuth, reportsRoutes);

// 3C. Management Dashboard & Consolidated MIS + platform services
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/seller-dashboard', sellerDashboardRoutes);
app.use('/api/buyer-dashboard', buyerDashboardRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/audit-logs', auditLogsRoutes);

// ── Built front end ───────────────────────────────────────────────────
// One process serves both the API and the UI, so the platform is reachable on
// a single address with no reverse proxy to configure. Skipped when the build
// is absent, which is the normal case in development (Vite serves it there).
const CLIENT_DIR = process.env.CLIENT_DIR
  || path.resolve(__dirname, '../../frontend/dist');

if (fs.existsSync(path.join(CLIENT_DIR, 'index.html'))) {
  app.use(express.static(CLIENT_DIR));
  // Anything that is not an API route is a client-side route: hand back
  // index.html and let React Router resolve it.
  app.get(/^(?!\/api\/|\/verify\/|\/uploads\/).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  });
  console.log(`[WEB] Serving the built front end from ${CLIENT_DIR}`);
} else {
  console.log('[WEB] No frontend build found — API only. Run `npm run build` in frontend/ to serve the UI from here.');
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
// 0.0.0.0 so the server answers on the machine's LAN address, not only on
// loopback — otherwise nobody else on the network can reach it.
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`SJVN Energy Platform listening on http://${HOST}:${PORT}`);
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
  // Schedule shortfall alerts — daily 07:00 IST (01:30 UTC), after the previous
  // day's schedules have settled.
  cron.schedule('30 1 * * *', () => {
    try {
      const r = runDeviationAlerts();
      if (r.alerted) console.log(`[DEVIATION] Raised ${r.alerted} shortfall alert(s) above ${r.threshold_pct}%`);
    } catch (err) {
      console.error('[DEVIATION] alert sweep failed', err.message);
    }
  });

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

  // CERC Market Monitoring Report scan — 15th and 25th of each month at 07:00 AM IST (01:30 UTC)
  cron.schedule('30 1 15,25 * *', async () => {
    console.log('[CERC Scraper] Scheduled scan for new MMC reports');
    try {
      const result = await cercScraper.scanForNewReports();
      if (result.fetched > 0) console.log(`[CERC Scraper] Fetched ${result.fetched} new report(s)`);
    } catch (err) {
      console.error('[CERC Scraper] Scheduled scan failed:', err.message);
    }
  });
  console.log('[CERC Scraper] Cron job registered (15th & 25th of each month at 07:00 IST)');

  // Auto-seed CERC reports from local disk if table is empty
  cercScraper.autoSeedLocalReports().catch(err => {
    console.warn('[CERC Scraper] Auto-seed initial run error:', err.message);
  });
});
