/**
 * Column defs for the remaining ISET pending screens.
 * Shared shape: { title, columns:[{key,label}], showSr? }
 *
 * The sample rows that used to sit inline here were transcribed from the live
 * ISET portal — real counterparty names, application numbers and amounts — and
 * this repo has a remote. They now load from src/data/live/, which is ignored,
 * and every screen renders its columns with no rows when that file is absent.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const LIVE_ROWS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'live/pendingReportRows.json');

/** Sample rows for a screen, or none when the live data is not present. */
export function pendingReportRows(kind) {
  return LIVE_ROWS[kind] || [];
}

let LIVE_ROWS = {};
try {
  LIVE_ROWS = JSON.parse(readFileSync(LIVE_ROWS_PATH, 'utf8'));
} catch {
  // A fresh clone has no live data; the screens render empty, which is correct.
}
export const PENDING_REPORT_CATALOG = {
  'market-clearing-price': {
    title: 'Market Clearing Price Report',
    columns: [
      { key: 'trade_date', label: 'Trade Date' },
      { key: 'exchange', label: 'Exchange' },
      { key: 'market', label: 'Market' },
      { key: 'time_block', label: 'Time Block' },
      { key: 'mcp', label: 'MCP (Rs/kWh)' },
      { key: 'mcv_mw', label: 'MCV (MW)' },
    ],
  },
  'daily-obligation-summary': {
    title: 'Daily Obligation Summary Report',
    columns: [
      { key: 'obligation_date', label: 'Date' },
      { key: 'client_name', label: 'Client Name' },
      { key: 'exchange', label: 'Exchange' },
      { key: 'obligation_mwh', label: 'Obligation (MWh)' },
      { key: 'settled_mwh', label: 'Settled (MWh)' },
      { key: 'outstanding_mwh', label: 'Outstanding (MWh)' },
      { key: 'amount_rs', label: 'Amount (Rs.)' },
    ],
  },
  'day-wise-transactions': {
    title: 'Day Wise Trading Transactions',
    columns: [
      { key: 'trade_date', label: 'Trade Date' },
      { key: 'exchange', label: 'Exchange' },
      { key: 'buy_mwh', label: 'Buy (MWh)' },
      { key: 'sell_mwh', label: 'Sell (MWh)' },
      { key: 'net_mwh', label: 'Net (MWh)' },
      { key: 'avg_price', label: 'Avg Price (Rs/kWh)' },
      { key: 'trading_margin', label: 'Trading Margin (Rs.)' },
    ],
  },
  'trading-margins': {
    title: 'Trading Margins Report',
    columns: [
      { key: 'period', label: 'Period' },
      { key: 'client_name', label: 'Client Name' },
      { key: 'contract_ref', label: 'Contract Ref' },
      { key: 'volume_mwh', label: 'Volume (MWh)' },
      { key: 'margin_per_kwh', label: 'Margin (Rs/kWh)' },
      { key: 'margin_amount', label: 'Margin Amount (Rs.)' },
    ],
  },
  'bilateral-volume-latest': {
    title: 'Bilateral Volume Report (Latest)',
    columns: [
      { key: 'month', label: 'Month' },
      { key: 'seller_name', label: 'Seller Name' },
      { key: 'buyer_name', label: 'Buyer Name' },
      { key: 'volume_mwh', label: 'Volume (MWh)' },
      { key: 'avg_rate', label: 'Avg Rate (Rs/kWh)' },
      { key: 'trading_margin', label: 'Trading Margin (Rs/kWh)' },
    ],
  },
  'supply-bill-report': {
    title: 'Report of Supply Bill',
    columns: [
      { key: 'bill_no', label: 'Bill No.' },
      { key: 'client_name', label: 'Client Name' },
      { key: 'bill_date', label: 'Bill Date' },
      { key: 'supply_from', label: 'Supply From' },
      { key: 'supply_to', label: 'Supply To' },
      { key: 'energy_mwh', label: 'Energy (MWh)' },
      { key: 'amount_rs', label: 'Amount (Rs.)' },
      { key: 'status', label: 'Status' },
    ],
  },
  'mmr-analysis': {
    title: 'MMR Analysis',
    columns: [
      { key: 'period', label: 'Period' },
      { key: 'exchange', label: 'Exchange' },
      { key: 'segment', label: 'Segment' },
      { key: 'volume_mu', label: 'Volume (MU)' },
      { key: 'avg_price', label: 'Avg Price (Rs/kWh)' },
      { key: 'yoy_change_pct', label: 'YoY Change %' },
    ],
  },
  'erp-weekly-billing': {
    title: 'Weekly Billing Format',
    columns: [
      { key: 'week_ending', label: 'Week Ending' },
      { key: 'client_name', label: 'Client Name' },
      { key: 'invoice_no', label: 'Invoice No.' },
      { key: 'energy_mwh', label: 'Energy (MWh)' },
      { key: 'amount_rs', label: 'Amount (Rs.)' },
      { key: 'status', label: 'ERP Status' },
    ],
  },
  'erp-dam-orders': {
    title: 'DAM Orders (ERP)',
    columns: [
      { key: 'order_date', label: 'Order Date' },
      { key: 'portfolio', label: 'Portfolio' },
      { key: 'side', label: 'Side' },
      { key: 'quantum_mw', label: 'Quantum (MW)' },
      { key: 'price', label: 'Price (Rs/kWh)' },
      { key: 'status', label: 'Status' },
    ],
  },
  'erp-rtm-orders': {
    title: 'RTM Orders (ERP)',
    columns: [
      { key: 'order_date', label: 'Order Date' },
      { key: 'portfolio', label: 'Portfolio' },
      { key: 'side', label: 'Side' },
      { key: 'quantum_mw', label: 'Quantum (MW)' },
      { key: 'price', label: 'Price (Rs/kWh)' },
      { key: 'status', label: 'Status' },
    ],
  },
  'erp-noc-updation': {
    title: 'NOC Updation',
    columns: [
      { key: 'noc_no', label: 'NOC No.' },
      { key: 'client_name', label: 'Client Name' },
      { key: 'valid_from', label: 'Valid From' },
      { key: 'valid_to', label: 'Valid To' },
      { key: 'quantum_mw', label: 'Quantum (MW)' },
      { key: 'status', label: 'Status' },
    ],
  },
  'erp-noc-status': {
    title: 'NOC Status',
    columns: [
      { key: 'noc_no', label: 'NOC No.' },
      { key: 'client_name', label: 'Client Name' },
      { key: 'region', label: 'Region' },
      { key: 'status', label: 'Status' },
      { key: 'last_updated', label: 'Last Updated' },
    ],
  },
};

