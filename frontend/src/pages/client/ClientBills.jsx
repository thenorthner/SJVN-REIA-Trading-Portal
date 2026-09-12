import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';

// What SJVN has billed this client, and the running account behind it. The
// client's menu used to open the desk's Billing & Settlement console — which
// can raise invoices — so this is the read-only half of it, scoped by the API
// to the client the caller belongs to.
export default function ClientBills() {
  const [summary, setSummary] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The summary names the client, which is also what the ledger is keyed by.
        const s = await api.tradingClient.summary();
        if (cancelled) return;
        setSummary(s);
        const [inv, led] = await Promise.all([
          api.billingSettlement.listInvoices().catch(() => []),
          api.billingSettlement.getLedger(s.client.id).catch(() => []),
        ]);
        if (cancelled) return;
        setInvoices(inv || []);
        setLedger(led || []);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.error || 'Could not load your bills.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const invoiceColumns = [
    { key: 'invoice_no', header: 'Invoice' },
    { key: 'invoice_kind', header: 'Type', render: (r) => r.invoice_kind || '—' },
    { key: 'billing_period', header: 'Period' },
    { key: 'quantum_mwh', header: 'Quantum (MWh)', render: (r) => fmtNumber(r.quantum_mwh) },
    { key: 'total_amount', header: 'Amount', render: (r) => fmtCurrency(r.total_amount) },
    { key: 'net_payable', header: 'Net payable', render: (r) => fmtCurrency(r.net_payable ?? r.total_amount) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'created_at', header: 'Raised', render: (r) => fmtDate(r.created_at) },
  ];

  const ledgerColumns = [
    { key: 'timestamp', header: 'When', render: (r) => fmtDateTime(r.timestamp) },
    { key: 'transaction_type', header: 'Entry', render: (r) => <Badge status={r.transaction_type} /> },
    { key: 'description', header: 'Description', render: (r) => r.description || '—' },
    { key: 'debit', header: 'Debit', render: (r) => (r.debit ? fmtCurrency(r.debit) : '—') },
    { key: 'credit', header: 'Credit', render: (r) => (r.credit ? fmtCurrency(r.credit) : '—') },
    { key: 'running_balance', header: 'Balance', render: (r) => <strong>{fmtCurrency(r.running_balance)}</strong> },
  ];

  return (
    <div>
      <PageHeader
        title="My Bills & Ledger"
        subtitle="Invoices SJVN has raised on your account, and the running balance behind them"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {summary && (
        <div className="kpi-grid">
          <StatCard label="Invoices" value={fmtNumber(summary.invoices.total)} tone="blue" />
          <StatCard label="Billed" value={fmtCurrency(summary.invoices.billed)} />
          <StatCard
            label="Outstanding"
            value={fmtCurrency(summary.invoices.outstanding)}
            tone={summary.invoices.outstanding > 0 ? 'amber' : 'green'}
            hint={`${fmtNumber(summary.invoices.paid_count)} settled`}
          />
          <StatCard
            label="Ledger balance"
            value={fmtCurrency(summary.ledger_balance)}
            tone={summary.ledger_balance < 0 ? 'red' : 'default'}
            hint={summary.ledger_as_of ? `as at ${fmtDate(summary.ledger_as_of)}` : 'no entries yet'}
          />
        </div>
      )}

      <Card title={`Invoices (${invoices.length})`}>
        <Table
          columns={invoiceColumns}
          rows={loading ? [] : invoices}
          emptyMessage={loading ? 'Loading…' : 'No invoices have been raised on your account yet.'}
        />
      </Card>

      <Card title={`Account ledger (${ledger.length})`}>
        <Table
          columns={ledgerColumns}
          rows={loading ? [] : ledger}
          emptyMessage={loading ? 'Loading…' : 'No ledger entries yet.'}
        />
      </Card>
    </div>
  );
}
