import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Tabs, Tab, Field, StatCard, SampleDataNotice, fmtNumber } from '../../components/ui.jsx';

// IEX Front Office API — the desk's window onto what the exchange actually
// returns, and onto whether we can reach it at all.
//
// This screen is deliberately blunt about three things, because each of them
// can turn a plausible-looking number into a wrong settlement:
//
//   1. STUB vs live. Until a base URL and a valid token are configured the
//      server answers in stub mode, and a stub schedule must never be read as
//      a cleared position.
//   2. The token. Its JWT exp claim is known to be wrong (IEX: a typo, the
//      token lasts six months, and it does work past the claim), so the claim
//      is only surfaced when iex_enforce_token_expiry is on. A real rejection
//      shows up as a 401 that names the token.
//   3. The scaling factor and the delivery-date source behind every figure.
//      A wrong decimal factor is a power-of-ten error and a wrong delivery
//      epoch silently reads the neighbouring trading day.

const PRODUCTS = ['DAM', 'GDAM', 'RTM', 'HPDAM'];

const TABS = [
  { key: 'pq', label: 'Market price (PQ results)' },
  { key: 'schedule', label: 'Our schedule (cleared)' },
  { key: 'dates', label: 'Delivery dates' },
  // IEX's own answer to "when are results ready?": read this rather than
  // polling PQ results. Empty on UAT, where clearing is run by hand.
  { key: 'publish', label: 'Published yet?' },
  // REC/EC is a different market model — an order book and a trade book, with
  // no delivery date and no time blocks — so it gets its own tabs.
  { key: 'rec-orders', label: 'REC/EC order book' },
  { key: 'rec-trades', label: 'REC/EC trades' },
];

/** Tabs driven by the REC API rather than the Front Office one. */
const REC_TABS = ['rec-orders', 'rec-trades'];

const today = () => new Date().toISOString().slice(0, 10);
const num = (v, d = 2) => (v == null ? '—' : fmtNumber(v, d));

/** Something the exchange sent that we could not fully verify: a warning, not a fact. */
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

const PQ_COLUMNS = [
  { key: 'from_period', header: 'From' },
  { key: 'to_period', header: 'To' },
  { key: 'mcp', header: 'MCP (Rs/kWh)', render: (r) => num(r.mcp_rs_per_kwh, 3) },
  { key: 'buy', header: 'Buy (MW)', render: (r) => num(r.buy_mw) },
  { key: 'sell', header: 'Sell (MW)', render: (r) => num(r.sell_mw) },
  { key: 'areas', header: 'Bid areas', render: (r) => (r.areas || []).map((a) => a.bid_area).join(', ') || '—' },
];

const SCHEDULE_COLUMNS = [
  { key: 'from_period', header: 'From' },
  { key: 'to_period', header: 'To' },
  { key: 'bid_area', header: 'Bid area', render: (r) => r.bid_area || '—' },
  { key: 'cleared_mw', header: 'Our cleared (MW)', render: (r) => num(r.cleared_mw) },
  { key: 'price', header: 'Area price (Rs/kWh)', render: (r) => num(r.cleared_price_rs_per_kwh, 3) },
  // Shown next to ours precisely so the two are never confused: the area's
  // volume is the whole market's, not SJVN's.
  { key: 'area_sell_mw', header: 'Area sell (MW)', render: (r) => num(r.area_sell_mw) },
  {
    key: 'portfolios',
    header: 'Portfolios',
    render: (r) => (r.portfolios || []).map((p) => `${p.portfolio_id}: ${num(p.mw)}`).join(', ') || '—',
  },
];

