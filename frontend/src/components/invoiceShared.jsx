import React from 'react';
import { Badge, Modal, fmtCurrency, fmtNumber } from './ui.jsx';

/** Status options for invoice list filters (role pages may subset). */
export const INVOICE_STATUS_OPTIONS = [
  'DRAFT', 'PENDING_L2', 'SUBMITTED', 'UNDER_APPROVAL', 'APPROVED', 'REJECTED',
  'SENT', 'DISPUTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED',
];

/** Statuses at which a bill has been approved and can be paid, noted or disputed. */
export const PAYABLE_STATUSES = ['APPROVED', 'SENT', 'PARTIALLY_PAID', 'DISPUTED'];

/** What is still owed on a bill: the server's figure, or the same sum worked here. */
export function calcBalanceDue(inv) {
  if (inv == null) return 0;
  if (inv.balance_due != null && !Number.isNaN(Number(inv.balance_due))) return Number(inv.balance_due);
  if (['PAID', 'CANCELLED'].includes(inv.status)) return 0;
  return Math.max(0, calcPayableNow(inv) - (Number(inv.paid_total) || 0));
}

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
  // A line that is a heading or a source note carries no figure.
  if (value == null || value === '') return '';
  // A deviation bill's energy lines; older ones were stored without a format.
  if (format === 'mwh' || ['SCH', 'ACT', 'DEV'].includes(code)) return `${fmtNumber(value, 3)} MWh`;
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
  // REIA only shows Val for seller bills, and NO_COUNTERPART/PENDING should never be displayed as an alarming badge.
  const valVisible = showValidation && row.validation_status
    && !['NO_COUNTERPART', 'PENDING'].includes(row.validation_status)
    && (row.direction == null || row.direction === 'SELLER_TO_SJVN');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <Badge status={row.status} />
      {valVisible && <Badge status={row.validation_status} label={`Val: ${row.validation_status}`} />}
      {(row.days_past_due > 0 || row.days_overdue > 0) && (
        <span
          title={`Overdue ${row.days_past_due || row.days_overdue} day(s) · accruing LPS`}
          style={{
            fontSize: 13, fontWeight: 600, color: 'var(--red-deep)', background: '#fee2e2',
            border: '1px solid #fecaca', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap',
          }}
        >
          Overdue {row.days_past_due || row.days_overdue}d · LPS {fmtCurrency(row.accrued_lps)}
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
              <th scope="col" style={{ padding: '10px 14px', textAlign: 'left', fontSize: 14, color: 'var(--slate-600)' }}>Code</th>
              <th scope="col" style={{ padding: '10px 14px', textAlign: 'left', fontSize: 14, color: 'var(--slate-600)' }}>Description</th>
              <th scope="col" style={{ padding: '10px 14px', textAlign: 'right', fontSize: 14, color: 'var(--slate-600)' }}>Value</th>
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
                <td style={{ padding: '8px 14px', fontFamily: 'monospace', fontSize: 13.5, color: '#4f46e5' }}>{item.code}</td>
                <td style={{ padding: '8px 14px', fontSize: 14.5 }}>{item.label}</td>
                <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 14.5, fontFamily: 'monospace' }}>
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
  const isSellerDir = invoice.direction === 'SELLER_TO_SJVN';
  // Surcharge as the bill has earned it to today, not as it stood at its last
  // payment — the same figure the "Overdue" line above the strip gives.
  const lps = Number(invoice.lps_to_date ?? invoice.lps) || 0;
  const settled = Number(invoice.paid_total) || 0;
  const balance = calcBalanceDue(invoice);
  const lpsRate = invoice.lps_annual_pct != null ? `${Number(invoice.lps_annual_pct)}% a year` : 'The contract rate';
  const grace = Number(invoice.lps_grace_days) > 0 ? `, after ${invoice.lps_grace_days} grace day(s)` : '';

  return (
    <div className="detail-grid mb-0" style={{ marginTop: 14 }}>
      <div className="detail-item">
        <span className="detail-label" style={{ fontWeight: 600 }}>Total Base Amount</span>
        <span className="detail-value" style={{ fontWeight: 700, fontSize: 17 }}>{fmtCurrency(invoice.total_amount)}</span>
      </div>
      <div className="detail-item">
        <span className="detail-label">
          Disputed Amount
          <div style={{ fontSize: 13, color: 'var(--text-light)', fontWeight: 'normal', marginTop: 3, lineHeight: 1.4 }}>
            Held from payable — LPS does not apply on this portion while open
          </div>
        </span>
        <span className="detail-value" style={{ color: 'var(--danger)', fontSize: 16 }}>-{fmtCurrency(invoice.disputed_amount || 0)}</span>
      </div>
      {(isSellerDir || Number(invoice.rebate) > 0) && (
        <div className="detail-item">
          <span className="detail-label">
            Early Pay Rebate
            <div style={{ fontSize: 13, color: 'var(--text-light)', fontWeight: 'normal', marginTop: 3, lineHeight: 1.4 }}>
              Earned by each payment on the part of the bill it settles early, at the contract&apos;s rate
            </div>
          </span>
          <span className="detail-value" style={{ color: 'var(--success)', fontSize: 16 }}>-{fmtCurrency(invoice.rebate || 0)}</span>
        </div>
      )}
      <div className="detail-item">
        <span className="detail-label">
          Late Pay Surcharge (LPS)
          <div style={{ fontSize: 13, color: 'var(--text-light)', fontWeight: 'normal', marginTop: 3, lineHeight: 1.4 }}>
            {lpsRate} on the undisputed amount unpaid past the due date{grace} — to date
          </div>
        </span>
        <span className="detail-value" style={{ color: 'var(--danger)', fontSize: 16 }}>+{fmtCurrency(lps)}</span>
      </div>
      <div className="detail-item">
        <span className="detail-label">
          Settled So Far
          <div style={{ fontSize: 13, color: 'var(--text-light)', fontWeight: 'normal', marginTop: 3, lineHeight: 1.4 }}>
            {invoice.settlement && invoice.settlement.credit_applied > 0
              ? `Cash ${fmtCurrency(invoice.settlement.cash_received)} · credit notes ${fmtCurrency(invoice.settlement.credit_applied)}`
              : 'Payments, tax and other deductions, and credit notes recorded on this bill'}
          </div>
          {invoice.settlement?.label && (
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{invoice.settlement.label}</div>
          )}
        </span>
        <span className="detail-value" style={{ color: 'var(--success)', fontSize: 16 }}>-{fmtCurrency(settled)}</span>
      </div>
      <div className="detail-item">
        <span className="detail-label">
          Balance Payable Now
          <div style={{ fontSize: 13, color: 'var(--text-light)', fontWeight: 'normal', marginTop: 3, lineHeight: 1.4 }}>
            What is left after everything above{Number(invoice.disputed_amount) > 0 ? ' — the disputed part is held out until it is decided' : ''}
          </div>
        </span>
        <span className="detail-value" style={{ fontSize: 18, fontWeight: 700 }}>{fmtCurrency(balance)}</span>
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
              <span className="detail-value" style={{ fontSize: 14 }}>
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
        {/* With no system invoice there are no lines to compare, and the panel
            showed only a "NO COUNTERPART" badge — the reason, and what to do
            about it, were in the server's refusal but never on screen. */}
        {validationResult.status === 'NO_COUNTERPART' && (
          <div className="inline-note" role="status" style={{ marginTop: 16, fontSize: 14.5 }}>
            No system counterpart invoice found for this contract and billing period.{' '}
            {perspective === 'seller'
              ? 'SJVN has not raised its own invoice for this month yet, so there is nothing to compare yours against. Validate again once it has.'
              : 'Raise the system invoice for this contract and month under Billing & Invoicing, then validate again.'}
          </div>
        )}
        {validationResult.lines?.length > 0 && (
          <table className="detail-table" style={{ width: '100%', marginTop: 18 }}>
            <thead>
              <tr style={{ background: 'var(--slate-50)' }}>
                <th scope="col" style={{ padding: '10px 14px', textAlign: 'left', fontSize: 14 }}>Field</th>
                <th scope="col" style={{ padding: '10px 14px', textAlign: 'right', fontSize: 14 }}>{claimLabel}</th>
                <th scope="col" style={{ padding: '10px 14px', textAlign: 'right', fontSize: 14 }}>System</th>
                <th scope="col" style={{ padding: '10px 14px', textAlign: 'right', fontSize: 14 }}>Diff</th>
                <th scope="col" style={{ padding: '10px 14px', textAlign: 'center', fontSize: 14 }}>Match</th>
              </tr>
            </thead>
            <tbody>
              {validationResult.lines.map((line) => (
                <tr key={line.field}>
                  <td style={{ padding: '8px 14px', fontSize: 14.5 }}>{line.label}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'monospace', fontSize: 14 }}>
                    {line.kind === 'qty' ? fmtNumber(line.seller) : fmtCurrency(line.seller)}
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'monospace', fontSize: 14 }}>
                    {line.kind === 'qty' ? fmtNumber(line.system) : fmtCurrency(line.system)}
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'monospace', fontSize: 14 }}>
                    {line.diff != null
                      ? (line.kind === 'qty' ? fmtNumber(line.diff) : fmtCurrency(line.diff))
                      : '—'}
                    {line.diff_pct != null && <span style={{ color: 'var(--text-subtle)' }}> ({line.diff_pct}%)</span>}
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                    <Badge status={line.matched ? 'MATCHED' : 'MISMATCH'} label={line.matched ? 'OK' : 'DIFF'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {validationResult.status === 'NO_COUNTERPART' && (
          <p style={{ marginTop: 14, color: 'var(--text-light)', fontSize: 14.5 }}>
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
  // An invoice number carries slashes, which a file name cannot.
  a.download = `Invoice_${String(invoice.invoice_no).replace(/[^\w.-]+/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
