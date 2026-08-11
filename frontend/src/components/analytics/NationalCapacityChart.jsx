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
      <div className="bg-white p-4 border border-gray-200 shadow-lg rounded-md">
        <h4 className="text-gray-700 font-semibold mb-3 border-b pb-2">{label}</h4>
        <div className="space-y-2">
          {payload.map((entry, index) => {
            const percentage = ((entry.value / total) * 100).toFixed(1);
            return (
              <div key={index} className="flex items-center justify-between gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: entry.color }}
                  ></div>
                  <span className="text-gray-600 font-medium">{entry.name}</span>
                </div>
                <div className="flex gap-4 items-center">
                  <span className="text-gray-900 font-bold">
                    {entry.value.toLocaleString()} MW
                  </span>
                  <span className="text-gray-500 w-12 text-right">
                    {percentage}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 pt-2 border-t flex justify-between items-center text-sm font-bold text-gray-800">
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
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-gray-800 font-sans">
          Category Wise Installed Capacity (All India) (MW)
        </h3>
        <p className="text-sm text-gray-500 mt-1">
          National grid generation asset tracking (Thermal/Hydro/Nuclear base load vs RES)
        </p>
      </div>
      
      <div className="h-[400px] w-full">
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
