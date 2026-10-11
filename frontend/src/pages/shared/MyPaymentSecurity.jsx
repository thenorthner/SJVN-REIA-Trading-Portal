import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, StatCard, Badge, Modal, Field, fmtCurrency } from '../../components/ui.jsx';
import SecurityInstrumentPanel, { ExpiryTag, attachSecurityFile, errText, eventLabel } from '../../components/SecurityInstrumentPanel.jsx';
import { PreviewModal } from '../../components/DocumentManager.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';

// The counterparty's side of payment security. A seller sees the guarantees it
// has given SJVN (EMD, PBG) and the letter of credit SJVN keeps open in its
// favour; a buyer sees the letters of credit it has given SJVN.

const ROW_CLASS = { EXPIRED: 'ps-row-expired', CRITICAL: 'ps-row-critical', WARN: 'ps-row-warn' };
const typeOf = (r) => (r.mechanism_type === 'BANK_GUARANTEE' ? (r.bg_subtype === 'OTHER_BG' ? 'BG · Other' : r.bg_subtype || 'BG') : r.mechanism_type === 'LC' ? 'LC' : r.mechanism_type.replace(/_/g, ' '));

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SubmitForm({ seller, contracts, onDone, onCancel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    contract_id: contracts.length === 1 ? contracts[0].id : '', bg_subtype: 'PBG', amount: '', bank_reference_no: '', issuing_bank: '',
    issuing_branch: '', issuing_ifsc: '', issue_date: today, validity_start: today, validity_end: '', claim_deadline: '', is_ebg: false, ebg_reference: '', remarks: '',
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const need = contracts.find((c) => c.id === f.contract_id);
  const thing = seller ? 'guarantee' : 'letter of credit';

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!file) { setError(`Attach the scanned ${thing}${seller ? ' or the e-BG' : ''}.`); return; }
    setBusy(true);
    try {
      const versionId = await attachSecurityFile(f.contract_id, file, { type: seller ? 'BANK_GUARANTEE' : 'LETTER_OF_CREDIT', title: `${seller ? f.bg_subtype : 'LC'} ${f.bank_reference_no}` });
      onDone(await api.securityDesk.submit({ ...f, amount: Number(f.amount), document_version_id: versionId }));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-light)' }}>
        Enter the {thing} as your bank issued it. It goes to SJVN for acceptance and counts as security only once accepted.
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="form-grid">
        <Field label={seller ? 'PPA' : 'PSA'} required>
          <select required value={f.contract_id} onChange={(e) => set({ contract_id: e.target.value })}>
            <option value="">Select…</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
          </select>
        </Field>
        {seller && (
          <Field label="Guarantee type" required>
            <select value={f.bg_subtype} onChange={(e) => set({ bg_subtype: e.target.value })}>
              <option value="PBG">Performance bank guarantee (PBG)</option>
              <option value="EMD">Earnest money deposit (EMD)</option>
              <option value="OTHER_BG">Other guarantee</option>
            </select>
          </Field>
        )}
        <Field label={`Bank's ${seller ? 'BG' : 'LC'} number`} required><input required value={f.bank_reference_no} onChange={(e) => set({ bank_reference_no: e.target.value })} /></Field>
        <Field label="Amount (₹)" required><input required type="number" min="1" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
        <Field label="Issuing bank" required><input required value={f.issuing_bank} onChange={(e) => set({ issuing_bank: e.target.value })} /></Field>
        <Field label="Branch"><input value={f.issuing_branch} onChange={(e) => set({ issuing_branch: e.target.value })} /></Field>
        <Field label="Branch IFSC"><input maxLength={11} value={f.issuing_ifsc} onChange={(e) => set({ issuing_ifsc: e.target.value.toUpperCase() })} /></Field>
        <Field label="Issue date"><input type="date" value={f.issue_date} onChange={(e) => set({ issue_date: e.target.value })} /></Field>
        <Field label="Valid from"><input type="date" value={f.validity_start} onChange={(e) => set({ validity_start: e.target.value })} /></Field>
        <Field label="Valid until" required><input required type="date" value={f.validity_end} onChange={(e) => set({ validity_end: e.target.value })} /></Field>
        <Field label="Claim period ends"><input type="date" value={f.claim_deadline} onChange={(e) => set({ claim_deadline: e.target.value })} /></Field>
        <Field label={`Scanned ${thing}${seller ? ' / e-BG' : ''} *`}>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*" onChange={(e) => setFile(e.target.files[0] || null)} aria-label="Scanned instrument" />
        </Field>
      </div>
      {seller && need && f.bg_subtype === 'PBG' && need.pbg_required > 0 && (
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-light)' }}>
          This PPA asks for a PBG of {fmtCurrency(need.pbg_required)}; {fmtCurrency(need.pbg_held)} is held now.
        </p>
      )}
      {seller && (
        <div className="form-grid">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={f.is_ebg} onChange={(e) => set({ is_ebg: e.target.checked })} /> This is an e-BG issued through NeSL
          </label>
          {f.is_ebg && <Field label="e-BG reference (NeSL)"><input value={f.ebg_reference} onChange={(e) => set({ ebg_reference: e.target.value })} /></Field>}
        </div>
      )}
      <Field label="Remarks"><textarea value={f.remarks} onChange={(e) => set({ remarks: e.target.value })} /></Field>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit to SJVN'}</button>
      </div>
    </form>
  );
}

