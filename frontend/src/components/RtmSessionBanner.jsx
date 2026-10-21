import React from 'react';
import { api } from '../api/client.js';
import { useServerCountdown, formatCountdown } from './useServerCountdown.js';

export { formatCountdown };

/**
 * The RTM session open for bids and how long its gate stays open.
 *
 * The session and gate time come from the server clock, not the browser's: the
 * response carries the server's time, the screen keeps only the offset to its
 * own clock and counts down against that, so a wrong laptop clock cannot show a
 * gate as open after it has closed. When the gate passes it asks again and moves
 * on to the next session.
 */
const loadRtm = () => api.bids.rtmSession();

export default function RtmSessionBanner({ children }) {
  const { data: session, left, failed } = useServerCountdown(loadRtm);

  const urgent = left !== null && left <= 120;
  const tone = urgent
    ? { bg: 'var(--t-red-50, #fef2f2)', border: 'var(--t-red-100, #fecaca)', text: 'var(--red-strong, #b91c1c)', dot: '#ef4444' }
    : { bg: 'var(--t-green-50)', border: 'var(--t-green-100)', text: 'var(--on-green)', dot: '#10b981' };

  return (
    <div
      role="status"
      aria-live={urgent ? 'assertive' : 'off'}
      style={{ background: tone.bg, border: `1px solid ${tone.border}`, padding: '10px 15px', borderRadius: 6, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
    >
      <div style={{ color: tone.text, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: tone.dot, boxShadow: `0 0 8px ${tone.dot}` }} />
        {session && left !== null ? (
          <span>
            Active window: RTM session #{session.session_no} ({session.delivery_from}-{session.delivery_to}, {session.delivery_date})
            {' | '}Gate closes in: <strong>{formatCountdown(left)}</strong>
            {urgent && ' — closing soon, place bids now'}
          </span>
        ) : failed ? (
          <span>RTM session clock unavailable — check the exchange portal for the open session.</span>
        ) : (
          <span>Loading RTM session…</span>
        )}
      </div>
      {children}
    </div>
  );
}
