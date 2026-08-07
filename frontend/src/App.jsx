import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { ROLE_GROUPS, isSellerRole, isBuyerRole, isTradingClientRole } from './roles.js';
import { useAuth } from './context/AuthContext.jsx';

const Login = lazy(() => import('./pages/Login.jsx'));
const ConsolidatedDashboard = lazy(() => import('./pages/ConsolidatedDashboard.jsx'));

const ReiaDashboard = lazy(() => import('./pages/reia/ReiaDashboard.jsx'));
const HomeDashboard = lazy(() => import('./pages/trading/HomeDashboard.jsx'));
const Entities = lazy(() => import('./pages/reia/Entities.jsx'));
const Contracts = lazy(() => import('./pages/reia/Contracts.jsx'));
const EnergyData = lazy(() => import('./pages/reia/EnergyData.jsx'));
const Invoices = lazy(() => import('./pages/reia/Invoices.jsx'));
const Team = lazy(() => import('./pages/shared/Team.jsx'));
const MyDocuments = lazy(() => import('./pages/shared/MyDocuments.jsx'));
const Disputes = lazy(() => import('./pages/reia/Disputes.jsx'));
const PaymentSecurity = lazy(() => import('./pages/reia/PaymentSecurity.jsx'));
const Reconciliation = lazy(() => import('./pages/reia/Reconciliation.jsx'));
const Reports = lazy(() => import('./pages/reia/Reports.jsx'));
const DeviationSettlements = lazy(() => import('./pages/reia/DeviationSettlements.jsx'));
const PowerDiversion = lazy(() => import('./pages/reia/PowerDiversion.jsx'));

const TradingDashboard = lazy(() => import('./pages/trading/TradingDashboard.jsx'));
const TradingClients = lazy(() => import('./pages/trading/TradingClients.jsx'));
const TradingClientProfile = lazy(() => import('./pages/trading/TradingClientProfile.jsx'));
const Bids = lazy(() => import('./pages/trading/Bids.jsx'));
const DayAheadMarketEngine = lazy(() => import('./pages/trading/DayAheadMarketEngine.jsx'));
const PreTradeBoard = lazy(() => import('./pages/trading/PreTradeBoard.jsx'));
const Bilateral = lazy(() => import('./pages/trading/Bilateral.jsx'));
const BillingSettlement = lazy(() => import('./pages/trading/BillingSettlement.jsx'));
const GeneratorBilling = lazy(() => import('./pages/trading/GeneratorBilling.jsx'));
const MarketAnalytics = lazy(() => import('./pages/trading/MarketAnalytics.jsx'));
const NOARWallet = lazy(() => import('./pages/trading/NOARWallet.jsx'));
const NOARRegistry = lazy(() => import('./pages/trading/NOARRegistry.jsx'));
const CERCFormIV = lazy(() => import('./pages/trading/CERCFormIV.jsx'));
const BulkCommunications = lazy(() => import('./pages/trading/BulkCommunications.jsx'));
const InboxMailList = lazy(() => import('./pages/trading/InboxMailList.jsx'));
const CertificateOperationsHub = lazy(() => import('./pages/trading/CertificateOperationsHub.jsx'));
const TAMManagement = lazy(() => import('./pages/trading/TAMManagement.jsx'));
const BankTransactionsList = lazy(() => import('./pages/trading/BankTransactionsList.jsx'));
const EnergySchedule = lazy(() => import('./pages/trading/EnergySchedule.jsx'));
const EnergyScheduleArchive = lazy(() => import('./pages/trading/EnergyScheduleArchive.jsx'));
const DailyObligationReport = lazy(() => import('./pages/trading/DailyObligationReport.jsx'));
const RateMaster = lazy(() => import('./pages/trading/RateMaster.jsx'));
const TDSRegister = lazy(() => import('./pages/trading/TDSRegister.jsx'));
const OAChargeCalculator = lazy(() => import('./pages/trading/OAChargeCalculator.jsx'));
const DeviationRegister = lazy(() => import('./pages/trading/DeviationRegister.jsx'));
const PaymentCycle = lazy(() => import('./pages/trading/PaymentCycle.jsx'));
const ContractPnl = lazy(() => import('./pages/trading/ContractPnl.jsx'));
const LedgerImport = lazy(() => import('./pages/trading/LedgerImport.jsx'));
const MarginAssurance = lazy(() => import('./pages/trading/MarginAssurance.jsx'));
const OAReconciliation = lazy(() => import('./pages/trading/OAReconciliation.jsx'));

