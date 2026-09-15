import React from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/ui.jsx';
import { NotHeld } from './cercMonth.jsx';

// CEA Reports Dashboard (CP-86 §3): generation mix, RE generation, peak demand
// against peak met, energy requirement against availability, installed capacity.
//
// Every series here was a block of "Data Mocks" under a "Reference data — Central
// Electricity Authority" label: peak demand in round thousands, thermal capacity
// flat at 243,000 MW for six months while RE rose by exactly 2,000 MW a month, and
// a generation mix with thermal at 85%. Labelled as CEA, none of it was CEA's.
//
// The platform has no CEA feed. The CEA API endpoints listed in the API Details
// report did not answer when tried from here (September 2026), and no upload
// brings CEA's monthly workbooks in. Until one of those exists the dashboard names
// what it would show rather than drawing it.

const CARDS = [
  ['Power generation, all India', 'Monthly generation by source (thermal, hydro, nuclear, imports) from CEA\'s generation report.'],
  ['RE generation, all India', 'Monthly renewable generation by source (solar, wind, small hydro, biomass) from CEA\'s RE report.'],
  ['Peak demand against peak met', 'CEA\'s monthly power supply position — peak.'],
  ['Energy requirement against energy available', 'CEA\'s monthly power supply position — energy.'],
  ['Installed capacity by category', 'CEA\'s monthly installed capacity report.'],
];

export default function CEAReportsDashboard() {
  return (
    <div className="page">
      <PageHeader title="CEA Reports Dashboard" subtitle="All-India supply position, generation and installed capacity from the Central Electricity Authority" />
      <div className="alert alert-info" role="status">
        The platform holds no CEA data: there is no feed from CEA and no upload for its monthly reports. The CEA API endpoints
        are listed in the <Link to="/reports/api-details">API Details report</Link>; connecting one needs the server to reach cea.nic.in.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        {CARDS.map(([title, what]) => (
          <NotHeld key={title} title={title}>
            {what} Not loaded — the figures that used to be drawn here were typed in, not taken from CEA.
          </NotHeld>
        ))}
      </div>
    </div>
  );
}
