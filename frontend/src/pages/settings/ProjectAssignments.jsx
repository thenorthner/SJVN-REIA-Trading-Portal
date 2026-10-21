import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader, Card, Table, Badge, Modal, Field, AlertPopup } from '../../components/ui.jsx';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { fmtDate } from '../../datetime.js';

/**
 * Project assignments (Target #2, Phase C). Each REIA maker, checker and
 * approver works on all projects or on the ones chosen here. The panel at the
 * top lists any live project left with nobody to act at a tier — a scoped desk
 * otherwise stalls there without anyone noticing.
 *
 * Assigning is the SJVN / IT administrators'; Management and the auditor read.
 */
const TIER = { REIA_MAKER: 'Maker', REIA_CHECKER: 'Checker', REIA_APPROVER: 'Approver (HOD)' };
const TIER_LABEL = { maker: 'maker', checker: 'checker', approver: 'approver' };

export default function ProjectAssignments() {
  const { user } = useAuth();
  const canEdit = ['SJVN_ADMIN', 'IT_SUPER_ADMIN'].includes(user?.role);
  const [officers, setOfficers] = useState([]);
  const [cover, setCover] = useState({ projects: [], uncovered: [] });
  const [editing, setEditing] = useState(null);
  const [popup, setPopup] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.projectScope.users().then(setOfficers).catch((e) => setPopup({ tone: 'error', title: 'Could not load officers', message: e.response?.data?.error || e.message }));
    api.projectScope.coverage().then(setCover).catch(() => {});
  }, []);
  useEffect(load, [load]);

  function open(o) {
    setEditing({ ...o, scope: o.project_scope, chosen: new Set(o.projects.map((p) => p.contract_id)), filter: '' });
  }

  async function save() {
    if (editing.scope === 'SELECTED' && editing.chosen.size === 0) {
      setPopup({ tone: 'error', title: 'Choose a project', message: `Tick at least one project for ${editing.name}, or leave them on all projects.` });
      return;
    }
    setBusy(true);
    try {
      const r = await api.projectScope.set(editing.id, { scope: editing.scope, contract_ids: [...editing.chosen] });
      setEditing(null);
      load();
      if (r.newly_uncovered?.length) {
        setPopup({
          tone: 'warning',
          okLabel: 'Understood',
          title: 'Saved — but projects are now without cover',
          message: 'Nobody can act at these tiers on these projects until someone is assigned:',
          items: r.newly_uncovered.map((p) => ({ label: p.contract_no, message: `no ${p.missing.map((t) => TIER_LABEL[t]).join(', ')}` })),
        });
      }
    } catch (e) {
      setPopup({ tone: 'error', title: 'Not saved', message: e.response?.data?.error || e.message });
    } finally {
      setBusy(false);
    }
  }

  const shown = useMemo(() => {
    if (!editing) return [];
    const q = editing.filter.trim().toLowerCase();
    return cover.projects.filter((p) => !q || `${p.contract_no} ${p.seller_name || ''} ${p.buyer_name || ''} ${p.project_type || ''}`.toLowerCase().includes(q));
  }, [editing, cover.projects]);

  const names = (list) => (list.length ? list.map((u) => `${u.name}${u.scope === 'ALL' ? ' (all)' : ''}`).join(', ') : '—');

  return (
    <div>
      <PageHeader title="Project Assignments" subtitle="Which REIA projects each maker, checker and approver works on" />

      <section aria-labelledby="cover-h" style={{ marginBottom: 16 }}>
        {cover.uncovered.length === 0 ? (
          <div className="alert alert-success" role="status" id="cover-h">
            All {cover.projects.length} live REIA project(s) have a maker, a checker and an approver who can act on them.
          </div>
        ) : (
          <Card title={<span id="cover-h">Projects without cover ({cover.uncovered.length})</span>}>
            <p style={{ marginTop: 0 }}>Nobody can take the next step at these tiers. Assign an officer, or put one back on all projects.</p>
            <Table
              caption="Projects without full cover"
              columns={[
                { key: 'contract_no', header: 'Project (contract)' },
                { key: 'party', header: 'Seller / buyer', render: (p) => p.seller_name || p.buyer_name || '—' },
                { key: 'missing', header: 'No one at', render: (p) => p.missing.map((t) => <Badge key={t} status="REJECTED" label={TIER_LABEL[t]} />) },
              ]}
              rows={cover.uncovered}
            />
          </Card>
        )}
      </section>

      <Card title="REIA officers">
        <Table
          caption="REIA officers and their projects"
          emptyMessage="No active REIA makers, checkers or approvers."
          columns={[
            { key: 'name', header: 'Officer', render: (o) => <><strong>{o.name}</strong><div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{o.email}</div></> },
            { key: 'role', header: 'Tier', render: (o) => TIER[o.role] || o.role },
            { key: 'scope', header: 'Works on', render: (o) => (o.project_scope === 'SELECTED' ? <Badge status="PENDING" label={`${o.projects.length} selected`} /> : <Badge status="ACTIVE" label="All projects" />) },
            { key: 'projects', header: 'Projects', render: (o) => (o.project_scope === 'SELECTED' ? o.projects.map((p) => p.contract_no).join(', ') : '—') },
            ...(canEdit ? [{ key: 'edit', header: <span className="sr-only">Change</span>, render: (o) => <button type="button" className="btn btn-sm" onClick={() => open(o)}>Change<span className="sr-only"> projects of {o.name}</span></button> }] : []),
          ]}
          rows={officers}
        />
      </Card>

      <Card title="Who covers each project" style={{ marginTop: 16 }}>
        <Table
          caption="Cover by project and tier"
          columns={[
            { key: 'contract_no', header: 'Project (contract)' },
            { key: 'type', header: 'Type', render: (p) => `${p.contract_type || ''} · ${p.project_type || ''}${p.capacity_mw ? ` · ${p.capacity_mw} MW` : ''}` },
            { key: 'maker', header: 'Makers', render: (p) => names(p.who.maker) },
            { key: 'checker', header: 'Checkers', render: (p) => names(p.who.checker) },
            { key: 'approver', header: 'Approvers', render: (p) => names(p.who.approver) },
            { key: 'covered', header: 'Cover', render: (p) => <Badge status={p.covered ? 'ACTIVE' : 'REJECTED'} label={p.covered ? 'Full' : `No ${p.missing.join(', ')}`} /> },
          ]}
          rows={cover.projects}
        />
      </Card>

      <Modal open={!!editing} onClose={() => !busy && setEditing(null)} title={editing ? `Projects — ${editing.name} (${TIER[editing.role]})` : ''}>
        {editing && (
          <div style={{ display: 'grid', gap: 14 }}>
            <Field label="Works on" htmlFor="pa-scope">
              <select id="pa-scope" className="select" value={editing.scope} onChange={(e) => setEditing({ ...editing, scope: e.target.value })}>
                <option value="ALL">All REIA projects</option>
                <option value="SELECTED">Only the projects ticked below</option>
              </select>
            </Field>
            {editing.scope === 'SELECTED' && (
              <>
                <Field label="Find a project" htmlFor="pa-filter">
                  <input id="pa-filter" value={editing.filter} placeholder="Contract no., seller, buyer or type" onChange={(e) => setEditing({ ...editing, filter: e.target.value })} />
                </Field>
                <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, maxHeight: '45vh', overflow: 'auto' }}>
                  <legend style={{ padding: '0 6px' }}>{editing.chosen.size} project(s) ticked</legend>
                  {shown.map((p) => (
                    <label key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 2px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={editing.chosen.has(p.id)}
                        onChange={(e) => {
                          const next = new Set(editing.chosen);
                          if (e.target.checked) next.add(p.id); else next.delete(p.id);
                          setEditing({ ...editing, chosen: next });
                        }}
                      />
                      <span>
                        <strong>{p.contract_no}</strong> — {p.seller_name || p.buyer_name || 'counterparty not set'}
                        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)' }}>
                          {p.contract_type} · {p.project_type}{p.capacity_mw ? ` · ${p.capacity_mw} MW` : ''} · {String(p.status).replaceAll('_', ' ').toLowerCase()}
                        </span>
                      </span>
                    </label>
                  ))}
                  {shown.length === 0 && <p style={{ margin: 0 }}>No project matches.</p>}
                </fieldset>
                {editing.projects.length > 0 && (
                  <p className="inline-note" style={{ margin: 0 }}>Assigned since: {editing.projects.map((p) => `${p.contract_no} (${fmtDate(p.assigned_at)})`).join(', ')}</p>
                )}
              </>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        )}
      </Modal>

      <AlertPopup open={!!popup} {...(popup || {})} onClose={() => setPopup(null)} />
    </div>
  );
}
