import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client.js';
import { Badge, Field, fmtCurrency, AlertPopup } from './ui.jsx';
import { PreviewModal } from './DocumentManager.jsx';
import { fmtDate, fmtDateTime } from '../datetime.js';

// A buyer telling SJVN it has paid, and Finance confirming it. Nothing a buyer
// enters settles a bill: the payment is recorded when Finance finds the money.

export const errText = (e) => e.response?.data?.error || e.message;
const STATUS_LABEL = {
  PENDING_CHECKER: 'With your checker',
  SUBMITTED: 'With SJVN Finance',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Not confirmed',
  RETURNED_BY_CHECKER: 'Returned to maker',
  WITHDRAWN: 'Withdrawn',
};
const STATUS_TONE = {
  PENDING_CHECKER: 'PENDING',
  SUBMITTED: 'SUBMITTED',
  CONFIRMED: 'APPROVED',
  REJECTED: 'REJECTED',
  RETURNED_BY_CHECKER: 'REJECTED',
  WITHDRAWN: 'CANCELLED',
};
export const IntimationBadge = ({ status, sjvn }) => <Badge status={STATUS_TONE[status]} label={sjvn && status === 'SUBMITTED' ? 'Awaiting confirmation' : STATUS_LABEL[status]} />;

/** The buyer's form: what reached the bank, what was held back, and the proof. */
export function IntimationForm({ bill, modes, sections, maker, onDone, onCancel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ amount: '', tds_amount: '', tds_section: '194Q', other_deduction: '', deduction_note: '', payment_date: today, mode: 'RTGS', reference: '', remarks: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const n = (v) => Number(v) || 0;
  const gross = n(f.amount) + n(f.tds_amount) + n(f.other_deduction);
  const onWay = bill.pending_intimation?.amount || 0;
  const after = Math.round((bill.left - onWay - gross) * 100) / 100;

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { invoice_id: bill.id, ...f, amount: n(f.amount), tds_amount: n(f.tds_amount), other_deduction: n(f.other_deduction) };
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('contract_id', bill.contract_id);
        fd.append('document_type', 'PAYMENT_PROOF');
        fd.append('category', 'RECORD');
        fd.append('title', `Payment advice — ${bill.invoice_no} — ${f.reference}`);
        body.proof_version_id = (await api.documents.upload(fd)).version_id;
      }
      onDone(await api.buyerBills.notify(body));
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  }

  return (
    <form className="cw-form" onSubmit={submit}>
      <strong>Tell SJVN about a payment</strong>
      <p style={{ margin: '4px 0 10px', fontSize: 15, color: 'var(--text-light)' }}>
        {fmtCurrency(bill.left)} is left on this bill{onWay > 0 ? `, of which ${fmtCurrency(onWay)} is already awaiting confirmation` : ''}.
        The bill is marked paid only after SJVN Finance matches this to its bank statement{maker ? ' — and, before that, your checker passes it on' : ''}.
      </p>
      <AlertPopup open={!!error} title="Not done" message={error} onClose={() => setError('')} />
      <div className="form-grid">
        <Field label="Amount credited to SJVN (₹)" required><input required type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
        <Field label="Payment date" required><input required type="date" max={today} value={f.payment_date} onChange={(e) => set({ payment_date: e.target.value })} /></Field>
        <Field label="TDS deducted (₹)"><input type="number" min="0" step="0.01" value={f.tds_amount} onChange={(e) => set({ tds_amount: e.target.value })} placeholder="0 if none" /></Field>
        <Field label="TDS section">
          <select value={f.tds_section} disabled={!(n(f.tds_amount) > 0)} onChange={(e) => set({ tds_section: e.target.value })}>
            {sections.map((s) => <option key={s} value={s}>{s === 'OTHER' ? 'Other' : s}</option>)}
          </select>
        </Field>
        <Field label="Other deduction (₹)"><input type="number" min="0" step="0.01" value={f.other_deduction} onChange={(e) => set({ other_deduction: e.target.value })} placeholder="0 if none" /></Field>
        <Field label="What the other deduction is for"><input value={f.deduction_note} required={n(f.other_deduction) > 0} disabled={!(n(f.other_deduction) > 0)} onChange={(e) => set({ deduction_note: e.target.value })} /></Field>
        <Field label="Mode" required>
          <select value={f.mode} onChange={(e) => set({ mode: e.target.value })}>{modes.map((m) => <option key={m} value={m}>{m === 'OTHER' ? 'Other' : m}</option>)}</select>
        </Field>
        <Field label="UTR / reference no." required><input required minLength={4} value={f.reference} onChange={(e) => set({ reference: e.target.value.trim() })} placeholder="e.g. SBINR52026100400123" /></Field>
        <Field label="Bank's payment advice"><input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*" onChange={(e) => setFile(e.target.files[0] || null)} aria-label="Bank's payment advice" /></Field>
        <Field label="Remarks"><input value={f.remarks} onChange={(e) => set({ remarks: e.target.value })} /></Field>
      </div>
      {gross > 0 && (
        <div className={`ps-alert ${after < -1 ? 'amber' : 'blue'}`} style={{ marginBottom: 10 }}>
          This settles <strong>{fmtCurrency(gross)}</strong> of the bill ({fmtCurrency(n(f.amount))} paid{n(f.tds_amount) > 0 ? ` + ${fmtCurrency(n(f.tds_amount))} TDS` : ''}{n(f.other_deduction) > 0 ? ` + ${fmtCurrency(n(f.other_deduction))} other deduction` : ''}).{' '}
          {after < -1 ? `That is ${fmtCurrency(-after)} more than is left on the bill — check the figures.` : after <= 1 ? 'Once confirmed, the bill is settled in full.' : `${fmtCurrency(after)} will remain to pay.`}
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : maker ? 'Send to checker' : 'Send to SJVN Finance'}</button>
      </div>
    </form>
  );
}

