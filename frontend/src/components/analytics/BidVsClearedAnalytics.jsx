import React, { useState, useMemo } from 'react';
import { 
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { Card } from '../ui.jsx';

// Generate mock flatline data for a specific date or active mock data
const generateChartData = (targetDateStr) => {
  const data = [];
  // Flatline state triggered for the specific date in the screenshot
  const isFlatline = targetDateStr === '2026-07-09';

  for (let i = 0; i < 96; i++) {
    const hh = String(Math.floor(i * 15 / 60)).padStart(2, '0');
    const mm = String((i * 15) % 60).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;
    
    if (isFlatline) {
      data.push({
        timeBlock: timeStr,
        bidQty: 0,
        bidPrice: 0,
        receivedQty: 0,
        receivedPrice: 0,
      });
    } else {
      // Mock realistic data
      const hourVal = Math.floor(i * 15 / 60);
      const baseQty = 150 + Math.random() * 50;
      const basePrice = 3000 + (hourVal > 8 && hourVal < 20 ? 1500 : 0) + Math.random() * 500;
      
      const receivedPct = Math.random() > 0.3 ? 1.0 : 0.8;
      
      data.push({
        timeBlock: timeStr,
        bidQty: Math.round(baseQty),
        bidPrice: Math.round(basePrice + 200),
        receivedQty: Math.round(baseQty * receivedPct),
        receivedPrice: Math.round(basePrice),
      });
    }
  }
  return data;
};

// Custom Tooltip with Dark Theme & Delta Volume calculation
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const p = payload[0].payload;
    const deltaVolume = p.bidQty - p.receivedQty;
    return (
      <div style={{ background: '#0f172a', color: '#f8fafc', padding: '12px 16px', borderRadius: 6, border: '1px solid #334155', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3)', fontSize: 13, minWidth: 200 }}>
        <p style={{ fontWeight: 600, color: '#cbd5e1', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #334155' }}>
          Time Block: {label}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 16px' }}>
          <span style={{ color: '#f87171' }}>Bid Qty:</span> <span style={{ fontWeight: 'bold' }}>{p.bidQty} MW</span>
          <span style={{ color: '#fb923c' }}>Bid Price:</span> <span style={{ fontWeight: 'bold' }}>₹{p.bidPrice}</span>
          <span style={{ color: '#60a5fa' }}>Received Qty:</span> <span style={{ fontWeight: 'bold' }}>{p.receivedQty} MW</span>
          <span style={{ color: '#4ade80' }}>Received Price:</span> <span style={{ fontWeight: 'bold' }}>₹{p.receivedPrice}</span>
        </div>
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #475569', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8', fontWeight: 600 }}>Δ Volume:</span>
          <span style={{ fontWeight: 'bold', color: deltaVolume > 0 ? '#ef4444' : '#22c55e' }}>{deltaVolume} MW</span>
        </div>
      </div>
    );
  }
  return null;
};

export default function BidVsClearedAnalytics() {
  // Use today as default, but allow switching to the flatline target date
  const [date, setDate] = useState('2026-07-09');
  
  const data = useMemo(() => generateChartData(date), [date]);

  const setPresetDate = (offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    setDate(d.toISOString().split('T')[0]);
  };

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {/* ── Control Panel ── */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Delivery date:</label>
            <div style={{ display: 'flex', border: '1px solid #cbd5e1', borderRadius: 4, overflow: 'hidden', background: '#fff' }}>
              <input 
                type="date" 
                value={date} 
                onChange={e => setDate(e.target.value)} 
                style={{ border: 'none', padding: '6px 10px', outline: 'none', fontSize: 14 }}
              />
              <button 
                onClick={() => setDate('')} 
                style={{ background: 'none', border: 'none', borderLeft: '1px solid #cbd5e1', padding: '0 8px', cursor: 'pointer', color: '#ef4444' }}
                title="Clear"
              >
                ✖
              </button>
            </div>
            <button className="btn btn-sm btn-outline" style={{ background: '#fff', marginLeft: 4 }}>Display</button>
          </div>
          
          <div style={{ width: 1, height: 24, background: '#cbd5e1' }} />
          
          {/* Quick Date Pills */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setPresetDate(-1)} style={{ fontSize: 12 }}>-1 Day</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setPresetDate(0)} style={{ fontSize: 12 }}>Today</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setPresetDate(1)} style={{ fontSize: 12 }}>Tomorrow</button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: '#1e293b' }}>Bided And Received Energy</h3>
          
          <div style={{ position: 'relative' }}>
            <button 
              className="btn btn-sm btn-ghost" 
              title="Export Chart" 
              style={{ fontSize: 16, padding: '4px 8px' }}
              onClick={() => {
                const el = document.getElementById('bid-vs-cleared-export-menu');
                if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
              }}
            >
              ☰
            </button>
            <div 
              id="bid-vs-cleared-export-menu"
              style={{ 
                display: 'none', position: 'absolute', right: 0, top: '100%', marginTop: 4, width: 160, 
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, 
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', zIndex: 10 
              }}
            >
              <div style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }} onClick={() => alert('Print')}>🖨️ Print chart</div>
              <div style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }} onClick={() => alert('Download PNG')}>🖼️ Download PNG image</div>
              <div style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }} onClick={() => alert('Download JPEG')}>🖼️ Download JPEG image</div>
              <div style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }} onClick={() => alert('Download PDF')}>📄 Download PDF document</div>
              <div style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer' }} onClick={() => alert('Download SVG')}>📐 Download SVG vector image</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Chart Rendering ── */}
      <div style={{ padding: '20px 20px 10px 20px', height: 420 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 20, right: 20, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            
            <XAxis 
              dataKey="timeBlock" 
              tickFormatter={(val) => val.endsWith(':00') ? parseInt(val.split(':')[0]) : ''}
              tick={{ fontSize: 12, fill: '#64748b' }} 
              axisLine={{ stroke: '#cbd5e1' }}
              label={{ value: 'Hour', position: 'insideBottom', offset: -15, fill: '#64748b', fontSize: 13 }}
            />
            
            {/* Primary Y-Axis (Left) - Price */}
            <YAxis 
              yAxisId="left" 
              orientation="left" 
              tick={{ fontSize: 12, fill: '#64748b' }}
              axisLine={{ stroke: '#cbd5e1' }}
              label={{ value: 'Price (Rs/MWH)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#475569', fontSize: 13, fontWeight: 500 } }} 
            />
            
            {/* Secondary Y-Axis (Right) - Qty */}
            <YAxis 
              yAxisId="right" 
              orientation="right"
              domain={[0, 300]}
              tick={{ fontSize: 12, fill: '#64748b' }} 
              axisLine={{ stroke: '#cbd5e1' }}
              label={{ value: 'QTY (MW)', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: '#475569', fontSize: 13, fontWeight: 500 } }} 
            />

            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '3 3' }} />
            
            <Legend 
              verticalAlign="bottom" 
              wrapperStyle={{ paddingTop: 20 }}
              iconType="circle"
            />
            
            <ReferenceLine y={0} yAxisId="left" stroke="#94a3b8" strokeWidth={2} />
            <ReferenceLine y={0} yAxisId="right" stroke="#94a3b8" strokeWidth={2} />

            {/* Traces based on screenshot legend */}
            <Line yAxisId="right" type="monotone" dataKey="bidQty" name="Bid Qty" stroke="#ef4444" strokeWidth={2} dot={{ r: 4, fill: '#ef4444' }} activeDot={{ r: 6 }} />
            <Line yAxisId="left" type="stepAfter" dataKey="bidPrice" name="Bid Price" stroke="#854d0e" strokeWidth={2} dot={{ r: 4, fill: '#854d0e', strokeWidth: 0, shape: 'diamond' }} />
            
            <Line yAxisId="right" type="monotone" dataKey="receivedQty" name="Received Energy Qty" stroke="#1e3a8a" strokeWidth={2} dot={{ r: 4, fill: '#1e3a8a', shape: 'square' }} />
            <Line yAxisId="left" type="stepAfter" dataKey="receivedPrice" name="Received Energy Price" stroke="#16a34a" strokeWidth={2} dot={{ r: 4, fill: '#16a34a', shape: 'star' }} />
            
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
