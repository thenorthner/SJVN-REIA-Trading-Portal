import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';
import { SettlementTrailPanel, BfrChip } from '../../components/SettlementTrail.jsx';
import VerificationChecklist from '../../components/VerificationChecklist.jsx';
import DevStageStepper from '../../components/DevStageStepper.jsx';
import {
  InvoiceBreakdown,
  InvoiceFinancialStrip,
  InvoiceStatusCell,
  InvoiceValidationRow,
  ValidationCompareModal,
  downloadInvoicePdf,
  INVOICE_STATUS_OPTIONS,
} from '../../components/invoiceShared.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER'];
const CAN_APPROVE = ['SJVN_ADMIN', 'REIA_USER', 'FINANCE_USER'];
const CAN_RECORD_PAYMENT = ['SJVN_ADMIN', 'FINANCE_USER', 'REIA_USER'];

const GEN_FORM = { contract_id: '', period_month: '', invoice_type: 'PROVISIONAL' };
const ARREAR_FORM = { contract_id: '', arrear_period: '', amount: '', taxes: '', reason: '' };
const SUPP_FORM = {
  contract_id: '', billing_period: '', amount: '', taxes: '', transmission_charges: '',
  reason_code: 'REVISED_REA', reason: '', parent_invoice_id: '',
};
const PAY_FORM = { amount: '', payment_date: '', mode: 'NEFT', reference: '', deduction: '' };

