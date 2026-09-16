import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../../api/client.js';
import { Card } from '../../components/ui.jsx';
import SourceNote from '../../components/SourceNote.jsx';
import { periodLabel, mu } from './cercMonth.jsx';

// Who traded, from the CERC monthly report: the trading licensees' shares, the
// entities that sold and bought in each market, the REC bid book, and the
// term-ahead markets contract by contract. These cards replaced "not held"
// notices, and before those, typed-in bars and placeholder names.

const SEGMENT_LABEL = {
  TRADING_LICENSEE: 'trading licensees',
  BILATERAL: 'bilateral',
  DAM: 'DAM',
  GDAM: 'GDAM',
  'HP-DAM': 'HP-DAM',
  RTM: 'RTM',
};

// Buy and sell bids: the pair the bid-vs-cleared and forecast charts already
// use, validated together on the white card surface (CVD ΔE 33.4, contrast ≥ 3:1).
const BUY = 'var(--primary)';
const SELL = 'var(--amber)';

// Entities often differ only at the end of the name ("…FIFTY SEVEN LIMITED_PSS13"
// against "…FIFTY SIX LIMITED_PSS9"), so a long name keeps its start and its end.
const short = (name, max = 32) => (name.length > max ? `${name.slice(0, max - 14)}…${name.slice(-13)}` : name);

/** One line per bar, never wrapped, with the whole name on hover. */
function EntityTick({ x, y, payload, rows }) {
  const row = rows.find((r) => r.label === payload.value);
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="var(--text)">
      <title>{row?.entity_name || payload.value}</title>
      {payload.value}
    </text>
  );
}
const pct = (v, digits = 1) => (v == null ? '—' : `${Number(v).toFixed(digits)}%`);
const whole = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }));

