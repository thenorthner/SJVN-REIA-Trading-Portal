import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { Badge, Field, Modal, AlertPopup, fmtCurrency } from './ui.jsx';
import { PreviewModal } from './DocumentManager.jsx';
import { fmtDate, fmtDateTime } from '../datetime.js';

// What surrounds the signatures of a reconciliation statement: the balance
// rolled forward, the exceptions the counterparty raised, each side's recorded
// signature, the auditor's certificate, the copies signed with a certificate,
// and the statement itself as a PDF or workbook.

const errText = (e) => e.response?.data?.error || e.message;

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function uploadTo(contractId, file, type, title) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('contract_id', contractId);
  fd.append('document_type', type);
  fd.append('category', 'RECORD');
  fd.append('title', title);
  return (await api.documents.upload(fd)).version_id;
}

/** Opening + billed − received − adjustments = closing, set out as the sum it is. */
export function RollForward({ rf }) {
  if (!rf) return null;
  const line = (sign, label, value, strong) => (
    <tr style={strong ? { borderTop: '2px solid var(--border)' } : undefined}>
      <td style={{ padding: '6px 0', width: 18, color: 'var(--slate-500)' }}>{sign}</td>
      <td style={{ padding: '6px 0', fontWeight: strong ? 700 : 400 }}>{label}</td>
      <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: strong ? 700 : 400 }}>{fmtCurrency(value)}</td>
    </tr>
  );
  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <tbody>
          {line('', 'Opening balance — bills of earlier periods still open', rf.opening)}
          {line('+', `Billed in ${rf.window.label}`, rf.billed)}
          {rf.lps > 0 && line('+', 'Late payment surcharge', rf.lps)}
          {line('−', 'Payments received', rf.received)}
          {rf.tds > 0 && line('−', 'Tax deducted at source', rf.tds)}
          {rf.deductions > 0 && line('−', 'Other deductions', rf.deductions)}
          {rf.rebate > 0 && line('−', 'Early-payment rebate', rf.rebate)}
          {rf.credit_notes > 0 && line('−', 'Credit notes', rf.credit_notes)}
          {line('=', `Closing balance as at ${fmtDate(rf.as_at)}`, rf.closing, true)}
        </tbody>
      </table>
      {(rf.since_received > 0 || rf.since_adjusted > 0) && (
        <p className="inline-note" style={{ margin: '6px 0 0' }}>
          Settled since the period closed: {fmtCurrency(rf.since_received + rf.since_adjusted)} — balance today {fmtCurrency(rf.balance_today)}.
        </p>
      )}
      {rf.carried_forward.length > 0 && (
        <details style={{ marginTop: 8, fontSize: 13 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: 600 }}>
            {rf.carried_forward.length} bill{rf.carried_forward.length === 1 ? '' : 's'} carried into the period
          </summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {rf.carried_forward.map((b) => (
              <li key={b.invoice_no}>{b.invoice_no} ({b.billing_period}){b.due_date ? ` · due ${fmtDate(b.due_date)}` : ''} — <strong>{fmtCurrency(b.balance)}</strong> open</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * The counterparty's sign-off: agree outright, or agree with exceptions —
 * naming what is not accepted — with an auditor's certificate where it has one.
 */
export function ReconSignModal({ recon, signoff, mode, signatory, onClose, onSigned }) {
  const partial = mode === 'AGREE_WITH_EXCEPTIONS';
  const [remarks, setRemarks] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [rows, setRows] = useState([{ item_id: '', label: '', amount: '', reason: '' }]);
  const [cert, setCert] = useState({ file: null, auditor_name: '', firm_reg_no: '', udin: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const billed = signoff?.rollforward?.billed || 0;
  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { decision: mode, remarks };
      if (partial) body.exceptions = rows.map((r) => ({ item_id: r.item_id || undefined, label: r.label, amount: Number(r.amount), reason: r.reason }));
      if (cert.file) {
        body.certificate = {
          version_id: await uploadTo(recon.contract_id, cert.file, 'AUDITOR_CERTIFICATE', `Auditor certificate — ${recon.recon_no}`),
          auditor_name: cert.auditor_name, firm_reg_no: cert.firm_reg_no, udin: cert.udin,
        };
      }
      onSigned(await api.reconSignoff.sign(recon.id, body));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title={partial ? 'Agree with exceptions' : 'Agree and sign off'} width={640}>
      <form onSubmit={submit}>
        <AlertPopup open={!!error} title="Not done" message={error} onClose={() => setError('')} />
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: 12, marginBottom: 14, color: '#065f46', fontSize: 13 }}>
          <div><strong>Statement:</strong> {recon.recon_no} · {recon.period} ({recon.data_basis})</div>
          <div><strong>Contract:</strong> {recon.contract_no}</div>
          <div><strong>Signing:</strong> {signatory}</div>
          {signoff?.rollforward && <div><strong>Closing balance:</strong> {fmtCurrency(signoff.rollforward.closing)} as at {fmtDate(signoff.rollforward.as_at)}</div>}
        </div>

        {partial && (
          <>
            <p className="inline-note" style={{ marginTop: 0 }}>
              Name what you do not accept. Everything else on the statement is agreed by this signature, so it can be settled while these are looked into.
            </p>
            {rows.map((r, i) => (
              <div key={i} className="cw-form" style={{ marginTop: 0 }}>
                <div className="form-grid">
                  <Field label="About">
                    <select value={r.item_id} onChange={(e) => { const it = recon.items.find((x) => x.id === e.target.value); setRow(i, { item_id: e.target.value, label: it ? it.label : r.label }); }}>
                      <option value="">Something else…</option>
                      {(recon.items || []).map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
                    </select>
                  </Field>
                  {!r.item_id && <Field label="What it is" required><input required value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} placeholder="e.g. Liquidated damages deducted" /></Field>}
                  <Field label="Amount not agreed (₹)" required><input required type="number" min="0.01" step="any" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} /></Field>
                </div>
                <Field label="Why" required><input required value={r.reason} onChange={(e) => setRow(i, { reason: e.target.value })} placeholder="What is wrong with it, and what it should be" /></Field>
                {rows.length > 1 && <button type="button" className="btn-link" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove this exception</button>}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRows([...rows, { item_id: '', label: '', amount: '', reason: '' }])}>+ Another exception</button>
              <span style={{ fontSize: 13 }}>
                Not agreed: <strong style={{ color: '#b91c1c' }}>{fmtCurrency(total)}</strong>
                {billed > 0 && <> · Agreed: <strong style={{ color: '#15803d' }}>{fmtCurrency(Math.max(0, billed - total))}</strong> of {fmtCurrency(billed)} billed</>}
              </span>
            </div>
          </>
        )}

        <Field label="Remarks (optional)"><input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Verified against JMR and our books" /></Field>

        {signoff?.can_attach_certificate && (
          <div className="cw-form">
            <Field label={`Auditor / CA certificate${signoff.certificate_required ? '' : ' (optional)'}`} required={signoff.certificate_required}>
              <input type="file" required={signoff.certificate_required} accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setCert({ ...cert, file: e.target.files[0] })} />
            </Field>
            {cert.file && (
              <div className="form-grid">
                <Field label="Auditor / firm"><input value={cert.auditor_name} onChange={(e) => setCert({ ...cert, auditor_name: e.target.value })} /></Field>
                <Field label="Firm registration no."><input value={cert.firm_reg_no} onChange={(e) => setCert({ ...cert, firm_reg_no: e.target.value })} /></Field>
                <Field label="UDIN (18 characters)"><input value={cert.udin} maxLength={18} onChange={(e) => setCert({ ...cert, udin: e.target.value.toUpperCase() })} /></Field>
              </div>
            )}
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 12, fontSize: 13, cursor: 'pointer', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            I have reviewed this statement for <strong>{recon.period}</strong> and {partial ? 'agree with it except for the amounts named above' : 'agree with it'}.
            This records an electronic acknowledgement in my name, with the time and a fingerprint of the figures. It cannot be signed again or undone.
          </span>
        </label>

        <div className="form-actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-success" disabled={!confirmed || busy}>{busy ? 'Recording…' : partial ? 'Sign with exceptions' : 'Sign off'}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * @param reconId     the statement
 * @param onChanged   called after anything changes
 * @param onLoaded    handed what was read, for a page that needs it (the sign modal does)
 * @param disputesPath where this user's disputes page is, to raise an exception as a dispute on the bill
 */
export default function ReconSignoffPanel({ reconId, onChanged, onLoaded, disputesPath }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [settle, setSettle] = useState(null);
  const [copy, setCopy] = useState(null);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null);

  const load = useCallback(() => api.reconSignoff.get(reconId).then((r) => { setD(r); onLoaded?.(r); }).catch((e) => setError(errText(e))), [reconId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  async function download(format) {
    setBusy(format);
    try {
      saveBlob(await api.reconSignoff.statementFile(reconId, format), `reconciliation-${d.recon_no.replace(/[^A-Za-z0-9]+/g, '-')}.${format}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  }

  async function attachCopy(e) {
    e.preventDefault();
    setBusy('copy');
    try {
      const versionId = await uploadTo(d.contract_id, copy, 'SIGNED_STATEMENT', `Signed reconciliation statement — ${d.recon_no}`);
      setD(await api.reconSignoff.attachSignedCopy(reconId, versionId));
      setCopy(null);
      setError('');
      onChanged?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy('');
    }
  }

  if (!d) return error ? <div className="alert alert-error">{error}</div> : null;
  const s = d.signatures;
  const both = !!(s.sjvn && s.counterparty);
  const sideKey = d.side === 'SJVN' ? 'sjvn' : 'counterparty';
  const sigLine = (label, x) => (
    <div style={{ padding: 10, border: `1px solid ${x ? '#a7f3d0' : 'var(--border)'}`, background: x ? '#ecfdf5' : '#fff', borderRadius: 6, fontSize: 13.5 }}>
      <div style={{ fontWeight: 700, color: x ? '#065f46' : 'var(--text-muted)' }}>{label}</div>
      {x ? (
        <>
          <div>{x.by} · {String(x.role).replace(/_/g, ' ')}</div>
          <div>{fmtDateTime(x.at)}{x.decision === 'AGREE_WITH_EXCEPTIONS' ? ' · with exceptions' : ''}</div>
          <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--slate-500)' }} title={x.fingerprint}>Fingerprint {x.fingerprint.slice(0, 16)}…</div>
        </>
      ) : <div style={{ color: 'var(--slate-500)' }}>Not signed in this way yet</div>}
    </div>
  );
  const copyLine = (label, c) => c && (
    <div style={{ fontSize: 13.5, marginTop: 4 }}>
      {label}: <button type="button" className="btn-link" onClick={() => setPreview(c)}>{c.file_name}</button>{' '}
      <span style={{ fontWeight: 600, color: c.signed ? '#15803d' : '#b91c1c' }}>
        {c.signed ? `✓ digital signature present${c.signer ? ` — ${c.signer}` : ''}${c.signed_on ? `, ${c.signed_on}` : ''}` : '✗ no digital signature found in the file'}
      </span>
    </div>
  );

  return (
    <div style={{ marginTop: 16 }}>
      <AlertPopup open={!!error} title="Not done" message={error} onClose={() => setError('')} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="section-title" style={{ margin: 0 }}>Balance roll-forward</div>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => download('pdf')}>{busy === 'pdf' ? 'Preparing…' : both ? 'Download signed statement (PDF)' : 'Download statement (PDF)'}</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => download('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Excel'}</button>
        </span>
      </div>
      <div style={{ marginTop: 8 }}>
        {d.rollforward ? <RollForward rf={d.rollforward} /> : <p className="inline-note">A roll-forward is worked out for contract statements with a month, quarter or financial year as their period.</p>}
      </div>

      {d.exceptions.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 18 }}>Exceptions — not agreed by the counterparty</div>
          {d.agreed_amount != null && d.excepted_amount > 0 && (
            <div className="alert alert-success" style={{ fontSize: 13 }}>
              Agreed and payable now: <strong>{fmtCurrency(d.agreed_amount)}</strong> of {fmtCurrency(d.rollforward.billed)} billed. Held under exception: <strong>{fmtCurrency(d.excepted_amount)}</strong>.
            </div>
          )}
          {d.exceptions.map((x) => (
            <div key={x.id} className="cw-card" style={{ borderLeft: `4px solid ${x.status === 'OPEN' ? '#dc2626' : '#94a3b8'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <strong>{x.label} — {fmtCurrency(x.amount)}</strong>
                <Badge status={x.status === 'OPEN' ? 'PENDING' : x.status === 'ACCEPTED' ? 'ACTIVE' : 'REJECTED'} label={x.status === 'OPEN' ? 'Open' : x.status === 'ACCEPTED' ? 'Accepted by SJVN' : 'Not accepted'} />
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{x.reason}</div>
              <div style={{ fontSize: 13.5, color: 'var(--slate-500)', marginTop: 2 }}>Raised by {x.raised_by_name} · {fmtDateTime(x.created_at)}</div>
              {x.status !== 'OPEN' && <div style={{ fontSize: 13, marginTop: 6 }}><strong>{x.resolved_by}:</strong> {x.resolution_note}</div>}
              {x.status === 'OPEN' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {d.can_resolve && <button className="btn btn-success btn-sm" onClick={() => setSettle({ id: x.id, outcome: 'ACCEPTED', note: '' })}>Accept</button>}
                  {d.can_resolve && <button className="btn btn-danger btn-sm" onClick={() => setSettle({ id: x.id, outcome: 'REJECTED', note: '' })}>Not accepted</button>}
                  {d.side !== 'SJVN' && d.period_invoice && disputesPath && (
                    <a className="btn btn-secondary btn-sm" href={`${disputesPath}?${new URLSearchParams({ invoice: d.period_invoice.id, amount: String(x.amount), note: `${d.recon_no} — ${x.label}: ${x.reason}` })}`}>
                      Raise as a dispute on {d.period_invoice.invoice_no}
                    </a>
                  )}
                </div>
              )}
              {settle?.id === x.id && (
                <form className="cw-form" onSubmit={async (e) => { e.preventDefault(); try { setD(await api.reconSignoff.resolveException(x.id, settle)); setSettle(null); setError(''); onChanged?.(); } catch (err) { setError(errText(err)); } }}>
                  <Field label={settle.outcome === 'ACCEPTED' ? 'What will be corrected' : 'Why it is not accepted'} required>
                    <input required value={settle.note} onChange={(e) => setSettle({ ...settle, note: e.target.value })} />
                  </Field>
                  <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setSettle(null)}>Cancel</button><button type="submit" className="btn btn-primary">Record decision</button></div>
                </form>
              )}
            </div>
          ))}
          {d.side !== 'SJVN' && d.excepted_amount > 0 && (
            <p className="inline-note">An exception is a note on this statement. To have the amount held back from what is payable on the bill, raise it as a dispute on the bill as well.</p>
          )}
        </>
      )}

      {(s.sjvn || s.counterparty) && (
        <>
          <div className="section-title" style={{ marginTop: 18 }}>Signatures on record</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {sigLine('SJVN', s.sjvn)}
            {sigLine('Counterparty', s.counterparty)}
          </div>
          {d.same_content === true && <p className="inline-note" style={{ marginTop: 6 }}>Both parties signed the same figures — the fingerprints match.</p>}
          {d.same_content === false && <div className="alert alert-error" style={{ marginTop: 6, fontSize: 13 }}>The figures changed between the two signatures — the fingerprints differ.</div>}
          <p className="inline-note" style={{ marginTop: 6 }}>
            A signature here is an electronic acknowledgement: the signatory, the time and a fingerprint of the figures. It is not a certificate-based digital signature (DSC / Aadhaar e-Sign). For one of those, download the statement, sign it with your certificate, and attach the signed copy below.
          </p>
        </>
      )}

      {d.certificate && (
        <div style={{ fontSize: 13, marginTop: 10 }}>
          <strong>Auditor's certificate:</strong>{' '}
          <button type="button" className="btn-link" onClick={() => setPreview(d.certificate)}>{d.certificate.file_name}</button>
          {d.certificate.auditor_name ? ` · ${d.certificate.auditor_name}` : ''}{d.certificate.firm_reg_no ? ` · FRN ${d.certificate.firm_reg_no}` : ''}{d.certificate.udin ? ` · UDIN ${d.certificate.udin}` : ''}
        </div>
      )}

      {(d.signed_copies.sjvn || d.signed_copies.counterparty || s[sideKey]) && d.contract_id && (
        <div style={{ marginTop: 12 }}>
          <div className="section-title">Copies signed with a digital signature certificate</div>
          {copyLine('SJVN', d.signed_copies.sjvn)}
          {copyLine('Counterparty', d.signed_copies.counterparty)}
          {!d.signed_copies.sjvn && !d.signed_copies.counterparty && <div style={{ fontSize: 13, color: 'var(--slate-500)' }}>None attached yet.</div>}
          {s[sideKey] && (
            <form onSubmit={attachCopy} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
              <input key={d.signed_copies[sideKey]?.version_id || 'none'} type="file" accept=".pdf,application/pdf" onChange={(e) => setCopy(e.target.files[0])} aria-label="Signed statement PDF" />
              <button type="submit" className="btn btn-primary btn-sm" disabled={!copy || busy === 'copy'}>{d.signed_copies[sideKey] ? 'Replace our signed copy' : 'Attach our signed copy'}</button>
            </form>
          )}
        </div>
      )}

      <PreviewModal open={!!preview} versionId={preview?.version_id} fileName={preview?.file_name} onClose={() => setPreview(null)} />
    </div>
  );
}
