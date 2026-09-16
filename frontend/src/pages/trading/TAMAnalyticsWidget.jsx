import React from 'react';
import { Card } from '../../components/ui.jsx';
import { useCercMonth, PeriodSelect, NoReport } from './cercMonth.jsx';
import { TermAheadCard } from './cercParticipants.jsx';

// TAM volume and price by contract type on each exchange, and the high-price
// TAM beside it, from the CERC monthly report. The chart here was a typed-in
// array. SJVN's own TAM bids are on the TAM Management screen.

export default function TAMAnalyticsWidget() {
  const { data, error, setPeriod } = useCercMonth();
  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!data) return <Card><div className="audit-placeholder">Loading…</div></Card>;
  if (!data.period) return <NoReport />;
  return (
    <>
      <Card><div className="report-criteria"><PeriodSelect data={data} onChange={setPeriod} /></div></Card>
      <TermAheadCard period={data.period} market="TAM" />
      <div style={{ marginTop: 16 }}>
        <TermAheadCard period={data.period} market="HP-TAM" />
      </div>
    </>
  );
}
