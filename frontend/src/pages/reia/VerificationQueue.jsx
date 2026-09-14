import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { PageHeader, Card, Badge, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import { fmtDateTime } from '../../datetime.js';

// Every developer bill waiting to be verified, and what each one is waiting on.
//
// The checklist has existed for a while — the technical items (REA, energy,
// tariff, capacity, CUF, COD, curtailment, change-in-law) and the commercial
// build-up — but only inside one invoice at a time. A desk with forty bills open
// had to open forty of them to find the two that were stuck.

const STATE_TONE = { FAILED: 'danger', IN_PROGRESS: 'warning', PENDING: 'neutral', VERIFIED: 'success' };
const STATE_LABEL = { FAILED: 'Failed a check', IN_PROGRESS: 'In progress', PENDING: 'Not started', VERIFIED: 'Verified' };
const CHECK_TONE = { FAILED: 'danger', PENDING: 'warning', VERIFIED: 'success', NA: 'neutral' };
const FILTERS = [
  { key: '', label: 'Everything' },
  { key: 'FAILED', label: 'Failed a check' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'PENDING', label: 'Not started' },
  { key: 'VERIFIED', label: 'Verified' },
];

export default function VerificationQueue() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.reports.verificationQueue()
      .then(setData)
      .catch((err) => {
        setError(err?.response?.data?.error || 'Could not load the verification queue.');
        setData(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(
    () => (data?.invoices || []).filter((i) => !status || i.verification_status === status),
    [data, status],
  );
  const totals = data?.totals;

  return (
    <div className="page">
      <PageHeader
        title="Invoice Verification"
        subtitle="Technical and commercial checks on developer bills, across the desk"
        actions={<Link className="btn btn-outline" to="/reia/invoices">Open invoices</Link>}
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {loading && !data ? (
        <Card><div className="audit-placeholder">Loading…</div></Card>
      ) : !data ? null : (
        <>
          <div className="kpi-grid">
            <StatCard
              label="Failed a check"
              value={fmtNumber(totals.failed, 0)}
              hint="Cannot be paid as they stand"
              tone={totals.failed ? 'red' : 'green'}
            />
            <StatCard label="In progress" value={fmtNumber(totals.in_progress, 0)} tone={totals.in_progress ? 'amber' : 'default'} />
            <StatCard label="Not started" value={fmtNumber(totals.pending, 0)} tone={totals.pending ? 'amber' : 'default'} />
            <StatCard
              label="Value awaiting verification"
              value={fmtCurrency(totals.value_awaiting)}
              hint={totals.oldest_days ? `Oldest raised ${totals.oldest_days} days ago` : undefined}
            />
          </div>

          {data.blockers.length > 0 && (
            <Card title="What is holding bills up">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Check</th>
                      <th scope="col" className="num">Bills blocked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.blockers.map((b) => (
                      <tr key={b.label}>
                        <td>{b.label}</td>
                        <td className="num">{b.invoices_blocked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card>
            <div className="report-toolbar">
              <div className="export-group">
                {FILTERS.map((f) => (
                  <button
                    key={f.key || 'all'}
                    type="button"
                    className={`btn btn-sm ${status === f.key ? 'btn-navy' : 'btn-outline'}`}
                    onClick={() => setStatus(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Invoice</th>
                    <th scope="col">Developer</th>
                    <th scope="col">Contract</th>
                    <th scope="col">Period</th>
                    <th scope="col" className="num">Amount</th>
                    <th scope="col" className="num">Waiting</th>
                    <th scope="col">Against SJVN&apos;s figure</th>
                    <th scope="col">Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td className="empty-cell" colSpan={8}>No bill in this state.</td></tr>
                  ) : rows.map((r) => (
                    <React.Fragment key={r.invoice_id}>
                      <tr className="clickable" onClick={() => setOpen(open === r.invoice_id ? null : r.invoice_id)}>
                        <td>{r.invoice_no}<div className="audit-muted">{r.invoice_type} · {r.status}</div></td>
                        <td>{r.developer_name || '—'}</td>
                        <td>{r.contract_no || '—'}</td>
                        <td>{r.billing_period}</td>
                        <td className="num">{fmtCurrency(r.total_amount)}</td>
                        <td className="num">{r.days_since_raised != null ? `${r.days_since_raised}d` : '—'}</td>
                        <td>{r.validation_status ? <Badge status={r.validation_status}>{r.validation_status}</Badge> : '—'}</td>
                        <td>
                          <Badge type={STATE_TONE[r.verification_status]}>{STATE_LABEL[r.verification_status] || r.verification_status}</Badge>
                          {r.failed_checks.length > 0 && (
                            <div className="audit-muted">{r.failed_checks.join(', ')}</div>
                          )}
                        </td>
                      </tr>
                      {open === r.invoice_id && (
                        <tr>
                          <td colSpan={8} style={{ background: 'var(--navy-tint)' }}>
                            <div className="grid-2">
                              <div>
                                <h4 style={{ margin: '0 0 8px' }}>Technical</h4>
                                <div className="table-wrap">
                                  <table className="data-table">
                                    <tbody>
                                      {r.technical.map((t) => (
                                        <tr key={t.key}>
                                          <th scope="row" style={{ width: '38%', textAlign: 'left' }}>{t.label}</th>
                                          <td style={{ width: 110 }}><Badge type={CHECK_TONE[t.status] || 'neutral'}>{t.status}</Badge></td>
                                          <td>
                                            {t.hint}
                                            {t.note && <div className="audit-muted">{t.note}</div>}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                              <div>
                                <h4 style={{ margin: '0 0 8px' }}>Commercial</h4>
                                <div className="table-wrap">
                                  <table className="data-table">
                                    <tbody>
                                      <tr><th scope="row" style={{ textAlign: 'left' }}>Energy charges</th><td className="num">{fmtCurrency(r.commercial.energy_charges)}</td></tr>
                                      <tr><th scope="row" style={{ textAlign: 'left' }}>Change in law</th><td className="num">{fmtCurrency(r.commercial.change_in_law)}</td></tr>
                                      <tr><th scope="row" style={{ textAlign: 'left' }}>Compensation event</th><td className="num">{fmtCurrency(r.commercial.compensation_event)}</td></tr>
                                      <tr><th scope="row" style={{ textAlign: 'left' }}>Liquidated damages</th><td className="num">− {fmtCurrency(r.commercial.liquidated_damages)}</td></tr>
                                      <tr><th scope="row" style={{ textAlign: 'left' }}>Previous adjustment</th><td className="num">{fmtCurrency(r.commercial.previous_adjustment)}</td></tr>
                                      <tr className="totals-row"><th scope="row" style={{ textAlign: 'left' }}>Net by the build-up</th><td className="num">{fmtCurrency(r.commercial_net)}</td></tr>
                                      <tr><th scope="row" style={{ textAlign: 'left' }}>Raised for</th><td className="num">{fmtCurrency(r.total_amount)}</td></tr>
                                    </tbody>
                                  </table>
                                </div>
                                {r.commercial_gap !== 0 && (
                                  <div className="alert alert-warning" style={{ marginTop: 10 }} role="status">
                                    The build-up and the bill differ by {fmtCurrency(Math.abs(r.commercial_gap))}.
                                  </div>
                                )}
                                {r.verified_by && (
                                  <p className="report-count">Verified by {r.verified_by} on {fmtDateTime(r.verified_at)}.</p>
                                )}
                                <Link className="btn btn-sm btn-outline" to="/reia/invoices">Open the bill to verify it</Link>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="report-count">
              Showing {rows.length} of {data.invoices.length} developer {data.invoices.length === 1 ? 'bill' : 'bills'}.
              Click one to see its checks. The checklist is the same one the invoice screen draws, so they cannot disagree.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
