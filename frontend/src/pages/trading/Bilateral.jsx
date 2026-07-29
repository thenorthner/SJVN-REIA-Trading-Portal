import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';

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
};

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

  function load() {
    setLoading(true);
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

  async function handleAddSchedule(txId) {
    const mw = prompt("Enter Approved MW for the schedule:");
    if (!mw) return;
    try {
      const updated = await api.bilateral.createSchedule(txId, {
        schedule_date: new Date().toISOString().split('T')[0],
        time_block: 'Block-1',
        approved_mw: Number(mw)
      });
      setSelectedTx(updated);
      load();
    } catch (err) {
      alert("Failed to add schedule");
    }
  }

  const NOAR_FLOW = ['NOT_INITIATED', 'FORMAT_D_PREPARED', 'CONTRACT_CREATED', 'SUBMITTED', 'APPROVED'];
  async function handleAdvanceNoar(tx) {
    const idx = NOAR_FLOW.indexOf(tx.noar_status || 'NOT_INITIATED');
    const next = NOAR_FLOW[Math.min(idx + 1, NOAR_FLOW.length - 1)];
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
  async function handleDownloadFormatD(tx) {
    try {
      const blob = await api.bilateral.downloadFormatD(tx.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `FormatD_${tx.counterparty}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch (err) { alert('Failed to download Format-D'); }
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
    { key: 'id', label: 'TX Ref' },
    { key: 'client_name', label: 'Client' },
    { key: 'counterparty', label: 'Counterparty' },
    { key: 'oa_type', label: 'OA Type', render: r => <Badge type="primary">{r.oa_type}</Badge> },
    { key: 'quantum_mw', label: 'Quantum (MW)' },
    { key: 'tariff_per_unit', label: 'Tariff (₹)' },
    { key: 'status', label: 'Status', render: r => <Badge type={r.status === 'ACTIVE' ? 'success' : 'neutral'}>{r.status}</Badge> },
    { key: 'actions', label: 'Actions', render: r => <button className="btn btn-outline" onClick={() => setSelectedTx(r)}>Manage Schedules</button> }
  ];

  return (
    <div style={{ padding: 20 }}>
      <PageHeader title="Bilateral Transactions & OA" onAdd={() => setShowCreate(true)} addLabel="New Bilateral Deal" />
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
                <span style={{ color: '#64748b', fontSize: 12 }}>
                  {' '}(inj {Number(selectedTx.loss_injection_state) || 0} · ISTS {Number(selectedTx.loss_inter_state) || 0} · drawee {Number(selectedTx.loss_drawee_state) || 0})
                </span>
              </p>
              <p><strong>Period:</strong> {selectedTx.start_date} to {selectedTx.end_date}</p>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <button className="btn btn-primary" onClick={() => handleAddSchedule(selectedTx.id)}>+ Add Schedule</button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16, padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <strong style={{ fontSize: 13 }}>NOAR Portal:</strong>
            <Badge status={selectedTx.noar_status === 'APPROVED' ? 'ACTIVE' : selectedTx.noar_status === 'NOT_INITIATED' ? 'DRAFT' : 'PENDING'} label={(selectedTx.noar_status || 'NOT_INITIATED').replace(/_/g, ' ')} />
            {selectedTx.noar_contract_no && <span style={{ fontSize: 12, color: '#475569' }}>Contract: <strong>{selectedTx.noar_contract_no}</strong></span>}
            {selectedTx.noar_timeline?.hours_in_current_status != null && (
              <span style={{ fontSize: 12, color: '#475569' }}>
                In this status: <strong>{fmtDuration(selectedTx.noar_timeline.hours_in_current_status)}</strong>
              </span>
            )}
            {selectedTx.noar_timeline?.approval_turnaround_hours != null && (
              <span style={{ fontSize: 12, color: '#166534' }}>
                Approval took <strong>{fmtDuration(selectedTx.noar_timeline.approval_turnaround_hours)}</strong>
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-outline" onClick={() => handleDownloadFormatD(selectedTx)}>Download Format-D</button>
              {selectedTx.noar_status !== 'APPROVED' && <button className="btn btn-sm btn-primary" onClick={() => handleAdvanceNoar(selectedTx)}>Advance NOAR →</button>}
            </div>
          </div>

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
                        background: e.status_to === 'APPROVED' ? '#16a34a' : '#2563eb',
                      }} />
                      {i < selectedTx.noar_timeline.entries.length - 1 && (
                        <span style={{ width: 2, flex: 1, minHeight: 26, background: '#cbd5e1' }} />
                      )}
                    </div>
                    <div style={{ paddingBottom: 14, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {NOAR_STEP_LABEL[e.status_to] || e.status_to}
                        {e.hours_in_previous_status != null && (
                          <span style={{ fontWeight: 400, color: '#64748b' }}>
                            {' '}· took {fmtDuration(e.hours_in_previous_status)}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {fmtStamp(e.changed_at)}{e.changed_by_name ? ` · ${e.changed_by_name}` : ''}
                        {e.noar_contract_no ? ` · ${e.noar_contract_no}` : ''}
                      </div>
                      {e.note && <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{e.note}</div>}
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
    </div>
  );
}
