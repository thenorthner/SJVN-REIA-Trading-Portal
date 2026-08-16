import IsetReportTable from './IsetReportTable.jsx';

const API_DETAILS_COLS = [
  { key: 'name', label: 'Name' },
  { key: 'link', label: 'Link' },
  { key: 'fetched_upto', label: 'Fetched Data Upto' },
];

const REGISTRATION_COLS = [
  { key: 'client_name', label: 'Client Name' },
  { key: 'reference_no', label: 'Reference No' },
  { key: 'short_name', label: 'Short Name' },
  { key: 'registered_company_name', label: 'Registered Company Name' },
  { key: 'unit_address', label: 'Unit Address' },
  { key: 'company_address', label: 'Company Address' },
  { key: 'state', label: 'State' },
  { key: 'category_name', label: 'Category Name' },
];

const REG_CATEGORY_COLS = [
  { key: 'category_name', label: 'Category Name' },
  { key: 'count', label: 'Count' },
];

const NOAR_COLS = [
  { key: 'application_no', label: 'Application No.' },
  { key: 'applicant_name', label: 'Applicant Name' },
  { key: 'seller_name', label: 'Seller Name' },
  { key: 'buyer_name', label: 'Buyer Name' },
  { key: 'from_date', label: 'From Date' },
  { key: 'to_date', label: 'To Date' },
  { key: 'applied_capacity_mwh', label: 'Applied Capacity (MWh)' },
  { key: 'approved_capacity_mwh', label: 'Approved Capacity (MWh)' },
  { key: 'approval_no', label: 'Approval No.' },
  { key: 'approval_date', label: 'Approval Date' },
];

const NRLDC_REFUND_COLS = [
  { key: 'application_id', label: 'Application ID' },
  { key: 'approval_no', label: 'Approval No.' },
  { key: 'from_date', label: 'Application From Date' },
  { key: 'to_date', label: 'Application To Date' },
  { key: 'applicant', label: 'Applicant' },
  { key: 'refund_mwh_curtailment', label: 'Refund Mwh Due To Curtailment' },
  { key: 'refund_amt_curtailment', label: 'Refund Amount Due To Curtailment (Rs.)' },
  { key: 'refund_amt_waiver', label: 'Refund Amount Due To Waiver (Rs.)' },
  { key: 'refund_reason', label: 'Refund Reason' },
  { key: 'net_payable', label: 'Net Payable (Rs.)' },
  { key: 'received', label: 'Received (Rs.)' },
  { key: 'refund_from_rldc', label: 'Refund From RLDC (Rs.)' },
  { key: 'rldc', label: 'RLDC' },
];

const NRLDC_LATEST_COLS = [
  { key: 'application_id', label: 'Application ID' },
  { key: 'approval_no', label: 'Approval No.' },
  { key: 'from_date', label: 'Application From Date' },
  { key: 'to_date', label: 'Application To Date' },
  { key: 'applicant', label: 'Applicant' },
  { key: 'refund_amt_waiver', label: 'Refund Amount Due To Waiver (Rs.)' },
  { key: 'refund_reason', label: 'Refund Reason' },
  { key: 'net_payable', label: 'Net Payable (Rs.)' },
  { key: 'received', label: 'Received (Rs.)' },
  { key: 'refund_from_rldc', label: 'Refund From RLDC (Rs.)' },
  { key: 'rldc', label: 'RLDC' },
];

const COMPENSATION_COLS = [
  { key: 'delivery_date', label: 'Delivary Date' },
  { key: 'purchase_contract', label: 'Purchase Contract' },
  { key: 'purchase_contracted_mwh', label: 'Purchase Contacted Value (MWh)' },
  { key: 'scheduled_availability_mwh', label: 'Scheduled Availibility (MWh)' },
  { key: 'purchase_default_mwh', label: 'Purchase Side Default (MWh)' },
  { key: 'purchase_default_pct', label: 'Purchase Side Default %' },
  { key: 'purchase_compensation', label: 'Purchase Side Compensation (Rs.)' },
  { key: 'sale_contract', label: 'Sale Contract' },
  { key: 'sale_contracted_mwh', label: 'Sale Contracted Value (MWh)' },
  { key: 'scheduled_requisition_mwh', label: 'Scheduled requisition (MWh)' },
  { key: 'sale_default_mwh', label: 'Sale Side Default (MWh)' },
  { key: 'sale_default_pct', label: 'Sale Side Default %' },
  { key: 'sale_compensation', label: 'Sale Side Compensation (Rs.)' },
];

