import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, StatCard, fmtNumber } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// The client's agreements with SJVN: its bilateral deals and its exchange
// contracts, both scoped to the client by the API. Read-only — the desk owns
// the paperwork; this screen answers "what do we have on, and where has it
// got to".
export default function ClientDeals() {
  const [bilateral, setBilateral] = useState([]);
  const [exchange, setExchange] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.bilateral.list().catch(() => []),
      api.exchangeContracts.list().catch(() => []),
    ])
      .then(([b, e]) => {
        setBilateral(b || []);
        setExchange(e || []);
      })
      .catch(() => setError('Could not load your deals.'))
      .finally(() => setLoading(false));
  }, []);

  const bilateralColumns = [
    { key: 'id', header: 'Reference' },
    { key: 'counterparty', header: 'Counterparty' },
    { key: 'quantum_mw', header: 'Quantum (MW)', render: (r) => fmtNumber(r.quantum_mw) },
    { key: 'tariff_per_unit', header: 'Tariff (₹/unit)', render: (r) => (r.tariff_per_unit != null ? r.tariff_per_unit : '—') },
    { key: 'period', header: 'Period', render: (r) => `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}` },
    { key: 'oa_type', header: 'Open access', render: (r) => `${r.oa_type || '—'} · ${r.open_access_status || '—'}` },
    { key: 'noar_status', header: 'NOAR', render: (r) => <Badge status={r.noar_status || 'NOT_INITIATED'} /> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  const exchangeColumns = [
    { key: 'loa_no', header: 'LoA', render: (r) => r.loa_no || r.id },
    { key: 'product', header: 'Product', render: (r) => r.product || '—' },
    { key: 'side', header: 'Side', render: (r) => r.side || '—' },
    { key: 'period', header: 'Period', render: (r) => `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}` },
    { key: 'portfolio_id', header: 'Portfolio', render: (r) => r.portfolio_id || '—' },
    { key: 'trading_margin', header: 'Margin (₹/unit)', render: (r) => (r.trading_margin != null ? r.trading_margin : '—') },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  const active = (rows) => rows.filter((r) => r.status === 'ACTIVE').length;

  return (
    <div>
      <PageHeader
        title="My Deals"
        subtitle="Your bilateral transactions and exchange contracts with SJVN"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="kpi-grid">
        <StatCard label="Bilateral deals" value={fmtNumber(bilateral.length)} hint={`${active(bilateral)} active`} tone="blue" />
        <StatCard label="Exchange contracts" value={fmtNumber(exchange.length)} hint={`${active(exchange)} active`} tone="blue" />
        <StatCard
          label="Contracted quantum"
          value={`${fmtNumber(bilateral.reduce((s, r) => s + (r.quantum_mw || 0), 0))} MW`}
          hint="across your bilateral deals"
        />
      </div>

      <Card title={`Bilateral transactions (${bilateral.length})`}>
        <Table
          columns={bilateralColumns}
          rows={loading ? [] : bilateral}
          emptyMessage={loading ? 'Loading…' : 'No bilateral transactions on your account.'}
        />
      </Card>

      <Card title={`Exchange contracts (${exchange.length})`}>
        <Table
          columns={exchangeColumns}
          rows={loading ? [] : exchange}
          emptyMessage={loading ? 'Loading…' : 'No exchange contracts on your account.'}
        />
      </Card>
    </div>
  );
}
