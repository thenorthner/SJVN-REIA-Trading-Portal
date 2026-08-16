import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, Field } from '../../components/ui.jsx';
import ExchangeBiddingSamplesModal from './ExchangeBiddingSamplesModal.jsx';

const TIME_BLOCKS = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0');
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h}:${m}`;
});

const PRODUCT_TYPES = ['DAM', 'GDAM', 'HPDAM', 'RTM', 'TAM', 'GTAM', 'Daily', 'Weekly', 'Monthly'];
const BIDDING_TYPES = ['Single Bid', 'Block Bid', 'Linked Block Bid', 'Differential Bid'];
const EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const SEGMENTS = ['Day Ahead', 'Real Time', 'Term Ahead', 'Green', 'Collective'];

const EMPTY_ROW = () => ({
  id: Date.now() + Math.random(),
  date_from: '',
  date_to: '',
  time_from: '00:00',
  time_to: '00:15',
  price: '',
  capacity: '',
  side: 'Buy',
});

const EMPTY_FORM = {
  client_id: '',
  client_name: '',
  client_ref_no: '',
  exchange: '',
  segment: '',
  portfolio_id: '',
  contract_id: '',
  contract_label: '',
  product_type: '',
  bidding_type: '',
  supply_start_date: '',
  supply_end_date: '',
  schedule_details: [EMPTY_ROW()],
  csv_filename: '',
};

function FormSection({ title, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="form-section-header">{title}</div>
      {children}
    </div>
  );
}

function parseCsvText(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/["']/g, ''));
  const idx = (names) => headers.findIndex((h) => names.includes(h));
  const iFrom = idx(['date_from', 'from_date', 'date from', 'from']);
  const iTo = idx(['date_to', 'to_date', 'date to', 'to']);
  const iTFrom = idx(['time_from', 'hour_from', 'hours_from', 'from_time']);
  const iTTo = idx(['time_to', 'hour_to', 'hours_to', 'to_time']);
  const iPrice = idx(['price', 'price_inr_mwh', 'price (inr/mwh)']);
  const iCap = idx(['capacity', 'capacity_mw', 'capacity (mw)', 'quantum', 'quantum_mw']);
  const iSide = idx(['buy_sell', 'side', 'buy/sell']);

  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const pick = (i, fallback = '') => (i >= 0 ? cols[i] || fallback : fallback);
    let side = pick(iSide, 'Buy');
    if (/^s/i.test(side)) side = 'Sell';
    else side = 'Buy';
    return {
      id: Date.now() + Math.random(),
      date_from: pick(iFrom),
      date_to: pick(iTo),
      time_from: pick(iTFrom, '00:00').slice(0, 5),
      time_to: pick(iTTo, '00:15').slice(0, 5),
      price: pick(iPrice),
      capacity: pick(iCap),
      side,
    };
  }).filter((r) => r.date_from || r.capacity || r.price);
}

export default function ExchangeBidding() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [clients, setClients] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [csvName, setCsvName] = useState('');
  const [samplesOpen, setSamplesOpen] = useState(false);

  useEffect(() => {
    api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => setClients([]));
    api.exchangeContracts.list().then(setContracts).catch(() => setContracts([]));
  }, []);

  const clientContracts = useMemo(() => {
    if (!form.client_id) return contracts;
    return contracts.filter((c) => c.client_id === form.client_id || !c.client_id);
  }, [contracts, form.client_id]);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function onClientChange(clientId) {
    const client = clients.find((c) => c.id === clientId);
    setForm((prev) => ({
      ...prev,
      client_id: clientId,
      client_name: client?.name || '',
      contract_id: '',
      contract_label: '',
    }));
  }

  function onContractChange(contractId) {
    const c = contracts.find((x) => x.id === contractId);
    setForm((prev) => ({
      ...prev,
      contract_id: contractId,
      contract_label: c ? (c.loa_no || c.ppa_no || c.id) : '',
      portfolio_id: prev.portfolio_id || c?.portfolio_id || '',
      product_type: prev.product_type || c?.product || '',
      bidding_type: prev.bidding_type || c?.bidding_type || '',
    }));
  }

  function addRow(seed) {
    setForm((prev) => ({
      ...prev,
      schedule_details: [...prev.schedule_details, seed ? { ...seed, id: Date.now() + Math.random() } : EMPTY_ROW()],
    }));
  }

  function removeRow(index) {
    setForm((prev) => {
      if (prev.schedule_details.length === 1) return prev;
      const next = [...prev.schedule_details];
      next.splice(index, 1);
      return { ...prev, schedule_details: next };
    });
  }

  function updateRow(index, field, value) {
    setForm((prev) => {
      const next = [...prev.schedule_details];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, schedule_details: next };
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
    const rows = parseCsvText(text);
    if (!rows.length) {
      setError('CSV had no usable rows. Use Download Samples for the expected columns.');
      return;
    }
    setCsvName(file.name);
    setForm((prev) => ({
      ...prev,
      csv_filename: file.name,
      schedule_details: rows,
      supply_start_date: prev.supply_start_date || rows[0].date_from || '',
      supply_end_date: prev.supply_end_date || rows[rows.length - 1].date_to || '',
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(null);
    setBusy(true);
    try {
      const created = await api.exchangeBidding.create(form);
      setSuccess(created);
      setForm({ ...EMPTY_FORM, schedule_details: [EMPTY_ROW()] });
      setCsvName('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit exchange bidding.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <Card>
        <form onSubmit={handleSubmit}>
          <FormSection title="Power Exchange Bidding">
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
            </div>
            <div style={{ borderTop: '1px dashed #cbd5e1', margin: '8px 0 16px' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 12 }}>
              <Field label="Exchange" required>
                <select className="input" value={form.exchange} onChange={(e) => set('exchange', e.target.value)} required>
                  <option value="">-- select an option --</option>
                  {EXCHANGES.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Segment" required>
                <select className="input" value={form.segment} onChange={(e) => set('segment', e.target.value)} required>
                  <option value="">-- select an option --</option>
                  {SEGMENTS.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Portfolio Id" required>
                <input className="input" placeholder="portfolio id of client" value={form.portfolio_id} onChange={(e) => set('portfolio_id', e.target.value)} required />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
              <Field label="Contract" required>
                <select className="input" value={form.contract_id} onChange={(e) => onContractChange(e.target.value)} required>
                  <option value="">-- select an option --</option>
                  {clientContracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.loa_no || c.id}{c.product ? ` · ${c.product}` : ''}{c.client_name ? ` · ${c.client_name}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </FormSection>

          <FormSection title="Product Details">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="Product Type" required>
                <select className="input" value={form.product_type} onChange={(e) => set('product_type', e.target.value)} required>
                  <option value="">-- select an option --</option>
                  {PRODUCT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Bidding Type" required>
                <select className="input" value={form.bidding_type} onChange={(e) => set('bidding_type', e.target.value)} required>
                  <option value="">-- select an option --</option>
                  {BIDDING_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
            </div>
          </FormSection>

          <FormSection title="Application Details">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <Field label="Power supply start date" required>
                <input type="date" className="input" value={form.supply_start_date} onChange={(e) => set('supply_start_date', e.target.value)} required />
              </Field>
              <Field label="Power supply end date" required>
                <input type="date" className="input" value={form.supply_end_date} onChange={(e) => set('supply_end_date', e.target.value)} required />
              </Field>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                Upload Request details in CSV format<span style={{ color: 'var(--red)' }}> *</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => setCsvName(e.target.files?.[0]?.name || '')} />
                <button type="button" className="btn" style={{ background: '#475569', color: '#fff' }} onClick={handleCsvUpload}>
                  Upload
                </button>
                <button type="button" className="btn btn-link" style={{ color: '#1d4ed8', padding: 0 }} onClick={downloadSample}>
                  Download Samples
                </button>
                {csvName && <span style={{ fontSize: 12, color: '#64748b' }}>{csvName}</span>}
              </div>
            </div>
          </FormSection>

          <FormSection title="Requested Schedule Details">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <tr>
                    <th colSpan="2" style={{ padding: 8, borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>Date</th>
                    <th colSpan="2" style={{ padding: 8, borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>Hours</th>
                    <th style={{ padding: 8 }}>Price (INR/MWh)</th>
                    <th style={{ padding: 8 }}>Capacity MW *</th>
                    <th style={{ padding: 8 }}>Buy/Sell</th>
                    <th style={{ padding: 8 }}>Add Bids</th>
                    <th style={{ padding: 8, width: 70, textAlign: 'center' }}>
                      Action{' '}
                      <button type="button" style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '1px 7px' }} onClick={() => addRow()}>+</button>
                    </th>
                  </tr>
                  <tr style={{ color: 'var(--slate-500)', fontWeight: 'normal', fontSize: 11 }}>
                    <th style={{ padding: '4px 8px' }}>From *</th>
                    <th style={{ padding: '4px 8px', borderRight: '1px solid #e2e8f0' }}>To *</th>
                    <th style={{ padding: '4px 8px' }}>From *</th>
                    <th style={{ padding: '4px 8px', borderRight: '1px solid #e2e8f0' }}>To *</th>
                    <th /><th /><th /><th /><th />
                  </tr>
                </thead>
                <tbody>
                  {form.schedule_details.map((row, idx) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: 4 }}>
                        <input type="date" className="input" style={{ width: 130, padding: 4 }} value={row.date_from} onChange={(e) => updateRow(idx, 'date_from', e.target.value)} required />
                      </td>
                      <td style={{ padding: 4, borderRight: '1px solid #e2e8f0' }}>
                        <input type="date" className="input" style={{ width: 130, padding: 4 }} value={row.date_to} onChange={(e) => updateRow(idx, 'date_to', e.target.value)} required />
                      </td>
                      <td style={{ padding: 4 }}>
                        <select className="input" style={{ width: 90, padding: 4 }} value={row.time_from} onChange={(e) => updateRow(idx, 'time_from', e.target.value)}>
                          {TIME_BLOCKS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: 4, borderRight: '1px solid #e2e8f0' }}>
                        <select className="input" style={{ width: 90, padding: 4 }} value={row.time_to} onChange={(e) => updateRow(idx, 'time_to', e.target.value)}>
                          {TIME_BLOCKS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: 4 }}>
                        <input type="number" step="any" className="input" style={{ padding: 4 }} value={row.price} onChange={(e) => updateRow(idx, 'price', e.target.value)} required />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input type="number" step="any" className="input" style={{ padding: 4 }} value={row.capacity} onChange={(e) => updateRow(idx, 'capacity', e.target.value)} required />
                      </td>
                      <td style={{ padding: 4 }}>
                        <select className="input" style={{ padding: 4 }} value={row.side} onChange={(e) => updateRow(idx, 'side', e.target.value)}>
                          <option value="Buy">Buy</option>
                          <option value="Sell">Sell</option>
                        </select>
                      </td>
                      <td style={{ padding: 4 }}>
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => addRow(row)}>Add Bids</button>
                      </td>
                      <td style={{ padding: 4, textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button type="button" style={{ background: '#fff', border: '1px solid #dc2626', color: '#dc2626', borderRadius: 4, padding: '1px 7px', marginRight: 4 }} onClick={() => addRow()}>+</button>
                        <button type="button" style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '1px 7px' }} onClick={() => removeRow(idx)}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>

          {error && (
            <div style={{ color: '#991b1b', marginBottom: 12, background: '#fee2e2', padding: 10, borderRadius: 4, fontSize: 13 }}>{error}</div>
          )}
          {success && (
            <div style={{ color: '#166534', marginBottom: 12, background: '#dcfce7', padding: 10, borderRadius: 4, fontSize: 13 }}>
              Bidding <strong>{success.id}</strong> submitted for {success.client_name} ({success.product_type} · {success.bidding_type}).
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, padding: '16px 0', borderTop: '1px solid #e2e8f0' }}>
            <button type="button" className="btn btn-outline" onClick={() => navigate(-1)}>Close</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit'}</button>
          </div>
        </form>
      </Card>

      <ExchangeBiddingSamplesModal open={samplesOpen} onClose={() => setSamplesOpen(false)} />
    </div>
  );
}
