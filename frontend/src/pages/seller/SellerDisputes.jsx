import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency } from '../../components/ui.jsx';

export default function SellerDisputes() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ invoice_id: '', issue_description: '', disputed_amount: '' });
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    api.disputes.list().then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, []);
  useEffect(() => {
    api.invoices.list({ direction: 'SELLER_TO_SJVN' }).then(setInvoices).catch(() => {});
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.disputes.create({
        invoice_id: form.invoice_id,
        raised_by: 'SELLER',
        issue_description: form.issue_description,
        disputed_amount: Number(form.disputed_amount),
      });
      setShowCreate(false);
      setForm({ invoice_id: '', issue_description: '', disputed_amount: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to raise dispute.');
    }
  }

  const columns = [
    { key: 'invoice_no', header: 'Invoice No.', render: (r) => {
      const inv = invoices.find((i) => i.id === r.invoice_id);
      return inv?.invoice_no || r.invoice_id;
    }},
    { key: 'raised_by', header: 'Raised By' },
    { key: 'issue_description', header: 'Issue', render: (r) => (
      <span style={{ maxWidth: 300, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.issue_description}</span>
    )},
    { key: 'disputed_amount', header: 'Disputed Amount', render: (r) => fmtCurrency(r.disputed_amount) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'created_at', header: 'Raised On', render: (r) => r.created_at?.split('T')[0] || r.created_at },
    { key: 'resolution_notes', header: 'Resolution', render: (r) => r.resolution_notes || '-' },
  ];

  return (
    <div>
      <PageHeader
        title="My Disputes"
        subtitle="Raise and track disputes against invoices or deductions"
        actions={
          <button className="btn btn-danger" onClick={() => setShowCreate(true)}>
            + Raise Dispute
          </button>
        }
      />

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No disputes raised. Your billing is clean! ✅'} />
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Raise New Dispute" width={560}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <Field label="Select Invoice">
            <select required value={form.invoice_id} onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}>
              <option value="">Select an invoice to dispute...</option>
              {invoices.filter((i) => !['DRAFT', 'CANCELLED', 'PAID'].includes(i.status)).map((i) => (
                <option key={i.id} value={i.id}>{i.invoice_no} — {i.billing_period} — {fmtCurrency(i.total_amount)}</option>
              ))}
            </select>
          </Field>
          <Field label="Issue Description">
            <textarea required rows={4} placeholder="Describe the issue in detail. E.g.: Energy data for June 2025 shows 27,000 MWh but our meter reading is 28,500 MWh. Difference of 1,500 MWh at ₹2.55/unit = ₹3,825 short-billed." value={form.issue_description} onChange={(e) => setForm({ ...form, issue_description: e.target.value })} />
          </Field>
          <Field label="Disputed Amount (₹)">
            <input required type="number" placeholder="Amount in dispute" value={form.disputed_amount} onChange={(e) => setForm({ ...form, disputed_amount: e.target.value })} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-danger">Submit Dispute</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
