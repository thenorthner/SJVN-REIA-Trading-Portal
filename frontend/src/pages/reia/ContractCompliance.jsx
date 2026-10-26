import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Badge, StatCard, Tabs, Tab, AlertPopup, fmtNumber } from '../../components/ui.jsx';
import ModuleGuide from '../../components/ModuleGuide.jsx';
import { getGuide } from '../../content/guides/index.js';
import { fmtDate } from '../../datetime.js';
import DeskTasksPanel from '../../components/DeskTasksPanel.jsx';

// Where each contract stands against its own timeline and obligations.
//
// The platform knew when a contract runs, when the project was commissioned, what
// security it requires against what is lodged, and whether the counterparty's
// approvals are in order. Nothing put those beside each other, so the questions a
// contract manager actually asks — which PPAs expire this quarter, which are live
// without their guarantee, whose licences have lapsed — had nowhere to be asked.

const STATE_TONE = { BREACH: 'danger', DUE: 'warning', OK: 'success', NOT_APPLICABLE: 'neutral', NOT_LIVE: 'neutral' };
const STATE_LABEL = { BREACH: 'Not compliant', DUE: 'Action due', OK: 'In order', NOT_APPLICABLE: 'n/a', NOT_LIVE: 'Not live' };
const FILTERS = [
  { key: '', label: 'Everything' },
  { key: 'BREACH', label: 'Not compliant' },
  { key: 'DUE', label: 'Action due' },
  { key: 'OK', label: 'In order' },
  { key: 'NOT_LIVE', label: 'Not live' },
];

