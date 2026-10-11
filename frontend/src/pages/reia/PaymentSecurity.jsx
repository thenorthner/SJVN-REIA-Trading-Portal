import React, { useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, Tabs, Tab, fmtCurrency, DemandLetterViewer } from '../../components/ui.jsx';
import ModuleGuide from '../../components/ModuleGuide.jsx';
import { getGuide } from '../../content/guides/index.js';
import { DocumentManager } from '../../components/DocumentManager.jsx';
import SecurityInstrumentPanel, { ExpiryTag, changeText, errText, eventLabel } from '../../components/SecurityInstrumentPanel.jsx';
import SjvnLcDesk from '../../components/SjvnLcDesk.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';

// Who the API lets do what. One list used to stand for all of it, so Finance
// was offered every button and refused on each, and REIA Admin — who may do
// all of it — was offered none.
const CAN_MANAGE = ROLE_GROUPS.REIA_WRITE;                          // record, draw, invoke, advance a demand
const CAN_RELEASE = [...ROLE_GROUPS.REIA_WRITE, 'FINANCE_USER'];     // ask for and decide a release
const CAN_RUN_ALERTS = [...ROLE_GROUPS.REIA_WRITE, 'MANAGEMENT'];
const CAN_OVERRIDE = [...ROLE_GROUPS.REIA_WRITE, 'MANAGEMENT'];
const LIVE = ['ACTIVE', 'PARTIALLY_UTILIZED', 'RENEWED'];

const EMPTY_FORM = {
  contract_id: '', mechanism_type: 'LC', bg_subtype: 'PBG', limit_amount: '', issuing_bank: '',
  beneficiary: 'SJVN Limited', validity_start: '', validity_end: '', is_revolving: true, remarks: '',
};
const EMPTY_FILTERS = { status: '', mechanism_type: '', bg_subtype: '', expiring_days: '' };
const MECHANISM_LABEL = {
  LC: 'Letter of credit', BANK_GUARANTEE: 'Bank guarantee', CORPUS_FUND: 'Corpus fund',
  PAYMENT_SECURITY_FUND: 'Payment security fund', OTHER: 'Other',
};
const BG_LABEL = { EMD: 'EMD', PBG: 'PBG', OTHER_BG: 'Other guarantee' };
const ACTION_LABEL = { utilize: 'Draw on this instrument', replenish: 'Record cover reinstated', release: 'Request release' };

export const typeLabel = (r) => {
  if (r.mechanism_type === 'BANK_GUARANTEE') return `BG${r.bg_subtype ? ` · ${BG_LABEL[r.bg_subtype] || r.bg_subtype}` : ''}`;
  const base = r.mechanism_type === 'LC' ? 'LC' : (MECHANISM_LABEL[r.mechanism_type] || r.mechanism_type);
  return `${base}${r.is_revolving ? ' · revolving' : ''}`;
};
const lapsed = (r) => !!r.validity_end && String(r.validity_end).slice(0, 10) < new Date().toISOString().slice(0, 10);
const parse = (json) => { try { return typeof json === 'string' ? JSON.parse(json) : (json || null); } catch { return null; } };

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StatPill({ label, value, sub }) {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--surface-2, #f6f7f9)', borderRadius: 8, minWidth: 110 }}>
      <div style={{ fontSize: 11, textTransform: 'none', letterSpacing: 0.4, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub != null && <div style={{ fontSize: 12, opacity: 0.65 }}>{sub}</div>}
    </div>
  );
}

