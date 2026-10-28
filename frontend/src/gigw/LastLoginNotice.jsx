import React, { useState } from 'react';
import { fmtDateTime } from '../datetime.js';
import { useGigw } from './GigwContext.jsx';

/**
 * Once per sign-in: when and from where this account last signed in, and a
 * warning if another session for it is still open (CERT-In session security —
 * a sign-in the holder does not recognise is how a stolen password shows up).
 */
export default function LastLoginNotice() {
  const { tUI } = useGigw();
  const [info, setInfo] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('sjvn_previous_login') || 'null'); } catch { return null; }
  });
  if (!info) return null;
  const dismiss = () => {
    try { sessionStorage.removeItem('sjvn_previous_login'); } catch { /* ignore */ }
    setInfo(null);
  };
  const concurrent = !!info.concurrent;
  return (
    <div className={`gigw-lastlogin${concurrent ? ' is-warning' : ''}`} role={concurrent ? 'alert' : 'status'}>
      <span>
        {tUI('Last sign-in')}: <strong>{fmtDateTime(info.at)}</strong>
        {info.ip && <> {tUI('from')} <strong>{info.ip}</strong></>}.
        {concurrent && ' Another session for this account was still active from a different address. If that was not you, change your password now and inform the Web Information Manager.'}
      </span>
      <button type="button" className="link-btn" onClick={dismiss}>{tUI('Dismiss')}<span className="sr-only"> last sign-in notice</span></button>
    </div>
  );
}
