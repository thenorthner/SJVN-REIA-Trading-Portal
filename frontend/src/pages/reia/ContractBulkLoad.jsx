import React, { useMemo, useState, useRef } from 'react';
import api from '../../api/client.js';
import { Modal, Badge } from '../../components/ui.jsx';
import { parseContractBulk } from './contractBulkPaste.js';
import { Download, UploadCloud, FileSpreadsheet, CheckCircle2, AlertCircle, Trash2, Sparkles, FileCheck } from 'lucide-react';

// Loading signed contracts from spreadsheet or direct paste.
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
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(null);
  const [checked, setChecked] = useState(null);   // the dry-run answer
  const [loaded, setLoaded] = useState(null);     // the commit answer
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const parsed = useMemo(() => parseContractBulk(text), [text]);

  const reset = () => { setChecked(null); setLoaded(null); setError(''); };

  function onText(value, name = '') {
    setText(value);
    if (name) setFileName(name);
    reset();
  }

  function handleClear() {
    setText('');
    setFileName('');
    setFileSize(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
    <Modal open={open} onClose={onClose} title="Load Contracts from Spreadsheet" width={880}>
      {error && (
        <div className="alert alert-error" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }} role="alert">
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

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
              Download official CSV template and fill 1 contract per row.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-xs"
            onClick={takeTemplate}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
          >
            <Download size={13} />
            <span>Download CSV Template</span>
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
            Drop or browse CSV file, or paste rows directly into the editor below.
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
            <strong style={{ fontSize: 14.5, color: 'var(--slate-800)' }}>Verify & Load</strong>
          </div>
          <p style={{ margin: 0, fontSize: 15, color: 'var(--slate-500)', lineHeight: 1.4 }}>
            Dry-run checks fields first. Every contract commits safely as a <strong>DRAFT</strong>.
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
        <div style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--t-blue-100) 0%, var(--t-blue-line) 100%)',
          color: 'var(--on-blue)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <UploadCloud size={24} />
        </div>
        {fileName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--t-blue-line)', padding: '6px 14px', borderRadius: 20, boxShadow: '0 2px 5px rgba(37,99,235,0.08)' }}>
            <FileSpreadsheet size={16} color="#2563eb" />
            <strong style={{ fontSize: 14.5, color: 'var(--on-blue)' }}>{fileName}</strong>
            {fileSize && <span style={{ fontSize: 14.5, color: 'var(--slate-500)' }}>({fileSize})</span>}
          </div>
        ) : (
          <div>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--slate-800)' }}>
              Choose a file or drag and drop
            </span>
            <span style={{ fontSize: 15, color: 'var(--slate-500)', display: 'block', marginTop: 2 }}>
              Supports CSV, TSV, or TXT spreadsheets
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
            <FileSpreadsheet size={14} color="#64748b" />
            <span>Spreadsheet CSV Data</span>
            {parsed.rows.length > 0 && (
              <span style={{ background: 'var(--t-blue-100)', color: 'var(--on-blue)', padding: '2px 8px', borderRadius: 12, fontSize: 14.5, fontWeight: 700 }}>
                {parsed.rows.length} {parsed.rows.length === 1 ? 'row' : 'rows'} detected
              </span>
            )}
          </div>
          {text && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={handleClear}
              style={{ color: 'var(--on-red)', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Trash2 size={12} />
              <span>Clear</span>
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
          placeholder={'contract_no,contract_type,project_type,seller_id,capacity_mw,tariff_per_unit,tenure\nPPA/SOLAR/001,PPA,SOLAR,SELL-0001,250,2.65,25 Years\nPPA/WIND/002,PPA,WIND,SELL-0002,150,3.10,25 Years'}
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
              ? 'Nothing to load yet.'
              : `${parsed.rows.length} ${parsed.rows.length === 1 ? 'row' : 'rows'} ready to validate.`}
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
            <CheckCircle2 size={14} color="#3b82f6" />
            <span>{busy && !loaded ? 'Validating…' : 'Check the Sheet'}</span>
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!canLoad}
            onClick={load}
            style={{ fontWeight: 600 }}
          >
            <Sparkles size={14} />
            <span>
              {parsed.rows.length && checked && checked.failed === 0
                ? `Load ${checked.would_load} ${checked.would_load === 1 ? 'Contract' : 'Contracts'}`
                : 'Load Contracts'}
            </span>
          </button>
        </div>
      </div>

      {/* Alerts & Results */}
      {parsed.unknownColumns.length > 0 && (
        <div className="alert alert-warning" style={{ marginTop: 14 }} role="status">
          These columns are not read and will be ignored: {parsed.unknownColumns.join(', ')}.
        </div>
      )}

      {parsed.errors.length > 0 && (
        <div className="alert alert-error" style={{ marginTop: 14 }} role="alert">
          <strong>The sheet could not be read in full:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {parsed.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      {loaded && (
        <div className={`alert alert-${loaded.failed ? 'warning' : 'success'}`} style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }} role="status">
          <CheckCircle2 size={16} />
          <span>
            Loaded <strong>{loaded.successful}</strong> of {loaded.rows_received} contracts as drafts
            {loaded.failed ? `; ${loaded.failed} refused.` : '.'}
          </span>
        </div>
      )}

      {checked && checked.failed === 0 && checked.would_load > 0 && (
        <div className="alert alert-success" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }} role="status">
          <CheckCircle2 size={16} />
          <span>Every row is valid and verified. Ready to commit into database.</span>
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 10px', fontSize: 14.5, color: 'var(--red-deep)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={15} />
            <span>Rows That Failed Validation</span>
          </h4>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 72 }}>Line</th>
                  <th scope="col">Contract No</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e, i) => (
                  <tr key={`${e.row}-${i}`}>
                    <td>{e.row}</td>
                    <td><strong style={{ color: 'var(--slate-800)' }}>{e.contract_no || '—'}</strong></td>
                    <td style={{ color: 'var(--red-strong)' }}>{e.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {checked?.preview?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 10px', fontSize: 14.5, color: 'var(--slate-800)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileCheck size={15} color="#059669" />
            <span>Validation Preview ({checked.preview.length} Rows)</span>
          </h4>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 60 }}>Line</th>
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
                    <td><strong>{row.contract_no}</strong></td>
                    <td>{row.contract_type}</td>
                    <td>{row.counterparty || '—'}</td>
                    <td className="num">{row.capacity_mw}</td>
                    <td className="num">{row.tariff_per_unit}</td>
                    <td>{row.tenure}</td>
                    <td><Badge status="DRAFT">Draft</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, borderTop: '1px solid var(--slate-200)', paddingTop: 14 }}>
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
