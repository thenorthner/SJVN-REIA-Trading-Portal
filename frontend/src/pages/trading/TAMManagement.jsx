import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PortfolioSelect } from '../../context/PortfolioContext.jsx';
import { api } from '../../api/client.js';
import { PageHeader, Card, Badge, fmtNumber } from '../../components/ui.jsx';
import TAMObligationDetailsModal from './TAMObligationDetailsModal.jsx';

function parseMinutes(hhmm) {
  const s = String(hhmm || '').trim();
  if (s === '24:00' || s === '24:00:00') return 24 * 60;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return 24 * 60;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Hours covered by a `HH:MM-HH:MM` label. TAM often files 00:00-24:00. */
export function hoursFromTimeBlock(label) {
  const raw = String(label || '');
  const dash = raw.indexOf('-');
  if (dash > 0) {
    const start = parseMinutes(raw.slice(0, dash));
    let end = parseMinutes(raw.slice(dash + 1));
    if (start != null && end != null) {
      if (end === 0 && start > 0) end = 24 * 60;
      if (end === start) end += 15;
      if (end < start) end += 24 * 60;
      const h = (end - start) / 60;
      if (h > 0 && h <= 24) return h;
    }
  }
  return 0.25;
}

export function summariseBid(bid) {
  let bidMwh = 0;
  let clearedMwh = 0;
  let value = 0;
  let pxMw = 0;
  let pxVal = 0;
  for (const blk of bid.blocks || []) {
    const h = hoursFromTimeBlock(blk.time_block);
    bidMwh += Number(blk.quantum_mw || 0) * h;
    const cmw = Number(blk.cleared_quantum_mw || 0);
    clearedMwh += cmw * h;
    const price = blk.cleared_price != null ? Number(blk.cleared_price) : Number(blk.price_per_unit || 0);
    if (cmw > 0) {
      pxMw += cmw;
      pxVal += cmw * price;
      value += cmw * h * 1000 * price;
    }
  }
  return {
    bidMwh,
    clearedMwh,
    value: Math.round(value * 100) / 100,
    avgPrice: pxMw > 0 ? pxVal / pxMw : null,
  };
}

function wrapBid(bid) {
  const s = summariseBid(bid);
  return {
    id: bid.id,
    isWeekly: false,
    exchange: bid.exchange,
    client_name: bid.client_name,
    contract_id: bid.contract_id,
    acceptanceNo: bid.exchange_receipt_ref || bid.id,
    contractType: 'Daily',
    deliveryDate: bid.delivery_date,
    tradeDate: bid.bid_date,
    status: bid.status,
    energyMUs: s.clearedMwh / 1000,
    netAmount: s.value,
    avgPrice: s.avgPrice,
    bid,
    children: [],
  };
}

function groupByContract(bids) {
  const byContract = new Map();
  const singles = [];
  for (const bid of bids) {
    if (bid.contract_id) {
      if (!byContract.has(bid.contract_id)) byContract.set(bid.contract_id, []);
      byContract.get(bid.contract_id).push(bid);
    } else {
      singles.push(wrapBid(bid));
    }
  }
  const rows = [];
  for (const [cid, list] of byContract) {
    list.sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date)));
    if (list.length === 1) {
      rows.push(wrapBid(list[0]));
      continue;
    }
    const children = list.map(wrapBid);
    const energyMUs = children.reduce((a, c) => a + c.energyMUs, 0);
    const netAmount = children.reduce((a, c) => a + c.netAmount, 0);
    const statuses = [...new Set(children.map((c) => c.status))];
    rows.push({
      id: cid,
      isWeekly: true,
      exchange: list[0].exchange,
      client_name: list[0].client_name,
      contract_id: cid,
      acceptanceNo: cid,
      contractType: 'Weekly',
      deliveryDate: `${list[0].delivery_date} → ${list[list.length - 1].delivery_date}`,
      tradeDate: list[0].bid_date,
      status: statuses.length === 1 ? statuses[0] : 'MIXED',
      energyMUs,
      netAmount,
      avgPrice: energyMUs > 0 ? (netAmount / (energyMUs * 1000 * 1000)) : null,
      bid: null,
      children,
    });
  }
  return [...rows, ...singles].sort((a, b) => String(b.deliveryDate).localeCompare(String(a.deliveryDate)));
}

function statusBadge(status) {
  if (status === 'CLEARED') return <Badge type="success">Cleared</Badge>;
  if (status === 'PARTIALLY_CLEARED') return <Badge type="warning">Partial</Badge>;
  if (status === 'SUBMITTED') return <Badge type="neutral">Submitted</Badge>;
  if (status === 'MIXED') return <Badge type="neutral">Mixed</Badge>;
  return <Badge type="neutral">{status}</Badge>;
}

