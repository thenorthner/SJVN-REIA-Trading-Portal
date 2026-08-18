import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, Field, Badge, Table, fmtNumber } from '../../components/ui.jsx';

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

function FormSection({ title, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="form-section-header">{title}</div>
      {children}
    </div>
  );
}

const EXCHANGE_BILL_TYPES = [
  ['EXCHANGE_ENERGY', 'Raise Energy Bill'],
  ['EXCHANGE_OA', 'Raise Open Access Bill'],
  ['TRADING_MARGIN', 'Raise Trading Margin Bill'],
];

function billTypeLabel(type) {
  return String(type || '').replace(/^EXCHANGE_/, '').replace(/_/g, ' ');
}

function fmtCreated(s) {
  if (!s) return '—';
  const d = new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toForm(c) {
  const schedule = (c.schedule_details || []).map((row, i) => ({
    id: row.id || `${Date.now()}-${i}`,
    date_from: row.date_from || '',
    date_to: row.date_to || '',
    time_from: row.time_from || '00:00',
    time_to: row.time_to || '00:15',
    rate_type: row.rate_type || '',
    rate: row.rate ?? '',
    quantum: row.quantum ?? '',
    variation: row.variation ?? '',
  }));
  return {
    contract_type: c.contract_type || 'Exchange',
    portfolio_id: c.portfolio_id || '',
    loa_no: c.loa_no || '',
    ppa_no: c.ppa_no || '',
    start_date: c.start_date || '',
    end_date: c.end_date || '',
    compensation: c.compensation ?? '',
    late_payment_surcharge: c.late_payment_surcharge ?? '',
    rebate: c.rebate ?? '',
    side: c.side || '',
    carry_over: c.carry_over || '',
    client_id: c.client_id || '',
    client_name: c.client_name || '',
    concerned_sldc: c.concerned_sldc || '',
    region: c.region || '',
    product: c.product || '',
    bidding_type: c.bidding_type || '',
    is_renewable: c.is_renewable || '',
    schedule_details: schedule.length ? schedule : [EMPTY_SCHEDULE_ROW()],
    billing_type: c.billing_type || '',
    bank_guarantee: c.bank_guarantee ?? '',
    bank_guarantee_validity: c.bank_guarantee_validity || '',
    client_registration_fee: c.client_registration_fee ?? '',
    trading_margin: c.trading_margin ?? '',
    application_fee: c.application_fee ?? '',
    remarks: c.remarks || '',
    created_at: c.created_at,
  };
}

function DetailRow({ label, value }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 8, padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
      <div style={{ color: '#475569', fontWeight: 600 }}>{label}</div>
      <div>{value === null || value === undefined || value === '' ? '—' : value}</div>
    </div>
  );
}

