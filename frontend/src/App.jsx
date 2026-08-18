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
const EnergyBanking = lazy(() => import('./pages/reia/EnergyBanking.jsx'));

const TradingDashboard = lazy(() => import('./pages/trading/TradingDashboard.jsx'));
const TradingClients = lazy(() => import('./pages/trading/TradingClients.jsx'));
const TradingClientProfile = lazy(() => import('./pages/trading/TradingClientProfile.jsx'));
const Bids = lazy(() => import('./pages/trading/Bids.jsx'));
const DayAheadMarketEngine = lazy(() => import('./pages/trading/DayAheadMarketEngine.jsx'));
const PreTradeBoard = lazy(() => import('./pages/trading/PreTradeBoard.jsx'));
const Bilateral = lazy(() => import('./pages/trading/Bilateral.jsx'));
const BilateralContractsSummary = lazy(() => import('./pages/trading/BilateralContractsSummary.jsx'));
const BilateralBidding = lazy(() => import('./pages/trading/BilateralBidding.jsx'));
const BilateralApplications = lazy(() => import('./pages/trading/BilateralApplications.jsx'));
const BillingSettlement = lazy(() => import('./pages/trading/BillingSettlement.jsx'));
const GeneratorBilling = lazy(() => import('./pages/trading/GeneratorBilling.jsx'));
const MarketAnalytics = lazy(() => import('./pages/trading/MarketAnalytics.jsx'));
const NOARWallet = lazy(() => import('./pages/trading/NOARWallet.jsx'));
const NOARRegistry = lazy(() => import('./pages/trading/NOARRegistry.jsx'));
const CERCFormIV = lazy(() => import('./pages/trading/CERCFormIV.jsx'));
const BulkCommunications = lazy(() => import('./pages/trading/BulkCommunications.jsx'));
const InboxMailList = lazy(() => import('./pages/trading/InboxMailList.jsx'));
const CertificateOperationsHub = lazy(() => import('./pages/trading/CertificateOperationsHub.jsx'));
const EscertBidEntry = lazy(() => import('./pages/trading/EscertBidEntry.jsx'));
const RecOrder = lazy(() => import('./pages/trading/RecOrder.jsx'));
const RecOrderReport = lazy(() => import('./pages/trading/RecOrderReport.jsx'));
const RecBidEntry = lazy(() => import('./pages/trading/RecBidEntry.jsx'));
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
const CustomerReceivablesTable = lazy(() => import('./pages/trading/CustomerReceivablesTable.jsx'));
const NOARDetailCard = lazy(() => import('./pages/trading/NOARDetailCard.jsx'));
const ImplementedScheduleGrid = lazy(() => import('./pages/trading/ImplementedScheduleGrid.jsx'));
const TDSSummaryLedger = lazy(() => import('./pages/trading/TDSSummaryLedger.jsx'));
const BillOfSupplyForm = lazy(() => import('./pages/trading/BillOfSupplyForm.jsx'));
const REAReconciliationGrid = lazy(() => import('./pages/trading/REAReconciliationGrid.jsx'));
const ERPVendorMasterTable = lazy(() => import('./pages/trading/ERPVendorMasterTable.jsx'));
const ERPVendorPayableLedger = lazy(() => import('./pages/trading/ERPVendorPayableLedger.jsx'));
const OpenAccessInvoiceViewer = lazy(() => import('./pages/trading/OpenAccessInvoiceViewer.jsx'));
const OpenAccessInvoiceDetail = lazy(() => import('./pages/trading/OpenAccessInvoiceDetail.jsx'));
const TradingMarginInvoiceSummary = lazy(() => import('./pages/trading/TradingMarginInvoiceSummary.jsx'));
const ExchangeEnergySettlementInvoice = lazy(() => import('./pages/trading/ExchangeEnergySettlementInvoice.jsx'));
const BilateralEnergySettlementInvoice = lazy(() => import('./pages/trading/BilateralEnergySettlementInvoice.jsx'));
const ChargesUploader = lazy(() => import('./pages/trading/ChargesUploader.jsx'));
const RldcScheduleUploader = lazy(() => import('./pages/trading/RldcScheduleUploader.jsx'));
const RefundReportUploader = lazy(() => import('./pages/trading/RefundReportUploader.jsx'));
const LatestRefundUploader = lazy(() => import('./pages/trading/LatestRefundUploader.jsx'));
const MmrExcelUploader = lazy(() => import('./pages/trading/MmrExcelUploader.jsx'));
const PxilOrderCreation = lazy(() => import('./pages/trading/PxilOrderCreation.jsx'));
const PxilOrderSummary = lazy(() => import('./pages/trading/PxilOrderSummary.jsx'));
const ApiDetailsReport = lazy(() => import('./pages/trading/IsetReportPages.jsx').then((m) => ({ default: m.ApiDetailsReport })));
const RegistrationReport = lazy(() => import('./pages/trading/IsetReportPages.jsx').then((m) => ({ default: m.RegistrationReport })));
const RegistrationCategoryReport = lazy(() => import('./pages/trading/IsetReportPages.jsx').then((m) => ({ default: m.RegistrationCategoryReport })));
const NoarApprovalsReport = lazy(() => import('./pages/trading/IsetReportPages.jsx').then((m) => ({ default: m.NoarApprovalsReport })));
const NrldcRefundReport = lazy(() => import('./pages/trading/IsetReportPages.jsx').then((m) => ({ default: m.NrldcRefundReport })));
const NrldcLatestRefundReport = lazy(() => import('./pages/trading/IsetReportPages.jsx').then((m) => ({ default: m.NrldcLatestRefundReport })));
const CompensationReconciliationReport = lazy(() => import('./pages/trading/IsetReportPages.jsx').then((m) => ({ default: m.CompensationReconciliationReport })));
const TdsFormatReport = lazy(() => import('./pages/trading/IsetReportPages.jsx').then((m) => ({ default: m.TdsFormatReport })));
const DailyScheduleReport = lazy(() => import('./pages/trading/IsetReportPages.jsx').then((m) => ({ default: m.DailyScheduleReport })));
const ImplementedScheduleSummaryReport = lazy(() => import('./pages/trading/IsetReportPages.jsx').then((m) => ({ default: m.ImplementedScheduleSummaryReport })));
const ImplementedBlockWiseReport = lazy(() => import('./pages/trading/IsetReportPages.jsx').then((m) => ({ default: m.ImplementedBlockWiseReport })));
const OutstandingDuesReport = lazy(() => import('./pages/trading/IsetReportPages.jsx').then((m) => ({ default: m.OutstandingDuesReport })));
const BilateralContractsReport = lazy(() => import('./pages/trading/IsetReportPages.jsx').then((m) => ({ default: m.BilateralContractsReport })));
const GenericIsetReport = lazy(() => import('./pages/trading/GenericIsetReport.jsx'));
const DailyScheduleEntry = lazy(() => import('./pages/trading/DailyScheduleEntry.jsx'));
const BilateralSldcConsentInvoice = lazy(() => import('./pages/trading/BilateralSldcConsentInvoice.jsx'));
const BilateralOpenAccessInvoice = lazy(() => import('./pages/trading/BilateralOpenAccessInvoice.jsx'));
const ViewBills = lazy(() => import('./pages/trading/ViewBills.jsx'));
const BillGenerationForm = lazy(() => import('./pages/trading/BillGenerationForm.jsx'));
const UpdatePortfolioID = lazy(() => import('./pages/trading/UpdatePortfolioID.jsx'));
const ClientDetails = lazy(() => import('./pages/trading/ClientDetails.jsx'));
const ClientRegistrationApproval = lazy(() => import('./pages/trading/ClientRegistrationApproval.jsx'));
const Top10GDAMParticipantsChart = lazy(() => import('./pages/trading/Top10GDAMParticipantsChart.jsx'));
const PortalLevel1Dashboard = lazy(() => import('./pages/trading/PortalLevel1Dashboard.jsx'));
const PreRegistrationRequests = lazy(() => import('./pages/trading/PreRegistrationRequests.jsx'));
const MainDashboard = lazy(() => import('./pages/trading/MainDashboard.jsx'));
const RegistrationRequests = lazy(() => import('./pages/trading/RegistrationRequests.jsx'));
const MMRDashboard = lazy(() => import('./pages/trading/MMRDashboard.jsx'));
const CEAReportsDashboard = lazy(() => import('./pages/trading/CEAReportsDashboard.jsx'));
const PowerMarketDashboard = lazy(() => import('./pages/trading/PowerMarketDashboard.jsx'));
const CreateExchangeContract = lazy(() => import('./pages/trading/CreateExchangeContract.jsx'));
const ExchangeContractsSummary = lazy(() => import('./pages/trading/ExchangeContractsSummary.jsx'));
const ExchangeContractDetail = lazy(() => import('./pages/trading/ExchangeContractDetail.jsx'));
const ExchangeBidding = lazy(() => import('./pages/trading/ExchangeBidding.jsx'));
const ExchangeBiddingLatest = lazy(() => import('./pages/trading/ExchangeBiddingLatest.jsx'));
const ExchangeBiddingDetailReport = lazy(() => import('./pages/trading/ExchangeBiddingDetailReport.jsx'));
const IexBidBookReport = lazy(() => import('./pages/trading/IexBidBookReport.jsx'));
const ExchangeApplications = lazy(() => import('./pages/trading/ExchangeApplications.jsx'));
const UpdateCharges = lazy(() => import('./pages/trading/UpdateCharges.jsx'));
const PendingScreen = lazy(() => import('./pages/trading/PendingScreen.jsx'));
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
        <Route path="reia/energy-banking" element={<ProtectedRoute roles={REIA_ROLES}><EnergyBanking /></ProtectedRoute>} />
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
        <Route path="trading/bilateral" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><BilateralContractsSummary /></ProtectedRoute>} />
        <Route path="trading/bilateral/desk" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><Bilateral /></ProtectedRoute>} />
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
        <Route path="trading/rec" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><RecOrder /></ProtectedRoute>} />
        <Route path="trading/rec/hub" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><CertificateOperationsHub defaultTab="REC" /></ProtectedRoute>} />
        <Route path="trading/rec/order-report" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><RecOrderReport /></ProtectedRoute>} />
        <Route path="trading/rec/bid-entry" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><RecBidEntry /></ProtectedRoute>} />
        <Route path="trading/noar" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><NOARWallet /></ProtectedRoute>} />
        <Route path="trading/noar-registry" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><NOARRegistry /></ProtectedRoute>} />
        <Route path="compliance/noar/:id" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><NOARDetailCard /></ProtectedRoute>} />
        <Route path="erp/receivables" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><CustomerReceivablesTable /></ProtectedRoute>} />
        <Route path="billing/bill-of-supply/new" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><BillOfSupplyForm /></ProtectedRoute>} />
        <Route path="reconciliation/rea-sea" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><REAReconciliationGrid /></ProtectedRoute>} />
        <Route path="erp/vendors" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ERPVendorMasterTable /></ProtectedRoute>} />
        <Route path="erp/payables" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ERPVendorPayableLedger /></ProtectedRoute>} />
        <Route path="invoices/open-access" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><OpenAccessInvoiceViewer /></ProtectedRoute>} />
        <Route path="invoices/open-access/:id" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><OpenAccessInvoiceDetail /></ProtectedRoute>} />
        <Route path="invoices/trading-margin" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><TradingMarginInvoiceSummary /></ProtectedRoute>} />
        <Route path="billing/view-bills" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ViewBills /></ProtectedRoute>} />
        <Route path="billing/generate" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><BillGenerationForm /></ProtectedRoute>} />
        <Route path="portfolio/update" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><UpdatePortfolioID /></ProtectedRoute>} />
        <Route path="clients/details" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ClientDetails /></ProtectedRoute>} />
        <Route path="registration/details/:id" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ClientRegistrationApproval /></ProtectedRoute>} />
        <Route path="market/gdam/participants" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><Top10GDAMParticipantsChart /></ProtectedRoute>} />
        <Route path="level1/dashboard" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><PortalLevel1Dashboard /></ProtectedRoute>} />
        <Route path="dashboard" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><MainDashboard /></ProtectedRoute>} />
        <Route path="registration/initial/requests" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><PreRegistrationRequests /></ProtectedRoute>} />
        <Route path="registration/requests" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><RegistrationRequests /></ProtectedRoute>} />
        <Route path="trading/mmr-dashboard" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><MMRDashboard /></ProtectedRoute>} />
        <Route path="trading/cea-reports" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><CEAReportsDashboard /></ProtectedRoute>} />
        <Route path="trading/power-market" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><PowerMarketDashboard /></ProtectedRoute>} />
        <Route path="reports/dispatch/implemented" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ImplementedScheduleGrid /></ProtectedRoute>} />
        <Route path="compliance/tax/tds-report" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><TDSSummaryLedger /></ProtectedRoute>} />
        <Route path="trading/form-iv" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><CERCFormIV /></ProtectedRoute>} />
        <Route path="trading/bulk-communications" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><BulkCommunications /></ProtectedRoute>} />
        <Route path="trading/inbox" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><InboxMailList /></ProtectedRoute>} />
        <Route path="trading/escert" element={<ProtectedRoute roles={TRADING_COMBINED_ROLES}><EscertBidEntry /></ProtectedRoute>} />
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

        {/* Screens ISET has that we have not written yet. Routed so the menu can
            carry ISET's full structure, each landing on a placeholder that says it
            is unbuilt rather than an empty table that reads as broken. Building one
            means pointing its route at a real page and dropping `pending` from
            src/config/tradingMenu.js — the URL does not change, so saved links keep
            working. */}
        <Route path="trading/mmr-analysis" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="mmr-analysis" /></ProtectedRoute>} />
        <Route path="trading/bilateral/create" element={<Navigate to="/trading/bilateral/desk?action=create" replace />} />
        <Route path="trading/bilateral/bidding" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><BilateralBidding /></ProtectedRoute>} />
        <Route path="trading/bilateral/applications" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><BilateralApplications /></ProtectedRoute>} />
        <Route path="trading/exchange/create" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><CreateExchangeContract /></ProtectedRoute>} />
        <Route path="trading/exchange/contracts" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ExchangeContractsSummary /></ProtectedRoute>} />
        <Route path="trading/exchange/contracts/:id" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ExchangeContractDetail /></ProtectedRoute>} />
        <Route path="trading/exchange/bidding" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ExchangeBiddingLatest /></ProtectedRoute>} />
        <Route path="trading/exchange/bidding-latest" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ExchangeBiddingLatest /></ProtectedRoute>} />
        <Route path="trading/exchange/bidding-detail" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ExchangeBiddingDetailReport /></ProtectedRoute>} />
        <Route path="trading/exchange/iex-dam-single" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><IexBidBookReport kind="dam-single" /></ProtectedRoute>} />
        <Route path="trading/exchange/iex-dam-block" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><IexBidBookReport kind="dam-block" /></ProtectedRoute>} />
        <Route path="trading/exchange/iex-rtm-single" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><IexBidBookReport kind="rtm-single" /></ProtectedRoute>} />
        <Route path="trading/exchange/iex-rtm-block" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><IexBidBookReport kind="rtm-block" /></ProtectedRoute>} />
        <Route path="trading/exchange/applications" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ExchangeApplications /></ProtectedRoute>} />
        <Route path="trading/exchange/update-charges" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><UpdateCharges /></ProtectedRoute>} />
        <Route path="trading/exchange/daily-schedule-entry" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><DailyScheduleEntry /></ProtectedRoute>} />
        <Route path="trading/pxil/create" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><PxilOrderCreation /></ProtectedRoute>} />
        <Route path="trading/pxil/summary" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><PxilOrderSummary /></ProtectedRoute>} />
        <Route path="billing/supply-bill-report" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="supply-bill-report" /></ProtectedRoute>} />
        <Route path="invoices/exchange-energy-settlement" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ExchangeEnergySettlementInvoice /></ProtectedRoute>} />
        <Route path="invoices/bilateral-energy-settlement" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><BilateralEnergySettlementInvoice /></ProtectedRoute>} />
        <Route path="invoices/bilateral-sldc-consent" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><BilateralSldcConsentInvoice /></ProtectedRoute>} />
        <Route path="invoices/bilateral-open-access" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><BilateralOpenAccessInvoice /></ProtectedRoute>} />
        <Route path="uploader/charges" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ChargesUploader /></ProtectedRoute>} />
        <Route path="uploader/rldc-schedule" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><RldcScheduleUploader /></ProtectedRoute>} />
        <Route path="uploader/refund-report" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><RefundReportUploader /></ProtectedRoute>} />
        <Route path="uploader/refund-report-latest" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><LatestRefundUploader /></ProtectedRoute>} />
        <Route path="uploader/mmr-excel" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><MmrExcelUploader /></ProtectedRoute>} />
        <Route path="reports/api-details" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ApiDetailsReport /></ProtectedRoute>} />
        <Route path="reports/registration" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><RegistrationReport /></ProtectedRoute>} />
        <Route path="reports/registration-category" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><RegistrationCategoryReport /></ProtectedRoute>} />
        <Route path="reports/noar-approvals" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><NoarApprovalsReport /></ProtectedRoute>} />
        <Route path="reports/nrldc-refund" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><NrldcRefundReport /></ProtectedRoute>} />
        <Route path="reports/nrldc-refund-latest" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><NrldcLatestRefundReport /></ProtectedRoute>} />
        <Route path="reports/compensation-reconciliation" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><CompensationReconciliationReport /></ProtectedRoute>} />
        <Route path="reports/tds-format" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><TdsFormatReport /></ProtectedRoute>} />
        <Route path="reports/daily-schedule" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><DailyScheduleReport /></ProtectedRoute>} />
        <Route path="reports/implemented-schedule" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ImplementedScheduleSummaryReport /></ProtectedRoute>} />
        <Route path="reports/implemented-block-wise" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><ImplementedBlockWiseReport /></ProtectedRoute>} />
        <Route path="reports/outstanding-dues" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><OutstandingDuesReport /></ProtectedRoute>} />
        <Route path="reports/bilateral-contracts" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><BilateralContractsReport /></ProtectedRoute>} />
        <Route path="reports/market-clearing-price" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="market-clearing-price" /></ProtectedRoute>} />
        <Route path="reports/daily-obligation-summary" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="daily-obligation-summary" /></ProtectedRoute>} />
        <Route path="reports/day-wise-transactions" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="day-wise-transactions" /></ProtectedRoute>} />
        <Route path="reports/trading-margins" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="trading-margins" /></ProtectedRoute>} />
        <Route path="reports/mmr-analysis" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="mmr-analysis" /></ProtectedRoute>} />
        <Route path="reports/supply-bill-report" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="supply-bill-report" /></ProtectedRoute>} />
        <Route path="reports/bilateral-volume-latest" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="bilateral-volume-latest" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-a" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-a" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-b" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-b" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-c-latest" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-c-latest" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-c" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-c" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-d" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-d" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-e" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-e" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-f" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-f" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-f-margin" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-f-margin" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-g" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-g" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-h" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-h" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-i" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-i" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-k" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-k" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-l" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-l" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-m" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-m" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-n" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-n" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-o" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-o" /></ProtectedRoute>} />
        <Route path="cerc/form-iv-o-margin" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-form-iv-o-margin" /></ProtectedRoute>} />
        <Route path="cerc/format-5-3-rec" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-format-5-3-rec" /></ProtectedRoute>} />
        <Route path="cerc/saudamini-trf-4c" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cerc-saudamini-trf-4c" /></ProtectedRoute>} />
        <Route path="cea/supply-position-energy" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cea-supply-position-energy" /></ProtectedRoute>} />
        <Route path="cea/supply-position-peak" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cea-supply-position-peak" /></ProtectedRoute>} />
        <Route path="cea/installed-capacity-month" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cea-installed-capacity-month" /></ProtectedRoute>} />
        <Route path="cea/installed-capacity-state" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cea-installed-capacity-state" /></ProtectedRoute>} />
        <Route path="cea/per-capita-consumption" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="cea-per-capita-consumption" /></ProtectedRoute>} />
        <Route path="erp/weekly-billing" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="erp-weekly-billing" /></ProtectedRoute>} />
        <Route path="erp/tds-format" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><TdsFormatReport /></ProtectedRoute>} />
        <Route path="erp/dam-orders" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="erp-dam-orders" /></ProtectedRoute>} />
        <Route path="erp/rtm-orders" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="erp-rtm-orders" /></ProtectedRoute>} />
        <Route path="erp/noc-updation" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="erp-noc-updation" /></ProtectedRoute>} />
        <Route path="erp/noc-status" element={<ProtectedRoute roles={TRADING_INTERNAL_ROLES}><GenericIsetReport kind="erp-noc-status" /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
