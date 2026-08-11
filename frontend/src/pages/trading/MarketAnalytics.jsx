import React, { useState, useMemo } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  ComposedChart, Area, Bar
} from 'recharts';
import { SampleDataNotice, Card, PageHeader } from '../../components/ui';
import ACPTrendWidget from '../../components/analytics/ACPTrendWidget.jsx';
import CERCMarketIntelligence from './CERCMarketIntelligence.jsx';
import GTAMAnalyticsWidget from './GTAMAnalyticsWidget.jsx';
import TAMAnalyticsWidget from './TAMAnalyticsWidget.jsx';
import CollectiveMarketAnalyticsWidget from './CollectiveMarketAnalyticsWidget.jsx';
import MacroTradingIntelligenceWidget from './MacroTradingIntelligenceWidget.jsx';

// Mock Data Generator for 96 blocks (15-min intervals)
const generateMockData = () => {
  const data = [];
  for (let i = 1; i <= 96; i++) {
    const timeStr = `${String(Math.floor((i-1)*15/60)).padStart(2, '0')}:${String(((i-1)*15)%60).padStart(2, '0')}`;
    
    // Base load shapes
    let basePrice = 3000;
    if (i >= 30 && i <= 45) basePrice = 4500; // Morning peak
    if (i >= 70 && i <= 85) basePrice = 6000; // Evening peak

    // Noise
    const dam_mcp = basePrice + (Math.random() * 500 - 250);
    
    // Green Day Ahead Market (GDAM) typically runs a premium, especially during solar hours
    const isSolarHour = i >= 32 && i <= 64; // 8 AM to 4 PM
    const greenPremium = isSolarHour ? (Math.random() * 1200 + 400) : (Math.random() * 200 - 100);
    const gdam_mcp = dam_mcp + greenPremium;

    // Real-Time Market (RTM) is highly volatile
    const rtm_mcp = dam_mcp + (Math.random() * 1500 - 750);

    // Volumes
    const dam_mcv = 8000 + Math.random() * 2000;
    const gdam_mcv = 1500 + Math.random() * 500;

    data.push({
      block: i,
      time: timeStr,
      DAM_MCP: Math.max(0, Math.round(dam_mcp)),
      GDAM_MCP: Math.max(0, Math.round(gdam_mcp)),
      RTM_MCP: Math.max(0, Math.round(rtm_mcp)),
      Premium: Math.round(gdam_mcp - dam_mcp),
      DAM_MCV: Math.round(dam_mcv),
      GDAM_MCV: Math.round(gdam_mcv),
    });
  }
  return data;
};

