import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Field } from '../../components/ui.jsx';

// ISET's Update Portfolio Id: which portfolio each exchange assigned a client.
//
// This screen used to carry a hard-coded list of client names and a Save button
// that only wrote to the browser console, so nothing the desk entered was kept.
// It reads the live client list and saves to /api/client-portfolios, which
// keeps one portfolio per client per exchange and refuses a portfolio that
// another client already holds.

const EXCHANGES = [
  { value: 'IEX', label: 'IEX' },
  { value: 'PXIL', label: 'PXIL' },
  { value: 'HPX', label: 'HPX' },
  { value: 'BILATERAL', label: 'Bilateral' },
];
const EMPTY = { client_id: '', exchange: 'IEX', portfolio_id: '', portfolio_name: '' };

const labelOf = (x) => EXCHANGES.find((e) => e.value === x)?.label || x;
const when = (ts) => (ts ? String(ts).slice(0, 16).replace('T', ' ') : '—');

export default function UpdatePortfolioID() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.TRADING_WRITE.includes(user?.role);

  const [clients, setClients] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadMappings = useCallback(() => api.clientPortfolios.list()
    .then((rows) => setMappings(rows || []))
    .catch((e) => setError(e?.response?.data?.error || e?.message || 'Could not load the portfolio register')), []);

  useEffect(() => {
    Promise.all([
      api.tradingClients.list({ status: 'ACTIVE' }).then((rows) => setClients(rows || [])).catch(() => setClients([])),
      loadMappings(),
    ]).finally(() => setLoading(false));
  }, [loadMappings]);

  // What is on record for the client and exchange picked, so the desk sees the
  // id it is about to replace rather than overwriting it blind.
  const current = useMemo(
    () => mappings.find((m) => m.client_id === form.client_id && m.exchange === form.exchange) || null,
    [mappings, form.client_id, form.exchange],
  );

  // Choosing a client and exchange that already have a portfolio fills it in;
  // choosing one that has none clears the previous client's figures.
  useEffect(() => {
    setForm((f) => ({ ...f, portfolio_id: current?.portfolio_id || '', portfolio_name: current?.portfolio_name || '' }));
  }, [current]);

  const set = (k) => (e) => {
    setNotice(''); setError('');
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  async function save(e) {
    e.preventDefault();
    setError(''); setNotice(''); setSaving(true);
    try {
      const row = await api.clientPortfolios.save(form);
      setNotice(`Saved — ${row.client_name} trades on ${labelOf(row.exchange)} as ${row.portfolio_id}.`);
      await loadMappings();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Could not save the portfolio');
    } finally {
      setSaving(false);
    }
  }

  const pick = (r) => {
    setNotice(''); setError('');
    setForm({ client_id: r.client_id, exchange: r.exchange, portfolio_id: r.portfolio_id, portfolio_name: r.portfolio_name });
  };

  const columns = [
    { key: 'client_name', label: 'Client' },
    { key: 'exchange', label: 'Exchange', render: (r) => labelOf(r.exchange) },
    { key: 'portfolio_id', label: 'Portfolio Id', render: (r) => <code>{r.portfolio_id}</code> },
    { key: 'portfolio_name', label: 'Portfolio Name' },
    { key: 'updated_at', label: 'Last Updated', render: (r) => when(r.updated_at) },
  ];

  return (
    <div>
      <PageHeader title="Update Portfolio Id" subtitle="The portfolio each exchange has assigned a trading client" />

      {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {notice && <div className="alert alert-success" role="status" style={{ marginBottom: 12 }}>{notice}</div>}

      <Card title="Portfolio mapping">
        <form onSubmit={save}>
          <div className="form-grid">
            <Field label="Client Name" required htmlFor="pf-client">
              <select id="pf-client" value={form.client_id} onChange={set('client_id')} required disabled={!canWrite}>
                <option value="">— select a client —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Exchange Name" required htmlFor="pf-exchange">
              <select id="pf-exchange" value={form.exchange} onChange={set('exchange')} required disabled={!canWrite}>
                {EXCHANGES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </Field>
            <Field label="Portfolio Id" required htmlFor="pf-id">
              <input
                id="pf-id" value={form.portfolio_id} onChange={set('portfolio_id')} required
                maxLength={40} placeholder="e.g. N1HP0PTC0850" autoComplete="off" disabled={!canWrite}
              />
            </Field>
            <Field label="Portfolio Name" required htmlFor="pf-name">
              <input
                id="pf-name" value={form.portfolio_name} onChange={set('portfolio_name')} required
                maxLength={120} autoComplete="off" disabled={!canWrite}
              />
            </Field>
          </div>

          {form.client_id && (
            <p style={{ color: 'var(--text-light)', fontSize: 13, margin: '4px 0 12px' }}>
              {current
                ? <>On record: <strong>{current.portfolio_id}</strong> — {current.portfolio_name}, last updated {when(current.updated_at)}. Saving replaces it.</>
                : <>No {labelOf(form.exchange)} portfolio is on record for this client yet.</>}
            </p>
          )}

          {canWrite ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={saving || !form.client_id}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn" onClick={() => { setForm(EMPTY); setNotice(''); setError(''); }}>
                Clear
              </button>
            </div>
          ) : (
            <p style={{ color: 'var(--text-light)', fontSize: 13 }}>
              Read-only — changing a portfolio needs a trading desk role.
            </p>
          )}
        </form>
      </Card>

      <Card title={`Portfolios on record (${mappings.length})`}>
        <Table
          columns={columns} rows={mappings} loading={loading}
          onRowClick={canWrite ? pick : undefined}
          emptyMessage="No portfolio has been recorded yet."
        />
      </Card>
    </div>
  );
}
