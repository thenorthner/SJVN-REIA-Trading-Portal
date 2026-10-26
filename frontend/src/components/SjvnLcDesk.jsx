import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { Badge, Modal, Field, fmtCurrency } from './ui.jsx';
import { ExpiryTag, SfmsFields, attachSecurityFile, errText } from './SecurityInstrumentPanel.jsx';
import { PreviewModal } from './DocumentManager.jsx';
import { fmtDate, fmtDateTime } from '../datetime.js';

// The letters of credit SJVN opens in a seller's favour under a PPA — the other
// direction from everything else on the Payment Security desk. Recorded here by
// the desk or Finance; the seller sees them under its own Payment Security.

const ROW_CLASS = { EXPIRED: 'ps-row-expired', CRITICAL: 'ps-row-critical', WARN: 'ps-row-warn' };
const sfmsBody = (f) => (f.sfms_reference ? { sfms_message_type: f.sfms_message_type, sfms_date: f.sfms_date, sfms_reference: f.sfms_reference } : {});

function OpenForm({ contracts, onDone, onCancel }) {
  const [f, setF] = useState({ contract_id: '', lc_no: '', issuing_bank: '', issuing_branch: '', advising_bank: '', amount: '', is_revolving: true, issue_date: new Date().toISOString().slice(0, 10), validity_end: '', sfms_message_type: 'MT700', remarks: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const need = contracts.find((c) => c.id === f.contract_id);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { ...f, amount: Number(f.amount), ...sfmsBody(f) };
      if (!f.sfms_reference) { delete body.sfms_message_type; delete body.sfms_date; }
      if (file) body.document_version_id = await attachSecurityFile(f.contract_id, file, { type: 'LETTER_OF_CREDIT', title: `SJVN LC ${f.lc_no || ''}`.trim() });
      onDone(await api.securityDesk.openLc(body));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}
      <div className="form-grid">
        <Field label="PPA" required>
          <select required value={f.contract_id} onChange={(e) => set({ contract_id: e.target.value })}>
            <option value="">Select…</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
          </select>
        </Field>
        <Field label="LC number (the bank's)"><input value={f.lc_no} onChange={(e) => set({ lc_no: e.target.value })} placeholder="Numbered automatically if left blank" /></Field>
        <Field label="Issuing bank" required><input required value={f.issuing_bank} onChange={(e) => set({ issuing_bank: e.target.value })} /></Field>
        <Field label="Branch"><input value={f.issuing_branch} onChange={(e) => set({ issuing_branch: e.target.value })} /></Field>
        <Field label="Advising bank (seller's)"><input value={f.advising_bank} onChange={(e) => set({ advising_bank: e.target.value })} /></Field>
        <Field label="Amount (₹)" required><input required type="number" min="1" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
        <Field label="Issue date"><input type="date" value={f.issue_date} onChange={(e) => set({ issue_date: e.target.value })} /></Field>
        <Field label="Valid until" required><input required type="date" value={f.validity_end} onChange={(e) => set({ validity_end: e.target.value })} /></Field>
      </div>
      {need?.lc_required > 0 && <p style={{ margin: '0 0 10px', fontSize: 15, color: 'var(--text-light)' }}>Worked out from the average monthly bill, this PPA needs about {fmtCurrency(need.lc_required)}; {fmtCurrency(need.lc_open)} is open now.</p>}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14.5, marginBottom: 10 }}>
        <input type="checkbox" checked={f.is_revolving} onChange={(e) => set({ is_revolving: e.target.checked })} /> Revolving
      </label>
      <SfmsFields form={f} set={set} defaultType="MT700" optional />
      <Field label="Copy of the LC"><input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*" onChange={(e) => setFile(e.target.files[0] || null)} aria-label="Copy of the LC" /></Field>
      <Field label="Remarks"><textarea value={f.remarks} onChange={(e) => set({ remarks: e.target.value })} /></Field>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Record letter of credit'}</button>
      </div>
    </form>
  );
}

