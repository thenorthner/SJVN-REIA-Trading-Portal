import React, { useState } from 'react';
import { 
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';

export const DashboardKPIs = () => {
  const kpiData = [
    { title: "Total Energy Traded", value: "343.97", unit: "MU", gradient: "from-emerald-400 to-green-500" },
    { title: "Energy Traded in FY 2026-27", value: "113.93", unit: "MU", gradient: "from-rose-400 to-fuchsia-500" },
    { title: "No of REC Sold (#till date)", value: "66167", unit: "Nos.", gradient: "from-cyan-400 to-indigo-500" },
    { title: "Total Earnings from REC", value: "75011149", unit: "Cr.", gradient: "from-amber-300 to-rose-400" },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {kpiData.map((kpi, index) => (
        <div 
          key={index} 
          className={`p-5 rounded shadow bg-gradient-to-br ${kpi.gradient} text-white flex flex-col justify-between h-28`}
        >
          <h3 className="text-sm font-semibold opacity-90">{kpi.title}</h3>
          <div className="flex items-baseline space-x-1 mt-auto">
            <span className="text-2xl font-bold">{kpi.value}</span>
            <span className="text-xs opacity-90 mb-1">{kpi.unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default function MainDashboard() {
  const [fromDate, setFromDate] = useState('10-08-2026');
  const [productType, setProductType] = useState('RTM');

  // Generating RTM Intraday mock data based on analysis
  const RTM_INTRADAY_DATA = [];
  for(let i=1; i<=96; i++) {
    let mcv = Math.random() * 4000 + 4000;
    let mcp = Math.random() * 2000 + 1000;
    
    // Explicit overrides based on screenshots
    if (i === 1) { mcv = 3728.25; mcp = 3500.12; }
    if (i === 27) { mcv = 5436.62; mcp = 4950.24; }
    if (i === 52) { mcv = 12299.49; mcp = 2305.82; }
    if (i === 54) { mcv = 12133.83; mcp = 2848.24; }
    if (i > 40 && i < 60) { mcv += 4000; } // Volatility boost in afternoon

    RTM_INTRADAY_DATA.push({
      blockNo: i.toString(),
      mcv: parseFloat(mcv.toFixed(2)),
      mcp: parseFloat(mcp.toFixed(2))
    });
  }

  return (
    <div className="p-4 md:p-6 space-y-6 bg-slate-50 min-h-screen">
      
      {/* KPI Cards */}
      <DashboardKPIs />

      {/* Filter Controls Bar */}
      <div className="flex flex-wrap items-center gap-4 bg-white p-4 rounded shadow-sm border border-gray-200">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-gray-700">From Date<span className="text-red-500">*</span></label>
          <div className="relative">
            <input 
              type="text" 
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-white border border-gray-300 p-2 pr-8 rounded text-sm focus:outline-none focus:border-blue-500 w-[130px]"
            />
            <span className="absolute right-2 top-2.5 text-gray-400">📅</span>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4">
          <label className="text-sm font-semibold text-gray-700">Product Type<span className="text-red-500">*</span></label>
          <select 
            value={productType} 
            onChange={(e) => setProductType(e.target.value)} 
            className="bg-white border border-gray-300 p-2 rounded text-sm min-w-[100px] focus:outline-none focus:border-blue-500"
          >
            <option value="RTM">RTM</option>
            <option value="GDAM">GDAM</option>
            <option value="DAM">DAM</option>
          </select>
        </div>

        <button className="ml-2 px-6 py-2 bg-[#64a6d1] hover:bg-blue-600 text-white font-medium rounded shadow-sm transition text-sm">
          Show Graph
        </button>
      </div>

      {/* Intraday 96-Block Deep Dive */}
      <div className="p-6 bg-white border border-gray-200 rounded shadow-md mt-6">
        <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-6">
          <h2 className="text-base font-bold text-gray-800 mx-auto">
            Time Block wise MCP vs MCV ({fromDate.replace(/-/g, '-').replace('08', 'Aug')})
          </h2>
          <button className="text-gray-400 hover:text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        <div className="h-[450px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={RTM_INTRADAY_DATA} margin={{ top: 20, right: 10, left: 10, bottom: 20 }}>
              <XAxis 
                dataKey="blockNo" 
                stroke="#64748b" 
                fontSize={10} 
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1' }}
                label={{ value: 'Months', position: 'insideBottom', offset: -15, fill: '#64748b', fontSize: 10 }}
              />
              <YAxis 
                yAxisId="mcv" 
                stroke="#f97316" 
                fontSize={10} 
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
                tickFormatter={(val) => `${val/1000}k`}
                label={{ value: 'MCV (MWh)', angle: -90, position: 'insideLeft', fill: '#f97316', fontSize: 11 }} 
              />
              <YAxis 
                yAxisId="mcp" 
                orientation="right" 
                stroke="#a855f7" 
                fontSize={10} 
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
                label={{ value: 'MCP (Rs./MWh)', angle: 90, position: 'insideRight', fill: '#a855f7', fontSize: 11 }} 
              />
              <Tooltip contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '4px', fontSize: '12px' }} />
              <Bar yAxisId="mcv" dataKey="mcv" name="MCV (MWh)" fill="#d97706" radius={[2, 2, 0, 0]} barSize={4} />
              <Bar yAxisId="mcp" dataKey="mcp" name="MCP (Rs./MWh)" fill="#a855f7" radius={[2, 2, 0, 0]} barSize={4} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  );
}