function ReleaseBox({ d, onDone }) {
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const rc = d.release_check;
  const pending = d.releases?.find((r) => r.status === 'PENDING');

  async function request() {
    setError('');
    try {
      await api.paymentSecurity.releaseRequest(d.id, note || 'Release requested after contract milestone');
      setOpen(false);
      onDone();
    } catch (err) {
      setError(errText(err));
    }
  }

  return (
    <div className="cw-card">
      <strong>Release</strong>
      {d.releases?.map((r) => (
        <div key={r.id} style={{ fontSize: 13, marginTop: 6 }}>
          <Badge status={r.status} /> {r.reason} <span style={{ color: 'var(--text-light)' }}>· {r.requested_by}, {fmtDate(r.created_at)}{r.acted_by ? ` · decided by ${r.acted_by}` : ''}</span>
          {r.decision_note && <div style={{ fontSize: 12, color: r.status === 'REJECTED' ? '#b91c1c' : 'var(--text-light)' }}>SJVN: {r.decision_note}</div>}
        </div>
      ))}
      {!pending && rc.can_request && (
        <>
          <p style={{ margin: '6px 0', fontSize: 13, color: rc.clear ? 'var(--text-light)' : '#b45309' }}>
            {rc.clear
              ? 'Nothing is outstanding on this contract and no dispute is open, so a release can be considered.'
              : `SJVN releases security only when nothing is owed and no dispute is open. Right now: ${[
                rc.outstanding_dues > 0 && `${fmtCurrency(rc.outstanding_dues)} outstanding`,
                rc.open_disputes > 0 && `${rc.open_disputes} open dispute${rc.open_disputes === 1 ? '' : 's'}`,
              ].filter(Boolean).join(' and ')}. A request made now is likely to be refused.`}
          </p>
          {error && <div className="form-error">{error}</div>}
          {open ? (
            <>
              <Field label="Reason / milestone reference"><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. COD achieved on 12 Aug 2026; EMD to be returned." /></Field>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={request}>Send release request</button>
              </div>
            </>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>Request release</button>
          )}
        </>
      )}
    </div>
  );
}

