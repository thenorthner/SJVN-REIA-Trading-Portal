import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { PageHeader, Card, StatCard, Badge, Modal, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import { InvoiceBreakdown, InvoiceFinancialStrip, downloadInvoicePdf } from '../../components/invoiceShared.jsx';
import InvoiceCompliance from '../../components/InvoiceCompliance.jsx';
import { IntimationForm, IntimationRow, errText } from '../../components/PaymentIntimations.jsx';
import { PreviewModal } from '../../components/DocumentManager.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';

// The bills SJVN has raised on the buyer: what is left on each and how soon it
// is due, the bill itself with its e-invoice and signed copy, and telling SJVN
// about a payment — which Finance then confirms against its bank.

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DueTag({ b }) {
  if (b.days_to_due === null || b.days_to_due === undefined) return null;
  const [bg, fg, text] = b.overdue ? ['#fef2f2', '#b91c1c', `${-b.days_to_due}d overdue`]
    : b.days_to_due <= 10 ? ['#fffbeb', '#b45309', b.days_to_due === 0 ? 'Due today' : `Due in ${b.days_to_due}d`]
      : ['#f0fdf4', '#15803d', `${b.days_to_due}d to go`];
  return <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: bg, color: fg, whiteSpace: 'nowrap' }}>{text}</span>;
}

const VIEWS = [
  ['ALL', 'All', () => true],
  ['TO_PAY', 'To pay', (b) => b.left > 0],
  ['OVERDUE', 'Overdue', (b) => b.overdue],
  ['WITH_FINANCE', 'Awaiting confirmation', (b) => !!b.pending_intimation],
  ['DISPUTED', 'In dispute', (b) => b.disputed_amount > 0 || b.status === 'DISPUTED'],
  ['PAID', 'Paid', (b) => b.status === 'PAID'],
];

