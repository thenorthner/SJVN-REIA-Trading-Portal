import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency } from '../../components/ui.jsx';
import { REASON_CODES, CHARGE_LINES, reasonLabel, chargeLabel, invoiceChargeBreakdown } from '../../disputesMeta.js';

const EMPTY = {
  invoice_id: '', reason_code: '', charge_line: 'energy_charges',
  issue_description: '', disputed_amount: '',
};

export default function BuyerDisputes() {
  const [rows, setRows] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [comment, setComment] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);

  const selectedInvoice = invoices.find((i) => i.id === form.invoice_id);
  const breakdown = invoiceChargeBreakdown(selectedInvoice);

  function load() {
    setLoading(true);
    api.disputes.list().then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, []);

  function openNew() {
    api.invoices.list({ direction: 'SJVN_TO_BUYER' }).then((res) => setInvoices(res.filter((r) => r.status !== 'DRAFT')));
    setForm(EMPTY);
    setError('');
    setNewModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.invoice_id || !form.reason_code || !form.disputed_amount) {
      setError('Invoice, reason code and amount are required');
      return;
    }
    if (form.reason_code === 'OTHER' && !form.issue_description.trim()) {
      setError('Description is mandatory for Other');
      return;
    }
    try {
      const created = await api.disputes.create({
        invoice_id: form.invoice_id,
        raised_by_role: 'BUYER',
        reason_code: form.reason_code,
        charge_line: form.charge_line,
        issue_description: form.issue_description,
        disputed_amount: Number(form.disputed_amount),
      });
      if (evidenceFile) {
        await api.disputes.uploadEvidence(created.id, evidenceFile);
      }
      setNewModal(false);
      setEvidenceFile(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to raise dispute');
    }
  }

  async function openDetail(row) {
    const d = await api.disputes.get(row.id);
    setDetail(d);
    setComment('');
  }

  async function postComment(e) {
    e.preventDefault();
    if (!comment.trim()) return;
    await api.disputes.comment(detail.id, comment, false);
    setComment('');
    setDetail(await api.disputes.get(detail.id));
    load();
  }

  async function uploadEvidence(e) {
    const file = e.target.files?.[0];
    if (!file || !detail) return;
    await api.disputes.uploadEvidence(detail.id, file);
    e.target.value = '';
    setDetail(await api.disputes.get(detail.id));
  }

  const columns = [
    { key: 'dispute_no', header: 'Dispute ID' },
    { key: 'invoice_no', header: 'Invoice', render: (r) => r.invoice_no },
    { key: 'reason_code', header: 'Category', render: (r) => reasonLabel(r.reason_code) },
    { key: 'disputed_amount', header: 'Disputed', render: (r) => fmtCurrency(r.disputed_amount) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'created_at', header: 'Raised', render: (r) => r.created_at?.substring(0, 10) },
  ];

  return (
    <div>
      <PageHeader
        title="My Disputes"
        subtitle="Raise partial invoice disputes with reason codes, evidence and track resolution"
        actions={<button className="btn btn-primary" onClick={openNew}>+ Raise Dispute</button>}
      />

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No disputes raised yet.'} />
      </Card>

      <Modal open={newModal} onClose={() => setNewModal(false)} title="Raise a New Dispute" width={620}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <Field label="Select Invoice">
            <select required value={form.invoice_id} onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}>
              <option value="">-- Choose Invoice --</option>
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_no} ({inv.billing_period}) — Total {fmtCurrency(inv.total_amount)} | Payable now {fmtCurrency(inv.payable_now ?? inv.total_amount - (inv.disputed_amount || 0))}
                </option>
              ))}
            </select>
          </Field>
          {selectedInvoice && (
            <div className="inline-note" style={{ marginBottom: 12 }}>
              <strong>Line-item breakdown</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {CHARGE_LINES.map((c) => (
                  <li key={c.value}>{c.label}: {fmtCurrency(breakdown[c.value] || 0)}</li>
                ))}
              </ul>
              <div style={{ marginTop: 6, color: 'var(--error, #b91c1c)' }}>
                Disputed: {fmtCurrency(selectedInvoice.disputed_amount || 0)} | Payable now: {fmtCurrency(selectedInvoice.payable_now ?? (selectedInvoice.total_amount - (selectedInvoice.disputed_amount || 0)))}
              </div>
            </div>
          )}
          <Field label="Charge line (partial dispute)">
            <select required value={form.charge_line} onChange={(e) => setForm({ ...form, charge_line: e.target.value })}>
              {CHARGE_LINES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Disputed Amount (₹)">
            <input required type="number" value={form.disputed_amount} onChange={(e) => setForm({ ...form, disputed_amount: e.target.value })} />
            <p className="inline-note" style={{ marginTop: 4 }}>Remaining undisputed amount stays payable by due date.</p>
          </Field>
          <Field label="Reason code (mandatory)">
            <select required value={form.reason_code} onChange={(e) => setForm({ ...form, reason_code: e.target.value })}>
              <option value="">-- Select Category --</option>
              {REASON_CODES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Detailed Description">
            <textarea
              required={form.reason_code === 'OTHER'}
              value={form.issue_description}
              onChange={(e) => setForm({ ...form, issue_description: e.target.value })}
              placeholder="Explain the discrepancy..."
            />
          </Field>
          <Field label="Evidence / supporting document">
            <input type="file" onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setNewModal(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Submit Dispute</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.dispute_no || 'Dispute'} width={640}>
        {detail && (
          <div>
            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Invoice</span><span className="detail-value">{detail.invoice?.invoice_no}</span></div>
              <div className="detail-item"><span className="detail-label">Category</span><span className="detail-value">{reasonLabel(detail.reason_code)}</span></div>
              <div className="detail-item"><span className="detail-label">Charge line</span><span className="detail-value">{chargeLabel(detail.charge_line)}</span></div>
              <div className="detail-item"><span className="detail-label">Disputed</span><span className="detail-value">{fmtCurrency(detail.disputed_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Payable now</span><span className="detail-value">{fmtCurrency(detail.invoice?.payable_now)}</span></div>
            </div>
            <p>{detail.issue_description}</p>
            {detail.resolution_notes && (
              <div className="inline-note"><strong>Resolution:</strong> {detail.resolution_notes}</div>
            )}
            {detail.status === 'INFO_REQUESTED' && (
              <div className="inline-note" style={{ borderColor: 'var(--warning, #d97706)' }}>
                SJVN has requested more information. Reply in the thread below.
              </div>
            )}

            <div className="section-title" style={{ marginTop: 14 }}>Evidence</div>
            <ul style={{ paddingLeft: 18 }}>
              {(detail.supporting_docs || []).map((d) => (
                <li key={d.filename}>{d.original_name || d.filename}</li>
              ))}
            </ul>
            <input type="file" onChange={uploadEvidence} />

            <div className="section-title" style={{ marginTop: 14 }}>Communication</div>
            <div style={{ maxHeight: 180, overflow: 'auto', marginBottom: 8 }}>
              {(detail.comments || []).map((c) => (
                <div key={c.id} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, opacity: 0.65 }}>{c.user_name} · {c.created_at?.slice(0, 16)}</div>
                  <div>{c.body}</div>
                </div>
              ))}
            </div>
            <form onSubmit={postComment}>
              <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a reply..." />
              <div className="form-actions">
                <button type="submit" className="btn btn-secondary">Send</button>
              </div>
            </form>
          </div>
        )}
      </Modal>
    </div>
  );
}
