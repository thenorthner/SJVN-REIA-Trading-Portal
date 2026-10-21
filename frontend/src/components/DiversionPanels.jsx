import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { Card, Table, Badge, fmtCurrency, fmtNumber } from './ui.jsx';
import { fmtDate } from '../datetime.js';

// SM1: each PSA's default position — overdue against the LC that can cover it;
// diversion for a payment default opens only when the LC cannot.
export function DefaultDashboard({ refresh }) {
  const [d, setD] = useState(null);
  useEffect(() => { api.powerDiversion.defaultDashboard().then(setD).catch(() => setD(null)); }, [refresh]);
  if (!d || !d.rows.length) return null;
  return (
    <Card title={`Buyer default — ${d.totals.in_default} of ${d.totals.psas} PSAs in default`}>
      <Table
        columns={[
          { key: 'contract_no', header: 'PSA', render: (r) => <>{r.contract_no}<div style={{ fontSize: 12.5, color: 'var(--text-light)' }}>{r.buyer_name}</div></> },
          { key: 'overdue', header: 'Overdue', render: (r) => (r.overdue ? <>{fmtCurrency(r.overdue)}<div style={{ fontSize: 12.5 }}>{r.overdue_bills} bill{r.overdue_bills === 1 ? '' : 's'} · since {fmtDate(r.oldest_due)} ({r.days_overdue} days)</div></> : '—') },
          { key: 'lc', header: 'LC to draw', render: (r) => (r.lc_count ? <>{fmtCurrency(r.lc_available)}{r.lc_exhausted && <div style={{ color: 'var(--red-deep)', fontSize: 12.5 }}>exhausted</div>}</> : <span style={{ color: 'var(--amber-strong)' }}>no LC</span>) },
          { key: 'state', header: 'Diversion', render: (r) => (r.in_default ? <Badge type="danger">In default — may divert</Badge> : <Badge type="neutral">Not open</Badge>) },
          { key: 'reason', header: '', render: (r) => <span style={{ fontSize: 13 }}>{r.reason}</span> },
        ]}
        rows={d.rows}
      />
    </Card>
  );
}

// SM5: what diversions came to, per buyer, and where the money went.
export function DiversionPnl({ refresh }) {
  const [p, setP] = useState(null);
  useEffect(() => { api.powerDiversion.pnl().then(setP).catch(() => setP(null)); }, [refresh]);
  if (!p || !p.rows.length) return null;
  return (
    <Card title={`Diversion P&L — net ${fmtCurrency(p.totals.net)}`}>
      <Table
        columns={[
          { key: 'buyer', header: 'Buyer / PSA', render: (r) => <>{r.buyer_name}<div style={{ fontSize: 12.5, color: 'var(--text-light)' }}>{r.contract_no}</div></> },
          { key: 'n', header: 'Diversions', render: (r) => `${r.diversions} · ${fmtNumber(r.quantum_mwh)} MWh` },
          { key: 'sale', header: 'Sale − expenses', render: (r) => `${fmtCurrency(r.sale_amount)} − ${fmtCurrency(r.expenses)}` },
          { key: 'gains', header: 'Gains', render: (r) => <>{fmtCurrency(r.gains)}<div style={{ fontSize: 12.5 }}>{fmtCurrency(r.applied_to_dues)} to dues · {fmtCurrency(r.surplus_to_advance)} to advance</div></> },
          { key: 'deficits', header: 'Deficits', render: (r) => <>{fmtCurrency(r.deficits)}<div style={{ fontSize: 12.5, color: r.deficit_unbilled ? 'var(--amber-strong)' : undefined }}>{fmtCurrency(r.deficit_billed)} billed{r.deficit_unbilled ? ` · ${fmtCurrency(r.deficit_unbilled)} not yet` : ''}</div></> },
          { key: 'net', header: 'Net', render: (r) => <strong>{fmtCurrency(r.net)}</strong> },
        ]}
        rows={p.rows}
      />
    </Card>
  );
}
