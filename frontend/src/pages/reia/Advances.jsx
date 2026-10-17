import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, AlertPopup, fmtCurrency } from '../../components/ui.jsx';

// Advances / unapplied receipts (decided 17-Oct-2026): money a buyer paid that
// no bill could take — a payment beyond the bill, or a diversion surplus beyond
// its dues. Finance applies it to a later bill of the same buyer, or refunds it.
const SOURCE = { EXCESS_PAYMENT: 'Paid beyond the bill', DIVERSION_SURPLUS: 'Diversion surplus', OTHER: 'Other' };

export default function Advances() {
  const { user } = useAuth();
  const canAct = user?.role === 'FINANCE_USER';
  const [data, setData] = useState({ advances: [], totals: {} });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [mode, setMode] = useState(null);
  const [f, setF] = useState({});
  const [popup, setPopup] = useState(null);
  const busy = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    api.advances.list()
      .then(setData)
      .catch((err) => setPopup({ title: 'Could not load advances', message: err.response?.data?.error || 'The ledger did not load.' }))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  async function show(r) {
    try {
      setOpen(await api.advances.get(r.id));
      setMode(null); setF({});
    } catch (err) {
      setPopup({ title: 'Not opened', message: err.response?.data?.error || err.message });
    }
  }

  async function act(e) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    try {
      if (mode === 'apply') {
        const res = await api.advances.apply(open.id, { invoice_id: f.invoice_id, amount: f.amount || undefined });
        setOpen(await api.advances.get(open.id));
        setPopup({ tone: 'success', title: 'Applied', message: `${res.invoice.invoice_no} is now ${String(res.invoice.status).replace(/_/g, ' ').toLowerCase()}.` });
      } else {
        await api.advances.refund(open.id, { amount: f.amount || undefined, reference: f.reference, note: f.note });
        setOpen(await api.advances.get(open.id));
        setPopup({ tone: 'success', title: 'Refund recorded', message: `The refund on ${open.receipt_no} is recorded.` });
      }
      setMode(null); setF({});
      load();
    } catch (err) {
      setPopup({ title: 'Not done', message: err.response?.data?.error || err.message });
    } finally {
      busy.current = false;
    }
  }

  const columns = [
    { key: 'receipt_no', header: 'Advance No.' },
    { key: 'counterparty', header: 'Counterparty' },
    { key: 'contract_no', header: 'Contract', render: (r) => r.contract_no || '—' },
    { key: 'source', header: 'From', render: (r) => `${SOURCE[r.source] || r.source}${r.source_ref ? ` · ${r.source_ref}` : ''}` },
    { key: 'received_on', header: 'Received' },
    { key: 'amount', header: 'Amount', render: (r) => fmtCurrency(r.amount) },
    { key: 'balance', header: 'Left', render: (r) => fmtCurrency(r.balance) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader title="Advances & Unapplied Receipts" subtitle="Money received that no bill could take — applied to a later bill of the same counterparty, or refunded" />
      <div className="kpi-grid">
        <StatCard label="Open advances" value={data.totals?.open_count ?? 0} />
        <StatCard label="Held for counterparties" value={fmtCurrency(data.totals?.open_balance || 0)} tone="amber" />
      </div>
      <Card>
        <Table columns={columns} rows={loading ? [] : data.advances} onRowClick={show} emptyMessage={loading ? 'Loading…' : 'No advances held.'} />
      </Card>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.receipt_no} — ${open.counterparty}` : ''} width={620}>
        {open && (
          <div>
            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Received</span><span className="detail-value">{fmtCurrency(open.amount)} on {open.received_on}{open.reference ? ` · ${open.reference}` : ''}</span></div>
              <div className="detail-item"><span className="detail-label">Left</span><span className="detail-value">{fmtCurrency(open.balance)}</span></div>
              <div className="detail-item"><span className="detail-label">From</span><span className="detail-value">{SOURCE[open.source] || open.source}{open.source_ref ? ` · ${open.source_ref}` : ''}</span></div>
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={open.status} /></span></div>
            </div>
            {canAct && open.status === 'OPEN' && !mode && (
              <div className="cell-actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={!open.open_bills?.length} onClick={() => { setMode('apply'); setF({ invoice_id: open.open_bills?.[0]?.id || '' }); }}>Apply to a bill</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode('refund'); setF({}); }}>Refund</button>
              </div>
            )}
            {mode && (
              <form className="cw-form" onSubmit={act}>
                {mode === 'apply' ? (
                  <div className="form-grid">
                    <Field label="Bill" required>
                      <select required value={f.invoice_id || ''} onChange={(e) => setF({ ...f, invoice_id: e.target.value })}>
                        {open.open_bills.map((b) => <option key={b.id} value={b.id}>{b.invoice_no} · {b.billing_period} · {fmtCurrency(b.total_amount)}</option>)}
                      </select>
                    </Field>
                    <Field label="Amount (blank = as much as both allow)"><input type="number" min="1" step="0.01" max={open.balance} value={f.amount || ''} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
                  </div>
                ) : (
                  <div className="form-grid">
                    <Field label="Amount (blank = all that is left)"><input type="number" min="1" step="0.01" max={open.balance} value={f.amount || ''} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
                    <Field label="Refund UTR" required><input required minLength={4} value={f.reference || ''} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
                    <Field label="Why refunded, not applied" required><input required value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
                  </div>
                )}
                <div className="form-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">{mode === 'apply' ? 'Apply' : 'Record refund'}</button>
                </div>
              </form>
            )}
            {open.events?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 16 }}>History</div>
                <div className="timeline">
                  {open.events.map((ev) => (
                    <div className="timeline-item" key={ev.id}>
                      <strong>{ev.event_type.charAt(0) + ev.event_type.slice(1).toLowerCase()}</strong> {fmtCurrency(ev.amount)}
                      {ev.invoice_no ? ` to ${ev.invoice_no}` : ''}{ev.reference ? ` · ${ev.reference}` : ''}{ev.note ? ` · ${ev.note}` : ''}
                      <div className="t-meta">{ev.actor_name || '—'} · {ev.created_at}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />
    </div>
  );
}
