import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, Field } from '../../components/ui.jsx';

const HOURS = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0');
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h}:${m}`;
});

const APPLICATION_TYPES = [
  'Fresh', 'Advance', 'Revision', 'Curtailment', 'Cancellation', 'Standing Clearance',
];
const GENERATING_SOURCES = [
  'Hydro', 'Thermal', 'Solar', 'Wind', 'Hybrid', 'Gas', 'Nuclear', 'Other',
];

const EMPTY_ROW = () => ({
  id: Date.now() + Math.random(),
  date_from: '',
  date_to: '',
  time_from: '00:00',
  time_to: '00:15',
  capacity: '',
});

const EMPTY = {
  applicant: 'SJVN Limited',
  seller_name: '',
  seller_id: '',
  seller_injecting_point: '',
  seller_utility: '',
  seller_sldc: '',
  seller_region: '',
  seller_contract_id: '',
  seller_contract_no: '',
  buyer_name: '',
  buyer_id: '',
  buyer_drawal_point: '',
  buyer_utility: '',
  buyer_sldc: '',
  buyer_region: '',
  buyer_contract_id: '',
  buyer_contract_no: '',
  under_gtam: 'No',
  access_type: 'T-GNA',
  accept_partial: 'No',
  application_type: '',
  route: '',
  alternate_route: '',
  generating_sources: [''],
  schedule_details: [EMPTY_ROW()],
  csv_filename: '',
  declaration_accepted: false,
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
  const iCap = idx(['capacity', 'capacity_mw', 'capacity (mw)', 'quantum', 'quantum_mw', 'mw']);

  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const pick = (i, fallback = '') => (i >= 0 ? cols[i] || fallback : fallback);
    return {
      id: Date.now() + Math.random(),
      date_from: pick(iFrom),
      date_to: pick(iTo),
      time_from: pick(iTFrom, '00:00').slice(0, 5),
      time_to: pick(iTTo, '00:15').slice(0, 5),
      capacity: pick(iCap),
    };
  }).filter((r) => r.date_from || r.capacity);
}

function downloadSampleCsv() {
  const header = 'date_from,date_to,time_from,time_to,capacity_mw';
  const rows = [
    '2026-04-01,2026-04-01,00:00,24:00,25',
    '2026-04-02,2026-04-02,06:00,22:00,20',
  ];
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bilateral-bidding-sample.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * ISET Bilateral Bidding — Application For Format Generation.
 */
export default function BilateralBidding() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [form, setForm] = useState(EMPTY);
  const [clients, setClients] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [csvName, setCsvName] = useState('');

  useEffect(() => {
    api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => setClients([]));
    api.bilateral.list().then((rows) => setContracts((rows || []).filter((r) => r.loa_no || r.ppa_no))).catch(() => setContracts([]));
  }, []);

  const contractOptions = useMemo(
    () => contracts.map((c) => ({
      id: c.id,
      label: c.loa_no || c.ppa_no || c.id,
      row: c,
    })),
    [contracts],
  );

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function onSellerNameChange(name) {
    const c = clients.find((x) => x.name === name);
    setForm((prev) => ({
      ...prev,
      seller_name: name,
      seller_id: c?.id || '',
    }));
  }

  function onBuyerNameChange(name) {
    const c = clients.find((x) => x.name === name);
    setForm((prev) => ({
      ...prev,
      buyer_name: name,
      buyer_id: c?.id || '',
    }));
  }

  function onSellerContract(id) {
    const opt = contractOptions.find((c) => c.id === id);
    const r = opt?.row;
    setForm((prev) => ({
      ...prev,
      seller_contract_id: id,
      seller_contract_no: opt?.label || '',
      seller_injecting_point: r?.injecting_point || prev.seller_injecting_point,
      seller_utility: r?.supplier_name || r?.counterparty || prev.seller_utility,
      seller_sldc: r?.supplier_sldc || prev.seller_sldc,
      seller_region: r?.supplier_region || prev.seller_region,
      seller_name: prev.seller_name || r?.supplier_name || '',
      seller_id: prev.seller_id || r?.supplier_id || '',
    }));
  }

  function onBuyerContract(id) {
    const opt = contractOptions.find((c) => c.id === id);
    const r = opt?.row;
    setForm((prev) => ({
      ...prev,
      buyer_contract_id: id,
      buyer_contract_no: opt?.label || '',
      buyer_drawal_point: r?.drawal_point || prev.buyer_drawal_point,
      buyer_utility: r?.procurer_name || r?.counterparty || prev.buyer_utility,
      buyer_sldc: r?.procurer_sldc || prev.buyer_sldc,
      buyer_region: r?.procurer_region || prev.buyer_region,
      buyer_name: prev.buyer_name || r?.procurer_name || '',
      buyer_id: prev.buyer_id || r?.procurer_id || '',
    }));
  }

  function updateRow(idx, field, value) {
    setForm((prev) => {
      const schedule_details = [...prev.schedule_details];
      schedule_details[idx] = { ...schedule_details[idx], [field]: value };
      return { ...prev, schedule_details };
    });
  }

  function addRow() {
    setForm((prev) => ({ ...prev, schedule_details: [...prev.schedule_details, EMPTY_ROW()] }));
  }

  function removeRow(idx) {
    setForm((prev) => ({
      ...prev,
      schedule_details: prev.schedule_details.length <= 1
        ? prev.schedule_details
        : prev.schedule_details.filter((_, i) => i !== idx),
    }));
  }

  function updateSource(idx, value) {
    setForm((prev) => {
      const generating_sources = [...prev.generating_sources];
      generating_sources[idx] = value;
      return { ...prev, generating_sources };
    });
  }

  function addSource() {
    setForm((prev) => ({ ...prev, generating_sources: [...prev.generating_sources, ''] }));
  }

  function removeSource(idx) {
    setForm((prev) => ({
      ...prev,
      generating_sources: prev.generating_sources.length <= 1
        ? prev.generating_sources
        : prev.generating_sources.filter((_, i) => i !== idx),
    }));
  }

  function handleCsvUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Choose a CSV file first.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsvText(String(reader.result || ''));
      if (!rows.length) {
        setError('CSV had no usable rows. Use Download Sample File for the expected columns.');
        return;
      }
      setCsvName(file.name);
      setForm((prev) => ({ ...prev, schedule_details: rows, csv_filename: file.name }));
      setError('');
    };
    reader.readAsText(file);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(null);
    if (!form.declaration_accepted) {
      setError('Please accept the declaration before submit.');
      return;
    }
    setBusy(true);
    try {
      const created = await api.bilateralBidding.create({
        ...form,
        generating_sources: form.generating_sources.filter(Boolean),
      });
      setSuccess(created);
      setForm(EMPTY);
      setCsvName('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit bilateral bidding application.');
    } finally {
      setBusy(false);
    }
  }

  const disabledStyle = { background: '#f1f5f9' };

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      <Card>
        <form onSubmit={handleSubmit}>
          <FormSection title="Application For Format Generation">
            <div style={{ maxWidth: 420, marginBottom: 8 }}>
              <Field label="Applicant" required>
                <input className="input" value={form.applicant} onChange={(e) => set('applicant', e.target.value)} required />
              </Field>
            </div>
          </FormSection>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <FormSection title="Seller Details">
              <div style={{ display: 'grid', gap: 12 }}>
                <Field label="Seller Name" required>
                  <input
                    className="input"
                    list="bilateral-seller-names"
                    value={form.seller_name}
                    onChange={(e) => onSellerNameChange(e.target.value)}
                    required
                  />
                  <datalist id="bilateral-seller-names">
                    {clients.map((c) => <option key={c.id} value={c.name} />)}
                  </datalist>
                </Field>
                <Field label="Seller Id" required>
                  <input className="input" value={form.seller_id} placeholder="client id of seller" disabled style={disabledStyle} />
                </Field>
                <Field label="Injecting Point" required>
                  <input className="input" value={form.seller_injecting_point} onChange={(e) => set('seller_injecting_point', e.target.value)} required />
                </Field>
                <Field label="Utility in which it is embedded" required>
                  <input className="input" value={form.seller_utility} onChange={(e) => set('seller_utility', e.target.value)} required />
                </Field>
                <Field label="Concerned SLDC" required>
                  <input className="input" value={form.seller_sldc} onChange={(e) => set('seller_sldc', e.target.value)} required />
                </Field>
                <Field label="Region" required>
                  <input className="input" value={form.seller_region} onChange={(e) => set('seller_region', e.target.value)} required />
                </Field>
                <Field label="Seller Side Contract" required>
                  <select className="input" value={form.seller_contract_id} onChange={(e) => onSellerContract(e.target.value)} required>
                    <option value="">-- select an option --</option>
                    {contractOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </Field>
              </div>
            </FormSection>

            <FormSection title="Buyer Details">
              <div style={{ display: 'grid', gap: 12 }}>
                <Field label="Buyer Name" required>
                  <input
                    className="input"
                    list="bilateral-buyer-names"
                    value={form.buyer_name}
                    onChange={(e) => onBuyerNameChange(e.target.value)}
                    required
                  />
                  <datalist id="bilateral-buyer-names">
                    {clients.map((c) => <option key={c.id} value={c.name} />)}
                  </datalist>
                </Field>
                <Field label="Buyer Id" required>
                  <input className="input" value={form.buyer_id} placeholder="client id of buyer" disabled style={disabledStyle} />
                </Field>
                <Field label="Drawal Point" required>
                  <input className="input" value={form.buyer_drawal_point} onChange={(e) => set('buyer_drawal_point', e.target.value)} required />
                </Field>
                <Field label="Utility in which it is embedded" required>
                  <input className="input" value={form.buyer_utility} onChange={(e) => set('buyer_utility', e.target.value)} required />
                </Field>
                <Field label="Concerned SLDC" required>
                  <input className="input" value={form.buyer_sldc} onChange={(e) => set('buyer_sldc', e.target.value)} required />
                </Field>
                <Field label="Region" required>
                  <input className="input" value={form.buyer_region} onChange={(e) => set('buyer_region', e.target.value)} required />
                </Field>
                <Field label="Buyer Side Contract" required>
                  <select className="input" value={form.buyer_contract_id} onChange={(e) => onBuyerContract(e.target.value)} required>
                    <option value="">-- select an option --</option>
                    {contractOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </Field>
              </div>
            </FormSection>
          </div>

          <FormSection title="Application Sought For">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
              <Field label="Whether Transaction Under GTAM" required>
                <div style={{ display: 'flex', gap: 18, height: 36, alignItems: 'center' }}>
                  {['Yes', 'No'].map((opt) => (
                    <label key={opt} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                      <input type="radio" name="under_gtam" checked={form.under_gtam === opt} onChange={() => set('under_gtam', opt)} />
                      {opt}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Type" required>
                <div style={{ display: 'flex', gap: 18, height: 36, alignItems: 'center' }}>
                  {['GNA', 'T-GNA'].map((opt) => (
                    <label key={opt} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                      <input type="radio" name="access_type" checked={form.access_type === opt} onChange={() => set('access_type', opt)} />
                      {opt}
                    </label>
                  ))}
                </div>
              </Field>
            </div>

            <Field label="Granting T-GNA/T-GNARE application with conditions for accepting the partial quantum / period in case of congestion / constraints?" required>
              <div style={{ display: 'flex', gap: 18, marginTop: 6, marginBottom: 14 }}>
                {['Yes', 'No'].map((opt) => (
                  <label key={opt} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                    <input type="radio" name="accept_partial" checked={form.accept_partial === opt} onChange={() => set('accept_partial', opt)} />
                    {opt}
                  </label>
                ))}
              </div>
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="Application Type" required>
                <select className="input" value={form.application_type} onChange={(e) => set('application_type', e.target.value)} required>
                  <option value="">-- select an option --</option>
                  {APPLICATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Route" required>
                <input className="input" value={form.route} onChange={(e) => set('route', e.target.value)} required />
              </Field>
              <Field label="Alternate Route">
                <input className="input" value={form.alternate_route} onChange={(e) => set('alternate_route', e.target.value)} />
              </Field>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Generating Source <span style={{ color: 'var(--red)' }}>*</span>
                </div>
                {form.generating_sources.map((src, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <select className="input" value={src} onChange={(e) => updateSource(idx, e.target.value)} required style={{ flex: 1 }}>
                      <option value="">-- select an option --</option>
                      {GENERATING_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {idx === 0 ? (
                      <button type="button" className="btn btn-sm" style={{ background: '#dc2626', color: '#fff', minWidth: 36 }} onClick={addSource}>+</button>
                    ) : (
                      <button type="button" className="btn btn-sm btn-outline" style={{ color: '#dc2626', minWidth: 36 }} onClick={() => removeSource(idx)}>×</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </FormSection>

          <div style={{ marginTop: 8, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Upload Request details in CSV format <span style={{ color: 'var(--red)' }}>*</span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="input" style={{ maxWidth: 280 }} />
              <button type="button" className="btn btn-sm" style={{ background: '#475569', color: '#fff' }} onClick={handleCsvUpload}>Upload</button>
              <button type="button" className="btn btn-sm" style={{ background: '#475569', color: '#fff' }} onClick={downloadSampleCsv}>Download Sample File</button>
              {csvName && <span style={{ fontSize: 12, color: '#64748b' }}>{csvName}</span>}
            </div>
          </div>

          <div style={{ overflowX: 'auto', marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th colSpan={2} style={{ padding: 8, border: '1px solid #e2e8f0', textAlign: 'center' }}>Date</th>
                  <th colSpan={2} style={{ padding: 8, border: '1px solid #e2e8f0', textAlign: 'center' }}>Hours</th>
                  <th style={{ padding: 8, border: '1px solid #e2e8f0', textAlign: 'center' }}>Capacity</th>
                  <th style={{ padding: 8, border: '1px solid #e2e8f0', width: 70, textAlign: 'center' }}>Action</th>
                </tr>
                <tr style={{ background: '#f8fafc', fontSize: 11, color: '#64748b', fontWeight: 500 }}>
                  <th style={{ padding: '4px 8px', border: '1px solid #e2e8f0' }}>From *</th>
                  <th style={{ padding: '4px 8px', border: '1px solid #e2e8f0' }}>To *</th>
                  <th style={{ padding: '4px 8px', border: '1px solid #e2e8f0' }}>From *</th>
                  <th style={{ padding: '4px 8px', border: '1px solid #e2e8f0' }}>To *</th>
                  <th style={{ padding: '4px 8px', border: '1px solid #e2e8f0' }}>MW *</th>
                  <th style={{ padding: '4px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                    <button type="button" className="btn btn-sm" style={{ background: '#dc2626', color: '#fff', padding: '2px 8px' }} onClick={addRow}>+</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {form.schedule_details.map((row, idx) => (
                  <tr key={row.id}>
                    <td style={{ padding: 4, border: '1px solid #e2e8f0' }}>
                      <input type="date" className="input" style={{ padding: 4 }} value={row.date_from} onChange={(e) => updateRow(idx, 'date_from', e.target.value)} required />
                    </td>
                    <td style={{ padding: 4, border: '1px solid #e2e8f0' }}>
                      <input type="date" className="input" style={{ padding: 4 }} value={row.date_to} onChange={(e) => updateRow(idx, 'date_to', e.target.value)} required />
                    </td>
                    <td style={{ padding: 4, border: '1px solid #e2e8f0' }}>
                      <select className="input" style={{ padding: 4 }} value={row.time_from} onChange={(e) => updateRow(idx, 'time_from', e.target.value)} required>
                        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 4, border: '1px solid #e2e8f0' }}>
                      <select className="input" style={{ padding: 4 }} value={row.time_to} onChange={(e) => updateRow(idx, 'time_to', e.target.value)} required>
                        {[...HOURS, '24:00'].map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 4, border: '1px solid #e2e8f0' }}>
                      <input type="number" step="any" min="0" className="input" style={{ padding: 4 }} value={row.capacity} onChange={(e) => updateRow(idx, 'capacity', e.target.value)} required />
                    </td>
                    <td style={{ padding: 4, border: '1px solid #e2e8f0', textAlign: 'center' }}>
                      <button type="button" className="btn btn-sm btn-outline" style={{ color: '#dc2626', padding: '2px 8px' }} onClick={() => removeRow(idx)} disabled={form.schedule_details.length <= 1}>🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, marginBottom: 16, lineHeight: 1.45 }}>
            <input
              type="checkbox"
              checked={form.declaration_accepted}
              onChange={(e) => set('declaration_accepted', e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              The provisions of the Electricity Act 2003, IEGC, CERC regulations &amp; CTU Procedures with respect to
              bilateral transactions in inter state transmission as amended from time to time are hereby understood and would be binding.
            </span>
          </label>

          {error && <div style={{ color: '#991b1b', background: '#fee2e2', padding: 10, borderRadius: 4, fontSize: 13, marginBottom: 12 }}>{error}</div>}
          {success && (
            <div style={{ color: '#166534', background: '#dcfce7', padding: 10, borderRadius: 4, fontSize: 13, marginBottom: 12 }}>
              Application <strong>{success.id}</strong> submitted — {success.application_type} · {success.seller_contract_no} → {success.buyer_contract_no}.
              {success.application?.application_id && (
                <> Listed as <strong>{success.application.application_id}</strong> under Bilateral Applications.</>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            <button type="button" className="btn btn-outline" onClick={() => navigate('/trading/bilateral')}>Close</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit'}</button>
          </div>
        </form>
      </Card>
    </div>
  );
}
