import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// The trading client's landing screen. It used to show a fixed table of another
// company's trades — the desk's sample rows — so nothing on it belonged to the
// client looking at it. These figures come from the client's own bids,
// contracts, bills and ledger, through /api/trading-client/summary.
export default function HomeDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.tradingClient.summary()
      .then(setData)
      .catch((err) => setError(err?.response?.data?.error || 'Could not load your account summary.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading">Loading your account…</div>;

  if (error) {
    return (
      <div>
        <PageHeader title="Home" subtitle="Your trading account with SJVN" />
        <div className="alert alert-error" role="alert">{error}</div>
      </div>
    );
  }

  const { client, bids, contracts, invoices, ledger_balance: balance, ledger_as_of: asOf, recent_invoices: recent } = data;

  const columns = [
    { key: 'invoice_no', header: 'Invoice' },
    { key: 'invoice_kind', header: 'Type', render: (r) => r.invoice_kind || '—' },
    { key: 'created_at', header: 'Raised', render: (r) => fmtDate(r.created_at) },
    { key: 'total_amount', header: 'Amount', render: (r) => fmtCurrency(r.total_amount) },
    { key: 'net_payable', header: 'Net payable', render: (r) => fmtCurrency(r.net_payable ?? r.total_amount) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title={client?.name || 'My trading account'}
        subtitle={`${client?.client_type || 'Trading client'} · account ${client?.status || '—'}`}
      />

      <div className="kpi-grid">
        <StatCard label="Bids placed" value={fmtNumber(bids.total)} hint={`${fmtNumber(bids.quantum_mw)} MW offered`} tone="blue" />
        <StatCard label="Cleared" value={`${fmtNumber(bids.cleared_mw)} MW`} hint={`${fmtNumber(bids.cleared)} of ${fmtNumber(bids.total)} bids`} tone="green" />
        <StatCard label="Exchange contracts" value={fmtNumber(contracts.exchange_contracts)} />
        <StatCard label="Bilateral deals" value={fmtNumber(contracts.bilateral_deals)} />
        <StatCard label="Billed to you" value={fmtCurrency(invoices.billed)} hint={`${fmtNumber(invoices.total)} invoice(s)`} />
        <StatCard
          label="Outstanding"
          value={fmtCurrency(invoices.outstanding)}
          tone={invoices.outstanding > 0 ? 'amber' : 'green'}
          hint={`${fmtNumber(invoices.paid_count)} settled`}
          onClick={() => navigate('/trading/billing-settlement')}
        />
        <StatCard
          label="Ledger balance"
          value={fmtCurrency(balance)}
          hint={asOf ? `as at ${fmtDate(asOf)}` : 'no entries yet'}
          tone={balance < 0 ? 'red' : 'default'}
        />
      </div>

      <Card title="Your latest bills">
        <Table
          columns={columns}
          rows={recent || []}
          emptyMessage="No bills have been raised on your account yet."
        />
      </Card>
    </div>
  );
}
