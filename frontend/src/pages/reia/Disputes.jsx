import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency } from '../../components/ui.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER'];
const CAN_RAISE = ['SELLER', 'BUYER', 'SJVN_ADMIN', 'REIA_USER'];

const EMPTY_FORM = { invoice_id: '', raised_by: 'BUYER', issue_description: '', disputed_amount: '' };
const RESOLVE_FORM = { resolution_notes: '', revised_amount: '', lps_on_resolution: '' };

export default function Disputes() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [resolveForm, setResolveForm] = useState(RESOLVE_FORM);

  function load() {
    setLoading(true);
    api.disputes.list(status ? { status } : undefined).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [status]);
  useEffect(() => { api.invoices.list().then(setInvoices).catch(() => {}); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.disputes.create({ ...form, disputed_amount: Number(form.disputed_amount) });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to raise dispute.');
    }
  }

  async function handleReview() {
    await api.disputes.setStatus(selected.id, 'UNDER_REVIEW');
    const fresh = await api.disputes.list(status ? { status } : undefined);
    setRows(fresh);
    setSelected({ ...selected, status: 'UNDER_REVIEW' });
  }

  async function handleResolve(e) {
    e.preventDefault();
    await api.disputes.resolve(selected.id, {
      resolution_notes: resolveForm.resolution_notes,
      revised_amount: resolveForm.revised_amount ? Number(resolveForm.revised_amount) : null,
      lps_on_resolution: resolveForm.lps_on_resolution ? Number(resolveForm.lps_on_resolution) : 0,
    });
    setSelected(null);
    setResolveForm(RESOLVE_FORM);
    load();
  }

  const columns = [
    { key: 'invoice_no', header: 'Invoice' },
    { key: 'raised_by', header: 'Raised By' },
    { key: 'issue_description', header: 'Issue' },
    { key: 'disputed_amount', header: 'Disputed Amount', render: (r) => fmtCurrency(r.disputed_amount) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'created_at', header: 'Raised On', render: (r) => r.created_at?.slice(0, 10) },
  ];

  return (
    <div>
      <PageHeader
        title="Dispute Management"
        subtitle="Track billing disputes raised by buyers/sellers through to resolution"
        actions={CAN_RAISE.includes(user?.role) && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Raise Dispute</button>}
      />

      <div className="filters-bar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['SUBMITTED', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={(r) => { setSelected(r); setResolveForm(RESOLVE_FORM); }} emptyMessage={loading ? 'Loading...' : 'No disputes found.'} />
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Raise Dispute" width={520}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <Field label="Invoice">
            <select required value={form.invoice_id} onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}>
              <option value="">Select invoice...</option>
              {invoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_no} — {fmtCurrency(i.total_amount)}</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Raised By">
              <select value={form.raised_by} onChange={(e) => setForm({ ...form, raised_by: e.target.value })}>
                <option value="BUYER">Buyer</option>
                <option value="SELLER">Seller</option>
              </select>
            </Field>
            <Field label="Disputed Amount (₹)">
              <input required type="number" value={form.disputed_amount} onChange={(e) => setForm({ ...form, disputed_amount: e.target.value })} />
            </Field>
          </div>
          <Field label="Issue Description">
            <textarea required value={form.issue_description} onChange={(e) => setForm({ ...form, issue_description: e.target.value })} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Submit Dispute</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Dispute — ${selected?.invoice_no}`} width={560}>
        {selected && (
          <div>
            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={selected.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Raised By</span><span className="detail-value">{selected.raised_by}</span></div>
              <div className="detail-item"><span className="detail-label">Disputed Amount</span><span className="detail-value">{fmtCurrency(selected.disputed_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Invoice Total</span><span className="detail-value">{fmtCurrency(selected.invoice_total)}</span></div>
            </div>
            <p style={{ marginTop: 14 }}>{selected.issue_description}</p>
            {selected.resolution_notes && (
              <div className="inline-note"><strong>Resolution:</strong> {selected.resolution_notes}</div>
            )}

            {CAN_WRITE.includes(user?.role) && selected.status === 'SUBMITTED' && (
              <div className="form-actions">
                <button className="btn btn-secondary" onClick={handleReview}>Mark Under Review</button>
              </div>
            )}

            {CAN_WRITE.includes(user?.role) && ['SUBMITTED', 'UNDER_REVIEW'].includes(selected.status) && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Resolve Dispute</div>
                <form onSubmit={handleResolve}>
                  <Field label="Resolution Notes">
                    <textarea required value={resolveForm.resolution_notes} onChange={(e) => setResolveForm({ ...resolveForm, resolution_notes: e.target.value })} />
                  </Field>
                  <div className="form-grid">
                    <Field label="Revised Invoice Total (optional)">
                      <input type="number" placeholder={selected.invoice_total} value={resolveForm.revised_amount} onChange={(e) => setResolveForm({ ...resolveForm, revised_amount: e.target.value })} />
                    </Field>
                    <Field label="LPS on Resolution (₹)">
                      <input type="number" value={resolveForm.lps_on_resolution} onChange={(e) => setResolveForm({ ...resolveForm, lps_on_resolution: e.target.value })} />
                    </Field>
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary">Resolve</button>
                  </div>
                </form>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
