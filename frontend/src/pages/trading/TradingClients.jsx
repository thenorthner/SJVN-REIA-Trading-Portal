import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { PageHeader, Table, Badge, Card } from '../../components/ui.jsx';

export default function TradingClients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = () => {
    setLoading(true);
    api.tradingClients.list().then(res => {
      setClients(res);
      setLoading(false);
    }).catch(console.error);
  };

  const getRiskColor = (rating) => {
    switch (rating) {
      case 'LOW': return 'success';
      case 'MEDIUM': return 'warning';
      case 'HIGH': return 'danger';
      default: return 'neutral';
    }
  };

  const columns = [
    { key: 'name', label: 'Client Name', render: r => <Link to={`/trading/clients/${r.id}`} style={{color: '#0052cc', fontWeight: 'bold'}}>{r.name}</Link> },
    { key: 'client_type', label: 'Type', render: r => <Badge>{r.client_type}</Badge> },
    { key: 'risk_rating', label: 'Risk Rating', render: r => <Badge type={getRiskColor(r.risk_rating)}>{r.risk_rating}</Badge> },
    { key: 'exposure_limit', label: 'Exposure Limit (₹)', render: r => r.exposure_limit.toLocaleString('en-IN') },
    { 
      key: 'noc_valid_till', 
      label: 'NOC Validity', 
      render: r => {
        if (!r.noc_valid_till) return 'N/A';
        const isExpiring = new Date(r.noc_valid_till) < new Date(Date.now() + 30*24*60*60*1000);
        return <span style={{ color: isExpiring ? '#cf1322' : '#389e0d' }}>{r.noc_valid_till} {isExpiring && '(Expiring Soon)'}</span>;
      }
    },
    { key: 'status', label: 'Status', render: r => <Badge type={r.status === 'ACTIVE' ? 'success' : 'danger'}>{r.status}</Badge> },
    { 
      key: 'actions', 
      label: 'Actions',
      render: r => (
        <Link to={`/trading/clients/${r.id}`}>
          <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: 12 }}>View Profile</button>
        </Link>
      )
    }
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="Trading Clients & Counterparties" />
      <Card>
        {loading ? <p>Loading clients...</p> : <Table columns={columns} data={clients} />}
      </Card>
    </div>
  );
}
