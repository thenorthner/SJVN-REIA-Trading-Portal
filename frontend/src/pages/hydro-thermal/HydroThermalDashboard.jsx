import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, StatCard } from '../../components/ui.jsx';

export default function HydroThermalDashboard() {
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        title="Hydro & Thermal Billing"
        subtitle="Manage station-wise billing, accounts, claims, and PTC sale bills for Hydro and Thermal stations"
      />

      <div className="kpi-grid">
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/hydro-thermal/hydro-billing')}>
          <StatCard label="Hydro Billing" value="Station-wise" hint="Raise and manage station bills" tone="blue" />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/hydro-thermal/hydro-ledger')}>
          <StatCard label="Account Display" value="Ledger" hint="View beneficiary accounts" tone="green" />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/hydro-thermal/hydro-claims')}>
          <StatCard label="Additional Charges" value="Claims & TCS" hint="Manage claims and tax" tone="amber" />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/hydro-thermal/hydro-finance')}>
          <StatCard label="Finance Posting" value="FI Docs" hint="Post bills to FI module" tone="default" />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/hydro-thermal/hydro-ptc')}>
          <StatCard label="PTC Sale Bills" value="PTC" hint="Bills raised on PTC for power sold" tone="default" />
        </div>
      </div>
    </div>
  );
}
