import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { PageHeader, Card, Table, Badge, Modal } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';

export default function TradingClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSuspendModal, setShowSuspendModal] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, [id]);

  const fetchProfile = () => {
    setLoading(true);
    api.tradingClients.get(id).then(res => {
      setClient(res);
      setLoading(false);
    }).catch(err => {
      alert("Failed to load profile");
      setLoading(false);
    });
  };

  const handleSuspend = () => {
    api.tradingClients.suspend(id, 'Risk limit breached or manual intervention').then(() => {
      setShowSuspendModal(false);
      fetchProfile();
    }).catch(err => {
      alert("Failed to suspend client");
    });
  };

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!client) return <div style={{ padding: 24 }}>Client not found</div>;

  return (
    <div style={{ padding: 24 }}>
      <PageHeader 
        title={`Profile: ${client.name}`} 
        actions={
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => navigate('/trading/clients')}>Back to List</button>
            {client.status === 'ACTIVE' && (
              <button className="btn btn-outline" style={{ borderColor: 'red', color: 'red' }} onClick={() => setShowSuspendModal(true)}>
                Suspend Client
              </button>
            )}
          </div>
        }
      />

      <Card title="Master & Operational Details" style={{ marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
          <div><strong>Client ID:</strong> {client.id}</div>
          <div><strong>Type:</strong> <Badge>{client.client_type}</Badge></div>
          <div><strong>Status:</strong> <Badge type={client.status === 'ACTIVE' ? 'success' : 'danger'}>{client.status}</Badge></div>
          <div><strong>Risk Rating:</strong> <Badge type={client.risk_rating === 'HIGH' ? 'danger' : client.risk_rating === 'LOW' ? 'success' : 'warning'}>{client.risk_rating}</Badge></div>
          <div><strong>Exposure Limit:</strong> ₹{client.exposure_limit?.toLocaleString('en-IN') || 0}</div>
          <div><strong>NOC Valid Till:</strong> <span style={{ color: new Date(client.noc_valid_till) < new Date() ? 'red' : 'green' }}>{client.noc_valid_till || 'Not Uploaded'}</span></div>
          <div><strong>Pre-payment Balance:</strong> ₹{client.pre_payment_balance.toLocaleString('en-IN')}</div>
          <div><strong>Margin Available:</strong> ₹{client.margin_available.toLocaleString('en-IN')}</div>
          {client.entity_details && (
            <>
              <div><strong>PAN No.:</strong> {client.entity_details.pan_no}</div>
              <div><strong>GST No.:</strong> {client.entity_details.gst_no}</div>
            </>
          )}
        </div>
      </Card>

      <Card title="Authorized Signatories" style={{ marginBottom: 24 }}>
        <Table 
          data={client.signatories || []}
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'designation', label: 'Designation' },
            { key: 'contact_info', label: 'Contact' },
            { key: 'is_active', label: 'Status', render: r => <Badge type={r.is_active ? 'success' : 'danger'}>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
            { key: 'created_at', label: 'Added On', render: r => new Date(r.created_at).toLocaleDateString() }
          ]}
        />
      </Card>

      <Card title="Exchange Memberships">
        <Table 
          data={client.exchanges || []}
          columns={[
            { key: 'exchange', label: 'Exchange', render: r => <Badge type="primary">{r.exchange}</Badge> },
            { key: 'registration_id', label: 'Registration ID' },
            { key: 'is_active', label: 'Status', render: r => <Badge type={r.is_active ? 'success' : 'danger'}>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
            { key: 'created_at', label: 'Added On', render: r => new Date(r.created_at).toLocaleDateString() }
          ]}
        />
      </Card>

      <div style={{ marginBottom: 24 }}>
        <DocumentManager 
          moduleName="TRADING_CLIENTS"
          entityId={client.id} 
          title="Client Documents (KYC, NOC, Agreements)" 
        />
      </div>

      {showSuspendModal && (
        <Modal open={true} onClose={() => setShowSuspendModal(false)} title="Suspend Trading Client" width={400}>
          <div style={{ marginBottom: 20, color: 'red' }}>
            <p><strong>Warning:</strong> Are you sure you want to suspend this client? This will immediately block new bids.</p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => setShowSuspendModal(false)}>Cancel</button>
            <button className="btn" style={{ background: 'red', color: 'white' }} onClick={handleSuspend}>Suspend Client</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
