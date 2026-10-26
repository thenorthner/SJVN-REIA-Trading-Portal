import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import { showAlert, askConfirm } from '../../lib/dialogs.js';

const EMPTY_FORM = { period_type: 'MONTHLY', period: '', auto_generate: true, reference_no: '', notes: '' };
const EMPTY_LINE = {
  seller_name: '', buyer_name: '', contract_ref: '', period_from: '', period_to: '',
  quantum_mu: '', purchase_rate: '', sale_rate: '', source: 'MANUAL', exempt_reason: '', remarks: '',
};

const STATUS_TONE = { SUBMITTED: 'success', PREPARED: 'primary', DRAFT: 'neutral' };
const COMPLIANCE_TONE = { COMPLIANT: 'success', BREACH: 'danger', EXEMPT: 'primary' };

// Margins are quoted in paise/kWh in every CERC discussion, so show both.
const rate = (v) => (v == null ? '—' : `₹${Number(v).toFixed(2)}`);
const paise = (v) => (v == null ? '—' : `${(Number(v) * 100).toFixed(2)}p`);

const currentFy = () => {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};

/** CERC4: the annual return, rolled up from the twelve filed monthlies. */
function AnnualRollUp({ canWrite, onDone }) {
  const [fy, setFy] = useState(currentFy());
  const [pos, setPos] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const fetchPos = useCallback(() => {
    setMsg('');
    api.formIv.annual(fy).then(setPos).catch((err) => { setPos(null); setMsg(err?.response?.data?.error || 'Could not load the year.'); });
  }, [fy]);
  useEffect(() => { fetchPos(); }, [fetchPos]);
  const years = Array.from({ length: 4 }, (_, i) => { const y = Number(currentFy().slice(0, 4)) - i; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; });
  return (
    <Card title="Annual return (roll-up of the monthlies)">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <select value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">{years.map((y) => <option key={y} value={y}>FY {y}</option>)}</select>
        {pos && <span style={{ fontSize: 14.5 }}>
          {12 - pos.not_filed.length}/12 monthlies filed · {fmtNumber(pos.sum.total_volume_mu, 4)} MU · margin ₹{fmtNumber(pos.sum.trading_margin, 0)}
          {pos.annual ? <> · Annual {pos.annual.form_no} <Badge status={pos.annual.status} /></> : ' · no annual return yet'}
          {pos.differences?.length > 0 && <span style={{ color: 'var(--red-strong, #b91c1c)' }}> · {pos.differences.length} figure(s) differ from the monthlies</span>}
        </span>}
        {canWrite && pos && pos.annual?.status !== 'SUBMITTED' && (
          <button className="btn btn-primary btn-sm" disabled={busy || !pos.ready}
            title={pos.ready ? '' : `Not yet filed: ${pos.not_filed.join(', ')}`}
            onClick={async () => {
              setBusy(true); setMsg('');
              try { await api.formIv.rollUpAnnual(fy); fetchPos(); onDone?.(); setMsg('Annual return built from the twelve filed monthlies.'); }
              catch (err) { setMsg(err?.response?.data?.error || 'Roll-up failed.'); }
              finally { setBusy(false); }
            }}>{pos.annual ? 'Rebuild annual' : 'Roll up annual'}</button>
        )}
      </div>
      {pos && !pos.ready && <div style={{ fontSize: 14, color: 'var(--slate-500)' }}>Waiting on: {pos.not_filed.join(', ')}</div>}
      {msg && <div style={{ fontSize: 14.5, marginTop: 6 }}>{msg}</div>}
    </Card>
  );
}

