import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { Table, Badge, Field, fmtNumber } from './ui.jsx';

// Energy for a month from the account that states it — a JMR, the SLDC's state
// energy account, an RLDC statement — read from the document's table. These
// were typed into the energy screen one figure at a time.
//
// The file is always read first and shown back: which contract each row landed
// on, what it will create or replace, and what was left alone and why. Nothing
// is written until the desk has seen that.

const ACTION_TONE = { CREATED: 'success', REPLACED: 'warning', SKIPPED: 'neutral' };
const ACTION_LABEL = { CREATED: 'New', REPLACED: 'Replaces draft', SKIPPED: 'Left alone' };

const FALLBACK_TYPES = [
  { key: 'JMR', label: 'Joint meter reading' },
  { key: 'SEA', label: 'State energy account (SLDC)' },
  { key: 'RLDC', label: 'RLDC statement' },
];
const FALLBACK_UNITS = [
  { key: 'MWH', label: 'MWh' },
  { key: 'MU', label: 'MU (million units)' },
  { key: 'KWH', label: 'kWh' },
  { key: 'LU', label: 'LU (lakh units)' },
  { key: 'GWH', label: 'GWh' },
];

export default function EnergyAccountUpload({ onDone, onCancel }) {
  const [meta, setMeta] = useState({ account_types: FALLBACK_TYPES, units: FALLBACK_UNITS });
  const [form, setForm] = useState({ account_type: 'JMR', unit: '', period_month: '', data_type: 'PROVISIONAL' });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.energyData.accountTypes().then(setMeta).catch(() => {});
  }, []);

  const fields = () => ({
    account_type: form.account_type,
    unit: form.unit,
    period_month: form.period_month,
    data_type: form.data_type,
  });

  const failure = (err, fallback) => {
    const body = err?.response?.data;
    return body?.errors?.length ? body.errors : [body?.error || fallback];
  };

  async function check(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setErrors([]);
    setPreview(null);
    try {
      setPreview(await api.energyData.uploadAccount(file, fields(), true));
    } catch (err) {
      setErrors(failure(err, 'The file could not be read.'));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setErrors([]);
    try {
      const done = await api.energyData.uploadAccount(file, fields(), false);
      onDone?.(done);
    } catch (err) {
      setErrors(failure(err, 'The import failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function template() {
    try {
      const blob = await api.energyData.accountTemplate(form.account_type);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${form.account_type.toLowerCase()}_energy_template.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setErrors(['Could not fetch the template.']);
    }
  }

  const writes = preview ? preview.created + preview.replaced : 0;

  return (
    <div>
      {errors.length > 0 && (
        <div className="form-error" role="alert">
          {errors.length === 1 ? errors[0] : <ul style={{ margin: 0, paddingLeft: 18 }}>{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
        </div>
      )}

      {!preview ? (
        <form onSubmit={check}>
          <div className="form-grid">
            <Field label="Account">
              <select value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value })}>
                {meta.account_types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Energy is stated in">
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                <option value="">As the file says (heading or Unit column)</option>
                {meta.units.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Period (if the file has no period column)">
              <input type="month" value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} />
            </Field>
            <Field label="Data type">
              <select value={form.data_type} onChange={(e) => setForm({ ...form, data_type: e.target.value })}>
                <option value="PROVISIONAL">Provisional</option>
                <option value="FINAL">Final</option>
              </select>
            </Field>
          </div>
          <Field label="Account table (CSV or Excel)">
            <input type="file" accept=".csv,.xlsx,.xls" aria-label="Account file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
          <p className="inline-note">
            A state energy account states energy in MUs and a JMR usually in MWh — the same number is a thousand
            times apart. If neither the column heading nor a Unit column says which, choose it above; a file that
            says nothing is refused rather than read at a guessed scale.{' '}
            <button type="button" className="btn btn-xs btn-ghost" onClick={template}>Download template</button>
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!file || busy}>{busy ? 'Reading…' : 'Check file'}</button>
          </div>
        </form>
      ) : (
        <div>
          <div className="audit-alert" style={{ marginBottom: 12 }}>
            <strong>{preview.account_label}</strong>, {fmtNumber(preview.rows_read, 0)} row(s) read.
            {' '}Energy read in <strong>{preview.unit_used === 'per row' ? 'each row’s own unit' : preview.unit_used}</strong>
            {preview.unit_from !== 'each row' ? `, taken from ${preview.unit_from}` : ''}.
            {' '}{fmtNumber(preview.created, 0)} new, {fmtNumber(preview.replaced, 0)} replacing a draft, {fmtNumber(preview.skipped, 0)} left alone.
          </div>

          {preview.errors?.length > 0 && (
            <div className="form-error">
              Rows that could not be read:
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{preview.errors.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
          {preview.unmapped_columns?.length > 0 && (
            <p className="inline-note">Columns not read: {preview.unmapped_columns.join(', ')}.</p>
          )}

          <Table
            columns={[
              { key: 'row_no', header: 'Row' },
              { key: 'station', header: 'Station', render: (r) => r.station || '—' },
              { key: 'contract', header: 'Contract', render: (r) => r.matched_contract_no || r.contract_no || '—' },
              { key: 'period_month', header: 'Period' },
              // Exactly as the document states it: an SEA gives MUs to seven places,
              // and rounding 81.61638 MU to 81.6 would hide 16 MWh.
              { key: 'energy_value', header: 'As stated', render: (r) => `${fmtNumber(r.energy_value, 7)} ${r.unit}` },
              { key: 'energy_mwh', header: 'MWh', render: (r) => fmtNumber(r.energy_mwh, 3) },
              {
                key: 'action',
                header: '',
                render: (r) => (
                  <span>
                    <Badge type={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action] || r.action}</Badge>
                    {r.action === 'REPLACED' && r.changed && <span className="inline-note" style={{ marginLeft: 6 }}>was {fmtNumber(r.was_energy_mwh, 3)} MWh</span>}
                    {r.reason && <div className="inline-note" style={{ marginTop: 4 }}>{r.reason}</div>}
                  </span>
                ),
              },
            ]}
            rows={preview.rows.map((r) => ({ ...r, id: `row-${r.row_no}` }))}
          />

          <div className="form-actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setPreview(null)}>Back</button>
            <button type="button" className="btn btn-primary" onClick={commit} disabled={busy || writes === 0}>
              {busy ? 'Importing…' : writes === 0 ? 'Nothing to import' : `Import ${writes} row(s)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
