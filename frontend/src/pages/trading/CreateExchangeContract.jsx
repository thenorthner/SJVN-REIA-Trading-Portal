import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { PageHeader, Card, Field } from '../../components/ui.jsx';

/** 15-minute block labels matching ISET hour dropdowns (00:00 … 23:45). */
const TIME_BLOCKS = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0');
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h}:${m}`;
});

const EMPTY_SCHEDULE_ROW = () => ({
  id: Date.now() + Math.random(),
  date_from: '',
  date_to: '',
  time_from: '00:00',
  time_to: '00:15',
  rate_type: '',
  rate: '',
  quantum: '',
  variation: '',
});

const EMPTY_FORM = {
  contract_type: 'Exchange',
  portfolio_id: '',
  loa_no: '',
  ppa_no: '',
  start_date: '',
  end_date: '',
  compensation: '',
  late_payment_surcharge: '',
  rebate: '',
  side: '',
  carry_over: '',
  client_id: '',
  client_name: '',
  concerned_sldc: '',
  region: '',
  product: '',
  bidding_type: '',
  is_renewable: '',
  schedule_details: [EMPTY_SCHEDULE_ROW()],
  billing_type: '',
  bank_guarantee: '',
  bank_guarantee_validity: '',
  client_registration_fee: '',
  trading_margin: '',
  application_fee: '',
  remarks: '',
};

function FormSection({ title, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="form-section-header">{title}</div>
      {children}
    </div>
  );
}

export default function CreateExchangeContract() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => setClients([]));
  }, []);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function onClientChange(clientId) {
    const client = clients.find((c) => c.id === clientId);
    setForm((prev) => ({
      ...prev,
      client_id: clientId,
      client_name: client?.name || '',
      concerned_sldc: client?.sldc_name || '',
      region: client?.region || client?.noar_region || '',
    }));
  }

  function addScheduleRow() {
    setForm((prev) => ({
      ...prev,
      schedule_details: [...prev.schedule_details, EMPTY_SCHEDULE_ROW()],
    }));
  }

  function removeScheduleRow(index) {
    setForm((prev) => {
      if (prev.schedule_details.length === 1) return prev;
      const next = [...prev.schedule_details];
      next.splice(index, 1);
      return { ...prev, schedule_details: next };
    });
  }

  function updateScheduleRow(index, field, value) {
    setForm((prev) => {
      const next = [...prev.schedule_details];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, schedule_details: next };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(null);
    setBusy(true);
    try {
      const created = await api.exchangeContracts.create(form);
      setSuccess(created);
      setForm({ ...EMPTY_FORM, schedule_details: [EMPTY_SCHEDULE_ROW()] });
      navigate(`/trading/exchange/contracts/${created.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create exchange contract.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <PageHeader
        title="Create Exchange Contract"
        subtitle="Exchange Power Trading — contract, application, schedule and charges"
        actions={
          <button type="button" className="btn btn-outline" onClick={() => navigate('/trading/exchange/contracts')}>
            Contracts Summary
          </button>
        }
      />

      <Card>
        <form onSubmit={handleSubmit}>
          <FormSection title="Contract Details">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
              <Field label="Contract Type" required>
                <input type="text" className="input" value={form.contract_type} disabled />
              </Field>
              <Field label="Portfolio Id" required>
                <input
                  type="text"
                  className="input"
                  value={form.portfolio_id}
                  onChange={(e) => set('portfolio_id', e.target.value)}
                  placeholder="e.g. N1HP0PTC0850"
                  required
                />
              </Field>
              <Field label="LoA/Contract No" required>
                <input type="text" className="input" value={form.loa_no} onChange={(e) => set('loa_no', e.target.value)} required />
              </Field>
              <Field label="PPA No/MOU No" required>
                <input type="text" className="input" value={form.ppa_no} onChange={(e) => set('ppa_no', e.target.value)} required />
              </Field>
              <Field label="Start Date Of Contract" required>
                <input type="date" className="input" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} required />
              </Field>
              <Field label="End Date Of Contract" required>
                <input type="date" className="input" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} required />
              </Field>
              <Field label="Compensation(%)" required>
                <input type="number" step="any" className="input" value={form.compensation} onChange={(e) => set('compensation', e.target.value)} required />
              </Field>
              <Field label="Late Payment Surcharge(LPS)(%)" required>
                <input type="number" step="any" className="input" value={form.late_payment_surcharge} onChange={(e) => set('late_payment_surcharge', e.target.value)} required />
              </Field>
              <Field label="Rebate(%)" required>
                <input type="number" step="any" className="input" value={form.rebate} onChange={(e) => set('rebate', e.target.value)} required />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Application Details">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
              <Field label="Buyer/Seller?" required>
                <div style={{ display: 'flex', gap: 16, height: 36, alignItems: 'center' }}>
                  {['Buyer', 'Seller'].map((opt) => (
                    <label key={opt} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                      <input type="radio" name="side" checked={form.side === opt} onChange={() => set('side', opt)} required />
                      {opt}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="CarryOver" required>
                <div style={{ display: 'flex', gap: 16, height: 36, alignItems: 'center' }}>
                  {['Yes', 'No'].map((opt) => (
                    <label key={opt} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                      <input type="radio" name="carry_over" checked={form.carry_over === opt} onChange={() => set('carry_over', opt)} required />
                      {opt}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Client Name" required>
                <select className="input" value={form.client_id} onChange={(e) => onClientChange(e.target.value)} required>
                  <option value="">Select client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Concerned SLDC" required>
                <input type="text" className="input" value={form.concerned_sldc} disabled style={{ background: '#f1f5f9' }} />
              </Field>
              <Field label="Region" required>
                <input type="text" className="input" value={form.region} disabled style={{ background: '#f1f5f9' }} />
              </Field>
              <Field label="Product" required>
                <select className="input" value={form.product} onChange={(e) => set('product', e.target.value)} required>
                  <option value="">Select</option>
                  {['DAM', 'RTM', 'GDAM', 'GTAM', 'TAM', 'Intra Day', 'Contingency'].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field label="Bidding Type" required>
                <select className="input" value={form.bidding_type} onChange={(e) => set('bidding_type', e.target.value)} required>
                  <option value="">Select</option>
                  {['Single Bid', 'Block Bid', 'Linked Bid'].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field label="Is source of energy renewable?" required>
                <div style={{ display: 'flex', gap: 16, height: 36, alignItems: 'center' }}>
                  {['Yes', 'No'].map((opt) => (
                    <label key={opt} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                      <input type="radio" name="is_renewable" checked={form.is_renewable === opt} onChange={() => set('is_renewable', opt)} required />
                      {opt}
                    </label>
                  ))}
                </div>
              </Field>
            </div>
          </FormSection>

          <FormSection title="Requested Schedule Details">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <tr>
                    <th colSpan="2" style={{ padding: 8, borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>Date</th>
                    <th colSpan="2" style={{ padding: 8, borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>Hours</th>
                    <th style={{ padding: 8 }}>Rate Type</th>
                    <th style={{ padding: 8 }}>Rate (INR/MWh) *</th>
                    <th style={{ padding: 8 }}>Quantum (MW) *</th>
                    <th style={{ padding: 8 }}>Variation</th>
                    <th style={{ padding: 8, width: 70, textAlign: 'center' }}>Action</th>
                  </tr>
                  <tr style={{ color: 'var(--slate-500)', fontWeight: 'normal', fontSize: 11 }}>
                    <th style={{ padding: '4px 8px' }}>From *</th>
                    <th style={{ padding: '4px 8px', borderRight: '1px solid #e2e8f0' }}>To *</th>
                    <th style={{ padding: '4px 8px' }}>From *</th>
                    <th style={{ padding: '4px 8px', borderRight: '1px solid #e2e8f0' }}>To *</th>
                    <th /><th /><th /><th />
                    <th style={{ textAlign: 'center' }}>
                      <button type="button" className="btn btn-sm" style={{ padding: '2px 8px', background: '#16a34a', color: '#fff', border: 'none' }} onClick={addScheduleRow}>+</button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {form.schedule_details.map((row, idx) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: 4 }}>
                        <input type="date" className="input" style={{ width: 130, padding: 4 }} value={row.date_from} onChange={(e) => updateScheduleRow(idx, 'date_from', e.target.value)} required />
                      </td>
                      <td style={{ padding: 4, borderRight: '1px solid #e2e8f0' }}>
                        <input type="date" className="input" style={{ width: 130, padding: 4 }} value={row.date_to} onChange={(e) => updateScheduleRow(idx, 'date_to', e.target.value)} required />
                      </td>
                      <td style={{ padding: 4 }}>
                        <select className="input" style={{ width: 90, padding: 4 }} value={row.time_from} onChange={(e) => updateScheduleRow(idx, 'time_from', e.target.value)} required>
                          {TIME_BLOCKS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: 4, borderRight: '1px solid #e2e8f0' }}>
                        <select className="input" style={{ width: 90, padding: 4 }} value={row.time_to} onChange={(e) => updateScheduleRow(idx, 'time_to', e.target.value)} required>
                          {TIME_BLOCKS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: 4 }}>
                        <select className="input" style={{ padding: 4 }} value={row.rate_type} onChange={(e) => updateScheduleRow(idx, 'rate_type', e.target.value)}>
                          <option value="">select</option>
                          <option value="Fixed">Fixed</option>
                          <option value="Variable">Variable</option>
                        </select>
                      </td>
                      <td style={{ padding: 4 }}>
                        <input type="number" step="any" className="input" style={{ padding: 4 }} value={row.rate} onChange={(e) => updateScheduleRow(idx, 'rate', e.target.value)} required />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input type="number" step="any" className="input" style={{ padding: 4 }} value={row.quantum} onChange={(e) => updateScheduleRow(idx, 'quantum', e.target.value)} required />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input type="text" className="input" style={{ padding: 4 }} value={row.variation} onChange={(e) => updateScheduleRow(idx, 'variation', e.target.value)} />
                      </td>
                      <td style={{ padding: 4, textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn btn-sm" style={{ padding: '2px 8px', marginRight: 4, background: '#16a34a', color: '#fff', border: 'none' }} onClick={addScheduleRow}>+</button>
                        <button type="button" className="btn btn-sm" style={{ padding: '2px 8px', background: '#dc2626', color: '#fff', border: 'none' }} onClick={() => removeScheduleRow(idx)} aria-label="Remove row">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>

          <FormSection title="Billing Cycle">
            <Field label="Billing Type" required>
              <select className="input" value={form.billing_type} onChange={(e) => set('billing_type', e.target.value)} required>
                <option value="">Select</option>
                <option value="Weekly">Weekly</option>
                <option value="Fortnightly">Fortnightly</option>
                <option value="Monthly">Monthly</option>
              </select>
            </Field>
          </FormSection>

          <FormSection title="Fee and Charges">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
              <Field label="Bank Guarantee (Rs.)" required>
                <input type="number" step="any" className="input" value={form.bank_guarantee} onChange={(e) => set('bank_guarantee', e.target.value)} required />
              </Field>
              <Field label="Bank Guarantee Validity Period" required>
                <input type="date" className="input" value={form.bank_guarantee_validity} onChange={(e) => set('bank_guarantee_validity', e.target.value)} required />
              </Field>
              <Field label="Client Registration Fee (Rs.)" required>
                <input type="number" step="any" className="input" value={form.client_registration_fee} onChange={(e) => set('client_registration_fee', e.target.value)} required />
              </Field>
              <Field label="Trading Margin (Rs./KWh)" required>
                <input type="number" step="any" className="input" value={form.trading_margin} onChange={(e) => set('trading_margin', e.target.value)} required />
              </Field>
              <Field label="Application Fee" required>
                <input type="number" step="any" className="input" placeholder="Application Charges" value={form.application_fee} onChange={(e) => set('application_fee', e.target.value)} required />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Remarks">
            <Field label="Remarks" required>
              <textarea className="input" rows={3} placeholder="remarks" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} required />
            </Field>
          </FormSection>

          {error && (
            <div style={{ color: '#991b1b', marginBottom: 12, background: '#fee2e2', padding: 10, borderRadius: 4, fontSize: 13 }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{ color: '#166534', marginBottom: 12, background: '#dcfce7', padding: 10, borderRadius: 4, fontSize: 13 }}>
              Exchange contract <strong>{success.id}</strong> created for {success.client_name} ({success.product}).
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, position: 'sticky', bottom: 0, background: '#fff', padding: '16px 0', borderTop: '1px solid #e2e8f0' }}>
            <button type="button" className="btn btn-outline" onClick={() => navigate(-1)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Create Contract'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
