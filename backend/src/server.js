import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
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
import bilateralRoutes, { runNoarSlaAlerts, sendNoarWeeklyDigest, seedBilateralContractSummary } from './routes/bilateral.js';
import billingRoutes from './routes/billing.js';
import exchangeContractsRoutes from './routes/exchangeContracts.js';
import exchangeBiddingRoutes from './routes/exchangeBidding.js';
import bilateralBiddingRoutes from './routes/bilateralBidding.js';
import bilateralApplicationsRoutes, { seedBilateralApplications } from './routes/bilateralApplications.js';
import viewBillInvoicesRoutes, { seedViewBillInvoices } from './routes/viewBillInvoices.js';
import csvUploadsRoutes from './routes/csvUploads.js';
import exchangeBiddingLatestRoutes from './routes/exchangeBiddingLatest.js';
import iexBidBookRoutes from './routes/iexBidBook.js';
import exchangeApplicationsRoutes, { seedExchangeApplications } from './routes/exchangeApplications.js';
import exchangeUpdateChargesRoutes from './routes/exchangeUpdateCharges.js';
import escertOrdersRoutes from './routes/escertOrders.js';
import pxilOrdersRoutes, { seedPxilOrders } from './routes/pxilOrders.js';
import pxilRoutes from './routes/pxil.js';
import iexRoutes from './routes/iex.js';
import isetReportsRoutes, { seedIsetReports } from './routes/isetReports.js';
import recOrdersRoutes, { seedRecOrders } from './routes/recOrders.js';
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
import { getMailConfig } from './services/mailService.js';
import alertsRoutes from './routes/alerts.js';
import auditLogsRoutes from './routes/auditLogs.js';
import sandboxRoutes from './routes/sandbox.js';
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
import dsmChargesRoutes from './routes/dsmCharges.js';
import hydroBillingRoutes from './routes/hydroBilling.js';
import nocUpdationRoutes from './routes/nocUpdation.js';
import clientPortfoliosRoutes from './routes/clientPortfolios.js';
import tdsLedgerRoutes from './routes/tdsLedger.js';
import oaChargesRoutes from './routes/oaCharges.js';
import importsRoutes from './routes/imports.js';
import deviationRegisterRoutes from './routes/deviationRegister.js';
import { runDeviationAlerts } from './services/deviationRegister.js';
import paymentCycleRoutes from './routes/paymentCycle.js';
import contractPnlRoutes from './routes/contractPnl.js';
import marginAssuranceRoutes from './routes/marginAssurance.js';
import energyBankingRoutes from './routes/energyBanking.js';
import { settleExpiredBanking } from './services/energyBanking.js';
import { ensureMasterDefaults } from './mastersService.js';
import { repairAuditChainIfBroken, verifyRecentIntegrity } from './auditEngine.js';
import { db } from './db/index.js';
import { backupDatabase } from './services/dbBackup.js';

import { assignTraceId, requireAuth, requireRole, ROLE_GROUPS } from './middleware/auth.js';

// Read-level access to the trading desk screens. There is no TRADING_READ group
// — TRADING_ALL is the read tier; TRADING_WRITE is the narrower acting tier.
const TRADING_READ = ROLE_GROUPS.TRADING_ALL;

ensureMasterDefaults();

// Retire audit hashes written by the earlier inconsistent hashing logic, so the
// integrity check reflects tamper state rather than a code bug. This runs at
// most once per database and reads nothing at all afterwards — a full
// verification on every boot grew with the audit history until start-up
// outlasted the health check a deploy waits on.
try {
  const r = repairAuditChainIfBroken();
  if (r.rebuilt) console.log(`[AUDIT] Rebuilt ${r.rebuilt} audit hash(es); chain now ${r.nowValid ? 'valid' : 'STILL INVALID'}`);
} catch (err) {
  console.error('[AUDIT] chain repair failed', err.message);
}