export default function Invoices() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filters, setFilters] = useState({ status: '', direction: '', billing_period: '' });
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [genForm, setGenForm] = useState(GEN_FORM);
  const [showArrear, setShowArrear] = useState(false);
  const [arrearForm, setArrearForm] = useState(ARREAR_FORM);
  const [arrearError, setArrearError] = useState('');
  const [showSupp, setShowSupp] = useState(false);
  const [suppForm, setSuppForm] = useState(SUPP_FORM);
  const [suppError, setSuppError] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [payForm, setPayForm] = useState(PAY_FORM);
  const [releaseForm, setReleaseForm] = useState({ amount: '', source: 'DISCOM_REALIZATION', payment_date: '', reference: '' });
  const [releaseError, setReleaseError] = useState('');
  const [showWaterfall, setShowWaterfall] = useState(false);
  const [buyers, setBuyers] = useState([]);
  const [wfForm, setWfForm] = useState({ buyer_id: '', amount: '', payment_date: '', reference: '' });
  const [wfOutstanding, setWfOutstanding] = useState(null);
  const [wfResult, setWfResult] = useState(null);
  const [wfError, setWfError] = useState('');
  const [ocRows, setOcRows] = useState([]);
  const [showOC, setShowOC] = useState(false);
  const [ocError, setOcError] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState([]);
  const [noteForm, setNoteForm] = useState({ note_type: 'DEBIT', amount: '', reason_code: 'REVISED_REA', reason: '' });
  const [noteError, setNoteError] = useState('');
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [approveComments, setApproveComments] = useState({}); // changed to object
  const [trailBfr, setTrailBfr] = useState(null);
  const [contractDetail, setContractDetail] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [showValidation, setShowValidation] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [showWaive, setShowWaive] = useState(false);
  const [waiveReason, setWaiveReason] = useState('');
  const [waiveError, setWaiveError] = useState('');

  const CANCELABLE = ['DRAFT', 'SUBMITTED', 'REJECTED', 'PENDING_L2', 'UNDER_APPROVAL'];
  const isCancelled = selected?.status === 'CANCELLED';

  function openContract(contractId) {
    if (!contractId) return;
    setContractLoading(true);
    setContractDetail({ id: contractId }); // open modal immediately with a loading state
    api.contracts.get(contractId)
      .then(setContractDetail)
      .catch(() => alert('Failed to load contract details'))
      .finally(() => setContractLoading(false));
  }

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.invoices.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.status, filters.direction, filters.billing_period]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  function loadNotes(invoiceId) {
    api.notes.list({ invoice_id: invoiceId }).then(setInvoiceNotes).catch(() => setInvoiceNotes([]));
  }

  function openDetail(row) {
    api.invoices.get(row.id).then(setSelected);
    loadNotes(row.id);
    setPayForm(PAY_FORM);
    setApproveComments({});
    setShowCancel(false);
    setCancelReason('');
    setCancelError('');
    setShowValidation(false);
    setValidationResult(null);
    setShowWaive(false);
    setShowNoteForm(false);
    setNoteError('');
    setNoteForm({ note_type: 'DEBIT', amount: '', reason_code: 'REVISED_REA', reason: '' });
    setWaiveReason('');
  }

  async function refreshSelected(id) {
    const fresh = await api.invoices.get(id);
    setSelected(fresh);
    loadNotes(id);
    load();
  }

  function openWaterfall() {
    setWfForm({ buyer_id: '', amount: '', payment_date: new Date().toISOString().split('T')[0], reference: '' });
    setWfOutstanding(null); setWfResult(null); setWfError('');
    if (!buyers.length) api.entities.list({ entity_type: 'BUYER' }).then(setBuyers).catch(() => {});
    setShowWaterfall(true);
  }
  function onWfBuyer(buyer_id) {
    setWfForm((f) => ({ ...f, buyer_id }));
    setWfOutstanding(null); setWfResult(null);
    if (buyer_id) api.invoices.buyerOutstanding(buyer_id).then(setWfOutstanding).catch(() => setWfOutstanding(null));
  }
  async function handleWaterfall(e) {
    e.preventDefault();
    setWfError('');
    try {
      const res = await api.invoices.waterfallPayment({ ...wfForm, amount: Number(wfForm.amount) });
      setWfResult(res);
      if (wfForm.buyer_id) api.invoices.buyerOutstanding(wfForm.buyer_id).then(setWfOutstanding).catch(() => {});
      load();
    } catch (err) {
      setWfError(err.response?.data?.error || 'Waterfall payment failed.');
    }
  }

  const OC_TYPES = {
    TRANSMISSION: 'Transmission / wheeling',
    RLDC_SLDC: 'RLDC / SLDC',
    CTU_STU: 'CTU / STU',
    OPEN_ACCESS: 'Open access',
    SCHEDULING: 'Scheduling & SO',
    OTHER: 'Other pass-through',
  };
  function openOtherCharges() {
    setOcRows((selected?.other_charges || []).map((c) => ({ type: c.code, amount: c.amount })));
    setOcError('');
    setShowOC(true);
  }
  async function handleSaveOtherCharges(e) {
    e.preventDefault();
    setOcError('');
    try {
      await api.invoices.setOtherCharges(selected.id, { charges: ocRows.filter((r) => Number(r.amount) > 0) });
      setShowOC(false);
      await refreshSelected(selected.id);
    } catch (err) {
      setOcError(err.response?.data?.error || 'Failed to save charges.');
    }
  }

  async function handleRaiseNote(e) {
    e.preventDefault();
    setNoteError('');
    try {
      await api.notes.create({ ...noteForm, invoice_id: selected.id, amount: Number(noteForm.amount) });
      setShowNoteForm(false);
      setNoteForm({ note_type: 'DEBIT', amount: '', reason_code: 'REVISED_REA', reason: '' });
      await refreshSelected(selected.id);
    } catch (err) {
      setNoteError(err.response?.data?.error || 'Failed to raise note.');
    }
  }

  async function handleCancelNote(id) {
    if (!window.confirm('Cancel this note? Its adjustment will be reversed on the invoice.')) return;
    await api.notes.cancel(id).catch(() => {});
    await refreshSelected(selected.id);
  }

  async function handleCancel(e) {
    e.preventDefault();
    setCancelError('');
    if (!cancelReason.trim()) {
      setCancelError('Cancel reason is required');
      return;
    }
    try {
      await api.invoices.cancel(selected.id, cancelReason.trim());
      setShowCancel(false);
      setCancelReason('');
      await refreshSelected(selected.id);
    } catch (err) {
      setCancelError(err.response?.data?.error || 'Failed to cancel invoice');
    }
  }

  async function handleValidate() {
    try {
      const res = await api.invoices.validate(selected.id);
      setValidationResult(res.validation || res);
      setShowValidation(true);
      await refreshSelected(selected.id);
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

  async function handleWaive(e) {
    e.preventDefault();
    setWaiveError('');
    if (!waiveReason.trim()) {
      setWaiveError('Waive reason is required');
      return;
    }
    try {
      const res = await api.invoices.waiveValidation(selected.id, waiveReason.trim());
      setShowWaive(false);
      setWaiveReason('');
      setValidationResult(res.validation || null);
      await refreshSelected(selected.id);
    } catch (err) {
      setWaiveError(err.response?.data?.error || 'Failed to waive validation');
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

  async function handleGenerate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.invoices.generate(genForm);
      setShowGenerate(false);
      setGenForm(GEN_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate invoice.');
    }
  }

  async function handleArrear(e) {
    e.preventDefault();
    setArrearError('');
    try {
      await api.invoices.arrear({
        ...arrearForm,
        amount: Number(arrearForm.amount),
        taxes: arrearForm.taxes ? Number(arrearForm.taxes) : 0,
      });
      setShowArrear(false);
      setArrearForm(ARREAR_FORM);
      load();
    } catch (err) {
      setArrearError(err.response?.data?.error || 'Failed to raise arrear bill.');
    }
  }

  async function handleSupp(e) {
    e.preventDefault();
    setSuppError('');
    try {
      await api.invoices.supplementary({
        ...suppForm,
        amount: Number(suppForm.amount),
        taxes: suppForm.taxes ? Number(suppForm.taxes) : 0,
        transmission_charges: suppForm.transmission_charges ? Number(suppForm.transmission_charges) : 0,
        parent_invoice_id: suppForm.parent_invoice_id || null,
      });
      setShowSupp(false);
      setSuppForm(SUPP_FORM);
      load();
    } catch (err) {
      setSuppError(err.response?.data?.error || 'Failed to create supplementary invoice.');
    }
  }

  async function handleSubmitForApproval() {
    try {
      await refreshSelected((await api.invoices.submitForApproval(selected.id)).id);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit invoice for approval.');
    }
  }

  async function handleSubmitL2() {
    await api.invoices.submitL2(selected.id);
    refreshSelected(selected.id);
  }

  async function handleApproveL2() {
    await api.invoices.approveL2(selected.id, 'Approved by L2');
    refreshSelected(selected.id);
  }

  async function handleAct(level, decision) {
    await api.invoices.act(selected.id, level, decision, approveComments[level] || '');
    setApproveComments({ ...approveComments, [level]: '' });
    refreshSelected(selected.id);
  }

  async function handleSend() {
    try {
      const res = await api.invoices.send(selected.id);
      const mode = res.delivery?.mode;
      const to = (res.delivery?.to || []).join(', ');
      if (mode === 'FILE_OUTBOX') {
        alert(`Invoice marked SENT.\nSMTP not configured — PDF saved to backend/outbox/.\nTo: ${to || '—'}\n\nSet SMTP_HOST (or Masters → smtp_host) for live email.`);
      } else {
        alert(`Invoice emailed successfully (${mode}).\nTo: ${to || '—'}`);
      }
      refreshSelected(selected.id);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Send failed');
    }
  }

  async function handleDownloadPdf() {
    try {
      await downloadInvoicePdf(api, selected);
    } catch (err) {
      console.error(err);
      alert('Failed to download PDF: ' + (err.response?.data?.error || err.message || err));
    }
  }

  async function handleRelease(e) {
    e.preventDefault();
    setReleaseError('');
    try {
      await api.invoices.releaseToGenerator(selected.id, { ...releaseForm, amount: Number(releaseForm.amount) });
      setReleaseForm({ amount: '', source: 'DISCOM_REALIZATION', payment_date: '', reference: '' });
      await refreshSelected(selected.id);
    } catch (err) {
      setReleaseError(err.response?.data?.error || 'Failed to release payment.');
    }
  }

  async function handlePayment(e) {
    e.preventDefault();
    await api.invoices.recordPayment(selected.id, { ...payForm, amount: Number(payForm.amount), deduction: payForm.deduction ? Number(payForm.deduction) : 0 });
    setPayForm(PAY_FORM);
    refreshSelected(selected.id);
  }

  const columns = [
    { key: 'invoice_no', header: 'Invoice No.' },
    { key: 'billing_family_ref', header: 'BFR', render: (r) => (
      <BfrChip bfr={r.billing_family_ref} onClick={(ref) => setTrailBfr(ref)} />
    )},
    { key: 'contract_no', header: 'Contract', render: (r) => (
      r.contract_id ? (
        <button
          type="button"
          className="btn-link"
          onClick={(e) => { e.stopPropagation(); openContract(r.contract_id); }}
          title="View contract details"
        >
          {r.contract_no}
        </button>
      ) : (r.contract_no || '-')
    )},
    { key: 'direction', header: 'Direction', render: (r) => r.direction === 'SJVN_TO_BUYER' ? 'SJVN → Buyer' : 'Seller → SJVN' },
    { key: 'billing_period', header: 'Period' },
    { key: 'invoice_type', header: 'Type', render: (r) => (
      r.invoice_type === 'PROVISIONAL' ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, padding: '2px 6px', background: '#fef08a', color: '#854d0e', borderRadius: 4, fontWeight: 600 }}>PROVISIONAL</span>
          {['SELLER_L1', 'SELLER_L2', 'SELLER_L3', 'BUYER_L1', 'BUYER_L2', 'BUYER_L3', 'TRADING_USER', 'REIA_USER', 'SYSTEM_ADMIN'].includes(user?.role) && (
            <button 
              className="btn btn-xs btn-outline" 
              onClick={(e) => {
                e.stopPropagation();
                setSuppForm({ ...SUPP_FORM, contract_id: r.contract_id, billing_period: r.billing_period, parent_invoice_id: r.id, reason_code: 'REVISED_REA', reason: 'Final REA True-Up delta vs Provisional Invoice.' });
                setSuppError('');
                setShowSupp(true);
              }}
              style={{ fontSize: 10, padding: '2px 6px' }}
            >
              ⚡ True-Up
            </button>
          )}
        </span>
      ) : (r.invoice_type || '-')
    )},
    { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => fmtNumber(r.energy_mwh) },
    { key: 'total_amount', header: 'Amount', render: (r) => fmtCurrency(r.total_amount) },
    { key: 'status', header: 'Status', render: (r) => <InvoiceStatusCell row={r} showValidation /> },
    { key: 'due_date', header: 'Due Date', render: (r) => r.due_date || '-' },
  ];

  return (
    <div>
      <PageHeader
        title="Billing &amp; Invoicing"
        subtitle="Generate provisional/final invoices, route through approvals and track payments"
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => navigate('/reia/reports')}>Billing Report</button>
            {CAN_WRITE.includes(user?.role) && (
              <>
                <button className="btn btn-secondary" onClick={openWaterfall}>Receive Buyer Payment</button>
                <button className="btn btn-secondary" onClick={() => { setArrearForm(ARREAR_FORM); setArrearError(''); setShowArrear(true); }}>+ Arrear Bill</button>
                <button className="btn btn-secondary" onClick={() => { setSuppForm(SUPP_FORM); setSuppError(''); setShowSupp(true); }}>+ Supplementary</button>
                <button className="btn btn-primary" onClick={() => setShowGenerate(true)}>+ Generate Invoice</button>
              </>
            )}
          </>
        }
      />

      <div className="filters-bar">
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {INVOICE_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.direction} onChange={(e) => setFilters({ ...filters, direction: e.target.value })}>
          <option value="">All directions</option>
          <option value="SELLER_TO_SJVN">Seller → SJVN</option>
          <option value="SJVN_TO_BUYER">SJVN → Buyer</option>
        </select>
        <input type="month" value={filters.billing_period} onChange={(e) => setFilters({ ...filters, billing_period: e.target.value })} />
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No invoices found.'} />
      </Card>

      <Modal open={showGenerate} onClose={() => setShowGenerate(false)} title="Generate Invoice" width={480}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleGenerate}>
          <Field label="Contract">
            <select required value={genForm.contract_id} onChange={(e) => setGenForm({ ...genForm, contract_id: e.target.value })}>
              <option value="">Select contract...</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.project_type})</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Billing Period">
              <input required type="month" value={genForm.period_month} onChange={(e) => setGenForm({ ...genForm, period_month: e.target.value })} />
            </Field>
            <Field label="Invoice Type">
              <select value={genForm.invoice_type} onChange={(e) => setGenForm({ ...genForm, invoice_type: e.target.value })}>
                <option value="PROVISIONAL">Provisional</option>
                <option value="FINAL">Final</option>
              </select>
            </Field>
          </div>
          
          {contracts.find(c => c.id === genForm.contract_id)?.contract_type === 'PSA' && (
            <Field label="Map to Seller Invoices (Many-to-Many)">
              <select multiple value={genForm.seller_invoice_ids || []} onChange={(e) => {
                const vals = Array.from(e.target.selectedOptions).map(o => o.value);
                setGenForm({ ...genForm, seller_invoice_ids: vals });
              }} style={{ height: 80 }}>
                {rows.filter(r => r.direction === 'SELLER_TO_SJVN' && ['APPROVED', 'PAID', 'PARTIALLY_PAID'].includes(r.status)).map(r => (
                  <option key={r.id} value={r.id}>{r.invoice_no} ({r.billing_period})</option>
                ))}
              </select>
              <p className="inline-note" style={{marginTop: 4}}>Hold Cmd/Ctrl to select multiple. These link the developer bills to this DISCOM bill.</p>
            </Field>
          )}
          
          <p className="inline-note">Invoice amount is auto-computed from locked/final energy data and the contract tariff. FINAL invoices require LOCKED energy data.</p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowGenerate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Generate</button>
          </div>
        </form>
      </Modal>

      <Modal open={showWaterfall} onClose={() => setShowWaterfall(false)} title="Receive Buyer Payment (LPS-first waterfall)" width={560}>
        <form onSubmit={handleWaterfall}>
          <Field label="Buyer (DISCOM)">
            <select required value={wfForm.buyer_id} onChange={(e) => onWfBuyer(e.target.value)}>
              <option value="">Select buyer...</option>
              {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          {wfOutstanding && (
            <div className="callout" style={{ margin: '6px 0 10px', padding: '10px 12px', background: 'var(--navy-soft, #eaf0f9)', borderRadius: 8, fontSize: 13 }}>
              Outstanding: <strong>{fmtCurrency(wfOutstanding.total_due)}</strong>
              {'  ·  '}LPS <strong>{fmtCurrency(wfOutstanding.total_lps)}</strong>
              {'  ·  '}Principal <strong>{fmtCurrency(wfOutstanding.total_principal)}</strong>
              <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>{wfOutstanding.items.length} outstanding bill(s)</div>
            </div>
          )}
          <div className="form-grid">
            <Field label="Amount Received (₹)">
              <input required type="number" value={wfForm.amount} onChange={(e) => setWfForm({ ...wfForm, amount: e.target.value })} />
            </Field>
            <Field label="Payment Date">
              <input required type="date" value={wfForm.payment_date} onChange={(e) => setWfForm({ ...wfForm, payment_date: e.target.value })} />
            </Field>
          </div>
          <Field label="Reference"><input value={wfForm.reference} onChange={(e) => setWfForm({ ...wfForm, reference: e.target.value })} /></Field>
          <p className="inline-note">Payment is applied first to LPS (oldest bill first), then to the oldest bill's principal — per PSA Art. 6.3.</p>
          {wfError && <div className="form-error">{wfError}</div>}
          {wfResult && (
            <div style={{ marginTop: 8 }}>
              <div className="inline-note">Allocated {fmtCurrency(wfResult.allocated)}{wfResult.unallocated > 0 ? ` · ${fmtCurrency(wfResult.unallocated)} unallocated (no more dues)` : ''}:</div>
              <table className="data-table" style={{ width: '100%', fontSize: 12.5, marginTop: 4 }}>
                <tbody>
                  {wfResult.allocations.map((a) => (
                    <tr key={a.invoice_no}>
                      <td><strong>{a.invoice_no}</strong> <span style={{ color: 'var(--text-light)' }}>{a.billing_period}</span></td>
                      <td className="text-right mono">{fmtCurrency(a.allocated)}</td>
                      <td><Badge status={a.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowWaterfall(false)}>Close</button>
            <button type="submit" className="btn btn-primary">Apply Payment</button>
          </div>
        </form>
      </Modal>

      <Modal open={showArrear} onClose={() => setShowArrear(false)} title="Raise Arrear Bill" width={480}>
        {arrearError && <div className="form-error">{arrearError}</div>}
        <form onSubmit={handleArrear}>
          <Field label="Contract">
            <select required value={arrearForm.contract_id} onChange={(e) => setArrearForm({ ...arrearForm, contract_id: e.target.value })}>
              <option value="">Select contract...</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.project_type})</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Arrear Period (recovering for)">
              <input required type="month" value={arrearForm.arrear_period} onChange={(e) => setArrearForm({ ...arrearForm, arrear_period: e.target.value })} />
            </Field>
            <Field label="Arrear Amount (₹)">
              <input required type="number" step="0.01" value={arrearForm.amount} placeholder="e.g. 250000" onChange={(e) => setArrearForm({ ...arrearForm, amount: e.target.value })} />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Taxes / GST (₹)">
              <input type="number" step="0.01" value={arrearForm.taxes} placeholder="0" onChange={(e) => setArrearForm({ ...arrearForm, taxes: e.target.value })} />
            </Field>
            <Field label="Total">
              <input disabled value={`₹${((Number(arrearForm.amount) || 0) + (Number(arrearForm.taxes) || 0)).toLocaleString('en-IN')}`} />
            </Field>
          </div>
          <Field label="Reason for arrear">
            <textarea required rows={2} value={arrearForm.reason} placeholder="e.g. Retrospective tariff revision per CERC order dated…" onChange={(e) => setArrearForm({ ...arrearForm, reason: e.target.value })} style={{ width: '100%', resize: 'vertical' }} />
          </Field>
          <p className="inline-note">An arrear bill recovers charges missed or under-billed in a past period. It routes through the normal approval workflow.</p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowArrear(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Raise Arrear</button>
          </div>
        </form>
      </Modal>

      <Modal open={showSupp} onClose={() => setShowSupp(false)} title="Manual Supplementary Invoice" width={520}>
        {suppError && <div className="form-error">{suppError}</div>}
        <form onSubmit={handleSupp}>
          <Field label="Contract">
            <select required value={suppForm.contract_id} onChange={(e) => setSuppForm({ ...suppForm, contract_id: e.target.value, parent_invoice_id: '' })}>
              <option value="">Select contract...</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.project_type})</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Billing Period">
              <input required type="month" value={suppForm.billing_period} onChange={(e) => setSuppForm({ ...suppForm, billing_period: e.target.value })} />
            </Field>
            <Field label="Reason Category">
              <select required value={suppForm.reason_code} onChange={(e) => setSuppForm({ ...suppForm, reason_code: e.target.value })}>
                <option value="REVISED_REA">Revised / amended REA true-up</option>
                <option value="CHANGE_IN_LAW">Change in Law</option>
                <option value="TRANSMISSION_CHARGES">Transmission charges</option>
                <option value="LPS">Late Payment Surcharge (LPS)</option>
                <option value="BETA_TRUE_UP">β true-up</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Adjustment Amount (₹)">
              <input required type="number" step="0.01" value={suppForm.amount} placeholder="positive debit / negative credit" onChange={(e) => setSuppForm({ ...suppForm, amount: e.target.value })} />
            </Field>
            <Field label="Taxes / GST (₹)">
              <input type="number" step="0.01" value={suppForm.taxes} placeholder="0" onChange={(e) => setSuppForm({ ...suppForm, taxes: e.target.value })} />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Transmission (₹)">
              <input type="number" step="0.01" value={suppForm.transmission_charges} placeholder="0" onChange={(e) => setSuppForm({ ...suppForm, transmission_charges: e.target.value })} />
            </Field>
            <Field label="Total">
              <input disabled value={`₹${((Number(suppForm.amount) || 0) + (Number(suppForm.taxes) || 0) + (Number(suppForm.transmission_charges) || 0)).toLocaleString('en-IN')}`} />
            </Field>
          </div>
          <Field label="Link to Parent Invoice (optional)">
            <select value={suppForm.parent_invoice_id} onChange={(e) => setSuppForm({ ...suppForm, parent_invoice_id: e.target.value })}>
              <option value="">None</option>
              {rows.filter((r) => r.contract_id === suppForm.contract_id && r.invoice_type !== 'SUPPLEMENTARY').map((r) => (
                <option key={r.id} value={r.id}>{r.invoice_no} · {r.billing_period} · {r.invoice_type}</option>
              ))}
            </select>
          </Field>
          <Field label="Reason / Reference">
            <textarea required rows={2} value={suppForm.reason} placeholder="e.g. CERC tariff revision order dated… / Change-in-law claim per clause…" onChange={(e) => setSuppForm({ ...suppForm, reason: e.target.value })} style={{ width: '100%', resize: 'vertical' }} />
          </Field>
          <p className="inline-note">Creates a SUPPLEMENTARY draft with billing family ref. Dispute auto-credits are unchanged — use this for tariff / change-in-law / energy / LPS adjustments.</p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowSupp(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Supplementary</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.invoice_no} width={760}>
        {selected && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button type="button" onClick={handleDownloadPdf} className="btn btn-sm btn-outline">
                Download PDF Bill
              </button>
            </div>
            {selected.direction === 'SELLER_TO_SJVN' && selected.dev_stage && (
              <div style={{ marginBottom: 16 }}>
                <div className="section-title" style={{ marginBottom: 6 }}>Developer Invoice Pipeline</div>
                <DevStageStepper stages={selected.dev_stages} current={selected.dev_stage} />
              </div>
            )}
            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={selected.status} /></span></div>
              {selected.direction === 'SELLER_TO_SJVN' && (
                <InvoiceValidationRow invoice={selected} onCompare={openStoredValidation} />
              )}
              {isCancelled && selected.cancel_reason && (
                <div className="detail-item">
                  <span className="detail-label">Cancel Reason</span>
                  <span className="detail-value">
                    {selected.cancel_reason}
                    <div style={{ fontSize: 11, color: 'var(--text-light)' }}>
                      {selected.cancelled_by || '—'} · {selected.cancelled_at || ''}
                    </div>
                  </span>
                </div>
              )}
              <div className="detail-item"><span className="detail-label">Contract</span><span className="detail-value">
                {selected.contract_id ? (
                  <button type="button" className="btn-link" onClick={() => openContract(selected.contract_id)} title="View contract details">
                    {selected.contract_no} &rsaquo;
                  </button>
                ) : (selected.contract_no || '-')}
              </span></div>
              <div className="detail-item"><span className="detail-label">Direction</span><span className="detail-value">{selected.direction === 'SJVN_TO_BUYER' ? 'SJVN → Buyer' : 'Seller → SJVN'}</span></div>
              <div className="detail-item"><span className="detail-label">Billing Period</span><span className="detail-value">{selected.billing_period}</span></div>
              <div className="detail-item"><span className="detail-label">Type</span><span className="detail-value">{selected.invoice_type || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Due Date</span><span className="detail-value">{selected.due_date || 'Not set'}</span></div>
              {selected.days_overdue > 0 && (
                <div className="detail-item">
                  <span className="detail-label">Overdue / Accrued LPS</span>
                  <span className="detail-value" style={{ color: 'var(--error)', fontWeight: 600 }}>
                    {selected.days_overdue} day(s) · {fmtCurrency(selected.accrued_lps)}
                    <span style={{ fontWeight: 400, color: 'var(--slate-500)', fontSize: 12 }}> (accruing until paid)</span>
                  </span>
                </div>
              )}
              <div className="detail-item"><span className="detail-label">Tariff</span><span className="detail-value">₹{selected.tariff_per_unit}/unit</span></div>
              <div className="detail-item">
                <span className="detail-label">Billing Family Ref</span>
                <span className="detail-value">
                  <BfrChip bfr={selected.billing_family_ref} onClick={() => setTrailBfr(selected.billing_family_ref)} />
                </span>
              </div>
              {selected.parent_invoice_id && (
                <div className="detail-item"><span className="detail-label">Parent Invoice</span><span className="detail-value" style={{ fontFamily: 'monospace', fontSize: 12 }}>{selected.parent_invoice_id}</span></div>
              )}
            </div>

            <SettlementTrailPanel invoiceId={selected.id} />

            <InvoiceBreakdown invoice={selected} />
            <InvoiceFinancialStrip invoice={selected} />

            {selected.direction === 'SELLER_TO_SJVN' && (
              <details style={{ marginTop: 18 }} open>
                <summary className="section-title" style={{ cursor: 'pointer' }}>Verification Checklist (Technical &amp; Commercial)</summary>
                <div style={{ marginTop: 10 }}>
                  <VerificationChecklist
                    invoiceId={selected.id}
                    canWrite={CAN_APPROVE.includes(user?.role)}
                    onSaved={() => refreshSelected(selected.id)}
                  />
                </div>
              </details>
            )}

            {selected.approvals?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Approval Workflow</div>
                <div className="timeline">
                  {selected.approvals.map((a) => (
                    <div className="timeline-item" key={a.id}>
                      Level {a.level}: <Badge status={a.status} /> {a.approver_name ? `by ${a.approver_name}` : ''}
                      {a.comments && <div className="t-meta">{a.comments}</div>}
                      {CAN_APPROVE.includes(user?.role) && !isCancelled && a.status === 'PENDING' && (
                        <div style={{ marginTop: 8 }}>
                          <input placeholder="Comments (optional)" value={approveComments[a.level] || ''} onChange={(e) => setApproveComments({ ...approveComments, [a.level]: e.target.value })} style={{ marginBottom: 6, width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px' }} />
                          <div className="cell-actions">
                            <button className="btn btn-danger btn-sm" onClick={() => handleAct(a.level, 'REJECTED')}>Reject</button>
                            <button className="btn btn-success btn-sm" onClick={() => handleAct(a.level, 'APPROVED')}>Approve</button>
                          </div>
                        </div>
                      )}
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

            {selected.payments?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Payment History</div>
                <div className="timeline">
                  {selected.payments.map((p) => (
                    <div className="timeline-item" key={p.id}>
                      {fmtCurrency(p.amount)} via {p.mode || '-'} on {p.payment_date}
                      <div className="t-meta">Ref: {p.reference || '-'}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ marginTop: 24, marginBottom: 24 }}>
              <DocumentManager 
                moduleName="REIA_BILLING"
                contractId={selected.contract_id} 
                title="Invoice Documents & Calculations" 
              />
            </div>

            <div className="form-actions" style={{ flexWrap: 'wrap' }}>
              {!isCancelled && ['SELLER_L1', 'BUYER_L1'].includes(user?.role) && selected.status === 'DRAFT' && (
                <button className="btn btn-secondary" onClick={handleSubmitL2}>Submit to L2 (Checker)</button>
              )}
              {!isCancelled && ['SELLER_L2', 'SELLER_L3', 'BUYER_L2', 'BUYER_L3'].includes(user?.role) && selected.status === 'PENDING_L2' && (
                <button className="btn btn-primary" onClick={handleApproveL2}>Approve & Submit to SJVN</button>
              )}
              {!isCancelled && CAN_WRITE.includes(user?.role) && ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(selected.status) && (
                <button className="btn btn-secondary" onClick={handleSubmitForApproval}>Submit for SJVN Approval</button>
              )}
              {!isCancelled && CAN_WRITE.includes(user?.role) && ['APPROVED', 'SENT'].includes(selected.status) && (
                <button className="btn btn-primary" onClick={handleSend}>
                  {selected.status === 'SENT'
                    ? (selected.direction === 'SJVN_TO_BUYER' ? 'Resend Email to Buyer' : 'Resend Email to Seller')
                    : (selected.direction === 'SJVN_TO_BUYER' ? 'Send Email to Buyer' : 'Send Email to Seller')}
                </button>
              )}
              {!isCancelled && CAN_WRITE.includes(user?.role) && selected.direction === 'SELLER_TO_SJVN' && (
                <button className="btn btn-secondary" onClick={handleValidate}>Validate vs System</button>
              )}
              {!isCancelled && CAN_WRITE.includes(user?.role) && selected.direction === 'SELLER_TO_SJVN'
                && ['MISMATCH', 'PARTIAL', 'NO_COUNTERPART'].includes(selected.validation_status) && (
                <button className="btn btn-secondary" onClick={() => { setWaiveReason(''); setWaiveError(''); setShowWaive(true); }}>
                  Waive Validation
                </button>
              )}
              {!isCancelled && CAN_WRITE.includes(user?.role) && CANCELABLE.includes(selected.status) && (
                <button className="btn btn-danger" onClick={() => { setCancelReason(''); setCancelError(''); setShowCancel(true); }}>
                  Cancel Invoice
                </button>
              )}
            </div>

            {/* Pay-when-paid: structured release to the generator (developer) */}
            {CAN_RECORD_PAYMENT.includes(user?.role) && selected.direction === 'SELLER_TO_SJVN'
              && ['APPROVED', 'SENT', 'PARTIALLY_PAID'].includes(selected.status) && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Release Payment to Generator (Pay-when-paid)</div>
                {selected.generator_realization && (
                  <div className="callout" style={{ margin: '6px 0 10px', padding: '10px 12px', background: 'var(--navy-soft, #eaf0f9)', borderRadius: 8, fontSize: 13 }}>
                    DISCOM realized: <strong>{fmtCurrency(selected.generator_realization.realized)}</strong>
                    {'  ·  '}Already released from realization: <strong>{fmtCurrency(selected.generator_realization.released_from_realization)}</strong>
                    {'  ·  '}Available: <strong style={{ color: 'var(--green)' }}>{fmtCurrency(selected.generator_realization.available)}</strong>
                    <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>
                      {selected.generator_realization.linked_psa ? `${selected.generator_realization.linked_psa} PSA invoice(s) linked` : 'No PSA invoice mapped — use Own Fund / Security Fund'}
                    </div>
                  </div>
                )}
                {releaseError && <div className="form-error">{releaseError}</div>}
                <form onSubmit={handleRelease}>
                  <div className="form-grid">
                    <Field label="Amount (₹)">
                      <input required type="number" value={releaseForm.amount} onChange={(e) => setReleaseForm({ ...releaseForm, amount: e.target.value })} />
                    </Field>
                    <Field label="Fund Source">
                      <select value={releaseForm.source} onChange={(e) => setReleaseForm({ ...releaseForm, source: e.target.value })}>
                        <option value="DISCOM_REALIZATION">DISCOM Realization</option>
                        <option value="OWN_FUND">SJVN Own Fund</option>
                        <option value="PAYMENT_SECURITY_FUND">Payment Security Fund</option>
                      </select>
                    </Field>
                    <Field label="Payment Date">
                      <input required type="date" value={releaseForm.payment_date} onChange={(e) => setReleaseForm({ ...releaseForm, payment_date: e.target.value })} />
                    </Field>
                    <Field label="Reference">
                      <input value={releaseForm.reference} onChange={(e) => setReleaseForm({ ...releaseForm, reference: e.target.value })} />
                    </Field>
                  </div>
                  <p className="inline-note">DISCOM Realization can only release what the buyer has actually paid; use Own Fund / Security Fund for the balance.</p>
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary">Release to Generator</button>
                  </div>
                </form>
              </>
            )}

            {CAN_RECORD_PAYMENT.includes(user?.role) && selected.direction !== 'SELLER_TO_SJVN' && !['PAID', 'CANCELLED', 'DRAFT'].includes(selected.status) && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>
                  Record Payment (Incoming from Buyer)
                </div>
                <form onSubmit={handlePayment}>
                  <div className="form-grid">
                    <Field label="Amount (₹)">
                      <input required type="number" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
                    </Field>
                    <Field label="Payment Date">
                      <input required type="date" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} />
                    </Field>
                    <Field label="Mode">
                      <select value={payForm.mode} onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })}>
                        {['NEFT', 'RTGS', 'UPI', 'CHEQUE', 'OTHER'].map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </Field>
                    <Field label="Reference">
                      <input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
                    </Field>
                    <Field label="Deduction (₹)">
                      <input type="number" value={payForm.deduction} onChange={(e) => setPayForm({ ...payForm, deduction: e.target.value })} />
                    </Field>
                  </div>
                  <p className="inline-note">Note: Rebate (early payment) and LPS (late payment) will be automatically calculated based on the Payment Date vs Due Date.</p>
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary">Record Payment</button>
                  </div>
                </form>
              </>
            )}

            {/* Pass-through "Other Charges" — transmission / RLDC-SLDC / CTU-STU / open access (rebate-excluded) */}
            {!isCancelled && (
              <>
                <div className="section-title" style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Other / Pass-through Charges</span>
                  {CAN_WRITE.includes(user?.role) && !['PAID'].includes(selected.status) && (
                    <button type="button" className="btn btn-xs btn-outline" onClick={() => (showOC ? setShowOC(false) : openOtherCharges())}>
                      {showOC ? 'Close' : 'Edit Charges'}
                    </button>
                  )}
                </div>
                {(selected.other_charges || []).length > 0 ? (
                  <table className="data-table" style={{ width: '100%', fontSize: 13, marginBottom: 8 }}>
                    <tbody>
                      {selected.other_charges.map((c, i) => (
                        <tr key={i}><td>{c.label}</td><td className="text-right mono">{fmtCurrency(c.amount)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="inline-note" style={{ marginTop: 4 }}>No pass-through charges. (Rebate is never allowed on these.)</p>}

                {showOC && (
                  <>
                    {ocError && <div className="form-error">{ocError}</div>}
                    <form onSubmit={handleSaveOtherCharges}>
                      {ocRows.map((row, i) => (
                        <div className="form-grid" key={i} style={{ alignItems: 'end' }}>
                          <Field label="Type">
                            <select value={row.type} onChange={(e) => setOcRows(ocRows.map((r, j) => j === i ? { ...r, type: e.target.value } : r))}>
                              {Object.entries(OC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </Field>
                          <Field label="Amount (₹)">
                            <input type="number" step="0.01" value={row.amount} onChange={(e) => setOcRows(ocRows.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))} />
                          </Field>
                          <button type="button" className="btn btn-xs btn-ghost" onClick={() => setOcRows(ocRows.filter((_, j) => j !== i))}>Remove</button>
                        </div>
                      ))}
                      <button type="button" className="btn btn-xs btn-outline" style={{ marginTop: 6 }} onClick={() => setOcRows([...ocRows, { type: 'TRANSMISSION', amount: '' }])}>+ Add charge</button>
                      <p className="inline-note">These pass-through charges add to the bill total and are excluded from early-payment rebate.</p>
                      <div className="form-actions">
                        <button type="submit" className="btn btn-primary">Save Charges</button>
                      </div>
                    </form>
                  </>
                )}
              </>
            )}

            {/* Debit / Credit Notes — final/amended REA adjustments */}
            {!isCancelled && (
              <>
                <div className="section-title" style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Debit / Credit Notes</span>
                  {CAN_WRITE.includes(user?.role) && (
                    <button type="button" className="btn btn-xs btn-outline" onClick={() => { setShowNoteForm((s) => !s); setNoteError(''); }}>
                      {showNoteForm ? 'Close' : '+ Raise Note'}
                    </button>
                  )}
                </div>

                {invoiceNotes.length > 0 ? (
                  <table className="data-table" style={{ width: '100%', fontSize: 13, marginBottom: 8 }}>
                    <tbody>
                      {invoiceNotes.map((n) => (
                        <tr key={n.id} style={{ opacity: n.status === 'CANCELLED' ? 0.5 : 1 }}>
                          <td><strong>{n.note_no}</strong></td>
                          <td><Badge status={n.note_type === 'DEBIT' ? 'PENDING' : 'ACTIVE'} label={n.note_type} /></td>
                          <td>{n.reason_code?.replace(/_/g, ' ')}</td>
                          <td className="text-right mono" style={{ color: n.note_type === 'DEBIT' ? 'var(--red)' : 'var(--green)' }}>
                            {n.note_type === 'DEBIT' ? '+' : '−'}{fmtCurrency(n.amount)}
                          </td>
                          <td>{n.status === 'CANCELLED' ? 'CANCELLED' : (CAN_WRITE.includes(user?.role) && (
                            <button type="button" className="btn btn-xs btn-ghost" onClick={() => handleCancelNote(n.id)}>Cancel</button>
                          ))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="inline-note" style={{ marginTop: 4 }}>No debit/credit notes on this invoice.</p>}

                {showNoteForm && (
                  <>
                    {noteError && <div className="form-error">{noteError}</div>}
                    <form onSubmit={handleRaiseNote}>
                      <div className="form-grid">
                        <Field label="Type">
                          <select value={noteForm.note_type} onChange={(e) => setNoteForm({ ...noteForm, note_type: e.target.value })}>
                            <option value="DEBIT">Debit Note (amount increases)</option>
                            <option value="CREDIT">Credit Note (amount decreases)</option>
                          </select>
                        </Field>
                        <Field label="Amount (₹)">
                          <input required type="number" step="0.01" value={noteForm.amount} onChange={(e) => setNoteForm({ ...noteForm, amount: e.target.value })} />
                        </Field>
                        <Field label="Reason Code">
                          <select value={noteForm.reason_code} onChange={(e) => setNoteForm({ ...noteForm, reason_code: e.target.value })}>
                            {['REVISED_REA', 'CHANGE_IN_LAW', 'TRANSMISSION_CHARGES', 'LPS', 'COMPENSATION_EVENT', 'LIQUIDATED_DAMAGES', 'OTHER'].map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                          </select>
                        </Field>
                        <Field label="Reason / Remarks">
                          <input value={noteForm.reason} onChange={(e) => setNoteForm({ ...noteForm, reason: e.target.value })} />
                        </Field>
                      </div>
                      <p className="inline-note">A Debit Note adds to the invoice's net amount; a Credit Note reduces it. Typically raised on final/amended REA true-up.</p>
                      <div className="form-actions">
                        <button type="submit" className="btn btn-primary">Issue Note</button>
                      </div>
                    </form>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!trailBfr} onClose={() => setTrailBfr(null)} title="Settlement Trail" width={720}>
        {trailBfr && <SettlementTrailPanel bfr={trailBfr} />}
      </Modal>

      <Modal open={!!contractDetail} onClose={() => setContractDetail(null)} title={contractDetail?.contract_no ? `Contract: ${contractDetail.contract_no}` : 'Contract Details'} width={720}>
        {contractLoading && !contractDetail?.contract_no ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>Loading contract details...</div>
        ) : contractDetail && contractDetail.contract_no ? (
          <div>
            <div className="section-title">Contract Overview</div>
            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Contract No</span><span className="detail-value">{contractDetail.contract_no}</span></div>
              <div className="detail-item"><span className="detail-label">Type</span><span className="detail-value"><Badge status={contractDetail.contract_type} /></span></div>
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={contractDetail.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Counterparty</span><span className="detail-value">{contractDetail.seller_name || contractDetail.buyer_name || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Project Type</span><span className="detail-value">{contractDetail.project_type || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Total Capacity</span><span className="detail-value">{fmtNumber(contractDetail.capacity_mw)} MW</span></div>
              <div className="detail-item">
                <span className="detail-label">Commissioned (COD)</span>
                <span className="detail-value">
                  {contractDetail.commissioned_capacity_mw > 0
                    ? <span style={{ color: 'var(--success)', fontWeight: 600 }}>{fmtNumber(contractDetail.commissioned_capacity_mw)} MW{contractDetail.cod_date ? ` (COD: ${contractDetail.cod_date})` : ''}</span>
                    : 'Not yet commissioned'}
                </span>
              </div>
              {contractDetail.billing_cycle && (
                <div className="detail-item"><span className="detail-label">Billing Cycle</span><span className="detail-value">{contractDetail.billing_cycle}</span></div>
              )}
            </div>

            <div className="section-title" style={{ marginTop: 18 }}>Commercial Terms</div>
            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Tariff Type</span><span className="detail-value">{contractDetail.tariff_type || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Tariff / Unit</span><span className="detail-value">₹{contractDetail.tariff_per_unit}</span></div>
              <div className="detail-item"><span className="detail-label">Tenure</span><span className="detail-value">{contractDetail.tenure_start || '?'} to {contractDetail.tenure_end || '?'}</span></div>
              <div className="detail-item"><span className="detail-label">PBG / EMD</span><span className="detail-value">{fmtCurrency(contractDetail.pbg_amount)}{contractDetail.pbg_type ? ` (${contractDetail.pbg_type})` : ''}</span></div>
              <div className="detail-item"><span className="detail-label">Rebate Rule</span><span className="detail-value">{contractDetail.rebate_rule || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">LPS Rule</span><span className="detail-value">{contractDetail.lps_rule || '-'}</span></div>
              {contractDetail.payment_terms && (
                <div className="detail-item"><span className="detail-label">Payment Terms</span><span className="detail-value">{contractDetail.payment_terms}</span></div>
              )}
            </div>

            {contractDetail.status === 'TERMINATED' && (
              <div className="detail-grid mb-0" style={{ marginTop: 12 }}>
                <div className="detail-item"><span className="detail-label">Termination Date</span><span className="detail-value">{contractDetail.termination_date || '-'}</span></div>
                <div className="detail-item"><span className="detail-label">Termination Reason</span><span className="detail-value">{contractDetail.termination_reason || '-'}</span></div>
              </div>
            )}

            {contractDetail.amendments?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Amendments</div>
                <div className="timeline">
                  {contractDetail.amendments.map((a) => (
                    <div className="timeline-item" key={a.id}>
                      v{a.version}: {a.change_summary || a.reason || 'Amendment'}
                      {a.created_at && <div className="t-meta">{a.created_at}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ marginTop: 20, marginBottom: 8 }}>
              <DocumentManager
                moduleName="CONTRACTS"
                contractId={contractDetail.id}
                title="Contract Documents (PPA / PSA, Amendments)"
              />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={showCancel} onClose={() => setShowCancel(false)} title="Cancel Invoice" width={480}>
        {cancelError && <div className="form-error">{cancelError}</div>}
        <p style={{ marginBottom: 12, color: 'var(--text-light)', fontSize: 13 }}>
          Cancels <strong>{selected?.invoice_no}</strong> and blocks further approval/send. Only allowed for draft / submitted / rejected / under-approval invoices with no payments or open disputes.
        </p>
        <form onSubmit={handleCancel}>
          <Field label="Cancel Reason">
            <textarea
              required
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Duplicate bill / wrong period / superseded by final"
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}
            />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setShowCancel(false)}>Back</button>
            <button type="submit" className="btn btn-danger">Confirm Cancel</button>
          </div>
        </form>
      </Modal>

      <Modal open={showWaive} onClose={() => setShowWaive(false)} title="Waive Validation" width={480}>
        {waiveError && <div className="form-error">{waiveError}</div>}
        <p style={{ marginBottom: 12, color: 'var(--text-light)', fontSize: 13 }}>
          Mark seller vs system validation as waived for <strong>{selected?.invoice_no}</strong> despite mismatch/partial result.
        </p>
        <form onSubmit={handleWaive}>
          <Field label="Waive Reason">
            <textarea
              required
              rows={3}
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
              placeholder="e.g. Rounding difference accepted / mapping to provisional OK"
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}
            />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setShowWaive(false)}>Back</button>
            <button type="submit" className="btn btn-primary">Waive</button>
          </div>
        </form>
      </Modal>

      <ValidationCompareModal
        open={showValidation}
        onClose={() => setShowValidation(false)}
        validationResult={validationResult}
        selectedInvoiceNo={selected?.invoice_no}
        perspective="reia"
        canWaive={CAN_WRITE.includes(user?.role)}
        onWaive={() => { setShowValidation(false); setShowWaive(true); }}
      />
    </div>
  );
}
