import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency } from '../../components/ui.jsx';
import { REASON_CODES, CHARGE_LINES, reasonLabel, chargeLabel, invoiceChargeBreakdown } from '../../disputesMeta.js';
import { fmtDate, fmtDateTime } from '../../datetime.js';

const EMPTY = {
  invoice_id: '', reason_code: '', charge_line: 'energy_charges',
  issue_description: '', disputed_amount: '',
};

export default function SellerDisputes() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
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
  useEffect(() => {
    api.invoices.list({ direction: 'SELLER_TO_SJVN' }).then(setInvoices).catch(() => {});
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (form.reason_code === 'OTHER' && !form.issue_description.trim()) {
      setError('Description is mandatory for Other');
      return;
    }
    try {
      const created = await api.disputes.create({
        invoice_id: form.invoice_id,
        raised_by_role: 'SELLER',
        reason_code: form.reason_code,
        charge_line: form.charge_line,
        issue_description: form.issue_description,
        disputed_amount: Number(form.disputed_amount),
      });
      if (evidenceFile) await api.disputes.uploadEvidence(created.id, evidenceFile);
      setShowCreate(false);
      setForm(EMPTY);
      setEvidenceFile(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to raise dispute.');
    }
  }

  async function openDetail(row) {
    setDetail(await api.disputes.get(row.id));
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
    { key: 'invoice_no', header: 'Invoice' },
    { key: 'reason_code', header: 'Category', render: (r) => reasonLabel(r.reason_code) },
    { key: 'charge_line', header: 'Line', render: (r) => chargeLabel(r.charge_line) },
    { key: 'disputed_amount', header: 'Amount', render: (r) => fmtCurrency(r.disputed_amount) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'created_at', header: 'Raised', render: (r) => fmtDate(r.created_at) },
  ];

  return (
    <div>
      <PageHeader
        title="My Disputes"
        subtitle="Partial charge-line disputes with structured reasons, evidence and SJVN tracking"
        actions={
          <button className="btn btn-danger" onClick={() => { setForm(EMPTY); setError(''); setShowCreate(true); }}>
            + Raise Dispute
          </button>
        }
      />

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No disputes raised.'} />
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Raise New Dispute" width={620}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <Field label="Select Invoice">
            <select required value={form.invoice_id} onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}>
              <option value="">Select an invoice...</option>
              {invoices.filter((i) => !['DRAFT', 'CANCELLED'].includes(i.status)).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoice_no} — {i.billing_period} — {fmtCurrency(i.total_amount)} | Payable {fmtCurrency(i.payable_now ?? i.total_amount - (i.disputed_amount || 0))}
                </option>
              ))}
            </select>
          </Field>
          {selectedInvoice && (
            <div className="inline-note" style={{ marginBottom: 12 }}>
              <strong>Charge breakdown</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {CHARGE_LINES.map((c) => (
                  <li key={c.value}>{c.label}: {fmtCurrency(breakdown[c.value] || 0)}</li>
                ))}
              </ul>
            </div>
          )}
          <Field label="Charge line">
            <select required value={form.charge_line} onChange={(e) => setForm({ ...form, charge_line: e.target.value })}>
              {CHARGE_LINES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Reason code">
            <select required value={form.reason_code} onChange={(e) => setForm({ ...form, reason_code: e.target.value })}>
              <option value="">Select...</option>
              {REASON_CODES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Disputed Amount (₹)">
            <input required type="number" value={form.disputed_amount} onChange={(e) => setForm({ ...form, disputed_amount: e.target.value })} />
          </Field>
          <Field label="Issue Description">
            <textarea required={form.reason_code === 'OTHER'} rows={3} value={form.issue_description} onChange={(e) => setForm({ ...form, issue_description: e.target.value })} />
          </Field>
          <Field label="Evidence">
            <input type="file" onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-danger">Submit Dispute</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.dispute_no || 'Dispute'} width={640}>
        {detail && (
          <div>
            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Category</span><span className="detail-value">{reasonLabel(detail.reason_code)}</span></div>
              <div className="detail-item"><span className="detail-label">Disputed</span><span className="detail-value">{fmtCurrency(detail.disputed_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Payable now</span><span className="detail-value">{fmtCurrency(detail.invoice?.payable_now)}</span></div>
            </div>
            <p>{detail.issue_description}</p>
            {detail.resolution_notes && <div className="inline-note"><strong>Resolution:</strong> {detail.resolution_notes}</div>}
            {detail.status === 'INFO_REQUESTED' && (
              <div className="inline-note">SJVN requested more information — reply below.</div>
            )}
            <div className="section-title" style={{ marginTop: 14 }}>Evidence</div>
            <ul style={{ paddingLeft: 18 }}>{(detail.supporting_docs || []).map((d) => <li key={d.filename}>{d.original_name || d.filename}</li>)}</ul>
            <input type="file" onChange={uploadEvidence} />
            <div className="section-title" style={{ marginTop: 14 }}>Thread</div>
            {(detail.comments || []).map((c) => (
              <div key={c.id} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.65 }}>{c.user_name} · {fmtDateTime(c.created_at)}</div>
                <div>{c.body}</div>
              </div>
            ))}
            <form onSubmit={postComment}>
              <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="form-actions"><button type="submit" className="btn btn-secondary">Send</button></div>
            </form>
          </div>
        )}
      </Modal>
    </div>
  );
}
