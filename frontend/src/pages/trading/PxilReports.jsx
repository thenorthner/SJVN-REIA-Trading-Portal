import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Tabs, Tab, Field, StatCard, SampleDataNotice, fmtNumber } from '../../components/ui.jsx';

// PXIL member reports — billing, Format-D, obligations and the live reverse
// auction, pulled straight from PXIL rather than re-keyed.
//
// Two things this screen refuses to hide:
//
//   1. Whether the figures came from PXIL or from the documented sample. Until
//      credentials are configured the server answers in STUB mode, and a stub
//      obligation must never be mistaken for a real one.
//   2. The checks that did not pass. PXIL's own DOR sample has a Total that
//      exceeds the sum of its Category, and its slot sample starts at 00:15
//      rather than 00:00. Both are open with PXIL, so rows that fail a check
//      are marked here instead of being quietly averaged away.

const TABS = [
  { key: 'tam-gtam', label: 'Billing (daily)' },
  { key: 'slot-wise', label: 'Billing (15-min slots)' },
  { key: 'format-d', label: 'Format-D' },
  { key: 'member-dor', label: 'Obligations (DOR)' },
  { key: 'trade-margin', label: 'Trade Margin' },
  { key: 'reverse-auction', label: 'Reverse auction (live)' },
];

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;

const side = (v) => (v === 'B' ? 'Buy' : v === 'S' ? 'Sell' : v || '—');
const money = (v) => (v == null ? '—' : fmtNumber(v, 2));

/** A value PXIL sent but we have not been able to verify reads as a warning, not a fact. */
function Caveat({ children }) {
  return (
    <div role="note" style={{
      background: 'var(--warning-bg, #fffbeb)',
      border: '1px solid var(--warning-border, #fcd34d)',
      color: 'var(--warning-text, #92400e)',
      borderRadius: 6, padding: '10px 12px', marginBottom: 14, fontSize: 13,
    }}>
      {children}
    </div>
  );
}

