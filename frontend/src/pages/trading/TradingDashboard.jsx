import React, { useState, useEffect } from 'react';
import { PageHeader, Card, Table, Badge, fmtNumber } from '../../components/ui.jsx';
import api from '../../api/client';

export default function TradingDashboard() {
  const [activeTab, setActiveTab] = useState('realtime');
  const [health, setHealth] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

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
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
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
            <h2 style={{ margin: 0 }}>{data.open_positions.count}</h2>
            <div style={{ color: '#666', fontSize: 14 }}>/ {data.open_positions.quantum_mw.toFixed(2)} MW</div>
          </Card>
          <Card title="Live Exchange Rates (Mock)">
            <div style={{ display: 'flex', gap: 32 }}>
              {Object.entries(data.live_rates).map(([ex, rate]) => (
                <div key={ex}>
                  <div style={{ color: '#666', fontSize: 14 }}>{ex} (₹/kWh)</div>
                  <h3 style={{ margin: 0, color: '#389e0d' }}>↑ ₹{rate.toFixed(2)}</h3>
                </div>
              ))}
            </div>
          </Card>
        </div>
        
        <Card title="Client Exposure Limit Utilization" style={{ marginBottom: 24 }}>
          <Table 
            data={data.client_limits} 
            columns={[
              { key: 'name', label: 'Client Name' },
              { key: 'exposure_limit', label: 'Exposure Limit (₹)', render: r => r.exposure_limit.toLocaleString('en-IN') },
              { key: 'utilized', label: 'Utilized (₹)', render: r => r.utilized.toLocaleString('en-IN') },
              { key: 'perc', label: 'Utilization %', render: r => {
                  const perc = r.exposure_limit > 0 ? (r.utilized / r.exposure_limit) * 100 : 0;
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
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 20, marginBottom: 24 }}>
          <Card title="Bids Today">
            <h2 style={{ margin: 0 }}>{data.daily_summary.totalBids}</h2>
          </Card>
          <Card title="Cleared Bids">
            <h2 style={{ margin: 0, color: '#1890ff' }}>{data.daily_summary.clearedBids}</h2>
            <div style={{ color: '#666', fontSize: 14 }}>({data.daily_summary.clearRatio.toFixed(1)}%)</div>
          </Card>
          <Card title="Quantum Bid (MW)">
            <h2 style={{ margin: 0 }}>{data.daily_summary.quantumBid.toFixed(2)}</h2>
          </Card>
          <Card title="Quantum Cleared (MW)">
            <h2 style={{ margin: 0 }}>{data.daily_summary.quantumCleared.toFixed(2)}</h2>
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Card title="Today's P&L (₹)">
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#666', fontSize: 14 }}>Realized Margin</div>
              <h2 style={{ margin: 0, color: '#389e0d' }}>₹{data.pnl.realized.toLocaleString('en-IN')}</h2>
            </div>
            <div>
              <div style={{ color: '#666', fontSize: 14 }}>Unrealized Margin (Open Positions)</div>
              <h3 style={{ margin: 0 }}>₹{data.pnl.unrealized.toLocaleString('en-IN')}</h3>
            </div>
          </Card>
          <Card title="Bid Rejection Analysis">
            {data.rejected_analysis.length === 0 ? <p style={{ color: '#389e0d' }}>No rejected bids today.</p> : 
              <Table 
                data={data.rejected_analysis} 
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
              data={data.client_profitability} 
              columns={[
                { key: 'client_name', label: 'Client' },
                { key: 'total_margin', label: 'Total Margin (₹)', render: r => r.total_margin.toLocaleString('en-IN') }
              ]}
            />
          </Card>
          <Card title="Product Mix (Cleared MW)">
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {data.product_mix.map(p => (
                <div key={p.product} style={{ width: '45%', padding: 15, border: '1px solid #eee', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ color: '#666', fontSize: 14, marginBottom: 8 }}>{p.product}</div>
                  <h3 style={{ margin: 0 }}>{p.cleared_mw.toFixed(2)} MW</h3>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="Trading Command Center" />
      {renderHealthBanner()}
      
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

      {loading ? <p>Loading...</p> : (
        activeTab === 'realtime' ? renderRealtime() :
        activeTab === 'daily' ? renderDaily() :
        renderPeriodic()
      )}
    </div>
  );
}
