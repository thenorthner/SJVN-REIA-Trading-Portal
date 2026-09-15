import React from 'react';
import { NotHeld } from './cercMonth.jsx';

// GTAM performance: top bilateral and DAM participants by state, and GTAM
// contract-wise volume and price on the exchanges. Every figure here was typed in,
// and the "top 10" lists were padded with placeholder names — "State2" through
// "State20" — that read as states. The platform reads none of this: the CERC
// report's participant and GTAM tables are not among those it parses, and no
// exchange feed carries them. The screen says so rather than drawing invented bars.

export default function GTAMAnalyticsWidget() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
      <NotHeld title="Top 10 bilateral participants">
        The CERC report's state-wise bilateral purchase and sale table is not among the tables the platform reads.
      </NotHeld>
      <NotHeld title="Top 10 DAM participants">
        The CERC report's state-wise DAM purchase and sale table is not among the tables the platform reads.
      </NotHeld>
      <NotHeld title="GTAM volume and price by contract type">
        GTAM contract-wise volume and price (any-day single-sided, daily, weekly, monthly, intraday) are not in the parsed
        report and no exchange feed carries them.
      </NotHeld>
    </div>
  );
}
