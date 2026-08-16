import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';
import { ScheduleGridModal } from './ScheduleGridModal.jsx';

const EMPTY_FORM = {
  contract_type: 'Bilateral', transaction_type: '', loa_no: '', ppa_no: '', start_date: '', end_date: '',
  compensation: '', late_payment_surcharge: '', rebate: '', type_of_contract: 'Purchase Side', product: '',
  supplier_name: '', supplier_id: '', supplier_sldc: '', supplier_region: '', injecting_point: '',
  procurer_name: '', procurer_id: '', procurer_sldc: '', procurer_region: '', drawal_point: '',
  order_details: [{ id: Date.now(), date_from: '', date_to: '', time_from: '', time_to: '', rate_type: '', rate: '', quantum: '', variation: '' }],
  route: '', alternate_route: '', is_renewable: 'Yes', billing_type: '',
  ists_charges_bearer: '', state_transmission_charges_bearer: '', distribution_wheeling_bearer: '', rldc_operating_bearer: '', state_operating_bearer: '', dis_operating_bearer: '', noar_application_bearer: '', sldc_consent_bearer: '',
  client_registration_fee: '', trading_margin: '', application_fee: '',
  remarks: ''
};

const NOAR_STEP_LABEL = {
  NOT_INITIATED: 'Not initiated',
  FORMAT_D_PREPARED: 'Format-D prepared',
  CONTRACT_CREATED: 'Contract created on NOAR',
  SUBMITTED: 'Submitted to NOAR',
  APPROVED: 'Approved by NLDC',
  REJECTED: 'Rejected by NLDC',
};

const SLA_STYLE = {
  ON_TRACK: { tone: '#166534', bg: '#dcfce7', label: 'On track' },
  AT_RISK: { tone: '#92400e', bg: '#fef3c7', label: 'At risk' },
  BREACHED: { tone: '#991b1b', bg: '#fee2e2', label: 'Overdue' },
  MET: { tone: '#166534', bg: '#dcfce7', label: 'Met' },
  MISSED: { tone: '#991b1b', bg: '#fee2e2', label: 'Missed' },
  REJECTED: { tone: '#9a3412', bg: '#ffedd5', label: 'Rejected' },
};

/** Compact SLA chip — omitted entirely when there is no approval clock running. */
function SlaChip({ sla }) {
  const style = sla && SLA_STYLE[sla.state];
  if (!style) return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
  const detail = sla.is_open
    ? `${sla.elapsed_days}d / ${sla.target_days}d`
    : `${sla.elapsed_days}d vs ${sla.target_days}d`;
  return (
    <span
      title={`${sla.oa_type} target ${sla.target_days} days, measured submission → approval`}
      style={{ background: style.bg, color: style.tone, padding: '2px 8px', borderRadius: 10, fontSize: 12, whiteSpace: 'nowrap' }}
    >
      {style.label} · {detail}
    </span>
  );
}

/** Open access losses are notified per leg; the deal-level figure is their sum. */
function totalLosses(tx) {
  return ['loss_injection_state', 'loss_inter_state', 'loss_drawee_state']
    .reduce((sum, k) => sum + (Number(tx?.[k]) || 0), 0);
}

/** Approval turnaround reads in days; short gaps still need to be legible. */
function fmtDuration(hours) {
  if (hours === null || hours === undefined) return null;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `${Math.round(hours * 10) / 10} hr`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  return h ? `${d}d ${h}h` : `${d}d`;
}