const SellerDashboard = lazy(() => import('./pages/seller/SellerDashboard.jsx'));
const SellerContracts = lazy(() => import('./pages/seller/SellerContracts.jsx'));
const SellerEnergyData = lazy(() => import('./pages/seller/SellerEnergyData.jsx'));
const SellerInvoices = lazy(() => import('./pages/seller/SellerInvoices.jsx'));
const SellerPayments = lazy(() => import('./pages/seller/SellerPayments.jsx'));
const SellerDisputes = lazy(() => import('./pages/seller/SellerDisputes.jsx'));
const SellerReconciliation = lazy(() => import('./pages/seller/SellerReconciliation.jsx'));
const SellerPaymentSecurity = lazy(() => import('./pages/seller/SellerPaymentSecurity.jsx'));

const BuyerDashboard = lazy(() => import('./pages/buyer/BuyerDashboard.jsx'));
const BuyerContracts = lazy(() => import('./pages/buyer/BuyerContracts.jsx'));
const BuyerEnergyData = lazy(() => import('./pages/buyer/BuyerEnergyData.jsx'));
const BuyerInvoices = lazy(() => import('./pages/buyer/BuyerInvoices.jsx'));
const BuyerPayments = lazy(() => import('./pages/buyer/BuyerPayments.jsx'));
const BuyerDisputes = lazy(() => import('./pages/buyer/BuyerDisputes.jsx'));
const BuyerReconciliation = lazy(() => import('./pages/buyer/BuyerReconciliation.jsx'));
const BuyerPaymentSecurity = lazy(() => import('./pages/buyer/BuyerPaymentSecurity.jsx'));

const AuditLogs = lazy(() => import('./pages/AuditLogs.jsx'));
const MastersHub = lazy(() => import('./pages/masters/MastersHub.jsx'));
const NotificationBoard = lazy(() => import('./pages/NotificationBoard.jsx'));
const PortfolioRegistry = lazy(() => import('./pages/masters/PortfolioRegistry.jsx'));
const UserProfile = lazy(() => import('./pages/settings/UserProfile.jsx'));

// Internal SJVN REIA desk only — counterparties use their own portals below,
// which scope every query to their own entity.
const REIA_ROLES = [...ROLE_GROUPS.REIA_ALL];
const TRADING_INTERNAL_ROLES = [...ROLE_GROUPS.TRADING_ALL];
const TRADING_CLIENT_ROLES = [...ROLE_GROUPS.TRADING_CLIENT_ALL];
const TRADING_COMBINED_ROLES = [...new Set([...TRADING_INTERNAL_ROLES, ...TRADING_CLIENT_ROLES])];
// CERC generator billing sits in the Power Trading nav but is raised by REIA,
// so it needs both — a trading-only guard locked out its own authors.
const GENERATOR_BILLING_ROLES = [...new Set([...TRADING_INTERNAL_ROLES, ...ROLE_GROUPS.REIA_ALL])];
const SELLER_ROLES = [...ROLE_GROUPS.SELLER_ALL, 'SJVN_ADMIN'];
const BUYER_ROLES = [...ROLE_GROUPS.BUYER_ALL, 'SJVN_ADMIN'];
const AUDIT_ROLES = [...ROLE_GROUPS.AUDITOR];
const MASTERS_ROLES = [...ROLE_GROUPS.MASTERS_READ];
const BOARD_ROLES = [...new Set([
  ...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.TRADING_ALL, ...ROLE_GROUPS.TRADING_CLIENT_ALL,
  ...ROLE_GROUPS.SELLER_ALL, ...ROLE_GROUPS.BUYER_ALL,
])];

/**
 * Landing route. The Consolidated Dashboard rolls up financials across every
 * seller, buyer and trading client, so only SJVN top management sees it.
 * Everyone else is sent to the dashboard they actually own — showing them an
 * "access restricted" wall on their own landing page would be a dead end.
 */
function HomeRoute() {
  const { user } = useAuth();
  const role = user?.role;

  if (isSellerRole(role)) return <Navigate to="/seller" replace />;
  if (isBuyerRole(role)) return <Navigate to="/buyer" replace />;
  if (isTradingClientRole(role)) return <Navigate to="/trading/my-profile" replace />;
  if (role === 'TRADING_USER') return <Navigate to="/trading" replace />;
  if (role === 'REIA_USER') return <Navigate to="/reia" replace />;
  if (role === 'COMPLIANCE_AUDITOR') return <Navigate to="/audit-logs" replace />;

  return (
    <ProtectedRoute roles={ROLE_GROUPS.EXECUTIVE}>
      <ConsolidatedDashboard />
    </ProtectedRoute>
  );
}

