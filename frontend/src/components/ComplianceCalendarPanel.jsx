/**
 * The 90-day compliance calendar (CC1/CERC1/SM4): CERC returns and fee,
 * LC/BG expiries, clearances, contract ends, banking cycle ends and hearings
 * on one timeline.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { Card, Badge } from './ui.jsx';
import { fmtDate } from '../datetime.js';

const KIND_TONE = { CERC_FILING: 'SUBMITTED', LICENCE_FEE: 'PENDING', SECURITY_EXPIRY: 'OVERDUE', CLEARANCE_EXPIRY: 'DISPUTED', CONTRACT_END: 'DRAFT', BANKING_CYCLE_END: 'VALIDATED', HEARING: 'ESCALATED' };

export default function ComplianceCalendarPanel() {
  const [days, setDays] = useState(90);
  const [kind, setKind] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    api.reports.complianceCalendar(days).then(setData).catch((err) => setError(err?.response?.data?.error || 'Could not load the calendar.'));
  }, [days]);
  if (error) return <div className="form-error">{error}</div>;
  if (!data) return <p>Loading…</p>;
  const items = kind ? data.items.filter((i) => i.kind === kind) : data.items;
  const labels = data.kinds || {};
  return (
    <Card title={`Next ${data.days} days — ${data.totals.items} item(s)${data.totals.overdue ? ` · ${data.totals.overdue} overdue` : ''}${data.totals.within_7_days ? ` · ${data.totals.within_7_days} within 7 days` : ''}`}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Window">
          {[30, 60, 90, 180].map((d) => <option key={d} value={d}>Next {d} days</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">Everything</option>
          {Object.entries(data.totals.by_kind).filter(([, n]) => n > 0).map(([k, n]) => <option key={k} value={k}>{labels[k] || k} ({n})</option>)}
        </select>
      </div>
      {data.older_overdue?.count > 0 && (
        <div className="alert alert-warning" style={{ marginBottom: 10 }}>
          Also overdue for more than {data.days} days: {data.older_overdue.count} item(s), the oldest due {fmtDate(data.older_overdue.oldest)}
          {' '}({Object.entries(data.older_overdue.by_kind).map(([k, n]) => `${labels[k] || k.replaceAll('_', ' ').toLowerCase()}: ${n}`).join(', ')}).
        </div>
      )}
      {items.length === 0 ? <p style={{ margin: 0 }}>Nothing falls due in this window.</p> : (
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr><th>Date</th><th>When</th><th>What</th><th>Detail</th></tr></thead>
            <tbody>
              {items.map((i, n) => (
                <tr key={`${i.kind}-${i.ref}-${n}`}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.date)}</td>
                  <td style={{ whiteSpace: 'nowrap', color: i.overdue ? 'var(--red-strong, #b91c1c)' : i.days_left <= 7 ? 'var(--amber-strong)' : undefined }}>
                    {i.overdue ? `${-i.days_left} day(s) overdue` : i.days_left === 0 ? 'Today' : `in ${i.days_left} day(s)`}
                  </td>
                  <td><Badge status={KIND_TONE[i.kind] || 'DRAFT'} label={i.kind_label} /> {i.link ? <Link to={i.link}>{i.title}</Link> : i.title}</td>
                  <td style={{ fontSize: 13 }}>{i.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
