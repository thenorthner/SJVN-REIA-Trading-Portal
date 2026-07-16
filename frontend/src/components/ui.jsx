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
  // Dispute lifecycle
  RAISED: 'blue', ACKNOWLEDGED: 'blue', INFO_REQUESTED: 'amber', ESCALATED: 'red',
  RESOLVED_ACCEPTED: 'green', RESOLVED_REJECTED: 'red',
  // Reconciliation
  AUTO_MATCHED: 'green', NEEDS_REVIEW: 'amber', PENDING_SIGN_OFF: 'blue',
  AGREED: 'green', REOPENED: 'amber', IN_PROGRESS: 'blue',
  // Payment security
  PARTIALLY_UTILIZED: 'amber', RENEWED: 'blue', RELEASE_PENDING: 'amber', RELEASED: 'green',
  ELIGIBLE: 'amber', NOTICE_ISSUED: 'blue', CLAIMED: 'amber', FUNDS_RECEIVED: 'green',
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

export function StatementViewer({ statement }) {
  if (!statement) return <div className="empty-cell">No statement available.</div>;
  const m = statement.metrics;
  const isHealthy = m.items_exception === 0 && m.auto_match_pct >= 90;

  return (
    <div className="statement-viewer" style={{ background: 'var(--bg-main, #f8fafc)', borderRadius: 8, padding: 16, border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h4 style={{ margin: 0, color: '#1e293b' }}>Statement {statement.recon_no}</h4>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Period: {statement.period} ({statement.period_type}) • Basis: {statement.data_basis}</div>
        </div>
        <Badge status={statement.status} />
      </div>

      <div className="metrics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatCard label="Match Confidence" value={`${m.auto_match_pct}%`} tone={m.auto_match_pct > 90 ? 'green' : 'amber'} />
        <StatCard label="Total Items" value={m.items_total} />
        <StatCard label="Exceptions" value={m.items_exception} tone={m.items_exception === 0 ? 'green' : 'red'} />
        <StatCard label="Unreconciled Amt" value={fmtCurrency(m.unreconciled_amount)} tone={m.unreconciled_amount === 0 ? 'green' : 'red'} />
      </div>

      <div style={{ backgroundColor: isHealthy ? '#f0fdf4' : '#fef2f2', padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13, border: `1px solid ${isHealthy ? '#bbf7d0' : '#fecaca'}` }}>
        <strong style={{ color: isHealthy ? '#166534' : '#991b1b' }}>{isHealthy ? '✅ Data is fully reconciled and ready for sign-off.' : '⚠️ Exceptions detected. Review required before sign-off.'}</strong>
      </div>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <table className="data-table" style={{ margin: 0 }}>
          <thead style={{ background: '#f1f5f9' }}>
            <tr>
              <th>Check Item</th>
              <th>Status</th>
              <th>Metered / Expected</th>
              <th>Billed / Actual</th>
              <th>Variance</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {statement.items.map((it, idx) => (
              <tr key={idx} style={{ background: it.status === 'EXACT' ? 'transparent' : '#fff1f2' }}>
                <td style={{ fontWeight: 500, fontSize: 13 }}>{it.label}</td>
                <td><Badge status={it.status === 'EXACT' ? 'AUTO_MATCHED' : 'NEEDS_REVIEW'} /></td>
                <td>{it.metered != null ? fmtNumber(it.metered, 2) : '-'}</td>
                <td>{it.billed != null ? (it.type.includes('FINANCIAL') ? fmtCurrency(it.billed) : fmtNumber(it.billed, 2)) : '-'}</td>
                <td style={{ color: it.variance !== 0 ? '#e53e3e' : '#10b981', fontWeight: it.variance !== 0 ? 600 : 400 }}>
                  {it.variance != null ? fmtNumber(it.variance, 2) : '-'}
                </td>
                <td style={{ fontSize: 12, color: '#64748b' }}>{it.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      <div style={{ display: 'flex', gap: 24, marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>SJVN Sign-off</div>
          <div style={{ fontWeight: 500 }}>{statement.sign_off?.sjvn ? `✅ ${statement.sign_off.sjvn.by}` : 'Pending'}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>Counterparty Sign-off</div>
          <div style={{ fontWeight: 500 }}>{statement.sign_off?.counterparty ? `✅ ${statement.sign_off.counterparty.by}` : 'Pending'}</div>
        </div>
      </div>
    </div>
  );
}

export function DemandLetterViewer({ letterStr }) {
  if (!letterStr) return null;
  let letter;
  try {
    letter = JSON.parse(letterStr);
  } catch(e) {
    return <div className="empty-cell">Invalid letter format</div>;
  }

  return (
    <div className="card" style={{ border: '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden', margin: '16px 0', background: 'white' }}>
      <div style={{ background: '#f8fafc', padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, textTransform: 'uppercase', color: '#64748b', fontWeight: 600, letterSpacing: 0.5 }}>Official Demand Letter</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginTop: 4 }}>{letter.subject}</div>
        </div>
        <Badge status="NOTICE_ISSUED" />
      </div>
      
      <div style={{ padding: '20px' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>To:</div>
          <div style={{ fontSize: 15, fontWeight: 500, color: '#1e293b' }}>{letter.to}</div>
        </div>
        
        <div style={{ display: 'flex', gap: 32, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 13, color: '#64748b' }}>Demand Amount</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: '#b91c1c' }}>{fmtCurrency(letter.amount)}</div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#64748b' }}>Date Issued</div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>{new Date().toLocaleDateString('en-IN')}</div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Outstanding Invoices Covered:</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {letter.invoice_ids?.map((inv) => (
              <span key={inv} style={{ padding: '4px 8px', background: '#f1f5f9', borderRadius: 4, fontSize: 13, border: '1px solid #e2e8f0' }}>{inv}</span>
            ))}
          </div>
        </div>

        {letter.waterfall?.length > 0 && (
          <div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Invocation Waterfall Sequence:</div>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: '#334155' }}>
              {letter.waterfall.map((step, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{step}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <div style={{ padding: '12px 20px', background: '#fffbeb', borderTop: '1px solid #fef3c7', fontSize: 12, color: '#92400e' }}>
        <strong>Important:</strong> This is a legally binding demand against the counterparty's payment security. The specified waterfall sequence will be executed unless payment is received immediately.
      </div>
    </div>
  );
}
