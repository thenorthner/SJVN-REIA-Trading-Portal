-- =====================================================================
-- SJVN Integrated Renewable Energy Commercial, Billing, Settlement and
-- Power Trading Management Platform -- Database Schema
-- =====================================================================

-- ---------------------------------------------------------------
-- Common / Platform-wide
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'IT_SUPER_ADMIN','REIA_ADMIN','TRADING_ADMIN','FINANCE_USER',
    'MANAGEMENT','SELLER_L1','SELLER_L2','SELLER_L3','BUYER_L1','BUYER_L2','BUYER_L3','TRADING_CLIENT','COMPLIANCE_AUDITOR',
    'SJVN_ADMIN', 'SELLER', 'BUYER', 'REIA_USER', 'TRADING_USER' -- Legacy roles preserved for existing data
  )),
  linked_entity_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  trace_id TEXT,
  session_id TEXT,
  ip_address TEXT,
  user_id TEXT,
  user_name TEXT,
  user_role TEXT,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_value TEXT,
  after_value TEXT,
  reason TEXT,
  details TEXT,
  prev_hash TEXT,
  curr_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  role TEXT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  entity_id TEXT REFERENCES entities(id),
  contract_id TEXT REFERENCES contracts(id),
  document_type TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('VERIFY', 'RECORD')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  version_number INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'NOT_REQUIRED')),
  verification_notes TEXT,
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  expiry_date TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(document_id, version_number)
);

CREATE TABLE IF NOT EXISTS price_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('ABOVE','BELOW')),
  threshold_price REAL NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------
-- 3A. REIA Billing, Contract and Settlement Management
-- ---------------------------------------------------------------

