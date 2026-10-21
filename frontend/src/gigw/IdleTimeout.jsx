import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useGigw } from './GigwContext.jsx';
import { useSiteInfo } from './siteInfo.js';
import { useFocusTrap } from './focusTrap.js';

/**
 * Inactivity sign-out (CERT-In session security). After the configured minutes
 * with no keyboard, mouse or touch input in any tab, the session is ended on the
 * server and in the browser. A minute before that a dialog offers to stay.
 *
 * Background polling (notifications, mail counts) is not activity: only the
 * person at the keyboard keeps the session alive. The last-activity time is
 * shared between tabs through localStorage, so working in one tab keeps the
 * others signed in too.
 */
const KEY = 'sjvn_last_activity';
const WARN_SECONDS = 60;
const EVENTS = ['mousedown', 'keydown', 'touchstart', 'wheel', 'mousemove'];

function stamp() { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } }
function lastActivity(fallback) {
  try { return Number(localStorage.getItem(KEY)) || fallback; } catch { return fallback; }
}

export default function IdleTimeout() {
  const { user, logout } = useAuth();
  const { t } = useGigw();
  const info = useSiteInfo();
  const navigate = useNavigate();
  const minutes = Number(info?.session?.idle_timeout_minutes) || 15;
  const [remaining, setRemaining] = useState(null); // seconds left while warning
  const local = useRef(Date.now());
  const panelRef = useRef(null);
  const stayRef = useRef(null);
  useFocusTrap(panelRef, remaining != null);

  useEffect(() => {
    if (!user) return undefined;
    stamp();
    let lastWrite = 0;
    const onActivity = () => {
      local.current = Date.now();
      // mousemove fires constantly; a write every few seconds is plenty.
      if (local.current - lastWrite > 5000) { lastWrite = local.current; stamp(); }
    };
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const timer = setInterval(() => {
      const last = Math.max(local.current, lastActivity(local.current));
      const left = Math.round((last + minutes * 60_000 - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(timer);
        endSession();
      } else if (left <= WARN_SECONDS) {
        setRemaining(left);
      } else {
        setRemaining(null);
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [user, minutes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (remaining != null) stayRef.current?.focus(); }, [remaining != null]); // eslint-disable-line react-hooks/exhaustive-deps

  function endSession(reason = 'IDLE_TIMEOUT') {
    const token = (() => { try { return localStorage.getItem('sjvn_token'); } catch { return null; } })();
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
        keepalive: true,
      }).catch(() => {});
    }
    setRemaining(null);
    logout({ silent: true });
    navigate('/login', { replace: true, state: { notice: t('idle.signedOut') } });
  }

  function stay() {
    local.current = Date.now();
    stamp();
    setRemaining(null);
  }

  if (remaining == null) return null;
  return (
    <div className="alert-popup-backdrop gigw-decl-backdrop">
      <div ref={panelRef} className="alert-popup warning" role="alertdialog" aria-modal="true" aria-labelledby="gigw-idle-title" aria-describedby="gigw-idle-body" tabIndex={-1}>
        <div className="alert-popup-head">
          <span className="alert-popup-icon" aria-hidden="true">!</span>
          <h3 id="gigw-idle-title">{t('idle.title')}</h3>
        </div>
        <div className="alert-popup-body">
          <p id="gigw-idle-body" aria-live="polite">{t('idle.body', { minutes, seconds: remaining })}</p>
        </div>
        <div className="alert-popup-actions">
          <button type="button" className="btn" onClick={() => endSession('USER_LOGOUT')}>{t('idle.logout')}</button>
          <button ref={stayRef} type="button" className="btn btn-primary" onClick={stay}>{t('idle.stay')}</button>
        </div>
      </div>
    </div>
  );
}
