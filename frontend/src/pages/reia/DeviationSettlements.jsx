import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, Tabs, Tab, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import ModuleGuide from '../../components/ModuleGuide.jsx';
import { getGuide } from '../../content/guides/index.js';

const EMPTY = {
  contract_id: '', plant_code: '', plant_name: '', period_month: '', week_no: '', week_date: '',
  entry_type: 'PRIMARY', scheduled_mwh: '', actual_mwh: '', deviation_rate: '', notes: '',
};

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
  const base = { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' };
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

export default function DeviationSettlements() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canWrite = ROLE_GROUPS.REIA_WRITE.includes(user?.role);
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [summary, setSummary] = useState({});
  const [filters, setFilters] = useState({ contract_id: '', period_month: '' });
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
    const params = {};
    if (filters.contract_id) params.contract_id = filters.contract_id;
    if (filters.period_month) params.period_month = filters.period_month;
    Promise.all([
      api.deviation.list(params),
      api.deviation.summary(params),
    ]).then(([list, sum]) => { setRows(list); setSummary(sum || {}); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filters.contract_id, filters.period_month]);

  useEffect(load, [load]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

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
    setError('');
    try {
      if (editId) await api.deviation.update(editId, form);
      else await api.deviation.create(form);
      setShow(false); load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save deviation entry.');
    }
  }

  async function viewSource(r) {
    try {
      await api.nrpcDsa.openPdf(r.dsa_account_id);
    } catch (err) {
      setError(err.message || 'Could not open the statement.');
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

  async function doSubmit(r) { await api.deviation.submit(r.id).catch(() => {}); load(); }
  async function doCancel(r) {
    if (!window.confirm(`Cancel deviation ${r.dsm_no}?`)) return;
    await api.deviation.remove(r.id).catch(() => {}); load();
  }
  function openDispatch(r) {
    setDispatchRow(r);
    setDispatchError('');
    setDispatchForm({ invoice_no: '', dispatch_date: new Date().toISOString().split('T')[0] });
  }
  async function doDispatch(e) {
    e.preventDefault();
    setDispatchError('');
    try {
      // A row still sitting at CALCULATED is submitted on the way through, so
      // raising the bill is one confirmed action rather than two clicks that
      // ask nothing between them. This modal is the review step: it shows the
      // figure and the statement it came from before anything is billed.
      if (dispatchRow.status === 'CALCULATED') {
        await api.deviation.submit(dispatchRow.id);
      }
      await api.deviation.dispatch(dispatchRow.id, dispatchForm);
      setDispatchRow(null);
      load();
    } catch (err) {
      setDispatchError(err.response?.data?.error || 'Failed to raise the supplementary bill.');
    }
  }

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
              style={{ padding: 0, fontSize: 11, textAlign: 'left', color: 'var(--primary)', fontWeight: 600 }}
              onClick={(e) => { e.stopPropagation(); navigate('/reia/invoices'); }}
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
              <button className="btn btn-xs btn-outline" onClick={() => navigate('/reia/invoices')}>
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
              <button
                className="btn btn-xs btn-success"
                disabled
                title="An estimate cannot be billed. Import the NRPC statement for this week and raise the bill from that."
              >
                Generate supplementary bill
              </button>
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
            {!billed && <button className="btn btn-xs btn-danger" onClick={() => doCancel(r)}>Delete</button>}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Deviation Settlement (DSM)"
        subtitle="Weekly grid deviation charges/credits per NRPC — schedule vs actual, plant-wise"
        actions={tab === 'weeks' && canWrite && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={openUpload}>
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

      <div className="filters-bar">
        <select value={filters.contract_id} onChange={(e) => setFilters({ ...filters, contract_id: e.target.value })}>
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
        </select>
        <input type="month" value={filters.period_month} onChange={(e) => setFilters({ ...filters, period_month: e.target.value })} />
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No deviation entries yet.'} />
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
              Upload it whole — every entity and every day is imported, and SJVN&apos;s stations
              are then promoted into settlement rows from it.
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

            {uploadError && (
              <div className="form-error" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                {uploadError}
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 8 }}>
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
              <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 12 }}>
                The figures are stored, but the PDF itself could not be kept — &ldquo;View
                source&rdquo; will not open for this week.
              </div>
            )}

            <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-muted)' }}>
              The statement is in. Nothing has been billed: raise a settlement row for a station
              from it, review the figure, then generate the supplementary bill.
            </p>

            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={() => setShowUpload(false)}>Done</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={show} onClose={() => setShow(false)} title={editId ? 'Edit Deviation Week' : 'Add Deviation Week'} width={600}>
        {error && <div className="form-error">{error}</div>}
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
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.project_type})</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Plant Code"><input value={form.plant_code} placeholder="NJHPS=001 / RHPS=002" onChange={(e) => setForm({ ...form, plant_code: e.target.value })} /></Field>
            <Field label="Plant Name"><input value={form.plant_name} placeholder="e.g. NATHPA JHAKRI" onChange={(e) => setForm({ ...form, plant_name: e.target.value })} /></Field>
          </div>
          <div className="form-grid">
            <Field label="Period (Month)"><input required type="month" disabled={!!editId} value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} /></Field>
            <Field label="Week No."><input required type="number" min="1" disabled={!!editId} value={form.week_no} onChange={(e) => setForm({ ...form, week_no: e.target.value })} /></Field>
          </div>
          <div className="form-grid" style={{ marginBottom: 24 }}>
            <Field label="Week Date"><input type="date" value={form.week_date} onChange={(e) => setForm({ ...form, week_date: e.target.value })} /></Field>
            <Field label="Entry Type">
              <select disabled={!!editId} value={form.entry_type} onChange={(e) => setForm({ ...form, entry_type: e.target.value })}>
                <option value="PRIMARY">Primary</option>
                <option value="REVISED">Revised</option>
              </select>
            </Field>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
            <h4 style={{ fontSize: 14, color: 'var(--primary)', margin: 0 }}>2. Energy Delivery Details</h4>
            <span style={{ fontSize: 12, color: 'var(--text-light)' }}>
              manual entry — an estimate
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 12, lineHeight: 1.5 }}>
            NRPC publishes one weekly Deviation Settlement Account covering every entity
            in the region, not a per-plant feed. Importing that statement gives the
            published figure for this station; entering figures here gives an estimate
            until it arrives.
          </div>

          <div className="form-grid">
            <Field label="Target (Scheduled MWh)"><input required type="number" step="0.001" value={form.scheduled_mwh} onChange={(e) => setForm({ ...form, scheduled_mwh: e.target.value })} /></Field>
            <Field label="Delivered (Actual MWh)"><input required type="number" step="0.001" value={form.actual_mwh} onChange={(e) => setForm({ ...form, actual_mwh: e.target.value })} /></Field>
          </div>
          <Field label="Deviation Rate (₹/MWh)"><input required type="number" step="0.01" value={form.deviation_rate} placeholder="DSM rate per NRPC" onChange={(e) => setForm({ ...form, deviation_rate: e.target.value })} /></Field>

          <div style={{
            margin: '16px 0', padding: '14px 16px', borderRadius: 8,
            background: 'var(--bg)', border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              Estimated deviation {devPreview > 0 ? '+' : ''}{fmtNumber(devPreview)} MWh
              {'  ·  '}<SignedAmount v={amtPreview} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 6, lineHeight: 1.5 }}>
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
            <button type="submit" className="btn btn-primary">{editId ? 'Save Week' : 'Add Week'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!dispatchRow} onClose={() => { setDispatchRow(null); setDispatchError(''); }} title="Generate supplementary bill" width={460}>
        {dispatchRow && (
          <form onSubmit={doDispatch}>
            {dispatchError && <div className="form-error">{dispatchError}</div>}
            <p className="inline-note">{dispatchRow.dsm_no} · Net <SignedAmount v={dispatchRow.deviation_amount} /></p>
            {dispatchRow.dsa_statement && (
              <p style={{ fontSize: 12.5, color: 'var(--text-light)', margin: '0 0 10px', lineHeight: 1.6 }}>
                Per NRPC statement {dispatchRow.dsa_statement.week_code || `week ${dispatchRow.week_no}`}
                {dispatchRow.dsa_statement.issued_date ? `, issued ${dispatchRow.dsa_statement.issued_date}` : ''}
                {dispatchRow.dsa_entity_name ? ` · ${dispatchRow.dsa_entity_name}` : ''}.
                {' '}This is the published figure, not a computed one.
              </p>
            )}
            <p style={{ fontSize: 13, color: 'var(--text-light)', margin: '0 0 12px' }}>
              Creates a Supplementary invoice linked to this row, as a Draft at approval level 1.
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
              <button type="submit" className="btn btn-primary">Dispatch &amp; Create Invoice</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
