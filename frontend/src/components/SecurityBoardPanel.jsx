import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client.js';
import { Card, Table, Badge, AlertPopup, fmtCurrency } from './ui.jsx';
import { fmtDate } from '../datetime.js';

// S1 requirement vs held per contract, with a request to the paying side for
// the gap; S4 revolving LCs drawn on and not yet restored.
export default function SecurityBoardPanel({ canAsk }) {
  const [board, setBoard] = useState(null);
  const [lcs, setLcs] = useState(null);
  const [onlyGaps, setOnlyGaps] = useState(true);
  const [popup, setPopup] = useState(null);
  const busy = useRef(false);
  const load = useCallback(() => {
    api.paymentSecurity.board().then(setBoard).catch(() => setBoard(null));
    api.paymentSecurity.reinstatements().then(setLcs).catch(() => setLcs(null));
  }, []);
  useEffect(load, [load]);

  async function ask(row) {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await api.paymentSecurity.requestShortfall(row.contract_id);
      setPopup({ tone: 'success', title: 'Request sent', message: r.message });
      load();
    } catch (err) {
      setPopup({ title: 'Not sent', message: err.response?.data?.error || err.message });
    } finally { busy.current = false; }
  }

  const rows = (board?.rows || []).filter((r) => !onlyGaps || r.gap_total > 0);
  return (
    <>
      <Card
        title={`Requirement vs held${board ? ` — ${board.totals.with_gap} of ${board.totals.contracts} contracts short, ${fmtCurrency(board.totals.gap)} in all` : ''}`}
        actions={<label style={{ fontSize: 15, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> Only contracts with a gap</label>}
      >
        <Table
          columns={[
            { key: 'contract_no', header: 'Contract', render: (r) => <><strong>{r.contract_no}</strong><div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>{r.counterparty} ({r.paying_side.toLowerCase()})</div></> },
            { key: 'heads', header: 'Required / in force / gap', render: (r) => r.heads.map((h) => (
              <div key={h.head} style={{ fontSize: 15 }}>
                {h.label}: {fmtCurrency(h.required)} / {fmtCurrency(h.held)}
                {h.gap > 0 ? <strong style={{ color: 'var(--red-deep)' }}> / short {fmtCurrency(h.gap)}</strong> : <span style={{ color: 'var(--on-green-2)' }}> ✓</span>}
                {h.unconfirmed > 0 && <span style={{ color: 'var(--amber-strong)' }}> ({fmtCurrency(h.unconfirmed)} not bank-confirmed)</span>}
              </div>
            )) },
            { key: 'exposure', header: 'At risk', render: (r) => <>{fmtCurrency(r.exposure)}<div style={{ fontSize: 14.5 }}>{r.adequate ? <Badge status="ACTIVE" label="Adequate" /> : <Badge status="REJECTED" label="Short" />}</div></> },
            { key: 'ask', header: '', render: (r) => (
              <div>
                {canAsk && r.gap_total > 0 && <button type="button" className="btn btn-primary btn-sm" onClick={() => ask(r)}>Ask the {r.paying_side === 'BUYER' ? 'buyer' : 'seller'}</button>}
                {r.last_requested && <div style={{ fontSize: 14, color: 'var(--text-light)', marginTop: 4 }}>Asked {fmtDate(r.last_requested.created_at)} by {r.last_requested.actor_name}</div>}
              </div>
            ) },
          ]}
          rows={rows}
          emptyMessage={board ? 'Every live contract holds what it requires.' : 'Loading…'}
        />
      </Card>
      {lcs && lcs.rows.length > 0 && (
        <Card title={`Revolving LCs awaiting reinstatement (period ${lcs.window_days} days)`}>
          <Table
            columns={[
              { key: 'instrument_no', header: 'LC', render: (r) => <><strong>{r.instrument_no}</strong><div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>{r.contract_no} · {r.kind === 'BUYER_LC' ? "buyer's LC to SJVN" : "SJVN's LC to the seller"}</div></> },
              { key: 'drawn', header: 'Drawn', render: (r) => `${fmtCurrency(r.drawn)} of ${fmtCurrency(r.limit)}` },
              { key: 'drawn_on', header: 'Drawn on', render: (r) => fmtDate(r.drawn_on) },
              { key: 'days', header: 'Waiting', render: (r) => <span style={{ fontWeight: 600, color: r.overdue ? 'var(--red-deep)' : undefined }}>{r.days_since_draw} days{r.overdue ? ' — late' : ` (by ${fmtDate(r.due_by)})`}</span> },
            ]}
            rows={lcs.rows}
          />
        </Card>
      )}
      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />
    </>
  );
}
