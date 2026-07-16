import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Badge, Modal, Field } from './ui.jsx';
import { DOCUMENT_TAXONOMY } from '../constants/documentTaxonomy.js';

export function DocumentManager({ moduleName, entityId, contractId, category = null, title = 'Documents' }) {
  const { user } = useAuth();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(null);

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
                  <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <a 
                        href={api.documents.downloadUrl(doc.latest_version_id)} 
                        target="_blank" rel="noreferrer"
                        className="btn btn-ghost btn-sm"
                        title="Download latest version"
                      >
                        ⬇️
                      </a>
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
    </div>
  );
}

function UploadModal({ open, onClose, onSuccess, moduleName, entityId, contractId }) {
  const availableTypes = DOCUMENT_TAXONOMY[moduleName] || [{ value: 'OTHER', label: 'Other Document', category: 'RECORD', reason: '' }];
  
  const [file, setFile] = useState(null);
  const [docType, setDocType] = useState(availableTypes[0].value);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);

  // Auto-resolve category based on taxonomy
  const activeDef = availableTypes.find(t => t.value === docType) || availableTypes[0];
  const autoCategory = activeDef.category;

  if (!open) return null;

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
          Uploaded on {new Date(doc.created_at).toLocaleString()}
        </div>
        <div style={{ marginTop: 12 }}>
          <a href={api.documents.downloadUrl(doc.latest_version_id)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
            ⬇️ View / Download File
          </a>
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
    </Modal>
  );
}
