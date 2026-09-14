import React from 'react';
import { Card } from '../../components/ui.jsx';
import { 
  PieChart, Pie, Cell, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';

const LICENSEE_DATA = [
  { name: 'PTC India Ltd.', value: 34.92, color: '#3b82f6' },
  { name: 'Powerpulse Trading Solutions Ltd.', value: 22.50, color: '#22c55e' },
  { name: 'NTPC Vidyut Vyapar Nigam Ltd.', value: 14.10, color: '#ef4444' },
  { name: 'Manikaran Power Ltd.', value: 11.80, color: '#eab308' },
  { name: 'JSW Power Trading Company Ltd', value: 7.20, color: '#06b6d4' },
  { name: 'Tata Power Trading Company (P) Ltd.', value: 5.40, color: '#10b981' },
  { name: 'Greenko Energies Pvt Ltd', value: 4.08, color: '#f97316' },
];

const REC_DEPTH_DATA = [
  { exchange: 'IEX', tradedVolume: 2391262, buyBid: 2677612, sellBid: 5479776, price: 337 },
  { exchange: 'PXIL', tradedVolume: 1224307, buyBid: 1485457, sellBid: 4372278, price: 336 },
  { exchange: 'HPX', tradedVolume: 380500, buyBid: 460000, sellBid: 1400000, price: 255 },
  { exchange: 'Bilateral', tradedVolume: 150000, buyBid: 0, sellBid: 0, price: 350 },
];

const PXIL_VOLUME_DATA = [
  { name: 'GDAM', value: 95.5, color: '#a3e635' },
  { name: 'DAM', value: 3.5, color: '#60a5fa' },
  { name: 'RTM', value: 0.8, color: '#fb923c' },
  { name: 'HP-DAM', value: 0.2, color: '#4b5563' },
];

const HPX_VOLUME_DATA = [
  { name: 'DAM', value: 92.4, color: '#60a5fa' },
  { name: 'GDAM', value: 4.5, color: '#a3e635' },
  { name: 'RTM', value: 2.1, color: '#fb923c' },
  { name: 'HP-DAM', value: 1.0, color: '#4b5563' },
];

const CustomREC_Tooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', borderRadius: 6, padding: 16, fontSize: 13, minWidth: 280, zIndex: 50 }}>
        <div style={{ color: 'var(--text-muted)', fontWeight: 500, marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{label}</div>
        
        {/* We expect the 4 payloads in order: Traded Vol, Buy Bid, Sell Bid, Price. Let's find them manually for exact styling */}
        {payload.map((entry, index) => {
          let labelText = '';
          let color = '';
          if (entry.dataKey === 'price') { labelText = 'Weighted Average Price'; color = '#f43f5e'; }
          if (entry.dataKey === 'tradedVolume') { labelText = 'Traded Volume'; color = '#3b82f6'; }
          if (entry.dataKey === 'buyBid') { labelText = 'Volume of Buy Bid'; color = '#2dd4bf'; }
          if (entry.dataKey === 'sellBid') { labelText = 'Volume of Sell Bid'; color = '#eab308'; }

          return (
            <div key={`rec-item-${index}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                 <span style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: color}}></span>
                 <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{labelText}</span>
              </div>
              <span style={{ fontWeight: 700, color: 'var(--text)', marginLeft: 24 }}>
                 {entry.value ? entry.value.toLocaleString() : '0'}
              </span>
            </div>
          );
        })}
      </div>
    );
  }
  return null;
};

// Custom Pie Chart Label for Licensees
const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index, name }) => {
  const RADIAN = Math.PI / 180;
  const radius = outerRadius * 1.3;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  if (percent < 0.05) return null; // Hide labels for very small segments to prevent overlap

  return (
    <text x={x} y={y} fill="#64748b" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11}>
      {name}
    </text>
  );
};


export default function MacroTradingIntelligenceWidget() {
  return (
    <div>
      
      {/* Top Row: Licensee Market Share & REC Market Depth */}
      <div className="grid-2">
        
        {/* Licensee Market Share Pie */}
        <div style={{ background: 'var(--surface)', padding: 24, border: '1px solid var(--border)', borderRadius: 2, boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text)', marginBottom: 24, fontSize: 17 }}>% Share of Electricity Transacted By Top 7 Trading Licensees</h3>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={LICENSEE_DATA} 
                  dataKey="value" 
                  nameKey="name" 
                  cx="50%" 
                  cy="50%" 
                  outerRadius={100} 
                  label={renderCustomizedLabel}
                  labelLine={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                >
                  {LICENSEE_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value) => [`${value}%`, 'Market Share']} 
                  contentStyle={{borderRadius: '6px', padding: '10px'}} 
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          
          {/* Custom Grid Legend */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', rowGap: 8, marginTop: 16, fontSize: 11, color: 'var(--text-muted)', paddingLeft: 16, paddingRight: 16 }}>
             {LICENSEE_DATA.map((entry, index) => (
               <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                 <div style={{ width: 14, height: 10, borderRadius: 2, backgroundColor: entry.color}}></div>
                 <span title={entry.name}>{entry.name}</span>
               </div>
             ))}
          </div>
        </div>

        {/* REC Market Depth Chart */}
        <div style={{ background: '#f8f9fa', padding: 24, border: '1px solid var(--border)', borderRadius: 2, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text)', marginBottom: 8, fontSize: 17 }}>Vol & Price Of RECs Transacted Through PX & Traders (Bilateral)</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, paddingLeft: 40, paddingRight: 40 }}>
            <span>Volume (MWh)</span>
            <span>Price (₹/MWh)</span>
          </div>

          <div style={{ height: 300, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={REC_DEPTH_DATA} margin={{ top: 20, right: 20, bottom: 20, left: 40 }}>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                
                <XAxis 
                  dataKey="exchange" 
                  tick={{fontSize: 12, fill: '#4b5563', fontWeight: 600}} 
                  axisLine={{ stroke: '#9ca3af' }}
                  tickLine={false}
                  tickMargin={10}
                />
                
                <YAxis 
                  yAxisId="left" 
                  tick={{fontSize: 11, fill: '#6b7280'}} 
                  axisLine={false} 
                  tickLine={false} 
                  domain={[0, 6000000]} 
                  tickFormatter={(val) => val.toLocaleString()}
                  dx={-10}
                />
                
                <YAxis 
                  yAxisId="right" 
                  orientation="right" 
                  tick={{fontSize: 11, fill: '#6b7280'}} 
                  axisLine={false} 
                  tickLine={false} 
                  domain={[0, 400]}
                  dx={10} 
                />
                
                <Tooltip content={<CustomREC_Tooltip />} cursor={{fill: 'rgba(0,0,0,0.04)'}} />
                
                {/* Notice the order is specific to render nicely: Price is rendered last so it's on top.
                    The payload order in tooltip is determined by the order here. Let's arrange them logically. */}
                <Line yAxisId="right" type="monotone" dataKey="price" stroke="#f43f5e" strokeWidth={2.5} dot={{r: 4, stroke: '#f43f5e', fill: '#fff', strokeWidth: 2}} activeDot={{r: 6}} />
                <Bar yAxisId="left" dataKey="tradedVolume" fill="#3b82f6" barSize={25} />
                <Bar yAxisId="left" dataKey="buyBid" fill="#2dd4bf" barSize={25} />
                <Bar yAxisId="left" dataKey="sellBid" fill="#eab308" barSize={25} />
                
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Bottom Row: Exchange Volume Transactions */}
      <div className="grid-2">
        
        {/* PXIL Volume Pie */}
        <Card title="Volume Transactions in PXIL (MU)">
           <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={PXIL_VOLUME_DATA} 
                  dataKey="value" 
                  nameKey="name" 
                  cx="50%" 
                  cy="50%" 
                  outerRadius={90} 
                  label={({name}) => name}
                  labelLine={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                >
                  {PXIL_VOLUME_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value}%`, name]} contentStyle={{borderRadius: '6px'}} />
                <Legend verticalAlign="bottom" height={36} iconType="square" wrapperStyle={{fontSize: '12px', paddingTop: '20px'}}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* HPX Volume Pie */}
        <Card title="Volume Transactions in HPX (MU)">
           <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={HPX_VOLUME_DATA} 
                  dataKey="value" 
                  nameKey="name" 
                  cx="50%" 
                  cy="50%" 
                  outerRadius={90} 
                  label={({name}) => name}
                  labelLine={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                >
                  {HPX_VOLUME_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value}%`, name]} contentStyle={{borderRadius: '6px'}} />
                <Legend verticalAlign="bottom" height={36} iconType="square" wrapperStyle={{fontSize: '12px', paddingTop: '20px'}}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

      </div>

    </div>
  );
}
