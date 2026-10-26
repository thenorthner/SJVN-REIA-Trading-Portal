import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGigw } from './GigwContext.jsx';

/**
 * Cookie and browser-storage notice (DPDP Act 2023, GIGW 3.0, DBIM v3 s.7.6).
 * Shown at the bottom of the page on the first visit and whenever "Cookie
 * preferences" in the footer is pressed, with the three choices DBIM asks for:
 * accept, reject, or customise by category.
 *
 * The categories are only the ones the portal really uses: essential storage
 * (session, display choices, this answer) and functionality storage (recent
 * searches and recently opened companies). There is no analytics or tracking
 * storage, so none is offered.
 *
 * The answer is kept in this browser under sjvn_cookie_consent_v1 with its time
 * and version, and also sent to the server, which records it with the IP
 * address as evidence of consent. Nothing is pre-selected and closing the
 * notice is not consent: until a button is pressed only essential storage is
 * used.
 */
export const CONSENT_KEY = 'sjvn_cookie_consent_v1';
export const CONSENT_VERSION = 'v1';
const OPEN_EVENT = 'sjvn:cookie-preferences';

// Keys written only with functionality consent; removed when it is refused.
export const FUNCTIONAL_KEYS = ['sjvn_command_recents', 'sjvn_recent_company_ids'];

export function readConsent() {
  try {
    const v = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
    return v && v.version === CONSENT_VERSION ? v : null;
  } catch {
    return null;
  }
}

/** True only when the visitor allowed the optional functionality storage. */
export function functionalConsented() {
  const c = readConsent();
  return c?.choice === 'all' || (c?.choice === 'custom' && !!c.categories?.functional);
}

export function openCookiePreferences() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export default function CookieConsent() {
  const { t } = useGigw();
  const [open, setOpen] = useState(() => !readConsent());
  const [customising, setCustomising] = useState(false);
  const [functional, setFunctional] = useState(() => functionalConsented());
  const firstBtn = useRef(null);

  useEffect(() => {
    const show = () => { setFunctional(functionalConsented()); setCustomising(false); setOpen(true); };
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  // Reopened from the footer: focus moves to it. On a first visit it does not,
  // so the skip link stays the first thing a keyboard reaches.
  useEffect(() => { if (open && readConsent()) firstBtn.current?.focus(); }, [open]);

  function choose(choice, categories) {
    const record = { choice, version: CONSENT_VERSION, ts: new Date().toISOString(), ...(categories ? { categories } : {}) };
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
      if (!functionalConsented()) FUNCTIONAL_KEYS.forEach((k) => localStorage.removeItem(k));
    } catch { /* storage blocked: asked again next visit */ }
    const token = (() => { try { return localStorage.getItem('sjvn_token'); } catch { return null; } })();
    fetch('/api/public/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ purpose: 'COOKIES', choice, version: CONSENT_VERSION, categories }),
    }).catch(() => {});
    setOpen(false);
  }

  if (!open) return null;
  return (
    <section className="gigw-cookie" role="region" aria-labelledby="gigw-cookie-title" aria-describedby="gigw-cookie-body">
      <div className="gigw-cookie-text">
        <h2 id="gigw-cookie-title">{t('cookie.title')}</h2>
        <p id="gigw-cookie-body">{t('cookie.body')} <Link to="/cookie-policy">{t('cookie.policy')}</Link></p>
        {customising && (
          <fieldset className="gigw-cookie-cats">
            <legend className="sr-only">{t('cookie.customise')}</legend>
            <label className="gigw-cookie-cat">
              <input type="checkbox" checked disabled />
              <span><strong>{t('cookie.catEssential')}</strong><span>{t('cookie.catEssentialDesc')}</span></span>
            </label>
            <label className="gigw-cookie-cat">
              <input type="checkbox" checked={functional} onChange={(e) => setFunctional(e.target.checked)} />
              <span><strong>{t('cookie.catFunctional')}</strong><span>{t('cookie.catFunctionalDesc')}</span></span>
            </label>
            <p className="gigw-cookie-note">{t('cookie.noTracking')}</p>
          </fieldset>
        )}
      </div>
      <div className="gigw-cookie-actions">
        {customising ? (
          <button ref={firstBtn} type="button" className="btn btn-primary" onClick={() => choose('custom', { essential: true, functional })}>{t('cookie.save')}</button>
        ) : (
          <>
            <button ref={firstBtn} type="button" className="btn" onClick={() => choose('essential')}>{t('cookie.reject')}</button>
            <button type="button" className="btn" onClick={() => setCustomising(true)} aria-expanded="false">{t('cookie.customise')}</button>
            <button type="button" className="btn btn-primary" onClick={() => choose('all')}>{t('cookie.acceptAll')}</button>
          </>
        )}
      </div>
    </section>
  );
}
