import React from 'react';
import { 
  LineChart, Line, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const COLLECTIVE_MARKET_DATA = [
  { segment: 'IEX-DAM', max: 10.00, min: 1.43, weightedAvg: 3.82 },
  { segment: 'IEX-GDAM', max: 10.00, min: 1.60, weightedAvg: 4.06 },
  { segment: 'IEX-HPDAM', max: 0, min: 0, weightedAvg: 0 },
  { segment: 'IEX-RTM', max: 5.92, min: 10.00, weightedAvg: 11.00 },
  { segment: 'PXIL-DAM', max: 10.00, min: 10.00, weightedAvg: 10.00 },
  { segment: 'PXIL-GDAM', max: 0, min: 0, weightedAvg: 0 },
  { segment: 'PXIL-HPDAM', max: 0, min: 0, weightedAvg: 0 },
  { segment: 'PXIL-RTM', max: 0, min: 10.00, weightedAvg: 0 },
  { segment: 'HPX-DAM', max: 10.00, min: 10.00, weightedAvg: 10.00 },
  { segment: 'HPX-GDAM', max: 0, min: 0, weightedAvg: 0 },
  { segment: 'HPX-HPDAM', max: 0, min: 0, weightedAvg: 0 },
  { segment: 'HPX-RTM', max: 0, min: 0, weightedAvg: 0 },
];

const REC_DATA = [
  { exchange: 'IEX', vol1: 2400000, vol2: 2700000, vol3: 5500000, price: 340 },
  { exchange: 'PXIL', vol1: 1200000, vol2: 1500000, vol3: 4400000, price: 340 },
  { exchange: 'HPX', vol1: 400000, vol2: 480000, vol3: 1400000, price: 260 },
  { exchange: 'Bilateral', vol1: 150000, vol2: 0, vol3: 0, price: 350 },
];

const CustomCollectiveTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', borderRadius: 6, padding: 12, fontSize: 13, minWidth: 220, zIndex: 50 }}>
        <div style={{ color: 'var(--text-muted)', fontWeight: 700, borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 12 }}>{label}</div>
        
        {payload.map((entry, index) => (
          <div key={`item-${index}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
               <span style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: entry.color}}></span>
               <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{entry.name}</span>
            </div>
            <span style={{ fontWeight: 700, color: 'var(--text)', marginLeft: 24 }}>
               {entry.value !== null && entry.value !== undefined ? entry.value.toFixed(2) : '0.00'}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function CollectiveMarketAnalyticsWidget() {
  return (
    <div>
      
      {/* Min Max & Avg Line Chart */}
      <div style={{ background: 'var(--surface)', padding: 24, border: '1px solid var(--border)', borderRadius: 2, boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
           <h3 style={{ fontWeight: 700, color: 'var(--text)', fontSize: 20 }}>Min Max and Weight Avg Price of Collective Market in PX</h3>
        </div>
        
        <div style={{ height: 320, width: '100%', paddingLeft: 16, paddingRight: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={COLLECTIVE_MARKET_DATA} margin={{ top: 20, right: 30, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
              <XAxis 
                dataKey="segment" 
                tick={{fontSize: 11, fill: '#64748b'}} 
                angle={-30} 
                textAnchor="end"
                interval={0}
                tickMargin={10}
              />
              <YAxis 
                tick={{fontSize: 12, fill: '#64748b'}} 
                domain={[0, 12]}
                tickCount={7}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomCollectiveTooltip />} cursor={{ fill: '#f1f5f9' }} />
              <Legend 
                verticalAlign="bottom" 
                height={36} 
                wrapperStyle={{fontSize: '13px', paddingTop: '40px', paddingBottom: '10px'}}
                iconType="circle"
              />
              <Line type="monotone" dataKey="weightedAvg" name="Weighted Average" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 4, stroke: '#22c55e', fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="min" name="Minimum" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4, stroke: '#3b82f6', fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="max" name="Maximum" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 4, stroke: '#ef4444', fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* REC Transacted Volume & Price Chart */}
      <div style={{ background: '#f8f9fa', padding: 24, border: '1px solid var(--border)', borderRadius: 2, boxShadow: 'var(--shadow-sm)' }}>
        <h3 style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text)', marginBottom: 8, fontSize: 20 }}>Vol & Price Of RECs Transacted Through PX & Traders (Bilateral)</h3>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, paddingLeft: 40, paddingRight: 40 }}>
          <span>Volume (MWh)</span>
          <span>Price (₹/MWh)</span>
        </div>

        <div style={{ height: 320, width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={REC_DATA} margin={{ top: 20, right: 20, bottom: 20, left: 40 }}>
              <CartesianGrid stroke="#e5e7eb" vertical={false} />
              
              <XAxis 
                dataKey="exchange" 
                tick={{fontSize: 12, fill: '#4b5563', fontWeight: 500}} 
                axisLine={{ stroke: '#9ca3af' }}
                tickLine={false}
                tickMargin={10}
              />
              
              <YAxis 
                yAxisId="left" 
                tick={{fontSize: 12, fill: '#6b7280'}} 
                axisLine={false} 
                tickLine={false} 
                domain={[0, 6000000]} 
                tickFormatter={(val) => val.toLocaleString()}
                dx={-10}
              />
              
              <YAxis 
                yAxisId="right" 
                orientation="right" 
                tick={{fontSize: 12, fill: '#6b7280'}} 
                axisLine={false} 
                tickLine={false} 
                domain={[0, 400]}
                dx={10} 
              />
              
              <Tooltip cursor={{fill: 'rgba(0,0,0,0.05)'}} />
              
              <Bar yAxisId="left" dataKey="vol1" name="Volume Type 1" fill="#3b82f6" barSize={30} />
              <Bar yAxisId="left" dataKey="vol2" name="Volume Type 2" fill="#2dd4bf" barSize={30} />
              <Bar yAxisId="left" dataKey="vol3" name="Volume Type 3" fill="#eab308" barSize={30} />
              
              <Line yAxisId="right" type="monotone" dataKey="price" name="Price (₹/MWh)" stroke="#f97316" strokeWidth={2.5} dot={{r: 4, stroke: '#f97316', fill: '#fff', strokeWidth: 2}} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Collective Market Price Metrics Table */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, boxShadow: 'var(--shadow-sm)', overflow: 'hidden', marginTop: 32 }}>
        <table className="report-table">
          <thead>
            <tr style={{ background: '#4eb1fc', color: '#fff' }}>
              <th style={{ padding: 12, borderRight: '1px solid var(--border)', borderColor: 'rgba(255,255,255,0.25)', fontWeight: 600, width: 128 }}>PX</th>
              <th style={{ padding: 12, borderRight: '1px solid var(--border)', borderColor: 'rgba(255,255,255,0.25)', fontWeight: 600, textAlign: 'left' }}>Product</th>
              <th>Maximum Price<br/>(₹/kWh)</th>
              <th>Minimum Price<br/>(₹/kWh)</th>
              <th style={{ padding: 12, fontWeight: 600 }}>Weighted Average<br/>Price (₹/kWh)</th>
            </tr>
          </thead>
          <tbody style={{ color: 'var(--text)' }}>
            {/* IEX Section */}
            <tr>
              <td rowSpan={4}>IEX</td>
              <td>DAM</td>
              <td>10.00</td>
              <td>1.43</td>
              <td>3.82</td>
            </tr>
            <tr>
              <td>GDAM</td>
              <td>10.00</td>
              <td>1.60</td>
              <td>4.06</td>
            </tr>
            <tr>
              <td>HPDAM</td>
              <td>0.00</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>RTM</td>
              <td>5.92</td>
              <td>10.00</td>
              <td>11.00</td>
            </tr>

            {/* PXIL Section */}
            <tr>
              <td rowSpan={4}>PXIL</td>
              <td>DAM</td>
              <td>10.00</td>
              <td>10.00</td>
              <td>10.00</td>
            </tr>
            <tr>
              <td>GDAM</td>
              <td>0.00</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>HPDAM</td>
              <td>0.00</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>RTM</td>
              <td>0.00</td>
              <td>10.00</td>
              <td>0.00</td>
            </tr>

            {/* HPX Section */}
            <tr>
              <td rowSpan={4}>HPX</td>
              <td>DAM</td>
              <td>10.00</td>
              <td>10.00</td>
              <td>10.00</td>
            </tr>
            <tr>
              <td>GDAM</td>
              <td>0.00</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>HPDAM</td>
              <td>0.00</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>RTM</td>
              <td>0.00</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  );
}
