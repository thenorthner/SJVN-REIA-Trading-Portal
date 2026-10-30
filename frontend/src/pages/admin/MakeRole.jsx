import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import { AlertPopup } from '../../components/ui.jsx';
import { fmtDateTime } from '../../datetime.js';
import { Lock, Pencil, Archive, AlertTriangle } from 'lucide-react';

// Making a role on Role Powers: a name, what it is for, the role it works like
// (whose unlisted work it does, and whose powers it starts with), then the
// combination of powers it holds. The server checks the combination against
// the platform's rules as it changes (backend/src/services/rolePowers.js,
// newRoleProblems), so a power that cannot be given says why beside it.

const errText = (e) => e.response?.data?.error || e.message;
const MIN_REASON = 15;
const MIN_PURPOSE = 15;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function aboutProblems(f) {
  return [
    f.label.trim().length < 3 && 'Give the role a name of at least 3 characters.',
    f.description.trim().length < MIN_PURPOSE && `Say what the role is for, in a sentence — at least ${MIN_PURPOSE} characters.`,
    !f.base && 'Choose the role it works like.',
    f.reason.trim().length < MIN_REASON && `Write the reason in a sentence — at least ${MIN_REASON} characters. It goes on the audit trail.`,
  ].filter(Boolean);
}

/** Why a power cannot be ticked for this base at all, whatever else is ticked. */
function fixedWhy(p, baseState) {
  if (baseState !== 'none') return null;
  if (p.kind === 'governance') return 'Governance stays with the platform administrators';
  if (!p.givable) return 'Decided on its own screens — it is not given from here';
  return null;
}