export default function CERCFormIV() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.TRADING_WRITE.includes(user?.role);

  const [rows, setRows] = useState([]);
  const [reportBusy, setReportBusy] = useState(false);

  async function downloadRegulatoryReport() {
    setReportBusy(true);
    try {
      await api.reports.downloadPdf(
        '/reports/regulatory/pdf',
        `SJVN_Regulatory_Report_${new Date().toISOString().slice(0, 10)}.pdf`,
      );
    } catch (err) {
      showAlert(err.message || 'Could not generate the regulatory report.');
    } finally {
      setReportBusy(false);
    }
  }

  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [busy, setBusy] = useState(false);
  const [outside, setOutside] = useState(null); // { reference_no, submission_date, note }

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');

  const [lineEdit, setLineEdit] = useState(null);
  const [lineForm, setLineForm] = useState(EMPTY_LINE);
  const [lineError, setLineError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.allSettled([api.formIv.list(), api.formIv.summary()]).then(([l, s]) => {
      if (l.status === 'fulfilled') setRows(l.value || []);
      if (s.status === 'fulfilled') setSummary(s.value || {});
      const first = [l, s].find((x) => x.status === 'rejected');
      if (first) setError(first.reason?.response?.data?.error || 'Could not load Form-IV filings.');
    }).finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // Arriving from the filing calendar with a period in the URL: open that
  // period's return if there is one, otherwise start it. Runs once, after the
  // register has loaded, so a later reload does not reopen a closed modal.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkHandled = useRef(false);
  useEffect(() => {
    const period = searchParams.get('period');
    if (!period || loading || linkHandled.current) return;
    linkHandled.current = true;
    const periodType = searchParams.get('period_type') === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY';
    const existing = rows.find((r) => r.period_type === periodType && r.period === period);
    if (existing) {
      openDetail(existing);
    } else if (canWrite) {
      setForm({ ...EMPTY_FORM, period_type: periodType, period });
      setFormError('');
      setShowNew(true);
    } else {
      setError(`No Form-IV has been started for ${period}, and your role cannot create one.`);
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, loading, rows]);

  // Every write endpoint returns the full form, so the modal and the list stay
  // in step without a second round-trip.
  function applyResult(updated) {
    setDetail(updated);
    setDetailError('');
    load();
  }

  async function openDetail(row) {
    setDetailError('');
    try {
      setDetail(await api.formIv.get(row.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not open this filing.');
    }
  }

  async function runOnDetail(fn, fallbackMsg) {
    setBusy(true);
    setDetailError('');
    try {
      applyResult(await fn());
    } catch (err) {
      setDetailError(err.response?.data?.error || fallbackMsg);
    } finally {
      setBusy(false);
    }
  }

  async function createForm(e) {
    e.preventDefault();
    setFormError('');
    try {
      const created = await api.formIv.create(form);
      setShowNew(false);
      setForm(EMPTY_FORM);
      load();
      setDetail(created);
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create the filing.');
    }
  }

  function openLine(line) {
    setLineError('');
    setLineEdit(line || { id: null });
    setLineForm(line ? {
      seller_name: line.seller_name, buyer_name: line.buyer_name, contract_ref: line.contract_ref || '',
      period_from: line.period_from, period_to: line.period_to,
      quantum_mu: line.quantum_mu, purchase_rate: line.purchase_rate, sale_rate: line.sale_rate,
      source: line.source, exempt_reason: line.exempt_reason || '', remarks: line.remarks || '',
    } : { ...EMPTY_LINE, period_from: detail?.period_from || '', period_to: detail?.period_to || '' });
  }

  async function saveLine(e) {
    e.preventDefault();
    setLineError('');
    const body = {
      ...lineForm,
      quantum_mu: Number(lineForm.quantum_mu) || 0,
      purchase_rate: Number(lineForm.purchase_rate) || 0,
      sale_rate: Number(lineForm.sale_rate) || 0,
    };
    try {
      const updated = lineEdit.id
        ? await api.formIv.updateLine(lineEdit.id, body)
        : await api.formIv.addLine(detail.id, body);
      setLineEdit(null);
      applyResult(updated);
    } catch (err) {
      setLineError(err.response?.data?.error || 'Failed to save the transaction line.');
    }
  }

  async function deleteLine(line) {
    if (!(await askConfirm(`Remove line ${line.line_no} (${line.seller_name} → ${line.buyer_name})?`))) return;
    runOnDetail(() => api.formIv.deleteLine(line.id), 'Failed to remove the line.');
  }

  const editable = detail && detail.status !== 'SUBMITTED' && canWrite;
  const blockers = detail?.blockers || [];

  const columns = [
    { key: 'form_no', header: 'Form No.' },
    { key: 'period', header: 'Period', render: (r) => `${r.period}${r.period_type === 'ANNUAL' ? ' (FY)' : ''}` },
    { key: 'line_count', header: 'Txns', render: (r) => fmtNumber(r.line_count, 0) },
    { key: 'total_volume_mu', header: 'Volume (MU)', render: (r) => fmtNumber(r.total_volume_mu, 2) },
    { key: 'total_revenue', header: 'Sale Revenue', render: (r) => fmtCurrency(r.total_revenue) },
    { key: 'trading_margin', header: 'Margin', render: (r) => fmtCurrency(r.trading_margin) },
    { key: 'avg_margin_per_unit', header: 'Avg Margin', render: (r) => paise(r.avg_margin_per_unit) },
    {
      key: 'breach_count',
      header: 'Cap Breaches',
      render: (r) => (r.breach_count > 0
        ? <Badge type="danger">{r.breach_count}</Badge>
        : <span style={{ color: 'var(--text-light)' }}>None</span>),
    },
    {
      key: 'due_date',
      header: 'Due',
      render: (r) => (r.is_overdue
        ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>{r.due_date} · overdue</span>
        : (r.due_date || '—')),
    },
    { key: 'status', header: 'Status', render: (r) => <Badge type={STATUS_TONE[r.status]}>{r.status}</Badge> },
  ];

  const lineColumns = [
    { key: 'line_no', header: '#' },
    { key: 'seller_name', header: 'Seller' },
    { key: 'buyer_name', header: 'Buyer' },
    { key: 'period', header: 'Period', render: (l) => <span style={{ fontSize: 14.5 }}>{l.period_from} → {l.period_to}</span> },
    { key: 'quantum_mu', header: 'MU', render: (l) => fmtNumber(l.quantum_mu, 2) },
    { key: 'purchase_rate', header: 'Purchase', render: (l) => (l.purchase_rate > 0 ? rate(l.purchase_rate) : <span style={{ color: 'var(--red)' }}>missing</span>) },
    { key: 'sale_rate', header: 'Sale', render: (l) => rate(l.sale_rate) },
    { key: 'trading_margin_per_unit', header: 'Margin', render: (l) => <strong>{paise(l.trading_margin_per_unit)}</strong> },
    { key: 'margin_cap', header: 'Cap', render: (l) => (l.margin_cap == null ? '—' : paise(l.margin_cap)) },
    {
      key: 'compliance_status',
      header: 'CERC Cap',
      render: (l) => (
        <span title={l.compliance_status === 'EXEMPT' ? l.exempt_reason : (l.remarks || '')}>
          <Badge type={COMPLIANCE_TONE[l.compliance_status]}>{l.compliance_status}</Badge>
        </span>
      ),
    },
    ...(editable ? [{
      key: 'actions',
      header: '',
      render: (l) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-xs btn-outline" onClick={() => openLine(l)}>Edit</button>
          <button className="btn btn-xs btn-ghost" onClick={() => deleteLine(l)}>Remove</button>
        </div>
      ),
    }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="CERC Form-IV Compliance"
        subtitle="Transaction-wise return of inter-state trading, with the CERC trading margin cap enforced per trade"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline" disabled={reportBusy} onClick={downloadRegulatoryReport}>
              {reportBusy ? 'Preparing…' : 'Regulatory Report (PDF)'}
            </button>
            {canWrite && <button className="btn btn-primary" onClick={() => { setForm(EMPTY_FORM); setFormError(''); setShowNew(true); }}>+ New Filing</button>}
          </div>
        }
      />

      {error && <div className="form-error">{error}</div>}

      <AnnualRollUp canWrite={canWrite} onDone={() => load()} />

      <div className="kpi-grid">
        <StatCard label="Total Filings" value={summary.total ?? 0} hint={`${summary.submitted ?? 0} submitted · ${summary.pending ?? 0} open`} />
        <StatCard
          label="Margin Cap Breaches"
          value={summary.open_breaches ?? 0}
          tone={(summary.open_breaches ?? 0) > 0 ? 'red' : 'green'}
          hint="Transactions over the CERC cap"
        />
        <StatCard
          label="Overdue Filings"
          value={summary.overdue ?? 0}
          tone={(summary.overdue ?? 0) > 0 ? 'amber' : 'green'}
          hint="Past the CERC filing deadline"
        />
        <StatCard label="Volume Reported" value={`${fmtNumber(summary.total_volume_mu, 2)} MU`} hint={`Margin ${fmtCurrency(summary.total_margin)}`} />
        <StatCard
          label="Latest Month"
          value={summary.latest_status || 'Pending'}
          tone={summary.latest_status === 'SUBMITTED' ? 'green' : 'amber'}
          hint={summary.latest_period ? `${summary.latest_period} · due ${summary.latest_due_date || '—'}` : 'No monthly return yet'}
        />
      </div>

      <Card title="Filings">
        <Table
          columns={columns}
          rows={loading ? [] : rows}
          onRowClick={openDetail}
          emptyMessage={loading ? 'Loading...' : 'No Form-IV filings yet.'}
        />
      </Card>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="New Form-IV Filing" width={520}>
        {formError && <div className="form-error">{formError}</div>}
        <form onSubmit={createForm}>
          <div className="form-grid">
            <Field label="Period Type">
              <select value={form.period_type} onChange={(e) => setForm({ ...form, period_type: e.target.value, period: '' })}>
                <option value="MONTHLY">Monthly</option>
                <option value="ANNUAL">Annual (FY)</option>
              </select>
            </Field>
            <Field label={form.period_type === 'ANNUAL' ? 'Financial Year' : 'Month'}>
              {form.period_type === 'ANNUAL'
                ? <input required value={form.period} placeholder="2026-27" onChange={(e) => setForm({ ...form, period: e.target.value })} />
                : <input required type="month" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} />}
            </Field>
          </div>

          <Field label="CERC Reference No. (on filing)">
            <input value={form.reference_no} placeholder="Added when the return is filed" onChange={(e) => setForm({ ...form, reference_no: e.target.value })} />
          </Field>
          <Field label="Notes"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={form.auto_generate}
              onChange={(e) => setForm({ ...form, auto_generate: e.target.checked })}
            />
            <span>Pre-fill transactions from bilateral trade data</span>
          </label>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Filing</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.form_no} · ${detail.period}` : ''}
        width={1080}
      >
        {detail && (
          <>
            {detailError && <div className="form-error">{detailError}</div>}

            <div className="kpi-grid" style={{ marginBottom: 12 }}>
              <StatCard label="Status" value={detail.status} tone={detail.status === 'SUBMITTED' ? 'green' : 'amber'} hint={detail.submission_date ? `Filed ${detail.submission_date}` : `Due ${detail.due_date || '—'}`} />
              <StatCard label="Volume" value={`${fmtNumber(detail.total_volume_mu, 3)} MU`} hint={`${detail.line_count} transactions`} />
              <StatCard label="Sale Revenue" value={fmtCurrency(detail.total_revenue)} hint={`Purchase ${fmtCurrency(detail.total_purchase_cost)}`} />
              <StatCard label="Trading Margin" value={fmtCurrency(detail.trading_margin)} hint={`Weighted avg ${paise(detail.avg_margin_per_unit)}/kWh`} />
            </div>

            {detail.status !== 'SUBMITTED' && blockers.length > 0 && (
              <div className="audit-alert audit-alert-warn" style={{ marginBottom: 12 }}>
                <strong>Cannot file yet.</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {blockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
              </div>
            )}

            {detail.status === 'SUBMITTED' && (
              <div className="audit-alert" style={{ marginBottom: 12 }}>
                Filed with CERC on {detail.submission_date} under reference <strong>{detail.reference_no}</strong>
                {detail.submitted_by ? ` by ${detail.submitted_by}` : ''}{detail.filed_outside ? ' (filed outside the platform)' : ''}. The return is locked.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {editable && (
                <button className="btn btn-outline" disabled={busy} onClick={() => runOnDetail(() => api.formIv.generate(detail.id), 'Failed to regenerate from trade data.')}>
                  Regenerate from trades
                </button>
              )}
              {editable && <button className="btn btn-outline" onClick={() => openLine(null)}>+ Add transaction</button>}
              <button className="btn btn-ghost" onClick={() => api.formIv.exportCsv(detail.id, detail.form_no)}>Export CSV</button>
              <button
                className="btn btn-outline"
                title="One sheet per form (IV-A, IV-B, …) in the layout filed with the Commission"
                onClick={() => api.reports.cercAnnexuresXlsx(detail.period_type, detail.period).catch((err) => showAlert(err.message || 'Could not build the Form-IV workbook.'))}
              >
                CERC Excel (annexures)
              </button>
              <button className="btn btn-outline" onClick={() => api.formIv.downloadPdf(detail.id, detail.form_no).catch((err) => showAlert(err.message || 'Could not generate the Form-IV PDF.'))}>Download PDF</button>
              {editable && blockers.length === 0 && (
                <button className="btn btn-primary" disabled={busy} onClick={() => runOnDetail(() => api.formIv.submit(detail.id, {}), 'Failed to submit the filing.')}>
                  Mark Submitted to CERC
                </button>
              )}
            </div>

            {/* A return filed with CERC before the platform held it (17-Oct-2026):
                recorded on CERC's acknowledgement, with no lines rebuilt behind it. */}
            {editable && !outside && (
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={() => setOutside({ reference_no: detail.reference_no || '', submission_date: '', note: '' })}>
                Already filed outside the platform?
              </button>
            )}
            {editable && outside && (
              <form className="cw-form" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); runOnDetail(async () => { const r = await api.formIv.markFiledOutside({ id: detail.id, ...outside }); setOutside(null); load(); return r; }, 'Could not record the filing.'); }}>
                <div className="form-grid">
                  <Field label="CERC acknowledgement / reference" required><input required value={outside.reference_no} onChange={(e) => setOutside({ ...outside, reference_no: e.target.value })} /></Field>
                  <Field label="Filed on" required><input required type="date" max={new Date().toISOString().slice(0, 10)} value={outside.submission_date} onChange={(e) => setOutside({ ...outside, submission_date: e.target.value })} /></Field>
                </div>
                <Field label="Note"><input value={outside.note} onChange={(e) => setOutside({ ...outside, note: e.target.value })} placeholder="e.g. filed by post before the platform went live" /></Field>
                <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setOutside(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>Record as filed</button></div>
              </form>
            )}

            {editable && !detail.reference_no && (
              <Field label="CERC Filing Reference No.">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={detail.reference_no || ''}
                    placeholder="Enter the CERC acknowledgement reference"
                    onChange={(e) => setDetail({ ...detail, reference_no: e.target.value })}
                  />
                  <button
                    className="btn btn-outline"
                    disabled={busy}
                    onClick={() => runOnDetail(() => api.formIv.update(detail.id, { reference_no: detail.reference_no }), 'Failed to save the reference.')}
                  >
                    Save
                  </button>
                </div>
              </Field>
            )}

            <Card
              title="Reported Transactions"
              actions={detail.generated_at && <span className="inline-note" style={{ marginTop: 0 }}>Last generated {detail.generated_at}</span>}
            >
              <Table columns={lineColumns} rows={detail.lines || []} emptyMessage="No transactions on this return yet." />
              <p className="inline-note">
                CERC (Fixation of Trading Margin) Regulations: margin is capped at 4 paise/kWh where the sale price
                is at or below ₹3/kWh, and 7 paise/kWh above it. Exchange-cleared and long-term trades fall outside
                the cap — record the reason on the line to mark it exempt.
              </p>
            </Card>
          </>
        )}
      </Modal>

      <Modal
        open={!!lineEdit}
        onClose={() => setLineEdit(null)}
        title={lineEdit?.id ? `Edit transaction ${lineEdit.line_no}` : 'Add transaction'}
        width={620}
      >
        {lineError && <div className="form-error">{lineError}</div>}
        <form onSubmit={saveLine}>
          <div className="form-grid">
            <Field label="Seller (purchased from)">
              <input required disabled={!!lineEdit?.id} value={lineForm.seller_name} onChange={(e) => setLineForm({ ...lineForm, seller_name: e.target.value })} />
            </Field>
            <Field label="Buyer (sold to)">
              <input required disabled={!!lineEdit?.id} value={lineForm.buyer_name} onChange={(e) => setLineForm({ ...lineForm, buyer_name: e.target.value })} />
            </Field>
          </div>

          {!lineEdit?.id && (
            <div className="form-grid">
              <Field label="Contract Reference">
                <input value={lineForm.contract_ref} onChange={(e) => setLineForm({ ...lineForm, contract_ref: e.target.value })} />
              </Field>
              <Field label="Source">
                <select value={lineForm.source} onChange={(e) => setLineForm({ ...lineForm, source: e.target.value })}>
                  <option value="MANUAL">Bilateral (manual entry)</option>
                  <option value="EXCHANGE">Power exchange</option>
                </select>
              </Field>
            </div>
          )}

          {!lineEdit?.id && (
            <div className="form-grid">
              <Field label="Period From"><input required type="date" value={lineForm.period_from} onChange={(e) => setLineForm({ ...lineForm, period_from: e.target.value })} /></Field>
              <Field label="Period To"><input required type="date" value={lineForm.period_to} onChange={(e) => setLineForm({ ...lineForm, period_to: e.target.value })} /></Field>
            </div>
          )}

          <div className="form-grid">
            <Field label="Quantum (MU)">
              <input required type="number" step="0.0001" min="0" value={lineForm.quantum_mu} onChange={(e) => setLineForm({ ...lineForm, quantum_mu: e.target.value })} />
            </Field>
            <Field label="Purchase Price (₹/kWh)">
              <input required type="number" step="0.0001" min="0" value={lineForm.purchase_rate} onChange={(e) => setLineForm({ ...lineForm, purchase_rate: e.target.value })} />
            </Field>
          </div>

          <div className="form-grid">
            <Field label="Sale Price (₹/kWh)">
              <input required type="number" step="0.0001" min="0" value={lineForm.sale_rate} onChange={(e) => setLineForm({ ...lineForm, sale_rate: e.target.value })} />
            </Field>
            <Field label="Resulting Margin">
              <input
                readOnly
                value={paise((Number(lineForm.sale_rate) || 0) - (Number(lineForm.purchase_rate) || 0))}
                style={{ background: 'var(--bg-subtle, var(--slate-50))' }}
              />
            </Field>
          </div>

          <Field label="Exemption Reason (leave blank to apply the CERC cap)">
            <input
              value={lineForm.exempt_reason}
              placeholder="e.g. Cleared on IEX — outside the trading margin cap"
              onChange={(e) => setLineForm({ ...lineForm, exempt_reason: e.target.value })}
            />
          </Field>
          <Field label="Remarks"><input value={lineForm.remarks} onChange={(e) => setLineForm({ ...lineForm, remarks: e.target.value })} /></Field>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setLineEdit(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save transaction</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
