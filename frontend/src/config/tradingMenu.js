/**
 * The Power Trading menu, arranged the way ISET arranges it.
 *
 * ISET groups roughly a hundred screens under fourteen headings. Ours had them
 * as one flat list of thirty-four, which worked while there were thirty-four and
 * will not once there are a hundred. The grouping here is taken from ISET so the
 * two read the same way to anyone who has used it.
 *
 * `to` points at a screen we have already built. `pending: true` means ISET has
 * the screen and we do not yet — it routes to a placeholder that says so plainly
 * rather than showing an empty table that looks broken. Nothing existing is
 * renamed or removed; screens we have that ISET does not are kept under the
 * group they belong to, marked `ours: true`.
 *
 * Building one of these is: write the page, point `to` at it, drop `pending`.
 */

export const TRADING_MENU = [
  {
    group: 'Dashboard',
    items: [
      { label: 'Main Dashboard', to: '/dashboard' },
      { label: 'Power Market Dashboard', to: '/trading/power-market' },
      { label: 'Trading Dashboard', to: '/trading', end: true },
    ],
  },
  {
    group: 'MMR Data',
    items: [
      { label: 'MMR Dashboard', to: '/trading/mmr-dashboard' },
      { label: 'MMR Analysis', to: '/trading/mmr-analysis', pending: true },
    ],
  },
  {
    group: 'Registration Request',
    items: [
      { label: 'Pre Registration', to: '/registration/initial/requests' },
      { label: 'Post Registration', to: '/registration/requests' },
      { label: 'Update Portfolio Id', to: '/portfolio/update' },
      { label: 'Enter Client Details', to: '/clients/details' },
      { label: 'Clients & Counterparties', to: '/trading/clients', ours: true },
    ],
  },
  {
    group: 'Bilateral',
    items: [
      { label: 'Create Bilateral Contract', to: '/trading/bilateral/create', pending: true },
      { label: 'Bilateral Contracts Summary', to: '/trading/bilateral' },
      { label: 'Bilateral Bidding', to: '/trading/bilateral/bidding', pending: true },
      { label: 'Bilateral Applications', to: '/trading/bilateral/applications', pending: true },
    ],
  },
  {
    group: 'Exchange',
    items: [
      { label: 'Create Exchange Contract', to: '/trading/exchange/create', pending: true },
      { label: 'Exchange Contracts Summary', to: '/trading/exchange/contracts', pending: true },
      { label: 'Exchange Bidding', to: '/trading/exchange/bidding', pending: true },
      { label: 'Exchange Bidding (Latest)', to: '/trading/exchange/bidding-latest', pending: true },
      { label: 'Exchange Bidding Detail Report', to: '/trading/exchange/bidding-detail', pending: true },
      { label: 'IEX DAM Single Bid Book Report', to: '/trading/exchange/iex-dam-single', pending: true },
      { label: 'IEX DAM Block Bid Book Report', to: '/trading/exchange/iex-dam-block', pending: true },
      { label: 'IEX RTM Single Bid Book Report', to: '/trading/exchange/iex-rtm-single', pending: true },
      { label: 'IEX RTM Block Bid Book Report', to: '/trading/exchange/iex-rtm-block', pending: true },
      { label: 'Exchange Applications', to: '/trading/exchange/applications', pending: true },
      { label: 'Update Charges', to: '/trading/exchange/update-charges', pending: true },
      { label: 'ECERTS Bid Entry', to: '/trading/escert' },
      { label: 'Daily Schedule Entry', to: '/trading/exchange/daily-schedule-entry', pending: true },
      { label: 'DAM Management', to: '/trading/dam', ours: true },
      { label: 'GDAM Management', to: '/trading/gdam', ours: true },
      { label: 'RTM Management', to: '/trading/rtm', ours: true },
      { label: 'GTAM Management', to: '/trading/gtam', ours: true },
      { label: 'TAM Management', to: '/trading/tam', ours: true },
      { label: 'Pre-Trade Board', to: '/trading/pre-trade', ours: true },
    ],
  },
  {
    group: 'PXIL',
    items: [
      { label: 'PXIL Order Creation', to: '/trading/pxil/create', pending: true },
      { label: 'PXIL Order Summary', to: '/trading/pxil/summary', pending: true },
    ],
  },
  {
    group: 'REC Order Details',
    items: [
      { label: 'REC Order', to: '/trading/rec' },
      { label: 'REC Order Details Report', to: '/trading/rec/order-report', pending: true },
      { label: 'REC Bid Entry', to: '/trading/rec/bid-entry', pending: true },
    ],
  },
  {
    group: 'Bill',
    items: [
      { label: 'Generate Bill', to: '/billing/generate' },
      { label: 'Supply Bill Entry', to: '/billing/bill-of-supply/new' },
      { label: 'Report of Supply Bill', to: '/billing/supply-bill-report', pending: true },
      { label: 'Trading Billing & Settlement', to: '/trading/billing-settlement', ours: true },
      { label: 'Generator Billing & Settlement', to: '/trading/generator-billing', ours: true },
    ],
  },
  {
    group: 'View Bills',
    items: [
      { label: 'All Bills', to: '/billing/view-bills' },
      { label: 'Exchange Trading Margin Invoice', to: '/invoices/trading-margin' },
      { label: 'Exchange Open Access Invoice', to: '/invoices/open-access' },
      { label: 'Exchange Energy Settlement Invoice', to: '/invoices/exchange-energy-settlement', pending: true },
      { label: 'Bilateral Energy Settlement Invoice', to: '/invoices/bilateral-energy-settlement', pending: true },
      { label: 'Bilateral SLDC Consent Fee Invoice', to: '/invoices/bilateral-sldc-consent', pending: true },
      { label: 'Bilateral Open Access Invoice', to: '/invoices/bilateral-open-access', pending: true },
    ],
  },
  {
    group: 'CSV File Uploader',
    items: [
      { label: 'Charges Uploader', to: '/uploader/charges', pending: true },
      { label: 'RLDC Schedule Uploader', to: '/uploader/rldc-schedule', pending: true },
      { label: 'Refund Report Uploader', to: '/uploader/refund-report', pending: true },
      { label: 'Latest Refund Report Uploader', to: '/uploader/refund-report-latest', pending: true },
      { label: 'MMR Excel File Uploader', to: '/uploader/mmr-excel', pending: true },
      { label: 'Import Ledger', to: '/trading/ledger-import', ours: true },
    ],
  },
  {
    group: 'Scheduling & Settlement',
    ours: true,
    items: [
      { label: 'Energy Schedule & DSM Matrix', to: '/trading/energy-schedule' },
      { label: 'Schedule Archive', to: '/trading/schedule-archive' },
      { label: 'Daily Obligation Report (DOR)', to: '/trading/daily-obligation-report' },
      { label: 'Deviation Register', to: '/trading/deviations' },
      { label: 'Payment Cycle', to: '/trading/payment-cycle' },
      { label: 'Contract P&L', to: '/trading/pnl' },
      { label: 'Margin Assurance', to: '/trading/margin-assurance' },
    ],
  },
  {
    group: 'Open Access',
    ours: true,
    items: [
      { label: 'NOAR Registry & Clearances', to: '/trading/noar-registry' },
      { label: 'NOAR Wallet (Open Access)', to: '/trading/noar' },
      { label: 'OA Charge Calculator', to: '/trading/oa-calculator' },
      { label: 'OA Reconciliation', to: '/trading/oa-reconciliation' },
      { label: 'OA Rate Master', to: '/trading/rate-master' },
    ],
  },
  {
    group: 'Reports',
    items: [
      { label: 'API Details Report', to: '/reports/api-details', pending: true },
      { label: 'Registration Report', to: '/reports/registration', pending: true },
      { label: 'Registration Report (Category Wise)', to: '/reports/registration-category', pending: true },
      { label: 'NOAR Approvals', to: '/reports/noar-approvals', pending: true },
      { label: 'NRLDC Refund Report', to: '/reports/nrldc-refund', pending: true },
      { label: 'NRLDC Latest Refund Report', to: '/reports/nrldc-refund-latest', pending: true },
      { label: 'Compensation Reconciliation Report', to: '/reports/compensation-reconciliation', pending: true },
      { label: 'TDS Breakup', to: '/compliance/tax/tds-report' },
      { label: 'Daily Schedule Report', to: '/reports/daily-schedule', pending: true },
      { label: 'Implemented Schedule Summary', to: '/reports/dispatch/implemented' },
      { label: 'Implemented Schedule Block Wise', to: '/reports/implemented-block-wise', pending: true },
      { label: 'Outstanding Dues Report', to: '/reports/outstanding-dues', pending: true },
      { label: 'Bilateral Contracts Report', to: '/reports/bilateral-contracts', pending: true },
      { label: 'Market Clearing Price Report', to: '/reports/market-clearing-price', pending: true },
      { label: 'Daily Obligation Summary Report', to: '/reports/daily-obligation-summary', pending: true },
      { label: 'Day Wise Trading Transactions', to: '/reports/day-wise-transactions', pending: true },
      { label: 'Trading Margins Report', to: '/reports/trading-margins', pending: true },
      { label: 'Bilateral Volume Report (Latest)', to: '/reports/bilateral-volume-latest', pending: true },
      { label: 'Energy Reconciliation', to: '/reconciliation/rea-sea' },
      { label: 'Open-Access Reconciliation', to: '/trading/oa-reconciliation' },
      { label: 'Market Rates & Analytics', to: '/trading/market-analytics', ours: true },
      { label: 'TDS Register', to: '/trading/tds-register', ours: true },
    ],
  },
  {
    group: 'CERC Reports',
    items: [
      { label: 'CERC Form-IV (built)', to: '/trading/form-iv' },
      { label: 'Form IV-A', to: '/cerc/form-iv-a', pending: true },
      { label: 'Form IV-B', to: '/cerc/form-iv-b', pending: true },
      { label: 'Form IV-C (Latest)', to: '/cerc/form-iv-c-latest', pending: true },
      { label: 'Form IV-C', to: '/cerc/form-iv-c', pending: true },
      { label: 'Form IV-D', to: '/cerc/form-iv-d', pending: true },
      { label: 'Form IV-E', to: '/cerc/form-iv-e', pending: true },
      { label: 'Form IV-F', to: '/cerc/form-iv-f', pending: true },
      { label: 'Form IV-F Margin', to: '/cerc/form-iv-f-margin', pending: true },
      { label: 'Form IV-G', to: '/cerc/form-iv-g', pending: true },
      { label: 'Form IV-H', to: '/cerc/form-iv-h', pending: true },
      { label: 'Form IV-I', to: '/cerc/form-iv-i', pending: true },
      { label: 'Form IV-K', to: '/cerc/form-iv-k', pending: true },
      { label: 'Form IV-L', to: '/cerc/form-iv-l', pending: true },
      { label: 'Form IV-M', to: '/cerc/form-iv-m', pending: true },
      { label: 'Form IV-N', to: '/cerc/form-iv-n', pending: true },
      { label: 'Form IV-O', to: '/cerc/form-iv-o', pending: true },
      { label: 'Form IV-O Margin', to: '/cerc/form-iv-o-margin', pending: true },
      { label: 'Format 5.3 REC Trading', to: '/cerc/format-5-3-rec', pending: true },
      { label: 'Saudamini TRF 4-C', to: '/cerc/saudamini-trf-4c', pending: true },
    ],
  },
  {
    group: 'CEA Reports',
    items: [
      { label: 'CEA Reports Dashboard', to: '/trading/cea-reports' },
      { label: 'Power Supply Position — Energy', to: '/cea/supply-position-energy', pending: true },
      { label: 'Power Supply Position — Peak', to: '/cea/supply-position-peak', pending: true },
      { label: 'Month Wise Installed Capacity', to: '/cea/installed-capacity-month', pending: true },
      { label: 'State Wise Installed Capacity', to: '/cea/installed-capacity-state', pending: true },
      { label: 'State Wise Per-Capita Consumption', to: '/cea/per-capita-consumption', pending: true },
    ],
  },
  {
    group: 'ERP',
    items: [
      { label: 'Vendor Format', to: '/erp/vendors' },
      { label: 'ERP Vendor Payable', to: '/erp/payables' },
      { label: 'ERP Customer Receivable', to: '/erp/receivables' },
      { label: 'Weekly Billing Format', to: '/erp/weekly-billing', pending: true },
      { label: 'ERP TDS Format', to: '/erp/tds-format', pending: true },
      { label: 'DAM Orders', to: '/erp/dam-orders', pending: true },
      { label: 'RTM Orders', to: '/erp/rtm-orders', pending: true },
      { label: 'NOC Updation', to: '/erp/noc-updation', pending: true },
      { label: 'NOC Status', to: '/erp/noc-status', pending: true },
      { label: 'Bank Transactions', to: '/trading/bank-transactions', ours: true },
    ],
  },
  {
    group: 'Communications',
    ours: true,
    items: [
      { label: 'Bulk Communications', to: '/trading/bulk-communications' },
      { label: 'Inbox', to: '/trading/inbox' },
    ],
  },
];

/** Every screen ISET has that we have not built yet. */
export const pendingScreens = () =>
  TRADING_MENU.flatMap((g) => g.items.filter((i) => i.pending).map((i) => ({ ...i, group: g.group })));