function downloadCsv(filename, rows) {
  const header = Object.keys(rows[0] || { client: '', delivery: '', exchange: '', mwh: '', value: '' });
  const lines = [
    header.join(','),
    ...rows.map((r) => header.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TAMManagement({ marketType = 'TAM' }) {
  const product = marketType === 'GTAM' ? 'GTAM' : 'TAM';
  const [exchange, setExchange] = useState('');
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [unitMode, setUnitMode] = useState('MWH');
  const [expandedRows, setExpandedRows] = useState([]);
  const [selectedTamRecord, setSelectedTamRecord] = useState(null);
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    setError('');
    api.bids.list({
      product,
      exchange: exchange || undefined,
      client_id: clientId || undefined,
      from: from || undefined,
      to: to || undefined,
    })
      .then(setBids)
      .catch((err) => {
        setBids([]);
        setError(err.response?.data?.error || 'Could not load bids');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [product]);

  const records = useMemo(() => groupByContract(bids), [bids]);

  const totals = useMemo(() => {
    const mwh = records.reduce((a, r) => a + r.energyMUs * 1000, 0);
    const value = records.reduce((a, r) => a + r.netAmount, 0);
    return { mwh, value };
  }, [records]);

  const toggleExpand = (id) => {
    setExpandedRows((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const renderVolume = (mus) => {
    if (unitMode === 'MWH') return `${fmtNumber(mus * 1000, 3)} MWh`;
    return `${mus.toFixed(3)} MU`;
  };

  function exportCsv() {
    const flat = [];
    for (const r of records) {
      if (r.children?.length) {
        for (const c of r.children) {
          flat.push({
            client: c.client_name, bid_id: c.id, delivery: c.deliveryDate,
            trade_date: c.tradeDate, exchange: c.exchange, status: c.status,
            mwh: (c.energyMUs * 1000).toFixed(3), value: c.netAmount,
          });
        }
      } else {
        flat.push({
          client: r.client_name, bid_id: r.id, delivery: r.deliveryDate,
          trade_date: r.tradeDate, exchange: r.exchange, status: r.status,
          mwh: (r.energyMUs * 1000).toFixed(3), value: r.netAmount,
        });
      }
    }
    downloadCsv(`${product}-bids.csv`, flat);
  }

  return (
    <div style={{ padding: '0 20px 20px', maxWidth: 1600, margin: '0 auto' }}>
      <PageHeader
        title={`${product} Obligation List`}
        actions={
          <div style={{ display: 'flex', gap: 10 }}>
            <Link to="/trading/exchange/bidding" className="btn btn-outline">Place bid</Link>
            <button type="button" className="btn btn-outline" onClick={exportCsv} disabled={!records.length}>Export CSV</button>
          </div>
        }
      />

      <Card style={{ marginBottom: 20, background: '#f5f7f9' }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="tam-exchange">Exchange</label>
            <select id="tam-exchange" className="input" value={exchange} onChange={(e) => setExchange(e.target.value)}>
              <option value="">All</option>
              <option value="IEX">IEX</option>
              <option value="PXIL">PXIL</option>
              <option value="HPX">HPX</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="tam-client">Client</label>
            <PortfolioSelect id="tam-client" includeAll allLabel="All clients" value={clientId} onChange={setClientId} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="tam-from">From delivery</label>
            <input id="tam-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="tam-to">To delivery</label>
            <input id="tam-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" onClick={load}>Search</button>
        </div>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
        <div style={{ background: '#e8f5e9', border: '1px solid #c8e6c9', padding: '10px 20px', borderRadius: 4 }}>
          <span style={{ color: '#27ae60', fontWeight: 'bold', fontSize: 16 }}>
            Cleared {fmtNumber(totals.mwh, 3)} MWh · ₹{fmtNumber(totals.value, 2)}
          </span>
          <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>From live {product} bids — not IEX PDFs</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 'bold', color: '#555' }}>Volume</span>
          <div style={{ display: 'flex', background: '#eee', borderRadius: 20, overflow: 'hidden', padding: 2 }}>
            <button type="button" onClick={() => setUnitMode('MU')} style={{ background: unitMode === 'MU' ? '#fff' : 'transparent', border: 'none', padding: '5px 15px', borderRadius: 20, cursor: 'pointer', fontWeight: unitMode === 'MU' ? 'bold' : 'normal' }}>MU</button>
            <button type="button" onClick={() => setUnitMode('MWH')} style={{ background: unitMode === 'MWH' ? '#fff' : 'transparent', border: 'none', padding: '5px 15px', borderRadius: 20, cursor: 'pointer', fontWeight: unitMode === 'MWH' ? 'bold' : 'normal' }}>MWh</button>
          </div>
        </div>
      </div>

      <Card>
        {error && <div style={{ padding: 12, color: '#b91c1c', background: '#fef2f2', borderRadius: 4, marginBottom: 12 }}>{error}</div>}
        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading {product} bids…</div>
          ) : records.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
              No {product} bids yet. File them from Exchange Bidding.
            </div>
          ) : (
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #ddd', textAlign: 'left' }}>
                  <th scope="col" style={{ padding: 10, width: 40 }} />
                  <th scope="col" style={{ padding: 10 }}>Client</th>
                  <th scope="col" style={{ padding: 10 }}>Trade Date</th>
                  <th scope="col" style={{ padding: 10 }}>Delivery</th>
                  <th scope="col" style={{ padding: 10 }}>Bid / Contract</th>
                  <th scope="col" style={{ padding: 10 }}>Exchange</th>
                  <th scope="col" style={{ padding: 10 }}>Status</th>
                  <th scope="col" style={{ padding: 10 }}>Cleared vol</th>
                  <th scope="col" style={{ padding: 10 }}>Value (₹)</th>
                  <th scope="col" style={{ padding: 10 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const isExpanded = expandedRows.includes(record.id);
                  return (
                    <React.Fragment key={record.id}>
                      <tr style={{ borderBottom: '1px solid #eee', background: record.isWeekly ? '#fdfdfd' : '#fff' }}>
                        <td style={{ padding: 10 }}>
                          {record.isWeekly ? (
                            <button type="button" onClick={() => toggleExpand(record.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}>
                              {isExpanded ? '▼' : '▶'}
                            </button>
                          ) : null}
                        </td>
                        <td style={{ padding: 10 }}>{record.client_name}</td>
                        <td style={{ padding: 10 }}>{record.tradeDate}</td>
                        <td style={{ padding: 10 }}>
                          {record.deliveryDate}
                          {product === 'GTAM' && (
                            <Badge type="success" style={{ display: 'block', marginTop: 4, background: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9', fontSize: 10 }}>
                              Green Power (GTAM)
                            </Badge>
                          )}
                        </td>
                        <td style={{ padding: 10, fontFamily: 'monospace' }}>
                          {record.contract_id ? (
                            <Link to={`/trading/exchange/contracts/${record.contract_id}`}>{record.acceptanceNo}</Link>
                          ) : record.acceptanceNo}
                        </td>
                        <td style={{ padding: 10 }}>{record.exchange}</td>
                        <td style={{ padding: 10 }}>{statusBadge(record.status)}</td>
                        <td style={{ padding: 10, fontWeight: 'bold' }}>{renderVolume(record.energyMUs)}</td>
                        <td style={{ padding: 10, color: '#27ae60', fontWeight: 'bold' }}>{fmtNumber(record.netAmount)}</td>
                        <td style={{ padding: 10 }}>
                          <button type="button" className="btn btn-sm btn-outline" onClick={() => setSelectedTamRecord(record)}>Blocks</button>
                        </td>
                      </tr>
                      {isExpanded && record.children.map((child) => (
                        <tr key={child.id} style={{ background: '#f8f9fc', borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: 10, textAlign: 'right', color: '#aaa' }}>├─</td>
                          <td style={{ padding: 10, color: '#666' }}>{child.client_name}</td>
                          <td style={{ padding: 10, color: '#666' }}>{child.tradeDate}</td>
                          <td style={{ padding: 10, color: '#666' }}>{child.deliveryDate}</td>
                          <td style={{ padding: 10, color: '#666', fontFamily: 'monospace', fontSize: 12 }}>{child.id}</td>
                          <td style={{ padding: 10, color: '#666' }}>{child.exchange}</td>
                          <td style={{ padding: 10 }}>{statusBadge(child.status)}</td>
                          <td style={{ padding: 10, color: '#444' }}>{renderVolume(child.energyMUs)}</td>
                          <td style={{ padding: 10, color: '#444' }}>{fmtNumber(child.netAmount)}</td>
                          <td style={{ padding: 10 }}>
                            <button type="button" className="btn btn-sm btn-outline" onClick={() => setSelectedTamRecord(child)}>Blocks</button>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {selectedTamRecord && (
        <TAMObligationDetailsModal record={selectedTamRecord} product={product} onClose={() => setSelectedTamRecord(null)} />
      )}
    </div>
  );
}