export default function BuyerInvoices() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [pins, setPins] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [view, setView] = useState('ALL');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState('');
  const [openId, setOpenId] = useState(null);
  const [full, setFull] = useState(null);       // the invoice with its breakdown, payments and disputes
  const [notify, setNotify] = useState(false);
  const [preview, setPreview] = useState(null);

  const load = useCallback(() => {
    api.buyerBills.list().then(setD).catch((e) => setError(errText(e)));
    api.buyerBills.intimations().then(setPins).catch(() => setPins({ intimations: [] }));
  }, []);
  useEffect(load, [load]);

  const loadFull = useCallback((id) => { api.invoices.get(id).then(setFull).catch((e) => setError(errText(e))); }, []);
  useEffect(() => { setFull(null); setNotify(false); if (openId) loadFull(openId); }, [openId, loadFull]);
  const refresh = () => { load(); if (openId) loadFull(openId); };

  const rows = useMemo(() => {
    const test = VIEWS.find((v) => v[0] === view)[2];
    const needle = q.trim().toLowerCase();
    return (d?.bills || []).filter((b) => test(b) && (!needle || [b.invoice_no, b.contract_no, b.billing_period].some((v) => String(v).toLowerCase().includes(needle))));
  }, [d, view, q]);

  if (error && !d) return <div className="form-error">{error}</div>;
  if (!d) return <div style={{ padding: 24, color: 'var(--text-light)' }}>Loading…</div>;

  const t = d.totals;
  const bill = d.bills.find((b) => b.id === openId) || null;
  const mine = (pins?.intimations || []);
  const forBill = mine.filter((i) => i.invoice_id === openId);
  const waitingChecker = mine.filter((i) => i.status === 'PENDING_CHECKER');
  const refused = mine.filter((i) => i.status === 'REJECTED' && (Date.now() - new Date(`${String(i.decided_at).replace(' ', 'T')}Z`).getTime()) < 14 * 86400000);
  const chosen = Object.keys(picked).filter((id) => picked[id]);
  const maker = d.my_tier === 'L1';

  async function downloadSelected() {
    setBusy('zip');
    try { saveBlob(await api.buyerBills.downloadZip(chosen), `bills-${new Date().toISOString().slice(0, 10)}.zip`); } catch (err) { setError(errText(err)); } finally { setBusy(''); }
  }
  async function exportCsv() {
    setBusy('csv');
    try { saveBlob(await api.buyerBills.exportCsv(), `payable-bills-${new Date().toISOString().slice(0, 10)}.csv`); } catch (err) { setError(errText(err)); } finally { setBusy(''); }
  }
  async function acknowledge() {
    try { await api.buyerBills.acknowledge(openId); refresh(); } catch (err) { setError(errText(err)); }
  }

  return (
    <div>
      <PageHeader
        title="Payable Invoices"
        subtitle="The bills SJVN has raised on your PSAs — what is left on each, when it falls due, and the payments you have told SJVN about"
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            {chosen.length > 0 && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={downloadSelected}>{busy === 'zip' ? 'Preparing…' : `Download ${chosen.length} bill${chosen.length === 1 ? '' : 's'} (ZIP)`}</button>}
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={exportCsv}>Export CSV</button>
          </div>
        )}
      />
      {error && <div className="form-error">{error}</div>}
      {flash && <div className="ps-alert green" role="status">{flash}</div>}

      {t.overdue_bills > 0 && (
        <div className="ps-alert red" role="alert">
          <strong>{t.overdue_bills} bill{t.overdue_bills === 1 ? ' is' : 's are'} past the due date — {fmtCurrency(t.overdue)}.</strong> Late payment surcharge is accruing on what is unpaid.{' '}
          <button type="button" className="btn-link" onClick={() => setView('OVERDUE')}>Show them →</button>
        </div>
      )}
      {refused.length > 0 && (
        <div className="ps-alert red" role="alert">
          <strong>SJVN Finance could not confirm {refused.length} payment{refused.length === 1 ? '' : 's'}.</strong>{' '}
          {refused.slice(0, 3).map((i) => `${i.invoice_no}, UTR ${i.reference}: ${i.decision_note}`).join('; ')}. The bill{refused.length === 1 ? ' stands' : 's stand'} unpaid — send the correct details.
        </div>
      )}
      {waitingChecker.length > 0 && (
        <Card title={maker ? `With your checker (${waitingChecker.length})` : `Payment intimations waiting for your approval (${waitingChecker.length})`} className="mb-3">
          {waitingChecker.map((i) => <IntimationRow key={i.id} i={i} side="BUYER" tier={d.my_tier} myId={pins.my_id} onChanged={load} onPreview={setPreview} />)}
        </Card>
      )}

      <div className="kpi-grid">
        <StatCard label="To pay" value={fmtCurrency(t.to_pay)} tone={t.to_pay > 0 ? 'amber' : 'green'} hint={`${t.open_bills} open bill${t.open_bills === 1 ? '' : 's'}`} onClick={() => setView('TO_PAY')} />
        <StatCard label="Due within 10 days" value={fmtCurrency(t.due_soon)} tone={t.due_soon > 0 ? 'amber' : 'default'} hint={`${t.due_soon_bills} bill${t.due_soon_bills === 1 ? '' : 's'}`} />
        <StatCard label="Overdue" value={fmtCurrency(t.overdue)} tone={t.overdue > 0 ? 'red' : 'green'} hint={t.overdue_bills ? `${t.overdue_bills} bill${t.overdue_bills === 1 ? '' : 's'}` : 'Nothing is late'} onClick={t.overdue_bills ? () => setView('OVERDUE') : undefined} />
        <StatCard label="Surcharge to date" value={fmtCurrency(t.accrued_lps)} hint="On what is running late" />
        <StatCard label="Awaiting SJVN's confirmation" value={fmtCurrency(t.with_finance)} tone={t.with_finance_count ? 'blue' : 'default'} hint={`${t.with_finance_count} payment${t.with_finance_count === 1 ? '' : 's'} notified`} onClick={t.with_finance_count ? () => setView('WITH_FINANCE') : undefined} />
      </div>

      <Card>
        <div className="nb-toolbar" style={{ marginBottom: 10 }}>
          <input type="search" placeholder="Search invoice, PSA or month…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bills" />
          {VIEWS.map(([k, l, test]) => <button key={k} type="button" className={`nb-chip ${view === k ? 'active' : ''}`} onClick={() => setView(k)}>{l}<small>{d.bills.filter(test).length}</small></button>)}
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: 28 }}><input type="checkbox" aria-label="Select all shown" checked={rows.length > 0 && rows.every((b) => picked[b.id])} onChange={(e) => setPicked(e.target.checked ? Object.fromEntries(rows.map((b) => [b.id, true])) : {})} /></th>
                <th scope="col">Invoice</th><th scope="col">PSA</th><th scope="col">Period</th><th scope="col">Energy</th><th scope="col">Bill amount</th><th scope="col">Left to pay</th><th scope="col">Due</th><th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9} className="empty-cell">{d.bills.length ? 'Nothing in this view.' : 'SJVN has not raised a bill on your PSAs yet.'}</td></tr>}
              {rows.map((b) => (
                <tr key={b.id} className={`clickable ${b.overdue ? 'ps-row-critical' : b.days_to_due !== null && b.days_to_due <= 10 && b.left > 0 ? 'ps-row-warn' : ''}`} tabIndex={0} role="button" onClick={() => setOpenId(b.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(b.id); }}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${b.invoice_no}`} checked={!!picked[b.id]} onChange={(e) => setPicked({ ...picked, [b.id]: e.target.checked })} /></td>
                  <td><strong>{b.invoice_no}</strong>{!b.acknowledged_at && b.status !== 'CANCELLED' && <div style={{ fontSize: 11, color: '#1d4ed8' }}>Receipt not acknowledged</div>}</td>
                  <td>{b.contract_no}</td>
                  <td>{b.billing_period}<div style={{ fontSize: 11, color: 'var(--text-light)' }}>{b.invoice_type}</div></td>
                  <td>{fmtNumber(b.energy_mwh)} MWh</td>
                  <td>{fmtCurrency(b.total_amount)}{b.disputed_amount > 0 && <div style={{ fontSize: 11, color: '#b45309' }}>{fmtCurrency(b.disputed_amount)} in dispute</div>}</td>
                  <td>{b.left > 0 ? <strong>{fmtCurrency(b.left)}</strong> : '—'}
                    {b.pending_intimation && <div style={{ fontSize: 11, color: '#1d4ed8' }}>{fmtCurrency(b.pending_intimation.amount)} {b.pending_intimation.with_finance ? 'with SJVN Finance' : 'with your checker'}</div>}
                    {b.accrued_lps > 0 && b.left > 0 && <div style={{ fontSize: 11, color: '#b91c1c' }}>incl. surcharge {fmtCurrency(b.accrued_lps)}</div>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{b.due_date ? fmtDate(b.due_date) : '—'} <DueTag b={b} /></td>
                  <td><Badge status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!openId} onClose={() => setOpenId(null)} title={bill?.invoice_no || 'Bill'} width={820}>
        {bill && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ fontSize: 13 }}>
                {bill.acknowledged_at
                  ? <span style={{ color: '#15803d' }}>✓ Receipt acknowledged by {bill.acknowledged_by} on {fmtDateTime(bill.acknowledged_at)}</span>
                  : bill.status !== 'CANCELLED' && <><span style={{ color: 'var(--text-light)' }}>Presented on {fmtDate(bill.issued_on)}. </span><button type="button" className="btn btn-secondary btn-sm" onClick={acknowledge}>Acknowledge receipt</button></>}
              </div>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!full} onClick={() => downloadInvoicePdf(api, full).catch((err) => setError(errText(err)))}>Download PDF bill</button>
            </div>

            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={bill.status} /></span></div>
              <div className="detail-item"><span className="detail-label">PSA</span><span className="detail-value">{bill.contract_no}</span></div>
              <div className="detail-item"><span className="detail-label">Billing period</span><span className="detail-value">{bill.billing_period} · {bill.invoice_type}</span></div>
              <div className="detail-item"><span className="detail-label">Due date</span><span className="detail-value">{bill.due_date ? fmtDate(bill.due_date) : 'Not set'} <DueTag b={bill} /></span></div>
              <div className="detail-item"><span className="detail-label">Settled so far</span><span className="detail-value">{fmtCurrency(bill.settled)}</span></div>
              <div className="detail-item"><span className="detail-label">Left to pay</span><span className="detail-value" style={{ fontWeight: 700, color: bill.left > 0 ? '#b45309' : '#15803d' }}>{fmtCurrency(bill.left)}{bill.accrued_lps > 0 && bill.left > 0 ? ` (incl. surcharge ${fmtCurrency(bill.accrued_lps)})` : ''}</span></div>
            </div>

            {full ? (
              <>
                <InvoiceBreakdown invoice={{ ...full, direction: 'SJVN_TO_BUYER' }} />
                <InvoiceFinancialStrip invoice={{ ...full, direction: 'SJVN_TO_BUYER' }} />
              </>
            ) : <p style={{ fontSize: 13, color: 'var(--text-light)' }}>Loading the bill…</p>}
            <p className="inline-note">A bill paid after its due date attracts late payment surcharge on the undisputed amount left unpaid. PSA bills carry no early-payment rebate.</p>

            {full && <InvoiceCompliance key={full.id} invoice={{ ...full, direction: 'SJVN_TO_BUYER' }} />}

            <div className="section-title" style={{ marginTop: 18 }}>Payments</div>
            {full?.payments?.length > 0 && full.payments.map((p) => (
              <div key={p.id} className="cw-card" style={{ borderLeft: '4px solid #16a34a' }}>
                <strong style={{ color: '#15803d' }}>{fmtCurrency(p.amount)}</strong> recorded on {fmtDate(p.payment_date)}
                <span style={{ color: 'var(--text-light)' }}> · {p.mode === 'CREDIT_NOTE' ? 'credit note' : p.mode || '—'} · {p.reference || '—'}{p.deduction > 0 ? ` · ${fmtCurrency(p.deduction)} deducted` : ''}</span>
                <button type="button" className="btn-link" style={{ marginLeft: 8, fontSize: 12.5 }} onClick={() => navigate('/buyer/payments')}>Receipt in the ledger →</button>
              </div>
            ))}
            {forBill.filter((i) => i.status !== 'CONFIRMED').map((i) => <IntimationRow key={i.id} i={i} side="BUYER" tier={d.my_tier} myId={pins?.my_id} onChanged={refresh} onPreview={setPreview} />)}
            {!full?.payments?.length && !forBill.length && <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-light)' }}>No payment has been recorded or notified on this bill.</p>}

            {notify
              ? <IntimationForm bill={bill} modes={d.modes} sections={d.tds_sections} maker={maker} onCancel={() => setNotify(false)}
                  onDone={(made) => { setNotify(false); setFlash(made.status === 'PENDING_CHECKER' ? `Sent to your checker. SJVN is told once it is approved.` : `SJVN Finance has been told about ${fmtCurrency(made.amount)} against ${made.invoice_no}. The bill is marked paid once they confirm it.`); refresh(); }} />
              : (
                <div className="form-actions" style={{ marginTop: 12, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                  {bill.can_notify && <button type="button" className="btn btn-primary" onClick={() => setNotify(true)}>Tell SJVN about a payment</button>}
                  {!['PAID', 'CANCELLED'].includes(bill.status) && <button type="button" className="btn btn-danger" onClick={() => navigate(`/buyer/disputes?invoice=${bill.id}`)}>Raise a dispute on this bill</button>}
                </div>
              )}

            {full?.disputes?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Disputes</div>
                {full.disputes.map((x) => (
                  <div key={x.id} style={{ fontSize: 13, marginBottom: 4 }}>
                    <Badge status={x.status} /> {x.dispute_no} — {fmtCurrency(x.disputed_amount)}{x.resolution_notes ? ` · ${x.resolution_notes}` : ''}{' '}
                    <button type="button" className="btn-link" onClick={() => navigate('/buyer/disputes')}>Open →</button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </Modal>

      <PreviewModal open={!!preview} versionId={preview?.version_id} fileName={preview?.file_name} onClose={() => setPreview(null)} />
    </div>
  );
}
