import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Badge } from '../../components/ui.jsx';
import { DocumentManager, ExpiryTag } from '../../components/DocumentManager.jsx';
import { FileText } from 'lucide-react';
import { fmtDate } from '../../datetime.js';
import { APPROVAL_STATUS_LABELS } from '../../constants/regulatoryApprovals.js';

// Seller/Buyer-facing document centre.
// Physical Document Policy: Counterparties submit hard copies of their KYC,
// registration, and regulatory proofs directly to SJVN REIA Office. SJVN Admin
// scans, uploads, and verifies each proof. This page allows counterparties to
// track verification status and view their records without direct uploading.
export default function MyDocuments() {
  const { user } = useAuth();
  const entity = user?.entity;
  const [checklist, setChecklist] = useState([]);
  const [docs, setDocs] = useState([]);
  const [requests, setRequests] = useState([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!entity?.id) return;
    api.documents.list({ entity_id: entity.id }).then(setDocs).catch(() => setDocs([]));
    api.documents.requests({ status: 'OPEN' }).then(setRequests).catch(() => setRequests([]));
  }, [entity?.id, tick]);

  // Pull the entity's regulatory checklist so the user can see which clearances
  // are verified by SJVN and which are still awaiting physical submission.
  useEffect(() => {
    if (!entity?.id) return;
    api.entities.get(entity.id)
      .then((e) => setChecklist(e.regulatory_checklist || []))
      .catch(() => setChecklist([]));
  }, [entity?.id, tick]);

  if (!entity?.id) {
    return (
      <div>
        <PageHeader title="My Documents & KYC" subtitle="Verification status of physical registration, licences and regulatory proofs" />
        <Card>
          <p style={{ margin: 0, color: 'var(--slate-500)' }}>
            Your login isn't linked to a company record yet. Please ask the SJVN REIA team to link your
            account to your entity before viewing documents.
          </p>
        </Card>
      </div>
    );
  }

  const pending = checklist.filter((c) => c.is_mandatory && c.status !== 'VERIFIED' && c.status !== 'NOT_APPLICABLE');
  const required = checklist.filter((c) => c.is_mandatory && c.status !== 'NOT_APPLICABLE');
  const done = required.length - pending.length;
  const pct = required.length ? Math.round((done / required.length) * 100) : null;
  const dated = docs.filter((d) => d.expiry_state && d.verification_status !== 'REJECTED').sort((a, b) => a.days_to_expiry - b.days_to_expiry);
  const rejected = docs.filter((d) => d.verification_status === 'REJECTED');

  return (
    <div>
      <PageHeader
        title="My Documents & KYC"
        subtitle="Verification status of registration, licences, guarantees and regulatory proofs submitted to SJVN."
      />

      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <FileText size={22} color="var(--primary)" style={{ marginTop: 2, flexShrink: 0 }} />
          <div>
            <strong style={{ fontSize: 15.5 }}>Physical Document Submission Process</strong>
            <p style={{ margin: '4px 0 0', fontSize: 15, color: 'var(--slate-600)', lineHeight: 1.55 }}>
              All KYC, company registration, and regulatory compliance proofs must be submitted in physical hard-copy form
              directly to the <strong>SJVN REIA Office</strong>. The SJVN Administration team will scan, upload, and verify
              each proof on your company profile. You can monitor the verification status and validity of all documents below.
            </p>
          </div>
        </div>
      </Card>

      {pct !== null && (
        <Card style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 16 }}>KYC {pct}% complete</strong>
            <span style={{ fontSize: 14.5, color: 'var(--slate-600)' }}>
              {done} of {required.length} mandatory proofs verified
              {pending.length > 0 ? ` · ${pending.length} to go` : ''}
            </span>
          </div>
          <div
            role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="KYC progress"
            style={{ marginTop: 10, height: 10, borderRadius: 999, background: 'var(--slate-100, var(--slate-100))', overflow: 'hidden' }}
          >
            <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: pct === 100 ? '#16a34a' : '#2563eb', transition: 'width .3s' }} />
          </div>
          {pending.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 14.5, color: 'var(--slate-600)' }}>
              Still needed: {pending.map((c) => c.label).join(' · ')}
            </div>
          )}
        </Card>
      )}

      {requests.length > 0 && (
        <Card title="SJVN has asked for" style={{ marginTop: 16 }}>
          {requests.map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--slate-100)', flexWrap: 'wrap' }}>
              <div>
                <strong style={{ fontSize: 15 }}>{r.document_type}</strong>
                {r.due_date && (
                  <span style={{ marginLeft: 8, fontSize: 15, fontWeight: 600, color: r.overdue ? 'var(--red-deep)' : 'var(--amber-strong)' }}>
                    {r.overdue ? 'Was due' : 'Due'} {fmtDate(r.due_date)}
                  </span>
                )}
                {r.note && <div style={{ fontSize: 15, color: 'var(--slate-600)', marginTop: 2 }}>{r.note}</div>}
              </div>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--on-amber)', background: 'var(--t-amber-100)', padding: '4px 10px', borderRadius: 6 }}>
                Submit physical copy to SJVN REIA desk
              </span>
            </div>
          ))}
        </Card>
      )}

      {(dated.length > 0 || rejected.length > 0) && (
        <Card title="Needs your attention" style={{ marginTop: 16 }}>
          {rejected.map((d) => (
            <div key={d.id} style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--slate-100)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ fontSize: 15, marginRight: 8 }}>{d.title}</strong>
                <Badge status="REJECTED" />
                <div style={{ fontSize: 15, color: 'var(--red-deep)', marginTop: 2 }}>
                  <strong>SJVN's remark:</strong> {d.verification_notes || 'No remark was given.'}
                </div>
              </div>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--red-deep)', background: 'var(--t-red-100)', padding: '4px 10px', borderRadius: 6 }}>
                Submit revised physical copy to SJVN
              </span>
            </div>
          ))}
          {dated.map((d) => (
            <div key={d.id} style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--slate-100)', flexWrap: 'wrap' }}>
              <div>
                <strong style={{ fontSize: 15 }}>{d.title}</strong>
                <div style={{ marginTop: 2 }}><ExpiryTag doc={d} /></div>
              </div>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--on-amber)', background: 'var(--t-amber-100)', padding: '4px 10px', borderRadius: 6 }}>
                Submit renewed copy to SJVN
              </span>
            </div>
          ))}
        </Card>
      )}

      {checklist.length > 0 && (
        <Card title="Regulatory Approvals & Clearance Status" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {checklist.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                  padding: '8px 4px', borderBottom: '1px solid var(--slate-100)', flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14.5 }}>{item.label}</strong>
                  {item.is_mandatory
                    ? <span style={{ fontSize: 14.5, color: 'var(--red-deep)' }}>Required</span>
                    : <span style={{ fontSize: 14.5, color: 'var(--slate-500)' }}>Optional</span>}
                </div>
                <Badge
                  status={item.status === 'VERIFIED' ? 'ACTIVE' : item.status === 'NOT_APPLICABLE' ? 'DRAFT' : 'PENDING'}
                  label={APPROVAL_STATUS_LABELS[item.status] || item.status}
                />
              </div>
            ))}
          </div>
          {pending.length > 0 && (
            <p style={{ margin: '12px 0 0', fontSize: 15, color: 'var(--amber-strong)' }}>
              {pending.length} mandatory {pending.length === 1 ? 'clearance' : 'clearances'} awaiting verified proof from SJVN desk.
            </p>
          )}
        </Card>
      )}

      <div style={{ marginTop: 16 }}>
        <DocumentManager
          onChange={() => setTick((n) => n + 1)}
          moduleName="STAKEHOLDERS"
          entityId={entity.id}
          canUpload={false}
          title="Verified Documents (KYC, Registration, Licences)"
        />
      </div>
    </div>
  );
}
