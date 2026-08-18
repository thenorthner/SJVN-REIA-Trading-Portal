import React, { useEffect, useState } from 'react';
import { PortfolioSelect } from '../../context/PortfolioContext.jsx';
import { api } from '../../api/client.js';
import { Card, Table, Badge, fmtNumber } from '../../components/ui.jsx';

function isoDaysAgo(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function downloadCsv(filename, rows) {
  const header = Object.keys(rows[0] || { client: '', delivery_date: '', exchange: '', cleared_mwh: '', value: '' });
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
  if (status === 'MIXED') return <Badge type="neutral">Mixed</Badge>;
  return <Badge type="neutral">{status}</Badge>;
}

export default function GDAMObligationConsole({ product = 'GDAM' }) {
  const [exchange, setExchange] = useState('');
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState(isoDaysAgo(-14));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailBlocks, setDetailBlocks] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  function load() {
    setLoading(true);
    setError('');
    api.tradingOps.obligations({
      product,
      from,
      to,
      exchange: exchange || undefined,
      client_id: clientId || undefined,
    })
      .then((r) => setRows(r.rows || []))
      .catch((err) => {
        setRows([]);
        setError(err.response?.data?.error || 'Could not load obligations');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [product]);

  function openDetail(row) {
    setDetail(row);
    setDetailBlocks(null);
    setDetailLoading(true);
    api.tradingOps.schedules({
      date: row.delivery_date,
      product,
      client_id: row.client_id,
      exchange: row.exchange,
    })
      .then((s) => setDetailBlocks((s.blocks || []).filter((b) => b.bid_mw > 0 || b.cleared_mw > 0)))
      .catch(() => setDetailBlocks([]))
      .finally(() => setDetailLoading(false));
  }

  const columns = [
    { key: 'client_name', label: 'Client' },
    { key: 'delivery_date', label: 'Delivery Date' },
    { key: 'exchange', label: 'Exchange' },
    { key: 'cleared_mwh', label: 'Cleared (MWh)', render: (r) => fmtNumber(r.cleared_mwh, 3) },
    { key: 'avg_price', label: 'Avg MCP (₹/kWh)', render: (r) => (r.avg_price == null ? '—' : fmtNumber(r.avg_price, 2)) },
    { key: 'trade_value', label: 'Value (₹)', render: (r) => fmtNumber(r.trade_value, 2) },
    { key: 'status', label: 'Status', render: (r) => statusBadge(r.status) },
    {
      key: 'view',
      label: 'View',
      render: (r) => (
        <button type="button" className="icon-btn" onClick={() => openDetail(r)} style={{ color: 'var(--sky)', background: 'none', border: 'none', cursor: 'pointer' }}>
          Blocks
        </button>
      ),
    },
  ];

  function exportCsv() {
    downloadCsv(`${product}-obligation-${from}-to-${to}.csv`, rows.map((r) => ({
      client: r.client_name,
      delivery_date: r.delivery_date,
      exchange: r.exchange,
      cleared_mwh: r.cleared_mwh,
      avg_price: r.avg_price ?? '',
      value: r.trade_value,
      status: r.status,
      bid_ids: (r.bid_ids || []).join(' '),
    })));
  }

  return (
    <div style={{ padding: '0 20px 20px', maxWidth: 1600, margin: '0 auto' }}>
      <Card style={{ marginBottom: 20, background: 'var(--slate-50)' }}>
        <div style={{ display: 'flex', gap: 15, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="gdam-ob-exchange">Exchange</label>
            <select id="gdam-ob-exchange" className="input" value={exchange} onChange={(e) => setExchange(e.target.value)}>
              <option value="">All</option>
              <option value="IEX">IEX</option>
              <option value="PXIL">PXIL</option>
              <option value="HPX">HPX</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="gdam-ob-client">Client</label>
            <PortfolioSelect id="gdam-ob-client" includeAll allLabel="All clients" value={clientId} onChange={setClientId} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="gdam-ob-from">From</label>
            <input id="gdam-ob-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="gdam-ob-to">To</label>
            <input id="gdam-ob-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button type="button" className="btn btn-outline" onClick={load}>Search</button>
          <button type="button" className="btn btn-outline" onClick={exportCsv} disabled={!rows.length} style={{ marginLeft: 'auto' }}>
            Export CSV
          </button>
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15, alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{product} Obligation</h3>
          <span style={{ fontSize: 12, color: '#555' }}>Cleared bid blocks — exchange PDFs are not stored</span>
        </div>
        {error && <div style={{ padding: 12, color: '#b91c1c', background: '#fef2f2', borderRadius: 4, marginBottom: 12 }}>{error}</div>}
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666' }}>Loading obligations…</div>
        ) : (
          <Table columns={columns} data={rows} />
        )}
      </Card>

      {detail && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 560, background: '#fff', zIndex: 9999, boxShadow: '-5px 0 25px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: 20, background: '#f8f9fa', borderBottom: '1px solid #dee2e6' }}>
            <div>
              <h3 style={{ margin: 0 }}>{detail.client_name}</h3>
              <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 5 }}>
                {detail.exchange} · {detail.delivery_date} · {fmtNumber(detail.cleared_mwh, 3)} MWh · ₹{fmtNumber(detail.trade_value, 2)}
              </div>
            </div>
            <button type="button" onClick={() => setDetail(null)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>&times;</button>
          </div>
          <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
            {detailLoading ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#666' }}>Loading blocks…</div>
            ) : !detailBlocks?.length ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#666' }}>No blocks on this day.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#343a40', color: '#fff' }}>
                    <th scope="col" style={{ padding: 8, textAlign: 'left' }}>Time</th>
                    <th scope="col" style={{ padding: 8, textAlign: 'right' }}>Bid MW</th>
                    <th scope="col" style={{ padding: 8, textAlign: 'right' }}>Cleared MW</th>
                    <th scope="col" style={{ padding: 8, textAlign: 'right' }}>₹/kWh</th>
                    <th scope="col" style={{ padding: 8, textAlign: 'right' }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {detailBlocks.map((b) => (
                    <tr key={b.block_no} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: 8 }}>{b.time_label}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{fmtNumber(b.bid_mw, 2)}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{fmtNumber(b.cleared_mw, 2)}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{b.cleared_price == null ? '—' : fmtNumber(b.cleared_price, 2)}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{fmtNumber(b.trade_value, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
