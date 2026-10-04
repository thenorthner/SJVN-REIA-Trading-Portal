import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../api/client';
import { Modal } from '../../components/ui';
import { fmtDate, fmtDateTime } from '../../datetime.js';
import { UserPlus, Shield, Power, PowerOff, ShieldCheck, Pencil, KeyRound, Unlock, History, Download, Check, Minus, Copy } from 'lucide-react';
import './Team-elite.css';

// The company's own users on the portal: who they are, what level each works
// at, when they last signed in — and, for the Company Admin or an Approver,
// adding people, changing their level, resetting a password and switching an
// account off.

const errText = (e) => e.response?.data?.error || e.message;
const avatarStyle = (m) => (m.tier === 'ADMIN' ? 'admin' : ['L2', 'L3'].includes(m.tier) ? 'checker' : '');

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A password an admin has to pass on, shown once. */
export function PasswordReveal({ name, email, password, onClose }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch { /* select-all on the box works as a fallback */ }
  }
  return (
    <div>
      <p style={{ margin: 0, fontSize: 14 }}>Give this temporary password to <strong>{name}</strong> ({email}). It is shown only this once.</p>
      <div className="elite-password" aria-label="Temporary password">{password}</div>
      <p className="elite-note">They will be asked to choose their own password as soon as they sign in. Pass it on by phone or in person rather than by email.</p>
      <div className="elite-modal-actions">
        <button type="button" className="elite-btn-cancel" onClick={copy}><Copy size={14} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" className="elite-btn-submit" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export function MemberForm({ roles, member, canRole, onSave, onCancel, noun = 'member', levelLabel = 'Access Level' }) {
  const adding = !member;
  const [f, setF] = useState({
    name: member?.name || '', email: member?.email || '', phone: member?.phone || '', designation: member?.designation || '',
    role: member?.role || '', own_password: false, password: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const chosen = roles.find((r) => r.value === f.role);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { name: f.name, phone: f.phone, designation: f.designation };
      if (adding) Object.assign(body, { email: f.email, role: f.role, ...(f.own_password ? { password: f.password } : {}) });
      else if (canRole && f.role !== member.role) body.role = f.role;
      await onSave(body);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error" style={{ marginBottom: '1rem' }}>{error}</div>}
      <div className="elite-field">
        <label htmlFor="tm-name">Full Name</label>
        <input id="tm-name" className="elite-input" required minLength={2} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Neha Sharma" />
      </div>
      {adding && (
        <div className="elite-field">
          <label htmlFor="tm-email">Email Address (their sign-in)</label>
          <input id="tm-email" className="elite-input" required type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} placeholder="neha@company.in" />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="elite-field">
          <label htmlFor="tm-desig">Designation</label>
          <input id="tm-desig" className="elite-input" value={f.designation} onChange={(e) => set({ designation: e.target.value })} placeholder="e.g. Accounts Officer" />
        </div>
        <div className="elite-field">
          <label htmlFor="tm-phone">Phone</label>
          <input id="tm-phone" className="elite-input" value={f.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+91 98765 43210" />
        </div>
      </div>
      {(adding || canRole) && (
        <div className="elite-field">
          <label htmlFor="tm-role">{levelLabel}</label>
          <select id="tm-role" className="elite-input" required value={f.role} onChange={(e) => set({ role: e.target.value })}>
            {adding && <option value="">Select…</option>}
            {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <p className="elite-note">
            <Shield size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
            {chosen ? chosen.does : 'Makers prepare; checkers review and submit to SJVN.'}
            {!adding && f.role !== member.role && ' Changing the level signs them out; it applies from their next sign-in.'}
          </p>
        </div>
      )}
      {adding && (
        <div className="elite-field">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}>
            <input type="checkbox" checked={f.own_password} onChange={(e) => set({ own_password: e.target.checked })} /> Set the temporary password myself
          </label>
          {f.own_password ? (
            <>
              <input className="elite-input" required type="text" minLength={8} value={f.password} onChange={(e) => set({ password: e.target.value })} placeholder="At least 8 characters, with a letter and a digit" aria-label="Temporary password" style={{ marginTop: 8 }} />
              <p className="elite-note">They will have to change it at first sign-in.</p>
            </>
          ) : <p className="elite-note">A temporary password is generated and shown to you once. They will have to change it at first sign-in.</p>}
        </div>
      )}
      <div className="elite-modal-actions">
        <button type="button" className="elite-btn-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="elite-btn-submit" disabled={busy}>{busy ? 'Saving...' : adding ? 'Add to team' : 'Save changes'}</button>
      </div>
    </form>
  );
}

export function Activity({ member, entityId, load = null }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { (load ? load(member.id) : api.team.activity(member.id, entityId)).then(setRows).catch((e) => setError(errText(e))); }, [member.id, entityId]);
  if (error) return <div className="form-error">{error}</div>;
  if (!rows) return <p className="elite-note">Loading…</p>;
  if (!rows.length) return <p className="elite-note">Nothing recorded for {member.name} yet.</p>;
  return (
    <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
      <table className="data-table">
        <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Where</th><th scope="col">On</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}><td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.at)}</td><td>{a.what}</td><td>{a.module}</td><td style={{ fontSize: 12, color: 'var(--slate-500)' }}>{a.on || '—'}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** @param entityId  the company whose team to show — for SJVN's admins; a company's own users see theirs */
export default function Team({ entityId = null }) {
  const [team, setTeam] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [tab, setTab] = useState('members');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('ACTIVE');
  const [modal, setModal] = useState(null); // { kind, member, ... }

  const load = useCallback(() => {
    setTeam(null);
    api.team.get(entityId).then(setTeam).catch((e) => setError(errText(e)));
  }, [entityId]);
  useEffect(load, [load]);
  useEffect(() => { if (tab === 'history') api.team.history(entityId).then(setHistory).catch((e) => setError(errText(e))); }, [tab, team, entityId]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (team?.members || []).filter((m) => {
      if (filter === 'ACTIVE' && !m.is_active) return false;
      if (filter === 'INACTIVE' && m.is_active) return false;
      if (['L1', 'L2', 'L3'].includes(filter) && (m.tier !== filter || !m.is_active)) return false;
      return !needle || [m.name, m.email, m.designation, m.phone].some((v) => String(v || '').toLowerCase().includes(needle));
    });
  }, [team, q, filter]);

  if (error && !team) return <div className="elite-team-container"><div className="form-error">{error}</div></div>;
  if (!team) return <div className="elite-team-container" style={{ textAlign: 'center', padding: '3rem', color: 'var(--slate-400)' }}>Loading team...</div>;

  const t = team.totals;
  const done = (fresh, message) => { setTeam(fresh.team || fresh); setModal(null); if (message) setFlash(message); };
  const act = async (fn, message) => {
    setError('');
    try { done(await fn(), message); } catch (err) { setError(errText(err)); }
  };

  async function exportCsv() {
    try { saveBlob(await api.team.exportCsv(entityId), `team-${new Date().toISOString().slice(0, 10)}.csv`); } catch (err) { setError(errText(err)); }
  }

  const chips = [['ACTIVE', 'Active', t.active], ['L1', 'Makers', t.makers], ['L2', 'Checkers', t.checkers], ['L3', 'Approvers', t.approvers], ['INACTIVE', 'Switched off', t.inactive], ['ALL', 'Everyone', team.members.length]];

  return (
    <div className="elite-team-container">
      <div className="elite-team-header">
        <div>
          <h1>{entityId ? team.entity?.name || 'Company users' : 'Team Management'}</h1>
          <p>{entityId ? 'This company\'s users on the portal. You can also reset or switch off its Company Admin account, which nobody inside the company can.' : `${team.entity?.name ? `${team.entity.name} — ` : ''}the people in your organisation on this portal, and what each may do.`}</p>
        </div>
        <div className="elite-header-actions">
          <button type="button" className="elite-ghost-btn" onClick={exportCsv}><Download size={16} /> Export</button>
          {team.can_manage && (
            <button type="button" className="elite-add-btn" onClick={() => { setError(''); setModal({ kind: 'add' }); }} disabled={t.seats_left === 0} title={t.seats_left === 0 ? `All ${t.seat_limit} seats are in use` : undefined}>
              <UserPlus size={18} /> Add Team Member
            </button>
          )}
        </div>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '1rem' }}>{error}</div>}
      {flash && <div className="elite-health green" role="status">{flash}</div>}

      <div className="elite-stats">
        <div className="elite-stat"><span>Active users</span><strong>{t.active}</strong><small>{t.seats_left} of {t.seat_limit} seats left</small></div>
        <div className="elite-stat"><span>Makers</span><strong>{t.makers}</strong><small>Level 1 — prepare</small></div>
        <div className="elite-stat"><span>Checkers</span><strong>{t.checkers}</strong><small>Level 2 — review &amp; submit</small></div>
        <div className="elite-stat"><span>Approvers</span><strong>{t.approvers}</strong><small>Level 3 — approve &amp; manage</small></div>
        <div className="elite-stat"><span>Never signed in</span><strong>{t.never_signed_in}</strong><small>{t.inactive} switched off</small></div>
      </div>

      {team.health.map((h) => <div key={h.text} className={`elite-health ${h.level}`} role={h.level === 'red' ? 'alert' : undefined}>{h.text}</div>)}

      <div className="nb-tabs" role="tablist" style={{ marginTop: '1rem' }}>
        {[['members', 'Members'], ['roles', 'Who can do what'], ['history', 'Change history']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`nb-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'members' && (
        <>
          <div className="elite-toolbar">
            <input className="elite-search" type="search" placeholder="Search by name, email, designation…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the team" />
            {chips.map(([k, l, n]) => <button key={k} type="button" className={`nb-chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}<small>{n}</small></button>)}
          </div>
          <div className="elite-team-grid">
            {shown.map((m) => (
              <div key={m.id} className={`elite-user-card ${!m.is_active ? 'inactive' : ''}`}>
                <div className="elite-card-top">
                  <div className={`elite-avatar ${avatarStyle(m)}`}>{m.name.charAt(0).toUpperCase()}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--slate-500)', fontWeight: 500 }}>
                    <div className={`elite-status-indicator ${!m.is_active ? 'inactive' : ''}`} />
                    {m.is_active ? 'Active' : 'Switched off'}
                  </div>
                </div>

                <div className="elite-user-info">
                  <h3>{m.name}{m.is_me && <span className="elite-you-badge">You</span>}</h3>
                  {m.designation && <p className="elite-meta"><strong>{m.designation}</strong></p>}
                  <p className="elite-meta">{m.email}{m.phone ? ` · ${m.phone}` : ''}</p>
                  <div className="elite-role-badge" style={{ marginTop: '0.6rem' }}>
                    <ShieldCheck size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }} />
                    {m.role_label}
                  </div>
                  <div className="elite-flags">
                    {m.locked && <span className="elite-flag red">Locked out · {m.locked_minutes} min</span>}
                    {m.is_active && m.must_change_password && <span className="elite-flag amber">Temporary password not yet changed</span>}
                    {m.is_active && m.never_signed_in && <span className="elite-flag blue">Never signed in</span>}
                  </div>
                  {!m.is_active && m.deactivation_reason && (
                    <p className="elite-meta" style={{ marginTop: '0.5rem' }}>Switched off {fmtDate(m.deactivated_at)}{m.deactivated_by_name ? ` by ${m.deactivated_by_name}` : ''} — {m.deactivation_reason}</p>
                  )}
                </div>

                <div className="elite-card-footer">
                  <div className="elite-joined">Added {fmtDate(m.created_at)}{m.created_by_name ? ` by ${m.created_by_name}` : ''}</div>
                  <div className="elite-joined">{m.last_login_at ? `Last sign-in ${fmtDateTime(m.last_login_at)}` : 'No sign-in yet'}{m.logins_30d ? ` · ${m.logins_30d} in 30 days` : ''}</div>
                </div>

                {(m.can.edit || m.can.reactivate || team.can_manage) && (
                  <div className="elite-card-actions">
                    {m.can.edit && <button type="button" className="elite-action" onClick={() => { setError(''); setModal({ kind: 'edit', member: m }); }}><Pencil size={13} /> {m.can.role ? 'Edit / change level' : 'Edit details'}</button>}
                    {m.can.unlock && <button type="button" className="elite-action go" onClick={() => act(() => api.team.unlock(m.id, entityId), `${m.name} can sign in again.`)}><Unlock size={13} /> Unlock</button>}
                    {m.can.reset_password && <button type="button" className="elite-action" onClick={() => { setError(''); setModal({ kind: 'reset', member: m }); }}><KeyRound size={13} /> Reset password</button>}
                    {(team.can_manage || m.is_me) && <button type="button" className="elite-action" onClick={() => setModal({ kind: 'activity', member: m })}><History size={13} /> Activity</button>}
                    {m.can.deactivate && <button type="button" className="elite-action danger" onClick={() => { setError(''); setModal({ kind: 'off', member: m, reason: '' }); }}><PowerOff size={13} /> Switch off</button>}
                    {m.can.reactivate && <button type="button" className="elite-action go" onClick={() => act(() => api.team.reactivate(m.id, entityId), `${m.name}'s account is switched back on.`)}><Power size={13} /> Switch on</button>}
                  </div>
                )}
              </div>
            ))}
            {shown.length === 0 && <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', color: 'var(--slate-500)' }}>Nobody matches.</div>}
          </div>
        </>
      )}

      {tab === 'roles' && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="table-wrap">
            <table className="data-table elite-matrix">
              <thead><tr><th scope="col">What</th><th scope="col">Maker (L1)</th><th scope="col">Checker (L2)</th><th scope="col">Approver (L3)</th><th scope="col">Company Admin</th></tr></thead>
              <tbody>
                {team.permissions.map((p) => (
                  <tr key={p.what}>
                    <td>{p.what}</td>
                    {['L1', 'L2', 'L3', 'ADMIN'].map((k) => <td key={k}>{p[k] ? <Check size={16} color="#15803d" aria-label="Yes" /> : <Minus size={16} color="#cbd5e1" aria-label="No" />}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="elite-note" style={{ marginTop: '1rem' }}>
            A maker's invoice is saved as a draft and goes to a checker; a checker's, approver's or admin's goes to SJVN directly. The Company Admin account is the one SJVN registered for your company — it cannot be switched off or re-levelled from here.
          </p>
        </div>
      )}

      {tab === 'history' && (
        <div className="table-wrap" style={{ marginTop: '1.5rem' }}>
          <table className="data-table">
            <thead><tr><th scope="col">When</th><th scope="col">Member</th><th scope="col">What</th><th scope="col">Detail</th><th scope="col">By</th></tr></thead>
            <tbody>
              {!history && <tr><td colSpan={5} className="empty-cell">Loading…</td></tr>}
              {history?.length === 0 && <tr><td colSpan={5} className="empty-cell">No changes to the team have been recorded yet.</td></tr>}
              {history?.map((h) => (
                <tr key={h.id}><td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(h.at)}</td><td>{h.member_name}</td><td>{h.what}</td><td>{h.detail || '—'}</td><td>{h.by}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal?.kind === 'add'} onClose={() => setModal(null)} title="Add Team Member" width={520}>
        {modal?.kind === 'add' && (
          <MemberForm roles={team.assignable_roles} onCancel={() => setModal(null)}
            onSave={async (body) => {
              const r = await api.team.add(body, entityId);
              setTeam(r.team);
              setFilter('ACTIVE');
              setModal({ kind: 'password', name: body.name, email: body.email, password: r.temporary_password });
            }} />
        )}
      </Modal>

      <Modal open={modal?.kind === 'edit'} onClose={() => setModal(null)} title={modal?.member ? `Edit — ${modal.member.name}` : ''} width={520}>
        {modal?.kind === 'edit' && (
          <MemberForm roles={team.assignable_roles} member={modal.member} canRole={modal.member.can.role} onCancel={() => setModal(null)}
            onSave={async (body) => done(await api.team.update(modal.member.id, body, entityId), `${body.name}'s details were saved.`)} />
        )}
      </Modal>

      <Modal open={modal?.kind === 'off'} onClose={() => setModal(null)} title={modal?.member ? `Switch off ${modal.member.name}'s account` : ''} width={480}>
        {modal?.kind === 'off' && (
          <form onSubmit={(e) => { e.preventDefault(); act(() => api.team.deactivate(modal.member.id, modal.reason, entityId), `${modal.member.name}'s account is switched off.`); }}>
            <p style={{ margin: '0 0 1rem', fontSize: 14 }}>They are signed out at once and cannot sign in again until the account is switched back on. What they have already done stays on record.</p>
            <div className="elite-field">
              <label htmlFor="tm-reason">Reason</label>
              <input id="tm-reason" className="elite-input" required value={modal.reason} onChange={(e) => setModal({ ...modal, reason: e.target.value })} placeholder="e.g. Left the company; moved to another department" />
            </div>
            <div className="elite-modal-actions">
              <button type="button" className="elite-btn-cancel" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="elite-btn-submit">Switch off</button>
            </div>
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
                  const r = await api.team.resetPassword(modal.member.id, entityId);
                  setTeam(r.team);
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
        {modal?.kind === 'activity' && <Activity member={modal.member} entityId={entityId} />}
      </Modal>
    </div>
  );
}
