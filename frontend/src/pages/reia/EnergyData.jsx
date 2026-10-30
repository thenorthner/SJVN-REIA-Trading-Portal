import React, { useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import EnergyOverview from '../../components/EnergyOverview.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, Tabs, Tab, AlertPopup, fmtNumber } from '../../components/ui.jsx';
import ModuleGuide from '../../components/ModuleGuide.jsx';
import { getGuide } from '../../content/guides/index.js';
import { SettlementTrailPanel, BfrChip } from '../../components/SettlementTrail.jsx';
import EnergyAccountUpload from '../../components/EnergyAccountUpload.jsx';
import EnergyRecordDetail, { ResponseBadge } from '../../components/EnergyRecordDetail.jsx';
import DeskTasksPanel from '../../components/DeskTasksPanel.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { actsAs } from '../../lib/rolePages.js';

// The server's REIA_WRITE group; a shorter copy here hid the buttons from REIA_CHECKER.
const CAN_WRITE = ROLE_GROUPS.REIA_WRITE;
// Phase B.2: the maker records, uploads and enters curtailment; the checker validates and locks.
const CAN_MAKE = ROLE_GROUPS.REIA_MAKE;
const CAN_CHECK = ROLE_GROUPS.REIA_CHECK;

const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const hoursIn = (ym) => { const [y, m] = String(ym).split('-').map(Number); return y && m ? new Date(Date.UTC(y, m, 0)).getUTCDate() * 24 : null; };
const capacityOf = (c) => (Number(c?.commissioned_capacity_mw) > 0 ? Number(c.commissioned_capacity_mw) : Number(c?.capacity_mw) || 0);
// Energy is recorded against a signed contract.
const recordable = (c) => !['DRAFT', 'UNDER_NEGOTIATION'].includes(c.status);

const EMPTY_FORM = { contract_id: '', period_month: '', data_type: 'PROVISIONAL', source: 'MANUAL', energy_mwh: '', availability_percent: '', peak_availability_percent: '' };

export default function EnergyData() {
  const [view, setView] = useState('main');
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filters, setFilters] = useState({ contract_id: '', period_month: '', status: '', source: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  // What went wrong on the page, and what was just done — said here, not in a browser pop-up.
  // Every error on this page is a popup; an empty message clears nothing.
  const showError = (title) => (msg) => { if (msg) setPopup({ tone: 'error', title, message: msg }); };
  const setPageError = showError('Something went wrong');
  const setError = showError('Check the upload');
  const [notice, setNotice] = useState('');
  // Errors are shown as a popup, the house rule for anything that has to be read.
  const [popup, setPopup] = useState(null);
  const [reaAccountPeriod, setReaAccountPeriod] = useState(null);
  // A lock the server will only take with a recorded reason.
  const [lockAsk, setLockAsk] = useState(null);
  // G2: certified curtailment hours (they lower CUF's possible generation, not the bill).
  const [curtail, setCurtail] = useState(null);
  const [lockReason, setLockReason] = useState('');
  const [lockError, setLockError] = useState('');
  const [busy, setBusyState] = useState(false);
  const lock = useRef(false);
  const setBusy = (on) => { lock.current = on; setBusyState(on); };
  const errOf = (err, fallback) => err?.response?.data?.error || err?.message || fallback;

  const [showAccountUpload, setShowAccountUpload] = useState(false);
  const [accountResult, setAccountResult] = useState(null);
  const [trailEnergyId, setTrailEnergyId] = useState(null);
  const [recordId, setRecordId] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  async function downloadEnergyPdf() {
    setPdfLoading(true);
    setError('');
    try {
      const params = {};
      if (filters.period_month) {
        params.from = filters.period_month;
        params.to = filters.period_month;
      }
      if (filters.contract_id) params.contract_id = filters.contract_id;
      await api.reports.energySummaryPdf(params);
    } catch (err) {
      setPageError(errOf(err, 'Failed to download energy PDF report'));
    } finally {
      setPdfLoading(false);
    }
  }

  function load(overrideFilters) {
    setLoading(true);
    const activeFilters = overrideFilters !== undefined ? overrideFilters : filters;
    const params = {};
    Object.entries(activeFilters).forEach(([k, v]) => { if (v) params[k] = v; });
    return api.energyData.list(params).then(setRows).catch((err) => setPageError(errOf(err, 'The energy records could not be loaded.'))).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filters.contract_id, filters.period_month, filters.status, filters.source]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  function openCreate() { setForm(EMPTY_FORM); setError(''); setShowCreate(true); }

  async function handleCreate(e) {
    e.preventDefault();
    if (lock.current) return;
    setError('');
    setBusy(true);
    try {
      // CUF is worked out from the energy and the capacity, on the server.
      const made = await api.energyData.create({
        ...form,
        energy_mwh: Number(form.energy_mwh),
        availability_percent: form.availability_percent ? Number(form.availability_percent) : null,
        peak_availability_percent: form.peak_availability_percent ? Number(form.peak_availability_percent) : null,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setPageError('');
      setNotice(made.replaced
        ? (made.changed === false
          ? `The ${made.period_month} figure is unchanged at ${fmtNumber(made.energy_mwh)} MWh and is a draft again. Validate it before it can be locked.`
          : `The ${made.period_month} figure was corrected to ${fmtNumber(made.energy_mwh)} MWh and is a draft again — any earlier answer from the counterparty no longer applies. Validate it before it can be locked.`)
        : `${fmtNumber(made.energy_mwh)} MWh recorded for ${made.period_month} as a draft. Validate it before it can be locked.`);
      load();
    } catch (err) {
      const data = err.response?.data;
      setPopup({ tone: 'error', title: 'The figure was not recorded', message: data?.errors?.length > 1 ? `${data.errors.length} things need attention.` : (data?.error || 'Failed to record energy data.'), items: data?.errors?.length > 1 ? data.errors : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function handleValidate(row) {
    if (lock.current) return;
    setBusy(true);
    setPageError('');
    try {
      const done = await api.energyData.validate(row.id);
      setNotice(done.status === 'VALIDATED'
        ? `${row.contract_no} ${row.period_month} validated. It has gone to the counterparty to confirm, and can now be locked.`
        : `${row.contract_no} ${row.period_month} failed validation and is marked DISPUTED — ${done.deviation_notes || 'see the Notes column'}.`);
    } catch (err) {
      setNotice('');
      setPopup({ tone: 'error', title: 'Not validated', message: errOf(err, 'This period could not be validated.') });
    } finally {
      setBusy(false);
    }
    load();
  }

  // Locking can be refused — an unvalidated period, or one the counterparty has
  // objected to. The refusal is shown; where a recorded reason lets the lock go
  // ahead anyway, the reason is asked for in the page.
  async function handleLock(row, reason) {
    if (lock.current) return;
    setBusy(true);
    setPageError('');
    setLockError('');
    try {
      await api.energyData.lock(row.id, reason ? { override_reason: reason } : undefined);
      setLockAsk(null);
      setLockReason('');
      setNotice(`${row.contract_no} ${row.period_month} locked for billing${reason ? ', with the reason on record' : ''}.${row.response_status === 'ACCEPTED' ? '' : ' The counterparty had not accepted this figure; it has been told it is locked.'}`);
    } catch (err) {
      const data = err.response?.data || {};
      if (data.hint && !reason) {
        setLockAsk({ row, error: data.error, objection: data.objection, validation: data.validation_note });
        setLockReason('');
      } else if (reason) {
        setLockError(data.error || 'Could not lock this period');
      } else {
        setNotice('');
        setPopup({ tone: 'error', title: 'Not locked', message: data.error || 'Could not lock this period' });
      }
    } finally {
      setBusy(false);
    }
    load();
  }

  const columns = [
    { key: 'contract_no', header: 'Contract & Plant', render: (r) => {
      const plant = r.contract_no?.includes('NJHPS') ? 'Nathpa Jhakri HEP' : r.contract_no?.includes('RHPS') ? 'Rampur HEP' : null;
      return (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--slate-900)' }}>{r.contract_no}</div>
          {plant && <div style={{ fontSize: 13.5, color: 'var(--slate-500)', fontWeight: 500 }}>{plant}</div>}
        </div>
      );
    }},
    { key: 'period_month', header: 'Period' },
    { key: 'billing_family_ref', header: 'BFR', render: (r) => (
      <BfrChip bfr={r.billing_family_ref} onClick={() => setTrailEnergyId(r.id)} />
    )},
    { key: 'data_type', header: 'Type', render: (r) => <Badge status={r.data_type} /> },
    { key: 'source', header: 'Source' },
    { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => (
      <span style={{ fontWeight: 700, color: 'var(--on-blue)' }}>{fmtNumber(r.energy_mwh)}</span>
    )},
    { key: 'cuf_percent', header: 'CUF %', render: (r) => (
      <span>
        {r.cuf_percent != null ? `${fmtNumber(r.cuf_percent)}%` : '-'}
        {Number(r.curtailment_hours) > 0 && <div style={{ fontSize: 13.5, color: 'var(--slate-500)' }} title={r.curtailment_ref || ''}>{fmtNumber(r.curtailment_hours)} h curtailed</div>}
      </span>
    ) },
    { key: 'availability_percent', header: 'Availability %', render: (r) => r.availability_percent != null ? `${fmtNumber(r.availability_percent)}%` : '-' },
    { key: 'peak_availability_percent', header: 'Peak Avail. %', render: (r) => r.peak_availability_percent != null ? `${fmtNumber(r.peak_availability_percent)}%` : '-' },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    // What the seller or buyer has said to the figure: accepted, objected, or not yet answered.
    { key: 'response', header: 'Counterparty', render: (r) => (r.is_superseded ? <span style={{ color: 'var(--slate-500)', fontSize: 15 }}>Replaced by final</span> : <ResponseBadge row={r} />) },
    { key: 'deviation_notes', header: 'Notes', render: (r) => r.deviation_notes || '-' },
    ...(actsAs(user, CAN_WRITE) ? [{
      key: 'actions', header: 'Actions', render: (r) => (
        <div className="cell-actions">
          {actsAs(user, CAN_CHECK) && ['DRAFT', 'DISPUTED'].includes(r.status) && !r.is_superseded && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); handleValidate(r); }}>{r.status === 'DISPUTED' ? 'Re-validate' : 'Validate'}</button>}
          {actsAs(user, CAN_CHECK) && ['VALIDATED', 'DISPUTED'].includes(r.status) && !r.is_superseded && <button className="btn btn-success btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); handleLock(r); }}>Lock</button>}
          <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); setTrailEnergyId(r.id); }}>Trail</button>
          <button className="btn btn-outline btn-sm" title="Source document, 15-minute blocks and the counterparty's answer" onClick={(e) => { e.stopPropagation(); setRecordId(r.id); }}>Record</button>
          {actsAs(user, CAN_MAKE) && !r.is_superseded && <button className="btn btn-outline btn-sm" title="SLDC/RLDC-certified curtailment hours, taken out of CUF's possible generation"
            onClick={(e) => { e.stopPropagation(); setCurtail({ row: r, hours: r.curtailment_hours ?? '', reference: r.curtailment_ref || '' }); }}>Curtailment</button>}
        </div>
      ),
    }] : [{
      key: 'actions', header: 'Actions', render: (r) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); setTrailEnergyId(r.id); }}>Trail</button>
          <button className="btn btn-outline btn-sm" title="Source document, 15-minute blocks and the counterparty's answer" onClick={(e) => { e.stopPropagation(); setRecordId(r.id); }}>Record</button>
        </div>
      ),
    }]),
  ];

  return (
    <div>
      <PageHeader
        title="Energy Data Accounting & Validation"
        subtitle="Record metered generation, validate against contracted parameters and lock for billing"
        actions={view === 'main' && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pdfLoading}
              onClick={downloadEnergyPdf}
            >
              {pdfLoading ? 'Preparing PDF…' : 'Download PDF Report'}
            </button>
            {actsAs(user, CAN_MAKE) && (
              <>
                <button className="btn btn-secondary" onClick={() => { setAccountResult(null); setShowAccountUpload(true); }}>Upload JMR / SEA</button>
                <button className="btn btn-secondary" onClick={openCreate}>+ Record Energy Data</button>
              </>
            )}
          </div>
        )}
      />

      <Tabs style={{ marginBottom: 18 }}>
        <Tab active={view === 'main'} onClick={() => setView('main')}>Periods</Tab>
        <Tab active={view === 'fyi'} onClick={() => setView('fyi')}>FYI</Tab>
      </Tabs>

      {view === 'fyi' && <ModuleGuide guide={getGuide('energy')} />}

      {view === 'main' && (
      <>
      <DeskTasksPanel desk="ENERGY_DATA" canWrite={actsAs(user, CAN_WRITE)} />
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {accountResult && (
        <div className="alert alert-success" role="status">
          {accountResult.account_label} {accountResult.file_name ? `(${accountResult.file_name}) ` : ''}imported:
          {' '}{accountResult.created} new, {accountResult.replaced} replacing a draft, {accountResult.skipped} left alone — all as DRAFT, to validate before locking.
        </div>
      )}

      <EnergyOverview contractId={filters.contract_id} period={filters.period_month} status={filters.status} rows={rows} vertical="REIA" />

      <div className="filters-bar">
        <select value={filters.contract_id} onChange={(e) => setFilters({ ...filters, contract_id: e.target.value })}>
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
        </select>
        <input type="month" value={filters.period_month} onChange={(e) => setFilters({ ...filters, period_month: e.target.value })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['DRAFT', 'VALIDATED', 'LOCKED', 'DISPUTED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
          <option value="">All sources</option>
          <option value="JMR">JMR (Joint meter reading)</option>
          <option value="SLDC">SEA (State energy account)</option>
          <option value="RLDC">RLDC statement</option>
          <option value="MANUAL">Manual entry</option>
        </select>
        {(filters.contract_id || filters.period_month || filters.status || filters.source) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters({ contract_id: '', period_month: '', status: '', source: '' })}>Clear filters</button>
        )}
      </div>

      <div id="energy-records-table" style={{ minHeight: 320 }}>
        <Card>
          <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No energy data records found.'} />
        </Card>
      </div>

      </>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Record Energy Data" width={560}>
        <form onSubmit={handleCreate}>
          <Field label="Contract">
            <select required value={form.contract_id} onChange={(e) => setForm({ ...form, contract_id: e.target.value })}>
              <option value="">Select contract...</option>
              {contracts.filter(recordable).map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.project_type} · {fmtNumber(capacityOf(c))} MW)</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Period (Month)">
              <input required type="month" max={lastMonth()} value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} />
            </Field>
            <Field label="Data Type">
              <select value={form.data_type} onChange={(e) => setForm({ ...form, data_type: e.target.value })}>
                <option value="PROVISIONAL">Provisional</option>
                <option value="FINAL">Final</option>
              </select>
            </Field>
            <Field label="Source">
              <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                {['MANUAL', 'REA', 'RLDC', 'SLDC', 'JMR'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Energy (MWh)">
              <input required type="number" step="0.01" value={form.energy_mwh} onChange={(e) => setForm({ ...form, energy_mwh: e.target.value })} />
            </Field>
            {(() => {
              const c = contracts.find((x) => x.id === form.contract_id);
              const mw = capacityOf(c);
              const h = hoursIn(form.period_month);
              const e = Number(form.energy_mwh);
              const max = mw && h ? mw * h : null;
              return (
                <Field label="CUF (worked out)">
                  <div style={{ padding: '8px 0', fontSize: 15, color: max != null && e > max ? 'var(--red-deep)' : 'var(--slate-600)' }}>
                    {mw && h && form.energy_mwh !== '' ? `${fmtNumber(Math.round((e / (mw * h)) * 10000) / 100)}% — ${fmtNumber(e)} MWh on ${fmtNumber(mw)} MW over ${h} h` : 'Choose the contract, month and energy'}
                    {max != null && e > max ? ` · above the ${fmtNumber(max)} MWh the plant can make` : ''}
                  </div>
                </Field>
              );
            })()}
            <Field label="Availability (%)">
              <input type="number" step="0.01" value={form.availability_percent} onChange={(e) => setForm({ ...form, availability_percent: e.target.value })} />
            </Field>
            {/* Only a contract with a peak obligation is billed on this, but the
                account reports it either way, so it is recorded either way. */}
            <Field label="Peak-window Availability (%)">
              <input
                type="number" step="0.01" min="0" max="100"
                placeholder="As the energy account reports the peak window"
                value={form.peak_availability_percent}
                onChange={(e) => setForm({ ...form, peak_availability_percent: e.target.value })}
              />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={showAccountUpload} onClose={() => setShowAccountUpload(false)} title="Upload JMR / State Energy Account" width={960}>
        {showAccountUpload && (
          <EnergyAccountUpload
            onCancel={() => setShowAccountUpload(false)}
            onDone={(result) => { setShowAccountUpload(false); setAccountResult(result); load(); }}
          />
        )}
      </Modal>

      <Modal open={!!curtail} onClose={() => setCurtail(null)} title="Certified curtailment hours" width={520}>
        {curtail && (
          <form noValidate onSubmit={async (e) => {
            e.preventDefault();
            const hours = Number(curtail.hours);
            const problems = [];
            if (curtail.hours === '' || !Number.isFinite(hours) || hours < 0) problems.push('Hours must be 0 or more');
            if (hours > 0 && curtail.reference.trim().length < 5) problems.push('Give the SLDC / RLDC instruction the hours are certified by');
            if (problems.length) { setPopup({ tone: 'error', title: 'Curtailment not saved', items: problems }); return; }
            try {
              await api.energyData.curtailment(curtail.row.id, { hours, reference: curtail.reference.trim() });
              setCurtail(null);
              load();
              setPopup({ tone: 'success', title: 'Curtailment recorded', message: `${curtail.row.contract_no} ${curtail.row.period_month}: ${hours} h now come off the possible generation its CUF is judged against. The billed energy is unchanged.` });
            } catch (err) {
              setPopup({ tone: 'error', title: 'Curtailment not saved', message: errOf(err, 'Could not save the curtailment hours.') });
            }
          }}>
            <p style={{ fontSize: 14.5, color: 'var(--slate-600)', marginTop: 0 }}>
              {curtail.row.contract_no} · {curtail.row.period_month}. Only hours an SLDC/RLDC instruction certifies count. Where hours are entered, deemed generation is not added again for the month.
            </p>
            <Field label="Curtailed hours" required><input type="number" min="0" step="0.25" value={curtail.hours} onChange={(e) => setCurtail({ ...curtail, hours: e.target.value })} /></Field>
            <Field label="SLDC / RLDC instruction reference"><input value={curtail.reference} onChange={(e) => setCurtail({ ...curtail, reference: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-outline" onClick={() => setCurtail(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!lockAsk} onClose={() => setLockAsk(null)} title="Lock this period as it stands?" width={560}>
        {lockAsk && (
          <form onSubmit={(e) => { e.preventDefault(); handleLock(lockAsk.row, lockReason.trim()); }}>
            <div className="alert alert-error" style={{ fontSize: 15 }}>
              <strong>{lockAsk.row.contract_no} · {lockAsk.row.period_month}</strong> — {lockAsk.error}
              {lockAsk.objection && <div style={{ marginTop: 6 }}>Their objection: {lockAsk.objection}</div>}
              {lockAsk.validation && <div style={{ marginTop: 6 }}>Validation: {lockAsk.validation}</div>}
            </div>
            {lockError && <div className="form-error" role="alert">{lockError}</div>}
            <Field label="Reason for locking it anyway (kept on record, and the desk is told)" required>
              <textarea required rows={3} minLength={15} placeholder="e.g. CERC order 14/2026 — NRLDC certified curtailment for the month" value={lockReason} onChange={(e) => setLockReason(e.target.value)} style={{ width: '100%' }} />
              <span style={{ fontSize: 14.5, color: 'var(--slate-500)' }}>At least 15 characters — an auditor reads this.</span>
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setLockAsk(null)}>Cancel</button>
              <button type="submit" className="btn btn-danger" disabled={busy || lockReason.trim().length < 15}>{busy ? 'Locking…' : 'Lock with this reason'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!trailEnergyId} onClose={() => setTrailEnergyId(null)} title="Settlement Trail & Pipeline" width="90vw">
        {trailEnergyId && <SettlementTrailPanel energyId={trailEnergyId} />}
      </Modal>

      <Modal open={!!recordId} onClose={() => setRecordId(null)} title="Energy record" width={940}>
        {recordId && <EnergyRecordDetail key={recordId} id={recordId} onChanged={load} />}
      </Modal>

      <AlertPopup
        open={!!popup}
        tone={popup?.tone}
        title={popup?.title}
        message={popup?.message}
        items={popup?.items}
        okLabel={popup?.okLabel}
        onClose={() => setPopup(null)}
      />
    </div>
  );
}
