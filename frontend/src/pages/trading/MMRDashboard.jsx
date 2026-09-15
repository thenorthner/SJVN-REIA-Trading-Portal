import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import api from '../../api/client.js';
import { PageHeader, Card } from '../../components/ui.jsx';
import SourceNote from '../../components/SourceNote.jsx';
import { useCercMonth, PeriodSelect, NoReport, periodLabel, mu } from './cercMonth.jsx';

// The CERC Market Monitoring Report, a month at a time and month by month.
//
// This carried two years of hardcoded annual figures (2023 and 2026) and, since
// the month picker "drove nothing", divided the annual volume across the months by
// a demand-shaped "seasonal weight" — a monthly number the report never printed.
// It reads the months the platform has loaded from the report itself.

// Validated (dataviz, all pairs): bilateral blue, exchanges green, DSM orange.
const MIX = [
  { key: 'bilateral_mu', label: 'Bilateral', colour: 'var(--primary)' },
  { key: 'exchanges_mu', label: 'Power exchanges', colour: 'var(--green)' },
  { key: 'dsm_mu', label: 'Through DSM', colour: '#c2410c' },
];

function ExchangeCard({ month, exchange }) {
  const ex = month.exchanges.find((e) => e.exchange === exchange);
  const rows = ex.volumes.filter((v) => v.volume_mu != null);
  return (
    <Card title={`${exchange} — ${mu(ex.total_mu)} MU`}>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead><tr><th scope="col">Product</th><th scope="col" className="num">Volume MU</th><th scope="col" className="num">Share</th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="empty-cell" colSpan={3}>No volume reported.</td></tr>
            ) : rows.map((v) => (
              <tr key={v.product}>
                <td>{v.product}</td>
                <td className="num">{mu(v.volume_mu)}</td>
                <td className="num">{ex.total_mu > 0 ? `${((v.volume_mu / ex.total_mu) * 100).toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SourceNote source="CERC Market Monitoring Report" period={periodLabel(month.period)} />
    </Card>
  );
}

export default function MMRDashboard() {
  const { data, error, setPeriod } = useCercMonth();
  const [history, setHistory] = useState([]);

  useEffect(() => {
    api.cercMarket.volumeHistory().then(setHistory).catch(() => setHistory([]));
  }, []);

  return (
    <div className="page">
      <PageHeader title="MMR Dashboard" subtitle="CERC Market Monitoring Report — short-term market volumes by month" />
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {!data ? <Card><div className="audit-placeholder">Loading…</div></Card> : !data.period ? <NoReport /> : (
        <>
          <Card>
            <div className="report-criteria"><PeriodSelect data={data} onChange={setPeriod} /></div>
          </Card>

          <Card title={`Short-term transactions and DSM — ${periodLabel(data.period)} (MU)`}>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={MIX.map((m) => ({ label: m.label, volume: data.short_term[m.key], fill: m.colour }))} layout="vertical" margin={{ top: 8, right: 24, left: 24, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 12, fill: 'var(--text)' }} />
                  <Tooltip formatter={(v) => [`${mu(v)} MU`, 'Volume']} />
                  <Bar dataKey="volume" name="Volume" maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {MIX.map((m) => <Cell key={m.key} fill={m.colour} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="report-count">
              Total short-term transactions and DSM: {mu(data.short_term.total_mu)} MU.
            </p>
            <SourceNote source="CERC Market Monitoring Report" period={periodLabel(data.period)} />
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            {['IEX', 'PXIL', 'HPX'].map((ex) => <ExchangeCard key={ex} month={data} exchange={ex} />)}
          </div>
        </>
      )}

      {history.length > 1 && (
        <Card title="Month by month (MU)">
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="period" tickFormatter={periodLabel} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} minTickGap={16} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={56} />
                <Tooltip labelFormatter={periodLabel} formatter={(v, name) => [v == null ? '—' : `${mu(v)} MU`, name]} />
                <Legend verticalAlign="top" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                {MIX.map((m) => (
                  <Line key={m.key} dataKey={m.key} name={m.label} stroke={m.colour} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="report-count">Only the months whose report has been loaded; a month CERC did not publish is not drawn.</p>
          <SourceNote source="CERC Market Monitoring Report" />
        </Card>
      )}
    </div>
  );
}
