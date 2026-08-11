import React, { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function MMRDashboard() {
  const [selectedYear, setSelectedYear] = useState('2026');
  const [selectedMonth, setSelectedMonth] = useState('January');

  // Datasets for 2026
  const shortTermData2026 = [
    { name: 'Power Exchanges', value: 88.2, color: '#474a59' }, // Dark Slate
    { name: 'Bilateral', value: 8.5, color: '#bdec38' }, // Lime Green
    { name: 'Dsm', value: 3.3, color: '#5a7bf6' }, // Blue
  ];

  const iexData2026 = [
    { name: 'DAM', value: 128544.16, color: '#5a7bf6' },
    { name: 'GDAM', value: 29500.00, color: '#bdec38' },
    { name: 'HP-DAM', value: 3200.00, color: '#474a59' },
    { name: 'RTM', value: 2100.00, color: '#fb923c' },
  ];

  const pxilData2026 = [
    { name: 'GDAM', value: 4638.3, color: '#bdec38' },
    { name: 'DAM', value: 120.5, color: '#5a7bf6' },
    { name: 'HP-DAM', value: 5.2, color: '#474a59' },
    { name: 'RTM', value: 2.1, color: '#fb923c' },
  ];

  const hpxData2026 = [
    { name: 'DAM', value: 14500.00, color: '#5a7bf6' },
    { name: 'GDAM', value: 150.00, color: '#bdec38' },
    { name: 'HP-DAM', value: 10.00, color: '#474a59' },
    { name: 'RTM', value: 5.00, color: '#fb923c' },
  ];

  // Datasets for 2023
  const shortTermData2023 = [
    { name: 'Power Exchanges', value: 60.0, color: '#474a59' },
    { name: 'Bilateral', value: 28.0, color: '#bdec38' },
    { name: 'Dsm', value: 12.0, color: '#5a7bf6' },
  ];

  const iexData2023 = [
    { name: 'DAM', value: 52000.00, color: '#5a7bf6' },
    { name: 'GDAM', value: 12000.00, color: '#bdec38' },
    { name: 'HP-DAM', value: 2000.00, color: '#474a59' },
    { name: 'RTM', value: 34000.00, color: '#fb923c' },
  ];

  const pxilData2023 = [
    { name: 'GDAM', value: 1000.0, color: '#bdec38' },
    { name: 'DAM', value: 1500.0, color: '#5a7bf6' },
    { name: 'HP-DAM', value: 0.0, color: '#474a59' },
    { name: 'RTM', value: 50.0, color: '#fb923c' },
  ];

  const hpxData2023 = [
    { name: 'DAM', value: 2000.00, color: '#5a7bf6' },
    { name: 'GDAM', value: 10.00, color: '#bdec38' },
    { name: 'HP-DAM', value: 0.00, color: '#474a59' },
    { name: 'RTM', value: 200.00, color: '#fb923c' },
  ];

  // Selecting active data based on year
  const activeShortTerm = selectedYear === '2026' ? shortTermData2026 : shortTermData2023;
  const activeIEX = selectedYear === '2026' ? iexData2026 : iexData2023;
  const activePXIL = selectedYear === '2026' ? pxilData2026 : pxilData2023;
  const activeHPX = selectedYear === '2026' ? hpxData2026 : hpxData2023;

  // Custom tooltips
  const CustomPieTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-200 shadow-md rounded p-2 text-sm">
          <div className="text-gray-500 mb-1 border-b pb-1 text-xs">{`Volume of Short-Term Transaction of Electricity and DSM (MU)`}</div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: payload[0].payload.color }}></div>
            <span className="font-medium text-gray-700">{payload[0].name}</span>
            <span className="ml-4 font-bold text-gray-900">{payload[0].value.toLocaleString()}</span>
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomExchangeTooltip = ({ active, payload, exchangeName }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-200 shadow-md rounded p-2 text-sm">
          <div className="text-gray-500 mb-1 border-b pb-1 text-xs">{`Volume Transactions in ${exchangeName} (MU)`}</div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: payload[0].payload.color }}></div>
            <span className="font-medium text-gray-700">{payload[0].name}</span>
            <span className="ml-4 font-bold text-gray-900">{payload[0].value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>MMR Dashboard</h1>
          <div className="page-subtitle">Market Monitoring Reports and Exchange analytics</div>
        </div>
      </div>

      {/* Control Filter Bar */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-body" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <select 
            value={selectedYear} 
            onChange={(e) => setSelectedYear(e.target.value)} 
            style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', minWidth: '120px' }}
          >
            <option value="2026">2026</option>
            <option value="2023">2023</option>
          </select>
          
          <select 
            value={selectedMonth} 
            onChange={(e) => setSelectedMonth(e.target.value)} 
            style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', minWidth: '120px' }}
          >
            <option value="January">January</option>
            <option value="February">February</option>
          </select>
          
          <button style={{ padding: '8px 16px', background: '#0b5ed7', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Show Data
          </button>
        </div>
      </div>

      {/* Main Charts Grid (Top Row) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        
        {/* Short Term & DSM Doughnut */}
        <div className="card">
          <div className="card-header">
            <h3>Volume of Short-Term Transaction of Electricity and DSM (MU)</h3>
          </div>
          <div className="card-body" style={{ height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={activeShortTerm} 
                  dataKey="value" 
                  innerRadius={70} 
                  outerRadius={110} 
                  label={({name}) => name}
                  labelLine={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                >
                  {activeShortTerm.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomPieTooltip />} />
                <Legend verticalAlign="bottom" height={36} iconType="square" wrapperStyle={{fontSize: '12px', paddingTop: '20px'}}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* IEX Volume Breakdown Pie */}
        <div className="card">
          <div className="card-header">
            <h3>Volume Transactions in IEX (MU)</h3>
          </div>
          <div className="card-body" style={{ height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={activeIEX} 
                  dataKey="value" 
                  outerRadius={110} 
                  label={({name}) => name}
                  labelLine={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                >
                  {activeIEX.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomExchangeTooltip exchangeName="IEX" />} />
                <Legend verticalAlign="bottom" height={36} iconType="square" wrapperStyle={{fontSize: '12px', paddingTop: '20px'}}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Secondary Exchanges Grid (Bottom Row) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        
        {/* PXIL Volume Pie */}
        <div className="card">
          <div className="card-header">
            <h3>Volume Transactions in PXIL (MU)</h3>
          </div>
          <div className="card-body" style={{ height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={activePXIL} 
                  dataKey="value" 
                  outerRadius={90} 
                  label={({name}) => name}
                  labelLine={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                >
                  {activePXIL.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomExchangeTooltip exchangeName="PXIL" />} />
                <Legend verticalAlign="bottom" height={36} iconType="square" wrapperStyle={{fontSize: '12px', paddingTop: '10px'}}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* HPX Volume Pie */}
        <div className="card">
          <div className="card-header">
            <h3>Volume Transactions in HPX (MU)</h3>
          </div>
          <div className="card-body" style={{ height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={activeHPX} 
                  dataKey="value" 
                  outerRadius={90} 
                  label={({name}) => name}
                  labelLine={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                >
                  {activeHPX.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomExchangeTooltip exchangeName="HPX" />} />
                <Legend verticalAlign="bottom" height={36} iconType="square" wrapperStyle={{fontSize: '12px', paddingTop: '10px'}}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

    </div>
  );
}
