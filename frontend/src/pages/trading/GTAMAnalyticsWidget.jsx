import React from 'react';
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, AreaChart, Area, Cell
} from 'recharts';

const BILATERAL_DATA = [
  { state: 'Gujarat', purchase: 1280, sale: null },
  { state: 'State2', purchase: 1150, sale: null },
  { state: 'State3', purchase: 920, sale: null },
  { state: 'State4', purchase: 620, sale: null },
  { state: 'State5', purchase: 580, sale: null },
  { state: 'Maharashtra', purchase: 548.05, sale: null },
  { state: 'State7', purchase: 540, sale: null },
  { state: 'State8', purchase: 430, sale: null },
  { state: 'State9', purchase: 420, sale: null },
  { state: 'State10', purchase: 410, sale: null },
  { state: 'Limited-Raipur TPP', purchase: null, sale: 1080 },
  { state: 'State12', purchase: null, sale: 660 },
  { state: 'State13', purchase: null, sale: 420 },
  { state: 'State14', purchase: null, sale: 400 },
  { state: 'State15', purchase: null, sale: 300 },
  { state: 'State16', purchase: null, sale: 280 },
  { state: 'State17', purchase: null, sale: 270 },
  { state: 'State18', purchase: null, sale: 260 },
  { state: 'State19', purchase: null, sale: 250 },
  { state: 'State20', purchase: null, sale: 245 }
];

const DAM_DATA = [
  { state: 'Gujarat', purchase: 980, sale: null },
  { state: 'State2', purchase: 900, sale: null },
  { state: 'State3', purchase: 500, sale: null },
  { state: 'State4', purchase: 480, sale: null },
  { state: 'State5', purchase: 300, sale: null },
  { state: 'State6', purchase: 280, sale: null },
  { state: 'State7', purchase: 270, sale: null },
  { state: 'State8', purchase: 270, sale: null },
  { state: 'State9', purchase: 250, sale: null },
  { state: 'State10', purchase: 245, sale: null },
  { state: 'State11', purchase: null, sale: 560 },
  { state: 'State12', purchase: null, sale: 480 },
  { state: 'State13', purchase: null, sale: 400 },
  { state: 'State14', purchase: null, sale: 280 },
  { state: 'State15', purchase: null, sale: 220 },
  { state: 'State16', purchase: null, sale: 220 },
  { state: 'State17', purchase: null, sale: 210 },
  { state: 'State18', purchase: null, sale: 180 },
  { state: 'State19', purchase: null, sale: 180 },
  { state: 'Tamil Nadu', purchase: null, sale: 150 }
];

const ENLARGED_GTAM_DATA = [
  { name: 'Any Day Single Sided Contracts', exchange: 'HPX', volume: 28.40, price: 4.62 },
  { name: 'Daily Contracts', exchange: 'HPX', volume: 0, price: 0 },
  { name: 'Day Ahead Contingency Contracts', exchange: 'HPX', volume: 0, price: 0 },
  { name: 'Intra Day Contracts', exchange: 'HPX', volume: 0, price: 0 },
  { name: 'Monthly Contracts', exchange: 'HPX', volume: 14.88, price: 4.67 },
  { name: 'Weekly Contracts', exchange: 'HPX', volume: 9.92, price: 8.15 },
  
  { name: 'Any Day Single Sided Contracts', exchange: 'IEX', volume: 0, price: 0 },
  { name: 'Daily Contracts', exchange: 'IEX', volume: 0, price: 0 },
  { name: 'Day Ahead Contingency Contracts', exchange: 'IEX', volume: 0, price: 0 },
  { name: 'Intra Day Contracts', exchange: 'IEX', volume: 52.25, price: 3.01 },
  { name: 'Monthly Contracts', exchange: 'IEX', volume: 4.07, price: 5.55 },
  { name: 'Weekly Contracts', exchange: 'IEX', volume: 0, price: 0 },

  { name: 'Any Day Single Sided Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Daily Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Day Ahead Contingency Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Intra Day Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Monthly Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Weekly Contracts', exchange: 'PXIL', volume: 0, price: 0 },
];


