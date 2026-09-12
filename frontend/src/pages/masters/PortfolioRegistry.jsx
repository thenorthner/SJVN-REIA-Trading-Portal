import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { PageHeader, Card, Badge, StatCard, fmtNumber } from '../../components/ui.jsx';
import { fmtDateTime } from '../../datetime.js';

// The portfolios each exchange has assigned SJVN's trading clients, read from
// the register the desk keeps on Update Portfolio Id. This screen used to show
// one hard-coded company with two invented portfolio ids, a profile drawer of
// made-up contact details, and three buttons that only said "not available".
const EXCHANGE_LABELS = { IEX: 'IEX', PXIL: 'PXIL', HPX: 'HPX', BILATERAL: 'Bilateral' };

export default function PortfolioRegistry() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.clientPortfolios.list()
      .then((r) => setRows(r || []))
      .catch((err) => {
        setError(err?.response?.data?.error || 'Could not load the portfolio register.');
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const byClient = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = r.client_id;
      if (!map.has(key)) map.set(key, { client_id: key, client_name: r.client_name, portfolios: [] });
      map.get(key).portfolios.push(r);
    }
    return [...map.values()].sort((a, b) => String(a.client_name).localeCompare(String(b.client_name)));
  }, [rows]);

  const exchanges = new Set(rows.map((r) => r.exchange));

  return (
    <div>
      <PageHeader
        title="Portfolio Registry"
        subtitle="Which portfolio each exchange has assigned to each trading client"
        actions={<Link className="btn btn-primary" to="/portfolio/update">Record a portfolio</Link>}
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="kpi-grid">
        <StatCard label="Clients with a portfolio" value={fmtNumber(byClient.length)} tone="blue" />
        <StatCard label="Portfolios on record" value={fmtNumber(rows.length)} />
        <StatCard label="Exchanges covered" value={fmtNumber(exchanges.size)} hint={[...exchanges].map((e) => EXCHANGE_LABELS[e] || e).join(', ') || '—'} />
      </div>

      {loading ? (
        <Card><div className="audit-placeholder">Loading the register…</div></Card>
      ) : byClient.length === 0 ? (
        <Card>
          <div className="audit-placeholder">
            <div>No portfolio has been recorded yet.</div>
            <Link className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} to="/portfolio/update">Record the first one</Link>
          </div>
        </Card>
      ) : (
        byClient.map((client) => (
          <Card key={client.client_id} title={client.client_name}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Exchange</th>
                    <th scope="col">Portfolio Id</th>
                    <th scope="col">Portfolio name</th>
                    <th scope="col">Last updated</th>
                  </tr>
                </thead>
                <tbody>
                  {client.portfolios.map((p) => (
                    <tr key={p.id}>
                      <td><Badge status={p.exchange}>{EXCHANGE_LABELS[p.exchange] || p.exchange}</Badge></td>
                      <td><code>{p.portfolio_id}</code></td>
                      <td>{p.portfolio_name}</td>
                      <td>
                        {fmtDateTime(p.updated_at)}
                        {p.updated_by && <div className="audit-muted">by {p.updated_by}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
