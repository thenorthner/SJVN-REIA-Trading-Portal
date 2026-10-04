import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isSellerRole, isBuyerRole } from '../roles';
import { ShieldAlert } from 'lucide-react';
import api from '../api/client.js';

const bar = (tone) => ({
  backgroundColor: tone === 'red' ? '#fef2f2' : '#fffbeb',
  color: tone === 'red' ? '#b91c1c' : '#b45309',
  padding: '12px 20px',
  borderBottom: tone === 'red' ? '1px solid #f87171' : '1px solid #fcd34d',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  fontSize: '14px',
  fontWeight: '500',
});

export default function KYCBanner() {
  const { user } = useAuth();
  const location = useLocation();
  const applies = !!user && (isSellerRole(user?.role) || isBuyerRole(user?.role)) && !!user.entity;
  const [docs, setDocs] = useState([]);
  const [requests, setRequests] = useState([]);

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

  return (
    <>
      {user.entity.status !== 'APPROVED' && (
        <div style={bar(isRejected ? 'red' : 'amber')}>
          <ShieldAlert size={20} />
          <div>
            {isPending && "Your company KYC and Regulatory Documents are pending verification by SJVN. You cannot raise invoices or access contracts until your onboarding is approved."}
            {isRejected && "Your company KYC has been rejected. Please update your documents. You cannot access business operations until approved."}
          </div>
        </div>
      )}
      {parts.length > 0 && !onDocsPage && (
        <div style={bar(expired.length || sentBack.length ? 'red' : 'amber')} role="status">
          <ShieldAlert size={20} />
          <div style={{ flex: 1 }}>{parts.join(' · ')}.</div>
          <Link to={docsPath} style={{ color: 'inherit', fontWeight: 700, whiteSpace: 'nowrap' }}>Open My Documents →</Link>
        </div>
      )}
    </>
  );
}