// Phase B.2: the maker (or Finance) records and amends an LC; the checker (or
// Finance) draws on, reinstates and closes it.
function LcDetail({ id, canMake, canCheck, onChanged, onPreview }) {
  const [lc, setLc] = useState(null);
  const [f, setF] = useState({});
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState(null);
  const [error, setError] = useState('');
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  useEffect(() => { api.securityDesk.lc(id).then(setLc).catch((e) => setError(errText(e))); }, [id]);

  async function amend(e) {
    e.preventDefault();
    setError('');
    try {
      const body = { amount: f.amount, validity_end: f.validity_end, note: f.note, ...sfmsBody({ sfms_message_type: 'MT707', ...f }) };
      if (file) body.document_version_id = await attachSecurityFile(lc.contract_id, file, { type: 'LETTER_OF_CREDIT', title: `SJVN LC ${lc.lc_no} — amendment` });
      setLc(await api.securityDesk.amendLc(lc.id, body));
      setMode(null); setF({}); setFile(null);
      onChanged();
    } catch (err) {
      setError(errText(err));
    }
  }
  // A draw by the seller, and a revolving LC's reinstatement, are events with
  // a date and a bank reference — not a figure typed over (17-Oct-2026).
  async function draw(e) {
    e.preventDefault();
    setError('');
    try {
      setLc(await api.securityDesk.drawLc(lc.id, { amount: f.amount, draw_date: f.draw_date, bank_reference: f.bank_reference, invoice_no: f.invoice_no, note: f.note }));
      setMode(null); setF({});
      onChanged();
    } catch (err) {
      setError(errText(err));
    }
  }
  async function reinstate(e) {
    e.preventDefault();
    setError('');
    try {
      setLc(await api.securityDesk.reinstateLc(lc.id, { amount: f.amount, reinstated_on: f.reinstated_on, note: f.note }));
      setMode(null); setF({});
      onChanged();
    } catch (err) {
      setError(errText(err));
    }
  }
  async function close(e) {
    e.preventDefault();
    setError('');
    try {
      await api.securityDesk.closeLc(lc.id, f.note);
      setLc(await api.securityDesk.lc(lc.id));
      setMode(null); setF({});
      onChanged();
    } catch (err) {
      setError(errText(err));
    }
  }

  if (!lc) return error ? <div className="form-error">{error}</div> : <div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>Loading…</div>;
  // Against everything open on the PPA, as the tab counts it — not this one letter alone.
  const short = Math.max(0, (lc.required_amount || 0) - (lc.open_on_contract ?? (lc.live ? lc.available_amount : 0)));
  return (
    <div>
      {error && <div className="form-error">{error}</div>}
      {['EXPIRED', 'CRITICAL', 'WARN'].includes(lc.expiry.level) && (
        <div className={`ps-alert ${lc.expiry.level === 'WARN' ? 'amber' : 'red'}`}><strong>{lc.expiry.label}.</strong> The PPA's payment security lapses with it — have the bank renew it.</div>
      )}
      <div className="detail-grid">
        <div className="detail-item"><span className="detail-label">PPA</span><span className="detail-value">{lc.contract_no}</span></div>
        <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={lc.status} /></span></div>
        <div className="detail-item"><span className="detail-label">Amount</span><span className="detail-value">{fmtCurrency(lc.amount)}{lc.is_revolving ? ' · revolving' : ''}</span></div>
        <div className="detail-item"><span className="detail-label">Drawn / available</span><span className="detail-value">{fmtCurrency(lc.utilized_amount)} / {fmtCurrency(lc.available_amount)}</span></div>
        <div className="detail-item"><span className="detail-label">Needed on this PPA</span><span className="detail-value">{fmtCurrency(lc.required_amount)}{short > 0 ? ` (short by ${fmtCurrency(short)})` : ''}</span></div>
        <div className="detail-item"><span className="detail-label">Issuing bank</span><span className="detail-value">{[lc.issuing_bank, lc.issuing_branch].filter(Boolean).join(', ') || '—'}</span></div>
        <div className="detail-item"><span className="detail-label">Advising bank</span><span className="detail-value">{lc.advising_bank || '—'}</span></div>
        <div className="detail-item"><span className="detail-label">Valid</span><span className="detail-value">{lc.issue_date ? fmtDate(lc.issue_date) : '—'} → {lc.validity_end ? fmtDate(lc.validity_end) : '—'}</span></div>
        <div className="detail-item"><span className="detail-label">SFMS advice</span><span className="detail-value">{lc.sfms_reference ? `${lc.sfms_message_type} · ${lc.sfms_reference}${lc.sfms_date ? ` · ${fmtDate(lc.sfms_date)}` : ''}` : 'Not recorded'}</span></div>
      </div>
      <div className="cell-actions" style={{ marginTop: 12 }}>
        {lc.document && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPreview(lc.document)}>View LC</button>}
        {canMake && lc.status === 'ACTIVE' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setMode('amend'); setF({ amount: lc.amount, validity_end: lc.validity_end || '', sfms_message_type: 'MT707' }); }}>Amend / renew</button>}
        {canCheck && lc.status === 'ACTIVE' && lc.available_amount > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setMode('draw'); setF({ draw_date: new Date().toISOString().slice(0, 10) }); }}>Record a draw</button>}
        {canCheck && lc.status === 'ACTIVE' && lc.is_revolving && lc.utilized_amount > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setMode('reinstate'); setF({ amount: lc.utilized_amount, reinstated_on: new Date().toISOString().slice(0, 10) }); }}>Record reinstatement</button>}
        {canCheck && lc.status === 'ACTIVE' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode('close'); setF({}); }}>Close</button>}
      </div>
      {mode === 'amend' && (
        <form className="cw-form" onSubmit={amend}>
          <div className="form-grid">
            <Field label="Amount (₹)"><input type="number" min="1" step="0.01" value={f.amount ?? ''} onChange={(e) => set({ amount: e.target.value })} /></Field>
            <Field label="Valid until"><input type="date" value={f.validity_end || ''} onChange={(e) => set({ validity_end: e.target.value })} /></Field>
            <Field label="Amended LC / bank letter"><input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*" onChange={(e) => setFile(e.target.files[0] || null)} aria-label="Amended LC" /></Field>
          </div>
          <SfmsFields form={f} set={set} defaultType="MT707" optional />
          <Field label="Note"><textarea value={f.note || ''} onChange={(e) => set({ note: e.target.value })} /></Field>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>Cancel</button><button type="submit" className="btn btn-primary">Save amendment</button></div>
        </form>
      )}
      {mode === 'draw' && (
        <form className="cw-form" onSubmit={draw}>
          <div className="form-grid">
            <Field label="Amount drawn (₹)" required><input type="number" required min="1" step="0.01" max={lc.available_amount} value={f.amount ?? ''} onChange={(e) => set({ amount: e.target.value })} /></Field>
            <Field label="Date of draw" required><input type="date" required value={f.draw_date || ''} onChange={(e) => set({ draw_date: e.target.value })} /></Field>
            <Field label="Bank reference" required><input required value={f.bank_reference || ''} onChange={(e) => set({ bank_reference: e.target.value })} /></Field>
            <Field label="Against bill (optional)"><input value={f.invoice_no || ''} onChange={(e) => set({ invoice_no: e.target.value })} placeholder="e.g. SELLER-INV/2026/000005" /></Field>
          </div>
          <Field label="Note"><textarea value={f.note || ''} onChange={(e) => set({ note: e.target.value })} /></Field>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>Cancel</button><button type="submit" className="btn btn-primary">Record draw</button></div>
        </form>
      )}
      {mode === 'reinstate' && (
        <form className="cw-form" onSubmit={reinstate}>
          <div className="form-grid">
            <Field label="Amount reinstated (₹)" required><input type="number" required min="1" step="0.01" max={lc.utilized_amount} value={f.amount ?? ''} onChange={(e) => set({ amount: e.target.value })} /></Field>
            <Field label="Reinstated on" required><input type="date" required value={f.reinstated_on || ''} onChange={(e) => set({ reinstated_on: e.target.value })} /></Field>
          </div>
          <Field label="Note"><textarea value={f.note || ''} onChange={(e) => set({ note: e.target.value })} /></Field>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>Cancel</button><button type="submit" className="btn btn-primary">Record reinstatement</button></div>
        </form>
      )}
      {mode === 'close' && (
        <form className="cw-form" onSubmit={close}>
          <Field label="Why is it being closed?" required><textarea required value={f.note || ''} onChange={(e) => set({ note: e.target.value })} /></Field>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>Cancel</button><button type="submit" className="btn btn-danger">Close letter of credit</button></div>
        </form>
      )}
      {lc.events?.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 16 }}>History</div>
          <div className="timeline">
            {lc.events.slice().reverse().map((ev) => (
              <div className="timeline-item" key={ev.id}>
                <strong>{ev.event_type.charAt(0) + ev.event_type.slice(1).toLowerCase()}</strong> — {ev.actor_name}
                {ev.details && (
                  <div style={{ fontSize: 15 }}>
                    {[ev.details.amount?.from != null && `amount ${fmtCurrency(ev.details.amount.from)} → ${fmtCurrency(ev.details.amount.to)}`,
                      typeof ev.details.amount === 'number' && fmtCurrency(ev.details.amount),
                      ev.details.validity_end?.from !== undefined && `validity ${ev.details.validity_end.from ? fmtDate(ev.details.validity_end.from) : '—'} → ${fmtDate(ev.details.validity_end.to)}`,
                      typeof ev.details.validity_end === 'string' && `valid until ${fmtDate(ev.details.validity_end)}`,
                      ev.details.utilized_amount && `drawn ${fmtCurrency(ev.details.utilized_amount.from)} → ${fmtCurrency(ev.details.utilized_amount.to)}`,
                      ev.details.draw_date && `on ${fmtDate(ev.details.draw_date)}`,
                      ev.details.bank_reference && `ref ${ev.details.bank_reference}`,
                      ev.details.invoice_no && `against ${ev.details.invoice_no}`,
                      ev.details.reinstated_on && `on ${fmtDate(ev.details.reinstated_on)}`,
                      ev.details.note].filter(Boolean).join(' · ')}
                  </div>
                )}
                <div className="t-meta">{fmtDateTime(ev.created_at)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function SjvnLcDesk({ overview, onChanged }) {
  const [showOpen, setShowOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [preview, setPreview] = useState(null);
  if (!overview) return <div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>Loading…</div>;
  const ppas = overview.contracts.filter((c) => c.contract_type === 'PPA');
  const short = ppas.filter((c) => c.lc_shortfall > 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--text-light)', maxWidth: 720 }}>
          Letters of credit SJVN has opened in sellers' favour as payment security under their PPAs. These are SJVN's obligations, not security SJVN holds, and are never counted in coverage.
        </p>
        {overview.can_make_lc && <button type="button" className="btn btn-primary" onClick={() => setShowOpen(true)}>+ Record an LC</button>}
      </div>
      {short.length > 0 && (
        <div className="ps-alert amber">
          <strong>{short.length} PPA{short.length === 1 ? '' : 's'} with less letter of credit open than the monthly bill calls for:</strong>{' '}
          {short.slice(0, 6).map((c) => `${c.contract_no} (short by ${fmtCurrency(c.lc_shortfall)})`).join('; ')}{short.length > 6 ? '; …' : ''}
        </div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th scope="col">LC no.</th><th scope="col">PPA</th><th scope="col">Issuing bank</th><th scope="col">Amount</th><th scope="col">Available</th><th scope="col">Valid until</th><th scope="col">SFMS</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {overview.lcs.length === 0 && <tr><td colSpan={8} className="empty-cell">No letters of credit recorded.</td></tr>}
            {overview.lcs.map((l) => (
              <tr key={l.id} className={`clickable ${ROW_CLASS[l.expiry.level] || ''}`} tabIndex={0} role="button" onClick={() => setOpenId(l.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(l.id); }}>
                <td><strong>{l.lc_no}</strong></td>
                <td>{l.contract_no}</td>
                <td>{l.issuing_bank || '—'}</td>
                <td>{fmtCurrency(l.amount)}</td>
                <td>{fmtCurrency(l.available_amount)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{l.validity_end ? fmtDate(l.validity_end) : '—'} <ExpiryTag expiry={l.expiry} /></td>
                <td>{l.sfms_reference || <span style={{ color: 'var(--text-light)' }}>Not recorded</span>}</td>
                <td><Badge status={l.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showOpen} onClose={() => setShowOpen(false)} title="Record a letter of credit in a seller's favour" width={680}>
        {showOpen && <OpenForm contracts={ppas} onCancel={() => setShowOpen(false)} onDone={() => { setShowOpen(false); onChanged(); }} />}
      </Modal>
      <Modal open={!!openId} onClose={() => setOpenId(null)} title={overview.lcs.find((l) => l.id === openId)?.lc_no || 'Letter of credit'} width={720}>
        {openId && <LcDetail id={openId} canMake={overview.can_make_lc} canCheck={overview.can_check_lc} onChanged={onChanged} onPreview={setPreview} />}
      </Modal>
      <PreviewModal open={!!preview} versionId={preview?.version_id} fileName={preview?.file_name} onClose={() => setPreview(null)} />
    </div>
  );
}