function ReplenishBox({ d, onDone }) {
  const [amt, setAmt] = useState('');
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await api.paymentSecurity.replenish(d.id, Number(amt));
      onDone(`${fmtCurrency(Number(amt))} recorded as reinstated on ${d.instrument_no}. SJVN has been told and will check it against your bank's advice.`);
      setAmt('');
    } catch (err) {
      setError(errText(err));
    }
  }
  return (
    <form className="cw-card" onSubmit={submit}>
      <strong>Replenish</strong>
      <p style={{ margin: '4px 0 8px', fontSize: 13, color: 'var(--text-light)' }}>{fmtCurrency(d.utilized_amount)} has been drawn on this revolving letter of credit. Record the amount your bank has reinstated.</p>
      {error && <div className="form-error">{error}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
        <Field label="Amount reinstated (₹)"><input required type="number" min="1" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
        <button type="submit" className="btn btn-primary btn-sm" style={{ marginBottom: 14 }}>Submit</button>
      </div>
    </form>
  );
}

function LcTab({ o, onPreview }) {
  const ppas = o.contracts.filter((c) => c.contract_type === 'PPA');
  return (
    <>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-light)' }}>
        Under the PPA, SJVN keeps a letter of credit open in your favour as security for its payments to you. This is that letter of credit — what SJVN has opened, for how much, and until when.
      </p>
      {ppas.map((c) => (
        <div key={c.id} className={`ps-alert ${c.lc_shortfall > 0 ? 'amber' : 'green'}`}>
          <strong>{c.contract_no}:</strong>{' '}
          {c.lc_open > 0 ? `${fmtCurrency(c.lc_open)} of letter of credit is open in your favour` : 'No letter of credit is open in your favour'}
          {c.lc_required > 0 && <> against {fmtCurrency(c.lc_required)} worked out from your average monthly bill</>}.
          {c.lc_shortfall > 0 && <> Short by <strong>{fmtCurrency(c.lc_shortfall)}</strong> — raise it with SJVN through a contract notice.</>}
        </div>
      ))}
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th scope="col">LC no.</th><th scope="col">PPA</th><th scope="col">Issuing bank</th><th scope="col">Amount</th><th scope="col">Available</th><th scope="col">Valid until</th><th scope="col">Bank advice (SFMS)</th><th scope="col">Status</th><th scope="col" /></tr></thead>
          <tbody>
            {o.lcs.length === 0 && <tr><td colSpan={9} className="empty-cell">SJVN has not recorded a letter of credit in your favour yet.</td></tr>}
            {o.lcs.map((l) => (
              <tr key={l.id} className={ROW_CLASS[l.expiry.level] || ''}>
                <td><strong>{l.lc_no}</strong>{!!l.is_revolving && <div style={{ fontSize: 11, color: 'var(--text-light)' }}>Revolving</div>}</td>
                <td>{l.contract_no}</td>
                <td>{l.issuing_bank || '—'}{l.advising_bank && <div style={{ fontSize: 11, color: 'var(--text-light)' }}>Advised through {l.advising_bank}</div>}</td>
                <td>{fmtCurrency(l.amount)}</td>
                <td>{fmtCurrency(l.available_amount)}{l.utilized_amount > 0 && <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{fmtCurrency(l.utilized_amount)} drawn</div>}</td>
                <td>{l.validity_end ? fmtDate(l.validity_end) : '—'} <ExpiryTag expiry={l.expiry} /></td>
                <td>{l.sfms_reference ? <>{l.sfms_message_type} · {l.sfms_reference}<div style={{ fontSize: 11, color: 'var(--text-light)' }}>{l.sfms_date ? fmtDate(l.sfms_date) : ''}</div></> : <span style={{ color: 'var(--text-light)' }}>Not recorded</span>}</td>
                <td><Badge status={l.status === 'ACTIVE' && l.expiry.level === 'EXPIRED' ? 'EXPIRED' : l.status} /></td>
                <td>{l.document && <button type="button" className="btn-link" onClick={() => onPreview(l.document)}>View LC</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function MyPaymentSecurity({ role = 'SELLER' }) {
  const seller = role === 'SELLER';
  const [o, setO] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('given');
  const [view, setView] = useState('ALL');
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [preview, setPreview] = useState(null);
  const [flash, setFlash] = useState('');
  const [detailFlash, setDetailFlash] = useState('');

  const load = useCallback(() => {
    api.securityDesk.overview().then(setO).catch((e) => setError(errText(e)));
  }, []);
  useEffect(load, [load]);

  const loadDetail = useCallback((id) => {
    api.securityDesk.get(id).then(setDetail).catch((e) => setError(errText(e)));
  }, []);
  useEffect(() => { setDetail(null); setDetailFlash(''); if (openId) loadDetail(openId); }, [openId, loadDetail]);
  const refresh = () => { load(); if (openId) loadDetail(openId); };

  const rows = useMemo(() => {
    const list = o?.instruments || [];
    if (view === 'ATTENTION') return list.filter((i) => i.needs_extension || (!i.sfms.confirmed && ['ACTIVE', 'PARTIALLY_UTILIZED', 'RENEWED'].includes(i.status)));
    if (view === 'WITH_SJVN') return list.filter((i) => i.pending_amendment || i.status === 'DRAFT' || i.status === 'RELEASE_PENDING');
    return list;
  }, [o, view]);

  if (error && !o) return <div className="form-error">{error}</div>;
  if (!o) return <div style={{ padding: 24, color: 'var(--text-light)' }}>Loading…</div>;

  const t = o.totals;
  const urgent = o.instruments.filter((i) => i.needs_extension);
  const worst = urgent.some((i) => ['EXPIRED', 'CRITICAL'].includes(i.expiry.level));
  const withSjvn = t.pending_amendments + t.pending_submissions;

  async function downloadRegister() {
    try {
      saveBlob(await api.securityDesk.register(), `payment-security-register-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      setError(errText(err));
    }
  }

  return (
    <div>
      <PageHeader
        title={seller ? 'Payment Security' : 'My Payment Security'}
        subtitle={seller
          ? 'The guarantees you have given SJVN (EMD / PBG) and the letter of credit SJVN keeps open in your favour'
          : 'The letters of credit you have given SJVN under your PSAs — validity, bank confirmation, amendments and release'}
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={downloadRegister}>Download register (Excel)</button>
            <button type="button" className="btn btn-primary" onClick={() => setShowSubmit(true)} disabled={!o.contracts.length}>{seller ? '+ Submit a new BG' : '+ Submit a new LC'}</button>
          </div>
        )}
      />
      {error && <div className="form-error">{error}</div>}
      {flash && <div className="ps-alert green" role="status">{flash}</div>}

      {urgent.length > 0 && (
        <div className={`ps-alert ${worst ? 'red' : 'amber'}`} role="alert">
          <strong>{urgent.length === 1 ? `${urgent[0].instrument_no} needs an extension` : `${urgent.length} instruments need an extension`}.</strong>{' '}
          {urgent.slice(0, 4).map((i) => `${typeOf(i)} ${i.bank_reference_no || i.instrument_no} — ${i.expiry.label.toLowerCase()}`).join('; ')}{urgent.length > 4 ? '; …' : ''}.{' '}
          {seller ? 'A guarantee that lapses without an extension may be encashed by SJVN.' : 'Have your bank renew it before it lapses.'}{' '}
          <button type="button" className="btn-link" onClick={() => { setTab('given'); setOpenId(urgent[0].id); }}>Submit the extension →</button>
        </div>
      )}

      <div className="kpi-grid">
        <StatCard label="Security given to SJVN" value={fmtCurrency(t.held)} hint={`${t.count} live instrument${t.count === 1 ? '' : 's'}`} />
        <StatCard label={`Expiring within ${o.thresholds.warn_days} days`} value={t.expiring + t.expired} tone={t.critical || t.expired ? 'red' : t.expiring ? 'amber' : 'green'}
          hint={t.expired ? `${t.expired} already expired` : t.critical ? `${t.critical} within ${o.thresholds.critical_days} days` : t.expiring ? 'Have the bank extend before it lapses' : 'Nothing running out'}
          onClick={t.expiring + t.expired ? () => { setTab('given'); setView('ATTENTION'); } : undefined} />
        <StatCard label="Bank confirmation awaited" value={t.awaiting_sfms} tone={t.awaiting_sfms ? 'amber' : 'green'} hint="SFMS advice not yet with SJVN" />
        <StatCard label="With SJVN for acceptance" value={withSjvn} hint="New instruments and amendments" onClick={withSjvn ? () => { setTab('given'); setView('WITH_SJVN'); } : undefined} />
        {seller && <StatCard label="SJVN's LC in your favour" value={fmtCurrency(t.lc_open)} tone={t.lc_shortfall > 0 ? 'amber' : 'default'} hint={t.lc_shortfall > 0 ? `Short by ${fmtCurrency(t.lc_shortfall)}` : t.lc_required > 0 ? `Against ${fmtCurrency(t.lc_required)} needed` : 'Your payment security'} onClick={() => setTab('lc')} />}
      </div>

      <div className="nb-tabs" role="tablist" style={{ marginTop: 16 }}>
        <button type="button" role="tab" aria-selected={tab === 'given'} className={`nb-tab ${tab === 'given' ? 'active' : ''}`} onClick={() => setTab('given')}>{seller ? 'My bank guarantees (EMD / PBG)' : 'My letters of credit'}</button>
        {seller && <button type="button" role="tab" aria-selected={tab === 'lc'} className={`nb-tab ${tab === 'lc' ? 'active' : ''}`} onClick={() => setTab('lc')}>SJVN LCs (My Payment Security){t.lc_shortfall > 0 && <span className="cw-dot">!</span>}</button>}
        <button type="button" role="tab" aria-selected={tab === 'need'} className={`nb-tab ${tab === 'need' ? 'active' : ''}`} onClick={() => setTab('need')}>Required vs held{!seller && t.lc_given_shortfall > 0 && <span className="cw-dot">!</span>}</button>
      </div>

      {tab === 'given' && (
        <Card>
          <div className="nb-toolbar" style={{ marginBottom: 10 }}>
            {[['ALL', 'All', o.instruments.length], ['ATTENTION', 'Needs your attention', o.instruments.filter((i) => i.needs_extension || (!i.sfms.confirmed && ['ACTIVE', 'PARTIALLY_UTILIZED', 'RENEWED'].includes(i.status))).length], ['WITH_SJVN', 'With SJVN', o.instruments.filter((i) => i.pending_amendment || i.status === 'DRAFT' || i.status === 'RELEASE_PENDING').length]].map(([k, l, n]) => (
              <button key={k} type="button" className={`nb-chip ${view === k ? 'active' : ''}`} onClick={() => setView(k)}>{l}<small>{n}</small></button>
            ))}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th scope="col">Instrument</th><th scope="col">{seller ? 'PPA' : 'PSA'}</th><th scope="col">Type</th><th scope="col">Amount</th><th scope="col">Bank</th><th scope="col">Valid until</th><th scope="col">Bank confirmation (SFMS)</th><th scope="col">Amendments</th><th scope="col">Document</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={10} className="empty-cell">{o.instruments.length ? 'Nothing in this view.' : `No ${seller ? 'guarantees' : 'letters of credit'} on record yet. Use “${seller ? 'Submit a new BG' : 'Submit a new LC'}” to put one before SJVN.`}</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id} className={`clickable ${ROW_CLASS[r.expiry.level] || ''}`} tabIndex={0} role="button" onClick={() => setOpenId(r.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(r.id); } }}>
                    <td><strong>{r.instrument_no}</strong>{r.bank_reference_no && <div style={{ fontSize: 11, color: 'var(--text-light)' }}>Bank ref {r.bank_reference_no}</div>}</td>
                    <td>{r.contract_no}</td>
                    <td>{typeOf(r)}{r.is_ebg && <span className="cw-flag" style={{ background: '#eff6ff', color: '#1d4ed8', marginLeft: 6 }}>e-BG</span>}</td>
                    <td>{fmtCurrency(r.limit_amount)}{r.utilized_amount > 0 && <div style={{ fontSize: 11, color: '#b91c1c' }}>{fmtCurrency(r.utilized_amount)} drawn</div>}</td>
                    <td>{r.issuing_bank || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.validity_end ? fmtDate(r.validity_end) : '—'} <ExpiryTag expiry={r.expiry} />{r.pending_amendment && <div style={{ fontSize: 11, color: '#1d4ed8' }}>Extension with SJVN</div>}</td>
                    <td>{r.sfms.confirmed
                      ? <><span style={{ color: '#15803d', fontWeight: 600 }}>Received</span><div style={{ fontSize: 11, color: 'var(--text-light)' }}>{[r.sfms.message_type, r.sfms.reference, r.sfms.date && fmtDate(r.sfms.date)].filter(Boolean).join(' · ')}</div></>
                      : <span style={{ color: '#b45309', fontWeight: 600 }}>Pending</span>}</td>
                    <td>{r.amendment_count || '—'}</td>
                    <td>{r.document
                      ? <button type="button" className="btn-link" onClick={(e) => { e.stopPropagation(); setPreview(r.document); }}>View {r.is_ebg ? 'e-BG' : 'scan'}</button>
                      : <span style={{ color: 'var(--text-light)' }}>None</span>}</td>
                    <td><Badge status={r.status === 'DRAFT' ? 'SUBMITTED' : r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'lc' && seller && <Card><LcTab o={o} onPreview={setPreview} /></Card>}

      {tab === 'need' && (
        <Card>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-light)' }}>{!seller && 'The letter of credit each PSA asks you to keep open in SJVN\'s favour, worked out from your monthly bill. '}What each contract asks for against what is in force today. An instrument that has lapsed or is still awaiting SJVN's acceptance is not counted.</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th scope="col">Contract</th>{seller ? <><th scope="col">PBG required</th><th scope="col">PBG held</th><th scope="col">EMD held</th><th scope="col">SJVN LC needed</th><th scope="col">SJVN LC open</th></> : <><th scope="col">LC required</th><th scope="col">LC in force</th></>}<th scope="col">Position</th></tr></thead>
              <tbody>
                {o.contracts.length === 0 && <tr><td colSpan={7} className="empty-cell">No contracts.</td></tr>}
                {o.contracts.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.contract_no}</strong></td>
                    {seller
                      ? <><td>{c.pbg_required ? fmtCurrency(c.pbg_required) : '—'}</td><td>{fmtCurrency(c.pbg_held)}</td><td>{c.emd_held ? fmtCurrency(c.emd_held) : '—'}</td><td>{c.lc_required ? fmtCurrency(c.lc_required) : '—'}</td><td>{fmtCurrency(c.lc_open)}</td></>
                      : <><td>{c.lc_given_required ? fmtCurrency(c.lc_given_required) : '—'}</td><td>{fmtCurrency(c.lc_given_held)}</td></>}
                    <td>
                      {seller && c.pbg_shortfall > 0 && <span className="cw-flag red">PBG short by {fmtCurrency(c.pbg_shortfall)}</span>}
                      {seller && c.lc_shortfall > 0 && <span className="cw-flag amber">SJVN LC short by {fmtCurrency(c.lc_shortfall)}</span>}
                      {!seller && c.lc_given_shortfall > 0 && <span className="cw-flag red">LC short by {fmtCurrency(c.lc_given_shortfall)}</span>}
                      {!(seller && (c.pbg_shortfall > 0 || c.lc_shortfall > 0)) && !(!seller && c.lc_given_shortfall > 0) && <span style={{ color: '#15803d', fontWeight: 600 }}>In order</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={showSubmit} onClose={() => setShowSubmit(false)} title={seller ? 'Submit a new bank guarantee' : 'Submit a new letter of credit'} width={680}>
        {showSubmit && (
          <SubmitForm seller={seller} contracts={o.contracts} onCancel={() => setShowSubmit(false)}
            onDone={(made) => { setShowSubmit(false); setFlash(`${made.instrument_no} submitted. It is with SJVN for acceptance.`); setView('ALL'); setTab('given'); load(); }} />
        )}
      </Modal>

      <Modal open={!!openId} onClose={() => setOpenId(null)} title={detail?.instrument_no || 'Instrument'} width={760}>
        {openId && (
          <div>
            {detail && (
              <div className="detail-grid" style={{ marginBottom: 14 }}>
                <div className="detail-item"><span className="detail-label">{seller ? 'PPA' : 'PSA'}</span><span className="detail-value">{detail.contract_no}</span></div>
                <div className="detail-item"><span className="detail-label">Type</span><span className="detail-value">{typeOf(detail)}{detail.is_revolving ? ' · revolving' : ''}</span></div>
                <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status === 'DRAFT' ? 'SUBMITTED' : detail.status} /></span></div>
                <div className="detail-item"><span className="detail-label">Amount</span><span className="detail-value">{fmtCurrency(detail.limit_amount)}</span></div>
                <div className="detail-item"><span className="detail-label">Bank</span><span className="detail-value">{[detail.issuing_bank, detail.issuing_branch].filter(Boolean).join(', ') || '—'}</span></div>
                <div className="detail-item"><span className="detail-label">Bank's reference</span><span className="detail-value">{detail.bank_reference_no || '—'}</span></div>
                <div className="detail-item"><span className="detail-label">Valid</span><span className="detail-value">{detail.validity_start ? fmtDate(detail.validity_start) : '—'} → {detail.validity_end ? fmtDate(detail.validity_end) : '—'}</span></div>
                <div className="detail-item"><span className="detail-label">Claim period ends</span><span className="detail-value">{detail.claim_deadline ? fmtDate(detail.claim_deadline) : '—'}</span></div>
                <div className="detail-item"><span className="detail-label">Drawn</span><span className="detail-value">{fmtCurrency(detail.utilized_amount)}</span></div>
              </div>
            )}
            {detail?.invocations?.length > 0 && (
              <div className="ps-alert red">
                <strong>SJVN has invoked this instrument.</strong>{' '}
                {detail.invocations.map((v) => `${v.invocation_no}: ${fmtCurrency(v.amount)} (${v.status.replace(/_/g, ' ').toLowerCase()})`).join('; ')}
              </div>
            )}
            {detailFlash && <div className="ps-alert green" role="status">{detailFlash}</div>}
            <SecurityInstrumentPanel instrumentId={openId} onChanged={refresh} />
            {detail && !seller && !!detail.is_revolving && detail.utilized_amount > 0 && detail.status !== 'RELEASED' && <ReplenishBox d={detail} onDone={(msg) => { setDetailFlash(msg || ''); refresh(); }} />}
            {detail && detail.status !== 'DRAFT' && detail.status !== 'CLOSED' && <ReleaseBox d={detail} onDone={refresh} />}
            {detail?.events?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 14 }}>History</div>
                <div className="timeline">
                  {detail.events.slice().reverse().slice(0, 12).map((ev) => (
                    <div className="timeline-item" key={ev.id}>
                      {eventLabel(ev.event_type)} — {ev.actor_name}
                      <div className="t-meta">{fmtDateTime(ev.created_at)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      <PreviewModal open={!!preview} versionId={preview?.version_id} fileName={preview?.file_name} onClose={() => setPreview(null)} />
    </div>
  );
}
