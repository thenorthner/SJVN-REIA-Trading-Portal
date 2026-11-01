import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api from '../../api/client.js';
import { PageHeader, Card, StatCard, Badge, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime, relativeDayLabel } from '../../datetime.js';

// A seller's or buyer's landing page: what is waiting on them, where their
// money stands, and what is coming up — instead of a wall of totals.

const errText = (e) => e.response?.data?.error || e.message;
const AGE_COLORS = ['#16a34a', '#eab308', '#f97316', '#ef4444', '#991b1b'];
const KIND_LABEL = { PAYMENT: 'Payment', SECURITY: 'Security', MILESTONE: 'Milestone', NOTICE: 'Notice', DOCUMENT: 'Document', CONTRACT: 'Contract' };
const monthLabel = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
/** Rupees short enough for an axis: ₹1.2 Cr, ₹45 L. */
const short = (v) => (Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(1)} Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : `₹${Math.round(v).toLocaleString('en-IN')}`);

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function CounterpartyHome() {
  const [d, setD] = useState(null);
  const [period, setPeriod] = useState('FY');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => {
    setError('');
    api.home.get(period).then(setD).catch((e) => setError(errText(e)));
  }, [period]);
  useEffect(load, [load]);

  if (error && !d) return <div className="empty-state"><h3>Unable to load the dashboard</h3><p>{error}</p></div>;
  if (!d) return <div className="page-loading">Loading dashboard...</div>;

  const seller = d.side === 'SELLER';
  const P = d.prefix;
  const k = d.kpis;
  const ageTotal = d.ageing.reduce((t, b) => t + b.amount, 0);
  const chart = d.months.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const hasEnergy = d.months.some((m) => m.energy_mwh > 0);
  const hasMoney = d.months.some((m) => m.billed > 0 || m.received > 0);
  const red = d.todo.filter((t) => t.level === 'red').length;

  async function downloadSummary() {
    setBusy(true);
    try {
      saveBlob(await api.home.summaryPdf(period), `account-summary-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const quick = seller
    ? [
      d.tier === 'L1' ? ['Prepare an invoice', `${P}/invoices`, true] : ['Create new invoice', `${P}/invoices`, true],
      ['Check energy data', `${P}/energy-data`], ['Payments & ledger', `${P}/payments`], ['Raise a dispute', `${P}/disputes`],
    ]
    : [['View my bills', `${P}/invoices`, true], ['Energy data', `${P}/energy-data`], ['Reconciliation', `${P}/reconciliation`], ['Raise a dispute', `${P}/disputes`]];

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${d.me.name}`}
        subtitle={[d.me.entity_name, d.me.previous_sign_in && `last signed in ${fmtDateTime(d.me.previous_sign_in)}`].filter(Boolean).join(' · ')}
        actions={(
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="ch-period" role="group" aria-label="Period">
              {Object.entries(d.period.options).map(([key, label]) => (
                <button key={key} type="button" className={period === key ? 'active' : ''} onClick={() => setPeriod(key)}>{key === 'FY' ? d.period.key === 'FY' ? d.period.label : label : label}</button>
              ))}
            </div>
            {!d.me.kyc_held && <button type="button" className="btn btn-secondary" onClick={downloadSummary} disabled={busy}>{busy ? 'Preparing…' : 'Download summary (PDF)'}</button>}
          </div>
        )}
      />
      {error && <div className="form-error">{error}</div>}

      {d.me.kyc_status && d.me.kyc_status !== 'APPROVED' && (
        <div className="ps-alert amber">
          Your company's KYC is <strong>{String(d.me.kyc_status).replace(/_/g, ' ').toLowerCase()}</strong>. Please submit required physical compliance documents directly to the SJVN REIA desk for intake and administrative verification.
          {d.me.kyc_held && ' Your contracts, bills and payments show here once SJVN has approved it.'}
        </div>
      )}

      <div className="kpi-grid">
        <StatCard label={seller ? `Billed to SJVN · ${d.period.label}` : `Billed by SJVN · ${d.period.label}`} value={fmtCurrency(k.billed)}
          hint={k.billed_change_pct != null ? `${k.billed_change_pct > 0 ? '▲' : '▼'} ${Math.abs(k.billed_change_pct)}% vs ${d.period.compare_label}` : `${k.billed_count} bill${k.billed_count === 1 ? '' : 's'}`}
          onClick={() => navigate(`${P}/invoices`)} />
        <StatCard label={seller ? 'Received' : 'Paid'} value={fmtCurrency(k.received)} tone="green"
          hint={k.collection_pct != null ? `${k.collection_pct}% of what was billed${k.tds > 0 ? ` · TDS ${fmtCurrency(k.tds)}` : ''}` : 'In the period'}
          onClick={() => navigate(seller ? `${P}/payments` : `${P}/invoices`)} />
        <StatCard label="Outstanding now" value={fmtCurrency(k.outstanding)} tone={k.outstanding > 0 ? 'amber' : 'green'} hint={`${k.open_bills} open bill${k.open_bills === 1 ? '' : 's'}`}
          onClick={() => navigate(seller ? `${P}/payments` : `${P}/invoices`)} />
        <StatCard label="Overdue" value={fmtCurrency(k.overdue)} tone={k.overdue > 0 ? 'red' : 'green'} hint={k.overdue_count ? `${k.overdue_count} bill${k.overdue_count === 1 ? '' : 's'} past the due date` : 'Nothing is late'} />
        <StatCard label={seller ? 'SJVN pays in' : 'You pay in'} value={k.avg_days_to_pay != null ? `${k.avg_days_to_pay} days` : '—'} hint={k.bills_settled ? `Average over ${k.bills_settled} settled bill${k.bills_settled === 1 ? '' : 's'}` : 'No bill settled in the period'} />
        <StatCard label="Open disputes" value={k.open_disputes} tone={k.open_disputes ? 'amber' : 'default'} hint={k.open_disputes ? `${fmtCurrency(k.disputed_amount)} in question` : 'None'} onClick={() => navigate(`${P}/disputes`)} />
      </div>

      <div className="ch-grid">
        <div>
          <Card title={d.todo.length ? `Waiting on you (${d.todo.length})` : 'Waiting on you'}
            actions={(d.alerts.critical + d.alerts.warning) > 0 && <button type="button" className="btn-link" onClick={() => navigate('/notification-board')}>Notification board · {d.alerts.critical} critical, {d.alerts.warning} warnings →</button>}>
            {d.todo.length === 0 && <div className="ps-alert green" style={{ marginBottom: 0 }}>Nothing is waiting on you. Bills, energy data, documents and guarantees are all in order.</div>}
            {red > 0 && <p style={{ margin: '0 0 10px', fontSize: 14.5, color: 'var(--on-red)' }}>{red} of these {red === 1 ? 'is' : 'are'} overdue or about to lapse.</p>}
            {d.todo.map((t) => (
              <button key={t.key} type="button" className={`ch-todo ${t.level}`} onClick={() => t.link && navigate(t.link)}>
                <div><strong>{t.title}</strong><span>{t.detail}</span></div>
                {t.link ? <div className="ch-go">Open →</div> : null}
              </button>
            ))}
          </Card>

          <Card title={seller ? 'Billed and received — last 12 months' : 'Billed and paid — last 12 months'} className="mt-3">
            {hasMoney ? (
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 14.5 }} />
                    <YAxis tickFormatter={short} tick={{ fontSize: 14.5 }} width={70} />
                    <Tooltip formatter={(v) => fmtCurrency(v)} />
                    <Legend />
                    <Bar dataKey="billed" name="Billed" fill="url(#eliteBlue)" isAnimationActive={false} />
                    <Bar dataKey="received" name={seller ? 'Received' : 'Paid'} fill="url(#eliteGreen)" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <p style={{ margin: 0, fontSize: 14.5, color: 'var(--text-light)' }}>No bills in the last twelve months.</p>}
          </Card>

          {hasEnergy && (
            <Card title="Energy and CUF — last 12 months" className="mt-3" actions={<button type="button" className="btn-link" onClick={() => navigate(`${P}/energy-data`)}>Energy data →</button>}>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 14.5 }} />
                    <YAxis yAxisId="mwh" tick={{ fontSize: 14.5 }} width={60} tickFormatter={(v) => fmtNumber(v, 0)} />
                    <YAxis yAxisId="cuf" orientation="right" tick={{ fontSize: 14.5 }} width={40} unit="%" domain={[0, 'auto']} />
                    <Tooltip formatter={(v, name) => (name === 'CUF' ? `${v}%` : `${fmtNumber(v, 1)} MWh`)} />
                    <Legend />
                    <Bar yAxisId="mwh" dataKey="energy_mwh" name="Energy (MWh)" fill="url(#eliteTeal)" isAnimationActive={false} />
                    <Line yAxisId="cuf" dataKey="cuf" name="CUF" stroke="url(#eliteOrange)" strokeWidth={2} connectNulls isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </div>

        <div>
          <Card title="Coming up — next 60 days">
            {d.calendar.length === 0 && <p style={{ margin: 0, fontSize: 14.5, color: 'var(--text-light)' }}>Nothing falls due in the next 60 days.</p>}
            {d.calendar.slice(0, 8).map((e, i) => {
              const dt = new Date(`${e.date}T00:00:00`);
              return (
                <div key={`${e.date}-${i}`} className="ch-cal" role="button" tabIndex={0} onClick={() => navigate(e.link)} onKeyDown={(ev) => { if (ev.key === 'Enter') navigate(e.link); }}>
                  <div className="ch-date"><b>{dt.getDate()}</b><small>{dt.toLocaleDateString('en-IN', { month: 'short' })}</small></div>
                  <div><div style={{ fontWeight: 600 }}>{e.title}</div><div style={{ fontSize: 15, color: 'var(--text-light)' }}>{KIND_LABEL[e.kind]}{e.detail ? ` · ${e.detail}` : ''}</div></div>
                  <div className={`ch-in ${e.days <= 7 ? 'soon' : ''}`}>{e.days === 0 ? 'Today' : e.days === 1 ? 'Tomorrow' : `in ${e.days} days`}</div>
                </div>
              );
            })}
            {d.calendar.length > 8 && <p style={{ margin: '8px 0 0', fontSize: 15, color: 'var(--text-light)' }}>and {d.calendar.length - 8} more — all are in the PDF summary.</p>}
          </Card>

          <Card title="Outstanding by age" className="mt-3">
            {ageTotal > 0 ? (
              <>
                <div className="ch-age" role="img" aria-label="Outstanding split by how long it is past due">
                  {d.ageing.map((b, i) => b.amount > 0 && <i key={b.label} style={{ width: `${(b.amount / ageTotal) * 100}%`, background: AGE_COLORS[i] }} title={`${b.label}: ${fmtCurrency(b.amount)}`} />)}
                </div>
                <table className="data-table" style={{ fontSize: 14.5 }}>
                  <tbody>
                    {d.ageing.map((b, i) => (
                      <tr key={b.label}><td><span className="ch-legend"><span style={{ '--c': AGE_COLORS[i] }}>{b.label}</span></span></td><td style={{ textAlign: 'right' }}>{b.count || '—'}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{b.amount ? fmtCurrency(b.amount) : '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : <p style={{ margin: 0, fontSize: 14.5, color: 'var(--text-light)' }}>Nothing is outstanding.</p>}
          </Card>

          <Card title={seller ? 'Latest payments from SJVN' : 'Your latest payments'} className="mt-3" actions={seller && <button type="button" className="btn-link" onClick={() => navigate(`${P}/payments`)}>Ledger →</button>}>
            {d.recent.payments.length === 0 && <p style={{ margin: 0, fontSize: 14.5, color: 'var(--text-light)' }}>No payments yet.</p>}
            {d.recent.payments.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 14.5 }}>
                <div><strong>{fmtCurrency(p.amount)}</strong> <span style={{ color: 'var(--text-light)' }}>against {p.invoice_no}</span>
                  <div style={{ fontSize: 15, color: 'var(--text-light)' }}>{[p.mode, p.reference, p.tds_amount > 0 && `TDS ${fmtCurrency(p.tds_amount)}`].filter(Boolean).join(' · ')}</div></div>
                <div style={{ whiteSpace: 'nowrap', color: 'var(--text-light)' }}>{fmtDate(p.payment_date)}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <Card title={`My contracts (${d.contracts.length})`} className="mt-3" actions={<button type="button" className="btn-link" onClick={() => navigate(`${P}/contracts`)}>All contracts →</button>}>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th scope="col">Contract</th><th scope="col">Capacity</th><th scope="col">Tariff</th><th scope="col">Billed</th><th scope="col">{seller ? 'Received' : 'Paid'}</th><th scope="col">Outstanding</th><th scope="col">Latest energy</th><th scope="col">Security</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {d.contracts.length === 0 && <tr><td colSpan={9} className="empty-cell">No contracts are linked to your company yet.</td></tr>}
              {d.contracts.map((c) => (
                <tr key={c.id} className="clickable" tabIndex={0} role="button" onClick={() => navigate(`${P}/contracts`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`${P}/contracts`); }}>
                  <td><strong>{c.contract_no}</strong><div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>{c.contract_type} · {c.project_type}</div></td>
                  <td>{fmtNumber(c.capacity_mw)} MW</td>
                  <td>₹{Number(c.tariff_per_unit).toFixed(2)}/kWh</td>
                  <td>{fmtCurrency(c.billed)}<div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>{c.invoices} bill{c.invoices === 1 ? '' : 's'}</div></td>
                  <td>{fmtCurrency(c.received)}</td>
                  <td>{fmtCurrency(c.outstanding)}{c.overdue > 0 && <div style={{ fontSize: 14.5, color: 'var(--on-red)' }}>{fmtCurrency(c.overdue)} overdue</div>}</td>
                  <td>{c.last_energy_month ? <>{fmtNumber(c.last_energy_mwh, 1)} MWh<div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>{monthLabel(c.last_energy_month)}{c.last_cuf != null ? ` · CUF ${Number(c.last_cuf).toFixed(1)}%` : ''}</div></> : '—'}</td>
                  <td>{c.security_count ? <>{c.security_count} live<div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>next expiry {fmtDate(c.security_next_expiry)}</div></> : <span style={{ color: 'var(--text-light)' }}>None</span>}</td>
                  <td><Badge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="ch-grid">
        <Card title="Recent bills" actions={<button type="button" className="btn-link" onClick={() => navigate(`${P}/invoices`)}>All bills →</button>}>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th scope="col">Bill</th><th scope="col">Period</th><th scope="col">Amount</th><th scope="col">Left to pay</th><th scope="col">Due</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {d.recent.invoices.length === 0 && <tr><td colSpan={6} className="empty-cell">No bills yet.</td></tr>}
                {d.recent.invoices.map((i) => (
                  <tr key={i.id}><td><strong>{i.invoice_no}</strong></td><td>{i.billing_period}</td><td>{fmtCurrency(i.total_amount)}</td><td>{i.left_amt > 0 && i.status !== 'CANCELLED' ? fmtCurrency(i.left_amt) : '—'}</td><td>{i.due_date ? fmtDate(i.due_date) : '—'}</td><td><Badge status={i.status} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="What's new">
          {d.recent.news.length === 0 && <p style={{ margin: 0, fontSize: 14.5, color: 'var(--text-light)' }}>No notifications yet.</p>}
          {d.recent.news.map((n) => (
            <div key={n.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 14.5, fontWeight: n.is_read ? 400 : 600 }}>
              {n.message}
              <div style={{ fontSize: 14.5, color: 'var(--text-light)', fontWeight: 400 }}>{relativeDayLabel(n.created_at)}</div>
            </div>
          ))}
        </Card>
      </div>

      <Card className="mt-3">
        <div className="section-title" style={{ marginBottom: 12 }}>Quick actions</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {quick.map(([label, to, primary]) => <button key={label} type="button" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} onClick={() => navigate(to)}>{label}</button>)}
        </div>
      </Card>
    </div>
  );
}
