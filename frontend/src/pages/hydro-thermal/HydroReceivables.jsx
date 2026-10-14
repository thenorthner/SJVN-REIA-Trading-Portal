import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { writeRolesFor, pathFor, deskLabel } from '../../lib/stationVertical.js';
import { PageHeader, Card, Table, StatCard, fmtCurrency } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// Payment monitoring for a hydro station: what each beneficiary owes, how far
// past due it is, the surcharge it has run up, and when it last paid — the
// figures the desk chases on, read straight off the beneficiary accounts.

export default function HydroReceivables({ vertical = 'HYDRO' }) {
  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

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

  const t = data?.totals || {};
  const money = (v) => (v ? fmtCurrency(v) : '—');

  return (
    <div>
      <PageHeader
        title="Payment Monitoring"
        subtitle="Beneficiary-wise outstanding on the station, aged by days past due, with surcharge accrued and the last payment received"
      />
      {error && <div className="alert alert-error">{error}</div>}
      <div className="filters-bar">
        <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
          {stations.map((s) => <option key={s.id} value={s.id}>{s.station_name || s.contract_no}</option>)}
        </select>
        {data && <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--text-muted)' }}>As of {fmtDate(data.as_of)}</span>}
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
          rows={(data?.rows || []).map((r) => ({ ...r, id: r.beneficiary_name }))}
          emptyMessage={data ? 'No bill has been issued on this station yet.' : 'Loading...'}
        />
      </Card>
    </div>
  );
}
