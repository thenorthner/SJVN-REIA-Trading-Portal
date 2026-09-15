import React from 'react';
import { NotHeld } from './cercMonth.jsx';

// TAM volume and price by contract type on the exchanges. The chart was a typed-in
// array; the platform holds no TAM market data — the CERC report's TAM tables are
// not parsed and no exchange feed carries them.

export default function TAMAnalyticsWidget() {
  return (
    <NotHeld title="TAM volume and price by contract type">
      TAM contract-wise volume and price on IEX, PXIL and HPX are not in the parsed CERC report and no exchange feed carries
      them. SJVN's own TAM bids are on the TAM Management screen.
    </NotHeld>
  );
}
