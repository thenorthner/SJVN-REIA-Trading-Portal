import React, { useEffect, useState } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import api from '../../api/client.js';
import { Card } from '../ui.jsx';

// The day-ahead clearing price, day by day, with the day's lowest and highest
// block where the day was loaded block by block. This used to be ten hardcoded
// days labelled "N1 Region Trend", with an export menu that apologised for itself.
// A CERC day has a price and no range; the chart shows it without inventing one.

const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const rs = (v) => `₹${Number(v).toFixed(2)}`;

export default function ACPTrendWidget({ exchange = 'IEX', product = 'DAM' }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let live = true;
    api.marketAnalytics.getRates({ exchange, product })
      .then((r) => { if (live) setRows([...r].reverse()); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [exchange, product]);

  const hasRange = rows?.some((r) => r.min_rate != null);

  return (
    <Card title={`${exchange} ${product} clearing price — last 30 days held (₹/kWh)`} style={{ marginBottom: 20 }}>
      {!rows ? (
        <div className="audit-placeholder">Loading…</div>
      ) : !rows.length ? (
        <div className="audit-placeholder">The platform holds no {exchange} {product} prices.</div>
      ) : (
        <>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="rate_date" tickFormatter={shortDate} minTickGap={24} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={48} tickFormatter={(v) => `₹${v}`} />
                <Tooltip labelFormatter={shortDate} formatter={(v, name) => [v == null ? '—' : `${rs(v)}/kWh`, name]} />
                <Legend verticalAlign="top" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="mcp_rate" name="Day price" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
                {hasRange && <Line dataKey="max_rate" name="Highest block" stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="4 3" dot={false} connectNulls={false} isAnimationActive={false} />}
                {hasRange && <Line dataKey="min_rate" name="Lowest block" stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="1 3" dot={false} connectNulls={false} isAnimationActive={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="report-count">
            {rows.length} day(s), {rows[0].rate_date} to {rows[rows.length - 1].rate_date}.
            {hasRange ? ' The block range shows only on days loaded block by block.' : ' No day in this window was loaded block by block, so there is no range to show.'}
          </p>
        </>
      )}
    </Card>
  );
}
