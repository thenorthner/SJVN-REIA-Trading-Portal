import React, { useCallback } from 'react';
import { api } from '../api/client.js';
import { useServerCountdown, formatCountdown } from './useServerCountdown.js';

/**
 * Day-ahead bidding gate (DAM / HP-DAM / GDAM / GTAM): how long until bids for
 * the next delivery day close. The gate time is a setting in Masters, so this
 * says what the platform is configured with, not what the exchange published.
 */
export default function DayAheadGateBanner({ product }) {
  const load = useCallback(() => api.bids.gateClosure(product), [product]);
  const { data, left, failed } = useServerCountdown(load);
  const urgent = left !== null && left <= 900;
  const tone = urgent
    ? { bg: 'var(--t-red-50, #fef2f2)', border: 'var(--t-red-100, #fecaca)', text: 'var(--red-strong, #b91c1c)' }
    : { bg: 'var(--t-amber-100)', border: 'var(--t-amber-100)', text: 'var(--on-amber)' };
  return (
    <div role="status" style={{ background: tone.bg, border: `1px solid ${tone.border}`, padding: '10px 15px', borderRadius: 6, marginBottom: 20 }}>
      <div style={{ color: tone.text, fontWeight: 600 }}>
        {data && left !== null ? (
          <span>
            {product} bids for {data.delivery_date} close at {data.gate_time} IST
            {' | '}Gate closes in: <strong>{formatCountdown(left)}</strong>
            {urgent && ' — closing soon'}
          </span>
        ) : failed ? (
          <span>Gate closure for {product} is not available — check the exchange notice.</span>
        ) : (
          <span>Loading {product} gate closure…</span>
        )}
      </div>
    </div>
  );
}