export default function PxilReports() {
  const [status, setStatus] = useState(null);
  const [tab, setTab] = useState('tam-gtam');
  const [range, setRange] = useState({ fromdate: monthStart(), todate: today() });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.pxil.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  // The result is stamped with the tab it belongs to. Five reports with five
  // different row shapes share this state, so a response that arrives after the
  // reader has moved on must not be rendered against the wrong columns.
  async function load(which = tab) {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const params = { fromdate: range.fromdate, todate: range.todate };
      const data = which === 'tam-gtam' ? await api.pxil.tamGtam(params)
        : which === 'slot-wise' ? await api.pxil.tamGtamSlotWise(params)
          : which === 'format-d' ? await api.pxil.formatD(params)
            : which === 'member-dor' ? await api.pxil.memberDor(params)
              : which === 'trade-margin' ? await api.pxil.tradeMargin(params)
                : await api.pxil.reverseAuction();
      setResult({ tab: which, data });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'PXIL request failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(tab); /* eslint-disable-next-line */ }, [tab]);

  const stub = !status || status.mode === 'STUB';
  const report = result?.tab === tab ? result.data : null;

  return (
    <div>
      <PageHeader
        title="PXIL Member Reports"
        subtitle="Billing, Format-D, day-wise obligations and the live reverse auction, read directly from PXIL."
      />

      {stub && (
        <SampleDataNotice detail="No PXIL credentials are configured on the server, so these figures are the sample shapes from PXIL's API documents — not SJVN's positions. Set pxil_enabled and pxil_api_token to pull live data." />
      )}

      {status && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 18 }}>
          <StatCard
            label="Data source"
            value={status.mode === 'PXIL' ? 'Live PXIL' : 'Documented sample'}
            tone={status.mode === 'PXIL' ? 'success' : 'warning'}
          />
          <StatCard label="Endpoint" value={status.base_url?.replace(/^https?:\/\//, '') || '—'} hint={status.token_present ? 'Token configured' : 'No token configured'} />
          <StatCard label="Portfolio" value={status.portfolio_id || 'Not set'} tone={status.portfolio_id ? 'default' : 'warning'} />
          <StatCard
            label="Daily billing path"
            value={`/${status.tam_gtam_path}/`}
            tone={status.tam_gtam_path_confirmed ? 'success' : 'warning'}
            hint={status.tam_gtam_path_confirmed ? 'Confirmed by PXIL' : 'Unconfirmed — awaiting PXIL'}
          />
        </div>
      )}

      <Card title="Report period">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="From">
            <input type="date" className="input" value={range.fromdate}
              onChange={e => setRange({ ...range, fromdate: e.target.value })} />
          </Field>
          <Field label="To">
            <input type="date" className="input" value={range.todate}
              onChange={e => setRange({ ...range, todate: e.target.value })} />
          </Field>
          <button className="btn btn-primary" onClick={() => load()} disabled={loading}>
            {loading ? 'Fetching…' : 'Fetch from PXIL'}
          </button>
          {tab === 'reverse-auction' && (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              The reverse auction endpoint has no date filter — it returns whatever is open now.
            </span>
          )}
        </div>
      </Card>

      <Tabs style={{ marginBottom: 16 }}>
        {TABS.map(t => (
          <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</Tab>
        ))}
      </Tabs>

      {error && (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: 14 }}>{error}</div>
      )}

      {report?.mode && (
        <div style={{ marginBottom: 12 }}>
          <Badge type={report.mode === 'PXIL' ? 'success' : 'warning'}>
            {report.mode === 'PXIL' ? 'Live from PXIL' : 'Documented sample'}
          </Badge>
          {report.code && <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>Response code {report.code}</span>}
        </div>
      )}

      {tab === 'tam-gtam' && <DailyBilling result={report} loading={loading} />}
      {tab === 'slot-wise' && <SlotBilling result={report} loading={loading} />}
      {tab === 'format-d' && <FormatD result={report} loading={loading} />}
      {tab === 'member-dor' && <MemberDor result={report} loading={loading} />}
      {tab === 'trade-margin' && <TradeMargin result={report} loading={loading} />}
      {tab === 'reverse-auction' && <ReverseAuction result={report} loading={loading} />}
    </div>
  );
}

/* ------------------------------------------------------------------ tabs */

function DailyBilling({ result, loading }) {
  const columns = [
    { key: 'trade_date', label: 'Trade date' },
    { key: 'application_no', label: 'Application' },
    { key: 'portfolio_name', label: 'Portfolio' },
    { key: 'source_type', label: 'Market', render: r => `${r.source_type || '—'}${r.source ? ` · ${r.source}` : ''}` },
    { key: 'side', label: 'Side', render: r => side(r.side) },
    { key: 'delivery_date', label: 'Delivery' },
    { key: 'traded_qty_mwh', label: 'Qty (MWh)', render: r => money(r.traded_qty_mwh) },
    { key: 'price_rs_per_mwh', label: 'Price (₹/MWh)', render: r => money(r.price_rs_per_mwh) },
    { key: 'trade_value', label: 'Trade value', render: r => money(r.trade_value) },
    { key: 'pxil_fees', label: 'PXIL fees', render: r => money(r.pxil_fees) },
    { key: 'stoa_charges', label: 'STOA', render: r => money(r.stoa_charges) },
    { key: 'total_payin_payout', label: 'Pay-in / pay-out', render: r => money(r.total_payin_payout) },
    { key: 'balance_margin', label: 'Balance margin', render: r => money(r.balance_margin) },
  ];

  return (
    <Card title="TAM / GTAM billing — day level">
      {result && result.date_order_confirmed === false && (
        <Caveat>
          <strong>Date order unconfirmed.</strong> Every day in this response is 12 or under, so
          PXIL's <code>DD-MM-YYYY</code> ordering cannot be proven from the data itself. Dates are
          read day-first; if PXIL is sending month-first, delivery periods in this range are wrong.
          Confirmation is pending with PXIL.
        </Caveat>
      )}
      <Table columns={columns} rows={result?.rows || []} loading={loading}
        emptyMessage="No TAM/GTAM trades in this period." />
    </Card>
  );
}

