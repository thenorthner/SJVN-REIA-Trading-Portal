import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { PageHeader, Card, Badge, StatCard, fmtNumber } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// The clients the desk trades for. This screen used to show one row reading
// "Demo Value" in every column — client id, contact person, bank account, IFSC —
// and a search box that filtered nothing. It reads `trading_clients` now, and
// shows the fields that register actually keeps.

const TYPES = ['GENERATOR', 'DISCOM', 'TRADER', 'C&I', 'OTHER'];

export default function ClientDetails() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');

  useEffect(() => {
    api.tradingClients.list()
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((err) => setError(err?.response?.data?.error || 'Could not load the client register.'))
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (type && r.client_type !== type) return false;
      if (!needle) return true;
      return [r.id, r.name, r.client_type, r.sldc_name, r.noar_id, r.standing_clearance_no]
        .join(' ').toLowerCase().includes(needle);
    });
  }, [rows, q, type]);

  const active = rows.filter((r) => r.status === 'ACTIVE').length;

  return (
    <div className="page">
      <PageHeader
        title="Client Details"
        subtitle="The trading clients on record, as the desk registered them"
        actions={<Link className="btn btn-primary" to="/trading/clients">Open the client master</Link>}
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="kpi-grid">
        <StatCard label="Clients on record" value={fmtNumber(rows.length, 0)} tone="blue" />
        <StatCard label="Active" value={fmtNumber(active, 0)} tone="green" />
        <StatCard label="Suspended or inactive" value={fmtNumber(rows.length - active, 0)} tone={rows.length - active ? 'amber' : 'default'} />
      </div>

      <Card>
        <div className="report-toolbar">
          <label className="report-search">
            Type:
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="report-search">
            Search:
            <input
              type="search"
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, id, SLDC, NOAR id"
            />
          </label>
        </div>

        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: 64 }}>Sr. No.</th>
                <th scope="col">Client ID</th>
                <th scope="col">Client Name</th>
                <th scope="col">Category</th>
                <th scope="col">SLDC</th>
                <th scope="col">Standing Clearance No.</th>
                <th scope="col">NOC Valid Till</th>
                <th scope="col" className="num">T-GNA (MW)</th>
                <th scope="col" className="num">Exposure Limit (Rs.)</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="empty-cell" colSpan={10}>Loading the client register…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td className="empty-cell" colSpan={10}>{rows.length ? 'No client matches this selection' : 'No clients on record'}</td></tr>
              ) : shown.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td><Link className="btn-link" to={`/trading/clients/${r.id}`}>{r.id}</Link></td>
                  <td>{r.name}</td>
                  <td>{r.client_type}</td>
                  <td>{r.sldc_name || '—'}</td>
                  <td>{r.standing_clearance_no || '—'}</td>
                  <td>{r.noc_valid_till ? fmtDate(r.noc_valid_till) : '—'}</td>
                  <td className="num">{r.tgna_approved_mw != null ? fmtNumber(r.tgna_approved_mw) : '—'}</td>
                  <td className="num">{fmtNumber(r.exposure_limit, 0)}</td>
                  <td><Badge status={r.status}>{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="report-count">
          Showing {shown.length} of {rows.length} {rows.length === 1 ? 'client' : 'clients'}
          {(q.trim() || type) && rows.length !== shown.length ? ' (filtered)' : ''}.
        </p>
      </Card>
    </div>
  );
}
