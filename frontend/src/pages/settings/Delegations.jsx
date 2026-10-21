import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader, Card, Table, Badge, Field, AlertPopup, Modal } from '../../components/ui.jsx';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { fmtDateTime } from '../../datetime.js';
import { switchTo } from '../../components/ActingSwitch.jsx';

/**
 * Additional charge and break-glass (Target #2, Phase D) — so four-eyes and
 * project scope never leave a desk with nobody able to act.
 *
 *  - Additional charge: the SJVN / IT administrator records who holds an absent
 *    officer's charge, for dated days. The holder switches to "acting for" them.
 *  - Break-glass: a desk officer asks for a role for a few hours; it opens on two
 *    approvals (one from Management, neither the requester) and closes by itself.
 */
const DESK_ROLES = ['REIA_MAKER', 'REIA_CHECKER', 'REIA_APPROVER', 'COMMERCIAL_ADMIN', 'COMMERCIAL', 'THERMAL_ADMIN', 'THERMAL_USER', 'TRADING_USER', 'TRADING_ADMIN', 'FINANCE_USER', 'MANAGEMENT'];
const ADMINS = ['SJVN_ADMIN', 'IT_SUPER_ADMIN'];
const READERS = [...ADMINS, 'MANAGEMENT', 'COMPLIANCE_AUDITOR'];
const HOURS = [1, 2, 4, 8, 12, 24, 48, 72];
const label = (r) => String(r || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bReia\b/g, 'REIA');
const STATE_TONE = { IN_FORCE: 'ACTIVE', UPCOMING: 'PENDING', ENDED: 'CLOSED', REVOKED: 'REJECTED' };
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export default function Delegations() {
  const { user } = useAuth();
  const myRole = user?.real_role || user?.role;
  const isAdmin = ADMINS.includes(myRole);
  const canRead = READERS.includes(myRole);
  const canAsk = DESK_ROLES.includes(myRole) && !user?.acting;

  const [mine, setMine] = useState(null);
  const [charges, setCharges] = useState([]);
  const [grants, setGrants] = useState([]);
  const [staff, setStaff] = useState([]);
  const [projects, setProjects] = useState([]);
  const [popup, setPopup] = useState(null);
  const [ask, setAsk] = useState({ role: '', hours: 4, reason: '' });
  const [give, setGive] = useState(null);
  const [refusing, setRefusing] = useState(null);

  const say = (title, e) => setPopup({ tone: 'error', title, message: e.response?.data?.error || e.message });
  const load = useCallback(() => {
    api.delegations.mine().then(setMine).catch(() => {});
    api.delegations.breakGlass().then(setGrants).catch(() => {});
    if (canRead) api.delegations.list().then(setCharges).catch(() => {});
    if (isAdmin) {
      api.staff.get().then((r) => setStaff((r.members || []).filter((m) => m.is_active))).catch(() => {});
      api.projectScope.projects().then(setProjects).catch(() => {});
    }
  }, [canRead, isAdmin]);
  useEffect(load, [load]);

  async function submitAsk(e) {
    e.preventDefault();
    const problems = [];
    if (!ask.role) problems.push({ label: 'Role', message: 'Choose the role you need.' });
    if (ask.reason.trim().length < 15) problems.push({ label: 'Reason', message: 'Say what cannot wait, and why nobody who holds the role can act (at least 15 characters).' });
    if (problems.length) { setPopup({ tone: 'error', title: 'Please fix the following', items: problems }); return; }
    try {
      await api.delegations.askBreakGlass({ ...ask, hours: Number(ask.hours) });
      setAsk({ role: '', hours: 4, reason: '' });
      setPopup({ tone: 'success', title: 'Request sent', message: 'Two approvers — one from Management — must agree before it opens. You will be notified.' });
      load();
    } catch (err) { say('Not sent', err); }
  }

  async function submitGive() {
    const problems = [];
    if (!give.delegator_id) problems.push({ label: 'Officer away', message: 'Choose who is away.' });
    if (!give.delegate_id) problems.push({ label: 'Holder', message: 'Choose who holds the charge.' });
    if (give.delegator_id && give.delegator_id === give.delegate_id) problems.push({ label: 'Holder', message: 'An officer cannot hold their own charge.' });
    if (!give.valid_from || !give.valid_to) problems.push({ label: 'Dates', message: 'Give the first and last day.' });
    if (give.valid_from && give.valid_to && give.valid_to < give.valid_from) problems.push({ label: 'Dates', message: 'The charge ends before it starts.' });
    if (give.reason.trim().length < 5) problems.push({ label: 'Reason', message: 'Say why (leave, tour, training …) and the office order, if any.' });
    if (problems.length) { setPopup({ tone: 'error', title: 'Please fix the following', items: problems }); return; }
    try {
      await api.delegations.give({ ...give, contract_ids: give.contract_ids.length ? give.contract_ids : undefined });
      setGive(null);
      load();
    } catch (err) { say('Not recorded', err); }
  }

  const away = useMemo(() => staff.filter((m) => DESK_ROLES.includes(m.role)), [staff]);
  const holders = useMemo(() => staff.filter((m) => !ADMINS.includes(m.role) && m.role !== 'COMPLIANCE_AUDITOR'), [staff]);
  const awayRole = away.find((m) => m.id === give?.delegator_id)?.role;

  return (
    <div>
      <PageHeader title="Additional Charge & Break-glass" subtitle="Who acts for an absent officer, and emergency access on two approvals" />

      {mine && mine.options.length > 0 && (
        <Card title="You can act as">
          <Table
            caption="Charges and grants you hold"
            columns={[
              { key: 'what', header: 'Charge', render: (o) => (o.kind === 'BG' ? <><Badge status="REJECTED" label="Break-glass" /> {label(o.role)}</> : <>For <strong>{o.for_name}</strong> — {label(o.role)}{o.projects ? ` (${o.projects} project${o.projects === 1 ? '' : 's'})` : ''}</>) },
              { key: 'until', header: 'Until', render: (o) => (o.kind === 'BG' ? fmtDateTime(o.until) : o.until) },
              { key: 'act', header: <span className="sr-only">Act</span>, render: (o) => <button type="button" className="btn btn-sm btn-primary" onClick={() => switchTo(o.value)}>Act now</button> },
            ]}
            rows={mine.options}
          />
        </Card>
      )}

      <Card title="Break-glass" style={{ marginTop: 16 }}>
        {canAsk && (
          <form onSubmit={submitAsk} noValidate style={{ display: 'grid', gap: 12, maxWidth: 720, marginBottom: 16 }}>
            <p className="inline-note" style={{ margin: 0 }}>For when work cannot wait and nobody who holds the role can act. It opens only after two approvals and closes by itself; everything you change under it is flagged.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
              <Field label="Role needed" required htmlFor="bg-role">
                <select id="bg-role" className="select" value={ask.role} onChange={(e) => setAsk({ ...ask, role: e.target.value })}>
                  <option value="">Select…</option>
                  {DESK_ROLES.filter((r) => r !== myRole).map((r) => <option key={r} value={r}>{label(r)}</option>)}
                </select>
              </Field>
              <Field label="For" htmlFor="bg-hours">
                <select id="bg-hours" className="select" value={ask.hours} onChange={(e) => setAsk({ ...ask, hours: e.target.value })}>
                  {HOURS.map((h) => <option key={h} value={h}>{h} hour{h === 1 ? '' : 's'}</option>)}
                </select>
              </Field>
            </div>
            <Field label="What cannot wait, and why nobody who holds the role can act" required htmlFor="bg-reason">
              <textarea id="bg-reason" rows={3} maxLength={1000} value={ask.reason} onChange={(e) => setAsk({ ...ask, reason: e.target.value })} />
            </Field>
            <div><button type="submit" className="btn btn-primary">Ask for break-glass</button></div>
          </form>
        )}
        <Table
          caption="Break-glass requests and grants"
          emptyMessage="No break-glass requests."
          columns={[
            { key: 'user_name', header: 'Officer', render: (g) => `${g.user_name} (${label(g.user_role)})` },
            { key: 'role', header: 'Role asked', render: (g) => `${label(g.role)} · ${g.hours} h` },
            { key: 'reason', header: 'Reason' },
            { key: 'approvals', header: 'Approved by', render: (g) => [g.approver1_name, g.approver2_name].filter(Boolean).join(', ') || '—' },
            { key: 'status', header: 'Status', render: (g) => <><Badge status={g.status === 'ACTIVE' ? 'ACTIVE' : g.status === 'REQUESTED' ? 'PENDING' : g.status === 'REJECTED' ? 'REJECTED' : 'CLOSED'} label={g.status.toLowerCase()} />{g.status === 'ACTIVE' && <div style={{ fontSize: 12.5 }}>until {fmtDateTime(g.expires_at)}</div>}</> },
            {
              key: 'act', header: <span className="sr-only">Decide</span>, render: (g) => (
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {g.can_approve && <button type="button" className="btn btn-sm btn-primary" onClick={async () => { try { const r = await api.delegations.approveBreakGlass(g.id); if (r.message) setPopup({ tone: 'info', title: 'Recorded', message: r.message }); load(); } catch (e) { say('Not approved', e); } }}>Approve</button>}
                  {g.can_approve && <button type="button" className="btn btn-sm" onClick={() => setRefusing({ id: g.id, reason: '' })}>Refuse</button>}
                  {['REQUESTED', 'ACTIVE'].includes(g.status) && (g.user_id === user?.id || isAdmin) && (
                    <button type="button" className="btn btn-sm" onClick={async () => { try { await api.delegations.endBreakGlass(g.id); load(); } catch (e) { say('Not ended', e); } }}>End</button>
                  )}
                </span>
              ),
            },
          ]}
          rows={grants}
        />
      </Card>

      {canRead && (
        <Card
          title="Additional charges"
          style={{ marginTop: 16 }}
          actions={isAdmin && <button type="button" className="btn btn-primary btn-sm" onClick={() => setGive({ delegator_id: '', delegate_id: '', valid_from: today(), valid_to: '', reason: '', contract_ids: [] })}>Record a charge</button>}
        >
          <Table
            caption="Additional charges"
            emptyMessage="No additional charges recorded."
            columns={[
              { key: 'who', header: 'Charge', render: (d) => <><strong>{d.delegate_name}</strong> holds <strong>{d.delegator_name}</strong>’s</> },
              { key: 'role', header: 'Role', render: (d) => label(d.role) },
              { key: 'dates', header: 'Days', render: (d) => `${d.valid_from} → ${d.valid_to}` },
              { key: 'projects', header: 'Projects', render: (d) => (d.contract_ids_json ? `${JSON.parse(d.contract_ids_json).length} named` : 'All theirs') },
              { key: 'reason', header: 'Reason' },
              { key: 'state', header: 'State', render: (d) => <Badge status={STATE_TONE[d.state]} label={d.state.replace('_', ' ').toLowerCase()} /> },
              ...(isAdmin ? [{ key: 'x', header: <span className="sr-only">Withdraw</span>, render: (d) => (['IN_FORCE', 'UPCOMING'].includes(d.state) ? <button type="button" className="btn btn-sm" onClick={async () => { try { await api.delegations.withdraw(d.id); load(); } catch (e) { say('Not withdrawn', e); } }}>Withdraw</button> : null) }] : []),
            ]}
            rows={charges}
          />
        </Card>
      )}

      <Modal open={!!give} onClose={() => setGive(null)} title="Record an additional charge" width="compact">
        {give && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Officer who is away" required htmlFor="dg-from">
              <select id="dg-from" className="select" value={give.delegator_id} onChange={(e) => setGive({ ...give, delegator_id: e.target.value, contract_ids: [] })}>
                <option value="">Select…</option>
                {away.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.role_label || label(m.role)}</option>)}
              </select>
            </Field>
            <Field label="Officer who holds the charge" required htmlFor="dg-to">
              <select id="dg-to" className="select" value={give.delegate_id} onChange={(e) => setGive({ ...give, delegate_id: e.target.value })}>
                <option value="">Select…</option>
                {holders.filter((m) => m.id !== give.delegator_id).map((m) => <option key={m.id} value={m.id}>{m.name} — {m.role_label || label(m.role)}</option>)}
              </select>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="From" required htmlFor="dg-start"><input id="dg-start" type="date" value={give.valid_from} onChange={(e) => setGive({ ...give, valid_from: e.target.value })} /></Field>
              <Field label="To (up to 90 days)" required htmlFor="dg-end"><input id="dg-end" type="date" value={give.valid_to} min={give.valid_from} onChange={(e) => setGive({ ...give, valid_to: e.target.value })} /></Field>
            </div>
            {String(awayRole || '').startsWith('REIA_') && projects.length > 0 && (
              <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                <legend style={{ padding: '0 6px' }}>Only these projects (leave all unticked for all of theirs)</legend>
                {projects.map((p) => (
                  <label key={p.id} style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
                    <input type="checkbox" checked={give.contract_ids.includes(p.id)} onChange={(e) => setGive({ ...give, contract_ids: e.target.checked ? [...give.contract_ids, p.id] : give.contract_ids.filter((x) => x !== p.id) })} />
                    <span>{p.contract_no}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <Field label="Reason and office order" required htmlFor="dg-reason"><textarea id="dg-reason" rows={2} value={give.reason} onChange={(e) => setGive({ ...give, reason: e.target.value })} /></Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setGive(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={submitGive}>Record</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!refusing} onClose={() => setRefusing(null)} title="Refuse break-glass" width="compact">
        {refusing && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Why it is refused" required htmlFor="bg-refuse"><textarea id="bg-refuse" rows={3} value={refusing.reason} onChange={(e) => setRefusing({ ...refusing, reason: e.target.value })} /></Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setRefusing(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={async () => {
                if (refusing.reason.trim().length < 5) { setPopup({ tone: 'error', title: 'Reason needed', message: 'Say why it is refused; the officer sees this.' }); return; }
                try { await api.delegations.rejectBreakGlass(refusing.id, refusing.reason); setRefusing(null); load(); } catch (e) { say('Not refused', e); }
              }}>Refuse</button>
            </div>
          </div>
        )}
      </Modal>

      <AlertPopup open={!!popup} {...(popup || {})} onClose={() => setPopup(null)} />
    </div>
  );
}