function SlotBilling({ result, loading }) {
  const [open, setOpen] = useState(null);
  const rows = result?.rows || [];
  const mismatches = rows.reduce((a, r) => a + (r.slot_mwh_mismatches || 0), 0);

  const columns = [
    { key: 'trade_date', label: 'Trade date' },
    { key: 'application_no', label: 'Application' },
    { key: 'side', label: 'Side', render: r => side(r.side) },
    { key: 'delivery_date', label: 'Delivery' },
    { key: 'traded_qty_mwh', label: 'Traded (MWh)', render: r => money(r.traded_qty_mwh) },
    { key: 'final_scheduled_qty_mwh', label: 'Final scheduled (MWh)', render: r => money(r.final_scheduled_qty_mwh) },
    { key: 'real_time_curtailment_mwh', label: 'Curtailed (MWh)', render: r => money(r.real_time_curtailment_mwh) },
    {
      key: 'trade_slot_count',
      label: 'Slots',
      render: r => (
        <span>
          {r.trade_slot_count} traded / {r.scheduled_slot_count} scheduled
          {r.slot_mwh_mismatches > 0 && <Badge type="danger" >{r.slot_mwh_mismatches} MWh mismatch</Badge>}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: r => (
        <button className="btn btn-secondary btn-sm"
          onClick={() => setOpen(open === r.application_no ? null : r.application_no)}>
          {open === r.application_no ? 'Hide slots' : 'Show slots'}
        </button>
      ),
    },
  ];

  const shown = rows.find(r => r.application_no === open);

  return (
    <Card title="TAM / GTAM billing — 15-minute slots">
      <Caveat>
        <strong>Slot labelling unconfirmed.</strong> PXIL's sample day begins at{' '}
        <code>00:15–00:30</code>, so we do not yet know whether a slot is labelled by its start or
        its end, nor whether a full day carries 95 or 96 blocks. Slot boundaries are shown exactly
        as PXIL sends them and are not renumbered — renumbering on a guess would shift every block
        by fifteen minutes.
      </Caveat>
      {mismatches > 0 && (
        <Caveat>
          <strong>{mismatches} slot{mismatches === 1 ? '' : 's'} where MWh ≠ MW ÷ 4.</strong> Both
          values are shown as received; neither has been recomputed.
        </Caveat>
      )}
      <Table columns={columns} rows={rows} loading={loading}
        emptyMessage="No slot-wise data in this period." />

      {shown && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 8px' }}>Slots — {shown.application_no}</h4>
          <Table
            columns={[
              { key: 'from_time', label: 'From' },
              { key: 'to_time', label: 'To' },
              { key: 'mw', label: 'MW', render: r => money(r.mw) },
              { key: 'mwh', label: 'MWh', render: r => money(r.mwh) },
              {
                key: 'mwh_matches_mw',
                label: 'MWh check',
                render: r => (r.mwh_matches_mw
                  ? <Badge type="success">Consistent</Badge>
                  : <Badge type="danger">MWh ≠ MW ÷ 4</Badge>),
              },
            ]}
            rows={shown.trade_slots || []}
            emptyMessage="No traded slots on this application."
          />
        </div>
      )}
    </Card>
  );
}

