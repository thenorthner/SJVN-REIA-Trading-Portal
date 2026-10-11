import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Badge, Modal, Field } from './ui.jsx';
import { DOCUMENT_TAXONOMY } from '../constants/documentTaxonomy.js';
import { ROLE_GROUPS } from '../roles.js';
import { fmtDate, fmtDateTime } from '../datetime.js';

// Sellers, buyers and trading clients send documents in; everyone else at SJVN
// reads them, and the REIA desk reviews them. Mirrors routes/documents.js.
export const isOutsideRole = (role) => /^(SELLER|BUYER|TRADING_CLIENT)/.test(role || '');
export const canReviewDocuments = (role) => ROLE_GROUPS.REIA_WRITE.includes(role);

/** Where a document stands, as a badge: the review status, or Expired once its date has passed. */
export function DocStatus({ doc }) {
  const st = doc.effective_status || doc.verification_status;
  if (st === 'EXPIRED') return <Badge status="REJECTED" label="Expired" />;
  if (st === 'VERIFIED') return <Badge status="ACTIVE" label="Verified" />;
  if (st === 'REJECTED') return <Badge status="REJECTED" />;
  if (st === 'DRAFT') return <Badge status="DRAFT" />;
  if (st === 'PENDING') return <Badge status="PENDING" label="Awaiting SJVN" />;
  return <span style={{ color: 'var(--slate-500)', fontSize: 12 }}>Not Required</span>;
}

/** The validity date, with how close it is when that matters. */
export function ExpiryTag({ doc }) {
  if (!doc.expiry_date) return <span style={{ color: 'var(--slate-500)', fontSize: 12 }}>—</span>;
  const d = doc.days_to_expiry;
  const tone = doc.expiry_state === 'EXPIRED' ? { bg: '#fef2f2', fg: '#b91c1c' } : { bg: '#fffbeb', fg: '#b45309' };
  return (
    <div>
      <div style={{ fontSize: 13 }}>{fmtDate(doc.expiry_date)}</div>
      {doc.expiry_state && (
        <span style={{ display: 'inline-block', marginTop: 2, padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: tone.bg, color: tone.fg }}>
          {doc.expiry_state === 'EXPIRED'
            ? `Expired ${-d} day${d === -1 ? '' : 's'} ago`
            : d === 0 ? 'Expires today' : `Expiring in ${d} day${d === 1 ? '' : 's'}`}
        </span>
      )}
    </div>
  );
}

