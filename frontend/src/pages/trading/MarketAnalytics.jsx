import React, { useState } from 'react';
import { PageHeader, Tabs, Tab } from '../../components/ui';
import IntradayMarketTab from './IntradayMarketTab.jsx';
import CERCMarketIntelligence from './CERCMarketIntelligence.jsx';
import GTAMAnalyticsWidget from './GTAMAnalyticsWidget.jsx';
import TAMAnalyticsWidget from './TAMAnalyticsWidget.jsx';
import CollectiveMarketAnalyticsWidget from './CollectiveMarketAnalyticsWidget.jsx';
import MacroTradingIntelligenceWidget from './MacroTradingIntelligenceWidget.jsx';

// The intraday tab used to generate its 96 blocks with Math.random on every
// render, under a notice saying so. It reads the block-wise prices the platform
// holds now — see IntradayMarketTab.

const TABS = [
  { id: 'intraday', label: 'Intraday Prices' },
  { id: 'cerc', label: 'CERC Monthly Intelligence' },
  { id: 'gtam', label: 'GTAM Performance Analytics' },
  { id: 'tam', label: 'TAM Performance Analytics' },
  { id: 'collective', label: 'Collective Market Analytics' },
  { id: 'macro', label: 'Macro Intelligence' },
];

export default function MarketAnalytics() {
  const [activeTab, setActiveTab] = useState('intraday');

  return (
    <div className="page">
      <PageHeader title="Market Rates & Analytics" subtitle="DAM, GDAM and RTM clearing prices and volumes, as the exchanges cleared them" />

      <Tabs style={{ marginBottom: 20 }}>
        {TABS.map((t) => (
          <Tab key={t.id} active={activeTab === t.id} onClick={() => setActiveTab(t.id)}>{t.label}</Tab>
        ))}
      </Tabs>

      {activeTab === 'intraday' && <IntradayMarketTab />}
      {activeTab === 'cerc' && <CERCMarketIntelligence />}
      {activeTab === 'gtam' && <GTAMAnalyticsWidget />}
      {activeTab === 'tam' && <TAMAnalyticsWidget />}
      {activeTab === 'collective' && <CollectiveMarketAnalyticsWidget />}
      {activeTab === 'macro' && <MacroTradingIntelligenceWidget />}
    </div>
  );
}
