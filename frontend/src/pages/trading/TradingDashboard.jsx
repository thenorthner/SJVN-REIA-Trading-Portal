import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Table, Typography, Tag, Progress, Tabs, Alert } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, AlertOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import api from '../../api/client';

const { Title, Text } = Typography;

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
    api.dashboard.trading.health().then(res => setHealth(res.data)).catch(console.error);
  };

  const fetchData = (tab) => {
    setLoading(true);
    api.dashboard.trading[tab]()
      .then(res => {
        setData(res.data);
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
      <Alert
        message={isOk ? `Exchange Integrations Online (Last Sync: ${new Date(health.last_sync).toLocaleTimeString()})` : "Exchange Integration Degradation Detected"}
        description={
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            {Object.entries(health.exchanges).map(([ex, h]) => (
              <Tag key={ex} color={h.status === 'ONLINE' ? 'success' : 'error'}>
                {ex}: {h.status} ({h.delay_ms}ms ping)
              </Tag>
            ))}
          </div>
        }
        type={isOk ? "success" : "warning"}
        showIcon
        icon={isOk ? <SafetyCertificateOutlined /> : <AlertOutlined />}
        style={{ marginBottom: 24 }}
      />
    );
  };

  const renderRealtime = () => {
    if (!data) return null;
    return (
      <div>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={8}>
            <Card>
              <Statistic title="Open Bids (Unmatched)" value={data.open_positions.count} suffix={`/ ${data.open_positions.quantum_mw.toFixed(2)} MW`} />
            </Card>
          </Col>
          <Col span={16}>
            <Card title="Live Exchange Rates (Mock)">
              <div style={{ display: 'flex', gap: 32 }}>
                {Object.entries(data.live_rates).map(([ex, rate]) => (
                  <Statistic key={ex} title={`${ex} (₹/kWh)`} value={rate} precision={2} valueStyle={{ color: '#3f8600' }} prefix={<ArrowUpOutlined />} />
                ))}
              </div>
            </Card>
          </Col>
        </Row>
        
        <Card title="Client Exposure Limit Utilization" style={{ marginBottom: 24 }}>
          <Table 
            dataSource={data.client_limits} 
            rowKey="name" 
            pagination={false}
            columns={[
              { title: 'Client Name', dataIndex: 'name' },
              { title: 'Exposure Limit (₹)', dataIndex: 'exposure_limit', render: val => val.toLocaleString('en-IN') },
              { title: 'Utilized (₹)', dataIndex: 'utilized', render: val => val.toLocaleString('en-IN') },
              { title: 'Utilization %', key: 'perc', render: (_, r) => {
                  const perc = r.exposure_limit > 0 ? (r.utilized / r.exposure_limit) * 100 : 0;
                  return <Progress percent={perc.toFixed(1)} status={perc > 90 ? 'exception' : 'active'} />;
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
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card><Statistic title="Bids Today" value={data.daily_summary.totalBids} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="Cleared Bids" value={data.daily_summary.clearedBids} suffix={`(${data.daily_summary.clearRatio.toFixed(1)}%)`} valueStyle={{ color: '#1890ff' }} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="Quantum Bid (MW)" value={data.daily_summary.quantumBid.toFixed(2)} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="Quantum Cleared (MW)" value={data.daily_summary.quantumCleared.toFixed(2)} /></Card>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Card title="Today's P&L (₹)">
              <Statistic title="Realized Margin" value={data.pnl.realized.toLocaleString('en-IN')} valueStyle={{ color: '#3f8600' }} />
              <Statistic title="Unrealized Margin (Open Positions)" value={data.pnl.unrealized.toLocaleString('en-IN')} style={{ marginTop: 16 }} />
            </Card>
          </Col>
          <Col span={12}>
            <Card title="Bid Rejection Analysis">
              {data.rejected_analysis.length === 0 ? <Text type="success">No rejected bids today.</Text> : 
                <Table 
                  dataSource={data.rejected_analysis} 
                  rowKey="status" 
                  pagination={false}
                  columns={[
                    { title: 'Reason / Status', dataIndex: 'status', render: s => <Tag color="error">{s}</Tag> },
                    { title: 'Count', dataIndex: 'c' }
                  ]}
                />
              }
            </Card>
          </Col>
        </Row>
      </div>
    );
  };

  const renderPeriodic = () => {
    if (!data) return null;
    return (
      <div>
        <Row gutter={16}>
          <Col span={12}>
            <Card title="Top Clients by Trading Margin (YTD)">
              <Table 
                dataSource={data.client_profitability} 
                rowKey="client_name" 
                pagination={false}
                columns={[
                  { title: 'Client', dataIndex: 'client_name' },
                  { title: 'Total Margin (₹)', dataIndex: 'total_margin', render: val => val.toLocaleString('en-IN') }
                ]}
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card title="Product Mix (Cleared MW)">
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {data.product_mix.map(p => (
                  <Card.Grid key={p.product} style={{ width: '50%', textAlign: 'center' }}>
                    <Statistic title={p.product} value={p.cleared_mw.toFixed(2)} suffix="MW" />
                  </Card.Grid>
                ))}
              </div>
            </Card>
          </Col>
        </Row>
      </div>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>Trading Command Center</Title>
      {renderHealthBanner()}
      
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        type="card"
        items={[
          { key: 'realtime', label: 'Real-Time Intraday', children: loading ? <p>Loading...</p> : renderRealtime() },
          { key: 'daily', label: 'Daily Settlement', children: loading ? <p>Loading...</p> : renderDaily() },
          { key: 'periodic', label: 'Periodic & Trends', children: loading ? <p>Loading...</p> : renderPeriodic() },
        ]}
      />
    </div>
  );
}
