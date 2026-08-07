import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

// Cash curve: inflow above the axis, outflow below, with the running balance
// drawn over them. Inline SVG so there is no chart dependency to pull in.
function CashTimeline({ points }) {
  if (!points.length) return <p style={{ color: 'var(--slate-500)', fontSize: 14 }}>No movement in this period.</p>;

  const W = 900, H = 240, PAD = { l: 70, r: 16, t: 16, b: 46 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const maxBar = Math.max(...points.map(p => Math.max(p.inflow, p.outflow)), 1);
  const balances = points.map(p => p.running_balance);
  const balMin = Math.min(0, ...balances), balMax = Math.max(0, ...balances);
  const balSpan = (balMax - balMin) || 1;

  const bandW = plotW / points.length;
  const barW = Math.max(3, Math.min(16, bandW * 0.34));
  const zeroY = PAD.t + plotH / 2;
  const barH = (v) => (v / maxBar) * (plotH / 2 - 6);
  const balY = (v) => PAD.t + plotH - ((v - balMin) / balSpan) * plotH;

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${PAD.l + bandW * i + bandW / 2} ${balY(p.running_balance)}`)
    .join(' ');

  const crore = (v) => `₹${(v / 10000000).toFixed(2)}Cr`;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 620, height: 'auto' }} role="img" aria-label="Daily cash movement and running balance">
        <line x1={PAD.l} y1={zeroY} x2={W - PAD.r} y2={zeroY} stroke="var(--slate-300, #cbd5e1)" strokeWidth="1" />
        {points.map((p, i) => {
          const x = PAD.l + bandW * i + bandW / 2;
          return (
            <g key={p.date}>
              {p.inflow > 0 && (
                <rect x={x - barW / 2} y={zeroY - barH(p.inflow)} width={barW} height={barH(p.inflow)} fill="#16a34a" opacity="0.75">
                  <title>{`${p.date}\nIn: ${fmtCurrency(p.inflow)}`}</title>
                </rect>
              )}
              {p.outflow > 0 && (
                <rect x={x - barW / 2} y={zeroY} width={barW} height={barH(p.outflow)} fill="#dc2626" opacity="0.75">
                  <title>{`${p.date}\nOut: ${fmtCurrency(p.outflow)}`}</title>
                </rect>
              )}
            </g>
          );
        })}
        <path d={path} fill="none" stroke="#2563eb" strokeWidth="2" />
        {points.map((p, i) => (
          <circle key={p.date} cx={PAD.l + bandW * i + bandW / 2} cy={balY(p.running_balance)} r="3" fill="#2563eb">
            <title>{`${p.date}\nBalance: ${fmtCurrency(p.running_balance)}`}</title>
          </circle>
        ))}
        <text x={PAD.l - 8} y={balY(balMax)} textAnchor="end" fontSize="11" fill="var(--slate-500,#64748b)">{crore(balMax)}</text>
        <text x={PAD.l - 8} y={balY(balMin)} textAnchor="end" fontSize="11" fill="var(--slate-500,#64748b)">{crore(balMin)}</text>
        {points.map((p, i) => (
          (points.length <= 12 || i % Math.ceil(points.length / 10) === 0) && (
            <text
              key={`x${p.date}`}
              x={PAD.l + bandW * i + bandW / 2}
              y={H - 22}
              textAnchor="end"
              fontSize="10"
              fill="var(--slate-500,#64748b)"
              transform={`rotate(-40 ${PAD.l + bandW * i + bandW / 2} ${H - 22})`}
            >
              {p.date.slice(5)}
            </text>
          )
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'var(--slate-500)', marginTop: 4 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#16a34a', marginRight: 5 }} />Collected from buyer</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#dc2626', marginRight: 5 }} />Paid to seller</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 2, background: '#2563eb', marginRight: 5, verticalAlign: 'middle' }} />Running balance</span>
      </div>
    </div>
  );
}

const AGE_LABEL = { current: 'Not yet due', d1_15: '1–15 days', d16_30: '16–30 days', d31_60: '31–60 days', d60_plus: '60+ days' };

export default function PaymentCycle() {
  const [position, setPosition] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [ageing, setAgeing] = useState(null);
  const [speed, setSpeed] = useState([]);
  const [entries, setEntries] = useState([]);
  const [direction, setDirection] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (range.from) params.from = range.from;
      if (range.to) params.to = range.to;
      const [p, t, a, s, e] = await Promise.all([
        api.paymentCycle.position(params),
        api.paymentCycle.timeline(params),
        api.paymentCycle.ageing(),
        api.paymentCycle.settlementSpeed(params),
        api.paymentCycle.entries({ ...params, ...(direction ? { direction } : {}) }),
      ]);
      setPosition(p); setTimeline(t); setAgeing(a); setSpeed(s); setEntries(e);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to load payment cycle');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [direction, range]);

  const entryColumns = [
    {
      key: 'direction',
      label: 'Leg',
      render: r => <Badge type={r.direction === 'INFLOW' ? 'success' : 'warning'}>{r.direction === 'INFLOW' ? 'Receivable' : 'Payable'}</Badge>,
    },
    { key: 'invoice_no', label: 'Invoice' },
    { key: 'invoice_type', label: 'Type', render: r => r.invoice_type || '—' },
    { key: 'party', label: 'Party', render: r => r.party || '—' },
    { key: 'invoice_date', label: 'Invoiced', render: r => r.invoice_date || '—' },
    { key: 'due_date', label: 'Due', render: r => r.due_date || '—' },
    { key: 'gross_amount', label: 'Gross', render: r => fmtCurrency(r.gross_amount) },
    { key: 'tds_amount', label: 'TDS', render: r => (r.tds_amount ? fmtCurrency(r.tds_amount) : '—') },
    { key: 'net_amount', label: 'Net', render: r => fmtCurrency(r.net_amount) },
    { key: 'paid_amount', label: 'Settled', render: r => fmtCurrency(r.paid_amount) },
    {
      key: 'payment_date',
      label: 'Paid on',
      // The ledger sometimes records the terms instead of a date; keep that visible.
      render: r => r.payment_date || (r.payment_note ? <span style={{ fontSize: 12, color: 'var(--slate-500)' }} title={r.payment_note}>per terms</span> : '—'),
    },
    {
      key: 'status',
      label: 'Status',
      render: r => <Badge type={r.status === 'SETTLED' ? 'success' : r.status === 'PARTIAL' ? 'warning' : 'neutral'}>{r.status}</Badge>,
    },
  ];

  const speedColumns = [
    { key: 'direction', label: 'Leg', render: r => (r.direction === 'INFLOW' ? 'Buyer pays SJVN' : 'SJVN pays seller') },
    { key: 'settled_invoices', label: 'Settled invoices' },
    { key: 'avg_days_to_pay', label: 'Avg days to pay', render: r => `${fmtNumber(r.avg_days_to_pay, 2)} d` },
    { key: 'fastest_days', label: 'Fastest', render: r => `${r.fastest_days} d` },
    { key: 'slowest_days', label: 'Slowest', render: r => `${r.slowest_days} d` },
    { key: 'paid_late', label: 'Paid after due date' },
  ];

  return (
    <div>
      <PageHeader
        title="Payment Cycle"
        subtitle="Money owed to SJVN by the buyer against money SJVN owes the seller, and the float between them"
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

      {position && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 15, marginBottom: 20 }}>
          <StatCard
            label="Receivable (billed)"
            value={fmtCurrency(position.receivable.gross)}
            hint={`${position.receivable.invoices} invoice(s) · ${fmtCurrency(position.receivable.outstanding)} outstanding`}
            tone="success"
          />
          <StatCard
            label="Payable (billed)"
            value={fmtCurrency(position.payable.gross)}
            hint={`${position.payable.invoices} invoice(s) · ${fmtCurrency(position.payable.outstanding)} outstanding`}
            tone="warning"
          />
          <StatCard label="Gross spread" value={fmtCurrency(position.gross_spread)} hint="Trading margin plus recovered open-access charges" />
          <StatCard label="Net settled" value={fmtCurrency(position.net_settled)} hint="Collected less paid out" />
          <StatCard
            label="Net outstanding"
            value={fmtCurrency(position.net_outstanding)}
            tone={position.net_outstanding < 0 ? 'danger' : 'default'}
            hint="Receivable outstanding less payable outstanding"
          />
        </div>
      )}

      <Card title="Cash movement and running balance">
        <CashTimeline points={timeline} />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        <Card title={`Ageing of unsettled invoices${ageing ? ` (as of ${ageing.as_of})` : ''}`}>
          {ageing && Object.values(ageing.buckets).every(v => v === 0) ? (
            <p style={{ color: 'var(--slate-500)', fontSize: 14 }}>Nothing outstanding — every invoice on both legs is settled.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th scope="col">Bucket</th><th scope="col">Outstanding</th></tr></thead>
              <tbody>
                {ageing && Object.entries(ageing.buckets).map(([k, v]) => (
                  <tr key={k}>
                    <td>{AGE_LABEL[k] || k}</td>
                    <td style={{ color: v > 0 && k !== 'current' ? 'var(--danger, #b91c1c)' : 'inherit' }}>{fmtCurrency(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Settlement speed">
          <Table columns={speedColumns} rows={speed} loading={loading} emptyMessage="Nothing settled yet." />
        </Card>
      </div>

      <Card
        title="Invoice register"
        actions={(
          <select className="input" value={direction} onChange={e => setDirection(e.target.value)} style={{ width: 190 }}>
            <option value="">Both legs</option>
            <option value="INFLOW">Receivable (from buyer)</option>
            <option value="OUTFLOW">Payable (to seller)</option>
          </select>
        )}
      >
        <Table columns={entryColumns} rows={entries} loading={loading} emptyMessage="No invoices recorded." />
      </Card>
    </div>
  );
}