export default function PaymentSecurity() {
  const [view, setView] = useState('instruments');
  const { user } = useAuth();
  const canManage = CAN_MANAGE.includes(user?.role);
  const canRelease = CAN_RELEASE.includes(user?.role);
  const canOverride = CAN_OVERRIDE.includes(user?.role);
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [releases, setReleases] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [invocations, setInvocations] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusyState] = useState(false);
  // `busy` is what the buttons show; the lock is what stops a second click.
  // State alone did not: two clicks landing before the next render both read
  // "not busy", and an invocation was raised twice.
  const lock = useRef(false);
  const setBusy = (on) => { lock.current = on; setBusyState(on); };
  // Each form keeps its own error: one shared between the Add form and the
  // invocation card showed a refused invocation inside the next instrument added.
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [createError, setCreateError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [detailNotice, setDetailNotice] = useState('');
  const [action, setAction] = useState(null);
  const [actionValue, setActionValue] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [invokeForm, setInvokeForm] = useState({ contract_id: '', amount: '' });
  const [invokeError, setInvokeError] = useState('');
  const [invokeConfirm, setInvokeConfirm] = useState(false);
  const [invocationError, setInvocationError] = useState('');
  const [letter, setLetter] = useState(null);
  const [releaseError, setReleaseError] = useState('');
  const [refusing, setRefusing] = useState(null);
  const [refuseNote, setRefuseNote] = useState('');
  const [overrideFor, setOverrideFor] = useState(null);
  const [overrideForm, setOverrideForm] = useState({ reason: '', valid_until: '' });
  const [overrideError, setOverrideError] = useState('');
  const [desk, setDesk] = useState(null);

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    return Promise.all([
      api.paymentSecurity.list(params),
      api.paymentSecurity.stats().catch(() => null),
      api.paymentSecurity.releases().catch(() => []),
      api.paymentSecurity.overrides().catch(() => []),
      api.paymentSecurity.invocations().catch(() => []),
      api.securityDesk.overview().catch(() => null),
    ]).then(([list, s, rel, ov, inv, dk]) => {
      setDesk(dk);
      setRows(list);
      setStats(s);
      setReleases(rel || []);
      setOverrides(ov || []);
      setInvocations(inv || []);
    }).catch((err) => setPageError(errText(err))).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filters.status, filters.mechanism_type, filters.bg_subtype, filters.expiring_days]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  const say = (text) => { setPageError(''); setNotice(text); };
  const switchView = (v) => { setNotice(''); setPageError(''); setView(v); };
  const fail = (err) => { setNotice(''); setPageError(errText(err)); };
  const filtered = Object.values(filters).some(Boolean);

  async function openDetail(row) {
    setPageError('');
    try {
      setDetail(await api.paymentSecurity.get(row.id));
      setAction(null);
      setActionValue('');
      setActionReason('');
      setDetailError('');
      setDetailNotice('');
    } catch (err) {
      fail(err);
    }
  }

  // SFMS, the scan, an amendment, a decision — the panel does these itself.
  const panelChanged = (fresh) => {
    setDetailError('');
    setDetailNotice(fresh?.instrument_no ? `Saved on ${fresh.instrument_no}.` : 'Saved.');
    refreshDetail();
  };

  async function refreshDetail() {
    if (!detail) return;
    try { setDetail(await api.paymentSecurity.get(detail.id)); } catch (err) { setDetailError(errText(err)); }
    load();
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setCreateError('');
    setShowCreate(true);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (lock.current) return;
    setCreateError('');
    setBusy(true);
    try {
      const made = await api.paymentSecurity.create({
        ...form,
        limit_amount: Number(form.limit_amount),
        bg_subtype: form.mechanism_type === 'BANK_GUARANTEE' ? form.bg_subtype || 'PBG' : null,
        is_revolving: form.mechanism_type === 'LC' ? !!form.is_revolving : false,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      say(`${made.instrument_no} recorded for ${fmtCurrency(made.limit_amount)}.${made.status === 'EXPIRED' ? ' Its validity has already run out, so it is on the register as expired.' : ''}`);
      load();
    } catch (err) {
      setCreateError(err.response?.data?.error || 'Failed to create instrument.');
    } finally {
      setBusy(false);
    }
  }

  function startAction(kind) {
    setAction(kind);
    setActionValue(kind === 'release' ? 'Contract completion release' : '');
    setActionReason('');
    setDetailError('');
    setDetailNotice('');
  }

  async function submitAction(e) {
    e.preventDefault();
    if (!detail || !action || lock.current) return;
    setDetailError('');
    setDetailNotice('');
    setBusy(true);
    try {
      if (action === 'utilize') {
        await api.paymentSecurity.utilize(detail.id, Number(actionValue), actionReason.trim() || undefined);
        setDetailNotice(`${fmtCurrency(Number(actionValue))} drawn on ${detail.instrument_no}.`);
      } else if (action === 'replenish') {
        await api.paymentSecurity.replenish(detail.id, Number(actionValue), actionReason.trim() || undefined);
        setDetailNotice(`${fmtCurrency(Number(actionValue))} reinstated on ${detail.instrument_no}.`);
      } else if (action === 'release') {
        await api.paymentSecurity.releaseRequest(detail.id, actionValue.trim() || 'Release requested');
        setDetailNotice(`Release of ${detail.instrument_no} requested. It is in the release queue for a decision.`);
      }
      setAction(null);
      await refreshDetail();
    } catch (err) {
      setDetailError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  function askInvoke(e) {
    e.preventDefault();
    setInvokeError('');
    if (invokeForm.amount !== '' && !(Number(invokeForm.amount) > 0)) {
      setInvokeError('The amount to invoke must be more than zero. Leave it blank to invoke what is overdue.');
      return;
    }
    setInvokeConfirm(true);
  }

  async function handleInvokeWaterfall() {
    if (lock.current) return;
    setInvokeError('');
    setBusy(true);
    try {
      const inv = await api.paymentSecurity.startInvocation({
        contract_id: invokeForm.contract_id,
        amount: invokeForm.amount ? Number(invokeForm.amount) : undefined,
      });
      const l = parse(inv.demand_letter_json) || {};
      const from = (l.waterfall || []).map((w) => w.instrument_no).join(', ');
      say(`${inv.invocation_no} raised: ${fmtCurrency(inv.amount)} drawn${from ? ` on ${from}` : ''}.${Number(l.shortfall_uncovered) > 0 ? ` ${fmtCurrency(l.shortfall_uncovered)} of the demand is not covered by any security.` : ''}`);
      setInvokeForm({ contract_id: '', amount: '' });
      setInvokeConfirm(false);
      load();
    } catch (err) {
      setInvokeConfirm(false);
      setInvokeError(err.response?.data?.error || 'Invocation failed');
    } finally {
      setBusy(false);
    }
  }

  async function transitionInv(row, status) {
    if (lock.current) return;
    setInvocationError('');
    setBusy(true);
    try {
      await api.paymentSecurity.transitionInvocation(row.id, status);
      say(`${row.invocation_no} moved to ${status.replaceAll('_', ' ').toLowerCase()}.`);
      await load();
      if (detail) await refreshDetail();
    } catch (err) {
      setInvocationError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function downloadLetter(row) {
    try {
      saveBlob(await api.paymentSecurity.invocationPdf(row.id), `demand-letter-${String(row.invocation_no).replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`);
    } catch (err) {
      setInvocationError(errText(err));
    }
  }

  async function actRelease(row, decision, note) {
    if (lock.current) return;
    setReleaseError('');
    setBusy(true);
    try {
      await api.paymentSecurity.actRelease(row.id, decision, note);
      say(decision === 'APPROVED' ? `${row.instrument_no} released.` : `Release of ${row.instrument_no} refused.`);
      setRefusing(null);
      setRefuseNote('');
      await load();
    } catch (err) {
      setReleaseError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveOverride(e) {
    e.preventDefault();
    if (lock.current || !overrideFor) return;
    setOverrideError('');
    setBusy(true);
    try {
      await api.paymentSecurity.createOverride({ contract_id: overrideFor.contract_id, reason: overrideForm.reason, valid_until: overrideForm.valid_until || undefined });
      say(`Adequacy override recorded on ${overrideFor.contract_no}.`);
      setOverrideFor(null);
      setOverrideForm({ reason: '', valid_until: '' });
      await load();
    } catch (err) {
      setOverrideError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function runAlerts() {
    if (lock.current) return;
    setBusy(true);
    try {
      const r = await api.paymentSecurity.runAlerts();
      const parts = [
        r.sent > 0 && `${r.sent} alert${r.sent === 1 ? '' : 's'} sent`,
        r.expired > 0 && `${r.expired} instrument${r.expired === 1 ? '' : 's'} marked expired`,
      ].filter(Boolean);
      say(parts.length ? `${parts.join('; ')}.` : 'No new alerts — nothing has crossed a new expiry threshold or fallen short of cover since the last run.');
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function downloadRegister() {
    try {
      saveBlob(await api.securityDesk.register(), `payment-security-register-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      fail(err);
    }
  }

  const columns = [
    { key: 'instrument_no', header: 'Instrument' },
    { key: 'contract_no', header: 'Contract' },
    { key: 'type', header: 'Type', render: (r) => typeLabel(r) },
    { key: 'limit_amount', header: 'Limit', render: (r) => fmtCurrency(r.limit_amount ?? r.amount) },
    { key: 'available_amount', header: 'Available', render: (r) => (['CLOSED', 'RELEASED'].includes(r.status) ? '—' : fmtCurrency(r.available_amount)) },
    {
      key: 'coverage',
      header: 'Coverage',
      // Cover is measured on a PSA: what the buyer has given against what it
      // owes. On a PPA the bills run the other way, so the same sum compared a
      // seller's guarantee with what SJVN owes the seller.
      render: (r) => (r.contract_type !== 'PSA' || r.coverage_ratio == null
        ? <span title="Coverage is measured on a PSA — the buyer's security against what it owes." style={{ color: 'var(--text-light)' }}>—</span>
        : (
          <span style={{ color: (r.coverage_ratio || 0) < 1 ? 'var(--danger, var(--red-deep))' : undefined }}>
            {r.coverage_ratio.toFixed(2)}
          </span>
        )),
    },
    {
      key: 'validity_end',
      header: 'Expiry',
      render: (r) => {
        const d = desk?.instruments.find((i) => i.id === r.id);
        return <span style={{ whiteSpace: 'nowrap' }}>{r.validity_end ? fmtDate(r.validity_end) : '—'} {d && <ExpiryTag expiry={d.expiry} />}</span>;
      },
    },
    {
      key: 'sfms',
      header: 'SFMS',
      render: (r) => (r.verified_at ? <span style={{ color: '#15803d', fontWeight: 600 }}>Received</span> : <span style={{ color: '#b45309' }}>Pending</span>),
    },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  const pendingReleases = releases.filter((r) => r.status === 'PENDING');
  const invokeContract = contracts.find((c) => c.id === invokeForm.contract_id);
  const detailLive = detail && LIVE.includes(detail.status) && !lapsed(detail);
  const canDraw = canManage && detailLive && detail.available_amount > 0;
  const canReinstate = canManage && detail && detail.utilized_amount > 0 && !['RELEASED', 'CLOSED', 'DRAFT'].includes(detail.status);
  const canAskRelease = canRelease && detail && [...LIVE, 'EXPIRED'].includes(detail.status);

  return (
    <div>
      <PageHeader
        title="Payment Security"
        subtitle="Revolving LC, bank guarantees, corpus waterfall, coverage & invocation control"
        actions={view === 'instruments' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={downloadRegister}>Download register (Excel)</button>
            {CAN_RUN_ALERTS.includes(user?.role) && <button type="button" className="btn btn-secondary" disabled={busy} onClick={runAlerts}>Run Alerts</button>}
            {canManage && <button type="button" className="btn btn-primary" onClick={openCreate}>+ Instrument</button>}
          </div>
        )}
      />
      {pageError && <div className="form-error" role="alert">{pageError}</div>}
      {notice && <div className="ps-alert green" role="status">{notice}</div>}

      <Tabs style={{ marginBottom: 18 }}>
        <Tab active={view === 'instruments'} onClick={() => switchView('instruments')}>Instruments</Tab>
        <Tab active={view === 'lcs'} onClick={() => switchView('lcs')}>LCs to sellers</Tab>
        <Tab active={view === 'fyi'} onClick={() => switchView('fyi')}>FYI</Tab>
      </Tabs>

      {view === 'fyi' && <ModuleGuide guide={getGuide('security')} />}
      {view === 'lcs' && <Card><SjvnLcDesk overview={desk} onChanged={load} /></Card>}

      {view === 'instruments' && (
      <>
      {stats && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          <StatPill label="Total security" value={fmtCurrency(stats.total_security_value)} sub={`${stats.instrument_count} active`} />
          <StatPill label="Avg coverage" value={stats.avg_coverage_ratio?.toFixed(2) ?? '—'} sub="across PSAs" />
          <StatPill label="Shortfalls" value={stats.shortfall_count} sub="coverage < 1" />
          <StatPill label="Expiring 30/60/90" value={`${stats.expiring?.[30] ?? 0} / ${stats.expiring?.[60] ?? 0} / ${stats.expiring?.[90] ?? 0}`} sub="days" />
          <StatPill label="Invocations" value={stats.invocation_ytd_count} sub={fmtCurrency(stats.invocation_ytd_amount)} />
        </div>
      )}

      {stats?.weak_entities?.length > 0 && (
        <Card title="Coverage shortfall" className="mb-3">
          <Table
            columns={[
              { key: 'contract_no', header: 'Contract' },
              { key: 'entity_name', header: 'Buyer' },
              { key: 'coverage_ratio', header: 'Ratio', render: (r) => r.coverage_ratio?.toFixed(3) },
              { key: 'shortfall', header: 'Shortfall', render: (r) => fmtCurrency(r.shortfall) },
              { key: 'available_security', header: 'Available', render: (r) => fmtCurrency(r.available_security) },
              { key: 'exposure', header: 'Owed + next bill', render: (r) => fmtCurrency(r.exposure) },
              ...(canOverride ? [{
                key: 'override',
                header: '',
                render: (r) => <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOverrideFor(r); setOverrideForm({ reason: '', valid_until: '' }); setOverrideError(''); }}>Record override</button>,
              }] : []),
            ]}
            rows={stats.weak_entities}
          />
          {overrideFor && (
            <form className="cw-form" onSubmit={saveOverride}>
              <strong>Treat the security on {overrideFor.contract_no} as adequate</strong>
              <p style={{ margin: '4px 0 10px', fontSize: 12, color: 'var(--text-light)' }}>
                Scheduling and bidding for this buyer are held while its cover falls short. An override lets them go ahead on your say-so, until the date you give. It is recorded against your name and Management is told.
              </p>
              {overrideError && <div className="form-error">{overrideError}</div>}
              <div className="form-grid">
                <Field label="Reason" required><input required value={overrideForm.reason} onChange={(e) => setOverrideForm({ ...overrideForm, reason: e.target.value })} placeholder="e.g. LC enhancement with the bank, advice awaited" /></Field>
                <Field label="Valid until (blank = until withdrawn)"><input type="date" value={overrideForm.valid_until} onChange={(e) => setOverrideForm({ ...overrideForm, valid_until: e.target.value })} /></Field>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setOverrideFor(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>Save override</button>
              </div>
            </form>
          )}
        </Card>
      )}

      {desk && desk.instruments.some((i) => i.pending_amendment || (i.status === 'DRAFT' && i.submitted_by_side)) && (
        <Card title="Awaiting your acceptance" className="mb-3">
          <Table
            columns={[
              { key: 'instrument_no', header: 'Instrument' },
              { key: 'contract_no', header: 'Contract' },
              { key: 'what', header: 'Submitted', render: (r) => (r.pending_amendment ? `Amendment — ${changeText(r.pending_amendment.changes)}` : `New ${r.bg_subtype || r.mechanism_type} ${r.bank_reference_no || ''} for ${fmtCurrency(r.limit_amount)}`) },
              { key: 'by', header: 'By', render: (r) => r.pending_amendment?.raised_by_name || r.submitted_by_name || (r.submitted_by_side || '').toLowerCase() },
            ]}
            rows={desk.instruments.filter((i) => i.pending_amendment || (i.status === 'DRAFT' && i.submitted_by_side))}
            onRowClick={openDetail}
          />
        </Card>
      )}

      <div className="filters-bar">
        <select aria-label="Type" value={filters.mechanism_type} onChange={(e) => setFilters({ ...filters, mechanism_type: e.target.value, bg_subtype: '' })}>
          <option value="">All types</option>
          <option value="LC">LC</option>
          <option value="BANK_GUARANTEE">Bank Guarantee</option>
          <option value="CORPUS_FUND">Corpus</option>
          <option value="PAYMENT_SECURITY_FUND">PSF</option>
          <option value="OTHER">Other</option>
        </select>
        {filters.mechanism_type === 'BANK_GUARANTEE' && (
          <select aria-label="BG subtype" value={filters.bg_subtype} onChange={(e) => setFilters({ ...filters, bg_subtype: e.target.value })}>
            <option value="">All BG subtypes</option>
            <option value="EMD">EMD</option>
            <option value="PBG">PBG</option>
            <option value="OTHER_BG">Other</option>
          </select>
        )}
        <select aria-label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['DRAFT', 'ACTIVE', 'PARTIALLY_UTILIZED', 'INVOKED', 'EXPIRED', 'RENEWED', 'RELEASE_PENDING', 'RELEASED', 'CLOSED'].map((s) => (
            <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>
          ))}
        </select>
        <select aria-label="Expiry" value={filters.expiring_days} onChange={(e) => setFilters({ ...filters, expiring_days: e.target.value })}>
          <option value="">Any expiry</option>
          <option value="15">≤ 15 days</option>
          <option value="30">≤ 30 days</option>
          <option value="60">≤ 60 days</option>
        </select>
        {filtered && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>}
      </div>

      <Card>
        <Table
          columns={columns}
          rows={loading ? [] : rows}
          onRowClick={openDetail}
          emptyMessage={loading ? 'Loading...' : filtered ? 'No instruments match these filters.' : 'No instruments found.'}
        />
      </Card>

      {canManage && (
        <Card title="Start waterfall invocation" className="mt-3">
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-light)' }}>
            Draws on the contract's security in waterfall order — the counterparty's own instrument first, pooled funds last — and raises a demand notice.
            On a PSA that is the buyer's letter of credit; on a PPA, the seller's guarantee. Leave the amount blank to invoke what is overdue by 30 days or more.
          </p>
          {invokeError && <div className="form-error" role="alert">{invokeError}</div>}
          <form onSubmit={askInvoke} className="form-grid" style={{ alignItems: 'end' }}>
            <Field label="Contract">
              <select required value={invokeForm.contract_id} onChange={(e) => { setInvokeForm({ ...invokeForm, contract_id: e.target.value }); setInvokeConfirm(false); }}>
                <option value="">Select PSA/PPA...</option>
                {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.contract_type})</option>)}
              </select>
            </Field>
            <Field label="Amount (optional)">
              <input type="number" min="0" step="0.01" value={invokeForm.amount} onChange={(e) => { setInvokeForm({ ...invokeForm, amount: e.target.value }); setInvokeConfirm(false); }} />
            </Field>
            {!invokeConfirm && <button type="submit" className="btn btn-danger">Invoke waterfall</button>}
          </form>
          {invokeConfirm && (
            <div className="ps-alert red" role="alertdialog" aria-label="Confirm invocation" style={{ marginTop: 10, marginBottom: 0 }}>
              <strong>Invoke the security on {invokeContract?.contract_no}?</strong>{' '}
              {invokeForm.amount ? `${fmtCurrency(Number(invokeForm.amount))} will be` : 'Whatever is overdue by 30 days or more will be'} drawn on the {invokeContract?.contract_type === 'PPA' ? "seller's guarantee" : "buyer's letter of credit"} and any pooled cover,
              a demand notice will be raised, and the counterparty will be told. This cannot be undone from this screen.
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInvokeConfirm(false)}>Cancel</button>
                <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={handleInvokeWaterfall}>{busy ? 'Invoking…' : 'Confirm invocation'}</button>
              </div>
            </div>
          )}
        </Card>
      )}

      {invocations.length > 0 && (
        <Card title="Invocation tracker" className="mt-3">
          {invocationError && <div className="form-error" role="alert">{invocationError}</div>}
          <Table
            columns={[
              { key: 'invocation_no', header: 'No.' },
              { key: 'contract_no', header: 'Contract' },
              { key: 'amount', header: 'Amount', render: (r) => fmtCurrency(r.amount) },
              { key: 'created_at', header: 'Raised', render: (r) => fmtDate(r.created_at) },
              { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
              {
                key: 'actions',
                header: 'Advance',
                render: (r) => (canManage && r.status !== 'FUNDS_RECEIVED' && r.status !== 'REJECTED' ? (
                  <div className="cell-actions" onClick={(e) => e.stopPropagation()}>
                    {r.status === 'ELIGIBLE' && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => transitionInv(r, 'NOTICE_ISSUED')}>Notice</button>}
                    {r.status === 'NOTICE_ISSUED' && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => transitionInv(r, 'CLAIMED')}>Claimed</button>}
                    {r.status === 'CLAIMED' && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => transitionInv(r, 'FUNDS_RECEIVED')}>Funds in</button>}
                  </div>
                ) : null),
              },
              {
                key: 'letter',
                header: 'Demand letter',
                render: (r) => (
                  <div className="cell-actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLetter(r)}>View</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadLetter(r)}>PDF</button>
                  </div>
                ),
              },
            ]}
            rows={invocations.slice(0, 12)}
          />
          {invocations.length > 12 && <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-light)' }}>Showing the latest 12 of {invocations.length}.</p>}
        </Card>
      )}

      {(pendingReleases.length > 0 || overrides.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', gap: 12, marginTop: 12 }}>
          {pendingReleases.length > 0 && (
          <Card title="Release queue">
            {releaseError && <div className="form-error" role="alert">{releaseError}</div>}
            <Table
              columns={[
                { key: 'instrument_no', header: 'Instrument', render: (r) => <><strong>{r.instrument_no}</strong><div style={{ fontSize: 11, color: 'var(--text-light)' }}>{r.contract_no}</div></> },
                { key: 'reason', header: 'Asked for', render: (r) => <>{r.reason}<div style={{ fontSize: 11, color: 'var(--text-light)' }}>{r.requested_by}, {fmtDate(r.created_at)}</div></> },
                {
                  key: 'position',
                  header: 'Position today',
                  render: (r) => (!r.position ? '—' : r.position.clear
                    ? <span style={{ color: '#15803d', fontWeight: 600 }}>Clear</span>
                    : (
                      <span style={{ color: '#b45309' }}>
                        {[r.position.outstanding_dues > 0 && `${fmtCurrency(r.position.outstanding_dues)} outstanding`,
                          r.position.open_disputes > 0 && `${r.position.open_disputes} open dispute${r.position.open_disputes === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                      </span>
                    )),
                },
                {
                  key: 'act',
                  header: '',
                  render: (r) => (canRelease ? (
                    <div className="cell-actions">
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => actRelease(r, 'APPROVED')}>Release</button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setRefusing(r); setRefuseNote(''); setReleaseError(''); }}>Refuse</button>
                    </div>
                  ) : null),
                },
              ]}
              rows={pendingReleases}
              emptyMessage="No pending releases."
            />
            {refusing && (
              <form className="cw-form" onSubmit={(e) => { e.preventDefault(); actRelease(refusing, 'REJECTED', refuseNote.trim()); }}>
                <Field label={`Why is the release of ${refusing.instrument_no} refused? (the counterparty is told)`} required>
                  <textarea required value={refuseNote} onChange={(e) => setRefuseNote(e.target.value)} />
                </Field>
                <div className="form-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setRefusing(null)}>Cancel</button>
                  <button type="submit" className="btn btn-danger" disabled={busy}>Refuse release</button>
                </div>
              </form>
            )}
          </Card>
          )}
          {overrides.length > 0 && (
          <Card title="Adequacy overrides">
            <Table
              columns={[
                { key: 'contract_no', header: 'Contract' },
                { key: 'reason', header: 'Reason' },
                { key: 'approved_by', header: 'By', render: (r) => <>{r.approved_by}<div style={{ fontSize: 11, color: 'var(--text-light)' }}>{fmtDate(r.created_at)}</div></> },
                {
                  key: 'valid_until',
                  header: 'Until',
                  render: (r) => (!r.valid_until ? 'Until withdrawn'
                    : lapsed({ validity_end: r.valid_until }) ? <span style={{ color: 'var(--text-light)' }}>{fmtDate(r.valid_until)} · lapsed</span> : fmtDate(r.valid_until)),
                },
              ]}
              rows={overrides.slice(0, 8)}
              emptyMessage="No overrides."
            />
          </Card>
          )}
        </div>
      )}

      </>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add payment security" width={560}>
        {createError && <div className="form-error" role="alert">{createError}</div>}
        <form onSubmit={handleCreate}>
          <Field label="Contract">
            <select required value={form.contract_id} onChange={(e) => setForm({ ...form, contract_id: e.target.value })}>
              <option value="">Select...</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.contract_type})</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Mechanism">
              <select value={form.mechanism_type} onChange={(e) => setForm({ ...form, mechanism_type: e.target.value })}>
                {Object.entries(MECHANISM_LABEL).map(([m, l]) => <option key={m} value={m}>{l}</option>)}
              </select>
            </Field>
            {form.mechanism_type === 'BANK_GUARANTEE' && (
              <Field label="BG subtype">
                <select value={form.bg_subtype || 'PBG'} onChange={(e) => setForm({ ...form, bg_subtype: e.target.value })}>
                  {Object.entries(BG_LABEL).map(([s, l]) => <option key={s} value={s}>{l}</option>)}
                </select>
              </Field>
            )}
            <Field label="Limit (₹)">
              <input required type="number" min="1" step="0.01" value={form.limit_amount} onChange={(e) => setForm({ ...form, limit_amount: e.target.value })} />
            </Field>
            <Field label="Issuing bank">
              <input value={form.issuing_bank} onChange={(e) => setForm({ ...form, issuing_bank: e.target.value })} />
            </Field>
            <Field label="Validity start">
              <input required type="date" value={form.validity_start} onChange={(e) => setForm({ ...form, validity_start: e.target.value })} />
            </Field>
            <Field label="Validity end">
              <input required type="date" value={form.validity_end} onChange={(e) => setForm({ ...form, validity_end: e.target.value })} />
            </Field>
          </div>
          {form.mechanism_type === 'LC' && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, fontSize: 13 }}>
              <input type="checkbox" checked={form.is_revolving} onChange={(e) => setForm({ ...form, is_revolving: e.target.checked })} />
              Revolving LC
            </label>
          )}
          <Field label="Remarks">
            <textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!letter} onClose={() => setLetter(null)} title={letter ? `Demand notice ${letter.invocation_no}` : 'Demand notice'} width={680}>
        {letter && <DemandLetterViewer letterStr={letter.demand_letter_json} status={letter.status} invocationNo={letter.invocation_no} onDownload={() => downloadLetter(letter)} />}
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.instrument_no || 'Instrument'} width={720}>
        {detail && (
          <div>
            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Contract</span><span className="detail-value">{detail.contract_no}</span></div>
              <div className="detail-item"><span className="detail-label">Type</span><span className="detail-value">{typeLabel(detail)}</span></div>
              <div className="detail-item"><span className="detail-label">Limit</span><span className="detail-value">{fmtCurrency(detail.limit_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Utilized</span><span className="detail-value">{fmtCurrency(detail.utilized_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Available</span><span className="detail-value">{fmtCurrency(detail.available_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Required</span><span className="detail-value">{fmtCurrency(detail.required_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Waterfall #</span><span className="detail-value">{detail.waterfall_priority}</span></div>
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status} /></span></div>
              {detail.contract_type === 'PSA' && (
                <div className="detail-item"><span className="detail-label">Coverage (contract)</span><span className="detail-value">{detail.coverage?.coverage_ratio?.toFixed(3)} (shortfall {fmtCurrency(detail.coverage?.shortfall)})</span></div>
              )}
              <div className="detail-item"><span className="detail-label">Bank confirm</span><span className="detail-value">{detail.bank_confirmation_ref || '—'}</span></div>
              <div className="detail-item"><span className="detail-label">Validity</span><span className="detail-value">{detail.validity_start ? fmtDate(detail.validity_start) : '—'} → {detail.validity_end ? fmtDate(detail.validity_end) : '—'}</span></div>
              <div className="detail-item"><span className="detail-label">Revolving</span><span className="detail-value">{detail.is_revolving ? 'Yes' : 'No'}</span></div>
            </div>

            {detailError && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{detailError}</div>}
            {detailNotice && <div className="ps-alert green" role="status" style={{ marginTop: 12, marginBottom: 0 }}>{detailNotice}</div>}

            {(canDraw || canReinstate || canAskRelease) && (
              <div className="cell-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                {canDraw && <button type="button" className="btn btn-secondary btn-sm" onClick={() => startAction('utilize')}>Utilize</button>}
                {canReinstate && <button type="button" className="btn btn-secondary btn-sm" onClick={() => startAction('replenish')}>Replenish</button>}
                {canAskRelease && <button type="button" className="btn btn-ghost btn-sm" onClick={() => startAction('release')}>Request release</button>}
              </div>
            )}
            {(canManage || canRelease) && !canDraw && !canReinstate && !canAskRelease && (
              <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--text-light)' }}>
                {detail.status === 'DRAFT' ? 'Awaiting acceptance — nothing can be drawn on it until it is taken on record.'
                  : detail.status === 'RELEASE_PENDING' ? 'A release request is open on this instrument. Decide it in the release queue.'
                    : `This instrument is ${detail.status.replaceAll('_', ' ').toLowerCase()} — nothing more can be drawn or released on it.`}
              </p>
            )}

            {action && (
              <form onSubmit={submitAction} className="cw-form">
                <strong>{ACTION_LABEL[action]}</strong>
                {action === 'release' ? (
                  <Field label="Reason">
                    <input required value={actionValue} onChange={(e) => setActionValue(e.target.value)} />
                  </Field>
                ) : (
                  <div className="form-grid" style={{ marginTop: 8 }}>
                    <Field label="Amount (₹)">
                      <input required type="number" min="0.01" step="0.01" value={actionValue} onChange={(e) => setActionValue(e.target.value)} />
                    </Field>
                    {action === 'utilize' && (
                      <Field label="What it is drawn for">
                        <input value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder="e.g. Default on the May bill" />
                      </Field>
                    )}
                    {action === 'replenish' && (
                      <Field label={detail.is_revolving ? 'Reference (optional)' : 'What restored the cover (required)'}>
                        <input required={!detail.is_revolving} value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder={detail.is_revolving ? "Bank's reinstatement advice" : 'Payment into the fund, or the guarantee amendment'} />
                      </Field>
                    )}
                  </div>
                )}
                {action === 'utilize' && <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-light)' }}>{fmtCurrency(detail.available_amount)} is available. To raise a demand on the bank, use “Start waterfall invocation” instead — this only records a draw.</p>}
                {action === 'replenish' && <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-light)' }}>{fmtCurrency(detail.utilized_amount)} has been drawn{detail.is_revolving ? '' : '. This instrument does not revolve, so say what put the cover back'}.</p>}
                <div className="form-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setAction(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</button>
                </div>
              </form>
            )}

            <div style={{ marginTop: 14 }}>
              <SecurityInstrumentPanel instrumentId={detail.id} onChanged={panelChanged} />
            </div>

            {detail.requirements?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 16 }}>Contract requirements</div>
                <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
                  {detail.requirements.map((r) => (
                    <li key={r.id}>{typeLabel({ ...r, is_revolving: 0 })} — min {fmtCurrency(r.min_amount)}, priority {r.waterfall_priority}</li>
                  ))}
                </ul>
              </>
            )}

            {detail.invocations?.[0]?.demand_letter_json && (
              <DemandLetterViewer
                letterStr={detail.invocations[0].demand_letter_json}
                status={detail.invocations[0].status}
                invocationNo={detail.invocations[0].invocation_no}
                onDownload={() => downloadLetter(detail.invocations[0])}
              />
            )}

            <DocumentManager
              moduleName="PAYMENT_SECURITY"
              entityId={detail.entity_id}
              contractId={detail.contract_id}
              title="Payment Security Documents"
            />

            {detail.events?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 16 }}>Lifecycle events</div>
                <div className="timeline">
                  {detail.events.slice().reverse().slice(0, 12).map((ev) => {
                    const d = parse(ev.details) || {};
                    const more = [
                      typeof d.amount === 'number' && ['UTILIZE', 'REPLENISH'].includes(ev.event_type) && fmtCurrency(d.amount),
                      d.via === 'waterfall' && 'under a demand notice',
                      d.invocation_no,
                      d.reason || d.note || d.notes,
                    ].filter(Boolean).join(' · ');
                    return (
                      <div className="timeline-item" key={ev.id}>
                        <strong>{eventLabel(ev.event_type)}</strong> — {ev.actor_name}
                        {more && <div style={{ fontSize: 12 }}>{more}</div>}
                        <div className="t-meta">{fmtDateTime(ev.created_at)}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
