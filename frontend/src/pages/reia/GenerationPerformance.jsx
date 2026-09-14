import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Badge, StatCard, Field, fmtNumber } from '../../components/ui.jsx';

// What each project generated against what its contract expects.
//
// The platform held the energy, the capacity and each contract's minimum CUF, and
// worked the shortfall out when a bill was raised — but nothing showed the
// performance itself, so "which projects are underperforming, and since when" meant
// reading invoices one at a time.

const pct = (v) => (v == null ? '—' : `${fmtNumber(v, 2)}%`);

function cufBadge(row) {
  if (row.meets_cuf == null) return <span className="audit-muted">capacity not on record</span>;
  return row.meets_cuf
    ? <Badge type="success">{pct(row.actual_cuf_percent)}</Badge>
    : <Badge type="danger">{pct(row.actual_cuf_percent)}</Badge>;
}

export default function GenerationPerformance() {
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [project, setProject] = useState('');

  function load(next = range) {
    setLoading(true);
    setError('');
    const params = {};
    if (next.from) params.from = next.from;
    if (next.to) params.to = next.to;
    api.reports.generationPerformance(params)
      .then(setData)
      .catch((err) => {
        setError(err?.response?.data?.error || 'Could not load generation performance.');
        setData(null);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const months = useMemo(
    () => (data?.months || []).filter((m) => !project || m.contract_id === project),
    [data, project],
  );
  const totals = data?.totals;

  return (
    <div className="page">
      <PageHeader
        title="Generation Performance"
        subtitle="Monthly energy, the CUF it works out to, and what each contract requires"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <Card>
        <div className="report-criteria">
          <Field label="From (month)">
            <input type="month" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </Field>
          <Field label="To (month)">
            <input type="month" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </Field>
          <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => load()}>
            {loading ? 'Loading…' : 'Apply'}
          </button>
          {(range.from || range.to) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setRange({ from: '', to: '' }); load({ from: '', to: '' }); }}
            >
              Clear
            </button>
          )}
        </div>
      </Card>

      {loading && !data ? (
        <Card><div className="audit-placeholder">Loading…</div></Card>
      ) : !data ? null : (
        <>
          <div className="kpi-grid">
            <StatCard label="Projects reporting" value={fmtNumber(totals.projects, 0)} tone="blue" />
            <StatCard label="Energy accounted" value={`${fmtNumber(totals.energy_mwh)} MWh`} hint={`of ${fmtNumber(totals.possible_mwh)} MWh possible`} />
            <StatCard label="CUF over the period" value={pct(totals.period_cuf_percent)} hint="Energy against what the capacity could make" />
            <StatCard
              label="Months below the contract CUF"
              value={fmtNumber(totals.months_below_cuf, 0)}
              hint={`${fmtNumber(totals.shortfall_mwh)} MWh short`}
              tone={totals.months_below_cuf ? 'amber' : 'green'}
            />
          </div>

          <Card title="By project">
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Contract</th>
                    <th scope="col">Developer</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="num">Capacity (MW)</th>
                    <th scope="col" className="num">Months</th>
                    <th scope="col" className="num">Energy (MWh)</th>
                    <th scope="col" className="num">CUF</th>
                    <th scope="col" className="num">Required</th>
                    <th scope="col" className="num">Months short</th>
                    <th scope="col" className="num">Shortfall (MWh)</th>
                    <th scope="col" className="num">Availability</th>
                  </tr>
                </thead>
                <tbody>
                  {data.projects.length === 0 ? (
                    <tr><td className="empty-cell" colSpan={11}>No energy has been accounted for this period.</td></tr>
                  ) : data.projects.map((p) => (
                    <tr
                      key={p.contract_id}
                      className="clickable"
                      onClick={() => setProject(project === p.contract_id ? '' : p.contract_id)}
                    >
                      <td>{p.contract_no}</td>
                      <td>{p.seller_name || '—'}</td>
                      <td>{p.project_type}</td>
                      <td className="num">{fmtNumber(p.capacity_mw)}</td>
                      <td className="num">{p.months}</td>
                      <td className="num">{fmtNumber(p.energy_mwh)}</td>
                      <td className="num">{pct(p.period_cuf_percent)}</td>
                      <td className="num">{pct(p.min_cuf_percent)}</td>
                      <td className="num">
                        {p.months_below_cuf
                          ? <Badge type="warning">{p.months_below_cuf}</Badge>
                          : <Badge type="success">0</Badge>}
                      </td>
                      <td className="num">{p.shortfall_mwh ? fmtNumber(p.shortfall_mwh) : '—'}</td>
                      <td className="num">{pct(p.avg_availability_percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {project && (
              <p className="report-count">
                Showing one project&apos;s months below.{' '}
                <button type="button" className="btn-link" onClick={() => setProject('')}>Show all</button>
              </p>
            )}
          </Card>

          <Card title="Month by month">
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Contract</th>
                    <th scope="col" className="num">Energy (MWh)</th>
                    <th scope="col" className="num">Possible (MWh)</th>
                    <th scope="col" className="num">CUF</th>
                    <th scope="col" className="num">Required</th>
                    <th scope="col" className="num">Shortfall (MWh)</th>
                    <th scope="col" className="num">Availability</th>
                    <th scope="col">Reading</th>
                  </tr>
                </thead>
                <tbody>
                  {months.length === 0 ? (
                    <tr><td className="empty-cell" colSpan={9}>Nothing accounted for this selection.</td></tr>
                  ) : months.map((m) => (
                    <tr key={`${m.contract_id}-${m.period_month}`}>
                      <td>{m.period_month}</td>
                      <td>{m.contract_no}</td>
                      <td className="num">{fmtNumber(m.energy_mwh)}</td>
                      <td className="num">{fmtNumber(m.possible_mwh)}</td>
                      <td className="num">{cufBadge(m)}</td>
                      <td className="num">{pct(m.min_cuf_percent)}</td>
                      <td className="num">{m.shortfall_mwh ? fmtNumber(m.shortfall_mwh) : '—'}</td>
                      <td className="num">{pct(m.availability_percent)}</td>
                      <td>
                        <Badge type={m.data_type === 'FINAL' ? 'success' : 'warning'}>{m.data_type}</Badge>
                        <div className="audit-muted">{m.source} · {m.status}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="report-count">
              CUF is the energy accounted against what the commissioned capacity could produce in that month.
              A provisional reading that a final one has replaced is not counted twice.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
