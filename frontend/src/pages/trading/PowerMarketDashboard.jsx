import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../../api/client.js';
import { PageHeader, Card } from '../../components/ui.jsx';
import SourceNote from '../../components/SourceNote.jsx';
import IntradayMarketTab from './IntradayMarketTab.jsx';
import { useCercMonth, PeriodSelect, periodLabel, mu } from './cercMonth.jsx';
import { ParticipantsCard } from './cercParticipants.jsx';

// The Power Market Dashboard (CP-86 §3). Every chart on it was a hardcoded array
// — "Data Mocks based on the screenshot analysis", with the last 34 intraday
// blocks topped up by Math.random, and date boxes that filtered nothing. It reads
// the observed prices (CERC report, exchange price files, IEX API) and the CERC
// monthly report now, and names the figures it has no source for.

const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function DailyMarket() {
  const [sel, setSel] = useState({ exchange: 'IEX', product: 'DAM' });
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    api.marketAnalytics.getRates(sel)
      .then((r) => { if (live) setRows([...r].reverse()); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [sel.exchange, sel.product]);

  const withEnergy = (rows || []).filter((r) => r.energy_mwh != null);

  return (
    <Card title="Day-wise clearing price and cleared energy">
      <div className="report-criteria" style={{ marginBottom: 12 }}>
        <label className="report-search">
          Exchange
          <select className="input" value={sel.exchange} onChange={(e) => setSel({ ...sel, exchange: e.target.value })}>
            {['IEX', 'PXIL', 'HPX'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label className="report-search">
          Product
          <select className="input" value={sel.product} onChange={(e) => setSel({ ...sel, product: e.target.value })}>
            {['DAM', 'GDAM', 'RTM'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
      </div>
      {!rows ? <div className="audit-placeholder">Loading…</div> : rows.length === 0 ? (
        <div className="audit-placeholder">The platform holds no {sel.exchange} {sel.product} prices.</div>
      ) : (
        <>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="rate_date" tickFormatter={shortDate} minTickGap={24} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={48} tickFormatter={(v) => `₹${v}`} />
                <Tooltip labelFormatter={shortDate} formatter={(v) => [`₹${Number(v).toFixed(2)}/kWh`, 'Day price']} />
                <Line dataKey="mcp_rate" name="Day price" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {withEnergy.length > 0 ? (
            <div style={{ width: '100%', height: 200, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={withEnergy} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="rate_date" tickFormatter={shortDate} minTickGap={24} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={64} />
                  <Tooltip labelFormatter={shortDate} formatter={(v) => [`${Number(v).toLocaleString('en-IN')} MWh`, 'Cleared']} />
                  <Bar dataKey="energy_mwh" name="Cleared MWh" fill="var(--green)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : null}
          <p className="report-count">
            {rows.length} day(s) held, {rows[0].rate_date} to {rows[rows.length - 1].rate_date}.
            {withEnergy.length ? ` Cleared energy on the ${withEnergy.length} day(s) loaded block by block.` : ' No day in this window was loaded block by block, so there is no cleared energy to show.'}
            {' '}Purchase and sell bid volumes are not in the files the platform loads.
          </p>
        </>
      )}
    </Card>
  );
}

function MonthlyMarket() {
  const { data, error, setPeriod } = useCercMonth();
  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!data?.period) return null;
  return (
    <>
    <Card title={`Exchanges and RECs — ${periodLabel(data.period)}`} actions={<PeriodSelect data={data} onChange={setPeriod} />}>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th scope="col">Exchange</th>
              <th scope="col" className="num">DAM MU</th>
              <th scope="col" className="num">GDAM MU</th>
              <th scope="col" className="num">HP-DAM MU</th>
              <th scope="col" className="num">RTM MU</th>
              <th scope="col" className="num">RECs traded (MWh)</th>
              <th scope="col" className="num">REC price ₹/MWh</th>
            </tr>
          </thead>
          <tbody>
            {data.exchanges.map((e) => {
              const v = (p) => e.volumes.find((x) => x.product === p)?.volume_mu;
              const rec = data.rec.find((r) => r.exchange === e.exchange);
              return (
                <tr key={e.exchange}>
                  <td>{e.exchange}</td>
                  <td className="num">{mu(v('DAM'))}</td>
                  <td className="num">{mu(v('GDAM'))}</td>
                  <td className="num">{mu(v('HP-DAM'))}</td>
                  <td className="num">{mu(v('RTM'))}</td>
                  <td className="num">{mu(rec?.volume_mwh)}</td>
                  <td className="num">{rec?.price_rs_mwh == null ? '—' : Number(rec.price_rs_mwh).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SourceNote source="CERC Market Monitoring Report" period={periodLabel(data.period)} />
    </Card>
    <ParticipantsCard period={data.period} segment="TRADING_LICENSEE" side="ALL" title="Share of electricity transacted by the top 10 trading licensees" />
    </>
  );
}

export default function PowerMarketDashboard() {
  return (
    <div className="page">
      <PageHeader title="Power Market Dashboard" subtitle="Exchange clearing prices and volumes, as observed and as reported to CERC" />
      <DailyMarket />
      <MonthlyMarket />
      <h3 style={{ margin: '24px 0 12px', fontSize: 16 }}>Time-block prices</h3>
      <IntradayMarketTab />
    </div>
  );
}
