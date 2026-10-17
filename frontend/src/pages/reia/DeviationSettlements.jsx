import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { DsmStatementSync, DsmPoolTracker } from '../../components/DsmDeskPanels.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, Tabs, Tab, AlertPopup, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import ModuleGuide from '../../components/ModuleGuide.jsx';
import { getGuide } from '../../content/guides/index.js';

const EMPTY = {
  contract_id: '', plant_code: '', plant_name: '', period_month: '', week_no: '', week_date: '',
  entry_type: 'PRIMARY', scheduled_mwh: '', actual_mwh: '', deviation_rate: '', notes: '',
};

const RAISE_EMPTY = { contract_id: '', dsa_account_id: '', entity_name: '', notes: '' };
const STATUSES = ['CALCULATED', 'SUBMITTED', 'DISPATCHED', 'CANCELLED'];
const errOf = (err, fallback) => err?.response?.data?.error || err?.message || fallback;

/** The section of the NRPC statement a contract's station is printed under. */
export function stationFor(contract) {
  const no = String(contract?.contract_no || '').toUpperCase();
  if (no.includes('NJHPS')) return 'NATHPA JHAKRI HEP';
  if (no.includes('RHPS')) return 'RAMPUR HEP';
  if (no.includes('SGEL')) return 'SJVN GREEN ENERGY';
  return '';
}

// ₹-signed formatter: +recoverable (green) / −payable (red)
function SignedAmount({ v }) {
  const n = Number(v) || 0;
  const color = n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text-light)';
  return <span style={{ color, fontWeight: 600 }}>{n > 0 ? '+' : ''}{fmtCurrency(n)}</span>;
}

/**
 * Where a row's figure came from, which decides what may be done with it.
 *
 * Estimated  priced off a rate the desk entered. Good enough to accrue a
 *            provision against; never good enough to bill, because NRPC prices
 *            each 15-minute block against the frequency in it.
 * Official   the figure NRPC published for that entity and week.
 * Invoiced   an official row that has become a supplementary bill.
 * Superseded an official row whose statement NRPC has since reissued.
 */
