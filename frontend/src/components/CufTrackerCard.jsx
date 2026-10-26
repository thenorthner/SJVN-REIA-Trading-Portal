import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { Card, Table, Badge, fmtCurrency, fmtNumber } from './ui.jsx';

// G1: each RE PPA's current contract year — CUF so far, what the rest of the
// year must average, and the shortfall if it carries on at today's rate.
const STATE = {
  CANNOT_MEET: ['danger', 'Cannot meet'], SHORT: ['danger', 'Short'], AT_RISK: ['warning', 'At risk'],
  ON_TRACK: ['success', 'On track'], MET: ['success', 'Met'], NO_DATA: ['neutral', 'No energy yet'],
};

export default function CufTrackerCard() {
  const [t, setT] = useState(null);
  useEffect(() => { Promise.resolve().then(() => api.reports.cufTracker()).then(setT).catch(() => setT(null)); }, []);
  if (!t || !t.rows.length) return null;
  return (
    <Card title={`Contract-year CUF tracker — as of ${t.as_of}${t.totals.at_risk ? ` · ${t.totals.at_risk} at risk, ${fmtCurrency(t.totals.projected_compensation)} projected` : ''}`}>
      <Table
        columns={[
          { key: 'contract_no', header: 'PPA', render: (r) => <><strong>{r.contract_no}</strong><div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>{r.project_type} · {r.capacity_mw} MW · year {r.contract_year} ({r.year_start} → {r.year_end})</div></> },
          { key: 'cuf_ytd', header: 'CUF so far', render: (r) => (r.cuf_ytd != null ? `${r.cuf_ytd}% over ${r.months_counted}/${r.months_in_year} months` : '—') },
          { key: 'min', header: 'Minimum', render: (r) => `${r.min_cuf}%` },
          { key: 'needed', header: 'Rest of year must average', render: (r) => (r.needed_cuf_rest_of_year != null ? <span style={{ color: r.needed_cuf_rest_of_year > 100 ? 'var(--red-deep)' : undefined, fontWeight: 600 }}>{r.needed_cuf_rest_of_year}%</span> : '—') },
          { key: 'projected', header: 'At today\'s rate', render: (r) => (r.projected_cuf != null ? (
            <span>{r.projected_cuf}% for the year{r.projected_shortfall_mwh > 0 && <div style={{ fontSize: 14.5, color: 'var(--amber-strong)' }}>{fmtNumber(r.projected_shortfall_mwh)} MWh short ≈ {fmtCurrency(r.projected_compensation)} ({r.compensation_basis})</div>}</span>
          ) : '—') },
          { key: 'state', header: '', render: (r) => <Badge type={STATE[r.state]?.[0]}>{STATE[r.state]?.[1] || r.state}</Badge> },
        ]}
        rows={t.rows}
      />
      <p className="inline-note">A run-rate projection: a solar year with its monsoon still to come will look worse mid-year than it ends. The year is settled at the true-up, not here.</p>
    </Card>
  );
}
