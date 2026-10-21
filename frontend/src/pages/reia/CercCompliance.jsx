import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import ComplianceCalendarPanel from '../../components/ComplianceCalendarPanel.jsx';
import { PageHeader, Card, Badge, StatCard, Tabs, Tab, Modal, Field, AlertPopup, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import ModuleGuide from '../../components/ModuleGuide.jsx';
import { getGuide } from '../../content/guides/index.js';
import { fmtDate } from '../../datetime.js';

// The CERC filing calendar: every period that owes a return, and where it stands.
//
// The Form-IV register answers "what have we prepared", which is a different
// question from "what do we owe the Commission". A month nobody started has no
// row in that register, so a register alone shows a clean sheet for exactly the
// months that are the problem. This walks the calendar instead.

const STATUS_TONE = { SUBMITTED: 'success', PREPARED: 'primary', DRAFT: 'warning', MISSING: 'danger' };
const STATUS_LABEL = { SUBMITTED: 'Filed', PREPARED: 'Prepared', DRAFT: 'Draft', MISSING: 'Not started' };

// What the button says depends on what there is to do: a period with no return
// is prepared, one in progress is reviewed, a filed one can only be looked at.
const ACTION_LABEL = { MISSING: 'Prepare Form-IV', DRAFT: 'Review filing', PREPARED: 'Review filing', SUBMITTED: 'View filing' };

const cellText = (row, key) => {
  const v = row[key];
  if (v == null || v === '') return '—';
  if (key === 'start_date' || key === 'end_date') return fmtDate(v);
  if (key === 'volume_mu') return fmtNumber(v, 4);
  if (typeof v === 'number') return fmtNumber(v, key === 'volume_recs' ? 0 : 2);
  return v;
};

/** One period's return, sorted into the formats it is filed in. */
function AnnexurePanel({ row }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let live = true;
    api.reports.cercAnnexures(row.period_type, row.period)
      .then((d) => {
        if (!live) return;
        setData(d);
        setOpen(d.annexures.find((a) => a.row_count)?.code || null);
      })
      .catch((err) => live && setError(err?.response?.data?.error || 'Could not load the annexures.'));
    return () => { live = false; };
  }, [row.period_type, row.period]);

  if (error) return <div className="audit-placeholder" role="status">{error}</div>;
  if (!data) return <div className="audit-placeholder">Loading…</div>;

  const shown = data.annexures.find((a) => a.code === open);

  return (
    <div>
      <p className="inline-note" style={{ marginTop: 0 }}>
        {data.basis === 'FORM_IV'
          ? `Bilateral rows are the lines on ${data.form_no}; exchange rows are the bids that cleared in the period.`
          : 'No return has been started for this period, so this is read straight from the trade book and the cleared bids.'}
        {' '}Forms with nothing on them are filed as NIL.
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {data.annexures.map((a) => (
          <button
            key={a.code}
            type="button"
            className={`btn btn-xs ${a.code === open ? 'btn-primary' : 'btn-outline'}`}
            title={a.title}
            onClick={() => setOpen(a.code)}
          >
            {a.code} · {a.row_count ? `${a.row_count} (${fmtNumber(a.volume_mu, 2)} MU)` : 'NIL'}
          </button>
        ))}
      </div>

      {shown && (
        <>
          <strong>Form {shown.code}</strong> — {shown.title}
          {shown.unverified && (
            <div className="audit-alert audit-alert-warn" style={{ margin: '8px 0' }}>
              The form letter for green day-ahead has not been confirmed against a filed return. Check it against
              the Commission’s current formats before filing.
            </div>
          )}
          <div className="report-table-wrap" style={{ marginTop: 8 }}>
            <table className="report-table">
              <thead>
                <tr>
                  {shown.sections.length > 0 && <th scope="col">Section</th>}
                  {shown.columns.filter((c) => c.key !== 'sr').map((c) => (
                    <th scope="col" key={c.key}>{c.group ? `${c.group}: ` : ''}{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.rows.length === 0 ? (
                  <tr><td className="empty-cell" colSpan={shown.columns.length}>NIL</td></tr>
                ) : shown.rows.map((r, i) => (
                  <tr key={`${r.source_ref || ''}-${i}`}>
                    {shown.sections.length > 0 && (
                      <td>{shown.sections.find((x) => x.key === r.section)?.label || '—'}</td>
                    )}
                    {shown.columns.filter((c) => c.key !== 'sr').map((c) => (
                      <td key={c.key}>{cellText(r, c.key)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.margins && shown.margins.rows.length > 0 && (
            <p className="inline-note">
              Margin charged: {shown.margins.rows.map((m) => (
                `${m.client} — ${Object.entries(m.margins).map(([x, v]) => `${x} ₹${Number(v).toFixed(2)}/kWh`).join(', ')}`
              )).join('; ')}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PeriodTable({ title, rows, emptyText, canOpenForm }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  async function downloadExcel(r) {
    const key = `${r.period_type}-${r.period}`;
    setBusy(key);
    setError('');
    try {
      await api.reports.cercAnnexuresXlsx(r.period_type, r.period);
    } catch (err) {
      setError(err.message || 'Could not build the Form-IV workbook.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title={title}>
      <AlertPopup open={!!error} title="Not done" message={error} onClose={() => setError('')} />
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Covers</th>
              <th scope="col">Due</th>
              <th scope="col">Status</th>
              <th scope="col">Filed</th>
              <th scope="col" className="num">Volume (MU)</th>
              <th scope="col" className="num">Margin</th>
              <th scope="col" className="num">Breaches</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="empty-cell" colSpan={9}>{emptyText}</td></tr>
            ) : rows.map((r) => {
              const key = `${r.period_type}-${r.period}`;
              return (
              <React.Fragment key={key}>
              <tr>
                <td>{r.period}{r.form_no && <div className="audit-muted">{r.form_no}</div>}</td>
                <td>{fmtDate(r.period_from)} → {fmtDate(r.period_to)}</td>
                <td>
                  {fmtDate(r.due_date)}
                  {r.overdue && <div className="audit-muted">{r.days_past_due} days past due</div>}
                </td>
                <td>
                  <Badge type={STATUS_TONE[r.status] || 'neutral'}>{STATUS_LABEL[r.status] || r.status}</Badge>
                  {r.overdue && <div><Badge type="danger">Overdue</Badge></div>}
                </td>
                <td>
                  {r.submission_date ? fmtDate(r.submission_date) : '—'}
                  {r.reference_no && <div className="audit-muted">{r.reference_no}</div>}
                </td>
                <td className="num">{r.total_volume_mu != null ? fmtNumber(r.total_volume_mu, 3) : '—'}</td>
                <td className="num">{r.trading_margin != null ? fmtNumber(r.trading_margin, 0) : '—'}</td>
                <td className="num">
                  {r.breach_count ? <Badge type="danger">{r.breach_count}</Badge> : '—'}
                  {r.breaches_from === 'TRADE_BOOK' && (
                    <div className="audit-muted">{r.nil_return ? 'No trades: a NIL return is owed' : `${r.trade_count} trade${r.trade_count === 1 ? '' : 's'} in the book`}</div>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {canOpenForm && (
                      <button
                        type="button"
                        className={`btn btn-xs ${r.status === 'MISSING' ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => navigate(`/trading/form-iv?period_type=${r.period_type}&period=${r.period}`)}
                      >
                        {ACTION_LABEL[r.status] || 'Open'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-xs btn-outline"
                      aria-expanded={expanded === key}
                      onClick={() => setExpanded(expanded === key ? null : key)}
                    >
                      {expanded === key ? 'Hide annexures' : 'Annexures'}
                    </button>
                    <button type="button" className="btn btn-xs btn-ghost" disabled={busy === key} onClick={() => downloadExcel(r)}>
                      {busy === key ? 'Preparing…' : 'Excel'}
                    </button>
                  </div>
                </td>
              </tr>
              {expanded === key && (
                <tr>
                  <td colSpan={9} style={{ background: 'var(--bg-subtle, var(--t-blue-50))' }}><AnnexurePanel row={r} /></td>
                </tr>
              )}
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const FEE_TONE = { PAID: 'success', PAID_LATE: 'warning', SHORT: 'danger', DUE: 'warning', OVERDUE: 'danger' };
const FEE_LABEL = { PAID: 'Paid', PAID_LATE: 'Paid late', SHORT: 'Paid short', DUE: 'Due', OVERDUE: 'Overdue' };
const NW_TONE = { COMPLIANT: 'success', PENDING: 'warning', STALE: 'warning', SHORTFALL: 'danger' };
const NW_LABEL = { COMPLIANT: 'Meets minimum', PENDING: 'Not recorded', STALE: 'Certificate out of date', SHORTFALL: 'Below minimum' };

const EMPTY_YEAR = {
  fee_amount: '', fee_paid_on: '', fee_reference: '', net_worth_cr: '', net_worth_as_on: '',
  certificate_ref: '', certificate_filed_on: '', notes: '',
};

/** The licence's own yearly dues: the fee payable by 30 April, and the net worth certificate. */
function LicenceTracker({ canWrite }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState(EMPTY_YEAR);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.reports.cercLicence()
      .then(setData)
      .catch((err) => setError(err?.response?.data?.error || 'Could not load the licence tracker.'));
  }, []);

  function openEdit(y) {
    setFormError('');
    setEdit(y);
    setForm(Object.fromEntries(Object.keys(EMPTY_YEAR).map((k) => [k, y[k] ?? ''])));
  }

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    const today = new Date().toISOString().slice(0, 10);
    const future = [['fee_paid_on', 'Fee paid on'], ['net_worth_as_on', 'Net worth as on'], ['certificate_filed_on', 'Certificate filed on']]
      .find(([k]) => form[k] && form[k] > today);
    if (future) { setFormError(`${future[1]} (${form[future[0]]}) is in the future.`); return; }
    if (form.fee_paid_on && !(Number(form.fee_amount) > 0)) { setFormError('Record the amount paid along with the payment date.'); return; }
    if (form.fee_paid_on && !String(form.fee_reference || '').trim()) { setFormError('Record the payment reference (UTR / receipt no.) along with the payment date.'); return; }
    if (form.net_worth_cr !== '' && !form.net_worth_as_on) { setFormError('Record the date the net worth is certified as on (the balance-sheet date).'); return; }
    setSaving(true);
    setFormError('');
    try {
      setData(await api.reports.saveCercLicence(edit.fy, form));
      setEdit(null);
    } catch (err) {
      setFormError(err?.response?.data?.error || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (error) return <AlertPopup open title="Could not load the licence tracker" message={error} onClose={() => setError('')} />;
  if (!data) return <Card><div className="audit-placeholder">Loading…</div></Card>;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <div className="kpi-grid">
        <StatCard
          label="Licence fees unpaid"
          value={fmtNumber(data.totals.fee_overdue, 0)}
          hint="Past 30 April, not paid or paid short"
          tone={data.totals.fee_overdue ? 'red' : 'green'}
        />
        <StatCard
          label={`Next fee · FY ${data.next_fee.fy}`}
          value={fmtDate(data.next_fee.due_date)}
          hint={`${data.next_fee.days_left} days left · ${fmtCurrency(data.fee_amount_due)}`}
          tone={data.next_fee.days_left <= 45 ? 'amber' : 'default'}
        />
        <StatCard
          label="Net worth not recorded or out of date"
          value={fmtNumber(data.totals.net_worth_pending, 0)}
          hint={`Category ${data.category} minimum ₹${fmtNumber(data.min_net_worth_cr, 0)} crore`}
          tone={data.totals.net_worth_pending ? 'amber' : 'green'}
        />
        <StatCard
          label="Net worth below minimum"
          value={fmtNumber(data.totals.net_worth_shortfall, 0)}
          tone={data.totals.net_worth_shortfall ? 'red' : 'green'}
        />
      </div>

      {data.category_watch && (
        <Card title={`Category volume watch — FY ${data.category_watch.fy}`}>
          {data.category_watch.state === 'NO_LIMIT'
            ? <p style={{ margin: 0, fontSize: 13 }}>Traded {fmtNumber(data.category_watch.volume_mu, 2)} MU so far. Set <code>cerc_licence_category_limit_mu</code> in Masters to watch it against the Category {data.category_watch.category} ceiling.</p>
            : (
              <div style={{ fontSize: 13.5 }}>
                <Badge status={data.category_watch.state === 'OK' ? 'ACTIVE' : data.category_watch.state === 'OVER' ? 'REJECTED' : 'PENDING'}
                  label={{ OK: 'Within limit', WARN: `Above ${data.category_watch.warn_pct}%`, PROJECTED_OVER: 'Heading over', OVER: 'Limit exceeded' }[data.category_watch.state]} />
                {' '}{fmtNumber(data.category_watch.volume_mu, 2)} MU of {fmtNumber(data.category_watch.limit_mu, 0)} MU ({fmtNumber(data.category_watch.pct_of_limit, 1)}%)
                {data.category_watch.projected_mu != null && <> · projected year-end {fmtNumber(data.category_watch.projected_mu, 0)} MU</>}
              </div>
            )}
        </Card>
      )}

      <Card title={`Category ${data.category} licence — ${data.licensee}`}>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">Financial year</th>
                <th scope="col">Fee due</th>
                <th scope="col">Fee</th>
                <th scope="col">Paid</th>
                <th scope="col" className="num">Net worth (₹ cr)</th>
                <th scope="col">Net worth</th>
                <th scope="col">Certificate</th>
                <th scope="col" className="num">Volume (MU)</th>
                {canWrite && <th scope="col" />}
              </tr>
            </thead>
            <tbody>
              {data.years.map((y) => (
                <tr key={y.fy}>
                  <td>{y.fy}{y.is_current && <div className="audit-muted">Current year</div>}</td>
                  <td>
                    {fmtDate(y.fee_due_date)}
                    <div className="audit-muted">{fmtCurrency(y.fee_amount_due)}</div>
                  </td>
                  <td>
                    <Badge type={FEE_TONE[y.fee_status]}>{FEE_LABEL[y.fee_status]}</Badge>
                    {y.fee_status === 'OVERDUE' && <div className="audit-muted">{y.fee_days_past_due} days past due</div>}
                    {y.fee_status === 'PAID_LATE' && <div className="audit-muted">{y.fee_days_late} days after the due date</div>}
                    {y.fee_status === 'SHORT' && <div className="audit-muted">{fmtCurrency(y.fee_short_by)} short</div>}
                    {y.fee_late_surcharge > 0 && (
                      <div className="audit-muted">
                        Late surcharge {fmtCurrency(y.fee_late_surcharge)} (1.25% a month)
                        {y.fee_late_surcharge_paid != null ? ` · paid ${fmtCurrency(y.fee_late_surcharge_paid)}` : ' · not recorded as paid'}
                      </div>
                    )}
                  </td>
                  <td>
                    {y.fee_paid_on ? fmtDate(y.fee_paid_on) : '—'}
                    {y.fee_paid_on && (
                      <div className="audit-muted">
                        {y.fee_amount != null ? `${fmtCurrency(y.fee_amount)} · ` : ''}{y.fee_reference}
                      </div>
                    )}
                  </td>
                  <td className="num">
                    {y.net_worth_cr != null ? fmtNumber(y.net_worth_cr, 2) : '—'}
                    {y.net_worth_as_on && <div className="audit-muted">as on {fmtDate(y.net_worth_as_on)}</div>}
                  </td>
                  <td>
                    <Badge type={NW_TONE[y.net_worth_status]}>{NW_LABEL[y.net_worth_status]}</Badge>
                    {y.net_worth_status === 'STALE' && <div className="audit-muted">Needs one as on {fmtDate(y.net_worth_stale_before)} or later</div>}
                  </td>
                  <td>
                    {y.certificate_ref || '—'}
                    {y.certificate_filed_on && <div className="audit-muted">filed {fmtDate(y.certificate_filed_on)}</div>}
                  </td>
                  <td className="num">{y.volume_mu != null ? fmtNumber(y.volume_mu, 2) : '—'}</td>
                  {canWrite && (
                    <td><button type="button" className="btn btn-xs btn-outline" onClick={() => openEdit(y)}>Record</button></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="report-count">
          Nothing on this tab comes out of trade data: a fee is unpaid, and a net worth unrecorded, until someone
          enters it here. Volume is what the year’s Form-IV returns add up to, shown because volume is what
          decides the licence category. The fee amount and the minimum net worth are parameters in Masters —
          check both against the regulation in force, since the Commission revises them.
        </p>
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Licence compliance · FY ${edit.fy}` : ''} width={620}>
        <AlertPopup open={!!formError} title="Not saved" message={formError} onClose={() => setFormError('')} />
        <form onSubmit={save}>
          <div className="form-grid">
            <Field label="Fee paid on"><input type="date" max={new Date().toISOString().slice(0, 10)} value={form.fee_paid_on} onChange={set('fee_paid_on')} /></Field>
            <Field label="Amount paid (₹)"><input type="number" min="0" step="0.01" value={form.fee_amount} onChange={set('fee_amount')} /></Field>
          </div>
          <Field label="Payment reference (UTR / receipt no.)"><input value={form.fee_reference} onChange={set('fee_reference')} /></Field>
          <div className="form-grid">
            <Field label="Net worth (₹ crore)"><input type="number" min="0" step="0.01" value={form.net_worth_cr} onChange={set('net_worth_cr')} /></Field>
            <Field label="Net worth as on"><input type="date" max={new Date().toISOString().slice(0, 10)} value={form.net_worth_as_on} onChange={set('net_worth_as_on')} /></Field>
          </div>
          <div className="form-grid">
            <Field label="Certificate reference"><input value={form.certificate_ref} onChange={set('certificate_ref')} /></Field>
            <Field label="Certificate filed on"><input type="date" max={new Date().toISOString().slice(0, 10)} value={form.certificate_filed_on} onChange={set('certificate_filed_on')} /></Field>
          </div>
          <Field label="Notes"><input value={form.notes} onChange={set('notes')} /></Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export default function CercCompliance({ embedded = false }) {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [view, setView] = useState(['licence', 'next90'].includes(searchParams.get('view')) ? searchParams.get('view') : 'calendar');
  // The Form-IV screen belongs to the trading module, so the shortcut into it
  // is only offered to roles that screen will actually let in.
  const canOpenForm = ROLE_GROUPS.TRADING_ALL.includes(user?.role);
  const canWriteLicence = [...ROLE_GROUPS.REIA_WRITE, ...ROLE_GROUPS.TRADING_WRITE].includes(user?.role);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });

  function load(next = range) {
    if (next.from && next.to && next.from > next.to) {
      setError(`The range starts (${next.from}) after it ends (${next.to}). Pick a From month on or before the To month.`);
      return;
    }
    setLoading(true);
    setError('');
    const params = {};
    if (next.from) params.from = next.from;
    if (next.to) params.to = next.to;
    api.reports.cercCompliance(params)
      .then(setData)
      .catch((err) => {
        setError(err?.response?.data?.error || 'Could not load the filing calendar.');
        setData(null);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const totals = data?.totals;

  return (
    <div className="page">
      <PageHeader
        title="CERC Compliance"
        subtitle="Every period that owes the Commission a return, monthly and annual"
      />

      <Tabs style={{ marginBottom: 18 }}>
        <Tab active={view === 'next90'} onClick={() => setView('next90')}>Next 90 days</Tab>
        <Tab active={view === 'calendar'} onClick={() => setView('calendar')}>Calendar</Tab>
        <Tab active={view === 'licence'} onClick={() => setView('licence')}>Licence fee &amp; net worth</Tab>
        <Tab active={view === 'fyi'} onClick={() => setView('fyi')}>FYI</Tab>
      </Tabs>

      {view === 'licence' && <LicenceTracker canWrite={canWriteLicence} />}

      {view === 'fyi' && <ModuleGuide guide={getGuide('cerc')} />}
      {view === 'next90' && <ComplianceCalendarPanel />}

      {view === 'calendar' && (
      <>
      <AlertPopup open={!!error} title="Could not show the calendar" message={error} onClose={() => setError('')} />

      <Card>
        <div className="report-criteria">
          <label className="report-search">
            From
            <input type="month" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </label>
          <label className="report-search">
            To
            <input type="month" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </label>
          <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => load()}>
            {loading ? 'Loading…' : 'Apply'}
          </button>
          {(range.from || range.to) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setRange({ from: '', to: '' }); load({ from: '', to: '' }); }}
            >
              Clear
            </button>
          )}
        </div>
      </Card>

      {loading && !data ? (
        <Card><div className="audit-placeholder">Loading…</div></Card>
      ) : !data ? null : data.note ? (
        <Card><div className="audit-placeholder">{data.note}</div></Card>
      ) : (
        <>
          <div className="kpi-grid">
            <StatCard
              label="Not started"
              value={fmtNumber(totals.missing, 0)}
              hint="Periods with no return at all"
              tone={totals.missing ? 'red' : 'green'}
            />
            <StatCard
              label="Past their deadline"
              value={fmtNumber(totals.overdue, 0)}
              tone={totals.overdue ? 'red' : 'green'}
            />
            <StatCard label="Filed" value={`${fmtNumber(totals.submitted, 0)} of ${fmtNumber(totals.expected, 0)}`} tone="blue" />
            <StatCard
              label="Margin breaches reported"
              value={fmtNumber(totals.open_breaches, 0)}
              hint="Transactions over the CERC cap"
              tone={totals.open_breaches ? 'amber' : 'default'}
            />
          </div>

          <PeriodTable
            title="Monthly returns"
            rows={data.monthly}
            canOpenForm={canOpenForm}
            emptyText="No completed month owes a return yet."
          />
          <PeriodTable
            title="Annual returns"
            rows={data.annual}
            canOpenForm={canOpenForm}
            emptyText="No financial year has ended yet."
          />

          <p className="report-count">
            A period is listed because the platform has trading data for it, whether or not anybody has started its
            return — which is the part a register of prepared filings cannot show. The current month is not listed
            until it ends. Deadlines are the period end plus the filing window in Masters.
          </p>
        </>
      )}
      </>
      )}
    </div>
  );
}