function SourceBadge({ row }) {
  const base = { fontSize: 13, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' };
  if (row.status === 'DISPATCHED') {
    return (
      <span style={{ ...base, background: 'var(--blue-bg)', color: 'var(--blue)' }} title="A supplementary bill has been raised from this row">
        Invoiced
      </span>
    );
  }
  if (row.dsa_superseded) {
    return (
      <span style={{ ...base, background: 'var(--red-bg)', color: 'var(--red)' }} title="NRPC has reissued the statement behind this row. Import the current one.">
        Superseded
      </span>
    );
  }
  if (row.is_estimate) {
    return (
      <span style={{ ...base, background: 'var(--amber-bg)', color: 'var(--amber)' }} title="Priced from a rate, not the published settlement. Use it to accrue, not to bill.">
        Estimated
      </span>
    );
  }
  return (
    <span
      style={{ ...base, background: 'var(--green-bg)', color: 'var(--green)' }}
      title={`Per NRPC Deviation Settlement Account${row.dsa_statement?.week_code ? ` · ${row.dsa_statement.week_code}` : ''}`}
    >
      Official DSA
    </span>
  );
}

// Which stations a desk's DSM screen shows. REIA's screen shows every station,
// as it always has; the Hydro and Thermal desks see their own.
const VERTICAL_TYPES = { HYDRO: ['Hydro', 'PSP'], THERMAL: ['Thermal'] };
const VERTICAL_WRITE = { REIA: ROLE_GROUPS.REIA_WRITE, HYDRO: ROLE_GROUPS.HYDRO_THERMAL_WRITE, THERMAL: ROLE_GROUPS.THERMAL_WRITE };

export default function DeviationSettlements({ vertical = 'REIA' }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canWrite = (VERTICAL_WRITE[vertical] || ROLE_GROUPS.REIA_WRITE).includes(user?.role);
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [summary, setSummary] = useState({});
  const [filters, setFilters] = useState({ contract_id: '', period_month: '', status: '' });
  // What went wrong on the page itself, and what was just done — a refusal to
  // delete a week or open a statement used to be swallowed without a word.
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusyState] = useState('');
  // The lock stops a second click that lands before the next render; state alone does not.
  const lock = useRef('');
  const setBusy = (what) => { lock.current = what; setBusyState(what); };
  // Raising a week from a statement NRPC published: the path the module is for.
  const [showRaise, setShowRaise] = useState(false);
  const [raise, setRaise] = useState(RAISE_EMPTY);
  const [accounts, setAccounts] = useState([]);
  const [statement, setStatement] = useState(null);
  const [raiseError, setRaiseError] = useState('');
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState('');
  const [dispatchRow, setDispatchRow] = useState(null);
  const [dispatchForm, setDispatchForm] = useState({ invoice_no: '', dispatch_date: '' });
  const [dispatchError, setDispatchError] = useState('');
  const [tab, setTab] = useState('weeks');
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadResult, setUploadResult] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = vertical === 'REIA' ? {} : { vertical };
    if (filters.contract_id) params.contract_id = filters.contract_id;
    if (filters.period_month) params.period_month = filters.period_month;
    const listParams = filters.status ? { ...params, status: filters.status } : params;
    Promise.all([
      api.deviation.list(listParams),
      api.deviation.summary(params),
    ]).then(([list, sum]) => { setRows(list); setSummary(sum || {}); })
      .catch((err) => setPageError(errOf(err, 'The deviation weeks could not be loaded.')))
      .finally(() => setLoading(false));
  }, [vertical, filters.contract_id, filters.period_month, filters.status]);

  useEffect(load, [load]);
  useEffect(() => {
    api.contracts.list().then((all) => {
      const types = VERTICAL_TYPES[vertical];
      setContracts(types ? (all || []).filter((c) => types.includes(c.project_type)) : (all || []));
    }).catch(() => {});
  }, [vertical]);

  const devPreview = (Number(form.actual_mwh) || 0) - (Number(form.scheduled_mwh) || 0);
  const amtPreview = Math.round(devPreview * (Number(form.deviation_rate) || 0));

  function openAdd() { setForm(EMPTY); setEditId(null); setError(''); setShow(true); }
  function openEdit(r) {
    setForm({
      contract_id: r.contract_id, plant_code: r.plant_code || '', plant_name: r.plant_name || '',
      period_month: r.period_month, week_no: r.week_no, week_date: r.week_date || '',
      entry_type: r.entry_type, scheduled_mwh: r.scheduled_mwh, actual_mwh: r.actual_mwh,
      deviation_rate: r.deviation_rate, notes: r.notes || '',
    });
    setEditId(r.id); setError(''); setShow(true);
  }

  async function save(e) {
    e.preventDefault();
    if (lock.current) return;
    setError('');
    setBusy('save');
    try {
      // An official row keeps NRPC's figures; only its labels and notes are sent.
      const body = editingOfficial
        ? { plant_code: form.plant_code, plant_name: form.plant_name, week_date: form.week_date, notes: form.notes }
        : form;
      if (editId) await api.deviation.update(editId, body);
      else await api.deviation.create(body);
      setShow(false); load();
    } catch (err) {
      setError(errOf(err, 'Failed to save deviation entry.'));
    } finally {
      setBusy('');
    }
  }

  async function viewSource(r) {
    setPageError('');
    try {
      await api.nrpcDsa.openPdf(r.dsa_account_id);
    } catch (err) {
      setPageError(errOf(err, 'Could not open the statement.'));
    }
  }

  function openRaise() {
    setRaise(RAISE_EMPTY);
    setStatement(null);
    setRaiseError('');
    setShowRaise(true);
    if (!accounts.length) {
      api.nrpcDsa.accounts().then(setAccounts).catch((err) => setRaiseError(errOf(err, 'The statements held could not be listed.')));
    }
  }
  function pickStatement(id, contractId = raise.contract_id) {
    setRaise((r) => ({ ...r, dsa_account_id: id, entity_name: '' }));
    setStatement(null);
    setRaiseError('');
    if (!id) return;
    api.nrpcDsa.account(id).then((a) => {
      setStatement(a);
      const want = stationFor(contracts.find((c) => c.id === contractId));
      if (want && a.totals.some((t) => t.entity_name === want)) setRaise((r) => ({ ...r, entity_name: want }));
    }).catch((err) => setRaiseError(errOf(err, 'That statement could not be opened.')));
  }
  function pickRaiseContract(id) {
    const want = stationFor(contracts.find((c) => c.id === id));
    setRaise((r) => ({ ...r, contract_id: id, entity_name: want && statement?.totals.some((t) => t.entity_name === want) ? want : r.entity_name }));
  }
  async function submitRaise(e) {
    e.preventDefault();
    if (lock.current) return;
    setRaiseError('');
    setBusy('raise');
    try {
      const made = await api.deviation.fromDsa({ ...raise, notes: raise.notes.trim() || undefined });
      setShowRaise(false);
      setNotice(`${made.dsm_no} raised from the statement. Nothing is billed yet — check the figure, then generate the supplementary bill.`);
      load();
    } catch (err) {
      setRaiseError(errOf(err, 'The week could not be raised from that statement.'));
    } finally {
      setBusy('');
    }
  }

  function openUpload() {
    setUploadFile(null);
    setUploadError('');
    setUploadResult(null);
    setShowUpload(true);
  }

  async function submitUpload(e) {
    e.preventDefault();
    if (!uploadFile) { setUploadError('Choose the statement PDF first.'); return; }
    setUploading(true);
    setUploadError('');
    try {
      const res = await api.nrpcDsa.upload(uploadFile);
      setUploadResult(res);
      load();
    } catch (err) {
      const d = err.response?.data;
      // A statement that does not reconcile against its own printed totals is
      // refused, and the reasons are worth showing rather than summarising.
      setUploadError(d?.problems?.length
        ? `${d.error}\n\n${d.problems.slice(0, 6).join('\n')}`
        : (d?.error || 'Could not read that file as an NRPC Deviation Settlement Account.'));
    } finally {
      setUploading(false);
    }
  }

  // Asked in the page, not with the browser's own dialog.
  const [confirmDelete, setConfirmDelete] = useState(null);
  async function doCancel(r) {
    setConfirmDelete(null);
    setPageError('');
    try {
      await api.deviation.remove(r.id);
      setNotice(`${r.dsm_no} deleted.`);
    } catch (err) {
      setPageError(errOf(err, 'That week could not be deleted.'));
    }
    load();
  }
  function openDispatch(r) {
    setDispatchRow(r);
    setDispatchError('');
    setDispatchForm({ invoice_no: '', dispatch_date: new Date().toISOString().split('T')[0] });
  }
  async function doDispatch(e) {
    e.preventDefault();
    if (lock.current) return;
    setDispatchError('');
    setBusy('dispatch');
    try {
      // Raised straight from CALCULATED: this modal is the review step, showing
      // the figure and the statement it came from before anything is billed.
      const billed = await api.deviation.dispatch(dispatchRow.id, dispatchForm);
      setDispatchRow(null);
      setNotice(`Pool bill ${billed.invoice_no} raised as a draft from ${billed.dsm_no} — settled with the NRPC deviation pool, due as the statement says. It goes for approval under Billing & Invoicing.`);
      load();
    } catch (err) {
      setDispatchError(errOf(err, 'Failed to raise the supplementary bill.'));
      load();
    } finally {
      setBusy('');
    }
  }
  const editingOfficial = !!editId && rows.find((r) => r.id === editId)?.is_estimate === false;
  const chosenTotal = statement?.totals.find((t) => t.entity_name === raise.entity_name) || null;
  const alreadyRaised = statement?.raised?.find((x) => x.contract_id === raise.contract_id) || null;
  // The station this contract is on the statement, and whether the one picked is it.
  const ownStation = stationFor(contracts.find((c) => c.id === raise.contract_id));
  const SJVN_SECTIONS = ['NATHPA JHAKRI HEP', 'RAMPUR HEP', 'SJVN GREEN ENERGY'];
  const wrongStation = !!raise.entity_name && !!raise.contract_id
    && (ownStation ? raise.entity_name !== ownStation : SJVN_SECTIONS.includes(raise.entity_name));
  const unknownStation = !!raise.entity_name && !!raise.contract_id && !ownStation && !wrongStation;

  const columns = [
    { key: 'dsm_no', header: 'DSM No.' },
    { key: 'contract_no', header: 'Contract' },
    { key: 'period_month', header: 'Period' },
    { key: 'week_no', header: 'Week', render: (r) => `W${r.week_no}${r.entry_type === 'REVISED' ? ' (R)' : ''}` },
    { key: 'scheduled_mwh', header: 'Scheduled', render: (r) => `${fmtNumber(r.scheduled_mwh)} MWh` },
    { key: 'actual_mwh', header: 'Actual', render: (r) => `${fmtNumber(r.actual_mwh)} MWh` },
    { key: 'deviation_mwh', header: 'Deviation', render: (r) => `${r.deviation_mwh > 0 ? '+' : ''}${fmtNumber(r.deviation_mwh)} MWh` },
    { key: 'deviation_amount', header: 'Net Amount', render: (r) => <SignedAmount v={r.deviation_amount} /> },
    {
      key: 'source',
      header: 'Source',
      render: (r) => <SourceBadge row={r} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Badge status={r.status} />
          {(r.invoice_no || r.invoice_id) && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: 0, fontSize: 13, textAlign: 'left', color: 'var(--primary)', fontWeight: 600 }}
              onClick={(e) => { e.stopPropagation(); navigate(r.invoice_id ? `/reia/invoices?id=${r.invoice_id}` : '/reia/invoices'); }}
              title={r.invoice_status ? `Invoice ${r.invoice_status}` : 'Open Invoices'}
            >
              {r.invoice_no || r.invoice_id}
            </button>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => {
        if (!canWrite || r.status === 'CANCELLED') return null;
        const billed = r.status === 'DISPATCHED';
        const official = !r.is_estimate;
        return (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
            {billed && (
              <button className="btn btn-xs btn-outline" onClick={() => navigate(r.invoice_id ? `/reia/invoices?id=${r.invoice_id}` : '/reia/invoices')}>
                View invoice
              </button>
            )}

            {!billed && official && (
              <button
                className="btn btn-xs btn-success"
                disabled={r.dsa_superseded}
                title={r.dsa_superseded
                  ? 'The statement behind this row has been superseded. Import the current one and raise the bill from that.'
                  : 'Raise the supplementary bill from the published figure'}
                onClick={() => openDispatch(r)}
              >
                Generate supplementary bill
              </button>
            )}

            {/* An estimate is priced off a rate, which is not how NRPC settles.
                The server refuses to bill one; saying so here saves the trip. */}
            {!billed && !official && (
              <span style={{ fontSize: 13, color: 'var(--text-light)', alignSelf: 'center' }} title="Import the NRPC statement for this week and raise the bill from that.">
                Estimate — not billable
              </span>
            )}

            {official && r.dsa_account_id && (
              <button
                className="btn btn-xs btn-outline"
                onClick={() => viewSource(r)}
                title="Open the NRPC statement this figure came from"
              >
                View source
              </button>
            )}

            {!billed && !official && (
              <button className="btn btn-xs btn-outline" onClick={() => openEdit(r)}>Edit estimate</button>
            )}
            {!billed && official && (
              <button className="btn btn-xs btn-outline" onClick={() => openEdit(r)}>Notes</button>
            )}
            {!billed && <button className="btn btn-xs btn-danger" onClick={() => setConfirmDelete(r)}>Delete</button>}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title={vertical === 'HYDRO' ? 'Deviation Settlement (DSM) — Hydro stations' : vertical === 'THERMAL' ? 'Deviation Settlement (DSM) — Thermal stations' : 'Deviation Settlement (DSM)'}
        subtitle={vertical === 'REIA'
          ? 'Weekly grid deviation charges/credits per NRPC — schedule vs actual, plant-wise'
          : 'Each station\'s weekly deviation account from the regional DSA — payable to or receivable from the pool, week by week'}
        actions={tab === 'weeks' && canWrite && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={openRaise}>
              Raise from NRPC statement
            </button>
            <button className="btn btn-secondary" onClick={openUpload}>
              Upload official NRPC DSA
            </button>
            <button className="btn btn-secondary" onClick={openAdd}>
              Add manual estimate
            </button>
          </div>
        )}
      />

      <Tabs style={{ marginBottom: 18 }}>
        <Tab active={tab === 'weeks'} onClick={() => setTab('weeks')}>Weeks</Tab>
        <Tab active={tab === 'fyi'} onClick={() => setTab('fyi')}>FYI</Tab>
      </Tabs>

      {tab === 'fyi' && <ModuleGuide guide={getGuide('dsm')} />}

      {tab === 'weeks' && (
      <>
      {/* DSM1 / DSM4: statements against the register, and the pool's payments. */}
      <DsmStatementSync canWrite={canWrite} onChanged={load} />
      <DsmPoolTracker />
      {notice && (
        <div className="alert alert-success" role="status" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <span>{notice}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNotice('')} aria-label="Dismiss">✕</button>
        </div>
      )}
      <div className="kpi-grid">
        <StatCard
          label="Weeks recorded"
          value={summary.weeks ?? 0}
          hint={summary.estimated > 0
            ? `${summary.from_statement || 0} from NRPC statements, ${summary.estimated} estimated`
            : 'a revised week counts once'}
        />
        <StatCard label="Net Balance" value={fmtCurrency(summary.net_amount || 0)} tone={(summary.net_amount || 0) >= 0 ? 'green' : 'red'} hint="+ recoverable / − payable" />
        <StatCard label="Recoverable" value={fmtCurrency(summary.recoverable || 0)} tone="green" />
        <StatCard label="Payable by SJVN" value={fmtCurrency(Math.abs(summary.payable || 0))} tone="amber" />
        <StatCard
          label="Pending reconciliation"
          value={summary.pending_reconciliation ?? 0}
          tone={(summary.pending_reconciliation ?? 0) > 0 ? 'amber' : 'default'}
          hint={(summary.estimates_replaceable ?? 0) > 0
            ? `${summary.estimates_replaceable} more estimate(s) can be replaced — their statement has arrived`
            : 'estimates with no NRPC statement yet'}
        />
      </div>

      {filters.status && (
        <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--text-light)' }}>
          The cards count every week that is not cancelled, for the contract and month chosen. The Status filter narrows the table only.
        </p>
      )}
      <div className="filters-bar">
        <select value={filters.contract_id} onChange={(e) => setFilters({ ...filters, contract_id: e.target.value })} aria-label="Contract">
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
        </select>
        <input type="month" value={filters.period_month} onChange={(e) => setFilters({ ...filters, period_month: e.target.value })} aria-label="Period" />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        {(filters.contract_id || filters.period_month || filters.status) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters({ contract_id: '', period_month: '', status: '' })}>Clear filters</button>
        )}
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : (filters.contract_id || filters.period_month || filters.status) ? 'No deviation weeks match these filters.' : 'No deviation entries yet.'} />
      </Card>

      </>
      )}

      <Modal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        title="Upload the NRPC Deviation Settlement Account"
        width={620}
      >
        {!uploadResult ? (
          <form onSubmit={submitUpload}>
            <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-muted)', marginTop: 0 }}>
              NRPC publishes one statement a week covering every entity in the Northern Region.
              Upload it whole — every entity and every day is imported. SJVN&apos;s stations are
              then raised from it, a week at a time, with “Raise from NRPC statement”.
            </p>

            <Field label="Statement PDF" required htmlFor="dsa-file">
              <input
                id="dsa-file"
                type="file"
                accept="application/pdf,.pdf"
                required
                onChange={(e) => { setUploadFile(e.target.files?.[0] || null); setUploadError(''); }}
              />
            </Field>


            <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 8 }}>
              Each entity&apos;s daily rows are added up and checked against the total the
              statement prints for it. A statement that does not reconcile against itself is
              refused rather than stored, so a half-read week never sits here looking like data.
            </div>

            <div className="form-actions" style={{ marginTop: 20 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowUpload(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={uploading}>
                {uploading ? 'Reading the statement…' : 'Import statement'}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <div style={{
              padding: '14px 16px', borderRadius: 8, marginBottom: 14,
              background: 'var(--green-bg)', borderLeft: '3px solid var(--green)',
            }}>
              <div style={{ fontWeight: 700, color: 'var(--green)', fontSize: 14 }}>
                Week {uploadResult.week_no} of {uploadResult.financial_year} imported
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 4, lineHeight: 1.6 }}>
                {uploadResult.week_start} to {uploadResult.week_end} ·{' '}
                {uploadResult.entities} entities · {uploadResult.days} daily rows
                {uploadResult.superseded?.length
                  ? ` · superseded ${uploadResult.superseded.length} earlier statement(s) for this week`
                  : ''}
              </div>
            </div>

            {uploadResult.warnings?.length > 0 && (
              <div style={{
                padding: '12px 16px', borderRadius: 8, marginBottom: 14,
                background: 'var(--amber-bg)', borderLeft: '3px solid var(--amber)',
                fontSize: 13, lineHeight: 1.6,
              }}>
                <div style={{ fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}>
                  Noted while reading it
                </div>
                {uploadResult.warnings.map((w) => <div key={w}>{w}</div>)}
              </div>
            )}

            {!uploadResult.file_stored && (
              <div style={{ fontSize: 13.5, color: 'var(--amber)', marginBottom: 12 }}>
                The figures are stored, but the PDF itself could not be kept — &ldquo;View
                source&rdquo; will not open for this week.
              </div>
            )}

            <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-muted)' }}>
              The statement is in. Nothing has been billed: use “Raise from NRPC statement” to
              record a station&apos;s week from it, review the figure, then generate the supplementary bill.
            </p>

            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowUpload(false)}>Done</button>
              <button type="button" className="btn btn-primary" onClick={() => { setShowUpload(false); setAccounts([]); openRaise(); }}>Raise a week from it</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={showRaise} onClose={() => setShowRaise(false)} title="Raise a week from the NRPC statement" width={640}>
        <form onSubmit={submitRaise}>
          <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-muted)', marginTop: 0 }}>
            Pick the statement and the station&apos;s section in it. The week is recorded at the figure
            NRPC published — nothing is computed here — and nothing is billed until you generate the
            supplementary bill from it.
          </p>
          <Field label="Contract (the station's PPA)" required>
            <select required value={raise.contract_id} onChange={(e) => pickRaiseContract(e.target.value)}>
              <option value="">Select contract...</option>
              {contracts.filter((c) => c.contract_type === 'PPA').map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.project_type})</option>)}
            </select>
          </Field>
          <Field label="NRPC statement (week)" required>
            <select required value={raise.dsa_account_id} onChange={(e) => pickStatement(e.target.value)}>
              <option value="">{accounts.length ? 'Select the week...' : 'No statement is held yet — upload one first'}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  FY {a.financial_year} · WK-{a.week_no}{a.revision ? ` (${a.revision})` : ''} · {a.week_start} to {a.week_end}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Station, as the statement names it" required>
            <select required disabled={!statement} value={raise.entity_name} onChange={(e) => setRaise({ ...raise, entity_name: e.target.value })}>
              <option value="">{statement ? 'Select the entity...' : 'Choose the statement first'}</option>
              {statement && [...statement.totals].sort((a, b) => Number(b.sjvn_station) - Number(a.sjvn_station) || a.entity_name.localeCompare(b.entity_name)).map((t) => (
                <option key={t.entity_name} value={t.entity_name}>{t.entity_name}{t.sjvn_station ? ' — SJVN station' : ''}</option>
              ))}
            </select>
          </Field>

          {chosenTotal && (
            <div style={{ margin: '4px 0 14px', padding: '12px 14px', borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)', fontSize: 13, lineHeight: 1.7 }}>
              <div><strong>{chosenTotal.entity_name}</strong> · week {statement.week_no} of {statement.financial_year}{statement.issued_date ? ` · issued ${statement.issued_date}` : ''}</div>
              <div>Scheduled {fmtNumber(chosenTotal.schedule_mwh, 3)} MWh ({chosenTotal.schedule_lu} LU) · Actual {fmtNumber(chosenTotal.actual_mwh, 3)} MWh ({chosenTotal.actual_lu} LU)</div>
              <div>
                On the statement: <strong>{chosenTotal.settled_lakh} Rs Lakh</strong> — {Number(chosenTotal.settled_lakh) > 0 ? 'to be paid to the pool' : Number(chosenTotal.settled_lakh) < 0 ? 'to be received from the pool' : 'nothing to settle'}
              </div>
              <div>
                Recorded here as: <SignedAmount v={chosenTotal.settlement_rupees} /> <span style={{ color: 'var(--text-light)' }}>(+ recoverable / − payable — the statement&apos;s sign is the reverse)</span>
              </div>
              {!statement.has_pdf && <div style={{ color: 'var(--text-light)' }}>The PDF of this statement is not held, so “View source” will not open for it.</div>}
            </div>
          )}
          {wrongStation && (
            <div className="form-error" role="alert">
              {ownStation
                ? `This contract is ${ownStation} on the statement. ${raise.entity_name} is another station's section, so its week cannot be raised here.`
                : `${raise.entity_name} is an SJVN station with its own contract. Raise its week on that contract.`}
            </div>
          )}
          {unknownStation && (
            <div className="ps-alert amber" role="status">
              This contract is not one of SJVN's stations on the statement, so nothing here can check that {raise.entity_name} is its section. Make sure it is before raising the week.
            </div>
          )}
          {alreadyRaised && (
            <div className="form-error" role="status">
              This contract already has a week raised from this statement — {alreadyRaised.dsm_no} ({alreadyRaised.status}).
            </div>
          )}
          <Field label="Notes (optional)"><input value={raise.notes} onChange={(e) => setRaise({ ...raise, notes: e.target.value })} /></Field>
          <div className="form-actions" style={{ marginTop: 18 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setShowRaise(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy === 'raise' || !chosenTotal || wrongStation}>{busy === 'raise' ? 'Raising…' : 'Raise this week'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={show} onClose={() => setShow(false)} title={editId ? 'Edit Deviation Week' : 'Add Deviation Week'} width={600}>
        <form onSubmit={save}>
          
          <h4 style={{ fontSize: 14, color: 'var(--primary)', marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>1. Station & Time Details</h4>
          <Field label="Contract">
            <select required disabled={!!editId} value={form.contract_id} onChange={(e) => {
              const cid = e.target.value;
              const c = contracts.find(x => x.id === cid);
              let pCode = form.plant_code;
              let pName = form.plant_name;
              if (c && c.contract_no) {
                if (c.contract_no.includes('NJHPS')) { pCode = '001'; pName = 'NATHPA JHAKRI'; }
                else if (c.contract_no.includes('RHPS')) { pCode = '002'; pName = 'RAMPUR HEP'; }
              }
              setForm({ ...form, contract_id: cid, plant_code: pCode, plant_name: pName });
            }}>
              <option value="">Select contract...</option>
              {contracts.filter((c) => c.contract_type === 'PPA').map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.project_type})</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Plant Code"><input value={form.plant_code} placeholder="NJHPS=001 / RHPS=002" onChange={(e) => setForm({ ...form, plant_code: e.target.value })} /></Field>
            <Field label="Plant Name"><input value={form.plant_name} placeholder="e.g. NATHPA JHAKRI" onChange={(e) => setForm({ ...form, plant_name: e.target.value })} /></Field>
          </div>
          <div className="form-grid">
            <Field label="Period (Month)"><input required type="month" disabled={!!editId} value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} /></Field>
            <Field label="Week No. (financial-year week, 1–53)"><input required type="number" min="1" max="53" step="1" disabled={!!editId} value={form.week_no} onChange={(e) => setForm({ ...form, week_no: e.target.value })} /></Field>
          </div>
          <div className="form-grid" style={{ marginBottom: 24 }}>
            <Field label="Entry Type">
              <select disabled={!!editId} value={form.entry_type} onChange={(e) => setForm({ ...form, entry_type: e.target.value })}>
                <option value="PRIMARY">Primary</option>
                <option value="REVISED">Revised</option>
              </select>
            </Field>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
            <h4 style={{ fontSize: 14, color: 'var(--primary)', margin: 0 }}>2. Energy Delivery Details</h4>
            <span style={{ fontSize: 13.5, color: 'var(--text-light)' }}>
              manual entry — an estimate
            </span>
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--text-light)', marginBottom: 12, lineHeight: 1.5 }}>
            NRPC publishes one weekly Deviation Settlement Account covering every entity
            in the region, not a per-plant feed. Importing that statement gives the
            published figure for this station; entering figures here gives an estimate
            until it arrives.
          </div>

          {editingOfficial && (
            <p className="inline-note" style={{ marginTop: 0 }}>
              These are the figures NRPC published for this week, so they are shown but cannot be changed here — only the plant label, week date and notes. A corrected figure comes from the revised statement.
            </p>
          )}
          <div className="form-grid">
            <Field label="Target (Scheduled MWh)"><input required type="number" step="0.001" min="0" disabled={editingOfficial} value={form.scheduled_mwh} onChange={(e) => setForm({ ...form, scheduled_mwh: e.target.value })} /></Field>
            <Field label="Delivered (Actual MWh)"><input required type="number" step="0.001" min="0" disabled={editingOfficial} value={form.actual_mwh} onChange={(e) => setForm({ ...form, actual_mwh: e.target.value })} /></Field>
          </div>
          {!editingOfficial && (
            <Field label="Deviation Rate (₹/MWh)"><input required type="number" step="0.01" value={form.deviation_rate} placeholder="DSM rate per NRPC" onChange={(e) => setForm({ ...form, deviation_rate: e.target.value })} /></Field>
          )}

          <div style={{
            margin: '16px 0', padding: '14px 16px', borderRadius: 8,
            background: 'var(--bg)', border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              Estimated deviation {devPreview > 0 ? '+' : ''}{fmtNumber(devPreview)} MWh
              {'  ·  '}<SignedAmount v={amtPreview} />
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--text-light)', marginTop: 6, lineHeight: 1.5 }}>
              + recoverable from beneficiary · − payable by SJVN.
              {' '}This is {fmtNumber(Math.abs(devPreview))} MWh × ₹{Number(form.deviation_rate) || 0}/MWh,
              which is <strong>an estimate, not the settlement</strong>: NRPC prices each 15-minute
              block against the grid frequency in that block, so neither the amount nor
              necessarily its direction follows from the weekly deviation. Import the
              Deviation Settlement Account to replace this with the published figure.
            </div>
          </div>

          <Field label="Notes (Optional)"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="form-actions" style={{ marginTop: 24 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : editId ? 'Save Week' : 'Add Week'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!dispatchRow} onClose={() => { setDispatchRow(null); setDispatchError(''); }} title="Generate supplementary bill" width={460}>
        {dispatchRow && (
          <form onSubmit={doDispatch}>
            <p className="inline-note">{dispatchRow.dsm_no} · Net <SignedAmount v={dispatchRow.deviation_amount} /></p>
            {dispatchRow.dsa_statement && (
              <p style={{ fontSize: 13.5, color: 'var(--text-light)', margin: '0 0 10px', lineHeight: 1.6 }}>
                Per NRPC statement {dispatchRow.dsa_statement.week_code || `week ${dispatchRow.week_no}`}
                {dispatchRow.dsa_statement.issued_date ? `, issued ${dispatchRow.dsa_statement.issued_date}` : ''}
                {dispatchRow.dsa_entity_name ? ` · ${dispatchRow.dsa_entity_name}` : ''}.
                {' '}This is the published figure, not a computed one.
              </p>
            )}
            <p style={{ fontSize: 13, color: 'var(--text-light)', margin: '0 0 12px' }}>
              Creates a Supplementary invoice linked to this row, as a Draft. It is then
              submitted and approved under Billing &amp; Invoicing like any other bill.
              Once raised, the row is frozen.
            </p>
            <Field label="Bill / Invoice No. (optional)">
              <input value={dispatchForm.invoice_no} placeholder="auto-generated if blank (DSM-PPA / DSM-PSA)" onChange={(e) => setDispatchForm({ ...dispatchForm, invoice_no: e.target.value })} />
            </Field>
            <Field label="Dispatch Date">
              <input type="date" required value={dispatchForm.dispatch_date} onChange={(e) => setDispatchForm({ ...dispatchForm, dispatch_date: e.target.value })} />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setDispatchRow(null); setDispatchError(''); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy === 'dispatch'}>{busy === 'dispatch' ? 'Raising…' : 'Dispatch & Create Invoice'}</button>
            </div>
          </form>
        )}
      </Modal>
      {/* Refusals as a popup (house rule). */}
      {(() => {
        const errs = [[pageError, setPageError], [raiseError, setRaiseError], [error, setError], [dispatchError, setDispatchError], [uploadError, setUploadError]];
        const hit = errs.find(([m]) => m);
        return <AlertPopup open={!!hit} title="Not done" message={hit?.[0]} onClose={() => hit?.[1]('')} />;
      })()}
      <AlertPopup
        open={!!confirmDelete}
        tone="warning"
        title={`Delete ${confirmDelete?.dsm_no || 'this week'}?`}
        message="It stays on the list as cancelled, and the week can be entered again."
        okLabel="Keep it"
        onClose={() => setConfirmDelete(null)}
        actions={<button type="button" className="btn btn-danger" onClick={() => doCancel(confirmDelete)}>Delete</button>}
      />
    </div>
  );
}
