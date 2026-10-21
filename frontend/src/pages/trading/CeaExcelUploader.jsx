import React, { useState, useRef } from 'react';
import { PageHeader } from '../../components/ui.jsx';
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertCircle, Info, X, ChevronRight } from 'lucide-react';

export default function CeaExcelUploader() {
  const [uploadData, setUploadData] = useState({ month: '', year: new Date().getFullYear(), file: null });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleUpload = async (e) => {
    if (e) e.preventDefault();
    if (!uploadData.file || !uploadData.month || !uploadData.year) {
      setUploadError('Please select a month, year, and a file to upload.');
      return;
    }

    setUploading(true);
    setUploadError('');
    setSuccessMsg('');

    const formData = new FormData();
    formData.append('month', uploadData.month);
    formData.append('year', uploadData.year);
    formData.append('file', uploadData.file);

    try {
      const response = await fetch('/api/iset-reports/upload-cea', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('sjvn_token')}`
        },
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Upload failed with status ${response.status}`);
      }

      setSuccessMsg(`Successfully processed CEA report for ${new Date(0, uploadData.month - 1).toLocaleString('default', { month: 'long' })} ${uploadData.year}`);
      setUploadData({ month: '', year: new Date().getFullYear(), file: null });
      if (fileInputRef.current) fileInputRef.current.value = '';
      
    } catch (err) {
      console.error("Upload error:", err);
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

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
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        setUploadData({...uploadData, file});
      } else {
        setUploadError('Please upload a valid Excel file (.xlsx or .xls)');
      }
    }
  };

  return (
    <div className="page" style={{ 
      background: 'linear-gradient(135deg, var(--slate-50) 0%, var(--slate-100) 100%)',
      minHeight: 'calc(100vh - 64px)',
      padding: '2rem 1rem'
    }}>
      <PageHeader 
        title="CEA Central Data Gateway" 
        subtitle="Ingest monthly installed capacity and power supply position workbooks directly into the data warehouse" 
      />
      
      <div style={{ maxWidth: 720, margin: '2rem auto' }}>
        
        {/* Elite Glowing Card */}
        <div style={{ 
          background: 'var(--surface)',
          backdropFilter: 'blur(12px)',
          borderRadius: '16px',
          boxShadow: '0 20px 40px -15px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.05)',
          overflow: 'hidden',
          transition: 'all 0.3s ease',
          border: '1px solid rgba(255,255,255,0.4)',
          position: 'relative'
        }}>
          {/* Subtle gradient top border line */}
          <div style={{ height: 4, width: '100%', background: 'linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899)' }}></div>
          
          <div style={{ padding: '2rem 2.5rem' }}>
            <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '1.25rem', fontWeight: 600, color: 'var(--slate-800)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <UploadCloud size={22} color="#3b82f6" />
              Upload Monthly Report
            </h3>
            
            {uploadError && (
              <div className="animate-fade-in-up" style={{ marginBottom: 24, padding: 16, backgroundColor: 'var(--t-red-50)', borderLeft: '4px solid #ef4444', color: 'var(--on-red)', borderRadius: '4px 8px 8px 4px', fontSize: 14, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <AlertCircle size={20} style={{ flexShrink: 0, marginTop: 2 }} color="#dc2626" />
                <div style={{ fontWeight: 500 }}>{uploadError}</div>
              </div>
            )}
            
            {successMsg && (
              <div className="animate-fade-in-up" style={{ marginBottom: 24, padding: 16, backgroundColor: 'var(--t-green-50)', borderLeft: '4px solid #22c55e', color: 'var(--on-green)', borderRadius: '4px 8px 8px 4px', fontSize: 14, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <CheckCircle2 size={20} style={{ flexShrink: 0, marginTop: 2 }} color="#16a34a" />
                <div style={{ fontWeight: 500 }}>{successMsg}</div>
              </div>
            )}
            
            <form onSubmit={handleUpload}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>
                <div className="form-group">
                  <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600, color: 'var(--slate-600)' }}>Reporting Month</label>
                  <select 
                    className="input elite-select" 
                    value={uploadData.month}
                    onChange={(e) => setUploadData({...uploadData, month: e.target.value})}
                    style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--slate-300)', backgroundColor: 'var(--slate-50)', transition: 'all 0.2s', outline: 'none', cursor: 'pointer' }}
                    required
                  >
                    <option value="" disabled>Select Month</option>
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                      <option key={m} value={m}>{new Date(0, m-1).toLocaleString('default', { month: 'long' })}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600, color: 'var(--slate-600)' }}>Reporting Year</label>
                  <input 
                    type="number" 
                    className="input elite-input" 
                    value={uploadData.year}
                    onChange={(e) => setUploadData({...uploadData, year: e.target.value})}
                    style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--slate-300)', backgroundColor: 'var(--slate-50)', transition: 'all 0.2s', outline: 'none' }}
                    required
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 32 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600, color: 'var(--slate-600)' }}>Data Source File</label>
                
                {/* Drag and Drop Zone */}
                <div 
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  onClick={() => !uploadData.file && fileInputRef.current.click()}
                  style={{ 
                    border: `2px dashed ${isDragging ? '#3b82f6' : (uploadData.file ? '#22c55e' : 'var(--slate-300)')}`, 
                    backgroundColor: isDragging ? 'var(--t-blue-50)' : (uploadData.file ? 'var(--t-green-50)' : 'var(--slate-50)'),
                    borderRadius: 12, 
                    padding: '3rem 2rem', 
                    textAlign: 'center',
                    cursor: uploadData.file ? 'default' : 'pointer',
                    transition: 'all 0.2s ease',
                    position: 'relative'
                  }}
                >
                  <input 
                    ref={fileInputRef}
                    type="file" 
                    accept=".xlsx, .xls"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setUploadData({...uploadData, file: e.target.files[0]});
                      }
                    }}
                    style={{ display: 'none' }}
                  />
                  
                  {uploadData.file ? (
                    <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                      <div style={{ background: 'var(--t-green-100)', padding: 16, borderRadius: '50%' }}>
                        <FileSpreadsheet size={32} color="#16a34a" />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--on-green)', fontSize: 16 }}>{uploadData.file.name}</div>
                        <div style={{ color: 'var(--on-green-2)', fontSize: 13, marginTop: 4 }}>{(uploadData.file.size / 1024).toFixed(1)} KB</div>
                      </div>
                      <button 
                        type="button" 
                        onClick={(e) => { e.stopPropagation(); setUploadData({...uploadData, file: null}); if(fileInputRef.current) fileInputRef.current.value = ''; }}
                        style={{ position: 'absolute', top: 16, right: 16, background: 'var(--t-red-100)', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--red-deep)', transition: 'all 0.2s' }}
                        title="Remove file"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, opacity: isDragging ? 1 : 0.7 }}>
                      <div style={{ background: isDragging ? 'var(--t-blue-100)' : 'var(--slate-200)', padding: 16, borderRadius: '50%', transition: 'all 0.2s' }}>
                        <UploadCloud size={32} color={isDragging ? '#2563eb' : '#64748b'} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--slate-700)', fontSize: 16 }}>{isDragging ? 'Drop file here' : 'Click or drag Excel file to upload'}</div>
                        <div style={{ color: 'var(--slate-500)', fontSize: 13, marginTop: 4 }}>Supports .xlsx and .xls up to 10MB</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button 
                  type="submit" 
                  disabled={uploading || !uploadData.file} 
                  style={{ 
                    background: (!uploading && uploadData.file) ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : 'var(--slate-300)',
                    color: 'white',
                    border: 'none',
                    padding: '12px 32px',
                    borderRadius: 8,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: (!uploading && uploadData.file) ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.2s ease',
                    boxShadow: (!uploading && uploadData.file) ? '0 4px 12px rgba(37, 99, 235, 0.3)' : 'none',
                    transform: (!uploading && uploadData.file) ? 'translateY(0)' : 'none',
                  }}
                  onMouseOver={(e) => { if(!uploading && uploadData.file) e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseOut={(e) => { if(!uploading && uploadData.file) e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  {uploading ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i> Processing Ledger...
                    </>
                  ) : (
                    <>
                      Ingest Data <ChevronRight size={18} />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
        
        {/* Elite Instructions Section */}
        <div style={{ 
          marginTop: 32, 
          background: 'var(--surface)', 
          borderRadius: 16, 
          border: '1px solid var(--slate-200)',
          overflow: 'hidden',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)'
        }}>
          <div style={{ padding: '16px 24px', background: 'var(--slate-50)', borderBottom: '1px solid var(--slate-200)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Info size={18} color="#64748b" />
            <h4 style={{ margin: 0, color: 'var(--slate-700)', fontSize: 15, fontWeight: 600 }}>Standard Operating Procedure</h4>
          </div>
          <div style={{ padding: 24 }}>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <li style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--t-blue-50)', color: 'var(--on-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, flexShrink: 0 }}>1</div>
                <div style={{ color: 'var(--slate-600)', fontSize: 14, lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--slate-800)', display: 'block', marginBottom: 4 }}>Acquire Source Material</strong>
                  Download the latest <i>"Installed Capacity"</i> or <i>"Power Supply Position"</i> executive summaries from the official <a href="https://cea.nic.in" target="_blank" rel="noreferrer" style={{ color: 'var(--on-blue)', textDecoration: 'none', fontWeight: 500 }}>Central Electricity Authority (cea.nic.in)</a> portal.
                </div>
              </li>
              <li style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--t-blue-50)', color: 'var(--on-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, flexShrink: 0 }}>2</div>
                <div style={{ color: 'var(--slate-600)', fontSize: 14, lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--slate-800)', display: 'block', marginBottom: 4 }}>Configure Metadata</strong>
                  Select the exact reporting month and year. This ensures the data maps correctly in the analytical dashboards and overwrites any existing partial data for that period.
                </div>
              </li>
              <li style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--t-blue-50)', color: 'var(--on-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, flexShrink: 0 }}>3</div>
                <div style={{ color: 'var(--slate-600)', fontSize: 14, lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--slate-800)', display: 'block', marginBottom: 4 }}>Execute Ingestion</strong>
                  Drop the file into the upload zone and hit "Ingest Data". The platform's parsing engine will automatically scrub the sheets, extract tabular structures, and populate the central data warehouse.
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
