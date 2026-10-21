import React, { useEffect, useRef, useState } from 'react';
import api from '../api/client.js';
import { AlertPopup, Badge, fmtCurrency } from './ui.jsx';

const STATUS_OPTS = ['VERIFIED', 'PENDING', 'FAILED', 'NA'];
const STATUS_TONE = { VERIFIED: 'ACTIVE', PENDING: 'PENDING', FAILED: 'REJECTED', NA: 'DRAFT', IN_PROGRESS: 'PENDING' };
// Only what can genuinely not arise on a bill can be marked not applicable;
// the server holds the same rule.
const NA_ALLOWED = new Set(['CURTAILMENT_CHECKED', 'CHANGE_IN_LAW_VERIFIED']);
const COMMERCIAL_FIELDS = [
  { key: 'energy_charges', label: 'Energy Charges', readOnly: true },
  { key: 'other_bill_lines', label: 'Other lines on the bill (transmission, taxes, …)', readOnly: true },
  { key: 'change_in_law', label: 'Change in Law' },
  { key: 'compensation_event', label: 'Compensation Event', min: 0 },
  { key: 'liquidated_damages', label: 'Liquidated Damages (−)', min: 0 },
  { key: 'previous_adjustment', label: 'Previous Adjustment' },
];
const netOf = (c) => Math.round((Number(c.energy_charges) || 0) + (Number(c.other_bill_lines) || 0)
  + (Number(c.change_in_law) || 0) + (Number(c.compensation_event) || 0)
  - (Number(c.liquidated_damages) || 0) + (Number(c.previous_adjustment) || 0));

