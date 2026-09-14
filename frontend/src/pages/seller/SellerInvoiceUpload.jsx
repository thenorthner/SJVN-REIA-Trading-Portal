import React, { useMemo, useState } from 'react';
import api from '../../api/client.js';
import { Modal, Badge, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import { parseSheet } from '../../lib/sheetPaste.js';

// Raising a month of bills from the sheet they already live in.
//
// A generator with twenty PPAs raised twenty bills through the same form. Three
// steps, in the order the work actually happens: take the template, paste the
// filled sheet, check it, raise it. Each bill lands where the form would put it —
// a maker's as a draft for its own checker, anyone else's as submitted to SJVN —
// and is validated against SJVN's own figure for that period the same way.

export const INVOICE_COLUMNS = [
  'contract_no', 'billing_period', 'invoice_no', 'invoice_type',
  'energy_mwh', 'tariff_per_unit', 'energy_charges', 'transmission_charges',
  'rebate', 'lps', 'penalty', 'other_adjustments', 'taxes',
];
const NUMERIC = [
  'energy_mwh', 'tariff_per_unit', 'energy_charges', 'transmission_charges',
  'rebate', 'lps', 'penalty', 'other_adjustments', 'taxes',
];

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

export default function SellerInvoiceUpload({ open, onClose, onRaised }) {
  const [text, setText] = useState('');
  const [checked, setChecked] = useState(null);
  const [raised, setRaised] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const parsed = useMemo(() => parseSheet(text, { columns: INVOICE_COLUMNS, numeric: NUMERIC }), [text]);

  function onText(value) {
    setText(value);
    setChecked(null);
    setRaised(null);
    setError('');
  }

  async function takeTemplate() {
    setError('');
    try {
      download('seller_invoice_template.csv', await api.invoices.uploadTemplate());
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
    setRaised(null);
    try {
      setChecked(await api.invoices.upload(parsed.rows, true));
    } catch (err) {
      setError(err?.response?.data?.error || 'The check failed.');
      setChecked(null);
    } finally {
      setBusy(false);
    }
  }

  async function raise() {
    setBusy(true);
    setError('');
    try {
      const result = await api.invoices.upload(parsed.rows, false);
      setRaised(result);
      setChecked(null);
      if (result.successful > 0) onRaised?.(result);
    } catch (err) {
      setError(err?.response?.data?.error || 'The bills could not be raised.');
    } finally {
      setBusy(false);
    }
  }

  const errors = checked?.errors || raised?.errors || [];
  const canRaise = parsed.rows.length > 0 && checked && checked.failed === 0 && !busy;
  const total = (checked?.preview || []).reduce((a, r) => a + (r.total_amount || 0), 0);

  return (
    <Modal open={open} onClose={onClose} title="Raise invoices from a sheet" width={880}>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <ol style={{ margin: '0 0 16px', paddingLeft: 20, lineHeight: 1.9 }}>
        <li>
          Take the template —{' '}
          <button type="button" className="btn-link" onClick={takeTemplate}>seller_invoice_template.csv</button>
          {' '}— one bill per row, the contract named by its contract number.
        </li>
        <li>Paste the filled sheet below, or pick the saved file.</li>
        <li>Check it, then raise. Leave <code>invoice_no</code> blank to have it numbered for you.</li>
      </ol>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <input type="file" accept=".csv,.tsv,.txt" onChange={(e) => readFile(e.target.files?.[0])} aria-label="Choose a filled template" />
        {text && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onText('')}>Clear</button>}
      </div>

      <textarea
        className="input"
        rows={8}
        style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
        placeholder={'contract_no,billing_period,invoice_no,invoice_type,energy_mwh,…\nPPA/SOLAR/001,2026-08,,FINAL,1250.5,…'}
        value={text}
        onChange={(e) => onText(e.target.value)}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        <span className="report-count" style={{ margin: 0 }}>
          {parsed.rows.length === 0
            ? 'Nothing to raise yet.'
            : `${parsed.rows.length} ${parsed.rows.length === 1 ? 'bill' : 'bills'} read from the sheet.`}
        </span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!parsed.rows.length || busy} onClick={check}>
          {busy && !raised ? 'Checking…' : 'Check the sheet'}
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!canRaise} onClick={raise}>
          {parsed.rows.length && checked && checked.failed === 0
            ? `Raise ${checked.would_raise} ${checked.would_raise === 1 ? 'bill' : 'bills'}`
            : 'Raise'}
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

      {raised && (
        <div className={`alert alert-${raised.failed ? 'warning' : 'success'}`} style={{ marginTop: 12 }} role="status">
          Raised <strong>{raised.successful}</strong> of {raised.rows_received}
          {raised.invoices?.[0]?.status === 'DRAFT' ? ' as drafts for your checker' : ' and submitted to SJVN'}
          {raised.failed ? `; ${raised.failed} refused.` : '.'}
        </div>
      )}

      {checked && checked.failed === 0 && checked.would_raise > 0 && (
        <div className="alert alert-success" style={{ marginTop: 12 }} role="status">
          Every row is billable — {fmtCurrency(total)} across {checked.would_raise}{' '}
          {checked.would_raise === 1 ? 'bill' : 'bills'}. Nothing has been raised yet.
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h4 style={{ margin: '0 0 8px' }}>Rows that cannot be raised</h4>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 72 }}>Line</th>
                  <th scope="col">Contract</th>
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
          <h4 style={{ margin: '0 0 8px' }}>What would be raised</h4>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 72 }}>Line</th>
                  <th scope="col">Contract</th>
                  <th scope="col">Period</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="num">Energy (MWh)</th>
                  <th scope="col" className="num">Amount</th>
                  <th scope="col">Lands as</th>
                </tr>
              </thead>
              <tbody>
                {checked.preview.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.contract_no}</td>
                    <td>{row.billing_period}</td>
                    <td>{row.invoice_type}</td>
                    <td className="num">{fmtNumber(row.energy_mwh, 3)}</td>
                    <td className="num">{fmtCurrency(row.total_amount)}</td>
                    <td><Badge status={row.status}>{row.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {raised?.invoices?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h4 style={{ margin: '0 0 8px' }}>Raised</h4>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col">Invoice No</th>
                  <th scope="col" className="num">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col">Against SJVN&apos;s figure</th>
                </tr>
              </thead>
              <tbody>
                {raised.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.invoice_no}</td>
                    <td className="num">{fmtCurrency(inv.total_amount)}</td>
                    <td><Badge status={inv.status}>{inv.status}</Badge></td>
                    <td><Badge status={inv.validation_status}>{inv.validation_status}</Badge></td>
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
