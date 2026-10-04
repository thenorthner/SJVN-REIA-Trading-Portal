import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { Badge, Field, fmtCurrency } from './ui.jsx';
import { PreviewModal } from './DocumentManager.jsx';
import { fmtDate, fmtDateTime } from '../datetime.js';

// A guarantee as a document a bank issued and can change: how close it is to
// lapsing, the bank's SFMS advice, the scanned copy or e-BG, and every
// amendment in order. Shown to the counterparty that gave it and to SJVN, who
// each get the actions that are theirs.

export const errText = (e) => e.response?.data?.error || e.message;
export const SFMS_TYPES = [
  ['MT760', 'MT760 / IFN 760 COV — guarantee issued'], ['MT767', 'MT767 / IFN 767 COV — guarantee amended'],
  ['MT700', 'MT700 — letter of credit issued'], ['MT707', 'MT707 — letter of credit amended'], ['OTHER', 'Other bank confirmation'],
];
/** An amendment's changes in words, with the dates as people write them. */
export const changeText = (changes) => (changes || []).map((c) => c.text.replace(/\d{4}-\d{2}-\d{2}/g, (d) => fmtDate(d))).join('; ');
const TONE = { EXPIRED: ['#fef2f2', '#b91c1c'], CRITICAL: ['#fef2f2', '#b91c1c'], WARN: ['#fffbeb', '#b45309'], OK: ['#f0fdf4', '#15803d'] };

/** Upload a file against the contract and hand back the version it became. */
export async function attachSecurityFile(contractId, file, { type = 'BANK_GUARANTEE', title }) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('contract_id', contractId);
  fd.append('document_type', type);
  fd.append('category', 'RECORD');
  fd.append('title', title);
  return (await api.documents.upload(fd)).version_id;
}

/** Days to expiry as a short tag, for a list. */
export function ExpiryTag({ expiry }) {
  if (!expiry || expiry.level === 'NONE' || expiry.days == null) return null;
  const tone = TONE[expiry.level] || TONE.OK;
  const text = expiry.level === 'EXPIRED' ? `Expired ${Math.abs(expiry.days)}d ago` : expiry.days === 0 ? 'Expires today' : `${expiry.days}d left`;
  return <span title={expiry.label} style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: tone[0], color: tone[1], whiteSpace: 'nowrap' }}>{text}</span>;
}

