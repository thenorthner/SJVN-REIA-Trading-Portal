import React, { useState } from 'react';
import { 
  PieChart, Pie, Cell, BarChart, Bar, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';

// Data Mocks
const POWER_GEN_DATA = [
  { name: 'THERMAL', value: 85.2, color: '#475569' }, // Dark Slate/Grey
  { name: 'HYDRO', value: 10.8, color: '#0ea5e9' }, // Light Blue
  { name: 'BHUTAN IMP', value: 1.2, color: '#22c55e' }, // Green
  { name: 'NUCLEAR', value: 2.8, color: '#ef4444' }, // Red
];

const RE_GEN_DATA = [
  { name: 'Wind', value: 28.2, color: '#475569' }, // Dark Slate
  { name: 'Bagasse', value: 10.1, color: '#22c55e' }, // Green
  { name: 'Small Hydel', value: 5.2, color: '#0ea5e9' }, // Blue
  { name: 'Solar', value: 56.5, color: '#eab308' }, // Yellow
];

const PEAK_DEMAND_MET_2024 = [
  { month: 'Jan-2024', peakDemand: 223000, peakMet: 222000 },
  { month: 'Feb-2024', peakDemand: 222000, peakMet: 221800 },
  { month: 'Mar-2024', peakDemand: 221000, peakMet: 220500 },
  { month: 'Apr-2024', peakDemand: 224000, peakMet: 223000 },
  { month: 'May-2024', peakDemand: 250000, peakMet: 249500 },
  { month: 'Jun-2024', peakDemand: 245000, peakMet: 244200 },
];

const ENERGY_REQ_AVAIL_2022 = [
  { month: 'Apr-2022', requirement: 135000, available: 134500 },
  { month: 'May-2022', requirement: 136000, available: 135000 },
  { month: 'Jun-2022', requirement: 135500, available: 135000 },
  { month: 'Jul-2022', requirement: 130000, available: 130000 },
  { month: 'Aug-2022', requirement: 132000, available: 131000 },
  { month: 'Sep-2022', requirement: 128000, available: 127000 },
];

const INSTALLED_CAPACITY_DATA = [
  { month: 'Jun-2024', thermal: 243000, hydro: 47000, res: 148000, nuclear: 8180 },
  { month: 'Jul-2024', thermal: 243000, hydro: 47000, res: 150000, nuclear: 8180 },
  { month: 'Aug-2024', thermal: 243000, hydro: 47000, res: 152000, nuclear: 8180 },
  { month: 'Sep-2024', thermal: 243000, hydro: 47000, res: 154000, nuclear: 8180 },
  { month: 'Oct-2024', thermal: 243000, hydro: 47000, res: 156000, nuclear: 8180 },
  { month: 'Nov-2024', thermal: 243000, hydro: 47000, res: 157000, nuclear: 8180 },
];

export default function CEAReportsDashboard() {
  const [fromMonth, setFromMonth] = useState('APR-2022');
  const [toMonth, setToMonth] = useState('SEP-2022');

  const CustomPieTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-200 shadow-md rounded p-2 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: payload[0].payload.color }}></div>
            <span className="font-medium text-gray-700">{payload[0].name}</span>
            <span className="ml-4 font-bold text-gray-900">{payload[0].value}%</span>
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomBarTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-200 shadow-lg rounded-md p-3 text-sm min-w-[200px] z-50">
          <div className="text-gray-600 font-bold border-b border-gray-100 pb-2 mb-2">{label}</div>
          {payload.map((entry, index) => (
            <div key={`item-${index}`} className="flex justify-between items-center mb-1">
              <div className="flex items-center gap-2">
                 <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                 <span className="text-gray-500 font-medium">{entry.name}</span>
              </div>
              <span className="font-bold text-gray-800 ml-4">
                 {entry.value.toLocaleString()} MW
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const DarkModeTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-[#1e293b] border border-slate-700 shadow-lg rounded-md p-3 text-sm min-w-[200px] z-50 text-slate-200">
          <div className="text-slate-400 font-bold border-b border-slate-700 pb-2 mb-2">{label}</div>
          {payload.map((entry, index) => (
            <div key={`item-${index}`} className="flex justify-between items-center mb-1">
              <div className="flex items-center gap-2">
                 <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                 <span className="text-slate-300 font-medium">{entry.name}</span>
              </div>
              <span className="font-bold text-white ml-4">
                 {entry.value.toLocaleString()} MW
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div>
      
      {/* Header & Controls */}
      <div className="page-header">
        <div>
          <h1>CEA Reports & Macro Grid Analytics</h1>
        </div>
      </div>
      
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-body" style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>From Month<span style={{color: 'red'}}>*</span></label>
            <select 
              value={fromMonth} 
              onChange={(e) => setFromMonth(e.target.value)} 
              style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', minWidth: '140px' }}
            >
              <option value="APR-2022">APR-2022</option>
              <option value="JAN-2024">JAN-2024</option>
            </select>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>To Month<span style={{color: 'red'}}>*</span></label>
            <select 
              value={toMonth} 
              onChange={(e) => setToMonth(e.target.value)} 
              style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', minWidth: '140px' }}
            >
              <option value="SEP-2022">SEP-2022</option>
              <option value="JUN-2024">JUN-2024</option>
              <option value="APR-2022">APR-2022</option>
            </select>
          </div>
          
          <button style={{ padding: '8px 16px', background: '#0b5ed7', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', alignSelf: 'flex-end', height: '36px' }}>
            Show Report
          </button>
        </div>
      </div>

      {/* Top Row: Generation Mix Pies */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        <div className="card">
          <div className="card-header">
            <h3>Power Generation (All India) (BUs) For Month: Apr-2022</h3>
          </div>
          <div className="card-body" style={{ height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={POWER_GEN_DATA} 
                  dataKey="value" 
                  outerRadius={100}
                >
                  {POWER_GEN_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomPieTooltip />} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{fontSize: '11px', fontWeight: 600, paddingTop: '10px'}}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>RE Generation (All India) (MUs) For Month: Apr-2022</h3>
          </div>
          <div className="card-body" style={{ height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={RE_GEN_DATA} 
                  dataKey="value" 
                  outerRadius={100}
                >
                  {RE_GEN_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomPieTooltip />} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{fontSize: '11px', fontWeight: 600, paddingTop: '10px'}}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Middle Row: Demand and Requirements Bars */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        <div className="card">
          <div className="card-header">
            <h3>Peak Demand v/s Peak Met (All India) (MW)</h3>
          </div>
          <div className="card-body" style={{ height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={PEAK_DEMAND_MET_2024} margin={{ top: 20, right: 0, left: 0, bottom: 20 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{fontSize: 11, fill: '#4b5563'}} axisLine={{ stroke: '#d1d5db' }} tickLine={false} tickMargin={10} />
                <YAxis tick={{fontSize: 11, fill: '#4b5563'}} domain={[0, 300000]} axisLine={false} tickLine={false} tickFormatter={(val) => `${val/1000}k`} />
                <Tooltip content={<CustomBarTooltip />} cursor={{ fill: '#f3f4f6' }} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{fontSize: '12px', fontWeight: 600}}/>
                <Bar dataKey="peakDemand" name="Peak Demand" fill="#54c2db" />
                <Bar dataKey="peakMet" name="Peak Met" fill="#a4d142" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Energy Requirements v/s Energy Available (All India) (in MW)</h3>
          </div>
          <div className="card-body" style={{ height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ENERGY_REQ_AVAIL_2022} margin={{ top: 20, right: 0, left: 0, bottom: 20 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{fontSize: 11, fill: '#4b5563'}} axisLine={{ stroke: '#d1d5db' }} tickLine={false} tickMargin={10} />
                <YAxis tick={{fontSize: 11, fill: '#4b5563'}} domain={[0, 150000]} axisLine={false} tickLine={false} tickFormatter={(val) => `${val/1000}k`} />
                <Tooltip content={<CustomBarTooltip />} cursor={{ fill: '#f3f4f6' }} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{fontSize: '12px', fontWeight: 600}}/>
                <Bar dataKey="requirement" name="Energy Requirement" fill="#54c2db" />
                <Bar dataKey="available" name="Energy Available" fill="#a4d142" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom Row: Dark Mode Installed Capacity Composed Chart */}
      <div className="card" style={{ background: '#0b0c10', border: '1px solid #1f2833' }}>
        <div className="card-header" style={{ borderBottom: '1px solid #1f2833', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           <h3 style={{ color: '#d1d5db', margin: 0 }}>Category Wise Installed Capacity (All India) (MW)</h3>
           <span style={{ color: '#6b7280', fontSize: '12px' }}>Dark Mode Analytics View</span>
        </div>
        
        <div className="card-body" style={{ height: '400px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={INSTALLED_CAPACITY_DATA} margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
              <CartesianGrid stroke="#1f2833" vertical={false} />
              
              <XAxis 
                dataKey="month" 
                tick={{fontSize: 11, fill: '#64748b'}} 
                axisLine={{ stroke: '#334155' }}
                tickLine={false}
                tickMargin={10}
              />
              
              <YAxis 
                yAxisId="left" 
                tick={{fontSize: 11, fill: '#64748b'}} 
                axisLine={false} 
                tickLine={false} 
                domain={[0, 300000]} 
                tickFormatter={(val) => `${val/1000}k`}
              />
              
              {/* Secondary Y-Axis for Nuclear (Red line) scaled exactly to show variation */}
              <YAxis 
                yAxisId="right" 
                orientation="right" 
                tick={{fontSize: 11, fill: '#64748b'}} 
                axisLine={false} 
                tickLine={false} 
                domain={[8174, 8186]}
                label={{ value: 'Nuclear', angle: 90, position: 'insideRight', fill: '#64748b', fontSize: 11 }}
              />
              
              <Tooltip content={<DarkModeTooltip />} cursor={{fill: 'rgba(255,255,255,0.02)'}} />
              <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{fontSize: '11px', color: '#64748b', paddingTop: '20px'}}/>
              
              <Bar yAxisId="left" dataKey="thermal" name="Thermal" fill="#475569" barSize={35} />
              <Bar yAxisId="left" dataKey="hydro" name="Hydro" fill="#0284c7" barSize={35} />
              <Bar yAxisId="left" dataKey="res" name="RES" fill="#16a34a" barSize={35} />
              
              <Line yAxisId="right" type="step" dataKey="nuclear" name="Nuclear" stroke="#ef4444" strokeWidth={2} dot={{r: 4, stroke: '#ef4444', fill: '#0b0c10', strokeWidth: 2}} activeDot={{r: 6}} />
              
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  );
}
