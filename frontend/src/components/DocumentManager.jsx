import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Badge, Modal, Field } from './ui.jsx';
import { DOCUMENT_TAXONOMY } from '../constants/documentTaxonomy.js';
import { fmtDate, fmtDateTime } from '../datetime.js';

// Extension -> MIME map, used only as a last-resort hint. See sniffType()
// below for why we don't trust the filename.
const EXT_MIME = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function extOf(name = '') {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

/**
 * Detect the REAL file type by reading its magic bytes (file signature).
 */
async function sniffType(blob) {
  try {
    const buf = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const startsWith = (...bytes) => bytes.every((b, i) => buf[i] === b);

    if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';           // %PDF
    if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
    if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';                 // GIF8
    if (startsWith(0x42, 0x4d)) return 'image/bmp';                             // BM
    if (startsWith(0x52, 0x49, 0x46, 0x46) && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
      return 'image/webp';
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Decide how to preview a file: 'image', 'pdf', 'excel', or 'other'
function kindOfType(type = '', fileName = '') {
  const ext = extOf(fileName);
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (/^image\//.test(type) || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  if (
    ['xlsx', 'xls', 'csv'].includes(ext) ||
    type.includes('spreadsheet') ||
    type.includes('excel') ||
    type.includes('csv')
  ) {
    return 'excel';
  }
  return 'other';
}

async function parseErrorBlob(err, fallback) {
  let message = fallback;
  const data = err.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text);
      message = parsed.error || message;
    } catch (_) { /* ignore */ }
  } else if (err.response?.data?.error) {
    message = err.response.data.error;
  }
  return message;
}

function ExcelViewer({ blob, fileName }) {
  const [sheets, setSheets] = useState([]);
  const [activeSheet, setActiveSheet] = useState('');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [parseError, setParseError] = useState(null);
  const [search, setSearch] = useState('');
  const [displayLimit, setDisplayLimit] = useState(250);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setParseError(null);

    (async () => {
      try {
        const buffer = await blob.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, dense: false });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error('Workbook contains no sheets.');
        }
        if (!cancelled) {
          setSheets(workbook.SheetNames);
          const initialSheet = workbook.SheetNames[0];
          setActiveSheet(initialSheet);
          const ws = workbook.Sheets[initialSheet];
          const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
          setData(rawRows);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setParseError(e.message || 'Failed to read spreadsheet data');
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [blob]);

  function handleSheetChange(sheetName) {
    setActiveSheet(sheetName);
    setSearch('');
    setDisplayLimit(250);
    try {
      blob.arrayBuffer().then((buf) => {
        const workbook = XLSX.read(buf, { type: 'array', cellDates: true });
        const ws = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
        setData(rawRows);
      });
    } catch (_) {}
  }

  // Filter rows by search term
  const filteredData = useMemo(() => {
    if (!search.trim()) return data;
    const term = search.toLowerCase();
    return data.filter((row, idx) => {
      if (idx === 0) return true; // keep header row
      return row.some((cell) => String(cell ?? '').toLowerCase().includes(term));
    });
  }, [data, search]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--slate-500)' }}>
        <div style={{ fontSize: 18, marginBottom: 8 }}>📊 Loading spreadsheet...</div>
        <div style={{ fontSize: 12 }}>Parsing workbook sheets and formulas</div>
      </div>
    );
  }

  if (parseError) {
    return (
      <div style={{ padding: 24, color: 'var(--red-deep)', background: 'var(--red-bg, #fef2f2)', borderRadius: 8 }}>
        <strong>Spreadsheet Preview Error:</strong> {parseError}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div style={{ padding: 30, textAlign: 'center', color: 'var(--slate-500)' }}>
        This sheet appears to be empty.
      </div>
    );
  }

  // Find max columns across all rows to format table columns properly
  const maxCols = Math.max(...data.map(r => r.length), 0);
  const rowsToShow = filteredData.slice(0, displayLimit);
  const hasMore = filteredData.length > displayLimit;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
      {/* Sheets switcher & Search toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: 'var(--bg, #f8fafc)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)' }}>
        {/* Sheet Tabs */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-light, #64748b)', marginRight: 4 }}>
            Sheets ({sheets.length}):
          </span>
          {sheets.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSheetChange(s)}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: activeSheet === s ? '1px solid var(--primary, #0284c7)' : '1px solid var(--border, #cbd5e1)',
                background: activeSheet === s ? 'var(--primary, #0284c7)' : 'var(--surface, #ffffff)',
                color: activeSheet === s ? '#ffffff' : 'var(--text, #1e293b)',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              📄 {s}
            </button>
          ))}
        </div>

        {/* Quick Search inside sheet */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search within sheet..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '5px 10px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid var(--border, #cbd5e1)',
              background: 'var(--surface, #ffffff)',
              color: 'var(--text, #1e293b)',
              width: 190
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-light, #64748b)', whiteSpace: 'nowrap' }}>
            {filteredData.length} rows • {maxCols} cols
          </span>
        </div>
      </div>

      {/* Spreadsheet Grid Table */}
      <div style={{
        maxHeight: '62vh',
        overflow: 'auto',
        border: '1px solid var(--border, #cbd5e1)',
        borderRadius: 8,
        background: 'var(--surface, #ffffff)',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'inherit' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg, #f1f5f9)' }}>
            <tr>
              <th style={{
                width: 44,
                padding: '6px 8px',
                borderRight: '1px solid var(--border, #cbd5e1)',
                borderBottom: '2px solid var(--border, #cbd5e1)',
                background: 'var(--bg, #e2e8f0)',
                color: 'var(--text-light, #64748b)',
                fontSize: 11,
                textAlign: 'center',
                fontWeight: 700,
                position: 'sticky',
                left: 0,
                zIndex: 11
              }}>
                #
              </th>
              {Array.from({ length: maxCols }).map((_, colIdx) => (
                <th key={colIdx} style={{
                  padding: '7px 12px',
                  borderRight: '1px solid var(--border, #e2e8f0)',
                  borderBottom: '2px solid var(--border, #cbd5e1)',
                  background: 'var(--bg, #f1f5f9)',
                  color: 'var(--text, #1e293b)',
                  fontSize: 11.5,
                  fontWeight: 700,
                  textAlign: 'left',
                  whiteSpace: 'nowrap'
                }}>
                  {data[0]?.[colIdx] !== undefined && data[0]?.[colIdx] !== '' 
                    ? String(data[0][colIdx]) 
                    : String.fromCharCode(65 + (colIdx % 26))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsToShow.map((row, rowIdx) => {
              // Skip repeating the header if row 0 was already displayed as the header
              if (rowIdx === 0 && data.length > 1) return null;
              return (
                <tr
                  key={rowIdx}
                  style={{
                    background: rowIdx % 2 === 0 ? 'var(--surface, #ffffff)' : 'var(--bg-subtle, #f8fafc)',
                    transition: 'background 0.1s'
                  }}
                >
                  <td style={{
                    padding: '5px 8px',
                    borderRight: '1px solid var(--border, #cbd5e1)',
                    borderBottom: '1px solid var(--border, #e2e8f0)',
                    background: 'var(--bg, #f1f5f9)',
                    color: 'var(--text-light, #64748b)',
                    fontSize: 11,
                    textAlign: 'center',
                    fontWeight: 600,
                    position: 'sticky',
                    left: 0,
                    zIndex: 5
                  }}>
                    {rowIdx + 1}
                  </td>
                  {Array.from({ length: maxCols }).map((_, colIdx) => {
                    const cellVal = row[colIdx];
                    const isNum = typeof cellVal === 'number' || (!isNaN(cellVal) && cellVal !== '' && cellVal !== null && typeof cellVal === 'string' && !isNaN(Number(cellVal.replace(/[,₹$%]/g, ''))));
                    return (
                      <td
                        key={colIdx}
                        style={{
                          padding: '6px 12px',
                          borderRight: '1px solid var(--border, #e2e8f0)',
                          borderBottom: '1px solid var(--border, #e2e8f0)',
                          color: 'var(--text, #1e293b)',
                          textAlign: isNum ? 'right' : 'left',
                          whiteSpace: 'nowrap',
                          fontVariantNumeric: isNum ? 'tabular-nums' : 'normal'
                        }}
                      >
                        {cellVal !== undefined && cellVal !== null ? String(cellVal) : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div style={{ textAlign: 'center', padding: '6px 0' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setDisplayLimit((prev) => prev + 250)}
          >
            Load more rows (Showing {rowsToShow.length} of {filteredData.length})
          </button>
        </div>
      )}
    </div>
  );
}

export function PreviewModal({ open, versionId, fileName, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, url: null, blob: null, kind: 'other', name: fileName });

  useEffect(() => {
    if (!open || !versionId) return;
    let objectUrl = null;
    let cancelled = false;
    setState({ loading: true, error: null, url: null, blob: null, kind: 'other', name: fileName });

    (async () => {
      try {
        const { blob, fileName: downloadedName, contentType } = await api.documents.download(versionId);
        const name = downloadedName || fileName;

        // Actual bytes win over the filename and the server header
        const sniffed = await sniffType(blob);
        const resolvedType = sniffed || EXT_MIME[extOf(name)] || contentType || blob.type || '';
        const kind = kindOfType(resolvedType, name);

        // Re-type the blob to match what we're actually rendering
        const typed = blob.type === resolvedType ? blob : new Blob([blob], { type: resolvedType });
        const url = URL.createObjectURL(typed);
        objectUrl = url;
        if (!cancelled) setState({ loading: false, error: null, url, blob, kind, name });
      } catch (err) {
        const message = await parseErrorBlob(err, 'Failed to load document');
        if (!cancelled) setState({ loading: false, error: message, url: null, blob: null, kind: 'other', name: fileName });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, versionId]);

  function handleDownload() {
    if (!state.url) return;
    const a = document.createElement('a');
    a.href = state.url;
    a.download = state.name || 'document';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (!open) return null;

  const modalWidth = state.kind === 'excel' ? 1150 : state.kind === 'other' ? 480 : 920;

  return (
    <Modal open={open} onClose={onClose} title={state.name ? `Preview — ${state.name}` : 'Document Preview'} width={modalWidth}>
      {state.loading && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--slate-500)' }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Loading preview...</div>
        </div>
      )}
      {!state.loading && state.error && (
        <div style={{ padding: 20, color: 'var(--red-deep)' }}>{state.error}</div>
      )}
      {!state.loading && !state.error && state.kind === 'image' && (
        <img
          src={state.url}
          alt={state.name}
          style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto', borderRadius: 6 }}
        />
      )}
      {!state.loading && !state.error && state.kind === 'pdf' && (
        <iframe
          src={state.url}
          title={state.name}
          style={{ width: '100%', height: '70vh', border: '1px solid var(--slate-200)', borderRadius: 6 }}
        />
      )}
      {!state.loading && !state.error && state.kind === 'excel' && state.blob && (
        <ExcelViewer blob={state.blob} fileName={state.name} />
      )}
      {!state.loading && !state.error && state.kind === 'other' && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--slate-500)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
            Preview isn't available for this file type
          </div>
          <div style={{ fontSize: 13 }}>
            Use the button below to download and view the file locally.
          </div>
        </div>
      )}
      {!state.loading && (
        <div className="form-actions" style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {state.name && (
              <span style={{ fontSize: 12, color: 'var(--text-light, #64748b)' }}>
                {state.name}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
            {state.url && (
              <button type="button" className="btn btn-primary" onClick={handleDownload} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Download</span>
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function DocumentManager({ moduleName, entityId, contractId, category = null, title = 'Documents' }) {
  const { user } = useAuth();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);

  const isAdmin = user?.role === 'SJVN_ADMIN';

  function load() {
    setLoading(true);
    api.documents.list({ entity_id: entityId, contract_id: contractId, category })
      .then(setDocs)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [entityId, contractId, category]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setUploadOpen(true)}>
          Upload Document
        </button>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 20 }}>Loading documents...</div>
        ) : (
          <table className="data-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Title</th>
                <th scope="col">Category</th>
                <th scope="col">Status</th>
                <th scope="col">Version</th>
                <th scope="col">Uploaded</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 && (
                <tr><td colSpan={7} className="empty-cell">No documents found</td></tr>
              )}
              {docs.map(doc => (
                <tr key={doc.id}>
                  <td>{doc.document_type}</td>
                  <td><strong>{doc.title}</strong></td>
                  <td>{doc.category}</td>
                  <td>
                    {doc.verification_status === 'VERIFIED' ? <Badge status="ACTIVE" /> :
                     doc.verification_status === 'REJECTED' ? <Badge status="REJECTED" /> :
                     doc.verification_status === 'PENDING' ? <Badge status="PENDING" /> :
                     <span style={{ color: 'var(--slate-500)', fontSize: 12 }}>Not Required</span>}
                  </td>
                  <td>v{doc.version_number}</td>
                  <td>{fmtDate(doc.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        title="View document"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px' }}
                        onClick={() => setPreviewDoc({ versionId: doc.latest_version_id, fileName: doc.file_name })}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span>View</span>
                      </button>
                      {isAdmin && doc.category === 'VERIFY' && doc.verification_status === 'PENDING' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => setReviewOpen(doc)}>
                          Review
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <UploadModal 
        open={uploadOpen} 
        onClose={() => setUploadOpen(false)} 
        onSuccess={load}
        moduleName={moduleName}
        entityId={entityId}
        contractId={contractId}
      />

      <ReviewModal
        open={!!reviewOpen}
        doc={reviewOpen}
        onClose={() => setReviewOpen(null)}
        onSuccess={load}
      />

      <PreviewModal
        open={!!previewDoc}
        versionId={previewDoc?.versionId}
        fileName={previewDoc?.fileName}
        onClose={() => setPreviewDoc(null)}
      />
    </div>
  );
}

export function UploadModal({ open, onClose, onSuccess, moduleName, entityId, contractId, presetDocType = null, presetTitle = '' }) {
  const { user } = useAuth();
  // Segregation of duties: internal users (SJVN Admin / REIA / Finance / Trading)
  // are the reviewers — they can only upload RECORD-category documents. VERIFY
  // documents must be uploaded by the stakeholder (Seller/Buyer) themselves.
  const isInternal = ['SJVN_ADMIN', 'REIA_USER', 'FINANCE_USER', 'TRADING_USER'].includes(user?.role);
  const filterTypes = (list) => (isInternal ? list.filter((t) => t.category !== 'VERIFY') : list);

  const fallbackTypes = filterTypes(DOCUMENT_TAXONOMY[moduleName] || [{ value: 'OTHER', label: 'Other Document', category: 'RECORD', reason: '' }]);
  const [availableTypes, setAvailableTypes] = useState(fallbackTypes);
  const [file, setFile] = useState(null);
  const [docType, setDocType] = useState(presetDocType || fallbackTypes[0]?.value || 'OTHER');
  const [title, setTitle] = useState(presetTitle);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(presetTitle);
    let cancelled = false;
    api.masters.documentTypes({ module: moduleName })
      .then((rows) => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return;
        const mapped = filterTypes(rows.map((r) => ({
          value: r.code,
          label: r.label,
          category: r.category,
          reason: r.reason || '',
        })));
        setAvailableTypes(mapped);
        // Honour a preset type when it survives the SoD filter, else fall back.
        if (presetDocType && mapped.some((t) => t.value === presetDocType)) setDocType(presetDocType);
        else if (mapped.length > 0) setDocType(mapped[0].value);
      })
      .catch(() => {
        // keep FE taxonomy fallback
        setAvailableTypes(fallbackTypes);
        setDocType(presetDocType || fallbackTypes[0]?.value || 'OTHER');
      });
    return () => { cancelled = true; };
  }, [open, moduleName, presetDocType, presetTitle]);

  // Auto-resolve category based on taxonomy
  const activeDef = availableTypes.find(t => t.value === docType) || availableTypes[0] || fallbackTypes[0];
  const autoCategory = activeDef?.category || 'RECORD';
  // A preset type the current user isn't allowed to upload (e.g. internal user +
  // VERIFY doc) gets filtered out — treat that exactly like "nothing to upload".
  const presetLocked = !!presetDocType;
  const presetBlocked = presetLocked && !availableTypes.some((t) => t.value === presetDocType);
  const noTypesAvailable = availableTypes.length === 0 || presetBlocked;

  if (!open) return null;

  if (noTypesAvailable) {
    return (
      <Modal open={open} onClose={onClose} title="Upload Document">
        <div style={{ padding: '8px 0 16px' }}>
          <p style={{ fontSize: 14, color: 'var(--slate-700)', margin: '0 0 8px' }}>
            There are no documents for you to upload here.
          </p>
          <p style={{ fontSize: 13, color: 'var(--slate-500)', margin: 0 }}>
            The documents required for this section are <strong>VERIFY-category</strong> and must be uploaded
            by the stakeholder (Seller / Buyer) from their own login. As an internal reviewer, you can only
            <strong> review and verify</strong> the documents they submit.
          </p>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>Got it</button>
        </div>
      </Modal>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file || !title) return;
    
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    if (entityId) formData.append('entity_id', entityId);
    if (contractId) formData.append('contract_id', contractId);
    formData.append('document_type', docType);
    formData.append('category', autoCategory);
    formData.append('title', title);

    try {
      await api.documents.upload(formData);
      onSuccess();
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Upload Document">
      <form onSubmit={handleSubmit}>
        <Field label="Document File (PDF, JPG, PNG, Excel. Max 10MB)">
          <input type="file" required onChange={(e) => setFile(e.target.files[0])} />
        </Field>
        <Field label="Title">
          <input required placeholder="e.g., Q3 Payment Guarantee" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Document Type">
          <select value={docType} onChange={e => setDocType(e.target.value)} disabled={presetLocked} style={presetLocked ? { backgroundColor: 'var(--slate-50)', color: 'var(--slate-700)' } : undefined}>
            {availableTypes.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {presetLocked && (
            <div style={{ fontSize: 11, color: 'var(--slate-500)', marginTop: 4 }}>
              Linked to this regulatory approval — type is fixed.
            </div>
          )}
          {activeDef.reason && (
            <div style={{ fontSize: 11, color: 'var(--slate-500)', marginTop: 4 }}>
              <i>Why is this needed?</i> {activeDef.reason}
            </div>
          )}
        </Field>
        <Field label="Classification Category (Auto-assigned)">
          <select value={autoCategory} disabled style={{ backgroundColor: 'var(--slate-50)', color: autoCategory === 'VERIFY' ? 'var(--red-deep)' : 'var(--slate-700)', fontWeight: autoCategory === 'VERIFY' ? 'bold' : 'normal' }}>
            <option value="RECORD">Record Only (No approval workflow)</option>
            <option value="VERIFY">Verify (Requires SJVN Admin approval)</option>
          </select>
          <div style={{ fontSize: 11, color: 'var(--slate-500)', marginTop: 4 }}>
            This is strictly enforced by the platform's cross-module document taxonomy rules.
          </div>
        </Field>
        <div className="form-actions" style={{ marginTop: 24 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={uploading}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={uploading || !file}>
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReviewModal({ open, doc, onClose, onSuccess }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  if (!open || !doc) return null;

  async function handleAction(action) {
    if (action === 'REJECT' && !reason) {
      alert('Please provide a reason for rejection');
      return;
    }
    
    setSubmitting(true);
    try {
      if (action === 'VERIFY') {
        await api.documents.verify(doc.latest_version_id);
      } else {
        await api.documents.reject(doc.latest_version_id, reason);
      }
      onSuccess();
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Review Document">
      <div style={{ marginBottom: 20 }}>
        <strong>{doc.title}</strong> (v{doc.version_number})
        <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4 }}>
          Uploaded on {fmtDateTime(doc.created_at)}
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setPreviewOpen(true)}
          >
            View / Download File
          </button>
        </div>
      </div>

      <Field label="Rejection Reason (Required if Rejecting)">
        <textarea 
          rows={3} 
          placeholder="Why is this document invalid?" 
          value={reason} 
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>

      <div className="form-actions" style={{ marginTop: 24 }}>
        <button type="button" className="btn btn-danger" onClick={() => handleAction('REJECT')} disabled={submitting}>
          Reject
        </button>
        <button type="button" className="btn btn-success" onClick={() => handleAction('VERIFY')} disabled={submitting}>
          Verify & Approve
        </button>
      </div>

      <PreviewModal
        open={previewOpen}
        versionId={doc.latest_version_id}
        fileName={doc.file_name}
        onClose={() => setPreviewOpen(false)}
      />
    </Modal>
  );
}
