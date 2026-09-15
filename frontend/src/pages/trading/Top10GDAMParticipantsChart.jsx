import React from 'react';
import { PageHeader } from '../../components/ui.jsx';
import { NotHeld } from './cercMonth.jsx';

// Top GDAM buyers and sellers by state. This drew a typed-in curve whose points
// were mostly unlabelled ("", "", "End") and whose tooltip guessed "Delhi" for any
// point above 300. The platform holds no participant-wise GDAM data.

export default function Top10GDAMParticipantsChart() {
  return (
    <div className="page">
      <PageHeader title="Top 10 GDAM Participants" subtitle="State-wise GDAM purchase and sale" />
      <NotHeld title="Top 10 GDAM participants">
        The CERC report's state-wise GDAM purchase and sale table is not among the tables the platform reads, and no exchange
        feed carries participant volumes. Nothing is drawn rather than a curve nobody measured.
      </NotHeld>
    </div>
  );
}
