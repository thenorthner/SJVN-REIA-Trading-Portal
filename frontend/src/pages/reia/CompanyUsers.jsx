import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card } from '../../components/ui.jsx';
import Team from '../shared/Team.jsx';

// A seller's or buyer's users, opened from SJVN's side. Inside a company its
// admin runs the team; nobody there can reset or switch off the admin's own
// account, so that falls to SJVN's administrators here.
export default function CompanyUsers() {
  const [companies, setCompanies] = useState(null);
  const [entityId, setEntityId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.team.companies().then(setCompanies).catch((e) => setError(e.response?.data?.error || e.message));
  }, []);

  return (
    <div>
      <PageHeader title="Company Users" subtitle="Each seller's and buyer's users on the portal — levels, sign-ins, password resets and switching accounts off" />
      {error && <div className="form-error">{error}</div>}
      <div className="filters-bar">
        <select value={entityId} onChange={(e) => setEntityId(e.target.value)} aria-label="Company">
          <option value="">Choose a company…</option>
          {['SELLER', 'BUYER'].map((type) => (
            <optgroup key={type} label={type === 'SELLER' ? 'Sellers' : 'Buyers'}>
              {(companies || []).filter((c) => c.entity_type === type).map((c) => (
                <option key={c.id} value={c.id}>{c.name} — {c.active_users} active user{c.active_users === 1 ? '' : 's'}{c.users === 0 ? ' (no login yet)' : ''}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {entityId
        ? <Team key={entityId} entityId={entityId} />
        : <Card><div style={{ padding: 28, textAlign: 'center', color: 'var(--text-light)' }}>Choose a company to see its users.</div></Card>}
    </div>
  );
}