// What the boot check costs now: the newest few hundred links, not the whole
// history. It cannot prove the chain back to genesis — the Audit screen's full
// verification does that, on request — but it says whether anything has written
// to the table since this server last ran, which is what is worth knowing here.
try {
  const recent = verifyRecentIntegrity();
  if (!recent.isValid) console.error(`[AUDIT] ${recent.message} — run the full integrity check from the Audit screen.`);
} catch (err) {
  console.error('[AUDIT] recent-chain check failed', err.message);
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
// Before the body parser: a request whose JSON does not parse never reaches
// the routes, and the reply it gets should still name a log line.
app.use(assignTraceId);
app.use(express.json({ limit: '10mb' }));
// `dev` writes ANSI colour codes, which journalctl stores verbatim and every
// later grep has to step over. Deployed logs get the standard Apache line
// instead, which log tooling already knows how to read.
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health is what update.sh watches to decide whether a release came up or has
// to be rolled back, so it has to fail when the platform is unusable — not
// merely when the process is dead. Express answering while the database is
// locked, missing or corrupt is exactly the state a deploy must not be told is
// fine, so the check reads a row rather than returning a constant.
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
  } catch (err) {
    console.error('[HEALTH] database unreachable:', err.message);
    return res.status(503).json({
      status: 'degraded',
      service: 'sjvn-energy-platform-backend',
      error: 'database unavailable',
    });
  }
  res.json({
    status: 'ok',
    service: 'sjvn-energy-platform-backend',
    uptime_seconds: Math.floor(process.uptime()),
  });
});

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
app.use('/api/billing', billingRoutes);
app.use('/api/bilateral', bilateralRoutes);
app.use('/api/trading/bilateral', bilateralRoutes);
app.use('/api/exchange-contracts', exchangeContractsRoutes);
app.use('/api/exchange-bidding', exchangeBiddingRoutes);
app.use('/api/bilateral-bidding', bilateralBiddingRoutes);
app.use('/api/bilateral-applications', bilateralApplicationsRoutes);
app.use('/api/view-bill-invoices', viewBillInvoicesRoutes);
app.use('/api/csv-uploads', csvUploadsRoutes);
app.use('/api/exchange-bidding-latest', exchangeBiddingLatestRoutes);
app.use('/api/iex-bid-book', iexBidBookRoutes);
app.use('/api/exchange-applications', exchangeApplicationsRoutes);
app.use('/api/exchange-update-charges', exchangeUpdateChargesRoutes);
app.use('/api/escert-orders', escertOrdersRoutes);
app.use('/api/pxil-orders', pxilOrdersRoutes);
app.use('/api/pxil', pxilRoutes);
app.use('/api/iex', iexRoutes);
app.use('/api/iset-reports', isetReportsRoutes);
app.use('/api/rec-trading', recOrdersRoutes);
app.use('/api/billing-settlement', billingSettlementRoutes);
app.use('/api/trading-invoices', tradingInvoicesRoutes);
app.use('/api/tds', tdsLedgerRoutes);
app.use('/api/oa-charges', oaChargesRoutes);
app.use('/api/import', importsRoutes);
app.use('/api/deviations', deviationRegisterRoutes);
app.use('/api/payment-cycle', paymentCycleRoutes);
app.use('/api/pnl', contractPnlRoutes);
app.use('/api/margin', marginAssuranceRoutes);
app.use('/api/energy-banking', requireAuth, energyBankingRoutes);
app.use('/api/generator-billing', generatorBillingRoutes);
app.use('/api/hydro-billing', hydroBillingRoutes);
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
app.use('/api/masters/dsm', requireAuth, dsmChargesRoutes);
app.use('/api/noc-updation', requireAuth, nocUpdationRoutes);
app.use('/api/client-portfolios', requireAuth, clientPortfoliosRoutes);
app.use('/api/masters', requireAuth, mastersRoutes);
app.use('/api/reports', requireAuth, reportsRoutes);