const TDS_FORMAT_COLS = [
  { key: 'nodal_rldc', label: 'Nodal RLDC' },
  { key: 'application_no', label: 'Application No.' },
  { key: 'noar_fee', label: 'NOAR Application Fee' },
  { key: 'approval_no', label: 'Approval No.' },
  { key: 'stoa_posoco', label: 'STOA Charges (POSOCO)(A)' },
  { key: 'stoa_ctu', label: 'STOA Charges (CTU)(B)' },
  { key: 'stoa_seller_stu', label: 'STOA Charges (Seller STU)(C)' },
  { key: 'stoa_buyer_stu', label: 'STOA Charges (Buyer STU)(D)' },
  { key: 'stoa_seller_sldc', label: 'STOA Charges (Seller SLDC)(E)' },
  { key: 'stoa_buyer_sldc', label: 'STOA Charges (Buyer SLDC)(F)' },
  { key: 'total_stoa', label: 'Total STOA Charges G=(A+B+C+D+E+F)' },
  { key: 'payment_date', label: 'Payment Date' },
  { key: 'vendor_posoco', label: 'Vendor Code (POSOCO)' },
  { key: 'pan_posoco', label: 'PAN (POSOCO)' },
  { key: 'tds_posoco', label: 'TDS Charges (POSOCO) (H)' },
  { key: 'vendor_ctu', label: 'Vendor Code (CTU)' },
  { key: 'pan_ctu', label: 'PAN (CTU)' },
  { key: 'tds_ctu', label: 'TDS Charges (CTU) (I)' },
  { key: 'vendor_seller_sldc', label: 'Vendor Code (Seller SLDC)' },
  { key: 'name_seller_sldc', label: 'Name (Seller SLDC)' },
  { key: 'pan_seller_sldc', label: 'PAN (Seller SLDC)' },
  { key: 'tds_seller_sldc', label: 'TDS Charges (Seller SLDC) (J)' },
  { key: 'vendor_seller_stu', label: 'Vendor Code (Seller STU)' },
  { key: 'name_seller_stu', label: 'Name (Seller STU)' },
  { key: 'pan_seller_stu', label: 'PAN (Seller STU)' },
  { key: 'tds_seller_stu', label: 'TDS Charges (Seller STU) (K)' },
  { key: 'vendor_buyer_sldc', label: 'Vendor Code (Buyer SLDC)' },
  { key: 'name_buyer_sldc', label: 'Name (Buyer SLDC)' },
  { key: 'pan_buyer_sldc', label: 'PAN (Buyer SLDC)' },
  { key: 'tds_buyer_sldc', label: 'TDS Charges (Buyer SLDC) (L)' },
  { key: 'vendor_buyer_stu', label: 'Vendor Code (Buyer STU)' },
  { key: 'name_buyer_stu', label: 'Name (Buyer STU)' },
  { key: 'pan_buyer_stu', label: 'PAN (Buyer STU)' },
  { key: 'tds_buyer_stu', label: 'TDS Charges (Buyer STU) (M)' },
  { key: 'total_tds', label: 'Total TDS (N= H+I+J+K+L+M)' },
  { key: 'net_payment', label: 'Net Payment (Rs.) (O= G-N)' },
  { key: 'actual_stoa_paid', label: 'Actual STOA Charges Paid' },
  { key: 'actual_tds_paid', label: 'Actual TDS Charges Paid' },
];

const DAILY_SCHEDULE_COLS = [
  { key: 'buyer_contract', label: 'Buyer Contract' },
  { key: 'seller_contract', label: 'Seller Contract' },
  { key: 'delivery_from', label: 'Delivery From' },
  { key: 'delivery_to', label: 'Delivery To' },
  { key: 'seller_availability', label: 'Seller Availability' },
  { key: 'buyer_request', label: 'Buyer Request' },
  { key: 'remarks', label: 'Remarks' },
];

const IMPLEMENTED_SUMMARY_COLS = [
  { key: 'reading_date', label: 'Reading Date' },
  { key: 'seller_name', label: 'Seller Name' },
  { key: 'buyer_name', label: 'Buyer Name' },
  { key: 'seller_schedule_mwh', label: 'Seller Schedule (at Regional Periphery (MWh))' },
  { key: 'buyer_schedule_mwh', label: 'Buyer Schedule (at Regional Periphery (MWh))' },
];

