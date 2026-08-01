import React from 'react';
import { Badge, Modal, fmtCurrency, fmtNumber } from './ui.jsx';

/** Status options for invoice list filters (role pages may subset). */
export const INVOICE_STATUS_OPTIONS = [
  'DRAFT', 'SUBMITTED', 'UNDER_APPROVAL', 'APPROVED', 'REJECTED',
  'SENT', 'DISPUTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED',
];

export function calcPayableNow(inv) {
  if (inv == null) return 0;
  if (inv.payable_now != null && !Number.isNaN(Number(inv.payable_now))) return Number(inv.payable_now);
  const total = Number(inv.total_amount) || 0;
  const lps = Number(inv.lps) || 0;
  const disputed = Number(inv.disputed_amount) || 0;
  const rebate = Number(inv.rebate) || 0;
  if (inv.direction === 'SELLER_TO_SJVN') return total - rebate + lps - disputed;
  return total + lps - disputed;
}

export function formatBreakdownValue(item) {
  if (!item) return '—';
  const { code, value, format } = item;
  if (format === 'beta' || code === 'C3') return Number(value).toFixed(2);
  if (format === 'pct' || ['A3', 'A4', 'A11'].includes(code)) return `${fmtNumber(value)}%`;
  if (format === 'ecr' || code === 'A12') return `₹${Number(value).toFixed(3)}/kWh`;
  if (format === 'mwh' || ['E1', 'E2', 'E3', 'E4', 'E5', 'A2', 'SRC', 'ALLOC'].includes(code)) {
    return `${fmtNumber(value)} MWh`;
  }
  return fmtCurrency(value);
}

/** Status + optional validation + overdue chips for list cells. */
export function InvoiceStatusCell({ row, showValidation = false }) {
  // Seller lists are direction-filtered (no direction field needed); REIA only shows Val for seller bills.
  const valVisible = showValidation && row.validation_status
    && (row.direction == null || row.direction === 'SELLER_TO_SJVN');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <Badge status={row.status} />
      {valVisible && <Badge status={row.validation_status} label={`Val: ${row.validation_status}`} />}
      {row.days_overdue > 0 && (
        <span
          title={`Overdue ${row.days_overdue} day(s) · accruing LPS`}
          style={{
            fontSize: 11, fontWeight: 600, color: 'var(--red-deep)', background: '#fee2e2',
            border: '1px solid #fecaca', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap',
          }}
        >
          Overdue {row.days_overdue}d · LPS {fmtCurrency(row.accrued_lps)}
        </span>
      )}
    </div>
  );
}

/**
 * CERC breakdown table when invoice_breakdown_json exists; otherwise charge-line summary.
 */
