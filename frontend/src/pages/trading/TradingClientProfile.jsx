import React, { useState, useEffect } from 'react';
import WriteOnly from '../../components/WriteOnly.jsx';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { isTradingClientRole, ROLE_GROUPS } from '../../roles.js';
import api from '../../api/client';
import { PageHeader, Card, Table, Badge, Modal } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';
import { fmtDate } from '../../datetime.js';
import { showAlert, askText } from '../../lib/dialogs.js';

export default function TradingClientProfile() {
  const { id: paramId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const isClient = isTradingClientRole(user?.role);
  const id = isClient ? user?.entity_id : paramId;

  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSuspendModal, setShowSuspendModal] = useState(false);

  useEffect(() => {
    if (id) fetchProfile();
    else setLoading(false);
  }, [id]);

  const fetchProfile = () => {
    setLoading(true);
    api.tradingClients.get(id).then(res => {
      setClient(res);
      setLoading(false);
    }).catch(err => {
      showAlert("Failed to load profile");
      setLoading(false);
    });
  };

  const canWrite = ROLE_GROUPS.TRADING_WRITE.includes(user?.role);

  // Pre-payment moves only through this call, so each one carries who and why.
  const handlePrepayment = async () => {
    const amount = Number((await askText('Amount received in ₹ (use a minus sign to take money off):')));
    if (!amount) return;
    const reason = (await askText('Receipt / UTR reference or reason:'));
    if (!reason || !reason.trim()) return;
    api.tradingClients.adjustPrepayment(id, amount, reason.trim())
      .then(setClient)
      .catch((err) => showAlert(err.response?.data?.error || 'Could not update the pre-payment balance'));
  };

  const handleSuspend = () => {
    api.tradingClients.suspend(id, 'Risk limit breached or manual intervention').then(() => {
      setShowSuspendModal(false);
      fetchProfile();
    }).catch(err => {
      showAlert("Failed to suspend client");
    });
  };

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!id) return <div style={{ padding: 24 }}>Invalid Profile ID</div>;
  if (!client) return <div style={{ padding: 24 }}>Client not found</div>;

  return (
    <div style={{ padding: 24 }}>
      <PageHeader 
        title={`Profile: ${client.name}`} 
        actions={
          !isClient && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline" onClick={() => navigate('/trading/clients')}>Back to List</button>
              {client.status === 'ACTIVE' && (
                <WriteOnly><button className="btn btn-outline" style={{ borderColor: 'red', color: 'red' }} onClick={() => setShowSuspendModal(true)}>
                  Suspend Client
                </button></WriteOnly>
              )}
            </div>
          )
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
          <div><strong>Virtual Account No.:</strong> {client.virtual_account_no || <span style={{ color: 'var(--slate-500)' }}>Not set — receipts cannot be matched automatically</span>}</div>
          <div><strong>Credit Limit:</strong> ₹{(client.credit_limit || 0).toLocaleString('en-IN')}</div>
          <div>
            <strong>Pre-payment Balance:</strong> ₹{client.pre_payment_balance.toLocaleString('en-IN')}
            {canWrite && !isClient && (
              <button type="button" className="btn btn-outline" style={{ marginLeft: 10, padding: '2px 10px', fontSize: 13.5 }} onClick={handlePrepayment}>
                Record receipt
              </button>
            )}
          </div>
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
            { key: 'created_at', label: 'Added On', render: r => fmtDate(r.created_at) }
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
            { key: 'created_at', label: 'Added On', render: r => fmtDate(r.created_at) }
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
            <WriteOnly><button className="btn" style={{ background: 'red', color: 'white' }} onClick={handleSuspend}>Suspend Client</button></WriteOnly>
          </div>
        </Modal>
      )}
    </div>
  );
}
