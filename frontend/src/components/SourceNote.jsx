import React from 'react';

/**
 * Says where a chart's numbers came from.
 *
 * Four analytics screens mix two kinds of series: what SJVN actually transacted,
 * which this platform records, and national figures published by CEA and CERC,
 * which it does not. Sitting side by side in identical cards they read as one
 * body of fact, and a reader had no way to tell that the all-India generation mix
 * is a quarterly publication while the REC revenue beside it is today's ledger.
 */
export default function SourceNote({ source, period, live = false }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, marginTop: 8,
      fontSize: 11, color: live ? '#047857' : '#6b7280',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: live ? '#10b981' : '#9ca3af', flexShrink: 0,
      }} />
      <span>
        {live ? 'Live from this platform' : `Reference data — ${source}`}
        {period ? ` · ${period}` : ''}
      </span>
    </div>
  );
}
