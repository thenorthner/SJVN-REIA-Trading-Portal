import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { Badge, Field, fmtCurrency, fmtNumber } from './ui.jsx';
import { DocumentManager, PreviewModal } from './DocumentManager.jsx';
import { SettlementTrailPanel } from './SettlementTrail.jsx';
import { fmtDate, fmtDateTime } from '../datetime.js';
import { paymentTermsText, rebateText, lpsText, paymentSecurityText } from '../lib/contractRules.js';
import { askConfirm } from '../lib/dialogs.js';

// The working file of one contract, shared by the seller, the buyer and the
// REIA desk: its documents, project milestones, performance guarantee, the
// requests the counterparty raises, and the notices that pass either way.
// What each side may do is decided by the server; this shows what it allows.
// A PSA has no plant behind it, so it has no milestones or performance
// guarantee here — its LC or corpus is in the Payment Security module.

const TABS = [
  ['OVERVIEW', 'Overview'], ['TRAIL', 'Settlement trail'], ['DOCUMENTS', 'Documents'], ['MILESTONES', 'Milestones'], ['GUARANTEE', 'Guarantee (PBG)'],
  ['REQUESTS', 'Requests'], ['NOTICES', 'Notices'], ['HISTORY', 'History'],
];

const MILESTONE_BADGE = {
  ACHIEVED: ['ACTIVE', 'Achieved'],
  DELAYED: ['REJECTED', 'Delayed'],
  REPORTED: ['PENDING', 'Reported — awaiting SJVN'],
  PENDING: ['DRAFT', 'Pending'],
};
const REQUEST_BADGE = {
  PENDING: ['PENDING', 'Awaiting SJVN'], APPROVED: ['ACTIVE', 'Approved'], REJECTED: ['REJECTED', 'Refused'], WITHDRAWN: ['DRAFT', 'Withdrawn'],
};
const SIDE_NAME = { SJVN: 'SJVN', SELLER: 'Seller', BUYER: 'Buyer' };

const errText = (e) => e.response?.data?.error || e.message;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "in 12 days" / "5 days ago", for a date that matters. */
function Countdown({ days }) {
  if (days === null || days === undefined) return null;
  const late = days < 0;
  const soon = !late && days <= 30;
  return (
    <span style={{ marginLeft: 8, padding: '1px 8px', borderRadius: 999, fontSize: 14.5, fontWeight: 700, background: late ? 'var(--t-red-50)' : soon ? 'var(--t-amber-50)' : 'var(--slate-100)', color: late ? 'var(--red-deep)' : soon ? 'var(--amber-strong)' : 'var(--slate-600)' }}>
      {late ? `${plural(-days, 'day')} overdue` : days === 0 ? 'today' : `in ${plural(days, 'day')}`}
    </span>
  );
}

const Note = ({ children, tone }) => (
  <p style={{ margin: '0 0 12px', fontSize: 14.5, lineHeight: 1.5, color: tone === 'red' ? 'var(--red-deep)' : 'var(--slate-600)' }}>{children}</p>
);

/** Upload a file against the contract and hand back the version it became. */
async function attach(contractId, file, { type, category, title }) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('contract_id', contractId);
  fd.append('document_type', type);
  fd.append('category', category);
  fd.append('title', title);
  return (await api.documents.upload(fd)).version_id;
}

