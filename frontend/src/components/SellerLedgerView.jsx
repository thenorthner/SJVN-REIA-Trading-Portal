import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import { Card, StatCard, Badge, Modal, Field, fmtCurrency } from './ui.jsx';
import { PreviewModal } from './DocumentManager.jsx';
import { fmtDate, fmtDateTime } from '../datetime.js';

// A seller's account with SJVN, as the seller reads it and as SJVN reads it for
// a seller: what is owed and how late, the ledger with a running balance, each
// payment with its advice, and the quarterly TDS certificates.

const errText = (e) => e.response?.data?.error || e.message;
const TYPE = {
  INVOICE: ['Invoice', '#1d4ed8', '#eff6ff'], DEBIT_NOTE: ['Debit note', '#b45309', '#fffbeb'], CREDIT_NOTE: ['Credit note', '#7c3aed', '#f5f3ff'],
  PAYMENT: ['Payment', '#15803d', '#f0fdf4'], TDS: ['TDS', '#b91c1c', '#fef2f2'], DEDUCTION: ['Deduction', '#b91c1c', '#fef2f2'],
  REBATE: ['Rebate', '#b45309', '#fffbeb'], LPS: ['LPS', '#1d4ed8', '#eff6ff'],
};

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** April-start financial years, newest first, back to the first one with anything in it. */
function fyRange(offset) {
  const now = new Date();
  const start = (now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1) - offset;
  return { label: `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`, from: `${start}-04-01`, to: `${start + 1}-03-31` };
}
const PERIODS = [
  { key: 'ALL', label: 'All time', range: () => ({ from: '', to: '' }) },
  { key: 'FY0', label: `This year (${fyRange(0).label})`, range: () => fyRange(0) },
  { key: 'FY1', label: `Last year (${fyRange(1).label})`, range: () => fyRange(1) },
  { key: 'CUSTOM', label: 'Custom dates', range: null },
];

