import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { Card } from '../../components/ui.jsx';
import { 
  UploadCloud, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  ChevronRight, 
  Download, 
  Calendar, 
  Tag, 
  MapPin, 
  FileText 
} from 'lucide-react';

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
  const [file, setFile] = useState(null);
  const [rowCount, setRowCount] = useState(0);
  const [csvText, setCsvText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [recent, setRecent] = useState([]);
  const [isDragging, setIsDragging] = useState(false);

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

  function handleFileSelection(selectedFile) {
    if (!selectedFile) {
      setFile(null);
      setRowCount(0);
      setCsvText('');
      return;
    }
    
    if (!selectedFile.name.endsWith('.csv')) {
      setError('Please upload a valid CSV file (.csv)');
      return;
    }

    setFile(selectedFile);
    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setCsvText(text);
      setRowCount(countCsvRows(text));
    };
    reader.readAsText(selectedFile);
  }

  function onFileChange(e) {
    handleFileSelection(e.target.files?.[0]);
  }

  const onDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

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
    if (!file || !csvText) {
      setError('Please choose a CSV file to upload.');
      return;
    }
    setBusy(true);
    try {
      const created = await api.csvUploads.create({
        upload_kind: kind,
        ...form,
        filename: file.name,
        row_count: rowCount,
      });
      setSuccess(created);
      setForm({
        start_date: '', end_date: '', reading_date: '', revision_no: '',
        charges_type: '', upload_type: '', rldc: '',
      });
      setFile(null);
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

  const getStatusColor = (status) => {
    switch (status?.toUpperCase()) {
      case 'SUBMITTED': return { bg: '#dbeafe', text: '#1e40af' };
      case 'PROCESSED': return { bg: '#dcfce7', text: '#166534' };
      case 'FAILED': return { bg: '#fee2e2', text: '#991b1b' };
      default: return { bg: '#f1f5f9', text: '#475569' };
    }
  };

  return (
    <div style={{ padding: '2rem 1rem', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ 
        background: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(12px)',
        borderRadius: '16px',
        boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.05)',
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.4)',
        position: 'relative'
      }}>
        {/* Top gradient accent */}
        <div style={{ height: 4, width: '100%', background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)' }}></div>
        
        <form onSubmit={handleSubmit} style={{ padding: '2rem 2.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: '#eff6ff', padding: 8, borderRadius: 8 }}>
                <FileText size={20} color="#3b82f6" />
              </div>
              {title}
            </h3>
            <button 
              type="button" 
              onClick={downloadSample} 
              style={{ 
                background: '#f8fafc', 
                border: '1px solid #e2e8f0', 
                color: '#3b82f6', 
                cursor: 'pointer', 
                padding: '8px 16px', 
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.2s'
              }}
              onMouseOver={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.borderColor = '#bfdbfe'; }}
              onMouseOut={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
            >
              <Download size={14} /> Download Sample
            </button>
          </div>

          {error && (
            <div className="animate-fade-in-up" style={{ marginBottom: 24, padding: 16, backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444', color: '#991b1b', borderRadius: '4px 8px 8px 4px', fontSize: 14, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <AlertCircle size={20} style={{ flexShrink: 0, marginTop: 2 }} color="#dc2626" />
              <div style={{ fontWeight: 500 }}>{error}</div>
            </div>
          )}
          
          {success && (
            <div className="animate-fade-in-up" style={{ marginBottom: 24, padding: 16, backgroundColor: '#f0fdf4', borderLeft: '4px solid #22c55e', color: '#166534', borderRadius: '4px 8px 8px 4px', fontSize: 14, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <CheckCircle2 size={20} style={{ flexShrink: 0, marginTop: 2 }} color="#16a34a" />
              <div>
                <div style={{ fontWeight: 600 }}>Upload Successful ({success.id})</div>
                <div style={{ marginTop: 4, fontSize: 13, color: '#15803d' }}>Processed {success.filename} with {success.row_count} rows.</div>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>
            {show('dates') && (
              <>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
                    <Calendar size={14} /> {kind.startsWith('REFUND') ? 'Starting Date' : 'Start Date'} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input 
                    type="date" 
                    className="input" 
                    value={form.start_date} 
                    onChange={(e) => set('start_date', e.target.value)} 
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', outline: 'none' }}
                    required 
                  />
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
                    <Calendar size={14} /> {kind.startsWith('REFUND') ? 'Ending Date' : 'End Date'} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input 
                    type="date" 
                    className="input" 
                    value={form.end_date} 
                    onChange={(e) => set('end_date', e.target.value)} 
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', outline: 'none' }}
                    required 
                  />
                </div>
              </>
            )}

            {show('reading') && (
              <>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
                    <Calendar size={14} /> Reading Date <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input 
                    type="date" 
                    className="input" 
                    value={form.reading_date} 
                    onChange={(e) => set('reading_date', e.target.value)} 
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', outline: 'none' }}
                    required 
                  />
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
                    <Tag size={14} /> Revision No. <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input 
                    className="input" 
                    placeholder="e.g. 1"
                    value={form.revision_no} 
                    onChange={(e) => set('revision_no', e.target.value)} 
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', outline: 'none' }}
                    required 
                  />
                </div>
              </>
            )}

            {show('charges_type') && (
              <div className="form-group" style={{ gridColumn: show('dates') || show('reading') ? '1 / -1' : 'auto' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
                  <Tag size={14} /> Charges Type <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select 
                  className="input" 
                  value={form.charges_type} 
                  onChange={(e) => set('charges_type', e.target.value)} 
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', outline: 'none', cursor: 'pointer' }}
                  required
                >
                  <option value="" disabled>-- select charges type --</option>
                  {(meta.charges_types || []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            {show('upload_type') && (
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
                  <Tag size={14} /> Upload Type <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select 
                  className="input" 
                  value={form.upload_type} 
                  onChange={(e) => set('upload_type', e.target.value)} 
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', outline: 'none', cursor: 'pointer' }}
                  required
                >
                  <option value="" disabled>-- select upload type --</option>
                  {(meta.upload_types || []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            {show('rldc') && (
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
                  <MapPin size={14} /> RLDC Region <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select 
                  className="input" 
                  value={form.rldc} 
                  onChange={(e) => set('rldc', e.target.value)} 
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', outline: 'none', cursor: 'pointer' }}
                  required
                >
                  <option value="" disabled>-- select region --</option>
                  {(meta.rldcs || []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="form-group" style={{ marginBottom: 32 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
              Data Source (CSV) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            
            <div 
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => !file && fileRef.current.click()}
              style={{ 
                border: `2px dashed ${isDragging ? '#3b82f6' : (file ? '#22c55e' : '#cbd5e1')}`, 
                backgroundColor: isDragging ? '#eff6ff' : (file ? '#f0fdf4' : '#f8fafc'),
                borderRadius: 12, 
                padding: '2.5rem 2rem', 
                textAlign: 'center',
                cursor: file ? 'default' : 'pointer',
                transition: 'all 0.2s ease',
                position: 'relative'
              }}
            >
              <input 
                ref={fileRef} 
                type="file" 
                accept=".csv,text/csv" 
                onChange={onFileChange} 
                style={{ display: 'none' }} 
              />
              
              {file ? (
                <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div style={{ background: '#dcfce7', padding: 14, borderRadius: '50%' }}>
                    <FileSpreadsheet size={28} color="#16a34a" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: '#166534', fontSize: 15 }}>{file.name}</div>
                    <div style={{ color: '#15803d', fontSize: 13, marginTop: 4 }}>{rowCount} data row{rowCount === 1 ? '' : 's'} · {(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button 
                    type="button" 
                    onClick={(e) => { e.stopPropagation(); setFile(null); setRowCount(0); setCsvText(''); if(fileRef.current) fileRef.current.value = ''; }}
                    style={{ position: 'absolute', top: 16, right: 16, background: '#fee2e2', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#b91c1c', transition: 'all 0.2s' }}
                    title="Remove file"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, opacity: isDragging ? 1 : 0.7 }}>
                  <div style={{ background: isDragging ? '#dbeafe' : '#e2e8f0', padding: 14, borderRadius: '50%', transition: 'all 0.2s' }}>
                    <UploadCloud size={28} color={isDragging ? '#2563eb' : '#64748b'} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: '#334155', fontSize: 15 }}>{isDragging ? 'Drop CSV here' : 'Click or drag CSV file to upload'}</div>
                    <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>Only .csv files are supported</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: 24 }}>
            <button 
              type="submit" 
              disabled={busy || !file} 
              style={{ 
                background: (!busy && file) ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : '#cbd5e1',
                color: 'white',
                border: 'none',
                padding: '10px 28px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: (!busy && file) ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.2s ease',
                boxShadow: (!busy && file) ? '0 4px 12px rgba(37, 99, 235, 0.3)' : 'none',
                transform: (!busy && file) ? 'translateY(0)' : 'none',
              }}
              onMouseOver={(e) => { if(!busy && file) e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseOut={(e) => { if(!busy && file) e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              {busy ? (
                <><i className="fas fa-spinner fa-spin"></i> Processing...</>
              ) : (
                <>Submit Data <ChevronRight size={16} /></>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Recent Uploads Table */}
      {recent.length > 0 && (
        <div style={{ 
          marginTop: 24, 
          background: 'white', 
          borderRadius: 12, 
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)',
          overflow: 'hidden'
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#334155' }}>Recent Submissions</h4>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 20px', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>ID</th>
                  <th style={{ padding: '12px 20px', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>File Name</th>
                  <th style={{ padding: '12px 20px', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>Rows</th>
                  <th style={{ padding: '12px 20px', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '12px 20px', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>Created At</th>
                </tr>
              </thead>
              <tbody>
                {recent.slice(0, 8).map((r, i) => {
                  const statusColor = getStatusColor(r.status);
                  return (
                    <tr key={r.id} style={{ borderBottom: i !== recent.slice(0, 8).length - 1 ? '1px solid #e2e8f0' : 'none', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = '#f8fafc'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '12px 20px', fontFamily: 'SFMono-Regular, Consolas, monospace', color: '#64748b' }}>{r.id.split('-')[0]}...</td>
                      <td style={{ padding: '12px 20px', fontWeight: 500, color: '#334155' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <FileText size={14} color="#94a3b8" /> {r.filename}
                        </div>
                      </td>
                      <td style={{ padding: '12px 20px', color: '#475569' }}>{r.row_count}</td>
                      <td style={{ padding: '12px 20px' }}>
                        <span style={{ 
                          padding: '4px 10px', 
                          background: statusColor.bg, 
                          color: statusColor.text, 
                          borderRadius: 20, 
                          fontSize: 11, 
                          fontWeight: 600,
                          letterSpacing: '0.02em'
                        }}>
                          {r.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 20px', color: '#475569' }}>{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

