import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';
import { showAlert, askConfirm } from '../../lib/dialogs.js';

// YYYY-MM of this month, and of the one before it — a month is billed once it is over.
const monthOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const thisMonth = () => monthOf(new Date());
const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return monthOf(d); };

export default function GeneratorBilling() {
  const { user } = useAuth();
  // Trading roles reach this page from the Power Trading sidebar, but raising
  // and settling a CERC generator bill stays with REIA — mirror the API guard
  // rather than showing buttons that come back 403.
  // Phase B.2: the maker generates a bill; the checker moves its status on.
  const canWrite = ROLE_GROUPS.REIA_MAKE.includes(user.role);
  const canAdvance = ROLE_GROUPS.REIA_CHECK.includes(user.role);
  const [bills, setBills] = useState([]);
  const [entities, setEntities] = useState([]);
  const [showGenerate, setShowGenerate] = useState(false);
  const [error, setError] = useState('');

  // NJHPS for 2026-27 as the Commercial department gave it (AFC Rs 1,700.8363
  // crore; their ECR of Rs 1.479/kWh is what these terms give). The share and
  // the energy are left blank: they are the beneficiary's, entered for each bill.
  const [form, setForm] = useState({
    station_name: 'Nathpa Jhakri HPS (NJHPS)',
    beneficiary_id: '',
    billing_month: lastMonth(),
    afc: '17008363000',
    napaf: '87',
    actual_paf: '90',
    ex_bus_energy: '',
    design_energy_mu: '6612',
    aux_consumption_pct: '1.2',
    free_energy_pct: '12',
    allocation_pct: '',
    ecr: ''
  });

  // Mirrors the API: ECR comes from AFC and design energy when design energy is
  // known, so the capacity and energy halves always add back to one AFC — spread
  // over the energy that can be sold, net of the station's own consumption and
  // the home state's free power (CERC's ECR formula for a hydro station).
  const AFC_ENERGY_SHARE = 0.5;
  const saleableKwh = Number(form.design_energy_mu) * 1e6
    * (1 - (Number(form.aux_consumption_pct) || 0) / 100)
    * (1 - (Number(form.free_energy_pct) || 0) / 100);
  const derivedEcr = Number(form.design_energy_mu) > 0 && saleableKwh > 0
    ? (Number(form.afc) * AFC_ENERGY_SHARE) / saleableKwh
    : null;

  useEffect(() => {
    loadBills();
    // A station's capacity is billed to the beneficiaries that take its power, never to a generator.
    api.entities.list({ entity_type: 'BUYER' }).then(setEntities).catch(console.error);
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
    if (!(await askConfirm(`Move bill ${bill.bill_no} from ${bill.status} to ${next}?`))) return;
    try {
      await api.generatorBilling.updateStatus(bill.id, next);
      loadBills();
    } catch (err) {
      showAlert(err.response?.data?.error || 'Failed to update bill status.');
    }
  }

  const columns = [
    { key: 'bill_no', label: 'Bill No.' },
    { key: 'station_name', label: 'Station' },
    { key: 'beneficiary_name', label: 'Beneficiary' },
    { key: 'billing_month', label: 'Month' },
    // Bills raised before the share was asked for carried the whole station.
    { key: 'allocation_pct', label: 'Share', render: r => (r.allocation_pct != null ? `${fmtNumber(r.allocation_pct)}%` : '—') },
    { key: 'ecr', label: 'ECR (₹/kWh)', render: r => (
        <div>
          {Number(r.ecr).toFixed(4)}
          <div style={{ fontSize: 14, color: 'var(--slate-500)' }}>
            {r.ecr_source === 'DERIVED_FROM_AFC' ? 'from AFC' : 'entered'}
          </div>
        </div>
      ) },
    { key: 'capacity_charge', label: 'Capacity Charge (₹)', render: r => `₹${fmtNumber(r.capacity_charge)}` },
    { key: 'energy_charge', label: 'Energy Charge (₹)', render: r => `₹${fmtNumber(r.energy_charge)}` },
    { key: 'total_amount', label: 'Total Amount (₹)', render: r => <span style={{fontWeight:'bold'}}>₹{fmtNumber(r.total_amount)}</span> },
    { key: 'status', label: 'Status', render: r => <Badge type={r.status === 'PAID' ? 'success' : 'warning'}>{r.status}</Badge> },
    { key: 'actions', label: '', render: r => (
        canAdvance && NEXT_STATUS[r.status]
          ? <button className="btn btn-outline" style={{ padding: '4px 10px', fontSize: 15 }} onClick={() => handleAdvance(r)}>
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
              <div style={{ gridColumn: '1 / -1', padding: '8px 12px', background: 'var(--t-red-50)', border: '1px solid var(--t-red-line)', borderRadius: 4, color: 'var(--red-deep)', fontSize: 14.5 }}>
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

            <Field label="Billing Month" required>
              <input type="month" max={thisMonth()} className="input" value={form.billing_month} onChange={e => setForm({...form, billing_month: e.target.value})} required />
            </Field>

            <Field label="Annual Fixed Charges (AFC) in ₹" required>
              <input type="number" step="0.01" min="0.01" className="input" value={form.afc} onChange={e => setForm({...form, afc: e.target.value})} required />
            </Field>

            <Field label="Beneficiary's share of the station (%)" required>
              <input type="number" step="0.0001" min="0.0001" max="100" className="input" value={form.allocation_pct} onChange={e => setForm({...form, allocation_pct: e.target.value})} required placeholder="its allocation" />
            </Field>

            <Field label="Normative PAF (NAPAF) %" required>
              <input type="number" step="0.01" min="0.01" max="100" className="input" value={form.napaf} onChange={e => setForm({...form, napaf: e.target.value})} required />
            </Field>

            <Field label="Actual PAF %" required>
              <input type="number" step="0.01" min="0" max="100" className="input" value={form.actual_paf} onChange={e => setForm({...form, actual_paf: e.target.value})} required />
            </Field>

            {/* CERC: energy charges are paid on the energy scheduled to the
                beneficiary in the month, ex-bus — its line in the REA, not the station's output. */}
            <Field label="Energy scheduled to this beneficiary, ex-bus (MWh)" required>
              <input type="number" step="0.001" min="0" className="input" value={form.ex_bus_energy} onChange={e => setForm({...form, ex_bus_energy: e.target.value})} required placeholder="its line in the REA" />
            </Field>

            <Field label="Design Energy (MU / year)">
              <input type="number" step="0.01" min="0" className="input" value={form.design_energy_mu} onChange={e => setForm({...form, design_energy_mu: e.target.value})} placeholder="e.g. 6612" />
            </Field>

            {Number(form.design_energy_mu) > 0 && (
              <>
                <Field label="Auxiliary consumption (%)">
                  <input type="number" step="0.01" min="0" max="99" className="input" value={form.aux_consumption_pct} onChange={e => setForm({...form, aux_consumption_pct: e.target.value})} />
                </Field>
                <Field label="Free energy to home state (%)">
                  <input type="number" step="0.01" min="0" max="99" className="input" value={form.free_energy_pct} onChange={e => setForm({...form, free_energy_pct: e.target.value})} />
                </Field>
              </>
            )}

            <Field label={derivedEcr != null ? 'Energy Charge Rate (ECR) ₹/kWh — derived' : 'Energy Charge Rate (ECR) ₹/kWh'}>
              {derivedEcr != null ? (
                <div>
                  <input type="number" className="input" value={derivedEcr.toFixed(4)} readOnly disabled />
                  <div style={{ fontSize: 14.5, color: 'var(--slate-500)', marginTop: 4 }}>
                    {(AFC_ENERGY_SHARE * 100).toFixed(0)}% of AFC ÷ design energy net of auxiliary consumption and free energy. Clear design energy to type a rate instead.
                  </div>
                </div>
              ) : (
                <input type="number" step="0.001" className="input" value={form.ecr} onChange={e => setForm({...form, ecr: e.target.value})} required />
              )}
            </Field>

            <div style={{ gridColumn: '1 / -1', marginTop: 15, display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 15 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowGenerate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Calculate & Generate Bill</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
