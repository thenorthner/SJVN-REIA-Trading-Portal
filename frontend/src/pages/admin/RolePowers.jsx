import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import { Modal, AlertPopup } from '../../components/ui.jsx';
import { fmtDateTime } from '../../datetime.js';
import { Check, X, Lock, Download, RotateCcw, Plus, Minus, UserPlus } from 'lucide-react';
import { MakeRole, MadeRolePanel } from './MakeRole.jsx';
import '../shared/Team-elite.css';
import './RolePowers.css';

// What each of SJVN's roles may do, as powers × roles: a tick where the role
// holds a power, a cross where it does not. Who holds what by default is read
// from the platform's own access rules, so the matrix shows what the system
// really allows. A platform administrator changes a cell with a reason; the
// server enforces it at once, tells the role's users and keeps it on the audit
// trail (backend/src/services/rolePowers.js). An administrator may also make
// a role from any combination of powers the rules allow (MakeRole.jsx).

const errText = (e) => e.response?.data?.error || e.message;
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const STATE = { all: 'Holds this power', some: 'Holds part of this power', none: 'Does not hold this power' };
const SHORT = { all: 'Yes', some: 'Partly', none: 'No' };
const ACTIONS = {
  give: { label: 'Give the power', verb: 'Give', icon: Plus },
  take: { label: 'Take the power away', verb: 'Take away', icon: Minus },
  reset: { label: 'Return to the platform default', verb: 'Return to default', icon: RotateCcw },
};
const MIN_REASON = 15;

function Mark({ state }) {
  if (state === 'all') return <Check size={18} strokeWidth={2.6} aria-hidden="true" />;
  if (state === 'some') return <span className="rp-half" aria-hidden="true" />;
  return <X size={16} strokeWidth={2.2} aria-hidden="true" />;
}

