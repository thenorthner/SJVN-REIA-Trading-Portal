import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { writeRolesFor, pathFor, deskLabel } from '../../lib/stationVertical.js';
import { PageHeader, Card, Table, StatCard, fmtCurrency } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';
import ModuleGuide from '../../components/ModuleGuide.jsx';

const TABS = [
  { key: 'MAIN', label: 'Ageing' },
  { key: 'FYI', label: 'FYI — Reference Guide' },
];

function exportAgeing(rows, stationName) {
  const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Beneficiary', 'Not yet due', '1-30 days', '31-60 days', '61-90 days', '90+ days', 'Outstanding', 'LPS accrued', 'Last payment date', 'Last payment amount'];
  const lines = rows.map((r) => [
    r.beneficiary_name, r.current, r.d1_30, r.d31_60, r.d61_90, r.d90_plus,
    r.outstanding, r.lps_accrued_not_charged, r.last_payment_date || '', r.last_payment_amount || '',
  ].map(csvCell).join(','));
  const blob = new Blob([`${head.map(csvCell).join(',')}\n${lines.join('\n')}\n`], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ageing-report-${(stationName || 'station').replace(/[^\w]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function HydroReceivables({ vertical = 'HYDRO' }) {
  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('MAIN');
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  useEffect(() => {
    api.hydroBilling.stations({ vertical })
      .then((list) => { setStations(list || []); if (list?.length) setStationId((cur) => cur || list[0].id); })
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, []);
  useEffect(() => {
    if (!stationId) return;
    setData(null);
    api.hydroBilling.receivables({ contract_id: stationId })
      .then(setData)
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, [stationId]);

  const filtered = useMemo(() => {
    const rows = data?.rows || [];
    if (!onlyOverdue) return rows;
    return rows.filter((r) => (r.d1_30 || 0) + (r.d31_60 || 0) + (r.d61_90 || 0) + (r.d90_plus || 0) > 0);
  }, [data, onlyOverdue]);

  const t = data?.totals || {};
  const money = (v) => (v ? fmtCurrency(v) : '—');
  const stationName = stations.find((s) => s.id === stationId)?.station_name || '';

  return (
    <div>
      <PageHeader
        title="Payment Monitoring"
        subtitle="Beneficiary-wise outstanding on the station, aged by days past due, with surcharge accrued and the last payment received"
        actions={filtered.length > 0 && tab === 'MAIN' && (
          <button type="button" className="btn btn-outline" onClick={() => exportAgeing(filtered, stationName)}>Export ageing (CSV)</button>
        )}
      />
      {error && <div className="alert alert-error">{error}</div>}

      <div className="nb-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`nb-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'FYI' && (
        <ModuleGuide sections={[
          { title: 'Ageing report', body: 'The ageing analysis shows each beneficiary\'s outstanding broken into buckets by the number of days past due. Amounts in the "Not yet due" column have not crossed their payment deadline. Amounts in 90+ days are the most critical — they represent long-overdue balances where the station should consider invoking payment security.' },
          { title: 'Late payment surcharge (LPS)', body: 'When a bill crosses its due date, surcharge accrues daily at the CERC rate (currently 1.50% per month, applied to chargeable days only — weekends and the payer\'s declared holidays are excluded). The "LPS accrued, not yet charged" figure is what has accumulated since the last surcharge bill was raised. Raise a surcharge bill from Account Display when it reaches a material amount.' },
          { title: 'Overdue action checklist', body: '1–30 days: send a reminder. 31–60 days: issue a formal notice. 61–90 days: escalate to Commercial head and consider restricting scheduling. 90+ days: invoke the beneficiary\'s letter of credit or bank guarantee from Payment Security.' },
          { title: 'Advances', body: 'Advances held are amounts received from beneficiaries ahead of a bill — typically a security deposit or an advance payment intimated before the monthly bill cycle. They sit as a credit on the ledger until set off against a future bill.' },
        ]} />
      )}

      {tab === 'MAIN' && (
        <>
          <div className="filters-bar">
            <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.station_name || s.contract_no}</option>)}
            </select>
            {data && <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--text-muted)' }}>As of {fmtDate(data.as_of)}</span>}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
              Overdue only
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 16 }}>
            <StatCard label="Total outstanding" value={fmtCurrency(t.outstanding || 0)} />
            <StatCard label="Overdue" value={fmtCurrency(t.overdue || 0)} tone={t.overdue > 0 ? 'danger' : 'default'} />
            <StatCard label="Over 90 days" value={fmtCurrency(t.d90_plus || 0)} tone={t.d90_plus > 0 ? 'danger' : 'default'} />
            <StatCard label="LPS accrued, not yet charged" value={fmtCurrency(t.lps_accrued_not_charged || 0)} hint="Charge it from Account Display" />
            <StatCard label="Advances held" value={fmtCurrency(t.advance || 0)} />
          </div>

          <Card title="Ageing by beneficiary">
            <Table
              columns={[
                { key: 'beneficiary_name', header: 'Beneficiary', render: (r) => <Link to={`${pathFor(vertical, 'ledger')}?beneficiary=${encodeURIComponent(r.beneficiary_name)}`}>{r.beneficiary_name}</Link> },
                { key: 'current', header: 'Not yet due', render: (r) => money(r.current) },
                { key: 'd1_30', header: '1–30 days', render: (r) => money(r.d1_30) },
                { key: 'd31_60', header: '31–60', render: (r) => money(r.d31_60) },
                { key: 'd61_90', header: '61–90', render: (r) => money(r.d61_90) },
                { key: 'd90_plus', header: '90+', render: (r) => <span style={{ color: r.d90_plus > 0 ? '#b91c1c' : undefined, fontWeight: r.d90_plus > 0 ? 700 : 400 }}>{money(r.d90_plus)}</span> },
                { key: 'outstanding', header: 'Outstanding', render: (r) => <strong>{money(r.outstanding)}</strong> },
                { key: 'lps', header: 'LPS accrued', render: (r) => money(r.lps_accrued_not_charged) },
                { key: 'last', header: 'Last payment', render: (r) => (r.last_payment_date ? `${fmtDate(r.last_payment_date)} · ${fmtCurrency(r.last_payment_amount)}` : 'none') },
              ]}
              rows={filtered.map((r) => ({ ...r, id: r.beneficiary_name }))}
              emptyMessage={data ? (onlyOverdue ? 'No beneficiary is overdue on this station.' : 'No bill has been issued on this station yet.') : 'Loading...'}
            />
          </Card>
        </>
      )}
    </div>
  );
}