export default function ExchangeContractDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editing = searchParams.get('edit') === '1';

  const [form, setForm] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [settlement, setSettlement] = useState(null);
  const [settleBusy, setSettleBusy] = useState(false);
  const [contractInvoices, setContractInvoices] = useState([]);
  const [billPeriod, setBillPeriod] = useState({ from: '', to: '' });
  const [billBusy, setBillBusy] = useState('');
  const [billMsg, setBillMsg] = useState(null);

  function load() {
    setLoading(true);
    setError('');
    Promise.all([
      api.exchangeContracts.get(id),
      api.tradingClients.list({ status: 'ACTIVE' }).catch(() => []),
    ])
      .then(([contract, clientList]) => {
        setForm(toForm(contract));
        setClients(clientList);
      })
      .catch((err) => setError(err.response?.data?.error || 'Contract not found'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  const refreshSettlement = useCallback((period) => {
    if (!id) return;
    setSettleBusy(true);
    const params = {};
    if (period?.from) params.from = period.from;
    if (period?.to) params.to = period.to;
    api.exchangeContracts.settlement(id, params)
      .then(setSettlement)
      .catch(() => setSettlement(null))
      .finally(() => setSettleBusy(false));
    api.exchangeContracts.invoices(id).then(setContractInvoices).catch(() => setContractInvoices([]));
  }, [id]);

  useEffect(() => {
    if (loading || editing || !form) {
      if (editing) {
        setSettlement(null);
        setContractInvoices([]);
        setBillMsg(null);
      }
      return;
    }
    refreshSettlement({ from: '', to: '' });
    setBillPeriod({ from: '', to: '' });
  }, [id, loading, editing, form, refreshSettlement]);

  async function handleRaiseBill(billType) {
    setBillBusy(billType);
    setBillMsg(null);
    try {
      const body = { bill_type: billType };
      if (billPeriod.from) body.from = billPeriod.from;
      if (billPeriod.to) body.to = billPeriod.to;
      const inv = await api.exchangeContracts.generateInvoice(id, body);
      setBillMsg({
        ok: true,
        text: `${inv.invoice_no} raised for ₹${fmtNumber(inv.invoice_amount)} (${inv.settlement_basis || 'FINAL'}).`,
        warnings: inv.warnings || [],
      });
      refreshSettlement(billPeriod);
    } catch (err) {
      const data = err.response?.data || {};
      setBillMsg({
        ok: false,
        text: data.error || 'Failed to raise the bill.',
        warnings: data.warnings || [],
      });
    } finally {
      setBillBusy('');
    }
  }

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
      region: client?.region || prev.region || '',
    }));
  }

  function addScheduleRow() {
    setForm((prev) => ({ ...prev, schedule_details: [...prev.schedule_details, EMPTY_SCHEDULE_ROW()] }));
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

  function startEdit() {
    setSearchParams({ edit: '1' });
  }

  function cancelEdit() {
    setSearchParams({});
    load();
  }

  async function handleSave(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const updated = await api.exchangeContracts.update(id, form);
      setForm(toForm(updated));
      setSearchParams({});
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update contract.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="page-loading" style={{ padding: 20 }}>Loading contract…</div>;
  if (!form) {
    return (
      <div style={{ padding: 20 }}>
        <Card>
          <p style={{ color: '#991b1b' }}>{error || 'Not found'}</p>
          <button type="button" className="btn btn-outline" onClick={() => navigate('/trading/exchange/contracts')}>Back to summary</button>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Exchange Contracts</div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{form.loa_no || id}</h1>
        </div>
        <div style={{ display: 'flex', gap: 24, fontSize: 13 }}>
          <div><strong>Region:</strong> {form.region || '—'}</div>
          <div><strong>Product Point:</strong> {form.product || '—'}</div>
          <div><strong>Bidding Type:</strong> {form.bidding_type || '—'}</div>
        </div>
      </div>

      <Card>
        <form onSubmit={editing ? handleSave : (e) => e.preventDefault()}>
          <FormSection title="Exchange Contract">
            {editing ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Contract Type"><input className="input" value={form.contract_type} disabled /></Field>
                <Field label="LoA/Contract No" required>
                  <input className="input" value={form.loa_no} onChange={(e) => set('loa_no', e.target.value)} required />
                </Field>
                <Field label="Portfolio ID" required>
                  <input className="input" value={form.portfolio_id} onChange={(e) => set('portfolio_id', e.target.value)} required />
                </Field>
                <Field label="Start Date Of Contract" required>
                  <input type="date" className="input" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} required />
                </Field>
                <Field label="PPA NO." required>
                  <input className="input" value={form.ppa_no} onChange={(e) => set('ppa_no', e.target.value)} required />
                </Field>
                <Field label="End Date Of Contract" required>
                  <input type="date" className="input" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} required />
                </Field>
                <Field label="Compensation (%)" required>
                  <input type="number" step="any" className="input" value={form.compensation} onChange={(e) => set('compensation', e.target.value)} required />
                </Field>
                <Field label="Late Payment Surcharge(LPS)(%)" required>
                  <input type="number" step="any" className="input" value={form.late_payment_surcharge} onChange={(e) => set('late_payment_surcharge', e.target.value)} required />
                </Field>
                <Field label="Rebate (%)" required>
                  <input type="number" step="any" className="input" value={form.rebate} onChange={(e) => set('rebate', e.target.value)} required />
                </Field>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
                <div>
                  <DetailRow label="Contract Type" value={form.contract_type} />
                  <DetailRow label="Portfolio ID" value={form.portfolio_id} />
                  <DetailRow label="PPA NO." value={form.ppa_no} />
                  <DetailRow label="End Date Of Contract" value={form.end_date} />
                  <DetailRow label="Late Payment Surcharge(LPS)(%)" value={form.late_payment_surcharge} />
                </div>
                <div>
                  <DetailRow label="LoA/Contract No" value={form.loa_no} />
                  <DetailRow label="Start Date Of Contract" value={form.start_date} />
                  <DetailRow label="Compensation (%)" value={form.compensation} />
                  <DetailRow label="Rebate (%)" value={form.rebate} />
                </div>
              </div>
            )}
          </FormSection>

          <FormSection title="Application Details">
            {editing ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Buyer/Seller?" required>
                  <div style={{ display: 'flex', gap: 16, height: 36, alignItems: 'center' }}>
                    {['Buyer', 'Seller'].map((opt) => (
                      <label key={opt} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                        <input type="radio" name="side" checked={form.side === opt} onChange={() => set('side', opt)} />
                        {opt}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Carry Over" required>
                  <div style={{ display: 'flex', gap: 16, height: 36, alignItems: 'center' }}>
                    {['Yes', 'No'].map((opt) => (
                      <label key={opt} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                        <input type="radio" name="carry_over" checked={form.carry_over === opt} onChange={() => set('carry_over', opt)} />
                        {opt}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Client Name" required>
                  <select className="input" value={form.client_id} onChange={(e) => onClientChange(e.target.value)}>
                    <option value="">{form.client_name || 'Select client'}</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Concerned SLDC">
                  <input className="input" value={form.concerned_sldc} onChange={(e) => set('concerned_sldc', e.target.value)} />
                </Field>
                <Field label="Region">
                  <input className="input" value={form.region} onChange={(e) => set('region', e.target.value)} />
                </Field>
                <Field label="Product Point" required>
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
                <Field label="Is source of energy renewable?">
                  <div style={{ display: 'flex', gap: 16, height: 36, alignItems: 'center' }}>
                    {['Yes', 'No'].map((opt) => (
                      <label key={opt} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                        <input type="radio" name="is_renewable" checked={form.is_renewable === opt} onChange={() => set('is_renewable', opt)} />
                        {opt}
                      </label>
                    ))}
                  </div>
                </Field>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
                <div>
                  <DetailRow label="Buyer/Seller?" value={form.side} />
                  <DetailRow label="Client Name" value={form.client_name} />
                  <DetailRow label="Region" value={form.region} />
                  <DetailRow label="Bidding Type" value={form.bidding_type} />
                </div>
                <div>
                  <DetailRow label="Carry Over" value={form.carry_over} />
                  <DetailRow label="Concerned SLDC" value={form.concerned_sldc} />
                  <DetailRow label="Product Point" value={form.product} />
                </div>
              </div>
            )}
          </FormSection>

          <FormSection title="Order Details">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead style={{ background: '#5b9bd5', color: '#fff' }}>
                  <tr>
                    <th colSpan="2" style={{ padding: 8, textAlign: 'center' }}>Date</th>
                    <th colSpan="2" style={{ padding: 8, textAlign: 'center' }}>Hours</th>
                    <th style={{ padding: 8 }}>Rate Type</th>
                    <th style={{ padding: 8 }}>Rate (INR/MWh) *</th>
                    <th style={{ padding: 8 }}>Quantum (MW) *</th>
                    <th style={{ padding: 8 }}>Variation</th>
                    {editing && <th style={{ padding: 8, textAlign: 'center' }}>
                      <button type="button" style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px' }} onClick={addScheduleRow}>+</button>
                    </th>}
                  </tr>
                  <tr style={{ background: '#7eb3de', fontSize: 11, fontWeight: 500 }}>
                    <th style={{ padding: '4px 8px' }}>From *</th>
                    <th style={{ padding: '4px 8px' }}>To *</th>
                    <th style={{ padding: '4px 8px' }}>From *</th>
                    <th style={{ padding: '4px 8px' }}>To *</th>
                    <th /><th /><th /><th />
                    {editing && <th />}
                  </tr>
                </thead>
                <tbody>
                  {form.schedule_details.map((row, idx) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      {editing ? (
                        <>
                          <td style={{ padding: 4 }}><input type="date" className="input" style={{ width: 130, padding: 4 }} value={row.date_from} onChange={(e) => updateScheduleRow(idx, 'date_from', e.target.value)} required /></td>
                          <td style={{ padding: 4 }}><input type="date" className="input" style={{ width: 130, padding: 4 }} value={row.date_to} onChange={(e) => updateScheduleRow(idx, 'date_to', e.target.value)} required /></td>
                          <td style={{ padding: 4 }}>
                            <select className="input" style={{ width: 90, padding: 4 }} value={row.time_from} onChange={(e) => updateScheduleRow(idx, 'time_from', e.target.value)}>
                              {TIME_BLOCKS.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: 4 }}>
                            <select className="input" style={{ width: 90, padding: 4 }} value={row.time_to} onChange={(e) => updateScheduleRow(idx, 'time_to', e.target.value)}>
                              {TIME_BLOCKS.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: 4 }}>
                            <select className="input" style={{ padding: 4 }} value={row.rate_type} onChange={(e) => updateScheduleRow(idx, 'rate_type', e.target.value)}>
                              <option value="">select</option>
                              <option value="Fixed">Fixed</option>
                              <option value="Variable">Variable</option>
                              <option value="Exchange linked">Exchange linked</option>
                            </select>
                          </td>
                          <td style={{ padding: 4 }}><input type="number" step="any" className="input" style={{ padding: 4 }} value={row.rate} onChange={(e) => updateScheduleRow(idx, 'rate', e.target.value)} required /></td>
                          <td style={{ padding: 4 }}><input type="number" step="any" className="input" style={{ padding: 4 }} value={row.quantum} onChange={(e) => updateScheduleRow(idx, 'quantum', e.target.value)} required /></td>
                          <td style={{ padding: 4 }}><input type="text" className="input" style={{ padding: 4 }} value={row.variation} onChange={(e) => updateScheduleRow(idx, 'variation', e.target.value)} /></td>
                          <td style={{ padding: 4, textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button type="button" style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', marginRight: 4 }} onClick={addScheduleRow}>+</button>
                            <button type="button" style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px' }} onClick={() => removeScheduleRow(idx)}>×</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: '8px' }}>{row.date_from || '—'}</td>
                          <td style={{ padding: '8px' }}>{row.date_to || '—'}</td>
                          <td style={{ padding: '8px' }}>{row.time_from || '—'}</td>
                          <td style={{ padding: '8px' }}>{row.time_to || '—'}</td>
                          <td style={{ padding: '8px' }}>{row.rate_type || '—'}</td>
                          <td style={{ padding: '8px' }}>{row.rate ?? '—'}</td>
                          <td style={{ padding: '8px' }}>{row.quantum ?? '—'}</td>
                          <td style={{ padding: '8px' }}>{row.variation ?? '—'}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>

          <FormSection title="Billing Cycle">
            {editing ? (
              <Field label="Billing Type" required>
                <select className="input" value={form.billing_type} onChange={(e) => set('billing_type', e.target.value)} required>
                  <option value="">Select</option>
                  <option value="Weekly">Weekly</option>
                  <option value="Fortnightly">Fortnightly</option>
                  <option value="Monthly">Monthly</option>
                </select>
              </Field>
            ) : (
              <DetailRow label="Billing Type" value={form.billing_type} />
            )}
          </FormSection>

          <FormSection title="Fee and Charges">
            {editing ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Bank Guarantee (Rs.)" required>
                  <input type="number" step="any" className="input" value={form.bank_guarantee} onChange={(e) => set('bank_guarantee', e.target.value)} required />
                </Field>
                <Field label="Bank Guarantee Validity Period" required>
                  <input type="date" className="input" value={form.bank_guarantee_validity} onChange={(e) => set('bank_guarantee_validity', e.target.value)} required />
                </Field>
                <Field label="Client Registration Fee (Rs.)" required>
                  <input type="number" step="any" className="input" value={form.client_registration_fee} onChange={(e) => set('client_registration_fee', e.target.value)} required />
                </Field>
                <Field label="Trading Margin (Rs/KWh)" required>
                  <input type="number" step="any" className="input" value={form.trading_margin} onChange={(e) => set('trading_margin', e.target.value)} required />
                </Field>
                <Field label="Application Fee" required>
                  <input type="number" step="any" className="input" value={form.application_fee} onChange={(e) => set('application_fee', e.target.value)} required />
                </Field>
                <Field label="Remarks" required>
                  <textarea className="input" rows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} required />
                </Field>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
                <div>
                  <DetailRow label="Bank Guarantee (Rs.)" value={form.bank_guarantee} />
                  <DetailRow label="Client Registration Fee (Rs.)" value={form.client_registration_fee} />
                  <DetailRow label="Application Fee" value={form.application_fee} />
                  <DetailRow label="Created On" value={fmtCreated(form.created_at)} />
                </div>
                <div>
                  <DetailRow label="Bank Guarantee Validity Period" value={form.bank_guarantee_validity} />
                  <DetailRow label="Trading Margin (Rs/KWh)" value={form.trading_margin} />
                  <DetailRow label="Remarks" value={form.remarks} />
                </div>
              </div>
            )}
          </FormSection>

          {error && (
            <div style={{ color: '#991b1b', marginBottom: 12, background: '#fee2e2', padding: 10, borderRadius: 4, fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, position: 'sticky', bottom: 0, background: '#fff', padding: '16px 0', borderTop: '1px solid #e2e8f0' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => (editing ? cancelEdit() : navigate('/trading/exchange/contracts'))}
            >
              {editing ? 'Cancel' : 'Close'}
            </button>
            {editing ? (
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save Contract'}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={startEdit}>
                Edit Contract
              </button>
            )}
          </div>
        </form>
      </Card>

      {!editing && (
        <Card style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Settlement &amp; Billing</h2>
            <Link to="/billing/view-bills" className="btn btn-sm btn-outline">View Bills →</Link>
          </div>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#64748b' }}>
            Cleared exchange bids for this contract, priced the same way as Generate Bill / View Bills.
          </p>

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
            <Field label="Supply from">
              <input type="date" className="input" value={billPeriod.from}
                onChange={(e) => setBillPeriod({ ...billPeriod, from: e.target.value })} />
            </Field>
            <Field label="Supply to">
              <input type="date" className="input" value={billPeriod.to}
                onChange={(e) => setBillPeriod({ ...billPeriod, to: e.target.value })} />
            </Field>
            <button type="button" className="btn btn-outline" style={{ marginBottom: 4 }}
              onClick={() => refreshSettlement(billPeriod)} disabled={settleBusy}>
              {settleBusy ? 'Settling…' : 'Recalculate'}
            </button>
            {(billPeriod.from || billPeriod.to) && (
              <button type="button" className="btn btn-outline" style={{ marginBottom: 4 }}
                onClick={() => { setBillPeriod({ from: '', to: '' }); refreshSettlement({ from: '', to: '' }); }}>
                Whole contract
              </button>
            )}
          </div>

          {settleBusy && !settlement ? (
            <p style={{ color: '#777', fontSize: 13 }}>Computing the settled position…</p>
          ) : !settlement ? (
            <p style={{ color: '#777', fontSize: 13 }}>Could not load settlement — check that cleared bids exist for this contract.</p>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
                {[
                  ['Cleared', `${fmtNumber(settlement.cleared?.cleared_mwh)} MWh`, `${settlement.cleared?.cleared_blocks ?? 0} of ${settlement.cleared?.blocks ?? 0} blocks`],
                  ['Bid volume', `${fmtNumber(settlement.cleared?.bid_mwh)} MWh`, `${fmtNumber(settlement.cleared?.uncleared_mwh)} MWh uncleared`],
                  ['Energy value', `₹${fmtNumber(settlement.money?.energy_value)}`, `@ ₹${settlement.rates?.avg_clearing_price ?? '—'}/kWh MCP`],
                  ['Trading margin', `₹${fmtNumber(settlement.money?.trading_margin)}`, `@ ₹${settlement.rates?.trading_margin_per_unit ?? '—'}/kWh`],
                  ['Exchange fee', `₹${fmtNumber(settlement.money?.exchange_fee)}`, settlement.exchange || 'IEX'],
                  ['Client position', `₹${fmtNumber(settlement.money?.client_energy_position)}`, settlement.side === 'Buyer' ? 'buy-side' : 'sell-side'],
                ].map(([label, value, sub]) => (
                  <div key={label} style={{ padding: '10px 12px', background: 'var(--slate-50)', border: '1px solid var(--slate-200)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--slate-500)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{value}</div>
                    <div style={{ fontSize: 11, color: 'var(--slate-500)' }}>{sub}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                <Badge type={(settlement.cleared?.cleared_mwh ?? 0) > 0 ? 'success' : 'warning'}>
                  {(settlement.cleared?.cleared_mwh ?? 0) > 0 ? 'FINAL' : 'NO CLEARANCE'}
                </Badge>
                <span style={{ fontSize: 12, color: 'var(--slate-600)' }}>
                  {settlement.cleared?.bids ?? 0} bid(s)
                  {settlement.cleared?.days ? ` · ${settlement.cleared.days} day(s)` : ''}
                  {settlement.cleared?.period_from ? ` · ${settlement.cleared.period_from} to ${settlement.cleared.period_to}` : ''}
                  {settlement.product ? ` · ${settlement.product} on ${settlement.exchange || 'IEX'}` : ''}
                </span>
              </div>

              {settlement.warnings?.length > 0 && (
                <ul style={{ margin: '0 0 12px 18px', fontSize: 12, color: '#92400e' }}>
                  {settlement.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {EXCHANGE_BILL_TYPES.map(([type, label]) => (
                  <button key={type} type="button" className="btn btn-primary"
                    disabled={billBusy === type || (settlement.cleared?.cleared_mwh ?? 0) <= 0}
                    onClick={() => handleRaiseBill(type)}>
                    {billBusy === type ? 'Raising…' : label}
                  </button>
                ))}
              </div>

              {billMsg && (
                <div style={{
                  marginTop: 12, padding: '10px 12px', borderRadius: 6, fontSize: 13,
                  background: billMsg.ok ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${billMsg.ok ? '#bbf7d0' : '#fecaca'}`,
                  color: billMsg.ok ? '#166534' : '#991b1b',
                }}>
                  {billMsg.text}
                  {billMsg.warnings?.length > 0 && (
                    <ul style={{ margin: '6px 0 0 18px', fontSize: 12 }}>
                      {billMsg.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  )}
                </div>
              )}

              <div style={{ marginTop: 18 }}>
                <strong style={{ fontSize: 13 }}>Bills raised against this contract</strong>
                {contractInvoices.length === 0 ? (
                  <p style={{ color: '#777', fontSize: 13, marginTop: 6 }}>None yet.</p>
                ) : (
                  <div style={{ marginTop: 8 }}>
                    <Table
                      columns={[
                        { key: 'invoice_no', label: 'Invoice No' },
                        { key: 'bill_type', label: 'Type', render: (r) => billTypeLabel(r.bill_type) },
                        { key: 'invoice_amount', label: 'Amount', render: (r) => `₹${fmtNumber(r.invoice_amount)}` },
                        { key: 'quantum_mwh', label: 'MWh', render: (r) => (r.quantum_mwh == null ? '—' : fmtNumber(r.quantum_mwh)) },
                        { key: 'supply_from_date', label: 'Supply', render: (r) => (r.supply_from_date ? `${r.supply_from_date} → ${r.supply_to_date}` : '—') },
                        { key: 'invoice_due_date', label: 'Due' },
                        { key: 'settlement_basis', label: 'Basis', render: (r) => <Badge type={r.settlement_basis === 'FINAL' ? 'success' : 'warning'}>{r.settlement_basis || 'MANUAL'}</Badge> },
                      ]}
                      data={contractInvoices}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
