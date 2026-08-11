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
      <div className="bg-white border border-gray-200 shadow-md p-3 rounded-md text-sm font-sans min-w-[200px] z-50">
        <div className="text-gray-500 mb-2 font-semibold border-b border-gray-100 pb-2">{label}</div>
        <div className="flex justify-between items-center mb-1">
          <div className="flex items-center gap-2">
             <span className="w-2.5 h-2.5 rounded-full bg-[#4b8ce3]"></span>
             <span className="text-gray-600">TAM Actual Scheduled Volume (MU)</span>
          </div>
          <span className="font-semibold text-gray-800 ml-4">
             {payload[0].value.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
             <span className="w-2.5 h-2.5 rounded-full bg-[#df5661]"></span>
             <span className="text-gray-600">TAM Weighted Average Price (₹/kWh)</span>
          </div>
          <span className="font-semibold text-gray-800 ml-4">
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
    <div className="p-4 space-y-6">
      
      {/* Enlarged TAM Chart */}
      <div className="bg-white p-4 border border-gray-200 rounded-sm shadow-sm">
        <h3 className="text-center font-bold text-gray-700 mb-2 text-lg">Volume and Price of Electricity Under TAM in PX's</h3>
        
        <div className="flex justify-between text-xs text-gray-500 mb-4 px-10">
          <span>TAM Actual Scheduled Volume (MU)</span>
          <span>TAM Weighted Average Price (₹/kWh)</span>
        </div>

        <div className="h-80 w-full mb-10">
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
        <div className="relative -mt-20 mb-10 flex text-sm font-bold text-gray-700 justify-around ml-20 mr-10">
           <span>HPX</span>
           <span>IEX</span>
           <span>PXIL</span>
        </div>
        
        {/* Custom Legend */}
        <div className="flex justify-center gap-6 mt-6 pb-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-3 bg-[#4b8ce3] rounded-sm"></div>
            <span className="text-gray-600 text-sm font-semibold">TAM Actual Scheduled Volume (MU)</span>
          </div>
          <div className="flex items-center gap-2">
             <div className="w-4 h-4 rounded-full border-2 border-[#df5661] bg-white flex items-center justify-center">
               <div className="w-full h-[2px] bg-[#df5661]"></div>
            </div>
            <span className="text-gray-600 text-sm font-semibold">TAM Weighted Average Price (₹/kWh)</span>
          </div>
        </div>

      </div>

      {/* TAM Data Table */}
      <div className="bg-white border border-gray-200 rounded-sm shadow-sm overflow-hidden">
        <table className="w-full text-sm text-center border-collapse">
          <thead>
            <tr className="bg-[#4eb1fc] text-white">
              <th className="p-3 border-r border-white/30 font-semibold w-24">PX</th>
              <th className="p-3 border-r border-white/30 font-semibold text-left">Product</th>
              <th className="p-3 border-r border-white/30 font-semibold">TAM Actual Scheduled<br/>Volume (MU)</th>
              <th className="p-3 font-semibold">TAM Weighted Average Price<br/>(₹/kWh)</th>
            </tr>
          </thead>
          <tbody className="text-gray-700">
            {/* HPX Section */}
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 align-top" rowSpan={6}>HPX</td>
              <td className="p-3 border-r border-gray-200 text-left">Any Day Single Sided<br/>Contracts</td>
              <td className="p-3 border-r border-gray-200">164.88</td>
              <td className="p-3">4.71</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Daily Contracts</td>
              <td className="p-3 border-r border-gray-200">234.49</td>
              <td className="p-3">5.95</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Day Ahead Contingency<br/>Contracts</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3">0.00</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Intra-Day Contracts</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3">0.00</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Monthly Contracts</td>
              <td className="p-3 border-r border-gray-200">504.01</td>
              <td className="p-3">4.62</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Weekly Contracts</td>
              <td className="p-3 border-r border-gray-200">685.15</td>
              <td className="p-3">5.40</td>
            </tr>

            {/* IEX Section */}
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 align-top" rowSpan={6}>IEX</td>
              <td className="p-3 border-r border-gray-200 text-left">Any Day Single Sided<br/>Contracts</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3">0.00</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Daily Contracts</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3">0.00</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Day Ahead Contingency<br/>Contracts</td>
              <td className="p-3 border-r border-gray-200">622.07</td>
              <td className="p-3">4.49</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Intra-Day Contracts</td>
              <td className="p-3 border-r border-gray-200">207.43</td>
              <td className="p-3">6.03</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Monthly Contracts</td>
              <td className="p-3 border-r border-gray-200">47.11</td>
              <td className="p-3">4.50</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Weekly Contracts</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3">0.00</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  );
}
