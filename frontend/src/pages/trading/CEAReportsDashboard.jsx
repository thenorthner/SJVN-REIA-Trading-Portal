import React, { useState } from 'react';
import { 
  PieChart, Pie, Cell, BarChart, Bar, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import SourceNote from '../../components/SourceNote.jsx';

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

// The From/To selectors drove nothing: whatever was picked, the three time-series
// charts showed their own fixed windows — peak demand from 2024, energy
// requirement from 2022, installed capacity from mid-2024. A single "Apr-2022 to
// Sep-2022" heading sat above two charts plotting 2024.
//
// The filter now selects a window and each series is cut to it. Where a series
// has nothing in range the card says so, rather than drawing an empty grid that
// looks like a rendering fault. That also makes the coverage gaps visible instead
// of hiding them behind a heading that was never true.
const MONTH_INDEX = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };

/** "APR-2022" or "Apr-2022" -> a sortable integer. */
function monthKey(label) {
  const [m, y] = String(label).toUpperCase().split('-');
  if (!(m in MONTH_INDEX) || !y) return NaN;
  return Number(y) * 12 + MONTH_INDEX[m];
}

function withinWindow(rows, from, to) {
  const lo = monthKey(from);
  const hi = monthKey(to);
  if (Number.isNaN(lo) || Number.isNaN(hi)) return rows;
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  return rows.filter((r) => {
    const k = monthKey(r.month);
    return !Number.isNaN(k) && k >= a && k <= b;
  });
}

/** Every month any dataset actually covers, so the selectors can only offer real ones. */
function selectableMonths(...datasets) {
  const seen = new Map();
  for (const rows of datasets) for (const r of rows) {
    const k = monthKey(r.month);
    if (!Number.isNaN(k) && !seen.has(k)) seen.set(k, String(r.month).toUpperCase());
  }
  return [...seen.entries()].sort((x, y) => x[0] - y[0]).map(([, label]) => label);
}

