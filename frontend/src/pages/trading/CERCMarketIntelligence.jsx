import React, { useState, useEffect } from 'react';
import {
  ComposedChart, LineChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Cell, LabelList
} from 'recharts';
import { Card, StatCard, Table, Badge, PageHeader, fmtCurrency, fmtNumber } from '../../components/ui';
import api from '../../api/client';

const COLORS = {
  dam: '#3b82f6',      // blue
  gdam: '#10b981',     // emerald  
  rtm: '#f59e0b',      // amber
  hpDam: '#8b5cf6',    // violet
  tam: '#ec4899',      // pink
  dsm: '#ef4444',      // red
  rec: '#06b6d4',      // cyan
};

export default function CERCMarketIntelligence() {
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [summary, setSummary] = useState(null);
  const [prices, setPrices] = useState([]);
  const [dailyTrend, setDailyTrend] = useState([]);
  const [volumes, setVolumes] = useState([]);
  const [dsm, setDsm] = useState(null);
  const [rec, setRec] = useState([]);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchPeriods = async () => {
    try {
      const p = await api.cercMarket.getPeriods();
      const normalized = Array.isArray(p) ? p.map(item => typeof item === 'string' ? { period: item } : item) : [];
      setPeriods(normalized);
      if (normalized.length > 0) {
        setSelectedPeriod(prev => prev || normalized[0].period);
      }
    } catch (e) {
      console.error(e);
      setPeriods([{ period: '2026-01' }]);
      setSelectedPeriod(prev => prev || '2026-01');
    }
  };

  useEffect(() => {
    fetchPeriods();
  }, []);

  const fetchData = async () => {
    if (!selectedPeriod) return;
    setLoading(true);
    setError('');
    
    try {
      const sum = await api.cercMarket.getSummary(selectedPeriod);
      setSummary(sum);
      
      const px = await api.cercMarket.getPrices({ period: selectedPeriod });
      setPrices(Array.isArray(px) ? px : []);
      
      const trend = await api.cercMarket.getDailyTrend({ period: selectedPeriod });
      setDailyTrend(Array.isArray(trend) ? trend : []);
      
      const vol = await api.cercMarket.getVolumes({ period: selectedPeriod });
      setVolumes(Array.isArray(vol) ? vol : []);
      
      const dsmData = await api.cercMarket.getDsm({ period: selectedPeriod });
      setDsm(dsmData || null);
      
      const recData = await api.cercMarket.getRec({ period: selectedPeriod });
      setRec(Array.isArray(recData) ? recData : []);
      
    } catch (err) {
      console.error(err);
      setError('Failed to fetch market data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPeriod) {
      fetchData();
    }
  }, [selectedPeriod]);

  const handleTriggerFetch = async () => {
    try {
      setLoading(true);
      setError('');
      await api.cercMarket.triggerFetch(selectedPeriod || '2026-01');
      await fetchPeriods();
      await fetchData();
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.error || err.message || 'Failed to trigger fetch.');
      setLoading(false);
    }
  };

  // Format period for display
  const periodLabel = selectedPeriod ? new Date(selectedPeriod + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '';

  return (
    <div style={{ padding: 20 }}>
      {/* 1. CONTROL BAR */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 15, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 5, fontWeight: 600, color: 'var(--slate-600)' }}>Select Month</label>
            <select 
              className="input" 
              value={selectedPeriod} 
              onChange={e => setSelectedPeriod(e.target.value)}
              style={{ width: 200, padding: '8px 12px' }}
            >
              {periods.map(p => {
                let label = p.period;
                try {
                  const [y, m] = p.period.split('-');
                  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
                  label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
                } catch (e) {}
                return (
                  <option key={p.period} value={p.period}>
                    {label} ({p.period})
                  </option>
                );
              })}
            </select>
          </div>
          
          <div style={{ marginTop: 22 }}>
            <button className="btn btn-outline" onClick={fetchData} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          
          <div style={{ marginTop: 22 }}>
            <button className="btn btn-primary" onClick={handleTriggerFetch} disabled={loading}>
              {loading ? 'Fetching CERC Report...' : 'Fetch Latest CERC MMC Report'}
            </button>
          </div>
          
          <div style={{ marginLeft: 'auto', textAlign: 'right', marginTop: 22 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--slate-800)' }}>
              Period: {periodLabel || selectedPeriod}
            </div>
            <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>
              Source: CERC Monthly Market Monitoring
            </div>
          </div>
        </div>
      </Card>

      {/* 2. ERROR & EMPTY STATES */}
      {error && (
        <div style={{ padding: '14px 20px', marginBottom: 20, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><strong>Notice: </strong> {error}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={fetchData} style={{ fontSize: 12, padding: '4px 10px' }}>Retry</button>
            <button className="btn btn-primary" onClick={handleTriggerFetch} style={{ fontSize: 12, padding: '4px 10px' }}>Fetch CERC Report</button>
          </div>
        </div>
      )}

      {loading && !summary && (
        <Card style={{ padding: 60, textAlign: 'center', color: 'var(--slate-600)' }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Loading CERC Market Intelligence Data...</div>
          <div style={{ fontSize: 13, color: 'var(--slate-400)', marginTop: 8 }}>Fetching records for {selectedPeriod}...</div>
        </Card>
      )}

      {!loading && !summary && (
        <Card style={{ padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--slate-800)', marginBottom: 8 }}>
            No CERC Market Data Found for {selectedPeriod || 'Selected Period'}
          </div>
          <p style={{ color: 'var(--slate-500)', maxWidth: 500, margin: '0 auto 20px auto', fontSize: 14 }}>
            The CERC Monthly Market Monitoring report has not been imported for this period yet. Click the button below to download and parse the official report.
          </p>
          <button className="btn btn-primary" onClick={handleTriggerFetch} disabled={loading} style={{ padding: '10px 24px', fontSize: 14 }}>
            Fetch & Parse CERC MMC Report ({selectedPeriod})
          </button>
        </Card>
      )}

      {/* 3. KPI CARDS ROW */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 15, marginBottom: 20 }}>
          <StatCard 
            label="IEX DAM Avg" 
            value={`${fmtNumber(summary.iexDamAvg, 2)} Rs/kWh`} 
            hint={summary.iexDamMom ? `${summary.iexDamMom > 0 ? '+' : ''}${fmtNumber(summary.iexDamMom, 1)}% MoM` : ''} 
            tone={summary.iexDamMom > 0 ? 'amber' : 'green'} 
          />
          <StatCard 
            label="GDAM Avg" 
            value={`${fmtNumber(summary.gdamAvg, 2)} Rs/kWh`} 
            hint={summary.gdamMom ? `${summary.gdamMom > 0 ? '+' : ''}${fmtNumber(summary.gdamMom, 1)}% MoM` : ''} 
            tone={summary.gdamMom > 0 ? 'amber' : 'green'} 
          />
          <StatCard 
            label="RTM Avg" 
            value={`${fmtNumber(summary.rtmAvg, 2)} Rs/kWh`} 
            hint={summary.rtmMom ? `${summary.rtmMom > 0 ? '+' : ''}${fmtNumber(summary.rtmMom, 1)}% MoM` : ''} 
            tone={summary.rtmMom > 0 ? 'amber' : 'green'} 
          />
          <StatCard 
            label="Total Volume" 
            value={`${fmtNumber(summary.totalVolume, 2)} MU`} 
            hint={summary.volumeMom ? `${summary.volumeMom > 0 ? '+' : ''}${fmtNumber(summary.volumeMom, 1)}% MoM` : ''} 
            tone="blue" 
          />
          <StatCard 
            label="DSM Avg Charge" 
            value={`${fmtNumber(summary.dsmAvg, 2)} Rs/kWh`} 
            hint={summary.dsmMom ? `${summary.dsmMom > 0 ? '+' : ''}${fmtNumber(summary.dsmMom, 1)}% MoM` : ''} 
            tone="red" 
          />
          <StatCard 
            label="REC Avg Price" 
            value={`${fmtNumber(summary.recAvg, 0)} Rs/MWh`} 
            hint={summary.recMom ? `${summary.recMom > 0 ? '+' : ''}${fmtNumber(summary.recMom, 1)}% MoM` : ''} 
            tone="cyan" 
          />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* 3. EXCHANGE PRICE COMPARISON TABLE */}
        <Card title="Exchange Price Comparison (Rs/kWh) & Volumes (MU)">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ margin: 0, fontSize: 13 }}>
              <thead style={{ background: 'var(--slate-100)' }}>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col" style={{ textAlign: 'right' }}>IEX Avg</th>
                  <th scope="col" style={{ textAlign: 'right' }}>PXIL Avg</th>
                  <th scope="col" style={{ textAlign: 'right' }}>HPX Avg</th>
                  <th scope="col" style={{ textAlign: 'right' }}>IEX Vol</th>
                  <th scope="col" style={{ textAlign: 'right' }}>PXIL Vol</th>
                  <th scope="col" style={{ textAlign: 'right' }}>HPX Vol</th>
                </tr>
              </thead>
              <tbody>
                {prices.map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{p.product}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNumber(p.iexAvg, 2)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNumber(p.pxilAvg, 2)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNumber(p.hpxAvg, 2)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNumber(p.iexVol, 2)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNumber(p.pxilVol, 2)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNumber(p.hpxVol, 2)}</td>
                  </tr>
                ))}
                {prices.length === 0 && (
                  <tr>
                    <td colSpan="7" className="empty-cell">No exchange data available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* 5. PRODUCT VOLUME DISTRIBUTION */}
        <Card title="Volume Distribution by Product (MU)">
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumes} layout="vertical" margin={{ top: 20, right: 30, left: 40, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--slate-200)" />
                <XAxis type="number" tick={{ fontSize: 12, fill: 'var(--slate-500)' }} />
                <YAxis type="category" dataKey="product" tick={{ fontSize: 12, fontWeight: 600, fill: 'var(--slate-700)' }} />
                <Tooltip 
                  formatter={(value) => [`${fmtNumber(value, 2)} MU`, 'Volume']}
                  contentStyle={{ borderRadius: 8, border: '1px solid var(--slate-200)', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="volume" radius={[0, 4, 4, 0]}>
                  {volumes.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[entry.product.toLowerCase().replace('-', '')] || COLORS.dam} />
                  ))}
                  <LabelList dataKey="volume" position="right" formatter={(v) => fmtNumber(v, 2)} style={{ fontSize: 11, fill: 'var(--slate-600)' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* 4. DAILY PRICE TREND CHART */}
      <Card title="Daily Price & Volume Trend" style={{ marginBottom: 20 }}>
        <div style={{ height: 400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dailyTrend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--slate-200)" />
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: 'var(--slate-500)' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12, fill: 'var(--slate-500)' }} label={{ value: 'Price (Rs/kWh)', angle: -90, position: 'insideLeft', style: { fill: 'var(--slate-500)' } }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: 'var(--slate-500)' }} label={{ value: 'Volume (MU)', angle: 90, position: 'insideRight', style: { fill: 'var(--slate-500)' } }} />
              <Tooltip 
                contentStyle={{ borderRadius: 8, border: '1px solid var(--slate-200)', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
              />
              <Legend verticalAlign="top" height={36} />
              <Bar yAxisId="right" dataKey="totalVolume" name="Total Vol (MU)" fill="var(--slate-200)" radius={[4, 4, 0, 0]} opacity={0.5} />
              <Line yAxisId="left" type="monotone" dataKey="damPrice" name="DAM Price" stroke={COLORS.dam} strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="left" type="monotone" dataKey="gdamPrice" name="GDAM Price" stroke={COLORS.gdam} strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="left" type="monotone" dataKey="rtmPrice" name="RTM Price" stroke={COLORS.rtm} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* 6. DSM PANEL */}
        <Card title="Deviation Settlement Mechanism (DSM)">
          {dsm ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 15, marginBottom: 20 }}>
                <div style={{ background: '#f8fafc', padding: 15, borderRadius: 8, border: '1px solid var(--slate-200)' }}>
                  <div style={{ fontSize: 12, color: 'var(--slate-500)', marginBottom: 5 }}>Min Charge</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--slate-800)' }}>{fmtNumber(dsm.minCharge, 2)} <span style={{ fontSize: 12, fontWeight: 'normal', color: 'var(--slate-500)' }}>Rs/kWh</span></div>
                </div>
                <div style={{ background: '#f8fafc', padding: 15, borderRadius: 8, border: '1px solid var(--slate-200)' }}>
                  <div style={{ fontSize: 12, color: 'var(--slate-500)', marginBottom: 5 }}>Avg Charge</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--slate-800)' }}>{fmtNumber(dsm.avgCharge, 2)} <span style={{ fontSize: 12, fontWeight: 'normal', color: 'var(--slate-500)' }}>Rs/kWh</span></div>
                </div>
                <div style={{ background: '#f8fafc', padding: 15, borderRadius: 8, border: '1px solid var(--slate-200)' }}>
                  <div style={{ fontSize: 12, color: 'var(--slate-500)', marginBottom: 5 }}>Max Charge</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--slate-800)' }}>{fmtNumber(dsm.maxCharge, 2)} <span style={{ fontSize: 12, fontWeight: 'normal', color: 'var(--slate-500)' }}>Rs/kWh</span></div>
                </div>
              </div>
              
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dsm.dailyTrend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="charge" name="DSM Rate" stroke={COLORS.dsm} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="empty-cell">No DSM data available</div>
          )}
        </Card>

        {/* 7. REC TRADING PANEL */}
        <Card title="REC Trading Summary">
          <table className="data-table" style={{ margin: 0 }}>
            <thead style={{ background: 'var(--slate-100)' }}>
              <tr>
                <th scope="col">Exchange</th>
                <th scope="col" style={{ textAlign: 'right' }}>Volume (RECs)</th>
                <th scope="col" style={{ textAlign: 'right' }}>Avg Price (Rs/MWh)</th>
                <th scope="col" style={{ textAlign: 'right' }}>Value (Cr)</th>
              </tr>
            </thead>
            <tbody>
              {rec.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{r.exchange}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNumber(r.volume, 0)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNumber(r.price, 2)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNumber(r.value, 2)}</td>
                </tr>
              ))}
              {rec.length === 0 && (
                <tr>
                  <td colSpan="4" className="empty-cell">No REC trading data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