function FormatD({ result, loading }) {
  const columns = [
    { key: 'application_no', label: 'Application' },
    { key: 'product', label: 'Product' },
    { key: 'start_date', label: 'From' },
    { key: 'end_date', label: 'To' },
    { key: 'start_time', label: 'Start' },
    { key: 'end_time', label: 'End' },
    { key: 'seller_name', label: 'Seller', render: r => `${r.seller_name || '—'}${r.seller_state ? ` (${r.seller_state})` : ''}` },
    { key: 'buyer_name', label: 'Buyer', render: r => `${r.buyer_name || '—'}${r.buyer_state ? ` (${r.buyer_state})` : ''}` },
    { key: 'scheduled_volume', label: 'Scheduled volume', render: r => money(r.scheduled_volume) },
    { key: 'transaction_price', label: 'Txn price', render: r => money(r.transaction_price) },
    { key: 'transaction_rate', label: 'Txn rate', render: r => money(r.transaction_rate) },
  ];

  return (
    <Card title="Format-D — scheduled transactions">
      {result && result.total_count_matches === false && (
        <Caveat>
          <strong>Row count does not match.</strong> PXIL declared{' '}
          {result.total_count_declared} row{result.total_count_declared === 1 ? '' : 's'} but sent{' '}
          {result.rows?.length}. Something was lost in paging or parsing — do not treat this list as complete.
        </Caveat>
      )}
      <Table columns={columns} rows={result?.rows || []} loading={loading}
        emptyMessage="No Format-D transactions in this period." />
    </Card>
  );
}

function MemberDor({ result, loading }) {
  const columns = [
    { key: 'application_no', label: 'Application' },
    { key: 'portfolio_name', label: 'Portfolio' },
    { key: 'side', label: 'Side', render: r => side(r.side) },
    { key: 'delivery_date_from', label: 'Delivery from' },
    { key: 'delivery_date_to', label: 'Delivery to' },
    { key: 'charges', label: 'Charges', render: r => money(r.category.charges) },
    { key: 'fees', label: 'Fees', render: r => money(r.category.fees) },
    { key: 'gst', label: 'GST', render: r => money(r.category.igst + r.category.cgst + r.category.sgst) },
    { key: 'cp', label: 'CP', render: r => money(r.category.cp) },
    { key: 'component_sum', label: 'Sum of category', render: r => money(r.component_sum) },
    { key: 'total', label: 'Total (PXIL)', render: r => money(r.total) },
    {
      key: 'total_reconciles',
      label: 'Reconciles',
      render: r => (r.total_reconciles
        ? <Badge type="success">Balanced</Badge>
        : <Badge type="danger">Off by {money(r.total_variance)}</Badge>),
    },
  ];

  return (
    <Card title="Member DOR — day-wise obligations">
      {result && result.unreconciled_count > 0 && (
        <Caveat>
          <strong>{result.unreconciled_count} row{result.unreconciled_count === 1 ? '' : 's'} where
            Total does not equal the sum of its own Category.</strong> PXIL's documented sample has
          the same gap and the composition of <code>Total</code> is still open with them. These rows
          must not be posted to the books until PXIL confirms what <code>Total</code> contains.
        </Caveat>
      )}
      <Table columns={columns} rows={result?.rows || []} loading={loading}
        emptyMessage="No obligations in this period." />
    </Card>
  );
}