export default function GTAMAnalyticsWidget() {
  return (
    <div className="p-4 space-y-6">
      
      {/* Top 10 Participants Row */}
      <div className="grid grid-cols-2 gap-6">
        
        {/* Bilateral Chart */}
        <div className="bg-white p-4 border border-gray-200 rounded-sm shadow-sm">
          <h3 className="text-center font-bold text-gray-700 mb-6 text-lg">Top 10 Bilateral Participants</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={BILATERAL_DATA} margin={{ top: 0, right: 0, left: -20, bottom: 0 }} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="state" tick={{fontSize: 10}} tickFormatter={(val) => val.includes('State') ? '' : val} axisLine={true} tickLine={false} />
                <YAxis tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '4px', fontSize: '12px'}} />
                <Bar dataKey="purchase" stackId="a">
                  {BILATERAL_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill="#3b82f6" />
                  ))}
                </Bar>
                <Bar dataKey="sale" stackId="a">
                  {BILATERAL_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill="#ef4444" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* DAM Chart */}
        <div className="bg-white p-4 border border-gray-200 rounded-sm shadow-sm">
          <h3 className="text-center font-bold text-gray-700 mb-6 text-lg">Top 10 DAM Participants</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={DAM_DATA} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="state" tick={{fontSize: 10}} tickFormatter={(val) => val.includes('State') ? '' : val} axisLine={true} tickLine={false} />
                <YAxis tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{borderRadius: '4px', fontSize: '12px'}} />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{fontSize: '12px', paddingTop: '20px'}}/>
                <Area type="linear" dataKey="purchase" name="Volume of Purchase" stroke="#3b82f6" fill="#93c5fd" dot={{r:3, stroke:'#3b82f6', fill:'white', strokeWidth:2}} connectNulls />
                <Area type="linear" dataKey="sale" name="Volume of Sale" stroke="#ef4444" fill="#fca5a5" dot={{r:3, stroke:'#ef4444', fill:'white', strokeWidth:2}} connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Enlarged GTAM Chart */}
      <div className="bg-white p-4 border border-gray-200 rounded-sm shadow-sm">
        <h3 className="text-center font-bold text-gray-700 mb-2 text-lg">Volume and Price of Electricity Under GTAM in PX's</h3>
        
        <div className="flex justify-between text-xs text-gray-500 mb-4 px-10">
          <span>TAM Actual Scheduled Volume (MU)</span>
          <span>TAM Weighted Average Price (₹/kWh)</span>
        </div>

        <div className="h-80 w-full mb-10">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={ENLARGED_GTAM_DATA} margin={{ top: 20, right: 20, bottom: 60, left: 20 }}>
              <CartesianGrid stroke="#eee" vertical={false} />
              
              <XAxis 
                dataKey="name" 
                tick={{fontSize: 10, fill: '#666'}} 
                angle={-45} 
                textAnchor="end"
                interval={0}
                tickFormatter={(val) => val}
              />
              
              <YAxis yAxisId="left" tick={{fontSize: 12, fill: '#666'}} axisLine={false} tickLine={false} domain={[0, 60]} />
              <YAxis yAxisId="right" orientation="right" tick={{fontSize: 12, fill: '#666'}} axisLine={false} tickLine={false} domain={[0, 10]} />
              
              <Tooltip cursor={{fill: '#f1f5f9'}} />
              
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

      {/* GTAM Data Table */}
      <div className="bg-white border border-gray-200 rounded-sm shadow-sm overflow-hidden">
        <table className="w-full text-sm text-center border-collapse">
          <thead>
            <tr className="bg-[#4eb1fc] text-white">
              <th className="p-3 border-r border-white/30 font-semibold w-24">PX</th>
              <th className="p-3 border-r border-white/30 font-semibold text-left">Product</th>
              <th className="p-3 border-r border-white/30 font-semibold">GTAM Actual Scheduled<br/>Volume (MU)</th>
              <th className="p-3 font-semibold">GTAM Weighted Average Price<br/>(₹/kWh)</th>
            </tr>
          </thead>
          <tbody className="text-gray-700">
            {/* HPX Section */}
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 align-top" rowSpan={6}>HPX</td>
              <td className="p-3 border-r border-gray-200 text-left">Any Day Single Sided<br/>Contracts</td>
              <td className="p-3 border-r border-gray-200">28.40</td>
              <td className="p-3">4.62</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Daily Contracts</td>
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3">0.00</td>
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
              <td className="p-3 border-r border-gray-200">14.88</td>
              <td className="p-3">4.67</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Weekly Contracts</td>
              <td className="p-3 border-r border-gray-200">9.92</td>
              <td className="p-3">8.15</td>
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
              <td className="p-3 border-r border-gray-200">0.00</td>
              <td className="p-3">0.00</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Intra-Day Contracts</td>
              <td className="p-3 border-r border-gray-200">52.25</td>
              <td className="p-3">3.01</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-3 border-r border-gray-200 text-left">Monthly Contracts</td>
              <td className="p-3 border-r border-gray-200">4.07</td>
              <td className="p-3">5.55</td>
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
