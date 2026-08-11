import React, { useState } from 'react';
import { 
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';

export const DashboardKPIs = () => {
  const kpiData = [
    { title: "Total Energy Traded", value: "343.97", unit: "MU", tone: "tone-green" },
    { title: "Energy Traded in FY 2026-27", value: "113.93", unit: "MU", tone: "tone-red" },
    { title: "No of REC Sold (#till date)", value: "66167", unit: "Nos.", tone: "tone-blue" },
    { title: "Total Earnings from REC", value: "75011149", unit: "Cr.", tone: "tone-amber" },
  ];

  return (
    <div className="kpi-grid">
      {kpiData.map((kpi, index) => (
        <div key={index} className={`stat-card ${kpi.tone}`}>
          <div className="stat-label">{kpi.title}</div>
          <div className="stat-value">{kpi.value}</div>
          <div className="stat-hint">{kpi.unit}</div>
        </div>
      ))}
    </div>
  );
};

export default function MainDashboard() {
  const [fromDate, setFromDate] = useState('10-08-2026');
  const [productType, setProductType] = useState('RTM');

  // Generating RTM Intraday mock data based on analysis
  const RTM_INTRADAY_DATA = [];
  for(let i=1; i<=96; i++) {
    let mcv = Math.random() * 4000 + 4000;
    let mcp = Math.random() * 2000 + 1000;
    
    // Explicit overrides based on screenshots
    if (i === 1) { mcv = 3728.25; mcp = 3500.12; }
    if (i === 27) { mcv = 5436.62; mcp = 4950.24; }
    if (i === 52) { mcv = 12299.49; mcp = 2305.82; }
    if (i === 54) { mcv = 12133.83; mcp = 2848.24; }
    if (i > 40 && i < 60) { mcv += 4000; } // Volatility boost in afternoon

    RTM_INTRADAY_DATA.push({
      blockNo: i.toString(),
      mcv: parseFloat(mcv.toFixed(2)),
      mcp: parseFloat(mcp.toFixed(2))
    });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Main Dashboard</h1>
          <div className="page-subtitle">Platform-level trading and revenue analytics</div>
        </div>
      </div>
      
      {/* KPI Cards */}
      <DashboardKPIs />

      {/* Filter Controls Bar */}
      <div className="filters-bar" style={{ background: 'var(--surface)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '13px', fontWeight: 600 }}>From Date*</label>
          <input 
            type="text" 
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px' }}>
          <label style={{ fontSize: '13px', fontWeight: 600 }}>Product Type*</label>
          <select 
            value={productType} 
            onChange={(e) => setProductType(e.target.value)} 
          >
            <option value="RTM">RTM</option>
            <option value="GDAM">GDAM</option>
            <option value="DAM">DAM</option>
          </select>
        </div>

        <button className="btn btn-primary" style={{ marginLeft: '12px' }}>
          Show Graph
        </button>
      </div>

      {/* Intraday 96-Block Deep Dive */}
      <div className="card">
        <div className="card-header">
          <h3>Time Block wise MCP vs MCV ({fromDate.replace(/-/g, '-').replace('08', 'Aug')})</h3>
        </div>
        <div className="card-body">
          <div style={{ width: '100%', height: '450px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={RTM_INTRADAY_DATA} margin={{ top: 20, right: 10, left: 10, bottom: 20 }}>
                <XAxis 
                  dataKey="blockNo" 
                  stroke="#64748b" 
                  fontSize={10} 
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                  label={{ value: 'Months', position: 'insideBottom', offset: -15, fill: '#64748b', fontSize: 10 }}
                />
                <YAxis 
                  yAxisId="mcv" 
                  stroke="#f97316" 
                  fontSize={10} 
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                  tickFormatter={(val) => `${val/1000}k`}
                  label={{ value: 'MCV (MWh)', angle: -90, position: 'insideLeft', fill: '#f97316', fontSize: 11 }} 
                />
                <YAxis 
                  yAxisId="mcp" 
                  orientation="right" 
                  stroke="#a855f7" 
                  fontSize={10} 
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                  label={{ value: 'MCP (Rs./MWh)', angle: 90, position: 'insideRight', fill: '#a855f7', fontSize: 11 }} 
                />
                <Tooltip contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '4px', fontSize: '12px' }} />
                <Bar yAxisId="mcv" dataKey="mcv" name="MCV (MWh)" fill="#d97706" radius={[2, 2, 0, 0]} barSize={4} />
                <Bar yAxisId="mcp" dataKey="mcp" name="MCP (Rs./MWh)" fill="#a855f7" radius={[2, 2, 0, 0]} barSize={4} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

    </div>
  );
}