// Shown while a route's code is being fetched. Routes are code-split, so the
// first visit to a screen downloads only that screen.
function RouteFallback() {
  return (
    <div style={{ padding: 40, color: 'var(--slate-500)', fontSize: 14 }} role="status" aria-live="polite">
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HomeRoute />} />

        <Route path="reia" element={<ProtectedRoute roles={REIA_ROLES}><ReiaDashboard /></ProtectedRoute>} />
        <Route path="reia/entities" element={<ProtectedRoute roles={REIA_ROLES}><Entities /></ProtectedRoute>} />
        <Route path="reia/contracts" element={<ProtectedRoute roles={REIA_ROLES}><Contracts /></ProtectedRoute>} />
        <Route path="reia/energy-data" element={<ProtectedRoute roles={REIA_ROLES}><EnergyData /></ProtectedRoute>} />
        <Route path="reia/invoices" element={<ProtectedRoute roles={REIA_ROLES}><Invoices /></ProtectedRoute>} />
        <Route path="reia/disputes" element={<ProtectedRoute roles={REIA_ROLES}><Disputes /></ProtectedRoute>} />
        <Route path="reia/payment-security" element={<ProtectedRoute roles={REIA_ROLES}><PaymentSecurity /></ProtectedRoute>} />
        <Route path="reia/reconciliation" element={<ProtectedRoute roles={REIA_ROLES}><Reconciliation /></ProtectedRoute>} />
        <Route path="reia/deviation" element={<ProtectedRoute roles={REIA_ROLES}><DeviationSettlements /></ProtectedRoute>} />
        <Route path="reia/power-diversion" element={<ProtectedRoute roles={REIA_ROLES}><PowerDiversion /></ProtectedRoute>} />
        <Route path="reia/reports" element={<ProtectedRoute roles={REIA_ROLES}><Reports /></ProtectedRoute>} />

        {/* Seller Portal */}
        <Route path="seller" element={<ProtectedRoute roles={SELLER_ROLES}><SellerDashboard /></ProtectedRoute>} />
        <Route path="seller/contracts" element={<ProtectedRoute roles={SELLER_ROLES}><SellerContracts /></ProtectedRoute>} />
        <Route path="seller/energy-data" element={<ProtectedRoute roles={SELLER_ROLES}><SellerEnergyData /></ProtectedRoute>} />
        <Route path="seller/invoices" element={<ProtectedRoute roles={SELLER_ROLES}><SellerInvoices /></ProtectedRoute>} />
        <Route path="seller/team" element={<ProtectedRoute roles={SELLER_ROLES}><Team /></ProtectedRoute>} />
        <Route path="seller/documents" element={<ProtectedRoute roles={SELLER_ROLES}><MyDocuments /></ProtectedRoute>} />
        <Route path="seller/payments" element={<ProtectedRoute roles={SELLER_ROLES}><SellerPayments /></ProtectedRoute>} />
        <Route path="seller/disputes" element={<ProtectedRoute roles={SELLER_ROLES}><SellerDisputes /></ProtectedRoute>} />
        <Route path="seller/reconciliation" element={<ProtectedRoute roles={SELLER_ROLES}><SellerReconciliation /></ProtectedRoute>} />
        <Route path="seller/payment-security" element={<ProtectedRoute roles={SELLER_ROLES}><SellerPaymentSecurity /></ProtectedRoute>} />

        {/* Buyer Portal */}
        <Route path="buyer" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerDashboard /></ProtectedRoute>} />
        <Route path="buyer/contracts" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerContracts /></ProtectedRoute>} />
        <Route path="buyer/energy-data" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerEnergyData /></ProtectedRoute>} />
        <Route path="buyer/invoices" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerInvoices /></ProtectedRoute>} />
        <Route path="buyer/team" element={<ProtectedRoute roles={BUYER_ROLES}><Team /></ProtectedRoute>} />
        <Route path="buyer/documents" element={<ProtectedRoute roles={BUYER_ROLES}><MyDocuments /></ProtectedRoute>} />
        <Route path="buyer/payments" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerPayments /></ProtectedRoute>} />
        <Route path="buyer/disputes" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerDisputes /></ProtectedRoute>} />
        <Route path="buyer/reconciliation" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerReconciliation /></ProtectedRoute>} />
        <Route path="buyer/payment-security" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerPaymentSecurity /></ProtectedRoute>} />

        <Route path="trading" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><TradingDashboard /></ProtectedRoute>} />
        <Route path="trading/clients" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><TradingClients /></ProtectedRoute>} />
        <Route path="trading/clients/:id" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><TradingClientProfile /></ProtectedRoute>} />
        <Route path="trading/pre-trade" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><PreTradeBoard /></ProtectedRoute>} />
        <Route path="trading/dam" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><DayAheadMarketEngine marketType="CONVENTIONAL_DAM" /></ProtectedRoute>} />
        <Route path="trading/gdam" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><DayAheadMarketEngine marketType="GREEN_DAM" /></ProtectedRoute>} />
        <Route path="trading/rtm" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><Bids product="RTM" /></ProtectedRoute>} />
        
        {/* Trading Client External specific route */}
        <Route path="trading/home" element={<ProtectedRoute roles={TRADING_CLIENT_ROLES}><HomeDashboard /></ProtectedRoute>} />
        <Route path="trading/my-profile" element={<ProtectedRoute roles={TRADING_CLIENT_ROLES}><TradingClientProfile /></ProtectedRoute>} />
        <Route path="settings/user-profile" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />

        {/* Shared routes between Internal and External */}
        <Route path="trading/bilateral" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><Bilateral /></ProtectedRoute>} />
        <Route path="trading/billing-settlement" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><BillingSettlement /></ProtectedRoute>} />
        {/* Generator billing is written by REIA and read by trading — its guard
            spans both, matching the API's own role set for /api/generator-billing. */}
        <Route path="trading/generator-billing" element={<ProtectedRoute roles={GENERATOR_BILLING_ROLES}><GeneratorBilling /></ProtectedRoute>} />
        <Route path="trading/market-analytics" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><MarketAnalytics /></ProtectedRoute>} />
        
        {/* Internal only */}
        <Route path="trading/margin-assurance" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><MarginAssurance /></ProtectedRoute>} />
        <Route path="trading/oa-reconciliation" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><OAReconciliation /></ProtectedRoute>} />
        <Route path="trading/deviations" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><DeviationRegister /></ProtectedRoute>} />
        <Route path="trading/payment-cycle" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><PaymentCycle /></ProtectedRoute>} />
        <Route path="trading/pnl" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ContractPnl /></ProtectedRoute>} />
        <Route path="trading/ledger-import" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><LedgerImport /></ProtectedRoute>} />
        <Route path="trading/rate-master" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><RateMaster /></ProtectedRoute>} />
        <Route path="trading/tds-register" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><TDSRegister /></ProtectedRoute>} />
        <Route path="trading/oa-calculator" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><OAChargeCalculator /></ProtectedRoute>} />
        <Route path="trading/rec" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><CertificateOperationsHub defaultTab="REC" /></ProtectedRoute>} />
        <Route path="trading/noar" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><NOARWallet /></ProtectedRoute>} />
        <Route path="trading/noar-registry" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><NOARRegistry /></ProtectedRoute>} />
        <Route path="trading/form-iv" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><CERCFormIV /></ProtectedRoute>} />
        <Route path="trading/bulk-communications" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><BulkCommunications /></ProtectedRoute>} />
        <Route path="trading/inbox" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><InboxMailList /></ProtectedRoute>} />
        <Route path="trading/escert" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><CertificateOperationsHub defaultTab="ESCERT" /></ProtectedRoute>} />
        <Route path="trading/tam" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><TAMManagement marketType="TAM" /></ProtectedRoute>} />
        <Route path="trading/gtam" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><TAMManagement marketType="GTAM" /></ProtectedRoute>} />
        <Route path="trading/bank-transactions" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><BankTransactionsList /></ProtectedRoute>} />
        <Route path="trading/energy-schedule" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><EnergySchedule /></ProtectedRoute>} />
        <Route path="trading/schedule-archive" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><EnergyScheduleArchive /></ProtectedRoute>} />
        <Route path="trading/daily-obligation-report" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><DailyObligationReport /></ProtectedRoute>} />

        <Route path="notification-board" element={<ProtectedRoute roles={BOARD_ROLES}><NotificationBoard /></ProtectedRoute>} />
        <Route path="master/portfolio-registry" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><PortfolioRegistry /></ProtectedRoute>} />
        <Route path="masters" element={<ProtectedRoute roles={MASTERS_ROLES}><MastersHub /></ProtectedRoute>} />
        <Route path="audit-logs" element={<ProtectedRoute roles={AUDIT_ROLES}><AuditLogs /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
