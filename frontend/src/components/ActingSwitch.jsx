import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Work as oneself, or in a charge handed over (Target #2 Phase D): an
 * additional charge for an absent officer, or an approved break-glass grant.
 * The choice lasts for this browser tab; the server checks it on every request
 * and ends it the moment the charge does.
 */
const label = (role) => String(role || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bReia\b/g, 'REIA');
const KEY = 'sjvn_acting';

function current() {
  try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function switchTo(value) {
  try {
    if (value) sessionStorage.setItem(KEY, value); else sessionStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
  // The role changes, and with it the menu and the landing page.
  window.location.assign('/');
}

export function ActingBanner() {
  const { user } = useAuth();
  const a = user?.acting;
  if (!a) return null;
  const until = a.kind === 'BG' ? `${new Date(`${String(a.until).replace(' ', 'T')}Z`).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST` : a.until;
  return (
    <div className={`gigw-lastlogin ${a.kind === 'BG' ? 'is-warning' : ''}`} role="status" style={{ borderLeftColor: 'var(--amber)' }}>
      <span>
        {a.kind === 'BG'
          ? <>Break-glass: you are working as <strong>{label(user.role)}</strong> until {until}. Everything you change is flagged in the audit trail.</>
          : <>Additional charge: you are acting for <strong>{a.for_name}</strong> as <strong>{label(user.role)}</strong> until {until}. What you do is recorded as “{user.name}”.</>}
      </span>
      <button type="button" className="link-btn" onClick={() => switchTo('')}>Work as myself</button>
    </div>
  );
}

export default function ActingSwitch() {
  const { user } = useAuth();
  const [mine, setMine] = useState(null);
  useEffect(() => {
    if (!user || user.linked_entity_id) return;
    api.delegations.mine().then(setMine).catch(() => setMine(null));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mine || (mine.options.length === 0 && !mine.acting)) return null;
  const own = label(mine.real_role || user.role);
  return (
    <label className="acting-switch" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <span className="sr-only">Work as</span>
      <select className="select" value={current()} onChange={(e) => switchTo(e.target.value)} style={{ maxWidth: 260 }}>
        <option value="">Myself — {own}</option>
        {mine.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.kind === 'BG' ? `Break-glass — ${label(o.role)}` : `For ${o.for_name} — ${label(o.role)} (till ${o.until})`}
          </option>
        ))}
      </select>
    </label>
  );
}
