export const REASON_CODES = [
  { value: 'ENERGY_DATA_MISMATCH', label: 'Energy data mismatch (metered vs billed)' },
  { value: 'TARIFF_RATE_ERROR', label: 'Tariff/rate calculation error' },
  { value: 'REBATE_ERROR', label: 'Rebate calculation error' },
  { value: 'LPS_PENALTY_ERROR', label: 'LPS/penalty calculation error' },
  { value: 'TRANSMISSION_WHEELING', label: 'Transmission/wheeling charge dispute' },
  { value: 'CUF_PERFORMANCE', label: 'CUF/performance penalty dispute' },
  { value: 'TAX_GST_ERROR', label: 'Tax/GST calculation error' },
  { value: 'CONTRACT_INTERPRETATION', label: 'Contract term interpretation dispute' },
  { value: 'DUPLICATE_BILLING', label: 'Duplicate billing' },
  { value: 'OTHER', label: 'Other (mandatory comment)' },
];

export const CHARGE_LINES = [
  { value: 'energy_charges', label: 'Energy charges' },
  { value: 'transmission_charges', label: 'Transmission / wheeling' },
  { value: 'trading_margin', label: 'Trading margin' },
  { value: 'rebate', label: 'Rebate' },
  { value: 'lps', label: 'LPS' },
  { value: 'penalty', label: 'Penalty (CUF/performance)' },
  { value: 'taxes', label: 'Tax / GST' },
  { value: 'other_adjustments', label: 'Other adjustments' },
];

export const DISPUTE_STATUSES = [
  'RAISED',
  'ACKNOWLEDGED',
  'UNDER_REVIEW',
  'INFO_REQUESTED',
  'RESOLVED_ACCEPTED',
  'RESOLVED_REJECTED',
  'ESCALATED',
  'CLOSED',
];

export const OPEN_STATUSES = ['RAISED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'INFO_REQUESTED', 'ESCALATED'];

export function reasonLabel(code) {
  return REASON_CODES.find((r) => r.value === code)?.label || code;
}

export function chargeLabel(line) {
  return CHARGE_LINES.find((c) => c.value === line)?.label || line;
}

export function invoiceChargeBreakdown(inv) {
  if (!inv) return {};
  return {
    energy_charges: inv.energy_charges || 0,
    transmission_charges: inv.transmission_charges || 0,
    trading_margin: inv.trading_margin || 0,
    rebate: inv.rebate || 0,
    lps: inv.lps || 0,
    penalty: inv.penalty || 0,
    taxes: inv.taxes || 0,
    other_adjustments: inv.other_adjustments || 0,
  };
}
