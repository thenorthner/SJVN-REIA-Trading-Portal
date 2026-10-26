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

// No penalty column: a penalty is SJVN's to assess on the developer, not the
// developer's to enter on its own bill (decided 17-Oct-2026).
export const INVOICE_COLUMNS = [
  'contract_no', 'billing_period', 'invoice_no', 'invoice_type',
  'energy_mwh', 'tariff_per_unit', 'energy_charges', 'transmission_charges',
  'rebate', 'lps', 'other_adjustments', 'taxes',
];
const NUMERIC = [
  'energy_mwh', 'tariff_per_unit', 'energy_charges', 'transmission_charges',
  'rebate', 'lps', 'other_adjustments', 'taxes',
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

  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = React.useRef(null);

  const parsed = useMemo(() => parseSheet(text, { columns: INVOICE_COLUMNS, numeric: NUMERIC }), [text]);

  function onText(value, name = '') {
    setText(value);
    if (name) setFileName(name);
    setChecked(null);
    setRaised(null);
    setError('');
  }

  function handleClear() {
    setText('');
    setFileName('');
    setFileSize(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
    setFileName(file.name);
    setFileSize((file.size / 1024).toFixed(1) + ' KB');
    onText(await file.text(), file.name);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) readFile(droppedFile);
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
    <Modal open={open} onClose={onClose} title="Raise Invoices from Spreadsheet" width={880}>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {/* Modern Workflow Step Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <div style={{
          background: 'linear-gradient(135deg, var(--slate-50) 0%, var(--slate-100) 100%)',
          border: '1px solid var(--slate-200)',
          borderRadius: 10,
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 10
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{
                background: '#2563eb', color: '#fff', width: 20, height: 20, borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14.5, fontWeight: 700
              }}>1</span>
              <strong style={{ fontSize: 14.5, color: 'var(--slate-800)' }}>Template</strong>
            </div>
            <p style={{ margin: 0, fontSize: 15, color: 'var(--slate-500)', lineHeight: 1.4 }}>
              Download official CSV template, 1 bill per row with contract number.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-xs"
            onClick={takeTemplate}
            style={{ alignSelf: 'flex-start', fontWeight: 600 }}
          >
            Download CSV Template
          </button>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, var(--slate-50) 0%, var(--slate-100) 100%)',
          border: '1px solid var(--slate-200)',
          borderRadius: 10,
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              background: '#0284c7', color: '#fff', width: 20, height: 20, borderRadius: '50%',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14.5, fontWeight: 700
            }}>2</span>
            <strong style={{ fontSize: 14.5, color: 'var(--slate-800)' }}>Input Data</strong>
          </div>
          <p style={{ margin: 0, fontSize: 15, color: 'var(--slate-500)', lineHeight: 1.4 }}>
            Drop or browse CSV file, or paste spreadsheet rows into the editor.
          </p>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, var(--slate-50) 0%, var(--slate-100) 100%)',
          border: '1px solid var(--slate-200)',
          borderRadius: 10,
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              background: '#059669', color: '#fff', width: 20, height: 20, borderRadius: '50%',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14.5, fontWeight: 700
            }}>3</span>
            <strong style={{ fontSize: 14.5, color: 'var(--slate-800)' }}>Verify & Raise</strong>
          </div>
          <p style={{ margin: 0, fontSize: 15, color: 'var(--slate-500)', lineHeight: 1.4 }}>
            Check validation against SJVN records. Invoices are raised reliably.
          </p>
        </div>
      </div>

      {/* Interactive Dropzone Card */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${isDragging ? '#2563eb' : 'var(--slate-300)'}`,
          backgroundColor: isDragging ? 'var(--t-blue-50)' : 'var(--slate-50)',
          borderRadius: 12,
          padding: '18px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          marginBottom: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt"
          onChange={(e) => readFile(e.target.files?.[0])}
          style={{ display: 'none' }}
        />
        {fileName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--t-blue-line)', padding: '6px 14px', borderRadius: 20, boxShadow: '0 2px 5px rgba(37,99,235,0.08)' }}>
            <strong style={{ fontSize: 14.5, color: 'var(--on-blue)' }}>{fileName}</strong>
            {fileSize && <span style={{ fontSize: 14.5, color: 'var(--slate-500)' }}>({fileSize})</span>}
          </div>
        ) : (
          <div>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--slate-800)' }}>
              Choose a file or drag and drop
            </span>
            <span style={{ fontSize: 15, color: 'var(--slate-500)', display: 'block', marginTop: 2 }}>
              Supports CSV, TSV, or TXT invoice sheets
            </span>
          </div>
        )}
      </div>

      {/* Direct Paste Container */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--slate-200)',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        marginBottom: 16
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          background: 'var(--slate-50)',
          borderBottom: '1px solid var(--slate-200)',
          fontSize: 15
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--slate-600)', fontWeight: 600 }}>
            <span>Spreadsheet CSV Data</span>
            {parsed.rows.length > 0 && (
              <span style={{ background: 'var(--t-blue-100)', color: 'var(--on-blue)', padding: '2px 8px', borderRadius: 12, fontSize: 14.5, fontWeight: 700 }}>
                {parsed.rows.length} {parsed.rows.length === 1 ? 'bill' : 'bills'} detected
              </span>
            )}
          </div>
          {text && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={handleClear}
              style={{ color: 'var(--on-red)' }}
            >
              Clear
            </button>
          )}
        </div>
        <textarea
          rows={7}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          wrap="off"
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            padding: '12px 14px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 15,
            lineHeight: 1.6,
            color: 'var(--slate-800)',
            background: 'var(--surface)',
            boxSizing: 'border-box',
            resize: 'vertical',
            whiteSpace: 'pre',
            overflowX: 'auto',
          }}
          placeholder={'contract_no,billing_period,invoice_no,invoice_type,energy_mwh,…\nPPA/SOLAR/001,2026-08,,FINAL,1250.5,…'}
          value={text}
          onChange={(e) => onText(e.target.value)}
        />
      </div>

      {/* Action Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 16px',
        background: 'linear-gradient(135deg, var(--slate-50) 0%, var(--slate-100) 100%)',
        border: '1px solid var(--slate-200)',
        borderRadius: 10,
        flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: parsed.rows.length === 0 ? '#94a3b8' : (checked && checked.failed === 0 ? '#10b981' : '#3b82f6')
          }} />
          <span style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--slate-700)' }}>
            {parsed.rows.length === 0
              ? 'Nothing to raise yet.'
              : `${parsed.rows.length} ${parsed.rows.length === 1 ? 'bill' : 'bills'} ready to validate.`}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!parsed.rows.length || busy}
            onClick={check}
            style={{ fontWeight: 600 }}
          >
            {busy && !raised ? 'Checking…' : 'Check the Sheet'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!canRaise}
            onClick={raise}
            style={{ fontWeight: 600 }}
          >
            {parsed.rows.length && checked && checked.failed === 0
              ? `Raise ${checked.would_raise} ${checked.would_raise === 1 ? 'Bill' : 'Bills'}`
              : 'Raise Invoices'}
          </button>
        </div>
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