/** The three SFMS fields, shared by every form that records a bank's advice. */
export function SfmsFields({ form, set, defaultType = 'MT760', optional = false }) {
  return (
    <div className="form-grid">
      <Field label={`SFMS message${optional ? ' (if received)' : ''}`}>
        <select value={form.sfms_message_type || defaultType} onChange={(e) => set({ sfms_message_type: e.target.value })}>
          {SFMS_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="SFMS message date">
        <input type="date" value={form.sfms_date || ''} onChange={(e) => set({ sfms_date: e.target.value })} />
      </Field>
      <Field label="SFMS reference / UTR">
        <input value={form.sfms_reference || ''} onChange={(e) => set({ sfms_reference: e.target.value })} placeholder="e.g. SBINH26280000123" />
      </Field>
      <Field label="Sender bank IFSC">
        <input value={form.sfms_sender_ifsc || ''} maxLength={11} onChange={(e) => set({ sfms_sender_ifsc: e.target.value.toUpperCase() })} />
      </Field>
    </div>
  );
}
const sfmsBody = (f, defaultType) => (f.sfms_reference
  ? { sfms_message_type: f.sfms_message_type || defaultType, sfms_date: f.sfms_date, sfms_reference: f.sfms_reference, sfms_sender_ifsc: f.sfms_sender_ifsc }
  : {});

function ExpiryBanner({ d, onExtend }) {
  const { expiry } = d;
  if (d.status === 'DRAFT') {
    return <div className="ps-alert blue">Submitted and awaiting SJVN's acceptance. It does not count as security until it is accepted.</div>;
  }
  if (d.status === 'CLOSED' && d.rejection_note) {
    return <div className="ps-alert red"><strong>Refused by SJVN.</strong> {d.rejection_note}</div>;
  }
  if (d.pending_amendment) {
    return <div className="ps-alert blue">An amendment submitted by {d.pending_amendment.raised_by_name} on {fmtDate(d.pending_amendment.created_at)} is awaiting SJVN's acceptance.</div>;
  }
  if (!['EXPIRED', 'CRITICAL', 'WARN'].includes(expiry.level)) return null;
  const red = expiry.level !== 'WARN';
  const isBg = d.mechanism_type === 'BANK_GUARANTEE';
  return (
    <div className={`ps-alert ${red ? 'red' : 'amber'}`} role="alert">
      <strong>{expiry.label}{d.validity_end ? ` — ${fmtDate(d.validity_end)}` : ''}.</strong>{' '}
      {expiry.level === 'EXPIRED'
        ? `This ${isBg ? 'guarantee' : 'instrument'} has lapsed and no longer counts as security.`
        : isBg ? 'A guarantee that is not extended before it lapses may be encashed by SJVN.' : 'Have it renewed before it lapses.'}
      {d.claim_deadline && <> Claims can be lodged until {fmtDate(d.claim_deadline)}.</>}
      {onExtend && <div style={{ marginTop: 8 }}><button type="button" className="btn btn-primary btn-sm" onClick={onExtend}>Submit {isBg ? 'BG' : 'LC'} extension / amendment</button></div>}
    </div>
  );
}

function AmendForm({ d, sjvn, onDone, onCancel }) {
  const [f, setF] = useState({ new_validity_end: '', new_limit: '', new_claim_deadline: '', amendment_ref: '', amendment_date: new Date().toISOString().slice(0, 10), reason: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!sjvn && !file) { setError("Attach the bank's amendment / extension letter."); return; }
    setBusy(true);
    try {
      const body = { ...f, new_limit: f.new_limit === '' ? null : Number(f.new_limit), ...sfmsBody(f, 'MT767') };
      if (file) body.document_version_id = await attachSecurityFile(d.contract_id, file, { type: 'SECURITY_RENEWAL', title: `Amendment to ${d.instrument_no}` });
      onDone(await api.securityDesk.amend(d.id, body));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cw-form" onSubmit={submit}>
      <strong>{sjvn ? 'Record an amendment' : `Submit ${d.mechanism_type === 'LC' ? 'LC' : 'BG'} extension / amendment`}</strong>
      <p style={{ margin: '4px 0 10px', fontSize: 12, color: 'var(--text-light)' }}>
        Fill in only what the bank changed. Currently {fmtCurrency(d.limit_amount)}, valid until {fmtDate(d.validity_end)}{d.claim_deadline ? `, claims until ${fmtDate(d.claim_deadline)}` : ''}.
        {!sjvn && ' Nothing changes on the instrument until SJVN accepts the amendment.'}
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="form-grid">
        <Field label="New validity (valid until)"><input type="date" value={f.new_validity_end} onChange={(e) => set({ new_validity_end: e.target.value })} /></Field>
        <Field label="New claim period ends"><input type="date" value={f.new_claim_deadline} onChange={(e) => set({ new_claim_deadline: e.target.value })} /></Field>
        <Field label="New amount (₹)"><input type="number" min="0" step="0.01" value={f.new_limit} onChange={(e) => set({ new_limit: e.target.value })} placeholder="Leave blank if unchanged" /></Field>
        <Field label="Bank's amendment no."><input value={f.amendment_ref} onChange={(e) => set({ amendment_ref: e.target.value })} /></Field>
        <Field label="Amendment date"><input type="date" value={f.amendment_date} onChange={(e) => set({ amendment_date: e.target.value })} /></Field>
        <Field label={`Bank's amendment letter${sjvn ? '' : ' *'}`}>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*" onChange={(e) => setFile(e.target.files[0] || null)} aria-label="Amendment letter" />
        </Field>
      </div>
      <Field label="Reason for the amendment" required>
        <textarea required value={f.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. SCOD extended by six months; validity extended to cover it." />
      </Field>
      <SfmsFields form={f} set={set} defaultType="MT767" optional />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : sjvn ? 'Record amendment' : 'Submit to SJVN'}</button>
      </div>
    </form>
  );
}

/** SJVN's decision on something a counterparty submitted — the instrument itself, or an amendment to it. */
function DecideForm({ label, defaultType, onDecide }) {
  const [f, setF] = useState({ note: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  async function go(decision) {
    setError('');
    setBusy(decision);
    try {
      await onDecide({ decision, note: f.note, ...(decision === 'ACCEPTED' ? sfmsBody(f, defaultType) : {}) });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="cw-form">
      <strong>{label}</strong>
      {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
      <div style={{ marginTop: 8 }}><SfmsFields form={f} set={set} defaultType={defaultType} optional /></div>
      <Field label="Note (needed to refuse)"><textarea value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => go('REJECTED')}>{busy === 'REJECTED' ? 'Refusing…' : 'Refuse'}</button>
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => go('ACCEPTED')}>{busy === 'ACCEPTED' ? 'Accepting…' : 'Accept and take on record'}</button>
      </div>
    </div>
  );
}

function SfmsForm({ d, onDone, onCancel }) {
  const [f, setF] = useState({ bank_reference_no: d.bank_reference_no || '', sfms_message_type: d.mechanism_type === 'LC' ? 'MT700' : 'MT760', sfms_date: '', sfms_reference: '', sfms_sender_ifsc: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      onDone(await api.securityDesk.recordSfms(d.id, f));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="cw-form" onSubmit={submit}>
      <strong>Record the bank's SFMS advice</strong>
      {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
      <div style={{ marginTop: 8 }}><SfmsFields form={f} set={set} /></div>
      <Field label="Bank's guarantee / LC number"><input value={f.bank_reference_no} onChange={(e) => set({ bank_reference_no: e.target.value })} /></Field>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Record confirmation'}</button>
      </div>
    </form>
  );
}

export default function SecurityInstrumentPanel({ instrumentId, onChanged }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState(null); // amend | sfms
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.securityDesk.get(instrumentId).then(setD).catch((e) => setError(errText(e)));
  }, [instrumentId]);
  useEffect(() => { setD(null); setMode(null); setError(''); load(); }, [load]);

  const took = (fresh) => { setD(fresh); setMode(null); onChanged?.(fresh); };

  async function attachScan(file) {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const versionId = await attachSecurityFile(d.contract_id, file, { type: d.mechanism_type === 'LC' ? 'LETTER_OF_CREDIT' : 'BANK_GUARANTEE', title: `${d.bg_subtype || d.mechanism_type} ${d.bank_reference_no || d.instrument_no}` });
      took(await api.securityDesk.attachDocument(d.id, { document_version_id: versionId }));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id) {
    setError('');
    try { took(await api.securityDesk.withdrawAmendment(id)); } catch (err) { setError(errText(err)); }
  }

  if (error && !d) return <div className="form-error">{error}</div>;
  if (!d) return <div style={{ fontSize: 13, color: 'var(--text-light)' }}>Loading…</div>;

  const sjvn = d.side === 'SJVN';
  const amendable = ['ACTIVE', 'PARTIALLY_UTILIZED', 'RENEWED', 'EXPIRED'].includes(d.status) && !d.pending_amendment && (!sjvn || d.can_manage);
  const canAttach = sjvn ? d.can_manage : (!d.document || d.status === 'DRAFT');
  const pending = d.pending_amendment;
  const others = d.amendments.filter((a) => ['REJECTED', 'WITHDRAWN'].includes(a.status));

  return (
    <div>
      {error && <div className="form-error">{error}</div>}
      <ExpiryBanner d={d} onExtend={amendable && !sjvn && mode !== 'amend' ? () => setMode('amend') : null} />

      {/* SJVN's decision on a counterparty's submission */}
      {sjvn && d.can_manage && d.status === 'DRAFT' && d.submitted_by_side && (
        <DecideForm label={`Submitted by the ${d.submitted_by_side.toLowerCase()} — accept it as security?`} defaultType={d.mechanism_type === 'LC' ? 'MT700' : 'MT760'}
          onDecide={async (body) => took(await api.securityDesk.decideSubmission(d.id, body))} />
      )}
      {sjvn && d.can_manage && pending && (
        <DecideForm label={`Amendment from ${pending.raised_by_name}: ${changeText(pending.changes)}`} defaultType="MT767"
          onDecide={async (body) => took(await api.securityDesk.decideAmendment(pending.id, body))} />
      )}

      {/* The bank's own confirmation */}
      <div className="cw-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <strong>Bank confirmation (SFMS)</strong>
          <span className={`cw-flag ${d.sfms.confirmed ? '' : 'amber'}`} style={d.sfms.confirmed ? { background: '#f0fdf4', color: '#15803d' } : undefined}>
            {d.sfms.confirmed ? 'Received by SJVN' : 'Not yet received'}
          </span>
        </div>
        {d.sfms.confirmed ? (
          <div className="ps-kv">
            <div><span>Message</span>{d.sfms.message_type || 'Bank confirmation'}</div>
            <div><span>Message date</span>{d.sfms.date ? fmtDate(d.sfms.date) : '—'}</div>
            <div><span>SFMS reference / UTR</span>{d.sfms.reference || '—'}</div>
            <div><span>Sender IFSC</span>{d.sfms.sender_ifsc || '—'}</div>
            <div><span>Bank's {d.mechanism_type === 'LC' ? 'LC' : 'BG'} no.</span>{d.bank_reference_no || '—'}</div>
            <div><span>Recorded</span>{fmtDateTime(d.sfms.recorded_at)}{d.sfms.recorded_by ? ` · ${d.sfms.recorded_by}` : ''}</div>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-light)' }}>
            {sjvn
              ? 'No SFMS advice has been recorded against this instrument. Until it is, the instrument rests on the paper copy alone.'
              : `SJVN has not yet recorded an SFMS advice (${d.mechanism_type === 'LC' ? 'MT700' : 'MT760 / IFN 760 COV'}) from your bank. Ask the issuing branch to send it to SJVN's bank and share the reference.`}
            {d.bank_reference_no && <> Bank's reference on record: <strong>{d.bank_reference_no}</strong>.</>}
          </p>
        )}
        {sjvn && d.can_manage && d.status !== 'DRAFT' && mode !== 'sfms' && (
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => setMode('sfms')}>{d.sfms.confirmed ? 'Update SFMS details' : 'Record SFMS advice'}</button>
        )}
        {mode === 'sfms' && <SfmsForm d={d} onDone={took} onCancel={() => setMode(null)} />}
      </div>

      {/* The instrument itself */}
      <div className="cw-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <strong>Original document</strong>
            {d.is_ebg && <span className="cw-flag" style={{ background: '#eff6ff', color: '#1d4ed8', marginLeft: 8 }}>e-BG{d.ebg_reference ? ` · ${d.ebg_reference}` : ''}</span>}
            <div style={{ fontSize: 12, color: 'var(--text-light)' }}>{d.document ? d.document.file_name : 'No scanned guarantee or e-BG is on file for this instrument.'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {d.document && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreview(d.document)}>View scanned BG / e-BG</button>}
            {canAttach && (
              <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                {busy ? 'Uploading…' : d.document ? 'Replace' : 'Attach scan'}
                <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*" disabled={busy} onChange={(e) => attachScan(e.target.files[0])} aria-label="Scanned guarantee" />
              </label>
            )}
          </div>
        </div>
      </div>

      {/* Original -> Amendment 1 -> Amendment 2 */}
      <div className="cw-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <strong>Amendments{d.amendment_count ? ` (${d.amendment_count})` : ''}</strong>
          {amendable && mode !== 'amend' && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMode('amend')}>{sjvn ? 'Record an amendment' : `Submit ${d.mechanism_type === 'LC' ? 'LC' : 'BG'} extension / amendment`}</button>
          )}
        </div>
        <ol className="ps-chain">
          {d.chain.map((c, i) => (
            <li key={c.seq} className={i === d.chain.length - 1 ? 'current' : ''}>
              <span className="ps-step">{c.step}</span>
              {i === d.chain.length - 1 && <span className="cw-flag" style={{ background: '#f0fdf4', color: '#15803d', marginLeft: 8 }}>In force</span>}
              <span className="ps-meta"> · {fmtDate(c.date)}{c.reference ? ` · ${c.reference}` : ''}</span>
              <div>{fmtCurrency(c.limit)} · valid until {c.validity_end ? fmtDate(c.validity_end) : '—'}</div>
              {c.changes.map((ch) => <div key={ch.field} style={{ color: 'var(--primary-dark, #1e40af)' }}>{changeText([ch])}</div>)}
              {c.reason && <div className="ps-meta">{c.reason}</div>}
              {c.sfms_reference && <div className="ps-meta">SFMS {c.sfms_message_type || ''} · {c.sfms_reference}{c.sfms_date ? ` · ${fmtDate(c.sfms_date)}` : ''}</div>}
              {c.seq > 0 && c.document && <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={() => setPreview(c.document)}>View amendment letter</button>}
            </li>
          ))}
        </ol>
        {d.chain.length === 1 && !pending && <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-light)' }}>No amendments — the instrument stands as issued.</p>}

        {pending && (
          <div className="ps-alert blue" style={{ margin: '12px 0 0' }}>
            <strong>Awaiting SJVN:</strong> {changeText(pending.changes)}
            <div style={{ fontSize: 12 }}>{pending.reason} — {pending.raised_by_name}, {fmtDateTime(pending.created_at)}</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              {pending.document_version_id && <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={() => setPreview({ version_id: pending.document_version_id, file_name: pending.document_name })}>View amendment letter</button>}
              {pending.raised_by_side === d.side && <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={() => withdraw(pending.id)}>Withdraw</button>}
            </div>
          </div>
        )}
        {others.map((a) => (
          <div key={a.id} style={{ marginTop: 8, fontSize: 12, color: 'var(--text-light)' }}>
            <Badge status={a.status} /> {changeText(a.changes)}{a.decision_note ? ` — ${a.decision_note}` : ''} · {fmtDate(a.decided_at || a.created_at)}
          </div>
        ))}
        {mode === 'amend' && <AmendForm d={d} sjvn={sjvn} onDone={took} onCancel={() => setMode(null)} />}
      </div>

      <PreviewModal open={!!preview} versionId={preview?.version_id} fileName={preview?.file_name} onClose={() => setPreview(null)} />
    </div>
  );
}
