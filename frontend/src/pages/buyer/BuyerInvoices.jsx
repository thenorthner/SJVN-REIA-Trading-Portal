import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import { REASON_CODES, CHARGE_LINES } from '../../disputesMeta.js';

const PAY_FORM = { amount: '', payment_date: '', mode: 'NEFT', reference: '' };
const DISPUTE_FORM = { reason_code: '', charge_line: 'energy_charges', issue_description: '', disputed_amount: '' };

function StatusStepper({ status }) {
  const steps = ['SENT', 'PARTIALLY_PAID', 'PAID'];
  let currentIdx = steps.indexOf(status);
  
  if (status === 'OVERDUE') currentIdx = 1; // Between sent and paid

  return (
    <div className="status-stepper">
      {steps.map((s, i) => {
        let stateClass = '';
        if (i < currentIdx) stateClass = 'step-done';
        else if (i === currentIdx) stateClass = 'step-active';
        
        if (status === 'OVERDUE' && i === currentIdx) stateClass = 'step-danger';

        return (
          <div key={s} className={`step ${stateClass}`}>
            <div className="step-dot">{i + 1}</div>
            <div className="step-label">{s.replace('_', ' ')}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function BuyerInvoices() {
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filters, setFilters] = useState({ contract_id: '', billing_period: '', status: '' });
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
      setRows(data.filter(i => i.status !== 'DRAFT'));
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
      const blob = await api.invoices.downloadPdf(selected.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Invoice_${selected.invoice_no}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
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
      await api.invoices.recordPayment(selected.id, payForm);
      const fresh = await api.invoices.get(selected.id);
      setSelected(fresh);
      load();
    } catch (err) {
      setError(err.message || 'Payment submission failed');
    }
  }

  const columns = [
    { key: 'invoice_no', header: 'Invoice No.' },
    { key: 'contract_no', header: 'PSA', render: (r) => r.contract?.contract_no },
    { key: 'billing_period', header: 'Period' },
    { key: 'energy_mwh', header: 'Allocated (MWh)', render: (r) => fmtNumber(r.energy_mwh) },
    { key: 'total_amount', header: 'Total Payable', render: (r) => fmtCurrency(r.total_amount) },
    { key: 'due_date', header: 'Due Date' },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Payable Invoices"
        subtitle="View and track invoices raised by SJVN against your PSAs"
      />

      <div className="filters-bar">
        <select value={filters.contract_id} onChange={(e) => setFilters({ ...filters, contract_id: e.target.value })}>
          <option value="">All PSAs</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
        </select>
        <input type="month" value={filters.billing_period} onChange={(e) => setFilters({ ...filters, billing_period: e.target.value })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No payable invoices found.'} />
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Invoice: ${selected?.invoice_no}`} width={720}>
        {selected && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button onClick={handleDownloadPdf} className="btn btn-sm btn-outline">Download PDF Bill</button>
            </div>
            <StatusStepper status={selected.status} />

            <div className="detail-grid mb-0" style={{ marginTop: 24 }}>
              <div className="detail-item"><span className="detail-label">PSA</span><span className="detail-value">{selected.contract?.contract_no}</span></div>
              <div className="detail-item"><span className="detail-label">Billing Period</span><span className="detail-value">{selected.billing_period}</span></div>
              <div className="detail-item"><span className="detail-label">Allocated Energy</span><span className="detail-value">{fmtNumber(selected.energy_mwh)} MWh</span></div>
              <div className="detail-item"><span className="detail-label">Tariff</span><span className="detail-value">₹{selected.tariff_per_unit}/unit</span></div>
            </div>

            <div className="section-title" style={{ marginTop: 24 }}>Payable Breakup</div>
            <table className="data-table" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8 }}>
              <tbody>
                <tr>
                  <td>Energy Charges ({fmtNumber(selected.energy_mwh * 1000)} units)</td>
                  <td className="text-right mono">{fmtCurrency(selected.energy_charges)}</td>
                </tr>
                {/* Assuming SJVN adds a 7 paise/unit trading margin for buyers */}
                <tr>
                  <td>Trading Margin (SJVN)</td>
                  <td className="text-right mono">{fmtCurrency(selected.trading_margin)}</td>
                </tr>
                <tr style={{ background: 'var(--bg)', fontWeight: 700 }}>
                  <td>Gross Amount Payable</td>
                  <td className="text-right mono">{fmtCurrency(selected.total_amount)}</td>
                </tr>

                {selected.lps > 0 && (
                  <tr>
                    <td>
                      <div>Late Pay Surcharge (LPS)</div>
                      <div style={{fontSize: 11, color: 'var(--text-light)'}}>Formula: 15% p.a. on Total Amount for delayed days</div>
                    </td>
                    <td className="text-right mono" style={{ color: 'var(--error)' }}>+{fmtCurrency(selected.lps)}</td>
                  </tr>
                )}
                {selected.disputed_amount > 0 && (
                  <tr>
                    <td>
                      <div>Disputed Amount</div>
                      <div style={{fontSize: 11, color: 'var(--text-light)'}}>Held from payable — LPS does not apply on this portion while open</div>
                    </td>
                    <td className="text-right mono" style={{ color: 'var(--error)' }}>-{fmtCurrency(selected.disputed_amount)}</td>
                  </tr>
                )}
                <tr style={{ background: 'var(--bg-main)', fontWeight: 800, borderTop: '2px solid var(--border)' }}>
                  <td style={{ paddingTop: 12, paddingBottom: 12 }}>
                    Payable Now
                    <div style={{fontSize: 11, color: 'var(--text-light)', fontWeight: 'normal'}}>
                      Disputed: {fmtCurrency(selected.disputed_amount || 0)} | Payable Now: {fmtCurrency(selected.payable_now ?? (selected.total_amount + (selected.lps || 0) - (selected.disputed_amount || 0)))}
                    </div>
                  </td>
                  <td className="text-right mono" style={{ paddingTop: 12, paddingBottom: 12, fontSize: 16 }}>{fmtCurrency(selected.payable_now ?? (selected.total_amount + selected.lps - selected.disputed_amount))}</td>
                </tr>
              </tbody>
            </table>
            <div className="inline-note">Note: LPS of 15% p.a. applies only on the undisputed payable if delayed beyond due date.</div>

            {selected.disputes?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Disputes</div>
                <div className="timeline">
                  {selected.disputes.map((d) => (
                    <div className="timeline-item" key={d.id}>
                      <Badge status={d.status} /> {d.dispute_no || d.id} — {fmtCurrency(d.disputed_amount)} ({d.reason_code})
                    </div>
                  ))}
                </div>
              </>
            )}

            {!['DRAFT', 'CANCELLED', 'PAID'].includes(selected.status) && (
              <div className="form-actions" style={{ marginTop: 16 }}>
                <button type="button" className="btn btn-danger" onClick={() => setShowDispute(true)}>Raise Dispute</button>
              </div>
            )}
            {showDispute && (
              <div style={{ marginTop: 12, padding: 16, background: 'var(--bg-main)', borderRadius: 8, border: '1px solid var(--border)' }}>
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
                  <Field label="Disputed amount (₹)">
                    <input required type="number" value={disputeForm.disputed_amount} onChange={(e) => setDisputeForm({ ...disputeForm, disputed_amount: e.target.value })} />
                  </Field>
                  <Field label="Description">
                    <textarea required={disputeForm.reason_code === 'OTHER'} value={disputeForm.issue_description} onChange={(e) => setDisputeForm({ ...disputeForm, issue_description: e.target.value })} />
                  </Field>
                  <div className="form-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => setShowDispute(false)}>Cancel</button>
                    <button type="submit" className="btn btn-danger">Submit Dispute</button>
                  </div>
                </form>
              </div>
            )}

            {selected.status !== 'PAID' && (
              <>
                <div className="section-title" style={{ marginTop: 24 }}>Notify Payment (Submit UTR details)</div>
                {error && <div className="form-error">{error}</div>}
                <form onSubmit={handlePayment} style={{ background: 'var(--bg-main)', padding: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div className="form-grid">
                    <Field label="Amount Paid (₹)">
                      <input required type="number" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
                    </Field>
                    <Field label="Payment Date">
                      <input required type="date" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} />
                    </Field>
                    <Field label="Payment Mode">
                      <select required value={payForm.mode} onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })}>
                        <option value="NEFT">NEFT</option>
                        <option value="RTGS">RTGS</option>
                        <option value="IMPS">IMPS</option>
                      </select>
                    </Field>
                    <Field label="UTR / Reference No.">
                      <input required type="text" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="e.g. SBIN4..."/>
                    </Field>
                  </div>
                  <div className="form-actions" style={{ marginTop: 16 }}>
                    <button type="submit" className="btn btn-primary">Submit Payment Details</button>
                  </div>
                </form>
              </>
            )}

            {selected.payments?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 24 }}>Payment History</div>
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
          </div>
        )}
      </Modal>
    </div>
  );
}
