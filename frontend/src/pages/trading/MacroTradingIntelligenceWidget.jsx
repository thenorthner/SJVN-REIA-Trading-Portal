import React from 'react';
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
      <div className="bg-white border border-gray-200 shadow-xl rounded-md p-4 text-sm min-w-[280px] z-50">
        <div className="text-gray-500 font-medium mb-3 border-b border-gray-100 pb-2">{label}</div>
        
        {/* We expect the 4 payloads in order: Traded Vol, Buy Bid, Sell Bid, Price. Let's find them manually for exact styling */}
        {payload.map((entry, index) => {
          let labelText = '';
          let color = '';
          if (entry.dataKey === 'price') { labelText = 'Weighted Average Price'; color = '#f43f5e'; }
          if (entry.dataKey === 'tradedVolume') { labelText = 'Traded Volume'; color = '#3b82f6'; }
          if (entry.dataKey === 'buyBid') { labelText = 'Volume of Buy Bid'; color = '#2dd4bf'; }
          if (entry.dataKey === 'sellBid') { labelText = 'Volume of Sell Bid'; color = '#eab308'; }

          return (
            <div key={`rec-item-${index}`} className="flex justify-between items-center mb-1.5">
              <div className="flex items-center gap-2">
                 <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }}></span>
                 <span className="text-gray-600 font-medium">{labelText}</span>
              </div>
              <span className="font-bold text-gray-800 ml-6">
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
    <div className="p-4 space-y-6">
      
      {/* Top Row: Licensee Market Share & REC Market Depth */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Licensee Market Share Pie */}
        <div className="bg-white p-6 border border-gray-200 rounded-sm shadow-sm flex flex-col">
          <h3 className="text-center font-bold text-gray-700 mb-6 text-lg">% Share of Electricity Transacted By Top 7 Trading Licensees</h3>
          <div className="flex-1 min-h-[300px]">
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
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 mt-4 text-xs text-gray-600 px-4">
             {LICENSEE_DATA.map((entry, index) => (
               <div key={index} className="flex items-center gap-2">
                 <div className="w-4 h-3 rounded-sm" style={{backgroundColor: entry.color}}></div>
                 <span className="truncate" title={entry.name}>{entry.name}</span>
               </div>
             ))}
          </div>
        </div>

        {/* REC Market Depth Chart */}
        <div className="bg-[#f8f9fa] p-6 border border-gray-200 rounded-sm shadow-sm">
          <h3 className="text-center font-bold text-gray-700 mb-2 text-lg">Vol & Price Of RECs Transacted Through PX & Traders (Bilateral)</h3>
          <div className="flex justify-between text-xs text-gray-500 mb-4 px-10">
            <span>Volume (MWh)</span>
            <span>Price (₹/MWh)</span>
          </div>

          <div className="h-[300px] w-full">
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* PXIL Volume Pie */}
        <div className="bg-white p-6 border border-gray-200 rounded-sm shadow-sm">
           <h3 className="text-center font-bold text-gray-700 mb-6 text-lg">Volume Transactions in PXIL (MU)</h3>
           <div className="h-64 w-full">
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
        </div>

        {/* HPX Volume Pie */}
        <div className="bg-white p-6 border border-gray-200 rounded-sm shadow-sm">
           <h3 className="text-center font-bold text-gray-700 mb-6 text-lg">Volume Transactions in HPX (MU)</h3>
           <div className="h-64 w-full">
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
        </div>

      </div>

    </div>
  );
}
