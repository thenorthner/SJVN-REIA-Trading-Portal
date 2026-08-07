import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const REGION_LABEL = { WR: 'Western', NR: 'Northern', ER: 'Eastern', SR: 'Southern', NER: 'North-Eastern' };

// Actual open-access cost per month, split by charge type, so the cost line reads
// at a glance rather than needing the table to be totalled up.
function MonthlyCost({ months }) {
  if (!months.length) return <p style={{ color: 'var(--slate-500)', fontSize: 14 }}>No applications in this period.</p>;
  const max = Math.max(...months.map(m => m.total), 1);
  const parts = [
    ['ists', '#2563eb', 'ISTS'],
    ['application_fees', '#16a34a', 'NOAR fee'],
    ['rldc_fees', '#f59e0b', 'RLDC'],
  ];
  return (
    <div>
      <div style={{ display: 'grid', gap: 10 }}>
        {months.map(m => (
          <div key={m.month} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 130px', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 13 }}>{m.month}</span>
            <div style={{ display: 'flex', height: 18, borderRadius: 3, overflow: 'hidden', background: 'var(--slate-100, #f1f5f9)' }}>
              {parts.map(([key, colour, label]) => (
                m[key] > 0 && (
                  <div key={key} style={{ width: `${(m[key] / max) * 100}%`, background: colour }} title={`${label}: ${fmtCurrency(m[key])}`} />
                )
              ))}
            </div>
            <span style={{ fontSize: 13, textAlign: 'right' }}>{fmtCurrency(m.total)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'var(--slate-500)', marginTop: 10 }}>
        {parts.map(([key, colour, label]) => (
          <span key={key}><span style={{ display: 'inline-block', width: 10, height: 10, background: colour, marginRight: 5 }} />{label}</span>
        ))}
      </div>
    </div>
  );
}

export default function OAReconciliation() {
  const [recon, setRecon] = useState(null);
  const [months, setMonths] = useState([]);
  const [range, setRange] = useState({ from: '', to: '' });
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (range.from) params.from = range.from;
      if (range.to) params.to = range.to;
      const [r, m] = await Promise.all([api.oaCharges.reconcile(params), api.oaCharges.actualsByMonth(params)]);
      setRecon(r); setMonths(m);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to load reconciliation');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range]);

  // Match rate per corridor — ISTS is priced per corridor, so a whole corridor
  // drifting means its rate is missing or stale rather than one application being odd.
  const byRegion = (recon?.rows || []).reduce((acc, r) => {
    const k = r.region || '—';
    acc[k] = acc[k] || { region: k, total: 0, matched: 0, actual: 0 };
    acc[k].total++;
    if (r.matched) acc[k].matched++;
    acc[k].actual += r.total_actual;
    return acc;
  }, {});
  const regionRows = Object.values(byRegion).map(r => ({
    ...r,
    match_pct: r.total ? Number(((r.matched / r.total) * 100).toFixed(1)) : 100,
  })).sort((a, b) => b.total - a.total);

  const regionColumns = [
    { key: 'region', label: 'Corridor', render: r => `${r.region}${REGION_LABEL[r.region] ? ` — ${REGION_LABEL[r.region]}` : ''}` },
    { key: 'total', label: 'Applications' },
    { key: 'matched', label: 'Matched' },
    {
      key: 'match_pct',
      label: 'Match rate',
      render: r => <Badge type={r.match_pct === 100 ? 'success' : r.match_pct >= 90 ? 'warning' : 'danger'}>{r.match_pct}%</Badge>,
    },
    { key: 'actual', label: 'Actual charges', render: r => fmtCurrency(r.actual) },
  ];

  const appColumns = [
    { key: 'application_no', label: 'Application' },
    { key: 'region', label: 'Corridor', render: r => r.region || '—' },
    { key: 'application_date', label: 'Date' },
    { key: 'days', label: 'Days', render: r => (r.days > 1 ? <Badge type="primary">{r.days}</Badge> : r.days) },
    { key: 'approved_mwh', label: 'MWh', render: r => fmtNumber(r.approved_mwh, 3) },
    { key: 'ists_actual', label: 'ISTS actual', render: r => fmtCurrency(r.ists_actual) },
    { key: 'ists_estimated', label: 'ISTS estimated', render: r => fmtCurrency(r.ists_estimated) },
    { key: 'total_actual', label: 'Total actual', render: r => fmtCurrency(r.total_actual) },
    { key: 'total_estimated', label: 'Total estimated', render: r => fmtCurrency(r.total_estimated) },
    {
      key: 'drift',
      label: 'Drift',
      render: r => (r.matched
        ? <span style={{ color: 'var(--slate-400)' }}>—</span>
        : <strong style={{ color: 'var(--danger, #b91c1c)' }}>{fmtCurrency(r.drift)}</strong>),
    },
  ];

  const monthColumns = [
    { key: 'month', label: 'Month' },
    { key: 'applications', label: 'Applications' },
    { key: 'approved_mwh', label: 'Approved (MWh)', render: r => fmtNumber(r.approved_mwh, 3) },
    { key: 'ists', label: 'ISTS', render: r => fmtCurrency(r.ists) },
    { key: 'application_fees', label: 'NOAR fees', render: r => fmtCurrency(r.application_fees) },
    { key: 'rldc_fees', label: 'RLDC fees', render: r => fmtCurrency(r.rldc_fees) },
    { key: 'total', label: 'Total', render: r => <strong>{fmtCurrency(r.total)}</strong> },
  ];

  const shown = showAll ? (recon?.rows || []) : (recon?.mismatches || []);

  return (
    <div>
      <PageHeader
        title="Open Access Reconciliation"
        subtitle="What each application was actually charged against what the rate master would have priced it at"
      />

      <Card title="Period">
        <div style={{ display: 'flex', gap: 15, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>From</label>
            <input type="date" className="input" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>To</label>
            <input type="date" className="input" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} />
          </div>
          <button className="btn btn-ghost" onClick={() => setRange({ from: '', to: '' })}>Clear</button>
        </div>
      </Card>

      {recon && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 15, marginBottom: 20 }}>
          <StatCard
            label="Match rate"
            value={`${fmtNumber(recon.match_pct, 3)}%`}
            tone={recon.mismatched === 0 ? 'success' : 'warning'}
            hint={`${recon.matched} of ${recon.applications} application(s)`}
          />
          <StatCard
            label="Applications drifting"
            value={recon.mismatched}
            tone={recon.mismatched > 0 ? 'warning' : 'default'}
            hint={recon.mismatched === 0 ? 'The rate master prices every application correctly' : 'Listed below'}
          />
          <StatCard label="Actual charges" value={fmtCurrency(recon.total_actual)} />
          <StatCard label="Estimated" value={fmtCurrency(recon.total_estimated)} />
          <StatCard
            label="Total drift"
            value={fmtCurrency(recon.total_drift)}
            tone={Math.abs(recon.total_drift) > 100 ? 'warning' : 'success'}
            hint="Estimated less actual"
          />
        </div>
      )}

      <Card title="Match rate by transmission corridor">
        <Table columns={regionColumns} rows={regionRows} loading={loading} emptyMessage="No applications." />
        <p style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 10 }}>
          ISTS is billed per corridor, not nationally — the same day is charged at a different rate in each. A whole
          corridor drifting means its rate is missing or stale, rather than one application being unusual.
        </p>
      </Card>

      <Card title="Actual open-access cost by month">
        <MonthlyCost months={months} />
      </Card>

      <Card title="Monthly detail">
        <Table columns={monthColumns} rows={months} loading={loading} emptyMessage="No applications." />
      </Card>

      <Card
        title={showAll ? `All applications (${recon?.applications || 0})` : `Applications drifting (${recon?.mismatched || 0})`}
        actions={(
          <button className="btn btn-outline" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show only drifting' : 'Show all applications'}
          </button>
        )}
      >
        <Table
          columns={appColumns}
          rows={shown}
          loading={loading}
          emptyMessage={showAll ? 'No applications.' : 'Every application matches what the rate master prices.'}
        />
      </Card>
    </div>
  );
}
