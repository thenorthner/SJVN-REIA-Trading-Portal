import React from 'react';

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = 'default' }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          {title && <h3>{title}</h3>}
          {actions}
        </div>
      )}
      <div className="card-body">{children}</div>
    </div>
  );
}

const TONE_MAP = {
  ACTIVE: 'green', APPROVED: 'green', PAID: 'green', RESOLVED: 'green', CLEARED: 'green', SENT: 'blue',
  DRAFT: 'gray', PENDING: 'amber', SUBMITTED: 'blue', UNDER_APPROVAL: 'amber', UNDER_REVIEW: 'amber',
  PARTIALLY_PAID: 'amber', PARTIALLY_CLEARED: 'amber', OPEN: 'amber', REJECTED: 'red', DISPUTED: 'red',
  EXPIRED: 'red', CANCELLED: 'gray', TERMINATED: 'gray', AMENDED: 'blue', INVOKED: 'red', OVERDUE: 'red',
  CLOSED: 'gray', NO_BID: 'gray', LOCKED: 'green', VALIDATED: 'blue',
};

export function Badge({ status }) {
  const tone = TONE_MAP[status] || 'gray';
  return <span className={`badge badge-${tone}`}>{String(status).replaceAll('_', ' ')}</span>;
}

export function Table({ columns, rows, onRowClick, emptyMessage = 'No records found.' }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="empty-cell">{emptyMessage}</td></tr>
          )}
          {rows.map((row, i) => (
            <tr key={row.id ?? i} onClick={() => onRowClick?.(row)} className={onRowClick ? 'clickable' : ''}>
              {columns.map((c) => <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = 560 }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function fmtCurrency(v) {
  if (v == null || isNaN(v)) return '₹0';
  return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function fmtNumber(v, digits = 1) {
  if (v == null || isNaN(v)) return '0';
  return Number(v).toLocaleString('en-IN', { maximumFractionDigits: digits });
}
