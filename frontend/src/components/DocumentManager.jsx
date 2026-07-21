import React, { useState, useEffect } from 'react';
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
 *
 * Neither the filename nor the stored mime_type can be trusted: a file can be
 * saved as "invoice.pdf" while actually containing a PNG, and legacy uploads
 * have wrong/missing mime types in the DB. The bytes never lie, so we sniff
 * them first and only fall back to the filename/header if the signature is
 * unrecognised.
 *
 * Returns 'application/pdf', an 'image/*' type, or null when inconclusive.
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
    // RIFF....WEBP
    if (startsWith(0x52, 0x49, 0x46, 0x46) && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
      return 'image/webp';
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Decide how to preview a file: 'image', 'pdf', or 'other' (no inline
// preview possible — offer a download instead).
function kindOfType(type = '') {
  if (type === 'application/pdf') return 'pdf';
  if (/^image\//.test(type)) return 'image';
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

function PreviewModal({ open, versionId, fileName, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, url: null, kind: 'other', name: fileName });

  useEffect(() => {
    if (!open || !versionId) return;
    let objectUrl = null;
    let cancelled = false;
    setState({ loading: true, error: null, url: null, kind: 'other', name: fileName });

    (async () => {
      try {
        const { blob, fileName: downloadedName, contentType } = await api.documents.download(versionId);
        const name = downloadedName || fileName;

        // Actual bytes win over the filename and the server header, which are
        // both frequently wrong (e.g. a PNG saved as "test-inv.pdf").
        const sniffed = await sniffType(blob);
        const resolvedType = sniffed || EXT_MIME[extOf(name)] || contentType || blob.type || '';
        const kind = kindOfType(resolvedType);

        // Re-type the blob to match what we're actually rendering, so the
        // browser doesn't try to open an image in its PDF viewer.
        const typed = blob.type === resolvedType ? blob : new Blob([blob], { type: resolvedType });
        const url = URL.createObjectURL(typed);
        objectUrl = url;
        if (!cancelled) setState({ loading: false, error: null, url, kind, name });
      } catch (err) {
        const message = await parseErrorBlob(err, 'Failed to load document');
        if (!cancelled) setState({ loading: false, error: message, url: null, kind: 'other', name: fileName });
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

  return (
    <Modal open={open} onClose={onClose} title={state.name || 'Document Preview'} width={state.kind === 'other' ? 480 : 880}>
      {state.loading && (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading preview...</div>
      )}
      {!state.loading && state.error && (
        <div style={{ padding: 20, color: '#b91c1c' }}>{state.error}</div>
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
          style={{ width: '100%', height: '70vh', border: '1px solid #e2e8f0', borderRadius: 6 }}
        />
      )}
      {!state.loading && !state.error && state.kind === 'other' && (
        <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>
          Preview isn't available for this file type. Use the button below to download it instead.
        </div>
      )}
      {!state.loading && (
        <div className="form-actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          {state.url && (
            <button type="button" className="btn btn-primary" onClick={handleDownload}>⬇️ Download</button>
          )}
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
          ⬆️ Upload Document
        </button>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 20 }}>Loading documents...</div>
        ) : (
          <table className="data-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Title</th>
                <th>Category</th>
                <th>Status</th>
                <th>Version</th>
                <th>Uploaded</th>
                <th>Actions</th>
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
                     <span style={{ color: '#64748b', fontSize: 12 }}>Not Required</span>}
                  </td>
                  <td>v{doc.version_number}</td>
                  <td>{fmtDate(doc.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="View document"
                        onClick={() => setPreviewDoc({ versionId: doc.latest_version_id, fileName: doc.file_name })}
                      >
                        👁️
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

function UploadModal({ open, onClose, onSuccess, moduleName, entityId, contractId }) {
  const { user } = useAuth();
  // Segregation of duties: internal users (SJVN Admin / REIA / Finance / Trading)
  // are the reviewers — they can only upload RECORD-category documents. VERIFY
  // documents must be uploaded by the stakeholder (Seller/Buyer) themselves.
  const isInternal = ['SJVN_ADMIN', 'REIA_USER', 'FINANCE_USER', 'TRADING_USER'].includes(user?.role);
  const filterTypes = (list) => (isInternal ? list.filter((t) => t.category !== 'VERIFY') : list);

  const fallbackTypes = filterTypes(DOCUMENT_TAXONOMY[moduleName] || [{ value: 'OTHER', label: 'Other Document', category: 'RECORD', reason: '' }]);
  const [availableTypes, setAvailableTypes] = useState(fallbackTypes);
  const [file, setFile] = useState(null);
  const [docType, setDocType] = useState(fallbackTypes[0]?.value || 'OTHER');
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
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
        if (mapped.length > 0) setDocType(mapped[0].value);
      })
      .catch(() => {
        // keep FE taxonomy fallback
        setAvailableTypes(fallbackTypes);
        setDocType(fallbackTypes[0]?.value || 'OTHER');
      });
    return () => { cancelled = true; };
  }, [open, moduleName]);

  // Auto-resolve category based on taxonomy
  const activeDef = availableTypes.find(t => t.value === docType) || availableTypes[0] || fallbackTypes[0];
  const autoCategory = activeDef?.category || 'RECORD';
  const noTypesAvailable = availableTypes.length === 0;

  if (!open) return null;

  if (noTypesAvailable) {
    return (
      <Modal open={open} onClose={onClose} title="Upload Document">
        <div style={{ padding: '8px 0 16px' }}>
          <p style={{ fontSize: 14, color: '#334155', margin: '0 0 8px' }}>
            There are no documents for you to upload here.
          </p>
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
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
          <select value={docType} onChange={e => setDocType(e.target.value)}>
            {availableTypes.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {activeDef.reason && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              <i>Why is this needed?</i> {activeDef.reason}
            </div>
          )}
        </Field>
        <Field label="Classification Category (Auto-assigned)">
          <select value={autoCategory} disabled style={{ backgroundColor: '#f8fafc', color: autoCategory === 'VERIFY' ? '#b91c1c' : '#334155', fontWeight: autoCategory === 'VERIFY' ? 'bold' : 'normal' }}>
            <option value="RECORD">Record Only (No approval workflow)</option>
            <option value="VERIFY">Verify (Requires SJVN Admin approval)</option>
          </select>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
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
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
          Uploaded on {fmtDateTime(doc.created_at)}
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setPreviewOpen(true)}
          >
            👁️ View / Download File
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
          ❌ Reject
        </button>
        <button type="button" className="btn btn-success" onClick={() => handleAction('VERIFY')} disabled={submitting}>
          ✅ Verify & Approve
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