// 3C. Management Dashboard & Consolidated MIS + platform services
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/seller-dashboard', sellerDashboardRoutes);
app.use('/api/buyer-dashboard', buyerDashboardRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/audit-logs', auditLogsRoutes);
// Date-shifting for tests. The router 404s itself unless SJVN_SANDBOX is set.
app.use('/api/sandbox', sandboxRoutes);

// ── Built front end ───────────────────────────────────────────────────
// One process serves both the API and the UI, so the platform is reachable on
// a single address with no reverse proxy to configure. Skipped when the build
// is absent, which is the normal case in development (Vite serves it there).
const CLIENT_DIR = process.env.CLIENT_DIR
  || path.resolve(__dirname, '../../frontend/dist');

if (fs.existsSync(path.join(CLIENT_DIR, 'index.html'))) {
  // Asset filenames carry a content hash, so they can be cached hard. index.html
  // must not be: it is the file that names the current hashes, and a cached copy
  // is what makes a tab ask for chunks a redeploy has already removed
  // ("Failed to fetch dynamically imported module").
  app.use(express.static(CLIENT_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  // A hashed asset that express.static did not find is gone, not a page. Handing
  // back index.html would answer a script request with HTML, which is what turns
  // a stale chunk into an unreadable parse error instead of a plain 404.
  app.get(/^\/assets\//, (req, res) => res.status(404).type('text/plain').send('Not found'));

  // Anything that is not an API route is a client-side route: hand back
  // index.html and let React Router resolve it.
  app.get(/^(?!\/api\/|\/verify\/|\/uploads\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  });
  console.log(`[WEB] Serving the built front end from ${CLIENT_DIR}`);
} else {
  console.log('[WEB] No frontend build found — API only. Run `npm run build` in frontend/ to serve the UI from here.');
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

/**
 * Last-resort error handler.
 *
 * Three things it has to get right, because each of them is a way a live server
 * either falls over or says something it should not:
 *
 *  - A malformed JSON body, or a file above a route's size limit, is the
 *    caller's mistake. Answering 500 tells the operator the platform broke and
 *    sends them looking for a fault that is not there.
 *  - `err.message` on an unexpected failure is a SQL statement or an absolute
 *    path. Deployed, the client gets the trace id and the detail stays in the
 *    journal, where it is still one `grep` away.
 *  - If the response has already begun — a PDF stream that died halfway — there
 *    is no status left to set. Writing one throws inside the handler, and that
 *    throw takes the process down.
 */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const trace = req.traceId || '-';

  if (res.headersSent) {
    console.error(`[ERR ${trace}] after response started:`, err);
    return req.socket?.destroy();
  }

  // Body parser: JSON that does not parse, or a body past the 10mb cap.
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
    return res.status(400).json({ error: 'Malformed JSON body', trace_id: trace });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large', trace_id: trace });
  }

  // Multer: an upload over the route's limit, or one its filter refused.
  if (err.name === 'MulterError') {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({
      error: tooBig ? 'The uploaded file is too large' : `Upload rejected: ${err.message}`,
      trace_id: trace,
    });
  }

  const status = Number(err.status || err.statusCode) || 500;
  console.error(`[ERR ${trace}] ${req.method} ${req.originalUrl}`, err);

  // A status a route chose deliberately carries a message meant for the caller.
  // A 500 did not: it is whatever threw.
  if (status < 500) {
    return res.status(status).json({ error: err.message || 'Request failed', trace_id: trace });
  }
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error — quote the trace id when reporting this.'
      : (err.message || 'Internal server error'),
    trace_id: trace,
  });
});

// Exported so tests can drive the routes without binding a port. Listening and
// the background sweeps are started below, and only when this file is the entry
// point — importing it must not take over port 4000 or start timers.
export { app };

