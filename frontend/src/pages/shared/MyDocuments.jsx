import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Badge } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';
import { APPROVAL_STATUS_LABELS } from '../../constants/regulatoryApprovals.js';

// Seller/Buyer-facing document centre. The counterparty uploads their own
// KYC + regulatory proofs here (VERIFY category) — the one place the backend
// actually lets them do it. SJVN's REIA desk then verifies each one, and the
// result shows up beside every regulatory approval on the stakeholder record.
export default function MyDocuments() {
  const { user } = useAuth();
  const entity = user?.entity;
  const [checklist, setChecklist] = useState([]);

  // Pull the entity's regulatory checklist so the user can see, at a glance,
  // which clearances still need a proof and which are already verified.
  useEffect(() => {
    if (!entity?.id) return;
    api.entities.get(entity.id)
      .then((e) => setChecklist(e.regulatory_checklist || []))
      .catch(() => setChecklist([]));
  }, [entity?.id]);

  if (!entity?.id) {
    return (
      <div>
        <PageHeader title="My Documents & KYC" subtitle="Upload your registration, licences and regulatory proofs" />
        <Card>
          <p style={{ margin: 0, color: '#64748b' }}>
            Your login isn't linked to a company record yet. Please ask the SJVN REIA team to link your
            account to your entity before uploading documents.
          </p>
        </Card>
      </div>
    );
  }

  const pending = checklist.filter((c) => c.is_mandatory && c.status !== 'VERIFIED' && c.status !== 'NOT_APPLICABLE');

  return (
    <div>
      <PageHeader
        title="My Documents & KYC"
        subtitle="Upload your registration, licences, guarantees and regulatory proofs. SJVN will verify each one."
      />

      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 20 }}>📎</span>
          <div>
            <strong style={{ fontSize: 14 }}>How this works</strong>
            <p style={{ margin: '4px 0 0', fontSize: 13.5, color: '#475569', lineHeight: 1.55 }}>
              Use <strong>Upload Document</strong> below and pick the matching document type (e.g. Generation
              License, Company Registration). These are <strong>Verify</strong> documents — once uploaded they
              go to SJVN for verification, and the status appears against the matching item in your Regulatory
              Approvals checklist. Your onboarding is approved only after all mandatory proofs are verified.
            </p>
          </div>
        </div>
      </Card>

      {checklist.length > 0 && (
        <Card title="Regulatory Approvals — what to upload" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {checklist.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                  padding: '8px 4px', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13 }}>{item.label}</strong>
                  {item.is_mandatory
                    ? <span style={{ fontSize: 11, color: '#b91c1c' }}>Required</span>
                    : <span style={{ fontSize: 11, color: '#64748b' }}>Optional</span>}
                </div>
                <Badge
                  status={item.status === 'VERIFIED' ? 'ACTIVE' : item.status === 'NOT_APPLICABLE' ? 'DRAFT' : 'PENDING'}
                  label={APPROVAL_STATUS_LABELS[item.status] || item.status}
                />
              </div>
            ))}
          </div>
          {pending.length > 0 && (
            <p style={{ margin: '12px 0 0', fontSize: 12.5, color: '#b45309' }}>
              {pending.length} mandatory {pending.length === 1 ? 'clearance' : 'clearances'} still awaiting a verified proof.
            </p>
          )}
        </Card>
      )}

      <div style={{ marginTop: 16 }}>
        <DocumentManager
          moduleName="STAKEHOLDERS"
          entityId={entity.id}
          title="My Documents (KYC, Registration, Licences)"
        />
      </div>
    </div>
  );
}
