import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProtectedRoute({ children, roles, requiresKyc }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="empty-state">
        <h3>Access restricted</h3>
        <p>Your role ({String(user.role || '').replaceAll('_', ' ') || 'unknown'}) does not have access to this module.</p>
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
