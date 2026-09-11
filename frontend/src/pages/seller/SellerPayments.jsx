import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, fmtCurrency } from '../../components/ui.jsx';

// Bills that count as billed: sent to SJVN and not withdrawn. A draft still with
// the company's checker, or one SJVN rejected, is not yet money owed.
const NOT_BILLED = ['DRAFT', 'PENDING_L2', 'REJECTED', 'CANCELLED'];

export default function SellerPayments() {
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ contract_id: '' });
  const [contracts, setContracts] = useState([]);

  useEffect(() => {
    api.contracts.list().then(setContracts).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = { direction: 'SELLER_TO_SJVN' };
    if (filters.contract_id) params.contract_id = filters.contract_id;
    // Two requests for the whole ledger — the bills, for the totals, and their
    // payments. Fetching each bill for its payments cost a request per bill and
    // recorded every one of them as opened.
    Promise.all([api.invoices.list(params), api.invoices.payments(params)])
      .then(([invs, pays]) => {
        setInvoices(invs || []);
        setPayments(pays || []);
      })
      .catch(() => {
        setInvoices([]);
        setPayments([]);
      })
      .finally(() => setLoading(false));
  }, [filters.contract_id]);

  const totalBilled = invoices
    .filter((inv) => !NOT_BILLED.includes(inv.status))
    .reduce((s, inv) => s + (inv.total_amount || 0), 0);
  const totalReceived = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const pendingAmount = totalBilled - totalReceived;
  const rows = payments.map((p) => ({ ...p, net_received: (p.amount || 0) - (p.deduction || 0) }));
  const lastPayment = rows[0] || null;

  const columns = [
    { key: 'payment_date', header: 'Date' },
    { key: 'invoice_no', header: 'Invoice No.' },
    { key: 'contract_no', header: 'Contract' },
    { key: 'billing_period', header: 'Period' },
    { key: 'amount', header: 'Amount Paid', render: (r) => fmtCurrency(r.amount) },
    { key: 'deduction', header: 'Deductions', render: (r) => r.deduction > 0 ? <span style={{ color: 'var(--danger)' }}>-{fmtCurrency(r.deduction)}</span> : '-' },
    { key: 'net_received', header: 'Net Received', render: (r) => <span style={{ color: 'var(--success)', fontWeight: 600 }}>{fmtCurrency(r.net_received)}</span> },
    { key: 'mode', header: 'Mode', render: (r) => r.mode || '-' },
    { key: 'reference', header: 'UTR / Reference', render: (r) => r.reference || '-' },
  ];

  return (
    <div>
      <PageHeader
        title="Payments & Ledger"
        subtitle="Track all payments received from SJVN against your invoices"
      />

      {/* Summary Cards */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">TOTAL BILLED (LIFETIME)</div>
          <div className="stat-value">{fmtCurrency(totalBilled)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">TOTAL RECEIVED</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{fmtCurrency(totalReceived)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">PENDING AMOUNT</div>
          <div className="stat-value" style={{ color: pendingAmount > 0 ? '#e67e22' : 'var(--success)' }}>{fmtCurrency(pendingAmount)}</div>
        </div>
        {lastPayment && (
          <div className="stat-card">
            <div className="stat-label">LAST PAYMENT</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>{fmtCurrency(lastPayment.amount)}</div>
            <div className="stat-sub">{lastPayment.payment_date} via {lastPayment.mode || 'N/A'}</div>
          </div>
        )}
      </div>

      <div className="filters-bar">
        <select value={filters.contract_id} onChange={(e) => setFilters({ ...filters, contract_id: e.target.value })}>
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No payments recorded yet.'} />
      </Card>
    </div>
  );
}
