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
      <div className="bg-white border border-gray-200 shadow-md p-3 rounded-md text-sm font-sans min-w-[200px]">
        <div className="text-gray-500 mb-2">{displayState || 'State'}</div>
        <div className="flex justify-between items-center mb-1">
          <div className="flex items-center gap-2">
             <span className="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
             <span className="text-gray-600">Volume of Purchase</span>
          </div>
          <span className="font-semibold text-gray-800">
             {payload[0].payload.purchase ? payload[0].payload.purchase.toFixed(2) : '-'}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
             <span className="w-2.5 h-2.5 rounded-full bg-red-400"></span>
             <span className="text-gray-600">Volume of Sale</span>
          </div>
          <span className="font-semibold text-gray-800">
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
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans">
      <div className="bg-white border border-gray-200 shadow-sm max-w-5xl mx-auto rounded-sm p-6">
        
        <h2 className="text-xl font-semibold text-gray-700 text-center mb-8">
          Top 10 GDAM Participants
        </h2>
        
        <div className="h-[400px] w-full">
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
        <div className="flex justify-center gap-6 mt-6">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border-2 border-blue-400 bg-white flex items-center justify-center">
               <div className="w-full h-[2px] bg-blue-400"></div>
            </div>
            <span className="text-gray-600 text-sm">Volume of Purchase</span>
          </div>
          <div className="flex items-center gap-2">
             <div className="w-4 h-4 rounded-full border-2 border-red-400 bg-white flex items-center justify-center">
               <div className="w-full h-[2px] bg-red-400"></div>
            </div>
            <span className="text-gray-600 text-sm">Volume of Sale</span>
          </div>
        </div>

      </div>
    </div>
  );
}
