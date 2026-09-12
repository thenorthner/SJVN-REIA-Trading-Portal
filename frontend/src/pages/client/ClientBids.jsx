import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, StatCard, fmtNumber, fmtCurrency } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// The client's own bids, and only its own — the API scopes the list to the
// company the caller belongs to. Read-only by design: the desk places and
// submits bids on the exchange; this is where the client sees what happened to
// them. Before this screen the client's menu opened the desk's bidding
// console, which answered 403 to every call it made.
const PRODUCTS = ['DAM', 'GDAM', 'HPDAM', 'RTM', 'TAM', 'GTAM', 'REC', 'ESCERT'];

export default function ClientBids() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ product: '', from: '', to: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.bids.list(params)
      .then((r) => setRows(r || []))
      .catch((err) => {
        setError(err?.response?.data?.error || 'Could not load your bids.');
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [filters.product, filters.from, filters.to]);

  const totals = useMemo(() => rows.reduce((acc, b) => ({
    offered: acc.offered + (b.quantum_mw || 0),
    cleared: acc.cleared + (b.cleared_quantum_mw || 0),
    value: acc.value + (b.cleared_quantum_mw || 0) * (b.cleared_price ?? b.price_per_unit ?? 0),
  }), { offered: 0, cleared: 0, value: 0 }), [rows]);

  const columns = [
    { key: 'delivery_date', header: 'Delivery', render: (r) => fmtDate(r.delivery_date) },
    { key: 'exchange', header: 'Exchange / Product', render: (r) => `${r.exchange} · ${r.product}` },
    { key: 'type', header: 'Side', render: (r) => r.type || '—' },
    { key: 'quantum_mw', header: 'Offered (MW)', render: (r) => fmtNumber(r.quantum_mw) },
    { key: 'price_per_unit', header: 'Price (₹/unit)', render: (r) => (r.price_per_unit != null ? r.price_per_unit : '—') },
    { key: 'cleared_quantum_mw', header: 'Cleared (MW)', render: (r) => fmtNumber(r.cleared_quantum_mw) },
    { key: 'cleared_price', header: 'Cleared price', render: (r) => (r.cleared_price != null ? r.cleared_price : '—') },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (r.status === 'SUBMITTED' && r.submission_mode === 'STUB'
        ? <span style={{ color: '#ca8a04', fontWeight: 600, fontSize: 12 }} title="Recorded by the desk; the exchange API is not live yet.">Not sent — stub</span>
        : <Badge status={r.status} />),
    },
  ];

  return (
    <div>
      <PageHeader
        title="My Bids"
        subtitle="Every bid SJVN has placed on the exchanges for your portfolio, and how much of it cleared"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="kpi-grid">
        <StatCard label="Bids" value={fmtNumber(rows.length)} tone="blue" />
        <StatCard label="Offered" value={`${fmtNumber(totals.offered)} MW`} />
        <StatCard label="Cleared" value={`${fmtNumber(totals.cleared)} MW`} tone="green" />
        <StatCard label="Cleared value" value={fmtCurrency(totals.value)} hint="cleared MW × cleared price" />
      </div>

      <Card>
        <div className="filters-bar">
          <select value={filters.product} onChange={(e) => setFilters({ ...filters, product: e.target.value })}>
            <option value="">All products</option>
            {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input type="date" aria-label="Delivery from" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          <input type="date" aria-label="Delivery to" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters({ product: '', from: '', to: '' })}>Clear</button>
        </div>

        <Table
          columns={columns}
          rows={loading ? [] : rows}
          emptyMessage={loading ? 'Loading your bids…' : 'No bids have been placed for your portfolio yet.'}
        />
      </Card>
    </div>
  );
}