// Certificate prices, NOT Rs/kWh — REC and EC are priced per certificate.
const REC_ORDER_COLUMNS = [
  { key: 'order_id', header: 'Order' },
  { key: 'product', header: 'Product', render: (r) => r.product || '—' },
  { key: 'instrument_name', header: 'Instrument', render: (r) => r.instrument_name || '—' },
  { key: 'side', header: 'Side', render: (r) => r.side || '—' },
  { key: 'price_rs', header: 'Price (Rs/certificate)', render: (r) => num(r.price_rs) },
  { key: 'pending_qty', header: 'Pending', render: (r) => num(r.pending_qty) },
  { key: 'executed_qty', header: 'Executed', render: (r) => num(r.executed_qty) },
  { key: 'status', header: 'Status', render: (r) => r.status || '—' },
];

const REC_TRADE_COLUMNS = [
  { key: 'trade_id', header: 'Trade' },
  { key: 'order_id', header: 'Order' },
  { key: 'product', header: 'Product', render: (r) => r.product || '—' },
  { key: 'side', header: 'Side', render: (r) => r.side || '—' },
  { key: 'qty', header: 'Quantity', render: (r) => num(r.qty) },
  { key: 'price_rs', header: 'Price (Rs/certificate)', render: (r) => num(r.price_rs) },
  { key: 'value_rs', header: 'Value (Rs)', render: (r) => num(r.value_rs) },
];

const PUBLISH_COLUMNS = [
  { key: 'delivery_date', header: 'Delivery date', render: (r) => r.delivery_date || '—' },
  // RTM publishes per session — two 15-minute blocks, 48 in a day.
  { key: 'session', header: 'Session (RTM)', render: (r) => (r.session == null ? '—' : r.session) },
  { key: 'stage', header: 'Provisional or final', render: (r) => r.stage || '—' },
  { key: 'action', header: 'Action', render: (r) => r.action || '—' },
  { key: 'run_count', header: 'Run', render: (r) => (r.run_count == null ? '—' : r.run_count) },
];

const DATE_COLUMNS = [
  { key: 'delivery_date_id', header: 'Label', render: (r) => r.delivery_date_id || '—' },
  { key: 'iso_date', header: 'Delivery date', render: (r) => r.iso_date || '—' },
  { key: 'epoch_seconds', header: 'Epoch seconds (as the API expects)' },
];

