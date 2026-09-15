import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import api from '../../api/client.js';
import { Card, StatCard } from '../ui.jsx';
import { fmtDate } from '../../datetime.js';

// What SJVN bid, block by block, against what cleared and what the market
// cleared at. This used to be Math.random for every date except 9 July 2026,
// which drew a flat zero line to match a screenshot, with an export menu of five
// alerts. It reads the bid book and the observed block prices now.
//
// Quantity and price are separate charts: one chart with a MW axis on one side
// and a Rs/MWh axis on the other made every crossing of the lines meaningless.

const BID = 'var(--amber)';
const CLEARED = 'var(--primary)';
const MARKET = 'var(--text-muted)';
const rs = (v) => (v == null ? '—' : `₹${Number(v).toFixed(2)}`);

export default function BidVsClearedAnalytics({ product = 'DAM' }) {
  const [date, setDate] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setError('');
    api.marketAnalytics.bidVsCleared({ product, ...(date ? { date } : {}) })
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(err?.response?.data?.error || 'Could not load the bid book.'); });
    return () => { live = false; };
  }, [product, date]);

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!data) return <Card><div className="audit-placeholder">Loading…</div></Card>;
  if (!data.date) {
    return (
      <Card title={`${product} — bid against cleared`}>
        <div className="audit-placeholder">No {product} bid has been submitted or cleared yet, so there is nothing to compare.</div>
      </Card>
    );
  }

  const blocks = data.blocks.filter((b) => b.bid_mw > 0 || b.cleared_mw > 0 || b.market_mcp != null);
  const { totals } = data;

  return (
    <>
      <Card>
        <div className="report-criteria">
          <label className="report-search">
            Delivery date
            <select className="input" value={data.date} onChange={(e) => setDate(e.target.value)}>
              {data.available_dates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
            </select>
          </label>
        </div>
      </Card>

      {totals.stub_bids > 0 && (
        <div className="alert alert-warning" role="status">
          {totals.stub_bids} of {totals.bids} bid(s) for this day were recorded in stub mode — not sent to the exchange — so what "cleared" on them was entered, not received.
        </div>
      )}

      <div className="kpi-grid">
        <StatCard label="Bid" value={`${totals.bid_mwh.toLocaleString('en-IN')} MWh`} hint={`${totals.bids} bid(s)`} />
        <StatCard label="Cleared" value={`${totals.cleared_mwh.toLocaleString('en-IN')} MWh`} tone="blue" />
        <StatCard label="Cleared of bid" value={totals.cleared_pct == null ? '—' : `${totals.cleared_pct}%`} />
        <StatCard
          label="Market price"
          value={data.market_loaded ? `${data.market_exchange} loaded` : 'Not loaded'}
          hint={data.market_loaded ? 'Block prices from the exchange price file or IEX API' : `No block-wise ${data.market_exchange || ''} ${product} prices for this day`}
        />
      </div>

      <Card title={`${product} quantity by block — ${fmtDate(data.date)} (MW)`}>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={blocks} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="time_block" minTickGap={24} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={48} />
              <Tooltip formatter={(v, name) => [`${v} MW`, name]} />
              <Legend verticalAlign="top" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Line type="stepAfter" dataKey="bid_mw" name="Bid" stroke={BID} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="cleared_mw" name="Cleared" stroke={CLEARED} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title={`${product} price by block — ${fmtDate(data.date)} (₹/kWh)`}>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={blocks} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="time_block" minTickGap={24} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={48} tickFormatter={(v) => `₹${v}`} />
              <Tooltip formatter={(v, name) => [`${rs(v)}/kWh`, name]} />
              <Legend verticalAlign="top" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Line type="stepAfter" dataKey="bid_price" name="Bid price" stroke={BID} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="cleared_price" name="Cleared price" stroke={CLEARED} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
              {data.market_loaded && (
                <Line type="stepAfter" dataKey="market_mcp" name="Market MCP" stroke={MARKET} strokeWidth={1} dot={false} isAnimationActive={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {data.unreadable_time_blocks?.length > 0 && (
        <p className="report-count">Not charted — time blocks that could not be read as quarter-hours: {data.unreadable_time_blocks.join(', ')}.</p>
      )}
    </>
  );
}
