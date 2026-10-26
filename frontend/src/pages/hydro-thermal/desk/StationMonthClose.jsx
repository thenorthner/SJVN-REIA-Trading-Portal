import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import { pathFor, deskLabel } from '../../../lib/stationVertical.js';
import { PageHeader, Card, Table, Badge, StatCard, AlertPopup, fmtCurrency } from '../../../components/ui.jsx';

const kwhToMu = (v) => (v == null ? '—' : `${(Number(v) / 1e6).toLocaleString('en-IN', { maximumFractionDigits: 2 })} MU`);

// One month, station by station: REA in, bill drafted, approved, issued,
// despatched and booked — and what is still open before Finance books it.
export default function StationMonthClose({ vertical = 'HYDRO' }) {
  const [period, setPeriod] = useState('');
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [popup, setPopup] = useState(null);

  const load = useCallback((p) => {
    setLoading(true);
    api.hydroDesk.monthClose({ vertical, period: p || undefined })
      .then((b) => { setBoard(b); if (!p) setPeriod(b.period); })
      .catch((e) => setPopup({ title: 'Could not load the board', message: e.response?.data?.error || e.message }))
      .finally(() => setLoading(false));
  }, [vertical]);
  useEffect(() => { load(); }, [load]);

  const linkTo = (key) => {
    const to = pathFor(vertical, key);
    return to || pathFor(vertical, 'billing');
  };
  const t = board?.totals || {};

  return (
    <div>
      <PageHeader
        title="Month-Close Board"
        subtitle={`Every ${deskLabel(vertical).toLowerCase()} station for one month — REA in, bill drafted, approved, issued, despatched and booked to Finance — and what is still open before the month is closed`}
        actions={(
          <input type="month" value={period} max={board?.last_closed_month} onChange={(e) => { setPeriod(e.target.value); load(e.target.value); }} aria-label="Billing month" />
        )}
      />
      {board?.month_open && <div className="inline-note" style={{ marginBottom: 12 }}>{board.period} has not ended; the latest month that can be closed is {board.last_closed_month}.</div>}

      <div className="kpi-grid">
        <StatCard label="Stations" value={t.stations ?? 0} />
        <StatCard label="Not billed" value={t.not_billed ?? 0} tone={t.not_billed ? 'amber' : 'default'} />
        <StatCard label="In draft / approval" value={t.in_progress ?? 0} tone={t.in_progress ? 'amber' : 'default'} />
        <StatCard label="Issued" value={t.issued ?? 0} tone="blue" />
        <StatCard label="Booked to Finance" value={t.booked ?? 0} tone="green" />
        <StatCard label="Billed for the month" value={fmtCurrency(t.billed_amount || 0)} />
      </div>

      <Card title="Stations">
        <Table
          columns={[
            { key: 'station_name', header: 'Station', render: (r) => <span>{r.station_name}<div style={{ fontSize: 14, color: 'var(--text-light)' }}>{r.contract_no}</div></span> },
            { key: 'energy', header: 'REA / energy', render: (r) => (r.energy.in
              ? <span>{kwhToMu(r.energy.saleable_kwh)}<div style={{ fontSize: 14, color: 'var(--text-light)' }}>{r.energy.rea_reference || 'REA on file'}{r.energy.pafm_pct != null ? ` · PAFM ${r.energy.pafm_pct}%` : ''}</div></span>
              : <span style={{ color: 'var(--amber-strong)' }}>Not in yet</span>) },
            { key: 'bill', header: 'Month bill', render: (r) => (r.bill
              ? <span>{r.bill.bill_no} <span style={{ color: 'var(--text-light)', fontSize: 14 }}>({r.bill.bill_kind.toLowerCase()})</span><div style={{ fontSize: 14 }}>{fmtCurrency(r.bill.total)}</div></span>
              : '—') },
            { key: 'others', header: 'Other bills', render: (r) => (r.other_bills.length
              ? r.other_bills.map((b) => <div key={b.bill_no} style={{ fontSize: 14 }}>{b.bill_no} · {b.bill_kind.toLowerCase()} <Badge status={b.status} /></div>)
              : '—') },
            { key: 'fi', header: 'Finance', render: (r) => (r.fi ? <span>{r.fi.posting_no} <Badge status={r.fi.status} /></span> : '—') },
            { key: 'stage', header: 'Standing', render: (r) => (
              <span><Badge type={r.tone}>{r.stage_label}</Badge>
                {r.next_step && <div style={{ fontSize: 14, color: 'var(--text-light)', marginTop: 2 }}>{r.next_step}</div>}
              </span>
            ) },
            { key: 'go', header: '', render: (r) => (r.next_step
              ? <Link className="btn btn-secondary btn-sm" to={r.stage === 'DESPATCHED' ? linkTo('finance') : linkTo('billing')}>Open</Link>
              : null) },
          ]}
          rows={loading ? [] : (board?.rows || []).map((r) => ({ ...r, id: r.contract_id }))}
          emptyMessage={loading ? 'Loading…' : `No ${deskLabel(vertical).toLowerCase()} station is on the platform.`}
        />
      </Card>

      {board && (
        <Card title={board.checklist.clear
          ? `Close checklist — nothing holding ${board.period}`
          : `Close checklist — ${board.checklist.open_items} item${board.checklist.open_items === 1 ? '' : 's'} holding ${board.period}`}
        >
          {board.checklist.items.map((i) => (
            <div key={i.key} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 600, color: i.clear ? 'var(--on-green-2)' : (i.blocking ? 'var(--amber-strong)' : 'var(--text)') }}>
                  {i.clear ? '✓' : (i.blocking ? '✗' : '•')} {i.label}
                  {!i.clear && i.key !== 'advances' && i.key !== 'lps' ? ` — ${i.count}` : ''}
                  {!i.clear && i.amount ? `, ${fmtCurrency(i.amount)}` : ''}
                  {!i.blocking && !i.clear && <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--text-light)' }}> (disclose, does not hold the close)</span>}
                </div>
                {!i.clear && (i.refs?.length > 0 || i.hint) && (
                  <div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>
                    {i.refs.slice(0, 6).join(', ')}{i.refs.length > 6 ? ` and ${i.refs.length - 6} more` : ''}{i.hint ? `${i.refs.length ? ' · ' : ''}${i.hint}` : ''}
                  </div>
                )}
              </div>
              {!i.clear && <Link className="btn btn-outline btn-sm" to={linkTo(i.link)}>Go</Link>}
            </div>
          ))}
        </Card>
      )}

      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />
    </div>
  );
}
