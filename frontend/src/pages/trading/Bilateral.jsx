import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';
import { ScheduleGridModal } from './ScheduleGridModal.jsx';

const EMPTY_FORM = {
  client_id: '', counterparty: '', loi_contract_ref: '', oa_type: 'STOA', is_standing_clearance: false,
  quantum_mw: '', tariff_per_unit: '', wheeling_charges: '', transmission_charges: '',
  loss_injection_state: '', loss_inter_state: '', loss_drawee_state: '', start_date: '', end_date: '',
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

/** SQLite hands back UTC without a zone marker; show it in the user's local time. */
function fmtStamp(s) {
  if (!s) return '—';
  const d = new Date(`${String(s).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function Bilateral() {
  const { user } = useAuth();
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

  function load() {
    setLoading(true);
    api.bilateral.noarSla().then(setSla).catch(() => setSla(null));
    api.bilateral.wbesStatus().then(setWbesStatus).catch(() => setWbesStatus(null));
    api.masters.lookups({ category: 'NOAR_REJECTION_REASON' }).then(setRejectReasons).catch(() => setRejectReasons([]));
    api.bilateral.list().then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, []);
  useEffect(() => { api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => {}); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.bilateral.create({
        ...form,
        quantum_mw: Number(form.quantum_mw),
        tariff_per_unit: Number(form.tariff_per_unit),
        wheeling_charges: Number(form.wheeling_charges) || 0,
        transmission_charges: Number(form.transmission_charges) || 0,
        loss_injection_state: Number(form.loss_injection_state) || 0,
        loss_inter_state: Number(form.loss_inter_state) || 0,
        loss_drawee_state: Number(form.loss_drawee_state) || 0,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create transaction.');
    }
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
      load();
    } catch (err) {
      alert("Failed to curtail");
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
    { key: 'tariff_per_unit', label: 'Tariff (₹)' },
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
                      : `✓ ${bulkPreview.applied} moved · ${bulkPreview.skipped} skipped`}
                  </div>
                  {bulkPreview.results.map((r) => (
                    <div key={r.id} style={{ fontSize: 12, color: r.ok ? '#166534' : '#92400e' }}>
                      {r.ok ? '✓' : '•'} {r.id} ({r.counterparty}) — {r.ok ? `${r.from} → ${r.to}` : r.reason}
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 20 }}>
              <Field label="Client" required>
                <select className="input" value={form.client_id} onChange={e => setForm({...form, client_id: e.target.value})} required>
                  <option value="">Select Client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Counterparty" required>
                <input type="text" className="input" value={form.counterparty} onChange={e => setForm({...form, counterparty: e.target.value})} required />
              </Field>
              <Field label="Open Access Type" required>
                <select className="input" value={form.oa_type} onChange={e => setForm({...form, oa_type: e.target.value})}>
                  <option value="STOA">STOA (Short Term)</option>
                  <option value="MTOA">MTOA (Medium Term)</option>
                  <option value="LTOA">LTOA (Long Term)</option>
                </select>
              </Field>
              <Field label="Standing Clearance?">
                <select className="input" value={form.is_standing_clearance} onChange={e => setForm({...form, is_standing_clearance: e.target.value === 'true'})}>
                  <option value="false">No (Daily Approval)</option>
                  <option value="true">Yes (Pre-approved Window)</option>
                </select>
              </Field>
              <Field label="Quantum (MW)" required>
                <input type="number" step="0.1" className="input" value={form.quantum_mw} onChange={e => setForm({...form, quantum_mw: e.target.value})} required />
              </Field>
              <Field label="Tariff (₹/unit)" required>
                <input type="number" step="0.01" className="input" value={form.tariff_per_unit} onChange={e => setForm({...form, tariff_per_unit: e.target.value})} required />
              </Field>
            </div>

            <h4 style={{ marginBottom: 10 }}>Transmission Losses (%)</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 15, marginBottom: 20 }}>
              <Field label="Injection State">
                <input type="number" step="0.1" className="input" value={form.loss_injection_state} onChange={e => setForm({...form, loss_injection_state: e.target.value})} />
              </Field>
              <Field label="Inter-State (CTU)">
                <input type="number" step="0.1" className="input" value={form.loss_inter_state} onChange={e => setForm({...form, loss_inter_state: e.target.value})} />
              </Field>
              <Field label="Drawee State">
                <input type="number" step="0.1" className="input" value={form.loss_drawee_state} onChange={e => setForm({...form, loss_drawee_state: e.target.value})} />
              </Field>
            </div>

            <h4 style={{ marginBottom: 10 }}>Duration</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 20 }}>
              <Field label="Start Date" required>
                <input type="date" className="input" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} required />
              </Field>
              <Field label="End Date" required>
                <input type="date" className="input" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} required />
              </Field>
            </div>

            {error && <div style={{ color: 'red', marginBottom: 15 }}>{error}</div>}
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
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
                        <button style={{ flex: 1, background: '#e0ffe0', border: '1px solid #8f8', borderRadius: 3, cursor: 'pointer' }} onClick={() => handleNodeApproval(sched.id, app.node_type, 'APPROVED')}>✓</button>
                        <button style={{ flex: 1, background: '#ffe0e0', border: '1px solid #f88', borderRadius: 3, cursor: 'pointer' }} onClick={() => handleNodeApproval(sched.id, app.node_type, 'REJECTED')}>✗</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

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
                <p style={{ color: 'var(--green-strong)', fontWeight: 600, marginBottom: 15 }}>✓ Sync Complete</p>
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
