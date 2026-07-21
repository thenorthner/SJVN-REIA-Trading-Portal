import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import { REASON_CODES, CHARGE_LINES } from '../../disputesMeta.js';

const STATUS_STEPS = ['DRAFT', 'SUBMITTED', 'UNDER_APPROVAL', 'APPROVED', 'PAID'];
const STATUS_LABELS = {
  DRAFT: 'Created',
  SUBMITTED: 'Submitted to SJVN',
  UNDER_APPROVAL: 'SJVN Verification',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SENT: 'Sent for Payment',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  DISPUTED: 'Disputed',
  CANCELLED: 'Cancelled',
};

function StatusStepper({ status }) {
  let currentIdx = STATUS_STEPS.indexOf(status);
  
  // Handle statuses not strictly in the linear array
  if (['PARTIALLY_PAID', 'SENT'].includes(status)) {
    currentIdx = STATUS_STEPS.indexOf('PAID') - 0.5;
  }
  const isRejected = status === 'REJECTED';
  const isDisputed = status === 'DISPUTED';

  return (
    <div className="status-stepper">
      {STATUS_STEPS.map((step, idx) => {
        let cls = 'step';
        let isDone = idx < currentIdx || (status === 'PAID' && step === 'PAID');
        let isActive = idx === currentIdx;
        
        if (isRejected && step === 'UNDER_APPROVAL') cls += ' step-danger';
        else if (isDone) cls += ' step-done';
        else if (isActive) cls += ' step-active';
        
        return (
          <div key={step} className={cls}>
            <div className="step-dot">{isDone ? '✓' : idx + 1}</div>
            <div className="step-label">{STATUS_LABELS[step]}</div>
          </div>
        );
      })}
      {isRejected && <div className="step step-danger"><div className="step-dot">✗</div><div className="step-label">Rejected</div></div>}
      {isDisputed && <div className="step step-danger"><div className="step-dot">!</div><div className="step-label">Disputed</div></div>}
    </div>
  );
}

const CREATE_FORM = { contract_id: '', period_month: '', invoice_type: 'FINAL', own_ref: '', transmission_charges: '', taxes: '', other_adjustments: '', adjustment_remarks: '' };

