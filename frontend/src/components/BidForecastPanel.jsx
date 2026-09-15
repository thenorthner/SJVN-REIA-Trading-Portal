import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { fmtDate } from '../datetime.js';

// The price forecast beside the bid being priced: what the model expects the
// delivery date to clear at, how wide that expectation is, and what each block
// on the bid is expected to clear at. It states figures and where they came
// from; it does not tell the trader what to bid.

const FORECAST_EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const FORECAST_PRODUCTS = ['DAM', 'GDAM', 'RTM'];

const rs = (v) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });

/**
 * The 15-minute blocks (1–96) a bid's time block covers. Bids here carry
 * "18:00-18:15", "00:00-24:00" for a whole-day block, or "Block-12".
 */
export function blocksCovered(label) {
  const s = String(label || '').trim();
  const mins = (h, m) => Number(h) * 60 + Number(m);
  let m = /^block[-\s]?(\d{1,2})$/i.exec(s) || /^(\d{1,2})$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 96 ? [n] : [];
  }
  m = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const a = mins(m[1], m[2]);
    let b = mins(m[3], m[4]);
    if (b <= a) b = 1440;
    if (a % 15 || b % 15 || b > 1440) return [];
    const out = [];
    for (let t = a; t < b; t += 15) out.push(t / 15 + 1);
    return out;
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const a = mins(m[1], m[2]);
    return a % 15 || a >= 1440 ? [] : [a / 15 + 1];
  }
  return [];
}

export default function BidForecastPanel({ exchange, product, deliveryDate, blocks = [] }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const applicable = FORECAST_EXCHANGES.includes(exchange) && FORECAST_PRODUCTS.includes(product)
    && /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate || '');

  useEffect(() => {
    setData(null);
    setError('');
    if (!applicable) return undefined;
    let live = true;
    api.marketForecast.forDate({ exchange, product, date: deliveryDate })
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(err?.response?.data?.error || 'The price forecast could not be loaded.'); });
    return () => { live = false; };
  }, [exchange, product, deliveryDate, applicable]);

  if (!applicable) return null;

  const box = {
    border: '1px solid var(--border)', borderLeft: '3px solid var(--amber)', borderRadius: 'var(--radius-sm)',
    background: 'var(--surface)', padding: '10px 14px', marginBottom: 20, fontSize: 13,
  };

  if (error) return <div style={box} role="status" className="audit-muted">{error}</div>;
  if (!data) return <div style={box} role="status" className="audit-muted">Loading the price forecast…</div>;

  const ceiling = <span className="audit-muted">Exchange ceiling {rs(data.price_cap)}/kWh</span>;

  if (!data.forecast) {
    return (
      <div style={box} role="status">
        <div>
          No price forecast covers {exchange} {product} for {weekday(deliveryDate)} {fmtDate(deliveryDate)}
          {data.latest_forecast_date ? ` — the newest reaches ${fmtDate(data.latest_forecast_date)}` : ''}.
          {' '}<Link to="/trading/market-forecasting">Market Price Forecasting</Link>
        </div>
        <div style={{ marginTop: 4 }}>{ceiling}</div>
      </div>
    );
  }

  const { forecast, run } = data;
  const byBlock = new Map((data.blocks || []).map((b) => [b.block, b.forecast]));
  const blockHints = blocks
    .map((b, i) => {
      const covered = blocksCovered(b.time_block);
      if (!covered.length) return null;
      // A whole day is the day's forecast; a part of one is the mean of its blocks.
      let expected = null;
      if (covered.length === 96) expected = forecast.forecast;
      else if (covered.every((n) => byBlock.has(n))) expected = covered.reduce((a, n) => a + byBlock.get(n), 0) / covered.length;
      if (expected == null) return null;
      const price = Number(b.price_per_unit);
      const gap = Number.isFinite(price) && price > 0 && expected > 0 ? ((price - expected) / expected) * 100 : null;
      return { key: `${i}-${b.time_block}`, label: b.time_block, expected, price: Number.isFinite(price) && price > 0 ? price : null, gap };
    })
    .filter(Boolean);

  return (
    <div style={box} role="status" aria-label="Price forecast">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', alignItems: 'baseline' }}>
        <strong>Forecast {weekday(deliveryDate)} {fmtDate(deliveryDate)}: {rs(forecast.forecast)}/kWh</strong>
        {forecast.lower != null && <span>80% range {rs(forecast.lower)} – {rs(forecast.upper)}</span>}
        {ceiling}
      </div>
      <div className="audit-muted" style={{ marginTop: 4 }}>
        {run.model_label}, from {exchange} {product} prices up to {fmtDate(run.cutoff_date)}
        {' '}({forecast.horizon} day{forecast.horizon === 1 ? '' : 's'} ahead)
        {run.backtest_mape != null ? ` · backtest error ${Number(run.backtest_mape).toFixed(1)}%` : ''}
        {' · '}<Link to="/trading/market-forecasting">details</Link>
      </div>
      {run.data_age_days > 3 && (
        <div style={{ marginTop: 4, color: 'var(--amber-strong)' }}>
          Made from prices {run.data_age_days} days older than the run itself — treat it as a rough guide.
        </div>
      )}
      {blockHints.length > 0 && (
        <table className="report-table" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th scope="col">Block</th>
              <th scope="col" className="num">Forecast</th>
              <th scope="col" className="num">Bid price</th>
              <th scope="col" className="num">Against forecast</th>
            </tr>
          </thead>
          <tbody>
            {blockHints.map((h) => (
              <tr key={h.key}>
                <td>{h.label}</td>
                <td className="num">{rs(h.expected)}</td>
                <td className="num">{h.price != null ? rs(h.price) : '—'}</td>
                <td className="num">{h.gap == null ? '—' : `${h.gap > 0 ? '+' : h.gap < 0 ? '−' : ''}${Math.abs(h.gap).toFixed(0)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {blocks.length > 0 && !blockHints.length && !(data.blocks || []).length && (
        <div className="audit-muted" style={{ marginTop: 4 }}>
          No block-wise forecast for this day — block prices need the exchange's block-wise price files loaded before the forecast.
        </div>
      )}
    </div>
  );
}
