import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="empty-state">
        <h3>Access restricted</h3>
        <p>Your role ({user.role.replaceAll('_', ' ')}) does not have access to this module.</p>
      </div>
    );
  }
  return children;
}