function TradeMargin({ result, loading }) {
  const entities = result?.entities || [];

  return (
    <Card title="Trade Margin — entity, portfolio and application">
      {result && result.trade_count_mismatches > 0 && (
        <Caveat>
          <strong>{result.trade_count_mismatches} entity/entities declare a TotalTrades that does not
            match the applications returned.</strong> PXIL's own sample does the same — it declares
          10 trades over one application — so we do not yet know what TotalTrades counts. It is not
          the number of rows.
        </Caveat>
      )}
      {result && result.unreconciled_portfolios > 0 && (
        <Caveat>
          <strong>{result.unreconciled_portfolios} portfolio Sum block{result.unreconciled_portfolios === 1 ? '' : 's'} disagree
            with the applications underneath.</strong> PXIL's declared sum and our recomputed sum are
          both shown below; neither has been preferred over the other.
        </Caveat>
      )}

      <Table
        columns={[
          { key: 'entity_name', label: 'Entity', render: r => `${r.entity_name || '—'} (${r.entity_id || '—'})` },
          { key: 'trade_date', label: 'Trade date' },
          {
            key: 'portfolios',
            label: 'Portfolios',
            render: r => (r.portfolio_count_matches
              ? r.portfolios_returned
              : <Badge type="danger">{r.portfolios_returned} of {r.portfolios_declared} declared</Badge>),
          },
          {
            key: 'trades',
            label: 'Trades',
            render: r => (r.trade_count_matches
              ? r.applications_returned
              : <Badge type="danger">{r.applications_returned} rows vs {r.trades_declared} declared</Badge>),
          },
          { key: 'total_margin', label: 'Total margin', render: r => money(r.declared.total_margin) },
          { key: 'initial_margin', label: 'Initial (post-trade)', render: r => money(r.declared.initial_margin) },
          { key: 'delivery_margin', label: 'Delivery', render: r => money(r.declared.delivery_margin) },
          { key: 'applicable_margin', label: 'Applicable', render: r => money(r.declared.applicable_margin) },
          {
            key: 'margins_reconcile',
            label: 'Totals vs rows',
            render: r => (r.margins_reconcile
              ? <Badge type="success">Match</Badge>
              : <Badge type="danger">Off by {money(r.margin_variance.applicable_margin)}</Badge>),
          },
        ]}
        rows={entities}
        loading={loading}
        emptyMessage="No margin data in this period."
      />

      {entities.map(e => e.portfolios.map(p => (
        <div key={`${e.entity_id}-${p.portfolio_id}`} style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 8px' }}>
            {p.portfolio_name} ({p.portfolio_id}){' '}
            {p.sum_declared
              ? (p.sums_reconcile ? <Badge type="success">Sum block matches</Badge> : <Badge type="danger">Sum block disagrees</Badge>)
              : <Badge type="warning">No Sum block declared</Badge>}
          </h4>
          {p.sum_declared && !p.sums_reconcile && (
            <Table
              caption="PXIL's declared sum against the sum of the applications below"
              columns={[
                { key: 'field', label: 'Figure' },
                { key: 'declared', label: 'PXIL declared', render: r => money(r.declared) },
                { key: 'computed', label: 'Sum of rows', render: r => money(r.computed) },
                { key: 'variance', label: 'Difference', render: r => money(r.variance) },
              ]}
              rows={Object.keys(p.declared).map(k => ({
                id: k,
                field: k.replace(/_/g, ' '),
                declared: p.declared[k],
                computed: p.computed[k],
                variance: p.variance[k],
              }))}
            />
          )}
        </div>
      )))}
    </Card>
  );
}

function ReverseAuction({ result, loading }) {
  const auctions = result?.auctions || [];

  return (
    <Card title="Reverse auction — L1 summary">
      <Caveat>
        <strong>Snapshot only.</strong> This endpoint carries no date filter, so it returns the
        auctions open at the moment of the call. Nothing here can be backfilled — history exists
        only if each poll is recorded.
      </Caveat>
      {result?.polled_at && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
          Polled at {result.polled_at}
        </p>
      )}
      <Table
        columns={[
          { key: 'auction_id', label: 'Auction' },
          { key: 'buyer', label: 'Buyer' },
          { key: 'type', label: 'Type' },
          { key: 'delivery_month', label: 'Delivery' },
          { key: 'auction_quantity', label: 'Quantity', render: r => money(r.auction_quantity) },
          { key: 'l1', label: 'L1', render: r => money(r.l1) },
          { key: 'remaining_time', label: 'Time left' },
          { key: 'auction_close_time', label: 'Closes' },
          { key: 'sellers', label: 'Bidders', render: r => r.sellers.length },
        ]}
        rows={auctions}
        loading={loading}
        emptyMessage="No auctions open right now."
      />

      {auctions.map(a => (
        <div key={a.auction_id} style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 8px' }}>Bids — {a.auction_id}</h4>
          <Table
            columns={[
              { key: 'seller_id', label: 'Seller ID' },
              { key: 'seller_name', label: 'Seller' },
              { key: 'bid_price', label: 'Bid price', render: r => money(r.bid_price) },
              { key: 'bid_quantity', label: 'Bid quantity', render: r => money(r.bid_quantity) },
            ]}
            rows={a.sellers}
            emptyMessage="No bids on this auction yet."
          />
        </div>
      ))}
    </Card>
  );
}
