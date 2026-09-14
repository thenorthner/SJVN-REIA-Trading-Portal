import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { PageHeader, Card, Badge, StatCard, Field, fmtNumber } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// Where each contract stands against its own timeline and obligations.
//
// The platform knew when a contract runs, when the project was commissioned, what
// security it requires against what is lodged, and whether the counterparty's
// approvals are in order. Nothing put those beside each other, so the questions a
// contract manager actually asks — which PPAs expire this quarter, which are live
// without their guarantee, whose licences have lapsed — had nowhere to be asked.

const STATE_TONE = { BREACH: 'danger', DUE: 'warning', OK: 'success', NOT_APPLICABLE: 'neutral' };
const STATE_LABEL = { BREACH: 'Not compliant', DUE: 'Action due', OK: 'In order', NOT_APPLICABLE: 'n/a' };
const FILTERS = [
  { key: '', label: 'Everything' },
  { key: 'BREACH', label: 'Not compliant' },
  { key: 'DUE', label: 'Action due' },
  { key: 'OK', label: 'In order' },
];

export default function ContractCompliance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [state, setState] = useState('');
  const [notice, setNotice] = useState(90);
  const [open, setOpen] = useState(null);

  function load(days = notice) {
    setLoading(true);
    setError('');
    api.reports.contractCompliance({ expiry_notice_days: days })
      .then(setData)
      .catch((err) => {
        setError(err?.response?.data?.error || 'Could not load contract compliance.');
        setData(null);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const rows = useMemo(
    () => (data?.contracts || []).filter((c) => !state || c.state === state),
    [data, state],
  );

  return (
    <div className="page">
      <PageHeader
        title="Contract Compliance"
        subtitle="Tenure, commissioning, capacity, payment security and statutory approvals — per contract"
        actions={<Link className="btn btn-outline" to="/reia/contracts">Open contracts</Link>}
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {loading && !data ? (
        <Card><div className="audit-placeholder">Loading…</div></Card>
      ) : !data ? null : (
        <>
          <div className="kpi-grid">
            <StatCard
              label="Not compliant"
              value={fmtNumber(data.totals.breach, 0)}
              hint="Live contracts failing a check"
              tone={data.totals.breach ? 'red' : 'green'}
            />
            <StatCard label="Action due" value={fmtNumber(data.totals.due, 0)} tone={data.totals.due ? 'amber' : 'default'} />
            <StatCard label="In order" value={fmtNumber(data.totals.ok, 0)} tone="green" />
            <StatCard
              label={`Expiring within ${data.expiry_notice_days} days`}
              value={fmtNumber(data.totals.expiring_within_notice, 0)}
              tone={data.totals.expiring_within_notice ? 'amber' : 'default'}
            />
          </div>

          <Card>
            <div className="report-toolbar">
              <div className="export-group">
                {FILTERS.map((f) => (
                  <button
                    key={f.key || 'all'}
                    type="button"
                    className={`btn btn-sm ${state === f.key ? 'btn-navy' : 'btn-outline'}`}
                    onClick={() => setState(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <label className="report-search">
                Notice window
                <input
                  type="number"
                  min="1"
                  className="input"
                  style={{ width: 90 }}
                  value={notice}
                  onChange={(e) => setNotice(Number(e.target.value))}
                  onBlur={() => load(notice)}
                />
                days
              </label>
            </div>

            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Contract</th>
                    <th scope="col">Counterparty</th>
                    <th scope="col">Status</th>
                    <th scope="col">Tenure</th>
                    <th scope="col" className="num">Ends in</th>
                    <th scope="col">COD</th>
                    <th scope="col" className="num">Capacity (MW)</th>
                    <th scope="col">Compliance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td className="empty-cell" colSpan={8}>No contract in this state.</td></tr>
                  ) : rows.map((c) => (
                    <React.Fragment key={c.contract_id}>
                      <tr className="clickable" onClick={() => setOpen(open === c.contract_id ? null : c.contract_id)}>
                        <td>{c.contract_no}<div className="audit-muted">{c.contract_type} · {c.project_type}</div></td>
                        <td>{c.counterparty || '—'}</td>
                        <td><Badge status={c.status}>{c.status}</Badge></td>
                        <td>{fmtDate(c.tenure_start)} → {fmtDate(c.tenure_end)}</td>
                        <td className="num">
                          {c.days_to_expiry == null ? '—' : c.days_to_expiry < 0 ? `${Math.abs(c.days_to_expiry)}d ago` : `${c.days_to_expiry}d`}
                        </td>
                        <td>{c.cod_date ? fmtDate(c.cod_date) : <span className="audit-muted">not on record</span>}</td>
                        <td className="num">
                          {fmtNumber(c.commissioned_capacity_mw)} / {fmtNumber(c.capacity_mw)}
                        </td>
                        <td>
                          <Badge type={STATE_TONE[c.state]}>{STATE_LABEL[c.state]}</Badge>
                          {c.breach_count + c.due_count > 0 && (
                            <div className="audit-muted">
                              {c.breach_count ? `${c.breach_count} failing` : ''}
                              {c.breach_count && c.due_count ? ', ' : ''}
                              {c.due_count ? `${c.due_count} due` : ''}
                            </div>
                          )}
                        </td>
                      </tr>
                      {open === c.contract_id && (
                        <tr>
                          <td colSpan={8} style={{ background: 'var(--navy-tint)' }}>
                            <div className="table-wrap">
                              <table className="data-table">
                                <tbody>
                                  {c.checks.map((k) => (
                                    <tr key={k.code}>
                                      <th scope="row" style={{ width: '28%', textAlign: 'left' }}>{k.label}</th>
                                      <td style={{ width: 140 }}><Badge type={STATE_TONE[k.state]}>{STATE_LABEL[k.state]}</Badge></td>
                                      <td>{k.detail}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
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
              Showing {rows.length} of {data.contracts.length} contracts. Click one to see each check.
              A contract that is not live is judged by what it is rather than held to a tenure it has left.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