export default function IexIntegration() {
  const [status, setStatus] = useState(null);
  const [tab, setTab] = useState('pq');
  const [product, setProduct] = useState('DAM');
  const [date, setDate] = useState(today());
  const [result, setResult] = useState(null);
  const [probe, setProbe] = useState(null);
  const [probing, setProbing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.iex.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  // The result is stamped with the tab it belongs to. Three reports with three
  // different row shapes share this state, so a response arriving after the
  // reader has moved on must not be rendered against the wrong columns.
  async function load(which = tab) {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = which === 'pq' ? await api.iex.pqResults({ product, date })
        : which === 'schedule' ? await api.iex.scheduleReport({ product, date })
          : which === 'publish' ? await api.iex.publishInfo({ product })
            : which === 'rec-orders' ? await api.iex.recOrders()
              : which === 'rec-trades' ? await api.iex.recTrades()
                : await api.iex.deliveryDates({ product });
      setResult({ tab: which, data });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'IEX request failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(tab); /* eslint-disable-next-line */ }, [tab, product]);

  async function runProbe() {
    setProbing(true);
    setProbe(null);
    try {
      setProbe(await api.iex.connectivity({ product }));
    } catch (err) {
      setProbe({ reachable: false, error: err.response?.data?.error || err.message });
    } finally {
      setProbing(false);
    }
  }

  const stub = !status || status.mode === 'STUB';
  const report = result?.tab === tab ? result.data : null;
  const isRec = REC_TABS.includes(tab);
  const rows = tab === 'pq' ? (report?.periods || [])
    : tab === 'schedule' ? (report?.blocks || [])
      : tab === 'publish' ? (report?.entries || [])
        : tab === 'rec-orders' ? (report?.orders || [])
          : tab === 'rec-trades' ? (report?.trades || [])
            : (report?.dates || []);
  const columns = tab === 'pq' ? PQ_COLUMNS
    : tab === 'schedule' ? SCHEDULE_COLUMNS
      : tab === 'publish' ? PUBLISH_COLUMNS
        : tab === 'rec-orders' ? REC_ORDER_COLUMNS
          : tab === 'rec-trades' ? REC_TRADE_COLUMNS
            : DATE_COLUMNS;

  return (
    <div>
      <PageHeader
        title="IEX Integration"
        subtitle="Front Office API — market clearing prices, our cleared schedule, and whether the exchange is reachable at all."
      />

      {stub && (
        <SampleDataNotice detail="The server is not configured to call IEX, so no figures here come from the exchange. Set iex_enabled=true with a current iex_api_token and iex_login_user_id — the segment hosts are already built in. Requests must also originate from the IP whitelisted with IEX." />
      )}

      {/* The token's own exp claim is known to be wrong (IEX: a typo; the token
          works), so it is only raised when the desk has chosen to enforce it. */}
      {status?.token_expired && status.token_expiry_enforced && (
        <Caveat>
          <strong>The configured token's own expiry claim passed on {new Date(status.token_expires_at).toLocaleString()}.</strong>{' '}
          Requests are being refused before they are sent (iex_enforce_token_expiry is on), so this is not an exchange outage.
          There is no refresh endpoint; IEX mails a replacement 15 days before a token genuinely lapses.
        </Caveat>
      )}

      {status && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 18 }}>
          <StatCard
            label="Data source"
            value={status.mode === 'IEX' ? `Live IEX (${status.environment})` : 'Not connected'}
            tone={status.mode === 'IEX' ? 'success' : 'warning'}
          />
          <StatCard
            label="Host"
            value={(status.hosts?.[product] || status.base_url_override || '—').replace(/^https?:\/\//, '').replace(/\/$/, '')}
            tone={status.hosts?.[product] || status.base_url_override ? 'default' : 'warning'}
            hint={status.base_url_override ? 'Overridden for every segment' : `Published by IEX for ${product}`}
          />
          <StatCard
            label="Token"
            value={!status.token_present ? 'Not set' : (status.token_expired && status.token_expiry_enforced) ? 'Expired' : 'Set'}
            tone={status.token_present && !(status.token_expired && status.token_expiry_enforced) ? 'success' : 'warning'}
            hint="Six months from issue; IEX mails a replacement"
          />
          <StatCard
            label="Participant"
            value={status.participant_id || 'Not set'}
            hint={status.login_user_id ? `User ${status.login_user_id}` : 'No login user set'}
            tone={status.participant_id ? 'default' : 'warning'}
          />
        </div>
      )}

      <Card
        title="Connectivity"
        actions={<button className="btn btn-secondary" onClick={runProbe} disabled={probing}>{probing ? 'Checking…' : 'Test connection'}</button>}
      >
        <p style={{ marginTop: 0, fontSize: 13, color: 'var(--text-muted, #64748b)' }}>
          One round trip to the exchange's business-configuration API. This is the check to run after IEX
          confirms an IP is whitelisted — it separates a wrong URL, a bad token and a blocked IP from
          "today's report is simply empty".
        </p>
        {probe && (
          <div style={{ fontSize: 13 }}>
            <strong>{probe.reachable ? 'Reachable' : 'Not reachable'}</strong>
            {probe.base_url && <> — {probe.base_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</>}
            {probe.elapsed_ms != null && <> — {probe.elapsed_ms} ms</>}
            {probe.business_date_iso && <> — exchange business date {probe.business_date_iso}</>}
            {probe.error && <div style={{ color: 'var(--danger-text, #b91c1c)', marginTop: 6 }}>{probe.error}</div>}
            {probe.note && <div style={{ color: 'var(--text-muted, #64748b)', marginTop: 6 }}>{probe.note}</div>}
            {probe.warning && <div style={{ color: 'var(--warning-text, #92400e)', marginTop: 6 }}>{probe.warning}</div>}
          </div>
        )}
      </Card>

      <Card title="Report">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
          {!isRec && (
            <Field label="Product">
              <select className="input" value={product} onChange={(e) => setProduct(e.target.value)}>
                {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          )}
          {tab !== 'dates' && tab !== 'publish' && !isRec && (
            <Field label="Delivery date">
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          )}
          <button className="btn btn-primary" onClick={() => load(tab)} disabled={loading}>
            {loading ? 'Loading…' : 'Fetch'}
          </button>
        </div>

        <Tabs>
          {TABS.map((t) => (
            <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</Tab>
          ))}
        </Tabs>

        {error && <Caveat>{error}</Caveat>}
        {report?.warning && <Caveat>{report.warning}</Caveat>}
        {report?.note && <Caveat>{report.note}</Caveat>}

        {report?.unscaled_rows > 0 && (
          <Caveat>
            {report.unscaled_rows} row(s) name a product the REC product master did not
            describe, so their price and quantity could not be scaled. They are shown as the
            exchange sent them — do not read those figures as certificates.
          </Caveat>
        )}

        {report?.bid_areas_queried && (
          <p style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginBottom: 4 }}>
            Bid areas asked: {report.bid_areas_queried.join(', ')}{' '}
            {report.bid_area_source === 'PORTFOLIO_MAPPING'
              ? '— ours, from the first two characters of our portfolio ids.'
              : report.bid_area_source === 'CONFIG'
                ? '— fixed in configuration (iex_bid_area_id).'
                : '— every area the exchange lists, because our own could not be established.'}
          </p>
        )}

        {report?.scaling && (
          <p style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
            Quantities divided by {report.scaling.qty_factor}, prices by {report.scaling.price_factor}{' '}
            ({report.scaling.source === 'ASSET_MASTER' ? 'from the Asset Master' : 'default — not read from the exchange'}).
            {report.delivery_date_source && <> Delivery date {report.delivery_date_source === 'EXCHANGE' ? 'taken from the exchange' : 'computed locally as UTC midnight'}.</>}
          </p>
        )}

        <Table
          columns={columns}
          rows={rows}
          loading={loading}
          emptyMessage={stub ? 'Not connected to IEX — nothing to show.' : 'The exchange returned no rows for this selection.'}
          // REC/EC is not filtered by the FO product selector, so naming one
          // in the caption would describe a filter that is not applied.
          caption={`IEX ${isRec ? '' : `${product} `}${TABS.find((t) => t.key === tab)?.label}`}
        />
      </Card>

      <Card title="Not implemented">
        <ul style={{ fontSize: 13, marginTop: 0, lineHeight: 1.7 }}>
          <li><strong>Bid submission</strong> — two-way and money-moving. It stays manual until a controlled test window; the server refuses to place live orders rather than pretending to.</li>
          <li><strong>REC/EC order entry</strong> — read-only for now. The order book, trade book and product master are live; placing and cancelling orders needs the same controlled rollout as FO bid submission.</li>
          <li><strong>REC on UAT</strong> — the production host is known (recapi.iexindia.com), but on UAT the whitelist is per host and 49.50.97.173 is not yet on the REC one, so every REC call there returns the gateway&apos;s 403 until IEX add it.</li>
          <li><strong>C&amp;S back office (post-trade reports)</strong> — needs a token of its own, which IEX have not issued, and the report API document has not been shared. No IP whitelisting is required there.</li>
          <li><strong>TAM (Term-Ahead Market)</strong> — IEX has not issued a TAM API document or enabled TAM on UAT for SJVN (UAT covers DAM, GDAM, HPDAM, RTM and REC), so there is nothing to call yet. PXIL&apos;s TAM-GTAM report is built under PXIL Reports, and the CERC monthly report&apos;s TAM figures are on the market dashboards.</li>
        </ul>
      </Card>
    </div>
  );
}
