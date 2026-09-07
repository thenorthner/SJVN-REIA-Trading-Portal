import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtNumber } from '../../components/ui.jsx';

// Deviation (DSM) charge slabs.
//
// The band structure ships empty on purpose: a deviation charge is only as good
// as the notified rate behind it, so a band cannot price a bill until someone
// has entered that rate and marked the row verified. The readiness strip at the
// top is how the desk sees what is still missing before it bills a period.

const SIDES = ['OVER', 'UNDER', 'BOTH'];
const SIDE_LABEL = { OVER: 'Over-injection', UNDER: 'Under-injection', BOTH: 'Either side' };

const EMPTY_SLAB = {
  slab_name: '', deviation_side: 'UNDER', freq_from_hz: '', freq_to_hz: '',
  charge_basis: 'FLAT', charge_value: '', reference_price_key: 'DAM_ACP',
  cap_paise_per_kwh: '', settlement_sign: 1, effective_from: '', source_note: '',
};

const EMPTY_PREVIEW = { deviation_mw: '', frequency_hz: '', date: '' };

/** A band reads as a range, with the open ends spelled out. */
function bandLabel(r) {
  if (r.freq_from_hz == null && r.freq_to_hz == null) return 'Any frequency';
  if (r.freq_from_hz == null) return `below ${fmtNumber(r.freq_to_hz, 2)} Hz`;
  if (r.freq_to_hz == null) return `${fmtNumber(r.freq_from_hz, 2)} Hz and above`;
  return `${fmtNumber(r.freq_from_hz, 2)} – ${fmtNumber(r.freq_to_hz, 2)} Hz`;
}

function rateLabel(r) {
  if (r.charge_value == null) return <span style={{ color: 'var(--slate-400, #94a3b8)' }}>not entered</span>;
  if (r.charge_basis === 'FLAT') return `${fmtNumber(r.charge_value, 2)} p/kWh`;
  const cap = r.cap_paise_per_kwh != null ? `, capped ${fmtNumber(r.cap_paise_per_kwh, 2)} p/kWh` : '';
  return `${fmtNumber(r.charge_value, 2)}% of ${r.reference_price_key || 'reference'}${cap}`;
}