-- Stakeholder Onboarding & Registration (Sellers / Buyers)
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  parent_entity_id TEXT REFERENCES entities(id), -- Hierarchy: Parent/Group vs SPV/Project
  entity_type TEXT NOT NULL CHECK (entity_type IN ('SELLER','BUYER')),
  category TEXT NOT NULL, -- RE Generator / DISCOM / C&I / Other
  name TEXT NOT NULL,
  pan_no TEXT,
  gst_no TEXT,
  cin TEXT,
  credit_rating TEXT,
  is_blacklisted INTEGER NOT NULL DEFAULT 0,
  capacity_mw REAL,
  technology TEXT, -- Solar / Wind / Hybrid / FDRE / Peak Power / PSP / Storage
  contracted_capacity_mw REAL,
  psa_tariff REAL,
  supply_criteria TEXT, -- Buyer: Criteria for Supply of Power (RTC / Peak / etc.)
  address TEXT,
  organization_details TEXT,
  regulatory_approvals TEXT,
  bank_name TEXT,
  account_no TEXT,
  ifsc_code TEXT,
  branch_address TEXT,
  bank_details TEXT,
  is_penny_drop_verified INTEGER NOT NULL DEFAULT 0,
  invoice_template_json TEXT,
  logo_url TEXT,
  signature_url TEXT,
  signatory_name TEXT,
  signatory_designation TEXT,
  corporate_email TEXT,
  corporate_phone TEXT,
  corporate_website TEXT,
  tan_no TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS entity_contacts (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  contact_type TEXT NOT NULL CHECK (contact_type IN ('COMMERCIAL','TECHNICAL','DISPUTE','EMERGENCY')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entity_documents (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  doc_type TEXT NOT NULL,
  url TEXT NOT NULL,
  validity_end TEXT,
  alert_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS entity_audit (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  field_changed TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contract Management (PPA / PSA)
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  contract_no TEXT UNIQUE NOT NULL,
  contract_type TEXT NOT NULL CHECK (contract_type IN ('PPA','PSA')),
  seller_id TEXT REFERENCES entities(id),
  buyer_id TEXT REFERENCES entities(id),
  project_type TEXT NOT NULL, -- Solar/Wind/Hybrid/FDRE/PeakPower/PSP/Storage
  capacity_mw REAL NOT NULL,
  commissioned_capacity_mw REAL NOT NULL DEFAULT 0,
  cod_date TEXT,
  tariff_type TEXT NOT NULL DEFAULT 'FLAT' CHECK (tariff_type IN ('FLAT','ESCALATING','TWO_PART','SLAB')),
  tariff_per_unit REAL NOT NULL,
  tariff_structure_json TEXT,
  tenure_start TEXT NOT NULL,
  tenure_end TEXT NOT NULL,
  billing_cycle TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (billing_cycle IN ('DAILY','WEEKLY','MONTHLY','CUSTOM')),
  payment_terms TEXT,
  emd_amount REAL,
  pbg_amount REAL,
  pbg_type TEXT, -- BG / ISB / POI
  pbg_expiry TEXT,
  rebate_rule TEXT,
  lps_rule TEXT,
  payment_security_type TEXT,
  trading_margin_per_mwh REAL, -- PSA-specific SJVN trading margin override (₹/MWh); NULL = use global default
  -- Hydro/CERC Specific Parameters
  normative_aux REAL, -- e.g. 1.2
  free_energy_home_state REAL, -- e.g. 12.0
  capacity_charges_total REAL, -- e.g. AFC/12
  version INTEGER NOT NULL DEFAULT 1,
  parent_contract_id TEXT,
  termination_reason TEXT,
  termination_date TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','UNDER_NEGOTIATION','SIGNED','PENDING_REGULATORY_APPROVAL',
    'ACTIVE','NEARING_EXPIRY','EXPIRED','RENEWED','TERMINATED','CLOSED'
  )),
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contract_projects (
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  project_entity_id TEXT NOT NULL REFERENCES entities(id),
  allocated_capacity_mw REAL NOT NULL,
  PRIMARY KEY (contract_id, project_entity_id)
);

CREATE TABLE IF NOT EXISTS contract_amendments (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  version INTEGER NOT NULL,
  changed_fields_json TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Energy Data Accounting & Validation
CREATE TABLE IF NOT EXISTS energy_data (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  period_month TEXT NOT NULL, -- YYYY-MM
  data_type TEXT NOT NULL CHECK (data_type IN ('PROVISIONAL','FINAL')),
  source TEXT NOT NULL DEFAULT 'MANUAL', -- MANUAL / REA / RLDC / SLDC / JMR
  energy_mwh REAL NOT NULL,
  cuf_percent REAL,
  availability_percent REAL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','VALIDATED','LOCKED','DISPUTED')),
  deviation_notes TEXT,
  billing_family_ref TEXT, -- BFR/{contract}/{YYYY-MM}/{S2S|S2B} — provisional↔final trail key
  supersedes_energy_id TEXT, -- FINAL row points at provisional energy for same period
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Billing & Invoicing
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_no TEXT UNIQUE NOT NULL,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('PROVISIONAL','FINAL','SUPPLEMENTARY')),
  direction TEXT NOT NULL CHECK (direction IN ('SELLER_TO_SJVN','SJVN_TO_BUYER')),
  billing_period TEXT NOT NULL, -- YYYY-MM
  energy_mwh REAL NOT NULL,
  tariff_per_unit REAL NOT NULL,
  energy_charges REAL NOT NULL,
  capacity_charges REAL DEFAULT 0,
  incentive_charges REAL DEFAULT 0,
  free_power_deduction REAL DEFAULT 0,
  nrldc_fees REAL DEFAULT 0,
  transmission_charges REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL,
  invoice_breakdown_json TEXT, -- detailed line-by-line math
  lps REAL NOT NULL DEFAULT 0,
  rebate REAL NOT NULL DEFAULT 0,
  penalty REAL NOT NULL DEFAULT 0,
  trading_margin REAL NOT NULL DEFAULT 0,
  taxes REAL NOT NULL DEFAULT 0,
  other_adjustments REAL NOT NULL DEFAULT 0,
  disputed_amount REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','PENDING_L2','SUBMITTED','UNDER_APPROVAL','APPROVED','REJECTED',
    'SENT','DISPUTED','PARTIALLY_PAID','PAID','CANCELLED'
  )),
  version INTEGER NOT NULL DEFAULT 1,
  parent_invoice_id TEXT, -- provisional→final true-up, or dispute supplementary credit
  billing_family_ref TEXT, -- same BFR as energy for this contract/period/direction
  energy_data_id TEXT, -- energy_data row used to compute this invoice
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_approvals (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  level INTEGER NOT NULL,
  approver_name TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  comments TEXT,
  acted_at TEXT
);

CREATE TABLE IF NOT EXISTS invoice_mapping (
  buyer_invoice_id TEXT NOT NULL REFERENCES invoices(id),
  seller_invoice_id TEXT NOT NULL REFERENCES invoices(id),
  PRIMARY KEY (buyer_invoice_id, seller_invoice_id)
);

-- Payment Security (live risk-control: revolving LC, BG, corpus, waterfall)
CREATE TABLE IF NOT EXISTS payment_security (
  id TEXT PRIMARY KEY,
  instrument_no TEXT UNIQUE NOT NULL,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  entity_id TEXT,
  mechanism_type TEXT NOT NULL CHECK (mechanism_type IN (
    'LC','BANK_GUARANTEE','CORPUS_FUND','PAYMENT_SECURITY_FUND','OTHER'
  )),
  bg_subtype TEXT CHECK (bg_subtype IS NULL OR bg_subtype IN ('EMD','PBG','OTHER_BG')),
  is_revolving INTEGER NOT NULL DEFAULT 0,
  limit_amount REAL NOT NULL,
  utilized_amount REAL NOT NULL DEFAULT 0,
  available_amount REAL NOT NULL DEFAULT 0,
  required_amount REAL NOT NULL DEFAULT 0,
  waterfall_priority INTEGER NOT NULL DEFAULT 100,
  issuing_bank TEXT,
  beneficiary TEXT,
  bank_confirmation_ref TEXT,
  verified_at TEXT,
  verified_by TEXT,
  validity_start TEXT,
  validity_end TEXT,
  renewal_status TEXT DEFAULT 'NONE',
  invocation_status TEXT DEFAULT 'NONE',
  claim_deadline TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
    'DRAFT','ACTIVE','PARTIALLY_UTILIZED','INVOKED','EXPIRED','RENEWED',
    'RELEASE_PENDING','RELEASED','CLOSED'
  )),
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS security_requirements (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  mechanism_type TEXT NOT NULL,
  bg_subtype TEXT,
  min_amount REAL NOT NULL DEFAULT 0,
  months_cover REAL NOT NULL DEFAULT 1,
  validity_rule TEXT,
  waterfall_priority INTEGER NOT NULL DEFAULT 100,
  is_revolving INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  payment_security_id TEXT REFERENCES payment_security(id),
  contract_id TEXT,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS security_invocations (
  id TEXT PRIMARY KEY,
  invocation_no TEXT UNIQUE NOT NULL,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  payment_security_id TEXT REFERENCES payment_security(id),
  amount REAL NOT NULL,
  invoice_ids TEXT,
  status TEXT NOT NULL DEFAULT 'ELIGIBLE' CHECK (status IN (
    'ELIGIBLE','NOTICE_ISSUED','CLAIMED','FUNDS_RECEIVED','REJECTED'
  )),
  demand_letter_json TEXT,
  waterfall_used TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS security_alerts (
  id TEXT PRIMARY KEY,
  payment_security_id TEXT,
  contract_id TEXT,
  alert_type TEXT NOT NULL,
  days_before INTEGER,
  sent_to TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS security_releases (
  id TEXT PRIMARY KEY,
  payment_security_id TEXT NOT NULL REFERENCES payment_security(id),
  contract_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','RELEASED')),
  checklist_no_dues INTEGER NOT NULL DEFAULT 0,
  checklist_no_disputes INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  requested_by TEXT,
  acted_by TEXT,
  acted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS security_adequacy_overrides (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  reason TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  valid_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  amount REAL NOT NULL,
  payment_date TEXT NOT NULL,
  mode TEXT,
  reference TEXT,
  deduction REAL NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reconciliation (three-way trust + joint sign-off)
CREATE TABLE IF NOT EXISTS reconciliations (
  id TEXT PRIMARY KEY,
  recon_no TEXT UNIQUE NOT NULL,
  scope TEXT NOT NULL DEFAULT 'REIA_CONTRACT' CHECK (scope IN ('REIA_CONTRACT','TRADING_CLIENT')),
  contract_id TEXT REFERENCES contracts(id),
  trading_client_id TEXT,
  period_type TEXT NOT NULL CHECK (period_type IN ('MONTHLY','QUARTERLY','ANNUAL')),
  period TEXT NOT NULL,
  data_basis TEXT NOT NULL DEFAULT 'FINAL' CHECK (data_basis IN ('PROVISIONAL','FINAL')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','IN_PROGRESS','AUTO_MATCHED','NEEDS_REVIEW','PENDING_SIGN_OFF',
    'AGREED','DISPUTED','CLOSED','REOPENED'
  )),
  trigger_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK (trigger_type IN ('MANUAL','SCHEDULED','FINAL_DATA','REOPEN')),
  tolerance_qty_pct REAL NOT NULL DEFAULT 0.5,
  tolerance_amount REAL NOT NULL DEFAULT 100,
  energy_match INTEGER NOT NULL DEFAULT 0,
  payment_match INTEGER NOT NULL DEFAULT 0,
  performance_match INTEGER NOT NULL DEFAULT 0,
  items_total INTEGER NOT NULL DEFAULT 0,
  items_auto_matched INTEGER NOT NULL DEFAULT 0,
  items_exception INTEGER NOT NULL DEFAULT 0,
  auto_match_pct REAL NOT NULL DEFAULT 0,
  unreconciled_amount REAL NOT NULL DEFAULT 0,
  discrepancy_notes TEXT,
  statement_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  counterparty_role TEXT,
  sjvn_ack_at TEXT,
  sjvn_ack_by TEXT,
  counterparty_ack_at TEXT,
  counterparty_ack_by TEXT,
  carried_from_id TEXT,
  reopened_from_id TEXT,
  reopen_reason TEXT,
  closed_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recon_items (
  id TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL REFERENCES reconciliations(id),
  item_type TEXT NOT NULL CHECK (item_type IN (
    'ENERGY_THREE_WAY','FINANCIAL_THREE_WAY','TAX','PERFORMANCE','PENALTY',
    'INTERNAL_SAP','TRADING_BID_CLEAR_BILL','CARRY_FORWARD','DISPUTE_REF'
  )),
  label TEXT,
  metered_value REAL,
  billed_value REAL,
  paid_value REAL,
  sap_reference_amount REAL,
  variance REAL NOT NULL DEFAULT 0,
  variance_pct REAL,
  unit TEXT,
  match_status TEXT NOT NULL CHECK (match_status IN (
    'EXACT','AUTO_MATCHED','EXCEPTION','CARRIED','OVERRIDDEN'
  )),
  pattern_flag INTEGER NOT NULL DEFAULT 0,
  dispute_id TEXT,
  invoice_id TEXT,
  override_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recon_events (
  id TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL REFERENCES reconciliations(id),
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recon_statements (
  id TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL REFERENCES reconciliations(id),
  version INTEGER NOT NULL,
  statement_json TEXT NOT NULL,
  generated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recon_reopen_requests (
  id TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL REFERENCES reconciliations(id),
  requested_by TEXT,
  requested_by_name TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  acted_by TEXT,
  acted_at TEXT,
  new_reconciliation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dispute Management (financial control + SLA workflow)
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  dispute_no TEXT UNIQUE NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  raised_by_role TEXT NOT NULL CHECK (raised_by_role IN ('BUYER','SELLER')),
  raised_by_user_id TEXT,
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'ENERGY_DATA_MISMATCH','TARIFF_RATE_ERROR','REBATE_ERROR','LPS_PENALTY_ERROR',
    'TRANSMISSION_WHEELING','CUF_PERFORMANCE','TAX_GST_ERROR','CONTRACT_INTERPRETATION',
    'DUPLICATE_BILLING','OTHER'
  )),
  charge_line TEXT NOT NULL CHECK (charge_line IN (
    'energy_charges','transmission_charges','trading_margin','rebate','lps',
    'penalty','taxes','other_adjustments'
  )),
  issue_description TEXT NOT NULL,
  disputed_amount REAL NOT NULL,
  supporting_docs TEXT,
  status TEXT NOT NULL DEFAULT 'RAISED' CHECK (status IN (
    'RAISED','ACKNOWLEDGED','UNDER_REVIEW','INFO_REQUESTED',
    'RESOLVED_ACCEPTED','RESOLVED_REJECTED','ESCALATED','CLOSED'
  )),
  assigned_to TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_outcome TEXT CHECK (resolution_outcome IS NULL OR resolution_outcome IN (
    'FULL_CREDIT','PARTIAL_CREDIT','REJECTED'
  )),
  resolution_notes TEXT,
  accepted_amount REAL NOT NULL DEFAULT 0,
  credit_amount REAL NOT NULL DEFAULT 0,
  lps_on_resolution REAL NOT NULL DEFAULT 0,
  before_total REAL,
  after_total REAL,
  supplementary_invoice_id TEXT,
  sla_ack_due TEXT,
  sla_resolve_due TEXT,
  sla_breached_at TEXT,
  escalated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dispute_comments (
  id TEXT PRIMARY KEY,
  dispute_id TEXT NOT NULL REFERENCES disputes(id),
  user_id TEXT,
  user_name TEXT NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dispute_events (
  id TEXT PRIMARY KEY,
  dispute_id TEXT NOT NULL REFERENCES disputes(id),
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------
-- 3B. Power Trading Management System
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trading_clients (
  id TEXT PRIMARY KEY,
  entity_id TEXT REFERENCES entities(id),
  name TEXT NOT NULL,
  client_type TEXT NOT NULL CHECK (client_type IN ('GENERATOR','DISCOM','TRADER','C&I','OTHER')),
  noc_valid_till TEXT,
  ppa_ref TEXT,
  pre_payment_balance REAL NOT NULL DEFAULT 0,
  margin_available REAL NOT NULL DEFAULT 0,
  exposure_limit REAL NOT NULL DEFAULT 0,
  risk_rating TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (risk_rating IN ('LOW','MEDIUM','HIGH')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED')),
  suspension_reason TEXT,
  documents TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trading_client_signatories (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES trading_clients(id),
  name TEXT NOT NULL,
  designation TEXT,
  contact_info TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trading_client_exchanges (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES trading_clients(id),
  exchange TEXT NOT NULL CHECK (exchange IN ('IEX','PXIL','HPX')),
  registration_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bids (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES trading_clients(id),
  exchange TEXT NOT NULL CHECK (exchange IN ('IEX','PXIL','HPX')),
  product TEXT NOT NULL CHECK (product IN ('DAM','HPDAM','TAM','GDAM','RTM','GTAM','REC','ESCERT','RPO')),
  bid_date TEXT NOT NULL,
  delivery_date TEXT NOT NULL,
  time_block TEXT,
  quantum_mw REAL NOT NULL,
  price_per_unit REAL NOT NULL,
  carry_forward_from TEXT, -- e.g. GDAM->DAM->RTM chain reference
  premium_discount REAL NOT NULL DEFAULT 0,
  cleared_quantum_mw REAL NOT NULL DEFAULT 0,
  cleared_price REAL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','SUBMITTED','CLEARED','PARTIALLY_CLEARED','REJECTED','CANCELLED','NO_BID'
  )),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bilateral_transactions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES trading_clients(id),
  counterparty TEXT NOT NULL,
  loi_contract_ref TEXT,
  quantum_mw REAL NOT NULL,
  tariff_per_unit REAL NOT NULL,
  open_access_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (open_access_status IN ('PENDING','APPROVED','REJECTED','PARTIAL')),
  schedule_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (schedule_status IN ('DRAFT','SUBMITTED','APPROVED','REVISED','CANCELLED')),
  wheeling_charges REAL NOT NULL DEFAULT 0,
  transmission_charges REAL NOT NULL DEFAULT 0,
  losses_percent REAL NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trading_invoices (
  id TEXT PRIMARY KEY,
  invoice_no TEXT UNIQUE NOT NULL,
  client_id TEXT NOT NULL REFERENCES trading_clients(id),
  invoice_kind TEXT NOT NULL CHECK (invoice_kind IN ('TRADING_MARGIN_ONLY','POWER_SUPPLY_ONLY','COMBINED')),
  billing_period TEXT NOT NULL,
  quantum_mwh REAL NOT NULL,
  rate_per_unit REAL NOT NULL,
  trading_margin REAL NOT NULL DEFAULT 0,
  gst_applicable INTEGER NOT NULL DEFAULT 1,
  gst_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','PARTIALLY_PAID','PAID','OVERDUE')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trading_payments (
  id TEXT PRIMARY KEY,
  trading_invoice_id TEXT NOT NULL REFERENCES trading_invoices(id),
  amount REAL NOT NULL,
  payment_date TEXT NOT NULL,
  mode TEXT,
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS market_rates (
  id TEXT PRIMARY KEY,
  product TEXT NOT NULL,
  rate_date TEXT NOT NULL,
  mcp_rate REAL NOT NULL, -- market clearing price
  forecast_rate REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contract_allocations (
  id TEXT PRIMARY KEY,
  ppa_id TEXT NOT NULL REFERENCES contracts(id),
  psa_id TEXT NOT NULL REFERENCES contracts(id),
  allocation_percent REAL NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Configurable Master Data (SRS)
CREATE TABLE IF NOT EXISTS bank_master (
  id TEXT PRIMARY KEY,
  bank_name TEXT NOT NULL,
  ifsc_prefix TEXT,
  branch_name TEXT,
  city TEXT,
  swift_code TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_parameters (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('REGULATORY','BILLING','GENERAL')),
  param_key TEXT NOT NULL UNIQUE,
  param_value TEXT NOT NULL,
  data_type TEXT NOT NULL DEFAULT 'NUMBER' CHECK (data_type IN ('NUMBER','TEXT','PERCENT','JSON')),
  unit TEXT,
  description TEXT,
  effective_from TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_type_master (
  id TEXT PRIMARY KEY,
  module_name TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('VERIFY','RECORD')),
  reason TEXT,
  is_mandatory INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(module_name, code)
);

CREATE TABLE IF NOT EXISTS lookup_master (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category, code)
);
