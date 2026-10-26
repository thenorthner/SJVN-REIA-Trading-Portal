import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { Badge, Field, AlertPopup, fmtCurrency } from './ui.jsx';
import { fmtDate, fmtDateTime } from '../datetime.js';

// What makes a dispute a claim rather than a ticket: whose move it is and how
// the time stands, what the amount is earning in surcharge, the submitter's
// answer to SJVN's resolution, the disputes it is linked with, and the whole
// file as a dossier.

const errText = (e) => e.response?.data?.error || e.message;
const FORUMS = [
  ['SJVN_MANAGEMENT', 'SJVN senior management'], ['LEGAL', 'Legal / conciliation under the contract'],
  ['ARBITRATION', 'Arbitration'], ['CERC', 'The Regulatory Commission'],
];

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The clock as a short tag, for a list. */
export function SlaTag({ sla, sjvn = false }) {
  if (!sla) return null;
  if (sla.stage === 'DONE') return <span style={{ color: 'var(--slate-500)', fontSize: 15 }}>{sla.label}</span>;
  const tone = sla.stage === 'CONTESTED' ? ['#f5f3ff', '#6d28d9']
    : sla.breached ? ['#fef2f2', '#b91c1c']
      : sla.stage === 'RESPONSE' || sla.owner === 'SUBMITTER' ? ['#eff6ff', '#1d4ed8']
        : sla.days_left <= 3 ? ['#fffbeb', '#b45309'] : ['#f0fdf4', '#15803d'];
  const text = sla.stage === 'CONTESTED' ? 'Escalated'
    : sla.stage === 'RESPONSE' ? `${sjvn ? 'Their' : 'Your'} answer awaited · ${sla.waiting_days}d`
      : sla.breached ? `Overdue ${Math.max(1, -sla.days_left)}d`
        : sla.days_left === undefined ? '—'
          : `${sla.owner === 'SUBMITTER' ? 'Reply awaited · ' : ''}${sla.days_left}d left`;
  return <span title={sla.label} style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 14.5, fontWeight: 700, background: tone[0], color: tone[1], whiteSpace: 'nowrap' }}>{text}</span>;
}

