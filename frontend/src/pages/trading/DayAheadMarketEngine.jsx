import React, { useState } from 'react';
import Bids from './Bids.jsx';
import EnergySchedule from './EnergySchedule.jsx';
import GDAMObligationConsole from './GDAMObligationConsole.jsx';
import TaxInvoiceLedgerTable from '../../components/TaxInvoiceLedgerTable.jsx';
import DAMInvoiceLedger from './DAMInvoiceLedger.jsx';
import { PageHeader, Card } from '../../components/ui.jsx';
import BidVsClearedAnalytics from '../../components/analytics/BidVsClearedAnalytics.jsx';
import ComplianceStatusBar from '../../components/analytics/ComplianceStatusBar.jsx';

export default function DayAheadMarketEngine({ marketType = 'CONVENTIONAL_DAM' }) {
  const [activeTab, setActiveTab] = useState('MANAGE'); 
  // Stages: CREATE, MANAGE, HISTORY, SCHEDULE, OBLIGATION, INVOICE, MCP

  const isGreen = marketType === 'GREEN_DAM';
  const productLabel = isGreen ? 'GDAM' : 'DAM';
  const themeColor = isGreen ? '#27ae60' : '#2980b9'; // Green vs Blue

  const tabs = [
    { id: 'CREATE', label: 'Create Bid' },
    { id: 'MANAGE', label: 'Manage Bids' },
    { id: 'HISTORY', label: 'Bid History' },
    { id: 'SCHEDULE', label: 'Energy Schedule' },
    { id: 'OBLIGATION', label: 'Obligation' },
    { id: 'INVOICE', label: 'Invoice Record' },
    { id: 'MCP', label: 'Market MCP' }
  ];

  // Generate mock invoice data for DAM/GDAM
  const mockInvoiceData = Array.from({ length: 15 }).map((_, i) => {
    const energyMUs = Math.floor(Math.random() * 500) + 100;
    const ratePerKwh = 4.5;
    const grossValue = (energyMUs * 1000) * ratePerKwh; // MWh * rate
    const margin = grossValue * 0.02;
    const isInterState = Math.random() > 0.5;
    const igst = isInterState ? margin * 0.18 : 0;
    const cgst = isInterState ? 0 : margin * 0.09;
    const sgst = isInterState ? 0 : margin * 0.09;
    const grandTotal = grossValue + margin + igst + cgst + sgst;
    const deduction = Math.random() * 2000;
    const netTotal = grandTotal - deduction;
    
    return {
      id: `inv-${i}`,
      deliveryDate: `1${(i % 5) + 1}-Oct-2025`,
      energyType: productLabel === 'GDAM' ? 'Non-Solar (Green)' : 'Conventional',
      energyMUs: energyMUs,
      grossValue, margin, igst, cgst, sgst, grandTotal, deduction, netTotal,
      sapStatus: Math.random() > 0.4 ? 'POSTED' : 'PENDING'
    };
  });

  const renderContent = () => {
    switch (activeTab) {
      case 'CREATE':
      case 'MANAGE':
      case 'HISTORY':
        return <Bids product={productLabel} externalView={activeTab} />;
      case 'SCHEDULE':
        return <EnergySchedule product={productLabel} />;
      case 'OBLIGATION':
        return <GDAMObligationConsole product={productLabel} />;
      case 'INVOICE':
        if (productLabel === 'DAM') {
          return <DAMInvoiceLedger />;
        }
        return (
          <div style={{ padding: 20 }}>
            <TaxInvoiceLedgerTable records={mockInvoiceData} marketSegment={productLabel} />
          </div>
        );
      case 'MCP':
        return (
          <div style={{ marginTop: 20 }}>
            <BidVsClearedAnalytics />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div style={{ padding: '0 20px 20px', maxWidth: 1600, margin: '0 auto' }}>
      
      {/* Top Compliance Alerts */}
      <ComplianceStatusBar />

      {/* Title & Regulatory Theme Banner */}
      <div style={{ 
        background: isGreen ? '#e8f5e9' : '#e3f2fd', 
        borderLeft: `4px solid ${themeColor}`, 
        padding: '15px 20px', 
        borderRadius: 4, 
        marginBottom: 20,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <h2 style={{ margin: 0, color: themeColor }}>
            {isGreen ? 'Green Day-Ahead Market (GDAM)' : 'Conventional Day-Ahead Market (DAM)'}
          </h2>
          <p style={{ margin: '5px 0 0 0', color: '#555', fontSize: 13 }}>
            Unified Workflow Engine: Manage the entire {productLabel} lifecycle from bidding to tax invoices.
          </p>
        </div>
        {isGreen && (
          <div style={{ background: '#c8e6c9', color: '#2e7d32', padding: '5px 10px', borderRadius: 12, fontSize: 12, fontWeight: 'bold' }}>
             RPO Compliance Eligible
          </div>
        )}
      </div>

      {/* 7-Stage Workflow Tab Navigation */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 20, borderBottom: '2px solid #ddd', overflowX: 'auto' }}>
        {tabs.map(tab => (
          <button 
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{ 
              padding: '12px 16px', 
              background: 'transparent', 
              border: 'none', 
              borderBottom: activeTab === tab.id ? `3px solid ${themeColor}` : '3px solid transparent', 
              color: activeTab === tab.id ? themeColor : '#666', 
              fontWeight: activeTab === tab.id ? 'bold' : 'normal', 
              cursor: 'pointer', 
              fontSize: 14,
              whiteSpace: 'nowrap'
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Render Active Stage */}
      <div style={{ background: '#fff' }}>
        {renderContent()}
      </div>

    </div>
  );
}