export default function DsmSlabMaster() {
  const [slabs, setSlabs] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [side, setSide] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showNew, setShowNew] = useState(false);
  const [newSlab, setNewSlab] = useState(EMPTY_SLAB);
  const [editing, setEditing] = useState(null);
  const [edit, setEdit] = useState({ charge_value: '', cap_paise_per_kwh: '', is_verified: 0, source_note: '' });

  const [preview, setPreview] = useState(EMPTY_PREVIEW);
  const [previewResult, setPreviewResult] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [rows, ready] = await Promise.all([
        api.dsmSlabs.list(side ? { side } : undefined),
        api.dsmSlabs.readiness(),
      ]);
      setSlabs(rows); setReadiness(ready); setError('');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load DSM slabs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [side]);

  function openEdit(row) {
    setEditing(row);
    setEdit({
      charge_value: row.charge_value ?? '',
      cap_paise_per_kwh: row.cap_paise_per_kwh ?? '',
      is_verified: row.is_verified,
      source_note: row.source_note || '',
    });
  }

  async function submitEdit(e) {
    e.preventDefault();
    try {
      await api.dsmSlabs.update(editing.id, {
        charge_value: edit.charge_value === '' ? null : Number(edit.charge_value),
        cap_paise_per_kwh: edit.cap_paise_per_kwh === '' ? null : Number(edit.cap_paise_per_kwh),
        is_verified: Number(edit.is_verified) === 1 ? 1 : 0,
        source_note: edit.source_note,
      });
      setEditing(null); load();
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to save slab');
    }
  }

  async function submitNew(e) {
    e.preventDefault();
    try {
      const body = {
        ...newSlab,
        freq_from_hz: newSlab.freq_from_hz === '' ? null : Number(newSlab.freq_from_hz),
        freq_to_hz: newSlab.freq_to_hz === '' ? null : Number(newSlab.freq_to_hz),
        charge_value: newSlab.charge_value === '' ? null : Number(newSlab.charge_value),
        cap_paise_per_kwh: newSlab.cap_paise_per_kwh === '' ? null : Number(newSlab.cap_paise_per_kwh),
        settlement_sign: Number(newSlab.settlement_sign),
      };
      if (body.charge_basis === 'FLAT') body.reference_price_key = null;
      await api.dsmSlabs.create(body);
      setShowNew(false); setNewSlab(EMPTY_SLAB); load();
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to create slab');
    }
  }

  async function runPreview(e) {
    e.preventDefault();
    setPreviewResult(null);
    try {
      setPreviewResult(await api.dsmSlabs.preview({
        deviation_mw: Number(preview.deviation_mw),
        frequency_hz: preview.frequency_hz === '' ? null : Number(preview.frequency_hz),
        date: preview.date || undefined,
      }));
    } catch (err) {
      setPreviewResult({ basis: 'ERROR', warning: err.response?.data?.error || 'Could not price that deviation' });
    }
  }

  const columns = [
    { key: 'deviation_side', label: 'Side', render: r => <Badge type={r.deviation_side === 'OVER' ? 'primary' : 'warning'}>{SIDE_LABEL[r.deviation_side]}</Badge> },
    { key: 'band', label: 'Frequency band', render: bandLabel },
    { key: 'charge_value', label: 'Rate', render: rateLabel },
    { key: 'settlement_sign', label: 'Money moves', render: r => (r.settlement_sign === -1 ? 'Credit to party' : 'Charge on party') },
    { key: 'effective_from', label: 'Effective from' },
    { key: 'effective_to', label: 'Effective to', render: r => (r.effective_to ? r.effective_to : <Badge type="success">Current</Badge>) },
    {
      key: 'is_verified',
      label: 'Status',
      render: r => (r.is_verified
        ? <Badge type="success">Verified</Badge>
        : <Badge type="danger">Cannot price</Badge>),
    },
    {
      key: 'actions',
      label: '',
      render: r => <button className="btn btn-secondary btn-sm" onClick={() => openEdit(r)}>Enter rate</button>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Deviation (DSM) Charge Slabs"
        subtitle="Frequency-linked deviation rates. A band prices a block only once its notified rate is entered and verified."
        actions={<button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New slab</button>}
      />

      {readiness && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 18 }}>
          <StatCard label="Bands configured" value={readiness.slabs} />
          <StatCard label="Verified" value={readiness.verified} tone={readiness.verified ? 'success' : 'default'} />
          <StatCard
            label="Awaiting notified rate"
            value={readiness.unverified}
            tone={readiness.unverified ? 'warning' : 'success'}
            hint={readiness.unverified ? 'Deviations in these bands stay unpriced' : 'Every band can price'}
          />
        </div>
      )}

      <Card title="What would a deviation cost?">
        <form onSubmit={runPreview} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Block deviation (MW)">
            <input type="number" step="0.01" className="input" value={preview.deviation_mw}
              onChange={e => setPreview({ ...preview, deviation_mw: e.target.value })} required placeholder="-20" />
          </Field>
          <Field label="Grid frequency (Hz)">
            <input type="number" step="0.01" className="input" value={preview.frequency_hz}
              onChange={e => setPreview({ ...preview, frequency_hz: e.target.value })} placeholder="49.90" />
          </Field>
          <Field label="On date">
            <input type="date" className="input" value={preview.date} onChange={e => setPreview({ ...preview, date: e.target.value })} />
          </Field>
          <button className="btn btn-secondary" type="submit">Price it</button>
          {previewResult && (
            <div style={{ marginLeft: 8, fontSize: 14 }}>
              {previewResult.basis === 'CERC_SLAB'
                ? <span><strong>₹{fmtNumber(previewResult.amount, 0)}</strong> at {fmtNumber(previewResult.rate_paise_per_kwh, 2)} p/kWh · {previewResult.slab_name}</span>
                : <span style={{ color: 'var(--warning, #b45309)' }}>{previewResult.warning || 'Nothing to charge — the block met its schedule'}</span>}
            </div>
          )}
        </form>
      </Card>

      <Card
        title="Slab register"
        actions={(
          <select className="input" value={side} onChange={e => setSide(e.target.value)} style={{ width: 180 }}>
            <option value="">Both sides</option>
            {SIDES.map(s => <option key={s} value={s}>{SIDE_LABEL[s]}</option>)}
          </select>
        )}
      >
        {error && <div style={{ color: 'var(--danger, #b91c1c)', marginBottom: 10 }}>{error}</div>}
        <Table columns={columns} rows={slabs} loading={loading} emptyMessage="No slabs configured." />
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.slab_name || 'Enter rate'}>
        <form onSubmit={submitEdit}>
          <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 14 }}>
            Enter the rate from the notified CERC / SERC deviation settlement slab. Until this band is
            marked verified, deviations falling in it are recorded but left unpriced.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
            <Field label={editing?.charge_basis === 'FLAT' ? 'Rate (paise/kWh)' : 'Percentage of reference'} required>
              <input type="number" step="0.01" className="input" value={edit.charge_value}
                onChange={e => setEdit({ ...edit, charge_value: e.target.value })} required />
            </Field>
            <Field label="Cap (paise/kWh)">
              <input type="number" step="0.01" className="input" value={edit.cap_paise_per_kwh}
                onChange={e => setEdit({ ...edit, cap_paise_per_kwh: e.target.value })} />
            </Field>
          </div>
          <Field label="Source">
            <input className="input" value={edit.source_note} onChange={e => setEdit({ ...edit, source_note: e.target.value })}
              placeholder="e.g. CERC DSM Regulations notification reference" />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 14 }}>
            <input type="checkbox" checked={Number(edit.is_verified) === 1}
              onChange={e => setEdit({ ...edit, is_verified: e.target.checked ? 1 : 0 })} />
            Verified against the notification — allow this band to price bills
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </Modal>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="New slab" width={640}>
        <form onSubmit={submitNew}>
          <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 14 }}>
            A band covers [from, to) — a frequency exactly on a boundary belongs to the band above it.
            Leave an end blank to leave that side open.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
            <Field label="Slab name" required>
              <input className="input" value={newSlab.slab_name} onChange={e => setNewSlab({ ...newSlab, slab_name: e.target.value })} required />
            </Field>
            <Field label="Deviation side" required>
              <select className="input" value={newSlab.deviation_side} onChange={e => setNewSlab({ ...newSlab, deviation_side: e.target.value })}>
                {SIDES.map(s => <option key={s} value={s}>{SIDE_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="Frequency from (Hz)">
              <input type="number" step="0.01" className="input" value={newSlab.freq_from_hz}
                onChange={e => setNewSlab({ ...newSlab, freq_from_hz: e.target.value })} placeholder="open below" />
            </Field>
            <Field label="Frequency to (Hz)">
              <input type="number" step="0.01" className="input" value={newSlab.freq_to_hz}
                onChange={e => setNewSlab({ ...newSlab, freq_to_hz: e.target.value })} placeholder="open above" />
            </Field>
            <Field label="Charge basis" required>
              <select className="input" value={newSlab.charge_basis} onChange={e => setNewSlab({ ...newSlab, charge_basis: e.target.value })}>
                <option value="FLAT">Flat (paise/kWh)</option>
                <option value="PCT_OF_REFERENCE">Percentage of a reference price</option>
              </select>
            </Field>
            {newSlab.charge_basis === 'PCT_OF_REFERENCE' && (
              <Field label="Reference price" required>
                <select className="input" value={newSlab.reference_price_key} onChange={e => setNewSlab({ ...newSlab, reference_price_key: e.target.value })}>
                  <option value="DAM_ACP">Day-ahead area clearing price</option>
                </select>
              </Field>
            )}
            <Field label={newSlab.charge_basis === 'FLAT' ? 'Rate (paise/kWh)' : 'Percentage'}>
              <input type="number" step="0.01" className="input" value={newSlab.charge_value}
                onChange={e => setNewSlab({ ...newSlab, charge_value: e.target.value })} placeholder="leave blank until notified" />
            </Field>
            <Field label="Cap (paise/kWh)">
              <input type="number" step="0.01" className="input" value={newSlab.cap_paise_per_kwh}
                onChange={e => setNewSlab({ ...newSlab, cap_paise_per_kwh: e.target.value })} />
            </Field>
            <Field label="Money moves" required>
              <select className="input" value={newSlab.settlement_sign} onChange={e => setNewSlab({ ...newSlab, settlement_sign: e.target.value })}>
                <option value={1}>Charge on the deviating party</option>
                <option value={-1}>Credit to the deviating party</option>
              </select>
            </Field>
            <Field label="Effective from" required>
              <input type="date" className="input" value={newSlab.effective_from}
                onChange={e => setNewSlab({ ...newSlab, effective_from: e.target.value })} required />
            </Field>
          </div>
          <Field label="Source">
            <input className="input" value={newSlab.source_note} onChange={e => setNewSlab({ ...newSlab, source_note: e.target.value })}
              placeholder="e.g. CERC DSM Regulations notification reference" />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