const BLOCK_WISE_COLS = [
  { key: 'seller_name', label: 'Seller Name' },
  { key: 'seller_state', label: 'Seller State' },
  { key: 'buyer_name', label: 'Buyer Name' },
  { key: 'buyer_state', label: 'Buyer State' },
  { key: 'trader_name', label: 'Trader Name' },
  { key: 'reading_date', label: 'Reading Date' },
  { key: 'time_block', label: 'Time Block' },
  { key: 'seller_schedule_mw', label: 'Seller Schedule (at Regional Periphery (MW))' },
  { key: 'buyer_schedule_mw', label: 'Buyer Schedule (at Regional Periphery (MW))' },
  { key: 'schedule_type', label: 'Schedule Type' },
  { key: 'approval_no', label: 'Approval No.' },
];

const OUTSTANDING_COLS = [
  { key: 'client_name', label: 'Client Name' },
  { key: 'bill_type', label: 'Bill Type' },
  { key: 'bill_date', label: 'Bill Date' },
  { key: 'bill_due_date', label: 'Bill Due Date' },
  { key: 'bill_amount', label: 'Bill Amount (Rs.)' },
  { key: 'amount_paid', label: 'Amount Paid (Rs.)' },
  { key: 'outstanding_amount', label: 'Outstanding Amount (Rs.)' },
];

const BILATERAL_CONTRACT_COLS = [
  { key: 'loa_no', label: 'LOA No.' },
  { key: 'seller_name', label: 'Seller Name' },
  { key: 'seller_state', label: 'Seller State' },
  { key: 'buyer_name', label: 'Buyer Name' },
  { key: 'buyer_state', label: 'Buyer State' },
  { key: 'start_date', label: 'Start Date' },
  { key: 'end_date', label: 'End Date' },
  { key: 'max_quantum_mw', label: 'Max Quantum (MW)' },
  { key: 'rate_kwh', label: 'Rate (KWh)' },
  { key: 'trading_margin', label: 'Trading Margin (Rs./KWh)' },
];

function page(kind, title, columns, extra = {}) {
  return function ReportPage() {
    return <IsetReportTable kind={kind} title={title} columns={columns} {...extra} />;
  };
}

export const ApiDetailsReport = page('api-details', 'API Details Report', API_DETAILS_COLS);
export const RegistrationReport = page('registration', 'Registration Report', REGISTRATION_COLS);
export const RegistrationCategoryReport = page('registration-category', 'Registration Report Category Wise', REG_CATEGORY_COLS);
export const NoarApprovalsReport = page('noar-approvals', 'NOAR Approvals', NOAR_COLS);
export const NrldcRefundReport = page('nrldc-refund', 'NRLDC Refund Report', NRLDC_REFUND_COLS);
export const NrldcLatestRefundReport = page('nrldc-refund-latest', 'NRLDC Latest Refund Report', NRLDC_LATEST_COLS, {
  totalKeys: ['refund_amt_waiver', 'net_payable', 'received', 'refund_from_rldc'],
});
export const CompensationReconciliationReport = page('compensation-reconciliation', 'Compensation Reconciliation Report', COMPENSATION_COLS);
export const TdsFormatReport = page('tds-format', 'TDS FORMAT REPORT', TDS_FORMAT_COLS);
export const DailyScheduleReport = page('daily-schedule', 'Daily Schedule Report', DAILY_SCHEDULE_COLS);
export const ImplementedScheduleSummaryReport = page('implemented-schedule', 'Implemented Schedule', IMPLEMENTED_SUMMARY_COLS, {
  totalKeys: ['seller_schedule_mwh', 'buyer_schedule_mwh'],
});
export const ImplementedBlockWiseReport = page('implemented-block-wise', 'Short Term Schedule Fetched From NRLDC API', BLOCK_WISE_COLS, {
  showSr: false,
});
export const OutstandingDuesReport = page('outstanding-dues', 'Outstanding Dues', OUTSTANDING_COLS);
export const BilateralContractsReport = page('bilateral-contracts', 'Bilateral Contract Report', BILATERAL_CONTRACT_COLS);
