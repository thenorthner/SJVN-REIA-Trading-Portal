import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import { Modal } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';
import { UserPlus, ShieldCheck, Power, PowerOff, Pencil, KeyRound, Unlock, History, Download, Check, Minus } from 'lucide-react';
import { PasswordReveal, MemberForm, Activity } from '../shared/Team.jsx';
import '../shared/Team-elite.css';

// SJVN's own users on the platform: who holds which role, when each last signed
// in, and — for an administrator — adding officers, moving them between desks,
// resetting a password and switching an account off.

const errText = (e) => e.response?.data?.error || e.message;
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function StaffUsers() {
  const [d, setD] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [tab, setTab] = useState('members');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('ACTIVE');
  const [modal, setModal] = useState(null);

  const load = useCallback(() => { api.staff.get().then(setD).catch((e) => setError(errText(e))); }, []);
  useEffect(load, [load]);
  useEffect(() => { if (tab === 'history') api.staff.history().then(setHistory).catch((e) => setError(errText(e))); }, [tab, d]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (d?.members || []).filter((m) => {
      if (filter === 'ACTIVE' && !m.is_active) return false;
      if (filter === 'INACTIVE' && m.is_active) return false;
      if (!['ACTIVE', 'INACTIVE', 'ALL'].includes(filter) && (m.desk !== filter || !m.is_active)) return false;
      return !needle || [m.name, m.email, m.designation, m.phone, m.role_label].some((v) => String(v || '').toLowerCase().includes(needle));
    });
  }, [d, q, filter]);

  if (error && !d) return <div className="elite-team-container"><div className="form-error">{error}</div></div>;
  if (!d) return <div className="elite-team-container" style={{ textAlign: 'center', padding: '3rem', color: 'var(--slate-400)' }}>Loading users...</div>;

  const t = d.totals;
  const done = (fresh, message) => { setD(fresh.team || fresh); setModal(null); if (message) setFlash(message); };
  const act = async (fn, message) => {
    setError('');
    try { done(await fn(), message); } catch (err) { setError(errText(err)); }
  };
  const chips = [['ACTIVE', 'Active', t.active], ...t.by_desk.map((x) => [x.desk, x.desk, x.count]), ['INACTIVE', 'Switched off', t.inactive], ['ALL', 'Everyone', d.members.length]];
  const cols = d.role_order;

  return (
    <div className="elite-team-container">
      <div className="elite-team-header">
        <div>
          <h1>SJVN Users</h1>
          <p>{d.sees_everyone ? 'SJVN\'s own officers on the platform, the role each holds, and what that role reaches.' : 'The users of your desk. The platform\'s administrators manage the other desks.'}</p>
        </div>
        <div className="elite-header-actions">
          <button type="button" className="elite-ghost-btn" onClick={() => api.staff.exportCsv().then((b) => saveBlob(b, `sjvn-users-${new Date().toISOString().slice(0, 10)}.csv`)).catch((e) => setError(errText(e)))}><Download size={16} /> Export</button>
          <button type="button" className="elite-add-btn" onClick={() => { setError(''); setModal({ kind: 'add' }); }}><UserPlus size={18} /> Add User</button>
        </div>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '1rem' }}>{error}</div>}
      {flash && <div className="elite-health green" role="status">{flash}</div>}

      <div className="elite-stats">
        <div className="elite-stat"><span>Active users</span><strong>{t.active}</strong><small>{t.inactive} switched off</small></div>
        <div className="elite-stat"><span>Administrators</span><strong>{t.admins}</strong><small>Can add users and reset passwords</small></div>
        {t.by_desk.filter((x) => x.desk !== 'Administration').slice(0, 4).map((x) => (
          <div key={x.desk} className="elite-stat"><span>{x.desk}</span><strong>{x.count}</strong><small>active</small></div>
        ))}
        <div className="elite-stat"><span>Never signed in</span><strong>{t.never_signed_in}</strong><small>of the active users</small></div>
      </div>

      {d.health.map((h) => <div key={h.text} className={`elite-health ${h.level}`} role={h.level === 'red' ? 'alert' : undefined}>{h.text}</div>)}

      <div className="nb-tabs" role="tablist" style={{ marginTop: '1rem' }}>
        {[['members', 'Users'], ['roles', 'Roles and what they reach'], ['history', 'Change history']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`nb-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'members' && (
        <>
          <div className="elite-toolbar">
            <input className="elite-search" type="search" placeholder="Search by name, email, role…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
            {chips.map(([k, l, n]) => <button key={k} type="button" className={`nb-chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}<small>{n}</small></button>)}
          </div>
          <div className="elite-team-grid">
            {shown.map((m) => (
              <div key={m.id} className={`elite-user-card ${!m.is_active ? 'inactive' : ''}`}>
                <div className="elite-card-top">
                  <div className={`elite-avatar ${m.is_admin ? 'admin' : m.desk === 'Finance' || m.desk === 'Management' ? 'checker' : ''}`}>{m.name.charAt(0).toUpperCase()}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--slate-500)', fontWeight: 500 }}>
                    <div className={`elite-status-indicator ${!m.is_active ? 'inactive' : ''}`} />{m.is_active ? 'Active' : 'Switched off'}
                  </div>
                </div>
                <div className="elite-user-info">
                  <h3>{m.name}{m.is_me && <span className="elite-you-badge">You</span>}</h3>
                  {m.designation && <p className="elite-meta"><strong>{m.designation}</strong></p>}
                  <p className="elite-meta">{m.email}{m.phone ? ` · ${m.phone}` : ''}</p>
                  <div className="elite-role-badge" style={{ marginTop: '0.6rem' }}>
                    <ShieldCheck size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }} />{m.role_label}
                  </div>
                  <div className="elite-flags">
                    {m.locked && <span className="elite-flag red">Locked out · {m.locked_minutes} min</span>}
                    {m.is_active && m.must_change_password && <span className="elite-flag amber">Temporary password not yet changed</span>}
                    {m.is_active && m.never_signed_in && <span className="elite-flag blue">Never signed in</span>}
                  </div>
                  {!m.is_active && m.deactivation_reason && <p className="elite-meta" style={{ marginTop: '0.5rem' }}>Switched off {fmtDate(m.deactivated_at)}{m.deactivated_by_name ? ` by ${m.deactivated_by_name}` : ''} — {m.deactivation_reason}</p>}
                </div>
                <div className="elite-card-footer">
                  <div className="elite-joined">Added {fmtDate(m.created_at)}{m.created_by_name ? ` by ${m.created_by_name}` : ''}</div>
                  <div className="elite-joined">{m.last_login_at ? `Last sign-in ${fmtDateTime(m.last_login_at)}` : 'No sign-in yet'}{m.logins_30d ? ` · ${m.logins_30d} in 30 days` : ''}</div>
                </div>
                <div className="elite-card-actions">
                  {m.can.edit && <button type="button" className="elite-action" onClick={() => { setError(''); setModal({ kind: 'edit', member: m }); }}><Pencil size={13} /> {m.can.role ? 'Edit / change role' : 'Edit details'}</button>}
                  {m.can.unlock && <button type="button" className="elite-action go" onClick={() => act(() => api.staff.unlock(m.id), `${m.name} can sign in again.`)}><Unlock size={13} /> Unlock</button>}
                  {m.can.reset_password && <button type="button" className="elite-action" onClick={() => { setError(''); setModal({ kind: 'reset', member: m }); }}><KeyRound size={13} /> Reset password</button>}
                  <button type="button" className="elite-action" onClick={() => setModal({ kind: 'activity', member: m })}><History size={13} /> Activity</button>
                  {m.can.deactivate && <button type="button" className="elite-action danger" onClick={() => { setError(''); setModal({ kind: 'off', member: m, reason: '' }); }}><PowerOff size={13} /> Switch off</button>}
                  {m.can.reactivate && <button type="button" className="elite-action go" onClick={() => act(() => api.staff.reactivate(m.id), `${m.name}'s account is switched back on.`)}><Power size={13} /> Switch on</button>}
                </div>
              </div>
            ))}
            {shown.length === 0 && <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', color: 'var(--slate-500)' }}>Nobody matches.</div>}
          </div>
        </>
      )}

      {tab === 'roles' && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th scope="col">Role</th><th scope="col">Desk</th><th scope="col">What it is for</th><th scope="col">Active users</th></tr></thead>
              <tbody>{d.roles.map((r) => <tr key={r.role}><td><strong>{r.label}</strong></td><td>{r.desk}</td><td>{r.does}</td><td>{r.count}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="table-wrap" style={{ marginTop: '1.5rem' }}>
            <table className="data-table elite-matrix">
              <thead><tr><th scope="col">What</th>{cols.map((r) => <th key={r} scope="col" style={{ fontSize: 11 }}>{d.roles.find((x) => x.role === r)?.label}</th>)}</tr></thead>
              <tbody>
                {d.access.map((a) => (
                  <tr key={a.what}><td>{a.what}</td>
                    {cols.map((r) => <td key={r}>{a.by[r] === 'Full' ? <Check size={16} color="#15803d" aria-label="Full" /> : a.by[r] ? <span style={{ fontSize: 11, color: 'var(--slate-600)' }}>{a.by[r]}</span> : <Minus size={16} color="#cbd5e1" aria-label="None" />}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="elite-note" style={{ marginTop: '1rem' }}>A tick is full use of the section; "Read" is seeing without changing. Changing someone's role signs them out, and the new role applies from their next sign-in.</p>
        </div>
      )}

      {tab === 'history' && (
        <div className="table-wrap" style={{ marginTop: '1.5rem' }}>
          <table className="data-table">
            <thead><tr><th scope="col">When</th><th scope="col">User</th><th scope="col">What</th><th scope="col">Detail</th><th scope="col">By</th></tr></thead>
            <tbody>
              {!history && <tr><td colSpan={5} className="empty-cell">Loading…</td></tr>}
              {history?.length === 0 && <tr><td colSpan={5} className="empty-cell">No changes have been recorded yet.</td></tr>}
              {history?.map((h) => <tr key={h.id}><td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(h.at)}</td><td>{h.member_name}</td><td>{h.what}</td><td>{h.detail || '—'}</td><td>{h.by}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal?.kind === 'add'} onClose={() => setModal(null)} title="Add an SJVN user" width={520}>
        {modal?.kind === 'add' && (
          <MemberForm roles={d.assignable_roles} levelLabel="Role" onCancel={() => setModal(null)}
            onSave={async (body) => {
              const r = await api.staff.add(body);
              setD(r.team); setFilter('ACTIVE');
              setModal({ kind: 'password', name: body.name, email: body.email, password: r.temporary_password });
            }} />
        )}
      </Modal>
      <Modal open={modal?.kind === 'edit'} onClose={() => setModal(null)} title={modal?.member ? `Edit — ${modal.member.name}` : ''} width={520}>
        {modal?.kind === 'edit' && (
          <MemberForm roles={d.assignable_roles} member={modal.member} canRole={modal.member.can.role} levelLabel="Role" onCancel={() => setModal(null)}
            onSave={async (body) => done(await api.staff.update(modal.member.id, body), `${body.name}'s details were saved.`)} />
        )}
      </Modal>
      <Modal open={modal?.kind === 'off'} onClose={() => setModal(null)} title={modal?.member ? `Switch off ${modal.member.name}'s account` : ''} width={480}>
        {modal?.kind === 'off' && (
          <form onSubmit={(e) => { e.preventDefault(); act(() => api.staff.deactivate(modal.member.id, modal.reason), `${modal.member.name}'s account is switched off.`); }}>
            <p style={{ margin: '0 0 1rem', fontSize: 14 }}>They are signed out at once and cannot sign in again until the account is switched back on. What they have done stays on record.</p>
            <div className="elite-field">
              <label htmlFor="st-reason">Reason</label>
              <input id="st-reason" className="elite-input" required value={modal.reason} onChange={(e) => setModal({ ...modal, reason: e.target.value })} placeholder="e.g. Transferred; retired; left SJVN" />
            </div>
            <div className="elite-modal-actions"><button type="button" className="elite-btn-cancel" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="elite-btn-submit">Switch off</button></div>
          </form>
        )}
      </Modal>
      <Modal open={modal?.kind === 'reset'} onClose={() => setModal(null)} title={modal?.member ? `Reset ${modal.member.name}'s password` : ''} width={480}>
        {modal?.kind === 'reset' && (
          <div>
            <p style={{ margin: 0, fontSize: 14 }}>A new temporary password is generated. Their current password stops working, they are signed out everywhere, and they must choose a new one at next sign-in.</p>
            <div className="elite-modal-actions">
              <button type="button" className="elite-btn-cancel" onClick={() => setModal(null)}>Cancel</button>
              <button type="button" className="elite-btn-submit" onClick={async () => {
                setError('');
                try {
                  const r = await api.staff.resetPassword(modal.member.id);
                  setD(r.team);
                  setModal({ kind: 'password', name: modal.member.name, email: modal.member.email, password: r.temporary_password });
                } catch (err) { setError(errText(err)); setModal(null); }
              }}>Reset password</button>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={modal?.kind === 'password'} onClose={() => setModal(null)} title="Temporary password" width={460}>
        {modal?.kind === 'password' && <PasswordReveal name={modal.name} email={modal.email} password={modal.password} onClose={() => setModal(null)} />}
      </Modal>
      <Modal open={modal?.kind === 'activity'} onClose={() => setModal(null)} title={modal?.member ? `Activity — ${modal.member.name}` : ''} width={760}>
        {modal?.kind === 'activity' && <Activity member={modal.member} load={(id) => api.staff.activity(id)} />}
      </Modal>
    </div>
  );
}
