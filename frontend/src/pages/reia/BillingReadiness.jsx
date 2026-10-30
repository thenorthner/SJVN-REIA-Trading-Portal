import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, StatCard, AlertPopup, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import { actsAs } from '../../lib/rolePages.js';

// B5: one row per live REIA contract for a month — energy locked? PPA bill in?
// already billed? — and every ready one raised in one go.
const STATE = { READY: 'Ready', BILLED: 'Billed', WAITING_ENERGY: 'Waiting for energy', BLOCKED: 'Blocked', MONTH_OPEN: 'Month not over' };
const TONE = { READY: 'primary', BILLED: 'success', WAITING_ENERGY: 'warning', BLOCKED: 'danger', MONTH_OPEN: 'neutral' };
const yes = (v) => <span style={{ fontWeight: 600, color: v ? 'var(--on-green-2)' : 'var(--amber-strong)' }}>{v ? '✓' : '✗'}</span>;

export default function BillingReadiness() {
  const { user } = useAuth();
  // Generating ready bills, running statements and raising LPS bills are the maker's (Phase B.2).
  const canWrite = actsAs(user, ROLE_GROUPS.REIA_MAKE);
  const [period, setPeriod] = useState('');
  const [board, setBoard] = useState(null);
  const [close, setClose] = useState(null);
  const [lps, setLps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [popup, setPopup] = useState(null);
  const busy = useRef(false);

  const load = useCallback((p) => {
    setLoading(true);
    api.invoices.monthClose(p || undefined)
      .then((m) => {
        setClose(m); setBoard(m.billing); if (!p) setPeriod(m.period);
        if (!m.month_open) api.invoices.lpsPreview(m.period).then(setLps).catch(() => setLps(null)); else setLps(null);
      })
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

  async function act(fn, title) {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await fn();
      setPopup({ tone: 'success', title, message: r?.message || '', items: r?.items });
      load(board.period);
    } catch (err) {
      setPopup({ title: 'Not done', message: err.response?.data?.error || err.message, items: err.response?.data?.missing });
    } finally { busy.current = false; }
  }

  const columns = [
    { key: 'contract_no', header: 'Contract', render: (r) => <span>{r.contract_no} <span style={{ color: 'var(--text-light)' }}>({r.contract_type})</span></span> },
    { key: 'counterparty', header: 'Counterparty', render: (r) => r.counterparty || '—' },
    { key: 'energy', header: 'Energy locked', render: (r) => (
      <span>{yes(r.energy.locked)} {r.energy.energy_mwh != null ? `${fmtNumber(r.energy.energy_mwh)} MWh` : ''}
        {r.energy.detail && r.energy.detail.filter((d) => !d.locked).map((d) => <div key={d.ppa_contract_no} style={{ fontSize: 14, color: 'var(--amber-strong)' }}>{d.ppa_contract_no} not locked</div>)}
      </span>
    ) },
    { key: 'ppa_bill_in', header: 'PPA bill in', render: (r) => (
      <span>{yes(r.ppa_bill_in)} {r.ppa_bills.filter((p) => p.invoice_no).map((p) => <div key={p.ppa_contract_no} style={{ fontSize: 14 }}>{p.invoice_no}</div>)}</span>
    ) },
    { key: 'billed', header: 'Billed', render: (r) => (r.billed ? <span>{r.billed.invoice_no} <Badge status={r.billed.status} /></span> : '—') },
    { key: 'state', header: 'Standing', render: (r) => (
      <span><Badge type={TONE[r.state]}>{STATE[r.state] || r.state}</Badge>
        {(r.blocker || r.note) && <div style={{ fontSize: 14, color: 'var(--text-light)', marginTop: 2 }}>{r.blocker || r.note}</div>}
      </span>
    ) },
  ];

  const t = board?.totals || {};
  return (
    <div>
      <PageHeader
        title="Month-Close Board"
        subtitle="One month, closed in order: energy locked and billed, statements reconciled, surcharge billed, and the open items Finance should see before it books the month"
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
      {close && (
        <Card title={`Reconciliation — ${close.reconciliation.totals.closed} closed, ${close.reconciliation.totals.statements} raised, ${close.reconciliation.totals.ready} ready to run, ${close.reconciliation.totals.waiting} waiting`}>
          <Table
            columns={[
              { key: 'contract_no', header: 'Contract', render: (r) => <span>{r.contract_no} <span style={{ color: 'var(--text-light)' }}>({r.contract_type})</span></span> },
              { key: 'ready', header: 'Month closed', render: (r) => (r.ready ? yes(true) : <span style={{ color: 'var(--amber-strong)', fontSize: 14.5 }}>✗ {r.missing.join('; ')}</span>) },
              { key: 'statement', header: 'Statement', render: (r) => (r.statement ? <span>{r.statement.recon_no} <Badge status={r.statement.status} /></span> : '—') },
              { key: 'run', header: '', render: (r) => (canWrite && r.ready && !r.statement ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(async () => { const x = await api.reconciliation.run({ contract_id: r.contract_id, period: close.period, scope: 'REIA_CONTRACT' }); return { message: `${x.recon_no} raised.` }; }, 'Reconciliation run')}>Run</button>
              ) : null) },
            ]}
            rows={close.reconciliation.rows}
          />
          <p className="inline-note">A month is reconciled once its energy is locked and its bill presented.</p>
        </Card>
      )}
      {lps && (
        <Card title={`Late payment surcharge for ${lps.period} — ${fmtCurrency(lps.total)} to bill`}
          actions={canWrite && lps.total > 0 ? <button type="button" className="btn btn-primary btn-sm" onClick={() => act(async () => { const r = await api.invoices.raiseLpsBills({ period_month: lps.period }); return { message: 'Raised as drafts for approval.', items: r.raised.map((x) => `${x.contract_no}: ${x.invoice_no} — ${fmtCurrency(x.total)}`) }; }, 'LPS bills raised')}>Raise LPS bills</button> : null}>
          <Table
            columns={[
              { key: 'contract_no', header: 'PSA', render: (r) => <>{r.contract_no}<div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>{r.buyer}</div></> },
              { key: 'lines', header: 'Overdue bills', render: (r) => r.lines.map((l) => <div key={l.invoice_id} style={{ fontSize: 14.5 }}>{l.invoice_no}: {l.days_overdue} days — {fmtCurrency(l.amount)}</div>) },
              { key: 'total', header: 'Surcharge', render: (r) => (r.existing ? <span>{r.existing.invoice_no} <Badge status={r.existing.status} /></span> : fmtCurrency(r.total)) },
            ]}
            rows={lps.rows}
            emptyMessage="No overdue bill has earned surcharge that is not yet billed."
          />
          <p className="inline-note">Electricity (Late Payment Surcharge) Rules, 2022: calendar days past the due date, base rate rising 0.5% a month to 3% above it. Each bill's surcharge is billed once; cancelling an LPS bill gives it back.</p>
        </Card>
      )}
      {close && (
        <Card title={close.posting.clear ? 'Posting checklist — nothing open' : `Posting checklist — ${close.posting.open_items} open item${close.posting.open_items === 1 ? '' : 's'} before Finance books ${close.period}`}>
          {close.posting.items.map((i) => (
            <div key={i.key} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, color: i.clear ? 'var(--on-green-2)' : 'var(--amber-strong)' }}>{i.clear ? '✓' : '✗'} {i.label}{!i.clear ? ` — ${i.count}${i.amount != null ? `, ${fmtCurrency(i.amount)}` : ''}` : ''}</div>
              {!i.clear && (
                <div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>
                  {i.rows.slice(0, 6).map((r) => r.invoice_no || r.contract_no || r.dispute_no || r.receipt_no).filter(Boolean).join(', ')}{i.count > 6 ? ` and ${i.count - 6} more` : ''}{i.hint ? ` · ${i.hint}` : ''}
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
