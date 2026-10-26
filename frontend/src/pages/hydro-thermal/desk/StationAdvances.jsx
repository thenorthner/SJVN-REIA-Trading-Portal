import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { pathFor, writeRolesFor, deskLabel } from '../../../lib/stationVertical.js';
import { PageHeader, Card, Table, StatCard, AlertPopup, fmtCurrency } from '../../../components/ui.jsx';
import { fmtDate } from '../../../datetime.js';

// Every receipt on the desk with money still unapplied: a true advance, or a
// payment that should have been set against a bill and was not.
export default function StationAdvances({ vertical = 'HYDRO' }) {
  const { user } = useAuth();
  const canWrite = writeRolesFor(vertical).includes(user?.role);
  const [data, setData] = useState(null);
  const [station, setStation] = useState('');
  const [onlyApplicable, setOnlyApplicable] = useState(false);
  const [popup, setPopup] = useState(null);
  const busy = useRef(false);

  const load = useCallback(() => {
    api.hydroDesk.advances({ vertical })
      .then(setData)
      .catch((e) => setPopup({ title: 'Could not load', message: e.response?.data?.error || e.message }));
  }, [vertical]);
  useEffect(load, [load]);

  const stations = useMemo(() => [...new Set((data?.rows || []).map((r) => r.station_name))], [data]);
  const rows = (data?.rows || [])
    .filter((r) => !station || r.station_name === station)
    .filter((r) => !onlyApplicable || r.can_apply);

  async function apply(r) {
    if (busy.current) return;
    busy.current = true;
    try {
      const out = await api.hydroBilling.accountMaintenance(r.doc_id, {});
      setPopup({
        tone: 'success',
        title: `${fmtCurrency(out.applied)} of ${r.doc_no} applied`,
        message: `Set against the oldest open bills first${out.unapplied > 0.005 ? `; ${fmtCurrency(out.unapplied)} stays as an advance` : ''}${out.rebate ? `. Early-payment rebate of ${fmtCurrency(out.rebate)} allowed.` : '.'}`,
        items: (out.clearings || []).map((c) => `${c.debit_doc_no || c.doc_no || 'Bill'} — ${fmtCurrency(c.amount)}`),
      });
      load();
    } catch (e) {
      setPopup({ title: 'Not applied', message: e.response?.data?.error || e.message });
    } finally { busy.current = false; }
  }

  const t = data?.totals || {};
  return (
    <div>
      <PageHeader
        title="Advances & Unapplied Receipts"
        subtitle={`Money ${deskLabel(vertical).toLowerCase()} beneficiaries have paid that is not yet set against a bill — true advances, and receipts sitting beside open bills that the desk should clear`}
      />
      <div className="kpi-grid">
        <StatCard label="Unapplied" value={fmtCurrency(t.unapplied || 0)} />
        <StatCard label="Receipts" value={t.receipts ?? 0} />
        <StatCard label="Could be applied now" value={fmtCurrency(t.applicable || 0)} tone={t.applicable ? 'amber' : 'default'} hint={t.applicable_count ? `${t.applicable_count} receipt(s) beside open bills` : undefined} onClick={t.applicable_count ? () => setOnlyApplicable(true) : undefined} />
        <StatCard label="Held over 30 days" value={fmtCurrency(t.over_30_days || 0)} tone={t.over_30_days ? 'red' : 'default'} />
      </div>

      <Card>
        <div className="filters-bar">
          <select value={station} onChange={(e) => setStation(e.target.value)} aria-label="Station">
            <option value="">All stations</option>
            {stations.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14.5 }}>
            <input type="checkbox" checked={onlyApplicable} onChange={(e) => setOnlyApplicable(e.target.checked)} /> Only those beside open bills
          </label>
        </div>
        <Table
          columns={[
            { key: 'doc_no', header: 'Receipt', render: (r) => <span>{r.doc_no}<div style={{ fontSize: 14, color: 'var(--text-light)' }}>{fmtDate(r.doc_date)}{r.mode ? ` · ${r.mode}` : ''}{r.reference ? ` · ${r.reference}` : ''}</div></span> },
            { key: 'beneficiary_name', header: 'Beneficiary', render: (r) => <Link to={`${pathFor(vertical, 'ledger')}?beneficiary=${encodeURIComponent(r.beneficiary_name)}`}>{r.beneficiary_name}</Link> },
            { key: 'station_name', header: 'Station' },
            { key: 'amount', header: 'Received', render: (r) => fmtCurrency(r.amount) },
            { key: 'unapplied', header: 'Unapplied', render: (r) => <strong>{fmtCurrency(r.unapplied)}</strong> },
            { key: 'age_days', header: 'Held', render: (r) => <span style={{ color: r.age_days > 30 ? 'var(--red-deep)' : undefined }}>{r.age_days} days</span> },
            { key: 'open', header: 'Open bills beside it', render: (r) => (r.open_debit_count ? `${r.open_debit_count} · ${fmtCurrency(r.open_debits)}` : 'none — a true advance') },
            { key: 'act', header: '', render: (r) => (canWrite && r.can_apply
              ? <button type="button" className="btn btn-primary btn-sm" onClick={() => apply(r)}>Apply to open bills</button>
              : null) },
          ]}
          rows={rows.map((r) => ({ ...r, id: r.doc_id }))}
          emptyMessage={data ? 'No receipt is sitting unapplied.' : 'Loading…'}
        />
        <p className="inline-note">Applying clears the oldest open bill first, the order surcharge is stopped in. A receipt to go against particular bills is applied from Account Display.</p>
      </Card>
      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