function PaymentAdvice({ paymentId, onClose }) {
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.ledger.payment(paymentId).then(setP).catch((e) => setError(errText(e))); }, [paymentId]);
  const line = (label, value, strong) => (
    <tr><td style={{ padding: '7px 0' }}>{label}</td><td style={{ padding: '7px 0', textAlign: 'right', fontWeight: strong ? 700 : 400 }}>{value}</td></tr>
  );
  return (
    <Modal open onClose={onClose} title={p?.party_side === 'BUYER' ? 'Payment receipt' : 'Payment advice'} width={620}>
      {error && <div className="alert alert-error">{error}</div>}
      {!p && !error && <div style={{ padding: 20 }}>Loading…</div>}
      {p && (
        <div>
          <div className="detail-grid mb-0">
            <div className="detail-item"><span className="detail-label">Invoice</span><span className="detail-value">{p.invoice_no} ({p.billing_period})</span></div>
            <div className="detail-item"><span className="detail-label">Contract</span><span className="detail-value">{p.contract_no}</span></div>
            <div className="detail-item"><span className="detail-label">Payment date</span><span className="detail-value">{fmtDate(p.payment_date)}</span></div>
            <div className="detail-item"><span className="detail-label">UTR / reference</span><span className="detail-value">{p.reference || '—'}</span></div>
            <div className="detail-item"><span className="detail-label">{p.party_side === 'BUYER' ? 'Paid by' : 'Paid from'}</span><span className="detail-value">{p.is_credit_note ? 'Credit note adjustment' : (p.source || p.mode || '—').replace(/_/g, ' ')}</span></div>
            <div className="detail-item"><span className="detail-label">Bill value</span><span className="detail-value">{fmtCurrency(p.invoice_total)}</span></div>
          </div>
          <div className="section-title" style={{ marginTop: 16 }}>How the payment is made up</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <tbody>
              {line('Amount of the bill settled by this payment', fmtCurrency(p.gross_settled))}
              {line(`Less: tax deducted at source${p.tds_section ? ` (section ${p.tds_section})` : ''}`, p.tds_amount ? `− ${fmtCurrency(p.tds_amount)}` : '—')}
              {line(`Less: other deductions${p.deduction_note ? ` — ${p.deduction_note}` : ''}`, p.other_deduction ? `− ${fmtCurrency(p.other_deduction)}` : '—')}
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td style={{ padding: '9px 0', fontWeight: 700 }}>{p.is_credit_note ? 'Adjusted, not paid in cash' : p.party_side === 'BUYER' ? 'Net amount received in SJVN\'s bank account' : 'Net amount paid to your bank account'}</td>
                <td style={{ padding: '9px 0', textAlign: 'right', fontWeight: 700, color: '#15803d', fontSize: 16 }}>{fmtCurrency(p.net_paid)}</td>
              </tr>
            </tbody>
          </table>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--slate-600)', lineHeight: 1.5 }}>
            {p.rebate_amount > 0 && <li>Early-payment rebate of {fmtCurrency(p.rebate_amount)} was allowed on this payment and reduces what remains payable on the bill.</li>}
            <li>Settled on this bill before this payment: {fmtCurrency(p.settled_before)}; after it: {fmtCurrency(p.settled_after)} of {fmtCurrency(p.invoice_total)}.</li>
            {!p.breakup_known && <li>This payment was recorded before deductions were itemised, so the deduction shows as a single amount. Ask SJVN Finance for its make-up.</li>}
          </ul>
          <div className="form-actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
            <button type="button" className="btn btn-primary" onClick={() => api.ledger.advicePdf(p.id).then((b) => saveBlob(b, `payment-${p.party_side === 'BUYER' ? 'receipt' : 'advice'}-${p.invoice_no.replace(/[^A-Za-z0-9]+/g, '-')}-${p.payment_date}.pdf`)).catch((e) => setError(errText(e)))}>
              Download PDF
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Certificates({ entityId }) {
  const counterparty = !entityId;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const params = useMemo(() => (entityId ? { entity_id: entityId } : undefined), [entityId]);
  const load = useCallback(() => api.ledger.tdsCertificates(params).then(setData).catch((e) => setError(errText(e))), [params]);
  useEffect(() => { load(); }, [load]);

  async function file(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', form.file);
      fd.append('entity_id', data.seller.id);
      fd.append('document_type', 'FORM_16A');
      fd.append('category', 'RECORD');
      fd.append('title', `Form 16A — ${form.quarter} FY ${form.financial_year}`);
      const up = await api.documents.upload(fd);
      setData(await api.ledger.fileTdsCertificate({ entity_id: data.seller.id, financial_year: form.financial_year, quarter: form.quarter, certificate_no: form.certificate_no, tds_amount: Number(form.tds_amount) || 0, version_id: up.version_id }));
      setForm(null);
      setError('');
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Card><div style={{ padding: 20 }}>{error || 'Loading…'}</div></Card>;
  const thisFy = fyRange(0).label.slice(3);

  return (
    <Card title="TDS certificates (Form 16A)">
      {error && <div className="alert alert-error">{error}</div>}
      <p className="inline-note" style={{ marginTop: 0 }}>
        {data.party_side === 'BUYER'
          ? (data.can_file
            ? 'The quarterly certificate for the tax you deducted at source from your payments to SJVN. File it here each quarter so SJVN can claim the credit.'
            : `The quarterly certificates ${counterparty ? 'your company has' : `${data.seller.name} has`} filed for tax deducted at source from its payments to SJVN.${counterparty ? ' A checker, approver or the company admin files them.' : ''}`)
          : `The quarterly certificate for tax SJVN deducted at source from ${data.can_file ? `${data.seller.name}'s` : 'your'} payments. Use it to claim the credit in the income-tax return.`}
      </p>
      {data.can_file && !form && (
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setForm({ financial_year: thisFy, quarter: 'Q1', certificate_no: '', tds_amount: '', file: null })}>+ File a certificate</button>
        </div>
      )}
      {form && (
        <form className="cw-form" onSubmit={file}>
          <div className="form-grid">
            <Field label="Financial year" required><input required value={form.financial_year} onChange={(e) => setForm({ ...form, financial_year: e.target.value })} placeholder="2026-27" /></Field>
            <Field label="Quarter" required>
              <select value={form.quarter} onChange={(e) => setForm({ ...form, quarter: e.target.value })}>
                <option value="Q1">Q1 — Apr–Jun</option><option value="Q2">Q2 — Jul–Sep</option><option value="Q3">Q3 — Oct–Dec</option><option value="Q4">Q4 — Jan–Mar</option>
              </select>
            </Field>
            <Field label="Certificate number"><input value={form.certificate_no} onChange={(e) => setForm({ ...form, certificate_no: e.target.value })} /></Field>
            <Field label="TDS on the certificate (₹)" required><input required type="number" min="0" step="any" value={form.tds_amount} onChange={(e) => setForm({ ...form, tds_amount: e.target.value })} /></Field>
          </div>
          <Field label="Certificate (PDF)" required><input required type="file" accept=".pdf,application/pdf" onChange={(e) => setForm({ ...form, file: e.target.files[0] })} /></Field>
          <p className="inline-note">Filing again for the same quarter replaces the earlier certificate.</p>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || !form.file}>{busy ? 'Filing…' : 'File certificate'}</button></div>
        </form>
      )}
      <div className="table-wrap">
        <table className="data-table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th scope="col">Financial year</th><th scope="col">Quarter</th><th scope="col">Certificate no.</th>
              <th scope="col" style={{ textAlign: 'right' }}>TDS on certificate</th><th scope="col" style={{ textAlign: 'right' }}>TDS deducted (per ledger)</th>
              <th scope="col">Filed</th><th scope="col">Certificate</th>
            </tr>
          </thead>
          <tbody>
            {!data.certificates.length && <tr><td colSpan={7} className="empty-cell">No tax has been deducted and no certificate has been filed.</td></tr>}
            {data.certificates.map((c) => {
              const differs = !c.awaited && c.tds_deducted > 0 && Math.abs(c.tds_deducted - c.tds_amount) > 1;
              return (
                <tr key={`${c.financial_year}-${c.quarter}`}>
                  <td>FY {c.financial_year}</td>
                  <td>{c.quarter} · {c.quarter_label}</td>
                  <td>{c.certificate_no || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{c.awaited ? '—' : fmtCurrency(c.tds_amount)}</td>
                  <td style={{ textAlign: 'right', color: differs ? '#b91c1c' : 'inherit', fontWeight: differs ? 700 : 400 }} title={differs ? 'Differs from the certificate' : undefined}>{fmtCurrency(c.tds_deducted)}</td>
                  <td>{c.awaited ? '—' : <>{fmtDate(c.updated_at || c.created_at)}<div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{c.uploaded_by_name || ''}</div></>}</td>
                  <td>
                    {c.awaited
                      ? <Badge status="PENDING" label={data.party_side === 'BUYER' ? (data.can_file ? 'Not yet filed' : 'Awaited from the buyer') : 'Awaited from SJVN Finance'} />
                      : <button className="btn btn-secondary btn-sm" onClick={() => setPreview(c)}>View / download</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PreviewModal open={!!preview} versionId={preview?.version_id} fileName={preview?.file_name} onClose={() => setPreview(null)} />
    </Card>
  );
}

/**
 * @param entityId  the seller whose account to show — SJVN's side only; a seller sees its own
 */
export default function SellerLedgerView({ entityId = null, partySide = 'SELLER' }) {
  const buyer = partySide === 'BUYER';
  const [tab, setTab] = useState('OVERVIEW');
  const [contracts, setContracts] = useState([]);
  const [contractId, setContractId] = useState('');
  const [period, setPeriod] = useState('ALL');
  const [dates, setDates] = useState({ from: '', to: '' });
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [advice, setAdvice] = useState(null);
  const [busy, setBusy] = useState('');

  const params = useMemo(() => {
    const p = {};
    if (entityId) p.entity_id = entityId;
    if (contractId) p.contract_id = contractId;
    if (dates.from) p.from = dates.from;
    if (dates.to) p.to = dates.to;
    return p;
  }, [entityId, contractId, dates]);

  useEffect(() => {
    api.contracts.list(entityId ? { [partySide === 'BUYER' ? 'buyer_id' : 'seller_id']: entityId } : undefined).then((list) => setContracts(list.filter((c) => c.contract_type === (partySide === 'BUYER' ? 'PSA' : 'PPA')))).catch(() => setContracts([]));
    setContractId('');
  }, [entityId, partySide]);

  useEffect(() => {
    setS(null);
    api.ledger.statement(params).then((r) => { setS(r); setError(''); }).catch((e) => setError(errText(e)));
  }, [params]);

  function choosePeriod(key) {
    setPeriod(key);
    const p = PERIODS.find((x) => x.key === key);
    if (p.range) { const r = p.range(); setDates({ from: r.from, to: r.to }); }
  }

  async function download(format) {
    setBusy(format);
    try {
      saveBlob(await api.ledger.statementFile(format, params), `statement-of-account-${dates.from || 'all'}-to-${dates.to || new Date().toISOString().slice(0, 10)}.${format}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  }

  const text = q.trim().toLowerCase();
  const entries = useMemo(() => (s?.entries || []).filter((e) => (!kind || e.type === kind)
    && (!text || `${e.ref} ${e.invoice_no} ${e.particulars} ${e.contract_no}`.toLowerCase().includes(text))), [s, kind, text]);

  // One row per payment, gathered from the ledger lines it produced.
  const payments = useMemo(() => {
    const map = new Map();
    for (const e of s?.entries || []) {
      if (!e.payment_id) continue;
      const row = map.get(e.payment_id) || { id: e.payment_id, date: e.date, invoice_no: e.invoice_no, contract_no: e.contract_no, ref: e.ref, net: 0, tds: 0, other: 0, rebate: 0, credit_note: false };
      if (e.type === 'PAYMENT') row.net += e.credit;
      if (e.type === 'TDS') row.tds += e.credit;
      if (e.type === 'DEDUCTION') row.other += e.credit;
      if (e.type === 'REBATE') row.rebate += e.credit;
      if (e.type === 'CREDIT_NOTE') { row.credit_note = true; row.other += e.credit; }
      map.set(e.payment_id, row);
    }
    return [...map.values()].filter((r) => !text || `${r.ref} ${r.invoice_no} ${r.contract_no}`.toLowerCase().includes(text)).sort((a, b) => b.date.localeCompare(a.date));
  }, [s, text]);

  if (error && !s) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!s) return <Card><div style={{ padding: 24 }}>Loading the account…</div></Card>;

  const maxBucket = Math.max(1, ...s.ageing.map((a) => a.amount));
  const tones = { NOT_DUE: '#16a34a', D1_30: '#f59e0b', D31_60: '#f97316', D61_90: '#ef4444', D90: '#991b1b' };
  const notes = s.totals.debit_notes + s.totals.credit_notes;

  return (
    <div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="filters-bar">
        <select value={contractId} onChange={(e) => setContractId(e.target.value)} aria-label="Contract">
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
        </select>
        <select value={period} onChange={(e) => choosePeriod(e.target.value)} aria-label="Period">
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {period === 'CUSTOM' && (
          <>
            <input type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} aria-label="From date" />
            <input type="date" value={dates.to} onChange={(e) => setDates({ ...dates, to: e.target.value })} aria-label="To date" />
          </>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" disabled={!!busy} onClick={() => download('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'Statement (PDF)'}</button>
          <button className="btn btn-secondary" disabled={!!busy} onClick={() => download('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Statement (Excel)'}</button>
        </span>
      </div>

      <div className="kpi-grid">
        <StatCard label="Billed in the period" value={fmtCurrency(s.totals.billed + s.totals.debit_notes + s.totals.lps)} tone="blue" />
        <StatCard label={buyer ? 'Paid' : 'Received'} value={fmtCurrency(s.totals.received)} tone="green" hint={s.totals.tds + s.totals.deductions + s.totals.rebate > 0 ? `+ ${fmtCurrency(s.totals.tds + s.totals.deductions + s.totals.rebate)} held back or allowed` : undefined} />
        <StatCard label="Outstanding today" value={fmtCurrency(s.outstanding_total)} tone={s.outstanding_total > 0 ? 'amber' : 'green'} hint={`${s.outstanding.length} open bill${s.outstanding.length === 1 ? '' : 's'}`} />
        <StatCard label="Of which overdue" value={fmtCurrency(s.overdue_total)} tone={s.overdue_total > 0 ? 'red' : 'green'} />
        <StatCard label="LPS accrued to date" value={fmtCurrency(s.accrued_lps_total)} hint="Surcharge on what is running late" />
      </div>

      <div className="nb-tabs" role="tablist">
        {[['OVERVIEW', 'Outstanding & ageing'], ['LEDGER', 'Ledger'], ['PAYMENTS', `Payments (${payments.length})`], ['TDS', 'TDS certificates']].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`nb-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'OVERVIEW' && (
        <>
          <Card title="Ageing of what is outstanding" style={{ marginBottom: 16 }}>
            {s.outstanding.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-light)' }}>Nothing is outstanding.</div>
            ) : s.ageing.map((a) => (
              <div key={a.key} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 150px 190px', gap: 12, alignItems: 'center', padding: '6px 0', fontSize: 13 }}>
                <span>{a.label}</span>
                <div style={{ height: 14, borderRadius: 999, background: 'var(--slate-100, #f1f5f9)', overflow: 'hidden' }}>
                  <div style={{ width: `${(a.amount / maxBucket) * 100}%`, height: '100%', background: tones[a.key] }} />
                </div>
                <strong style={{ textAlign: 'right' }}>{fmtCurrency(a.amount)}</strong>
                <span style={{ color: 'var(--slate-500)', fontSize: 12 }}>{a.invoices} bill{a.invoices === 1 ? '' : 's'}{a.accrued_lps > 0 ? ` · LPS ${fmtCurrency(a.accrued_lps)}` : ''}</span>
              </div>
            ))}
            {s.due_soon.length > 0 && (
              <p className="inline-note" style={{ margin: '10px 0 0' }}>
                Falling due in the next 30 days: {s.due_soon.map((o) => `${o.invoice_no} (${fmtCurrency(o.balance)} on ${fmtDate(o.due_date)})`).join(' · ')}
              </p>
            )}
          </Card>
          <Card title="Open bills">
            <div className="table-wrap">
              <table className="data-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th scope="col">Invoice</th><th scope="col">Contract</th><th scope="col">Period</th><th scope="col">Due date</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Billed</th><th scope="col" style={{ textAlign: 'right' }}>Settled</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Balance</th><th scope="col">Overdue</th><th scope="col" style={{ textAlign: 'right' }}>LPS accrued</th>
                  </tr>
                </thead>
                <tbody>
                  {!s.outstanding.length && <tr><td colSpan={9} className="empty-cell">Every bill has been settled.</td></tr>}
                  {s.outstanding.map((o) => (
                    <tr key={o.invoice_id}>
                      <td><strong>{o.invoice_no}</strong>{o.disputed > 0 && <div style={{ fontSize: 12, color: '#b91c1c' }}>{fmtCurrency(o.disputed)} under dispute</div>}</td>
                      <td>{o.contract_no}</td><td>{o.billing_period}</td><td>{o.due_date ? fmtDate(o.due_date) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{fmtCurrency(o.billed)}</td><td style={{ textAlign: 'right' }}>{fmtCurrency(o.paid)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCurrency(o.balance)}</td>
                      <td style={{ color: o.days_overdue > 60 ? '#b91c1c' : o.days_overdue > 0 ? '#b45309' : 'var(--slate-500)', fontWeight: o.days_overdue ? 700 : 400 }}>{o.days_overdue ? `${o.days_overdue} days` : 'Not due'}</td>
                      <td style={{ textAlign: 'right' }}>{o.accrued_lps > 0 ? fmtCurrency(o.accrued_lps) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'LEDGER' && (
        <Card>
          <div className="nb-toolbar">
            <input type="search" placeholder="Search invoice, UTR or particulars…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the ledger" />
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type of entry">
              <option value="">All entries</option>
              {Object.entries(TYPE).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
            </select>
            {notes > 0 && <span style={{ fontSize: 12.5, color: 'var(--slate-600)' }}>Debit notes {fmtCurrency(s.totals.debit_notes)} · Credit notes {fmtCurrency(s.totals.credit_notes)}</span>}
          </div>
          <div className="table-wrap">
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th scope="col">Date</th><th scope="col">Type</th><th scope="col">Reference</th><th scope="col">Particulars</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Debit</th><th scope="col" style={{ textAlign: 'right' }}>Credit</th><th scope="col" style={{ textAlign: 'right' }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: 'var(--bg)' }}>
                  <td>{s.from ? fmtDate(s.from) : '—'}</td><td colSpan={3}><strong>Opening balance</strong></td><td /><td />
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCurrency(s.opening_balance)}</td>
                </tr>
                {!entries.length && <tr><td colSpan={7} className="empty-cell">{s.entries.length ? 'Nothing in the ledger matches.' : 'Nothing in this period.'}</td></tr>}
                {entries.map((e, i) => {
                  const [label, fg, bg] = TYPE[e.type];
                  return (
                    <tr key={`${e.type}-${e.ref}-${e.date}-${i}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.date)}</td>
                      <td><span style={{ padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: fg, background: bg, whiteSpace: 'nowrap' }}>{label}</span></td>
                      <td>{e.ref}</td>
                      <td>{e.particulars}<div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{e.invoice_no !== e.ref ? `${e.invoice_no} · ` : ''}{e.contract_no}</div></td>
                      <td style={{ textAlign: 'right' }}>{e.debit ? fmtCurrency(e.debit) : ''}</td>
                      <td style={{ textAlign: 'right' }}>{e.credit ? fmtCurrency(e.credit) : ''}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(e.balance)}</td>
                    </tr>
                  );
                })}
                <tr style={{ background: 'var(--bg)' }}>
                  <td>{fmtDate(s.to || new Date().toISOString().slice(0, 10))}</td><td colSpan={3}><strong>{buyer ? 'Closing balance — payable to SJVN' : 'Closing balance — receivable from SJVN'}</strong></td><td /><td />
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCurrency(s.closing_balance)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="inline-note" style={{ marginTop: 10 }}>
            {buyer ? 'A debit is an amount SJVN billed; a credit is an amount paid, deducted at source or adjusted by a credit note.' : 'A debit is an amount billed to SJVN; a credit is an amount paid, deducted at source, allowed as rebate or adjusted by a credit note.'} Generated {fmtDateTime(s.generated_at)}.
          </p>
        </Card>
      )}

      {tab === 'PAYMENTS' && (
        <Card>
          <div className="nb-toolbar">
            <input type="search" placeholder="Search invoice or UTR…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payments" />
          </div>
          <div className="table-wrap">
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th scope="col">Date</th><th scope="col">Invoice</th><th scope="col">Contract</th><th scope="col">UTR / reference</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Bill settled</th><th scope="col" style={{ textAlign: 'right' }}>TDS</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Other deductions</th><th scope="col" style={{ textAlign: 'right' }}>{buyer ? 'Net paid' : 'Net received'}</th><th scope="col">{buyer ? 'Receipt' : 'Advice'}</th>
                </tr>
              </thead>
              <tbody>
                {!payments.length && <tr><td colSpan={9} className="empty-cell">No payments in this period.</td></tr>}
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.date)}</td>
                    <td>{p.invoice_no}{p.credit_note && <div style={{ fontSize: 12, color: '#7c3aed' }}>Credit note adjustment</div>}</td>
                    <td>{p.contract_no}</td><td>{p.ref}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(p.net + p.tds + p.other)}</td>
                    <td style={{ textAlign: 'right', color: p.tds ? '#b91c1c' : 'inherit' }}>{p.tds ? `− ${fmtCurrency(p.tds)}` : '—'}</td>
                    <td style={{ textAlign: 'right', color: p.other ? '#b91c1c' : 'inherit' }}>{p.other ? `− ${fmtCurrency(p.other)}` : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#15803d' }}>{fmtCurrency(p.net)}</td>
                    <td><button className="btn btn-secondary btn-sm" onClick={() => setAdvice(p.id)}>{buyer ? 'View receipt' : 'View payment advice'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'TDS' && <Certificates entityId={entityId} />}

      {advice && <PaymentAdvice paymentId={advice} onClose={() => setAdvice(null)} />}
    </div>
  );
}
