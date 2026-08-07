import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

// Purchase and sale rate over time. The point of the chart is the gap between the
// two lines: the purchase rate swings widely while the margin stays flat, so the
// two should track each other exactly.
function RateTrend({ points }) {
  if (!points.length) return <p style={{ color: 'var(--slate-500)', fontSize: 14 }}>No settled days in this period.</p>;

  const W = 900, H = 260, PAD = { l: 56, r: 16, t: 16, b: 44 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const rates = points.flatMap(p => [p.purchase_rate, p.sale_rate]).filter(Number.isFinite);
  const lo = Math.min(...rates), hi = Math.max(...rates);
  const span = (hi - lo) || 1;
  const pad = span * 0.12;
  const yMin = lo - pad, yMax = hi + pad;

  const x = (i) => PAD.l + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v) => PAD.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const line = (key) => points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p[key])}`).join(' ');
  const band = `${points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.sale_rate)}`).join(' ')} `
    + `${points.slice().reverse().map((p, i) => `L ${x(points.length - 1 - i)} ${y(p.purchase_rate)}`).join(' ')} Z`;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 620, height: 'auto' }} role="img" aria-label="Daily purchase and sale rate">
        {[yMin, (yMin + yMax) / 2, yMax].map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} stroke="var(--slate-200, #e2e8f0)" strokeWidth="1" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--slate-500,#64748b)">₹{v.toFixed(2)}</text>
          </g>
        ))}
        {/* The margin band — thin and even is what "healthy" looks like. */}
        <path d={band} fill="#2563eb" opacity="0.18" />
        <path d={line('purchase_rate')} fill="none" stroke="#dc2626" strokeWidth="1.8" />
        <path d={line('sale_rate')} fill="none" stroke="#16a34a" strokeWidth="1.8" />
        {points.map((p, i) => (
          (points.length <= 14 || i % Math.ceil(points.length / 12) === 0) && (
            <text key={p.settlement_date} x={x(i)} y={H - 20} textAnchor="end" fontSize="10"
              fill="var(--slate-500,#64748b)" transform={`rotate(-40 ${x(i)} ${H - 20})`}>
              {p.settlement_date.slice(5)}
            </text>
          )
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'var(--slate-500)', marginTop: 4 }}>
        <span><span style={{ display: 'inline-block', width: 14, height: 2, background: '#dc2626', marginRight: 5, verticalAlign: 'middle' }} />Purchase rate (paid to seller)</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 2, background: '#16a34a', marginRight: 5, verticalAlign: 'middle' }} />Sale rate (billed to buyer)</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#2563eb', opacity: 0.3, marginRight: 5 }} />Trading margin</span>
      </div>
    </div>
  );
}

