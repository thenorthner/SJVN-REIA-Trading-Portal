import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, fmtCurrency } from '../../components/ui.jsx';

export default function BuyerDisputes() {
  const [rows, setRows] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState({ invoice_id: '', reason: '', description: '', disputed_amount: '' });

  function load() {
    setLoading(true);
    api.disputes.list().then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, []);

  function openNew() {
    api.invoices.list({ direction: 'SJVN_TO_BUYER' }).then(res => setInvoices(res.filter(r => r.status !== 'DRAFT')));
    setForm({ invoice_id: '', reason: '', description: '', disputed_amount: '' });
    setNewModal(true);
  }

  function handleSubmit() {
    if (!form.invoice_id || !form.reason || !form.description || !form.disputed_amount) return alert('All fields required');
    const payload = {
      invoice_id: form.invoice_id,
      raised_by: 'BUYER',
      issue_description: `[${form.reason}] ${form.description}`,
      disputed_amount: Number(form.disputed_amount)
    };
    api.disputes.create(payload).then(() => {
      setNewModal(false);
      load();
    });
  }

  const columns = [
    { key: 'created_at', header: 'Date', render: (r) => r.created_at.substring(0, 10) },
    { key: 'invoice_no', header: 'Against Invoice', render: (r) => r.invoice?.invoice_no },
    { key: 'description', header: 'Description', render: (r) => <div style={{ maxWidth: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.issue_description || r.description}</div> },
    { key: 'disputed_amount', header: 'Disputed Amount', render: (r) => fmtCurrency(r.disputed_amount) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="My Disputes"
        subtitle="Raise and track discrepancies in invoices or energy allocations"
        action={<button className="btn btn-primary" onClick={openNew}>+ Raise Dispute</button>}
      />

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No disputes raised yet.'} />
      </Card>

      <Modal open={newModal} onClose={() => setNewModal(false)} title="Raise a New Dispute">
        <div className="field">
          <label className="field-label">Select Invoice</label>
          <select value={form.invoice_id} onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}>
            <option value="">-- Choose Invoice --</option>
            {invoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.invoice_no} ({inv.billing_period}) - Total: {fmtCurrency(inv.total_amount)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label">Disputed Amount (₹)</label>
          <input
            type="number"
            value={form.disputed_amount}
            onChange={(e) => setForm({ ...form, disputed_amount: e.target.value })}
            placeholder="Enter the exact amount in dispute..."
          />
          <p className="inline-note" style={{marginTop: 4}}>The remaining undisputed amount is still payable by the due date.</p>
        </div>
        <div className="field">
          <label className="field-label">Dispute Reason / Category</label>
          <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
            <option value="">-- Select Category --</option>
            <option value="Energy Data Mismatch">Energy Data / Allocation Mismatch</option>
            <option value="Tariff Discrepancy">Incorrect Tariff Applied</option>
            <option value="Rebate Not Provided">Rebate / Prompt Payment Discount missing</option>
            <option value="Tax/Duty Calculation">Tax or Duty Calculation Error</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">Detailed Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Explain the discrepancy in detail..."
          ></textarea>
        </div>
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={() => setNewModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit}>Submit Dispute</button>
        </div>
      </Modal>
    </div>
  );
}
