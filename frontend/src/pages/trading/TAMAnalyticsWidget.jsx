import React from 'react';
import { 
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

const ENLARGED_TAM_DATA = [
  { name: 'Any Day Single Sided Contracts', exchange: 'HPX', volume: 164.88, price: 4.71 },
  { name: 'Daily Contracts', exchange: 'HPX', volume: 234.49, price: 5.95 },
  { name: 'Day Ahead Contingency Contracts', exchange: 'HPX', volume: 0, price: 0 },
  { name: 'Intra Day Contracts', exchange: 'HPX', volume: 0, price: 0 },
  { name: 'Monthly Contracts', exchange: 'HPX', volume: 504.01, price: 4.62 },
  { name: 'Weekly Contracts', exchange: 'HPX', volume: 685.15, price: 5.40 },
  
  { name: 'Any Day Single Sided Contracts', exchange: 'IEX', volume: 0, price: 0 },
  { name: 'Daily Contracts', exchange: 'IEX', volume: 0, price: 0 },
  { name: 'Day Ahead Contingency Contracts', exchange: 'IEX', volume: 622.07, price: 4.49 },
  { name: 'Intra Day Contracts', exchange: 'IEX', volume: 207.43, price: 6.03 },
  { name: 'Monthly Contracts', exchange: 'IEX', volume: 47.11, price: 4.50 },
  { name: 'Weekly Contracts', exchange: 'IEX', volume: 0, price: 0 },

  { name: 'Any Day Single Sided Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Daily Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Day Ahead Contingency Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Intra Day Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Monthly Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Weekly Contracts', exchange: 'PXIL', volume: 0, price: 0 },
];

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', padding: 12, borderRadius: 6, fontSize: 13, minWidth: 200, zIndex: 50 }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{label}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
             <span style={{ width: 10, height: 10, borderRadius: 999, background: '#4b8ce3' }}></span>
             <span className="audit-muted">TAM Actual Scheduled Volume (MU)</span>
          </div>
          <span style={{ fontWeight: 600, color: 'var(--text)', marginLeft: 16 }}>
             {payload[0].value.toFixed(2)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
             <span style={{ width: 10, height: 10, borderRadius: 999, background: '#df5661' }}></span>
             <span className="audit-muted">TAM Weighted Average Price (₹/kWh)</span>
          </div>
          <span style={{ fontWeight: 600, color: 'var(--text)', marginLeft: 16 }}>
             {payload[1].value.toFixed(2)}
          </span>
        </div>
      </div>
    );
  }
  return null;
};

export default function TAMAnalyticsWidget() {
  return (
    <div>
      
      {/* Enlarged TAM Chart */}
      <div style={{ background: 'var(--surface)', padding: 16, border: '1px solid var(--border)', borderRadius: 2, boxShadow: 'var(--shadow-sm)' }}>
        <h3 style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text)', marginBottom: 8, fontSize: 17 }}>Volume and Price of Electricity Under TAM in PX's</h3>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, paddingLeft: 40, paddingRight: 40 }}>
          <span>TAM Actual Scheduled Volume (MU)</span>
          <span>TAM Weighted Average Price (₹/kWh)</span>
        </div>

        <div style={{ height: 320, width: '100%', marginBottom: 40 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={ENLARGED_TAM_DATA} margin={{ top: 20, right: 20, bottom: 60, left: 20 }}>
              <CartesianGrid stroke="#eee" vertical={false} />
              
              <XAxis 
                dataKey="name" 
                tick={{fontSize: 10, fill: '#666'}} 
                angle={-45} 
                textAnchor="end"
                interval={0}
              />
              
              <YAxis yAxisId="left" tick={{fontSize: 12, fill: '#666'}} axisLine={false} tickLine={false} domain={[0, 700]} />
              <YAxis yAxisId="right" orientation="right" tick={{fontSize: 12, fill: '#666'}} axisLine={false} tickLine={false} domain={[0, 7]} />
              
              {/* Tooltip with crosshairs enabled */}
              <Tooltip 
                cursor={{ stroke: '#ccc', strokeWidth: 1, strokeDasharray: '5 5' }} 
                content={<CustomTooltip />} 
              />
              
              <Bar yAxisId="left" dataKey="volume" name="TAM Actual Scheduled Volume (MU)" fill="#4b8ce3" barSize={20} />
              <Line yAxisId="right" type="monotone" dataKey="price" name="TAM Weighted Average Price (₹/kWh)" stroke="#df5661" strokeWidth={2} dot={{r: 4, stroke: '#df5661', fill: '#fff', strokeWidth: 2}} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Custom Labels for PX Groups */}
        <div style={{ position: 'relative', marginTop: -80, marginBottom: 40, display: 'flex', fontSize: 13, fontWeight: 700, color: 'var(--text)', justifyContent: 'space-around', marginLeft: 80, marginRight: 40 }}>
           <span>HPX</span>
           <span>IEX</span>
           <span>PXIL</span>
        </div>
        
        {/* Custom Legend */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 24, paddingBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 24, height: 12, background: '#4b8ce3', borderRadius: 2 }}></div>
            <span className="chart-legend-label">TAM Actual Scheduled Volume (MU)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
             <div style={{ width: 16, height: 16, borderRadius: 999, border: '2px solid var(--border)', borderColor: '#df5661', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               <div style={{ width: '100%', height: 2, background: '#df5661' }}></div>
            </div>
            <span className="chart-legend-label">TAM Weighted Average Price (₹/kWh)</span>
          </div>
        </div>

      </div>

      {/* TAM Data Table */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
        <table className="report-table">
          <thead>
            <tr style={{ background: '#4eb1fc', color: '#fff' }}>
              <th style={{ padding: 12, borderRight: '1px solid var(--border)', borderColor: 'rgba(255,255,255,0.25)', fontWeight: 600, width: 96 }}>PX</th>
              <th style={{ padding: 12, borderRight: '1px solid var(--border)', borderColor: 'rgba(255,255,255,0.25)', fontWeight: 600, textAlign: 'left' }}>Product</th>
              <th>TAM Actual Scheduled<br/>Volume (MU)</th>
              <th style={{ padding: 12, fontWeight: 600 }}>TAM Weighted Average Price<br/>(₹/kWh)</th>
            </tr>
          </thead>
          <tbody style={{ color: 'var(--text)' }}>
            {/* HPX Section */}
            <tr>
              <td rowSpan={6}>HPX</td>
              <td>Any Day Single Sided<br/>Contracts</td>
              <td>164.88</td>
              <td>4.71</td>
            </tr>
            <tr>
              <td>Daily Contracts</td>
              <td>234.49</td>
              <td>5.95</td>
            </tr>
            <tr>
              <td>Day Ahead Contingency<br/>Contracts</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>Intra-Day Contracts</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>Monthly Contracts</td>
              <td>504.01</td>
              <td>4.62</td>
            </tr>
            <tr>
              <td>Weekly Contracts</td>
              <td>685.15</td>
              <td>5.40</td>
            </tr>

            {/* IEX Section */}
            <tr>
              <td rowSpan={6}>IEX</td>
              <td>Any Day Single Sided<br/>Contracts</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>Daily Contracts</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>Day Ahead Contingency<br/>Contracts</td>
              <td>622.07</td>
              <td>4.49</td>
            </tr>
            <tr>
              <td>Intra-Day Contracts</td>
              <td>207.43</td>
              <td>6.03</td>
            </tr>
            <tr>
              <td>Monthly Contracts</td>
              <td>47.11</td>
              <td>4.50</td>
            </tr>
            <tr>
              <td>Weekly Contracts</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  );
}
