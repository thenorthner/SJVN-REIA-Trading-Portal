import React, { useState, useEffect } from 'react';
import { Table, Button, Space, Tag, Typography, Progress, Badge } from 'antd';
import { Link } from 'react-router-dom';
import api from '../../api/client';

const { Title, Text } = Typography;

export default function TradingClients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = () => {
    setLoading(true);
    api.tradingClients.list().then(res => {
      setClients(res.data);
      setLoading(false);
    }).catch(console.error);
  };

  const getRiskColor = (rating) => {
    switch (rating) {
      case 'LOW': return 'success';
      case 'MEDIUM': return 'warning';
      case 'HIGH': return 'error';
      default: return 'default';
    }
  };

  const columns = [
    { title: 'Client Name', dataIndex: 'name', render: (val, r) => <Link to={`/trading/clients/${r.id}`}>{val}</Link> },
    { title: 'Type', dataIndex: 'client_type', render: val => <Tag>{val}</Tag> },
    { title: 'Risk Rating', dataIndex: 'risk_rating', render: val => <Badge status={getRiskColor(val)} text={val} /> },
    { 
      title: 'Exposure Limit (₹)', 
      dataIndex: 'exposure_limit', 
      render: val => val.toLocaleString('en-IN') 
    },
    { 
      title: 'NOC Validity', 
      dataIndex: 'noc_valid_till', 
      render: val => {
        if (!val) return 'N/A';
        const isExpiring = new Date(val) < new Date(Date.now() + 30*24*60*60*1000);
        return <Text type={isExpiring ? 'danger' : 'success'}>{val} {isExpiring && '(Expiring Soon)'}</Text>;
      }
    },
    { title: 'Status', dataIndex: 'status', render: val => <Tag color={val === 'ACTIVE' ? 'green' : 'red'}>{val}</Tag> },
    { 
      title: 'Actions', 
      key: 'actions',
      render: (_, r) => (
        <Space>
          <Link to={`/trading/clients/${r.id}`}>
            <Button size="small" type="primary">View Profile</Button>
          </Link>
        </Space>
      )
    }
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3}>Trading Clients & Counterparties</Title>
        <Button type="primary">Onboard New Client</Button>
      </div>
      <Table 
        dataSource={clients} 
        columns={columns} 
        rowKey="id" 
        loading={loading}
      />
    </div>
  );
}
