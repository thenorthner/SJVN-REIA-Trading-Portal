import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, AlertPopup, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import ContractWorkspace from '../../components/ContractWorkspace.jsx';
import ContractBulkLoad from './ContractBulkLoad.jsx';
import { PowerRoutingTree3D, routingPosition } from '../../components/PowerRoutingTree3D.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { paymentTermsText, rebateText, lpsText } from '../../lib/contractRules.js';

// The server's REIA_WRITE group; a shorter copy here hid the buttons from REIA_ADMIN.
const CAN_WRITE = ROLE_GROUPS.REIA_WRITE;

// Must stay in lockstep with backend CONTRACT_TRANSITIONS. A draft is not yet
// signed or regulator-cleared, so ACTIVE is not a legal next hop from DRAFT.
const CONTRACT_TRANSITIONS = {
  DRAFT: ['UNDER_NEGOTIATION', 'SIGNED', 'TERMINATED'],
  UNDER_NEGOTIATION: ['SIGNED', 'DRAFT', 'TERMINATED'],
  SIGNED: ['PENDING_REGULATORY_APPROVAL', 'ACTIVE', 'TERMINATED'],
  PENDING_REGULATORY_APPROVAL: ['ACTIVE', 'SIGNED', 'TERMINATED'],
  ACTIVE: ['AMENDED', 'NEARING_EXPIRY', 'EXPIRED', 'RENEWED', 'TERMINATED', 'CLOSED'],
  AMENDED: ['ACTIVE', 'NEARING_EXPIRY', 'EXPIRED', 'TERMINATED', 'CLOSED'],
  NEARING_EXPIRY: ['EXPIRED', 'RENEWED', 'TERMINATED', 'CLOSED'],
  EXPIRED: ['RENEWED', 'CLOSED'],
  RENEWED: ['ACTIVE', 'NEARING_EXPIRY', 'EXPIRED', 'CLOSED'],
  TERMINATED: ['CLOSED'],
  CLOSED: [],
};

function allowedNextStatuses(current) {
  return CONTRACT_TRANSITIONS[current] || [];
}

function lifecycleHint(current) {
  if (current === 'DRAFT') {
    return 'This contract is still a draft. Mark it SIGNED first (or UNDER_NEGOTIATION), then you can move it to ACTIVE.';
  }
  if (current === 'UNDER_NEGOTIATION') {
    return 'Once terms are agreed, mark it SIGNED. ACTIVE is available after signing.';
  }
  if (current === 'SIGNED') {
    return 'Signed contracts can go ACTIVE directly, or via PENDING_REGULATORY_APPROVAL if a clearance is still outstanding.';
  }
  return '';
}

const EMPTY_FORM = {
  contract_no: '', contract_type: 'PPA', seller_id: '', buyer_id: '', project_type: 'Solar', capacity_mw: '',
  tariff_type: 'FLAT', tariff_per_unit: '', tariff_structure: null, 
  tenure_start: '', tenure_end: '', billing_cycle: 'MONTHLY',
  emd_amount: '', pbg_amount: '', pbg_type: '', pbg_expiry: '', trading_margin_per_mwh: '',
  // Structured billing rules (drive due dates, rebate & LPS calculations)
  payment_terms_days: 30, rebate_pct: '', rebate_days: '', rebate_basis: 'BILL_DATE',
  lps_annual_pct: '', lps_grace_days: 0, payment_security_type: 'LETTER_OF_CREDIT',
  min_cuf_percent: '',
  peak_window_start: '', peak_window_end: '', min_peak_availability_percent: '', peak_penalty_per_mwh: '',
  projects: []
};

function renderTariffStructure(selected) {
  if (!selected) return null;
  let ts = selected.tariff_structure;
  if (!ts && selected.tariff_structure_json) {
    try {
      ts = typeof selected.tariff_structure_json === 'string' ? JSON.parse(selected.tariff_structure_json) : selected.tariff_structure_json;
    } catch (e) {
      ts = null;
    }
  }
  if (!ts || typeof ts !== 'object' || Object.keys(ts).length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
      {Object.entries(ts).map(([k, v]) => {
        let display;
        try {
          display = v != null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
        } catch {
          display = '';
        }
        return (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--slate-100, #f1f5f9)', padding: '2px 8px', borderRadius: 4, fontSize: 13 }}>
            <span style={{ color: 'var(--slate-600, #475569)', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}:</span>
            <span style={{ fontWeight: 600 }}>{display}</span>
          </div>
        );
      })}
    </div>
  );
}

const SECURITY_TYPES = [
  { value: 'LETTER_OF_CREDIT', label: 'Letter of Credit (LC)' },
  { value: 'BANK_GUARANTEE', label: 'Bank Guarantee (BG)' },
  { value: 'CORPUS_FUND', label: 'Corpus Fund' },
  { value: 'PAYMENT_SECURITY_FUND', label: 'Payment Security Fund' },
  { value: 'ESCROW', label: 'Escrow Account' },
  { value: 'NONE', label: 'None' },
];

// Live human-readable preview so the user sees exactly what the rule will do.
function previewRebate(f) {
  if (f.rebate_pct === '' || f.rebate_pct == null || Number(f.rebate_pct) === 0) return 'No early-payment rebate';
  const ref = f.rebate_basis === 'DUE_DATE' ? 'due date' : 'bill date';
  if (!(Number(f.rebate_days) > 0)) return `${f.rebate_pct}% rebate — enter the number of days it is allowed within`;
  return `${f.rebate_pct}% rebate if paid within ${f.rebate_days} days from ${ref}`;
}
function previewLps(f) {
  if (f.lps_annual_pct === '' || f.lps_annual_pct == null || Number(f.lps_annual_pct) === 0) return 'No late-payment surcharge';
  const g = Number(f.lps_grace_days);
  const grace = g > 0 ? ` after a ${g}-day grace period` : (g < 0 ? ' — the grace period cannot be negative' : ', from the day after the due date');
  return `${f.lps_annual_pct}% per annum on the overdue amount${grace}`;
}
function previewTerms(days) {
  const d = Number(days);
  if (days === '' || !Number.isFinite(d) || d < 0) return 'Enter the number of days (0 or more) payment is due in.';
  return `Due date auto-calculates as bill date + ${d} days.`;
}

const TERMINATION_GROUNDS = [
  ['FOR_CAUSE', 'For cause (counterparty default)'],
  ['FOR_CONVENIENCE', 'For convenience'],
  ['MUTUAL_AGREEMENT', 'Mutual agreement'],
  ['FORCE_MAJEURE', 'Force majeure'],
  ['REGULATORY_ORDER', 'Regulatory / CERC order'],
];

/** Problems with the CERC / tariff fields shared by the create and amend forms. */
function termErrors(f, add) {
  const n = (v) => (v === '' || v == null ? null : Number(v));
  const cap = n(f.capacity_mw);
  if (cap != null && cap > 10000) add('Total Capacity (MW)', `${cap} MW is not credible for one contract — check the figure.`);
  const tariff = n(f.tariff_per_unit);
  if (tariff != null && tariff > 20) add('Base Tariff', `₹${tariff}/unit is not credible — check the figure.`);
  if (n(f.trading_margin_per_mwh) != null && n(f.trading_margin_per_mwh) < 0) add('Trading Margin', 'Trading margin cannot be negative.');
  if (n(f.pbg_amount) != null && n(f.pbg_amount) < 0) add('PBG / Security Amount (₹)', 'The amount cannot be negative.');
  if (n(f.lps_grace_days) != null && n(f.lps_grace_days) < 0) add('Late-Payment Surcharge', 'The grace period cannot be negative.');
  if (n(f.rebate_pct) != null && n(f.rebate_days) > 0 && (f.rebate_basis || 'BILL_DATE') === 'BILL_DATE'
      && n(f.payment_terms_days) != null && n(f.rebate_days) > n(f.payment_terms_days)) {
    add('Early-Payment Rebate', `The rebate window (${f.rebate_days} days) is longer than the payment terms (${f.payment_terms_days} days) — an early-payment rebate must fall before the due date.`);
  }
  for (const [k, label] of [['min_cuf_percent', 'Min / Guaranteed CUF (%)'], ['min_peak_availability_percent', 'Min peak availability (%)']]) {
    if (n(f[k]) != null && (n(f[k]) < 0 || n(f[k]) > 100)) add(label, 'Must be between 0% and 100%.');
  }
  if (n(f.min_peak_availability_percent) != null && (!f.peak_window_start || !f.peak_window_end)) add('Peak window from', 'A peak availability obligation needs its peak window (from and to).');
  if (f.peak_window_start && f.peak_window_end && f.peak_window_start === f.peak_window_end) add('Peak window to', 'The peak window cannot start and end at the same time.');
  if (f.tenure_start && f.tenure_end && f.tenure_end > f.tenure_start) {
    const years = (new Date(f.tenure_end) - new Date(f.tenure_start)) / (365.25 * 86400000);
    if (years > 50) add('Tenure End', `A tenure of ${Math.round(years)} years is longer than any PPA/PSA (limit 50).`);
  }
  if (n(f.commissioned_capacity_mw) != null && cap != null && n(f.commissioned_capacity_mw) > cap) add('Commissioned Capacity (MW)', `Commissioned capacity cannot exceed the contracted ${cap} MW.`);
  if (n(f.commissioned_capacity_mw) > 0 && !f.cod_date) add('COD Date', 'A commissioned capacity needs its COD date.');
}

// The instrument behind the performance guarantee.
const PBG_TYPES = ['Bank Guarantee (BG)', 'Letter of Credit (LC)', 'Insurance Surety Bond (ISB)', 'Payment on Order Instrument (POI)'];

const MAX_CONTRACT_PDF_MB = 25;

// ₹2.40, not ₹2.4; ₹2.425 keeps its third decimal.
const fmtTariff = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));