// Structured technical + commercial verification for a developer's own bill.
export default function VerificationChecklist({ invoiceId, totalAmount, canWrite = false, onSaved }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [popup, setPopup] = useState('');
  const busy = useRef(false);

  useEffect(() => {
    if (!invoiceId) return;
    setData(null); setLoadError('');
    api.invoices.getVerification(invoiceId)
      .then(setData)
      .catch((err) => setLoadError(err.response?.data?.error || 'Could not load the verification checklist.'));
  }, [invoiceId]);

  if (loadError) return <div style={{ fontSize: 13, color: 'var(--text-light)' }}>{loadError}</div>;
  if (!data) return <div style={{ fontSize: 13, color: 'var(--text-light)' }}>Loading verification…</div>;

  const writable = canWrite && data.editable;
  const setTech = (key, patch) => { setSaved(false); setData((d) => ({
    ...d, technical: d.technical.map((t) => (t.key === key ? { ...t, ...patch } : t)),
  })); };
  const setComm = (key, val) => { setSaved(false); setData((d) => {
    const commercial = { ...d.commercial, [key]: val };
    commercial.net_invoice = netOf(commercial);
    return { ...d, commercial };
  }); };
  const needsReason = (t) => t.auto === 'FAILED' && t.status !== 'FAILED';
  const raised = Number(totalAmount ?? (data.commercial.net_invoice - (data.commercial_gap || 0))) || 0;
  // Damages recovered by their own note (V4) are not a gap in the bill.
  const ld = Math.round(Number(data.commercial.liquidated_damages) || 0);
  const gap = Math.round((data.commercial.net_invoice || 0) + (Number(data.ld_recovered) || 0) - raised);

  async function draftLdNote() {
    if (busy.current) return;
    busy.current = true;
    try {
      await api.notes.fromException({ kind: 'VERIFICATION_LD', invoice_id: invoiceId });
      setData(await api.invoices.getVerification(invoiceId));
      onSaved?.();
    } catch (err) {
      setPopup(err.response?.data?.error || 'Could not draft the note.');
    } finally { busy.current = false; }
  }

  async function save() {
    if (busy.current) return;
    const missing = data.technical.filter((t) => needsReason(t) && String(t.note || '').trim().length < 5);
    if (missing.length) {
      setPopup(`${missing.map((t) => t.label).join(', ')} failed the automatic check. Say why you are clearing it in the note.`);
      return;
    }
    const bad = COMMERCIAL_FIELDS.find((f) => !f.readOnly && (data.commercial[f.key] === '' || !Number.isFinite(Number(data.commercial[f.key])) || (f.min === 0 && Number(data.commercial[f.key]) < 0)));
    if (bad) { setPopup(`${bad.label} must be a number${bad.min === 0 ? ' of zero or more' : ''}.`); return; }
    busy.current = true; setSaving(true);
    try {
      const commercial = Object.fromEntries(COMMERCIAL_FIELDS.filter((f) => !f.readOnly).map((f) => [f.key, Number(data.commercial[f.key]) || 0]));
      const res = await api.invoices.saveVerification(invoiceId, {
        technical: data.technical.map((t) => ({ key: t.key, status: t.status, note: t.note || '' })),
        commercial,
      });
      setData(res); setSaved(true);
      onSaved && onSaved(res);
    } catch (err) {
      setPopup(err.response?.data?.error || 'The verification could not be saved.');
    } finally { busy.current = false; setSaving(false); }
  }

  return (
    <div>
      <AlertPopup open={!!popup} title="Not saved" message={popup} onClose={() => setPopup('')} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <strong>Verification Status:</strong>
        <Badge status={STATUS_TONE[data.verification_status] || 'PENDING'} label={data.started ? data.verification_status.replace(/_/g, ' ') : (data.verification_status === 'FAILED' ? 'FAILED (automatic check)' : 'NOT STARTED')} />
        {data.verified_by && <span style={{ fontSize: 13.5, color: 'var(--text-light)' }}>by {data.verified_by}</span>}
      </div>
      {canWrite && !data.editable && (
        <p className="inline-note">The checklist is worked while the bill is with SJVN for a decision; it is read-only now.</p>
      )}
      {writable && data.retrospective && (
        <div className="alert alert-warning" role="status" style={{ marginBottom: 10 }}>
          This bill was approved without a completed verification. Working the checklist now records the check after the fact: it does not undo the approval, and a failure here keeps the bill flagged on the verification queue — settle it with a dispute or a debit note.
        </div>
      )}

      <div className="section-title" style={{ marginTop: 8 }}>Technical Verification</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.technical.map((t) => (
          <div key={t.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--border, var(--border))' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {t.label}
                {t.auto === 'FAILED' && t.status !== 'FAILED' && (
                  <span style={{ fontWeight: 400, color: 'var(--text-light)' }}> · automatic check: {t.auto}</span>
                )}
              </div>
              {t.hint && <div style={{ fontSize: 13, color: 'var(--text-light)' }}>{t.hint}</div>}
              {writable ? (
                <input
                  aria-label={`${t.label} note`}
                  placeholder={needsReason(t) ? 'Reason for clearing the failed check (required)' : 'Note (optional)'}
                  value={t.note || ''}
                  onChange={(e) => setTech(t.key, { note: e.target.value })}
                  style={{ marginTop: 4, width: '100%', fontSize: 13.5, padding: '2px 6px', borderColor: needsReason(t) && !String(t.note || '').trim() ? 'var(--red)' : undefined }}
                />
              ) : (t.note && <div className="audit-muted">{t.note}</div>)}
            </div>
            {writable ? (
              <select aria-label={`${t.label} status`} value={t.status} onChange={(e) => setTech(t.key, { status: e.target.value })} style={{ minWidth: 110 }}>
                {STATUS_OPTS.filter((s) => s !== 'NA' || NA_ALLOWED.has(t.key) || t.auto === 'NA').map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : <Badge status={STATUS_TONE[t.status] || 'PENDING'} label={t.status} />}
          </div>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>Commercial Verification</div>
      <table className="data-table" style={{ width: '100%' }}>
        <tbody>
          {COMMERCIAL_FIELDS.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td className="text-right" style={{ width: 180 }}>
                {writable && !f.readOnly ? (
                  <input type="number" step="1" min={f.min} aria-label={f.label} value={data.commercial[f.key] ?? 0}
                    onChange={(e) => setComm(f.key, e.target.value)}
                    style={{ width: 160, textAlign: 'right' }} />
                ) : <span className="mono">{fmtCurrency(Number(data.commercial[f.key]) || 0)}</span>}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border, var(--border))' }}>
            <td>Net by the build-up</td>
            <td className="text-right mono">{fmtCurrency(data.commercial.net_invoice || 0)}</td>
          </tr>
          <tr>
            <td>Raised for</td>
            <td className="text-right mono">{fmtCurrency(raised)}</td>
          </tr>
        </tbody>
      </table>
      {data.ld_note && (
        <div className="inline-note" style={{ marginTop: 10 }}>
          Liquidated damages of {fmtCurrency(data.ld_note.amount)} are recovered by {data.ld_note.status === 'DRAFT' ? 'a draft credit note awaiting Finance\'s approval' : `credit note ${data.ld_note.note_no}`}.
        </div>
      )}
      {gap !== 0 && (
        <div className="alert alert-warning" style={{ marginTop: 10 }} role="status">
          The build-up and the bill differ by {fmtCurrency(Math.abs(gap))}, so the bill cannot be verified as it stands.
          {ld > 0 && !data.ld_note && Math.abs(gap) === ld
            ? ' The difference is the liquidated damages: save the checklist, then recover them by a note on this bill.'
            : ' Send it back to the developer to correct.'}
          {canWrite && ld > 0 && !data.ld_note && data.started && (
            <div style={{ marginTop: 8 }}><button type="button" className="btn btn-primary btn-sm" onClick={draftLdNote}>Draft LD note of {fmtCurrency(ld)}</button></div>
          )}
        </div>
      )}

      {writable && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Verification'}
          </button>
          {saved && <span style={{ fontSize: 13, color: 'var(--green)' }}>Verification saved.</span>}
        </div>
      )}
    </div>
  );
}
