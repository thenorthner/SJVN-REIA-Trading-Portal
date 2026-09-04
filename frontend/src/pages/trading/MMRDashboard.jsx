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

// Two-line slice label keeps text fully inside the chart card box without clipping
const renderCustomSliceLabel = ({ percent, name, x, y, textAnchor }) => {
  if (percent < LABEL_MIN_PERCENT) return null;
  const pctStr = `${(percent * 100).toFixed(1)}%`;
  return (
    <text
      x={x}
      y={y}
      fill="#334155"
      textAnchor={textAnchor}
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
    >
      <tspan x={x} dy="-0.4em">{name}</tspan>
      <tspan x={x} dy="1.25em" fill="#0f172a" fontWeight={700}>{pctStr}</tspan>
    </text>
  );
};

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

  const monthShare = SEASONAL_WEIGHT[Math.max(0, MONTHS.indexOf(selectedMonth))];
  const forMonth = (rows) => rows.map((r) => ({ ...r, value: +(r.value * monthShare).toFixed(2) }));

  const activeShortTerm = selectedYear === '2026' ? shortTermData2026 : shortTermData2023;
  const activeIEX = forMonth(selectedYear === '2026' ? iexData2026 : iexData2023);
  const activePXIL = forMonth(selectedYear === '2026' ? pxilData2026 : pxilData2023);
  const activeHPX = forMonth(selectedYear === '2026' ? hpxData2026 : hpxData2023);

  const totalMu = (rows) => rows.reduce((a, r) => a + r.value, 0)
    .toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const period = `${selectedMonth} ${selectedYear}`;

  // Uniform, beautifully styled tooltip dialog box for all graphs
  const CustomGraphTooltip = ({ active, payload, title, isPercentage = false, totalVolume = null }) => {
    if (!active || !payload || !payload.length) return null;
    const entry = payload[0];
    const color = entry.payload?.color || entry.color || '#3b82f6';
    const name = entry.name;
    const val = entry.value;

    let valueDisplay = '';
    let shareDisplay = '';

    if (isPercentage) {
      valueDisplay = `${val}%`;
      shareDisplay = 'Volume Share';
    } else {
      valueDisplay = `${val.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MU`;
      if (totalVolume && totalVolume > 0) {
        shareDisplay = `${((val / totalVolume) * 100).toFixed(1)}% share`;
      }
    }

    return (
      <div style={{
        background: '#ffffff',
        border: '1px solid #cbd5e1',
        borderRadius: '8px',
        padding: '10px 14px',
        boxShadow: '0 4px 16px rgba(15, 23, 42, 0.12)',
        minWidth: '220px',
        maxWidth: '280px',
        boxSizing: 'border-box',
        pointerEvents: 'none'
      }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
          {title}
        </div>
        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', marginBottom: '6px' }}>
          {period}
        </div>
        <div style={{
          borderTop: '1px solid #e2e8f0',
          paddingTop: '8px',
          marginTop: '6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              width: '9px',
              height: '9px',
              borderRadius: '50%',
              backgroundColor: color,
              flexShrink: 0,
              display: 'inline-block'
            }} />
            <span style={{ fontWeight: 600, color: '#334155', fontSize: '12px' }}>
              {name}
            </span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '12.5px' }}>
              {valueDisplay}
            </div>
            {shareDisplay && (
              <div style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 500 }}>
                {shareDisplay}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const iexTotal = activeIEX.reduce((a, r) => a + r.value, 0);
  const pxilTotal = activePXIL.reduce((a, r) => a + r.value, 0);
  const hpxTotal = activeHPX.reduce((a, r) => a + r.value, 0);

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
          <div className="card-body" style={{ height: '370px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 10, right: 35, bottom: 10, left: 35 }}>
                  <Pie 
                    data={activeShortTerm} 
                    dataKey="value" 
                    innerRadius={52} 
                    outerRadius={80} 
                    label={renderCustomSliceLabel}
                    labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}
                  >
                    {activeShortTerm.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomGraphTooltip title="Short-Term Transactions & DSM" isPercentage={true} />} />
                  <Legend verticalAlign="bottom" height={36} iconType="square" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <SourceNote source="CERC Market Monitoring Report" period={period} />
          </div>
        </div>

        {/* IEX Volume Breakdown Pie */}
        <div className="card">
          <div className="card-header">
            <h3>Volume Transactions in IEX — {period} · {totalMu(activeIEX)} MU</h3>
          </div>
          <div className="card-body" style={{ height: '370px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 10, right: 35, bottom: 10, left: 35 }}>
                  <Pie 
                    data={activeIEX} 
                    dataKey="value" 
                    outerRadius={80} 
                    label={renderCustomSliceLabel}
                    labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}
                  >
                    {activeIEX.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomGraphTooltip title="Volume Transactions in IEX" totalVolume={iexTotal} />} />
                  <Legend verticalAlign="bottom" height={36} iconType="square" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
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
          <div className="card-body" style={{ height: '370px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 10, right: 35, bottom: 10, left: 35 }}>
                  <Pie 
                    data={activePXIL} 
                    dataKey="value" 
                    outerRadius={80} 
                    label={renderCustomSliceLabel}
                    labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}
                  >
                    {activePXIL.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomGraphTooltip title="Volume Transactions in PXIL" totalVolume={pxilTotal} />} />
                  <Legend verticalAlign="bottom" height={36} iconType="square" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <SourceNote source="CERC Market Monitoring Report" period={period} />
          </div>
        </div>

        {/* HPX Volume Pie */}
        <div className="card">
          <div className="card-header">
            <h3>Volume Transactions in HPX — {period} · {totalMu(activeHPX)} MU</h3>
          </div>
          <div className="card-body" style={{ height: '370px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 10, right: 35, bottom: 10, left: 35 }}>
                  <Pie 
                    data={activeHPX} 
                    dataKey="value" 
                    outerRadius={80} 
                    label={renderCustomSliceLabel}
                    labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}
                  >
                    {activeHPX.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomGraphTooltip title="Volume Transactions in HPX" totalVolume={hpxTotal} />} />
                  <Legend verticalAlign="bottom" height={36} iconType="square" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <SourceNote source="CERC Market Monitoring Report" period={period} />
          </div>
        </div>

      </div>

    </div>
  );
}
