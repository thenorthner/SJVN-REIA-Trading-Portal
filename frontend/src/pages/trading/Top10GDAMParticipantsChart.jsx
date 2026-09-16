import React from 'react';
import { PageHeader, Card } from '../../components/ui.jsx';
import { useCercMonth, PeriodSelect, NoReport } from './cercMonth.jsx';
import { ParticipantsCard } from './cercParticipants.jsx';

// The largest GDAM sellers and buyers in a month, from the CERC report's
// entity-wise tables. This drew a typed-in curve whose points were mostly
// unlabelled and whose tooltip guessed "Delhi" for any point above 300; then it
// said the platform held no such data, which was not so — the report lists every
// regional entity that sold or bought in GDAM.

export default function Top10GDAMParticipantsChart() {
  const { data, error, setPeriod } = useCercMonth();
  return (
    <div className="page">
      <PageHeader title="Top 10 GDAM Participants" subtitle="The regional entities that sold and bought most in the green day-ahead market" />
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {!error && !data && <Card><div className="audit-placeholder">Loading…</div></Card>}
      {data && !data.period && <NoReport />}
      {data?.period && (
        <>
          <Card><div className="report-criteria"><PeriodSelect data={data} onChange={setPeriod} /></div></Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
            <ParticipantsCard period={data.period} segment="GDAM" side="SELL" />
            <ParticipantsCard period={data.period} segment="GDAM" side="BUY" />
          </div>
        </>
      )}
    </div>
  );
}
