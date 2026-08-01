import React, { useState } from 'react';
import { 
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea 
} from 'recharts';
import { Card } from '../ui.jsx';

const mockAcpData = [
  { day: '30', min: 0.1, avg: 6.2, max: 10.0 },
  { day: '1', min: 0.2, avg: 5.8, max: 10.0 },
  { day: '2', min: 0.1, avg: 5.5, max: 10.0 },
  { day: '3', min: 0.0, avg: 4.8, max: 10.0 },
  { day: '4', min: 0.3, avg: 4.2, max: 10.0 },
  { day: '5', min: 0.5, avg: 3.5, max: 10.0 },
  { day: '6', min: 0.2, avg: 3.8, max: 10.0 },
  { day: '7', min: 0.4, avg: 4.1, max: 10.0 },
  { day: '8', min: 0.6, avg: 4.5, max: 10.0 },
  { day: '9', min: 0.5, avg: 4.9, max: 10.0 },
];

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 14px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
        <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>Delivery Day: {label}</div>
        {payload.map(p => {
          let name = 'Avg';
          if (p.dataKey === 'max') name = 'Max';
          if (p.dataKey === 'min') name = 'Min';
          return (
            <div key={p.dataKey} style={{ fontSize: 14, color: p.color, fontWeight: 500, margin: '2px 0' }}>
              {name} {label}: {p.value.toFixed(2)} Rs
            </div>
          );
        })}
      </div>
    );
  }
  return null;
};

export default function ACPTrendWidget() {
  const [showExportMenu, setShowExportMenu] = useState(false);

  const handleExport = (format) => {
    setShowExportMenu(false);
    // In a real implementation, we would use html2canvas or native recharts SVG export
    window.alert(`Not available yet — chart export as ${format} is not built, and this widget is drawing placeholder prices.`);
  };

  return (
    <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
      {/* ── Widget Header & Export Menu ── */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16, color: '#1e293b' }}>Area Clearing Price (N1 Region Trend)</h3>
        
        <div style={{ position: 'relative' }}>
          <button 
            className="btn btn-sm btn-ghost" 
            title="Export Chart" 
            style={{ fontSize: 16, padding: '4px 8px' }}
            onClick={() => setShowExportMenu(!showExportMenu)}
          >
            ☰
          </button>
          
          {showExportMenu && (
            <div style={{ 
              position: 'absolute', right: 0, top: '100%', marginTop: 4, width: 160, 
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, 
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', zIndex: 10 
            }}>
              <div style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }} onClick={() => handleExport('Print')}>🖨️ Print chart</div>
              <div style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }} onClick={() => handleExport('PNG')}>🖼️ Download PNG image</div>
              <div style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }} onClick={() => handleExport('JPEG')}>🖼️ Download JPEG image</div>
              <div style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }} onClick={() => handleExport('PDF')}>📄 Download PDF document</div>
              <div style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer' }} onClick={() => handleExport('SVG')}>📐 Download SVG vector image</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Chart Rendering ── */}
      <div style={{ padding: '20px', height: 350 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={mockAcpData} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            
            <XAxis 
              dataKey="day" 
              tick={{ fontSize: 12, fill: '#64748b' }} 
              axisLine={{ stroke: '#cbd5e1' }}
              label={{ value: 'Delivery days', position: 'insideBottom', offset: -15, fill: '#64748b', fontSize: 13 }}
            />
            
            <YAxis 
              domain={[ -5, 15 ]}
              ticks={[-5, 0, 5, 10, 15]}
              tick={{ fontSize: 12, fill: '#64748b' }}
              axisLine={{ stroke: '#cbd5e1' }}
              label={{ value: 'Price (Rs / KWH)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#475569', fontSize: 13, fontWeight: 500 } }} 
            />

            <Tooltip content={<CustomTooltip />} />
            
            <Legend 
              verticalAlign="bottom" 
              wrapperStyle={{ paddingTop: 20 }}
              iconType="circle"
            />

            {/* Regulatory Cap Highlight Band */}
            <ReferenceArea y1={10} y2={15} fill="#fef08a" fillOpacity={0.3} />
            
            {/* Base line at 0 */}
            <ReferenceArea y1={-5} y2={0} fill="#f1f5f9" fillOpacity={0.5} />

            {/* Traces mapped precisely to legacy visual scheme */}
            <Line type="monotone" dataKey="max" name="Max" stroke="#16a34a" strokeWidth={3} dot={{ r: 5, fill: '#16a34a', shape: 'square' }} activeDot={{ r: 7 }} />
            <Line type="monotone" dataKey="avg" name="Avg" stroke="#1e293b" strokeWidth={3} dot={{ r: 5, fill: '#1e293b', shape: 'diamond' }} activeDot={{ r: 7 }} />
            <Line type="monotone" dataKey="min" name="Min" stroke="#3b82f6" strokeWidth={3} dot={{ r: 5, fill: '#3b82f6' }} activeDot={{ r: 7 }} />
            
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
