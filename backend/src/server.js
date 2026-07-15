import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import entitiesRoutes from './routes/entities.js';
import contractsRoutes from './routes/contracts.js';
import energyDataRoutes from './routes/energyData.js';
import invoicesRoutes from './routes/invoices.js';
import disputesRoutes, { runSlaEscalations } from './routes/disputes.js';
import paymentSecurityRoutes from './routes/paymentSecurity.js';
import reconciliationRoutes, { runScheduledReconciliations } from './routes/reconciliation.js';
import tradingClientsRoutes from './routes/tradingClients.js';
import bidsRoutes from './routes/bids.js';
import bilateralRoutes from './routes/bilateral.js';
import tradingInvoicesRoutes from './routes/tradingInvoices.js';
import marketRatesRoutes from './routes/marketRates.js';
import dashboardRoutes from './routes/dashboard.js';
import sellerDashboardRoutes from './routes/sellerDashboard.js';
import buyerDashboardRoutes from './routes/buyerDashboard.js';
import notificationsRoutes from './routes/notifications.js';
import auditLogsRoutes from './routes/auditLogs.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'sjvn-energy-platform-backend' }));

// Auth
app.use('/api/auth', authRoutes);

// 3A. REIA Billing, Contract and Settlement Management System
app.use('/api/entities', entitiesRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/energy-data', energyDataRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/disputes', disputesRoutes);
app.use('/api/payment-security', paymentSecurityRoutes);
app.use('/api/reconciliation', reconciliationRoutes);

// 3B. Power Trading Management System
app.use('/api/trading-clients', tradingClientsRoutes);
app.use('/api/bids', bidsRoutes);
app.use('/api/bilateral', bilateralRoutes);
app.use('/api/trading-invoices', tradingInvoicesRoutes);
app.use('/api/market-rates', marketRatesRoutes);

// 3C. Management Dashboard & Consolidated MIS + platform services
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/seller-dashboard', sellerDashboardRoutes);
app.use('/api/buyer-dashboard', buyerDashboardRoutes);
app.use('/api/notifications', notificationsRoutes);
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
});
