import React, { useState, useEffect } from 'react';
import { PageHeader, Card, Table, Badge, StatCard, fmtNumber, fmtCurrency } from '../../components/ui.jsx';
import api from '../../api/client';

// A missing or non-numeric field must never blank the whole dashboard.
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export default function TradingDashboard() {
  const [activeTab, setActiveTab] = useState('realtime');
  const [health, setHealth] = useState(null);
  const [data, setData] = useState(null);
  // Which tab the payload in `data` belongs to. Each tab returns a completely
  // different shape, so rendering one tab's view against another's data crashes.
  const [dataTab, setDataTab] = useState(null);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState({ rec: {}, noar: {}, formIv: {} });

  useEffect(() => {
    Promise.all([
      api.rec.summary().catch(() => ({})),
      api.noar.summary().catch(() => ({})),
      api.formIv.summary().catch(() => ({})),
    ]).then(([rec, noar, formIv]) => setOverview({ rec, noar, formIv }));
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchData(activeTab);
    const interval = setInterval(() => {
      if (activeTab === 'realtime') fetchData('realtime');
    }, 15000); // refresh realtime every 15s
    return () => clearInterval(interval);
  }, [activeTab]);

  const fetchHealth = () => {
    api.dashboard.trading.health().then(res => setHealth(res)).catch(console.error);
  };

  const fetchData = (tab) => {
    setLoading(true);
    api.dashboard.trading[tab]()
      .then(res => {
        setData(res);
        setDataTab(tab);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setData(null);
        setDataTab(tab);
        setLoading(false);
      });
  };

  const renderHealthBanner = () => {
    if (!health) return null;
    const isOk = health.status === 'ONLINE';
    return (
      <div style={{
        padding: 15, marginBottom: 24, borderRadius: 8,
        backgroundColor: isOk ? '#e3fce8' : '#fff3cd',
        border: `1px solid ${isOk ? '#b7eb8f' : '#ffe58f'}`
      }}>
        <strong style={{ color: isOk ? '#389e0d' : '#d48806' }}>
          {isOk ? `Exchange Integrations Online (Last Sync: ${new Date(health.last_sync).toLocaleTimeString()})` : "Exchange Integration Degradation Detected"}
        </strong>
        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
          {Object.entries(health.exchanges).map(([ex, h]) => (
            <Badge key={ex} type={h.status === 'ONLINE' ? 'success' : 'danger'}>
              {ex}: {h.status} ({h.delay_ms}ms ping)
            </Badge>
          ))}
        </div>
      </div>
    );
  };

  const renderRealtime = () => {
    if (!data) return null;
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20, marginBottom: 24 }}>
          <Card title="Open Bids (Unmatched)">
            <h2 style={{ margin: 0 }}>{num(data.open_positions?.count, 0)}</h2>
            <div style={{ color: '#666', fontSize: 14 }}>/ {num(data.open_positions?.quantum_mw).toFixed(2)} MW</div>
          </Card>
          <Card title="Live Exchange Rates (Mock)">
            <div style={{ display: 'flex', gap: 32 }}>
              {Object.entries(data.live_rates || {}).map(([ex, rate]) => (
                <div key={ex}>
                  <div style={{ color: '#666', fontSize: 14 }}>{ex} (₹/kWh)</div>
                  <h3 style={{ margin: 0, color: '#389e0d' }}>↑ ₹{num(rate).toFixed(2)}</h3>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card title="Client Exposure Limit Utilization" style={{ marginBottom: 24 }}>
          <Table
            data={data.client_limits || []}
            columns={[
              { key: 'name', label: 'Client Name' },
              { key: 'exposure_limit', label: 'Exposure Limit (₹)', render: r => num(r.exposure_limit).toLocaleString('en-IN') },
              { key: 'utilized', label: 'Utilized (₹)', render: r => num(r.utilized).toLocaleString('en-IN') },
              { key: 'perc', label: 'Utilization %', render: r => {
                  const limit = num(r.exposure_limit);
                  const perc = limit > 0 ? (num(r.utilized) / limit) * 100 : 0;
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, height: 8, background: '#eee', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: perc > 90 ? '#cf1322' : '#1890ff', width: `${Math.min(perc, 100)}%` }} />
                      </div>
                      <span style={{ fontSize: 12, color: perc > 90 ? '#cf1322' : '#666' }}>{perc.toFixed(1)}%</span>
                    </div>
                  );
                }
              }
            ]}
          />
        </Card>
      </div>
    );
  };

  const renderDaily = () => {
    if (!data) return null;
    const s = data.daily_summary || {};
    const pnl = data.pnl || {};
    const rejected = data.rejected_analysis || [];
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 20, marginBottom: 24 }}>
          <Card title="Bids Today">
            <h2 style={{ margin: 0 }}>{num(s.totalBids, 0)}</h2>
          </Card>
          <Card title="Cleared Bids">
            <h2 style={{ margin: 0, color: '#1890ff' }}>{num(s.clearedBids, 0)}</h2>
            <div style={{ color: '#666', fontSize: 14 }}>({num(s.clearRatio).toFixed(1)}%)</div>
          </Card>
          <Card title="Quantum Bid (MW)">
            <h2 style={{ margin: 0 }}>{num(s.quantumBid).toFixed(2)}</h2>
          </Card>
          <Card title="Quantum Cleared (MW)">
            <h2 style={{ margin: 0 }}>{num(s.quantumCleared).toFixed(2)}</h2>
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Card title="Today's P&L (₹)">
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#666', fontSize: 14 }}>Realized Margin</div>
              <h2 style={{ margin: 0, color: '#389e0d' }}>₹{num(pnl.realized).toLocaleString('en-IN')}</h2>
            </div>
            <div>
              <div style={{ color: '#666', fontSize: 14 }}>Unrealized Margin (Open Positions)</div>
              <h3 style={{ margin: 0 }}>₹{num(pnl.unrealized).toLocaleString('en-IN')}</h3>
            </div>
          </Card>
          <Card title="Bid Rejection Analysis">
            {rejected.length === 0 ? <p style={{ color: '#389e0d' }}>No rejected bids today.</p> :
              <Table
                data={rejected}
                columns={[
                  { key: 'status', label: 'Reason / Status', render: r => <Badge type="danger">{r.status}</Badge> },
                  { key: 'c', label: 'Count' }
                ]}
              />
            }
          </Card>
        </div>
      </div>
    );
  };

  const renderPeriodic = () => {
    if (!data) return null;
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Card title="Top Clients by Trading Margin (YTD)">
            <Table
              data={data.client_profitability || []}
              columns={[
                { key: 'client_name', label: 'Client' },
                { key: 'total_margin', label: 'Total Margin (₹)', render: r => num(r.total_margin).toLocaleString('en-IN') }
              ]}
            />
          </Card>
          <Card title="Product Mix (Cleared MW)">
            {(data.product_mix || []).length === 0 ? (
              <p style={{ color: '#666' }}>No cleared volume yet.</p>
            ) : (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {(data.product_mix || []).map(p => (
                  <div key={p.product} style={{ width: '45%', padding: 15, border: '1px solid #eee', borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ color: '#666', fontSize: 14, marginBottom: 8 }}>{p.product}</div>
                    <h3 style={{ margin: 0 }}>{num(p.cleared_mw).toFixed(2)} MW</h3>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="Trading Command Center" />
      {renderHealthBanner()}

      {/* SJVN Power Trading overview — REC, Open Access & compliance at a glance */}
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <StatCard label="RECs Traded" value={fmtNumber(overview.rec?.sold_recs || 0, 0)} hint={`${fmtNumber(overview.rec?.total_recs || 0, 0)} total`} tone="green" />
        <StatCard label="Profit from REC" value={fmtCurrency(overview.rec?.profit_from_rec || 0)} tone={(overview.rec?.profit_from_rec || 0) >= 0 ? 'green' : 'red'} />
        <StatCard label="NOAR Wallet Balance" value={fmtCurrency(overview.noar?.balance || 0)} hint={`Charges ${fmtCurrency(overview.noar?.total_charges || 0)}`} tone={(overview.noar?.balance || 0) > 0 ? 'green' : 'amber'} />
        <StatCard label="CERC Form-IV" value={overview.formIv?.latest_status || 'Pending'} hint={`${overview.formIv?.submitted || 0} submitted · ${overview.formIv?.pending || 0} pending`} tone={overview.formIv?.latest_status === 'SUBMITTED' ? 'green' : 'amber'} />
      </div>

      <div style={{ marginBottom: 20, borderBottom: '1px solid #ddd', display: 'flex', gap: 20 }}>
        {['realtime', 'daily', 'periodic'].map(t => (
          <button 
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              padding: '10px 0', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16,
              borderBottom: activeTab === t ? '2px solid #0052cc' : '2px solid transparent',
              color: activeTab === t ? '#0052cc' : '#555', fontWeight: activeTab === t ? 'bold' : 'normal'
            }}
          >
            {t === 'realtime' ? 'Real-Time Intraday' : t === 'daily' ? 'Daily Settlement' : 'Periodic & Trends'}
          </button>
        ))}
      </div>

      {loading || dataTab !== activeTab ? <p>Loading...</p> : (
        activeTab === 'realtime' ? renderRealtime() :
        activeTab === 'daily' ? renderDaily() :
        renderPeriodic()
      )}
    </div>
  );
}
