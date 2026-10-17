import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client.js';
import { Card, Table, Badge, AlertPopup, fmtCurrency } from './ui.jsx';
import { fmtDate } from '../datetime.js';

// DSM1: each current NRPC statement against the register, with the revision
// delta and one click to raise and bill it. DSM4: the pool bills, their
// NRPC due dates, payments (UTR) and the late payment interest running.
const STATE = {
  NOT_RAISED: ['warning', 'Not raised'], REVISION_NOT_RAISED: ['warning', 'Revision not raised'], RAISED_UNBILLED: ['warning', 'Raised, not billed'],
  BILLED: ['primary', 'Billed — delta open'], SETTLED: ['success', 'Billed'],
};

export function DsmStatementSync({ canWrite, onChanged }) {
  const [d, setD] = useState(null);
  const [popup, setPopup] = useState(null);
  const busy = useRef(false);
  const load = useCallback(() => { api.deviation.statementSync().then(setD).catch(() => setD(null)); }, []);
  useEffect(load, [load]);
  async function raise(r) {
    if (busy.current) return;
    busy.current = true;
    try {
      const out = await api.deviation.raiseFromStatement({ dsa_account_id: r.dsa_account_id, contract_id: r.contract_id });
      setPopup({ tone: 'success', title: 'Raised and billed', message: `${out.invoice_no} drafted for week ${r.week_no} — it goes for approval.` });
      load(); onChanged?.();
    } catch (e) { setPopup({ title: 'Not raised', message: e.response?.data?.error || e.message }); } finally { busy.current = false; }
  }
  if (!d || !d.rows.length) return null;
  return (
    <Card title={`NRPC statements against the register — ${d.totals.to_raise} to raise`}>
      <Table
        columns={[
          { key: 'week', header: 'Week', render: (r) => <>{r.financial_year} W{r.week_no}{r.revision ? ` ${r.revision}` : ''}<div style={{ fontSize: 12.5, color: 'var(--text-light)' }}>{fmtDate(r.week_start)} → {fmtDate(r.week_end)}</div></> },
          { key: 'station', header: 'Station', render: (r) => <>{r.entity_name}<div style={{ fontSize: 12.5, color: 'var(--text-light)' }}>{r.contract_no}</div></> },
          { key: 'statement_amount', header: 'Statement', render: (r) => (r.statement_amount == null ? '—' : <span>{fmtCurrency(Math.abs(r.statement_amount))} {r.statement_amount >= 0 ? 'receivable' : 'payable'}</span>) },
          { key: 'billed', header: 'Billed so far', render: (r) => <>{fmtCurrency(Math.abs(r.billed_so_far))}<div style={{ fontSize: 12.5 }}>{r.bills.map((b) => b.invoice_no).join(', ')}</div></> },
          { key: 'delta', header: 'Delta', render: (r) => (r.delta ? <strong style={{ color: '#b45309' }}>{fmtCurrency(Math.abs(r.delta))} {r.delta > 0 ? 'more from the pool' : 'back to the pool'}</strong> : '—') },
          { key: 'state', header: '', render: (r) => (
            <div>
              <Badge type={STATE[r.state]?.[0]}>{STATE[r.state]?.[1] || r.state}</Badge>
              {canWrite && r.delta !== 0 && r.state !== 'BILLED' && <div><button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 4 }} onClick={() => raise(r)}>Raise</button></div>}
            </div>
          ) },
        ]}
        rows={d.rows}
      />
      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />
    </Card>
  );
}

export function DsmPoolTracker() {
  const [t, setT] = useState(null);
  useEffect(() => { api.deviation.poolTracker().then(setT).catch(() => setT(null)); }, []);
  if (!t || !t.rows.length) return null;
  const x = t.totals;
  return (
    <Card title={`NRPC pool — ${fmtCurrency(x.receivable_outstanding)} to come in, ${fmtCurrency(x.payable_outstanding)} to pay · late interest ${t.rate_pct_per_day}% a day`}>
      <Table
        columns={[
          { key: 'invoice_no', header: 'Pool bill', render: (r) => <>{r.invoice_no}<div style={{ fontSize: 12.5, color: 'var(--text-light)' }}>{r.contract_no}{r.week ? ` · ${r.week}` : ''}</div></> },
          { key: 'flow', header: 'Flow', render: (r) => (r.flow === 'RECEIVABLE' ? 'Pool pays SJVN' : 'SJVN pays the pool') },
          { key: 'amount', header: 'Amount', render: (r) => fmtCurrency(r.amount) },
          { key: 'due', header: 'NRPC due', render: (r) => (r.due_date ? fmtDate(r.due_date) : '—') },
          { key: 'paid', header: 'Paid / UTR', render: (r) => <>{fmtCurrency(r.paid)}<div style={{ fontSize: 12.5 }}>{r.utrs.join(', ') || '—'}</div></> },
          { key: 'late', header: 'Late', render: (r) => (r.days_late ? <span style={{ color: '#b91c1c' }}>{r.days_late} days</span> : '—') },
          { key: 'interest', header: 'Interest', render: (r) => (r.late_interest ? fmtCurrency(r.late_interest) : '—') },
        ]}
        rows={t.rows}
      />
    </Card>
  );
}
