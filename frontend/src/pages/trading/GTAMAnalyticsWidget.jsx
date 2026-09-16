import React from 'react';
import { Card } from '../../components/ui.jsx';
import { useCercMonth, PeriodSelect, NoReport } from './cercMonth.jsx';
import { ParticipantsCard, TermAheadCard } from './cercParticipants.jsx';

// GTAM performance: the largest bilateral and DAM participants, and the green
// term-ahead market contract by contract on each exchange. Every figure here was
// once typed in, with "top 10" lists padded by placeholder names — "State2"
// through "State20". All of it is in the CERC monthly report and is read from it.

export default function GTAMAnalyticsWidget() {
  const { data, error, setPeriod } = useCercMonth();
  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!data) return <Card><div className="audit-placeholder">Loading…</div></Card>;
  if (!data.period) return <NoReport />;
  return (
    <>
      <Card><div className="report-criteria"><PeriodSelect data={data} onChange={setPeriod} /></div></Card>
      <TermAheadCard period={data.period} market="GTAM" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginTop: 16 }}>
        <ParticipantsCard period={data.period} segment="BILATERAL" side="SELL" />
        <ParticipantsCard period={data.period} segment="BILATERAL" side="BUY" />
        <ParticipantsCard period={data.period} segment="DAM" side="SELL" />
        <ParticipantsCard period={data.period} segment="DAM" side="BUY" />
      </div>
    </>
  );
}
