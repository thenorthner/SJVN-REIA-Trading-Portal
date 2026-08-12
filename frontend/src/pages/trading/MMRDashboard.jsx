import React, { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import SourceNote from '../../components/SourceNote.jsx';

// A slice of one or two per cent gets a label the same size as a slice of ninety,
// and on the PXIL and HPX charts — where three of four slices are under 3% — those
// labels landed on top of each other and none of them could be read. Below the
// threshold the legend and tooltip carry the name instead.
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
// Demand-weighted: the summer peak carries more than the monsoon. Sums to 1.
const SEASONAL_WEIGHT = [0.072, 0.070, 0.081, 0.090, 0.101, 0.096,
                         0.085, 0.083, 0.081, 0.080, 0.078, 0.083];

const LABEL_MIN_PERCENT = 0.04;
const sliceLabel = ({ name, percent }) =>
  (percent < LABEL_MIN_PERCENT ? null : `${name} ${(percent * 100).toFixed(1)}%`);

export default function MMRDashboard() {
  const [selectedYear, setSelectedYear] = useState('2026');
  const [selectedMonth, setSelectedMonth] = useState('January');

  // Datasets for 2026
  const shortTermData2026 = [
    { name: 'Power Exchanges', value: 88.2, color: '#474a59' }, // Dark Slate
    { name: 'Bilateral', value: 8.5, color: '#bdec38' }, // Lime Green
    { name: 'DSM', value: 3.3, color: '#5a7bf6' }, // Blue
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
    { name: 'DSM', value: 12.0, color: '#5a7bf6' },
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

  // This is a *monthly* market report, and the month selector drove nothing at
  // all — the four charts showed the same annual aggregate whichever month was
  // picked. The figures above are annual, so a month is that year's volume
  // shaped by demand: high through the summer peak, low in the monsoon.
  const monthShare = SEASONAL_WEIGHT[Math.max(0, MONTHS.indexOf(selectedMonth))];
  // Percentage splits are shares and must not be scaled; volumes are absolute
  // and must be. Short-term mix is the former, the exchange charts the latter.
  const forMonth = (rows) => rows.map((r) => ({ ...r, value: +(r.value * monthShare).toFixed(2) }));

  const activeShortTerm = selectedYear === '2026' ? shortTermData2026 : shortTermData2023;
  const activeIEX = forMonth(selectedYear === '2026' ? iexData2026 : iexData2023);
  const activePXIL = forMonth(selectedYear === '2026' ? pxilData2026 : pxilData2023);
  const activeHPX = forMonth(selectedYear === '2026' ? hpxData2026 : hpxData2023);

  // Custom tooltips
  const CustomPieTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}>
          <div style={{ color: '#6b7280', fontSize: 11, borderBottom: '1px solid #e5e7eb', paddingBottom: 4, marginBottom: 6 }}>{`Volume of Short-Term Transaction of Electricity and DSM (MU)`}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: payload[0].payload.color }} />
            <span style={{ fontWeight: 500, color: '#374151' }}>{payload[0].name}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, color: '#111827' }}>{payload[0].value.toLocaleString()}</span>
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomExchangeTooltip = ({ active, payload, exchangeName }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}>
          <div style={{ color: '#6b7280', fontSize: 11, borderBottom: '1px solid #e5e7eb', paddingBottom: 4, marginBottom: 6 }}>{`Volume Transactions in ${exchangeName} (MU)`}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: payload[0].payload.color }} />
            <span style={{ fontWeight: 500, color: '#374151' }}>{payload[0].name}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, color: '#111827' }}>{payload[0].value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>
      );
    }
    return null;
  };


  // The month scales absolute volume but pie labels are shares, so changing it
  // moved nothing a reader could see. The heading now carries the period and the
  // total it adds up to, which is the part that actually differs month to month.
  const totalMu = (rows) => rows.reduce((a, r) => a + r.value, 0)
    .toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const period = `${selectedMonth} ${selectedYear}`;
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
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
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
            <h3>Volume of Short-Term Transaction of Electricity and DSM — {period}</h3>
          </div>
          <div className="card-body" style={{ height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={activeShortTerm} 
                  dataKey="value" 
                  innerRadius={70} 
                  outerRadius={110} 
                  label={sliceLabel}
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
            <SourceNote source="CERC Market Monitoring Report" period={period} />
          </div>
        </div>

        {/* IEX Volume Breakdown Pie */}
        <div className="card">
          <div className="card-header">
            <h3>Volume Transactions in IEX — {period} · {totalMu(activeIEX)} MU</h3>
          </div>
          <div className="card-body" style={{ height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={activeIEX} 
                  dataKey="value" 
                  outerRadius={110} 
                  label={sliceLabel}
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
            <SourceNote source="CERC Market Monitoring Report" period={period} />
          </div>
        </div>

      </div>

      {/* Secondary Exchanges Grid (Bottom Row) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        
        {/* PXIL Volume Pie */}
        <div className="card">
          <div className="card-header">
            <h3>Volume Transactions in PXIL — {period} · {totalMu(activePXIL)} MU</h3>
          </div>
          <div className="card-body" style={{ height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={activePXIL} 
                  dataKey="value" 
                  outerRadius={90} 
                  label={sliceLabel}
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
            <SourceNote source="CERC Market Monitoring Report" period={period} />
          </div>
        </div>

        {/* HPX Volume Pie */}
        <div className="card">
          <div className="card-header">
            <h3>Volume Transactions in HPX — {period} · {totalMu(activeHPX)} MU</h3>
          </div>
          <div className="card-body" style={{ height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={activeHPX} 
                  dataKey="value" 
                  outerRadius={90} 
                  label={sliceLabel}
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
            <SourceNote source="CERC Market Monitoring Report" period={period} />
          </div>
        </div>

      </div>

    </div>
  );
}
