import React, { useMemo, useState } from 'react';
import api from '../../api/client.js';
import { Modal, Badge } from '../../components/ui.jsx';
import { parseContractBulk } from './contractBulkPaste.js';

// Loading signed contracts from the spreadsheet they already live in.
//
// The loader has been in the API for a while with nothing calling it, so a desk
// with fifty PPAs to enter typed fifty forms. Three steps, in the order the desk
// actually works: take the template, paste the filled sheet, and see what it
// would do before any of it is written. Rows load as DRAFT — going live is the
// lifecycle's job, which is where a contract's approvals are enforced.

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ContractBulkLoad({ open, onClose, onLoaded }) {
  const [text, setText] = useState('');
  const [checked, setChecked] = useState(null);   // the dry-run answer
  const [loaded, setLoaded] = useState(null);     // the commit answer
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const parsed = useMemo(() => parseContractBulk(text), [text]);

  const reset = () => { setChecked(null); setLoaded(null); setError(''); };

  function onText(value) {
    setText(value);
    reset();
  }

  async function takeTemplate() {
    setError('');
    try {
      download('contract_bulk_template.csv', await api.contracts.bulkTemplate());
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not download the template.');
    }
  }

  async function readFile(file) {
    if (!file) return;
    onText(await file.text());
  }

  async function check() {
    setBusy(true);
    setError('');
    setLoaded(null);
    try {
      setChecked(await api.contracts.bulkUpload(parsed.rows, true));
    } catch (err) {
      setError(err?.response?.data?.error || 'The check failed.');
      setChecked(null);
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    setBusy(true);
    setError('');
    try {
      const result = await api.contracts.bulkUpload(parsed.rows, false);
      setLoaded(result);
      setChecked(null);
      if (result.successful > 0) onLoaded?.(result);
    } catch (err) {
      setError(err?.response?.data?.error || 'The load failed.');
    } finally {
      setBusy(false);
    }
  }

  const errors = checked?.errors || loaded?.errors || [];
  const canLoad = parsed.rows.length > 0 && checked && checked.failed === 0 && !busy;

  return (
    <Modal open={open} onClose={onClose} title="Load contracts from a spreadsheet" width={860}>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <ol style={{ margin: '0 0 16px', paddingLeft: 20, lineHeight: 1.9 }}>
        <li>
          Take the template —{' '}
          <button type="button" className="btn-link" onClick={takeTemplate}>contract_bulk_template.csv</button>
          {' '}— and fill one contract per row.
        </li>
        <li>Paste the filled sheet below, or pick the saved file.</li>
        <li>Check it, then load. Every row arrives as a <strong>DRAFT</strong>.</li>
      </ol>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <input
          type="file"
          accept=".csv,.tsv,.txt"
          onChange={(e) => readFile(e.target.files?.[0])}
          aria-label="Choose a filled template"
        />
        {text && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onText('')}>Clear</button>
        )}
      </div>

      <textarea
        className="input"
        rows={8}
        style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
        placeholder={'contract_no,contract_type,project_type,seller_id,…\nPPA/SOLAR/001,PPA,SOLAR,SELL-0001,…'}
        value={text}
        onChange={(e) => onText(e.target.value)}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        <span className="report-count" style={{ margin: 0 }}>
          {parsed.rows.length === 0
            ? 'Nothing to load yet.'
            : `${parsed.rows.length} ${parsed.rows.length === 1 ? 'row' : 'rows'} read from the sheet.`}
        </span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!parsed.rows.length || busy} onClick={check}>
          {busy && !loaded ? 'Checking…' : 'Check the sheet'}
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!canLoad} onClick={load}>
          {parsed.rows.length && checked && checked.failed === 0
            ? `Load ${checked.would_load} ${checked.would_load === 1 ? 'contract' : 'contracts'}`
            : 'Load'}
        </button>
      </div>

      {parsed.unknownColumns.length > 0 && (
        <div className="alert alert-warning" style={{ marginTop: 12 }} role="status">
          These columns are not read and will be ignored: {parsed.unknownColumns.join(', ')}.
        </div>
      )}

      {parsed.errors.length > 0 && (
        <div className="alert alert-error" style={{ marginTop: 12 }} role="alert">
          <strong>The sheet could not be read in full:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {parsed.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      {loaded && (
        <div className={`alert alert-${loaded.failed ? 'warning' : 'success'}`} style={{ marginTop: 12 }} role="status">
          Loaded <strong>{loaded.successful}</strong> of {loaded.rows_received} as drafts
          {loaded.failed ? `; ${loaded.failed} refused.` : '.'}
        </div>
      )}

      {checked && checked.failed === 0 && checked.would_load > 0 && (
        <div className="alert alert-success" style={{ marginTop: 12 }} role="status">
          Every row is loadable. Nothing has been written yet.
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h4 style={{ margin: '0 0 8px' }}>Rows that cannot load</h4>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 72 }}>Line</th>
                  <th scope="col">Contract No</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e, i) => (
                  <tr key={`${e.row}-${i}`}>
                    <td>{e.row}</td>
                    <td>{e.contract_no || '—'}</td>
                    <td>{e.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {checked?.preview?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h4 style={{ margin: '0 0 8px' }}>What would load</h4>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 72 }}>Line</th>
                  <th scope="col">Contract No</th>
                  <th scope="col">Type</th>
                  <th scope="col">Counterparty</th>
                  <th scope="col" className="num">Capacity (MW)</th>
                  <th scope="col" className="num">Tariff (Rs/kWh)</th>
                  <th scope="col">Tenure</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {checked.preview.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.contract_no}</td>
                    <td>{row.contract_type}</td>
                    <td>{row.counterparty || '—'}</td>
                    <td className="num">{row.capacity_mw}</td>
                    <td className="num">{row.tariff_per_unit}</td>
                    <td>{row.tenure}</td>
                    <td><Badge status="DRAFT">DRAFT</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
