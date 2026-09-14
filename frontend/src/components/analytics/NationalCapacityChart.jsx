import React from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

const data = [
  { month: 'Jun-2024', Thermal: 243000, Hydro: 47000, RES: 148000, Nuclear: 8180 },
  { month: 'Jul-2024', Thermal: 243000, Hydro: 47000, RES: 150000, Nuclear: 8180 },
  { month: 'Aug-2024', Thermal: 243000, Hydro: 47000, RES: 152000, Nuclear: 8180 },
  { month: 'Sep-2024', Thermal: 243000, Hydro: 47000, RES: 154000, Nuclear: 8180 },
  { month: 'Oct-2024', Thermal: 243000, Hydro: 47000, RES: 155000, Nuclear: 8180 },
  { month: 'Nov-2024', Thermal: 243000, Hydro: 47000, RES: 157000, Nuclear: 8180 },
];

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const total = payload.reduce((sum, entry) => sum + entry.value, 0);
    
    return (
      <div style={{ background: 'var(--surface)', padding: 16, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', borderRadius: 6 }}>
        <h4 style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{label}</h4>
        <div className="space-y-2">
          {payload.map((entry, index) => {
            const percentage = ((entry.value / total) * 100).toFixed(1);
            return (
              <div key={index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div 
                    style={{ width: 10, height: 10, borderRadius: 999 }} 
                    style={{ backgroundColor: entry.color }}
                  ></div>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{entry.name}</span>
                </div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <span style={{ color: 'var(--text)', fontWeight: 700 }}>
                    {entry.value.toLocaleString()} MW
                  </span>
                  <span style={{ color: 'var(--text-muted)', width: 48, textAlign: 'right' }}>
                    {percentage}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          <span>Total Capacity</span>
          <span>{total.toLocaleString()} MW</span>
        </div>
      </div>
    );
  }
  return null;
};

// Formatter to display Y-axis labels as 80k, 160k, etc.
const formatYAxisLeft = (tickItem) => {
  if (tickItem === 0) return '0';
  return `${tickItem / 1000}k`;
};

const NationalCapacityChart = () => {
  return (
    <div style={{ background: 'var(--surface)', padding: 24, borderRadius: 12, boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
          Category Wise Installed Capacity (All India) (MW)
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          National grid generation asset tracking (Thermal/Hydro/Nuclear base load vs RES)
        </p>
      </div>
      
      <div style={{ height: 400, width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 20, right: 20, bottom: 20, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            
            <XAxis 
              dataKey="month" 
              axisLine={{ stroke: '#E5E7EB' }}
              tickLine={false}
              tick={{ fill: '#6B7280', fontSize: 13, dy: 10 }}
            />
            
            <YAxis 
              yAxisId="left" 
              domain={[0, 320000]} 
              tickCount={5}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatYAxisLeft}
              tick={{ fill: '#9CA3AF', fontSize: 13 }}
              width={60}
            />
            
            <YAxis 
              yAxisId="right" 
              orientation="right" 
              domain={[8178, 8182]}
              tickCount={5}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#9CA3AF', fontSize: 13 }}
              width={60}
              label={{ value: 'Nuclear', angle: 90, position: 'insideRight', fill: '#9CA3AF', dy: -20 }}
            />
            
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F3F4F6' }} />
            
            <Legend 
              verticalAlign="bottom" 
              height={36} 
              iconType="circle"
              wrapperStyle={{ paddingTop: '20px' }}
            />
            
            <Bar 
              yAxisId="left" 
              dataKey="Thermal" 
              name="Thermal"
              fill="#4B5563" 
              barSize={20}
              radius={[2, 2, 0, 0]} 
            />
            <Bar 
              yAxisId="left" 
              dataKey="Hydro" 
              name="Hydro"
              fill="#0ea5e9" 
              barSize={20}
              radius={[2, 2, 0, 0]} 
            />
            <Bar 
              yAxisId="left" 
              dataKey="RES" 
              name="RES"
              fill="#16a34a" 
              barSize={20}
              radius={[2, 2, 0, 0]} 
            />
            
            <Line 
              yAxisId="right" 
              type="monotone" 
              dataKey="Nuclear" 
              name="Nuclear"
              stroke="#ef4444" 
              strokeWidth={2}
              dot={{ stroke: '#f97316', strokeWidth: 2, fill: '#ffffff', r: 5 }}
              activeDot={{ stroke: '#f97316', strokeWidth: 2, fill: '#ffffff', r: 7 }}
              isAnimationActive={true}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default NationalCapacityChart;
