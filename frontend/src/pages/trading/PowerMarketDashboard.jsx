import React, { useState } from 'react';
import { 
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';

// Data Mocks based on the screenshot analysis
const RTM_DATA = [
  { date: '07-Aug-2026', sellVolume: 1641043.6, buyVolume: 789360.1, mcp: 2130.45 },
  { date: '08-Aug-2026', sellVolume: 1680000.0, buyVolume: 820000.0, mcp: 2100.00 },
  { date: '09-Aug-2026', sellVolume: 1900000.0, buyVolume: 880000.0, mcp: 1950.00 },
  { date: '10-Aug-2026', sellVolume: 1180000.0, buyVolume: 580000.0, mcp: 2200.00 },
];

const INTRADAY_BLOCK_DATA = [
  { blockNo: '1', mcv: 5428.6, mcp: 3329.73 },
  { blockNo: '2', mcv: 5406.1, mcp: 3219.16 },
  { blockNo: '3', mcv: 5297.66, mcp: 3100.65 },
  { blockNo: '4', mcv: 5138.59, mcp: 3100.67 },
  { blockNo: '5', mcv: 5050.7, mcp: 3219.54 },
  { blockNo: '6', mcv: 5097.89, mcp: 3100.2 },
  { blockNo: '7', mcv: 4916.9, mcp: 3059.66 },
  { blockNo: '8', mcv: 4706.7, mcp: 2999.52 },
  { blockNo: '9', mcv: 4656.3, mcp: 2929.42 },
  { blockNo: '10', mcv: 4367.4, mcp: 2672.77 },
  { blockNo: '11', mcv: 4211.7, mcp: 2672.22 },
  { blockNo: '12', mcv: 4181.4, mcp: 2672.15 },
  { blockNo: '13', mcv: 4509.41, mcp: 2305.32 },
  { blockNo: '14', mcv: 4462.47, mcp: 2171.94 },
  { blockNo: '15', mcv: 4282.53, mcp: 2171.37 },
  { blockNo: '16', mcv: 4128.66, mcp: 2169.07 },
  { blockNo: '17', mcv: 3733.03, mcp: 2029.61 },
  { blockNo: '18', mcv: 3708.54, mcp: 2029.5 },
  { blockNo: '19', mcv: 3732.75, mcp: 2029.36 },
  { blockNo: '20', mcv: 4088.4, mcp: 2100.14 },
  { blockNo: '21', mcv: 5017.6, mcp: 2390.03 },
  { blockNo: '22', mcv: 4953.0, mcp: 2570.41 },
  { blockNo: '23', mcv: 5370.21, mcp: 3100.01 },
  { blockNo: '24', mcv: 6148.3, mcp: 3579.78 },
  { blockNo: '25', mcv: 6722.5, mcp: 4199.63 },
  { blockNo: '26', mcv: 7562.7, mcp: 4199.94 },
  { blockNo: '27', mcv: 8340.5, mcp: 4329.13 },
  { blockNo: '28', mcv: 8768.3, mcp: 4146.63 },
  { blockNo: '29', mcv: 8504.17, mcp: 4000.55 },
  { blockNo: '30', mcv: 8601.9, mcp: 3614.88 },
  { blockNo: '31', mcv: 8559.9, mcp: 3282.92 },
  { blockNo: '32', mcv: 8220.9, mcp: 2999.75 },
  { blockNo: '33', mcv: 8400.2, mcp: 2100.67 },
  { blockNo: '34', mcv: 8305.3, mcp: 2100.16 },
  { blockNo: '35', mcv: 8427.0, mcp: 1928.4 },
  { blockNo: '36', mcv: 9007.3, mcp: 1928.17 },
  { blockNo: '37', mcv: 9969.2, mcp: 1819.13 },
  { blockNo: '38', mcv: 10424.15, mcp: 1760.78 },
  { blockNo: '39', mcv: 11279.35, mcp: 1760.18 },
  { blockNo: '40', mcv: 11312.8, mcp: 1699.3 },
  { blockNo: '41', mcv: 10556.9, mcp: 1504.49 },
  { blockNo: '42', mcv: 10387.7, mcp: 1499.33 },
  { blockNo: '43', mcv: 10503.7, mcp: 1342.46 },
  { blockNo: '44', mcv: 10747.6, mcp: 1366.25 },
  { blockNo: '45', mcv: 10541.7, mcp: 1260.31 },
  { blockNo: '46', mcv: 10444.4, mcp: 1111.92 },
  { blockNo: '47', mcv: 10344.4, mcp: 1111.62 },
  { blockNo: '48', mcv: 10541.9, mcp: 1111.64 },
  { blockNo: '49', mcv: 10617.2, mcp: 1111.47 },
  { blockNo: '50', mcv: 10872.7, mcp: 1111.43 },
  { blockNo: '51', mcv: 10826.3, mcp: 1111.4 },
  { blockNo: '52', mcv: 10804.1, mcp: 1111.4 },
  { blockNo: '53', mcv: 10400.8, mcp: 1111.26 },
  { blockNo: '54', mcv: 10327.5, mcp: 1111.25 },
  { blockNo: '55', mcv: 10131.7, mcp: 1111.41 },
  { blockNo: '56', mcv: 10485.5, mcp: 1111.51 },
  { blockNo: '57', mcv: 10604.7, mcp: 1111.71 },
  { blockNo: '58', mcv: 10806.6, mcp: 1111.69 },
  { blockNo: '59', mcv: 10955.5, mcp: 1169.4 },
  { blockNo: '60', mcv: 11069.6, mcp: 1342.33 },
  { blockNo: '61', mcv: 10617.3, mcp: 1525.87 },
  { blockNo: '62', mcv: 10493.8, mcp: 1689.22 },
];
// Fill rest to 96
for(let i=63; i<=96; i++) {
  INTRADAY_BLOCK_DATA.push({ blockNo: i.toString(), mcv: Math.random() * 5000 + 4000, mcp: Math.random() * 2000 + 2000 });
}

const GDAM_DATA = [
  { date: '07-Aug-2026', sellVolume: 165000.0, buyVolume: 580000.0, mcp: 3450.00 },
  { date: '08-Aug-2026', sellVolume: 168000.0, buyVolume: 350000.0, mcp: 3300.00 },
  { date: '09-Aug-2026', sellVolume: 172360.2, buyVolume: 282266.0, mcp: 3114.13 },
  { date: '10-Aug-2026', sellVolume: 190000.0, buyVolume: 450000.0, mcp: 3200.00 },
];

const DAM_OVERALL_DATA = [
  { date: '07-Aug-2026', sellVolume: 1986701.3, buyVolume: 1617013.9, mcp: 4510.65 },
  { date: '08-Aug-2026', sellVolume: 2084305.9, buyVolume: 1205482.1, mcp: 4100.93 },
  { date: '09-Aug-2026', sellVolume: 2387506.6, buyVolume: 860460.3, mcp: 2413.29 },
  { date: '10-Aug-2026', sellVolume: 2283858.7, buyVolume: 1134406.8, mcp: 3772.46 },
];

export default function PowerMarketDashboard() {
  const [fromDate, setFromDate] = useState('07-08-2026');
  const [toDate, setToDate] = useState('10-08-2026');
  const [productType, setProductType] = useState('RTM');

  // Select active dataset
  let activeData = RTM_DATA;
  if (productType === 'GDAM') activeData = GDAM_DATA;
  if (productType === 'DAM') activeData = DAM_OVERALL_DATA;

  const CustomChartTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '4px', padding: '12px', fontSize: '12px', boxShadow: 'var(--shadow)', zIndex: 50 }}>
          <div style={{ color: 'var(--text-muted)', marginBottom: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '4px', fontWeight: 600 }}>{label}</div>
          {payload.map((entry, index) => (
            <div key={`item-${index}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: entry.color }}></div>
              <span style={{ fontWeight: 500, color: 'var(--text)' }}>{entry.name}:</span>
              <span style={{ fontWeight: 700, color: '#0f172a', marginLeft: 'auto' }}>
                {entry.value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div>
      
      {/* Top Main Header */}
      <div className="page-header">
        <div>
          <h1>SJVN Power Market Dashboard</h1>
          <div className="page-subtitle">Market clearing volumes and pricing data</div>
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
          <label style={{ fontSize: '13px', fontWeight: 600 }}>To Date*</label>
          <input 
            type="text" 
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
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
            <option value="DAM">DAM (Overall)</option>
          </select>
        </div>

        <button className="btn btn-primary" style={{ marginLeft: '12px' }}>
          Show Graph
        </button>
      </div>

      {/* Main Chart Card */}
      <div className="card">
        
        <div className="card-header">
          <h3>
            Day wise Buy Volume V/s Sell Volume V/s MCP (for dates from: {fromDate.replace(/-/g, '-')} to {toDate.replace(/-/g, '-')})
          </h3>
        </div>

        <div className="card-body">
          <div style={{ width: '100%', height: '450px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={activeData} barGap={4} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                
                <XAxis 
                  dataKey="date" 
                  tick={{fontSize: 11, fill: '#4b5563', angle: -45, textAnchor: 'end'}} 
                  axisLine={{ stroke: '#9ca3af' }}
                  tickLine={false}
                  height={60}
                />
                
                {/* Left Y Axis for Volumes */}
                <YAxis 
                  yAxisId="left" 
                  tick={{fontSize: 11, fill: '#4b5563'}} 
                  axisLine={{ stroke: '#9ca3af' }}
                  tickLine={false} 
                  tickFormatter={(val) => val.toLocaleString()}
                  label={{ value: 'Volume (MWh)', angle: -90, position: 'insideLeft', offset: -10, fill: '#6b7280', fontSize: 12 }}
                />
                
                {/* Right Y Axis for MCP */}
                <YAxis 
                  yAxisId="right" 
                  orientation="right" 
                  tick={{fontSize: 11, fill: '#4b5563'}} 
                  axisLine={{ stroke: '#9ca3af' }}
                  tickLine={false} 
                  tickFormatter={(val) => val.toLocaleString()}
                  label={{ value: 'MCP (₹/MWh)', angle: 90, position: 'insideRight', offset: 0, fill: '#6b7280', fontSize: 12 }}
                />
                
                <Tooltip content={<CustomChartTooltip />} cursor={{fill: '#f3f4f6'}} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{fontSize: '12px', color: '#4b5563', paddingTop: '20px'}}/>
                
                {/* Bars and Line mapping exactly to screenshot colors */}
                <Bar yAxisId="left" dataKey="sellVolume" name="Sell Volume" fill="#5c82e6" barSize={40} />
                <Bar yAxisId="left" dataKey="buyVolume" name="Buy Volume" fill="#a4df87" barSize={40} />
                <Line yAxisId="right" type="linear" dataKey="mcp" name="MCP" stroke="#ef4444" strokeWidth={2} dot={{r: 4, fill: '#ef4444'}} activeDot={{r: 6}} />
                
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Data Table View (Only visible for DAM to match Screenshot 1) */}
      {productType === 'DAM' && (
        <div className="card" style={{ maxWidth: '900px' }}>
          <div className="card-header">
            <h3 style={{ textAlign: 'center', width: '100%' }}>
              Day wise Buy Volume V/s Sell Volume V/s MCP (for dates from: {fromDate} to {toDate})
            </h3>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead style={{ background: 'var(--primary)', color: '#fff' }}>
                  <tr>
                    <th style={{ padding: '10px 14px', border: '1px solid #fff' }}>Category</th>
                    <th style={{ padding: '10px 14px', border: '1px solid #fff', textAlign: 'right' }}>Sell Volume</th>
                    <th style={{ padding: '10px 14px', border: '1px solid #fff', textAlign: 'right' }}>Buy Volume</th>
                    <th style={{ padding: '10px 14px', border: '1px solid #fff', textAlign: 'right' }}>MCP</th>
                  </tr>
                </thead>
                <tbody>
                  {activeData.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border)', background: '#fff' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{row.date}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>{row.sellVolume.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>{row.buyVolume.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>{row.mcp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Intraday 96-Block Deep Dive */}
      <div className="card" style={{ background: '#0f172a', color: '#f1f5f9', border: 'none' }}>
        <div className="card-header" style={{ borderBottom: '1px solid #334155' }}>
          <h3 style={{ color: '#fff' }}>Time Block wise MCP vs MCV (10-Aug-2026)</h3>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>Product: GDAM</span>
        </div>

        <div className="card-body">
          <div style={{ width: '100%', height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={INTRADAY_BLOCK_DATA} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                <XAxis 
                  dataKey="blockNo" 
                  stroke="#64748b" 
                  fontSize={10} 
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                />
                <YAxis 
                  yAxisId="mcv" 
                  stroke="#f97316" 
                  fontSize={10} 
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val) => `${val/1000}k`}
                  label={{ value: 'MCV (MWh)', angle: -90, position: 'insideLeft', fill: '#f97316', fontSize: 10 }} 
                />
                <YAxis 
                  yAxisId="mcp" 
                  orientation="right" 
                  stroke="#a855f7" 
                  fontSize={10} 
                  axisLine={false}
                  tickLine={false}
                  label={{ value: 'MCP (₹/MWh)', angle: 90, position: 'insideRight', fill: '#a855f7', fontSize: 10 }} 
                />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '4px', fontSize: '11px', color: '#fff' }} />
                <Bar yAxisId="mcv" dataKey="mcv" name="MCV (MWh)" fill="#f97316" radius={[2, 2, 0, 0]} barSize={4} />
                <Bar yAxisId="mcp" dataKey="mcp" name="MCP (₹/MWh)" fill="#a855f7" radius={[2, 2, 0, 0]} barSize={4} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

    </div>
  );
}
