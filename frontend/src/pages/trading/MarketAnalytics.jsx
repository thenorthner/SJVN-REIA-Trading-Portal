import React, { useCallback, useEffect, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from '../../api/client.js';
import { PageHeader, StatCard, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';

const EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const PRODUCTS = ['DAM', 'RTM', 'GDAM'];
const EXCHANGE_COLOR = { IEX: '#0b5fff', PXIL: '#f59e0b', HPX: '#10b981' };
const EMPTY_ALERT = { product: 'DAM', condition: 'ABOVE', threshold_price: '' };
const RATE_ROWS_SHOWN = 25;

const rate = (v) => (v == null ? '—' : `₹${Number(v).toFixed(2)}`);

// ₹/unit change vs the previous window of equal length.
function ChangeHint({ percent }) {
  if (percent == null) return <span>No comparable prior period</span>;
  const color = percent > 0 ? 'var(--green)' : percent < 0 ? 'var(--red)' : 'var(--text-light)';
  const arrow = percent > 0 ? '↑' : percent < 0 ? '↓' : '—';
  return <span style={{ color, fontWeight: 600 }}>{arrow} {Math.abs(percent).toFixed(1)}% vs prior period</span>;
}

export default function MarketAnalytics() {
  const [filters, setFilters] = useState({ start_date: '', end_date: '', exchange: '', product: '' });
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState({ points: [], forecast: [], exchanges: [] });
  const [rates, setRates] = useState([]);
  const [events, setEvents] = useState([]);
  const [factors, setFactors] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [latestPrices, setLatestPrices] = useState(null);
  const [blocks, setBlocks] = useState({ date: null, blocks: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [show, setShow] = useState(false);
  const [form, setForm] = useState(EMPTY_ALERT);
  const [formError, setFormError] = useState('');
  const [alertError, setAlertError] = useState('');

  const loadAlerts = useCallback(() => {
    api.marketAnalytics.getAlerts().then(setAlerts).catch(() => setAlertError('Could not load price alerts.'));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = {};
    if (filters.start_date) params.start_date = filters.start_date;
    if (filters.end_date) params.end_date = filters.end_date;
    if (filters.exchange) params.exchange = filters.exchange;
    if (filters.product) params.product = filters.product;

    // allSettled, not all: a single failing panel must not blank the page.
    Promise.allSettled([
      api.marketAnalytics.getSummary(params),
      api.marketAnalytics.getTrend(params),
      api.marketAnalytics.getRates({ ...params, limit: 1000 }),
      api.marketAnalytics.getContext({ start_date: params.start_date, end_date: params.end_date }),
      api.marketAnalytics.getAlerts(),
    ]).then(([s, t, r, c, a]) => {
      const failed = [];
      if (s.status === 'fulfilled') setSummary(s.value); else failed.push('KPIs');
      if (t.status === 'fulfilled') setTrend(t.value || { points: [], forecast: [], exchanges: [] }); else failed.push('charts');
      if (r.status === 'fulfilled') setRates(r.value || []); else failed.push('rates');
      if (c.status === 'fulfilled') {
        setEvents(c.value?.events || []);
        setFactors(c.value?.factors || []);
      } else failed.push('market context');
      if (a.status === 'fulfilled') setAlerts(a.value || []); else failed.push('alerts');

      const firstError = [s, t, r, c, a].find((x) => x.status === 'rejected');
      if (failed.length) {
        setError(firstError?.reason?.response?.data?.error || `Could not load ${failed.join(', ')}.`);
      }
    }).finally(() => setLoading(false));
  }, [filters.start_date, filters.end_date, filters.exchange, filters.product]);

  useEffect(load, [load]);

  // Exchange Price Dashboard: latest price snapshot + intraday MCP-vs-MCV blocks.
  useEffect(() => {
    api.marketAnalytics.getLatestPrices().then(setLatestPrices).catch(() => {});
    const bp = {};
    if (filters.exchange) bp.exchange = filters.exchange;
    if (filters.product) bp.product = filters.product;
    api.marketAnalytics.getBlocks(bp).then(setBlocks).catch(() => setBlocks({ date: null, blocks: [] }));
  }, [filters.exchange, filters.product]);

  function openAdd() { setForm(EMPTY_ALERT); setFormError(''); setShow(true); }

  async function createAlert(e) {
    e.preventDefault();
    setFormError('');
    try {
      await api.marketAnalytics.createAlert(form);
      setShow(false);
      loadAlerts();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create price alert.');
    }
  }

  async function toggleAlert(a) {
    setAlertError('');
    try {
      await api.marketAnalytics.toggleAlert(a.id, !a.is_active);
      loadAlerts();
    } catch (err) {
      setAlertError(err.response?.data?.error || 'Failed to update alert.');
    }
  }

  async function deleteAlert(a) {
    if (!window.confirm(`Delete the ${a.condition} ₹${a.threshold_price} alert on ${a.product}?`)) return;
    setAlertError('');
    try {
      await api.marketAnalytics.deleteAlert(a.id);
      loadAlerts();
    } catch (err) {
      setAlertError(err.response?.data?.error || 'Failed to delete alert.');
    }
  }

  if (loading && !summary) return <div className="page-loading">Loading market analytics...</div>;

  const win = summary?.window;
  const overall = summary?.overall;
  const forecast = summary?.forecast;
  const seriesExchanges = trend.exchanges?.length ? trend.exchanges : EXCHANGES;
  const latestByExchange = (summary?.exchanges || []).map((e) => ({
    exchange: e.exchange, latest: e.latest_mcp, average: e.avg_rate,
  }));
  const triggeredCount = alerts.filter((a) => a.triggered).length;

  const ratesCols = [
    { key: 'rate_date', header: 'Date' },
    { key: 'exchange', header: 'Exchange', render: (r) => <Badge type="primary">{r.exchange || '—'}</Badge> },
    { key: 'product', header: 'Product' },
    { key: 'mcp_rate', header: 'MCP (₹/unit)', render: (r) => <strong>{rate(r.mcp_rate)}</strong> },
    { key: 'min_rate', header: 'Day Low', render: (r) => rate(r.min_rate) },
    { key: 'max_rate', header: 'Day High', render: (r) => rate(r.max_rate) },
    { key: 'forecast_rate', header: 'Forecast', render: (r) => <span style={{ color: 'var(--text-light)' }}>{rate(r.forecast_rate)}</span> },
    {
      key: 'variance',
      header: 'Fcst Error',
      render: (r) => {
        if (r.forecast_rate == null) return '—';
        const d = r.mcp_rate - r.forecast_rate;
        return <span style={{ color: Math.abs(d) > 0.5 ? 'var(--red)' : 'var(--text-light)' }}>{d > 0 ? '+' : ''}{d.toFixed(2)}</span>;
      },
    },
    { key: 'volume_mw', header: 'Volume (MW)', render: (r) => fmtNumber(r.volume_mw, 0) },
    { key: 'data_source', header: 'Source', render: (r) => <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{r.data_source || 'MANUAL'}</span> },
  ];

  const eventsCols = [
    { key: 'event_date', header: 'Date' },
    { key: 'event_type', header: 'Type', render: (r) => String(r.event_type || '').replaceAll('_', ' ') },
    { key: 'description', header: 'Description' },
    {
      key: 'impact_level',
      header: 'Impact',
      render: (r) => <Badge type={r.impact_level === 'HIGH' ? 'danger' : r.impact_level === 'MEDIUM' ? 'warning' : 'success'}>{r.impact_level}</Badge>,
    },
  ];

  const factorsCols = [
    { key: 'factor_date', header: 'Date' },
    { key: 'weather_index', header: 'Peak Temp (°C)', render: (r) => fmtNumber(r.weather_index) },
    { key: 'renewable_forecast_mw', header: 'RE Forecast (MW)', render: (r) => fmtNumber(r.renewable_forecast_mw, 0) },
    { key: 'demand_forecast_mw', header: 'Demand Forecast (MW)', render: (r) => fmtNumber(r.demand_forecast_mw, 0) },
    { key: 'coal_price_index', header: 'Coal Index', render: (r) => fmtNumber(r.coal_price_index) },
  ];

  const alertsCols = [
    { key: 'product', header: 'Product' },
    { key: 'condition', header: 'Condition', render: (a) => (a.condition === 'ABOVE' ? 'Spikes above' : 'Drops below') },
    { key: 'threshold_price', header: 'Threshold', render: (a) => rate(a.threshold_price) },
    {
      key: 'last_rate',
      header: 'Latest Rate',
      render: (a) => (a.last_rate == null ? '—' : (
        <span>{rate(a.last_rate)} <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{a.last_rate_exchange} · {a.last_rate_date}</span></span>
      )),
    },
    {
      key: 'triggered',
      header: 'Signal',
      render: (a) => (a.triggered
        ? <Badge type="danger">Triggered</Badge>
        : <Badge type="neutral">{a.is_active ? 'Watching' : 'Paused'}</Badge>),
    },
    { key: 'is_active', header: 'Status', render: (a) => <Badge type={a.is_active ? 'success' : 'neutral'}>{a.is_active ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions',
      header: '',
      render: (a) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-xs btn-outline" onClick={() => toggleAlert(a)}>{a.is_active ? 'Pause' : 'Resume'}</button>
          <button className="btn btn-xs btn-ghost" onClick={() => deleteAlert(a)}>Delete</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Market Rates & Analytics"
        subtitle="Multi-exchange price discovery (IEX · PXIL · HPX), forecast accuracy and market context"
        actions={<button className="btn btn-primary" onClick={openAdd}>+ Set Price Alert</button>}
      />

      {error && <div className="form-error">{error}</div>}

      {/* Exchange Price Dashboard: latest DAM/RTM/GDAM/REC snapshot */}
      {latestPrices && (
        <div className="kpi-grid" style={{ marginBottom: 8 }}>
          {latestPrices.products.map((p) => (
            <StatCard key={p.product} label={`${p.product} Price`} value={p.mcp_rate != null ? `₹${p.mcp_rate}/unit` : '—'}
              hint={p.date ? `${p.exchange || ''} · ${p.date}${p.volume_mw ? ` · ${fmtNumber(p.volume_mw, 0)} MW` : ''}` : 'No data'} />
          ))}
          <StatCard label="REC Price" value={latestPrices.rec?.price != null ? `₹${latestPrices.rec.price}` : '—'}
            hint={latestPrices.rec?.date ? `traded ${latestPrices.rec.date}` : 'per REC'} tone="green" />
        </div>
      )}

      {/* Time-block-wise MCP vs MCV (cleared volume) */}
      {blocks.blocks?.length > 0 && (
        <Card title={`Time-block MCP vs MCV — ${blocks.date}`} style={{ marginBottom: 16 }}>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <ComposedChart data={blocks.blocks}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="time_block" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis yAxisId="mcv" tick={{ fontSize: 10 }} label={{ value: 'MCV (MW)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <YAxis yAxisId="mcp" orientation="right" tick={{ fontSize: 10 }} label={{ value: 'MCP (₹)', angle: 90, position: 'insideRight', fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="mcv" dataKey="mcv" name="MCV (MW)" fill="#93c5fd" />
                <Line yAxisId="mcp" type="monotone" dataKey="mcp" name="MCP (₹/unit)" stroke="#0b5fff" strokeWidth={2.2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="kpi-grid">
        <StatCard
          label="Average MCP"
          value={rate(overall?.avg_rate)}
          tone="blue"
          hint={<ChangeHint percent={summary?.previous?.change_percent} />}
        />
        <StatCard label="Period High" value={rate(overall?.max_rate)} tone="red" hint="Highest cleared price in window" />
        <StatCard label="Period Low" value={rate(overall?.min_rate)} tone="green" hint="Lowest cleared price in window" />
        <StatCard
          label="Best Realisation"
          value={summary?.best_exchange?.exchange || '—'}
          hint={summary?.best_exchange
            ? `Avg ${rate(summary.best_exchange.avg_rate)}${summary.worst_exchange ? ` · lowest ${summary.worst_exchange.exchange} ${rate(summary.worst_exchange.avg_rate)}` : ''}`
            : 'Not enough data'}
        />
        <StatCard label="Cleared Volume" value={`${fmtNumber(overall?.total_volume_mw, 0)} MW`} hint={`${fmtNumber(overall?.observations, 0)} daily observations`} />
        <StatCard
          label="Forecast Accuracy"
          value={forecast?.accuracy_percent == null ? '—' : `${forecast.accuracy_percent.toFixed(1)}%`}
          tone={forecast?.accuracy_percent >= 90 ? 'green' : 'amber'}
          hint={forecast?.mape_percent == null ? 'No forecasts published' : `MAPE ${forecast.mape_percent.toFixed(2)}% · avg error ${rate(forecast.avg_abs_error)}`}
        />
      </div>

      <div className="filters-bar">
        <input type="date" value={filters.start_date} onChange={(e) => setFilters({ ...filters, start_date: e.target.value })} />
        <input type="date" value={filters.end_date} onChange={(e) => setFilters({ ...filters, end_date: e.target.value })} />
        <select value={filters.exchange} onChange={(e) => setFilters({ ...filters, exchange: e.target.value })}>
          <option value="">All exchanges</option>
          {EXCHANGES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={filters.product} onChange={(e) => setFilters({ ...filters, product: e.target.value })}>
          <option value="">All products</option>
          {PRODUCTS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <button className="btn btn-outline" onClick={() => setFilters({ start_date: '', end_date: '', exchange: '', product: '' })}>Reset</button>
        {win && <span className="inline-note" style={{ marginTop: 0 }}>Showing {win.start_date} → {win.end_date} ({win.days} days)</span>}
      </div>

      <Card title="Multi-Exchange Price Trend (MCP ₹/unit)">
        {trend.points?.length ? (
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend.points}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ed" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} domain={['auto', 'auto']} tickFormatter={(v) => `₹${v}`} />
                <Tooltip formatter={(v, name) => [`₹${Number(v).toFixed(2)}`, name]} />
                <Legend />
                {seriesExchanges.map((ex) => (
                  <Line key={ex} type="monotone" dataKey={ex} name={ex} stroke={EXCHANGE_COLOR[ex] || '#64748b'} strokeWidth={2.2} dot={false} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="empty-cell">No rate data for the selected filters.</div>}
      </Card>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <Card title="Forecast vs Actual (₹/unit)">
          {trend.forecast?.length ? (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend.forecast}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ed" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} domain={['auto', 'auto']} tickFormatter={(v) => `₹${v}`} />
                  <Tooltip formatter={(v, name) => [`₹${Number(v).toFixed(2)}`, name]} />
                  <Legend />
                  <Line type="monotone" dataKey="actual" name="Actual MCP" stroke="#0b5fff" strokeWidth={2.4} dot={false} />
                  <Line type="monotone" dataKey="forecast" name="Day-ahead forecast" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="empty-cell">No forecast published for this window.</div>}
          {forecast?.observations > 0 && (
            <p className="inline-note">
              MAPE {forecast.mape_percent?.toFixed(2)}% across {fmtNumber(forecast.observations, 0)} observations
              (mean absolute error {rate(forecast.avg_abs_error)}).
            </p>
          )}
        </Card>

        <Card title="Exchange Comparison">
          {latestByExchange.length ? (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={latestByExchange}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ed" />
                  <XAxis dataKey="exchange" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${v}`} />
                  <Tooltip formatter={(v, name) => [`₹${Number(v).toFixed(2)}`, name]} />
                  <Legend />
                  <Bar dataKey="latest" name="Latest MCP" fill="#0b5fff" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="average" name="Window average" fill="#94a3b8" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="empty-cell">No exchange data for the selected filters.</div>}
          <p className="inline-note">Latest MCP is the average across products on each exchange's most recent trade date.</p>
        </Card>
      </div>

      <Card
        title="Discovered Rates"
        style={{ marginTop: 16 }}
        actions={<span className="inline-note" style={{ marginTop: 0 }}>{fmtNumber(rates.length, 0)} rows in window</span>}
      >
        <Table
          columns={ratesCols}
          rows={rates.slice(0, RATE_ROWS_SHOWN)}
          loading={loading}
          emptyMessage="No rates recorded for the selected filters."
        />
        {rates.length > RATE_ROWS_SHOWN && (
          <p className="inline-note">Showing the {RATE_ROWS_SHOWN} most recent of {fmtNumber(rates.length, 0)} rows — narrow the date range or filter by exchange/product to see the rest.</p>
        )}
      </Card>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <Card title="Market Events">
          <Table columns={eventsCols} rows={events} loading={loading} emptyMessage="No market events recorded in this window." />
        </Card>
        <Card title="External Factors (Weather, RE & Fuel)">
          <Table columns={factorsCols} rows={factors.slice(0, 12)} loading={loading} emptyMessage="No external factor data in this window." />
          {factors.length > 12 && <p className="inline-note">Showing the 12 most recent of {fmtNumber(factors.length, 0)} days.</p>}
        </Card>
      </div>

      <Card
        title="Price Alerts"
        style={{ marginTop: 16 }}
        actions={triggeredCount > 0 ? <Badge type="danger">{triggeredCount} triggered</Badge> : null}
      >
        {alertError && <div className="form-error">{alertError}</div>}
        <Table
          columns={alertsCols}
          rows={alerts}
          loading={loading}
          emptyMessage="No price alerts yet. Use “Set Price Alert” to watch a product."
        />
        <p className="inline-note">
          Alerts are evaluated against the latest cleared rate on every load — an “above” alert fires when any exchange
          clears at or over the threshold, a “below” alert when any exchange clears at or under it.
        </p>
      </Card>

      <Modal open={show} onClose={() => setShow(false)} title="Set Market Price Alert" width={440}>
        <form onSubmit={createAlert}>
          {formError && <div className="form-error">{formError}</div>}
          <Field label="Product" required>
            <select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}>
              {PRODUCTS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="Condition" required>
            <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
              <option value="ABOVE">Spikes above</option>
              <option value="BELOW">Drops below</option>
            </select>
          </Field>
          <Field label="Threshold Price (₹/unit)" required>
            <input type="number" step="0.01" min="0.01" required value={form.threshold_price} onChange={(e) => setForm({ ...form, threshold_price: e.target.value })} />
          </Field>
          <p className="inline-note">
            Current average MCP in this window is {rate(overall?.avg_rate)} (high {rate(overall?.max_rate)} / low {rate(overall?.min_rate)}).
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Alert</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
