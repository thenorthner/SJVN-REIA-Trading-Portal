import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, Cell, ReferenceLine,
} from 'recharts';
import api from '../api/client.js';
import { Card, StatCard, fmtNumber } from './ui.jsx';

/** "2026-05" → "May '26". */
const monthLabel = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

export default function HydroEnergyOverview({ contractId, title, subtitle, showKpis = true }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = { vertical: 'HYDRO' };
    if (contractId && contractId !== 'ALL') {
      params.contract_id = contractId;
    }
    Promise.resolve(api.energyRecords?.analytics?.(params))
      .then((res) => setData(res || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [contractId]);

  const series = data?.series || [];
  const t = data?.totals;

  // Station name if specific contract chosen
  const stationName = contractId === 'CON-NJHPS-001'
    ? 'Nathpa Jhakri HEP (1,500 MW)'
    : contractId === 'CON-RHPS-001'
    ? 'Rampur HEP (412 MW)'
    : null;

  return (
    <div style={{ marginBottom: 24 }}>
      {showKpis && (
        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          <StatCard
            label={t && t.months > 0 ? `Energy — last ${t.months} months` : 'Energy (last 12 months)'}
            value={t ? `${fmtNumber(t.energy_mwh)} MWh` : (loading ? 'Loading…' : '—')}
            tone="blue"
            hint={stationName ? `Ex-bus generation for ${stationName}` : 'Total ex-bus generation across hydro fleet (NRPC certified)'}
          />
          <StatCard
            label="Average Plant Availability (PAFM)"
            value={t?.avg_cuf_percent != null ? `${fmtNumber(t.avg_cuf_percent)}%` : (loading ? 'Loading…' : '—')}
            tone={t?.avg_cuf_percent >= 87 ? 'green' : 'amber'}
            hint="CERC normative benchmark: 87.0% NAPAF"
          />
          <StatCard
            label="Peak Generation Month"
            value={t?.best_month ? `${t.best_month.period}` : '—'}
            tone="blue"
            hint={t?.best_month ? `${fmtNumber(t.best_month.energy_mwh)} MWh ex-bus` : 'Highest single-month generation'}
          />
          <StatCard
            label="NRPC Certified Accounts"
            value={series.length ? `${series.length} Months` : (loading ? 'Loading…' : '—')}
            tone="default"
            hint="Table D2 Regional Energy Accounts on record"
          />
        </div>
      )}

      <Card
        title={title || `Regional Energy Account (REA) — Generation & Plant Availability Month on Month${stationName ? ` (${stationName})` : ' — All Hydro Stations'}`}
      >
        <div style={{ padding: '4px 0 12px', fontSize: 15, color: 'var(--slate-500)' }}>
          {subtitle || 'Actual ex-bus generation in MWh and plant availability factor (PAFM %) certified by Northern Regional Power Committee (NRPC)'}
        </div>

        {series.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--slate-500)', fontSize: 15 }}>
            {loading ? 'Loading REA energy data from NRPC records…' : 'No energy records found for the selected station.'}
          </div>
        ) : (
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="period" tickFormatter={monthLabel} tick={{ fontSize: 14 }} />
                <YAxis
                  yAxisId="mwh"
                  tick={{ fontSize: 14 }}
                  width={72}
                  tickFormatter={(v) => fmtNumber(v, 0)}
                  label={{ value: 'Energy (MWh)', angle: -90, position: 'insideLeft', offset: 10, fontSize: 13, fill: 'var(--slate-500)' }}
                />
                <YAxis
                  yAxisId="pafm"
                  orientation="right"
                  tick={{ fontSize: 14 }}
                  width={52}
                  unit="%"
                  domain={[0, (max) => Math.ceil(Math.max(max, 100) / 10) * 10 + 10]}
                  label={{ value: 'PAFM %', angle: 90, position: 'insideRight', offset: 10, fontSize: 13, fill: 'var(--slate-500)' }}
                />
                <Tooltip
                  labelFormatter={(p) => {
                    const item = series.find((s) => s.period === p);
                    return `${monthLabel(p)} (${p})${item?.provisional ? ' — Provisional REA' : ' — Final REA'}`;
                  }}
                  formatter={(v, name) => (
                    name.includes('%')
                      ? [`${fmtNumber(v)}%`, name]
                      : [`${fmtNumber(v)} MWh`, name]
                  )}
                />
                <Legend wrapperStyle={{ fontSize: 14.5, paddingTop: 8 }} />
                <Bar
                  yAxisId="mwh"
                  dataKey="energy_mwh"
                  name="Energy Generation (MWh)"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                >
                  {series.map((s) => (
                    <Cell key={s.period} fill={s.provisional ? '#93c5fd' : '#2563eb'} />
                  ))}
                </Bar>
                <Line
                  yAxisId="pafm"
                  type="monotone"
                  dataKey="cuf_percent"
                  name="Availability % (PAFM)"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: '#f59e0b' }}
                  connectNulls
                  isAnimationActive={false}
                />
                <ReferenceLine
                  yAxisId="pafm"
                  y={87.0}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  label={{ value: 'NAPAF Norm 87%', position: 'insideTopRight', fontSize: 13.5, fill: '#ef4444' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
          <p className="inline-note" style={{ margin: 0, fontSize: 14, color: 'var(--slate-500)' }}>
            Darker blue bars indicate Final REA accounts; lighter blue bars indicate Provisional REA accounts.
            Dashed red line indicates CERC NAPAF norm of 87.0%.
          </p>
          <span style={{ fontSize: 13.5, color: 'var(--slate-500)', background: 'var(--slate-100)', padding: '2px 8px', borderRadius: 4 }}>
            Source: Table D2 (NRPC Certified)
          </span>
        </div>
      </Card>
    </div>
  );
}
