import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';
import { Badge, Field, fmtCurrency } from '../../components/ui.jsx';

// Debit and credit notes on one invoice.
//
// A note is raised as a DRAFT and changes nothing until a second person
// approves it. On approval a debit note becomes its own supplementary bill
// (numbered as the note, with its own due date); a credit note is set against
// this bill as a deduction, and any part the bill cannot absorb stays on the
// note to apply to another open bill of the same contract. The invoice as
// issued is never rewritten. Notes from before this (LEGACY) were folded into
// the invoice total and still read that way.

const REASONS = [
  ['REVISED_REA', 'Revised / amended REA'],
  ['CHANGE_IN_LAW', 'Change in Law'],
  ['TRANSMISSION_CHARGES', 'Transmission / wheeling charges'],
  ['LPS', 'Late Payment Surcharge'],
  ['COMPENSATION_EVENT', 'Compensation event'],
  ['LIQUIDATED_DAMAGES', 'Liquidated damages'],
  ['OTHER', 'Other'],
];
const EMPTY = { note_type: 'DEBIT', taxable_amount: '', tax_amount: '', tax_label: '', reason_code: 'REVISED_REA', reason: '' };
const STATUS_TONE = { DRAFT: 'PENDING', ISSUED: 'ACTIVE', SETTLED: 'APPROVED', CANCELLED: 'CANCELLED', REJECTED: 'REJECTED' };

export function isOwnNote(note, user) {
  if (!note || !user) return false;
  return note.created_by_id ? note.created_by_id === user.id : note.created_by === user.name;
}

