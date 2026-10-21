import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGigw } from './GigwContext.jsx';

/**
 * Cookie and browser-storage notice (DPDP Act 2023, GIGW 3.0). Shown on the
 * first visit and whenever "Cookie preferences" in the footer is pressed. The
 * answer is kept in this browser under sjvn_cookie_consent_v1 with its time and
 * version, and also sent to the server, which records it with the IP address
 * as evidence of consent.
 *
 * Nothing here is pre-selected and closing the notice is not consent: until a
 * button is pressed only the essential storage is used.
 */
export const CONSENT_KEY = 'sjvn_cookie_consent_v1';
export const CONSENT_VERSION = 'v1';
const OPEN_EVENT = 'sjvn:cookie-preferences';

export function readConsent() {
  try {
    const v = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
    return v && v.version === CONSENT_VERSION ? v : null;
  } catch {
    return null;
  }
}

/** True only when the visitor accepted the optional (performance) storage. */
export function performanceConsented() {
  return readConsent()?.choice === 'all';
}

export function openCookiePreferences() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export default function CookieConsent() {
  const { t } = useGigw();
  const [open, setOpen] = useState(() => !readConsent());
  const firstBtn = useRef(null);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  // Reopened from the footer: focus moves to it. On a first visit it does not,
  // so the skip link stays the first thing a keyboard reaches.
  useEffect(() => { if (open && readConsent()) firstBtn.current?.focus(); }, [open]);

  function choose(choice) {
    const record = { choice, version: CONSENT_VERSION, ts: new Date().toISOString() };
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify(record)); } catch { /* storage blocked: asked again next visit */ }
    const token = (() => { try { return localStorage.getItem('sjvn_token'); } catch { return null; } })();
    fetch('/api/public/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ purpose: 'COOKIES', choice, version: CONSENT_VERSION }),
    }).catch(() => {});
    setOpen(false);
  }

  if (!open) return null;
  return (
    <section className="gigw-cookie" role="region" aria-labelledby="gigw-cookie-title" aria-describedby="gigw-cookie-body">
      <div className="gigw-cookie-text">
        <h2 id="gigw-cookie-title">{t('cookie.title')}</h2>
        <p id="gigw-cookie-body">{t('cookie.body')} <Link to="/cookie-policy">{t('cookie.policy')}</Link></p>
      </div>
      <div className="gigw-cookie-actions">
        <button ref={firstBtn} type="button" className="btn" onClick={() => choose('essential')}>{t('cookie.essential')}</button>
        <button type="button" className="btn btn-primary" onClick={() => choose('all')}>{t('cookie.acceptAll')}</button>
      </div>
    </section>
  );
}
