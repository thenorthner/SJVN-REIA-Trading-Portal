import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import api from '../../api/client.js';
import { PageHeader, Card, StatCard, Table, Badge, Modal, AlertPopup, fmtNumber } from '../../components/ui.jsx';
import EnergyRecordDetail, { ResponseBadge } from '../../components/EnergyRecordDetail.jsx';

const monthLabel = (p) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function exportCsv(rows) {
  const head = ['Contract', 'Period', 'Type', 'Source', 'Energy (MWh)', 'CUF %', 'Availability %', 'Status', 'Your response', 'Responded on', 'Invoice', 'Notes'];
  const lines = rows.map((r) => [r.contract_no, r.period_month, r.data_type, r.source, r.energy_mwh, r.cuf_percent ?? '', r.availability_percent ?? '',
    r.status, r.response_status || '', r.response_at || '', r.invoice_no || '', r.deviation_notes || ''].map(csvCell).join(','));
  const url = URL.createObjectURL(new Blob([`${head.map(csvCell).join(',')}\n${lines.join('\n')}\n`], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `energy-data-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A counterparty's own energy records: the trend at the top, then each period
 * with what it was taken from, its 15-minute blocks, and the answer — accept
 * or object — that goes on record before the period is billed.
 */
export default function MyEnergyData({ title, subtitle, contractType, contractLabel, energyLabel, disputesPath, showCuf = true }) {
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [filters, setFilters] = useState({ contract_id: '', period_month: '', status: '' });
  const [onlyAwaiting, setOnlyAwaiting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null); // { id, tab }
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(null); // the row whose figure is being accepted

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.energyData.list(params).then(setRows).finally(() => setLoading(false));
    api.energyRecords.analytics(filters.contract_id ? { contract_id: filters.contract_id } : undefined).then(setAnalytics).catch(() => setAnalytics(null));
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.contracts.list(contractType ? { contract_type: contractType } : undefined).then(setContracts).catch(() => {}); }, [contractType]);

  // Chased while a period is validated and not yet locked for billing.
  const awaiting = (r) => !r.response_status && r.status === 'VALIDATED' && !r.is_superseded;
  const shown = useMemo(() => (onlyAwaiting ? rows.filter(awaiting) : rows), [rows, onlyAwaiting]);

  // Asked in the page, not a browser dialog: those block assistive and automated browsers.
  const accept = (r) => setAsking(r);
  async function confirmAccept() {
    const r = asking;
    setAsking(null);
    try {
      await api.energyRecords.respond(r.id, { response: 'ACCEPTED' });
      setNotice(`Accepted ${r.period_month} on ${r.contract_no}.`);
      setError('');
      load();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  const columns = [
    { key: 'contract_no', header: contractLabel },
    { key: 'period_month', header: 'Period' },
    { key: 'data_type', header: 'Type', render: (r) => <Badge status={r.data_type} /> },
    { key: 'source', header: 'Source' },
    { key: 'energy_mwh', header: `${energyLabel} (MWh)`, render: (r) => fmtNumber(r.energy_mwh) },
    ...(showCuf ? [{
      key: 'cuf_percent',
      header: 'CUF %',
      render: (r) => (r.cuf_percent != null
        ? <span style={{ color: r.min_cuf_percent != null && r.cuf_percent < r.min_cuf_percent ? 'var(--on-red)' : 'inherit', fontWeight: r.min_cuf_percent != null && r.cuf_percent < r.min_cuf_percent ? 700 : 400 }}>{fmtNumber(r.cuf_percent)}%</span>
        : '-'),
    }] : []),
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'response', header: 'Your answer', render: (r) => (r.is_superseded ? <span style={{ color: 'var(--slate-500)', fontSize: 15 }}>Replaced by final{r.response_status === 'OBJECTED' ? ' · objected' : r.response_status === 'ACCEPTED' ? ' · accepted' : ''}</span> : <ResponseBadge row={r} />) },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {awaiting(r) && <button className="btn btn-success btn-sm" onClick={stop(() => accept(r))}>Accept</button>}
          {awaiting(r) && <button className="btn btn-danger btn-sm" onClick={stop(() => setOpen({ id: r.id, tab: 'RESPONSE' }))}>Object</button>}
          {r.invoice_id && (
            <a
              className="btn btn-secondary btn-sm" onClick={(e) => e.stopPropagation()}
              href={`${disputesPath}?${new URLSearchParams({ invoice: r.invoice_id, reason: 'ENERGY_DATA_MISMATCH', note: `Energy for ${r.period_month} on ${r.contract_no}: recorded ${r.energy_mwh} MWh.` })}`}
            >
              Raise dispute
            </a>
          )}
          <button className="btn btn-secondary btn-sm" onClick={stop(() => setOpen({ id: r.id, tab: 'SUMMARY' }))}>Source</button>
          <button className="btn btn-secondary btn-sm" disabled={!r.has_blocks} title={r.has_blocks ? '15-minute block data' : 'No 15-minute data has been loaded for this period'} onClick={stop(() => setOpen({ id: r.id, tab: 'BLOCKS' }))}>Blocks</button>
        </div>
      ),
    },
  ];

  const t = analytics?.totals;
  const series = analytics?.series || [];
  const minCuf = series.find((s) => s.min_cuf_percent != null)?.min_cuf_percent ?? null;
  const openRow = open ? rows.find((r) => r.id === open.id) : null;

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={<button className="btn btn-secondary" disabled={!shown.length} onClick={() => exportCsv(shown)}>Export CSV</button>}
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {t && (
        <div className="kpi-grid">
          <StatCard label={t.months > 0 ? `${energyLabel} — last ${t.months} month${t.months === 1 ? '' : 's'}` : energyLabel} value={`${fmtNumber(t.energy_mwh)} MWh`} tone="blue" />
          {showCuf && <StatCard label="Average CUF" value={t.avg_cuf_percent != null ? `${fmtNumber(t.avg_cuf_percent)}%` : '—'} hint={minCuf != null ? `Contractual minimum ${fmtNumber(minCuf)}%` : undefined} tone={minCuf != null && t.avg_cuf_percent != null && t.avg_cuf_percent < minCuf ? 'red' : 'green'} />}
          <StatCard label="Best month" value={t.best_month ? monthLabel(t.best_month.period) : '—'} hint={t.best_month ? `${fmtNumber(t.best_month.energy_mwh)} MWh` : undefined} />
          {showCuf && <StatCard label="Months below minimum CUF" value={t.months_below_min} tone={t.months_below_min ? 'red' : 'green'} hint={minCuf == null ? 'No minimum set on the contract' : undefined} />}
          <StatCard
            label="Awaiting your confirmation" value={t.awaiting_response} tone={t.awaiting_response ? 'amber' : 'green'}
            hint={t.awaiting_response ? 'Click to show them' : 'Nothing waiting'} onClick={t.awaiting_response ? () => setOnlyAwaiting(true) : undefined}
          />
        </div>
      )}

      <Card title={`${energyLabel} month on month${filters.contract_id ? '' : ' — all contracts'}`} style={{ marginBottom: 16 }}>
        {!analytics ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-light)' }}>Loading…</div>
        ) : !series.length ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-light)' }}>No energy has been recorded yet.</div>
        ) : (
          <>
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="period" tickFormatter={monthLabel} tick={{ fontSize: 14.5 }} />
                  <YAxis yAxisId="mwh" tick={{ fontSize: 14.5 }} width={64} tickFormatter={(v) => fmtNumber(v, 0)} />
                  {showCuf && <YAxis yAxisId="cuf" orientation="right" tick={{ fontSize: 14.5 }} width={44} unit="%" domain={[0, (max) => Math.ceil(Math.max(max, minCuf || 0) / 10) * 10 + 10]} />}
                  <Tooltip
                    labelFormatter={(p) => `${monthLabel(p)}${series.find((s) => s.period === p)?.provisional ? ' — provisional' : ''}`}
                    formatter={(v, name) => (name === 'CUF' ? [`${fmtNumber(v)}%`, name] : [`${fmtNumber(v)} MWh`, name])}
                  />
                  <Legend wrapperStyle={{ fontSize: 15 }} />
                  <Bar yAxisId="mwh" dataKey="energy_mwh" name={energyLabel} fill="url(#eliteBlue)" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {series.map((s) => <Cell key={s.period} fill={s.provisional ? '#93c5fd' : '#2563eb'} />)}
                  </Bar>
                  {showCuf && <Line yAxisId="cuf" type="monotone" dataKey="cuf_percent" name="CUF" stroke="url(#eliteOrange)" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />}
                  {showCuf && minCuf != null && <ReferenceLine yAxisId="cuf" y={minCuf} stroke="url(#eliteRed)" strokeDasharray="5 4" label={{ value: `Min CUF ${minCuf}%`, position: 'insideTopRight', fontSize: 14.5, fill: '#dc2626' }} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="inline-note" style={{ margin: '6px 0 0' }}>
              Darker bars are final figures, lighter ones provisional.{showCuf ? ' Where SJVN did not record a CUF, it is worked out from the energy and the commissioned capacity.' : ''}
            </p>
          </>
        )}
      </Card>

      <div className="filters-bar">
        <select value={filters.contract_id} onChange={(e) => setFilters({ ...filters, contract_id: e.target.value })} aria-label={contractLabel}>
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
        </select>
        <input type="month" value={filters.period_month} onChange={(e) => setFilters({ ...filters, period_month: e.target.value })} aria-label="Period" />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Status">
          <option value="">All statuses</option>
          {['VALIDATED', 'LOCKED', 'DISPUTED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14.5 }}>
          <input type="checkbox" checked={onlyAwaiting} onChange={(e) => setOnlyAwaiting(e.target.checked)} />
          Only those awaiting my confirmation
        </label>
      </div>

      <Card>
        <Table
          columns={columns} rows={loading ? [] : shown} onRowClick={(r) => setOpen({ id: r.id, tab: 'SUMMARY' })}
          emptyMessage={loading ? 'Loading...' : onlyAwaiting ? 'Nothing is waiting for your confirmation.' : 'No energy data records found.'}
        />
      </Card>

      <AlertPopup
        open={!!asking}
        tone="warning"
        title="Accept this energy figure?"
        message={asking ? `Accept ${fmtNumber(asking.energy_mwh)} MWh for ${asking.period_month} on ${asking.contract_no}? This is recorded as your agreement to the figure and cannot be undone.` : ''}
        okLabel="Back"
        onClose={() => setAsking(null)}
        actions={<button type="button" className="btn btn-success" onClick={confirmAccept}>Accept the figure</button>}
      />
      <Modal open={!!open} onClose={() => setOpen(null)} title={openRow ? `${openRow.contract_no} — ${openRow.period_month}` : 'Energy record'} width={940}>
        {open && <EnergyRecordDetail key={`${open.id}-${open.tab}`} id={open.id} startTab={open.tab} onChanged={load} disputesPath={disputesPath} />}
      </Modal>
    </div>
  );
}
