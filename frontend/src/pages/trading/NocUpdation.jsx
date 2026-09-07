import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';

// NOC Updation (ERP).
//
// ISET's screen is a standing-clearance entry form: the header identifies the
// client and the RLDC/SLDC that issued the NOC, and the order grid beneath it
// carries the injection/drawal blocks the NOC actually clears. A clearance with
// no blocks under it schedules nothing, so the form will not submit without at
// least one line, and the register below shows what has been entered.

const BLOCKS = Array.from({ length: 96 }, (_, i) => {
  const m = i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});
const HOUR_OPTIONS = [...BLOCKS, '24:00'];

const EMPTY_HEADER = {
  client_name: '', client_id: '', noar_id: '', issuing_authority: '',
  noc_reference_no: '', noc_valid_from: '', noc_valid_to: '',
};

const emptyLine = () => ({
  direction: 'INJECTION', energy_source: 'CONVENTIONAL',
  valid_from: '', valid_to: '', hour_from: '00:00', hour_to: '00:15', quantum_mw: '',
});

const title = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');

export default function NocUpdation() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [header, setHeader] = useState(EMPTY_HEADER);
  const [lines, setLines] = useState([emptyLine()]);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const list = await api.nocUpdation.list();
      setRows(list);
      setError('');
    } catch (e) {
      setError(e?.message || 'Failed to load the NOC register');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { api.nocUpdation.meta().then(setMeta).catch(() => setMeta(null)); }, []);

  const setH = (k, v) => setHeader((f) => ({ ...f, [k]: v }));
  const setL = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i) => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)));

  function openForm() {
    setHeader(EMPTY_HEADER);
    setLines([emptyLine()]);
    setFormError('');
    setShowForm(true);
  }

  // Picking a known client fills the ids the NOC is filed against.
  function pickClient(name) {
    setH('client_name', name);
    const c = (meta?.clients || []).find((x) => x.client_name === name);
    if (c) {
      setHeader((f) => ({ ...f, client_name: name, client_id: c.id, noar_id: c.noar_id || f.noar_id }));
    }
  }

  async function submit(e) {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      await api.nocUpdation.create({
        ...header,
        orders: lines.map((l) => ({ ...l, quantum_mw: Number(l.quantum_mw) })),
      });
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err?.message || 'Could not save this NOC');
    } finally {
      setSaving(false);
    }
  }

  async function cancelNoc(id) {
    try {
      await api.nocUpdation.cancel(id, {});
      setDetail(null);
      await load();
    } catch (err) {
      setError(err?.message || 'Could not cancel this NOC');
    }
  }

  const columns = useMemo(() => [
    { key: 'noc_reference_no', label: 'NOC Reference No.' },
    { key: 'client_name', label: 'Client Name' },
    { key: 'noar_id', label: 'NOAR Id' },
    { key: 'issuing_authority', label: 'Issuing RLDC / SLDC' },
    { key: 'noc_valid_from', label: 'Valid From' },
    { key: 'noc_valid_to', label: 'Valid To' },
    { key: 'order_count', label: 'Orders' },
    { key: 'total_quantum_mw', label: 'Total MW', render: (r) => fmtNumber(r.total_quantum_mw, 2) },
    { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
  ], []);

  return (
    <div className="page">
      <PageHeader
        title="NOC Updation"
        subtitle="Standing clearances issued by an RLDC or SLDC, and the blocks each one clears."
        onAdd={openForm}
        addLabel="New NOC"
      />

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <Card title="NOC Register">
        <Table
          columns={columns}
          rows={rows}
          loading={loading}
          emptyMessage="No NOC has been entered yet."
          onRowClick={(r) => api.nocUpdation.get(r.id).then(setDetail).catch(() => {})}
        />
      </Card>

      <Modal open={showForm} onClose={() => setShowForm(false)} title="NOC Updation" width={1100}>
        <form onSubmit={submit}>
          <h4 style={{ margin: '0 0 12px' }}>Standing Clearance</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <Field label="Client Name" required>
              <input
                className="input" list="noc-client-names" required
                value={header.client_name}
                onChange={(e) => pickClient(e.target.value)}
              />
              <datalist id="noc-client-names">
                {(meta?.clients || []).map((c) => <option key={c.id} value={c.client_name} />)}
              </datalist>
            </Field>
            <Field label="Client Id" required>
              <input
                className="input" required placeholder="client id of seller"
                value={header.client_id}
                onChange={(e) => setH('client_id', e.target.value)}
              />
            </Field>
            <Field label="NOAR Id" required>
              <input className="input" required value={header.noar_id} onChange={(e) => setH('noar_id', e.target.value)} />
            </Field>
            <Field label="Name of the RLDC / SLDC issuing NOC" required>
              <select
                className="input" required
                value={header.issuing_authority}
                onChange={(e) => setH('issuing_authority', e.target.value)}
              >
                <option value="">-- select an option --</option>
                {(meta?.issuing_authorities || []).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="NOC Reference Number" required>
              <input className="input" required value={header.noc_reference_no} onChange={(e) => setH('noc_reference_no', e.target.value)} />
            </Field>
            <Field label="NOC Validity From Date" required>
              <input type="date" className="input" required value={header.noc_valid_from} onChange={(e) => setH('noc_valid_from', e.target.value)} />
            </Field>
            <Field label="NOC Validity To Date" required>
              <input type="date" className="input" required value={header.noc_valid_to} onChange={(e) => setH('noc_valid_to', e.target.value)} />
            </Field>
          </div>

          <h4 style={{ margin: '20px 0 12px' }}>Order Details</h4>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th rowSpan={2}>Injection/Drawal</th>
                  <th rowSpan={2}>Energy Source</th>
                  <th colSpan={2} style={{ textAlign: 'center' }}>Validity of NOC</th>
                  <th colSpan={2} style={{ textAlign: 'center' }}>Hours</th>
                  <th style={{ textAlign: 'center' }}>Quantum</th>
                  <th rowSpan={2}>
                    <button type="button" className="btn btn-sm" onClick={addLine} aria-label="Add order line">+</button>
                  </th>
                </tr>
                <tr>
                  <th>From *</th>
                  <th>To *</th>
                  <th>From *</th>
                  <th>To *</th>
                  <th>MW *</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select className="input" value={l.direction} onChange={(e) => setL(i, 'direction', e.target.value)}>
                        {(meta?.directions || ['INJECTION', 'DRAWAL']).map((d) => <option key={d} value={d}>{title(d)}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="input" value={l.energy_source} onChange={(e) => setL(i, 'energy_source', e.target.value)}>
                        {(meta?.energy_sources || ['CONVENTIONAL', 'RENEWABLE']).map((s) => <option key={s} value={s}>{title(s)}</option>)}
                      </select>
                    </td>
                    <td><input type="date" className="input" required value={l.valid_from} onChange={(e) => setL(i, 'valid_from', e.target.value)} /></td>
                    <td><input type="date" className="input" required value={l.valid_to} onChange={(e) => setL(i, 'valid_to', e.target.value)} /></td>
                    <td>
                      <select className="input" value={l.hour_from} onChange={(e) => setL(i, 'hour_from', e.target.value)}>
                        {BLOCKS.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="input" value={l.hour_to} onChange={(e) => setL(i, 'hour_to', e.target.value)}>
                        {HOUR_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number" step="0.01" min="0" className="input" required
                        value={l.quantum_mw} onChange={(e) => setL(i, 'quantum_mw', e.target.value)}
                      />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn btn-sm" onClick={addLine} aria-label="Add order line">+</button>
                      <button
                        type="button" className="btn btn-sm btn-danger" style={{ marginLeft: 6 }}
                        onClick={() => removeLine(i)} disabled={lines.length === 1}
                        aria-label="Remove order line"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {formError && <div className="alert alert-error" style={{ marginTop: 12 }}>{formError}</div>}

          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn" onClick={() => setShowForm(false)}>Close</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Submitting…' : 'Submit'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `NOC ${detail.noc_reference_no}` : ''} width={900}>
        {detail && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
              <div><div className="field-label">Client</div>{detail.client_name}</div>
              <div><div className="field-label">Client Id</div>{detail.client_id}</div>
              <div><div className="field-label">NOAR Id</div>{detail.noar_id}</div>
              <div><div className="field-label">Issuing RLDC / SLDC</div>{detail.issuing_authority}</div>
              <div><div className="field-label">Validity</div>{detail.noc_valid_from} → {detail.noc_valid_to}</div>
              <div><div className="field-label">Status</div><Badge status={detail.status} /></div>
            </div>
            <Table
              columns={[
                { key: 'line_no', label: '#' },
                { key: 'direction', label: 'Injection/Drawal', render: (r) => title(r.direction) },
                { key: 'energy_source', label: 'Energy Source', render: (r) => title(r.energy_source) },
                { key: 'valid_from', label: 'From' },
                { key: 'valid_to', label: 'To' },
                { key: 'hours', label: 'Hours', render: (r) => `${r.hour_from} – ${r.hour_to}` },
                { key: 'quantum_mw', label: 'MW', render: (r) => fmtNumber(r.quantum_mw, 2) },
              ]}
              rows={detail.orders || []}
              emptyMessage="No order lines on this NOC."
            />
            {detail.status === 'ACTIVE' && (
              <div style={{ marginTop: 16, textAlign: 'right' }}>
                <button className="btn btn-danger" onClick={() => cancelNoc(detail.id)}>Cancel this NOC</button>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
