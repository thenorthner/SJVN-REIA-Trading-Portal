import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { Card } from '../../components/ui.jsx';

const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

function yearOptions() {
  const now = new Date().getFullYear();
  const years = [];
  for (let y = now + 1; y >= 2018; y -= 1) years.push(y);
  return years;
}

/**
 * ISET MMR Report Uploader — Month / Year / Excel file.
 */
export default function MmrExcelUploader() {
  const fileRef = useRef(null);
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [recent, setRecent] = useState([]);

  function loadRecent() {
    api.csvUploads.list({ kind: 'MMR_EXCEL' }).then(setRecent).catch(() => setRecent([]));
  }

  useEffect(loadRecent, []);

  function onFileChange(e) {
    const file = e.target.files?.[0];
    setFileName(file?.name || '');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(null);
    if (!month || !year) {
      setError('Month and year are required.');
      return;
    }
    if (!fileName) {
      setError('Please choose an Excel file to upload.');
      return;
    }
    setBusy(true);
    try {
      const created = await api.csvUploads.create({
        upload_kind: 'MMR_EXCEL',
        month: Number(month),
        year: Number(year),
        filename: fileName,
        row_count: 0,
        notes: 'Excel workbook accepted (row parse deferred)',
      });
      setSuccess(created);
      setMonth('');
      setYear('');
      setFileName('');
      if (fileRef.current) fileRef.current.value = '';
      loadRecent();
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 720, margin: '0 auto' }}>
      <Card>
        <form onSubmit={handleSubmit}>
          <div className="form-section-header" style={{ marginTop: 0 }}>MMR Report Uploader</div>

          <div style={{ display: 'grid', gap: 14, maxWidth: 480, margin: '0 auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'center', gap: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                Month<span style={{ color: 'var(--red)' }}> *</span>
              </label>
              <select className="input" value={month} onChange={(e) => setMonth(e.target.value)} required>
                <option value="">---- Select ----</option>
                {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'center', gap: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                year<span style={{ color: 'var(--red)' }}> *</span>
              </label>
              <select className="input" value={year} onChange={(e) => setYear(e.target.value)} required>
                <option value="">---- Select ----</option>
                {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'center', gap: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                Upload Excel<span style={{ color: 'var(--red)' }}> *</span>
              </label>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="input"
                  onChange={onFileChange}
                  required
                />
                {fileName && <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>{fileName}</div>}
              </div>
            </div>
          </div>

          {error && <div style={{ color: '#991b1b', background: '#fee2e2', padding: 10, borderRadius: 4, fontSize: 13, marginTop: 16 }}>{error}</div>}
          {success && (
            <div style={{ color: '#166534', background: '#dcfce7', padding: 10, borderRadius: 4, fontSize: 13, marginTop: 16 }}>
              Upload <strong>{success.id}</strong> submitted — {success.filename}
              {success.revision_no ? ` · period ${success.revision_no}` : ''}.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit'}</button>
          </div>
        </form>
      </Card>

      {recent.length > 0 && (
        <Card style={{ marginTop: 16 }}>
          <strong style={{ fontSize: 13 }}>Recent MMR uploads</strong>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  {['Id', 'Period', 'File', 'Status', 'Created'].map((h) => (
                    <th key={h} style={{ padding: '6px 8px', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.slice(0, 8).map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{r.id}</td>
                    <td style={{ padding: '6px 8px' }}>{r.revision_no || '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{r.filename}</td>
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