export default function DisputeExtrasPanel({ disputeId, onChanged }) {
  const [x, setX] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // { kind: 'ESCALATE' | 'WITHDRAW' | 'CONCLUDE', ... }
  const [busy, setBusy] = useState('');

  const load = useCallback(() => api.disputeExtras.get(disputeId).then(setX).catch((e) => setError(errText(e))), [disputeId]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, after) => {
    setBusy('act');
    try {
      setX(await fn());
      setError('');
      after?.();
      onChanged?.();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  };

  async function dossier(format) {
    setBusy(format);
    try {
      saveBlob(await api.disputeExtras.dossier(disputeId, format), `dossier-${x.dispute_no.replace(/[^A-Za-z0-9]+/g, '-')}.${format}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  }

  const popup = <AlertPopup open={!!error} title="Not done" message={error} onClose={() => setError('')} />;
  if (!x) return popup;
  const { sla, lps_estimate: lps, resolution: r, group } = x;
  const red = sla.breached && sla.stage !== 'RESPONSE' && sla.stage !== 'DONE';
  const clock = sla.stage === 'DONE' ? null : (
    <div style={{ padding: '10px 12px', borderRadius: 8, fontSize: 15, fontWeight: 600, border: `1px solid ${red ? '#fca5a5' : sla.stage === 'CONTESTED' ? '#c4b5fd' : 'var(--t-blue-line)'}`, background: red ? 'var(--t-red-50)' : sla.stage === 'CONTESTED' ? 'var(--t-blue-50)' : 'var(--t-blue-50)', color: red ? 'var(--red-deep)' : sla.stage === 'CONTESTED' ? 'var(--on-blue)' : 'var(--on-blue)' }}>
      {sla.label}{sla.due ? <span style={{ fontWeight: 400 }}> · due {fmtDateTime(sla.due)}</span> : ''}
      {red && <span style={{ fontWeight: 400 }}> — escalated</span>}
    </div>
  );

  return (
    <div style={{ margin: '12px 0' }}>
      {popup}
      {clock}

      {lps.base > 0 && (
        <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-main, var(--slate-50))', fontSize: 14.5 }}>
          <strong>Late payment surcharge on the amount in question: {fmtCurrency(lps.amount)}</strong>
          {lps.running && lps.per_day > 0 && <span style={{ color: 'var(--amber-strong)', fontWeight: 600 }}> · growing by {fmtCurrency(lps.per_day)} a day</span>}
          <div style={{ color: 'var(--slate-600)', marginTop: 2 }}>
            {lps.not_yet_due
              ? `The bill falls due on ${fmtDate(lps.from)}; surcharge starts after that.`
              : `${fmtCurrency(lps.base)} at ${lps.rate_pct}% a year for ${lps.days} day${lps.days === 1 ? '' : 's'} from the due date (${lps.from ? fmtDate(lps.from) : '—'})${lps.running ? '' : ', to the date of resolution'}.`}
            {' '}An estimate at simple interest of what is payable if the amount is found due; the contract's own surcharge rules decide the actual figure.
          </div>
        </div>
      )}

      {group && (
        <div style={{ marginTop: 10, fontSize: 14.5 }}>
          <strong>Linked disputes — {group.ref}:</strong> {group.title} · {group.disputes.length} bills · {fmtCurrency(group.total)} in all
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {group.disputes.map((g) => (
              <li key={g.id} style={{ fontWeight: g.id === x.id ? 700 : 400 }}>{g.dispute_no} · {g.invoice_no} ({g.billing_period}) · {fmtCurrency(g.disputed_amount)} · {g.status.replace(/_/g, ' ').toLowerCase()}</li>
            ))}
          </ul>
        </div>
      )}

      {r && r.outcome && (
        <div className="cw-card" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <strong>SJVN's resolution: {String(r.outcome).replace(/_/g, ' ').toLowerCase()}</strong>
            {r.response
              ? <Badge status={r.response === 'ACCEPTED' ? 'ACTIVE' : 'REJECTED'} label={r.response === 'ACCEPTED' ? 'Accepted by submitter' : r.response === 'CONTESTED' ? 'Contested' : 'Withdrawn'} />
              : <Badge status="PENDING" label="Awaiting submitter's answer" />}
          </div>
          <div style={{ fontSize: 14.5, marginTop: 4 }}>
            Accepted {fmtCurrency(r.accepted_amount)} · not accepted {fmtCurrency(r.not_accepted)}
            {r.notes ? <div style={{ marginTop: 4 }}>{r.notes}</div> : null}
          </div>
          {r.response && (
            <div style={{ fontSize: 14.5, marginTop: 8, color: r.response === 'ACCEPTED' ? 'var(--on-green-2)' : 'var(--on-blue)' }}>
              <strong>{r.response === 'ACCEPTED' ? 'Accepted' : `Not accepted — ${fmtCurrency(r.contested_amount)} taken to ${r.forum_label}`}</strong> by {r.response_by} on {fmtDateTime(r.response_at)}
              {r.response_note ? ` — ${r.response_note}` : ''}
            </div>
          )}
          {r.escalation_outcome && <div style={{ fontSize: 14.5, marginTop: 6 }}><strong>How it ended:</strong> {r.escalation_outcome}</div>}

          {x.can.respond && !form && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-success btn-sm" disabled={!!busy} onClick={() => setForm({ kind: 'ACCEPT' })}>Accept resolution</button>
              {r.not_accepted > 0 && <button className="btn btn-danger btn-sm" onClick={() => setForm({ kind: 'ESCALATE', forum: 'LEGAL', note: '', contested_amount: r.not_accepted })}>Escalate — not accepted</button>}
            </div>
          )}
          {x.can.conclude && !form && (
            <div style={{ marginTop: 10 }}><button className="btn btn-primary btn-sm" onClick={() => setForm({ kind: 'CONCLUDE', note: '', awarded: '0' })}>Record how the escalation ended</button></div>
          )}
        </div>
      )}
      {r && !r.outcome && r.response === 'WITHDRAWN' && (
        <div className="inline-note" style={{ marginTop: 10 }}>Withdrawn by {r.response_by} on {fmtDateTime(r.response_at)} — {r.response_note}</div>
      )}

      {/* A confirmation in the page, not the browser's own dialog. */}
      <AlertPopup
        open={form?.kind === 'ACCEPT'}
        tone="warning"
        title="Accept SJVN's resolution?"
        message="This closes the dispute. You will not be able to contest it afterwards."
        okLabel="Cancel"
        onClose={() => setForm(null)}
        actions={<button type="button" className="btn btn-success" disabled={!!busy} onClick={() => run(() => api.disputeExtras.respond(x.id, { response: 'ACCEPT' }), () => setForm(null))}>Accept and close</button>}
      />
      {form?.kind === 'ESCALATE' && (
        <form className="cw-form" onSubmit={(e) => { e.preventDefault(); run(() => api.disputeExtras.respond(x.id, { response: 'ESCALATE', forum: form.forum, note: form.note, contested_amount: form.contested_amount }), () => setForm(null)); }}>
          <div className="form-grid">
            <Field label="Taking it to">
              <select value={form.forum} onChange={(e) => setForm({ ...form, forum: e.target.value })}>
                {FORUMS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </Field>
            <Field label="Amount contested (₹)"><input type="number" min="0.01" step="any" max={r.not_accepted} value={form.contested_amount} onChange={(e) => setForm({ ...form, contested_amount: e.target.value })} /></Field>
          </div>
          <Field label="Why the resolution is not accepted" required>
            <textarea required rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="The clause relied on, and what the resolution gets wrong." />
          </Field>
          <p className="inline-note">This records that you do not accept the resolution and where you are taking it. It does not itself start proceedings in that forum.</p>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-danger" disabled={!!busy}>Record escalation</button></div>
        </form>
      )}
      {form?.kind === 'CONCLUDE' && (
        <form className="cw-form" onSubmit={(e) => { e.preventDefault(); run(() => api.disputeExtras.conclude(x.id, form.note, form.awarded === '' ? undefined : Number(form.awarded)), () => setForm(null)); }}>
          <Field label="How it ended — the order, award or settlement" required>
            <textarea required rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <Field label={`Amount awarded to the ${String(x.raised_by_role || 'party').toLowerCase()} (₹) — up to ${fmtCurrency(r?.contested_amount || 0)}`}>
            <input type="number" min="0" step="any" max={r?.contested_amount || 0} value={form.awarded} onChange={(e) => setForm({ ...form, awarded: e.target.value })} />
            <p className="inline-note" style={{ marginTop: 4 }}>Anything awarded becomes a {x.raised_by_role === 'SELLER' ? 'debit' : 'credit'} note for approval. Leave 0 if the claim failed.</p>
          </Field>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!!busy}>Close the dispute</button></div>
        </form>
      )}
      {form?.kind === 'WITHDRAW' && (
        <form className="cw-form" onSubmit={(e) => { e.preventDefault(); run(() => api.disputeExtras.withdraw(x.id, form.note), () => setForm(null)); }}>
          <Field label="Why it is being withdrawn" required><input required value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <p className="inline-note">Withdrawing closes the dispute and makes the amount held on the bill payable again.</p>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-danger" disabled={!!busy}>Withdraw dispute</button></div>
        </form>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} title="One indexed PDF with the evidence files beside it" onClick={() => dossier('zip')}>{busy === 'zip' ? 'Preparing…' : 'Export dispute dossier (ZIP)'}</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => dossier('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'Dossier PDF only'}</button>
        {x.can.withdraw && !form && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ kind: 'WITHDRAW', note: '' })}>Withdraw dispute</button>}
      </div>
    </div>
  );
}
