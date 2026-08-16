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
      { label: 'MMR Analysis', to: '/reports/mmr-analysis' },
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
      { label: 'Create Bilateral Contract', to: '/trading/bilateral/desk?action=create' },
      { label: 'Bilateral Contracts Summary', to: '/trading/bilateral' },
      { label: 'Bilateral Bidding', to: '/trading/bilateral/bidding' },
      { label: 'Bilateral Applications', to: '/trading/bilateral/applications' },
    ],
  },
  {
    group: 'Exchange',
    items: [
      { label: 'Create Exchange Contract', to: '/trading/exchange/create' },
      { label: 'Exchange Contracts Summary', to: '/trading/exchange/contracts' },
      { label: 'Exchange Bidding', to: '/trading/exchange/bidding' },
      { label: 'Exchange Bidding (Latest)', to: '/trading/exchange/bidding-latest' },
      { label: 'Exchange Bidding Detail Report', to: '/trading/exchange/bidding-detail' },
      { label: 'IEX DAM Single Bid Book Report', to: '/trading/exchange/iex-dam-single' },
      { label: 'IEX DAM Block Bid Book Report', to: '/trading/exchange/iex-dam-block' },
      { label: 'IEX RTM Single Bid Book Report', to: '/trading/exchange/iex-rtm-single' },
      { label: 'IEX RTM Block Bid Book Report', to: '/trading/exchange/iex-rtm-block' },
      { label: 'Exchange Applications', to: '/trading/exchange/applications' },
      { label: 'Update Charges', to: '/trading/exchange/update-charges' },
      { label: 'ECERTS Bid Entry', to: '/trading/escert' },
      { label: 'Daily Schedule Entry', to: '/trading/exchange/daily-schedule-entry' },
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
      { label: 'PXIL Order Creation', to: '/trading/pxil/create' },
      { label: 'PXIL Order Summary', to: '/trading/pxil/summary' },
    ],
  },
  {
    group: 'REC Order Details',
    items: [
      { label: 'REC Order', to: '/trading/rec' },
      { label: 'REC Order Details Report', to: '/trading/rec/order-report' },
      { label: 'REC Bid Entry', to: '/trading/rec/bid-entry' },
    ],
  },
  {
    group: 'Bill',
    items: [
      { label: 'Generate Bill', to: '/billing/generate' },
      { label: 'Supply Bill Entry', to: '/billing/bill-of-supply/new' },
      { label: 'Report of Supply Bill', to: '/reports/supply-bill-report' },
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
      { label: 'Exchange Energy Settlement Invoice', to: '/invoices/exchange-energy-settlement' },
      { label: 'Bilateral Energy Settlement Invoice', to: '/invoices/bilateral-energy-settlement' },
      { label: 'Bilateral SLDC Consent Fee Invoice', to: '/invoices/bilateral-sldc-consent' },
      { label: 'Bilateral Open Access Invoice', to: '/invoices/bilateral-open-access' },
    ],
  },
  {
    group: 'CSV File Uploader',
    items: [
      { label: 'Charges Uploader', to: '/uploader/charges' },
      { label: 'RLDC Schedule Uploader', to: '/uploader/rldc-schedule' },
      { label: 'Refund Report Uploader', to: '/uploader/refund-report' },
      { label: 'Latest Refund Report Uploader', to: '/uploader/refund-report-latest' },
      { label: 'MMR Excel File Uploader', to: '/uploader/mmr-excel' },
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
      { label: 'API Details Report', to: '/reports/api-details' },
      { label: 'Registration Report', to: '/reports/registration' },
      { label: 'Registration Report (Category Wise)', to: '/reports/registration-category' },
      { label: 'NOAR Approvals', to: '/reports/noar-approvals' },
      { label: 'NRLDC Refund Report', to: '/reports/nrldc-refund' },
      { label: 'NRLDC Latest Refund Report', to: '/reports/nrldc-refund-latest' },
      { label: 'Compensation Reconciliation Report', to: '/reports/compensation-reconciliation' },
      { label: 'TDS Format Report', to: '/reports/tds-format' },
      { label: 'Daily Schedule Report', to: '/reports/daily-schedule' },
      { label: 'Implemented Schedule Summary', to: '/reports/implemented-schedule' },
      { label: 'Implemented Schedule Block Wise', to: '/reports/implemented-block-wise' },
      { label: 'Outstanding Dues Report', to: '/reports/outstanding-dues' },
      { label: 'Bilateral Contracts Report', to: '/reports/bilateral-contracts' },
      { label: 'Market Clearing Price Report', to: '/reports/market-clearing-price' },
      { label: 'Daily Obligation Summary Report', to: '/reports/daily-obligation-summary' },
      { label: 'Day Wise Trading Transactions', to: '/reports/day-wise-transactions' },
      { label: 'Trading Margins Report', to: '/reports/trading-margins' },
      { label: 'Bilateral Volume Report (Latest)', to: '/reports/bilateral-volume-latest' },
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
      { label: 'Form IV-A', to: '/cerc/form-iv-a' },
      { label: 'Form IV-B', to: '/cerc/form-iv-b' },
      { label: 'Form IV-C (Latest)', to: '/cerc/form-iv-c-latest' },
      { label: 'Form IV-C', to: '/cerc/form-iv-c' },
      { label: 'Form IV-D', to: '/cerc/form-iv-d' },
      { label: 'Form IV-E', to: '/cerc/form-iv-e' },
      { label: 'Form IV-F', to: '/cerc/form-iv-f' },
      { label: 'Form IV-F Margin', to: '/cerc/form-iv-f-margin' },
      { label: 'Form IV-G', to: '/cerc/form-iv-g' },
      { label: 'Form IV-H', to: '/cerc/form-iv-h' },
      { label: 'Form IV-I', to: '/cerc/form-iv-i' },
      { label: 'Form IV-K', to: '/cerc/form-iv-k' },
      { label: 'Form IV-L', to: '/cerc/form-iv-l' },
      { label: 'Form IV-M', to: '/cerc/form-iv-m' },
      { label: 'Form IV-N', to: '/cerc/form-iv-n' },
      { label: 'Form IV-O', to: '/cerc/form-iv-o' },
      { label: 'Form IV-O Margin', to: '/cerc/form-iv-o-margin' },
      { label: 'Format 5.3 REC Trading', to: '/cerc/format-5-3-rec' },
      { label: 'Saudamini TRF 4-C', to: '/cerc/saudamini-trf-4c' },
    ],
  },
  {
    group: 'CEA Reports',
    items: [
      { label: 'CEA Reports Dashboard', to: '/trading/cea-reports' },
      { label: 'Power Supply Position — Energy', to: '/cea/supply-position-energy' },
      { label: 'Power Supply Position — Peak', to: '/cea/supply-position-peak' },
      { label: 'Month Wise Installed Capacity', to: '/cea/installed-capacity-month' },
      { label: 'State Wise Installed Capacity', to: '/cea/installed-capacity-state' },
      { label: 'State Wise Per-Capita Consumption', to: '/cea/per-capita-consumption' },
    ],
  },
  {
    group: 'ERP',
    items: [
      { label: 'Vendor Format', to: '/erp/vendors' },
      { label: 'ERP Vendor Payable', to: '/erp/payables' },
      { label: 'ERP Customer Receivable', to: '/erp/receivables' },
      { label: 'Weekly Billing Format', to: '/erp/weekly-billing' },
      { label: 'ERP TDS Format', to: '/erp/tds-format' },
      { label: 'DAM Orders', to: '/erp/dam-orders' },
      { label: 'RTM Orders', to: '/erp/rtm-orders' },
      { label: 'NOC Updation', to: '/erp/noc-updation' },
      { label: 'NOC Status', to: '/erp/noc-status' },
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
