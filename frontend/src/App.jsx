import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { ROLE_GROUPS, isSellerRole, isBuyerRole, isTradingClientRole } from './roles.js';
import { useAuth } from './context/AuthContext.jsx';

import Login from './pages/Login.jsx';
import ConsolidatedDashboard from './pages/ConsolidatedDashboard.jsx';

import ReiaDashboard from './pages/reia/ReiaDashboard.jsx';
import HomeDashboard from './pages/trading/HomeDashboard.jsx';
import Entities from './pages/reia/Entities.jsx';
import Contracts from './pages/reia/Contracts.jsx';
import EnergyData from './pages/reia/EnergyData.jsx';
import Invoices from './pages/reia/Invoices.jsx';
import Team from './pages/shared/Team.jsx';
import MyDocuments from './pages/shared/MyDocuments.jsx';
import Disputes from './pages/reia/Disputes.jsx';
import PaymentSecurity from './pages/reia/PaymentSecurity.jsx';
import Reconciliation from './pages/reia/Reconciliation.jsx';
import Reports from './pages/reia/Reports.jsx';
import DeviationSettlements from './pages/reia/DeviationSettlements.jsx';
import PowerDiversion from './pages/reia/PowerDiversion.jsx';

import TradingDashboard from './pages/trading/TradingDashboard.jsx';
import TradingClients from './pages/trading/TradingClients.jsx';
import TradingClientProfile from './pages/trading/TradingClientProfile.jsx';
import Bids from './pages/trading/Bids.jsx';
import DayAheadMarketEngine from './pages/trading/DayAheadMarketEngine.jsx';
import PreTradeBoard from './pages/trading/PreTradeBoard.jsx';
import Bilateral from './pages/trading/Bilateral.jsx';
import BillingSettlement from './pages/trading/BillingSettlement.jsx';
import GeneratorBilling from './pages/trading/GeneratorBilling.jsx';
import MarketAnalytics from './pages/trading/MarketAnalytics.jsx';
import RECManagement from './pages/trading/RECManagement.jsx';
import NOARWallet from './pages/trading/NOARWallet.jsx';
import NOARRegistry from './pages/trading/NOARRegistry.jsx';
import CERCFormIV from './pages/trading/CERCFormIV.jsx';
import BulkCommunications from './pages/trading/BulkCommunications.jsx';
import InboxMailList from './pages/trading/InboxMailList.jsx';
import CertificateOperationsHub from './pages/trading/CertificateOperationsHub.jsx';
import TAMManagement from './pages/trading/TAMManagement.jsx';
import BankTransactionsList from './pages/trading/BankTransactionsList.jsx';
import EnergySchedule from './pages/trading/EnergySchedule.jsx';
import EnergyScheduleArchive from './pages/trading/EnergyScheduleArchive.jsx';
import DailyObligationReport from './pages/trading/DailyObligationReport.jsx';
import RateMaster from './pages/trading/RateMaster.jsx';
import TDSRegister from './pages/trading/TDSRegister.jsx';
import OAChargeCalculator from './pages/trading/OAChargeCalculator.jsx';
import DeviationRegister from './pages/trading/DeviationRegister.jsx';
import PaymentCycle from './pages/trading/PaymentCycle.jsx';
import ContractPnl from './pages/trading/ContractPnl.jsx';
import LedgerImport from './pages/trading/LedgerImport.jsx';

import SellerDashboard from './pages/seller/SellerDashboard.jsx';
import SellerContracts from './pages/seller/SellerContracts.jsx';
import SellerEnergyData from './pages/seller/SellerEnergyData.jsx';
import SellerInvoices from './pages/seller/SellerInvoices.jsx';
import SellerPayments from './pages/seller/SellerPayments.jsx';
import SellerDisputes from './pages/seller/SellerDisputes.jsx';
import SellerReconciliation from './pages/seller/SellerReconciliation.jsx';
import SellerPaymentSecurity from './pages/seller/SellerPaymentSecurity.jsx';

import BuyerDashboard from './pages/buyer/BuyerDashboard.jsx';
import BuyerContracts from './pages/buyer/BuyerContracts.jsx';
import BuyerEnergyData from './pages/buyer/BuyerEnergyData.jsx';
import BuyerInvoices from './pages/buyer/BuyerInvoices.jsx';
import BuyerPayments from './pages/buyer/BuyerPayments.jsx';
import BuyerDisputes from './pages/buyer/BuyerDisputes.jsx';
import BuyerReconciliation from './pages/buyer/BuyerReconciliation.jsx';
import BuyerPaymentSecurity from './pages/buyer/BuyerPaymentSecurity.jsx';

import AuditLogs from './pages/AuditLogs.jsx';
import MastersHub from './pages/masters/MastersHub.jsx';
import NotificationBoard from './pages/NotificationBoard.jsx';
import PortfolioRegistry from './pages/masters/PortfolioRegistry.jsx';
import UserProfile from './pages/settings/UserProfile.jsx';

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

export default function App() {
  return (
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
  );
}
