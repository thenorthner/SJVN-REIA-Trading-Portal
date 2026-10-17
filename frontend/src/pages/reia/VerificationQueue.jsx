import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Badge, StatCard, Tabs, Tab, AlertPopup, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import ModuleGuide from '../../components/ModuleGuide.jsx';
import { getGuide } from '../../content/guides/index.js';
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
  const [view, setView] = useState('queue');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(null);

  const { user } = useAuth() || {};
  const canWrite = ['SJVN_ADMIN', 'REIA_ADMIN', 'IT_SUPER_ADMIN', 'REIA_USER'].includes(user?.role);
  const [picked, setPicked] = useState([]);
  const [popup, setPopup] = useState(null);
  const [reload, setReload] = useState(0);
  const OPEN_FOR_DESK = ['SUBMITTED', 'UNDER_APPROVAL'];
  async function verifySelected() {
    try {
      const r = await api.invoices.verifyBulk(picked);
      setPopup({ tone: 'success', title: `${r.verified.length} verified`, message: r.skipped.length ? 'Some were left for a full check:' : '', items: r.skipped.map((x) => `${x.invoice_no || x.invoice_id}: ${x.why}`) });
    } catch (e) {
      const d = e.response?.data;
      setPopup({ title: 'None verified', message: d?.error || e.message, items: (d?.skipped || []).map((x) => `${x.invoice_no || x.invoice_id}: ${x.why}`) });
    }
    setPicked([]); setReload((n) => n + 1);
  }
  async function sendBack(r) {
    try {
      const out = await api.invoices.sendBack(r.invoice_id);
      setPopup({ tone: 'success', title: `${r.invoice_no} sent back`, message: 'The developer has been told:', items: out.sent_back });
    } catch (e) { setPopup({ title: 'Not sent back', message: e.response?.data?.error || e.message }); }
    setReload((n) => n + 1);
  }

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
  }, [reload]);

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

      <Tabs style={{ marginBottom: 18 }}>
        <Tab active={view === 'queue'} onClick={() => setView('queue')}>Queue</Tab>
        <Tab active={view === 'fyi'} onClick={() => setView('fyi')}>FYI</Tab>
      </Tabs>

      {view === 'fyi' && <ModuleGuide guide={getGuide('verification')} />}

      {view === 'queue' && (
      <>
      <AlertPopup open={!!error} title="Could not load" message={error} onClose={() => setError('')} />

      {loading && !data ? (
        <Card><div className="audit-placeholder">Loading…</div></Card>
      ) : !data ? null : (
        <>
          <div className="kpi-grid">
            <StatCard
              label="Failed a check"
              value={fmtNumber(totals.failed, 0)}
              hint="Cannot be approved as they stand"
              tone={totals.failed ? 'red' : 'green'}
            />
            <StatCard label="In progress" value={fmtNumber(totals.in_progress, 0)} tone={totals.in_progress ? 'amber' : 'default'} />
            <StatCard label="Not started" value={fmtNumber(totals.pending, 0)} tone={totals.pending ? 'amber' : 'default'} />
            <StatCard
              label="Approved without verification"
              value={fmtNumber(totals.approved_unverified, 0)}
              hint={totals.approved_unverified ? `${fmtCurrency(totals.approved_unverified_value)} · ${(data.approved_unverified || []).map((b) => b.invoice_no).join(', ')}` : 'None'}
              tone={totals.approved_unverified ? 'red' : 'green'}
            />
            <StatCard
              label="Value awaiting verification"
              value={fmtCurrency(totals.value_awaiting)}
              hint={totals.oldest_days ? `Oldest raised ${totals.oldest_days} days ago` : undefined}
            />
          </div>

          {(data.approved_unverified || []).length > 0 && (
            <Card title="Approved without a completed verification">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Invoice</th>
                      <th scope="col">Status</th>
                      <th scope="col">Checklist</th>
                      <th scope="col" className="num">Amount</th>
                      <th scope="col"><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.approved_unverified.map((b) => (
                      <tr key={b.invoice_id}>
                        <td>{b.invoice_no}</td>
                        <td>{b.status.replace(/_/g, ' ')}</td>
                        <td>{b.verification_status ? STATE_LABEL[b.verification_status] || b.verification_status : 'Never worked'}</td>
                        <td className="num">{fmtCurrency(b.total_amount)}</td>
                        <td><Link className="btn btn-sm btn-outline" to={`/reia/invoices?id=${encodeURIComponent(b.invoice_id)}`}>Verify after the fact</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

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

            {canWrite && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={!picked.length} onClick={verifySelected}>Verify selected ({picked.length})</button>
                <span className="audit-muted">Bulk verification takes only bills whose automatic checks all pass and whose build-up meets the bill; capacity is confirmed and curtailment / change in law marked not claimed for each.</span>
              </div>
            )}
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    {canWrite && <th scope="col"><span className="sr-only">Select</span></th>}
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
                    <tr><td className="empty-cell" colSpan={canWrite ? 9 : 8}>No developer bill with SJVN in this state.</td></tr>
                  ) : rows.map((r) => (
                    <React.Fragment key={r.invoice_id}>
                      <tr className="clickable" onClick={() => setOpen(open === r.invoice_id ? null : r.invoice_id)}>
                        {canWrite && (
                          <td onClick={(e) => e.stopPropagation()}>
                            {r.verification_status !== 'VERIFIED' && OPEN_FOR_DESK.includes(r.status) && r.failed_checks.length === 0 && (
                              <input type="checkbox" aria-label={`Select ${r.invoice_no}`} checked={picked.includes(r.invoice_id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.invoice_id] : picked.filter((x) => x !== r.invoice_id))} />
                            )}
                          </td>
                        )}
                        <td>{r.invoice_no}<div className="audit-muted">{r.invoice_type} · {r.status}</div></td>
                        <td>{r.developer_name || '—'}</td>
                        <td>{r.contract_no || '—'}</td>
                        <td>{r.billing_period}</td>
                        <td className="num">{fmtCurrency(r.total_amount)}</td>
                        <td className="num">
                          {r.days_since_raised != null ? `${r.days_since_raised}d` : '—'}
                          {r.sla && r.sla.level !== 'DONE' && (
                            // V2: against the PPA's verification window.
                            <div><Badge type={r.sla.level === 'RED' ? 'danger' : r.sla.level === 'AMBER' ? 'warning' : 'success'}>{r.sla.level === 'RED' ? `${-r.sla.days_left}d over` : `${r.sla.days_left}d left`}</Badge></div>
                          )}
                        </td>
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
                          <td colSpan={canWrite ? 9 : 8} style={{ background: 'var(--navy-tint)' }}>
                            <div className="grid-2">
                              <div>
                                <h4 style={{ margin: '0 0 8px' }}>Technical</h4>
                                <div className="table-wrap">
                                  <table className="data-table">
                                    <tbody>
                                      {r.technical.map((t) => (
                                        <tr key={t.key}>
                                          <th scope="row" style={{ width: '38%', textAlign: 'left' }}>{t.label}</th>
                                          <td style={{ width: 110 }}><Badge type={CHECK_TONE[t.status] || 'neutral'}>{t.status}</Badge>{t.auto === 'FAILED' && t.status !== 'FAILED' && <div className="audit-muted">automatic check failed</div>}</td>
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
                                      <tr><th scope="row" style={{ textAlign: 'left' }}>Other lines on the bill</th><td className="num">{fmtCurrency(r.commercial.other_bill_lines)}</td></tr>
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
                                {r.verification_status === 'VERIFIED' && r.verified_by && (
                                  <p className="report-count">Verified by {r.verified_by} on {fmtDateTime(r.verified_at)}.</p>
                                )}
                                <Link className="btn btn-sm btn-outline" to={`/reia/invoices?id=${encodeURIComponent(r.invoice_id)}`}>Open the bill to verify it</Link>
                                {canWrite && OPEN_FOR_DESK.includes(r.status) && (r.failed_checks.length > 0) && (
                                  // V1: back to the developer with exactly what failed.
                                  <button type="button" className="btn btn-sm btn-danger" style={{ marginLeft: 8 }} onClick={() => sendBack(r)}>Send back to the developer</button>
                                )}
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
      </>
      )}
      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
