import React from 'react';
import PublicHome from './PublicHome.jsx';

// The REIA beta's public home: the portal's own home page in its beta mode,
// which names the REIA desk alone (see PublicHome's `beta`).
export default function ReiaBetaHome() {
  return <PublicHome beta />;
}
