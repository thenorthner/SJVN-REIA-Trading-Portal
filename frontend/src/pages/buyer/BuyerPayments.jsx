import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, fmtCurrency } from '../../components/ui.jsx';

export default function BuyerPayments() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The ledger comes from the payments endpoint. This screen used to read
  // `payments` off each row of the invoice list, which that list does not
  // carry — so the ledger was empty however many payments had been made.
  useEffect(() => {
    api.invoices.payments({ direction: 'SJVN_TO_BUYER' })
      .then((pays) => setRows(pays || []))
      .catch((err) => {
        setError(err?.response?.data?.error || 'Could not load the payment ledger.');
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const totalPaid = rows.reduce((s, p) => s + (p.amount || 0), 0);

  const columns = [
    { key: 'payment_date', header: 'Payment Date' },
    { key: 'invoice_no', header: 'Against Invoice' },
    { key: 'contract_no', header: 'PSA' },
    { key: 'billing_period', header: 'Period' },
    { key: 'amount', header: 'Amount Paid', render: (r) => fmtCurrency(r.amount) },
    { key: 'deduction', header: 'Deductions', render: (r) => (r.deduction > 0 ? <span style={{ color: 'var(--danger)' }}>-{fmtCurrency(r.deduction)}</span> : '-') },
    { key: 'mode', header: 'Payment Mode', render: (r) => r.mode || '-' },
    { key: 'reference', header: 'Reference / UTR', render: (r) => r.reference || '-' },
  ];

  return (
    <div>
      <PageHeader
        title="Payment Ledger"
        subtitle="View history of all payments made to SJVN against your invoices"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">PAYMENTS RECORDED</div>
          <div className="stat-value">{rows.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">TOTAL PAID TO SJVN</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{fmtCurrency(totalPaid)}</div>
        </div>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading ledger...' : 'No payments found.'} />
      </Card>
    </div>
  );
}