export default function MarginAssurance() {
  const [check, setCheck] = useState(null);
  const [trend, setTrend] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [range, setRange] = useState({ from: '', to: '' });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (range.from) params.from = range.from;
      if (range.to) params.to = range.to;
      const [c, t, e] = await Promise.all([
        api.margin.check(params),
        api.margin.rateTrend(params),
        api.margin.receiptExceptions({ ...params, min_abs: 1 }),
      ]);
      setCheck(c); setTrend(t); setExceptions(e);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to load margin assurance');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range]);

  const dayColumns = [
    { key: 'settlement_date', label: 'Date' },
    { key: 'energy_kwh', label: 'Energy (kWh)', render: r => fmtNumber(r.energy_kwh, 0) },
    { key: 'purchase_rate', label: 'Buy ₹/kWh', render: r => fmtNumber(r.purchase_rate, 3) },
    { key: 'sale_rate', label: 'Sell ₹/kWh', render: r => fmtNumber(r.sale_rate, 3) },
    { key: 'margin_rate', label: 'Margin ₹/kWh', render: r => <strong>{fmtNumber(r.margin_rate, 3)}</strong> },
    { key: 'expected_margin', label: 'Expected', render: r => fmtNumber(r.expected_margin, 3) },
    {
      key: 'drift',
      label: 'Drift',
      render: r => (r.drift === 0 ? '—' : <span style={{ color: 'var(--danger, #b91c1c)' }}>{fmtNumber(r.drift, 4)}</span>),
    },
    { key: 'margin_amount', label: 'Margin earned', render: r => fmtCurrency(r.margin_amount) },
    { key: 'ok', label: '', render: r => <Badge type={r.ok ? 'success' : 'danger'}>{r.ok ? 'On contract' : 'Off contract'}</Badge> },
  ];

  const exceptionColumns = [
    { key: 'settlement_date', label: 'Date' },
    { key: 'net_receivable', label: 'Billed (net)', render: r => fmtCurrency(r.net_receivable) },
    { key: 'actual_receipt', label: 'Received', render: r => fmtCurrency(r.actual_receipt) },
    {
      key: 'receipt_difference',
      label: 'Difference',
      render: r => (
        <span style={{ color: r.receipt_difference < 0 ? 'var(--danger, #b91c1c)' : 'var(--slate-700)' }}>
          {fmtCurrency(r.receipt_difference)}
        </span>
      ),
    },
    { key: 'receipt_date', label: 'Received on', render: r => r.receipt_date || '—' },
  ];

  return (
    <div>
      <PageHeader
        title="Trading Margin Assurance"
        subtitle="The desk buys and sells the same energy each day — the gap between the two rates should be the contract margin on every one"
      />

      <Card title="Period">
        <div style={{ display: 'flex', gap: 15, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>From</label>
            <input type="date" className="input" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>To</label>
            <input type="date" className="input" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} />
          </div>
          <button className="btn btn-ghost" onClick={() => setRange({ from: '', to: '' })}>Clear</button>
        </div>
      </Card>

      {check && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 15, marginBottom: 20 }}>
          <StatCard
            label="Margin compliance"
            value={`${fmtNumber(check.compliance_pct, 3)}%`}
            tone={check.days_breached === 0 ? 'success' : 'danger'}
            hint={`${check.days_ok} of ${check.days} day(s) on contract`}
          />
          <StatCard
            label="Days off contract"
            value={check.days_breached}
            tone={check.days_breached > 0 ? 'danger' : 'default'}
            hint={check.days_breached === 0 ? 'Every settled day matched the contract margin' : 'Investigate the days listed below'}
          />
          <StatCard label="Effective margin" value={`₹${fmtNumber(check.effective_margin_rate, 5)}/kWh`} hint="Realised across the period" />
          <StatCard label="Energy settled" value={`${fmtNumber(check.total_energy_kwh / 1000, 1)} MWh`} />
          <StatCard label="Margin earned" value={fmtCurrency(check.total_margin)} tone="success" />
        </div>
      )}

      <Card title="Purchase and sale rate, day by day">
        <RateTrend points={trend} />
        <p style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 10 }}>
          The purchase rate is market-linked and moves daily; the margin does not. An even band between the two lines is
          what a healthy book looks like — a widening or pinching band is a pricing error worth chasing.
        </p>
      </Card>

      {check && check.days_breached > 0 && (
        <Card title={`Days off contract (${check.days_breached})`}>
          <Table columns={dayColumns} rows={check.breaches} loading={loading} emptyMessage="None." />
        </Card>
      )}

      <Card title={`Receipt exceptions (${exceptions.length})`}>
        <Table columns={exceptionColumns} rows={exceptions} loading={loading} emptyMessage="Every receipt matched what was billed." />
        <p style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 10 }}>
          Days where the money received did not match the bill. These are small and were never chased in the ledger —
          a TDS adjustment and bank rounding — but they are the list to work through.
        </p>
      </Card>

      <Card title="All settled days">
        <Table columns={dayColumns} rows={check?.days_detail || []} loading={loading} emptyMessage="No settled days." />
      </Card>
    </div>
  );
}