export default function Contracts() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [allContracts, setAllContracts] = useState([]);
  const [allocSubmitting, setAllocSubmitting] = useState(false);
  const [sellers, setSellers] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [filters, setFilters] = useState({ contract_type: '', status: '', project_type: '', q: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [uploadFile, setUploadFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // The one message on screen that has to be read: { tone, title, message, items }.
  const [popup, setPopup] = useState(null);
  const [selected, setSelected] = useState(null);
  // The contract whose working file — milestones, documents, requests, notices — is open, and on which tab.
  const [workFile, setWorkFile] = useState(null);
  // What across all contracts is waiting on SJVN.
  const [pending, setPending] = useState(null);
  // Per contract: the next milestone and what on it needs someone to act.
  const [attention, setAttention] = useState({});
  const loadPending = () => {
    api.contractWorkspace.pending().then(setPending).catch(() => setPending(null));
    api.contractWorkspace.summary().then((list) => setAttention(Object.fromEntries(list.map((a) => [a.contract_id, a])))).catch(() => setAttention({}));
  };
  const loadAllContracts = () => {
    api.contracts.list({}).then((data) => setAllContracts(Array.isArray(data) ? data : [])).catch(() => setAllContracts([]));
  };
  useEffect(() => { loadPending(); loadAllContracts(); }, []);
  const openWorkFile = (contractId, tab) => api.contracts.get(contractId).then((c) => setWorkFile({ contract: c, tab })).catch(() => {});
  const [allocations, setAllocations] = useState([]);
  const [amendForm, setAmendForm] = useState(null);
  const [requirements, setRequirements] = useState([]);
  const [syncMsg, setSyncMsg] = useState('');
  const [statusForm, setStatusForm] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [allocationForm, setAllocationForm] = useState(null);
  // A PPA's complete split from a date: { effective_from, reason, rows: [{ psa_id, allocation_percent }], add_psa_id }.
  const [resplit, setResplit] = useState(null);
  // One submission at a time: a state flag is set too late to stop a fast
  // double-click, which saved the same PPA→PSA share twice.
  const busyRef = useRef(false);
  const once = async (fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try { await fn(); } finally { busyRef.current = false; }
  };
  // The link notifications carry ("View Contract →") opens that contract.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const no = searchParams.get('contract_no');
    if (!no) return;
    api.contracts.list({ q: no }).then((list) => {
      const hit = (Array.isArray(list) ? list : []).filter((c) => c.contract_no === no).sort((a, b) => (b.version || 1) - (a.version || 1))[0];
      if (hit) openDetail(hit);
      else setPopup({ tone: 'warning', title: 'Contract not found', message: `No contract numbered ${no} is on record.` });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function downloadContractPdf() {
    setPdfLoading(true);
    try {
      const params = {};
      if (filters.contract_type) params.contract_type = filters.contract_type;
      if (filters.status) params.status = filters.status;
      if (filters.project_type) params.project_type = filters.project_type;
      if (filters.q) params.q = filters.q;
      await api.reports.contractSummaryPdf(params);
      setPopup({ tone: 'success', title: 'Report downloaded', message: `SJVN_Contract_Portfolio_Report.pdf — ${rows.length} contract${rows.length === 1 ? '' : 's'}, with the filters on screen.` });
    } catch (err) {
      setPopup({ tone: 'error', title: 'The report could not be prepared', message: err.message || 'Failed to download contract PDF' });
    } finally {
      setPdfLoading(false);
    }
  }
  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.contracts.list(params)
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }

  useEffect(load, [filters.contract_type, filters.status, filters.project_type, filters.q]);

  useEffect(() => {
    // Only approved entities
    api.entities.list({ entity_type: 'SELLER', status: 'APPROVED' }).then((d) => setSellers(Array.isArray(d) ? d : [])).catch(() => setSellers([]));
    api.entities.list({ entity_type: 'BUYER', status: 'APPROVED' }).then((d) => setBuyers(Array.isArray(d) ? d : [])).catch(() => setBuyers([]));
  }, []);

  function openDetail(row) {
    api.contracts.get(row.id).then(setSelected).catch(() => setSelected(row));
    api.paymentSecurity.requirements(row.id).then((d) => setRequirements(Array.isArray(d) ? d : [])).catch(() => setRequirements([]));
    // Read from either end: a PPA's PSAs, or a PSA's source PPAs.
    setAllocations([]);
    api.contracts.allocations(row.id).then((d) => setAllocations(Array.isArray(d) ? d : [])).catch(() => setAllocations([]));
    setAllocationForm(null);
    setResplit(null);
    setAmendForm(null);
    setStatusForm(null);
    setSyncMsg('');
  }

  async function syncSecurity() {
    if (!selected) return;
    try {
      const res = await api.paymentSecurity.fromContract(selected.id);
      setRequirements(res.requirements || []);
      setSyncMsg(`Synced — ${res.created?.length || 0} new instrument(s)`);
    } catch (err) {
      setSyncMsg(err.response?.data?.error || 'Sync failed');
    }
  }

  function pickContractFile(file) {
    if (!file) { setUploadFile(null); return; }
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      setUploadFile(null);
      setPopup({ tone: 'error', title: 'The contract has to be a PDF', message: `"${file.name}" is not a PDF. Upload the signed agreement as a PDF file.` });
      return;
    }
    if (file.size > MAX_CONTRACT_PDF_MB * 1024 * 1024) {
      setUploadFile(null);
      setPopup({ tone: 'error', title: 'The file is too large', message: `"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_CONTRACT_PDF_MB} MB.` });
      return;
    }
    setUploadFile(file);
  }

  /** Everything wrong with the create form, each one named. */
  function contractFormErrors() {
    const errors = [];
    const add = (label, message) => errors.push({ label, message });
    if (!form.contract_no.trim()) add('Contract No.', 'Contract number is required.');
    if (form.contract_type === 'PPA' && !form.seller_id) add('Seller', 'Select the seller this PPA is signed with.');
    if (form.contract_type === 'PSA' && !form.buyer_id) add('Buyer', 'Select the buyer this PSA is signed with.');
    if (!(Number(form.capacity_mw) > 0)) add('Total Capacity (MW)', 'Capacity must be greater than zero.');
    if (form.tariff_per_unit === '' || !(Number(form.tariff_per_unit) > 0)) add('Base Tariff', 'Enter the base tariff in ₹/unit — it must be more than ₹0.');
    if (!form.tenure_start) add('Tenure Start', 'Tenure start date is required.');
    if (!form.tenure_end) add('Tenure End', 'Tenure end date is required.');
    if (form.tenure_start && form.tenure_end && form.tenure_end <= form.tenure_start) add('Tenure End', 'Tenure end must be after tenure start.');
    if (form.payment_terms_days === '' || !(Number(form.payment_terms_days) >= 0)) add('Payment Terms', 'Enter the number of days payment is due in.');
    if (form.rebate_pct !== '' && !(Number(form.rebate_days) > 0)) add('Early-Payment Rebate', 'A rebate needs the number of days it is allowed within.');
    if (form.rebate_pct !== '' && Number(form.rebate_pct) > 100) add('Early-Payment Rebate', 'Rebate cannot be more than 100%.');
    if (form.lps_annual_pct !== '' && Number(form.lps_annual_pct) > 100) add('Late-Payment Surcharge', 'LPS cannot be more than 100% per annum.');
    if (form.pbg_amount !== '' && Number(form.pbg_amount) > 0 && !form.pbg_type) add('Security Type', 'Select the instrument the guarantee is given as.');
    termErrors(form, add);
    if (!uploadFile) add('Contract Document (PDF)', 'Upload the contract PDF. A contract cannot be created without its agreement on file.');
    return errors;
  }

  // House rule: a field is checked as soon as the officer leaves it.
  function checkOnBlur(e) {
    const label = e.target.closest('label.field')?.querySelector('.field-label')?.textContent?.replace(/\s*\*.*$/s, '').trim()
      || e.target.closest('.rule-block')?.querySelector('.rule-block-label')?.textContent?.trim();
    if (!label || e.target.value === '' || e.target.type === 'file') return;
    const hits = contractFormErrors().filter((x) => x.label.startsWith(label) || label.startsWith(x.label));
    if (hits.length) setPopup({ tone: 'error', title: `Check ${label}`, items: hits });
  }

  function handleCreate(e) {
    e.preventDefault();
    return once(() => createContract());
  }

  async function createContract() {
    const errors = contractFormErrors();
    if (errors.length) {
      setPopup({
        tone: 'error',
        title: 'The contract cannot be created yet',
        message: errors.length > 1 ? `${errors.length} things need attention.` : undefined,
        items: errors,
      });
      return;
    }

    setSubmitting(true);
    let created = null;
    try {
      created = await api.contracts.create({
        ...form,
        seller_id: form.contract_type === 'PPA' ? form.seller_id : null,
        buyer_id: form.contract_type === 'PSA' ? form.buyer_id : null,
        capacity_mw: Number(form.capacity_mw),
        tariff_per_unit: Number(form.tariff_per_unit),
        emd_amount: form.emd_amount ? Number(form.emd_amount) : null,
        pbg_amount: form.pbg_amount ? Number(form.pbg_amount) : null,
      });
    } catch (err) {
      const data = err.response?.data;
      setPopup({
        tone: 'error', title: 'The contract was not created',
        message: data?.errors?.length > 1 ? `${data.errors.length} things need attention.` : (data?.error || 'Failed to create contract.'),
        items: data?.errors?.length > 1 ? data.errors : undefined,
      });
      setSubmitting(false);
      return;
    }

    // The agreement goes on file with the record. A failed upload used to be
    // logged to the console and nothing else, which is how a contract ended up
    // created with no document behind it.
    let uploadError = null;
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      fd.append('contract_id', created.id);
      fd.append('document_type', 'CONTRACT');
      fd.append('category', 'RECORD');
      fd.append('title', `${form.contract_no} Agreement`);
      await api.documents.upload(fd);
    } catch (err) {
      uploadError = err.response?.data?.error || err.message || 'Upload failed';
    }

    // No contract without its agreement: when the file is refused, the draft
    // created a moment ago is discarded and the form stays open to try again.
    if (uploadError) {
      const discarded = await api.contracts.discardDraft(created.id).then(() => true).catch(() => false);
      setSubmitting(false);
      load();
      loadAllContracts();
      setPopup(discarded
        ? { tone: 'error', title: 'The agreement PDF was refused — nothing was saved', message: `${uploadError} Choose the signed agreement again and resubmit; the form is as you left it.` }
        : { tone: 'warning', title: 'Contract saved as a draft — but the PDF did not upload', message: `${created.contract_no} was created, but its agreement could not be stored (${uploadError}). Upload it from the working file → Documents before signing.` });
      if (discarded) { setUploadFile(null); return; }
    }

    setShowCreate(false);
    setForm(EMPTY_FORM);
    setUploadFile(null);
    setSubmitting(false);
    load();
    loadAllContracts();
    if (!uploadError) setPopup({ tone: 'success', title: 'Draft contract created', message: `${created.contract_no} is saved as a DRAFT with its agreement on file.` });
  }

  const refreshDetail = (c) => {
    setSelected(c);
    api.contracts.allocations(c.id).then((d) => setAllocations(Array.isArray(d) ? d : [])).catch(() => setAllocations([]));
  };
  const fieldErrorPopup = (title, data, fallback) => setPopup({
    tone: 'error', title,
    message: data?.errors?.length > 1 ? `${data.errors.length} things need attention.` : (data?.error || fallback),
    items: data?.errors?.length > 1 ? data.errors : undefined,
  });

  function handleAmend(e) {
    e.preventDefault();
    const isDraft = ['DRAFT', 'UNDER_NEGOTIATION'].includes(selected.status);
    const problems = [];
    termErrors(amendForm, (label, message) => problems.push({ label, message }));
    if (!isDraft && !amendForm.effective_from) problems.push({ label: 'Effective From', message: 'Give the date the amendment takes effect from.' });
    if (!String(amendForm.amendment_reason || '').trim()) problems.push({ label: 'Amendment Reason / Reference', message: isDraft ? 'Say what is being corrected and why.' : 'Give the reason or reference (e.g. the CERC order).' });
    if (problems.length) { setPopup({ tone: 'error', title: isDraft ? 'The draft cannot be saved yet' : 'The amendment cannot be submitted yet', items: problems }); return undefined; }
    return once(async () => {
      setSubmitting(true);
      try {
        const updated = await api.contracts.amend(selected.id, amendForm);
        refreshDetail(updated);
        setAmendForm(null);
        load();
        loadAllContracts();
        setPopup(updated.edited_in_place
          ? { tone: 'success', title: 'Draft updated', message: `${updated.contract_no} — ${Object.keys(updated.changed || {}).length} term(s) corrected. It is still a ${updated.status.replace(/_/g, ' ')}.` }
          : { tone: 'success', title: `Version ${updated.version} submitted`, message: `${updated.contract_no} v${updated.version} is PENDING REGULATORY APPROVAL. Version ${updated.version - 1} stays in force until v${updated.version} is made ACTIVE; the change applies from ${updated.amendment_effective_from}.` });
      } catch (err) {
        fieldErrorPopup(isDraft ? 'The draft was not saved' : 'The amendment was not saved', err.response?.data, 'Failed to amend contract.');
      } finally {
        setSubmitting(false);
      }
    });
  }
  
  async function submitStatus() {
    setSubmitting(true);
    try {
      const updated = await api.contracts.updateStatus(selected.id, statusForm);
      refreshDetail(updated);
      setStatusForm(null);
      load();
      loadAllContracts();
      loadPending();
      setPopup({ tone: 'success', title: `${updated.contract_no} is now ${updated.status.replace(/_/g, ' ')}`, message: statusForm.remarks ? `Remarks: ${statusForm.remarks}` : undefined });
    } catch (err) {
      const data = err.response?.data;
      if (data?.settlement && data?.outstanding_actions) {
        setStatusForm((f) => ({ ...f, settlement_open: true }));
        setPopup({ tone: 'warning', title: 'Settlement is still open', message: 'Clear these first, or record why the contract is being closed as it stands:', items: data.outstanding_actions.map((a) => (typeof a === 'string' ? a : a.message || a.label || JSON.stringify(a))) });
      } else {
        const allowed = data?.allowed_transitions?.length ? ` Allowed next: ${data.allowed_transitions.join(', ')}.` : '';
        fieldErrorPopup('The stage was not changed', data ? { ...data, error: (data.error || '') + allowed } : null, 'Failed to update contract status.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleStatusChange(e) {
    e.preventDefault();
    const s = statusForm.status;
    if (s === 'TERMINATED') {
      const problems = [];
      if (!statusForm.termination_date) problems.push('Give the termination date.');
      else if (selected.tenure_start && statusForm.termination_date < selected.tenure_start) problems.push(`The termination date is before the contract begins (${selected.tenure_start}).`);
      else if (selected.tenure_end && statusForm.termination_date > selected.tenure_end) problems.push(`The termination date is after the contract ends anyway (${selected.tenure_end}).`);
      if (!statusForm.termination_ground) problems.push('Choose the ground for termination.');
      if (problems.length) { setPopup({ tone: 'error', title: 'The contract cannot be terminated yet', items: problems }); return; }
    }
    if (s === 'CLOSED' && statusForm.settlement_open && !String(statusForm.settlement_override_reason || '').trim()) {
      setPopup({ tone: 'error', title: 'Give the reason for closing with settlement open' });
      return;
    }
    // Ending a contract cannot be undone, so it is confirmed rather than one click away.
    if (['TERMINATED', 'CLOSED', 'EXPIRED'].includes(s)) {
      setPopup({
        tone: 'warning',
        title: `Move ${selected.contract_no} to ${s}?`,
        message: `This cannot be undone. Its PPA→PSA shares end ${s === 'TERMINATED' ? `on ${statusForm.termination_date}` : 'today'}${s === 'TERMINATED' ? '' : ''}, and it will no longer supply or be supplied.`,
        okLabel: 'Go back',
        actions: <button type="button" className="btn btn-danger" onClick={() => { setPopup(null); once(submitStatus); }}>Yes, move to {s}</button>,
      });
      return;
    }
    once(submitStatus);
  }

  // The link is the same row whichever contract it is made from: a PPA picks
  // the PSA it supplies, a PSA picks the PPA it draws from.
  function handleAddAllocation(e) {
    e.preventDefault();
    const fromPsa = selected.contract_type === 'PSA';
    const problems = [];
    if (!(fromPsa ? allocationForm.ppa_id : allocationForm.psa_id)) problems.push(fromPsa ? 'Select the source PPA.' : 'Select the PSA to supply.');
    const pct = Number(allocationForm.allocation_percent);
    if (!(pct > 0 && pct <= 100)) problems.push('The share must be more than 0% and at most 100%.');
    if (!allocationForm.effective_from) problems.push('Give the date the share starts from.');
    if (allocationForm.need_reason && !String(allocationForm.negative_spread_reason || '').trim()) problems.push('Record why this PSA may sell below the PPA tariff.');
    if (problems.length) { setPopup({ tone: 'error', title: 'The mapping cannot be saved yet', items: problems }); return undefined; }
    return once(async () => {
      setAllocSubmitting(true);
      const ppaId = fromPsa ? allocationForm.ppa_id : selected.id;
      const psaId = fromPsa ? selected.id : allocationForm.psa_id;
      try {
        const res = await api.contracts.addAllocation(ppaId, {
          psa_id: psaId,
          allocation_percent: allocationForm.allocation_percent,
          effective_from: allocationForm.effective_from,
          negative_spread_reason: allocationForm.negative_spread_reason || undefined,
        });
        setAllocationForm(null);
        api.contracts.allocations(selected.id).then(setAllocations);
        setPopup({ tone: 'success', title: 'Share mapped', message: `${pct}% (${res.share_mw} MW) from ${res.effective_from}. Spread ${res.spread_per_unit < 0 ? '−' : '+'}₹${Math.abs(Number(res.spread_per_unit)).toFixed(2)}/unit${res.spread_per_unit < 0 ? ' (a loss, on the recorded reason)' : ''}.` });
      } catch (err) {
        const data = err.response?.data;
        if (data?.code === 'NEGATIVE_SPREAD') {
          setAllocationForm((f) => ({ ...f, need_reason: true, spread_message: data.error }));
        } else {
          setPopup({ tone: 'error', title: 'The mapping was not saved', message: data?.error || 'Failed to map allocation' });
        }
      } finally {
        setAllocSubmitting(false);
      }
    });
  }

  /** The PSA a re-split row names, from the PPA's shares or the contract list. */
  function psaInfo(psaId) {
    const a = allocations.find((x) => x.psa_id === psaId);
    if (a) return { contract_no: a.psa_no, buyer_name: a.buyer_name, capacity_mw: Number(a.psa_capacity_mw), tariff: Number(a.psa_tariff) };
    const c = (allContracts.length ? allContracts : rows).find((x) => x.id === psaId);
    return c ? { contract_no: c.contract_no, buyer_name: c.buyer_name, capacity_mw: Number(c.capacity_mw), tariff: Number(c.tariff_per_unit) } : { contract_no: psaId };
  }

  /** Shares of this PPA in force on a day. */
  const sharesOn = (day) => allocations.filter((a) => a.effective_from <= day && (!a.effective_to || a.effective_to >= day));

  function openResplit() {
    const next = new Date(); next.setDate(1); next.setMonth(next.getMonth() + 1);
    const firstOfNext = next.toISOString().slice(0, 10);
    // Start from the latest split on record, so a change already scheduled is
    // the one edited rather than silently replaced.
    const start = [firstOfNext, selected.tenure_start, ...allocations.filter((a) => !a.effective_to).map((a) => a.effective_from)].filter(Boolean).sort().pop();
    setAllocationForm(null);
    setResplit({
      effective_from: start,
      reason: '',
      add_psa_id: '',
      rows: sharesOn(start).map((a) => ({ psa_id: a.psa_id, allocation_percent: String(a.allocation_percent) })),
    });
  }

  function resplitProblems(r) {
    const problems = [];
    if (!r.effective_from) problems.push('Give the date the new split takes effect from.');
    else if (selected.tenure_end && r.effective_from > selected.tenure_end) problems.push(`The PPA ends on ${selected.tenure_end}.`);
    if (!r.reason.trim()) problems.push('Give the reason for the change (e.g. the buyer exit notice or the order behind it).');
    let total = 0;
    for (const row of r.rows) {
      const info = psaInfo(row.psa_id);
      const pct = Number(row.allocation_percent);
      if (!(pct > 0 && pct <= 100)) { problems.push(`${info.contract_no}: the share must be more than 0% and at most 100% — use "End share" to drop it.`); continue; }
      total += pct;
      const mw = Math.round(pct * Number(selected.capacity_mw)) / 100;
      if (info.capacity_mw && mw > info.capacity_mw + 1e-6) problems.push(`${info.contract_no}: ${pct}% is ${mw} MW, but it contracts for only ${info.capacity_mw} MW.`);
    }
    if (Math.round(total * 100) / 100 > 100) problems.push(`The new split comes to ${Math.round(total * 100) / 100}% — a PPA cannot be allocated beyond 100%.`);
    return problems;
  }

  function handleResplit(e) {
    e.preventDefault();
    const problems = resplitProblems(resplit);
    if (problems.length) { setPopup({ tone: 'error', title: 'The new split cannot be saved yet', items: problems }); return; }
    const dayBefore = new Date(`${resplit.effective_from}T00:00:00Z`); dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const endOn = dayBefore.toISOString().slice(0, 10);
    const ending = sharesOn(endOn).filter((a) => !resplit.rows.some((r) => r.psa_id === a.psa_id));
    const replaced = [...new Set(allocations.filter((a) => a.effective_from > resplit.effective_from).map((a) => a.effective_from))];
    const summary = [
      ...replaced.map((d) => `The split scheduled from ${d} is replaced by this one`),
      ...resplit.rows.map((r) => `${psaInfo(r.psa_id).contract_no}: ${r.allocation_percent}% from ${resplit.effective_from}`),
      ...ending.map((a) => `${a.psa_no}: share ends on ${endOn}`),
    ];
    const submit = () => once(async () => {
      setAllocSubmitting(true);
      try {
        const res = await api.contracts.reviseAllocations(selected.id, {
          effective_from: resplit.effective_from,
          reason: resplit.reason.trim(),
          allocations: resplit.rows.map((r) => ({ psa_id: r.psa_id, allocation_percent: Number(r.allocation_percent) })),
        });
        setResplit(null);
        api.contracts.allocations(selected.id).then((d) => setAllocations(Array.isArray(d) ? d : []));
        setPopup({
          tone: 'success', title: `New split from ${res.effective_from}`,
          message: `The previous shares close on ${res.previous_allocations_closed_on}. Total now ${res.total_percent}%.`,
          items: [...res.allocations.map((a) => `${a.psa_no}: ${a.allocation_percent}% (${a.share_mw} MW)`), ...(res.ended_psa_nos || []).map((n) => `${n}: share ended`)],
          okLabel: 'OK',
        });
      } catch (err) {
        const data = err.response?.data;
        if (data?.earliest_effective_from) setResplit((r) => ({ ...r, effective_from: data.earliest_effective_from }));
        setPopup({ tone: 'error', title: 'The new split was not saved', message: data?.error || 'Failed to change the split.' });
      } finally {
        setAllocSubmitting(false);
      }
    });
    setPopup({
      tone: 'warning',
      title: `Change ${selected.contract_no}'s split from ${resplit.effective_from}?`,
      message: 'Months before this date keep the split they were billed on.',
      items: summary,
      okLabel: 'Go back',
      actions: <button type="button" className="btn btn-primary" onClick={() => { setPopup(null); submit(); }}>Save new split</button>,
    });
  }

  function handleRemoveAllocation(allocId) {
    const a = allocations.find((x) => x.id === allocId);
    setPopup({
      tone: 'warning',
      title: 'Remove this share?',
      message: a ? `${a.allocation_percent}% of ${a.ppa_no} to ${a.psa_no}, from ${a.effective_from}. Use this only to correct a wrong entry — a share that has been billed cannot be removed.` : 'Remove this share?',
      okLabel: 'Keep it',
      actions: (
        <button type="button" className="btn btn-danger" onClick={() => {
          setPopup(null);
          once(async () => {
            try {
              await api.contracts.deleteAllocation(selected.id, allocId);
              api.contracts.allocations(selected.id).then(setAllocations);
              setPopup({ tone: 'success', title: 'Share removed' });
            } catch (err) {
              setPopup({ tone: 'error', title: 'The share could not be removed', message: err.response?.data?.error || 'Failed to remove allocation' });
            }
          });
        }}>Remove share</button>
      ),
    });
  }

  const columns = [
    { key: 'contract_no', header: 'Contract No.', render: (r) => (
      <span>{r.contract_no}{r.version > 1 && ' '}{r.version > 1 && <span style={{ marginLeft: 2, fontSize: 12.5, fontWeight: 700, color: 'var(--slate-500)' }}>v{r.version}</span>}</span>
    ) },
    { key: 'contract_type', header: 'Type', render: (r) => <Badge status={r.contract_type} /> },
    { key: 'party', header: 'Counterparty', render: (r) => r.seller_name || r.buyer_name || '-' },
    { key: 'capacity_mw', header: 'Capacity', render: (r) => (
      <div>
        <div style={{fontWeight: 600}}>{fmtNumber(r.capacity_mw)} MW</div>
        {r.contract_type === 'PPA' && r.commissioned_capacity_mw > 0 && r.cod_date && <div style={{fontSize: 13, color:'#22c55e'}}>{fmtNumber(r.commissioned_capacity_mw)} MW COD</div>}
      </div>
    )},
    { key: 'tariff', header: 'Tariff', render: (r) => (
      <div>
        <div>₹{fmtTariff(r.tariff_per_unit)}/u</div>
        <div style={{fontSize: 13, color:'#666'}}>{r.tariff_type}</div>
      </div>
    )},
    {
      key: 'next', header: 'Next milestone', render: (r) => {
        const n = attention[r.id]?.next_milestone;
        if (!n) return <span style={{ color: 'var(--slate-500)' }}>—</span>;
        return <span>{n.label.replace(/\s*\(.*\)$/, '')}{n.due_date ? <div style={{ fontSize: 13.5, color: n.status === 'DELAYED' ? '#b91c1c' : 'var(--slate-500)' }}>{n.due_date}</div> : null}</span>;
      },
    },
    {
      key: 'attention', header: 'Needs attention', render: (r) => {
        const a = attention[r.id];
        const n = (k, one) => `${k} ${one}${k === 1 ? '' : 's'}`;
        const flags = a ? [
          a.notices_awaiting_me > 0 && ['red', `${n(a.notices_awaiting_me, 'notice')} to acknowledge`, 'NOTICES'],
          a.milestones_delayed > 0 && ['red', `${n(a.milestones_delayed, 'milestone')} delayed`, 'MILESTONES'],
          a.pbg_state === 'EXPIRED' && ['red', 'PBG expired', 'GUARANTEE'],
          a.requests_pending > 0 && ['amber', `${n(a.requests_pending, 'request')} to decide`, 'REQUESTS'],
          a.milestones_to_confirm > 0 && ['amber', `${n(a.milestones_to_confirm, 'milestone')} to confirm`, 'MILESTONES'],
          a.pbg_state === 'EXPIRING' && ['amber', `PBG expires in ${n(a.pbg_days_to_expiry, 'day')}`, 'GUARANTEE'],
        ].filter(Boolean) : [];
        return flags.length
          ? flags.map(([tone, text, tab]) => <button key={text} type="button" className={`cw-flag ${tone}`} style={{ border: 'none', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); openWorkFile(r.id, tab); }}>{text}</button>)
          : <span style={{ color: 'var(--slate-500)' }}>—</span>;
      },
    },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    {
      key: 'file', header: '', render: (r) => (
        <button type="button" className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); openWorkFile(r.id, 'OVERVIEW'); }}>Working file</button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Contract Management (PPA / PSA)"
        subtitle="Create, amend and track Contract Lifecycle, COD and Complex Tariffs"
        actions={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={pdfLoading} onClick={downloadContractPdf}>
              {pdfLoading ? 'Preparing PDF…' : 'Download PDF Report'}
            </button>
            {CAN_WRITE.includes(user?.role) && (
              <>
                <button className="btn btn-secondary" onClick={() => setShowBulk(true)}>Load from Spreadsheet</button>
                <button className="btn btn-secondary" onClick={() => setShowCreate(true)}>+ New Contract</button>
              </>
            )}
          </div>
        }
      />

      {pending && (pending.requests.length + pending.notices.length + pending.milestones_to_confirm.length + pending.milestones_delayed.length) > 0 && (
        <Card title="Waiting on SJVN" style={{ marginBottom: 16 }}>
          {[
            ...pending.requests.map((r) => ({ key: `r${r.id}`, tone: 'amber', flag: 'Request to decide', text: r.subject, tab: 'REQUESTS', ...r })),
            ...pending.notices.map((n) => ({ key: `n${n.id}`, tone: 'red', flag: 'Notice to acknowledge', text: `${n.notice_no} — ${n.subject}`, tab: 'NOTICES', ...n })),
            ...pending.milestones_to_confirm.map((m) => ({ key: `c${m.id}`, tone: 'amber', flag: 'Milestone to confirm', text: `${m.label} — reported for ${m.reported_date}`, tab: 'MILESTONES', ...m })),
            ...pending.milestones_delayed.map((m) => ({ key: `d${m.id}`, tone: 'red', flag: `Milestone ${m.delay_days} day(s) late`, text: `${m.label} — was due ${m.due_date}`, tab: 'MILESTONES', ...m })),
          ].map((x) => (
            <div key={x.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--slate-100)', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13.5, minWidth: 0 }}>
                <span className={`cw-flag ${x.tone}`}>{x.flag}</span>
                <strong>{x.contract_no}</strong>{x.counterparty ? ` · ${x.counterparty}` : ''} — {x.text}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => openWorkFile(x.contract_id, x.tab)}>Open</button>
            </div>
          ))}
        </Card>
      )}

      <div className="filters-bar">
        <input type="search" placeholder="Search contract no. or counterparty…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select value={filters.contract_type} onChange={(e) => setFilters({ ...filters, contract_type: e.target.value })}>
          <option value="">All types</option>
          <option value="PPA">PPA</option>
          <option value="PSA">PSA</option>
        </select>
        <select value={filters.project_type} onChange={(e) => setFilters({ ...filters, project_type: e.target.value })}>
          <option value="">All project types</option>
          {['Solar', 'Wind', 'Hybrid', 'FDRE', 'PeakPower', 'Hydro', 'PSP', 'Storage'].map((pt) => <option key={pt} value={pt}>{pt}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['DRAFT', 'UNDER_NEGOTIATION', 'SIGNED', 'PENDING_REGULATORY_APPROVAL', 'ACTIVE', 'AMENDED', 'NEARING_EXPIRY', 'EXPIRED', 'RENEWED', 'TERMINATED', 'CLOSED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No contracts found.'} />
      </Card>

      <ContractBulkLoad
        open={showBulk}
        onClose={() => setShowBulk(false)}
        onLoaded={load}
      />

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create New Contract" width={900}>
        <form onSubmit={handleCreate} onBlur={checkOnBlur} noValidate>
          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>1. Basic Details</h4>
            <div className="form-grid">
              <Field label="Contract No."><input required value={form.contract_no} onChange={(e) => setForm({ ...form, contract_no: e.target.value })} /></Field>
              <Field label="Contract Type">
                <select value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })}>
                  <option value="PPA">PPA (Seller → SJVN)</option>
                  <option value="PSA">PSA (SJVN → Buyer)</option>
                </select>
              </Field>
              {form.contract_type === 'PPA' ? (
                <Field label="Seller">
                  <select required value={form.seller_id} onChange={(e) => setForm({ ...form, seller_id: e.target.value })}>
                    <option value="">Select seller...</option>
                    {sellers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.parent_name ? 'SPV' : 'Parent'})</option>)}
                  </select>
                </Field>
              ) : (
                <Field label="Buyer">
                  <select required value={form.buyer_id} onChange={(e) => setForm({ ...form, buyer_id: e.target.value })}>
                    <option value="">Select buyer...</option>
                    {buyers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Project Type">
                <select value={form.project_type} onChange={(e) => setForm({ ...form, project_type: e.target.value })}>
                  <option value="Solar">Solar</option>
                  <option value="Wind">Wind</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="FDRE">FDRE</option>
                  <option value="PeakPower">Peak Power</option>
                  <option value="Hydro">Hydro</option>
                  <option value="PSP">Pumped Storage (PSP)</option>
                  <option value="Storage">BESS / Storage</option>
                </select>
              </Field>
            </div>
          </div>

          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>2. Capacity & Tariff Structure</h4>
            <div className="form-grid">
              <Field label="Total Capacity (MW)"><input required type="number" step="0.01" value={form.capacity_mw} onChange={(e) => setForm({ ...form, capacity_mw: e.target.value })} /></Field>
              <Field label="Tariff Type">
                <select value={form.tariff_type} onChange={(e) => setForm({ ...form, tariff_type: e.target.value })}>
                  <option value="FLAT">Flat / Fixed</option>
                  <option value="TWO_PART">Two-Part (Fixed + Variable)</option>
                  <option value="ESCALATING">Escalating / Indexed</option>
                  <option value="SLAB">Time of Day / Slab</option>
                </select>
              </Field>
              <Field label="Base Tariff (₹/unit)"><input required type="number" step="0.01" value={form.tariff_per_unit} onChange={(e) => setForm({ ...form, tariff_per_unit: e.target.value })} /></Field>
              {form.contract_type === 'PSA' && (
                <Field label="Trading Margin (₹/MWh) — optional">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Blank = global default (₹70/MWh)"
                    value={form.trading_margin_per_mwh}
                    onChange={(e) => setForm({ ...form, trading_margin_per_mwh: e.target.value })}
                  />
                </Field>
              )}
              <Field label="Billing Cycle">
                <select value={form.billing_cycle} onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })}>
                  <option value="MONTHLY">Monthly</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="DAILY">Daily</option>
                </select>
              </Field>
            </div>
          </div>

          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>3. Tenure & Payment Security</h4>
            <div className="form-grid">
              <Field label="Tenure Start"><input required type="date" value={form.tenure_start} onChange={(e) => setForm({ ...form, tenure_start: e.target.value })} /></Field>
              <Field label="Tenure End"><input required type="date" value={form.tenure_end} onChange={(e) => setForm({ ...form, tenure_end: e.target.value })} /></Field>
              <Field label="PBG / Security Amount (₹)"><input type="number" value={form.pbg_amount} onChange={(e) => setForm({ ...form, pbg_amount: e.target.value })} /></Field>
              <Field label="Security Type">
                <select value={form.pbg_type} onChange={(e) => setForm({ ...form, pbg_type: e.target.value })}>
                  <option value="">Select instrument…</option>
                  {PBG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </div>
          </div>
          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>4. Billing &amp; Regulatory Rules (CERC)</h4>

            {/* Payment terms → drives the invoice due date */}
            <div className="rule-block">
              <div className="rule-block-label">Payment Terms</div>
              <div className="rule-inline">
                <span>Payment is due</span>
                <input type="number" min="0" className="rule-num" required value={form.payment_terms_days}
                  onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} />
                <span>days from the bill date.</span>
              </div>
              <div className="rule-preview">{previewTerms(form.payment_terms_days)}</div>
            </div>

            {/* Early-payment rebate */}
            <div className="rule-block">
              <div className="rule-block-label">Early-Payment Rebate</div>
              <div className="rule-inline">
                <input type="number" step="0.01" min="0" className="rule-num" placeholder="2" value={form.rebate_pct}
                  onChange={(e) => setForm({ ...form, rebate_pct: e.target.value })} />
                <span>% rebate if paid within</span>
                <input type="number" min="0" className="rule-num" placeholder="5" value={form.rebate_days}
                  onChange={(e) => setForm({ ...form, rebate_days: e.target.value })} />
                <span>days from</span>
                <select className="rule-select" value={form.rebate_basis}
                  onChange={(e) => setForm({ ...form, rebate_basis: e.target.value })}>
                  <option value="BILL_DATE">bill date</option>
                  <option value="DUE_DATE">due date</option>
                </select>
              </div>
              <div className="rule-preview">{previewRebate(form)}</div>
            </div>

            {/* Late-payment surcharge */}
            <div className="rule-block">
              <div className="rule-block-label">Late-Payment Surcharge (LPS)</div>
              <div className="rule-inline">
                <input type="number" step="0.01" min="0" className="rule-num" placeholder="15" value={form.lps_annual_pct}
                  onChange={(e) => setForm({ ...form, lps_annual_pct: e.target.value })} />
                <span>% per annum, charged after a grace of</span>
                <input type="number" min="0" className="rule-num" placeholder="0" value={form.lps_grace_days}
                  onChange={(e) => setForm({ ...form, lps_grace_days: e.target.value })} />
                <span>days past due.</span>
              </div>
              <div className="rule-preview">{previewLps(form)}</div>
            </div>

            {/* Payment security mechanism */}
            <div className="rule-block" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
              <div className="rule-block-label">Payment Security Mechanism</div>
              <select className="rule-select" style={{ minWidth: 260 }} value={form.payment_security_type}
                onChange={(e) => setForm({ ...form, payment_security_type: e.target.value })}>
                {SECURITY_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {['Hydro', 'PSP'].includes(form.project_type) && (
          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#0369a1' }}>4b. Hydro-Specific Parameters (CERC)</h4>
            <div className="form-grid">
              <Field label="Annual Fixed Charges AFC (₹)">
                <input type="number" step="1" placeholder="e.g. 14615741000" value={form.annual_afc || ''} onChange={(e) => setForm({ ...form, annual_afc: e.target.value })} />
              </Field>
              <Field label="Annual Design Energy DE (MWh)">
                <input type="number" step="0.001" placeholder="e.g. 6612000" value={form.annual_design_energy_mwh || ''} onChange={(e) => setForm({ ...form, annual_design_energy_mwh: e.target.value })} />
              </Field>
              <Field label="NAPAF (%)">
                <input type="number" step="0.01" placeholder="e.g. 87" value={form.napaf_percent || ''} onChange={(e) => setForm({ ...form, napaf_percent: e.target.value })} />
              </Field>
              <Field label="Normative Auxiliary Consumption (%)"><input type="number" step="0.01" placeholder="e.g. 1.2" value={form.normative_aux || ''} onChange={(e) => setForm({ ...form, normative_aux: e.target.value })} /></Field>
              <Field label="Free Energy to Home State (%)"><input type="number" step="0.01" placeholder="e.g. 12" value={form.free_energy_home_state || ''} onChange={(e) => setForm({ ...form, free_energy_home_state: e.target.value })} /></Field>
              <Field label="Legacy Monthly Capacity (₹ AFC/12) — optional fallback">
                <input type="number" step="1" placeholder="only if AFC blank" value={form.capacity_charges_total || ''} onChange={(e) => setForm({ ...form, capacity_charges_total: e.target.value })} />
              </Field>
              <Field label="Transmission / Wheeling (₹/MWh)">
                <input type="number" step="0.01" placeholder="Blank = master default" value={form.transmission_charge_per_mwh || ''} onChange={(e) => setForm({ ...form, transmission_charge_per_mwh: e.target.value })} />
              </Field>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--slate-500)', margin: '8px 0 0' }}>
              Capacity = AFC × 0.5 × days/year × (PAFM/NAPAF). ECR from AFC &amp; DE. PAFM comes from energy data availability %. β incentive = (3% × β × 0.5 × AFC)/12.
            </p>
          </div>
          )}

          {['Solar', 'Wind', 'Hybrid', 'FDRE'].includes(form.project_type) && (
          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#0369a1' }}>4b. CUF Performance Threshold</h4>
            <div className="form-grid">
              <Field label="Min / Guaranteed CUF (%)">
                <input type="number" step="0.01" min="0" max="100" placeholder="Blank = master default (Solar 22 / Wind 30 / Hybrid 25)" value={form.min_cuf_percent || ''} onChange={(e) => setForm({ ...form, min_cuf_percent: e.target.value })} />
              </Field>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--slate-500)', margin: '8px 0 0' }}>
              If actual CUF (from energy data) is below this threshold, invoice generate applies a shortfall penalty = shortfall MWh × tariff (or master ₹/MWh rate).
            </p>
            <h4 style={{ margin: '16px 0 12px 0', color: '#0369a1' }}>4c. Peak Availability Obligation</h4>
            <div className="form-grid">
              <Field label="Peak window from">
                <input type="time" value={form.peak_window_start || ''} onChange={(e) => setForm({ ...form, peak_window_start: e.target.value })} />
              </Field>
              <Field label="Peak window to">
                <input type="time" value={form.peak_window_end || ''} onChange={(e) => setForm({ ...form, peak_window_end: e.target.value })} />
              </Field>
              <Field label="Min peak availability (%)">
                <input type="number" step="0.01" min="0" max="100" placeholder="Blank = no peak obligation" value={form.min_peak_availability_percent || ''} onChange={(e) => setForm({ ...form, min_peak_availability_percent: e.target.value })} />
              </Field>
              <Field label="Peak shortfall penalty (₹/MWh)">
                <input type="number" step="0.01" min="0" placeholder="Blank = master rate, else tariff" value={form.peak_penalty_per_mwh || ''} onChange={(e) => setForm({ ...form, peak_penalty_per_mwh: e.target.value })} />
              </Field>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--slate-500)', margin: '8px 0 0' }}>
              A peak-power or FDRE PSA buys energy when the system needs it. Leave the minimum blank and this contract
              carries no peak obligation — nothing is charged on it. With one set, a month whose reported peak-window
              availability falls short is billed shortfall % × capacity × peak hours × rate.
            </p>
          </div>
          )}

          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>5. Contract Document</h4>
            <div className="form-grid">
              <Field label="Contract Agreement (PDF)" required>
                <input type="file" accept="application/pdf,.pdf" onChange={(e) => pickContractFile(e.target.files[0])} />
              </Field>
            </div>
            <p style={{ fontSize: 13.5, color: uploadFile ? '#15803d' : 'var(--slate-500)', margin: '4px 0 0' }}>
              {uploadFile
                ? `Selected: ${uploadFile.name} (${(uploadFile.size / 1048576).toFixed(2)} MB)`
                : 'Mandatory. A contract cannot be created — or later marked SIGNED / ACTIVE — without its agreement PDF on file.'}
            </p>
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create Draft Contract'}</button>
          </div>
        </form>
      </Modal>

      {workFile && (
        <Modal open={true} onClose={() => setWorkFile(null)} title={`Working file: ${workFile.contract.contract_no}`} width={1060}>
          <ContractWorkspace key={workFile.contract.id} contract={workFile.contract} startTab={workFile.tab || 'MILESTONES'} onChanged={loadPending} />
        </Modal>
      )}

      {selected && !amendForm && !statusForm && !workFile && (
        <Modal open={true} onClose={() => setSelected(null)} title={`Contract: ${selected.contract_no}`} width="90vw">
          <div className="ps-alert blue" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>Documents, milestones, the guarantee, requests and notices on this contract are in its working file — the same one the counterparty sees.</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { const id = selected.id; setSelected(null); openWorkFile(id, 'OVERVIEW'); }}>Open working file</button>
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
            <div style={{ flex: 1, minWidth: 300 }}>
              <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Contract Info</h4>
              <table className="detail-table">
                <tbody>
                  <tr><td>Type</td><td><Badge status={selected.contract_type} /></td></tr>
                  <tr><td>Status</td><td><Badge status={selected.status} /></td></tr>
                  <tr><td>Counterparty</td><td>{selected.seller_name || selected.buyer_name || '-'}</td></tr>
                  <tr><td>Project</td><td>{selected.project_type}</td></tr>
                  <tr><td>Total Capacity</td><td>{fmtNumber(selected.capacity_mw)} MW</td></tr>
                  <tr><td>Commissioned / COD</td><td>
                    {selected.contract_type === 'PSA' ? '— (a PSA has no plant of its own)' : selected.commissioned_capacity_mw > 0 ? (
                      <span style={{color: '#22c55e', fontWeight: 600}}>{fmtNumber(selected.commissioned_capacity_mw)} MW (COD: {selected.cod_date || 'date not recorded'})</span>
                    ) : (
                      <Badge status="PENDING" label="Not Commissioned" />
                    )}
                  </td></tr>
                  {selected.status === 'TERMINATED' && (
                    <>
                      <tr><td>Termination Date</td><td>{selected.termination_date}</td></tr>
                      <tr><td>Termination Reason</td><td>{selected.termination_reason}</td></tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
            
            <div style={{ flex: 1, minWidth: 300 }}>
              <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Commercials</h4>
              <table className="detail-table">
                <tbody>
                  <tr><td>Tariff Type</td><td>{selected.tariff_type}</td></tr>
                  <tr><td>Tariff / Unit</td><td>₹{fmtTariff(selected.tariff_per_unit)}</td></tr>
                  {['solar', 'wind', 'hybrid', 'fdre'].includes(String(selected.project_type).toLowerCase()) && (
                    <tr><td>Min CUF %</td><td>{selected.min_cuf_percent != null ? `${selected.min_cuf_percent}%` : 'Master default'}</td></tr>
                  )}
                  {selected.contract_type === 'PSA' && (
                    <tr><td>Trading Margin</td><td>{selected.trading_margin_per_mwh != null
                      ? `₹${selected.trading_margin_per_mwh}/MWh (contract-specific)`
                      : 'Global default (₹70/MWh)'}</td></tr>
                  )}
                  {renderTariffStructure(selected) && (
                    <tr><td>Tariff Structure</td><td>{renderTariffStructure(selected)}</td></tr>
                  )}
                  <tr><td>Tenure</td><td>{selected.tenure_start} to {selected.tenure_end}</td></tr>
                  <tr><td>PBG / EMD</td><td>{fmtCurrency(selected.pbg_amount)} {selected.pbg_type && `(${selected.pbg_type})`}</td></tr>
                  <tr><td>Billing Cycle</td><td>{selected.billing_cycle || '-'}</td></tr>
                  <tr><td>Payment Terms</td><td>{paymentTermsText(selected)}</td></tr>
                  <tr><td>Rebate Rule</td><td>{rebateText(selected)}</td></tr>
                  <tr><td>LPS Rule</td><td>{lpsText(selected)}</td></tr>
                  <tr><td>Payment Security</td><td>{(SECURITY_TYPES.find((s) => s.value === selected.payment_security_type) || {}).label || selected.payment_security_type || '-'}</td></tr>
                  <tr><td>Remarks</td><td>{selected.remarks || '-'}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          
          <h4 style={{ margin: '20px 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Projects Mapped</h4>
          {selected.projects?.length > 0 ? (
            <Table columns={[{key:'name', header:'Project SPV'}, {key:'capacity', header:'Allocated (MW)', render: r=>r.allocated_capacity_mw}]} rows={selected.projects} />
          ) : <div style={{ fontSize: 13, color: '#666' }}>No projects mapped.</div>}

          {(() => {
            const isPpa = selected.contract_type === 'PPA';
            // The contracts this one can be linked to: the other type, and not already linked.
            // Using allContracts avoids filter poisoning when user has filtered the table by PPA or PSA.
            const linked = new Set(allocations.map((a) => (isPpa ? a.psa_id : a.ppa_id)));
            const sourceList = allContracts.length > 0 ? allContracts : rows;
            const ENDED = ['CLOSED', 'TERMINATED', 'EXPIRED', 'AMENDED'];
            const candidates = sourceList.filter((r) => r && r.contract_type === (isPpa ? 'PSA' : 'PPA') && !linked.has(r.id) && !ENDED.includes(r.status));
            const canMap = CAN_WRITE.includes(user?.role) && !ENDED.includes(selected.status);
            const otherKey = isPpa ? 'psa_id' : 'ppa_id';
            // What is mapped now (shares not yet ended), and so what is left.
            const position = routingPosition(selected, allocations);
            const live = position.live;
            const usedPct = isPpa ? position.coveredPct : Math.round(live.reduce((s2, a) => s2 + Number(a.allocation_percent || 0), 0) * 100) / 100;
            const headroomPct = Math.max(0, Math.round((100 - usedPct) * 100) / 100);
            // A PSA is billed from one source PPA at a time.
            const canMapMore = canMap && (isPpa ? headroomPct > 0 : live.length === 0);
            const other = allocationForm ? sourceList.find((c) => c.id === allocationForm[otherKey]) : null;
            const ppaRec = isPpa ? selected : other;
            const psaRec = isPpa ? other : selected;
            const pctNum = Number(allocationForm?.allocation_percent);
            const shareMw = ppaRec && pctNum > 0 ? Math.round(pctNum * Number(ppaRec.capacity_mw) / 100 * 100) / 100 : null;
            const spread = ppaRec && psaRec ? Math.round((Number(psaRec.tariff_per_unit) - Number(ppaRec.tariff_per_unit)) * 100) / 100 : null;
            return (
              <>
                <PowerRoutingTree3D
                  contract={selected}
                  allocations={allocations}
                  onRemoveAllocation={canMap ? handleRemoveAllocation : undefined}
                  canMap={canMap}
                />
                {(() => {
                  // Splits already recorded to start later than the one shown above.
                  const upcoming = [...new Set(allocations.map((a) => a.effective_from).filter((d) => d && d > position.asOf))].sort();
                  if (!upcoming.length) return null;
                  return (
                    <div style={{ marginTop: 10, fontSize: 13.5, color: 'var(--slate-600)' }}>
                      {upcoming.map((d) => {
                        const at = allocations.filter((a) => a.effective_from <= d && (!a.effective_to || a.effective_to >= d));
                        const pct = Math.round(at.reduce((t, a) => t + Number(a.allocation_percent || 0), 0) * 100) / 100;
                        return (
                          <div key={d}>
                            <strong>Scheduled from {d}:</strong>{' '}
                            {at.map((a) => `${isPpa ? a.psa_no : a.ppa_no} ${a.allocation_percent}%`).join(', ') || 'no shares'}
                            {isPpa ? ` — ${pct}% in total` : ''}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {allocationForm ? (
                  <form onSubmit={handleAddAllocation} style={{ marginTop: 16, padding: 16, border: '1px solid var(--slate-200)', borderRadius: 8 }}>
                    <h5 style={{ margin: '0 0 12px 0' }}>{isPpa ? 'Map a PSA to this PPA' : 'Map a source PPA to this PSA'}</h5>
                    <div className="form-grid">
                      <Field label={isPpa ? 'Select PSA' : 'Select PPA'} required>
                        <select required value={allocationForm[otherKey] || ''} onChange={(e) => setAllocationForm({ ...allocationForm, [otherKey]: e.target.value })}>
                          <option value="">{isPpa ? 'Select PSA...' : 'Select PPA...'}</option>
                          {candidates.map((c) => (
                            <option key={c.id} value={c.id}>{c.contract_no}{c.version > 1 ? ` v${c.version}` : ''} — {isPpa ? c.buyer_name : c.seller_name} · {c.project_type} · {fmtNumber(c.capacity_mw)} MW · ₹{c.tariff_per_unit}/unit · {c.status.replace(/_/g, ' ')}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label={isPpa ? 'Allocation %' : 'Share of the PPA’s energy (%)'} required>
                        <input required type="number" step="0.01" min="0.01" max="100" value={allocationForm.allocation_percent} onChange={(e) => setAllocationForm({ ...allocationForm, allocation_percent: e.target.value })} />
                      </Field>
                      <Field label="Effective From" required>
                        <input required type="date" value={allocationForm.effective_from} onChange={(e) => setAllocationForm({ ...allocationForm, effective_from: e.target.value })} />
                      </Field>
                    </div>
                    <div style={{ fontSize: 13.5, margin: '8px 0 0', display: 'flex', gap: 18, flexWrap: 'wrap', color: 'var(--slate-600)' }}>
                      {isPpa && <span>Already mapped <strong>{usedPct}%</strong> · left <strong>{headroomPct}%</strong> ({fmtNumber(Math.round(headroomPct * Number(selected.capacity_mw)) / 100)} MW)</span>}
                      {shareMw != null && <span>This share: <strong>{fmtNumber(shareMw)} MW</strong>{psaRec ? ` of ${psaRec.contract_no}'s ${fmtNumber(psaRec.capacity_mw)} MW` : ''}</span>}
                      {spread != null && (
                        <span style={{ color: spread < 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                          Spread {spread < 0 ? '−' : '+'}₹{Math.abs(spread).toFixed(2)}/unit {spread < 0 ? '(PSA sells below PPA — a loss on every unit)' : ''}
                        </span>
                      )}
                    </div>
                    {!isPpa && (
                      <p style={{ fontSize: 13.5, color: 'var(--slate-500)', margin: '4px 0 0' }}>
                        The percentage is the share of the chosen PPA’s energy that goes to this PSA. A PPA cannot be allocated beyond 100% across all its PSAs.
                      </p>
                    )}
                    {allocationForm.need_reason && (
                      <div style={{ marginTop: 10 }}>
                        <p style={{ fontSize: 13.5, color: '#b91c1c', margin: '0 0 6px' }}>{allocationForm.spread_message}</p>
                        <Field label="Reason for mapping below cost (order / VGF reference)" required>
                          <input value={allocationForm.negative_spread_reason || ''} onChange={(e) => setAllocationForm({ ...allocationForm, negative_spread_reason: e.target.value })} />
                        </Field>
                      </div>
                    )}
                    {candidates.length === 0 && (
                      <p style={{ fontSize: 13.5, color: 'var(--amber-strong)', margin: '4px 0 0' }}>
                        {isPpa ? 'There is no PSA left to map. Create the PSA first.' : 'There is no PPA left to map. Create the PPA first.'}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button type="submit" className="btn btn-primary btn-sm" disabled={allocSubmitting}>
                        {allocSubmitting ? 'Saving...' : 'Save Map'}
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setAllocationForm(null)}>Cancel</button>
                    </div>
                  </form>
                ) : resplit && isPpa ? (() => {
                  const inSplit = new Set(resplit.rows.map((r) => r.psa_id));
                  const addable = sourceList.filter((c) => c && c.contract_type === 'PSA' && !inSplit.has(c.id) && !ENDED.includes(c.status));
                  const dayBeforeIso = (() => { if (!resplit.effective_from) return null; const d = new Date(`${resplit.effective_from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
                  const ending = dayBeforeIso ? sharesOn(dayBeforeIso).filter((a) => !inSplit.has(a.psa_id)) : [];
                  const replaced = [...new Set(allocations.filter((a) => resplit.effective_from && a.effective_from > resplit.effective_from).map((a) => a.effective_from))];
                  const total = Math.round(resplit.rows.reduce((t, r) => t + (Number(r.allocation_percent) || 0), 0) * 100) / 100;
                  const cap = Number(selected.capacity_mw);
                  const dayBefore = (() => { if (!resplit.effective_from) return '—'; const d = new Date(`${resplit.effective_from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
                  const setRow = (i, v) => setResplit({ ...resplit, rows: resplit.rows.map((r, j) => (j === i ? { ...r, allocation_percent: v } : r)) });
                  return (
                    <form onSubmit={(e) => handleResplit(e)} noValidate style={{ marginTop: 16, padding: 16, border: '1px solid var(--slate-200)', borderRadius: 8 }}>
                      <h5 style={{ margin: '0 0 4px 0' }}>Change the split from a date</h5>
                      <p style={{ fontSize: 13.5, color: 'var(--slate-500)', margin: '0 0 12px' }}>
                        The complete split from the date below. Shares in force close the day before; a PSA you end keeps its share for every earlier month.
                      </p>
                      <div className="form-grid">
                        <Field label="New split takes effect from" required>
                          <input type="date" min={selected.tenure_start || undefined} max={selected.tenure_end || undefined} value={resplit.effective_from} onChange={(e) => setResplit({ ...resplit, effective_from: e.target.value })} />
                        </Field>
                        <Field label="Reason / reference" required>
                          <input value={resplit.reason} placeholder="e.g. HPPC exit notice dated 12-Dec-2026" onChange={(e) => setResplit({ ...resplit, reason: e.target.value })} />
                        </Field>
                      </div>
                      <div className="table-wrap" style={{ marginTop: 8 }}>
                        <table className="data-table" style={{ margin: 0 }}>
                          <thead><tr><th scope="col">PSA</th><th scope="col">Buyer</th><th scope="col" style={{ width: 110 }}>Share %</th><th scope="col">MW</th><th scope="col">Spread</th><th scope="col" /></tr></thead>
                          <tbody>
                            {resplit.rows.map((r, i) => {
                              const info = psaInfo(r.psa_id);
                              const pct = Number(r.allocation_percent);
                              const mw = pct > 0 ? Math.round(pct * cap) / 100 : null;
                              const over = mw != null && info.capacity_mw && mw > info.capacity_mw + 1e-6;
                              const sp = Number.isFinite(info.tariff) ? Math.round((info.tariff - Number(selected.tariff_per_unit)) * 100) / 100 : null;
                              const was = (dayBeforeIso ? sharesOn(dayBeforeIso) : []).find((a) => a.psa_id === r.psa_id);
                              return (
                                <tr key={r.psa_id}>
                                  <td><strong>{info.contract_no}</strong>{!was && ' '}{!was && <span style={{ marginLeft: 6, fontSize: 12.5, color: '#15803d' }}>new</span>}{was && Number(was.allocation_percent) !== pct && <div style={{ fontSize: 12.5, color: 'var(--slate-500)' }}>was {was.allocation_percent}%</div>}</td>
                                  <td>{info.buyer_name || '—'}</td>
                                  <td><input type="number" step="0.01" min="0.01" max="100" aria-label={`Share % for ${info.contract_no}`} value={r.allocation_percent} onChange={(e) => setRow(i, e.target.value)} style={{ width: 90 }} /></td>
                                  <td style={{ color: over ? '#b91c1c' : 'inherit', fontWeight: over ? 600 : 400 }}>{mw != null ? `${fmtNumber(mw)} of ${fmtNumber(info.capacity_mw)} MW` : '—'}</td>
                                  <td style={{ color: sp != null && sp < 0 ? '#b91c1c' : '#15803d' }}>{sp == null ? '—' : `${sp < 0 ? '−' : '+'}₹${Math.abs(sp).toFixed(2)}`}</td>
                                  <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => setResplit({ ...resplit, rows: resplit.rows.filter((_, j) => j !== i) })}>End share</button></td>
                                </tr>
                              );
                            })}
                            {resplit.rows.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--slate-500)' }}>No PSA keeps a share — every share ends on {dayBefore}.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                        <select aria-label="Add a PSA to the split" value={resplit.add_psa_id} onChange={(e) => setResplit({ ...resplit, add_psa_id: e.target.value })} style={{ minWidth: 320 }}>
                          <option value="">Add a PSA to the split…</option>
                          {addable.map((c) => <option key={c.id} value={c.id}>{c.contract_no}{c.version > 1 ? ` v${c.version}` : ''} — {c.buyer_name} · {fmtNumber(c.capacity_mw)} MW · ₹{c.tariff_per_unit}/unit · {c.status.replace(/_/g, ' ')}</option>)}
                        </select>
                        <button type="button" className="btn btn-outline btn-sm" disabled={!resplit.add_psa_id} onClick={() => setResplit({ ...resplit, rows: [...resplit.rows, { psa_id: resplit.add_psa_id, allocation_percent: '' }], add_psa_id: '' })}>Add</button>
                      </div>
                      <div style={{ fontSize: 13.5, margin: '10px 0 0', display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                        <span style={{ color: total > 100 ? '#b91c1c' : 'var(--slate-600)', fontWeight: 600 }}>New total {total}% · {fmtNumber(Math.round(total * cap) / 100)} MW of {fmtNumber(cap)} MW</span>
                        {total <= 100 && <span style={{ color: 'var(--slate-600)' }}>Left unsold {Math.round((100 - total) * 100) / 100}%</span>}
                        {ending.length > 0 && <span style={{ color: '#b45309' }}>Ending on {dayBefore}: {ending.map((a) => a.psa_no).join(', ')}</span>}
                      </div>
                      {replaced.length > 0 && (
                        <p style={{ fontSize: 13.5, color: '#b45309', margin: '8px 0 0' }}>
                          A split is already scheduled from {replaced.join(', ')}. Saving from {resplit.effective_from} replaces it — include every PSA that should keep a share after that date.
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button type="submit" className="btn btn-primary btn-sm" disabled={allocSubmitting}>{allocSubmitting ? 'Saving...' : 'Review new split'}</button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setResplit(null)}>Cancel</button>
                      </div>
                    </form>
                  );
                })() : canMap && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {canMapMore && (
                      <button className="btn btn-outline btn-sm" onClick={() => setAllocationForm({ psa_id: '', ppa_id: '', allocation_percent: '', effective_from: new Date().toISOString().split('T')[0] })}>
                        {isPpa ? '+ Map PSA to this PPA' : '+ Map PPA to this PSA'}
                      </button>
                    )}
                    {isPpa && live.length > 0 && (
                      <button className="btn btn-outline btn-sm" onClick={() => openResplit()}>Change split from a date</button>
                    )}
                    {!canMapMore && (
                      <span style={{ fontSize: 13.5, color: 'var(--slate-500)' }}>
                        {isPpa ? 'This PPA is fully allocated — change the split from a date to give a share to another PSA.' : `This PSA already draws from ${live[0]?.ppa_no || 'a source PPA'}. A PSA is billed from one source at a time — to move it, change that PPA's split from a date.`}
                      </span>
                    )}
                  </div>
                )}
              </>
            );
          })()}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => setWorkFile({ contract: selected, tab: 'MILESTONES' })}>
              Documents, milestones, requests &amp; notices
            </button>
            {CAN_WRITE.includes(user?.role) && selected.status !== 'CLOSED' && (
              <>
                {allowedNextStatuses(selected.status).length > 0 && (
                  <button className="btn btn-outline" onClick={() => {
                    const next = allowedNextStatuses(selected.status);
                    setStatusForm({
                      status: next[0] || selected.status,
                      remarks: '',
                      termination_date: '',
                      termination_ground: '',
                      termination_reason: '',
                    });
                  }}>Update Lifecycle Stage</button>
                )}
                {!['CLOSED', 'TERMINATED'].includes(selected.status) && (
                  <button className="btn btn-outline" onClick={() => setAmendForm({ ...selected, effective_from: '', amendment_reason: '' })}>
                    {['DRAFT', 'UNDER_NEGOTIATION'].includes(selected.status) ? 'Edit Draft' : 'Amend Contract'}
                  </button>
                )}
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Lifecycle Modal */}
      {statusForm && (
        <Modal open={true} onClose={() => setStatusForm(null)} title="Update Contract Lifecycle Stage">
          <form onSubmit={handleStatusChange} noValidate>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#475569' }}>
              Current stage: <strong>{selected?.status}</strong>
            </p>
            {lifecycleHint(selected?.status) && (
              <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.45, color: '#64748b' }}>
                {lifecycleHint(selected?.status)}
              </p>
            )}
            <Field label="New Status">
              <select
                value={allowedNextStatuses(selected?.status).includes(statusForm.status) ? statusForm.status : (allowedNextStatuses(selected?.status)[0] || '')}
                onChange={e => setStatusForm({...statusForm, status: e.target.value})}
                disabled={!allowedNextStatuses(selected?.status).length}
              >
                {allowedNextStatuses(selected?.status).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            {statusForm.status === 'TERMINATED' && (
              <div className="form-grid" style={{marginTop: 12}}>
                <Field label="Termination Date" required><input type="date" min={selected?.tenure_start || undefined} max={selected?.tenure_end || undefined} value={statusForm.termination_date} onChange={e => setStatusForm({...statusForm, termination_date: e.target.value})} /></Field>
                <Field label="Ground" required>
                  <select value={statusForm.termination_ground || ''} onChange={e => setStatusForm({...statusForm, termination_ground: e.target.value})}>
                    <option value="">Select ground…</option>
                    {TERMINATION_GROUNDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Details / notice reference"><input value={statusForm.termination_reason} onChange={e => setStatusForm({...statusForm, termination_reason: e.target.value})} placeholder="e.g. Default notice SJVN/REIA/2026/14" /></Field>
              </div>
            )}
            {statusForm.status === 'CLOSED' && statusForm.settlement_open && (
              <Field label="Reason for closing with settlement open" required>
                <input value={statusForm.settlement_override_reason || ''} onChange={e => setStatusForm({...statusForm, settlement_override_reason: e.target.value})} />
              </Field>
            )}
            <Field label="Remarks">
              <input value={statusForm.remarks || ''} onChange={e => setStatusForm({...statusForm, remarks: e.target.value})} placeholder="e.g. Approved by board / commissioning phase" />
            </Field>
            <div className="form-actions" style={{marginTop: 20}}>
              <button type="button" className="btn btn-ghost" onClick={() => setStatusForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting || !allowedNextStatuses(selected?.status).length}>
                {submitting ? 'Updating...' : 'Update Status'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Amendment Modal */}
      {amendForm && (
        <Modal open={true} onClose={() => setAmendForm(null)} title={`${['DRAFT', 'UNDER_NEGOTIATION'].includes(amendForm.status) ? 'Edit Draft' : 'Amend Contract'}: ${amendForm.contract_no}`} width={850}>
          <form onSubmit={handleAmend} noValidate>

            {/* Mandatory Amendment Metadata */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: 13.5, color: '#1e3a8a' }}>{['DRAFT', 'UNDER_NEGOTIATION'].includes(amendForm.status) ? 'Correcting an unsigned draft — no new version is created' : 'Amendment Application'}</h4>
              <div className="form-grid">
                {!['DRAFT', 'UNDER_NEGOTIATION'].includes(amendForm.status) && <Field label="Effective From" required>
                  <input
                    required
                    type="date"
                    min={amendForm.tenure_start || undefined}
                    max={amendForm.tenure_end || undefined}
                    value={amendForm.effective_from || ''}
                    onChange={(e) => setAmendForm({ ...amendForm, effective_from: e.target.value })}
                  />
                  {(amendForm.tenure_start || amendForm.tenure_end) && (
                    <span style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4 }}>
                      Date the revised terms apply from — within tenure {amendForm.tenure_start || '…'} to {amendForm.tenure_end || '…'}
                    </span>
                  )}
                </Field>}
                <Field label="Amendment Reason / Reference" required>
                  <input
                    required
                    value={amendForm.amendment_reason || ''}
                    onChange={(e) => setAmendForm({ ...amendForm, amendment_reason: e.target.value })}
                    placeholder="e.g. CERC Tariff Order, Mutual Agreement, SCOD Extension"
                  />
                </Field>
              </div>
            </div>

            {/* 1. Capacity & Milestone Dates */}
            <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: 13.5 }}>1. Capacity & Milestone Dates</h4>
              <div className="form-grid">
                <Field label="Contracted Capacity (MW)">
                  <input type="number" step="0.01" value={amendForm.capacity_mw ?? ''} onChange={(e) => setAmendForm({ ...amendForm, capacity_mw: e.target.value })} />
                </Field>
                <Field label="Commissioned Capacity (MW)">
                  <input type="number" step="0.01" value={amendForm.commissioned_capacity_mw ?? ''} onChange={(e) => setAmendForm({ ...amendForm, commissioned_capacity_mw: e.target.value })} />
                </Field>
                <Field label="COD Date">
                  <input type="date" value={amendForm.cod_date || ''} onChange={(e) => setAmendForm({ ...amendForm, cod_date: e.target.value })} />
                </Field>
                <Field label="Tenure End Date (Extension)">
                  <input type="date" value={amendForm.tenure_end || ''} onChange={(e) => setAmendForm({ ...amendForm, tenure_end: e.target.value })} />
                </Field>
              </div>
            </div>

            {/* 2. Tariff & Commercial Terms */}
            <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: 13.5 }}>2. Tariff & Commercial Structure</h4>
              <div className="form-grid">
                <Field label="Tariff Type">
                  <select value={amendForm.tariff_type || 'FLAT'} onChange={(e) => setAmendForm({ ...amendForm, tariff_type: e.target.value })}>
                    <option value="FLAT">Flat / Fixed</option>
                    <option value="TWO_PART">Two-Part (Fixed + Variable)</option>
                    <option value="ESCALATING">Escalating / Indexed</option>
                    <option value="SLAB">Time of Day / Slab</option>
                  </select>
                </Field>
                <Field label="Base Tariff (₹/unit)">
                  <input type="number" step="0.01" value={amendForm.tariff_per_unit ?? ''} onChange={(e) => setAmendForm({ ...amendForm, tariff_per_unit: e.target.value })} />
                </Field>
                {amendForm.contract_type === 'PSA' && (
                  <Field label="Trading Margin (₹/MWh)">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Blank = global default (₹70/MWh)"
                      value={amendForm.trading_margin_per_mwh ?? ''}
                      onChange={(e) => setAmendForm({ ...amendForm, trading_margin_per_mwh: e.target.value })}
                    />
                  </Field>
                )}
                <Field label="Billing Cycle">
                  <select value={amendForm.billing_cycle || 'MONTHLY'} onChange={(e) => setAmendForm({ ...amendForm, billing_cycle: e.target.value })}>
                    <option value="MONTHLY">Monthly</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="DAILY">Daily</option>
                  </select>
                </Field>
              </div>
            </div>

            {/* 3. Billing & Regulatory Rules (CERC) */}
            <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: 13.5 }}>3. Billing & Regulatory Rules (CERC)</h4>
              
              <div className="rule-block">
                <div className="rule-block-label">Payment Terms</div>
                <div className="rule-inline">
                  <span>Payment is due</span>
                  <input type="number" min="0" className="rule-num" value={amendForm.payment_terms_days ?? ''}
                    onChange={(e) => setAmendForm({ ...amendForm, payment_terms_days: e.target.value })} />
                  <span>days from the bill date.</span>
                </div>
              </div>

              <div className="rule-block">
                <div className="rule-block-label">Early-Payment Rebate</div>
                <div className="rule-inline">
                  <input type="number" step="0.01" min="0" className="rule-num" placeholder="2" value={amendForm.rebate_pct ?? ''}
                    onChange={(e) => setAmendForm({ ...amendForm, rebate_pct: e.target.value })} />
                  <span>% rebate if paid within</span>
                  <input type="number" min="0" className="rule-num" placeholder="5" value={amendForm.rebate_days ?? ''}
                    onChange={(e) => setAmendForm({ ...amendForm, rebate_days: e.target.value })} />
                  <span>days from</span>
                  <select className="rule-select" value={amendForm.rebate_basis || 'BILL_DATE'}
                    onChange={(e) => setAmendForm({ ...amendForm, rebate_basis: e.target.value })}>
                    <option value="BILL_DATE">bill date</option>
                    <option value="DUE_DATE">due date</option>
                  </select>
                </div>
                <div className="rule-preview">{previewRebate(amendForm)}</div>
              </div>

              <div className="rule-block">
                <div className="rule-block-label">Late-Payment Surcharge (LPS)</div>
                <div className="rule-inline">
                  <input type="number" step="0.01" min="0" className="rule-num" placeholder="15" value={amendForm.lps_annual_pct ?? ''}
                    onChange={(e) => setAmendForm({ ...amendForm, lps_annual_pct: e.target.value })} />
                  <span>% per annum, charged after a grace of</span>
                  <input type="number" min="0" className="rule-num" placeholder="0" value={amendForm.lps_grace_days ?? ''}
                    onChange={(e) => setAmendForm({ ...amendForm, lps_grace_days: e.target.value })} />
                  <span>days past due.</span>
                </div>
                <div className="rule-preview">{previewLps(amendForm)}</div>
              </div>

              <div className="rule-block" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
                <div className="rule-block-label">Payment Security Mechanism</div>
                <select className="rule-select" style={{ minWidth: 260 }} value={amendForm.payment_security_type || 'NONE'}
                  onChange={(e) => setAmendForm({ ...amendForm, payment_security_type: e.target.value })}>
                  {SECURITY_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {/* 4. Payment Security & Guarantees */}
            <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: 13.5 }}>4. Performance Security & Guarantee</h4>
              <div className="form-grid">
                <Field label="PBG / Security Amount (₹)">
                  <input type="number" value={amendForm.pbg_amount ?? ''} onChange={(e) => setAmendForm({ ...amendForm, pbg_amount: e.target.value })} />
                </Field>
                <Field label="Security Instrument Type">
                  <select value={amendForm.pbg_type || ''} onChange={(e) => setAmendForm({ ...amendForm, pbg_type: e.target.value })}>
                    <option value="">Select instrument…</option>
                    {PBG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="PBG Expiry Date">
                  <input type="date" value={amendForm.pbg_expiry || ''} onChange={(e) => setAmendForm({ ...amendForm, pbg_expiry: e.target.value })} />
                </Field>
              </div>
            </div>

            {/* 5. Performance / Technology Specific Parameters */}
            {['Solar', 'Wind', 'Hybrid', 'FDRE'].includes(amendForm.project_type) && (
              <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: 13.5, color: '#0369a1' }}>5. CUF Performance Threshold</h4>
                <div className="form-grid">
                  <Field label="Min / Guaranteed CUF (%)">
                    <input type="number" step="0.01" min="0" max="100" value={amendForm.min_cuf_percent ?? ''} onChange={(e) => setAmendForm({ ...amendForm, min_cuf_percent: e.target.value })} />
                  </Field>
                </div>
              </div>
            )}

            {['Hydro', 'PSP'].includes(amendForm.project_type) && (
              <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: 13.5, color: '#0369a1' }}>5. Hydro-Specific Parameters (CERC)</h4>
                <div className="form-grid">
                  <Field label="Annual Fixed Charges AFC (₹)">
                    <input type="number" step="1" value={amendForm.annual_afc ?? ''} onChange={(e) => setAmendForm({ ...amendForm, annual_afc: e.target.value })} />
                  </Field>
                  <Field label="Annual Design Energy DE (MWh)">
                    <input type="number" step="0.001" value={amendForm.annual_design_energy_mwh ?? ''} onChange={(e) => setAmendForm({ ...amendForm, annual_design_energy_mwh: e.target.value })} />
                  </Field>
                  <Field label="NAPAF (%)">
                    <input type="number" step="0.01" value={amendForm.napaf_percent ?? ''} onChange={(e) => setAmendForm({ ...amendForm, napaf_percent: e.target.value })} />
                  </Field>
                  <Field label="Normative Auxiliary (%)">
                    <input type="number" step="0.01" value={amendForm.normative_aux ?? ''} onChange={(e) => setAmendForm({ ...amendForm, normative_aux: e.target.value })} />
                  </Field>
                  <Field label="Free Energy to Home State (%)">
                    <input type="number" step="0.01" value={amendForm.free_energy_home_state ?? ''} onChange={(e) => setAmendForm({ ...amendForm, free_energy_home_state: e.target.value })} />
                  </Field>
                  <Field label="Transmission / Wheeling (₹/MWh)">
                    <input type="number" step="0.01" value={amendForm.transmission_charge_per_mwh ?? ''} onChange={(e) => setAmendForm({ ...amendForm, transmission_charge_per_mwh: e.target.value })} />
                  </Field>
                </div>
              </div>
            )}

            <div className="form-actions" style={{ marginTop: 20 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setAmendForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Submitting...' : (['DRAFT', 'UNDER_NEGOTIATION'].includes(amendForm.status) ? 'Save Draft Changes' : `Submit Amendment (Creates v${(amendForm.version || 1) + 1})`)}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <AlertPopup
        open={!!popup}
        tone={popup?.tone}
        title={popup?.title}
        message={popup?.message}
        items={popup?.items}
        actions={popup?.actions}
        okLabel={popup?.okLabel}
        onClose={() => setPopup(null)}
      />
    </div>
  );
}