/** A chart with nothing in the chosen window says why. */
function NoDataInRange({ from, to, covers }) {
  return (
    <div style={{ height: 300, display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', color: '#6b7280', fontSize: 13, textAlign: 'center', gap: 6 }}>
      <div style={{ fontWeight: 600 }}>No data for {from} to {to}</div>
      <div style={{ fontSize: 12 }}>This series covers {covers}.</div>
    </div>
  );
}

export default function CEAReportsDashboard() {
  const [fromMonth, setFromMonth] = useState('APR-2022');
  const [toMonth, setToMonth] = useState('NOV-2024');

  const MONTH_OPTIONS = selectableMonths(PEAK_DEMAND_MET_2024, ENERGY_REQ_AVAIL_2022, INSTALLED_CAPACITY_DATA);
  const peakInRange = withinWindow(PEAK_DEMAND_MET_2024, fromMonth, toMonth);
  const energyInRange = withinWindow(ENERGY_REQ_AVAIL_2022, fromMonth, toMonth);
  const capacityInRange = withinWindow(INSTALLED_CAPACITY_DATA, fromMonth, toMonth);
  const coverageOf = (rows) => `${rows[0].month} to ${rows[rows.length - 1].month}`;

  const CustomPieTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: payload[0].payload.color }}></div>
            <span style={{ fontWeight: 500, color: '#374151' }}>{payload[0].name}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, color: '#111827' }}>{payload[0].value}%</span>
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomBarTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, fontSize: 12, minWidth: 200, boxShadow: '0 8px 20px rgba(0,0,0,.10)' }}>
          <div style={{ color: '#4b5563', fontWeight: 700, borderBottom: '1px solid #f3f4f6', paddingBottom: 8, marginBottom: 8 }}>{label}</div>
          {payload.map((entry, index) => (
            <div key={`item-${index}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                 <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: entry.color }}></span>
                 <span style={{ color: '#6b7280', fontWeight: 500 }}>{entry.name}</span>
              </div>
              <span style={{ fontWeight: 700, color: '#1f2937', marginLeft: 16 }}>
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
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: 12, fontSize: 12, minWidth: 200, color: '#e2e8f0', boxShadow: '0 8px 20px rgba(0,0,0,.35)' }}>
          <div style={{ color: '#94a3b8', fontWeight: 700, borderBottom: '1px solid #334155', paddingBottom: 8, marginBottom: 8 }}>{label}</div>
          {payload.map((entry, index) => (
            <div key={`item-${index}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                 <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: entry.color }}></span>
                 <span style={{ color: '#cbd5e1', fontWeight: 500 }}>{entry.name}</span>
              </div>
              <span style={{ fontWeight: 700, color: '#fff', marginLeft: 16 }}>
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
          {/* Every series on this page is a national statistic the CEA publishes.
              None of it is generated by this platform, and sitting in the same
              cards as the trading screens it read as though it were. */}
          <div className="page-subtitle">
            All-India figures published by the Central Electricity Authority — reference data, not platform records
          </div>
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
              {MONTH_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>To Month<span style={{color: 'red'}}>*</span></label>
            <select 
              value={toMonth} 
              onChange={(e) => setToMonth(e.target.value)} 
              style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', minWidth: '140px' }}
            >
              {MONTH_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
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
            {peakInRange.length === 0 ? <NoDataInRange from={fromMonth} to={toMonth} covers={coverageOf(PEAK_DEMAND_MET_2024)} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={peakInRange} margin={{ top: 20, right: 0, left: 0, bottom: 20 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{fontSize: 11, fill: '#4b5563'}} axisLine={{ stroke: '#d1d5db' }} tickLine={false} tickMargin={10} />
                <YAxis tick={{fontSize: 11, fill: '#4b5563'}} domain={[0, 300000]} axisLine={false} tickLine={false} tickFormatter={(val) => `${val/1000}k`} />
                <Tooltip content={<CustomBarTooltip />} cursor={{ fill: '#f3f4f6' }} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{fontSize: '12px', fontWeight: 600}}/>
                <Bar dataKey="peakDemand" name="Peak Demand" fill="#54c2db" />
                <Bar dataKey="peakMet" name="Peak Met" fill="#a4d142" />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Energy Requirements v/s Energy Available (All India) (in MW)</h3>
          </div>
          <div className="card-body" style={{ height: '350px' }}>
            {energyInRange.length === 0 ? <NoDataInRange from={fromMonth} to={toMonth} covers={coverageOf(ENERGY_REQ_AVAIL_2022)} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={energyInRange} margin={{ top: 20, right: 0, left: 0, bottom: 20 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{fontSize: 11, fill: '#4b5563'}} axisLine={{ stroke: '#d1d5db' }} tickLine={false} tickMargin={10} />
                <YAxis tick={{fontSize: 11, fill: '#4b5563'}} domain={[0, 150000]} axisLine={false} tickLine={false} tickFormatter={(val) => `${val/1000}k`} />
                <Tooltip content={<CustomBarTooltip />} cursor={{ fill: '#f3f4f6' }} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{fontSize: '12px', fontWeight: 600}}/>
                <Bar dataKey="requirement" name="Energy Requirement" fill="#54c2db" />
                <Bar dataKey="available" name="Energy Available" fill="#a4d142" />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row: Installed Capacity Composed Chart */}
      <div className="card">
        <div className="card-header">
           <h3>Category Wise Installed Capacity (All India) (MW)</h3>
        </div>
        
        <div className="card-body" style={{ height: '400px' }}>
          {capacityInRange.length === 0 ? <NoDataInRange from={fromMonth} to={toMonth} covers={coverageOf(INSTALLED_CAPACITY_DATA)} /> : (
            <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={capacityInRange} margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
              <CartesianGrid stroke="#e5e7eb" vertical={false} />
              
              <XAxis 
                dataKey="month" 
                tick={{fontSize: 11, fill: '#4b5563'}} 
                axisLine={{ stroke: '#d1d5db' }}
                tickLine={false}
                tickMargin={10}
              />
              
              <YAxis 
                yAxisId="left" 
                tick={{fontSize: 11, fill: '#4b5563'}} 
                axisLine={false} 
                tickLine={false} 
                domain={[0, 300000]} 
                tickFormatter={(val) => `${val/1000}k`}
              />
              
              {/* Secondary Y-Axis for Nuclear (Red line) scaled exactly to show variation */}
              <YAxis 
                yAxisId="right" 
                orientation="right" 
                tick={{fontSize: 11, fill: '#4b5563'}} 
                axisLine={false} 
                tickLine={false} 
                domain={[8174, 8186]}
                label={{ value: 'Nuclear', angle: 90, position: 'insideRight', fill: '#4b5563', fontSize: 11 }}
              />
              
              <Tooltip content={<CustomBarTooltip />} cursor={{fill: '#f3f4f6'}} />
              <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{fontSize: '12px', fontWeight: 600, paddingTop: '20px'}}/>
              
              <Bar yAxisId="left" dataKey="thermal" name="Thermal" fill="#54c2db" barSize={35} />
              <Bar yAxisId="left" dataKey="hydro" name="Hydro" fill="#a4d142" barSize={35} />
              <Bar yAxisId="left" dataKey="res" name="RES" fill="#3b82f6" barSize={35} />
              
              <Line yAxisId="right" type="step" dataKey="nuclear" name="Nuclear" stroke="#ef4444" strokeWidth={2} dot={{r: 4, stroke: '#ef4444', fill: '#fff', strokeWidth: 2}} activeDot={{r: 6}} />
              
            </ComposedChart>
          </ResponsiveContainer>
            )}
        </div>
      </div>

    </div>
  );
}
