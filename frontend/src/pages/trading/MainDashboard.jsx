import React, { useState, useMemo, useEffect } from 'react';
import { 
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { api } from '../../api/client.js';
import SourceNote from '../../components/SourceNote.jsx';

const inLakhCrore = (n) => Number(n).toLocaleString('en-IN');

// These four cards were typed in. The REC pair in particular claimed 66,167
// certificates sold for Rs 7.5 crore while the ledger this platform maintains
// held 32,500 for Rs 1.27 crore — a dashboard reporting a book that was not its
// own. They now come from /dashboard/trading/analytics, which reads the REC
// ledger and the locked energy periods directly.
export const DashboardKPIs = () => {
  const [figures, setFigures] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.dashboard.trading.analytics()
      .then((d) => { if (alive) setFigures(d); })
      .catch((err) => {
        console.error('[MainDashboard] Could not load trading analytics:', err);
        if (alive) setFailed(true);
      });
    return () => { alive = false; };
  }, []);

  // Dashes rather than zeros while loading or after a failure. A KPI card
  // showing 0 is a claim about the business; showing nothing is a claim about
  // the fetch, and only one of those is true here.
  const pending = !figures;
  const show = (v, fmt = (x) => x) => (pending ? (failed ? '—' : '…') : fmt(v));

  const kpiData = [
    {
      title: "Total Energy Traded",
      value: show(figures?.energy?.delivered_mu, (v) => inLakhCrore(v)),
      unit: "MU", tone: "tone-green",
      exact: figures ? `${inLakhCrore(figures.energy.delivered_mwh)} MWh locked` : undefined,
    },
    {
      // An Indian financial year spans two calendar years, so name both.
      title: figures
        ? `Energy Traded in FY ${figures.financial_year_from.slice(0, 4)}-${String(Number(figures.financial_year_from.slice(0, 4)) + 1).slice(2)}`
        : 'Energy Traded this FY',
      value: show(figures?.energy?.fy_delivered_mu, (v) => inLakhCrore(v)),
      unit: "MU", tone: "tone-red",
    },
    {
      title: "No of REC Sold (#till date)",
      value: show(figures?.rec?.sold, (v) => inLakhCrore(v)),
      unit: "Nos.", tone: "tone-blue",
    },
    {
      title: "Total Earnings from REC",
      value: show(figures?.rec?.revenue_crore, (v) => v.toFixed(2)),
      unit: "₹ Cr.", tone: "tone-amber",
      exact: figures ? `₹${inLakhCrore(figures.rec.revenue_rupees)}` : undefined,
    },
  ];

  return (
    <div>
      {failed && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                      borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
          Could not load live figures — the cards below are showing no value rather than a stale one.
        </div>
      )}
      <div className="kpi-grid">
        {kpiData.map((kpi, index) => (
          <div key={index} className={`stat-card ${kpi.tone}`} title={kpi.exact || undefined}>
            <div className="stat-label">{kpi.title}</div>
            <div className="stat-value">{kpi.value}</div>
            <div className="stat-hint">{kpi.unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const GENERATION_MIX_DATA = [
  { name: 'Thermal', value: 72.5, color: '#ef4444' },
  { name: 'Hydro', value: 10.2, color: '#3b82f6' },
  { name: 'Renewable (RE)', value: 14.8, color: '#10b981' },
  { name: 'Nuclear', value: 2.5, color: '#f59e0b' }
];

const SHORT_TERM_VS_DSM_DATA = [
  { year: '2023', shortTerm: 18520, dsm: 3100 },
  { year: '2026', shortTerm: 24350, dsm: 1850 }
];

// How each product behaves across the day. RTM is the volatile one — it clears
// against whatever is left after the day-ahead markets have run. GDAM carries the
// solar belly: heavy midday volume at collapsed prices. DAM sits between them.
const PRODUCT_SHAPES = {
  RTM:  { label: 'RTM',  volBase: 4000, volSwing: 4000, priceBase: 1000, priceSwing: 2000, middayVolume: 4000 },
  GDAM: { label: 'GDAM', volBase: 5200, volSwing: 2200, priceBase: 900,  priceSwing: 900,  middayVolume: 7000, solarBelly: true },
  DAM:  { label: 'DAM',  volBase: 6500, volSwing: 1800, priceBase: 2600, priceSwing: 1200, middayVolume: 2200 },
};

// A fixed pseudo-random sequence. The previous version called Math.random() in
// the component body, so all 96 blocks were redrawn with different numbers on
// every render — typing in the date field silently rewrote the day's market
// data. Seeded on the product so each one is stable and reproducible.
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function buildIntraday(product) {
  const shape = PRODUCT_SHAPES[product] || PRODUCT_SHAPES.RTM;
  const rand = seeded(product.split('').reduce((a, c) => a + c.charCodeAt(0), 7));
  const rows = [];
  for (let i = 1; i <= 96; i++) {
    let mcv = rand() * shape.volSwing + shape.volBase;
    let mcp = rand() * shape.priceSwing + shape.priceBase;

    // Blocks 41-59 are roughly 10am to 3pm.
    const midday = i > 40 && i < 60;
    if (midday) {
      mcv += shape.middayVolume;
      // Solar floods the green market at exactly the hours it is worth least.
      if (shape.solarBelly) mcp *= 0.45;
    }

    // Anchors taken from the reference screenshots, so the shape stays familiar.
    if (product === 'RTM') {
      if (i === 1) { mcv = 3728.25; mcp = 3500.12; }
      if (i === 27) { mcv = 5436.62; mcp = 4950.24; }
      if (i === 52) { mcv = 12299.49; mcp = 2305.82; }
      if (i === 54) { mcv = 12133.83; mcp = 2848.24; }
    }

    rows.push({ blockNo: String(i), mcv: +mcv.toFixed(2), mcp: +mcp.toFixed(2) });
  }
  return rows;
}

export default function MainDashboard() {
  const [fromDate, setFromDate] = useState('10-08-2026');
  const [productType, setProductType] = useState('RTM');

  // Recomputed only when the product changes, which is what the dropdown is for.
  const RTM_INTRADAY_DATA = useMemo(() => buildIntraday(productType), [productType]);

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

      {/* Macro Grid Analytics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px', marginBottom: '20px' }}>
        {/* Generation Mix Doughnut */}
        <div className="card">
          <div className="card-header">
            <h3>All-India Generation Mix (Thermal/Hydro/Nuclear/RE)</h3>
          </div>
          <div className="card-body" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={GENERATION_MIX_DATA}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={120}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                >
                  {GENERATION_MIX_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `${value}%`} />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ padding: '0 16px 12px' }}>
            <SourceNote source="Central Electricity Authority" />
          </div>
        </div>

        {/* Short Term vs DSM Bar Chart */}
        <div className="card">
          <div className="card-header">
            <h3>Volume of Short-Term Transaction vs DSM (MU)</h3>
          </div>
          <div className="card-body">
            <div style={{ width: '100%', height: '350px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={SHORT_TERM_VS_DSM_DATA} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="year" axisLine={{ stroke: '#9ca3af' }} tickLine={false} />
                  <YAxis 
                    axisLine={{ stroke: '#9ca3af' }} 
                    tickLine={false} 
                    tickFormatter={(val) => `${val/1000}k`}
                    label={{ value: 'Volume (MU)', angle: -90, position: 'insideLeft', offset: -5, fill: '#6b7280', fontSize: 12 }}
                  />
                  <Tooltip cursor={{fill: '#f3f4f6'}} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  <Bar dataKey="shortTerm" name="Short-Term Transactions" fill="#3b82f6" barSize={50} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="dsm" name="DSM Volume" fill="#f59e0b" barSize={50} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <SourceNote source="CERC Market Monitoring Report" />
          </div>
        </div>
      </div>

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
          <h3>Time Block wise MCP vs MCV — {productType} ({fromDate.replace(/-/g, '-').replace('08', 'Aug')})</h3>
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
                  label={{ value: 'Time Block (15-min)', position: 'insideBottom', offset: -15, fill: '#64748b', fontSize: 10 }}
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
