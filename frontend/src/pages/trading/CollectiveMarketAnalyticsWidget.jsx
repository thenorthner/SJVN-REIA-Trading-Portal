import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card } from '../../components/ui.jsx';
import SourceNote from '../../components/SourceNote.jsx';
import { useCercMonth, PeriodSelect, NoReport, periodLabel, mu } from './cercMonth.jsx';

// Prices and volumes across the collective market, by exchange and product, for
// a month of the CERC report. This used to be a hardcoded table that contradicted
// itself — an IEX RTM minimum of ₹10.00 above a maximum of ₹5.92, a weighted
// average of ₹11.00 over a ₹10 ceiling — and a REC chart of "Volume Type 1/2/3".

const rs = (v) => (v == null ? '—' : Number(v).toFixed(2));

export default function CollectiveMarketAnalyticsWidget() {
  const { data, error, setPeriod } = useCercMonth();
  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!data) return <Card><div className="audit-placeholder">Loading…</div></Card>;
  if (!data.period) return <NoReport />;

  const traded = data.segments.filter((s) => s.weighted_avg != null || (s.volume_mu || 0) > 0);
  const chart = traded.filter((s) => s.weighted_avg != null).map((s) => ({ segment: `${s.exchange} ${s.product}`, weighted_avg: s.weighted_avg }));
  const rec = data.rec.filter((r) => r.volume_mwh != null || r.price_rs_mwh != null);

  return (
    <>
      <Card>
        <div className="report-criteria"><PeriodSelect data={data} onChange={setPeriod} /></div>
      </Card>

      <Card title={`Collective market prices — ${periodLabel(data.period)}`}>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">Exchange</th>
                <th scope="col">Product</th>
                <th scope="col" className="num">Minimum ₹/kWh</th>
                <th scope="col" className="num">Maximum ₹/kWh</th>
                <th scope="col" className="num">Weighted average ₹/kWh</th>
                <th scope="col" className="num">Volume MU</th>
              </tr>
            </thead>
            <tbody>
              {traded.length === 0 ? (
                <tr><td className="empty-cell" colSpan={6}>The report for this month carries no exchange prices.</td></tr>
              ) : traded.map((s) => (
                <tr key={`${s.exchange}-${s.product}`}>
                  <td>{s.exchange}</td>
                  <td>{s.product}</td>
                  <td className="num">{rs(s.min)}</td>
                  <td className="num">{rs(s.max)}</td>
                  <td className="num">{rs(s.weighted_avg)}</td>
                  <td className="num">{mu(s.volume_mu)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {chart.length > 0 && (
          <div style={{ width: '100%', height: 260, marginTop: 16 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="segment" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} interval={0} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={40} tickFormatter={(v) => `₹${v}`} />
                <Tooltip formatter={(v) => [`₹${Number(v).toFixed(2)}/kWh`, 'Weighted average']} />
                <Bar dataKey="weighted_avg" name="Weighted average" fill="var(--primary)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="report-count">Segments with no trade in the month are left out. Exchanges with no weighted average reported no clearing that month.</p>
        <SourceNote source="CERC Market Monitoring Report" period={periodLabel(data.period)} />
      </Card>

      <Card title={`RECs traded on the exchanges — ${periodLabel(data.period)}`}>
        {rec.length === 0 ? (
          <div className="audit-placeholder">The report for this month carries no REC trades.</div>
        ) : (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr><th scope="col">Exchange</th><th scope="col" className="num">Traded (MWh)</th><th scope="col" className="num">Weighted price ₹/MWh</th></tr>
              </thead>
              <tbody>
                {rec.map((r) => (
                  <tr key={r.exchange}>
                    <td>{r.exchange}</td>
                    <td className="num">{mu(r.volume_mwh)}</td>
                    <td className="num">{r.price_rs_mwh == null ? '—' : Number(r.price_rs_mwh).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="report-count">Bilateral REC trades through traders, and bid depth, are not in the parsed report.</p>
        <SourceNote source="CERC Market Monitoring Report" period={periodLabel(data.period)} />
      </Card>
    </>
  );
}
