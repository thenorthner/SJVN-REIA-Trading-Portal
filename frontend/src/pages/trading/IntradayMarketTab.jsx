import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import api from '../../api/client.js';
import { Card, StatCard } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';
import ACPTrendWidget from '../../components/analytics/ACPTrendWidget.jsx';

// A delivery day's 96-block clearing prices and volumes, as the exchange cleared
// them. This tab used to draw a new random day on every render — prices, volumes
// and a "green premium" — beside an "Auto-Route to GDAM" button that did nothing
// and Export buttons that did nothing either. It shows the block-wise days the
// platform holds (exchange price files, the IEX API) and says so when it holds
// none.

// Validated trio (dataviz validator, all pairs): DAM blue, GDAM green, RTM
// orange; RTM is also dashed.
export const PRODUCT_COLOURS = { DAM: 'var(--primary)', GDAM: 'var(--green)', RTM: '#c2410c' };
const PRODUCTS = ['DAM', 'GDAM', 'RTM'];
const SOURCE_LABELS = { EXCHANGE_FILE: 'exchange price file', IEX_API: 'IEX API' };

const rs = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export default function IntradayMarketTab() {
  const [exchange, setExchange] = useState('IEX');
  const [date, setDate] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setError('');
    api.marketAnalytics.getBlocks({ exchange, ...(date ? { date } : {}) })
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(err?.response?.data?.error || 'Could not load the block prices.'); });
    return () => { live = false; };
  }, [exchange, date]);

  const present = data ? PRODUCTS.filter((p) => data.products[p]?.blocks.length) : [];
  const rows = Array.from({ length: 96 }, (_, i) => {
    const row = { block: i + 1 };
    for (const p of present) {
      const b = data.products[p].blocks.find((x) => x.block === i + 1);
      if (b) {
        row.time_block = b.time_block;
        row[`${p}_mcp`] = b.mcp;
        row[`${p}_mcv`] = b.mcv;
      }
    }
    return row;
  }).filter((r) => r.time_block);

  const dam = data?.products.DAM;
  const gdam = data?.products.GDAM;
  const bothGreen = dam?.blocks.length && gdam?.blocks.length;
  const greenAbove = bothGreen ? rows.filter((r) => r.GDAM_mcp != null && r.DAM_mcp != null && r.GDAM_mcp > r.DAM_mcp).length : 0;

  return (
    <>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <Card>
        <div className="report-criteria">
          <label className="report-search">
            Exchange
            <select className="input" value={exchange} onChange={(e) => { setExchange(e.target.value); setDate(''); }}>
              {['IEX', 'PXIL', 'HPX'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label className="report-search">
            Delivery date
            <select className="input" value={data?.date || ''} onChange={(e) => setDate(e.target.value)} disabled={!data?.available_dates.length}>
              {!data?.available_dates.length && <option value="">No block-wise days</option>}
              {data?.available_dates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
            </select>
          </label>
        </div>
      </Card>

      {data && !present.length ? (
        <Card>
          <div className="audit-placeholder">
            The platform holds no block-wise {exchange} prices{data.date ? ` for ${fmtDate(data.date)}` : ''}. They come from the
            exchange's time-block price file (Market Price Forecasting → Load price file) or from the IEX API once it is enabled.
          </div>
        </Card>
      ) : data && (
        <>
          <div className="kpi-grid">
            {PRODUCTS.map((p) => (
              <StatCard
                key={p}
                label={`${p} day price`}
                value={data.products[p].blocks.length ? `${rs(data.products[p].day_price)}/kWh` : 'Not loaded'}
                hint={data.products[p].blocks.length
                  ? `Weighted by cleared volume · from ${SOURCE_LABELS[data.products[p].source] || data.products[p].source}`
                  : `No ${p} blocks for this day`}
              />
            ))}
            {bothGreen ? (
              <StatCard
                label="GDAM against DAM"
                value={`${gdam.day_price - dam.day_price >= 0 ? '+' : '−'}${rs(Math.abs(gdam.day_price - dam.day_price))}/kWh`}
                hint={`GDAM cleared above DAM in ${greenAbove} of ${rows.length} blocks`}
              />
            ) : null}
          </div>

          <Card title={`${exchange} clearing price by block — ${fmtDate(data.date)} (₹/kWh)`}>
            <div style={{ width: '100%', height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="time_block" interval={11} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={48} tickFormatter={(v) => `₹${v}`} />
                  <Tooltip formatter={(v, name) => [`${rs(v)}/kWh`, name]} />
                  <Legend verticalAlign="top" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                  {present.map((p) => (
                    <Line key={p} dataKey={`${p}_mcp`} name={p} stroke={PRODUCT_COLOURS[p]} strokeWidth={2}
                      strokeDasharray={p === 'RTM' ? '6 4' : undefined} dot={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {present.some((p) => data.products[p].blocks.some((b) => b.mcv != null)) && (
            <Card title="Cleared volume by block (MW)">
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="time_block" interval={11} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={56} />
                    <Tooltip formatter={(v, name) => [`${Number(v).toLocaleString('en-IN')} MW`, name]} />
                    <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
                    {present.map((p) => (
                      <Bar key={p} dataKey={`${p}_mcv`} name={p} stackId="mcv" fill={PRODUCT_COLOURS[p]} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}

      <ACPTrendWidget exchange={exchange} />
    </>
  );
}
