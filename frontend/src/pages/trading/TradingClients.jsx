import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Table, Badge, Card, Modal, Field } from '../../components/ui.jsx';
import { ROLE_GROUPS } from '../../roles.js';

const CLIENT_TYPES = ['GENERATOR', 'DISCOM', 'TRADER', 'C&I', 'OTHER'];
const RISK_RATINGS = ['LOW', 'MEDIUM', 'HIGH'];
const EMPTY_FORM = {
  name: '', client_type: 'GENERATOR', risk_rating: 'MEDIUM',
  exposure_limit: '', noc_valid_till: '', ppa_ref: '',
};

export default function TradingClients() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.TRADING_WRITE.includes(user.role);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showOnboard, setShowOnboard] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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

  function openOnboard() {
    setForm(EMPTY_FORM);
    setError('');
    setShowOnboard(true);
  }

  async function handleOnboard(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.tradingClients.create({
        name: form.name.trim(),
        client_type: form.client_type,
        risk_rating: form.risk_rating,
        exposure_limit: Number(form.exposure_limit) || 0,
        noc_valid_till: form.noc_valid_till || null,
        ppa_ref: form.ppa_ref || null,
      });
      setShowOnboard(false);
      fetchClients();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to onboard the client.');
    } finally {
      setSaving(false);
    }
  }

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
      <PageHeader
        title="Trading Clients & Counterparties"
        onAdd={canWrite ? openOnboard : undefined}
        addLabel="Onboard Client"
      />
      <Card>
        {loading ? <p>Loading clients...</p> : (
          <Table columns={columns} data={clients} emptyMessage="No clients onboarded yet. Use Onboard Client to add the first counterparty." />
        )}
      </Card>

      {showOnboard && (
        <Modal open={true} onClose={() => setShowOnboard(false)} title="Onboard Trading Client / Counterparty" width={640}>
          <form onSubmit={handleOnboard}>
            {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Client / Counterparty Name" required>
                  <input type="text" className="input" required autoFocus
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Rajasthan Urja Vikas Nigam Ltd" />
                </Field>
              </div>
              <Field label="Type" required>
                <select className="input" value={form.client_type}
                  onChange={(e) => setForm({ ...form, client_type: e.target.value })}>
                  {CLIENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Risk Rating">
                <select className="input" value={form.risk_rating}
                  onChange={(e) => setForm({ ...form, risk_rating: e.target.value })}>
                  {RISK_RATINGS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Exposure Limit (₹)">
                <input type="number" min="0" step="1" className="input"
                  value={form.exposure_limit}
                  onChange={(e) => setForm({ ...form, exposure_limit: e.target.value })}
                  placeholder="e.g. 50000000" />
              </Field>
              <Field label="NOC Valid Till">
                <input type="date" className="input"
                  value={form.noc_valid_till}
                  onChange={(e) => setForm({ ...form, noc_valid_till: e.target.value })} />
              </Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="PPA / Contract Reference">
                  <input type="text" className="input"
                    value={form.ppa_ref}
                    onChange={(e) => setForm({ ...form, ppa_ref: e.target.value })}
                    placeholder="Optional — e.g. PPA/SJVN/2026/014" />
                </Field>
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 10 }}>
              Authorised signatories and exchange registrations are added from the client's profile after onboarding.
            </p>
            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowOnboard(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Onboarding…' : 'Onboard Client'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
