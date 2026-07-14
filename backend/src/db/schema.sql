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
    'SJVN_ADMIN','REIA_USER','TRADING_USER','FINANCE_USER',
    'MANAGEMENT','SELLER','BUYER','TRADING_CLIENT'
  )),
  linked_entity_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT,
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

-- ---------------------------------------------------------------
-- 3A. REIA Billing, Contract and Settlement Management
-- ---------------------------------------------------------------

-- Stakeholder Onboarding & Registration (Sellers / Buyers)
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('SELLER','BUYER')),
  category TEXT NOT NULL, -- RE Generator / DISCOM / C&I / Other
  name TEXT NOT NULL,
  capacity_mw REAL,
  technology TEXT, -- Solar / Wind / Hybrid / FDRE / Peak Power / PSP / Storage
  contracted_capacity_mw REAL,
  psa_tariff REAL,
  supply_criteria TEXT,
  organization_details TEXT,
  regulatory_approvals TEXT,
  bank_details TEXT,
  contact_details TEXT,
  documents TEXT, -- JSON array of {name, url}
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  tariff_per_unit REAL NOT NULL,
  tenure_start TEXT NOT NULL,
  tenure_end TEXT NOT NULL,
  billing_cycle TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (billing_cycle IN ('DAILY','WEEKLY','MONTHLY','CUSTOM')),
  payment_terms TEXT,
  emd_amount REAL,
  pbg_amount REAL,
  pbg_type TEXT, -- BG / ISB / POI
  pbg_expiry TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  parent_contract_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','AMENDED','EXPIRED','TERMINATED')),
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  transmission_charges REAL NOT NULL DEFAULT 0,
  rebate REAL NOT NULL DEFAULT 0,
  lps REAL NOT NULL DEFAULT 0,
  penalty REAL NOT NULL DEFAULT 0,
  trading_margin REAL NOT NULL DEFAULT 0,
  taxes REAL NOT NULL DEFAULT 0,
  other_adjustments REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL,
  disputed_amount REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','SUBMITTED','UNDER_APPROVAL','APPROVED','REJECTED',
    'SENT','DISPUTED','PARTIALLY_PAID','PAID','CANCELLED'
  )),
  version INTEGER NOT NULL DEFAULT 1,
  parent_invoice_id TEXT,
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

-- Payment Security & Payment Tracking
CREATE TABLE IF NOT EXISTS payment_security (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  mechanism_type TEXT NOT NULL CHECK (mechanism_type IN ('LC','BANK_GUARANTEE','CORPUS_FUND','OTHER')),
  amount REAL NOT NULL,
  issuing_bank TEXT,
  beneficiary TEXT,
  validity_start TEXT,
  validity_end TEXT,
  utilized_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','INVOKED','RENEWED','CLOSED')),
  remarks TEXT,
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

-- Reconciliation
CREATE TABLE IF NOT EXISTS reconciliations (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  period_type TEXT NOT NULL CHECK (period_type IN ('MONTHLY','QUARTERLY','ANNUAL')),
  period TEXT NOT NULL,
  energy_match INTEGER NOT NULL DEFAULT 0,
  payment_match INTEGER NOT NULL DEFAULT 0,
  performance_match INTEGER NOT NULL DEFAULT 0,
  discrepancy_notes TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ASSISTED_REVIEW','RESOLVED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dispute Management
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  raised_by TEXT NOT NULL, -- BUYER / SELLER
  issue_description TEXT NOT NULL,
  disputed_amount REAL NOT NULL,
  supporting_docs TEXT,
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','UNDER_REVIEW','RESOLVED','CLOSED')),
  resolution_notes TEXT,
  lps_on_resolution REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

-- ---------------------------------------------------------------
-- 3B. Power Trading Management System
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trading_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_type TEXT NOT NULL CHECK (client_type IN ('GENERATOR','DISCOM','TRADER','C&I','OTHER')),
  noc_valid_till TEXT,
  ppa_ref TEXT,
  pre_payment_balance REAL NOT NULL DEFAULT 0,
  margin_available REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED')),
  documents TEXT,
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
