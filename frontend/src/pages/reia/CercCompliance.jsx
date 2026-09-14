import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Badge, StatCard, fmtNumber } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// The CERC filing calendar: every period that owes a return, and where it stands.
//
// The Form-IV register answers "what have we prepared", which is a different
// question from "what do we owe the Commission". A month nobody started has no
// row in that register, so a register alone shows a clean sheet for exactly the
// months that are the problem. This walks the calendar instead.

const STATUS_TONE = { SUBMITTED: 'success', PREPARED: 'primary', DRAFT: 'warning', MISSING: 'danger' };
const STATUS_LABEL = { SUBMITTED: 'Filed', PREPARED: 'Prepared', DRAFT: 'Draft', MISSING: 'Not started' };

function PeriodTable({ title, rows, emptyText }) {
  return (
    <Card title={title}>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Covers</th>
              <th scope="col">Due</th>
              <th scope="col">Status</th>
              <th scope="col">Filed</th>
              <th scope="col" className="num">Volume (MU)</th>
              <th scope="col" className="num">Margin</th>
              <th scope="col" className="num">Breaches</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="empty-cell" colSpan={8}>{emptyText}</td></tr>
            ) : rows.map((r) => (
              <tr key={`${r.period_type}-${r.period}`}>
                <td>{r.period}{r.form_no && <div className="audit-muted">{r.form_no}</div>}</td>
                <td>{fmtDate(r.period_from)} → {fmtDate(r.period_to)}</td>
                <td>
                  {fmtDate(r.due_date)}
                  {r.overdue && <div className="audit-muted">{r.days_past_due} days past due</div>}
                </td>
                <td>
                  <Badge type={STATUS_TONE[r.status] || 'neutral'}>{STATUS_LABEL[r.status] || r.status}</Badge>
                  {r.overdue && <div><Badge type="danger">Overdue</Badge></div>}
                </td>
                <td>
                  {r.submission_date ? fmtDate(r.submission_date) : '—'}
                  {r.reference_no && <div className="audit-muted">{r.reference_no}</div>}
                </td>
                <td className="num">{r.total_volume_mu != null ? fmtNumber(r.total_volume_mu, 3) : '—'}</td>
                <td className="num">{r.trading_margin != null ? fmtNumber(r.trading_margin, 0) : '—'}</td>
                <td className="num">
                  {r.breach_count ? <Badge type="danger">{r.breach_count}</Badge> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function CercCompliance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });

  function load(next = range) {
    setLoading(true);
    setError('');
    const params = {};
    if (next.from) params.from = next.from;
    if (next.to) params.to = next.to;
    api.reports.cercCompliance(params)
      .then(setData)
      .catch((err) => {
        setError(err?.response?.data?.error || 'Could not load the filing calendar.');
        setData(null);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const totals = data?.totals;

  return (
    <div className="page">
      <PageHeader
        title="CERC Compliance"
        subtitle="Every period that owes the Commission a return, monthly and annual"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <Card>
        <div className="report-criteria">
          <label className="report-search">
            From
            <input type="month" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </label>
          <label className="report-search">
            To
            <input type="month" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </label>
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
      ) : !data ? null : data.note ? (
        <Card><div className="audit-placeholder">{data.note}</div></Card>
      ) : (
        <>
          <div className="kpi-grid">
            <StatCard
              label="Not started"
              value={fmtNumber(totals.missing, 0)}
              hint="Periods with no return at all"
              tone={totals.missing ? 'red' : 'green'}
            />
            <StatCard
              label="Past their deadline"
              value={fmtNumber(totals.overdue, 0)}
              tone={totals.overdue ? 'red' : 'green'}
            />
            <StatCard label="Filed" value={`${fmtNumber(totals.submitted, 0)} of ${fmtNumber(totals.expected, 0)}`} tone="blue" />
            <StatCard
              label="Margin breaches reported"
              value={fmtNumber(totals.open_breaches, 0)}
              hint="Transactions over the CERC cap"
              tone={totals.open_breaches ? 'amber' : 'default'}
            />
          </div>

          <PeriodTable
            title="Monthly returns"
            rows={data.monthly}
            emptyText="No completed month owes a return yet."
          />
          <PeriodTable
            title="Annual returns"
            rows={data.annual}
            emptyText="No financial year has ended yet."
          />

          <p className="report-count">
            A period is listed because the platform has trading data for it, whether or not anybody has started its
            return — which is the part a register of prepared filings cannot show. The current month is not listed
            until it ends. Deadlines are the period end plus the filing window in Masters.
          </p>
        </>
      )}
    </div>
  );
}
