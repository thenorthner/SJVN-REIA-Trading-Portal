import React, { useEffect, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import api from '../api/client.js';
import { Card, StatCard, fmtNumber } from './ui.jsx';

// Energy and CUF month on month, for SJVN's desk: the same trend a seller sees
// on its own page, across every contract or for the one chosen in the filter,
// with what is waiting on a counterparty's answer and what SJVN has to answer.

const monthLabel = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

export default function EnergyOverview({ contractId, rows = [], onShow }) {
  // Read again whenever the list behind it changes — a record, a validation, a lock.
  const stamp = rows.map((r) => `${r.id}:${r.status}:${r.energy_mwh}`).join('|');
  const [a, setA] = useState(null);
  useEffect(() => {
    // A courtesy above the list: if it cannot load, the list stands without it.
    Promise.resolve(api.energyRecords?.analytics?.(contractId ? { contract_id: contractId } : undefined)).then((r) => setA(r || false)).catch(() => setA(false));
  }, [contractId, stamp]);

  const live = rows.filter((r) => !r.is_superseded);
  const awaiting = live.filter((r) => r.status === 'VALIDATED' && !r.response_status).length;
  const objected = live.filter((r) => r.response_status === 'OBJECTED' && !r.objection_outcome).length;
  const toValidate = live.filter((r) => ['SUBMITTED', 'PENDING', 'DRAFT'].includes(r.status)).length;
  const series = a?.series || [];
  const t = a?.totals;
  const minCuf = series.find((s) => s.min_cuf_percent != null)?.min_cuf_percent ?? null;

  return (
    <>
      <div className="kpi-grid">
        <StatCard label={t && t.months > 0 ? `Energy — last ${t.months} month${t.months === 1 ? '' : 's'}` : 'Energy'} value={t ? `${fmtNumber(t.energy_mwh)} MWh` : '—'} tone="blue" />
        <StatCard label="Average CUF" value={t?.avg_cuf_percent != null ? `${fmtNumber(t.avg_cuf_percent)}%` : '—'} hint={contractId && minCuf != null ? `Contractual minimum ${fmtNumber(minCuf)}%` : contractId ? undefined : 'Across the contracts shown'} />
        <StatCard label="Objections to answer" value={objected} tone={objected ? 'red' : 'green'} hint="A counterparty does not accept the figure" onClick={objected && onShow ? () => onShow('OBJECTED') : undefined} />
        <StatCard label="Awaiting the counterparty" value={awaiting} tone={awaiting ? 'amber' : 'default'} hint="Validated, not yet accepted or objected to" />
        <StatCard label="Still to validate" value={toValidate} tone={toValidate ? 'amber' : 'default'} hint="Recorded, not yet validated" />
      </div>
      {series.length > 0 && (
        <Card title={`Energy month on month${contractId ? '' : ' — all contracts'}`} style={{ marginBottom: 16 }}>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="period" tickFormatter={monthLabel} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="mwh" tick={{ fontSize: 11 }} width={64} tickFormatter={(v) => fmtNumber(v, 0)} />
                <YAxis yAxisId="cuf" orientation="right" tick={{ fontSize: 11 }} width={44} unit="%" domain={[0, (max) => Math.ceil(Math.max(max, minCuf || 0) / 10) * 10 + 10]} />
                <Tooltip labelFormatter={(p) => `${monthLabel(p)}${series.find((s) => s.period === p)?.provisional ? ' — provisional' : ''}`}
                  formatter={(v, name) => (name === 'CUF' ? [`${fmtNumber(v)}%`, name] : [`${fmtNumber(v)} MWh`, name])} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="mwh" dataKey="energy_mwh" name="Energy" fill="url(#eliteBlue)" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {series.map((s) => <Cell key={s.period} fill={s.provisional ? '#93c5fd' : '#2563eb'} />)}
                </Bar>
                <Line yAxisId="cuf" type="monotone" dataKey="cuf_percent" name="CUF" stroke="url(#eliteOrange)" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                {contractId && minCuf != null && <ReferenceLine yAxisId="cuf" y={minCuf} stroke="url(#eliteRed)" strokeDasharray="5 4" label={{ value: `Min CUF ${minCuf}%`, position: 'insideTopRight', fontSize: 11, fill: '#dc2626' }} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="inline-note" style={{ margin: '6px 0 0' }}>Darker bars are final figures, lighter ones provisional. Choose a contract in the filter below to see it against its own minimum CUF.</p>
        </Card>
      )}
    </>
  );
}
