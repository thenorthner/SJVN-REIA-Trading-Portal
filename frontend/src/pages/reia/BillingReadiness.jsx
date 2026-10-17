import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, StatCard, AlertPopup, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

// B5: one row per live REIA contract for a month — energy locked? PPA bill in?
// already billed? — and every ready one raised in one go.
const STATE = { READY: 'Ready', BILLED: 'Billed', WAITING_ENERGY: 'Waiting for energy', BLOCKED: 'Blocked', MONTH_OPEN: 'Month not over' };
const TONE = { READY: 'primary', BILLED: 'success', WAITING_ENERGY: 'warning', BLOCKED: 'danger', MONTH_OPEN: 'neutral' };
const yes = (v) => <span style={{ fontWeight: 600, color: v ? '#15803d' : '#b45309' }}>{v ? '✓' : '✗'}</span>;

export default function BillingReadiness() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.REIA_WRITE.includes(user?.role);
  const [period, setPeriod] = useState('');
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [popup, setPopup] = useState(null);
  const busy = useRef(false);

  const load = useCallback((p) => {
    setLoading(true);
    api.invoices.readiness(p || undefined)
      .then((b) => { setBoard(b); if (!p) setPeriod(b.period); })
      .catch((err) => setPopup({ title: 'Could not load the board', message: err.response?.data?.error || err.message }))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function generateAll() {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await api.invoices.generateReady({ period_month: board.period });
      setPopup({
        tone: r.failed.length ? 'warning' : 'success',
        title: `${r.raised.length} bill${r.raised.length === 1 ? '' : 's'} raised as drafts`,
        message: r.failed.length ? `${r.failed.length} could not be raised — see below.` : 'Each goes for approval under Billing & Invoicing.',
        items: [
          ...r.raised.map((x) => `${x.contract_no}: ${x.invoice_no} — ${fmtCurrency(x.total_amount)}`),
          ...r.failed.map((x) => `${x.contract_no}: not raised — ${x.error}`),
        ],
      });
      load(board.period);
    } catch (err) {
      const d = err.response?.data;
      setPopup({ title: 'Nothing raised', message: d?.error || err.message, items: (d?.failed || []).map((x) => `${x.contract_no}: ${x.error}`) });
    } finally {
      busy.current = false;
    }
  }

  const columns = [
    { key: 'contract_no', header: 'Contract', render: (r) => <span>{r.contract_no} <span style={{ color: 'var(--text-light)' }}>({r.contract_type})</span></span> },
    { key: 'counterparty', header: 'Counterparty', render: (r) => r.counterparty || '—' },
    { key: 'energy', header: 'Energy locked', render: (r) => (
      <span>{yes(r.energy.locked)} {r.energy.energy_mwh != null ? `${fmtNumber(r.energy.energy_mwh)} MWh` : ''}
        {r.energy.detail && r.energy.detail.filter((d) => !d.locked).map((d) => <div key={d.ppa_contract_no} style={{ fontSize: 12.5, color: '#b45309' }}>{d.ppa_contract_no} not locked</div>)}
      </span>
    ) },
    { key: 'ppa_bill_in', header: 'PPA bill in', render: (r) => (
      <span>{yes(r.ppa_bill_in)} {r.ppa_bills.filter((p) => p.invoice_no).map((p) => <div key={p.ppa_contract_no} style={{ fontSize: 12.5 }}>{p.invoice_no}</div>)}</span>
    ) },
    { key: 'billed', header: 'Billed', render: (r) => (r.billed ? <span>{r.billed.invoice_no} <Badge status={r.billed.status} /></span> : '—') },
    { key: 'state', header: 'Standing', render: (r) => (
      <span><Badge type={TONE[r.state]}>{STATE[r.state] || r.state}</Badge>
        {(r.blocker || r.note) && <div style={{ fontSize: 12.5, color: 'var(--text-light)', marginTop: 2 }}>{r.blocker || r.note}</div>}
      </span>
    ) },
  ];

  const t = board?.totals || {};
  return (
    <div>
      <PageHeader
        title="Billing Readiness"
        subtitle="Per contract for the month: energy locked, PPA bill in, already billed — and every ready one raised in one go"
        actions={(
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="month" value={period} max={board?.last_billable_month} onChange={(e) => { setPeriod(e.target.value); load(e.target.value); }} aria-label="Billing month" />
            {canWrite && <button type="button" className="btn btn-primary" disabled={!t.ready} onClick={generateAll}>Generate all ready ({t.ready || 0})</button>}
          </div>
        )}
      />
      {board?.month_open && <div className="inline-note" style={{ marginBottom: 12 }}>{board.period} has not ended; the latest month that can be billed is {board.last_billable_month}.</div>}
      <div className="kpi-grid">
        <StatCard label="Contracts" value={t.contracts ?? 0} />
        <StatCard label="Ready" value={t.ready ?? 0} tone="green" />
        <StatCard label="Billed" value={t.billed ?? 0} />
        <StatCard label="Waiting for energy" value={t.waiting_energy ?? 0} tone="amber" />
        <StatCard label="Blocked" value={t.blocked ?? 0} tone="red" />
      </div>
      <Card>
        <Table columns={columns} rows={loading ? [] : board?.rows || []} emptyMessage={loading ? 'Loading…' : 'No live REIA contract for this month.'} />
        <p className="inline-note">Bills are raised as drafts through the same Generate path, one at a time; open them under <Link to="/reia/invoices">Billing &amp; Invoicing</Link> to check and submit.</p>
      </Card>
      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
