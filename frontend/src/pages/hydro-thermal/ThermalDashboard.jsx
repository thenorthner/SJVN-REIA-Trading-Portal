import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import ThermalCoalBlendingInflow3D from '../../components/ThermalCoalBlendingInflow3D.jsx';
import ThermalUrsMarketDiversion3D from '../../components/ThermalUrsMarketDiversion3D.jsx';
import ThermalTariffArchitectureDoc3D from '../../components/ThermalTariffArchitectureDoc3D.jsx';

/**
 * Thermal Billing — its own section, apart from hydro.
 *
 * A thermal station is billed on a different tariff from a hydro one: fixed
 * (capacity) charges against availability, plus an energy charge that follows
 * the fuel — station heat rate, GCV and the landed cost of coal. The figures
 * here come from the bills and the beneficiary ledger (services/hydroDashboard.js)
 * and the desk's own registers, so an empty month shows as empty.
 */

const LINE_COLORS = ['#2563eb', '#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899'];
const STAGE_LABEL = { not_billed: 'Not billed', in_progress: 'In draft / approval', issued: 'Issued', booked: 'Booked to Finance' };
const crore = (v) => `₹${fmtNumber(v || 0, 2)} Cr`;

function Pill({ to, label, value, tone }) {
  return (
    <Link to={to} className="card" style={{ padding: '12px 14px', display: 'block', textDecoration: 'none', color: 'var(--text)' }}>
      <div style={{ fontSize: 14.5, color: 'var(--text-light)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone ? `var(--${tone})` : 'var(--text)' }}>{value}</div>
    </Link>
  );
}

export default function ThermalDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.hydroBilling.dashboard({ vertical: 'THERMAL' })
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const k = data?.kpis || {};
  const stations = data?.stations || [];
  const desk = data?.desk || {};
  const mc = desk.month_close;
  const thermalTrend = (data?.thermalTrend || []).filter((m) => m.billed);
  const napaf = stations.find((s) => s.napaf_percent != null)?.napaf_percent;
  const ageing = desk.ageing || {};
  const ageingRows = [
    { bucket: 'Not yet due', amount: ageing.current },
    { bucket: '1–30 days', amount: ageing.d1_30 },
    { bucket: '31–60', amount: ageing.d31_60 },
    { bucket: '61–90', amount: ageing.d61_90 },
    { bucket: '90+', amount: ageing.d90_plus },
  ].map((r) => ({ ...r, crore: Math.round((r.amount || 0) / 1e5) / 100 }));

  return (
    <div>
      <PageHeader
        title="Thermal Billing"
        subtitle={`Thermal stations, their beneficiaries and the desk's open work — FY ${data?.financial_year || ''}, as of ${data?.as_of || '…'}`}
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" onClick={load}>{loading ? 'Loading…' : 'Refresh'}</button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/thermal/stations')}>Stations &amp; Tariff</button>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/thermal/billing')}>Monthly Bills</button>
          </div>
        )}
      />
      {error && <div className="alert alert-error">{error}</div>}

      <div className="kpi-grid">
        <StatCard label="Thermal capacity" value={`${fmtNumber(k.totalCapacityMw || 0, 0)} MW`} hint={`${k.activeStationsCount ?? 0} station(s) · ${k.beneficiariesCount ?? 0} beneficiaries`} />
        <StatCard label="Annual Fixed Charges" value={crore(k.annualAfcCr)} hint={stations.map((s) => s.afc_source).filter((v, i, a) => a.indexOf(v) === i).join(', ') || undefined} />
        <StatCard label="Billed this FY" value={crore(k.cumulativeBilledCr)} />
        <StatCard label="Collected" value={crore(k.cumulativeCollectedCr)} hint={k.realizationPct != null ? `${k.realizationPct}% realised` : 'nothing billed yet'} tone={k.realizationPct != null && k.realizationPct < 90 ? 'amber' : 'default'} />
        <StatCard label="Overdue" value={crore(k.overdueCr)} tone={k.overdueCr > 0 ? 'red' : 'default'} onClick={() => navigate('/thermal/receivables')} />
        <StatCard label="PAFM (latest month)" value={k.avgPafmPct != null ? `${k.avgPafmPct}%` : '—'} hint={napaf != null ? `NAPAF ${napaf}%` : undefined} tone={k.avgPafmPct != null && napaf != null && k.avgPafmPct < napaf ? 'red' : 'default'} />
        <StatCard label="PLF this FY" value={k.plfYtdPct != null ? `${k.plfYtdPct}%` : '—'} hint="on energy scheduled" onClick={() => navigate('/thermal/generation-performance')} />
        <StatCard label="Average ECR" value={k.avgEcr != null ? `₹${k.avgEcr}/kWh` : '—'} hint={`${fmtNumber(k.cumulativeEnergyMu || 0, 1)} MU scheduled`} />
      </div>

      <Card title={mc ? `The desk today — ${mc.period} close: ${mc.clear ? 'nothing holding it' : `${mc.open_items} item(s) holding it`}` : 'The desk today'} style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          {mc && Object.entries(STAGE_LABEL).map(([key, label]) => (
            <Pill key={key} to="/thermal/month-close" label={`${mc.period}: ${label}`} value={mc[key] ?? 0} tone={key === 'not_billed' && mc[key] ? 'amber' : key === 'booked' ? 'green' : undefined} />
          ))}
          <Pill to="/thermal/approvals" label="Bills in approval" value={desk.approvals?.bills ?? 0} tone={desk.approvals?.bills ? 'amber' : undefined} />
          <Pill to="/thermal/approvals" label="Notes awaiting checker" value={desk.approvals?.notes ?? 0} tone={desk.approvals?.notes ? 'amber' : undefined} />
          <Pill to="/thermal/power-regulation" label="In default / regulated" value={`${desk.regulation?.candidates ?? 0} / ${desk.regulation?.regulating ?? 0}`} tone={desk.regulation?.candidates ? 'red' : undefined} />
          <Pill to="/thermal/regulatory" label="Regulatory items open" value={desk.regulatory?.open ?? 0} tone={desk.regulatory?.overdue || desk.regulatory?.to_implement ? 'red' : undefined} />
          <Pill to="/thermal/ppas" label="Billed without a PPA" value={desk.ppas?.missing ?? 0} tone={desk.ppas?.missing ? 'red' : undefined} />
          <Pill to="/thermal/advances" label="Advances unapplied" value={fmtCurrency(ageing.advance || 0)} />
        </div>
      </Card>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <Card title={`Billing & collection — FY ${data?.financial_year || ''} (₹ Cr)`}>
          <div className="chart-box" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data?.monthlyBillingTrend || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="billing_period" tick={{ fontSize: 13.5 }} />
                <YAxis tick={{ fontSize: 13.5 }} />
                <Tooltip formatter={(v, n) => [`₹${Number(v).toFixed(2)} Cr`, { capacity_charges: 'Capacity charge', energy_charges: 'Energy charge', collected_amount: 'Collected' }[n] || n]} />
                <Legend formatter={(n) => ({ capacity_charges: 'Capacity charge', energy_charges: 'Energy charge', collected_amount: 'Collected' }[n] || n)} />
                <Bar dataKey="capacity_charges" stackId="a" fill="#3b82f6" />
                <Bar dataKey="energy_charges" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="collected_amount" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Receivables ageing (₹ Cr)">
          <div className="chart-box" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ageingRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="bucket" tick={{ fontSize: 13.5 }} />
                <YAxis tick={{ fontSize: 13.5 }} />
                <Tooltip formatter={(v) => [`₹${Number(v).toFixed(2)} Cr`, 'Outstanding']} />
                <Bar dataKey="crore" radius={[4, 4, 0, 0]}>
                  {ageingRows.map((r, i) => <Cell key={r.bucket} fill={['#10b981', '#f59e0b', '#f97316', '#ef4444', '#b91c1c'][i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <Card title="Availability (PAFM) against NAPAF">
          <div className="chart-box" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.pafmTrend || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="period" tick={{ fontSize: 13.5 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 13.5 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v, n) => [v == null ? 'not billed' : `${v}%`, n]} />
                <Legend />
                {napaf != null && <ReferenceLine y={napaf} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `NAPAF ${napaf}%`, fill: '#ef4444', fontSize: 13.5 }} />}
                {stations.map((s, i) => <Line key={s.id} type="monotone" dataKey={s.code} name={s.station_name} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2.5} connectNulls dot={{ r: 3 }} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Plant load factor and energy charge rate">
          <div className="chart-box" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data?.thermalTrend || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="period" tick={{ fontSize: 13.5 }} />
                <YAxis yAxisId="plf" domain={[0, 100]} tick={{ fontSize: 13.5 }} tickFormatter={(v) => `${v}%`} />
                <YAxis yAxisId="ecr" orientation="right" tick={{ fontSize: 13.5 }} tickFormatter={(v) => `₹${v}`} />
                <Tooltip formatter={(v, n) => [v == null ? '—' : (n === 'PLF' ? `${v}%` : `₹${v}/kWh`), n]} />
                <Legend />
                <ReferenceLine yAxisId="plf" y={85} stroke="#10b981" strokeDasharray="4 4" label={{ value: 'PLF incentive 85%', fill: '#10b981', fontSize: 13.5 }} />
                <Bar yAxisId="plf" dataKey="plf" name="PLF" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Line yAxisId="ecr" type="monotone" dataKey="ecr" name="ECR" stroke="#f59e0b" strokeWidth={2.5} connectNulls dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <Card title="Fuel the energy charge was worked on">
          {thermalTrend.length ? (
            <Table
              columns={[
                { key: 'period', header: 'Month' },
                { key: 'gcv', header: 'GCV as received', render: (r) => (r.gcv ? `${fmtNumber(r.gcv, 0)} kCal/kg` : '—') },
                { key: 'coal', header: 'Landed coal', render: (r) => (r.coal_rs_per_tonne ? `${fmtCurrency(r.coal_rs_per_tonne)}/t` : '—') },
                { key: 'ecr', header: 'ECR', render: (r) => (r.ecr != null ? `₹${r.ecr}/kWh` : '—') },
                { key: 'mu', header: 'Scheduled', render: (r) => `${fmtNumber(r.scheduled_mu, 1)} MU` },
              ]}
              rows={thermalTrend.map((r) => ({ ...r, id: r.month_key }))}
            />
          ) : <p className="inline-note">No issued thermal bill this financial year yet.</p>}
          <p className="inline-note">Weighted by energy scheduled across stations. Norms and fuel by station are on <Link to="/thermal/generation-performance">Generation Performance</Link>.</p>
        </Card>

        <Card title="Beneficiary shares">
          <div className="chart-box" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data?.beneficiaryBreakup || []} dataKey="share_pct" nameKey="name" innerRadius={55} outerRadius={100} paddingAngle={2}>
                  {(data?.beneficiaryBreakup || []).map((b, i) => <Cell key={b.name} fill={b.color || LINE_COLORS[i % LINE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v, n, item) => [`${v}% · ${item.payload.mw_share} MW · billed ₹${item.payload.billed_cr} Cr`, item.payload.name]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Beneficiary settlement position" style={{ marginBottom: 16 }}>
        <Table
          columns={[
            { key: 'name', header: 'Beneficiary', render: (b) => (b.name.startsWith('Others') ? b.name : <Link to={`/thermal/ledger?beneficiary=${encodeURIComponent(b.name)}`}>{b.name}</Link>) },
            { key: 'share_pct', header: 'Share', render: (b) => `${b.share_pct}% · ${b.mw_share} MW` },
            { key: 'billed_cr', header: 'Billed', render: (b) => crore(b.billed_cr) },
            { key: 'collected_cr', header: 'Collected', render: (b) => crore(b.collected_cr) },
            { key: 'status', header: 'Position', render: (b) => <Badge type={{ Overdue: 'danger', Settled: 'success', Current: 'primary' }[b.status] || 'neutral'}>{b.status}</Badge> },
          ]}
          rows={(data?.beneficiaryBreakup || []).map((b) => ({ ...b, id: b.name }))}
          emptyMessage="No beneficiary allocation on a thermal station yet."
        />
      </Card>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <Card title="Stations">
          <Table
            columns={[
              { key: 'station_name', header: 'Station', render: (s) => <span>{s.station_name}<div style={{ fontSize: 14, color: 'var(--text-light)' }}>{s.contract_no} · {fmtNumber(s.capacity_mw, 0)} MW</div></span> },
              { key: 'afc', header: 'AFC', render: (s) => <span>{fmtCurrency(s.annual_afc)}<div style={{ fontSize: 14, color: 'var(--text-light)' }}>{s.afc_source}</div></span> },
              { key: 'latest', header: 'Latest month', render: (s) => (s.latest_month ? <span>{s.latest_month}<div style={{ fontSize: 14, color: 'var(--text-light)' }}>{crore(s.latest_billed_cr)} billed · {crore(s.latest_collected_cr)} in</div></span> : '—') },
              { key: 'ready', header: 'Ready to bill', render: (s) => (s.ready ? <Badge type="success">Ready</Badge> : <span style={{ fontSize: 14.5, color: 'var(--amber-strong)' }}>Missing: {(s.missing || []).join(', ')}</span>) },
            ]}
            rows={stations}
            emptyMessage={loading ? 'Loading…' : 'No thermal station yet — set one up under Stations & Tariff.'}
          />
        </Card>

        <Card title="Bill pipeline and recent bills">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {Object.entries(data?.pipeline || {}).map(([key, n]) => (
              <Badge key={key} type={n ? 'primary' : 'neutral'}>{key.replace('_', ' ')}: {n}</Badge>
            ))}
          </div>
          <Table
            columns={[
              { key: 'bill_no', header: 'Bill', render: (b) => <span>{b.bill_no}<div style={{ fontSize: 14, color: 'var(--text-light)' }}>{b.billing_month} · {String(b.bill_kind).toLowerCase()}</div></span> },
              { key: 'total_charges', header: 'Amount', render: (b) => fmtCurrency(b.total_charges) },
              { key: 'status', header: 'Status', render: (b) => <Badge status={b.status} /> },
            ]}
            rows={data?.recentBills || []}
            onRowClick={() => navigate('/thermal/billing')}
            emptyMessage="No thermal bill yet."
          />
        </Card>
      </div>

      <ThermalCoalBlendingInflow3D station={stations[0]} />
      <ThermalUrsMarketDiversion3D station={stations[0]} />
      <ThermalTariffArchitectureDoc3D station={stations[0]} />
    </div>
  );
}