export function MakeRole({ d, onClose, onDone }) {
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ label: '', description: '', base: '', reason: '', reference: '' });
  const [ticks, setTicks] = useState(() => new Set());
  const [verdict, setVerdict] = useState(null);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [popup, setPopup] = useState(null);

  const byKey = useMemo(() => new Map(d.powers.map((p) => [p.key, p])), [d]);
  const base = d.bases.find((b) => b.role === f.base);
  const stateIn = (p, role) => p.cells[role]?.state || 'none';
  const baseTicks = (role) => new Set(d.powers.filter((p) => stateIn(p, role) !== 'none').map((p) => p.key));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Each change to the combination is checked against the rules on the server.
  useEffect(() => {
    if (step !== 2 || !f.base) return undefined;
    setChecking(true);
    const t = setTimeout(() => {
      api.rolePowers.checkRole({ base: f.base, powers: [...ticks] })
        .then(setVerdict)
        .catch((e) => setPopup({ title: 'Could not check the powers', message: errText(e) }))
        .finally(() => setChecking(false));
    }, 250);
    return () => clearTimeout(t);
  }, [step, f.base, ticks]);

  function chooseBase(role) {
    setF({ ...f, base: role });
    setTicks(baseTicks(role));
    setVerdict(null);
    setNote('');
  }

  function toggle(p) {
    const next = new Set(ticks);
    if (next.has(p.key)) {
      next.delete(p.key);
      setNote('');
    } else {
      next.add(p.key);
      // A power is no use without the one its screens open from: tick that too, and say so.
      const added = (p.needs || []).filter((k) => !next.has(k));
      added.forEach((k) => next.add(k));
      setNote(added.length ? `Also ticked "${added.map((k) => byKey.get(k)?.label).join('", "')}" — "${p.label}" works from those screens.` : '');
    }
    setTicks(next);
  }

  function next(e) {
    e.preventDefault();
    const problems = aboutProblems(f);
    if (problems.length) { setPopup({ title: 'Before the powers', items: problems }); return; }
    setStep(2);
  }

  async function make() {
    if (verdict?.problems?.length) {
      setPopup({ title: 'This combination breaks a rule', items: verdict.problems.map((x) => (x.power ? `${byKey.get(x.power)?.label || x.power}: ${x.why}` : x.why)) });
      return;
    }
    setBusy(true);
    try {
      const fresh = await api.rolePowers.makeRole({ ...f, label: f.label.trim(), description: f.description.trim(), reason: f.reason.trim(), reference: f.reference.trim(), powers: [...ticks] });
      onDone(fresh, `The role "${f.label.trim()}" was made. Give it to officers on SJVN Users; its column is on the right of the matrix.`);
    } catch (err) {
      setBusy(false);
      const items = err.response?.data?.problems?.map((x) => (x.power ? `${byKey.get(x.power)?.label || x.power}: ${x.why}` : x.why));
      setPopup({ title: 'The role was not made', message: items ? undefined : errText(err), items });
    }
  }

  const problemOf = (key) => verdict?.problems?.find((x) => x.power === key)?.why;
  const general = verdict?.problems?.filter((x) => !x.power) || [];
  const needle = q.trim().toLowerCase();
  const rows = d.powers.filter((p) => !needle || [p.label, p.does, p.area].some((v) => String(v).toLowerCase().includes(needle)));
  const areas = d.areas.filter((a) => rows.some((p) => p.area === a));
  const desks = [...new Set(d.bases.map((b) => b.desk))];

  return (
    <div className="rp-panel rp-make">
      <ol className="rp-steps" aria-label="Steps">
        <li className={step === 1 ? 'current' : 'done'}><span>1</span> About the role</li>
        <li className={step === 2 ? 'current' : ''}><span>2</span> Its powers</li>
      </ol>

      {step === 1 && (
        <form onSubmit={next} noValidate>
          <div className="elite-field">
            <label htmlFor="mr-label">Name <span aria-hidden="true">*</span></label>
            <input id="mr-label" className="elite-input" value={f.label} onChange={set('label')} maxLength={60} placeholder="e.g. Solar Bill Checker"
              onBlur={() => { if (f.label.trim() && f.label.trim().length < 3) setPopup({ title: 'Name too short', message: 'Give the role a name of at least 3 characters.', tone: 'warning' }); }} />
          </div>
          <div className="elite-field">
            <label htmlFor="mr-desc">What it is for <span aria-hidden="true">*</span></label>
            <textarea id="mr-desc" className="elite-input" rows={2} value={f.description} onChange={set('description')} maxLength={300}
              placeholder="e.g. Approves the first level of solar bills and nothing else on the desk"
              onBlur={() => { if (f.description.trim() && f.description.trim().length < MIN_PURPOSE) setPopup({ title: 'Say a little more', message: `Say what the role is for, in a sentence — at least ${MIN_PURPOSE} characters.`, tone: 'warning' }); }} />
          </div>
          <div className="elite-field">
            <label htmlFor="mr-base">Works like <span aria-hidden="true">*</span></label>
            <select id="mr-base" className="elite-input" value={f.base} onChange={(e) => chooseBase(e.target.value)}>
              <option value="" disabled>Choose a role…</option>
              {desks.map((desk) => (
                <optgroup key={desk} label={desk}>
                  {d.bases.filter((b) => b.desk === desk).map((b) => <option key={b.role} value={b.role}>{b.label}</option>)}
                </optgroup>
              ))}
            </select>
            <p className="rp-hint">
              {base
                ? <>{base.does} The new role starts with {base.label}&apos;s powers, which you change next, and does {base.label}&apos;s work wherever the matrix lists no power.</>
                : 'The new role starts with this role\'s powers, which you change next, and does its work wherever the matrix lists no power. The administrators are not offered: they govern and do not transact.'}
            </p>
          </div>
          <div className="elite-field">
            <label htmlFor="mr-reason">Reason <span aria-hidden="true">*</span></label>
            <textarea id="mr-reason" className="elite-input" rows={2} value={f.reason} onChange={set('reason')} maxLength={500}
              placeholder="e.g. Office order 31/2026: a bill checker for the solar portfolio"
              onBlur={() => { if (f.reason.trim() && f.reason.trim().length < MIN_REASON) setPopup({ title: 'Reason too short', message: `Write the reason in a sentence — at least ${MIN_REASON} characters. It goes on the audit trail.`, tone: 'warning' }); }} />
          </div>
          <div className="elite-field">
            <label htmlFor="mr-ref">Office order / note reference</label>
            <input id="mr-ref" className="elite-input" value={f.reference} onChange={set('reference')} maxLength={80} placeholder="Optional, e.g. OO/REIA/2026/31" />
          </div>
          <div className="elite-modal-actions">
            <button type="button" className="elite-btn-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="elite-btn-submit">Next: its powers</button>
          </div>
        </form>
      )}

      {step === 2 && (
        <>
          <p className="rp-does">
            Tick what <strong>{f.label.trim()}</strong> may do. It starts with what {base?.label} holds today; a power beyond that runs as the role the platform wrote it for, and the rules that bind a single change bind each tick.
          </p>
          <div className="rp-make-tools">
            <input className="elite-search" type="search" placeholder="Search powers…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search powers" />
            <button type="button" className="btn btn-secondary elite-ghost-btn" onClick={() => { setTicks(baseTicks(f.base)); setNote(''); }}>Start again from {base?.label}</button>
            <button type="button" className="btn btn-secondary elite-ghost-btn" onClick={() => { setTicks(new Set()); setNote(''); }}>Untick all</button>
          </div>
          {note && <div className="elite-health blue" role="status">{note}</div>}
          {general.map((x) => <div key={x.why} className="elite-health amber" role="alert">{x.why}</div>)}

          <div className="rp-pick" role="group" aria-label="Powers">
            {areas.map((a) => (
              <fieldset key={a} className="rp-pick-area">
                <legend>{a}</legend>
                {rows.filter((p) => p.area === a).map((p) => {
                  const was = stateIn(p, f.base);
                  const on = ticks.has(p.key);
                  const locked = fixedWhy(p, was);
                  const why = problemOf(p.key);
                  const tag = on && was === 'none' ? ['beyond', `Beyond ${base?.label}`]
                    : !on && was !== 'none' ? ['fewer', `${base?.label} has it`]
                      : on && was === 'some' ? ['part', `Part of it, as ${base?.label}`] : null;
                  return (
                    <label key={p.key} className={`rp-pick-row ${on ? 'on' : ''} ${locked ? 'locked' : ''} ${why ? 'bad' : ''}`}>
                      <input type="checkbox" checked={on} disabled={!!locked} onChange={() => toggle(p)} />
                      <span className="rp-pick-text">
                        <span className="rp-power-label">
                          {p.label}
                          <span className={`rp-kind ${p.kind}`}>{p.kind_label}</span>
                          {tag && <span className={`rp-tag ${tag[0]}`}>{tag[1]}</span>}
                        </span>
                        <span className="rp-power-does">{p.does}</span>
                        {locked && <span className="rp-why"><Lock size={12} aria-hidden="true" /> {locked}</span>}
                        {why && <span className="rp-problem"><AlertTriangle size={13} aria-hidden="true" /> {why}</span>}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
            {rows.length === 0 && <p className="elite-meta">No power matches.</p>}
          </div>

          <div className="rp-summary" aria-live="polite">
            <span><strong>{plural(ticks.size, 'power')}</strong> ticked</span>
            {verdict && <span>{plural(verdict.given.length, 'power')} beyond {base?.label}</span>}
            {verdict && <span>{verdict.taken.length} fewer than {base?.label}</span>}
            {checking ? <span className="elite-meta">Checking…</span>
              : verdict && (verdict.problems.length
                ? <span className="rp-problem"><AlertTriangle size={14} aria-hidden="true" /> {plural(verdict.problems.length, 'rule')} broken</span>
                : <span className="rp-ok">Within the rules</span>)}
          </div>

          <div className="elite-modal-actions">
            <button type="button" className="elite-btn-cancel" onClick={() => setStep(1)} disabled={busy}>Back</button>
            <button type="button" className="elite-btn-submit" onClick={make} disabled={busy || checking || !verdict}>{busy ? 'Making…' : 'Make the role'}</button>
          </div>
        </>
      )}

      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}

/** A made role: what it is, who made it and why — and, for an administrator, renaming or retiring it. */
export function MadeRolePanel({ role, canEdit, onClose, onDone }) {
  const [action, setAction] = useState('');
  const [label, setLabel] = useState(role.label);
  const [description, setDescription] = useState(role.description);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [popup, setPopup] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const problems = [
      !action && 'Choose what to do with the role.',
      action === 'edit' && label.trim().length < 3 && 'Give the role a name of at least 3 characters.',
      action === 'edit' && description.trim().length < MIN_PURPOSE && `Say what the role is for — at least ${MIN_PURPOSE} characters.`,
      action === 'edit' && label.trim() === role.label && description.trim() === role.description && 'Nothing was changed.',
      reason.trim().length < MIN_REASON && `Write the reason in a sentence — at least ${MIN_REASON} characters. It goes on the audit trail.`,
    ].filter(Boolean);
    if (problems.length) { setPopup({ title: 'Before this can be saved', items: problems }); return; }
    setBusy(true);
    try {
      const body = { reason: reason.trim(), reference: reference.trim() };
      const fresh = action === 'edit'
        ? await api.rolePowers.updateRole(role.role, { ...body, label: label.trim(), description: description.trim() })
        : await api.rolePowers.retireRole(role.role, body);
      onDone(fresh, action === 'edit' ? `The role is now "${label.trim()}".` : `The role "${role.label}" was retired. Nobody can be given it now; its record stays in the history.`);
    } catch (err) {
      setBusy(false);
      setPopup({ title: 'Nothing was changed', message: errText(err) });
    }
  }

  return (
    <div className="rp-panel">
      <p className="rp-does">{role.description}</p>
      <dl className="rp-facts">
        <dt>Works like</dt><dd>{role.base_label} — for whatever the matrix lists no power for</dd>
        <dt>Officers</dt><dd>{plural(role.users, 'active officer')}</dd>
        <dt>Made</dt><dd>{role.made_by || 'An administrator'}, {fmtDateTime(role.made_at)}: &ldquo;{role.reason}&rdquo;{role.reference ? ` (ref. ${role.reference})` : ''}</dd>
        {role.updated_at && <><dt>Last renamed</dt><dd>{role.updated_by || 'An administrator'}, {fmtDateTime(role.updated_at)}</dd></>}
      </dl>
      <p className="elite-meta">Its powers are its column in the matrix — click a cell there to give or take one away.</p>

      {canEdit ? (
        <form onSubmit={submit} noValidate>
          <fieldset className="rp-choice">
            <legend>What to do</legend>
            <label className={`rp-option ${action === 'edit' ? 'chosen' : ''}`}>
              <input type="radio" name="mr-action" checked={action === 'edit'} onChange={() => setAction('edit')} />
              <span><strong><Pencil size={14} aria-hidden="true" /> Rename it or say again what it is for</strong></span>
            </label>
            <label className={`rp-option ${role.retire?.ok ? '' : 'blocked'} ${action === 'retire' ? 'chosen' : ''}`}>
              <input type="radio" name="mr-action" checked={action === 'retire'} disabled={!role.retire?.ok} onChange={() => setAction('retire')} />
              <span>
                <strong><Archive size={14} aria-hidden="true" /> Retire it</strong>
                {role.retire?.ok
                  ? <span className="rp-why">Nobody can be given it afterwards; its record stays in the history.</span>
                  : <span className="rp-why"><Lock size={12} aria-hidden="true" /> {role.retire?.why}</span>}
              </span>
            </label>
          </fieldset>
          {action === 'edit' && (
            <>
              <div className="elite-field">
                <label htmlFor="mr-new-label">Name</label>
                <input id="mr-new-label" className="elite-input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
              </div>
              <div className="elite-field">
                <label htmlFor="mr-new-desc">What it is for</label>
                <textarea id="mr-new-desc" className="elite-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
              </div>
            </>
          )}
          {action && (
            <>
              <div className="elite-field">
                <label htmlFor="mr-why">Reason <span aria-hidden="true">*</span></label>
                <textarea id="mr-why" className="elite-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
                  onBlur={() => { if (reason.trim() && reason.trim().length < MIN_REASON) setPopup({ title: 'Reason too short', message: `Write the reason in a sentence — at least ${MIN_REASON} characters.`, tone: 'warning' }); }} />
              </div>
              <div className="elite-field">
                <label htmlFor="mr-why-ref">Office order / note reference</label>
                <input id="mr-why-ref" className="elite-input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder="Optional" />
              </div>
            </>
          )}
          <div className="elite-modal-actions">
            <button type="button" className="elite-btn-cancel" onClick={onClose} disabled={busy}>Cancel</button>
            {action && <button type="submit" className="elite-btn-submit" disabled={busy}>{busy ? 'Saving…' : action === 'edit' ? 'Save' : 'Retire the role'}</button>}
          </div>
        </form>
      ) : (
        <div className="elite-modal-actions"><button type="button" className="elite-btn-cancel" onClick={onClose}>Close</button></div>
      )}

      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