const PORT = process.env.PORT || 4000;
// 0.0.0.0 so the server answers on the machine's LAN address, not only on
// loopback — otherwise nobody else on the network can reach it.
const HOST = process.env.HOST || '0.0.0.0';

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
const server = app.listen(PORT, HOST, () => {
  console.log(`SJVN Energy Platform listening on http://${HOST}:${PORT}`);
  const mail = getMailConfig();
  console.log(mail.configured
    ? `[MAIL] SMTP ${mail.host}:${mail.port} from ${mail.from}`
    : '[MAIL] SMTP not configured — messages written to backend/outbox/');
  try { seedExchangeApplications(); } catch (err) { console.warn('[Exchange Applications] seed failed:', err.message); }
  try { seedRecOrders(); } catch (err) { console.warn('[REC Orders] seed failed:', err.message); }
  try { seedPxilOrders(); } catch (err) { console.warn('[PXIL Orders] seed failed:', err.message); }
  try { seedIsetReports(); } catch (err) { console.warn('[ISET Reports] seed failed:', err.message); }
  try { seedBilateralContractSummary(); } catch (err) { console.warn('[Bilateral Summary] seed failed:', err.message); }
  try { seedBilateralApplications(); } catch (err) { console.warn('[Bilateral Applications] seed failed:', err.message); }
  try { seedViewBillInvoices(); } catch (err) { console.warn('[View Bill Invoices] seed failed:', err.message); }
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
      const r = runStakeholderAlerts();
      // Logged when it does something, so a sweep that has quietly stopped
      // working is distinguishable from one with nothing to do. It threw on
      // every run for as long as it existed and this read as an hourly no-op.
      if (r && Object.values(r).some(Boolean)) {
        console.log(`[STAKEHOLDER] ${r.documents} document(s), ${r.nearingExpiry} nearing expiry, ${r.expired} expired, ${r.slaBreaches} onboarding SLA`);
      }
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
  // Banking cycles that have closed with energy unused settle themselves — daily
  // 02:00 IST (20:30 UTC). A cycle ending with unused energy has to settle
  // whether or not anyone remembers to ask for it.
  cron.schedule('30 20 * * *', () => {
    try {
      const r = settleExpiredBanking();
      if (r.settled) console.log(`[BANKING] Settled ${r.settled} expired banking cycle(s)`);
    } catch (err) {
      console.error('[BANKING] settlement sweep failed', err.message);
    }
  });

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

  // Monthly MIS pack — 1st of every month at 09:00 IST (03:30 UTC), mailed to
  // the executive group with the MIS and REIA dashboard PDFs attached. The log
  // says what happened, including when nothing was sent and why.
  cron.schedule('30 3 1 * *', async () => {
    try {
      const { distributeMonthlyMis } = await import('./services/misDistribution.js');
      const r = await distributeMonthlyMis();
      if (r.sent) {
        console.log(`[MIS-DISTRIBUTION] ${r.period}: sent to ${r.recipients} recipient(s) via ${r.mode} — ${r.attachments.join(', ')}`);
      } else {
        console.warn(`[MIS-DISTRIBUTION] ${r.period}: not sent — ${r.reason || r.error}`);
      }
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

  // ─── Database snapshots ───────────────────────────────────────────────
  // Everything the platform knows lives in one SQLite file, and nothing else in
  // the deployment keeps a second copy. Take one on boot — which is also the
  // moment just after a release ran its migrations, so the snapshot is the
  // pre-upgrade state if the new schema turns out to be wrong — and one a day
  // at 01:00 IST (19:30 UTC), before the settlement sweeps run.
  let warnedSameDisk = false;
  const announceBackup = (r) => {
    if (r.skipped) return;
    console.log(`[BACKUP] ${path.basename(r.file)} (${(r.bytes / 1e6).toFixed(1)} MB)${r.pruned ? `, pruned ${r.pruned}` : ''}`);
    // A copy on the database's own disk survives a bad migration, not a dead
    // disk. Said once per boot, so an install notices without the journal
    // repeating it every night.
    if (r.same_disk && !warnedSameDisk) {
      warnedSameDisk = true;
      console.warn(`[BACKUP] snapshots are on the same disk as the database (${path.dirname(r.file)}) — set SJVN_BACKUP_DIR to a second disk or a mounted share`);
    }
  };
  backupDatabase().then(announceBackup).catch((err) => console.error('[BACKUP] boot snapshot failed:', err.message));
  cron.schedule('30 19 * * *', () => {
    backupDatabase().then(announceBackup).catch((err) => console.error('[BACKUP] daily snapshot failed:', err.message));
  });
});

// ─── Staying up, and going down cleanly ─────────────────────────────────
//
// A rejected promise nobody caught terminates the process by default on Node
// 15 and later. That is the right default for a script and the wrong one for
// this server: one route forgetting a `.catch`, or one scraper losing its
// connection mid-fetch, would take down billing, trading and the dashboards
// along with it. The failure is logged loudly and the other requests continue.
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection — the server is still serving:',
    reason instanceof Error ? reason.stack : reason);
});

// An uncaught synchronous throw is different: it escaped every handler, so the
// state it left behind is unknown and continuing on it is a guess. Log it, then
// hand over to systemd, which restarts within five seconds — a short restart
// beats a process serving from state nobody can describe.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception — restarting:', err.stack || err);
  shutdown('uncaughtException', 1);
});

// systemctl restart (which is what update.sh runs on every release) sends
// SIGTERM. Without a handler the process dies where it stands: replies in
// flight are cut off mid-body, and the WAL is left for the next boot to
// recover. Stop taking new connections, let the open ones finish, checkpoint
// the WAL back into the database, then exit.
let shuttingDown = false;
function shutdown(signal, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SHUTDOWN] ${signal} — finishing in-flight requests`);

  // A client holding a keep-alive connection open would otherwise hold the
  // whole shutdown open with it. Ten seconds is longer than any request here.
  const forced = setTimeout(() => {
    console.warn('[SHUTDOWN] requests did not finish within 10s — exiting anyway');
    closeDbAndExit(code);
  }, 10_000);
  forced.unref();

  server.close(() => {
    clearTimeout(forced);
    closeDbAndExit(code);
  });
}

function closeDbAndExit(code) {
  try {
    // Fold the write-ahead log back into the main file so the next start opens
    // a complete database, and so a backup taken from a stopped server is whole.
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    console.log('[SHUTDOWN] database closed');
  } catch (err) {
    console.error('[SHUTDOWN] closing the database failed:', err.message);
  }
  process.exit(code);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
}
