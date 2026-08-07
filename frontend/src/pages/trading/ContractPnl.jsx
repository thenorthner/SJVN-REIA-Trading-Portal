import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, StatCard, Tabs, Tab, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

// Relative contribution across deals, so the shape of the book is visible
// without reading every number.
function ContributionBars({ rows }) {
  const max = Math.max(...rows.map(r => r.contribution), 1);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {rows.map(r => (
        <div key={r.bilateral_id} style={{ display: 'grid', gridTemplateColumns: '220px 1fr 120px', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.client}>{r.client}</span>
          <div style={{ height: 14, background: 'var(--slate-100, #f1f5f9)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(r.contribution / max) * 100}%`, height: '100%', background: '#2563eb' }} />
          </div>
          <span style={{ fontSize: 13, textAlign: 'right' }}>{fmtCurrency(r.contribution)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ContractPnl() {
  const [view, setView] = useState('MODELLED');
  const [modelled, setModelled] = useState(null);
  const [realised, setRealised] = useState(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (range.from) params.from = range.from;
      if (range.to) params.to = range.to;
      const [c, r] = await Promise.all([api.pnl.contracts(params), api.pnl.realised(params)]);
      setModelled(c); setRealised(r);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to load P&L');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range]);

  // Deals with no volume carry no P&L; showing them would bury the real book.
  const active = (modelled?.contracts || []).filter(r => r.scheduled_mwh > 0);

  const columns = [
    { key: 'client', label: 'Buyer' },
    { key: 'counterparty', label: 'Seller', render: r => <span style={{ fontSize: 12 }}>{r.counterparty}</span> },
    {
      key: 'volume_basis',
      label: 'Volume from',
      render: r => <Badge type={r.volume_basis === 'SCHEDULE' ? 'success' : 'neutral'}>{r.volume_basis === 'SCHEDULE' ? 'Schedule' : 'Applications'}</Badge>,
    },
    { key: 'scheduled_mwh', label: 'Volume (MWh)', render: r => fmtNumber(r.scheduled_mwh, 3) },
    { key: 'purchase_rate', label: 'Buy ₹/kWh', render: r => fmtNumber(r.purchase_rate, 3) },
    { key: 'sale_rate', label: 'Sell ₹/kWh', render: r => fmtNumber(r.sale_rate, 3) },
    { key: 'revenue', label: 'Revenue', render: r => fmtCurrency(r.revenue) },
    { key: 'cost_of_power', label: 'Cost of power', render: r => fmtCurrency(r.cost_of_power) },
    { key: 'trading_margin', label: 'Trading margin', render: r => fmtCurrency(r.trading_margin) },
    { key: 'oa_charges_borne', label: 'OA borne', render: r => (r.oa_charges_borne ? fmtCurrency(r.oa_charges_borne) : '—') },
    { key: 'contribution', label: 'Contribution', render: r => <strong>{fmtCurrency(r.contribution)}</strong> },
    { key: 'margin_pct', label: 'Margin %', render: r => `${fmtNumber(r.margin_pct, 3)}%` },
  ];

  return (
    <div>
      <PageHeader
        title="Contract P&L"
        subtitle="Contribution per deal from its own rates and volume, alongside what the invoices actually realised"
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

      <Tabs>
        <Tab active={view === 'MODELLED'} onClick={() => setView('MODELLED')}>Modelled per deal</Tab>
        <Tab active={view === 'REALISED'} onClick={() => setView('REALISED')}>Realised from invoices</Tab>
      </Tabs>

      {view === 'MODELLED' && modelled && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 15, margin: '20px 0' }}>
            <StatCard label="Volume" value={`${fmtNumber(modelled.totals.scheduled_mwh, 1)} MWh`} hint={`${active.length} deal(s) with volume`} />
            <StatCard label="Revenue" value={fmtCurrency(modelled.totals.revenue)} />
            <StatCard label="Cost of power" value={fmtCurrency(modelled.totals.cost_of_power)} />
            <StatCard label="Trading margin" value={fmtCurrency(modelled.totals.trading_margin)} tone="success" />
            <StatCard label="Contribution" value={fmtCurrency(modelled.totals.contribution)} tone="success" hint="Margin less open-access charges SJVN bears" />
          </div>

          {active.length > 0 && (
            <Card title="Contribution by deal">
              <ContributionBars rows={[...active].sort((a, b) => b.contribution - a.contribution)} />
            </Card>
          )}

          <Card title="Per-deal detail">
            <Table columns={columns} rows={active} loading={loading} emptyMessage="No deals with volume in this period." />
            <p style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 10 }}>
              Volume is the buyer's own approved application energy where the day-wise schedule is held at contract level,
              so no single buyer is credited with the whole contract.
            </p>
          </Card>
        </>
      )}

      {view === 'REALISED' && realised && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 15, margin: '20px 0' }}>
            <StatCard label="Energy billed to buyer" value={fmtCurrency(realised.energy_sales.gross)} hint={`${realised.energy_sales.invoices} invoice(s)`} />
            <StatCard label="Power purchased" value={fmtCurrency(realised.power_purchases.gross)} hint={`${realised.power_purchases.invoices} invoice(s)`} />
            <StatCard label="Energy margin" value={fmtCurrency(realised.energy_margin)} tone="success" />
            <StatCard label="OA recovered" value={fmtCurrency(realised.oa_recovered)} hint={`${realised.oa_recharges.invoices} recharge invoice(s)`} />
            <StatCard label="Gross profit" value={fmtCurrency(realised.gross_profit)} tone="success" />
          </div>

          <Card title="How it adds up">
            <table className="data-table">
              <tbody>
                <tr><td>Energy billed to buyer</td><td style={{ textAlign: 'right' }}>{fmtCurrency(realised.energy_sales.gross)}</td></tr>
                <tr><td>Less: power purchased from seller</td><td style={{ textAlign: 'right' }}>({fmtCurrency(realised.power_purchases.gross)})</td></tr>
                <tr><td><strong>Energy margin</strong></td><td style={{ textAlign: 'right' }}><strong>{fmtCurrency(realised.energy_margin)}</strong></td></tr>
                <tr><td>Add: open-access charges recharged</td><td style={{ textAlign: 'right' }}>{fmtCurrency(realised.oa_recovered)}</td></tr>
                <tr style={{ borderTop: '2px solid var(--border, #e2e8f0)' }}>
                  <td><strong>Gross profit</strong></td>
                  <td style={{ textAlign: 'right' }}><strong>{fmtCurrency(realised.gross_profit)}</strong></td>
                </tr>
              </tbody>
            </table>
            <p style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 12 }}>
              TDS is shown separately because it is timing rather than cost — {fmtCurrency(realised.tds_withheld_by_buyer)} withheld
              by the buyer from SJVN, and {fmtCurrency(realised.tds_withheld_from_seller)} withheld by SJVN from the seller.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