export default function MarketAnalytics() {
  const [dateRange, setDateRange] = useState({ 
    from: new Date().toISOString().split('T')[0], 
    to: new Date().toISOString().split('T')[0] 
  });
  const [activeTab, setActiveTab] = useState('intraday');
  
  const data = useMemo(() => generateMockData(), [dateRange]);

  // Analytics Calculations
  const avgDamPrice = Math.round(data.reduce((sum, d) => sum + d.DAM_MCP, 0) / data.length);
  const avgGdamPrice = Math.round(data.reduce((sum, d) => sum + d.GDAM_MCP, 0) / data.length);
  const avgPremium = avgGdamPrice - avgDamPrice;

  // Identify Dispatch Opportunities (Consecutive blocks with high premium)
  const highPremiumBlocks = data.filter(d => d.Premium > 800);
  const suggestedAction = highPremiumBlocks.length > 10 
    ? `Actionable Alert: High Green Premium detected across ${highPremiumBlocks.length} blocks. Consider routing surplus hydro to GDAM.` 
    : 'Market is stable. Maintain standard day-ahead scheduling allocations.';

  return (
    <div style={{ padding: 20 }}>
      <PageHeader 
        title="Market Analytics Dashboard" 
        subtitle="GDAM, DAM & RTM Exchange Analytics (MCP & MCV)" 
      />

      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #e2e8f0' }}>
        <button
          onClick={() => setActiveTab('intraday')}
          style={{
            padding: '10px 24px',
            fontWeight: 600,
            fontSize: 14,
            border: 'none',
            borderBottom: activeTab === 'intraday' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === 'intraday' ? '#3b82f6' : '#64748b',
            background: 'transparent',
            cursor: 'pointer',
            marginBottom: -2,
          }}
        >
          Intraday Analytics
        </button>
        <button
          onClick={() => setActiveTab('cerc')}
          style={{
            padding: '10px 24px',
            fontWeight: 600,
            fontSize: 14,
            border: 'none',
            borderBottom: activeTab === 'cerc' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === 'cerc' ? '#3b82f6' : '#64748b',
            background: 'transparent',
            cursor: 'pointer',
            marginBottom: -2,
          }}
        >
          CERC Monthly Intelligence
        </button>
        <button
          onClick={() => setActiveTab('gtam')}
          style={{
            padding: '10px 24px',
            fontWeight: 600,
            fontSize: 14,
            border: 'none',
            borderBottom: activeTab === 'gtam' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === 'gtam' ? '#3b82f6' : '#64748b',
            background: 'transparent',
            cursor: 'pointer',
            marginBottom: -2,
          }}
        >
          GTAM Performance Analytics
        </button>
        <button
          onClick={() => setActiveTab('tam')}
          style={{
            padding: '10px 24px',
            fontWeight: 600,
            fontSize: 14,
            border: 'none',
            borderBottom: activeTab === 'tam' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === 'tam' ? '#3b82f6' : '#64748b',
            background: 'transparent',
            cursor: 'pointer',
            marginBottom: -2,
          }}
        >
          TAM Performance Analytics
        </button>
        <button
          onClick={() => setActiveTab('collective')}
          style={{
            padding: '10px 24px',
            fontWeight: 600,
            fontSize: 14,
            border: 'none',
            borderBottom: activeTab === 'collective' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === 'collective' ? '#3b82f6' : '#64748b',
            background: 'transparent',
            cursor: 'pointer',
            marginBottom: -2,
          }}
        >
          Collective Market Analytics
        </button>
        <button
          onClick={() => setActiveTab('macro')}
          style={{
            padding: '10px 24px',
            fontWeight: 600,
            fontSize: 14,
            border: 'none',
            borderBottom: activeTab === 'macro' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === 'macro' ? '#3b82f6' : '#64748b',
            background: 'transparent',
            cursor: 'pointer',
            marginBottom: -2,
          }}
        >
          Macro Intelligence
        </button>
      </div>

      {activeTab === 'intraday' && (
        <>
          <SampleDataNotice detail="Every price and volume on this page is generated locally and changes on each reload. The live IEX market-price feed is not wired to this screen." />

          {/* Control Bar */}
      <Card>
        <div style={{ display: 'flex', gap: 15, alignItems: 'flex-end', marginBottom: 20 }}>
          <div style={{ flex: 1, maxWidth: 200 }}>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 5, fontWeight: 600, color: 'var(--slate-600)' }} htmlFor="marketanalytics-from-trading-date">From Trading Date</label>
            <input id="marketanalytics-from-trading-date" type="date" className="input" value={dateRange.from} onChange={e => setDateRange({...dateRange, from: e.target.value})} />
          </div>
          <div style={{ flex: 1, maxWidth: 200 }}>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 5, fontWeight: 600, color: 'var(--slate-600)' }} htmlFor="marketanalytics-to-trading-date">To Trading Date</label>
            <input id="marketanalytics-to-trading-date" type="date" className="input" value={dateRange.to} onChange={e => setDateRange({...dateRange, to: e.target.value})} />
          </div>
          <button className="btn btn-primary">Search Analytics</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-outline">Export PDF</button>
            <button className="btn btn-outline" style={{ background: '#059669', color: 'white', borderColor: '#059669' }}>Export Excel</button>
          </div>
        </div>
      </Card>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 20 }}>
        <Card style={{ borderTop: '4px solid #3b82f6' }}>
          <div style={{ color: 'var(--slate-500)', fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Avg DAM MCP (₹/MWh)</div>
          <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--slate-800)' }}>₹{avgDamPrice.toLocaleString()}</div>
        </Card>
        <Card style={{ borderTop: '4px solid #10b981' }}>
          <div style={{ color: 'var(--slate-500)', fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Avg GDAM MCP (₹/MWh)</div>
          <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--slate-800)' }}>₹{avgGdamPrice.toLocaleString()}</div>
        </Card>
        <Card style={{ borderTop: `4px solid ${avgPremium > 0 ? '#10b981' : '#ef4444'}`, background: avgPremium > 0 ? '#f0fdf4' : '#fef2f2' }}>
          <div style={{ color: 'var(--slate-500)', fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Net Green Premium</div>
          <div style={{ fontSize: 24, fontWeight: 'bold', color: avgPremium > 0 ? '#166534' : '#991b1b' }}>
            {avgPremium > 0 ? '+' : ''}₹{avgPremium.toLocaleString()}
          </div>
        </Card>
      </div>

      {/* Intelligent Dispatch Suggestion */}
      <div style={{ 
        background: '#fffbeb', border: '1px solid #fcd34d', padding: '15px 20px', 
        borderRadius: 8, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}></span>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--amber-strong)' }}>Automated Dispatch Suggestion</div>
            <div style={{ color: '#92400e', fontSize: 14 }}>{suggestedAction}</div>
          </div>
        </div>
        {highPremiumBlocks.length > 10 && (
          <button className="btn btn-sm btn-primary" style={{ background: '#d97706', borderColor: '#d97706' }}>
            Auto-Route to GDAM
          </button>
        )}
      </div>

      <ACPTrendWidget />

      {/* Price Curves Chart */}
      <Card style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 20, fontSize: 16, color: 'var(--slate-700)' }}>96-Block Market Clearing Price (MCP) Curve</h3>
        <div style={{ height: 400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" minTickGap={30} tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} label={{ value: 'Price (₹/MWh)', angle: -90, position: 'insideLeft', style: {textAnchor: 'middle', fill: 'var(--slate-500)'} }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} label={{ value: 'Premium (₹/MWh)', angle: 90, position: 'insideRight', style: {textAnchor: 'middle', fill: 'var(--slate-500)'} }} />
              <Tooltip 
                contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                labelStyle={{ fontWeight: 'bold', color: 'var(--slate-800)', marginBottom: 5 }}
              />
              <Legend verticalAlign="top" height={36}/>
              
              <Area yAxisId="right" type="monotone" dataKey="Premium" fill="#dcfce7" stroke="none" name="Green Premium Overlay" />
              
              <Line yAxisId="left" type="monotone" dataKey="DAM_MCP" stroke="#3b82f6" strokeWidth={2} dot={false} name="Conventional DAM" />
              <Line yAxisId="left" type="monotone" dataKey="GDAM_MCP" stroke="#10b981" strokeWidth={2} dot={false} name="Green DAM (GDAM)" />
              <Line yAxisId="left" type="monotone" dataKey="RTM_MCP" stroke="#f59e0b" strokeWidth={1} strokeDasharray="5 5" dot={false} name="Real-Time (RTM)" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Volume Bar Chart */}
      <Card>
        <h3 style={{ marginBottom: 20, fontSize: 16, color: 'var(--slate-700)' }}>Market Clearing Volume (MCV) Distribution</h3>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" minTickGap={30} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} label={{ value: 'Volume (MWh)', angle: -90, position: 'insideLeft', style: {textAnchor: 'middle', fill: 'var(--slate-500)'} }} />
              <Tooltip />
              <Legend verticalAlign="top" height={36}/>
              <Bar dataKey="DAM_MCV" stackId="a" fill="#93c5fd" name="DAM Volume" />
              <Bar dataKey="GDAM_MCV" stackId="a" fill="#6ee7b7" name="GDAM Volume" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
      </>
      )}
      
      {activeTab === 'cerc' && <CERCMarketIntelligence />}

      {activeTab === 'gtam' && <GTAMAnalyticsWidget />}

      {activeTab === 'tam' && <TAMAnalyticsWidget />}

      {activeTab === 'collective' && <CollectiveMarketAnalyticsWidget />}

      {activeTab === 'macro' && <MacroTradingIntelligenceWidget />}

    </div>
  );
}
