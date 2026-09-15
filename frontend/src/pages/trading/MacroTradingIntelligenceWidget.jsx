import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card } from '../../components/ui.jsx';
import SourceNote from '../../components/SourceNote.jsx';
import { useCercMonth, PeriodSelect, NoReport, NotHeld, periodLabel, mu } from './cercMonth.jsx';

// The market at large for a month: how volume split across each exchange's
// products, and the RECs that traded. It used to be four hardcoded arrays — a
// "top 7 trading licensees" pie, REC bid depth, and PXIL and HPX product splits
// given as percentages with nothing to say which month they were.

function ExchangeVolumes({ exchange, month }) {
  const ex = month.exchanges.find((e) => e.exchange === exchange);
  const rows = (ex?.volumes || []).filter((v) => v.volume_mu != null);
  return (
    <Card title={`${exchange} volume by product — ${periodLabel(month.period)} (MU)`}>
      {!rows.some((v) => v.volume_mu > 0) ? (
        <div className="audit-placeholder">No {exchange} volume in the report for this month.</div>
      ) : (
        <>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="product" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={56} />
                <Tooltip formatter={(v) => [`${mu(v)} MU`, 'Volume']} />
                <Bar dataKey="volume_mu" name="Volume" fill="var(--primary)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="report-count">{mu(ex.total_mu)} MU across {rows.filter((v) => v.volume_mu > 0).map((v) => v.product).join(', ')}.</p>
        </>
      )}
      <SourceNote source="CERC Market Monitoring Report" period={periodLabel(month.period)} />
    </Card>
  );
}

export default function MacroTradingIntelligenceWidget() {
  const { data, error, setPeriod } = useCercMonth();
  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!data) return <Card><div className="audit-placeholder">Loading…</div></Card>;
  if (!data.period) return <NoReport />;

  const st = data.short_term;

  return (
    <>
      <Card>
        <div className="report-criteria"><PeriodSelect data={data} onChange={setPeriod} /></div>
      </Card>

      <div className="kpi-grid">
        <div className="stat-card"><div className="stat-label">Bilateral</div><div className="stat-value">{mu(st.bilateral_mu)} MU</div></div>
        <div className="stat-card"><div className="stat-label">Power exchanges</div><div className="stat-value">{mu(st.exchanges_mu)} MU</div></div>
        <div className="stat-card"><div className="stat-label">Through DSM</div><div className="stat-value">{mu(st.dsm_mu)} MU</div></div>
        <div className="stat-card"><div className="stat-label">Short-term and DSM</div><div className="stat-value">{mu(st.total_mu)} MU</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        <ExchangeVolumes exchange="IEX" month={data} />
        <ExchangeVolumes exchange="PXIL" month={data} />
        <ExchangeVolumes exchange="HPX" month={data} />
        <NotHeld title="Share of the trading licensees">
          The report's table of electricity traded by each trading licensee is not among the tables the platform reads,
          so there are no licensee shares to show. The figures that used to be here were typed in.
        </NotHeld>
      </div>
    </>
  );
}
