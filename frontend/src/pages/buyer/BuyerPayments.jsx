import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, fmtCurrency } from '../../components/ui.jsx';

export default function BuyerPayments() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // We fetch invoices and their payments, but only SJVN_TO_BUYER direction
  useEffect(() => {
    api.invoices.list({ direction: 'SJVN_TO_BUYER' }).then((invoices) => {
      const pays = [];
      invoices.forEach(inv => {
        if (inv.payments) {
          inv.payments.forEach(p => {
            pays.push({
              ...p,
              invoice_no: inv.invoice_no,
              contract_no: inv.contract?.contract_no,
              billing_period: inv.billing_period,
            });
          });
        }
      });
      pays.sort((a, b) => new Date(b.payment_date) - new Date(a.payment_date));
      setRows(pays);
    }).finally(() => setLoading(false));
  }, []);

  const columns = [
    { key: 'payment_date', header: 'Payment Date' },
    { key: 'invoice_no', header: 'Against Invoice' },
    { key: 'contract_no', header: 'PSA' },
    { key: 'billing_period', header: 'Period' },
    { key: 'amount', header: 'Amount Paid', render: (r) => fmtCurrency(r.amount) },
    { key: 'mode', header: 'Payment Mode' },
    { key: 'reference', header: 'Reference / UTR' },
  ];

  return (
    <div>
      <PageHeader
        title="Payment Ledger"
        subtitle="View history of all payments made to SJVN against your invoices"
      />
      
      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading ledger...' : 'No payments found.'} />
      </Card>
    </div>
  );
}