/** One intimation as a line, with the actions that are the reader's. */
export function IntimationRow({ i, side, tier, myId, canConfirm, onChanged, onPreview }) {
  const [mode, setMode] = useState(null); // confirm | reject | withdraw | return_to_maker
  const [note, setNote] = useState('');
  const [valueDate, setValueDate] = useState(i.payment_date);
  const [toAdvance, setToAdvance] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sjvn = side === 'SJVN';
  // A second click landing before the next render must not send a second decision.
  const lock = useRef(false);
  const run = async (fn) => {
    if (lock.current) return;
    lock.current = true;
    setError('');
    setBusy(true);
    try { await fn(); setMode(null); setNote(''); onChanged(); } catch (err) { setError(errText(err)); } finally { lock.current = false; setBusy(false); }
  };
  const canApprove = !sjvn && i.status === 'PENDING_CHECKER' && tier !== 'L1' && i.prepared_by !== myId;
  const canReturnToMaker = !sjvn && i.status === 'PENDING_CHECKER' && tier !== 'L1';
  const canWithdraw = !sjvn && (i.status === 'PENDING_CHECKER' || i.status === 'RETURNED_BY_CHECKER' || (i.status === 'SUBMITTED' && tier !== 'L1'));

  return (
    <div className="cw-card" style={{ borderLeft: `4px solid ${i.status === 'CONFIRMED' ? '#16a34a' : i.status === 'REJECTED' ? '#dc2626' : i.status === 'RETURNED_BY_CHECKER' ? '#f59e0b' : i.status === 'WITHDRAWN' ? '#94a3b8' : '#d97706'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <strong>{fmtCurrency(i.amount)}</strong>
          {sjvn && <> from <strong>{i.buyer_name}</strong></>} against <strong>{i.invoice_no}</strong> <span style={{ color: 'var(--text-light)' }}>({i.billing_period} · {i.contract_no})</span>
          <div style={{ fontSize: 15, color: 'var(--text-light)' }}>
            {i.mode} · UTR {i.reference} · paid {fmtDate(i.payment_date)}
            {i.tds_amount > 0 && <> · TDS {fmtCurrency(i.tds_amount)}{i.tds_section ? ` u/s ${i.tds_section}` : ''}</>}
            {i.other_deduction > 0 && <> · other deduction {fmtCurrency(i.other_deduction)} ({i.deduction_note})</>}
            {(i.tds_amount > 0 || i.other_deduction > 0) && <> · settles {fmtCurrency(i.gross_settled)}</>}
          </div>
          <div style={{ fontSize: 15, color: 'var(--text-light)' }}>
            Prepared by {i.prepared_by_name || '—'}, {fmtDateTime(i.created_at)}{i.approved_by_name && i.approved_by_name !== i.prepared_by_name ? ` · passed on by ${i.approved_by_name}` : ''}
            {i.remarks ? ` · “${i.remarks}”` : ''}
          </div>
          {sjvn && i.status === 'SUBMITTED' && (
            <div style={{ fontSize: 15, marginTop: 2 }}>
              Left on the bill: <strong>{fmtCurrency(i.left_on_bill)}</strong> of {fmtCurrency(i.invoice_total)}
              {!!i.exceeds_balance && <span className="cw-flag amber" style={{ marginLeft: 6 }}>More than the bill has left</span>}
              {!i.proof && <span className="cw-flag amber" style={{ marginLeft: 6 }}>No bank advice attached</span>}
            </div>
          )}
          {i.status === 'CONFIRMED' && <div style={{ fontSize: 15, color: 'var(--on-green-2)' }}>Confirmed by {i.decided_by_name} on {fmtDate(i.decided_at)}{i.confirmed_date !== i.payment_date ? ` with value date ${fmtDate(i.confirmed_date)}` : ''}{i.decision_note ? ` — ${i.decision_note}` : ''}</div>}
          {i.status === 'REJECTED' && <div style={{ fontSize: 15, color: 'var(--red-deep)' }}>Not confirmed by {i.decided_by_name}: {i.decision_note}</div>}
          {i.status === 'RETURNED_BY_CHECKER' && <div style={{ fontSize: 15, color: 'var(--amber-strong)', fontWeight: 600 }}>Returned to maker by {i.decided_by_name || 'Checker'}{i.decided_at ? ` on ${fmtDate(i.decided_at)}` : ''}: {i.decision_note}</div>}
          {i.status === 'WITHDRAWN' && <div style={{ fontSize: 15, color: 'var(--text-light)' }}>Withdrawn by {i.decided_by_name}{i.decision_note ? ` — ${i.decision_note}` : ''}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <IntimationBadge status={i.status} sjvn={sjvn} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {i.proof && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPreview(i.proof)}>Bank advice</button>}
            {canApprove && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => api.buyerBills.approve(i.id))}>Approve &amp; send to SJVN</button>}
            {canReturnToMaker && !mode && <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--amber-strong)' }} onClick={() => setMode('return_to_maker')}>Return to maker</button>}
            {canWithdraw && !mode && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('withdraw')}>Withdraw</button>}
            {sjvn && canConfirm && i.status === 'SUBMITTED' && !mode && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('reject')}>Not found</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setMode('confirm')}>Confirm receipt</button>
              </>
            )}
          </div>
        </div>
      </div>
      <AlertPopup open={!!error} title="Not done" message={error} onClose={() => setError('')} />
      {mode === 'return_to_maker' && (
        <form className="cw-form" onSubmit={(e) => { e.preventDefault(); run(() => api.buyerBills.returnToMaker(i.id, note)); }}>
          <Field label="Remarks for Maker (what needs correction)" required>
            <input required value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. UTR number does not match bank advice, please re-verify" />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>Cancel</button>
            <button type="submit" className="btn btn-secondary" style={{ background: 'var(--t-amber-100)', borderColor: '#f59e0b', color: 'var(--on-amber)' }} disabled={busy}>
              {busy ? 'Returning…' : 'Return to Maker with Remarks'}
            </button>
          </div>
        </form>
      )}
      {mode === 'confirm' && (
        <form className="cw-form" onSubmit={(e) => { e.preventDefault(); run(() => api.buyerBills.confirm(i.id, { payment_date: valueDate, note, excess_to_advance: toAdvance || undefined })); }}>
          <p style={{ margin: '0 0 8px', fontSize: 15 }}>Confirming records a payment of {fmtCurrency(i.amount)}{i.tds_amount + i.other_deduction > 0 ? ` (and ${fmtCurrency(i.tds_amount + i.other_deduction)} deducted)` : ''} on {i.invoice_no}. Surcharge is worked out to the value date.</p>
          <div className="form-grid">
            <Field label="Value date in SJVN's bank" required><input required type="date" max={new Date().toISOString().slice(0, 10)} value={valueDate} onChange={(e) => setValueDate(e.target.value)} /></Field>
            <Field label={valueDate !== i.payment_date ? 'Why the date differs (required)' : 'Note'}><input value={note} required={valueDate !== i.payment_date} onChange={(e) => setNote(e.target.value)} placeholder="e.g. credited next working day" /></Field>
          </div>
          {!!i.exceeds_balance && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 15, margin: '4px 0 8px' }}>
              <input type="checkbox" checked={toAdvance} onChange={(e) => setToAdvance(e.target.checked)} />
              <span>This is more than the bill has left. Apply what the bill can take and hold the rest as the buyer&apos;s advance (Finance applies it to a later bill or refunds it).</span>
            </label>
          )}
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Recording…' : 'Confirm and record the payment'}</button></div>
        </form>
      )}
      {(mode === 'reject' || mode === 'withdraw') && (
        <form className="cw-form" onSubmit={(e) => { e.preventDefault(); run(() => (mode === 'reject' ? api.buyerBills.reject(i.id, note) : api.buyerBills.withdraw(i.id, note))); }}>
          <Field label={mode === 'reject' ? 'Why it is not accepted' : 'Why it is withdrawn'} required={mode === 'reject'}>
            <input required={mode === 'reject'} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'reject' ? 'e.g. No such credit in the bank statement for this UTR' : 'e.g. Entered against the wrong bill'} />
          </Field>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>Cancel</button><button type="submit" className="btn btn-danger" disabled={busy}>{mode === 'reject' ? 'Return to the buyer' : 'Withdraw'}</button></div>
        </form>
      )}
    </div>
  );
}

/** SJVN Finance's desk: what buyers say they have paid, to match against the bank. */
export default function PaymentConfirmationDesk({ onChanged }) {
  const [d, setD] = useState(null);
  const [filter, setFilter] = useState('SUBMITTED');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const load = useCallback(() => {
    api.buyerBills.intimations(filter ? { status: filter } : undefined).then(setD).catch((e) => setError(errText(e)));
  }, [filter]);
  useEffect(load, [load]);

  if (error && !d) return <div className="form-error">{error}</div>;
  if (!d) return <div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>Loading…</div>;
  return (
    <div>
      <p style={{ margin: '0 0 12px', fontSize: 14.5, color: 'var(--text-light)' }}>
        Payments buyers say they have made. Match each to the bank statement and confirm it — only then is it recorded on the bill.
        {!d.can_confirm && ' Finance confirms; you can read the queue.'}
      </p>
      <div className="nb-toolbar" style={{ marginBottom: 10 }}>
        {[['SUBMITTED', 'Awaiting confirmation'], ['CONFIRMED', 'Confirmed'], ['REJECTED', 'Not confirmed'], ['', 'All']].map(([k, l]) => (
          <button key={k || 'ALL'} type="button" className={`nb-chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}{k === 'SUBMITTED' && filter === 'SUBMITTED' && <small>{d.intimations.length}</small>}</button>
        ))}
      </div>
      {d.intimations.length === 0 && <div className="ps-alert green" style={{ marginBottom: 0 }}>{filter === 'SUBMITTED' ? 'Nothing is waiting to be confirmed.' : 'Nothing here.'}</div>}
      {d.intimations.map((i) => <IntimationRow key={i.id} i={i} side="SJVN" canConfirm={d.can_confirm} onChanged={() => { load(); onChanged?.(); }} onPreview={setPreview} />)}
      <PreviewModal open={!!preview} versionId={preview?.version_id} fileName={preview?.file_name} onClose={() => setPreview(null)} />
    </div>
  );
}