export default function SellerInvoices() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filters, setFilters] = useState({ status: '', billing_period: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(CREATE_FORM);
  const [energyPreview, setEnergyPreview] = useState(null);
  const [contractPreview, setContractPreview] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  // Dispute form
  const [showDispute, setShowDispute] = useState(false);
  const [disputeForm, setDisputeForm] = useState({
    reason_code: '', charge_line: 'energy_charges', issue_description: '', disputed_amount: '',
  });

  function load() {
    setLoading(true);
    const params = { direction: 'SELLER_TO_SJVN' };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.invoices.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.status, filters.billing_period]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  // When user selects contract + period in create form, preview energy data
  useEffect(() => {
    if (form.contract_id && form.period_month) {
      // Fetch energy data for this contract+period
      api.energyData.list({ contract_id: form.contract_id, period_month: form.period_month, status: 'LOCKED' })
        .then((data) => setEnergyPreview(data.length > 0 ? data[0] : null))
        .catch(() => setEnergyPreview(null));
      // Fetch contract details for tariff
      const c = contracts.find((c) => c.id === form.contract_id);
      setContractPreview(c || null);
    } else {
      setEnergyPreview(null);
      setContractPreview(null);
    }
  }, [form.contract_id, form.period_month, contracts]);

  const calculatedCharges = energyPreview && contractPreview
    ? Math.round(energyPreview.energy_mwh * contractPreview.tariff_per_unit)
    : 0;
  const totalAmount = calculatedCharges
    + (Number(form.transmission_charges) || 0)
    + (Number(form.taxes) || 0)
    + (Number(form.other_adjustments) || 0);

  function openDetail(row) {
    api.invoices.get(row.id).then(setSelected);
    setShowDispute(false);
    setDisputeForm({ reason_code: '', charge_line: 'energy_charges', issue_description: '', disputed_amount: '' });
  }

  async function handleCreate(e, asDraft = false) {
    e.preventDefault();
    setError('');
    if (!energyPreview) {
      setError('No locked energy data found for this contract and period. Ask SJVN to validate and lock the energy data first.');
      return;
    }
    try {
      const body = {
        contract_id: form.contract_id,
        billing_period: form.period_month,
        invoice_type: form.invoice_type,
        energy_mwh: energyPreview.energy_mwh,
        tariff_per_unit: contractPreview.tariff_per_unit,
        energy_charges: calculatedCharges,
        transmission_charges: Number(form.transmission_charges) || 0,
        taxes: Number(form.taxes) || 0,
        other_adjustments: Number(form.other_adjustments) || 0,
        invoice_no: form.own_ref || undefined,
        due_date: null,
      };
      await api.invoices.submit(body);
      setShowCreate(false);
      setForm(CREATE_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit invoice.');
    }
  }

  async function handleSubmitForApproval() {
    await api.invoices.submitForApproval(selected.id);
    const fresh = await api.invoices.get(selected.id);
    setSelected(fresh);
    load();
  }

  async function handleRaiseDispute(e) {
    e.preventDefault();
    try {
      await api.disputes.create({
        invoice_id: selected.id,
        raised_by_role: 'SELLER',
        reason_code: disputeForm.reason_code,
        charge_line: disputeForm.charge_line,
        issue_description: disputeForm.issue_description,
        disputed_amount: Number(disputeForm.disputed_amount),
      });
      setShowDispute(false);
      setDisputeForm({ reason_code: '', charge_line: 'energy_charges', issue_description: '', disputed_amount: '' });
      const fresh = await api.invoices.get(selected.id);
      setSelected(fresh);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to raise dispute');
    }
  }

  const columns = [
    { key: 'invoice_no', header: 'Invoice No.' },
    { key: 'contract_no', header: 'Contract' },
    { key: 'billing_period', header: 'Period' },
    { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => fmtNumber(r.energy_mwh) },
    { key: 'total_amount', header: 'Amount', render: (r) => fmtCurrency(r.total_amount) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'due_date', header: 'Due Date', render: (r) => r.due_date || '-' },
  ];

  return (
    <div>
      <PageHeader
        title="My Invoices"
        subtitle="Create invoices, submit to SJVN for approval, and track payment status"
        actions={
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Create Invoice
          </button>
        }
      />

      <div className="filters-bar">
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['DRAFT', 'SUBMITTED', 'UNDER_APPROVAL', 'APPROVED', 'REJECTED', 'PARTIALLY_PAID', 'PAID'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="month" value={filters.billing_period} onChange={(e) => setFilters({ ...filters, billing_period: e.target.value })} />
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No invoices found. Click "+ Create Invoice" to create your first invoice.'} />
      </Card>

      {/* Create Invoice Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create New Invoice" width={640}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <div className="form-grid">
            <Field label="Contract (PPA)">
              <select required value={form.contract_id} onChange={(e) => setForm({ ...form, contract_id: e.target.value })}>
                <option value="">Select your contract...</option>
                {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.project_type} — {c.capacity_mw} MW)</option>)}
              </select>
            </Field>
            <Field label="Billing Period">
              <input required type="month" value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} />
            </Field>
          </div>

          {/* Auto-calculated preview */}
          {form.contract_id && form.period_month && (
            <div style={{ background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, margin: '12px 0' }}>
              <div className="section-title" style={{ marginBottom: 8 }}>Auto-Calculated from Energy Data</div>
              {energyPreview ? (
                <div className="detail-grid mb-0">
                  <div className="detail-item"><span className="detail-label">Energy Supplied</span><span className="detail-value">{fmtNumber(energyPreview.energy_mwh)} MWh</span></div>
                  <div className="detail-item"><span className="detail-label">PPA Tariff</span><span className="detail-value">₹{contractPreview?.tariff_per_unit}/unit</span></div>
                  <div className="detail-item"><span className="detail-label">Energy Charges</span><span className="detail-value" style={{ color: 'var(--success)', fontWeight: 600 }}>{fmtCurrency(calculatedCharges)}</span></div>
                  <div className="detail-item"><span className="detail-label">Data Source</span><span className="detail-value">{energyPreview.source} ({energyPreview.data_type})</span></div>
                </div>
              ) : (
                <div style={{ color: 'var(--danger)', fontSize: 13 }}>
                  No locked energy data found for this contract and period. Energy data must be validated and locked by SJVN before you can generate an invoice.
                </div>
              )}
            </div>
          )}

          <div className="form-grid">
            <Field label="Your Invoice Ref (optional)">
              <input placeholder="e.g. SS/INV/2025/06/001" value={form.own_ref} onChange={(e) => setForm({ ...form, own_ref: e.target.value })} />
            </Field>
            <Field label="Invoice Type">
              <select value={form.invoice_type} onChange={(e) => setForm({ ...form, invoice_type: e.target.value })}>
                <option value="FINAL">Final</option>
                <option value="PROVISIONAL">Provisional</option>
                <option value="SUPPLEMENTARY">Supplementary</option>
              </select>
            </Field>
            <Field label="Transmission Charges (₹)">
              <input type="number" placeholder="0" value={form.transmission_charges} onChange={(e) => setForm({ ...form, transmission_charges: e.target.value })} />
            </Field>
            <Field label="Taxes / GST (₹)">
              <input type="number" placeholder="0" value={form.taxes} onChange={(e) => setForm({ ...form, taxes: e.target.value })} />
            </Field>
            <Field label="Other Adjustments (₹)">
              <input type="number" placeholder="0" value={form.other_adjustments} onChange={(e) => setForm({ ...form, other_adjustments: e.target.value })} />
            </Field>
            {form.other_adjustments && (
              <Field label="Adjustment Remarks">
                <input placeholder="Reason for adjustment" value={form.adjustment_remarks} onChange={(e) => setForm({ ...form, adjustment_remarks: e.target.value })} />
              </Field>
            )}
          </div>

          {energyPreview && (
            <div style={{ background: 'var(--bg-main)', border: '2px solid var(--primary)', borderRadius: 8, padding: 16, margin: '12px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>TOTAL INVOICE AMOUNT</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{fmtCurrency(totalAmount)}</div>
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!energyPreview}>Submit to SJVN</button>
          </div>
        </form>
      </Modal>

      {/* Invoice Detail Modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.invoice_no} width={760}>
        {selected && (
          <div>
            {/* Status Stepper */}
            <StatusStepper status={selected.status} />

            {/* Invoice Breakup */}
            <div className="section-title" style={{ marginTop: 18 }}>Invoice Breakup</div>
            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Contract</span><span className="detail-value">{selected.contract_no}</span></div>
              <div className="detail-item"><span className="detail-label">Billing Period</span><span className="detail-value">{selected.billing_period}</span></div>
              <div className="detail-item"><span className="detail-label">Energy Supplied</span><span className="detail-value">{fmtNumber(selected.energy_mwh)} MWh</span></div>
              <div className="detail-item"><span className="detail-label">PPA Tariff</span><span className="detail-value">₹{selected.tariff_per_unit}/unit</span></div>
              <div className="detail-item"><span className="detail-label">Energy Charges</span><span className="detail-value">{fmtCurrency(selected.energy_charges)}</span></div>
              <div className="detail-item"><span className="detail-label">Transmission Charges</span><span className="detail-value">{fmtCurrency(selected.transmission_charges)}</span></div>
              {selected.rebate > 0 && (
                <div className="detail-item">
                  <span className="detail-label">
                    Early Pay Rebate (Deducted by SJVN)
                    <div style={{fontSize: 11, color: 'var(--text-light)', fontWeight: 'normal'}}>Formula: 2% of Energy Charges if paid early</div>
                  </span>
                  <span className="detail-value" style={{ color: 'var(--danger)' }}>-{fmtCurrency(selected.rebate)}</span>
                </div>
              )}
              {selected.penalty > 0 && (
                <div className="detail-item">
                  <span className="detail-label">
                    Penalty (CUF Shortfall)
                  </span>
                  <span className="detail-value" style={{ color: 'var(--danger)', fontWeight: 600 }}>-{fmtCurrency(selected.penalty)}</span>
                </div>
              )}
              {selected.lps > 0 && (
                <div className="detail-item">
                  <span className="detail-label">
                    Late Pay Surcharge (LPS from SJVN)
                    <div style={{fontSize: 11, color: 'var(--text-light)', fontWeight: 'normal'}}>Formula: 15% p.a. on Total Amount for delayed days</div>
                  </span>
                  <span className="detail-value" style={{ color: 'var(--success)', fontWeight: 600 }}>+{fmtCurrency(selected.lps)}</span>
                </div>
              )}
              <div className="detail-item"><span className="detail-label">Taxes</span><span className="detail-value">{fmtCurrency(selected.taxes)}</span></div>
              <div className="detail-item"><span className="detail-label">Other Adjustments</span><span className="detail-value">{fmtCurrency(selected.other_adjustments)}</span></div>
              {selected.disputed_amount > 0 && (
                <div className="detail-item"><span className="detail-label" style={{ color: 'var(--danger)' }}>Disputed</span><span className="detail-value" style={{ color: 'var(--danger)' }}>{fmtCurrency(selected.disputed_amount)}</span></div>
              )}
              <div className="detail-item">
                <span className="detail-label" style={{ fontWeight: 600 }}>
                  Payable Now
                  <div style={{fontSize: 11, color: 'var(--text-light)', fontWeight: 'normal'}}>
                    Disputed: {fmtCurrency(selected.disputed_amount || 0)} | Payable Now: {fmtCurrency(selected.payable_now ?? (selected.total_amount - selected.rebate + selected.lps - selected.disputed_amount))}
                  </div>
                </span>
                <span className="detail-value" style={{ fontSize: 18, fontWeight: 700 }}>{fmtCurrency(selected.payable_now ?? (selected.total_amount - selected.rebate + selected.lps - selected.disputed_amount))}</span>
              </div>
              <div className="detail-item"><span className="detail-label">Due Date</span><span className="detail-value">{selected.due_date || 'Not set'}</span></div>
            </div>

            {/* Approval Workflow */}
            {selected.approvals?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Approval Workflow</div>
                <div className="timeline">
                  {selected.approvals.map((a) => (
                    <div className="timeline-item" key={a.id}>
                      Level {a.level}: <Badge status={a.status} /> {a.approver_name ? `by ${a.approver_name}` : ''}
                      {a.comments && <div className="t-meta">💬 {a.comments}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Payment History */}
            {selected.payments?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Payment History</div>
                <div className="timeline">
                  {selected.payments.map((p) => (
                    <div className="timeline-item" key={p.id}>
                      <span style={{ color: 'var(--success)', fontWeight: 600 }}>{fmtCurrency(p.amount)}</span> received via {p.mode || '-'} on {p.payment_date}
                      <div className="t-meta">UTR/Ref: {p.reference || '-'} {p.deduction > 0 && `| Deduction: ${fmtCurrency(p.deduction)}`}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Disputes */}
            {selected.disputes?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Disputes</div>
                <div className="timeline">
                  {selected.disputes.map((d) => (
                    <div className="timeline-item" key={d.id}>
                      <Badge status={d.status} /> {d.issue_description} — {fmtCurrency(d.disputed_amount)}
                      {d.resolution_notes && <div className="t-meta">Resolution: {d.resolution_notes}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Actions */}
            <div className="form-actions" style={{ marginTop: 18, flexWrap: 'wrap' }}>
              {selected.status === 'DRAFT' && (
                <button className="btn btn-primary" onClick={handleSubmitForApproval}>Submit for Approval</button>
              )}
              {selected.status === 'REJECTED' && (
                <button className="btn btn-secondary" onClick={handleSubmitForApproval}>Revise &amp; Resubmit</button>
              )}
              {!['DRAFT', 'CANCELLED', 'PAID'].includes(selected.status) && (
                <button className="btn btn-danger" onClick={() => setShowDispute(true)}>Raise Dispute</button>
              )}
            </div>

            {/* Inline Dispute Form */}
            {showDispute && (
              <div style={{ marginTop: 16, padding: 16, background: 'var(--bg-main)', borderRadius: 8, border: '1px solid var(--danger)' }}>
                <div className="section-title">Raise Dispute</div>
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
          </div>
        )}
      </Modal>
    </div>
  );
}
