import { parseSheet } from '../../lib/sheetPaste.js';

/**
 * Read a contract sheet pasted (or opened) out of the bulk template.
 *
 * The desk has the signed contracts in a spreadsheet; the fastest honest path
 * from there to here is the template's own columns, in its own order or not.
 * The reading itself is shared with the seller invoice loader — the two sheets
 * differ only in the columns they carry.
 */

export const BULK_COLUMNS = [
  'contract_no', 'contract_type', 'project_type', 'seller_id', 'buyer_id',
  'capacity_mw', 'commissioned_capacity_mw', 'cod_date',
  'tariff_per_unit', 'tenure_start', 'tenure_end', 'billing_cycle',
  'emd_amount', 'pbg_amount',
];

const NUMERIC = ['capacity_mw', 'commissioned_capacity_mw', 'tariff_per_unit', 'emd_amount', 'pbg_amount'];

export function parseContractBulk(text) {
  return parseSheet(text, { columns: BULK_COLUMNS, numeric: NUMERIC });
}
