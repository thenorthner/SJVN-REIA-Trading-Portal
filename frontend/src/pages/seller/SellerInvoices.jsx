import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, StatCard, Table, Badge, Modal, Field, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import InvoiceCompliance, { TdsEstimate } from '../../components/InvoiceCompliance.jsx';
import {
  InvoiceBreakdown,
  InvoiceFinancialStrip,
  InvoiceStatusCell,
  InvoiceValidationRow,
  ValidationCompareModal,
  downloadInvoicePdf,
  INVOICE_STATUS_OPTIONS,
} from '../../components/invoiceShared.jsx';
import { REASON_CODES, CHARGE_LINES } from '../../disputesMeta.js';
import SellerInvoiceUpload from './SellerInvoiceUpload.jsx';

const STATUS_STEPS = ['DRAFT', 'PENDING_L2', 'SUBMITTED', 'UNDER_APPROVAL', 'APPROVED', 'PAID'];
const STATUS_LABELS = {
  DRAFT: 'Draft',
  PENDING_L2: 'Company check',
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

const SELLER_STATUS_FILTERS = INVOICE_STATUS_OPTIONS.filter((s) => s !== 'SENT');

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function exportCsv(rows) {
  const head = ['Invoice No.', 'Contract', 'Period', 'Type', 'Energy (MWh)', 'Amount', 'Paid', 'Status', 'Due date', 'IRN', 'Signed copy', 'Courier docket', 'Hard copy received'];
  const lines = rows.map((r) => [r.invoice_no, r.contract_no, r.billing_period, r.invoice_type, r.energy_mwh, r.total_amount, r.paid_total ?? 0, r.status,
    r.due_date || '', r.irn || '', r.signed_version_id ? 'Yes' : 'No', r.hardcopy_docket_no || '', r.hardcopy_received_on || ''].map(csvCell).join(','));
  const url = URL.createObjectURL(new Blob([`${head.map(csvCell).join(',')}\n${lines.join('\n')}\n`], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A small mark for each thing that goes with the bill.
const Mark = ({ on, children, title }) => (
  <span title={title} style={{ display: 'inline-block', marginRight: 4, padding: '1px 6px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: on ? '#dcfce7' : '#f1f5f9', color: on ? '#15803d' : '#94a3b8' }}>{children}</span>
);

function StatusStepper({ status }) {
  let currentIdx = STATUS_STEPS.indexOf(status);

  if (['PARTIALLY_PAID', 'SENT'].includes(status)) {
    currentIdx = STATUS_STEPS.indexOf('PAID') - 0.5;
  }
  const isRejected = status === 'REJECTED';
  const isDisputed = status === 'DISPUTED';

  return (
    <div className="status-stepper">
      {STATUS_STEPS.map((step, idx) => {
        let cls = 'step';
        const isDone = idx < currentIdx || (status === 'PAID' && step === 'PAID');
        const isActive = idx === currentIdx;

        if (isRejected && step === 'UNDER_APPROVAL') cls += ' step-danger';
        else if (isDone) cls += ' step-done';
        else if (isActive) cls += ' step-active';

        return (
          <div key={step} className={cls}>
            <div className="step-dot">{isDone ? '' : idx + 1}</div>
            <div className="step-label">{STATUS_LABELS[step]}</div>
          </div>
        );
      })}
      {isRejected && <div className="step step-danger"><div className="step-dot"></div><div className="step-label">Rejected</div></div>}
      {isDisputed && <div className="step step-danger"><div className="step-dot">!</div><div className="step-label">Disputed</div></div>}
    </div>
  );
}

const CREATE_FORM = { contract_id: '', period_month: '', invoice_type: 'FINAL', own_ref: '', transmission_charges: '', taxes: '', other_adjustments: '', adjustment_remarks: '' };
const DISPUTE_FORM = { reason_code: '', charge_line: 'energy_charges', issue_description: '', disputed_amount: '' };

export default function SellerInvoices() {
  const { user } = useAuth();
  // The company's maker (L1) drafts; its admin and checkers (L2, L3) are the
  // ones who send a bill to SJVN.
  const isMaker = user?.role === 'SELLER_L1';
  const canSendToSjvn = ['SELLER', 'SELLER_L2', 'SELLER_L3'].includes(user?.role);
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filters, setFilters] = useState({ status: '', billing_period: '' });
  const [q, setQ] = useState('');
  const [contractFilter, setContractFilter] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [tdsPreview, setTdsPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState(CREATE_FORM);
  const [energyPreview, setEnergyPreview] = useState(null);
  const [contractPreview, setContractPreview] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [showValidation, setShowValidation] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [showDispute, setShowDispute] = useState(false);
  const [disputeForm, setDisputeForm] = useState(DISPUTE_FORM);

  function load() {
    setLoading(true);
    const params = { direction: 'SELLER_TO_SJVN' };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.invoices.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.status, filters.billing_period]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  useEffect(() => {
    if (form.contract_id && form.period_month) {
      api.energyData.list({ contract_id: form.contract_id, period_month: form.period_month, status: 'LOCKED' })
        .then((data) => setEnergyPreview(data.length > 0 ? data[0] : null))
        .catch(() => setEnergyPreview(null));
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

  // What SJVN would deduct at source on a bill of this size — shown before it is raised.
  useEffect(() => {
    if (!form.contract_id || !form.period_month || !(totalAmount > 0)) { setTdsPreview(null); return undefined; }
    const t = setTimeout(() => {
      api.invoiceCompliance.tdsPreview({ contract_id: form.contract_id, billing_period: form.period_month, amount: totalAmount, taxes: Number(form.taxes) || 0 })
        .then(setTdsPreview).catch(() => setTdsPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [form.contract_id, form.period_month, form.taxes, totalAmount]);

  const text = q.trim().toLowerCase();
  const shown = useMemo(() => rows.filter((r) => (!contractFilter || r.contract_id === contractFilter)
    && (!text || `${r.invoice_no} ${r.contract_no} ${r.billing_period}`.toLowerCase().includes(text))), [rows, contractFilter, text]);

  const totals = useMemo(() => {
    const live = shown.filter((r) => !['CANCELLED', 'DRAFT', 'PENDING_L2', 'REJECTED'].includes(r.status));
    const billed = live.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
    const paid = live.reduce((s, r) => s + (Number(r.paid_total) || 0), 0);
    return {
      billed, paid, outstanding: Math.max(0, billed - paid),
      overdue: live.filter((r) => r.days_overdue > 0).length,
      withSjvn: shown.filter((r) => ['SUBMITTED', 'UNDER_APPROVAL'].includes(r.status)).length,
      toAct: shown.filter((r) => (r.status === 'REJECTED' && canSendToSjvn) || (r.status === 'DRAFT' && isMaker) || (r.status === 'PENDING_L2' && canSendToSjvn)).length,
    };
  }, [shown, canSendToSjvn, isMaker]);

  // What this person can move on in bulk: the maker sends drafts to the checker; the checker sends checked bills to SJVN.
  const bulkable = (r) => (r.status === 'DRAFT' && isMaker) || (r.status === 'PENDING_L2' && canSendToSjvn);
  const pickedRows = shown.filter((r) => picked.has(r.id) && bulkable(r));
  const pickedDrafts = pickedRows.filter((r) => r.status === 'DRAFT');
  const pickedChecked = pickedRows.filter((r) => r.status === 'PENDING_L2');
  const allBulkable = shown.filter(bulkable);

  // One at a time, through the same routes the single buttons use, so every bill
  // is held to the same checks and a refusal names the bill it was for.
  async function bulk(list, call, verb) {
    if (!window.confirm(`${verb} ${list.length} invoice${list.length === 1 ? '' : 's'}?`)) return;
    setBulkBusy(true);
    const failed = [];
    let done = 0;
    for (const r of list) {
      try { await call(r.id); done += 1; } catch (err) { failed.push(`${r.invoice_no}: ${err.response?.data?.error || err.message}`); }
    }
    setBulkBusy(false);
    setBulkResult({ verb, done, failed });
    setPicked(new Set());
    load();
  }

  function openDetail(row) {
    api.invoices.get(row.id).then(setSelected);
    setShowDispute(false);
    setShowValidation(false);
    setValidationResult(null);
    setDisputeForm(DISPUTE_FORM);
  }

  async function handleValidate() {
    try {
      const res = await api.invoices.validate(selected.id);
      setValidationResult(res.validation || res);
      setShowValidation(true);
      const fresh = await api.invoices.get(selected.id);
      setSelected(fresh);
      load();
    } catch (err) {
      const v = err.response?.data?.validation;
      if (v) {
        setValidationResult(v);
        setShowValidation(true);
        if (err.response?.data?.invoice) setSelected(err.response.data.invoice);
      } else {
        alert(err.response?.data?.error || 'Validation failed');
      }
    }
  }

  function openStoredValidation() {
    if (!selected?.validation_json) return;
    try {
      setValidationResult(JSON.parse(selected.validation_json));
      setShowValidation(true);
    } catch {
      alert('Could not parse stored validation result');
    }
  }

  async function handleDownloadPdf() {
    try {
      await downloadInvoicePdf(api, selected);
    } catch (err) {
      alert('Failed to download PDF: ' + (err.response?.data?.error || err.message || err));
    }
  }

  async function handleCreate(e) {
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

  // Every workflow button goes through here, so a refusal is shown rather than
  // lost as an unhandled rejection with the modal sitting unchanged.
  async function act(call, failure) {
    try {
      await call();
      setSelected(await api.invoices.get(selected.id));
      load();
    } catch (err) {
      alert(err.response?.data?.error || failure);
    }
  }
  const handleSubmitForApproval = () => act(() => api.invoices.submitForApproval(selected.id), 'Could not resubmit the invoice.');
  const handleSendToChecker = () => act(() => api.invoices.submitL2(selected.id), 'Could not send the invoice to your checker.');
  const handleCheckerApprove = () => act(() => api.invoices.approveL2(selected.id), 'Could not approve and submit the invoice.');

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
      setDisputeForm(DISPUTE_FORM);
      const fresh = await api.invoices.get(selected.id);
      setSelected(fresh);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to raise dispute');
    }
  }

  const columns = [
    {
      key: 'pick',
      header: (
        <input
          type="checkbox" aria-label="Select all that can be moved on" disabled={!allBulkable.length}
          checked={allBulkable.length > 0 && allBulkable.every((r) => picked.has(r.id))}
          onChange={(e) => setPicked(e.target.checked ? new Set(allBulkable.map((r) => r.id)) : new Set())}
        />
      ),
      render: (r) => (bulkable(r) ? (
        <input
          type="checkbox" aria-label={`Select ${r.invoice_no}`} checked={picked.has(r.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
        />
      ) : null),
    },
    { key: 'invoice_no', header: 'Invoice No.' },
    { key: 'contract_no', header: 'Contract' },
    { key: 'billing_period', header: 'Period' },
    { key: 'invoice_type', header: 'Type', render: (r) => r.invoice_type || '-' },
    { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => fmtNumber(r.energy_mwh) },
    { key: 'total_amount', header: 'Amount', render: (r) => fmtCurrency(r.total_amount) },
    { key: 'status', header: 'Status', render: (r) => <InvoiceStatusCell row={r} showValidation /> },
    { key: 'due_date', header: 'Due Date', render: (r) => r.due_date || '-' },
    {
      key: 'goes_with',
      header: 'With the bill',
      render: (r) => (
        <span style={{ whiteSpace: 'nowrap' }}>
          <Mark on={!!r.irn} title={r.irn ? 'E-invoice IRN recorded' : 'No e-invoice IRN'}>IRN</Mark>
          <Mark on={!!r.signed_version_id} title={r.signed_version_id ? 'Signed copy attached' : 'No signed copy'}>Signed</Mark>
          <Mark on={!!r.hardcopy_received_on} title={r.hardcopy_received_on ? `Hard copy received ${r.hardcopy_received_on}` : r.hardcopy_docket_no ? `Hard copy in transit — ${r.hardcopy_docket_no}` : 'No hard copy sent'}>
            {r.hardcopy_received_on ? 'Paper ✓' : r.hardcopy_docket_no ? 'In transit' : 'Paper'}
          </Mark>
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="My Invoices"
        subtitle="Create invoices, submit to SJVN for approval, and track payment status"
        actions={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" disabled={!shown.length} onClick={() => exportCsv(shown)}>Export CSV</button>
            <button className="btn btn-secondary" onClick={() => setShowUpload(true)}>
              Raise from a Sheet
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              + Create Invoice
            </button>
          </div>
        }
      />

      <SellerInvoiceUpload open={showUpload} onClose={() => setShowUpload(false)} onRaised={load} />

      <div className="kpi-grid">
        <StatCard label="Billed" value={fmtCurrency(totals.billed)} tone="blue" hint="Submitted to SJVN, not cancelled" />
        <StatCard label="Received" value={fmtCurrency(totals.paid)} tone="green" />
        <StatCard label="Outstanding" value={fmtCurrency(totals.outstanding)} tone={totals.outstanding > 0 ? 'amber' : 'green'} hint={totals.overdue ? `${totals.overdue} past due date` : 'Nothing past due'} />
        <StatCard label="With SJVN for approval" value={totals.withSjvn} />
        <StatCard label="Waiting on you" value={totals.toAct} tone={totals.toAct ? 'red' : 'green'} hint="Drafts, bills to check, and rejections" />
      </div>

      {bulkResult && (
        <div className={`alert ${bulkResult.failed.length ? 'alert-error' : 'alert-success'}`} role="status">
          {bulkResult.verb}: {bulkResult.done} done{bulkResult.failed.length ? `, ${bulkResult.failed.length} not done —` : '.'}
          {bulkResult.failed.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{bulkResult.failed.map((f) => <li key={f}>{f}</li>)}</ul>}
        </div>
      )}

      {pickedRows.length > 0 && (
        <div className="mail-bulk" role="toolbar" aria-label="Actions on the selected invoices" style={{ marginBottom: 12 }}>
          <strong>{pickedRows.length} selected</strong>
          {pickedDrafts.length > 0 && (
            <button type="button" disabled={bulkBusy} onClick={() => bulk(pickedDrafts, api.invoices.submitL2, 'Send to checker')}>
              Send {pickedDrafts.length} to checker
            </button>
          )}
          {pickedChecked.length > 0 && (
            <button type="button" disabled={bulkBusy} onClick={() => bulk(pickedChecked, (id) => api.invoices.approveL2(id), 'Approve and submit to SJVN')}>
              Approve &amp; submit {pickedChecked.length} to SJVN
            </button>
          )}
          <button type="button" disabled={bulkBusy} onClick={() => setPicked(new Set())}>Clear</button>
          {bulkBusy && <span>Working…</span>}
        </div>
      )}

      <div className="filters-bar">
        <input type="search" placeholder="Search invoice no. or contract…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search invoices" />
        <select value={contractFilter} onChange={(e) => setContractFilter(e.target.value)} aria-label="Contract">
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {SELLER_STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="month" value={filters.billing_period} onChange={(e) => setFilters({ ...filters, billing_period: e.target.value })} />
      </div>

      <Card>
        <Table
          columns={columns}
          rows={loading ? [] : shown}
          onRowClick={openDetail}
          emptyMessage={loading ? 'Loading...' : 'No invoices found. Click "+ Create Invoice" to create your first invoice.'}
        />
      </Card>

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

          {energyPreview && tdsPreview && (
            <div style={{ margin: '12px 0' }}>
              <div className="section-title" style={{ marginBottom: 8 }}>TDS — what SJVN is expected to deduct</div>
              <TdsEstimate tds={tdsPreview} total={totalAmount} />
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!energyPreview}>{isMaker ? 'Save draft for your checker' : 'Submit to SJVN'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.invoice_no} width={760}>
        {selected && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button type="button" onClick={handleDownloadPdf} className="btn btn-sm btn-outline">Download PDF Bill</button>
            </div>
            <StatusStepper status={selected.status} />

            {selected.status === 'REJECTED' && (() => {
              const r = [...(selected.approvals || [])].reverse().find((a) => a.status === 'REJECTED');
              return (
                <div className="alert alert-error" style={{ marginTop: 12 }}>
                  <strong>Rejected by SJVN{r?.approver_name ? ` (${r.approver_name})` : ''}:</strong> {r?.comments || 'No reason was recorded.'}
                </div>
              );
            })()}

            <div className="detail-grid mb-0" style={{ marginTop: 12 }}>
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={selected.status} /></span></div>
              <InvoiceValidationRow invoice={selected} onCompare={openStoredValidation} />
              <div className="detail-item"><span className="detail-label">Contract</span><span className="detail-value">{selected.contract_no}</span></div>
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

            <InvoiceBreakdown invoice={selected} />
            <InvoiceFinancialStrip invoice={{ ...selected, direction: selected.direction || 'SELLER_TO_SJVN' }} />

            <InvoiceCompliance key={selected.id} invoice={selected} onChanged={load} />

            {selected.approvals?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Approval Workflow</div>
                <div className="timeline">
                  {selected.approvals.map((a) => (
                    <div className="timeline-item" key={a.id}>
                      Level {a.level}: <Badge status={a.status} /> {a.approver_name ? `by ${a.approver_name}` : ''}
                      {a.comments && <div className="t-meta">{a.comments}</div>}
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
                      <span style={{ color: 'var(--success)', fontWeight: 600 }}>{fmtCurrency(p.amount)}</span> received via {p.mode || '-'} on {p.payment_date}
                      <div className="t-meta">UTR/Ref: {p.reference || '-'} {p.deduction > 0 && `| Deduction: ${fmtCurrency(p.deduction)}`}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

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

            <div className="form-actions" style={{ marginTop: 18, flexWrap: 'wrap' }}>
              {selected.status === 'DRAFT' && (
                <button type="button" className="btn btn-primary" onClick={handleSendToChecker}>Send to checker</button>
              )}
              {selected.status === 'PENDING_L2' && (canSendToSjvn
                ? <button type="button" className="btn btn-primary" onClick={handleCheckerApprove}>Approve &amp; submit to SJVN</button>
                : <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Waiting for your company&apos;s checker to approve it and submit it to SJVN.</span>)}
              {selected.status === 'REJECTED' && (canSendToSjvn
                ? <button type="button" className="btn btn-secondary" onClick={handleSubmitForApproval}>Revise &amp; Resubmit</button>
                : <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Rejected by SJVN — your company&apos;s checker resubmits it.</span>)}
              {selected.status !== 'CANCELLED' && (
                <button type="button" className="btn btn-secondary" onClick={handleValidate}>Validate vs System</button>
              )}
              {!['DRAFT', 'PENDING_L2', 'CANCELLED', 'PAID'].includes(selected.status) && (
                <button type="button" className="btn btn-danger" onClick={() => setShowDispute(true)}>Raise Dispute</button>
              )}
            </div>

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

      <ValidationCompareModal
        open={showValidation}
        onClose={() => setShowValidation(false)}
        validationResult={validationResult}
        selectedInvoiceNo={selected?.invoice_no}
        perspective="seller"
      />
    </div>
  );
}
