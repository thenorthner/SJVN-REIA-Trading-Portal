import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import {
  InvoiceBreakdown,
  InvoiceFinancialStrip,
  InvoiceStatusCell,
  downloadInvoicePdf,
} from '../../components/invoiceShared.jsx';
import { REASON_CODES, CHARGE_LINES } from '../../disputesMeta.js';

const PAY_FORM = { amount: '', payment_date: '', mode: 'NEFT', reference: '' };
const DISPUTE_FORM = { reason_code: '', charge_line: 'energy_charges', issue_description: '', disputed_amount: '' };

const BUYER_STATUS_FILTERS = ['APPROVED', 'SENT', 'DISPUTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];

function StatusStepper({ status }) {
  const steps = ['SENT', 'PARTIALLY_PAID', 'PAID'];
  let currentIdx = steps.indexOf(status);
  if (status === 'OVERDUE') currentIdx = 1;
  if (status === 'APPROVED') currentIdx = 0;
  if (status === 'DISPUTED') currentIdx = 0;

  return (
    <div className="status-stepper">
      {steps.map((s, i) => {
        let stateClass = '';
        if (i < currentIdx) stateClass = 'step-done';
        else if (i === currentIdx) stateClass = 'step-active';
        if (status === 'OVERDUE' && i === currentIdx) stateClass = 'step-danger';
        if (status === 'DISPUTED' && i === 0) stateClass = 'step-danger';

        return (
          <div key={s} className={`step ${stateClass}`}>
            <div className="step-dot">{i < currentIdx || status === 'PAID' ? '✓' : i + 1}</div>
            <div className="step-label">{s.replace('_', ' ')}</div>
          </div>
        );
      })}
      {status === 'DISPUTED' && (
        <div className="step step-danger"><div className="step-dot">!</div><div className="step-label">Disputed</div></div>
      )}
    </div>
  );
}

export default function BuyerInvoices() {
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filters, setFilters] = useState({ status: '', billing_period: '', contract_id: '' });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [payForm, setPayForm] = useState(PAY_FORM);
  const [error, setError] = useState('');
  const [showDispute, setShowDispute] = useState(false);
  const [disputeForm, setDisputeForm] = useState(DISPUTE_FORM);

  function load() {
    setLoading(true);
    const params = { direction: 'SJVN_TO_BUYER' };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });

    api.invoices.list(params).then((data) => {
      // Buyers shouldn't see DRAFT invoices being prepared by SJVN
      setRows(data.filter((i) => i.status !== 'DRAFT'));
    }).finally(() => setLoading(false));
  }

  useEffect(load, [filters.contract_id, filters.billing_period, filters.status]);
  useEffect(() => { api.contracts.list({ contract_type: 'PSA' }).then(setContracts).catch(() => {}); }, []);

  function openDetail(row) {
    api.invoices.get(row.id).then(setSelected);
    setPayForm(PAY_FORM);
    setError('');
    setShowDispute(false);
    setDisputeForm(DISPUTE_FORM);
  }

  async function handleDownloadPdf() {
    try {
      await downloadInvoicePdf(api, selected);
    } catch (err) {
      alert('Failed to download PDF: ' + (err.response?.data?.error || err.message || err));
    }
  }

  async function handleRaiseDispute(e) {
    e.preventDefault();
    setError('');
    try {
      await api.disputes.create({
        invoice_id: selected.id,
        raised_by_role: 'BUYER',
        reason_code: disputeForm.reason_code,
        charge_line: disputeForm.charge_line,
        issue_description: disputeForm.issue_description,
        disputed_amount: Number(disputeForm.disputed_amount),
      });
      setShowDispute(false);
      setDisputeForm(DISPUTE_FORM);
      const fresh = await api.invoices.get(selected.id);
      setSelected(fresh);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to raise dispute');
    }
  }

  async function handlePayment(e) {
    e.preventDefault();
    setError('');
    try {
      await api.invoices.recordPayment(selected.id, {
        ...payForm,
        amount: Number(payForm.amount),
      });
      const fresh = await api.invoices.get(selected.id);
      setSelected(fresh);
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Payment submission failed');
    }
  }

  const columns = [
    { key: 'invoice_no', header: 'Invoice No.' },
    { key: 'contract_no', header: 'Contract', render: (r) => r.contract_no || r.contract?.contract_no || '-' },
    { key: 'billing_period', header: 'Period' },
    { key: 'invoice_type', header: 'Type', render: (r) => r.invoice_type || '-' },
    { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => fmtNumber(r.energy_mwh) },
    { key: 'total_amount', header: 'Amount', render: (r) => fmtCurrency(r.total_amount) },
    { key: 'status', header: 'Status', render: (r) => <InvoiceStatusCell row={r} /> },
    { key: 'due_date', header: 'Due Date', render: (r) => r.due_date || '-' },
  ];

  return (
    <div>
      <PageHeader
        title="Payable Invoices"
        subtitle="View and track invoices raised by SJVN against your PSAs"
      />

      <div className="filters-bar">
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {BUYER_STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.contract_id} onChange={(e) => setFilters({ ...filters, contract_id: e.target.value })}>
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
        </select>
        <input type="month" value={filters.billing_period} onChange={(e) => setFilters({ ...filters, billing_period: e.target.value })} />
      </div>

      <Card>
        <Table
          columns={columns}
          rows={loading ? [] : rows}
          onRowClick={openDetail}
          emptyMessage={loading ? 'Loading...' : 'No payable invoices found.'}
        />
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.invoice_no} width={760}>
        {selected && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button type="button" onClick={handleDownloadPdf} className="btn btn-sm btn-outline">Download PDF Bill</button>
            </div>
            <StatusStepper status={selected.status} />

            <div className="detail-grid mb-0" style={{ marginTop: 12 }}>
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={selected.status} /></span></div>
              <div className="detail-item">
                <span className="detail-label">Contract</span>
                <span className="detail-value">{selected.contract_no || selected.contract?.contract_no || '-'}</span>
              </div>
              <div className="detail-item"><span className="detail-label">Billing Period</span><span className="detail-value">{selected.billing_period}</span></div>
              <div className="detail-item"><span className="detail-label">Type</span><span className="detail-value">{selected.invoice_type || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Due Date</span><span className="detail-value">{selected.due_date || 'Not set'}</span></div>
              {selected.days_overdue > 0 && (
                <div className="detail-item">
                  <span className="detail-label">Overdue / Accrued LPS</span>
                  <span className="detail-value" style={{ color: 'var(--danger)', fontWeight: 600 }}>
                    {selected.days_overdue} day(s) · {fmtCurrency(selected.accrued_lps)}
                  </span>
                </div>
              )}
            </div>

            <InvoiceBreakdown invoice={{ ...selected, direction: selected.direction || 'SJVN_TO_BUYER' }} />
            <InvoiceFinancialStrip invoice={{ ...selected, direction: selected.direction || 'SJVN_TO_BUYER' }} />
            <p className="inline-note">Note: LPS of 15% p.a. applies only on the undisputed payable if delayed beyond due date.</p>

            {selected.disputes?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Disputes</div>
                <div className="timeline">
                  {selected.disputes.map((d) => (
                    <div className="timeline-item" key={d.id}>
                      <Badge status={d.status} /> {d.dispute_no || ''} {d.issue_description || d.reason_code || ''} — {fmtCurrency(d.disputed_amount)}
                      {d.resolution_notes && <div className="t-meta">Resolution: {d.resolution_notes}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}

            {selected.payments?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Payment History</div>
                <div className="timeline">
                  {selected.payments.map((p) => (
                    <div className="timeline-item" key={p.id}>
                      <span style={{ color: 'var(--success)', fontWeight: 600 }}>{fmtCurrency(p.amount)}</span> paid via {p.mode || '-'} on {p.payment_date}
                      <div className="t-meta">UTR/Ref: {p.reference || '-'}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!['DRAFT', 'CANCELLED', 'PAID'].includes(selected.status) && (
              <div className="form-actions" style={{ marginTop: 16, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-danger" onClick={() => setShowDispute(true)}>Raise Dispute</button>
              </div>
            )}
            {showDispute && (
              <div style={{ marginTop: 16, padding: 16, background: 'var(--bg-main)', borderRadius: 8, border: '1px solid var(--danger)' }}>
                <div className="section-title">Raise Dispute</div>
                {error && <div className="form-error">{error}</div>}
                <form onSubmit={handleRaiseDispute}>
                  <Field label="Charge line">
                    <select required value={disputeForm.charge_line} onChange={(e) => setDisputeForm({ ...disputeForm, charge_line: e.target.value })}>
                      {CHARGE_LINES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Reason code">
                    <select required value={disputeForm.reason_code} onChange={(e) => setDisputeForm({ ...disputeForm, reason_code: e.target.value })}>
                      <option value="">Select...</option>
                      {REASON_CODES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Issue Description">
                    <textarea required={disputeForm.reason_code === 'OTHER'} rows={3} value={disputeForm.issue_description} onChange={(e) => setDisputeForm({ ...disputeForm, issue_description: e.target.value })} />
                  </Field>
                  <Field label="Disputed Amount (₹)">
                    <input required type="number" value={disputeForm.disputed_amount} onChange={(e) => setDisputeForm({ ...disputeForm, disputed_amount: e.target.value })} />
                  </Field>
                  <div className="form-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => setShowDispute(false)}>Cancel</button>
                    <button type="submit" className="btn btn-danger">Submit Dispute</button>
                  </div>
                </form>
              </div>
            )}

            {!['PAID', 'CANCELLED', 'DRAFT'].includes(selected.status) && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Notify Payment (Submit UTR details)</div>
                {error && !showDispute && <div className="form-error">{error}</div>}
                <form onSubmit={handlePayment} style={{ background: 'var(--bg-main)', padding: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div className="form-grid">
                    <Field label="Amount (₹)">
                      <input required type="number" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
                    </Field>
                    <Field label="Payment Date">
                      <input required type="date" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} />
                    </Field>
                    <Field label="Mode">
                      <select required value={payForm.mode} onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })}>
                        {['NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'OTHER'].map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </Field>
                    <Field label="UTR / Reference No.">
                      <input required type="text" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="e.g. SBIN4..." />
                    </Field>
                  </div>
                  <div className="form-actions" style={{ marginTop: 16 }}>
                    <button type="submit" className="btn btn-primary">Submit Payment Details</button>
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