function Overview({ contract, ws, go }) {
  const a = ws.attention;
  const flags = [
    a.milestones_delayed > 0 && { tone: 'red', text: `${plural(a.milestones_delayed, 'milestone')} delayed`, tab: 'MILESTONES' },
    a.milestones_due_soon > 0 && { tone: 'amber', text: `${plural(a.milestones_due_soon, 'milestone')} due within 30 days`, tab: 'MILESTONES' },
    a.milestones_to_confirm > 0 && { tone: 'amber', text: `${plural(a.milestones_to_confirm, 'milestone')} reported, awaiting SJVN`, tab: 'MILESTONES' },
    a.pbg_state === 'EXPIRED' && { tone: 'red', text: `Performance guarantee expired ${plural(-a.pbg_days_to_expiry, 'day')} ago`, tab: 'GUARANTEE' },
    a.pbg_state === 'EXPIRING' && { tone: 'amber', text: `Performance guarantee expires in ${plural(a.pbg_days_to_expiry, 'day')}`, tab: 'GUARANTEE' },
    a.requests_pending > 0 && { tone: 'amber', text: `${plural(a.requests_pending, 'request')} awaiting SJVN's decision`, tab: 'REQUESTS' },
    a.notices_awaiting_me > 0 && { tone: 'red', text: `${plural(a.notices_awaiting_me, 'notice')} to acknowledge`, tab: 'NOTICES' },
  ].filter(Boolean);
  const item = (label, value) => (
    <div className="detail-item"><span className="detail-label">{label}</span><span className="detail-value">{value}</span></div>
  );
  const b = ws.billing;

  return (
    <div>
      {flags.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {flags.map((f) => (
            <button
              key={f.text} type="button" onClick={() => go(f.tab)}
              style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 14.5, fontWeight: 600, padding: '8px 12px', borderRadius: 8, border: `1px solid ${f.tone === 'red' ? '#fca5a5' : 'var(--t-amber-100)'}`, background: f.tone === 'red' ? 'var(--t-red-50)' : 'var(--t-amber-50)', color: f.tone === 'red' ? 'var(--red-deep)' : 'var(--amber-strong)' }}
            >
              {f.text} →
            </button>
          ))}
        </div>
      )}
      <div className="detail-grid mb-0">
        {item('Contract Type', <Badge status={contract.contract_type} />)}
        {item('Status', <Badge status={contract.status} />)}
        {item('Project Type', contract.project_type)}
        {item('Capacity', `${fmtNumber(contract.capacity_mw)} MW`)}
        {item('Tariff', `₹${contract.tariff_per_unit}/unit`)}
        {item('Tenure', `${contract.tenure_start} → ${contract.tenure_end}`)}
        {item('Billing Cycle', contract.billing_cycle)}
        {item('Payment Terms', paymentTermsText(contract))}
        {item('Rebate Rule', rebateText(contract))}
        {item('LPS Rule', lpsText(contract))}
        {item('Payment Security', paymentSecurityText(contract))}
        {ws.has_project && item('COD', contract.cod_date ? fmtDate(contract.cod_date) : 'Not commissioned')}
        {ws.has_project && item('Next milestone', a.next_milestone ? <>{a.next_milestone.label}{a.next_milestone.due_date ? <> · {fmtDate(a.next_milestone.due_date)}<Countdown days={a.next_milestone.days_to_due} /></> : ' · no date set'}</> : '—')}
        {ws.guarantee && item('EMD', fmtCurrency(contract.emd_amount))}
        {item('Version', `v${contract.version}`)}
      </div>
      {b && b.invoices > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 18 }}>Billing on this contract</div>
          <div className="detail-grid mb-0">
            {item('Invoices', b.invoices)}
            {item('Billed', fmtCurrency(b.billed))}
            {item('Paid', fmtCurrency(b.paid))}
            {item('Outstanding', <strong style={{ color: b.outstanding > 0 ? 'var(--amber-strong)' : 'inherit' }}>{fmtCurrency(b.outstanding)}</strong>)}
            {item('Overdue invoices', <strong style={{ color: b.overdue ? 'var(--red-deep)' : 'inherit' }}>{b.overdue}</strong>)}
            {item('Open disputes', b.open_disputes)}
          </div>
        </>
      )}
    </div>
  );
}