export default function RolePowers() {
  const [d, setD] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [tab, setTab] = useState('matrix');
  const [q, setQ] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [area, setArea] = useState('');
  const [cell, setCell] = useState(null); // { power, role }
  const [making, setMaking] = useState(false);
  const [madeOpen, setMadeOpen] = useState(null); // a made role's code

  const load = useCallback(() => { api.rolePowers.get().then(setD).catch((e) => setError(errText(e))); }, []);
  useEffect(load, [load]);
  useEffect(() => { if (tab === 'history') api.rolePowers.history().then(setHistory).catch((e) => setError(errText(e))); }, [tab, d]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (d?.powers || []).filter((p) => {
      if (area && p.area !== area) return false;
      if (onlyChanged && !Object.values(p.cells).some((c) => c.changed)) return false;
      return !needle || [p.label, p.does, p.area, p.kind_label].some((v) => String(v || '').toLowerCase().includes(needle));
    });
  }, [d, q, onlyChanged, area]);

  if (error && !d) return <div className="elite-team-container"><div className="form-error">{error}</div></div>;
  if (!d) return <div className="elite-team-container" style={{ textAlign: 'center', padding: '3rem', color: 'var(--slate-500)' }}>Loading role powers…</div>;

  const areas = d.areas.filter((a) => shown.some((p) => p.area === a));
  const open = cell && { power: d.powers.find((p) => p.key === cell.power), role: d.roles.find((r) => r.role === cell.role) };
  const made = d.roles.filter((r) => r.custom);
  const madePanel = madeOpen && d.roles.find((r) => r.role === madeOpen);
  const done = (fresh, message) => { setD(fresh); setCell(null); setMaking(false); setMadeOpen(null); setFlash(message); };

  return (
    <div className="elite-team-container">
      <div className="elite-team-header">
        <div>
          <h1>Role Powers</h1>
          <p>What each of SJVN&apos;s roles may do. A tick is a power the role holds, a cross one it does not. {d.can_edit ? 'Click a cell to give or take away a power, or make a new role from any combination of powers — with a reason, on the record.' : 'Only the platform administrators change it; you can read it and its history.'}</p>
        </div>
        <div className="elite-header-actions">
          {d.can_edit && <button type="button" className="elite-btn-submit rp-make-btn" onClick={() => { setFlash(''); setMaking(true); }}><UserPlus size={16} aria-hidden="true" /> Make a role</button>}
          <button type="button" className="btn btn-secondary elite-ghost-btn" onClick={() => api.rolePowers.exportCsv().then((b) => saveBlob(b, `role-powers-${new Date().toISOString().slice(0, 10)}.csv`)).catch((e) => setError(errText(e)))}><Download size={16} /> Export</button>
        </div>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '1rem' }}>{error}</div>}
      {flash && <div className="elite-health green" role="status">{flash}</div>}

      <div className="elite-stats">
        <div className="elite-stat"><span>Powers</span><strong>{d.powers.length}</strong><small>in {d.areas.length} areas</small></div>
        <div className="elite-stat"><span>Roles</span><strong>{d.roles.length}</strong><small>{d.roles.reduce((n, r) => n + r.users, 0)} active users{made.length ? ` · ${made.length} made here` : ''}</small></div>
        <div className="elite-stat"><span>Changed from default</span><strong>{d.changed}</strong><small>{d.changed ? 'cells an administrator changed' : 'everything as the platform gives it'}</small></div>
      </div>

      <div className="nb-tabs" role="tablist" style={{ marginTop: '1rem' }}>
        {[['matrix', 'Powers by role'], ['history', 'Change history']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`nb-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'matrix' && (
        <>
          <div className="elite-toolbar">
            <input className="elite-search" type="search" placeholder="Search powers…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search powers" />
            <select className="elite-input rp-select" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Show one area">
              <option value="">All areas</option>
              {d.areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button type="button" className={`nb-chip ${onlyChanged ? 'active' : ''}`} onClick={() => setOnlyChanged(!onlyChanged)} aria-pressed={onlyChanged}>Changed only<small>{d.changed}</small></button>
          </div>

          <div className="rp-legend" aria-hidden="true">
            <span><span className="rp-cell all mini"><Check size={14} strokeWidth={2.6} /></span> Holds</span>
            <span><span className="rp-cell some mini"><span className="rp-half" /></span> Holds part (hover for which)</span>
            <span><span className="rp-cell none mini"><X size={13} /></span> Does not hold</span>
            <span><span className="rp-cell all mini changed"><Check size={14} strokeWidth={2.6} /></span> Changed by an administrator</span>
            {d.can_edit && <span><Lock size={13} /> Cannot be changed — click to see why</span>}
          </div>

          <div className="table-wrap rp-wrap">
            <table className="data-table rp-table">
              <thead>
                <tr>
                  <th scope="col" className="rp-power-col">Power</th>
                  {d.roles.map((r) => (
                    <th key={r.role} scope="col" className={`rp-role-col ${r.custom ? 'made' : ''}`}>
                      {r.custom ? (
                        <button type="button" className="rp-role-btn" onClick={() => { setFlash(''); setMadeOpen(r.role); }} title={`${r.description} Works like ${r.base_label}.`}>
                          <span className="rp-role-name">{r.label}</span>
                          <span className="rp-made-tag">Made here</span>
                        </button>
                      ) : <span className="rp-role-name">{r.label}</span>}
                      <span className="rp-role-users">{r.users} {r.users === 1 ? 'user' : 'users'}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {areas.map((a) => (
                  <React.Fragment key={a}>
                    <tr className="rp-area"><th scope="colgroup" colSpan={d.roles.length + 1}><span>{a}</span></th></tr>
                    {shown.filter((p) => p.area === a).map((p) => (
                      <tr key={p.key}>
                        <th scope="row" className="rp-power-col">
                          <div className="rp-power-label">{p.label}<span className={`rp-kind ${p.kind}`}>{p.kind_label}</span></div>
                          <div className="rp-power-does">{p.does}</div>
                        </th>
                        {d.roles.map((r) => {
                          const c = p.cells[r.role];
                          const editable = !!(c.give?.ok || c.take?.ok || c.reset?.ok);
                          return (
                            <td key={r.role} className="rp-cell-td">
                              <button
                                type="button"
                                className={`rp-cell ${c.state} ${c.changed ? 'changed' : ''}`}
                                aria-label={`${p.label} — ${r.label}: ${STATE[c.state]}${c.changed ? ', changed by an administrator' : ''}`}
                                title={`${r.label}: ${STATE[c.state]}${c.changed ? ` (changed; the platform default is ${SHORT[c.default].toLowerCase()})` : ''}`}
                                onClick={() => { setFlash(''); setCell({ power: p.key, role: r.role }); }}
                              >
                                <Mark state={c.state} />
                                {d.can_edit && !editable && <Lock size={11} className="rp-lock" aria-hidden="true" />}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                {shown.length === 0 && <tr><td colSpan={d.roles.length + 1} className="empty-cell">No power matches.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="elite-note" style={{ marginTop: '1rem' }}>
            Who holds a power by default is read from the platform&apos;s own access rules. A role made here starts with the powers of the role it works like and does that role&apos;s work wherever no power is listed; click its name for what it is for, to rename it or to retire it. A change applies at once on every screen and action of the power; the role&apos;s users are told and see their menu change when they next open the portal. Some changes are never allowed — a maker also checking, an administrator transacting, the auditor changing data, a power left with nobody — and a locked cell says which rule holds it.
          </p>
        </>
      )}

      {tab === 'history' && (
        <div className="table-wrap" style={{ marginTop: '1.5rem' }}>
          <table className="data-table">
            <thead><tr><th scope="col">When</th><th scope="col">By</th><th scope="col">Power</th><th scope="col">Role</th><th scope="col">Change</th><th scope="col">Reason</th><th scope="col">Reference</th></tr></thead>
            <tbody>
              {!history && <tr><td colSpan={7} className="empty-cell">Loading…</td></tr>}
              {history?.length === 0 && <tr><td colSpan={7} className="empty-cell">No role power has been changed and no role made yet. Every role has its powers as the platform gives them.</td></tr>}
              {history?.map((h) => (
                <tr key={h.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(h.at)}</td>
                  <td>{h.by}<div className="elite-meta">{h.by_role}</div></td>
                  <td>{h.power_label || '—'}</td>
                  <td>{h.role_label}{h.users_affected != null && <div className="elite-meta">{h.users_affected} active {h.users_affected === 1 ? 'user' : 'users'}</div>}</td>
                  <td><strong>{h.what}</strong><div className="elite-meta">{h.kind === 'role' ? h.change : `${h.from} → ${h.to}`}</div></td>
                  <td>{h.reason}</td>
                  <td>{h.reference || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!open} onClose={() => setCell(null)} title={open ? `${open.power.label} — ${open.role.label}` : ''} width={620}>
        {open && (
          <CellPanel power={open.power} role={open.role} canEdit={d.can_edit} onClose={() => setCell(null)}
            onDone={done} />
        )}
      </Modal>
      <Modal open={making} onClose={() => setMaking(false)} title="Make a role" width={860}>
        {making && <MakeRole d={d} onClose={() => setMaking(false)} onDone={done} />}
      </Modal>
      <Modal open={!!madePanel} onClose={() => setMadeOpen(null)} title={madePanel ? `${madePanel.label} — a role made here` : ''} width={640}>
        {madePanel && <MadeRolePanel role={madePanel} canEdit={d.can_edit} onClose={() => setMadeOpen(null)} onDone={done} />}
      </Modal>
    </div>
  );
}

/** One cell: where it stands, why, what it covers, and — for an administrator — the change. */
function CellPanel({ power, role, canEdit, onClose, onDone }) {
  const c = power.cells[role.role];
  const offers = Object.entries(ACTIONS).filter(([k]) => c[k]);
  const allowed = offers.filter(([k]) => c[k].ok);
  const [action, setAction] = useState(allowed.length === 1 ? allowed[0][0] : '');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [popup, setPopup] = useState(null);
  const [actions, setActions] = useState(null);

  const reasonProblem = () => (reason.trim().length < MIN_REASON ? `Write the reason in a sentence — at least ${MIN_REASON} characters. It goes on the audit trail and to ${role.label}'s users.` : null);

  async function submit(e) {
    e.preventDefault();
    const problems = [!action && 'Choose what to do with the power.', reasonProblem()].filter(Boolean);
    if (problems.length) { setPopup({ title: 'Before this can be saved', items: problems }); return; }
    setBusy(true);
    try {
      const body = { power: power.key, role: role.role, reason: reason.trim(), reference: reference.trim() };
      const fresh = action === 'reset' ? await api.rolePowers.reset(body) : await api.rolePowers.change({ ...body, give: action === 'give' });
      const now = fresh.powers.find((p) => p.key === power.key).cells[role.role].state;
      onDone(fresh, `${role.label} — "${power.label}": ${STATE[now].toLowerCase()}. It applies at once; ${role.users} active ${role.users === 1 ? 'user was' : 'users were'} told.`);
    } catch (err) {
      setBusy(false);
      setPopup({ title: 'The change was not made', message: errText(err) });
    }
  }

  return (
    <div className="rp-panel">
      <div className="rp-now">
        <span className={`rp-cell ${c.state} ${c.changed ? 'changed' : ''}`}><Mark state={c.state} /></span>
        <div>
          <strong>{STATE[c.state]}</strong>
          <div className="elite-meta">{c.changed ? `Changed by an administrator — the platform default is "${SHORT[c.default]}".` : 'As the platform gives it.'} {power.kind_label} · {role.users} active {role.users === 1 ? 'user' : 'users'}</div>
        </div>
      </div>
      <p className="rp-does">{power.does}</p>
      {c.changed && (
        <div className="elite-health blue">
          {c.by || 'An administrator'} changed this on {fmtDateTime(c.at)}: &ldquo;{c.reason}&rdquo;{c.reference ? ` (ref. ${c.reference})` : ''}
        </div>
      )}
      {power.fixed && <div className="elite-health amber">{power.fixed}</div>}

      <div className="rp-actions-list">
        <button type="button" className="rp-link" onClick={() => (actions ? setActions(null) : api.rolePowers.actions(power.key).then(setActions).catch((e) => setPopup({ title: 'Could not load the actions', message: errText(e) })))}>
          {actions ? 'Hide' : 'Show'} the {power.actions} {power.actions === 1 ? 'action' : 'actions'} this power covers
        </button>
        {actions && (
          <ul>
            {actions.map((a) => (
              <li key={`${a.method} ${a.path}`}>
                <code>{a.method} {a.path.replace(/^\/api/, '')}</code>
                {a.decided_by === 'screen' ? <span className="elite-meta"> — the screen decides who</span> : !a.roles.includes(role.role) && <span className="elite-meta"> — not open to this role</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canEdit && offers.length > 0 && (
        <form onSubmit={submit} noValidate>
          <fieldset className="rp-choice">
            <legend>What to do</legend>
            {offers.map(([k, a]) => (
              <label key={k} className={`rp-option ${c[k].ok ? '' : 'blocked'} ${action === k ? 'chosen' : ''}`}>
                <input type="radio" name="rp-action" value={k} checked={action === k} disabled={!c[k].ok} onChange={() => setAction(k)} />
                <span>
                  <strong><a.icon size={14} aria-hidden="true" /> {a.label}</strong>
                  {!c[k].ok && <span className="rp-why"><Lock size={12} aria-hidden="true" /> {c[k].why}</span>}
                </span>
              </label>
            ))}
          </fieldset>
          {allowed.length > 0 && (
            <>
              <div className="elite-field">
                <label htmlFor="rp-reason">Reason <span aria-hidden="true">*</span></label>
                <textarea id="rp-reason" className="elite-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                  onBlur={() => { if (reason.trim() && reasonProblem()) setPopup({ title: 'Reason too short', message: reasonProblem(), tone: 'warning' }); }}
                  placeholder="e.g. HOD approves releases while Finance is short-staffed, till 31 Dec" />
              </div>
              <div className="elite-field">
                <label htmlFor="rp-ref">Office order / note reference</label>
                <input id="rp-ref" className="elite-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional, e.g. OO/REIA/2026/14" maxLength={80} />
              </div>
              <p className="elite-note" style={{ marginTop: 0 }}>Applies at once to {role.users} active {role.users === 1 ? 'user' : 'users'} of {role.label}, who are told by notification. The change, its reason and who made it go on the audit trail.</p>
            </>
          )}
          <div className="elite-modal-actions">
            <button type="button" className="elite-btn-cancel" onClick={onClose} disabled={busy}>Cancel</button>
            {allowed.length > 0 && <button type="submit" className="elite-btn-submit" disabled={busy}>{busy ? 'Saving…' : action ? ACTIONS[action].label : 'Save'}</button>}
          </div>
        </form>
      )}
      {(!canEdit || offers.length === 0) && (
        <div className="elite-modal-actions"><button type="button" className="elite-btn-cancel" onClick={onClose}>Close</button></div>
      )}

      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
