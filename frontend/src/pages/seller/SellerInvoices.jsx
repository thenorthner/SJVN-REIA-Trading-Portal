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
  PAYABLE_STATUSES,
} from '../../components/invoiceShared.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';
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

// Every status a seller's bill can be in — SENT included, or a bill SJVN has
// marked sent for payment could not be filtered for.
const SELLER_STATUS_FILTERS = INVOICE_STATUS_OPTIONS;

// The tariff is rupees per unit (kWh) and energy is in MWh.
const UNITS_PER_MWH = 1000;
export const chargesFor = (mwh, tariff) => Math.round((Number(mwh) || 0) * UNITS_PER_MWH * (Number(tariff) || 0));
/**
 * The locked energy a bill of this type runs on: the final figure for a final
 * bill and the provisional one for a provisional bill, where both are locked.
 */
export function energyRowFor(rows, invoiceType) {
  const list = Array.isArray(rows) ? rows : [];
  const want = invoiceType === 'PROVISIONAL' ? 'PROVISIONAL' : 'FINAL';
  return list.find((r) => r.data_type === want) || list.find((r) => r.data_type === 'FINAL') || list[0] || null;
}
const errOf = (err, fallback) => err?.response?.data?.error || err?.message || fallback;

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
  <span title={title} style={{ display: 'inline-block', marginRight: 4, padding: '1px 6px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: on ? '#dcfce7' : '#f1f5f9', color: on ? '#15803d' : '#94a3b8' }}>{children}</span>
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
  const [busy, setBusy] = useState('');
  const [energyRows, setEnergyRows] = useState([]);
  const [revise, setRevise] = useState(null);       // the figures being corrected on a rejected bill
  const [reviseEnergy, setReviseEnergy] = useState(null);
  const [actionError, setActionError] = useState('');
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
        .then((data) => setEnergyRows(Array.isArray(data) ? data : []))
        .catch(() => setEnergyRows([]));
      const c = contracts.find((c) => c.id === form.contract_id);
      setContractPreview(c || null);
    } else {
      setEnergyRows([]);
      setContractPreview(null);
    }
  }, [form.contract_id, form.period_month, contracts]);
  // Which locked row the bill runs on follows the invoice type. It used to be
  // whichever row came back first, whatever type was chosen.
  useEffect(() => { setEnergyPreview(energyRowFor(energyRows, form.invoice_type)); }, [energyRows, form.invoice_type]);

  // MWh × 1000 × ₹/unit. Without the 1000 the form raised every bill at a
  // thousandth of its value — ₹43,947 for a month worth ₹4,39,47,000.
  const calculatedCharges = energyPreview && contractPreview
    ? chargesFor(energyPreview.energy_mwh, contractPreview.tariff_per_unit)
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
    // A dispute's credit note is left out: the bill it answers has already come down by the same amount.
    const live = shown.filter((r) => !['CANCELLED', 'DRAFT', 'PENDING_L2', 'REJECTED'].includes(r.status) && !r.is_dispute_credit);
    const billed = live.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
    const paid = live.reduce((s, r) => s + (Number(r.paid_total) || 0), 0);
    return {
      billed, paid, outstanding: Math.max(0, billed - paid),
      overdue: live.filter((r) => (r.days_past_due || r.days_overdue) > 0).length,
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

  function openCreate() {
    setForm(CREATE_FORM);
    setError('');
    setShowCreate(true);
  }
  function closeCreate() {
    setShowCreate(false);
    setForm(CREATE_FORM);
    setError('');
  }

  function openDetail(row) {
    api.invoices.get(row.id).then(setSelected);
    setRevise(null);
    setActionError('');
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
    if (busy) return;
    setError('');
    if (!energyPreview) {
      setError('No locked energy data found for this contract and period. Ask SJVN to validate and lock the energy data first.');
      return;
    }
    setBusy('create');
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
        adjustment_remarks: Number(form.other_adjustments) ? form.adjustment_remarks.trim() : undefined,
        invoice_no: form.own_ref.trim() || undefined,
        due_date: null,
      };
      await api.invoices.submit(body);
      closeCreate();
      load();
    } catch (err) {
      setError(errOf(err, 'Failed to submit invoice.'));
    } finally {
      setBusy('');
    }
  }

  // Every workflow button goes through here, so a refusal is shown rather than
  // lost as an unhandled rejection with the modal sitting unchanged.
  async function act(call, failure) {
    if (busy) return false;
    setActionError('');
    setBusy('act');
    try {
      await call();
      setSelected(await api.invoices.get(selected.id));
      load();
      return true;
    } catch (err) {
      setActionError(errOf(err, failure));
      return false;
    } finally {
      setBusy('');
    }
  }
  const handleSubmitForApproval = () => act(() => api.invoices.submitForApproval(selected.id), 'Could not resubmit the invoice.');

  // Revising a bill SJVN sent back: the figures open for correction, worked
  // again from the locked energy for the month, before it goes to SJVN again.
  function openRevise() {
    const contract = contracts.find((c) => c.id === selected.contract_id);
    setActionError('');
    setReviseEnergy(null);
    setRevise({
      energy_mwh: selected.energy_mwh, tariff_per_unit: selected.tariff_per_unit, energy_charges: selected.energy_charges,
      transmission_charges: selected.transmission_charges || '', taxes: selected.taxes || '',
      other_adjustments: selected.other_adjustments || '', adjustment_remarks: selected.adjustment_remarks || '',
    });
    api.energyData.list({ contract_id: selected.contract_id, period_month: selected.billing_period, status: 'LOCKED' })
      .then((rows) => {
        const row = energyRowFor(rows, selected.invoice_type);
        if (!row) return;
        const tariff = contract?.tariff_per_unit ?? selected.tariff_per_unit;
        setReviseEnergy({ ...row, tariff, charges: chargesFor(row.energy_mwh, tariff) });
      })
      .catch(() => {});
  }
  const reviseTotal = revise
    ? (Number(revise.energy_charges) || 0) + (Number(revise.transmission_charges) || 0) + (Number(revise.taxes) || 0) + (Number(revise.other_adjustments) || 0)
    : 0;
  async function saveRevision(andResubmit) {
    const ok = await act(async () => {
      await api.invoices.revise(selected.id, {
        energy_mwh: Number(revise.energy_mwh), tariff_per_unit: Number(revise.tariff_per_unit), energy_charges: Number(revise.energy_charges),
        transmission_charges: Number(revise.transmission_charges) || 0, taxes: Number(revise.taxes) || 0,
        other_adjustments: Number(revise.other_adjustments) || 0, adjustment_remarks: String(revise.adjustment_remarks || '').trim(),
      });
      if (andResubmit) await api.invoices.submitForApproval(selected.id);
    }, 'The revision could not be saved.');
    if (ok) setRevise(null);
  }
  const handleSendToChecker = () => act(() => api.invoices.submitL2(selected.id), 'Could not send the invoice to your checker.');
  const handleCheckerApprove = () => act(() => api.invoices.approveL2(selected.id), 'Could not approve and submit the invoice.');

  async function handleRaiseDispute(e) {
    e.preventDefault();
    if (busy) return;
    setActionError('');
    setBusy('dispute');
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
      setActionError(errOf(err, 'Failed to raise dispute'));
    } finally {
      setBusy('');
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
    {
      key: 'invoice_no',
      header: 'Invoice No.',
      // SJVN's own computation of a month, shown once it is approved, is not
      // one of the seller's invoices — say so.
      render: (r) => (r.raised_by_seller === false
        ? <span>{r.invoice_no}<div style={{ fontSize: 13, color: '#1d4ed8' }}>Raised by SJVN</div></span>
        : r.invoice_no),
    },
    { key: 'contract_no', header: 'Contract' },
    { key: 'billing_period', header: 'Period' },
    { key: 'invoice_type', header: 'Type', render: (r) => r.invoice_type || '-' },
    { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => fmtNumber(r.energy_mwh) },
    { key: 'total_amount', header: 'Amount', render: (r) => fmtCurrency(r.total_amount) },
    { key: 'status', header: 'Status', render: (r) => <InvoiceStatusCell row={r} showValidation={false} /> },
    { key: 'due_date', header: 'Due Date', render: (r) => (r.due_date ? fmtDate(r.due_date) : '-') },
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
            <button className="btn btn-primary" onClick={openCreate}>
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
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Status">
          <option value="">All statuses</option>
          {SELLER_STATUS_FILTERS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
        </select>
        <input type="month" value={filters.billing_period} onChange={(e) => setFilters({ ...filters, billing_period: e.target.value })} aria-label="Billing period" />
        {(q || contractFilter || filters.status || filters.billing_period) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setContractFilter(''); setFilters({ status: '', billing_period: '' }); }}>Clear filters</button>
        )}
      </div>

      <Card>
        <Table
          columns={columns}
          rows={loading ? [] : shown}
          onRowClick={openDetail}
          emptyMessage={loading ? 'Loading...' : 'No invoices found. Click "+ Create Invoice" to create your first invoice.'}
        />
      </Card>

      <Modal open={showCreate} onClose={closeCreate} title="Create New Invoice" width={640}>
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
                  <div className="detail-item">
                    <span className="detail-label">Energy Charges</span>
                    <span className="detail-value" style={{ color: 'var(--success)', fontWeight: 600 }}>
                      {fmtCurrency(calculatedCharges)}
                      <div style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-light)' }}>{fmtNumber(energyPreview.energy_mwh)} MWh × 1,000 units × ₹{contractPreview?.tariff_per_unit}</div>
                    </span>
                  </div>
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
            {Number(form.other_adjustments) !== 0 && form.other_adjustments !== '' && (
              <Field label="Adjustment Remarks" required>
                <input required placeholder="What the adjustment is for" value={form.adjustment_remarks} onChange={(e) => setForm({ ...form, adjustment_remarks: e.target.value })} />
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
            <button type="button" className="btn btn-ghost" onClick={closeCreate}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!energyPreview || busy === 'create'}>{busy === 'create' ? 'Submitting…' : isMaker ? 'Save draft for your checker' : 'Submit to SJVN'}</button>
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
            {selected.status !== 'REJECTED' && selected.approval_history?.length > 0 && (
              <p className="inline-note" style={{ marginTop: 10 }}>
                Sent back earlier: {selected.approval_history.map((h) => `${fmtDateTime(h.at)}${h.comments ? ` — ${h.comments}` : ''}`).join('; ')}
              </p>
            )}
            {selected.raised_by_seller === false && (
              <p className="inline-note" style={{ marginTop: 10 }}>
                This is SJVN&apos;s own bill for the month, shown to you now that it is approved. It is not one of the invoices you raised.
              </p>
            )}

            <div className="detail-grid mb-0" style={{ marginTop: 12 }}>
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={selected.status} /></span></div>
              <InvoiceValidationRow invoice={selected} onCompare={openStoredValidation} />
              <div className="detail-item"><span className="detail-label">Contract</span><span className="detail-value">{selected.contract_no}</span></div>
              <div className="detail-item"><span className="detail-label">Billing Period</span><span className="detail-value">{selected.billing_period}</span></div>
              <div className="detail-item"><span className="detail-label">Type</span><span className="detail-value">{selected.invoice_type || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Due Date</span><span className="detail-value">{selected.due_date ? fmtDate(selected.due_date) : 'Not set'}</span></div>
              {(selected.days_past_due > 0 || selected.days_overdue > 0) && (
                <div className="detail-item">
                  <span className="detail-label">Overdue / Accrued LPS</span>
                  <span className="detail-value" style={{ color: 'var(--danger)', fontWeight: 600 }}>
                    {selected.days_past_due || selected.days_overdue} day(s) past due · {fmtCurrency(selected.accrued_lps)}
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

            {actionError && <div className="form-error" role="alert" style={{ marginTop: 14 }}>{actionError}</div>}

            {/* Correcting a bill before it goes to SJVN again. */}
            {revise && (
              <div style={{ marginTop: 16, padding: 16, background: 'var(--bg-main)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div className="section-title">Revise this bill</div>
                {reviseEnergy && (
                  <p className="inline-note" style={{ marginTop: 0 }}>
                    Locked energy for {selected.billing_period}: <strong>{fmtNumber(reviseEnergy.energy_mwh)} MWh</strong> ({reviseEnergy.source}, {reviseEnergy.data_type}) at ₹{reviseEnergy.tariff}/unit comes to <strong>{fmtCurrency(reviseEnergy.charges)}</strong>.
                    {Math.abs(reviseEnergy.charges - (Number(revise.energy_charges) || 0)) > 1 && (
                      <> The bill has {fmtCurrency(revise.energy_charges)}.{' '}
                        <button type="button" className="btn-link" onClick={() => setRevise({ ...revise, energy_mwh: reviseEnergy.energy_mwh, tariff_per_unit: reviseEnergy.tariff, energy_charges: reviseEnergy.charges })}>Use the locked figure</button>
                      </>
                    )}
                  </p>
                )}
                <div className="form-grid">
                  <Field label="Energy (MWh)"><input type="number" min="0" step="any" value={revise.energy_mwh} onChange={(e) => setRevise({ ...revise, energy_mwh: e.target.value })} /></Field>
                  <Field label="Tariff (₹/unit)"><input type="number" min="0" step="any" value={revise.tariff_per_unit} onChange={(e) => setRevise({ ...revise, tariff_per_unit: e.target.value })} /></Field>
                  <Field label="Energy Charges (₹)"><input type="number" min="0" step="any" value={revise.energy_charges} onChange={(e) => setRevise({ ...revise, energy_charges: e.target.value })} /></Field>
                  <Field label="Transmission Charges (₹)"><input type="number" min="0" step="any" placeholder="0" value={revise.transmission_charges} onChange={(e) => setRevise({ ...revise, transmission_charges: e.target.value })} /></Field>
                  <Field label="Taxes / GST (₹)"><input type="number" min="0" step="any" placeholder="0" value={revise.taxes} onChange={(e) => setRevise({ ...revise, taxes: e.target.value })} /></Field>
                  <Field label="Other Adjustments (₹)"><input type="number" step="any" placeholder="0" value={revise.other_adjustments} onChange={(e) => setRevise({ ...revise, other_adjustments: e.target.value })} /></Field>
                  {Number(revise.other_adjustments) !== 0 && revise.other_adjustments !== '' && (
                    <Field label="Adjustment Remarks" required><input value={revise.adjustment_remarks} placeholder="What the adjustment is for" onChange={(e) => setRevise({ ...revise, adjustment_remarks: e.target.value })} /></Field>
                  )}
                </div>
                <p className="inline-note">The revised bill comes to <strong>{fmtCurrency(reviseTotal)}</strong> (it was {fmtCurrency(selected.total_amount)}). It is checked against SJVN&apos;s figure again when saved.</p>
                <div className="form-actions" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => setRevise(null)}>Cancel</button>
                  <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => saveRevision(false)}>Save the revision</button>
                  {selected.status === 'REJECTED' && canSendToSjvn && (
                    <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => saveRevision(true)}>{busy ? 'Saving…' : 'Save and resubmit to SJVN'}</button>
                  )}
                </div>
              </div>
            )}

            {!revise && (
            <div className="form-actions" style={{ marginTop: 18, flexWrap: 'wrap' }}>
              {selected.status === 'DRAFT' && (isMaker
                ? <button type="button" className="btn btn-primary" disabled={!!busy} onClick={handleSendToChecker}>Send to checker</button>
                : <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>A draft your maker has not yet sent for checking.</span>)}
              {selected.status === 'DRAFT' && selected.raised_by_seller !== false && (
                <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={openRevise}>Revise</button>
              )}
              {selected.status === 'PENDING_L2' && (canSendToSjvn
                ? <button type="button" className="btn btn-primary" disabled={!!busy} onClick={handleCheckerApprove}>Approve &amp; submit to SJVN</button>
                : <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Waiting for your company&apos;s checker to approve it and submit it to SJVN.</span>)}
              {selected.status === 'REJECTED' && selected.raised_by_seller !== false && (
                <>
                  <button type="button" className="btn btn-primary" disabled={!!busy} onClick={openRevise}>Revise the bill</button>
                  {canSendToSjvn
                    ? <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={handleSubmitForApproval}>Resubmit to SJVN</button>
                    : <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Your company&apos;s checker sends it to SJVN again.</span>}
                </>
              )}
              {selected.status !== 'CANCELLED' && selected.raised_by_seller !== false && (
                <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={handleValidate}>Validate vs System</button>
              )}
              {/* A dispute is with what SJVN has decided on the bill, so there is
                  one to raise only once SJVN has approved it. */}
              {PAYABLE_STATUSES.includes(selected.status) && !selected.is_dispute_credit && Number(selected.total_amount) > 0 && (
                <button type="button" className="btn btn-danger" onClick={() => { setActionError(''); setShowDispute(true); }}>Raise Dispute</button>
              )}
            </div>
            )}

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
