import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';
import { ROLE_GROUPS } from '../../roles.js';

const EMPTY_FORM = { seller_id: '', start_date: '', end_date: '', quantum_mw: '', expected_tariff: '' };

/** MW still uncommitted — only CONFIRMED consents hold capacity, same rule as the API. */
const remainingMw = (av) => av.quantum_mw - (av.consents || [])
  .filter((c) => c.status === 'CONFIRMED')
  .reduce((sum, c) => sum + Number(c.quantum_mw || 0), 0);

export default function PreTradeBoard() {
  const { user } = useAuth();
  const [availabilities, setAvailabilities] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [consentTarget, setConsentTarget] = useState(null); // The availability being consented to
  const [consentForm, setConsentForm] = useState({ quantum_mw: '', offered_tariff: '', buyer_id: '' });

  // Must match the API's TRADING_WRITE — 'TRADING_DEPT' is not a role this
  // platform issues, so every write control on this page rendered for nobody.
  const isTRADING = ROLE_GROUPS.TRADING_WRITE.includes(user.role);
  const isSeller = user.role === 'SELLER';
  const isBuyer = user.role === 'BUYER';
  
  // Optional client filtering based on role
  // Seller should see their own availabilities. Buyer sees all.
  
  function load() {
    setLoading(true);
    let params = {};
    if (isSeller && user.linked_entity_id) {
       // Ideally we match user.linked_entity_id to a trading client id, 
       // but assuming we fetch all for demo or backend filters it.
       // Actually, we'll fetch all and filter in frontend if needed, or backend can.
    }
    api.preTrade.availabilities(params)
      .then(setAvailabilities)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);
  
  useEffect(() => {
    // If TRADING or Admin, get all clients. If BUYER/SELLER, we need their trading client ID.
    // For simplicity, we just fetch active trading clients to pick from.
    api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => {});
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!form.seller_id) {
      setError('Select the seller client this availability belongs to.');
      return;
    }

    try {
      await api.preTrade.declareAvailability({
        seller_id: form.seller_id,
        start_date: form.start_date,
        end_date: form.end_date,
        quantum_mw: Number(form.quantum_mw),
        expected_tariff: Number(form.expected_tariff) || null
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to declare availability.');
    }
  }

  async function handleConsentSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      // No silent fallback to clients[0] — that would file a consent under the
      // wrong company. The select is required, so a buyer is always chosen.
      const buyerId = consentForm.buyer_id
        || (isBuyer ? clients.find(c => c.entity_id === user.linked_entity_id)?.id : '');
      if (!buyerId) {
        setError('Select the buyer client submitting this consent.');
        return;
      }

      await api.preTrade.submitConsent(consentTarget.id, {
        buyer_id: buyerId,
        quantum_mw: Number(consentForm.quantum_mw),
        offered_tariff: Number(consentForm.offered_tariff) || null
      });
      setConsentTarget(null);
      setConsentForm({ quantum_mw: '', offered_tariff: '', buyer_id: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit consent.');
    }
  }

  async function handleActionConsent(consentId, action) {
    if (!window.confirm(`Are you sure you want to ${action} this consent?`)) return;
    try {
      if (action === 'confirm') {
        await api.preTrade.confirmConsent(consentId);
      } else {
        await api.preTrade.rejectConsent(consentId);
      }
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to process consent action.');
    }
  }

  const getStatusColor = (status) => {
    switch(status) {
      case 'OPEN': return '#10b981'; // Green
      case 'PARTIALLY_BOOKED': return '#f59e0b'; // Amber
      case 'FULLY_BOOKED': return '#3b82f6'; // Blue
      case 'CANCELLED': return '#64748b'; // Slate
      default: return '#6b7280';
    }
  };

  return (
    <div>
      <PageHeader
        title="Pre-Trade Board"
        description="Seller Availability & Buyer Consents"
        actions={
          (isTRADING || isSeller) && (
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              Declare Availability
            </button>
          )
        }
      />

      <Card>
        <Table
          loading={loading}
          columns={[
            { key: 'seller', header: 'Seller', render: (r) => r.seller_name || r.seller_id },
            { key: 'period', header: 'Period', render: (r) => `${r.start_date} to ${r.end_date}` },
            { key: 'available_mw', header: 'Available MW', render: (r) => {
                const left = remainingMw(r);
                return (
                  <div>
                    <strong>{fmtNumber(left)} MW</strong>
                    {left !== r.quantum_mw && (
                      <div style={{ fontSize: 11, color: '#64748b' }}>of {fmtNumber(r.quantum_mw)} declared</div>
                    )}
                  </div>
                );
            } },
            { key: 'tariff', header: 'Expected Tariff (₹)', render: (r) => r.expected_tariff || '—' },
            { key: 'status', header: 'Status', render: (r) => (
                <Badge color={getStatusColor(r.status)}>{r.status}</Badge>
            ) },
            { key: 'consents', header: 'Consents', render: (r) => {
                if (!r.consents || r.consents.length === 0) return <span style={{ color: '#94a3b8' }}>None</span>;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {r.consents.map(c => (
                      <div key={c.id} style={{ fontSize: 12, border: '1px solid #e2e8f0', padding: '4px 8px', borderRadius: 4, background: '#f8fafc' }}>
                        <div><strong>{c.buyer_name}</strong>: {c.quantum_mw} MW @ ₹{c.offered_tariff || r.expected_tariff}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                           <Badge color={c.status === 'CONFIRMED' ? '#10b981' : c.status === 'REJECTED' ? '#ef4444' : '#f59e0b'}>{c.status}</Badge>
                           {c.status === 'PENDING' && (isTRADING || isSeller) && (
                             <div style={{ display: 'flex', gap: 4 }}>
                                <button style={{ fontSize: 10, padding: '2px 4px', cursor: 'pointer', background: '#10b981', color: '#fff', border: 'none', borderRadius: 2 }} onClick={() => handleActionConsent(c.id, 'confirm')}>Confirm</button>
                                <button style={{ fontSize: 10, padding: '2px 4px', cursor: 'pointer', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 2 }} onClick={() => handleActionConsent(c.id, 'reject')}>Reject</button>
                             </div>
                           )}
                           {c.status === 'CONFIRMED' && c.linked_transaction_id && (
                               <span style={{ fontSize: 10, color: '#3b82f6' }}>Tx: {c.linked_transaction_id}</span>
                           )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
            } },
            { key: 'actions', header: 'Actions', render: (r) => (
               (isBuyer || isTRADING) && (r.status === 'OPEN' || r.status === 'PARTIALLY_BOOKED') ? (
                  <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setConsentTarget(r)}>
                    Submit Consent
                  </button>
               ) : null
            ) }
          ]}
          data={availabilities}
        />
      </Card>

      {/* Declare Availability Modal */}
      {showCreate && (
        <Modal open onClose={() => { setShowCreate(false); setError(''); }} title="Declare Power Availability">
          <form onSubmit={handleCreate}>
            {error && <div style={{ color: '#dc2626', marginBottom: 16 }}>{error}</div>}
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <Field label="Seller Client">
                <select
                  value={form.seller_id}
                  onChange={(e) => setForm({ ...form, seller_id: e.target.value })}
                  required
                >
                  <option value="">Select Seller</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.client_type})</option>
                  ))}
                </select>
              </Field>
              <div />
              
              <Field label="Start Date">
                <input type="date" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} required />
              </Field>
              <Field label="End Date">
                <input type="date" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} required />
              </Field>
              
              <Field label="Quantum (MW)">
                <input type="number" step="0.01" min="0" value={form.quantum_mw} onChange={e => setForm({...form, quantum_mw: e.target.value})} required />
              </Field>
              <Field label="Expected Tariff (₹/unit) [Optional]">
                <input type="number" step="0.01" value={form.expected_tariff} onChange={e => setForm({...form, expected_tariff: e.target.value})} />
              </Field>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Declare Availability</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Submit Consent Modal */}
      {consentTarget && (
        <Modal open onClose={() => { setConsentTarget(null); setError(''); }} title={`Submit Consent to ${consentTarget.seller_name}`}>
          <div style={{ marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 6, fontSize: 14 }}>
             <div><strong>Available Period:</strong> {consentTarget.start_date} to {consentTarget.end_date}</div>
             <div>
               <strong>Uncommitted MW:</strong> {fmtNumber(remainingMw(consentTarget))} MW
               <span style={{ color: '#64748b' }}> (of {fmtNumber(consentTarget.quantum_mw)} MW declared)</span>
             </div>
             <div><strong>Expected Tariff:</strong> {consentTarget.expected_tariff ? `₹${consentTarget.expected_tariff}` : 'Not specified'}</div>
          </div>
          
          <form onSubmit={handleConsentSubmit}>
            {error && <div style={{ color: '#dc2626', marginBottom: 16 }}>{error}</div>}
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, marginBottom: 16 }}>
              <Field label="Buyer Client (Your entity)">
                <select
                  value={consentForm.buyer_id}
                  onChange={(e) => setConsentForm({ ...consentForm, buyer_id: e.target.value })}
                  required
                >
                  <option value="">Select Buyer Client</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
              <Field label={`Required Quantum (MW) — max ${fmtNumber(remainingMw(consentTarget))}`}>
                <input type="number" step="0.01" min="0" max={remainingMw(consentTarget)} value={consentForm.quantum_mw} onChange={e => setConsentForm({...consentForm, quantum_mw: e.target.value})} required />
              </Field>
              <Field label="Offered Tariff (₹/unit)">
                <input type="number" step="0.01" value={consentForm.offered_tariff} onChange={e => setConsentForm({...consentForm, offered_tariff: e.target.value})} placeholder={consentTarget.expected_tariff || 'Enter tariff'} />
              </Field>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button type="button" className="btn-secondary" onClick={() => setConsentTarget(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Submit Consent</button>
            </div>
          </form>
        </Modal>
      )}

    </div>
  );
}
