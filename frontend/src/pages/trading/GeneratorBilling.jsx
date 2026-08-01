import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';

export default function GeneratorBilling() {
  const { user } = useAuth();
  // Trading roles reach this page from the Power Trading sidebar, but raising
  // and settling a CERC generator bill stays with REIA — mirror the API guard
  // rather than showing buttons that come back 403.
  const canWrite = ROLE_GROUPS.REIA_WRITE.includes(user.role);
  const [bills, setBills] = useState([]);
  const [entities, setEntities] = useState([]);
  const [showGenerate, setShowGenerate] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    station_name: 'Nathpa Jhakri HPS (NJHPS)',
    beneficiary_id: '',
    billing_month: '2026-06',
    afc: '14615741000',
    napaf: '87',
    actual_paf: '90',
    ex_bus_energy: '540000',
    design_energy_mu: '6612',
    ecr: ''
  });

  // Mirrors the API: ECR comes from AFC and design energy when design energy is
  // known, so the capacity and energy halves always add back to one AFC.
  const AFC_ENERGY_SHARE = 0.5;
  const derivedEcr = Number(form.design_energy_mu) > 0
    ? (Number(form.afc) * AFC_ENERGY_SHARE) / (Number(form.design_energy_mu) * 1e6)
    : null;

  useEffect(() => {
    loadBills();
    api.entities.list().then(setEntities).catch(console.error);
  }, []);

  function loadBills() {
    api.generatorBilling.list().then(setBills).catch(console.error);
  }

  async function handleGenerate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.generatorBilling.generate(form);
      setShowGenerate(false);
      loadBills();
    } catch (err) {
      // Axios puts the API's own message on err.response.data.error; err.message
      // is only ever the generic "Request failed with status code 400".
      setError(err.response?.data?.error || 'Failed to generate bill.');
    }
  }

  // DRAFT -> FINAL -> PAID. The API accepts nothing else.
  const NEXT_STATUS = { DRAFT: 'FINAL', FINAL: 'PAID' };

  async function handleAdvance(bill) {
    const next = NEXT_STATUS[bill.status];
    if (!next) return;
    if (!window.confirm(`Move bill ${bill.bill_no} from ${bill.status} to ${next}?`)) return;
    try {
      await api.generatorBilling.updateStatus(bill.id, next);
      loadBills();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update bill status.');
    }
  }

  const columns = [
    { key: 'bill_no', label: 'Bill No.' },
    { key: 'station_name', label: 'Station' },
    { key: 'beneficiary_name', label: 'Beneficiary' },
    { key: 'billing_month', label: 'Month' },
    { key: 'ecr', label: 'ECR (₹/kWh)', render: r => (
        <div>
          {Number(r.ecr).toFixed(4)}
          <div style={{ fontSize: 10, color: '#64748b' }}>
            {r.ecr_source === 'DERIVED_FROM_AFC' ? 'from AFC' : 'entered'}
          </div>
        </div>
      ) },
    { key: 'capacity_charge', label: 'Capacity Charge (₹)', render: r => `₹${fmtNumber(r.capacity_charge)}` },
    { key: 'energy_charge', label: 'Energy Charge (₹)', render: r => `₹${fmtNumber(r.energy_charge)}` },
    { key: 'total_amount', label: 'Total Amount (₹)', render: r => <span style={{fontWeight:'bold'}}>₹{fmtNumber(r.total_amount)}</span> },
    { key: 'status', label: 'Status', render: r => <Badge type={r.status === 'PAID' ? 'success' : 'warning'}>{r.status}</Badge> },
    { key: 'actions', label: '', render: r => (
        canWrite && NEXT_STATUS[r.status]
          ? <button className="btn btn-outline" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleAdvance(r)}>
              Mark {NEXT_STATUS[r.status]}
            </button>
          : null
      ) }
  ];

  return (
    <div style={{ padding: 20 }}>
      <PageHeader 
        title="Generator Billing & Settlement (CERC Tariff)" 
        actions={
          canWrite && <button className="btn btn-primary" onClick={() => setShowGenerate(true)}>+ Generate Bill</button>
        }
      />

      <Card>
        <Table columns={columns} data={bills} />
      </Card>

      {showGenerate && (
        <Modal open={true} onClose={() => { setShowGenerate(false); setError(''); }} title="Generate Generator Bill" width={700}>
          <form onSubmit={handleGenerate} style={{ display: 'grid', gap: 15, gridTemplateColumns: '1fr 1fr' }}>
            {error && (
              <div style={{ gridColumn: '1 / -1', padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, color: '#b91c1c', fontSize: 13 }}>
                {error}
              </div>
            )}
            <Field label="Station Name" required>
              <input className="input" value={form.station_name} onChange={e => setForm({...form, station_name: e.target.value})} required />
            </Field>
            
            <Field label="Beneficiary" required>
              <select className="input" value={form.beneficiary_id} onChange={e => setForm({...form, beneficiary_id: e.target.value})} required>
                <option value="">-- Select Beneficiary --</option>
                {entities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>

            <Field label="Billing Month (e.g. June-2026)" required>
              <input className="input" value={form.billing_month} onChange={e => setForm({...form, billing_month: e.target.value})} required />
            </Field>

            <Field label="Annual Fixed Charges (AFC) in ₹" required>
              <input type="number" step="0.01" className="input" value={form.afc} onChange={e => setForm({...form, afc: e.target.value})} required />
            </Field>

            <Field label="Normative PAF (NAPAF) %" required>
              <input type="number" step="0.01" className="input" value={form.napaf} onChange={e => setForm({...form, napaf: e.target.value})} required />
            </Field>

            <Field label="Actual PAF %" required>
              <input type="number" step="0.01" className="input" value={form.actual_paf} onChange={e => setForm({...form, actual_paf: e.target.value})} required />
            </Field>

            <Field label="Ex-bus Saleable Energy (MWh)" required>
              <input type="number" step="0.001" className="input" value={form.ex_bus_energy} onChange={e => setForm({...form, ex_bus_energy: e.target.value})} required />
            </Field>

            <Field label="Design Energy (MU / year)">
              <input type="number" step="0.01" className="input" value={form.design_energy_mu} onChange={e => setForm({...form, design_energy_mu: e.target.value})} placeholder="e.g. 6612" />
            </Field>

            <Field label={derivedEcr != null ? 'Energy Charge Rate (ECR) ₹/kWh — derived' : 'Energy Charge Rate (ECR) ₹/kWh'}>
              {derivedEcr != null ? (
                <div>
                  <input type="number" className="input" value={derivedEcr.toFixed(4)} readOnly disabled />
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                    {(AFC_ENERGY_SHARE * 100).toFixed(0)}% of AFC ÷ design energy. Clear design energy to type a rate instead.
                  </div>
                </div>
              ) : (
                <input type="number" step="0.001" className="input" value={form.ecr} onChange={e => setForm({...form, ecr: e.target.value})} required />
              )}
            </Field>

            <div style={{ gridColumn: '1 / -1', marginTop: 15, display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid #ddd', paddingTop: 15 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowGenerate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Calculate & Generate Bill</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
