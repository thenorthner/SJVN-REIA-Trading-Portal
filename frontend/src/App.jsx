import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { ROLE_GROUPS } from './roles.js';

import Login from './pages/Login.jsx';
import ConsolidatedDashboard from './pages/ConsolidatedDashboard.jsx';

import ReiaDashboard from './pages/reia/ReiaDashboard.jsx';
import Entities from './pages/reia/Entities.jsx';
import Contracts from './pages/reia/Contracts.jsx';
import EnergyData from './pages/reia/EnergyData.jsx';
import Invoices from './pages/reia/Invoices.jsx';
import Disputes from './pages/reia/Disputes.jsx';
import PaymentSecurity from './pages/reia/PaymentSecurity.jsx';
import Reconciliation from './pages/reia/Reconciliation.jsx';

import TradingDashboard from './pages/trading/TradingDashboard.jsx';
import TradingClients from './pages/trading/TradingClients.jsx';
import Bids from './pages/trading/Bids.jsx';
import Bilateral from './pages/trading/Bilateral.jsx';
import TradingInvoices from './pages/trading/TradingInvoices.jsx';
import MarketRates from './pages/trading/MarketRates.jsx';

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

const REIA_ROLES = [...ROLE_GROUPS.REIA_ALL, 'SELLER', 'BUYER'];
const TRADING_ROLES = [...ROLE_GROUPS.TRADING_ALL, 'TRADING_CLIENT'];
const SELLER_ROLES = ['SELLER', 'SJVN_ADMIN'];
const BUYER_ROLES = ['BUYER', 'SJVN_ADMIN'];

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
        <Route index element={<ConsolidatedDashboard />} />

        <Route path="reia" element={<ProtectedRoute roles={REIA_ROLES}><ReiaDashboard /></ProtectedRoute>} />
        <Route path="reia/entities" element={<ProtectedRoute roles={REIA_ROLES}><Entities /></ProtectedRoute>} />
        <Route path="reia/contracts" element={<ProtectedRoute roles={REIA_ROLES}><Contracts /></ProtectedRoute>} />
        <Route path="reia/energy-data" element={<ProtectedRoute roles={REIA_ROLES}><EnergyData /></ProtectedRoute>} />
        <Route path="reia/invoices" element={<ProtectedRoute roles={REIA_ROLES}><Invoices /></ProtectedRoute>} />
        <Route path="reia/disputes" element={<ProtectedRoute roles={REIA_ROLES}><Disputes /></ProtectedRoute>} />
        <Route path="reia/payment-security" element={<ProtectedRoute roles={REIA_ROLES}><PaymentSecurity /></ProtectedRoute>} />
        <Route path="reia/reconciliation" element={<ProtectedRoute roles={REIA_ROLES}><Reconciliation /></ProtectedRoute>} />

        {/* Seller Portal */}
        <Route path="seller" element={<ProtectedRoute roles={SELLER_ROLES}><SellerDashboard /></ProtectedRoute>} />
        <Route path="seller/contracts" element={<ProtectedRoute roles={SELLER_ROLES}><SellerContracts /></ProtectedRoute>} />
        <Route path="seller/energy-data" element={<ProtectedRoute roles={SELLER_ROLES}><SellerEnergyData /></ProtectedRoute>} />
        <Route path="seller/invoices" element={<ProtectedRoute roles={SELLER_ROLES}><SellerInvoices /></ProtectedRoute>} />
        <Route path="seller/payments" element={<ProtectedRoute roles={SELLER_ROLES}><SellerPayments /></ProtectedRoute>} />
        <Route path="seller/disputes" element={<ProtectedRoute roles={SELLER_ROLES}><SellerDisputes /></ProtectedRoute>} />
        <Route path="seller/reconciliation" element={<ProtectedRoute roles={SELLER_ROLES}><SellerReconciliation /></ProtectedRoute>} />
        <Route path="seller/payment-security" element={<ProtectedRoute roles={SELLER_ROLES}><SellerPaymentSecurity /></ProtectedRoute>} />

        {/* Buyer Portal */}
        <Route path="buyer" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerDashboard /></ProtectedRoute>} />
        <Route path="buyer/contracts" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerContracts /></ProtectedRoute>} />
        <Route path="buyer/energy-data" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerEnergyData /></ProtectedRoute>} />
        <Route path="buyer/invoices" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerInvoices /></ProtectedRoute>} />
        <Route path="buyer/payments" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerPayments /></ProtectedRoute>} />
        <Route path="buyer/disputes" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerDisputes /></ProtectedRoute>} />
        <Route path="buyer/reconciliation" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerReconciliation /></ProtectedRoute>} />
        <Route path="buyer/payment-security" element={<ProtectedRoute roles={BUYER_ROLES}><BuyerPaymentSecurity /></ProtectedRoute>} />

        <Route path="trading" element={<ProtectedRoute roles={TRADING_ROLES}><TradingDashboard /></ProtectedRoute>} />
        <Route path="trading/clients" element={<ProtectedRoute roles={TRADING_ROLES}><TradingClients /></ProtectedRoute>} />
        <Route path="trading/bids" element={<ProtectedRoute roles={TRADING_ROLES}><Bids /></ProtectedRoute>} />
        <Route path="trading/bilateral" element={<ProtectedRoute roles={TRADING_ROLES}><Bilateral /></ProtectedRoute>} />
        <Route path="trading/invoices" element={<ProtectedRoute roles={TRADING_ROLES}><TradingInvoices /></ProtectedRoute>} />
        <Route path="trading/market-rates" element={<ProtectedRoute roles={TRADING_ROLES}><MarketRates /></ProtectedRoute>} />

        <Route path="audit-logs" element={<AuditLogs />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