export default function NotesPanel({ invoice, user, canWrite, onChanged }) {
  const [notes, setNotes] = useState([]);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(null);
  const [openBills, setOpenBills] = useState([]);
  const [target, setTarget] = useState('');

  const load = useCallback(() => {
    api.notes.list({ invoice_id: invoice.id }).then((r) => setNotes(r || [])).catch(() => setNotes([]));
  }, [invoice.id]);
  useEffect(load, [load]);

  async function act(fn) {
    setErr(''); setBusy(true);
    try {
      await fn();
      load();
      onChanged?.();
      return true;
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    const ok = await act(() => api.notes.create({
      ...form,
      invoice_id: invoice.id,
      taxable_amount: Number(form.taxable_amount),
      tax_amount: Number(form.tax_amount || 0),
    }));
    if (ok) setForm(null);
  }

  async function startApply(note) {
    setApplying(note); setTarget('');
    const list = await api.invoices.list({ contract_id: invoice.contract_id }).catch(() => []);
    const rows = Array.isArray(list) ? list : (list?.rows || list?.data || []);
    setOpenBills(rows.filter((b) => b.id !== invoice.id && b.direction === invoice.direction
      && !['DRAFT', 'CANCELLED', 'PAID'].includes(b.status)));
  }

  async function downloadPdf(note) {
    const blob = await api.notes.downloadPdf(note.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${note.note_no.replace(/\//g, '-')}.pdf`; a.click();
    URL.revokeObjectURL(url);
  }

  const total = Number(form?.taxable_amount || 0) + Number(form?.tax_amount || 0);

  return (
    <>
      <div className="section-title" style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Debit / Credit Notes</span>
        {canWrite && (
          <button type="button" className="btn btn-xs btn-outline" onClick={() => { setForm(form ? null : { ...EMPTY }); setErr(''); }}>
            {form ? 'Close' : '+ Raise Note'}
          </button>
        )}
      </div>

      {err && <div className="form-error">{err}</div>}

      {notes.length > 0 ? (
        <table className="data-table" style={{ width: '100%', fontSize: 13, marginBottom: 8 }}>
          <thead>
            <tr><th>Note</th><th>Type</th><th>Reason</th><th className="text-right">Amount</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {notes.map((n) => {
              const status = n.effective_status || n.status;
              const mine = isOwnNote(n, user);
              return (
                <tr key={n.id} style={{ opacity: ['CANCELLED', 'REJECTED'].includes(n.status) ? 0.5 : 1 }}>
                  <td>
                    <strong>{n.status === 'DRAFT' ? 'Draft' : n.note_no}</strong>
                    {n.model === 'LEGACY' && <div className="inline-note">folded into this invoice (before approvals)</div>}
                    {n.supplementary_invoice && (
                      <div className="inline-note">billed as {n.supplementary_invoice.invoice_no}, due {n.supplementary_invoice.due_date}</div>
                    )}
                    {n.credit_applications?.length > 0 && (
                      <div className="inline-note">
                        applied: {n.credit_applications.map((a) => `${a.invoice_no} ${fmtCurrency(a.amount)}`).join(', ')}
                      </div>
                    )}
                  </td>
                  <td><Badge status={n.note_type === 'DEBIT' ? 'PENDING' : 'ACTIVE'} label={n.note_type} /></td>
                  <td title={n.reason || ''}>{n.reason_label || n.reason_code}</td>
                  <td className="text-right mono" style={{ color: n.note_type === 'DEBIT' ? 'var(--red)' : 'var(--green)' }}>
                    {n.note_type === 'DEBIT' ? '+' : '−'}{fmtCurrency(n.amount)}
                    {Number(n.tax_amount) > 0 && <div className="inline-note">incl. {n.tax_label || 'tax'} {fmtCurrency(n.tax_amount)}</div>}
                    {n.unapplied_credit > 0 && <div className="inline-note">{fmtCurrency(n.unapplied_credit)} unapplied</div>}
                  </td>
                  <td>
                    <Badge status={STATUS_TONE[status]} label={status} />
                    <div className="inline-note">
                      {n.status === 'DRAFT' ? `raised by ${n.created_by}` : n.approved_by ? `${n.status === 'REJECTED' ? 'rejected' : 'approved'} by ${n.approved_by}` : ''}
                    </div>
                    {n.rejected_reason && <div className="inline-note">{n.rejected_reason}</div>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {canWrite && n.status === 'DRAFT' && !mine && (
                      <>
                        <button type="button" className="btn btn-xs btn-primary" disabled={busy}
                          onClick={() => act(() => api.notes.approve(n.id))}>Approve</button>{' '}
                        <button type="button" className="btn btn-xs btn-ghost" disabled={busy}
                          onClick={() => {
                            const reason = window.prompt('Why is this note rejected?');
                            if (reason) act(() => api.notes.reject(n.id, reason));
                          }}>Reject</button>
                      </>
                    )}
                    {canWrite && n.status === 'DRAFT' && mine && <span className="inline-note">awaiting another approver</span>}
                    {['ISSUED', 'SETTLED'].includes(n.status) && (
                      <button type="button" className="btn btn-xs btn-ghost" onClick={() => downloadPdf(n)}>PDF</button>
                    )}
                    {canWrite && n.unapplied_credit > 0 && (
                      <button type="button" className="btn btn-xs btn-ghost" onClick={() => startApply(n)}>Apply credit</button>
                    )}
                    {canWrite && !['CANCELLED', 'REJECTED'].includes(n.status) && (
                      <button type="button" className="btn btn-xs btn-ghost" disabled={busy}
                        onClick={() => {
                          const reason = window.prompt(n.status === 'DRAFT'
                            ? 'Withdraw this draft? Say why:'
                            : 'Cancel this issued note? Its effect is reversed. Say why:');
                          if (reason) act(() => api.notes.cancel(n.id, reason));
                        }}>Cancel</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="inline-note" style={{ marginTop: 4 }}>No debit/credit notes on this invoice.</p>}

      {applying && (
        <div className="card" style={{ padding: 12, marginBottom: 8 }}>
          <strong>Apply {fmtCurrency(applying.unapplied_credit)} of {applying.note_no} to another bill</strong>
          {openBills.length ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose an open bill of this contract…</option>
                {openBills.map((b) => <option key={b.id} value={b.id}>{b.invoice_no} — {b.billing_period} — {fmtCurrency(b.total_amount)}</option>)}
              </select>
              <button type="button" className="btn btn-xs btn-primary" disabled={!target || busy}
                onClick={async () => { if (await act(() => api.notes.apply(applying.id, target))) setApplying(null); }}>Apply</button>
              <button type="button" className="btn btn-xs btn-ghost" onClick={() => setApplying(null)}>Close</button>
            </div>
          ) : (
            <p className="inline-note">No other open bill on this contract to apply it to. <button type="button" className="btn-link" onClick={() => setApplying(null)}>Close</button></p>
          )}
        </div>
      )}

      {form && (
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="Type">
              <select value={form.note_type} onChange={(e) => setForm({ ...form, note_type: e.target.value })}>
                <option value="DEBIT">Debit note — the party owes more</option>
                <option value="CREDIT">Credit note — the party owes less</option>
              </select>
            </Field>
            <Field label="Reason code">
              <select value={form.reason_code} onChange={(e) => setForm({ ...form, reason_code: e.target.value })}>
                {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Taxable value (₹)">
              <input required type="number" step="0.01" min="0.01" value={form.taxable_amount}
                onChange={(e) => setForm({ ...form, taxable_amount: e.target.value })} />
            </Field>
            <Field label="Tax on the note (₹)">
              <input type="number" step="0.01" min="0" value={form.tax_amount} placeholder="0 if none"
                onChange={(e) => setForm({ ...form, tax_amount: e.target.value })} />
            </Field>
            <Field label="Tax label">
              <input value={form.tax_label} placeholder="e.g. IGST 18%" onChange={(e) => setForm({ ...form, tax_label: e.target.value })} />
            </Field>
            <Field label="What the note is for (printed on it)">
              <input required minLength={5} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </Field>
          </div>
          <p className="inline-note">
            Total {fmtCurrency(total)}. Saved as a draft; it takes effect only when someone else approves it.
            {form.note_type === 'DEBIT'
              ? ' A debit note is then billed as its own supplementary invoice, payable from its own due date.'
              : ' A credit note is then set against this invoice; anything it cannot absorb stays available for another bill of the contract.'}
          </p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save as draft'}</button>
          </div>
        </form>
      )}
    </>
  );
}