const CERC_FORMS = [
  ['form-iv-a', 'Form IV-A'],
  ['form-iv-b', 'Form IV-B'],
  ['form-iv-c-latest', 'Form IV-C (Latest)'],
  ['form-iv-c', 'Form IV-C'],
  ['form-iv-d', 'Form IV-D'],
  ['form-iv-e', 'Form IV-E'],
  ['form-iv-f', 'Form IV-F'],
  ['form-iv-f-margin', 'Form IV-F Margin'],
  ['form-iv-g', 'Form IV-G'],
  ['form-iv-h', 'Form IV-H'],
  ['form-iv-i', 'Form IV-I'],
  ['form-iv-k', 'Form IV-K'],
  ['form-iv-l', 'Form IV-L'],
  ['form-iv-m', 'Form IV-M'],
  ['form-iv-n', 'Form IV-N'],
  ['form-iv-o', 'Form IV-O'],
  ['form-iv-o-margin', 'Form IV-O Margin'],
  ['format-5-3-rec', 'Format 5.3 REC Trading'],
  ['saudamini-trf-4c', 'Saudamini TRF 4-C'],
];

for (const [slug, title] of CERC_FORMS) {
  PENDING_REPORT_CATALOG[`cerc-${slug}`] = {
    title,
    columns: [
      { key: 'period', label: 'Period' },
      { key: 'trader_name', label: 'Trader Name' },
      { key: 'seller_name', label: 'Seller' },
      { key: 'buyer_name', label: 'Buyer' },
      { key: 'quantum_mu', label: 'Quantum (MU)' },
      { key: 'purchase_rate', label: 'Purchase Rate' },
      { key: 'sale_rate', label: 'Sale Rate' },
      { key: 'margin', label: 'Trading Margin' },
    ],
  };
}

const CEA_REPORTS = [
  ['supply-position-energy', 'Power Supply Position — Energy'],
  ['supply-position-peak', 'Power Supply Position — Peak'],
  ['installed-capacity-month', 'Month Wise Installed Capacity'],
  ['installed-capacity-state', 'State Wise Installed Capacity'],
  ['per-capita-consumption', 'State Wise Per-Capita Consumption'],
];

for (const [slug, title] of CEA_REPORTS) {
  PENDING_REPORT_CATALOG[`cea-${slug}`] = {
    title,
    columns: [
      { key: 'period', label: 'Period' },
      { key: 'region_or_state', label: 'Region / State' },
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value' },
      { key: 'unit', label: 'Unit' },
    ],
  };
}

export const ALL_PENDING_KINDS = Object.keys(PENDING_REPORT_CATALOG);
