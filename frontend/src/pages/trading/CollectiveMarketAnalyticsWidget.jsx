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
      <div className="bg-white border border-gray-200 shadow-lg rounded-md p-3 text-sm min-w-[220px] z-50">
        <div className="text-gray-600 font-bold border-b border-gray-100 pb-2 mb-3">{label}</div>
        
        {payload.map((entry, index) => (
          <div key={`item-${index}`} className="flex justify-between items-center mb-1.5">
            <div className="flex items-center gap-2">
               <span className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }}></span>
               <span className="text-gray-500 font-medium">{entry.name}</span>
            </div>
            <span className="font-bold text-gray-800 ml-6">
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
    <div className="p-4 space-y-6">
      
      {/* Min Max & Avg Line Chart */}
      <div className="bg-white p-6 border border-gray-200 rounded-sm shadow-sm">
        <div className="text-center mb-6">
           <h3 className="font-bold text-gray-700 text-xl">Min Max and Weight Avg Price of Collective Market in PX</h3>
        </div>
        
        <div className="h-80 w-full px-4">
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
      <div className="bg-[#f8f9fa] p-6 border border-gray-200 rounded-sm shadow-sm">
        <h3 className="text-center font-bold text-gray-700 mb-2 text-xl">Vol & Price Of RECs Transacted Through PX & Traders (Bilateral)</h3>
        
        <div className="flex justify-between text-xs text-gray-500 mb-4 px-10">
          <span>Volume (MWh)</span>
          <span>Price (₹/MWh)</span>
        </div>

        <div className="h-80 w-full">
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
      <div className="bg-white border border-gray-200 rounded-sm shadow-sm overflow-hidden mt-8">
        <table className="w-full text-sm text-center border-collapse">
          <thead>
            <tr className="bg-[#4eb1fc] text-white">
              <th className="p-3 border-r border-white/30 font-semibold w-32">PX</th>
              <th className="p-3 border-r border-white/30 font-semibold text-left">Product</th>
              <th className="p-3 border-r border-white/30 font-semibold">Maximum Price<br/>(₹/kWh)</th>
              <th className="p-3 border-r border-white/30 font-semibold">Minimum Price<br/>(₹/kWh)</th>
              <th className="p-3 font-semibold">Weighted Average<br/>Price (₹/kWh)</th>
            </tr>
          </thead>
          <tbody className="text-gray-700">
            {/* IEX Section */}
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 align-top font-medium" rowSpan={4}>IEX</td>
              <td className="p-3 border-r border-gray-200 text-left">DAM</td>
              <td className="p-3 border-r border-gray-200">10.00</td>
              <td className="p-3 border-r border-gray-200">1.43</td>
              <td className="p-3">3.82</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">GDAM</td>
              <td className="p-3 border-r border-gray-200">10.00</td>
              <td className="p-3 border-r border-gray-200">1.60</td>
              <td className="p-3">4.06</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">HPDAM</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3">0.00</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">RTM</td>
              <td className="p-3 border-r border-gray-200">5.92</td>
              <td className="p-3 border-r border-gray-200">10.00</td>
              <td className="p-3">11.00</td>
            </tr>

            {/* PXIL Section */}
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 align-top font-medium" rowSpan={4}>PXIL</td>
              <td className="p-3 border-r border-gray-200 text-left">DAM</td>
              <td className="p-3 border-r border-gray-200">10.00</td>
              <td className="p-3 border-r border-gray-200">10.00</td>
              <td className="p-3">10.00</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">GDAM</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3">0.00</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">HPDAM</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3">0.00</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">RTM</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3 border-r border-gray-200">10.00</td>
              <td className="p-3">0.00</td>
            </tr>

            {/* HPX Section */}
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 align-top font-medium" rowSpan={4}>HPX</td>
              <td className="p-3 border-r border-gray-200 text-left">DAM</td>
              <td className="p-3 border-r border-gray-200">10.00</td>
              <td className="p-3 border-r border-gray-200">10.00</td>
              <td className="p-3">10.00</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">GDAM</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3">0.00</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">HPDAM</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3">0.00</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">RTM</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3">0.00</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  );
}
