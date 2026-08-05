import React from 'react';

export function PageHeader({ title, subtitle, actions, onAdd, addLabel }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {(actions || onAdd) && (
        <div className="page-actions">
          {actions}
          {onAdd && <button className="btn btn-primary" onClick={onAdd}>+ {addLabel || 'Add'}</button>}
        </div>
      )}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = 'default', onClick }) {
  return (
    <div
      className={`stat-card tone-${tone} ${onClick ? 'clickable' : ''}`}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      // Focusable and Enter/Space-activated when it does something, so the card
      // is reachable without a mouse.
      {...(onClick ? {
        tabIndex: 0,
        role: 'button',
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); }
        },
      } : {})}
    >
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', style }) {
  return (
    <div className={`card ${className}`} style={style}>
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
  // Seller invoice validation
  MATCHED: 'green', PARTIAL: 'amber', MISMATCH: 'red', WAIVED: 'blue', NO_COUNTERPART: 'gray',
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

// Trading module pages pass `type` (a semantic tone name) instead of a
// `status` enum value. Map those onto the same tone palette used by TONE_MAP.
const TYPE_TONE_MAP = { success: 'green', danger: 'red', warning: 'amber', primary: 'blue', neutral: 'gray' };

// `status` (REIA-style, e.g. status="ACTIVE") and `type` + children
// (Trading-style, e.g. type="success">Custom label</Badge>) are both
// supported here so this one component works for every module.
export function Badge({ status, type, label, children }) {
  const tone = TONE_MAP[status] || TYPE_TONE_MAP[type] || 'gray';
  const content = children ?? label ?? (status != null ? String(status).replaceAll('_', ' ') : (type ?? ''));
  return <span className={`badge badge-${tone}`}>{content}</span>;
}

// `rows` (REIA-style) and `data` (Trading-style) are both supported so this
// one component works for every module without each caller needing to match
// an exact prop name.
export function Table({
  columns, rows, data, onRowClick, loading,
  emptyMessage = 'No records found.', caption,
}) {
  const list = rows ?? data ?? [];
  return (
    <div className="table-wrap">
      {/* aria-busy tells assistive tech the table is mid-load rather than empty. */}
      <table className="data-table" aria-busy={loading || undefined}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {/* scope="col" is what associates a data cell with its header; without
                it a screen reader reads cells with no idea which column they are in. */}
            {columns.map((c) => <th key={c.key} scope="col">{c.header ?? c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr><td colSpan={columns.length} className="empty-cell">{loading ? 'Loading...' : emptyMessage}</td></tr>
          )}
          {list.map((row, i) => (
            <tr
              key={row.id ?? i}
              onClick={() => onRowClick?.(row)}
              className={onRowClick ? 'clickable' : ''}
              // A row that responds to a click has to respond to a keyboard too,
              // or the whole table is unusable without a mouse.
              {...(onRowClick ? {
                tabIndex: 0,
                role: 'button',
                onKeyDown: (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row); }
                },
              } : {})}
            >
              {columns.map((c) => <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

let modalSeq = 0;

export function Modal({ open, onClose, title, children, width = 560 }) {
  const titleId = React.useMemo(() => `modal-title-${++modalSeq}`, []);
  const panelRef = React.useRef(null);
  const wasOpenRef = React.useRef(false);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  // Focus modal only once when opening; Escape key listener with stable onClose ref
  React.useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return undefined;
    }
    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      panelRef.current?.focus();
    }
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panelRef}
      >
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1, fontWeight: 'bold' }}>✕</span>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/**
 * Wrapping <label>, so the control inside is associated without needing an id.
 * `htmlFor` is there for the cases where the control cannot be a child.
 */
export function Field({ label, children, required, htmlFor }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field-label">
        {label}
        {required && (
          <>
            <span aria-hidden="true" style={{ color: 'var(--red)' }}> *</span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </span>
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
    <div className="statement-viewer" style={{ background: 'var(--bg-main, var(--slate-50))', borderRadius: 8, padding: 16, border: '1px solid var(--slate-200)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h4 style={{ margin: 0, color: 'var(--slate-800)' }}>Statement {statement.recon_no}</h4>
          <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 4 }}>Period: {statement.period} ({statement.period_type}) • Basis: {statement.data_basis}</div>
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
        <strong style={{ color: isHealthy ? '#166534' : '#991b1b' }}>{isHealthy ? 'Data is fully reconciled and ready for sign-off.' : 'Exceptions detected. Review required before sign-off.'}</strong>
      </div>

      <div style={{ border: '1px solid var(--slate-200)', borderRadius: 8, overflow: 'hidden' }}>
        <table className="data-table" style={{ margin: 0 }}>
          <thead style={{ background: 'var(--slate-100)' }}>
            <tr>
              <th scope="col">Check Item</th>
              <th scope="col">Status</th>
              <th scope="col">Metered / Expected</th>
              <th scope="col">Billed / Actual</th>
              <th scope="col">Variance</th>
              <th scope="col">Notes</th>
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
                <td style={{ fontSize: 12, color: 'var(--slate-500)' }}>{it.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      <div style={{ display: 'flex', gap: 24, marginTop: 16, borderTop: '1px solid var(--slate-200)', paddingTop: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--slate-500)', textTransform: 'uppercase' }}>SJVN Sign-off</div>
          <div style={{ fontWeight: 500 }}>{statement.sign_off?.sjvn ? `${statement.sign_off.sjvn.by}` : 'Pending'}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--slate-500)', textTransform: 'uppercase' }}>Counterparty Sign-off</div>
          <div style={{ fontWeight: 500 }}>{statement.sign_off?.counterparty ? `${statement.sign_off.counterparty.by}` : 'Pending'}</div>
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
    <div className="card" style={{ border: '1px solid var(--slate-300)', borderRadius: 8, overflow: 'hidden', margin: '16px 0', background: 'white' }}>
      <div style={{ background: 'var(--slate-50)', padding: '16px 20px', borderBottom: '1px solid var(--slate-200)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--slate-500)', fontWeight: 600, letterSpacing: 0.5 }}>Official Demand Letter</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--slate-900)', marginTop: 4 }}>{letter.subject}</div>
        </div>
        <Badge status="NOTICE_ISSUED" />
      </div>
      
      <div style={{ padding: '20px' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--slate-500)' }}>To:</div>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--slate-800)' }}>{letter.to}</div>
        </div>
        
        <div style={{ display: 'flex', gap: 32, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--slate-500)' }}>Demand Amount</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--red-deep)' }}>{fmtCurrency(letter.amount)}</div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--slate-500)' }}>Date Issued</div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>{new Date().toLocaleDateString('en-IN')}</div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 4 }}>Outstanding Invoices Covered:</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {letter.invoice_ids?.map((inv) => (
              <span key={inv} style={{ padding: '4px 8px', background: 'var(--slate-100)', borderRadius: 4, fontSize: 13, border: '1px solid var(--slate-200)' }}>{inv}</span>
            ))}
          </div>
        </div>

        {letter.waterfall?.length > 0 && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 4 }}>Invocation Waterfall Sequence:</div>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--slate-700)' }}>
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
export function Tabs({ children, style }) {
  return (
    <div
      className="tabs-container"
      role="tablist"
      style={{ display: 'flex', borderBottom: '1px solid var(--border)', ...style }}
    >
      {children}
    </div>
  );
}

/** A real <button>: the previous <div onClick> could not be reached or activated by keyboard. */
export function Tab({ active, onClick, children }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={!!active}
      onClick={onClick}
      style={{
        padding: '10px 20px',
        cursor: 'pointer',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
        color: active ? 'var(--primary)' : 'var(--text-muted)',
        fontWeight: active ? 600 : 400,
        marginBottom: '-1px',
        font: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

/**
 * Marks a screen whose figures are generated, not read from the platform.
 *
 * Several trading screens were built ahead of their data sources and render
 * convincing tax invoices, obligation reports and SAP references off local
 * generators. Without a standing notice those read as real SJVN positions.
 *
 * `detail` should say what specifically is not connected, so the reader knows
 * which part to distrust rather than dismissing the whole page.
 */
export function SampleDataNotice({ detail }) {
  return (
    <div className="sample-data-notice" role="note">
      <span aria-hidden="true"></span>
      <div>
        <strong>SAMPLE DATA — NOT CONNECTED</strong>
        {detail && <div className="sample-data-notice__detail">{detail}</div>}
      </div>
    </div>
  );
}
