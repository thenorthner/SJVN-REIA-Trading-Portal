import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../../api/client.js';
import { PageHeader, Card } from '../../components/ui.jsx';
import SourceNote from '../../components/SourceNote.jsx';
import IntradayMarketTab from './IntradayMarketTab.jsx';
import { NotHeld, periodLabel, mu } from './cercMonth.jsx';

const inLakhCrore = (n) => Number(n).toLocaleString('en-IN');

// These four cards were typed in. The REC pair in particular claimed 66,167
// certificates sold for Rs 7.5 crore while the ledger this platform maintains
// held 32,500 for Rs 1.27 crore — a dashboard reporting a book that was not its
// own. They now come from /dashboard/trading/analytics, which reads the REC
// ledger and the locked energy periods directly.
export const DashboardKPIs = () => {
  const [figures, setFigures] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.dashboard.trading.analytics()
      .then((d) => { if (alive) setFigures(d); })
      .catch((err) => {
        console.error('[MainDashboard] Could not load trading analytics:', err);
        if (alive) setFailed(true);
      });
    return () => { alive = false; };
  }, []);

  // Dashes rather than zeros while loading or after a failure. A KPI card
  // showing 0 is a claim about the business; showing nothing is a claim about
  // the fetch, and only one of those is true here.
  const pending = !figures;
  const show = (v, fmt = (x) => x) => (pending ? (failed ? '—' : '…') : fmt(v));

  const kpiData = [
    {
      title: "Total Energy Traded",
      value: show(figures?.energy?.delivered_mu, (v) => inLakhCrore(v)),
      unit: "MU", tone: "tone-green",
      exact: figures ? `${inLakhCrore(figures.energy.delivered_mwh)} MWh locked` : undefined,
    },
    {
      // An Indian financial year spans two calendar years, so name both.
      title: figures
        ? `Energy Traded in FY ${figures.financial_year_from.slice(0, 4)}-${String(Number(figures.financial_year_from.slice(0, 4)) + 1).slice(2)}`
        : 'Energy Traded this FY',
      value: show(figures?.energy?.fy_delivered_mu, (v) => inLakhCrore(v)),
      unit: "MU", tone: "tone-red",
    },
    {
      title: "No of REC Sold (#till date)",
      value: show(figures?.rec?.sold, (v) => inLakhCrore(v)),
      unit: "Nos.", tone: "tone-blue",
    },
    {
      title: "Total Earnings from REC",
      value: show(figures?.rec?.revenue_crore, (v) => v.toFixed(2)),
      unit: "₹ Cr.", tone: "tone-amber",
      exact: figures ? `₹${inLakhCrore(figures.rec.revenue_rupees)}` : undefined,
    },
  ];

  return (
    <div>
      {failed && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                      borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
          Could not load live figures — the cards below are showing no value rather than a stale one.
        </div>
      )}
      <div className="kpi-grid">
        {kpiData.map((kpi, index) => (
          <div key={index} className={`stat-card ${kpi.tone}`} title={kpi.exact || undefined}>
            <div className="stat-label">{kpi.title}</div>
            <div className="stat-value">{kpi.value}</div>
            <div className="stat-hint">{kpi.unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// The rest of this screen was an all-India generation mix typed in as four
// percentages, two years of "short-term vs DSM" volume typed in as two bars, and
// a 96-block MCP/MCV chart generated from a seeded random sequence with four
// blocks pinned to values read off a screenshot. The generation mix has no
// source on this platform and says so; the other two read the CERC report and
// the observed block prices.

const MIX = [
  { key: 'bilateral_mu', label: 'Bilateral', colour: 'var(--primary)' },
  { key: 'exchanges_mu', label: 'Power exchanges', colour: 'var(--green)' },
  { key: 'dsm_mu', label: 'Through DSM', colour: '#c2410c' },
];

export default function MainDashboard() {
  const [history, setHistory] = useState(null);

  useEffect(() => {
    api.cercMarket.volumeHistory().then((h) => setHistory(h.slice(-6))).catch(() => setHistory([]));
  }, []);

  return (
    <div className="page">
      <PageHeader title="Main Dashboard" subtitle="Platform-level trading and revenue analytics" />

      <DashboardKPIs />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginTop: 20 }}>
        <NotHeld title="All-India generation mix">
          The platform does not hold CEA generation data — no feed or upload brings it in — so there is no mix to draw.
          The thermal, hydro, RE and nuclear shares that used to be here were typed in.
        </NotHeld>

        <Card title="Short-term transactions and DSM — last six report months (MU)">
          {!history ? <div className="audit-placeholder">Loading…</div> : history.length === 0 ? (
            <div className="audit-placeholder">No CERC monthly market report has been loaded yet.</div>
          ) : (
            <>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={history} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={periodLabel} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={56} />
                    <Tooltip labelFormatter={periodLabel} formatter={(v, name) => [v == null ? '—' : `${mu(v)} MU`, name]} />
                    <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
                    {MIX.map((m) => (
                      <Bar key={m.key} dataKey={m.key} name={m.label} stackId="mu" fill={m.colour} maxBarSize={32} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <SourceNote source="CERC Market Monitoring Report" />
            </>
          )}
        </Card>
      </div>

      <h3 style={{ margin: '24px 0 12px', fontSize: 16 }}>Time-block prices</h3>
      <IntradayMarketTab />
    </div>
  );
}
