import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { Card } from '../../components/ui.jsx';

function countCsvRows(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return Math.max(0, lines.length - 1);
}

/**
 * Shared ISET-style CSV uploader form.
 * @param {{
 *   kind: 'CHARGES'|'RLDC_SCHEDULE'|'REFUND'|'REFUND_LATEST',
 *   title: string,
 *   fields: Array<'dates'|'reading'|'charges_type'|'upload_type'|'rldc'>,
 * }} props
 */
export default function CsvUploaderForm({ kind, title, fields }) {
  const fileRef = useRef(null);
  const [meta, setMeta] = useState({ charges_types: [], upload_types: [], rldcs: [] });
  const [form, setForm] = useState({
    start_date: '',
    end_date: '',
    reading_date: '',
    revision_no: '',
    charges_type: '',
    upload_type: '',
    rldc: '',
  });
  const [fileName, setFileName] = useState('');
  const [rowCount, setRowCount] = useState(0);
  const [csvText, setCsvText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [recent, setRecent] = useState([]);

  function loadRecent() {
    api.csvUploads.list({ kind }).then(setRecent).catch(() => setRecent([]));
  }

  useEffect(() => {
    api.csvUploads.meta().then(setMeta).catch(() => {});
    loadRecent();
  }, [kind]);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) {
      setFileName('');
      setRowCount(0);
      setCsvText('');
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setCsvText(text);
      setRowCount(countCsvRows(text));
    };
    reader.readAsText(file);
  }

  async function downloadSample() {
    try {
      const blob = await api.csvUploads.downloadSample(kind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind.toLowerCase()}-sample.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Failed to download sample file.');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(null);
    if (!fileName || !csvText) {
      setError('Please choose a CSV file to upload.');
      return;
    }
    setBusy(true);
    try {
      const created = await api.csvUploads.create({
        upload_kind: kind,
        ...form,
        filename: fileName,
        row_count: rowCount,
      });
      setSuccess(created);
      setForm({
        start_date: '', end_date: '', reading_date: '', revision_no: '',
        charges_type: '', upload_type: '', rldc: '',
      });
      setFileName('');
      setRowCount(0);
      setCsvText('');
      if (fileRef.current) fileRef.current.value = '';
      loadRecent();
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  const show = (f) => fields.includes(f);

  return (
    <div style={{ padding: 20, maxWidth: 720, margin: '0 auto' }}>
      <Card>
        <form onSubmit={handleSubmit}>
          <div className="form-section-header" style={{ marginTop: 0 }}>{title}</div>

          <div style={{ display: 'grid', gap: 14, maxWidth: 520, margin: '0 auto' }}>
            {show('dates') && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', gap: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>
                    {kind.startsWith('REFUND') ? 'Starting Date' : 'Start Date'}
                    <span style={{ color: 'var(--red)' }}> *</span>
                  </label>
                  <input type="date" className="input" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} required />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', gap: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>
                    {kind.startsWith('REFUND') ? 'Ending Date' : 'End Date'}
                    <span style={{ color: 'var(--red)' }}> *</span>
                  </label>
                  <input type="date" className="input" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} required />
                </div>
              </>
            )}

            {show('reading') && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', gap: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Reading Date<span style={{ color: 'var(--red)' }}> *</span></label>
                  <input type="date" className="input" value={form.reading_date} onChange={(e) => set('reading_date', e.target.value)} required />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', gap: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Full schedule Revision No.<span style={{ color: 'var(--red)' }}> *</span></label>
                  <input className="input" value={form.revision_no} onChange={(e) => set('revision_no', e.target.value)} required />
                </div>
              </>
            )}

            {show('charges_type') && (
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Charges Type<span style={{ color: 'var(--red)' }}> *</span></label>
                <select className="input" value={form.charges_type} onChange={(e) => set('charges_type', e.target.value)} required>
                  <option value="">-- select an option --</option>
                  {(meta.charges_types || []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            {show('upload_type') && (
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Upload Type<span style={{ color: 'var(--red)' }}> *</span></label>
                <select className="input" value={form.upload_type} onChange={(e) => set('upload_type', e.target.value)} required>
                  <option value="">Select Upload Type</option>
                  {(meta.upload_types || []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            {show('rldc') && (
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Select RLDC<span style={{ color: 'var(--red)' }}> *</span></label>
                <select className="input" value={form.rldc} onChange={(e) => set('rldc', e.target.value)} required>
                  <option value="">-- select an option --</option>
                  {(meta.rldcs || []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'start', gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Upload CSV<span style={{ color: 'var(--red)' }}> *</span></label>
                <div style={{ marginTop: 8 }}>
                  <button type="button" onClick={downloadSample} style={{ background: 'none', border: 'none', color: '#1d4ed8', cursor: 'pointer', padding: 0, fontSize: 13 }}>
                    Download Sample File
                  </button>
                </div>
              </div>
              <div>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="input" onChange={onFileChange} required />
                {fileName && (
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                    {fileName} · {rowCount} data row{rowCount === 1 ? '' : 's'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {error && <div style={{ color: '#991b1b', background: '#fee2e2', padding: 10, borderRadius: 4, fontSize: 13, marginTop: 16 }}>{error}</div>}
          {success && (
            <div style={{ color: '#166534', background: '#dcfce7', padding: 10, borderRadius: 4, fontSize: 13, marginTop: 16 }}>
              Upload <strong>{success.id}</strong> submitted — {success.filename} ({success.row_count} rows).
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit'}</button>
          </div>
        </form>
      </Card>

      {recent.length > 0 && (
        <Card style={{ marginTop: 16 }}>
          <strong style={{ fontSize: 13 }}>Recent uploads</strong>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  {['Id', 'File', 'Rows', 'Status', 'Created'].map((h) => (
                    <th key={h} style={{ padding: '6px 8px', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.slice(0, 8).map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{r.id}</td>
                    <td style={{ padding: '6px 8px' }}>{r.filename}</td>
                    <td style={{ padding: '6px 8px' }}>{r.row_count}</td>
                    <td style={{ padding: '6px 8px' }}>{r.status}</td>
                    <td style={{ padding: '6px 8px' }}>{r.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
