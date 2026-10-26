import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isSellerRole, isBuyerRole } from '../roles';
import { ShieldAlert, Check } from 'lucide-react';
import api from '../api/client.js';

const bar = (tone) => ({
  backgroundColor: tone === 'red' ? 'var(--t-red-50)' : 'var(--t-amber-50)',
  color: tone === 'red' ? 'var(--red-deep)' : 'var(--amber-strong)',
  padding: '12px 20px',
  borderBottom: tone === 'red' ? '1px solid #f87171' : '1px solid var(--t-amber-100)',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  fontSize: '15.5px',
  fontWeight: '500',
});

const getStoredAck = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const setStoredAck = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

export default function KYCBanner() {
  const { user } = useAuth();
  const location = useLocation();
  const applies = !!user && (isSellerRole(user?.role) || isBuyerRole(user?.role)) && !!user.entity;
  const [docs, setDocs] = useState([]);
  const [requests, setRequests] = useState([]);
  const [partsDismissed, setPartsDismissed] = useState(false);
  const [entityDismissed, setEntityDismissed] = useState(false);

  // What on the document side needs this company to act: a proof running out,
  // one sent back, or one SJVN has asked for. Re-read as they move about, so
  // the bar clears once it has been dealt with.
  useEffect(() => {
    if (!applies) return;
    api.documents.list({ entity_id: user.entity.id }).then(setDocs).catch(() => {});
    api.documents.requests({ status: 'OPEN' }).then(setRequests).catch(() => {});
  }, [applies, user?.entity?.id, location.pathname]);

  // Only apply to Sellers and Buyers
  if (!applies) return null;

  const isPending = user.entity.status === 'PENDING';
  const isRejected = user.entity.status === 'REJECTED';
  const docsPath = isSellerRole(user.role) ? '/seller/documents' : '/buyer/documents';

  // A rejected document is counted once, as rejected, whatever its date.
  const live = docs.filter((d) => d.verification_status !== 'REJECTED');
  const expired = live.filter((d) => d.expiry_state === 'EXPIRED');
  const expiring = live.filter((d) => d.expiry_state === 'EXPIRING');
  const sentBack = docs.filter((d) => d.verification_status === 'REJECTED');
  const soonest = [...expiring].sort((a, b) => a.days_to_expiry - b.days_to_expiry)[0];
  const parts = [];
  if (expired.length) parts.push(`${expired.length} document${expired.length === 1 ? ' has' : 's have'} expired`);
  if (soonest) {
    parts.push(expiring.length === 1
      ? `${soonest.title} expires in ${soonest.days_to_expiry} day${soonest.days_to_expiry === 1 ? '' : 's'}`
      : `${expiring.length} documents expire within 30 days (the first in ${soonest.days_to_expiry})`);
  }
  if (sentBack.length) parts.push(`${sentBack.length} document${sentBack.length === 1 ? ' was' : 's were'} rejected by SJVN`);
  if (requests.length) parts.push(`SJVN has asked for ${requests.length} document${requests.length === 1 ? '' : 's'}`);
  const onDocsPage = location.pathname === docsPath;

  const partsKey = parts.length > 0
    ? `${user.entity.id}_parts_${parts.join('|')}_${sentBack.map((d) => d.id).join(',')}_${expired.map((d) => d.id).join(',')}`
    : '';
  const entityKey = user.entity.status !== 'APPROVED'
    ? `${user.entity.id}_status_${user.entity.status}`
    : '';

  const isPartsAcked = partsDismissed || (!!partsKey && (
    getStoredAck(`sjvn_kyc_parts_ack_${user.entity.id}`) === partsKey ||
    getStoredAck(`sjvn_kyc_ack_${partsKey}`) === 'true'
  ));

  const isEntityAcked = entityDismissed || (!!entityKey && (
    getStoredAck(`sjvn_kyc_entity_ack_${user.entity.id}`) === entityKey ||
    getStoredAck(`sjvn_kyc_ack_${entityKey}`) === 'true'
  ));

  const handleAckParts = () => {
    if (partsKey) {
      setStoredAck(`sjvn_kyc_parts_ack_${user.entity.id}`, partsKey);
      setStoredAck(`sjvn_kyc_ack_${partsKey}`, 'true');
    }
    setPartsDismissed(true);
  };

  const handleAckEntity = () => {
    if (entityKey) {
      setStoredAck(`sjvn_kyc_entity_ack_${user.entity.id}`, entityKey);
      setStoredAck(`sjvn_kyc_ack_${entityKey}`, 'true');
    }
    setEntityDismissed(true);
  };

  return (
    <>
      {user.entity.status !== 'APPROVED' && !isEntityAcked && (
        <div style={bar(isRejected ? 'red' : 'amber')} role="status">
          <ShieldAlert size={20} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            {isPending && "Your company KYC and Regulatory Documents are pending physical verification by SJVN. Physical documents submitted to the SJVN office will be scanned and verified by SJVN Admin."}
            {isRejected && "Your company KYC has remarks from SJVN. Please submit revised physical documents to the SJVN REIA office for re-verification."}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <Link
              to={docsPath}
              style={{
                fontSize: '14px',
                fontWeight: '600',
                color: isRejected ? 'var(--red-deep)' : 'var(--amber-strong)',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                marginRight: '4px',
                whiteSpace: 'nowrap',
              }}
            >
              View Documents
            </Link>
            <button
              type="button"
              onClick={handleAckEntity}
              title="Acknowledge and dismiss this alert"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 11px',
                fontSize: '13.5px',
                fontWeight: '700',
                borderRadius: '6px',
                cursor: 'pointer',
                background: isRejected ? 'var(--t-red-100)' : 'var(--t-amber-100)',
                color: isRejected ? 'var(--on-red)' : 'var(--on-amber)',
                border: isRejected ? '1px solid #fca5a5' : '1px solid var(--t-amber-line)',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isRejected ? '#fecaca' : '#fde68a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isRejected ? '#fee2e2' : '#fef3c7';
              }}
            >
              <Check size={13} strokeWidth={2.5} />
              <span>Ack</span>
            </button>
          </div>
        </div>
      )}
      {parts.length > 0 && !onDocsPage && !isPartsAcked && (
        <div style={bar(expired.length || sentBack.length ? 'red' : 'amber')} role="status">
          <ShieldAlert size={20} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>{parts.join(' · ')}. Please submit updated physical copies to the SJVN REIA desk.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <Link
              to={docsPath}
              style={{
                fontSize: '14px',
                fontWeight: '600',
                color: expired.length || sentBack.length ? 'var(--red-deep)' : 'var(--amber-strong)',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                marginRight: '4px',
                whiteSpace: 'nowrap',
              }}
            >
              View Documents
            </Link>
            <button
              type="button"
              onClick={handleAckParts}
              title="Acknowledge and dismiss this alert"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 11px',
                fontSize: '13.5px',
                fontWeight: '700',
                borderRadius: '6px',
                cursor: 'pointer',
                background: expired.length || sentBack.length ? 'var(--t-red-100)' : 'var(--t-amber-100)',
                color: expired.length || sentBack.length ? 'var(--on-red)' : 'var(--on-amber)',
                border: expired.length || sentBack.length ? '1px solid #fca5a5' : '1px solid var(--t-amber-line)',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = expired.length || sentBack.length ? '#fecaca' : '#fde68a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = expired.length || sentBack.length ? '#fee2e2' : '#fef3c7';
              }}
            >
              <Check size={13} strokeWidth={2.5} />
              <span>Ack</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
