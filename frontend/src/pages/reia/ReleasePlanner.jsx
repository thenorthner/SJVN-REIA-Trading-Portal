import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, StatCard, Field, AlertPopup, fmtCurrency } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// PM4: what the buyers have paid that is each generator's (its energy share,
// no trading margin, no credit notes), what has gone out of it already, and
// what can be released now — so Finance releases in one pass.
export default function ReleasePlanner() {
  const { user } = useAuth();
  const canRelease = ['FINANCE_USER', ...ROLE_GROUPS.REIA_WRITE].includes(user?.role);
  const [p, setP] = useState(null);
  const [form, setForm] = useState(null);
  const [popup, setPopup] = useState(null);
  const busy = useRef(false);
  const load = useCallback(() => { api.invoices.releasePlanner().then(setP).catch((e) => setPopup({ title: 'Could not load', message: e.response?.data?.error || e.message })); }, []);
  useEffect(load, [load]);

  async function release(e) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    try {
      await api.invoices.releaseToGenerator(form.row.invoice_id, { amount: Number(form.amount), source: 'DISCOM_REALIZATION', payment_date: form.date, reference: form.reference });
      setPopup({ tone: 'success', title: 'Released', message: `${fmtCurrency(Number(form.amount))} released on ${form.row.invoice_no}.` });
      setForm(null);
      load();
    } catch (err) {
      setPopup({ title: 'Not released', message: err.response?.data?.error || err.message });
    } finally { busy.current = false; }
  }

  const t = p?.totals || {};
  return (
    <div>
      <PageHeader title="Developer Release Planner" subtitle="Buyer receipts that are the generator's energy share — no margin, no credit notes — against what each developer bill still has open" />
      <div className="kpi-grid">
        <StatCard label="Open on developer bills" value={fmtCurrency(t.open || 0)} />
        <StatCard label="Realised, not released" value={fmtCurrency(t.realized_unreleased || 0)} tone="amber" />
        <StatCard label="Releasable now" value={fmtCurrency(t.releasable_now || 0)} tone="green" />
      </div>
      <Card>
        <Table
          columns={[
            { key: 'invoice_no', header: 'Developer bill', render: (r) => <><strong>{r.invoice_no}</strong><div style={{ fontSize: 13, color: 'var(--text-light)' }}>{r.developer} · {r.contract_no} · {r.billing_period}</div></> },
            { key: 'due', header: 'Due', render: (r) => (r.due_date ? fmtDate(r.due_date) : '—') },
            { key: 'open', header: 'Open', render: (r) => fmtCurrency(r.open) },
            { key: 'realized', header: 'Realised from buyers', render: (r) => <>{fmtCurrency(r.realized)}<div style={{ fontSize: 12.5, color: 'var(--text-light)' }}>{r.linked_psa_bills} PSA bill{r.linked_psa_bills === 1 ? '' : 's'} · {fmtCurrency(r.released)} released</div></> },
            { key: 'now', header: 'Releasable now', render: (r) => (r.blocked ? <span style={{ color: '#b91c1c', fontSize: 13 }}>{r.blocked}</span> : <strong>{fmtCurrency(r.releasable_now)}</strong>) },
            { key: 'act', header: '', render: (r) => (canRelease && r.releasable_now > 0 ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setForm({ row: r, amount: r.releasable_now, date: new Date().toISOString().slice(0, 10), reference: '' })}>Release</button> : null) },
          ]}
          rows={p?.rows || []}
          emptyMessage={p ? 'No developer bill is open.' : 'Loading…'}
        />
      </Card>
      {form && (
        <Card title={`Release on ${form.row.invoice_no}`}>
          <form className="cw-form" onSubmit={release}>
            <div className="form-grid">
              <Field label="Amount (₹)" required><input type="number" required min="1" step="0.01" max={form.row.releasable_now} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
              <Field label="Payment date" required><input type="date" required max={new Date().toISOString().slice(0, 10)} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <Field label="UTR / reference" required><input required minLength={4} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
            </div>
            <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-primary">Release from buyer receipts</button></div>
          </form>
        </Card>
      )}
      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />
    </div>
  );
}