function fmtStamp(s) {
  if (!s) return '—';
  const d = new Date(`${String(s).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function FormSection({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div className="form-section-header">{title}</div>
      {children}
    </div>
  );
}

function BearerRadio({ label, field, form, setForm }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
      <span style={{ color: 'var(--slate-700)' }}>{label}</span>
      <div style={{ display: 'flex', gap: 10 }}>
        {['Seller', 'Buyer', 'SJVN', 'Both'].map(opt => (
          <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="radio" name={field} checked={form[field] === opt} onChange={() => setForm({...form, [field]: opt})} />
            {opt}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function Bilateral() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [selectedTx, setSelectedTx] = useState(null);
  const [sla, setSla] = useState(null);
  const [rejectForm, setRejectForm] = useState(null);
  const [rejectReasons, setRejectReasons] = useState([]);
  const [picked, setPicked] = useState([]);
  const [bulkTo, setBulkTo] = useState('FORMAT_D_PREPARED');
  const [bulkReason, setBulkReason] = useState({ rejection_category: '', rejection_reason: '' });
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showScheduleGrid, setShowScheduleGrid] = useState(false);
  const [wbesStatus, setWbesStatus] = useState(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncForm, setSyncForm] = useState({ date: new Date().toISOString().split('T')[0] });
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  // Settlement & billing: the settled position for a supply period, the bills
  // already raised against it, and the period the desk is billing for.
  const [settlement, setSettlement] = useState(null);
  const [settleBusy, setSettleBusy] = useState(false);
  const [txInvoices, setTxInvoices] = useState([]);
  const [billPeriod, setBillPeriod] = useState({ from: '', to: '' });
  const [billBusy, setBillBusy] = useState('');
  const [billMsg, setBillMsg] = useState(null);

  function load() {
    setLoading(true);
    api.bilateral.noarSla().then(setSla).catch(() => setSla(null));
    api.bilateral.wbesStatus().then(setWbesStatus).catch(() => setWbesStatus(null));
    api.masters.lookups({ category: 'NOAR_REJECTION_REASON' }).then(setRejectReasons).catch(() => setRejectReasons([]));
    api.bilateral.list().then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, []);
  useEffect(() => { api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => {}); }, []);

  // Check URL params for action=create / tx= on mount or when location changes
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'create') {
      setShowCreate(true);
      navigate(location.pathname, { replace: true });
      return;
    }
    const txId = params.get('tx');
    if (txId) {
      api.bilateral.get(txId)
        .then((tx) => setSelectedTx(tx))
        .catch(() => {});
      navigate(location.pathname, { replace: true });
    }
  }, [location, navigate]);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      // NOTE: Passing the complex form data. Backend may need updates to support this.
      await api.bilateral.create(form);
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create transaction.');
    }
  }

  function addOrderRow() {
    setForm({ ...form, order_details: [...form.order_details, { id: Date.now(), date_from: '', date_to: '', time_from: '', time_to: '', rate_type: '', rate: '', quantum: '', variation: '' }] });
  }

  function removeOrderRow(index) {
    if (form.order_details.length === 1) return;
    const updated = [...form.order_details];
    updated.splice(index, 1);
    setForm({ ...form, order_details: updated });
  }

  function updateOrderRow(index, field, value) {
    const updated = [...form.order_details];
    updated[index][field] = value;
    setForm({ ...form, order_details: updated });
  }

  async function handleScheduleSubmit(blocks) {
    try {
      const updated = await api.bilateral.createSchedule(selectedTx.id, { blocks });
      setSelectedTx(updated);
      setShowScheduleGrid(false);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to add schedule");
    }
  }

  const NOAR_FLOW = ['NOT_INITIATED', 'FORMAT_D_PREPARED', 'CONTRACT_CREATED', 'SUBMITTED', 'APPROVED'];
  async function handleAdvanceNoar(tx) {
    // A rejected application does not continue down the linear flow — it goes
    // back to NOAR as a fresh submission once the desk has fixed the issue.
    const current = tx.noar_status || 'NOT_INITIATED';
    const idx = NOAR_FLOW.indexOf(current);
    const next = current === 'REJECTED' ? 'SUBMITTED' : NOAR_FLOW[Math.min(idx + 1, NOAR_FLOW.length - 1)];
    let contractNo = tx.noar_contract_no;
    if (next === 'CONTRACT_CREATED' && !contractNo) {
      contractNo = prompt('NOAR contract number:') || '';
    }
    // Optional, but it is what makes the history readable months later.
    const note = prompt(`Note for "${NOAR_STEP_LABEL[next]}" (optional):`) || '';
    try {
      const updated = await api.bilateral.updateNoar(tx.id, { noar_status: next, noar_contract_no: contractNo, note });
      setSelectedTx(updated); load();
    } catch (err) { alert('Failed to update NOAR status'); }
  }
  /** Downloads go through the API client so the JWT is attached. */
  async function download(fetcher, filename) {
    try {
      const blob = await fetcher();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert(`Could not download ${filename}.`);
    }
  }

  function togglePick(id) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setBulkPreview(null);
  }

  async function runBulk(dryRun) {
    setBulkBusy(true);
    try {
      const res = await api.bilateral.noarBulk({
        ids: picked,
        to_status: bulkTo,
        dry_run: dryRun,
        ...(bulkTo === 'REJECTED' ? bulkReason : {}),
      });
      setBulkPreview(res);
      if (!dryRun) {
        // Keep only what did not move, so a second pass targets the leftovers.
        setPicked(res.results.filter((r) => !r.ok).map((r) => r.id));
        load();
      }
    } catch (err) {
      setBulkPreview({ error: err.response?.data?.error || 'Bulk update failed' });
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleRejectNoar(e) {
    e.preventDefault();
    if (!rejectForm.rejection_reason.trim()) return;
    try {
      const updated = await api.bilateral.updateNoar(selectedTx.id, {
        noar_status: 'REJECTED',
        rejection_category: rejectForm.rejection_category || undefined,
        rejection_reason: rejectForm.rejection_reason.trim(),
      });
      setSelectedTx(updated); setRejectForm(null); load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to record rejection');
    }
  }

  async function handleDownloadFormatD(tx) {
    try {
      const blob = await api.bilateral.downloadFormatD(tx.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `FormatD_${tx.counterparty}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch (err) { alert('Failed to download Format-D'); }
  }

  async function handleDownloadLoi(tx) {
    try {
      const blob = await api.bilateral.downloadLoi(tx.id);
      const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      const cleanRef = (tx.loi_contract_ref || tx.id).replace(/[/\\?%*:|"<>]/g, '_');
      a.download = `SJVN_LoI_${cleanRef}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download LoI:', err);
      alert('Failed to download LoI');
    }
  }

  async function handleNodeApproval(schedId, nodeType, status) {
    try {
      const updated = await api.bilateral.updateApproval(schedId, nodeType, status);
      setSelectedTx(updated);
      load();
    } catch (err) {
      alert("Failed to update node approval");
    }
  }

  async function handleRecordActuals(schedId) {
    const mw = prompt("Enter Actual MW flow (used for DSM calculation):");
    if (!mw) return;
    try {
      const updated = await api.bilateral.recordActuals(schedId, Number(mw));
      setSelectedTx(updated);
      // Metered actuals move the settled quantum, so the position is restated.
      refreshSettlement(selectedTx.id, billPeriod);
      load();
    } catch (err) {
      alert("Failed to record actuals");
    }
  }

  async function handleWbesSync(e) {
    e.preventDefault();
    setSyncBusy(true);
    setSyncResult(null);
    try {
      const res = await api.bilateral.wbesSync({ date: syncForm.date });
      setSyncResult(res);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'WBES sync failed');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleCurtail(schedId) {
    const mw = prompt("Enter Curtailed MW:");
    if (!mw) return;
    try {
      const updated = await api.bilateral.curtail(schedId, Number(mw));
      setSelectedTx(updated);
      refreshSettlement(selectedTx.id, billPeriod);
      load();
    } catch (err) {
      alert("Failed to curtail");
    }
  }

  /* ─────────── Settlement & billing ───────────
   * The settlement preview writes nothing, so it can be refreshed freely
   * whenever the blocks underneath it change.
   */

  function refreshSettlement(txId, period = billPeriod) {
    if (!txId) return;
    setSettleBusy(true);
    const params = {};
    if (period.from) params.from = period.from;
    if (period.to) params.to = period.to;
    api.bilateral.settlement(txId, params)
      .then(setSettlement)
      .catch(() => setSettlement(null))
      .finally(() => setSettleBusy(false));
    api.bilateral.invoices(txId).then(setTxInvoices).catch(() => setTxInvoices([]));
  }

  // Reload the settled position whenever a different transaction is opened, and
  // clear it when the panel closes so the next one never shows stale figures.
  useEffect(() => {
    if (!selectedTx) {
      setSettlement(null);
      setTxInvoices([]);
      setBillMsg(null);
      setBillPeriod({ from: '', to: '' });
      return;
    }
    refreshSettlement(selectedTx.id, { from: '', to: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTx?.id]);

  async function handleRaiseBill(billType) {
    if (!selectedTx) return;
    setBillBusy(billType);
    setBillMsg(null);
    try {
      const body = { bill_type: billType };
      if (billPeriod.from) body.from = billPeriod.from;
      if (billPeriod.to) body.to = billPeriod.to;
      const inv = await api.bilateral.generateInvoice(selectedTx.id, body);
      setBillMsg({
        ok: true,
        text: `${inv.invoice_no} raised for ₹${fmtNumber(inv.invoice_amount)} (${inv.settlement_basis}).`,
        warnings: inv.warnings || [],
      });
      const updated = await api.bilateral.get(selectedTx.id);
      setSelectedTx(updated);
      refreshSettlement(selectedTx.id);
      load();
    } catch (err) {
      const data = err.response?.data || {};
      setBillMsg({ ok: false, text: data.error || 'Failed to raise the bill.', warnings: data.warnings || [] });
    } finally {
      setBillBusy('');
    }
  }

  const columns = [
    {
      key: 'pick',
      label: '',
      render: (r) => (
        <input
          type="checkbox"
          checked={picked.includes(r.id)}
          onChange={() => togglePick(r.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${r.id}`}
        />
      ),
    },
    { key: 'id', label: 'TX Ref' },
    { key: 'client_name', label: 'Client' },
    { key: 'counterparty', label: 'Counterparty' },
    { key: 'oa_type', label: 'OA Type', render: r => <Badge type="primary">{r.oa_type}</Badge> },
    { key: 'quantum_mw', label: 'Quantum (MW)' },
    { key: 'sale_rate_per_unit', label: 'Sale Rate (₹)', render: r => {
      const sale = r.sale_rate_per_unit ?? r.tariff_per_unit;
      const margin = r.trading_margin_per_unit;
      return (
        <span>
          {sale != null ? Number(sale).toFixed(3) : '—'}
          {margin != null && (
            <span style={{ fontSize: 11, color: 'var(--slate-500)', marginLeft: 6 }}>
              (buy {r.purchase_rate_per_unit != null ? Number(r.purchase_rate_per_unit).toFixed(3) : '—'} + {Number(margin).toFixed(3)})
            </span>
          )}
        </span>
      );
    } },
    { key: 'status', label: 'Status', render: r => <Badge type={r.status === 'ACTIVE' ? 'success' : 'neutral'}>{r.status}</Badge> },
    { key: 'noar_sla', label: 'OA Approval SLA', render: r => <SlaChip sla={r.noar_sla} /> },
    { key: 'actions', label: 'Actions', render: r => <button className="btn btn-outline" onClick={() => setSelectedTx(r)}>Manage Schedules</button> }
  ];

  if (loading) return <div className="page-loading">Loading transactions...</div>;

  return (
    <div style={{ padding: 20 }}>
      <PageHeader 
        title="Bilateral Transactions & OA" 
        actions={
          <div style={{ display: 'flex', gap: 10 }}>
            {wbesStatus?.enabled && (
              <button className="btn btn-secondary" onClick={() => { setSyncModalOpen(true); setSyncResult(null); }}>
                Sync NOAR Schedules
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              New Bilateral Deal
            </button>
          </div>
        }
      />

      {/* Open-access approval SLA at portfolio level. */}
      {sla && (
        <Card>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>Pending approvals</div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{sla.pending_total}</div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>
                {sla.counts.ON_TRACK} on track · <span style={{ color: '#92400e' }}>{sla.counts.AT_RISK} at risk</span> ·{' '}
                <span style={{ color: '#991b1b' }}>{sla.counts.BREACHED} overdue</span>
                {sla.counts.REJECTED > 0 && (
                  <> · <span style={{ color: '#9a3412' }}>{sla.counts.REJECTED} rejected</span></>
                )}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>On-time rate</div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>
                {sla.on_time_rate_pct === null ? '—' : `${sla.on_time_rate_pct}%`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>
                {sla.counts.MET + sla.counts.MISSED} decided ({sla.counts.MISSED} missed)
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>Avg approval time</div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>
                {sla.avg_approval_days === null ? '—' : `${sla.avg_approval_days}d`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>
                Targets: {Object.entries(sla.targets).map(([k, v]) => `${k} ${v}d`).join(' · ')}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignSelf: 'center' }}>
              <button className="btn btn-outline btn-sm"
                onClick={() => download(api.bilateral.downloadNoarTimelineCsv, `SJVN_NOAR_Timeline_${new Date().toISOString().slice(0, 10)}.csv`)}>
                Timeline CSV
              </button>
              <button className="btn btn-outline btn-sm"
                onClick={() => download(api.bilateral.downloadNoarReportPdf, `SJVN_NOAR_Approval_Report_${new Date().toISOString().slice(0, 10)}.pdf`)}>
                Approval Report PDF
              </button>
            </div>
            {sla.needs_attention.length > 0 && (
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontSize: 12, color: 'var(--slate-500)', marginBottom: 4 }}>Needs attention</div>
                {sla.needs_attention.slice(0, 4).map((a) => (
                  <div key={a.id} style={{ fontSize: 12, marginBottom: 2 }}>
                    <span style={{ color: a.state === 'BREACHED' ? '#991b1b' : '#92400e' }}>●</span>{' '}
                    {a.counterparty} — {a.elapsed_days}d of {a.target_days}d ({a.noar_contract_no || a.id})
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Bulk NOAR step. Preview first — a batch usually contains rows that
          cannot make the requested move, and they are skipped rather than
          failing the whole run. */}
      {picked.length > 0 && (
        <Card>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13, marginBottom: 8 }}>{picked.length} selected</strong>
            <Field label="Move to">
              <select className="input" value={bulkTo} onChange={(e) => { setBulkTo(e.target.value); setBulkPreview(null); }}>
                <option value="FORMAT_D_PREPARED">Format-D prepared</option>
                <option value="SUBMITTED">Submitted to NOAR (incl. resubmit)</option>
                <option value="APPROVED">Approved by NLDC</option>
                <option value="REJECTED">Rejected by NLDC</option>
              </select>
            </Field>
            {bulkTo === 'REJECTED' && (
              <>
                <Field label="Reason category">
                  <select className="input" value={bulkReason.rejection_category}
                    onChange={(e) => setBulkReason({ ...bulkReason, rejection_category: e.target.value })}>
                    <option value="">— not specified —</option>
                    {rejectReasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                </Field>
                <Field label="What NLDC said" required>
                  <input type="text" className="input" style={{ minWidth: 300 }}
                    placeholder="Shared reason for all selected"
                    value={bulkReason.rejection_reason}
                    onChange={(e) => setBulkReason({ ...bulkReason, rejection_reason: e.target.value })} />
                </Field>
              </>
            )}
            <button className="btn btn-outline" style={{ marginBottom: 4 }} disabled={bulkBusy} onClick={() => runBulk(true)}>Preview</button>
            {/* Only a fresh preview enables Apply: once a run completes the
                selection has changed underneath it, so the old counts no
                longer describe what a second click would do. */}
            <button
              className="btn btn-primary"
              style={{ marginBottom: 4 }}
              disabled={bulkBusy || !bulkPreview?.dry_run || !bulkPreview.will_apply}
              onClick={() => runBulk(false)}
            >
              Apply to {bulkPreview?.dry_run ? bulkPreview.will_apply : 0}
            </button>
            <button className="btn btn-outline" style={{ marginBottom: 4 }} onClick={() => { setPicked([]); setBulkPreview(null); }}>Clear</button>
          </div>

          {bulkPreview && (
            <div style={{ marginTop: 12 }}>
              {bulkPreview.error ? (
                <div style={{ color: '#b00', fontSize: 13 }}>{bulkPreview.error}</div>
              ) : (
                <>
                  <div style={{ fontSize: 13, marginBottom: 6 }}>
                    {bulkPreview.dry_run
                      ? `${bulkPreview.will_apply} of ${bulkPreview.requested} can move · ${bulkPreview.skipped} skipped`
                      : ` ${bulkPreview.applied} moved · ${bulkPreview.skipped} skipped`}
                  </div>
                  {bulkPreview.results.map((r) => (
                    <div key={r.id} style={{ fontSize: 12, color: r.ok ? '#166534' : '#92400e' }}>
                      {r.ok ? '' : '•'} {r.id} ({r.counterparty}) — {r.ok ? `${r.from} → ${r.to}` : r.reason}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </Card>
      )}

      <Card>
        <Table columns={columns} data={rows} loading={loading} />
      </Card>

      {showCreate && (
        <Modal open={true} onClose={() => setShowCreate(false)} title="Create Bilateral Transaction" width={800}>
          <form onSubmit={handleCreate}>
            <FormSection title="Contract Details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 15 }}>
                <Field label="Contract Types *"><input type="text" className="input" value={form.contract_type} disabled /></Field>
                <Field label="Transaction Type *">
                  <select className="input" value={form.transaction_type} onChange={e => setForm({...form, transaction_type: e.target.value})}>
                    <option value="">Select</option>
                    <option value="Bilateral">Bilateral</option>
                  </select>
                </Field>
                <Field label="LoA/Contract No *"><input type="text" className="input" value={form.loa_no} onChange={e => setForm({...form, loa_no: e.target.value})} /></Field>
                <Field label="PPA/No/MOU No *"><input type="text" className="input" value={form.ppa_no} onChange={e => setForm({...form, ppa_no: e.target.value})} /></Field>
                <Field label="Start Date Of Contract *"><input type="date" className="input" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} /></Field>
                <Field label="End Date Of Contract *"><input type="date" className="input" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} /></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 15, marginBottom: 15 }}>
                <Field label="Compensation(%) *"><input type="number" className="input" value={form.compensation} onChange={e => setForm({...form, compensation: e.target.value})} /></Field>
                <Field label="Late Payment Surcharge(LPS)(%) *"><input type="number" className="input" value={form.late_payment_surcharge} onChange={e => setForm({...form, late_payment_surcharge: e.target.value})} /></Field>
                <Field label="Rebate(%) *"><input type="number" className="input" value={form.rebate} onChange={e => setForm({...form, rebate: e.target.value})} /></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                <Field label="Type of Contract *">
                  <div style={{ display: 'flex', gap: 15, height: '36px', alignItems: 'center' }}>
                    <label style={{ display: 'flex', gap: 4 }}><input type="radio" name="type_of_contract" checked={form.type_of_contract === 'Purchase Side'} onChange={() => setForm({...form, type_of_contract: 'Purchase Side'})} /> Purchase Side</label>
                    <label style={{ display: 'flex', gap: 4 }}><input type="radio" name="type_of_contract" checked={form.type_of_contract === 'Sell Side'} onChange={() => setForm({...form, type_of_contract: 'Sell Side'})} /> Sell Side</label>
                  </div>
                </Field>
                <Field label="Product *"><input type="text" className="input" value={form.product} onChange={e => setForm({...form, product: e.target.value})} /></Field>
              </div>
            </FormSection>

            <FormSection title="Client Details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 15 }}>
                <Field label="Supplier Name *"><input type="text" className="input" value={form.supplier_name} onChange={e => setForm({...form, supplier_name: e.target.value})} /></Field>
                <Field label="Supplier Id *"><input type="text" className="input" value={form.supplier_id} placeholder="client id of seller" disabled style={{ background: '#f8fafc' }} /></Field>
                <Field label="Concerned SLDC *"><input type="text" className="input" value={form.supplier_sldc} onChange={e => setForm({...form, supplier_sldc: e.target.value})} /></Field>
                <Field label="Region *"><input type="text" className="input" value={form.supplier_region} onChange={e => setForm({...form, supplier_region: e.target.value})} /></Field>
              </div>
              <Field label="Injecting Point *"><input type="text" className="input" value={form.injecting_point} onChange={e => setForm({...form, injecting_point: e.target.value})} /></Field>
            </FormSection>

            <FormSection title="Procurer Details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 15 }}>
                <Field label="Procurer Name *"><input type="text" className="input" value={form.procurer_name} onChange={e => setForm({...form, procurer_name: e.target.value})} /></Field>
                <Field label="Procurer ID *"><input type="text" className="input" value={form.procurer_id} placeholder="client id of buyer" disabled style={{ background: '#f8fafc' }} /></Field>
                <Field label="Concerned SLDC *"><input type="text" className="input" value={form.procurer_sldc} onChange={e => setForm({...form, procurer_sldc: e.target.value})} /></Field>
                <Field label="Region *"><input type="text" className="input" value={form.procurer_region} onChange={e => setForm({...form, procurer_region: e.target.value})} /></Field>
              </div>
              <Field label="Drawal Point *"><input type="text" className="input" value={form.drawal_point} onChange={e => setForm({...form, drawal_point: e.target.value})} /></Field>
            </FormSection>

            <FormSection title="Order Details">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: '800px', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                  <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <tr>
                      <th colSpan="2" style={{ padding: '8px', borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>Date</th>
                      <th colSpan="2" style={{ padding: '8px', borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>Hours</th>
                      <th style={{ padding: '8px' }}>Rate Type</th>
                      <th style={{ padding: '8px' }}>Rate (INR/MW) *</th>
                      <th style={{ padding: '8px' }}>Quantum (MW) *</th>
                      <th style={{ padding: '8px' }}>Variation</th>
                      <th style={{ padding: '8px', width: 60, textAlign: 'center' }}>Action</th>
                    </tr>
                    <tr style={{ color: 'var(--slate-500)', fontWeight: 'normal', fontSize: 11 }}>
                      <th style={{ padding: '4px 8px' }}>From *</th>
                      <th style={{ padding: '4px 8px', borderRight: '1px solid #e2e8f0' }}>To *</th>
                      <th style={{ padding: '4px 8px' }}>From *</th>
                      <th style={{ padding: '4px 8px', borderRight: '1px solid #e2e8f0' }}>To *</th>
                      <th></th><th></th><th></th><th></th>
                      <th style={{ textAlign: 'center' }}><button type="button" className="btn btn-sm btn-outline" style={{ padding: '2px 6px', fontSize: 14 }} onClick={addOrderRow}>+</button></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.order_details.map((row, idx) => (
                      <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '4px' }}><input type="date" className="input" style={{ width: 130, padding: 4 }} value={row.date_from} onChange={e => updateOrderRow(idx, 'date_from', e.target.value)} /></td>
                        <td style={{ padding: '4px', borderRight: '1px solid #e2e8f0' }}><input type="date" className="input" style={{ width: 130, padding: 4 }} value={row.date_to} onChange={e => updateOrderRow(idx, 'date_to', e.target.value)} /></td>
                        <td style={{ padding: '4px' }}><input type="time" className="input" style={{ width: 100, padding: 4 }} value={row.time_from} onChange={e => updateOrderRow(idx, 'time_from', e.target.value)} /></td>
                        <td style={{ padding: '4px', borderRight: '1px solid #e2e8f0' }}><input type="time" className="input" style={{ width: 100, padding: 4 }} value={row.time_to} onChange={e => updateOrderRow(idx, 'time_to', e.target.value)} /></td>
                        <td style={{ padding: '4px' }}>
                          <select className="input" style={{ padding: 4 }} value={row.rate_type} onChange={e => updateOrderRow(idx, 'rate_type', e.target.value)}>
                            <option value="">Select</option>
                            <option value="Fixed">Fixed</option>
                            <option value="Variable">Variable</option>
                          </select>
                        </td>
                        <td style={{ padding: '4px' }}><input type="number" className="input" style={{ padding: 4 }} value={row.rate} onChange={e => updateOrderRow(idx, 'rate', e.target.value)} /></td>
                        <td style={{ padding: '4px' }}><input type="number" className="input" style={{ padding: 4 }} value={row.quantum} onChange={e => updateOrderRow(idx, 'quantum', e.target.value)} /></td>
                        <td style={{ padding: '4px' }}><input type="text" className="input" style={{ padding: 4 }} value={row.variation} onChange={e => updateOrderRow(idx, 'variation', e.target.value)} /></td>
                        <td style={{ padding: '4px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button type="button" className="btn btn-sm btn-outline" style={{ padding: '2px 6px', fontSize: 14, marginRight: 4 }} onClick={addOrderRow}>+</button>
                          <button type="button" className="btn btn-sm btn-outline" style={{ padding: '2px 8px', fontSize: 14, color: 'var(--red)' }} onClick={() => removeOrderRow(idx)}>-</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </FormSection>

            <FormSection title="Route Details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                <Field label="Route *"><input type="text" className="input" value={form.route} onChange={e => setForm({...form, route: e.target.value})} /></Field>
                <Field label="Alternate Route *"><input type="text" className="input" value={form.alternate_route} onChange={e => setForm({...form, alternate_route: e.target.value})} /></Field>
              </div>
            </FormSection>

            <FormSection title="Renewable Details">
              <Field label="Is source of energy renewable? *">
                <div style={{ display: 'flex', gap: 15, height: '36px', alignItems: 'center' }}>
                  <label style={{ display: 'flex', gap: 4 }}><input type="radio" name="is_renewable" checked={form.is_renewable === 'Yes'} onChange={() => setForm({...form, is_renewable: 'Yes'})} /> Yes</label>
                  <label style={{ display: 'flex', gap: 4 }}><input type="radio" name="is_renewable" checked={form.is_renewable === 'No'} onChange={() => setForm({...form, is_renewable: 'No'})} /> No</label>
                </div>
              </Field>
            </FormSection>

            <FormSection title="Billing Cycle">
              <Field label="Billing Type *">
                <select className="input" value={form.billing_type} onChange={e => setForm({...form, billing_type: e.target.value})}>
                  <option value="">Select</option>
                  <option value="Weekly">Weekly</option>
                  <option value="Monthly">Monthly</option>
                </select>
              </Field>
            </FormSection>

            <FormSection title="Fee and Charges">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 40px', marginBottom: 20 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <BearerRadio label="ISTS Transmission Charges" field="ists_charges_bearer" form={form} setForm={setForm} />
                  <BearerRadio label="State Operating Charges" field="state_operating_bearer" form={form} setForm={setForm} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <BearerRadio label="State Transmission Charges" field="state_transmission_charges_bearer" form={form} setForm={setForm} />
                  <BearerRadio label="DIS Operating Charges" field="dis_operating_bearer" form={form} setForm={setForm} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                  <BearerRadio label="Distribution Wheeling Charge" field="distribution_wheeling_bearer" form={form} setForm={setForm} />
                  <BearerRadio label="NOAR Application Fee" field="noar_application_bearer" form={form} setForm={setForm} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                  <BearerRadio label="RLDC Operating Charges" field="rldc_operating_bearer" form={form} setForm={setForm} />
                  <BearerRadio label="SLDC Consent Fee" field="sldc_consent_bearer" form={form} setForm={setForm} />
                </div>
              </div>
              <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: 15, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 15 }}>
                <Field label="Client Registration Fee (Rs.) *"><input type="number" className="input" value={form.client_registration_fee} onChange={e => setForm({...form, client_registration_fee: e.target.value})} /></Field>
                <Field label="Trading Margin (Rs./KWh) *"><input type="number" className="input" value={form.trading_margin} onChange={e => setForm({...form, trading_margin: e.target.value})} /></Field>
                <Field label="Application Fee *"><input type="number" className="input" value={form.application_fee} onChange={e => setForm({...form, application_fee: e.target.value})} /></Field>
              </div>
            </FormSection>

            <FormSection title="Remarks">
              <Field label="Remarks *">
                <textarea className="input" rows="3" placeholder="remarks" value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})}></textarea>
              </Field>
            </FormSection>

            {error && <div style={{ color: 'red', marginBottom: 15, background: '#fee2e2', padding: 10, borderRadius: 4 }}>{error}</div>}
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, position: 'sticky', bottom: 0, background: '#fff', padding: '15px 0', borderTop: '1px solid #e2e8f0' }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Create Transaction</button>
            </div>
          </form>
        </Modal>
      )}

      {selectedTx && (
        <Modal open={true} onClose={() => setSelectedTx(null)} title={`Bilateral: ${selectedTx.counterparty}`} width={1000}>
          <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <p><strong>OA Type:</strong> {selectedTx.oa_type} {selectedTx.is_standing_clearance ? '(Standing Clearance)' : ''}</p>
              <p><strong>Contract Ref:</strong> {selectedTx.loi_contract_ref}</p>
              <p><strong>Total MW:</strong> {selectedTx.quantum_mw}</p>
            </div>
            <div style={{ flex: 1 }}>
              <p>
                <strong>Total Losses:</strong> {totalLosses(selectedTx).toFixed(2)}%
                <span style={{ color: 'var(--slate-500)', fontSize: 12 }}>
                  {' '}(inj {Number(selectedTx.loss_injection_state) || 0} · ISTS {Number(selectedTx.loss_inter_state) || 0} · drawee {Number(selectedTx.loss_drawee_state) || 0})
                </span>
              </p>
              <p><strong>Period:</strong> {selectedTx.start_date} to {selectedTx.end_date}</p>
            </div>
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', marginBottom: 10 }}>
                <h4 style={{ margin: 0 }}>Schedules (15-min Blocks)</h4>
                <button className="btn btn-primary" onClick={() => setShowScheduleGrid(true)}>+ Generate 96-Block Schedule</button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16, padding: '10px 14px', background: 'var(--slate-50)', borderRadius: 8, border: '1px solid var(--slate-200)' }}>
            <strong style={{ fontSize: 13 }}>NOAR Portal:</strong>
            <Badge status={selectedTx.noar_status === 'APPROVED' ? 'ACTIVE' : selectedTx.noar_status === 'NOT_INITIATED' ? 'DRAFT' : 'PENDING'} label={(selectedTx.noar_status || 'NOT_INITIATED').replace(/_/g, ' ')} />
            {selectedTx.noar_contract_no && <span style={{ fontSize: 12, color: 'var(--slate-600)' }}>Contract: <strong>{selectedTx.noar_contract_no}</strong></span>}
            {selectedTx.noar_sla?.state && selectedTx.noar_sla.state !== 'NOT_APPLICABLE' && (
              <SlaChip sla={selectedTx.noar_sla} />
            )}
            {selectedTx.noar_timeline?.hours_in_current_status != null && (
              <span style={{ fontSize: 12, color: 'var(--slate-600)' }}>
                In this status: <strong>{fmtDuration(selectedTx.noar_timeline.hours_in_current_status)}</strong>
              </span>
            )}
            {selectedTx.noar_timeline?.approval_turnaround_hours != null && (
              <span style={{ fontSize: 12, color: '#166534' }}>
                Approval took <strong>{fmtDuration(selectedTx.noar_timeline.approval_turnaround_hours)}</strong>
              </span>
            )}
            {selectedTx.noar_resubmit_count > 0 && (
              <span style={{ fontSize: 12, color: '#9a3412' }}>
                Resubmitted {selectedTx.noar_resubmit_count}×
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-outline" onClick={() => handleDownloadFormatD(selectedTx)}>Download Format-D</button>
              <button className="btn btn-sm btn-outline" onClick={() => handleDownloadLoi(selectedTx)}>Download LoI (PDF)</button>
              {selectedTx.noar_status === 'SUBMITTED' && (
                <button className="btn btn-sm btn-outline" onClick={() => setRejectForm({ rejection_category: '', rejection_reason: '' })}>
                  Record Rejection
                </button>
              )}
              {selectedTx.noar_status !== 'APPROVED' && (
                <button className="btn btn-sm btn-primary" onClick={() => handleAdvanceNoar(selectedTx)}>
                  {selectedTx.noar_status === 'REJECTED' ? 'Resubmit to NOAR →' : 'Advance NOAR →'}
                </button>
              )}
            </div>
          </div>

          {/* Why NOAR sent it back, so the desk knows what to fix before resubmitting. */}
          {selectedTx.noar_status === 'REJECTED' && selectedTx.noar_rejection_reason && (
            <div style={{ marginBottom: 16, padding: '10px 14px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8 }}>
              <strong style={{ fontSize: 13, color: '#9a3412' }}>Rejected by NLDC</strong>
              {selectedTx.noar_rejection_category && (
                <span style={{ fontSize: 12, color: '#9a3412' }}>
                  {' '}· {rejectReasons.find((r) => r.code === selectedTx.noar_rejection_category)?.label || selectedTx.noar_rejection_category}
                </span>
              )}
              <div style={{ fontSize: 13, color: '#7c2d12', marginTop: 3 }}>{selectedTx.noar_rejection_reason}</div>
            </div>
          )}

          {rejectForm && (
            <form onSubmit={handleRejectNoar} style={{ marginBottom: 16, padding: '12px 14px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8 }}>
              <h4 style={{ marginBottom: 10 }}>Record NOAR Rejection</h4>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <Field label="Reason category">
                  <select className="input" value={rejectForm.rejection_category}
                    onChange={(e) => setRejectForm({ ...rejectForm, rejection_category: e.target.value })}>
                    <option value="">— not specified —</option>
                    {rejectReasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                </Field>
                <Field label="What NLDC said" required>
                  <input type="text" className="input" style={{ minWidth: 320 }} required
                    placeholder="e.g. Format-D block totals do not match contract quantum"
                    value={rejectForm.rejection_reason}
                    onChange={(e) => setRejectForm({ ...rejectForm, rejection_reason: e.target.value })} />
                </Field>
                <button type="button" className="btn btn-outline" style={{ marginBottom: 4 }} onClick={() => setRejectForm(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ marginBottom: 4 }}>Save Rejection</button>
              </div>
            </form>
          )}

          {/* Open-access approval tracking — who moved it, when, and how long each step took. */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 10, borderBottom: '1px solid #eee', paddingBottom: 5 }}>
              Open Access Approval Timeline
            </h4>
            {!selectedTx.noar_timeline?.has_history ? (
              <p style={{ color: '#777', fontSize: 13 }}>
                No transitions recorded yet. This transaction currently sits at{' '}
                <strong>{NOAR_STEP_LABEL[selectedTx.noar_status] || selectedTx.noar_status}</strong>
                {selectedTx.noar_status !== 'NOT_INITIATED' && ' — it reached this status before timeline tracking was added, so earlier step times are not known'}.
                Use <strong>Advance NOAR</strong> to record the next step.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {selectedTx.noar_timeline.entries.map((e, i) => (
                  <div key={e.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 18 }}>
                      <span style={{
                        width: 11, height: 11, borderRadius: '50%', marginTop: 5,
                        background: e.status_to === 'APPROVED' ? 'var(--green-strong)' : '#2563eb',
                      }} />
                      {i < selectedTx.noar_timeline.entries.length - 1 && (
                        <span style={{ width: 2, flex: 1, minHeight: 26, background: 'var(--slate-300)' }} />
                      )}
                    </div>
                    <div style={{ paddingBottom: 14, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {NOAR_STEP_LABEL[e.status_to] || e.status_to}
                        {e.hours_in_previous_status != null && (
                          <span style={{ fontWeight: 400, color: 'var(--slate-500)' }}>
                            {' '}· took {fmtDuration(e.hours_in_previous_status)}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>
                        {fmtStamp(e.changed_at)}{e.changed_by_name ? ` · ${e.changed_by_name}` : ''}
                        {e.noar_contract_no ? ` · ${e.noar_contract_no}` : ''}
                      </div>
                      {e.note && <div style={{ fontSize: 12, color: 'var(--slate-600)', marginTop: 2 }}>{e.note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <h4 style={{ marginBottom: 10, borderBottom: '1px solid #eee', paddingBottom: 5 }}>Daily Schedules & DSM Tracker (15-min blocks · Format-D)</h4>
          {selectedTx.schedules?.length === 0 ? <p style={{ color: '#777' }}>No schedules created yet.</p> : (
            <Table 
              columns={[
                { key: 'schedule_date', label: 'Date' },
                { key: 'approved_mw', label: 'Approved MW' },
                { key: 'actual_mw', label: 'Actual MW', render: r => r.actual_mw === null ? '-' : r.actual_mw },
                { key: 'curtailed_mw', label: 'Curtailed', render: r => r.curtailed_mw > 0 ? <span style={{color: 'red'}}>{r.curtailed_mw} MW</span> : '-' },
                { key: 'deviation_mw', label: 'Deviation', render: r => r.deviation_mw ? <Badge type={Math.abs(r.deviation_mw) > 2 ? 'danger' : 'warning'}>{r.deviation_mw} MW</Badge> : '-' },
                { key: 'dsm_penalty_amount', label: 'DSM Penalty', render: r => r.dsm_penalty_amount ? `₹${fmtNumber(r.dsm_penalty_amount)}` : '-' },
                { key: 'status', label: 'Status', render: r => <Badge type={r.status === 'APPROVED' ? 'success' : 'neutral'}>{r.status}</Badge> },
              ]}
              data={selectedTx.schedules || []}
            />
          )}

          {selectedTx.schedules?.map(sched => (
            <div key={sched.id} style={{ marginTop: 20, padding: 15, background: '#f9f9f9', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <strong>Multi-Hop Approval: {sched.schedule_date}</strong>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => handleCurtail(sched.id)}>Grid Curtailment</button>
                  <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => handleRecordActuals(sched.id)}>Record Actuals (DSM)</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 15 }}>
                {sched.approvals?.map(app => (
                  <div key={app.id} style={{ flex: 1, padding: 10, background: '#fff', border: '1px solid #ddd', borderRadius: 4 }}>
                    <div style={{ fontSize: 11, color: '#777', marginBottom: 5 }}>{app.node_type}</div>
                    <Badge type={app.status === 'APPROVED' ? 'success' : app.status === 'REJECTED' ? 'danger' : 'warning'}>{app.status}</Badge>
                    {app.status === 'PENDING' && (
                      <div style={{ marginTop: 10, display: 'flex', gap: 5 }}>
                        <button style={{ flex: 1, background: '#e0ffe0', border: '1px solid #8f8', borderRadius: 3, cursor: 'pointer' }} onClick={() => handleNodeApproval(sched.id, app.node_type, 'APPROVED')}></button>
                        <button style={{ flex: 1, background: '#ffe0e0', border: '1px solid #f88', borderRadius: 3, cursor: 'pointer' }} onClick={() => handleNodeApproval(sched.id, app.node_type, 'REJECTED')}></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Settle the delivered energy for a supply period, then raise the three
              bills off it. The preview and the bills read the same computation,
              so what is shown here is what gets invoiced. */}
          <div style={{ marginTop: 24 }}>
            <h4 style={{ marginBottom: 10, borderBottom: '1px solid #eee', paddingBottom: 5 }}>
              Settlement &amp; Billing
            </h4>

            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
              <Field label="Supply from">
                <input type="date" className="input" value={billPeriod.from}
                  onChange={(e) => setBillPeriod({ ...billPeriod, from: e.target.value })} />
              </Field>
              <Field label="Supply to">
                <input type="date" className="input" value={billPeriod.to}
                  onChange={(e) => setBillPeriod({ ...billPeriod, to: e.target.value })} />
              </Field>
              <button type="button" className="btn btn-outline" style={{ marginBottom: 4 }}
                onClick={() => refreshSettlement(selectedTx.id)} disabled={settleBusy}>
                {settleBusy ? 'Settling…' : 'Recalculate'}
              </button>
              {(billPeriod.from || billPeriod.to) && (
                <button type="button" className="btn btn-outline" style={{ marginBottom: 4 }}
                  onClick={() => { setBillPeriod({ from: '', to: '' }); refreshSettlement(selectedTx.id, { from: '', to: '' }); }}>
                  Whole contract
                </button>
              )}
            </div>

            {!settlement ? (
              <p style={{ color: '#777', fontSize: 13 }}>
                {settleBusy ? 'Computing the settled position…' : 'No settled position yet — punch schedules first.'}
              </p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
                  {[
                    ['Delivered', `${fmtNumber(settlement.energy.delivered_mwh)} MWh`, `scheduled ${fmtNumber(settlement.energy.scheduled_mwh)}`],
                    ['Injected', `${fmtNumber(settlement.losses.injected_mwh)} MWh`, `losses ${fmtNumber(settlement.losses.loss_mwh)} MWh`],
                    ['Energy value', `₹${fmtNumber(settlement.money.sale_value)}`, `@ ₹${settlement.rates.sale_rate_per_unit}/kWh`],
                    ['Trading margin', `₹${fmtNumber(settlement.money.trading_margin)}`, `@ ₹${settlement.rates.trading_margin_per_unit}/kWh`],
                    ['DSM charges', `₹${fmtNumber(settlement.money.dsm_penalty_amount)}`, `deviation ${fmtNumber(settlement.energy.deviation_mwh)} MWh`],
                  ].map(([label, value, sub]) => (
                    <div key={label} style={{ padding: '10px 12px', background: 'var(--slate-50)', border: '1px solid var(--slate-200)', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--slate-500)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
                      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{value}</div>
                      <div style={{ fontSize: 11, color: 'var(--slate-500)' }}>{sub}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                  <Badge type={settlement.energy.is_final ? 'success' : 'warning'}>
                    {settlement.energy.is_final ? 'FINAL' : 'PROVISIONAL'}
                  </Badge>
                  <span style={{ fontSize: 12, color: 'var(--slate-600)' }}>
                    {settlement.energy.metered_blocks} of {settlement.energy.blocks} blocks metered
                    {settlement.energy.days ? ` · ${settlement.energy.days} day(s)` : ''}
                    {settlement.energy.period_from ? ` · ${settlement.energy.period_from} to ${settlement.energy.period_to}` : ''}
                  </span>
                </div>

                {/* Energy cannot be billed until the portal has granted open access. */}
                {!['APPROVED', 'PARTIAL'].includes(selectedTx.open_access_status) && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, fontSize: 12, color: '#9a3412' }}>
                    Open access is <strong>{selectedTx.open_access_status}</strong> — the energy bill unlocks once NOAR approves it.
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    ['BILATERAL_ENERGY', 'Raise Energy Bill'],
                    ['BILATERAL_OA', 'Raise Open Access Bill'],
                    ['BILATERAL_SLDC', 'Raise SLDC Consent Bill'],
                  ].map(([type, label]) => (
                    <button key={type} type="button" className="btn btn-primary"
                      disabled={billBusy === type || (type === 'BILATERAL_ENERGY' && !['APPROVED', 'PARTIAL'].includes(selectedTx.open_access_status))}
                      onClick={() => handleRaiseBill(type)}>
                      {billBusy === type ? 'Raising…' : label}
                    </button>
                  ))}
                </div>

                {billMsg && (
                  <div style={{
                    marginTop: 12, padding: '10px 12px', borderRadius: 6, fontSize: 13,
                    background: billMsg.ok ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${billMsg.ok ? '#bbf7d0' : '#fecaca'}`,
                    color: billMsg.ok ? '#166534' : '#991b1b',
                  }}>
                    {billMsg.text}
                    {billMsg.warnings?.length > 0 && (
                      <ul style={{ margin: '6px 0 0 18px', fontSize: 12 }}>
                        {billMsg.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    )}
                  </div>
                )}

                <div style={{ marginTop: 18 }}>
                  <strong style={{ fontSize: 13 }}>Bills raised against this contract</strong>
                  {txInvoices.length === 0 ? (
                    <p style={{ color: '#777', fontSize: 13, marginTop: 6 }}>None yet.</p>
                  ) : (
                    <div style={{ marginTop: 8 }}>
                      <Table
                        columns={[
                          { key: 'invoice_no', label: 'Invoice No' },
                          { key: 'bill_type', label: 'Type', render: (r) => r.bill_type.replace('BILATERAL_', '') },
                          { key: 'invoice_amount', label: 'Amount', render: (r) => `₹${fmtNumber(r.invoice_amount)}` },
                          { key: 'quantum_mwh', label: 'MWh', render: (r) => (r.quantum_mwh == null ? '-' : fmtNumber(r.quantum_mwh)) },
                          { key: 'supply_from_date', label: 'Supply', render: (r) => (r.supply_from_date ? `${r.supply_from_date} → ${r.supply_to_date}` : '-') },
                          { key: 'invoice_due_date', label: 'Due' },
                          { key: 'settlement_basis', label: 'Basis', render: (r) => <Badge type={r.settlement_basis === 'FINAL' ? 'success' : 'warning'}>{r.settlement_basis || 'MANUAL'}</Badge> },
                        ]}
                        data={txInvoices}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div style={{ marginTop: 24 }}>
            <DocumentManager
              moduleName="BILATERAL"
              title="Bilateral Documents (LOI, Grid Approvals, Notices)"
            />
          </div>

        </Modal>
      )}

      {showScheduleGrid && selectedTx && (
        <ScheduleGridModal 
          tx={selectedTx} 
          onClose={() => setShowScheduleGrid(false)} 
          onSubmit={handleScheduleSubmit} 
        />
      )}

      {syncModalOpen && (
        <Modal open={true} onClose={() => setSyncModalOpen(false)} title="Sync NOAR Schedules">
          <div style={{ padding: '10px 0' }}>
            {!syncResult ? (
              <form onSubmit={handleWbesSync}>
                <p style={{ marginBottom: 15, color: 'var(--slate-600)' }}>
                  Pull approved 15-minute block schedules from NOAR / State WBES for a specific delivery date. 
                  Schedules will be automatically matched to your contracts using the NOAR Contract / Approval No.
                  {!wbesStatus?.live && <><br/><br/><strong>Note:</strong> WBES is running in Stub Mode. A sample schedule will be returned.</>}
                </p>
                <Field label="Delivery Date" required>
                  <input type="date" className="input" value={syncForm.date} onChange={(e) => setSyncForm({ ...syncForm, date: e.target.value })} required />
                </Field>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                  <button type="button" className="btn btn-outline" onClick={() => setSyncModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={syncBusy}>
                    {syncBusy ? 'Syncing...' : 'Sync Schedules'}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <p style={{ color: 'var(--green-strong)', fontWeight: 600, marginBottom: 15 }}> Sync Complete</p>
                <ul style={{ marginBottom: 20, lineHeight: 1.6, color: 'var(--slate-700)' }}>
                  <li><strong>Schedules Received:</strong> {syncResult.lines_received}</li>
                  <li><strong>Matched to Contracts:</strong> {syncResult.matched?.length || 0}</li>
                  <li><strong>Unmatched:</strong> {syncResult.unmatched?.length || 0}</li>
                  <li><strong>Blocks Written:</strong> {syncResult.blocks_written}</li>
                </ul>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-primary" onClick={() => setSyncModalOpen(false)}>Close</button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
