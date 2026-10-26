import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import { pathFor, deskLabel } from '../../../lib/stationVertical.js';
import { PageHeader, Card, Table, Badge, StatCard, AlertPopup, fmtCurrency } from '../../../components/ui.jsx';

const mu = (mwh) => (mwh == null ? '—' : (Number(mwh) / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const muKwh = (kwh) => (kwh == null ? '—' : (Number(kwh) / 1e6).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const FLAG_TONE = { MISMATCH: 'danger', NOT_BILLED: 'warning', FINAL_NOT_BILLED: 'warning', FINAL_AWAITED: 'neutral', NO_REA: 'warning' };

function fyOptions() {
  const now = new Date();
  const start = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return [0, 1, 2, 3].map((i) => `${start - i}-${start - i + 1}`);
}

// Which REA each month was billed on, provisional against final, and whether
// each bill still agrees with the REA it was drawn from.
export default function StationReaRegister({ vertical = 'HYDRO' }) {
  const [fy, setFy] = useState('');
  const [data, setData] = useState(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [popup, setPopup] = useState(null);

  const load = useCallback((year) => {
    api.hydroDesk.reaRegister({ vertical, fy: year || undefined })
      .then((d) => { setData(d); if (!year) setFy(d.fy); })
      .catch((e) => setPopup({ title: 'Could not load', message: e.response?.data?.error || e.message }));
  }, [vertical]);
  useEffect(() => { load(); }, [load]);

  const t = data?.totals || {};
  const billLink = pathFor(vertical, 'billing');
  const billCell = (b) => (b
    ? <span>{b.bill_no} <Badge status={b.status} /><div style={{ fontSize: 14, color: 'var(--text-light)' }}>{muKwh(b.saleable_kwh)} MU saleable · {fmtCurrency(b.total)}</div></span>
    : '—');
  const reaCell = (r, fetch) => (r
    ? <span>{mu(r.energy_mwh)} MU<div style={{ fontSize: 14, color: 'var(--text-light)' }}>free {mu(r.free_mwh)} · PAF {r.paf ?? '—'}%</div></span>
    : <span style={{ color: 'var(--text-light)' }}>{fetch ? `fetch ${fetch.toLowerCase()}` : 'not in'}</span>);

  return (
    <div>
      <PageHeader
        title="REA Register & Validation"
        subtitle={`Month by month for each ${deskLabel(vertical).toLowerCase()} station: the provisional and final Regional Energy Account, the bills drawn on each, how far the final moved from the provisional, and any bill that no longer agrees with its REA`}
        actions={(
          <select value={fy} onChange={(e) => { setFy(e.target.value); load(e.target.value); }} aria-label="Financial year">
            {[...new Set([fy, ...fyOptions()].filter(Boolean))].map((y) => <option key={y} value={y}>FY {y}</option>)}
          </select>
        )}
      />
      <div className="kpi-grid">
        <StatCard label="Station-months" value={t.months ?? 0} />
        <StatCard label="Final REA in" value={t.final_in ?? 0} tone="green" />
        <StatCard label="Bill ≠ REA" value={t.mismatches ?? 0} tone={t.mismatches ? 'red' : 'default'} onClick={() => setOnlyFlagged(true)} />
        <StatCard label="REA in, not billed" value={t.not_billed ?? 0} tone={t.not_billed ? 'amber' : 'default'} onClick={() => setOnlyFlagged(true)} />
        <StatCard label={`Final awaited > ${data?.final_rea_expected_days || 90} days`} value={t.final_awaited ?? 0} tone={t.final_awaited ? 'amber' : 'default'} onClick={() => setOnlyFlagged(true)} />
      </div>
      <div className="filters-bar">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14.5 }}>
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Only months with something to act on
        </label>
      </div>

      {(data?.stations || []).map((s) => (
        <Card key={s.contract_id} title={s.station_name}>
          <Table
            columns={[
              { key: 'month', header: 'Month', render: (r) => monthName(r.month) },
              { key: 'prea', header: 'Provisional REA', render: (r) => reaCell(r.provisional_rea, r.provisional_fetch) },
              { key: 'pbill', header: 'Provisional bill', render: (r) => billCell(r.provisional_bill) },
              { key: 'frea', header: 'Final REA', render: (r) => reaCell(r.final_rea, r.final_fetch) },
              { key: 'fbill', header: 'Final bill', render: (r) => billCell(r.final_bill) },
              { key: 'move', header: 'Final vs provisional', render: (r) => (r.final_vs_provisional_kwh != null
                ? <span>{muKwh(r.final_vs_provisional_kwh)} MU<div style={{ fontSize: 14, color: r.final_vs_provisional_amount < 0 ? 'var(--red-deep)' : 'var(--text-light)' }}>{fmtCurrency(r.final_vs_provisional_amount)}</div></span>
                : '—') },
              { key: 'rev', header: 'Revisions', render: (r) => (r.revisions ? `${r.revisions} · ${fmtCurrency(r.revision_amount)}` : '—') },
              { key: 'flags', header: 'Check', render: (r) => (r.flags.length
                ? r.flags.map((f) => <div key={f.code} style={{ marginBottom: 2 }}><Badge type={FLAG_TONE[f.code]}>{f.text}</Badge></div>)
                : <Badge type="success">Agrees</Badge>) },
              { key: 'go', header: '', render: (r) => (r.flags.some((f) => f.code !== 'FINAL_AWAITED') ? <Link className="btn btn-secondary btn-sm" to={billLink}>Open</Link> : null) },
            ]}
            rows={s.rows.filter((r) => !onlyFlagged || r.flags.length).map((r) => ({ ...r, id: r.month }))}
            emptyMessage={onlyFlagged ? 'Nothing to act on for this station.' : 'No month of this year has ended yet.'}
          />
        </Card>
      ))}
      {data && !data.stations.length && <Card><p className="inline-note">No {deskLabel(vertical).toLowerCase()} station is on the platform.</p></Card>}
      <p className="inline-note">REA energy is the station's ex-bus scheduled energy from the RPC's account; a bill disagrees when its ex-bus energy is more than 1 MWh off the REA now on file — the REA was revised after the bill was drawn, and a revision is due.</p>
      <AlertPopup open={!!popup} tone="error" title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />
    </div>
  );
}
