import React from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { pageOpen, pageWithdrawn, firstOpenPage } from '../lib/rolePages.js';
import { REIA_BETA, inReiaBeta } from '../reiaBeta.js';

export default function ProtectedRoute({ children, roles, requiresKyc }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page-loading">Loading...</div>;
  // The page that was asked for goes along, so signing in lands on it.
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  // Role powers may open or close a page for this role (lib/rolePages.js).
  // Without `roles` this is only the sign-in gate (the shell around every
  // page), so a closed page never takes the menu with it.
  if (roles && !pageOpen(user, location.pathname, roles)) {
    const withdrawn = pageWithdrawn(user, location.pathname, roles);
    const elsewhere = withdrawn && firstOpenPage(user, REIA_BETA ? inReiaBeta : undefined);
    return (
      <div className="empty-state">
        <h3>Access restricted</h3>
        <p>
          {withdrawn
            ? 'The SJVN Administrator has taken this power away from your role. Ask them if you need it.'
            : `Your role (${String(user.role || '').replaceAll('_', ' ') || 'unknown'}) does not have access to this module.`}
        </p>
        {elsewhere && <Link className="btn btn-primary" to={elsewhere}>Go to your work</Link>}
      </div>
    );
  }

  // KYC Gate Check
  if (requiresKyc && user.entity && user.entity.status !== 'APPROVED') {
    return (
      <div className="empty-state">
        <h3>Action Requires Verification</h3>
        <p>Your company KYC is currently {user.entity.status}. You cannot access this module until it is APPROVED by SJVN.</p>
      </div>
    );
  }

  return children;
}
