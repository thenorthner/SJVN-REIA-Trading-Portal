import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, StatCard, fmtNumber } from '../../components/ui.jsx';

const GRADE_TONE = { A: 'success', B: 'primary', C: 'warning', D: 'danger' };

// A shortfall bar, so the size of an incident reads at a glance rather than
// having to compare numbers across rows.
function ShortfallBar({ pct }) {
  const width = Math.min(100, Math.max(0, pct));
  const tone = pct >= 25 ? 'var(--danger, #b91c1c)' : pct >= 10 ? 'var(--warning, #b45309)' : 'var(--slate-400, #94a3b8)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--slate-100, #f1f5f9)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${width}%`, height: '100%', background: tone }} />
      </div>
      <span style={{ fontSize: 12, color: tone, minWidth: 44, textAlign: 'right' }}>{fmtNumber(pct, 2)}%</span>
    </div>
  );
}

export default function DeviationRegister() {
  const [summary, setSummary] = useState(null);
  const [scorecard, setScorecard] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [register, setRegister] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', only_deviations: false });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      const [s, sc, inc, reg] = await Promise.all([
        api.deviations.summary(params),
        api.deviations.scorecard(params),
        api.deviations.incidents(params),
        api.deviations.list({ ...params, ...(filters.only_deviations ? { only_deviations: '1' } : {}) }),
      ]);
      setSummary(s); setScorecard(sc); setIncidents(inc); setRegister(reg);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to load deviation register');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters]);

  const scoreColumns = [
    { key: 'counterparty', label: 'Counterparty' },
    { key: 'contract_ref', label: 'Contract', render: r => <span style={{ fontSize: 12 }}>{r.contract_ref}</span> },
    { key: 'days', label: 'Days' },
    { key: 'requested_mwh', label: 'Requested (MWh)', render: r => fmtNumber(r.requested_mwh, 2) },
    { key: 'scheduled_mwh', label: 'Delivered (MWh)', render: r => fmtNumber(r.scheduled_mwh, 2) },
    { key: 'seller_default_mwh', label: 'Shortfall (MWh)', render: r => fmtNumber(r.seller_default_mwh, 2) },
    { key: 'incident_days', label: 'Incidents' },
    { key: 'worst_shortfall_mwh', label: 'Worst day', render: r => `${fmtNumber(r.worst_shortfall_mwh, 2)} MWh` },
    {
      key: 'seller_reliability_pct',
      label: 'Reliability',
      render: r => (
        <span>
          <strong>{fmtNumber(r.seller_reliability_pct, 3)}%</strong>{' '}
          <Badge type={GRADE_TONE[r.grade] || 'neutral'}>{r.grade}</Badge>
        </span>
      ),
    },
  ];

  const incidentColumns = [
    { key: 'schedule_date', label: 'Date' },
    { key: 'counterparty', label: 'Counterparty' },
    { key: 'requested_mwh', label: 'Requested', render: r => fmtNumber(r.requested_mwh, 3) },
    { key: 'scheduled_mwh', label: 'Delivered', render: r => fmtNumber(r.scheduled_mwh, 3) },
    { key: 'seller_default_mwh', label: 'Seller short', render: r => <strong>{fmtNumber(r.seller_default_mwh, 3)}</strong> },
    { key: 'buyer_default_mwh', label: 'Buyer short', render: r => fmtNumber(r.buyer_default_mwh, 3) },
    { key: 'shortfall_pct', label: 'Shortfall', render: r => <ShortfallBar pct={r.shortfall_pct} /> },
  ];

  const registerColumns = [
    { key: 'schedule_date', label: 'Date' },
    { key: 'availability_mwh', label: 'Available', render: r => fmtNumber(r.availability_mwh, 2) },
    { key: 'requested_mwh', label: 'Requested', render: r => fmtNumber(r.requested_mwh, 3) },
    { key: 'scheduled_mwh', label: 'Scheduled', render: r => fmtNumber(r.scheduled_mwh, 3) },
    {
      key: 'seller_default_mwh',
      label: 'Seller default',
      render: r => (r.seller_default_mwh > 0
        ? <span style={{ color: 'var(--danger, #b91c1c)' }}>{fmtNumber(r.seller_default_mwh, 3)}</span>
        : '—'),
    },
    {
      key: 'buyer_default_mwh',
      label: 'Buyer default',
      render: r => (r.buyer_default_mwh > 0
        ? <span style={{ color: 'var(--danger, #b91c1c)' }}>{fmtNumber(r.buyer_default_mwh, 3)}</span>
        : '—'),
    },
    { key: 'remark', label: 'Remark', render: r => r.remark || '—' },
  ];

  return (
    <div>
      <PageHeader
        title="Schedule Deviation Register"
        subtitle="Day-wise availability against what was requested and actually scheduled, with counterparty reliability"
      />

      <Card title="Period">
        <div style={{ display: 'flex', gap: 15, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>From</label>
            <input type="date" className="input" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>To</label>
            <input type="date" className="input" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
          </div>
          <button className="btn btn-ghost" onClick={() => setFilters({ from: '', to: '', only_deviations: filters.only_deviations })}>Clear</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginLeft: 'auto' }}>
            <input
              type="checkbox"
              checked={filters.only_deviations}
              onChange={e => setFilters({ ...filters, only_deviations: e.target.checked })}
            />
            Show only days with a default
          </label>
        </div>
      </Card>

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 15, marginBottom: 20 }}>
          <StatCard label="Days tracked" value={summary.days} />
          <StatCard label="Requested" value={`${fmtNumber(summary.requested_mwh, 1)} MWh`} />
          <StatCard label="Delivered" value={`${fmtNumber(summary.scheduled_mwh, 1)} MWh`} />
          <StatCard
            label="Seller shortfall"
            value={`${fmtNumber(summary.seller_default_mwh, 1)} MWh`}
            tone={summary.seller_default_mwh > 0 ? 'danger' : 'default'}
            hint={`${fmtNumber(summary.seller_shortfall_pct, 3)}% of requested · ${summary.seller_default_days} day(s)`}
          />
          <StatCard
            label="Seller reliability"
            value={`${fmtNumber(summary.seller_reliability_pct, 3)}%`}
            tone={summary.seller_reliability_pct >= 99.5 ? 'success' : summary.seller_reliability_pct >= 98 ? 'default' : 'warning'}
            hint="Share of requested energy actually delivered"
          />
        </div>
      )}

      <Card title="Counterparty scorecard">
        <Table columns={scoreColumns} rows={scorecard} loading={loading} emptyMessage="No schedule data for this period." />
        <p style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 10 }}>
          Grade is on delivered share of requested energy — A at 99.5% and above, B at 98%, C at 95%, D below that.
        </p>
      </Card>

      <Card title={`Shortfall incidents (${incidents.length})`}>
        <Table columns={incidentColumns} rows={incidents} loading={loading} emptyMessage="No shortfalls in this period." />
      </Card>

      <Card title="Day-wise register">
        <Table columns={registerColumns} rows={register} loading={loading} emptyMessage="No schedule days recorded." />
      </Card>
    </div>
  );
}