export default function ContractCompliance({ embedded = false }) {
  const [view, setView] = useState('main');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [state, setState] = useState('');
  const [notice, setNotice] = useState('90');
  const [open, setOpen] = useState(null);
  const loaded = useRef(90);
  const { user } = useAuth() || {};
  // The REIA desk acts here; the administrators read (Target #2 Phase B).
  const canDesk = ['REIA_CHECKER', 'REIA_MAKER'].includes(user?.role);
  // Asking a counterparty for papers is the maker's (Phase B.2); a hold is either's.
  const canAsk = ['REIA_MAKER'].includes(user?.role);
  // Lifting a hold is the approver's: the REIA HOD or Management (ROLE_GROUPS.REIA_APPROVE).
  const canLift = ['MANAGEMENT', 'REIA_APPROVER'].includes(user?.role);
  const [holdForm, setHoldForm] = useState(null); // { contract, mode: HOLD|RELEASE|OVERRIDE, reason, valid_until }
  const [notice2, setNotice2] = useState(null);
  async function act(fn, done) {
    try { await fn(); setNotice2({ tone: 'success', title: done }); setHoldForm(null); load(); }
    catch (e) { setNotice2({ title: 'Not done', message: e.response?.data?.error || e.message }); }
  }

  function load(days = Number(notice)) {
    // An unusable window used to be replaced by 90 without a word.
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      setError('The notice window must be a whole number of days from 1 to 3650.');
      setNotice(String(loaded.current));
      return;
    }
    loaded.current = days;
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
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={async () => {
              try {
                const blob = await api.reports.contractComplianceXlsx();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `compliance-register-${new Date().toISOString().slice(0, 10)}.xlsx`;
                a.click(); URL.revokeObjectURL(url);
              } catch { setError('Could not prepare the compliance register.'); }
            }}>Export register (Excel)</button>
            <Link className="btn btn-outline" to="/reia/contracts">Open contracts</Link>
          </div>
        )}
      />

      <Tabs style={{ marginBottom: 18 }}>
        <Tab active={view === 'main'} onClick={() => setView('main')}>Contracts</Tab>
        <Tab active={view === 'fyi'} onClick={() => setView('fyi')}>FYI</Tab>
      </Tabs>

      {view === 'fyi' && <ModuleGuide guide={getGuide('compliance')} />}

      {view === 'main' && (
      <>
      <AlertPopup open={!!error} title="Could not show the register" message={error} onClose={() => setError('')} />
      <DeskTasksPanel desk="CONTRACT_COMPLIANCE" canWrite={['REIA_CHECKER', 'REIA_MAKER'].includes(user?.role)} />

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
            <StatCard label="In order" value={fmtNumber(data.totals.ok, 0)} tone={data.totals.ok ? 'green' : 'default'} hint={data.totals.not_live ? `${data.totals.not_live} not live, not counted` : undefined} />
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
                  step="1"
                  max="3650"
                  aria-label="Notice window in days"
                  value={notice}
                  onChange={(e) => setNotice(e.target.value)}
                  onBlur={() => { if (Number(notice) !== loaded.current || notice === '') load(notice === '' ? NaN : Number(notice)); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
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
                          {c.hold?.on_hold && <div><Badge type="danger">ON HOLD</Badge></div>}
                          {!c.hold?.on_hold && c.hold?.flagged && <div title={c.hold.flag_reason}><Badge type="warning">Would be held</Badge></div>}
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
                                    <tr key={`${k.code}-${k.label}`}>
                                      <th scope="row" style={{ width: '28%', textAlign: 'left' }}>{k.label}</th>
                                      <td style={{ width: 140 }}><Badge type={STATE_TONE[k.state]}>{STATE_LABEL[k.state]}</Badge></td>
                                      <td>
                                        {k.detail}
                                        {canAsk && ['BREACH', 'DUE'].includes(k.state) && ['SECURITY', 'APPROVALS', 'TENURE'].includes(k.code) && (
                                          // CC2: one click to ask the counterparty on the Document Desk.
                                          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={(e) => { e.stopPropagation(); act(() => api.contracts.complianceRequest(c.contract_id, k.code), 'Request sent to the counterparty'); }}>Ask the counterparty</button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                  <tr>
                                    <th scope="row" style={{ textAlign: 'left' }}>Hold</th>
                                    <td>{c.hold?.on_hold ? <Badge type="danger">On hold</Badge> : <Badge type="success">Not held</Badge>}</td>
                                    <td>
                                      {c.hold?.flagged && !c.hold?.on_hold && <div style={{ color: 'var(--amber-strong)' }}>Flag only (automatic hold is switched off): {c.hold.flag_reason}</div>}
                                      {c.hold?.reason || (c.hold?.override ? `Breach lifted by ${c.hold.override.approved_by} until ${fmtDate(c.hold.override.valid_until)}: ${c.hold.override.reason}` : 'New bills and scheduling go ahead.')}
                                      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                                        {canDesk && !c.hold?.manual && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHoldForm({ contract: c, mode: 'HOLD', reason: '' })}>Put on hold</button>}
                                        {(canDesk || canLift) && c.hold?.manual && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHoldForm({ contract: c, mode: 'RELEASE', reason: '' })}>Release hold</button>}
                                        {canLift && c.hold?.breaches?.length > 0 && !c.hold?.override && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHoldForm({ contract: c, mode: 'OVERRIDE', reason: '', valid_until: '' })}>Lift for a stated time</button>}
                                      </div>
                                      {holdForm?.contract?.contract_id === c.contract_id && (
                                        <form className="cw-form" onClick={(e) => e.stopPropagation()} onSubmit={(e) => {
                                          e.preventDefault();
                                          const f = holdForm;
                                          act(() => (f.mode === 'OVERRIDE' ? api.contracts.overrideHold(c.contract_id, { reason: f.reason, valid_until: f.valid_until }) : api.contracts.setHold(c.contract_id, f.mode === 'HOLD', f.reason)),
                                            f.mode === 'HOLD' ? 'Put on hold' : f.mode === 'RELEASE' ? 'Hold released' : 'Hold lifted');
                                        }}>
                                          <input required minLength={15} placeholder="Reason (at least 15 characters)" value={holdForm.reason} onChange={(e) => setHoldForm({ ...holdForm, reason: e.target.value })} style={{ minWidth: 280 }} />
                                          {holdForm.mode === 'OVERRIDE' && <input type="date" required min={new Date().toISOString().slice(0, 10)} max={new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)} value={holdForm.valid_until} onChange={(e) => setHoldForm({ ...holdForm, valid_until: e.target.value })} aria-label="Lifted until (30 days at most)" />}
                                          <button type="submit" className="btn btn-primary btn-sm">Save</button>
                                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHoldForm(null)}>Cancel</button>
                                        </form>
                                      )}
                                    </td>
                                  </tr>
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
              A contract that is not live (draft, terminated, expired) is listed as such and kept out of the counts.
              Payment security is the Payment Security desk&apos;s figure: instruments of the paying side in force today, net of draws.
            </p>
          </Card>
        </>
      )}
      </>
      )}
      <AlertPopup open={!!notice2} tone={notice2?.tone || 'error'} title={notice2?.title} message={notice2?.message} onClose={() => setNotice2(null)} />
    </div>
  );
}
