import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

const data = [
  { state: 'Punjab', purchase: 110, sale: null },
  { state: '', purchase: 108, sale: null },
  { state: '', purchase: 95, sale: null },
  { state: '', purchase: 85, sale: null },
  { state: '', purchase: 65, sale: null },
  { state: '', purchase: 60, sale: null },
  { state: '', purchase: 55, sale: null },
  { state: '', purchase: 45, sale: null },
  { state: '', purchase: 45, sale: null },
  { state: 'Telangana', purchase: 45, sale: null },
  { state: 'Delhi', purchase: null, sale: 340 },
  { state: '', purchase: null, sale: 55.15 },
  { state: '', purchase: null, sale: 50 },
  { state: '', purchase: null, sale: 40 },
  { state: '', purchase: null, sale: 38 },
  { state: '', purchase: null, sale: 35 },
  { state: 'End', purchase: null, sale: 30 }
];

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const isPurchase = payload[0].dataKey === 'purchase';
    const isSale = payload[0].dataKey === 'sale';
    
    // In our dummy data, we didn't label every point, so let's default to Delhi if it's the high peak
    const displayState = label || (isSale && payload[0].value > 300 ? 'Delhi' : label);

    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', padding: 12, borderRadius: 6, fontSize: 13, minWidth: 200 }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: 8 }}>{displayState || 'State'}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
             <span style={{ width: 10, height: 10, borderRadius: 999, background: '#60a5fa' }}></span>
             <span className="audit-muted">Volume of Purchase</span>
          </div>
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>
             {payload[0].payload.purchase ? payload[0].payload.purchase.toFixed(2) : '-'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
             <span style={{ width: 10, height: 10, borderRadius: 999, background: '#f87171' }}></span>
             <span className="audit-muted">Volume of Sale</span>
          </div>
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>
             {payload[0].payload.sale ? payload[0].payload.sale.toFixed(2) : '-'}
          </span>
        </div>
      </div>
    );
  }
  return null;
};

export default function Top10GDAMParticipantsChart() {
  return (
    <div style={{ padding: 24, background: '#f8f9fa' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', maxWidth: 1024, margin: '0 auto', borderRadius: 2, padding: 24 }}>
        
        <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', textAlign: 'center', marginBottom: 32 }}>
          Top 10 GDAM Participants
        </h2>
        
        <div style={{ height: 400, width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{
                top: 10,
                right: 30,
                left: 0,
                bottom: 0,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
              <XAxis 
                dataKey="state" 
                axisLine={true} 
                tickLine={false} 
                tick={{fill: '#666', fontSize: 12}}
                dy={10}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{fill: '#666', fontSize: 12}}
                domain={[0, 350]}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#ccc', strokeWidth: 1, strokeDasharray: '5 5' }} />
              
              {/* Blue Area for Purchase */}
              <Area 
                type="monotone" 
                dataKey="purchase" 
                stroke="#66b2ff" 
                fill="#80bfff" 
                fillOpacity={0.8}
                strokeWidth={2}
                dot={{ r: 4, stroke: '#66b2ff', fill: '#fff', strokeWidth: 2 }}
                activeDot={{ r: 6 }}
                connectNulls
              />

              {/* Red Area for Sale */}
              <Area 
                type="monotone" 
                dataKey="sale" 
                stroke="#ff6b6b" 
                fill="#ff8787" 
                fillOpacity={0.8}
                strokeWidth={2}
                dot={{ r: 4, stroke: '#ff6b6b', fill: '#fff', strokeWidth: 2 }}
                activeDot={{ r: 6 }}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 16, height: 16, borderRadius: 999, border: '2px solid #60a5fa', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               <div style={{ width: '100%', height: 2, background: '#60a5fa' }}></div>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Volume of Purchase</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
             <div style={{ width: 16, height: 16, borderRadius: 999, border: '2px solid #f87171', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               <div style={{ width: '100%', height: 2, background: '#f87171' }}></div>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Volume of Sale</span>
          </div>
        </div>

      </div>
    </div>
  );
}