function Milestones({ ws, meta, run, raiseExtension }) {
  // Only a contract with a project behind it takes new milestones.
  // Phase B.2: the maker sets and edits milestones; the checker accepts a reported one.
  const manage = ws.can_make;
  const canAdd = manage && ws.has_project;
  const canExtend = ws.request_types.includes('MILESTONE_EXTENSION');
  const outside = ws.side !== 'SJVN';
  const [edit, setEdit] = useState(null);     // { id, due_date, achieved_date, remarks }
  const [report, setReport] = useState(null); // { id, achieved_date, note }
  const [refuse, setRefuse] = useState(null); // { id, note }
  const [add, setAdd] = useState(null);       // { milestone_type, label, due_date }

  return (
    <div>
      <Note>
        The dates the project is held to. {outside
          ? 'When one is met, report it here with the date; it counts once SJVN confirms it. If one cannot be met, ask for an extension before it falls due.'
          : 'Set the dates from the contract. The counterparty reports a milestone as met; it counts once confirmed here.'}
      </Note>

      {ws.milestones.length === 0 && (
        <div className="empty-cell" style={{ padding: 24 }}>
          No milestones have been set on this contract yet.
          {canAdd && <div style={{ marginTop: 10 }}><button className="btn btn-primary btn-sm" onClick={() => run(() => api.contractWorkspace.addStandardMilestones(ws.contract.id))}>Add Financial Closure, SCOD and COD</button></div>}
        </div>
      )}

      {ws.milestones.length > 0 && (
        <div className="table-wrap">
          <table className="data-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th scope="col" style={{ width: '24%' }}>Milestone</th>
                <th scope="col" style={{ width: '20%' }}>Due</th>
                <th scope="col" style={{ width: '24%' }}>Status</th>
                <th scope="col" style={{ width: '12%' }}>Achieved</th>
                <th scope="col" style={{ width: '20%' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {ws.milestones.map((m) => {
                const [tone, label] = MILESTONE_BADGE[m.status];
                return (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.label}</strong>
                      {m.remarks && <div style={{ fontSize: 15, color: 'var(--slate-500)' }}>{m.remarks}</div>}
                    </td>
                    <td>
                      {m.due_date ? fmtDate(m.due_date) : <span style={{ color: 'var(--slate-500)' }}>Not set</span>}
                      {m.status !== 'ACHIEVED' && <Countdown days={m.days_to_due} />}
                      {m.extended && <div style={{ fontSize: 15, color: 'var(--slate-500)' }}>Extended — first agreed {fmtDate(m.original_due_date)}</div>}
                    </td>
                    <td>
                      <Badge status={tone} label={label} />
                      {m.status === 'REPORTED' && <div style={{ fontSize: 15, color: 'var(--slate-500)', marginTop: 2 }}>Reported for {fmtDate(m.reported_date)}{m.reported_note ? ` — ${m.reported_note}` : ''}</div>}
                    </td>
                    <td>
                      {m.achieved_date ? fmtDate(m.achieved_date) : '—'}
                      {m.achieved_date && m.delay_days > 0 && <div style={{ fontSize: 15, color: 'var(--red-deep)' }}>{plural(m.delay_days, 'day')} late</div>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {ws.can_check && m.status === 'REPORTED' && (
                          <>
                            <button className="btn btn-success btn-sm" onClick={() => run(() => api.contractWorkspace.confirmMilestone(m.id, {}))}>Confirm</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setRefuse({ id: m.id, note: '' })}>Not accepted</button>
                          </>
                        )}
                        {manage && <button className="btn btn-secondary btn-sm" onClick={() => setEdit({ id: m.id, due_date: m.due_date || '', achieved_date: m.achieved_date || '', remarks: m.remarks || '' })}>Edit</button>}
                        {manage && !m.achieved_date && !m.reported_date && (
                          <button className="btn btn-secondary btn-sm" onClick={async () => (await askConfirm(`Remove "${m.label}" from this contract?`)) && run(() => api.contractWorkspace.removeMilestone(m.id))}>Remove</button>
                        )}
                        {outside && !m.achieved_date && m.status !== 'REPORTED' && (
                          <button className="btn btn-primary btn-sm" onClick={() => setReport({ id: m.id, achieved_date: '', note: '' })}>Report achieved</button>
                        )}
                        {canExtend && !m.achieved_date && m.due_date && (
                          <button className="btn btn-secondary btn-sm" onClick={() => raiseExtension(m)}>Ask for extension</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canAdd && ws.milestones.length > 0 && !add && (
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setAdd({ milestone_type: 'OTHER', label: '', due_date: '' })}>+ Add a milestone</button>
        </div>
      )}

      {add && (
        <form className="cw-form" onSubmit={(e) => { e.preventDefault(); run(() => api.contractWorkspace.addMilestone(ws.contract.id, add), () => setAdd(null)); }}>
          <div className="form-grid">
            <Field label="Milestone">
              <select value={add.milestone_type} onChange={(e) => setAdd({ ...add, milestone_type: e.target.value })}>
                {Object.entries(meta.milestone_types || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Name (optional)"><input value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} placeholder="As it should read" /></Field>
            <Field label="Due date"><input type="date" value={add.due_date} onChange={(e) => setAdd({ ...add, due_date: e.target.value })} /></Field>
          </div>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setAdd(null)}>Cancel</button><button type="submit" className="btn btn-primary">Add</button></div>
        </form>
      )}

      {edit && (
        <form className="cw-form" onSubmit={(e) => { e.preventDefault(); run(() => api.contractWorkspace.updateMilestone(edit.id, edit), () => setEdit(null)); }}>
          <div className="form-grid">
            <Field label="Due date"><input type="date" value={edit.due_date} onChange={(e) => setEdit({ ...edit, due_date: e.target.value })} /></Field>
            <Field label="Achieved on (leave empty if not yet)"><input type="date" value={edit.achieved_date} onChange={(e) => setEdit({ ...edit, achieved_date: e.target.value })} /></Field>
          </div>
          <Field label="Remarks"><input value={edit.remarks} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} /></Field>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button type="submit" className="btn btn-primary">Save</button></div>
        </form>
      )}

      {report && (
        <form className="cw-form" onSubmit={(e) => { e.preventDefault(); run(() => api.contractWorkspace.reportMilestone(report.id, report), () => setReport(null)); }}>
          <div className="form-grid">
            <Field label="Achieved on" required><input type="date" required value={report.achieved_date} onChange={(e) => setReport({ ...report, achieved_date: e.target.value })} /></Field>
            <Field label="Note for SJVN"><input value={report.note} onChange={(e) => setReport({ ...report, note: e.target.value })} placeholder="e.g. Sanction letter uploaded under Documents" /></Field>
          </div>
          <Note>Put the proof — sanction letter, COD certificate — under Documents so SJVN can check it.</Note>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setReport(null)}>Cancel</button><button type="submit" className="btn btn-primary">Report to SJVN</button></div>
        </form>
      )}

      {refuse && (
        <form className="cw-form" onSubmit={(e) => { e.preventDefault(); run(() => api.contractWorkspace.confirmMilestone(refuse.id, { accept: false, note: refuse.note }), () => setRefuse(null)); }}>
          <Field label="Why the report is not accepted" required><input required value={refuse.note} onChange={(e) => setRefuse({ ...refuse, note: e.target.value })} /></Field>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setRefuse(null)}>Cancel</button><button type="submit" className="btn btn-danger">Send back</button></div>
        </form>
      )}
    </div>
  );
}

function Guarantee({ ws, run, setError }) {
  const g = ws.guarantee;
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const pending = ws.requests.filter((r) => r.request_type === 'PBG_RENEWAL' && r.status === 'PENDING');
  const canRenew = ws.request_types.includes('PBG_RENEWAL');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const versionId = await attach(ws.contract.id, form.file, { type: 'PBG_COPY', category: 'VERIFY', title: `Renewed PBG — valid to ${form.requested_date}` });
      await run(() => api.contractWorkspace.raiseRequest(ws.contract.id, {
        request_type: 'PBG_RENEWAL', requested_date: form.requested_date, amount: form.amount, bank: form.bank,
        description: form.description || 'Renewed performance guarantee submitted for SJVN to take on record.', attachment_version_id: versionId,
      }), () => setForm(null));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {g.state === 'EXPIRED' && <div className="alert alert-error">The performance guarantee on record expired on {fmtDate(g.expiry)} — {plural(-g.days_to_expiry, 'day')} ago. {canRenew ? 'Submit the renewed guarantee below.' : ''}</div>}
      {g.state === 'EXPIRING' && <div className="alert" style={{ background: 'var(--t-amber-50)', border: '1px solid var(--t-amber-100)', color: 'var(--amber-strong)' }}>The performance guarantee expires on {fmtDate(g.expiry)} — in {plural(g.days_to_expiry, 'day')}. {canRenew ? 'Submit the renewed guarantee before then.' : ''}</div>}

      <div className="detail-grid mb-0">
        <div className="detail-item"><span className="detail-label">PBG Amount</span><span className="detail-value">{g.amount ? fmtCurrency(g.amount) : '—'}</span></div>
        <div className="detail-item"><span className="detail-label">Type</span><span className="detail-value">{g.type || '—'}</span></div>
        <div className="detail-item"><span className="detail-label">Valid until</span><span className="detail-value">{g.expiry ? <>{fmtDate(g.expiry)}<Countdown days={g.days_to_expiry} /></> : 'No expiry date on record'}</span></div>
      </div>

      {g.instruments.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 18 }}>Guarantees SJVN holds for this contract</div>
          <div className="table-wrap">
            <table className="data-table" style={{ margin: 0 }}>
              <thead><tr><th scope="col">Instrument</th><th scope="col">Kind</th><th scope="col">Bank</th><th scope="col" style={{ textAlign: 'right' }}>Amount</th><th scope="col">Valid until</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {g.instruments.map((i) => (
                  <tr key={i.id}>
                    <td>{i.instrument_no}</td><td>{i.bg_subtype || 'BG'}</td><td>{i.issuing_bank || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(i.limit_amount)}</td>
                    <td>{i.validity_end ? <>{fmtDate(i.validity_end)}<Countdown days={i.days_to_expiry} /></> : '—'}</td>
                    <td><Badge status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pending.length > 0 && (
        <div className="alert alert-success" style={{ marginTop: 16 }}>
          A renewed guarantee valid to {fmtDate(pending[0].requested_date)} was submitted on {fmtDate(pending[0].created_at)} and is with SJVN. See Requests.
        </div>
      )}

      {canRenew && !form && pending.length === 0 && (
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={() => setForm({ file: null, requested_date: '', amount: g.amount || '', bank: '', description: '' })}>Upload renewed PBG</button>
        </div>
      )}

      {form && (
        <form className="cw-form" onSubmit={submit}>
          <Field label="Renewed guarantee (PDF or scan)" required>
            <input type="file" required accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setForm({ ...form, file: e.target.files[0] })} />
          </Field>
          <div className="form-grid">
            <Field label="Valid until" required><input type="date" required value={form.requested_date} onChange={(e) => setForm({ ...form, requested_date: e.target.value })} /></Field>
            <Field label="Amount (₹)"><input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="Issuing bank"><input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} /></Field>
          </div>
          <Field label="Note for SJVN"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Note>The expiry on record changes only once SJVN has checked the guarantee and accepted it.</Note>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || !form.file}>{busy ? 'Submitting…' : 'Submit to SJVN'}</button></div>
        </form>
      )}
    </div>
  );
}

function Requests({ ws, meta, run, setError, draft, clearDraft, onPreview }) {
  const outside = ws.side !== 'SJVN';
  const [form, setForm] = useState(null);
  const [decide, setDecide] = useState(null); // { id, decision, note, approved_date, type }
  const [busy, setBusy] = useState(false);
  const open = ws.milestones.filter((m) => !m.achieved_date);

  // "Ask for extension" on a milestone lands here with the form filled in.
  useEffect(() => {
    if (draft) { setForm(draft); clearDraft(); }
  }, [draft, clearDraft]);

  // The renewed guarantee has its own form under Guarantee.
  const types = Object.entries(meta.request_types || {}).filter(([k]) => k !== 'PBG_RENEWAL' && ws.request_types.includes(k));
  const grounds = Object.entries(meta.request_grounds || {}).filter(([k]) => ws.request_grounds.includes(k));
  const canExtend = ws.request_types.includes('MILESTONE_EXTENSION');
  const blank = { request_type: canExtend ? 'MILESTONE_EXTENSION' : 'AMENDMENT', milestone_id: open[0]?.id || '', requested_date: '', ground: 'FORCE_MAJEURE', subject: '', description: '', file: null };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { file, ...body } = form;
      if (file) body.attachment_version_id = await attach(ws.contract.id, file, { type: 'CONTRACT_CORRESPONDENCE', category: 'RECORD', title: `Supporting document — ${form.subject || meta.request_types?.[form.request_type] || 'request'}` });
      await run(() => api.contractWorkspace.raiseRequest(ws.contract.id, body), () => setForm(null));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Note>
        {outside
          ? `Ask SJVN for ${canExtend ? 'more time on a milestone, ' : ''}an amendment, or anything else under this contract. Nothing changes until SJVN approves.`
          : `What the counterparty has asked for. ${ws.has_project ? 'Approving an extension moves the milestone date; approving a renewed guarantee updates the expiry on record. ' : ''}An approved amendment is then made through Amend on the contract.`}
      </Note>

      {outside && !form && <div style={{ marginBottom: 12 }}><button className="btn btn-primary btn-sm" onClick={() => setForm(blank)}>+ Raise a request</button></div>}

      {form && (
        <form className="cw-form" onSubmit={submit}>
          <div className="form-grid">
            <Field label="What is being asked for">
              <select value={form.request_type} onChange={(e) => setForm({ ...form, request_type: e.target.value })}>
                {types.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Ground">
              <select value={form.ground} onChange={(e) => setForm({ ...form, ground: e.target.value })}>
                {grounds.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          {form.request_type === 'MILESTONE_EXTENSION' ? (
            <div className="form-grid">
              <Field label="Milestone" required>
                <select required value={form.milestone_id} onChange={(e) => setForm({ ...form, milestone_id: e.target.value })}>
                  <option value="">Choose…</option>
                  {open.map((m) => <option key={m.id} value={m.id}>{m.label}{m.due_date ? ` (now ${m.due_date})` : ''}</option>)}
                </select>
              </Field>
              <Field label="New date asked for" required><input type="date" required value={form.requested_date} onChange={(e) => setForm({ ...form, requested_date: e.target.value })} /></Field>
            </div>
          ) : (
            <Field label="Subject" required><input required maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. Change of delivery point" /></Field>
          )}
          <Field label="Explanation" required>
            <textarea required rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What happened, since when, and what is being asked for." />
          </Field>
          <Field label="Supporting document (optional)"><input type="file" onChange={(e) => setForm({ ...form, file: e.target.files[0] })} /></Field>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send to SJVN'}</button></div>
        </form>
      )}

      {ws.requests.length === 0 && !form && <div className="empty-cell" style={{ padding: 24 }}>No requests on this contract.</div>}

      {ws.requests.map((r) => {
        const [tone, label] = REQUEST_BADGE[r.status];
        return (
          <div key={r.id} className="cw-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <strong>{r.subject}</strong>
                <div style={{ fontSize: 15, color: 'var(--slate-500)', marginTop: 2 }}>
                  {meta.request_types?.[r.request_type] || r.request_type} · {meta.request_grounds?.[r.ground] || r.ground} · raised {fmtDateTime(r.created_at)} by {r.raised_by_name || SIDE_NAME[r.raised_by_side]}
                </div>
              </div>
              <Badge status={tone} label={label} />
            </div>
            <p style={{ margin: '8px 0', fontSize: 15, whiteSpace: 'pre-wrap' }}>{r.description}</p>
            <div style={{ fontSize: 15, color: 'var(--slate-600)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {r.milestone_label && <span>Milestone: {r.milestone_label}</span>}
              {r.requested_date && <span>Asked for: {fmtDate(r.requested_date)}</span>}
              {r.amount && <span>Amount: {fmtCurrency(r.amount)}</span>}
              {r.bank && <span>Bank: {r.bank}</span>}
              {r.attachment_version_id && <button type="button" className="btn-link" onClick={() => onPreview(r.attachment_version_id, r.attachment_name)}>View attachment</button>}
            </div>
            {r.status !== 'PENDING' && r.status !== 'WITHDRAWN' && (
              <div style={{ marginTop: 8, fontSize: 14.5, color: r.status === 'APPROVED' ? 'var(--on-green-2)' : 'var(--red-deep)' }}>
                <strong>{r.status === 'APPROVED' ? 'Approved' : 'Refused'}</strong> by {r.decided_by_name || 'SJVN'} on {fmtDateTime(r.decided_at)}
                {r.approved_date && r.approved_date !== r.requested_date ? ` — granted to ${fmtDate(r.approved_date)}` : ''}
                {r.decision_note ? ` — ${r.decision_note}` : ''}
              </div>
            )}
            {r.status === 'PENDING' && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                {ws.can_check && <button className="btn btn-success btn-sm" onClick={() => setDecide({ id: r.id, decision: 'APPROVED', note: '', approved_date: r.requested_date || '', type: r.request_type })}>Approve</button>}
                {ws.can_check && <button className="btn btn-danger btn-sm" onClick={() => setDecide({ id: r.id, decision: 'REJECTED', note: '', approved_date: '', type: r.request_type })}>Refuse</button>}
                {ws.side === r.raised_by_side && <button className="btn btn-secondary btn-sm" onClick={async () => (await askConfirm('Withdraw this request?')) && run(() => api.contractWorkspace.withdrawRequest(r.id))}>Withdraw</button>}
              </div>
            )}
            {decide?.id === r.id && (
              <form className="cw-form" onSubmit={(e) => { e.preventDefault(); run(() => api.contractWorkspace.decideRequest(r.id, decide), () => setDecide(null)); }}>
                {decide.decision === 'APPROVED' && ['MILESTONE_EXTENSION', 'PBG_RENEWAL'].includes(decide.type) && (
                  <Field label={decide.type === 'PBG_RENEWAL' ? 'Guarantee valid until' : 'Date granted (may differ from the date asked for)'} required>
                    <input type="date" required value={decide.approved_date} onChange={(e) => setDecide({ ...decide, approved_date: e.target.value })} />
                  </Field>
                )}
                <Field label={decide.decision === 'REJECTED' ? 'Why it is refused' : 'Note (optional)'} required={decide.decision === 'REJECTED'}>
                  <textarea rows={2} required={decide.decision === 'REJECTED'} value={decide.note} onChange={(e) => setDecide({ ...decide, note: e.target.value })} />
                </Field>
                <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setDecide(null)}>Cancel</button><button type="submit" className={`btn ${decide.decision === 'APPROVED' ? 'btn-success' : 'btn-danger'}`}>{decide.decision === 'APPROVED' ? 'Approve' : 'Refuse'}</button></div>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Notices({ ws, meta, run, setError, onPreview }) {
  // SJVN's notices are written by the maker; one sent to SJVN is acknowledged by the checker.
  const canSend = ws.side !== 'SJVN' || ws.can_make;
  const canAck = ws.side !== 'SJVN' || ws.can_check;
  const twoSided = ws.side === 'SJVN' && ws.contract.has_seller && ws.contract.has_buyer;
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const blank = { notice_type: 'GENERAL', subject: '', body: '', event_date: '', response_due: '', to_side: 'SELLER', reply_to: null, file: null };

  async function submit(e) {
    e.preventDefault();
    if (!(await askConfirm('Send this notice? It cannot be edited or withdrawn once sent.'))) return;
    setBusy(true);
    try {
      const { file, ...body } = form;
      if (file) body.attachment_version_id = await attach(ws.contract.id, file, { type: 'CONTRACT_CORRESPONDENCE', category: 'RECORD', title: `Notice attachment — ${form.subject}` });
      await run(() => api.contractWorkspace.sendNotice(ws.contract.id, body), () => setForm(null));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const byId = Object.fromEntries(ws.notices.map((n) => [n.id, n]));

  return (
    <div>
      <Note>Formal notices under this contract, in both directions. A notice cannot be changed once sent; the side that receives it acknowledges it and may reply.</Note>

      {canSend && !form && <div style={{ marginBottom: 12 }}><button className="btn btn-primary btn-sm" onClick={() => setForm(blank)}>+ Issue a notice</button></div>}

      {form && (
        <form className="cw-form" onSubmit={submit}>
          {form.reply_to && <Note>In reply to {byId[form.reply_to]?.notice_no} — {byId[form.reply_to]?.subject}</Note>}
          <div className="form-grid">
            <Field label="Kind of notice">
              <select value={form.notice_type} onChange={(e) => setForm({ ...form, notice_type: e.target.value })}>
                {Object.entries(meta.notice_types || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            {twoSided && !form.reply_to && (
              <Field label="To">
                <select value={form.to_side} onChange={(e) => setForm({ ...form, to_side: e.target.value })}>
                  <option value="SELLER">The seller</option>
                  <option value="BUYER">The buyer</option>
                </select>
              </Field>
            )}
            <Field label="Date of the event (optional)"><input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></Field>
            <Field label="Reply needed by (optional)"><input type="date" value={form.response_due} onChange={(e) => setForm({ ...form, response_due: e.target.value })} /></Field>
          </div>
          <Field label="Subject" required><input required maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          <Field label="Notice" required><textarea required rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="The notice in full, citing the article of the contract it is given under." /></Field>
          <Field label="Attachment (optional)"><input type="file" onChange={(e) => setForm({ ...form, file: e.target.files[0] })} /></Field>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send notice'}</button></div>
        </form>
      )}

      {ws.notices.length === 0 && !form && <div className="empty-cell" style={{ padding: 24 }}>No notices on this contract.</div>}

      {ws.notices.map((n) => {
        const mine = n.sent_by_side === ws.side;
        const toSide = n.sent_by_side === 'SJVN' ? n.counterparty_side : 'SJVN';
        return (
          <div key={n.id} className="cw-card" style={{ borderLeft: `4px solid ${n.awaiting === ws.side ? '#dc2626' : mine ? '#2563eb' : '#94a3b8'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <strong>{n.subject}</strong>
                <div style={{ fontSize: 15, color: 'var(--slate-500)', marginTop: 2 }}>
                  {n.notice_no} · {meta.notice_types?.[n.notice_type] || n.notice_type} · {SIDE_NAME[n.sent_by_side]} → {SIDE_NAME[toSide]} · {fmtDateTime(n.created_at)} · {n.sent_by_name}
                  {n.parent_notice_id && byId[n.parent_notice_id] ? ` · in reply to ${byId[n.parent_notice_id].notice_no}` : ''}
                </div>
              </div>
              {n.acknowledged_at
                ? <Badge status="ACTIVE" label="Acknowledged" />
                : <Badge status={n.response_overdue ? 'REJECTED' : 'PENDING'} label={n.response_overdue ? 'Reply overdue' : `Awaiting ${SIDE_NAME[n.awaiting]}`} />}
            </div>
            <p style={{ margin: '8px 0', fontSize: 15, whiteSpace: 'pre-wrap' }}>{n.body}</p>
            <div style={{ fontSize: 15, color: 'var(--slate-600)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {n.event_date && <span>Event: {fmtDate(n.event_date)}</span>}
              {n.response_due && <span style={{ color: n.response_overdue ? 'var(--red-deep)' : 'inherit' }}>Reply by: {fmtDate(n.response_due)}</span>}
              {n.acknowledged_at && <span>Acknowledged {fmtDateTime(n.acknowledged_at)} by {n.acknowledged_by_name}</span>}
              {n.attachment_version_id && <button type="button" className="btn-link" onClick={() => onPreview(n.attachment_version_id, n.attachment_name)}>View attachment</button>}
            </div>
            {!mine && (canSend || canAck) && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                {canAck && !n.acknowledged_at && <button className="btn btn-primary btn-sm" onClick={() => run(() => api.contractWorkspace.acknowledgeNotice(n.id))}>Acknowledge receipt</button>}
                {canSend && <button className="btn btn-secondary btn-sm" onClick={() => setForm({ ...blank, reply_to: n.id, notice_type: n.notice_type, subject: /^re:/i.test(n.subject) ? n.subject : `Re: ${n.subject}`, to_side: n.counterparty_side })}>Reply</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function History({ contract, ws }) {
  const versions = contract.versions || [];
  return (
    <div>
      {ws.amendments.length === 0 && versions.length <= 1 && <div className="empty-cell" style={{ padding: 24 }}>This contract has not been amended.</div>}
      {ws.amendments.map((a) => (
        <div key={a.id} className="cw-card">
          <strong>Amendment — version {a.version}</strong>
          <span style={{ marginLeft: 8, fontSize: 15, color: 'var(--slate-500)' }}>{fmtDateTime(a.created_at)}</span>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data-table" style={{ margin: 0 }}>
              <thead><tr><th scope="col">What changed</th><th scope="col">From</th><th scope="col">To</th></tr></thead>
              <tbody>
                {Object.entries(a.changed).map(([field, v]) => {
                  const pair = v && typeof v === 'object' && !Array.isArray(v) ? [v.old ?? v.from ?? v.before, v.new ?? v.to ?? v.after] : [undefined, v];
                  return (
                    <tr key={field}>
                      <td>{field.replace(/_/g, ' ')}</td>
                      <td>{pair[0] === undefined || pair[0] === null ? '—' : String(pair[0])}</td>
                      <td>{pair[1] === undefined || pair[1] === null ? '—' : String(pair[1])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {versions.length > 1 && (
        <>
          <div className="section-title" style={{ marginTop: 18 }}>Versions</div>
          <div className="timeline">
            {versions.map((v) => (
              <div className="timeline-item" key={v.id}>
                {v.contract_no} — v{v.version} <Badge status={v.status} />
                <div className="t-meta">{fmtDateTime(v.created_at)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * @param contract  the contract as api.contracts.get returns it
 * @param onChanged called after anything here changes, so a list behind can refresh
 * @param startTab  which tab to open on
 */
// The chain a month's power and money follow: developer (PPA) → SJVN → DISCOM
// (PSA), with the bills on each leg and their late-payment surcharge and rebate.
// The server decides what this party may see of the other end; the note says it.
function TrailTab({ contract, ws }) {
  const [periods, setPeriods] = useState(null);
  const [period, setPeriod] = useState('');
  useEffect(() => {
    let live = true;
    api.billingTrail.periods(contract.id)
      .then((r) => { if (live) { setPeriods(r.periods || []); setPeriod((r.periods || [])[0] || ''); } })
      .catch(() => { if (live) setPeriods([]); });
    return () => { live = false; };
  }, [contract.id]);

  const seller = contract.contract_type === 'PPA';
  const note = ws.side === 'SJVN'
    ? 'Both ends of the back-to-back chain, with the bills on each leg.'
    : seller
      ? 'Where your power goes and how much, with the bills on your side. The DISCOM\'s tariff, bills and payments, and SJVN\'s margin, are between SJVN and the DISCOM and are not shown here.'
      : 'Whose power you receive, the PPA tariff and SJVN\'s trading margin that make up your tariff, and your own bills with their late-payment surcharge and rebate. The developer\'s bills and payments are not shown.';
  return (
    <div>
      <Note>{note}</Note>
      {periods === null && <div style={{ padding: 16 }}>Loading…</div>}
      {periods && periods.length === 0 && <div style={{ padding: 16, color: 'var(--slate-500)' }}>No month has energy or bills on this contract yet.</div>}
      {periods && periods.length > 0 && (
        <>
          <div style={{ margin: '0 0 12px', maxWidth: 240 }}>
            <Field label="Month">
              <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                {periods.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          {period && <SettlementTrailPanel key={`${contract.id}-${period}`} contractId={contract.id} periodMonth={period} />}
        </>
      )}
    </div>
  );
}

export default function ContractWorkspace({ contract, onChanged, startTab = 'OVERVIEW' }) {
  const [ws, setWs] = useState(null);
  const [meta, setMeta] = useState({});
  const [tab, setTab] = useState(startTab);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [requestDraft, setRequestDraft] = useState(null);

  const load = useCallback(() => api.contractWorkspace.get(contract.id).then(setWs).catch((e) => setError(errText(e))), [contract.id]);

  useEffect(() => {
    load();
    api.contractWorkspace.meta().then(setMeta).catch(() => {});
  }, [load]);

  // Every action is: do it, then read the file again from the server.
  const run = useCallback(async (fn, after) => {
    try {
      await fn();
      setError('');
      after?.();
      await load();
      onChanged?.();
    } catch (e) {
      setError(errText(e));
    }
  }, [load, onChanged]);

  const clearDraft = useCallback(() => setRequestDraft(null), []);

  if (!ws) return <div style={{ padding: 24 }}>{error || 'Loading…'}</div>;

  const a = ws.attention;
  const dot = {
    MILESTONES: a.milestones_delayed + (ws.side === 'SJVN' ? a.milestones_to_confirm : 0),
    GUARANTEE: a.pbg_state === 'EXPIRED' || a.pbg_state === 'EXPIRING' ? 1 : 0,
    REQUESTS: ws.side === 'SJVN' ? a.requests_pending : 0,
    NOTICES: a.notices_awaiting_me,
  };

  return (
    <div>
      <div className="nb-tabs" role="tablist" style={{ flexWrap: 'wrap' }}>
        {TABS.filter(([key]) => (key !== 'GUARANTEE' || ws.guarantee) && (key !== 'MILESTONES' || ws.has_project || ws.milestones.length > 0)).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`nb-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            {label}{dot[key] > 0 && <span className="cw-dot">{dot[key]}</span>}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {tab === 'OVERVIEW' && <Overview contract={contract} ws={ws} go={setTab} />}
      {tab === 'TRAIL' && <TrailTab contract={contract} ws={ws} />}
      {tab === 'DOCUMENTS' && (
        <div>
          <Note>The executed agreement, its annexures and everything else filed against this contract. Open one to read it here, or take the lot as a zip.</Note>
          <DocumentManager moduleName="CONTRACTS" contractId={contract.id} title="Agreement, annexures and filings" onChange={load} />
        </div>
      )}
      {tab === 'MILESTONES' && (
        <Milestones
          ws={ws} meta={meta} run={run}
          raiseExtension={(m) => { setRequestDraft({ request_type: 'MILESTONE_EXTENSION', milestone_id: m.id, requested_date: '', ground: 'FORCE_MAJEURE', subject: '', description: '', file: null }); setTab('REQUESTS'); }}
        />
      )}
      {tab === 'GUARANTEE' && ws.guarantee && <Guarantee ws={ws} run={run} setError={setError} />}
      {tab === 'REQUESTS' && <Requests ws={ws} meta={meta} run={run} setError={setError} draft={requestDraft} clearDraft={clearDraft} onPreview={(id, name) => setPreview({ id, name })} />}
      {tab === 'NOTICES' && <Notices ws={ws} meta={meta} run={run} setError={setError} onPreview={(id, name) => setPreview({ id, name })} />}
      {tab === 'HISTORY' && <History contract={contract} ws={ws} />}

      <PreviewModal open={!!preview} versionId={preview?.id} fileName={preview?.name} onClose={() => setPreview(null)} />
    </div>
  );
}
