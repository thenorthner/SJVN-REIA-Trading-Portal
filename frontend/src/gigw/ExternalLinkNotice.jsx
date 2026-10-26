import React, { useEffect, useRef, useState } from 'react';
import { useGigw } from './GigwContext.jsx';
import { useFocusTrap } from './focusTrap.js';

/**
 * GIGW 3.0 lifecycle guideline 4: "clear indications are given when a link
 * leads out to a non-government website". On the public pages a click on a
 * link to any host outside gov.in / nic.in (and the few government-company
 * domains listed below) first shows this notice; government links open
 * directly. Modifier clicks (new tab / window) are left alone.
 */
const GOVT_HOSTS = [/^mygov\.in$/i, /\.mygov\.in$/i, /\.gov\.in$/i, /\.nic\.in$/i, /^grid-india\.in$/i, /\.grid-india\.in$/i, /^cert-in\.org\.in$/i, /\.cert-in\.org\.in$/i];

export function isGovernmentHost(host) {
  const h = String(host || '').replace(/^www\./i, '');
  return h === 'gov.in' || h === 'nic.in' || GOVT_HOSTS.some((re) => re.test(h));
}

export default function ExternalLinkNotice() {
  const { t } = useGigw();
  const [target, setTarget] = useState(null); // { href, host, newTab }
  const panelRef = useRef(null);
  const goRef = useRef(null);
  const returnTo = useRef(null);
  useFocusTrap(panelRef, !!target);

  useEffect(() => {
    function onClick(e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a) return;
      let url;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (!/^https?:$/.test(url.protocol) || url.host === window.location.host || isGovernmentHost(url.hostname)) return;
      e.preventDefault();
      returnTo.current = a;
      setTarget({ href: url.href, host: url.hostname.replace(/^www\./, ''), newTab: a.target === '_blank' });
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    if (!target) return undefined;
    goRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    setTarget(null);
    setTimeout(() => returnTo.current?.focus?.(), 0);
  }

  function go() {
    const { href, newTab } = target;
    setTarget(null);
    if (newTab) window.open(href, '_blank', 'noopener,noreferrer');
    else window.location.assign(href);
  }

  if (!target) return null;
  return (
    <div className="alert-popup-backdrop" onClick={close}>
      <div
        ref={panelRef}
        className="alert-popup info"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="gigw-ext-title"
        aria-describedby="gigw-ext-body"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="alert-popup-head">
          <span className="alert-popup-icon" aria-hidden="true">i</span>
          <h3 id="gigw-ext-title">{t('ext.title')}</h3>
        </div>
        <div className="alert-popup-body">
          <p id="gigw-ext-body">{t('ext.body', { host: target.host })}</p>
        </div>
        <div className="alert-popup-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={close}>{t('ext.cancel')}</button>
          <button ref={goRef} type="button" className="btn btn-primary" onClick={go}>{t('ext.continue')}</button>
        </div>
      </div>
    </div>
  );
}
