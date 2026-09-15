import React, { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, LineChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Badge, StatCard, Modal, Field, Tabs, Tab, fmtNumber } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';

// Where exchange prices are going, and how close earlier forecasts came.
//
// Every figure here is either a price the platform actually holds — the CERC
// monthly report, an exchange price file the desk loaded, the IEX API — or a
// forecast made from those prices up to a stated date and nothing after it.
// The screen says which, and how old the newest price was when the forecast was
// made: a "week ahead" forecast off prices six months old is a forecast of six
// months ago, and it looks exactly like a real one unless somebody says so.

// Validated pair (dataviz validator, light surface): actual in the primary
// blue, forecast in amber, the forecast also dashed so identity is never colour
// alone.
const ACTUAL = 'var(--primary)';
const FORECAST = 'var(--amber)';

const rs = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (v) => (v == null ? '—' : `${fmtNumber(v, 1)}%`);
const signedRs = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${rs(Math.abs(v))}`);
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const errorOf = (err, fallback) => err?.response?.data?.error || err?.message || fallback;
// Two cards side by side only when each can hold its table without scrolling it sideways.
const PAIR = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(520px, 1fr))', gap: 16 };

/** Save a blob the browser already holds, without a second unauthenticated request. */
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 12, boxShadow: 'var(--shadow-md)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{row.time_block || `${weekday(label)} ${fmtDate(label)}`}</div>
      {row.actual != null && <div>Actual {rs(row.actual)}/kWh</div>}
      {row.forecast != null && <div>Forecast {rs(row.forecast)}/kWh</div>}
      {row.band && <div style={{ color: 'var(--text-muted)' }}>80% range {rs(row.band[0])} – {rs(row.band[1])}</div>}
    </div>
  );
}

function ForecastChart({ rows, height = 300 }) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={48} tickFormatter={(v) => `₹${v}`} domain={['auto', 'auto']} />
          <Tooltip content={<ChartTooltip />} />
          <Legend verticalAlign="top" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          <Area dataKey="band" name="80% range" stroke="none" fill={FORECAST} fillOpacity={0.12} isAnimationActive={false} />
          <Line dataKey="actual" name="Actual" stroke={ACTUAL} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="forecast" name="Forecast" stroke={FORECAST} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 4, fill: FORECAST, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function RunSummary({ detail }) {
  const { run, points, realised } = detail;
  const next = points[0];
  const avg = points.reduce((a, p) => a + p.forecast, 0) / points.length;
  return (
    <div className="kpi-grid">
      <StatCard
        label={`Forecast for ${fmtDate(next.date)}`}
        value={`${rs(next.forecast)}/kWh`}
        hint={next.lower != null ? `80% range ${rs(next.lower)} – ${rs(next.upper)}` : 'No range: too little history to test against'}
        tone="blue"
      />
      <StatCard
        label={`Average over ${run.horizon_days} day${run.horizon_days === 1 ? '' : 's'}`}
        value={`${rs(avg)}/kWh`}
        hint={`${fmtDate(run.first_target_date)} → ${fmtDate(run.last_target_date)}`}
      />
      <StatCard
        label="Backtest error (MAPE)"
        value={pct(run.backtest_mape)}
        hint={run.backtest_origins ? `${run.model_label}, from ${run.backtest_origins} earlier cutoffs` : `${run.model_label} — not enough history to test`}
        tone={run.backtest_mape == null ? 'amber' : 'default'}
      />
      <StatCard
        label="Against what cleared"
        value={realised.scored_days ? pct(realised.mape) : 'Awaiting prices'}
        hint={realised.scored_days
          ? `${realised.scored_days} of ${points.length} days cleared${realised.within_band_pct != null ? ` · ${fmtNumber(realised.within_band_pct, 0)}% inside the range` : ''}`
          : `None of the ${points.length} days has a price loaded yet`}
        tone={realised.scored_days ? 'green' : 'default'}
      />
    </div>
  );
}

function BlockCard({ detail, onDate }) {
  const { run, blocks } = detail;
  if (!blocks.dates.length) {
    return (
      <Card title="Block-wise (96 blocks)">
        <div className="audit-placeholder">
          No block-wise {run.exchange} {run.product} prices were loaded in the four weeks up to {fmtDate(run.cutoff_date)}, so
          there is no intraday shape to lay the day's forecast over. Load the exchange's time-block price file and forecast again.
        </div>
      </Card>
    );
  }
  const hasActual = blocks.rows.some((b) => b.actual != null);
  return (
    <Card
      title="Block-wise (96 blocks)"
      actions={(
        <label className="report-search">
          Day
          <select className="input" style={{ width: 170 }} value={blocks.date} onChange={(e) => onDate(e.target.value)}>
            {blocks.dates.map((d) => <option key={d} value={d}>{weekday(d)} {fmtDate(d)}</option>)}
          </select>
        </label>
      )}
    >
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={blocks.rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="time_block" interval={11} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={48} tickFormatter={(v) => `₹${v}`} />
            <Tooltip content={<ChartTooltip />} />
            {hasActual && <Legend verticalAlign="top" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />}
            {hasActual && <Line dataKey="actual" name="Actual" stroke={ACTUAL} strokeWidth={2} dot={false} isAnimationActive={false} />}
            <Line dataKey="forecast" name="Forecast" stroke={FORECAST} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="report-count">
        The day's forecast laid over how {run.exchange} {run.product} prices spread across the day in the {run.block_shape_days} block-wise
        day{run.block_shape_days === 1 ? '' : 's'} loaded before the cutoff, weekdays and weekends shaped separately. The shape has not been
        backtested, so blocks carry no range. Laid out for the first {blocks.dates.length} day{blocks.dates.length === 1 ? '' : 's'} only.
      </p>
    </Card>
  );
}

function ForecastTab({ detail, labels, onBlockDate }) {
  const { run, points, history } = detail;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  async function download() {
    setExporting(true);
    setExportError('');
    try {
      saveBlob(await api.marketForecast.exportRun(run.id), `SJVN_Price_Forecast_${run.exchange}_${run.product}_${run.first_target_date}_to_${run.last_target_date}.xlsx`);
    } catch {
      setExportError('The workbook could not be downloaded. Try again.');
    } finally {
      setExporting(false);
    }
  }

  const chartRows = useMemo(() => {
    const byDate = new Map(history.map((h) => [h.date, { date: h.date, actual: h.price }]));
    for (const p of points) {
      byDate.set(p.date, {
        date: p.date,
        actual: p.actual,
        forecast: p.forecast,
        band: p.lower != null ? [p.lower, p.upper] : undefined,
      });
    }
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [history, points]);

  const sources = Object.entries(run.sources || {}).map(([k, n]) => `${labels[k] || k} ${n}`).join(' · ');

  return (
    <>
      {run.data_age_days > 3 && (
        <div className="alert alert-warning" role="alert">
          The newest {run.exchange} {run.product} price this run could see is {fmtDate(run.cutoff_date)} — {run.data_age_days} days
          before the run was made — so it forecasts {fmtDate(run.first_target_date)} to {fmtDate(run.last_target_date)}, not the days
          ahead. Load the exchange's price files for the days since to forecast from today.
        </div>
      )}

      <RunSummary detail={detail} />

      {exportError && <div className="alert alert-error" role="alert">{exportError}</div>}

      <Card
        title={`${run.exchange} ${run.product} — daily price, ₹/kWh`}
        actions={(
          <button type="button" className="btn btn-secondary btn-sm" disabled={exporting} onClick={download}>
            {exporting ? 'Preparing…' : 'Download Excel'}
          </button>
        )}
      >
        <ForecastChart rows={chartRows} />
        <p className="report-count">
          {run.model_label}{run.selection === 'BEST_BACKTEST' ? ' — the closest of five models on this series\' own recent past' : run.selection === 'FALLBACK' ? ' — too little history to compare models, so the simplest one that fits' : ' — as requested'}.
          Trained on {run.history_days} days, {fmtDate(run.history_from)} to {fmtDate(run.cutoff_date)} ({sources}).
          The range is the 10th–90th percentile of this model's own backtest misses at each distance.
        </p>
      </Card>

      <div style={PAIR}>
        <Card title="Forecast">
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col" className="num">Forecast</th>
                  <th scope="col" className="num">80% range</th>
                  <th scope="col" className="num">Actual</th>
                  <th scope="col" className="num">Error</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.date}>
                    <td>{weekday(p.date)} {fmtDate(p.date)}</td>
                    <td className="num">{rs(p.forecast)}</td>
                    <td className="num">{p.lower != null ? `${rs(p.lower)} – ${rs(p.upper)}` : '—'}</td>
                    <td className="num">
                      {rs(p.actual)}
                      {p.within_band === false && <div><Badge type="warning">Outside range</Badge></div>}
                    </td>
                    <td className="num">{p.abs_pct_error != null ? `${signedRs(p.error)} (${pct(p.abs_pct_error)})` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Models tested">
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col" className="num">MAPE</th>
                  <th scope="col" className="num">MAE ₹</th>
                  <th scope="col" className="num">Bias ₹</th>
                  <th scope="col" className="num">Cutoffs</th>
                </tr>
              </thead>
              <tbody>
                {run.backtest.map((b) => (
                  <tr key={b.model}>
                    <td>
                      {b.label}
                      {b.model === run.model && <> <Badge type="primary">Published</Badge></>}
                    </td>
                    <td className="num">{pct(b.mape)}</td>
                    <td className="num">{b.mae != null ? fmtNumber(b.mae, 3) : '—'}</td>
                    <td className="num">{b.bias != null ? fmtNumber(b.bias, 3) : '—'}</td>
                    <td className="num">{b.origins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="report-count">
            Each model stood at earlier cutoffs, forecast the same {run.horizon_days} day{run.horizon_days === 1 ? '' : 's'} ahead from only
            what was known then, and was scored against what cleared. Bias above zero means it forecast high.
          </p>
        </Card>
      </div>

      <BlockCard detail={detail} onDate={onBlockDate} />
    </>
  );
}

function AccuracyTab({ accuracy }) {
  if (!accuracy) return <Card><div className="audit-placeholder">Loading…</div></Card>;
  const { summary } = accuracy;
  if (!summary.forecast_days) {
    return <Card><div className="audit-placeholder">No {accuracy.exchange} {accuracy.product} forecast has been made yet.</div></Card>;
  }
  const scoredDays = accuracy.days.filter((d) => d.actual != null);
  return (
    <>
      <div className="kpi-grid">
        <StatCard label="Days scored" value={`${fmtNumber(summary.scored_days, 0)} of ${fmtNumber(summary.forecast_days, 0)}`} hint={summary.awaiting_days ? `${summary.awaiting_days} still waiting for a price` : 'Every forecast day has cleared'} tone="blue" />
        <StatCard label="MAPE" value={pct(summary.mape)} hint="Mean absolute % error, day by day" />
        <StatCard label="Bias" value={summary.bias != null ? `${signedRs(summary.bias)}/kWh` : '—'} hint="Above zero: forecasts ran high" />
        <StatCard label="Inside the 80% range" value={pct(summary.within_band_pct)} hint="Near 80% means the range is honest" tone={summary.within_band_pct != null && Math.abs(summary.within_band_pct - 80) > 15 ? 'amber' : 'default'} />
      </div>

      {scoredDays.length > 0 ? (
        <Card title="Forecast against actual">
          <ForecastChart rows={accuracy.days.map((d) => ({ date: d.date, actual: d.actual, forecast: d.forecast, band: d.lower != null ? [d.lower, d.upper] : undefined }))} />
          <p className="report-count">
            Each day shows the forecast made from the newest data before it — the one the desk would have been looking at.
            Newest price held: {fmtDate(accuracy.latest_actual_date)}.
          </p>
        </Card>
      ) : (
        <Card>
          <div className="audit-placeholder">
            None of the forecast days has a price loaded yet — the newest {accuracy.exchange} {accuracy.product} price the platform holds is {fmtDate(accuracy.latest_actual_date)}.
          </div>
        </Card>
      )}

      <div style={PAIR}>
        <ScoreTable title="By distance ahead" first="Distance" rows={accuracy.by_horizon.map((r) => ({ ...r, label: r.key }))}
          note="Every forecast ever made for a day, grouped by how far ahead it was made." />
        <ScoreTable title="By model" first="Model" rows={accuracy.by_model} note="Every scored forecast, by the model that made it." />
      </div>
    </>
  );
}

function ScoreTable({ title, first, rows, note }) {
  return (
    <Card title={title}>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th scope="col">{first}</th>
              <th scope="col" className="num">Forecasts</th>
              <th scope="col" className="num">MAPE</th>
              <th scope="col" className="num">Bias ₹</th>
              <th scope="col" className="num">In range</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="empty-cell" colSpan={5}>Nothing scored yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="num">{r.forecasts}</td>
                <td className="num">{pct(r.mape)}</td>
                <td className="num">{r.bias != null ? fmtNumber(r.bias, 3) : '—'}</td>
                <td className="num">{pct(r.within_band_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="report-count">{note}</p>
    </Card>
  );
}

function RunsTab({ runs, currentId, onOpen }) {
  return (
    <Card title="Forecast runs">
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th scope="col">Made</th>
              <th scope="col">Model</th>
              <th scope="col">Prices up to</th>
              <th scope="col">Forecasts</th>
              <th scope="col" className="num">Backtest MAPE</th>
              <th scope="col" className="num">Against actual</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr><td className="empty-cell" colSpan={6}>No forecast has been made for this series.</td></tr>
            ) : runs.map((r) => (
              <tr key={r.id} onClick={() => onOpen(r.id)} style={{ cursor: 'pointer' }}>
                <td>
                  {fmtDateTime(r.created_at)}
                  {r.id === currentId && <> <Badge type="primary">Showing</Badge></>}
                  <div className="audit-muted">{r.trigger_type === 'SCHEDULED' ? 'Scheduled' : (r.created_by_name || 'Desk')}</div>
                </td>
                <td>
                  {r.model_label}
                  {r.requested_model === 'AUTO' && <div className="audit-muted">Auto</div>}
                </td>
                <td>{fmtDate(r.cutoff_date)}</td>
                <td>{fmtDate(r.first_target_date)} → {fmtDate(r.last_target_date)}</td>
                <td className="num">{pct(r.backtest_mape)}</td>
                <td className="num">
                  {r.realised.scored_days ? pct(r.realised.mape) : '—'}
                  <div className="audit-muted">{r.realised.scored_days} of {r.horizon_days} days</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="report-count">Runs are never edited. A better forecast is a new run, and the old one stays to be scored.</p>
    </Card>
  );
}

function UploadModal({ open, onClose, defaults, onLoaded }) {
  const [form, setForm] = useState({ exchange: defaults.exchange, product: defaults.product, date: '', file: null });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({ exchange: defaults.exchange, product: defaults.product, date: '', file: null });
      setResult(null);
      setFailure(null);
    }
  }, [open, defaults.exchange, defaults.product]);

  async function submit(e) {
    e.preventDefault();
    if (!form.file) return setFailure({ error: 'Choose the file to load.' });
    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      const r = await api.marketForecast.uploadPrices(form);
      setResult(r);
      onLoaded(r);
    } catch (err) {
      setFailure({ error: errorOf(err, 'The file could not be loaded.'), errors: err?.response?.data?.errors || [] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Load an exchange price file" width={620}>
      <form onSubmit={submit}>
        <p className="audit-muted" style={{ marginTop: 0 }}>
          The exchange's own block-wise download — one row per 15-minute block with its clearing price (MCP) and volume
          (MCV). Rs/MWh or Rs/kWh, Excel or CSV. A date in the file replaces whatever is held for that exchange, product and date.
          {' '}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ padding: 0, textDecoration: 'underline' }}
            onClick={() => api.marketForecast.priceFileTemplate()
              .then((blob) => saveBlob(blob, 'exchange_price_file_template.csv'))
              .catch(() => setFailure({ error: 'The template could not be downloaded.' }))}
          >
            Download a blank template
          </button>
        </p>
        <div className="form-grid">
          <Field label="Exchange" required>
            <select value={form.exchange} onChange={(e) => setForm({ ...form, exchange: e.target.value })}>
              {['IEX', 'PXIL', 'HPX'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="Product" required>
            <select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}>
              {['DAM', 'GDAM', 'RTM'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="Delivery date (if the file has no date column)">
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="File" required>
            <input type="file" accept=".xls,.xlsx,.csv" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} />
          </Field>
        </div>

        {failure && (
          <div className="alert alert-error" role="alert">
            {failure.error}
            {failure.errors?.length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {failure.errors.map((x) => <li key={x}>{x}</li>)}
              </ul>
            )}
          </div>
        )}
        {result && (
          <div className="alert alert-success" role="status">
            Loaded {result.rows} block price{result.rows === 1 ? '' : 's'} for {result.exchange} {result.product}
            {result.price_unit === 'Rs/MWh' ? ' (converted from Rs/MWh)' : ''}
            {result.replaced_rows ? `, replacing ${result.replaced_rows} row${result.replaced_rows === 1 ? '' : 's'} held before` : ''}.
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {result.days.map((d) => (
                <li key={d.date}>
                  {fmtDate(d.date)}: {d.blocks} of 96 blocks, day's price {rs(d.daily_price)}/kWh
                  {!d.counts_as_daily_price && ' — too incomplete to count as the day\'s price'}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Loading…' : 'Load prices'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function MarketForecasting() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.TRADING_WRITE.includes(user?.role);

  const [meta, setMeta] = useState(null);
  const [sel, setSel] = useState({ exchange: 'IEX', product: 'DAM' });
  const [form, setForm] = useState({ horizon_days: 7, model: 'AUTO', cutoff_date: '' });
  const [detail, setDetail] = useState(null);
  const [runs, setRuns] = useState([]);
  const [accuracy, setAccuracy] = useState(null);
  const [tab, setTab] = useState('forecast');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const series = meta?.series.find((s) => s.exchange === sel.exchange && s.product === sel.product);

  async function loadMeta() {
    const m = await api.marketForecast.series();
    setMeta(m);
    return m;
  }

  async function loadSeries(next, { runId } = {}) {
    setError('');
    try {
      const [runList, acc] = await Promise.all([
        api.marketForecast.runs(next),
        api.marketForecast.accuracy(next),
      ]);
      setRuns(runList.runs);
      setAccuracy(acc);
      const open = runId || runList.runs[0]?.id;
      setDetail(open ? await api.marketForecast.run(open) : null);
    } catch (err) {
      setError(errorOf(err, 'Could not load the forecasts.'));
    }
  }

  useEffect(() => {
    loadMeta()
      .then((m) => {
        // Open on the first series that has any prices, rather than an empty one.
        const first = m.series.find((s) => s.days > 0) || m.series[0];
        const next = { exchange: first.exchange, product: first.product };
        setSel(next);
        return loadSeries(next);
      })
      .catch((err) => setError(errorOf(err, 'Could not load the price history.')));
  }, []);

  function choose(patch) {
    const next = { ...sel, ...patch };
    setSel(next);
    setDetail(null);
    setAccuracy(null);
    loadSeries(next);
  }

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const created = await api.marketForecast.createRun({
        ...sel,
        horizon_days: Number(form.horizon_days),
        model: form.model,
        cutoff_date: form.cutoff_date || null,
      });
      setTab('forecast');
      await Promise.all([loadMeta(), loadSeries(sel, { runId: created.run.id })]);
    } catch (err) {
      setError(errorOf(err, 'The forecast could not be made.'));
    } finally {
      setBusy(false);
    }
  }

  async function openRun(id) {
    try {
      setDetail(await api.marketForecast.run(id));
      setTab('forecast');
    } catch (err) {
      setError(errorOf(err, 'Could not open that run.'));
    }
  }

  async function blockDate(date) {
    try {
      setDetail(await api.marketForecast.run(detail.run.id, { block_date: date }));
    } catch (err) {
      setError(errorOf(err, 'Could not load that day\'s blocks.'));
    }
  }

  const productLabel = (p) => {
    const s = meta?.series.find((x) => x.exchange === sel.exchange && x.product === p);
    return s ? `${p} — ${s.days ? `${s.days} days` : 'no prices'}` : p;
  };

  return (
    <div className="page">
      <PageHeader
        title="Market Price Forecasting"
        subtitle="DAM, GDAM and RTM clearing prices: what the models expect, and how close earlier forecasts came"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <Card>
        <div className="report-criteria">
          <label className="report-search">
            Exchange
            <select className="input" style={{ width: 110 }} value={sel.exchange} onChange={(e) => choose({ exchange: e.target.value })}>
              {['IEX', 'PXIL', 'HPX'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label className="report-search">
            Product
            <select className="input" style={{ width: 170 }} value={sel.product} onChange={(e) => choose({ product: e.target.value })}>
              {['DAM', 'GDAM', 'RTM'].map((p) => <option key={p} value={p}>{productLabel(p)}</option>)}
            </select>
          </label>
          {canWrite && (
            <>
              <label className="report-search">
                Days ahead
                <input
                  type="number" min={1} max={meta?.max_horizon_days || 31} className="input" style={{ width: 80 }}
                  value={form.horizon_days} onChange={(e) => setForm({ ...form, horizon_days: e.target.value })}
                />
              </label>
              <label className="report-search">
                Model
                <select className="input" style={{ width: 230 }} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
                  {(meta?.models || [{ model: 'AUTO', label: 'Auto — best backtest' }]).map((m) => <option key={m.model} value={m.model}>{m.label}</option>)}
                </select>
              </label>
              <label className="report-search" title="Stand the model at an earlier date: it sees no price after it, so the forecast can be scored against what cleared.">
                Prices up to
                <input type="date" className="input" style={{ width: 160 }} value={form.cutoff_date} onChange={(e) => setForm({ ...form, cutoff_date: e.target.value })} />
              </label>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !series?.days} onClick={generate}>
                {busy ? 'Forecasting…' : 'Make forecast'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUploadOpen(true)}>Load price file</button>
            </>
          )}
        </div>
        {series && (
          <p className="report-count">
            {series.days
              ? `${sel.exchange} ${sel.product}: ${series.days} daily prices, ${fmtDate(series.first_date)} to ${fmtDate(series.last_date)} — `
                + Object.entries(series.sources).map(([k, n]) => `${meta.source_labels[k] || k} ${n}`).join(' · ')
                + (series.block_days ? ` · ${series.block_days} day${series.block_days === 1 ? '' : 's'} block-wise` : '')
              : `The platform holds no ${sel.exchange} ${sel.product} prices. They come from the CERC monthly market report, an exchange price file, or the IEX API once it is live.`}
          </p>
        )}
      </Card>

      <Tabs style={{ marginBottom: 16 }}>
        <Tab active={tab === 'forecast'} onClick={() => setTab('forecast')}>Forecast</Tab>
        <Tab active={tab === 'accuracy'} onClick={() => setTab('accuracy')}>Forecast vs actual</Tab>
        <Tab active={tab === 'runs'} onClick={() => setTab('runs')}>Runs{runs.length ? ` (${runs.length})` : ''}</Tab>
      </Tabs>

      {tab === 'forecast' && (
        !meta ? <Card><div className="audit-placeholder">Loading…</div></Card>
          : detail ? <ForecastTab detail={detail} labels={meta.source_labels} onBlockDate={blockDate} />
            : (
              <Card>
                <div className="audit-placeholder">
                  No forecast has been made for {sel.exchange} {sel.product} yet.
                  {series?.days ? (canWrite ? ' Choose how far ahead and make one.' : ' The desk makes them, and one is made each afternoon when new prices have been loaded.') : ''}
                </div>
              </Card>
            )
      )}
      {tab === 'accuracy' && <AccuracyTab accuracy={accuracy} />}
      {tab === 'runs' && <RunsTab runs={runs} currentId={detail?.run.id} onOpen={openRun} />}

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        defaults={sel}
        onLoaded={() => { loadMeta(); loadSeries(sel); }}
      />
    </div>
  );
}