/** What was read from the file, and whether it agrees with the company record. */
export function ExtractedChecks({ extracted }) {
  if (!extracted) return null;
  if (!extracted.readable && !extracted.checks?.length) {
    return (
      <div style={{ fontSize: 12.5, color: 'var(--slate-500)', background: 'var(--slate-50, #f8fafc)', padding: '8px 10px', borderRadius: 6 }}>
        No text could be read from this file (a scan or a picture), so its PAN / GSTIN was not checked automatically. Check it by eye.
      </div>
    );
  }
  const found = [...(extracted.pan || []).map((v) => `PAN ${v}`), ...(extracted.gstin || []).map((v) => `GSTIN ${v}`)];
  return (
    <div style={{ fontSize: 12.5, background: 'var(--slate-50, #f8fafc)', padding: '8px 10px', borderRadius: 6 }}>
      <div style={{ color: 'var(--slate-600)' }}>
        Read from the file: {found.length ? found.join(' · ') : 'no PAN or GSTIN found'}
      </div>
      {(extracted.checks || []).map((c, i) => (
        <div key={i} style={{ marginTop: 4, fontWeight: 600, color: c.ok ? '#15803d' : '#b91c1c' }}>
          {c.ok ? '✓' : '✗'} {c.text}
        </div>
      ))}
    </div>
  );
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download the latest version of every document under a company or contract as one zip. */
export async function downloadAllDocuments(params) {
  try {
    const { blob, fileName } = await api.documents.zip(params);
    saveBlob(blob, fileName);
  } catch (err) {
    alert(await parseErrorBlob(err, 'Could not download the documents'));
  }
}

/**
 * A light, repeating mark laid over a preview: who is looking, and that it is
 * confidential. It sits on top of the viewer and lets clicks and scrolling
 * through. It marks what is on screen — a screenshot carries it — but it is
 * not written into the file itself.
 */
function Watermark({ text }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="220"><text x="20" y="130" transform="rotate(-24 190 110)" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#1e293b" fill-opacity="0.13">${text.replace(/[<>&]/g, '')}</text></svg>`;
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: 6,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, backgroundRepeat: 'repeat',
      }}
    />
  );
}

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
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'none', color: 'var(--text-light, #64748b)', marginRight: 4 }}>
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
  const { user } = useAuth();
  const mark = `CONFIDENTIAL · SJVN · ${user?.name || ''} · ${new Date().toLocaleDateString('en-IN')}`;
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

        // A PDF with a header and no body would be handed to the browser's own
        // viewer, which answers with a bare "Failed to load PDF document". Say
        // what is wrong instead, and leave the download available.
        if (resolvedType === 'application/pdf') {
          const tail = await blob.slice(Math.max(0, blob.size - 2048)).text();
          if (!(tail.includes('startxref') && tail.includes('%%EOF'))) {
            const url = URL.createObjectURL(blob);
            objectUrl = url;
            if (!cancelled) setState({ loading: false, error: `This file cannot be shown: it is not a complete PDF (${blob.size.toLocaleString('en-IN')} bytes). It was probably damaged or cut short when it was uploaded. Ask for it to be uploaded again.`, url, blob, kind: 'other', name });
            return;
          }
        }

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
        <div style={{ position: 'relative', width: 'fit-content', maxWidth: '100%', margin: '0 auto' }}>
          <img
            src={state.url}
            alt={state.name}
            style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', borderRadius: 6 }}
          />
          <Watermark text={mark} />
        </div>
      )}
      {!state.loading && !state.error && state.kind === 'pdf' && (
        <div style={{ position: 'relative' }}>
          <iframe
            src={`${state.url}#view=FitH`}
            title={state.name}
            style={{ width: '100%', height: '75vh', border: '1px solid var(--slate-200)', borderRadius: 6, display: 'block' }}
          />
          <Watermark text={mark} />
        </div>
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

// `onChange` tells the page around it that something here was uploaded, reviewed or submitted.
export function DocumentManager({ moduleName, entityId, contractId, category = null, title = 'Documents', onChange, canUpload = true }) {
  const { user } = useAuth();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [versionOf, setVersionOf] = useState(null);
  const [historyOf, setHistoryOf] = useState(null);
  const [zipping, setZipping] = useState(false);

  const isAdmin = canReviewDocuments(user?.role);
  // The side that sends a document in is the side that may replace it.
  const mayReplace = (doc) => (doc.category === 'VERIFY') === isOutsideRole(user?.role);
  const canSubmitToSjvn = ['SELLER', 'SELLER_L2', 'SELLER_L3', 'BUYER', 'BUYER_L2', 'BUYER_L3'].includes(user?.role);
  
  function load() {
    setLoading(true);
    api.documents.list({ entity_id: entityId, contract_id: contractId, category })
      .then(setDocs)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [entityId, contractId, category]);

  const changed = () => { load(); onChange?.(); };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {docs.length > 0 && (entityId || contractId) && (
            <button
              className="btn btn-secondary btn-sm" disabled={zipping}
              title="The latest version of every document here, in one zip file"
              onClick={async () => {
                setZipping(true);
                await downloadAllDocuments({ entity_id: entityId, contract_id: contractId });
                setZipping(false);
              }}
            >
              {zipping ? 'Preparing…' : 'Download all (ZIP)'}
            </button>
          )}
          {canUpload && (
            <button className="btn btn-primary btn-sm" onClick={() => setUploadOpen(true)}>
              Upload Document
            </button>
          )}
        </div>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 20 }}>Loading documents...</div>
        ) : (
          // The wrapper scrolls a wide table inside the card instead of letting
          // its right-hand columns run out past the card's edge in a narrow modal.
          <div className="table-wrap">
          <table className="data-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Title</th>
                <th scope="col">Category</th>
                <th scope="col">Status</th>
                <th scope="col">Valid until</th>
                <th scope="col">Version</th>
                <th scope="col">Uploaded</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 && (
                <tr><td colSpan={8} className="empty-cell">No documents found</td></tr>
              )}
              {docs.map(doc => (
                <tr key={doc.id}>
                  <td>{doc.document_type}</td>
                  <td><strong>{doc.title}</strong></td>
                  <td>{doc.category}</td>
                  <td>
                    <div style={{ maxWidth: 260, whiteSpace: 'normal', wordWrap: 'break-word' }}>
                      <DocStatus doc={doc} />
                      {doc.verification_status === 'REJECTED' && doc.verification_notes && (
                        <div style={{ marginTop: 4, fontSize: 12, color: '#b91c1c', lineHeight: 1.35 }}>
                          <strong>SJVN's remark:</strong> {doc.verification_notes}
                        </div>
                      )}
                    </div>
                  </td>
                  <td><ExpiryTag doc={doc} /></td>
                  <td>
                    <button type="button" className="btn-link" title="See every version" onClick={() => setHistoryOf(doc)}>
                      v{doc.version_number}{doc.version_count > 1 ? ` of ${doc.version_count}` : ''}
                    </button>
                  </td>
                  <td>{fmtDate(doc.uploaded_at || doc.created_at)}</td>
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
                      {mayReplace(doc) && (
                        <button className="btn btn-secondary btn-sm" onClick={() => setVersionOf(doc)}>
                          {doc.verification_status === 'REJECTED' ? 'Re-upload' : doc.expiry_state ? 'Renew' : 'New version'}
                        </button>
                      )}
                      {isAdmin && doc.category === 'VERIFY' && doc.verification_status === 'PENDING' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => setReviewOpen(doc)}>
                          Review
                        </button>
                      )}
                      {canSubmitToSjvn && doc.category === 'VERIFY' && doc.verification_status === 'DRAFT' && (
                        <button 
                          className="btn btn-primary btn-sm" 
                          onClick={async () => {
                            if (window.confirm('Submit this document to SJVN for verification?')) {
                              try {
                                await api.documents.submitL2(doc.latest_version_id);
                                changed();
                              } catch (e) {
                                alert(e.response?.data?.error || 'Failed to submit');
                              }
                            }
                          }}
                        >
                          Submit to SJVN
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <UploadModal 
        open={uploadOpen} 
        onClose={() => setUploadOpen(false)} 
        onSuccess={changed}
        moduleName={moduleName}
        entityId={entityId}
        contractId={contractId}
      />

      <UploadModal
        open={!!versionOf}
        existing={versionOf}
        onClose={() => setVersionOf(null)}
        onSuccess={changed}
        moduleName={moduleName}
      />

      <ReviewModal
        open={!!reviewOpen}
        doc={reviewOpen}
        onClose={() => setReviewOpen(null)}
        onSuccess={changed}
      />

      <HistoryModal doc={historyOf} onClose={() => setHistoryOf(null)} />

      <PreviewModal
        open={!!previewDoc}
        versionId={previewDoc?.versionId}
        fileName={previewDoc?.fileName}
        onClose={() => setPreviewDoc(null)}
      />
    </div>
  );
}

// `existing` turns this into "upload a new version of that document": the type,
// title and category are the document's own and are not asked for again.
export function UploadModal({ open, onClose, onSuccess, moduleName, entityId, contractId, presetDocType = null, presetTitle = '', existing = null }) {
  const { user } = useAuth();
  const [expiry, setExpiry] = useState('');
  // Segregation of duties: general internal users (Finance / Trading) are reviewers,
  // but SJVN_ADMIN / REIA_USER / REIA_ADMIN / IT_SUPER_ADMIN are fully empowered
  // to onboard stakeholders directly and upload their regulatory verification documents.
  const isInternal = !isOutsideRole(user?.role);
  const canAdminDirectUpload = ['SJVN_ADMIN', 'REIA_USER', 'REIA_ADMIN', 'IT_SUPER_ADMIN'].includes(user?.role);
  const filterTypes = (list) => (isInternal && !canAdminDirectUpload ? list.filter((t) => t.category !== 'VERIFY') : list);
  const [autoVerify, setAutoVerify] = useState(true);

  const fallbackTypes = filterTypes(DOCUMENT_TAXONOMY[moduleName] || [{ value: 'OTHER', label: 'Other Document', category: 'RECORD', reason: '' }]);
  const [availableTypes, setAvailableTypes] = useState(fallbackTypes);
  const [file, setFile] = useState(null);
  const [docType, setDocType] = useState(presetDocType || fallbackTypes[0]?.value || 'OTHER');
  const [title, setTitle] = useState(presetTitle);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(presetTitle);
    setExpiry('');
    setFile(null);
    if (existing) return undefined;
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
  // A preset type the current user isn't allowed to upload gets filtered out — treat that like "nothing to upload".
  const presetLocked = !!presetDocType;
  const presetBlocked = presetLocked && !availableTypes.some((t) => t.value === presetDocType);
  const noTypesAvailable = !existing && (availableTypes.length === 0 || presetBlocked);

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
            by the stakeholder (Seller / Buyer) or an SJVN Admin.
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
    if (!file || (!existing && !title)) return;
    
    if (file.size > 10 * 1024 * 1024) {
      alert('The selected document exceeds the maximum allowed size of 10MB. Please compress the file and try again.');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    if (existing) {
      formData.append('document_id', existing.id);
    } else {
      if (entityId) formData.append('entity_id', entityId);
      if (contractId) formData.append('contract_id', contractId);
      formData.append('document_type', docType);
      formData.append('category', autoCategory);
      formData.append('title', title);
    }
    if (expiry) formData.append('expiry_date', expiry);
    if (canAdminDirectUpload && autoVerify) {
      formData.append('auto_verify', 'true');
    }

    try {
      const r = await api.documents.upload(formData);
      // Say straight away if the file does not agree with the company record.
      const wrong = (r.extracted?.checks || []).filter((c) => !c.ok);
      if (wrong.length) alert(`Uploaded. Please note:\n\n${wrong.map((c) => `• ${c.text}`).join('\n')}\n\nSJVN's reviewer will see the same note.`);
      onSuccess();
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? `New version — ${existing.title}` : 'Upload Document'}>
      <form onSubmit={handleSubmit}>
        {existing && (
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--slate-600)' }}>
            This replaces version {existing.version_number} of <strong>{existing.title}</strong>. The earlier
            versions stay on record{existing.category === 'VERIFY' ? ', and the new one goes to SJVN for verification' : ''}.
          </p>
        )}
        {existing?.verification_status === 'REJECTED' && existing.verification_notes && (
          <div className="alert alert-error" style={{ fontSize: 13 }}>
            <strong>Why the last one was rejected:</strong> {existing.verification_notes}
          </div>
        )}
        <Field label="Document File (PDF, JPG, PNG, Excel. Max 10MB)">
          <input type="file" required onChange={(e) => setFile(e.target.files[0])} />
        </Field>
        <Field label="Valid until (leave empty if it does not expire)">
          <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
        {!existing && (
        <>
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
        {canAdminDirectUpload && autoCategory === 'VERIFY' && (
          <div style={{ margin: '14px 0 6px', padding: '10px 14px', background: 'linear-gradient(135deg, rgba(37,99,235,0.06) 0%, rgba(30,58,138,0.08) 100%)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              id="autoVerifyDoc"
              checked={autoVerify}
              onChange={(e) => setAutoVerify(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#2563eb' }}
            />
            <label htmlFor="autoVerifyDoc" style={{ fontSize: 12.5, fontWeight: 600, color: '#1e3a8a', cursor: 'pointer', margin: 0 }}>
              Direct SJVN Admission: Auto-verify document upon upload (Clears regulatory approval checklist)
            </label>
          </div>
        )}
        </>
        )}
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

export function ReviewModal({ open, doc, onClose, onSuccess }) {
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [reasons, setReasons] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setCode('');
    api.documents.rejectReasons().then(setReasons).catch(() => setReasons([]));
  }, [open, doc?.latest_version_id]);

  if (!open || !doc) return null;

  async function handleAction(action) {
    if (action === 'REJECT' && !code) {
      alert('Choose why the document is being rejected');
      return;
    }
    if (action === 'REJECT' && code === 'OTHER' && !reason.trim()) {
      alert('Please say what is wrong with the document');
      return;
    }

    setSubmitting(true);
    try {
      if (action === 'VERIFY') {
        await api.documents.verify(doc.latest_version_id);
      } else {
        await api.documents.reject(doc.latest_version_id, reason, code);
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
    <Modal open={open} onClose={onClose} title="Review Document" width={740}>
      <div style={{ marginBottom: 16 }}>
        <strong>{doc.title}</strong> (v{doc.version_number})
        <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4 }}>
          {doc.entity_name ? `${doc.entity_name} · ` : ''}{doc.document_type} · uploaded {fmtDateTime(doc.uploaded_at || doc.created_at)}
          {doc.uploaded_by_name ? ` by ${doc.uploaded_by_name}` : ''}
        </div>
        {doc.expiry_date && <div style={{ marginTop: 8 }}><ExpiryTag doc={doc} /></div>}
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreviewOpen(true)}>
            View file
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <ExtractedChecks extracted={doc.extracted} />
      </div>

      <Field label="If rejecting — why">
        <select value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">Choose a reason…</option>
          {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </Field>
      <Field label="Remark for the company (they will see this)">
        <textarea
          rows={3}
          placeholder="e.g. Image is blurry, please upload a clear scanned copy"
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

/** Every version of one document: who sent it, what SJVN said, and the file itself. */
function HistoryModal({ doc, onClose }) {
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!doc) return;
    setVersions(null);
    setError('');
    api.documents.history(doc.id)
      .then((r) => setVersions(r.versions))
      .catch((e) => setError(e.response?.data?.error || 'Could not load the versions'));
  }, [doc?.id]);

  if (!doc) return null;

  return (
    <Modal open onClose={onClose} title={`Versions — ${doc.title}`} width={860}>
      {error && <div className="alert alert-error">{error}</div>}
      {!versions && !error && <div style={{ padding: 20 }}>Loading…</div>}
      {versions && (
        <div className="table-wrap">
          <table className="data-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Uploaded</th>
                <th scope="col">Status</th>
                <th scope="col">Reviewed</th>
                <th scope="col">Valid until</th>
                <th scope="col">File</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td><strong>v{v.version_number}</strong></td>
                  <td>
                    {fmtDateTime(v.created_at)}
                    <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{v.uploaded_by_name || '—'}</div>
                  </td>
                  <td style={{ maxWidth: 240 }}>
                    <DocStatus doc={v} />
                    {v.verification_notes && (
                      <div style={{ marginTop: 4, fontSize: 12, color: '#b91c1c' }}>{v.verification_notes}</div>
                    )}
                  </td>
                  <td>
                    {v.verified_at ? fmtDateTime(v.verified_at) : '—'}
                    {v.verified_by_name && <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{v.verified_by_name}</div>}
                  </td>
                  <td>{v.expiry_date ? fmtDate(v.expiry_date) : '—'}</td>
                  <td>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreview(v)}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PreviewModal open={!!preview} versionId={preview?.id} fileName={preview?.file_name} onClose={() => setPreview(null)} />
    </Modal>
  );
}
