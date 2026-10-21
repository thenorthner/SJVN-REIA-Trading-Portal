import React, { useEffect, useRef, useState } from 'react';
import { useGigw } from './GigwContext.jsx';
import { registerDeclarationHandler } from './declaration.js';
import { useFocusTrap } from './focusTrap.js';

/**
 * The statutory affirmation asked before every critical submission. The box is
 * never pre-ticked, and "Confirm and submit" stays disabled until it is ticked.
 * Mounted once at the root; the API client opens it through declaration.js.
 */
export default function DeclarationGate() {
  const { t } = useGigw();
  const [req, setReq] = useState(null); // { label, version, resolve }
  const [checked, setChecked] = useState(false);
  const panelRef = useRef(null);
  const boxRef = useRef(null);
  useFocusTrap(panelRef, !!req);

  useEffect(() => registerDeclarationHandler(({ label, version }) => new Promise((resolve) => {
    setChecked(false);
    setReq({ label, version, resolve });
  })), []);

  useEffect(() => {
    if (!req) return undefined;
    boxRef.current?.focus();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      finish(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps

  function finish(ok) {
    if (!req) return;
    req.resolve(ok ? { at: new Date().toISOString() } : null);
    setReq(null);
  }

  if (!req) return null;
  return (
    <div className="alert-popup-backdrop gigw-decl-backdrop">
      <div
        ref={panelRef}
        className="alert-popup info gigw-decl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gigw-decl-title"
        aria-describedby="gigw-decl-text"
        tabIndex={-1}
      >
        <div className="alert-popup-head">
          <span className="alert-popup-icon" aria-hidden="true">§</span>
          <h3 id="gigw-decl-title">{t('decl.title')}</h3>
        </div>
        <div className="alert-popup-body">
          <p>{t('decl.intro')}</p>
          <p className="gigw-decl-meta"><strong>{t('decl.action')}:</strong> {req.label}</p>
          <blockquote id="gigw-decl-text" className="gigw-decl-text">{t('decl.text')}</blockquote>
          <label className="gigw-decl-check">
            <input
              ref={boxRef}
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              aria-describedby="gigw-decl-text"
            />
            <span>{t('decl.agree')}</span>
          </label>
          <p className="gigw-decl-meta">{t('decl.version')}: {req.version}</p>
        </div>
        <div className="alert-popup-actions">
          <button type="button" className="btn" onClick={() => finish(false)}>{t('decl.cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={!checked} aria-disabled={!checked} onClick={() => finish(true)}>
            {t('decl.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
