import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import CufTrackerCard from '../../components/CufTrackerCard.jsx';
import DeveloperScorecardCard from '../../components/DeveloperScorecardCard.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { REIA_BETA } from '../../reiaBeta.js';
import { PageHeader, Card, Badge, StatCard, Field, AlertPopup, fmtNumber, fmtCurrency } from '../../components/ui.jsx';

// What each project generated against what its contract expects.
//
// The platform held the energy, the capacity and each contract's minimum CUF, and
// worked the shortfall out when a bill was raised — but nothing showed the
// performance itself, so "which projects are underperforming, and since when" meant
// reading invoices one at a time.

const pct = (v) => (v == null ? '—' : `${fmtNumber(v, 2)}%`);
// Who may raise a note (the notes desk's own writers); a second person approves it there.
// A true-up note is drafted by the maker or Finance (routes/notes.js, Phase B.2).
const CAN_RAISE = [...new Set([...ROLE_GROUPS.REIA_MAKE, 'FINANCE_USER'])];
const YEAR_STATE = {
  IN_PROGRESS: { tone: 'neutral', label: 'Year in progress' },
  AWAITING_ENERGY: { tone: 'warning', label: 'Waiting on locked energy' },
  MET: { tone: 'success', label: 'CUF met' },
  DUE: { tone: 'danger', label: 'True-up due' },
  NOTE_RAISED: { tone: 'info', label: 'Note raised' },
};

function cufBadge(row) {
  if (row.meets_cuf == null) return <span className="audit-muted">capacity not on record</span>;
  return row.meets_cuf
    ? <Badge type="success">{pct(row.actual_cuf_percent)}</Badge>
    : <Badge type="danger">{pct(row.actual_cuf_percent)}</Badge>;
}

export default function GenerationPerformance() {
  const { user } = useAuth();
  const [range, setRange] = useState({ from: '', to: '' });
  const [notice, setNotice] = useState('');
  const raising = useRef(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [project, setProject] = useState('');

  function load(next = range) {
    // A reversed range used to come back as an empty page, which reads as
    // "nothing was generated".
    if (next.from && next.to && next.from > next.to) {
      setError(`The range starts (${next.from}) after it ends (${next.to}). Pick a From month on or before the To month.`);
      return;
    }
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

  async function raiseTrueUp(y) {
    if (raising.current) return;
    raising.current = true;
    try {
      const res = await api.notes.cufTrueUp(y.contract_id, y.contract_year);
      setNotice(`Credit note of ${fmtCurrency(res.penalty)} raised as a draft on ${res.anchor_invoice?.invoice_no} for ${y.contract_no}, contract year ${y.contract_year}. It takes effect when someone else approves it on the notes desk.`);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || 'The true-up note could not be raised.');
    } finally {
      raising.current = false;
    }
  }

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

      <AlertPopup open={!!error} title="Not done" message={error} onClose={() => setError('')} />
      <AlertPopup open={!!notice} tone="success" title="True-up raised" message={notice} onClose={() => setNotice('')} />

      <CufTrackerCard />
      <DeveloperScorecardCard />

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
            <StatCard
              label="CUF true-up due"
              value={fmtCurrency(totals.true_up_due_amount)}
              hint={`${fmtNumber(totals.true_up_due, 0)} finished contract year${totals.true_up_due === 1 ? '' : 's'} short, no note raised yet`}
              tone={totals.true_up_due ? 'red' : 'green'}
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
                      tabIndex={0}
                      aria-selected={project === p.contract_id}
                      onClick={() => setProject(project === p.contract_id ? '' : p.contract_id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setProject(project === p.contract_id ? '' : p.contract_id); } }}
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

          <Card title="Contract-year CUF and the year-end true-up">
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Contract</th>
                    <th scope="col">Contract year</th>
                    <th scope="col" className="num">Months</th>
                    <th scope="col" className="num">Energy (MWh)</th>
                    <th scope="col" className="num">CUF</th>
                    <th scope="col" className="num">Required</th>
                    <th scope="col" className="num">Shortfall (MWh)</th>
                    <th scope="col" className="num">True-up</th>
                    <th scope="col">Assessment</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.contract_years || []).length === 0 ? (
                    <tr><td className="empty-cell" colSpan={9}>No solar, wind or hybrid contract with a tenure on record.</td></tr>
                  ) : data.contract_years.map((y) => (
                    <tr key={`${y.contract_id}-${y.contract_year}`}>
                      <td>{y.contract_no}<div className="audit-muted">{y.contract_type} · {y.project_type}</div></td>
                      <td>{y.contract_year}<div className="audit-muted">{y.year_start} → {y.year_end}</div></td>
                      <td className="num">{y.months_counted}</td>
                      <td className="num">{fmtNumber(y.energy_mwh)}</td>
                      <td className="num">{pct(y.cuf_percent)}</td>
                      <td className="num">{pct(y.min_cuf_percent)}</td>
                      <td className="num">{y.shortfall_mwh ? fmtNumber(y.shortfall_mwh) : '—'}</td>
                      <td className="num">{y.penalty ? fmtCurrency(y.penalty) : '—'}</td>
                      <td>
                        <Badge type={YEAR_STATE[y.state]?.tone || 'neutral'}>{YEAR_STATE[y.state]?.label || y.state}</Badge>
                        {y.state === 'AWAITING_ENERGY' && y.months_missing?.length > 0 && (
                          <div className="audit-muted">Not locked: {y.months_missing.join(', ')}</div>
                        )}
                        {y.state === 'NOTE_RAISED' && y.note && (
                          <div className="audit-muted">{y.note.note_no} · {y.note.status}</div>
                        )}
                        {y.state === 'DUE' && (
                          y.anchor_invoice
                            ? (CAN_RAISE.includes(user?.role) && (
                              <button type="button" className="btn btn-sm btn-outline" style={{ marginTop: 4 }} onClick={() => raiseTrueUp(y)}>
                                Raise true-up note
                              </button>
                            ))
                            : <div className="audit-muted">No bill presented in the year to set it against</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="report-count">
              CUF is assessed over the contract year (counted from the tenure start, from the COD in the first year), not month by month.
              Once a year is over and every month of it is locked, its shortfall is settled by a credit note on the year&apos;s last bill,
              approved by a second person under Debit / Credit Notes on <Link to="/reia/invoices">Billing &amp; Invoicing</Link>.
            </p>
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
              The monthly shortfall is an indicator; nothing is deducted for a month on its own.
              CUF is the energy accounted against what the commissioned capacity could produce in that month,
              for solar, wind and hybrid PPAs{REIA_BETA ? '.' : ' (hydro stations are measured on plant availability, not CUF).'}
              One reading a month, the one billing uses: locked first, then final, then the latest.
              Months up to {data.judged_up_to}; the month in progress is judged once it is over.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