export function InvoiceBreakdown({ invoice, title = 'Invoice Breakdown' }) {
  if (!invoice) return null;

  let items = [];
  if (invoice.invoice_breakdown_json) {
    try { items = JSON.parse(invoice.invoice_breakdown_json); } catch { items = []; }
  }

  if (items.length > 0) {
    return (
      <div style={{ marginTop: 20, marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 12 }}>{title} (CERC Format)</div>
        <table className="detail-table" style={{ width: '100%' }}>
          <thead>
            <tr style={{ background: 'var(--slate-50)' }}>
              <th scope="col" style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: 'var(--slate-500)' }}>Code</th>
              <th scope="col" style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: 'var(--slate-500)' }}>Description</th>
              <th scope="col" style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, color: 'var(--slate-500)' }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr
                key={`${item.code}-${i}`}
                style={
                  item.code === 'TOTAL'
                    ? { fontWeight: 700, background: '#eef2ff', borderTop: '2px solid #4f46e5' }
                    : item.code === 'PEN' && Number(item.value) < 0
                      ? { color: 'var(--error, var(--danger))' }
                      : {}
                }
              >
                <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 12, color: '#4f46e5' }}>{item.code}</td>
                <td style={{ padding: '6px 12px', fontSize: 13 }}>{item.label}</td>
                <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 13, fontFamily: 'monospace' }}>
                  {formatBreakdownValue(item)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const penalty = Number(invoice.penalty) || 0;
  const capacity = Number(invoice.capacity_charges) || 0;
  const trading = Number(invoice.trading_margin) || 0;
  const other = Number(invoice.other_adjustments) || 0;

  return (
    <div style={{ marginTop: 16 }}>
      <div className="section-title" style={{ marginBottom: 8 }}>{title}</div>
      <div className="detail-grid mb-0">
        <div className="detail-item">
          <span className="detail-label">Energy</span>
          <span className="detail-value">{fmtNumber(invoice.energy_mwh)} MWh</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">PPA / PSA Tariff</span>
          <span className="detail-value">₹{invoice.tariff_per_unit}/unit</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Energy Charges</span>
          <span className="detail-value">{fmtCurrency(invoice.energy_charges)}</span>
        </div>
        {capacity > 0 && (
          <div className="detail-item">
            <span className="detail-label">Capacity Charges</span>
            <span className="detail-value">{fmtCurrency(capacity)}</span>
          </div>
        )}
        <div className="detail-item">
          <span className="detail-label">Transmission Charges</span>
          <span className="detail-value">{fmtCurrency(invoice.transmission_charges)}</span>
        </div>
        {(trading > 0 || invoice.direction === 'SJVN_TO_BUYER') && (
          <div className="detail-item">
            <span className="detail-label">Trading Margin</span>
            <span className="detail-value">{fmtCurrency(trading)}</span>
          </div>
        )}
        {penalty > 0 && (
          <div className="detail-item">
            <span className="detail-label">Penalty (CUF Shortfall)</span>
            <span className="detail-value" style={{ color: 'var(--danger)' }}>-{fmtCurrency(penalty)}</span>
          </div>
        )}
        <div className="detail-item">
          <span className="detail-label">Taxes</span>
          <span className="detail-value">{fmtCurrency(invoice.taxes)}</span>
        </div>
        {other !== 0 && (
          <div className="detail-item">
            <span className="detail-label">Other Adjustments</span>
            <span className="detail-value">{fmtCurrency(other)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shared financial strip: total, disputed, rebate (seller), LPS, payable now. */
export function InvoiceFinancialStrip({ invoice }) {
  if (!invoice) return null;
  const payable = calcPayableNow(invoice);
  const isSellerDir = invoice.direction === 'SELLER_TO_SJVN';

  return (
    <div className="detail-grid mb-0" style={{ marginTop: 12 }}>
      <div className="detail-item">
        <span className="detail-label" style={{ fontWeight: 600 }}>Total Base Amount</span>
        <span className="detail-value" style={{ fontWeight: 600 }}>{fmtCurrency(invoice.total_amount)}</span>
      </div>
      <div className="detail-item">
        <span className="detail-label">
          Disputed Amount
          <div style={{ fontSize: 11, color: 'var(--text-light)', fontWeight: 'normal' }}>
            Held from payable — LPS does not apply on this portion while open
          </div>
        </span>
        <span className="detail-value" style={{ color: 'var(--danger)' }}>-{fmtCurrency(invoice.disputed_amount || 0)}</span>
      </div>
      {isSellerDir && (
        <div className="detail-item">
          <span className="detail-label">
            Early Pay Rebate
            <div style={{ fontSize: 11, color: 'var(--text-light)', fontWeight: 'normal' }}>
              Formula: 2% of Energy Charges if paid early
            </div>
          </span>
          <span className="detail-value" style={{ color: 'var(--success)' }}>-{fmtCurrency(invoice.rebate || 0)}</span>
        </div>
      )}
      <div className="detail-item">
        <span className="detail-label">
          Late Pay Surcharge (LPS)
          <div style={{ fontSize: 11, color: 'var(--text-light)', fontWeight: 'normal' }}>
            15% p.a. on undisputed amount only while dispute is open
          </div>
        </span>
        <span className="detail-value" style={{ color: 'var(--danger)' }}>+{fmtCurrency(invoice.lps || 0)}</span>
      </div>
      <div className="detail-item">
        <span className="detail-label">
          Payable Now
          <div style={{ fontSize: 11, color: 'var(--text-light)', fontWeight: 'normal' }}>
            Disputed: {fmtCurrency(invoice.disputed_amount || 0)} · Undisputed balance due by due date
          </div>
        </span>
        <span className="detail-value" style={{ fontSize: 16, fontWeight: 700 }}>{fmtCurrency(payable)}</span>
      </div>
    </div>
  );
}

/** Read-only validation status row for detail headers. */
export function InvoiceValidationRow({ invoice, onCompare }) {
  if (!invoice) return null;
  return (
    <div className="detail-item">
      <span className="detail-label">Validation</span>
      <span className="detail-value" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {invoice.validation_status
          ? <Badge status={invoice.validation_status} />
          : <span style={{ color: 'var(--text-light)' }}>Not validated</span>}
        {invoice.validation_json && onCompare && (
          <button type="button" className="btn-link" onClick={onCompare}>Compare</button>
        )}
      </span>
    </div>
  );
}

/**
 * Seller vs system validation compare modal.
 * @param {'seller'|'reia'} perspective — column label for seller-claimed side
 * @param {boolean} canWaive — show Waive action (REIA only)
 */
export function ValidationCompareModal({
  open,
  onClose,
  validationResult,
  selectedInvoiceNo,
  perspective = 'reia',
  canWaive = false,
  onWaive,
}) {
  if (!validationResult) return null;
  const claimLabel = perspective === 'seller' ? 'Your Claim' : 'Seller';

  return (
    <Modal open={open} onClose={onClose} title="Seller vs System Validation" width={720}>
      <div>
        <div className="detail-grid mb-0">
          <div className="detail-item">
            <span className="detail-label">Result</span>
            <span className="detail-value"><Badge status={validationResult.status} /></span>
          </div>
          {perspective === 'reia' && (
            <div className="detail-item">
              <span className="detail-label">Seller Invoice</span>
              <span className="detail-value">{validationResult.seller_invoice_no || selectedInvoiceNo || '—'}</span>
            </div>
          )}
          <div className="detail-item">
            <span className="detail-label">System Invoice</span>
            <span className="detail-value">{validationResult.system_invoice_no || validationResult.system_invoice_id || '—'}</span>
          </div>
          {validationResult.tolerances && (
            <div className="detail-item">
              <span className="detail-label">Tolerances</span>
              <span className="detail-value" style={{ fontSize: 12 }}>
                Qty ±{validationResult.tolerances.qty_pct}% · Amt ±₹{validationResult.tolerances.amount_abs} / {validationResult.tolerances.amount_pct}%
              </span>
            </div>
          )}
          {validationResult.waive_reason && (
            <div className="detail-item">
              <span className="detail-label">Waive Reason</span>
              <span className="detail-value">{validationResult.waive_reason}</span>
            </div>
          )}
        </div>
        {validationResult.lines?.length > 0 && (
          <table className="detail-table" style={{ width: '100%', marginTop: 16 }}>
            <thead>
              <tr style={{ background: 'var(--slate-50)' }}>
                <th scope="col" style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12 }}>Field</th>
                <th scope="col" style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12 }}>{claimLabel}</th>
                <th scope="col" style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12 }}>System</th>
                <th scope="col" style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12 }}>Diff</th>
                <th scope="col" style={{ padding: '8px 12px', textAlign: 'center', fontSize: 12 }}>Match</th>
              </tr>
            </thead>
            <tbody>
              {validationResult.lines.map((line) => (
                <tr key={line.field}>
                  <td style={{ padding: '6px 12px', fontSize: 13 }}>{line.label}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                    {line.kind === 'qty' ? fmtNumber(line.seller) : fmtCurrency(line.seller)}
                  </td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                    {line.kind === 'qty' ? fmtNumber(line.system) : fmtCurrency(line.system)}
                  </td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                    {line.diff != null
                      ? (line.kind === 'qty' ? fmtNumber(line.diff) : fmtCurrency(line.diff))
                      : '—'}
                    {line.diff_pct != null && <span style={{ color: 'var(--text-subtle)' }}> ({line.diff_pct}%)</span>}
                  </td>
                  <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                    <Badge status={line.matched ? 'MATCHED' : 'MISMATCH'} label={line.matched ? 'OK' : 'DIFF'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {validationResult.status === 'NO_COUNTERPART' && (
          <p style={{ marginTop: 12, color: 'var(--text-light)', fontSize: 13 }}>
            {perspective === 'seller'
              ? 'No SJVN system invoice exists yet for this period. Validation will run automatically once one is generated.'
              : 'No system-generated invoice found for this contract and billing period. Generate one first, then re-validate.'}
          </p>
        )}
        <div className="form-actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          {canWaive && ['MISMATCH', 'PARTIAL', 'NO_COUNTERPART'].includes(validationResult.status) && onWaive && (
            <button type="button" className="btn btn-primary" onClick={onWaive}>Waive…</button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export async function downloadInvoicePdf(api, invoice) {
  const blob = await api.invoices.downloadPdf(invoice.id);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Invoice_${invoice.invoice_no}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
