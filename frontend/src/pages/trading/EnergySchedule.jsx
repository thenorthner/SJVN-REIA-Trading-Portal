import React, { useState, useEffect, useMemo } from 'react';
import { PortfolioSelect, usePortfolios } from '../../context/PortfolioContext.jsx';
import { api } from '../../api/client.js';
import { PageHeader, Card, Badge, Table, fmtNumber } from '../../components/ui.jsx';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function isoDaysAgo(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function downloadCsv(filename, rows) {
  const header = Object.keys(rows[0] || { block: '', time: '', bid_mw: '', cleared_mw: '', mwh: '', price: '', value: '' });
  const lines = [
    header.join(','),
    ...rows.map((r) => header.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function statusBadge(status) {
  if (status === 'CLEARED') return <Badge type="success">Cleared</Badge>;
  if (status === 'PARTIALLY_CLEARED') return <Badge type="warning">Partial</Badge>;
  if (status === 'SUBMITTED' || status === 'PENDING') return <Badge type="neutral">Filed</Badge>;
  if (status === 'EMPTY') return <Badge type="neutral" style={{ opacity: 0.45 }}>—</Badge>;
  return <Badge type="neutral">{status}</Badge>;
}

export default function EnergySchedule({ product = 'DAM' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState('BLOCK');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [recent, setRecent] = useState([]);
  const { activeId: clientId, active: activeClient } = usePortfolios();

  useEffect(() => {
    api.tradingOps.obligations({
      product,
      from: isoDaysAgo(-21),
      to: isoDaysAgo(1),
      client_id: clientId || undefined,
    }).then((r) => setRecent((r.rows || []).map((row) => row.delivery_date)
      .filter((d, i, a) => a.indexOf(d) === i)))
      .catch(() => setRecent([]));
  }, [product, clientId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.tradingOps.schedules({ date, product, client_id: clientId || undefined })
      .then((row) => { if (!cancelled) setData(row); })
      .catch((err) => {
        if (cancelled) return;
        setData(null);
        setError(err.response?.data?.error || 'Could not load the energy schedule');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date, product, clientId]);

  const blocks = data?.blocks || [];
  const hasVolume = blocks.some((b) => b.bid_mw > 0 || b.cleared_mw > 0);

  const aggregatedData = useMemo(() => {
    if (viewMode === 'BLOCK') return blocks;
    const hourly = [];
    for (let h = 0; h < 24; h++) {
      const chunk = blocks.slice(h * 4, h * 4 + 4);
      if (!chunk.length) continue;
      const bid = chunk.reduce((s, b) => s + b.bid_mw, 0) / chunk.length;
      const cleared = chunk.reduce((s, b) => s + b.cleared_mw, 0) / chunk.length;
      const mwh = chunk.reduce((s, b) => s + b.scheduled_mwh, 0);
      const value = chunk.reduce((s, b) => s + b.trade_value, 0);
      const pxMw = chunk.reduce((s, b) => s + (b.cleared_mw > 0 ? b.cleared_mw : 0), 0);
      const pxVal = chunk.reduce((s, b) => s + (b.cleared_mw > 0 ? b.cleared_mw * (b.cleared_price || 0) : 0), 0);
      hourly.push({
        block_no: `H${h + 1}`,
        time_label: `${String(h).padStart(2, '0')}:00 - ${String(h + 1).padStart(2, '0')}:00`,
        bid_mw: bid,
        cleared_mw: cleared,
        scheduled_mwh: mwh,
        cleared_price: pxMw > 0 ? pxVal / pxMw : null,
        trade_value: value,
        status: chunk.some((b) => b.status === 'CLEARED') ? 'CLEARED' : chunk[0].status,
      });
    }
    return hourly;
  }, [blocks, viewMode]);

  const columns = [
    { key: 'block_no', label: viewMode === 'BLOCK' ? 'Block (1-96)' : 'Hour (1-24)' },
    { key: 'time_label', label: 'Time Window' },
    { key: 'bid_mw', label: 'Bid (MW)', render: (r) => fmtNumber(r.bid_mw, 2) },
    { key: 'cleared_mw', label: 'Cleared (MW)', render: (r) => <strong>{fmtNumber(r.cleared_mw, 2)}</strong> },
    { key: 'scheduled_mwh', label: 'Energy (MWh)', render: (r) => fmtNumber(r.scheduled_mwh, 3) },
    { key: 'cleared_price', label: 'MCP (₹/kWh)', render: (r) => (r.cleared_price == null ? '—' : fmtNumber(r.cleared_price, 2)) },
    { key: 'trade_value', label: 'Value (₹)', render: (r) => (r.trade_value ? fmtNumber(r.trade_value, 2) : '—') },
    { key: 'status', label: 'Block', render: (r) => statusBadge(r.status) },
  ];

  function exportCsv() {
    downloadCsv(`${product}-schedule-${date}.csv`, aggregatedData.map((r) => ({
      block: r.block_no,
      time: r.time_label,
      bid_mw: r.bid_mw,
      cleared_mw: r.cleared_mw,
      mwh: r.scheduled_mwh,
      price: r.cleared_price ?? '',
      value: r.trade_value,
      status: r.status,
    })));
  }

  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>
      <PageHeader
        title={`${product} Energy Schedule`}
        actions={
          <button className="btn btn-outline" onClick={exportCsv} disabled={!hasVolume}>Export CSV</button>
        }
      />

      <Card style={{ marginBottom: 20, background: '#f5f7f9' }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="energyschedule-trading-date">Delivery Date</label>
            <input id="energyschedule-trading-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="energyschedule-portfolio-id">Client</label>
            <PortfolioSelect id="energyschedule-portfolio-id" scope="global" allLabel="All clients" includeAll />
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>Aggregation</span>
            <div role="group" aria-label="Aggregation Level" style={{ display: 'flex', gap: 5 }}>
              <button type="button" className={`btn btn-sm ${viewMode === 'BLOCK' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('BLOCK')}>15-min (96)</button>
              <button type="button" className={`btn btn-sm ${viewMode === 'HOURLY' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('HOURLY')}>Hourly (24)</button>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ marginBottom: 16, padding: 15, background: '#e9ecef', borderRadius: 4, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <strong>Client:</strong> {activeClient?.name || 'All clients'}<br />
            <strong>Delivery:</strong> {date}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div><strong>Cleared:</strong> {fmtNumber(data?.summary?.cleared_mwh || 0, 3)} MWh</div>
            <div><strong>Value:</strong> ₹{fmtNumber(data?.summary?.cleared_value || 0, 2)}</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
              From {data?.summary?.bids || 0} filed bid{(data?.summary?.bids || 0) === 1 ? '' : 's'} — not WBES / JMR
            </div>
          </div>
        </div>

        {error && <div style={{ padding: 12, color: '#b91c1c', background: '#fef2f2', borderRadius: 4, marginBottom: 12 }}>{error}</div>}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading schedule…</div>
        ) : !hasVolume ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
            No {product} bids filed for this delivery date{activeClient ? ` (${activeClient.name})` : ''}.
            {recent.length > 0 && (
              <div style={{ marginTop: 12 }}>
                Cleared days:{' '}
                {recent.slice(0, 8).map((d) => (
                  <button key={d} type="button" className="btn btn-sm btn-outline" style={{ margin: '0 4px' }} onClick={() => setDate(d)}>{d}</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {viewMode === 'BLOCK' && (
              <div style={{ marginBottom: 20, height: 250, width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={blocks} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCleared" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="block_no"
                      tickFormatter={(val) => {
                        if (val === 1) return '00:00';
                        if (val === 48) return '12:00';
                        if (val === 96) return '24:00';
                        return '';
                      }}
                    />
                    <YAxis tickFormatter={(val) => `${val} MW`} />
                    <Tooltip
                      labelFormatter={(label, payload) => {
                        if (payload && payload.length > 0) {
                          return `Block ${label} · ${payload[0].payload.time_label}`;
                        }
                        return `Block ${label}`;
                      }}
                    />
                    <Area type="stepAfter" dataKey="bid_mw" name="Bid (MW)" stroke="#94a3b8" fillOpacity={0} />
                    <Area type="stepAfter" dataKey="cleared_mw" name="Cleared (MW)" stroke="#10b981" fillOpacity={1} fill="url(#colorCleared)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            <Table columns={columns} data={aggregatedData} />
          </>
        )}
      </Card>
    </div>
  );
}