function useFetch(fetcher, deps) {
  const [state, setState] = useState({ data: null, error: '' });
  useEffect(() => {
    let live = true;
    setState({ data: null, error: '' });
    fetcher()
      .then((data) => { if (live) setState({ data, error: '' }); })
      .catch((err) => { if (live) setState({ data: null, error: err?.response?.data?.error || 'Could not load the CERC report.' }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** Explains the index once, where it is shown: a reader should not need to look it up. */
const hhiNote = (hhi) => (hhi == null ? '' : ` HHI ${Number(hhi).toFixed(3)} (0 is many equal participants, 1 is a single one).`);

/**
 * The largest participants in one segment and side of the month, as a ranked
 * bar, with the segment's concentration underneath and the same rows as a table.
 */
export function ParticipantsCard({ period, segment, side, title, limit = 10 }) {
  const licensee = segment === 'TRADING_LICENSEE';
  const { data, error } = useFetch(
    () => api.cercMarket.participants({ period, segment, side, limit }),
    [period, segment, side, limit],
  );

  const heading = title || `Top ${limit} ${SEGMENT_LABEL[segment]} ${side === 'BUY' ? 'buyers' : 'sellers'}`;
  if (error) return <Card title={heading}><div className="alert alert-error" role="alert">{error}</div></Card>;
  if (!data) return <Card title={heading}><div className="audit-placeholder">Loading…</div></Card>;

  const when = periodLabel(data.period);
  if (!data.in_report) {
    return (
      <Card title={`${heading} — ${when}`}>
        <div className="audit-placeholder">
          The {when} CERC report has no {SEGMENT_LABEL[segment]} {licensee ? 'share' : side === 'BUY' ? 'purchase' : 'sale'} table.
        </div>
      </Card>
    );
  }

  const rows = data.participants.map((p) => ({
    ...p,
    label: `${p.rank}. ${short(p.entity_name)}`,
    value: licensee ? p.share_percent : p.volume_mu,
  }));
  const c = data.concentration;

  return (
    <Card title={`${heading} — ${when}`}>
      <div style={{ width: '100%', height: Math.max(160, rows.length * 30 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
            <CartesianGrid stroke="var(--border)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} unit={licensee ? '%' : ''} />
            <YAxis type="category" dataKey="label" width={260} tick={<EntityTick rows={rows} />} interval={0} tickLine={false} />
            <Tooltip
              formatter={(v) => [licensee ? pct(v, 2) : `${mu(v)} MU`, licensee ? 'Share' : 'Volume']}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.entity_name || ''}
            />
            <Bar dataKey="value" name={licensee ? 'Share' : 'Volume'} fill="var(--primary)" maxBarSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="report-count">
        {licensee
          ? `The top five of ${c?.entity_count ?? data.entities_in_table} licensees transacted ${pct(c?.top5_share_percent)} of what licensees traded.`
          : `${data.entities_in_table} entities ${side === 'BUY' ? 'bought' : 'sold'} ${mu(c?.total_volume_mu)} MU; the top five ${pct(c?.top5_share_percent)} of it (${mu(c?.top5_volume_mu)} MU).`}
        {hhiNote(c?.hhi)}
      </p>

      <details>
        <summary style={{ fontSize: 12, cursor: 'pointer' }}>Show as a table</summary>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">{licensee ? 'Trading licensee' : 'Entity'}</th>
                {!licensee && <th scope="col" className="num">MU</th>}
                <th scope="col" className="num">Share</th>
              </tr>
            </thead>
            <tbody>
              {data.participants.map((p) => (
                <tr key={`${p.rank}-${p.entity_name}`}>
                  <td className="num">{p.rank}</td>
                  <td>{p.entity_name}</td>
                  {!licensee && <td className="num">{mu(p.volume_mu)}</td>}
                  <td className="num">{pct(p.share_percent, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <SourceNote source={`CERC Market Monitoring Report${c?.source_table ? `, ${c.source_table}` : ''}`} period={when} />
    </Card>
  );
}

const CONTRACT_ORDER = ['INTRADAY', 'DAY_AHEAD_CONTINGENCY', 'DAILY', 'WEEKLY', 'MONTHLY', 'ANY_DAY_SINGLE_SIDED', 'OTHER'];
const CONTRACT_LABEL = {
  INTRADAY: 'Intra-day',
  DAY_AHEAD_CONTINGENCY: 'Day-ahead contingency',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  ANY_DAY_SINGLE_SIDED: 'Any-day single-sided',
};
const MARKET_TITLE = { TAM: 'Term-ahead market', GTAM: 'Green term-ahead market', 'HP-TAM': 'High-price term-ahead market' };

/**
 * A term-ahead market for the month: each exchange's scheduled volume and
 * weighted price by contract type. A table, because the point is the figures
 * themselves, and volume and price cannot share an axis.
 */
export function TermAheadCard({ period, market }) {
  const { data, error } = useFetch(() => api.cercMarket.termAhead({ period, market }), [period, market]);
  const heading = `${MARKET_TITLE[market]} (${market}) by contract type`;
  if (error) return <Card title={heading}><div className="alert alert-error" role="alert">{error}</div></Card>;
  if (!data) return <Card title={heading}><div className="audit-placeholder">Loading…</div></Card>;
  const when = periodLabel(data.period);
  if (!data.in_report) {
    return <Card title={`${heading} — ${when}`}><div className="audit-placeholder">The {when} CERC report has no {market} tables.</div></Card>;
  }

  const types = CONTRACT_ORDER.filter((t) => data.exchanges.some((e) => e.contracts.some((c) => c.contract_type === t)));
  const cell = (exchange, type) => {
    const found = exchange.contracts.filter((c) => c.contract_type === type);
    if (!found.length) return null;
    return found.reduce((a, c) => ({ volume_mu: a.volume_mu + (c.volume_mu || 0), price_rs_kwh: c.price_rs_kwh ?? a.price_rs_kwh }), { volume_mu: 0, price_rs_kwh: null });
  };
  const nothing = data.exchanges.every((e) => !e.volume_mu);

  return (
    <Card title={`${heading} — ${when}`}>
      {nothing ? (
        <div className="audit-placeholder">Nothing was scheduled in {market} on any exchange this month.</div>
      ) : (
      <>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th scope="col" rowSpan={2}>Contract</th>
              {data.exchanges.map((e) => <th key={e.exchange} scope="colgroup" colSpan={2} className="num">{e.exchange}</th>)}
            </tr>
            <tr>
              {data.exchanges.map((e) => (
                <React.Fragment key={e.exchange}>
                  <th scope="col" className="num">MU</th>
                  <th scope="col" className="num">₹/kWh</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t}>
                <td>{CONTRACT_LABEL[t] || 'Other'}</td>
                {data.exchanges.map((e) => {
                  const v = cell(e, t);
                  return (
                    <React.Fragment key={e.exchange}>
                      <td className="num">{v ? mu(v.volume_mu) : '—'}</td>
                      <td className="num">{v?.price_rs_kwh == null ? '—' : v.price_rs_kwh.toFixed(2)}</td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All contracts</th>
              {data.exchanges.map((e) => (
                <React.Fragment key={e.exchange}>
                  <td className="num"><strong>{mu(e.volume_mu)}</strong></td>
                  <td className="num"><strong>{e.weighted_price_rs_kwh == null ? '—' : e.weighted_price_rs_kwh.toFixed(2)}</strong></td>
                </React.Fragment>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="report-count">
        A dash is a contract that scheduled nothing, so it has no price. The all-contracts price is weighted by the volume scheduled.
      </p>
      </>
      )}
      <SourceNote source="CERC Market Monitoring Report" period={when} />
    </Card>
  );
}

/**
 * The REC bid book for the month: what buyers bid for against what sellers
 * offered on each exchange, beside what traded and at what price.
 */
export function RecBidDepthCard({ month }) {
  const when = periodLabel(month.period);
  const exchanges = (month.rec || []).filter((r) => r.exchange !== 'TRADERS');
  const traders = (month.rec || []).find((r) => r.exchange === 'TRADERS');
  const rows = exchanges.filter((r) => r.buy_bid_mwh != null || r.sell_bid_mwh != null);

  return (
    <Card title={`REC bids and trades — ${when}`}>
      {!rows.length ? (
        <div className="audit-placeholder">The {when} report carries no REC bid volumes.</div>
      ) : (
        <>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 0 }} barGap={2} barCategoryGap="38%">
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="exchange" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={72} tickFormatter={(v) => `${(v / 100000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}L`} />
                <Tooltip formatter={(v, name) => [`${whole(v)} RECs`, name]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="buy_bid_mwh" name="Bid to buy" fill={BUY} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="sell_bid_mwh" name="Offered to sell" fill={SELL} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="report-count">Axis in lakh RECs (1 REC = 1 MWh).</p>
        </>
      )}

      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th scope="col">Where</th>
              <th scope="col" className="num">Bid to buy</th>
              <th scope="col" className="num">Offered to sell</th>
              <th scope="col" className="num">Buy ÷ sell</th>
              <th scope="col" className="num">Traded</th>
              <th scope="col" className="num">₹/REC</th>
            </tr>
          </thead>
          <tbody>
            {[...exchanges, ...(traders && traders.volume_mwh != null ? [traders] : [])].map((r) => (
              <tr key={r.exchange}>
                <td>{r.exchange === 'TRADERS' ? 'Through traders (bilateral)' : r.exchange}</td>
                <td className="num">{whole(r.buy_bid_mwh)}</td>
                <td className="num">{whole(r.sell_bid_mwh)}</td>
                <td className="num">{r.buy_sell_ratio == null ? '—' : Number(r.buy_sell_ratio).toFixed(2)}</td>
                <td className="num">{whole(r.volume_mwh)}</td>
                <td className="num">{r.price_rs_mwh == null ? '—' : Number(r.price_rs_mwh).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="report-count">
        Below 1, sellers offered more certificates than buyers wanted. Sales through traders have no bid book.
      </p>
      <SourceNote source="CERC Market Monitoring Report" period={when} />
    </Card>
  );
}
