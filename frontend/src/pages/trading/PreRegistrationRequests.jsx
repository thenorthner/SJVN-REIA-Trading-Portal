import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { PageHeader, Card, StatCard, fmtNumber } from '../../components/ui.jsx';

// Pre-registration requests — a client asking for a login before it is a client.
//
// The platform has no such queue: nothing in the API or the database holds a
// request awaiting approval, because these arrive on the ISET portal and are not
// fed here. This screen used to draw the ISET table with "No data available in
// table" written into the markup, which reads as "no requests today" rather than
// "this platform never sees them". It now says which it is, and points at the two
// registers that do hold something.

export default function PreRegistrationRequests() {
  const [registered, setRegistered] = useState(null);
  const [clients, setClients] = useState(null);

  useEffect(() => {
    api.isetReports.list('registration')
      .then((r) => setRegistered(Array.isArray(r) ? r.length : 0))
      .catch(() => setRegistered(null));
    api.tradingClients.list()
      .then((r) => setClients(Array.isArray(r) ? r.length : 0))
      .catch(() => setClients(null));
  }, []);

  return (
    <div className="page">
      <PageHeader
        title="Pre-Registration Requests"
        subtitle="Requests for a client login, before the client is registered"
      />

      <div className="alert alert-info" role="status">
        <strong>Not fed into this platform. </strong>
        Pre-registration requests are raised on the ISET portal and approved there;
        nothing sends them here, so this screen has no queue to show — not an empty
        one. Once a client is registered, it appears in the two registers below.
      </div>

      <div className="kpi-grid">
        <StatCard
          label="Registrations on record"
          value={registered == null ? '—' : fmtNumber(registered, 0)}
          hint="Clients already registered"
          tone="blue"
        />
        <StatCard
          label="Clients on the trading master"
          value={clients == null ? '—' : fmtNumber(clients, 0)}
          hint="Clients the desk can trade for"
        />
      </div>

      <Card title="Where to go instead">
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}>
          <li><Link className="btn-link" to="/registration/requests">Registration Report</Link> — the clients that have been registered, with their reference numbers and categories.</li>
          <li><Link className="btn-link" to="/clients/details">Client Details</Link> — the trading clients on record and their clearance terms.</li>
          <li><Link className="btn-link" to="/trading/clients">Clients &amp; Counterparties</Link> — where a new client is added to the trading master.</li>
        </ul>
      </Card>
    </div>
  );
}
