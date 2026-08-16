import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Card, Field } from '../../components/ui.jsx';
import ExchangeBiddingSamplesModal from './ExchangeBiddingSamplesModal.jsx';

const PERIODS = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0');
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h}:${m}`;
});

const PRODUCT_TYPES = ['DAM', 'GDAM', 'HPDAM', 'RTM', 'TAM', 'GTAM', 'Daily', 'Weekly', 'Monthly'];
const BID_TYPES = [
  { value: 'single', label: 'Single Bid' },
  { value: 'block', label: 'Block Bid' },
  { value: 'linked block', label: 'Linked Block Bid' },
  { value: 'differential', label: 'Differential Bid' },
];

const EMPTY_PQ = () => ({ id: Date.now() + Math.random(), rate: '', quantity: '', bid_reference: '', block_id: '' });
const EMPTY_DETAIL = () => ({
  id: Date.now() + Math.random(),
  from_period_id: '',
  to_period_id: '',
  buy_sell: 'Buy (B)',
  ocf_opted: '',
  premium_discount_price: '',
  max_ocf_quantity: '',
  pq_data: [],
});

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function ExchangeBiddingLatest() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileRef = useRef(null);

  const [clients, setClients] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [csvName, setCsvName] = useState('');
  const [samplesOpen, setSamplesOpen] = useState(false);

  const [form, setForm] = useState({
    client_id: '',
    client_name: '',
    client_ref_no: '',
    contract_id: '',
    product_type: '',
    bid_type: '',
    delivery_date: tomorrowIso(),
    asset_id: '',
    bid_area_id: '',
    user_id: '',
    participant_id: '',
    portfolio_id: '',
    initiated_by: '',
  });
  const [details, setDetails] = useState([EMPTY_DETAIL()]);

  useEffect(() => {
    api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => setClients([]));
    api.exchangeContracts.list().then(setContracts).catch(() => setContracts([]));
  }, []);

  useEffect(() => {
    if (!user) return;
    setForm((prev) => ({
      ...prev,
      user_id: prev.user_id || user.username || user.name || user.id || '',
      initiated_by: prev.initiated_by || user.username || user.name || '',
    }));
  }, [user]);

  const clientContracts = useMemo(() => {
    if (!form.client_id) return contracts;
    return contracts.filter((c) => !c.client_id || c.client_id === form.client_id);
  }, [contracts, form.client_id]);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function onClientChange(id) {
    const c = clients.find((x) => x.id === id);
    setForm((prev) => ({
      ...prev,
      client_id: id,
      client_name: c?.name || '',
      contract_id: '',
    }));
  }

  function onContractChange(id) {
    const c = contracts.find((x) => x.id === id);
    setForm((prev) => ({
      ...prev,
      contract_id: id,
      portfolio_id: prev.portfolio_id || c?.portfolio_id || '',
      product_type: prev.product_type || c?.product || '',
      bid_type: prev.bid_type || (c?.bidding_type ? String(c.bidding_type).toLowerCase().replace(' bid', '') : ''),
    }));
  }

  function updateDetail(index, field, value) {
    setDetails((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addDetail() {
    setDetails((prev) => [...prev, EMPTY_DETAIL()]);
  }

  function removeDetail(index) {
    setDetails((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function addPq(index) {
    setDetails((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], pq_data: [...next[index].pq_data, EMPTY_PQ()] };
      return next;
    });
  }

  function updatePq(dIndex, pIndex, field, value) {
    setDetails((prev) => {
      const next = [...prev];
      const pq = [...next[dIndex].pq_data];
      pq[pIndex] = { ...pq[pIndex], [field]: value };
      next[dIndex] = { ...next[dIndex], pq_data: pq };
      return next;
    });
  }

  function removePq(dIndex, pIndex) {
    setDetails((prev) => {
      const next = [...prev];
      next[dIndex] = {
        ...next[dIndex],
        pq_data: next[dIndex].pq_data.filter((_, i) => i !== pIndex),
      };
      return next;
    });
  }

  function downloadSample() {
    setSamplesOpen(true);
  }

  async function handleCsvUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a CSV file first.');
      return;
    }
    setError('');
    const text = await file.text();
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      setError('CSV had no data rows.');
      return;
    }
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const idx = (names) => headers.findIndex((h) => names.includes(h));
    const mapped = lines.slice(1).map((line) => {
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      const pick = (names, fb = '') => {
        const i = idx(names);
        return i >= 0 ? (cols[i] || fb) : fb;
      };
      let buy = pick(['buy_sell', 'buy/sell', 'side'], 'Buy (B)');
      if (/^s/i.test(buy)) buy = 'Sell (S)';
      else buy = 'Buy (B)';
      return {
        id: Date.now() + Math.random(),
        from_period_id: pick(['from_period_id', 'from_period', 'from']),
        to_period_id: pick(['to_period_id', 'to_period', 'to']),
        buy_sell: buy,
        ocf_opted: pick(['ocf_opted', 'ocf'], 'No') || 'No',
        premium_discount_price: pick(['premium_discount_price', 'premium_discount'], '0'),
        max_ocf_quantity: pick(['max_ocf_quantity', 'max_ocf'], '0'),
        pq_data: [{
          id: Date.now() + Math.random(),
          rate: pick(['rate', 'price', 'rate_price']),
          quantity: pick(['quantity', 'quantity_mwh', 'capacity']),
          bid_reference: pick(['bid_reference', 'bid_ref']),
          block_id: pick(['block_id', 'block']),
        }],
      };
    }).filter((d) => d.from_period_id || d.to_period_id);
    if (!mapped.length) {
      setError('CSV had no usable bid detail rows.');
      return;
    }
    setCsvName(file.name);
    setDetails(mapped);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(null);
    setBusy(true);
    try {
      const created = await api.exchangeBiddingLatest.create({
        ...form,
        details,
      });
      setSuccess(created);
      setDetails([EMPTY_DETAIL()]);
      setCsvName('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit bid.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <Card>
        <form onSubmit={handleSubmit}>
          <div className="form-section-header" style={{ marginTop: 0 }}>Power Exchange Bidding</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
            <Field label="Client Name" required>
              <select className="input" value={form.client_id} onChange={(e) => onClientChange(e.target.value)} required>
                <option value="">-- select an option --</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Client Ref No." required>
              <input className="input" value={form.client_ref_no} onChange={(e) => set('client_ref_no', e.target.value)} required />
            </Field>
            <Field label="Contract" required>
              <select className="input" value={form.contract_id} onChange={(e) => onContractChange(e.target.value)} required>
                <option value="">-- select an option --</option>
                {clientContracts.map((c) => (
                  <option key={c.id} value={c.id}>{c.loa_no || c.id}{c.product ? ` · ${c.product}` : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Product Type" required>
              <select className="input" value={form.product_type} onChange={(e) => set('product_type', e.target.value)} required>
                <option value="">Select</option>
                {PRODUCT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Bid Type" required>
              <select className="input" value={form.bid_type} onChange={(e) => set('bid_type', e.target.value)} required>
                <option value="">Select</option>
                {BID_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 16, marginBottom: 16, background: '#f8fafc' }}>
            <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>General Information</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="Delivery Date (T+1)">
                <input type="date" className="input" value={form.delivery_date} onChange={(e) => set('delivery_date', e.target.value)} required />
              </Field>
              <Field label="Asset ID" required>
                <input className="input" value={form.asset_id} onChange={(e) => set('asset_id', e.target.value)} required />
              </Field>
              <Field label="Bid Area ID" required>
                <input className="input" value={form.bid_area_id} onChange={(e) => set('bid_area_id', e.target.value)} required />
              </Field>
              <Field label="User ID">
                <input className="input" value={form.user_id} onChange={(e) => set('user_id', e.target.value)} />
              </Field>
              <Field label="Participant ID">
                <input className="input" value={form.participant_id} onChange={(e) => set('participant_id', e.target.value)} />
              </Field>
              <Field label="Portfolio ID">
                <input className="input" value={form.portfolio_id} onChange={(e) => set('portfolio_id', e.target.value)} />
              </Field>
              <Field label="Initiated By">
                <input className="input" value={form.initiated_by} onChange={(e) => set('initiated_by', e.target.value)} />
              </Field>
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Upload Request details in CSV format<span style={{ color: 'var(--red)' }}> *</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => setCsvName(e.target.files?.[0]?.name || '')} />
              <button type="button" className="btn" style={{ background: '#475569', color: '#fff' }} onClick={handleCsvUpload}>Upload</button>
              <button type="button" className="btn btn-link" style={{ color: '#1d4ed8', padding: 0 }} onClick={downloadSample}>Download Samples</button>
              {csvName && <span style={{ fontSize: 12, color: '#64748b' }}>{csvName}</span>}
            </div>
          </div>

          {details.map((detail, dIndex) => (
            <div key={detail.id} style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: 16, marginBottom: 14, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong>Bid Detail #{dIndex + 1}</strong>
                <button type="button" className="btn btn-sm" style={{ background: '#dc2626', color: '#fff', border: 'none' }} onClick={() => removeDetail(dIndex)}>
                  Remove Bid Detail
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="From Period ID" required>
                  <select className="input" value={detail.from_period_id} onChange={(e) => updateDetail(dIndex, 'from_period_id', e.target.value)} required>
                    <option value="">-- Select From Period --</option>
                    {PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="To Period ID" required>
                  <select className="input" value={detail.to_period_id} onChange={(e) => updateDetail(dIndex, 'to_period_id', e.target.value)} required>
                    <option value="">-- Select To Period --</option>
                    {PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Buy/Sell" required>
                  <select className="input" value={detail.buy_sell} onChange={(e) => updateDetail(dIndex, 'buy_sell', e.target.value)}>
                    <option value="Buy (B)">Buy (B)</option>
                    <option value="Sell (S)">Sell (S)</option>
                  </select>
                </Field>
                <Field label="OCF Opted">
                  <select className="input" value={detail.ocf_opted} onChange={(e) => updateDetail(dIndex, 'ocf_opted', e.target.value)}>
                    <option value="">----select----</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </Field>
                <Field label="Premium Discount Price">
                  <input type="number" step="any" className="input" value={detail.premium_discount_price} onChange={(e) => updateDetail(dIndex, 'premium_discount_price', e.target.value)} />
                </Field>
                <Field label="Max OCF Quantity">
                  <input type="number" step="any" className="input" value={detail.max_ocf_quantity} onChange={(e) => updateDetail(dIndex, 'max_ocf_quantity', e.target.value)} />
                </Field>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>PQData:</strong>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => addPq(dIndex)}>Add PQData</button>
                </div>
                {detail.pq_data.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#64748b' }}>No PQ rows yet — click Add PQData (rate / quantity).</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9' }}>
                        <th style={{ padding: 6, textAlign: 'left' }}>Rate / Price</th>
                        <th style={{ padding: 6, textAlign: 'left' }}>Quantity (MWh)</th>
                        <th style={{ padding: 6, textAlign: 'left' }}>Bid Reference</th>
                        {form.bid_type === 'block' && <th style={{ padding: 6, textAlign: 'left' }}>Block Id</th>}
                        <th style={{ padding: 6, width: 60 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {detail.pq_data.map((pq, pIndex) => (
                        <tr key={pq.id}>
                          <td style={{ padding: 4 }}><input type="number" step="any" className="input" style={{ padding: 4 }} value={pq.rate} onChange={(e) => updatePq(dIndex, pIndex, 'rate', e.target.value)} required /></td>
                          <td style={{ padding: 4 }}><input type="number" step="any" className="input" style={{ padding: 4 }} value={pq.quantity} onChange={(e) => updatePq(dIndex, pIndex, 'quantity', e.target.value)} required /></td>
                          <td style={{ padding: 4 }}><input className="input" style={{ padding: 4 }} value={pq.bid_reference} onChange={(e) => updatePq(dIndex, pIndex, 'bid_reference', e.target.value)} /></td>
                          {form.bid_type === 'block' && (
                            <td style={{ padding: 4 }}><input className="input" style={{ padding: 4 }} value={pq.block_id} onChange={(e) => updatePq(dIndex, pIndex, 'block_id', e.target.value)} /></td>
                          )}
                          <td style={{ padding: 4 }}>
                            <button type="button" className="btn btn-sm" style={{ color: '#dc2626' }} onClick={() => removePq(dIndex, pIndex)}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ))}

          <button type="button" className="btn" style={{ background: '#16a34a', color: '#fff', marginBottom: 16 }} onClick={addDetail}>
            Add New Bid Detail
          </button>

          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '12px 14px', marginBottom: 16, fontSize: 13, color: '#1e3a8a' }}>
            <strong>Important Notes:</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li>A bid can only be cancelled after it appears in the Bid Book.</li>
              <li>There may be a delay of up to 20 seconds for a newly placed bid to be reflected in the Bid Book.</li>
            </ul>
          </div>

          {error && <div style={{ color: '#991b1b', marginBottom: 12, background: '#fee2e2', padding: 10, borderRadius: 4, fontSize: 13 }}>{error}</div>}
          {success && (
            <div style={{ color: '#166534', marginBottom: 12, background: '#dcfce7', padding: 10, borderRadius: 4, fontSize: 13 }}>
              Bid submitted — Transaction ID <strong>{success.transaction_id}</strong>.{' '}
              <button type="button" className="btn btn-link" style={{ padding: 0 }} onClick={() => navigate('/trading/exchange/bidding-detail')}>
                Open Bid Details Report
              </button>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit Bid'}</button>
          </div>
        </form>
      </Card>

      <ExchangeBiddingSamplesModal open={samplesOpen} onClose={() => setSamplesOpen(false)} />
    </div>
  );
}
