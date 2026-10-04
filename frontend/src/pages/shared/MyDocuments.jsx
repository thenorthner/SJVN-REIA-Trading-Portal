import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Badge } from '../../components/ui.jsx';
import { DocumentManager, UploadModal, ExpiryTag } from '../../components/DocumentManager.jsx';
import { fmtDate } from '../../datetime.js';
import { APPROVAL_STATUS_LABELS } from '../../constants/regulatoryApprovals.js';

// Seller/Buyer-facing document centre. The counterparty uploads their own
// KYC + regulatory proofs here (VERIFY category) — the one place the backend
// actually lets them do it. SJVN's REIA desk then verifies each one, and the
// result shows up beside every regulatory approval on the stakeholder record.
export default function MyDocuments() {
  const { user } = useAuth();
  const entity = user?.entity;
  const [checklist, setChecklist] = useState([]);
  const [docs, setDocs] = useState([]);
  const [requests, setRequests] = useState([]);
  const [renew, setRenew] = useState(null);
  const [answer, setAnswer] = useState(null);
  // Bumped after an upload made from this page, so the list below reloads too.
  const [round, setRound] = useState(0);
  // Bumped when the list below changes something, so the cards above re-read.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!entity?.id) return;
    api.documents.list({ entity_id: entity.id }).then(setDocs).catch(() => setDocs([]));
    api.documents.requests({ status: 'OPEN' }).then(setRequests).catch(() => setRequests([]));
  }, [entity?.id, round, tick]);

  // Pull the entity's regulatory checklist so the user can see, at a glance,
  // which clearances still need a proof and which are already verified.
  useEffect(() => {
    if (!entity?.id) return;
    api.entities.get(entity.id)
      .then((e) => setChecklist(e.regulatory_checklist || []))
      .catch(() => setChecklist([]));
  }, [entity?.id, round, tick]);

  if (!entity?.id) {
    return (
      <div>
        <PageHeader title="My Documents & KYC" subtitle="Upload your registration, licences and regulatory proofs" />
        <Card>
          <p style={{ margin: 0, color: 'var(--slate-500)' }}>
            Your login isn't linked to a company record yet. Please ask the SJVN REIA team to link your
            account to your entity before uploading documents.
          </p>
        </Card>
      </div>
    );
  }

  const pending = checklist.filter((c) => c.is_mandatory && c.status !== 'VERIFIED' && c.status !== 'NOT_APPLICABLE');
  // Progress is counted over what is mandatory and applies to this company.
  const required = checklist.filter((c) => c.is_mandatory && c.status !== 'NOT_APPLICABLE');
  const done = required.length - pending.length;
  const pct = required.length ? Math.round((done / required.length) * 100) : null;
  const dated = docs.filter((d) => d.expiry_state && d.verification_status !== 'REJECTED').sort((a, b) => a.days_to_expiry - b.days_to_expiry);
  const rejected = docs.filter((d) => d.verification_status === 'REJECTED');

  return (
    <div>
      <PageHeader
        title="My Documents & KYC"
        subtitle="Upload your registration, licences, guarantees and regulatory proofs. SJVN will verify each one."
      />

      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 20 }}></span>
          <div>
            <strong style={{ fontSize: 14 }}>How this works</strong>
            <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--slate-600)', lineHeight: 1.55 }}>
              Use <strong>Upload Document</strong> below and pick the matching document type (e.g. Generation
              License, Company Registration). These are <strong>Verify</strong> documents — once uploaded they
              go to SJVN for verification, and the status appears against the matching item in your Regulatory
              Approvals checklist. Your onboarding is approved only after all mandatory proofs are verified.
            </p>
          </div>
        </div>
      </Card>

      {pct !== null && (
        <Card style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>KYC {pct}% complete</strong>
            <span style={{ fontSize: 13, color: 'var(--slate-600)' }}>
              {done} of {required.length} mandatory proofs verified
              {pending.length > 0 ? ` · ${pending.length} to go` : ''}
            </span>
          </div>
          <div
            role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="KYC progress"
            style={{ marginTop: 10, height: 10, borderRadius: 999, background: 'var(--slate-100, #f1f5f9)', overflow: 'hidden' }}
          >
            <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: pct === 100 ? '#16a34a' : '#2563eb', transition: 'width .3s' }} />
          </div>
          {pending.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 13, color: 'var(--slate-600)' }}>
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
                <strong style={{ fontSize: 13.5 }}>{r.document_type}</strong>
                {r.due_date && (
                  <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: r.overdue ? '#b91c1c' : '#b45309' }}>
                    {r.overdue ? 'Was due' : 'Due'} {fmtDate(r.due_date)}
                  </span>
                )}
                {r.note && <div style={{ fontSize: 12.5, color: 'var(--slate-600)', marginTop: 2 }}>{r.note}</div>}
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setAnswer(r)}>Upload it</button>
            </div>
          ))}
        </Card>
      )}

      {(dated.length > 0 || rejected.length > 0) && (
        <Card title="Needs your attention" style={{ marginTop: 16 }}>
          {rejected.map((d) => (
            <div key={d.id} style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--slate-100)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ fontSize: 13.5, marginRight: 8 }}>{d.title}</strong>
                <Badge status="REJECTED" />
                <div style={{ fontSize: 12.5, color: '#b91c1c', marginTop: 2 }}>
                  <strong>SJVN's remark:</strong> {d.verification_notes || 'No remark was given.'}
                </div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setRenew(d)}>Upload a corrected copy</button>
            </div>
          ))}
          {dated.map((d) => (
            <div key={d.id} style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--slate-100)', flexWrap: 'wrap' }}>
              <div>
                <strong style={{ fontSize: 13.5 }}>{d.title}</strong>
                <div style={{ marginTop: 2 }}><ExpiryTag doc={d} /></div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setRenew(d)}>Upload the renewed one</button>
            </div>
          ))}
        </Card>
      )}

      {checklist.length > 0 && (
        <Card title="Regulatory Approvals — what to upload" style={{ marginTop: 16 }}>
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
                  <strong style={{ fontSize: 13 }}>{item.label}</strong>
                  {item.is_mandatory
                    ? <span style={{ fontSize: 11, color: 'var(--red-deep)' }}>Required</span>
                    : <span style={{ fontSize: 11, color: 'var(--slate-500)' }}>Optional</span>}
                </div>
                <Badge
                  status={item.status === 'VERIFIED' ? 'ACTIVE' : item.status === 'NOT_APPLICABLE' ? 'DRAFT' : 'PENDING'}
                  label={APPROVAL_STATUS_LABELS[item.status] || item.status}
                />
              </div>
            ))}
          </div>
          {pending.length > 0 && (
            <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--amber-strong)' }}>
              {pending.length} mandatory {pending.length === 1 ? 'clearance' : 'clearances'} still awaiting a verified proof.
            </p>
          )}
        </Card>
      )}

      <div style={{ marginTop: 16 }}>
        <DocumentManager
          key={round}
          onChange={() => setTick((n) => n + 1)}
          moduleName="STAKEHOLDERS"
          entityId={entity.id}
          title="My Documents (KYC, Registration, Licences)"
        />
      </div>

      <UploadModal
        open={!!renew}
        existing={renew}
        moduleName="STAKEHOLDERS"
        onClose={() => setRenew(null)}
        onSuccess={() => setRound((n) => n + 1)}
      />
      <UploadModal
        open={!!answer}
        moduleName="STAKEHOLDERS"
        entityId={entity.id}
        presetDocType={answer?.document_type}
        presetTitle={answer?.document_type || ''}
        onClose={() => setAnswer(null)}
        onSuccess={() => setRound((n) => n + 1)}
      />
    </div>
  );
}
