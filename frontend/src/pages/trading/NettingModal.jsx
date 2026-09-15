import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Modal, Field, Badge } from '../../components/ui.jsx';

// Set off what a trading client owes against what SJVN owes it, for a month.
//
// This used to be two number boxes — "Total Receivables" and "Total Payables" —
// whose difference was written into the ledger as typed. Both sides come from
// the records now: the client's unpaid issued bills, and the proceeds of its
// Seller exchange contracts. The desk sees exactly what would be set off, and
// against which bills, before it does it.

const rs = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function NettingModal({ open, clients, onClose, onApplied }) {
  const [form, setForm] = useState({ client_id: '', period: '' });
  const [position, setPosition] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ client_id: '', period: '' });
    setPosition(null);
    setError('');
  }, [open]);

  useEffect(() => {
    setPosition(null);
    setError('');
    if (!form.client_id || !/^\d{4}-\d{2}$/.test(form.period)) return undefined;
    let live = true;
    api.billingSettlement.nettingPreview(form)
      .then((p) => { if (live) setPosition(p); })
      .catch((err) => { if (live) setError(err?.response?.data?.error || 'Could not work out the set-off.'); });
    return () => { live = false; };
  }, [form.client_id, form.period]);

  async function apply() {
    setBusy(true);
    setError('');
    try {
      const result = await api.billingSettlement.applyNetting(form);
      onApplied(result);
    } catch (err) {
      setError(err?.response?.data?.error || 'The set-off could not be applied.');
    } finally {
      setBusy(false);
    }
  }

  const canApply = position && !position.already_netted && position.set_off > 0;

  return (
    <Modal open={open} onClose={onClose} title="Set-off / netting" width={640}>
      <div className="form-grid">
        <Field label="Client" required>
          <select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
            <option value="">Select client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Month" required>
          <input type="month" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} />
        </Field>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {position && (
        <>
          {position.already_netted && (
            <div className="alert alert-info" role="status">
              Already netted for {position.period} on {position.already_netted.netted_on}: {rs(position.already_netted.amount)} set off.
            </div>
          )}
          <div className="report-table-wrap" style={{ marginBottom: 12 }}>
            <table className="report-table">
              <thead>
                <tr><th scope="col">Client owes (issued bills)</th><th scope="col">Status</th><th scope="col" className="num">Unpaid</th></tr>
              </thead>
              <tbody>
                {position.receivable.invoices.length === 0 ? (
                  <tr><td className="empty-cell" colSpan={3}>No unpaid issued bill for {position.period}.</td></tr>
                ) : position.receivable.invoices.map((b) => (
                  <tr key={b.invoice_id}>
                    <td>{b.invoice_no}</td>
                    <td><Badge status={b.status} /></td>
                    <td className="num">{rs(b.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {position.receivable.drafts_not_counted > 0 && (
            <p className="report-count">{position.receivable.drafts_not_counted} draft bill(s) not counted — a bill is set off once it has been issued.</p>
          )}
          <div className="report-table-wrap" style={{ marginBottom: 12 }}>
            <table className="report-table">
              <thead>
                <tr><th scope="col">SJVN owes (Seller exchange proceeds)</th><th scope="col" className="num">Cleared MWh</th><th scope="col" className="num">Proceeds less margin</th></tr>
              </thead>
              <tbody>
                {position.payable.contracts.length === 0 ? (
                  <tr><td className="empty-cell" colSpan={3}>No Seller exchange contract cleared anything in {position.period}.</td></tr>
                ) : position.payable.contracts.map((c) => (
                  <tr key={c.contract_id}>
                    <td>{c.loa_no || c.contract_id} · {c.product}</td>
                    <td className="num">{Number(c.cleared_mwh).toLocaleString('en-IN', { maximumFractionDigits: 3 })}</td>
                    <td className="num">{rs(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 13, marginBottom: 8 }}>
            <div>Set off<br /><strong>{rs(position.set_off)}</strong></div>
            <div>Client still owes<br /><strong>{rs(position.after.client_owes)}</strong></div>
            <div>SJVN still owes<br /><strong>{rs(position.after.sjvn_owes)}</strong></div>
          </div>
          <p className="report-count">Not included — {position.not_included}</p>
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
        <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!canApply || busy} onClick={apply}>
          {busy ? 'Setting off…' : position?.set_off > 0 ? `Set off ${rs(position.set_off)}` : 'Set off'}
        </button>
      </div>
    </Modal>
  );
}
