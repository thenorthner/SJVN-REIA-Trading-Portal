/**
 * Master-data helpers: system parameters, default seed, typed getters.
 */
import db from './db/index.js';
import { newId } from './util.js';

const DEFAULT_PARAMS = [
  { category: 'BILLING', param_key: 'trading_margin_per_mwh', param_value: '70', data_type: 'NUMBER', unit: 'INR/MWh', description: 'PSA trading margin (7 paise/unit = ₹70/MWh)' },
  { category: 'BILLING', param_key: 'early_payment_rebate_pct', param_value: '2', data_type: 'PERCENT', unit: '%', description: 'Flat early-payment rebate (fallback when tiers empty)' },
  { category: 'BILLING', param_key: 'early_payment_rebate_tiers', param_value: JSON.stringify([{ within_days: 7, pct: 2 }, { within_days: 30, pct: 1 }]), data_type: 'JSON', unit: '', description: 'Tiered early-payment rebate: pay within N days of bill date → % rebate on billed amount (PPA / SELLER_TO_SJVN only)' },
  { category: 'BILLING', param_key: 'lps_annual_pct', param_value: '15', data_type: 'PERCENT', unit: '% p.a.', description: 'Late Payment Surcharge annual rate' },
  { category: 'BILLING', param_key: 'nrldc_fee_per_mw', param_value: '100', data_type: 'NUMBER', unit: 'INR/MW', description: 'NRLDC/SLDC fee per MW capacity' },
  { category: 'BILLING', param_key: 'default_payment_terms_days', param_value: '30', data_type: 'NUMBER', unit: 'days', description: 'Default payment terms when contract has none' },
  { category: 'BILLING', param_key: 'gst_rate_percent', param_value: '0', data_type: 'PERCENT', unit: '%', description: 'GST on the taxable service component (trading margin). Default 0 — sale of electricity is GST-exempt (HSN 2716). Set >0 only where GST genuinely applies; PDF then splits CGST+SGST (intra-state) or IGST (inter-state).' },
  { category: 'REGULATORY', param_key: 'solar_base_cuf_pct', param_value: '22', data_type: 'PERCENT', unit: '%', description: 'Baseline CUF for Solar energy validation' },
  { category: 'REGULATORY', param_key: 'wind_base_cuf_pct', param_value: '30', data_type: 'PERCENT', unit: '%', description: 'Baseline CUF for Wind energy validation' },
  { category: 'REGULATORY', param_key: 'hydro_base_cuf_pct', param_value: '65', data_type: 'PERCENT', unit: '%', description: 'Baseline CUF for Hydro energy validation' },
  { category: 'REGULATORY', param_key: 'energy_validate_tolerance_pct', param_value: '30', data_type: 'PERCENT', unit: '%', description: 'Deviation tolerance for Solar/Wind validation' },
  { category: 'REGULATORY', param_key: 'hydro_validate_tolerance_pct', param_value: '80', data_type: 'PERCENT', unit: '%', description: 'Deviation tolerance for Hydro (seasonality)' },
  { category: 'REGULATORY', param_key: 'freq_response_incentive_pct_hydro', param_value: '3', data_type: 'PERCENT', unit: '%', description: 'CERC Reg 65(4): Hydro/PSP frequency-response incentive = (pct × β × AFC)/12' },
  { category: 'REGULATORY', param_key: 'freq_response_incentive_pct_thermal', param_value: '1', data_type: 'PERCENT', unit: '%', description: 'CERC Reg 62(5): Thermal frequency-response incentive = (pct × β × AFC)/12' },
  { category: 'REGULATORY', param_key: 'freq_response_beta_min', param_value: '0.30', data_type: 'NUMBER', unit: '', description: 'Minimum β for incentive eligibility (CERC: payable only if β > 0.30)' },
  { category: 'REGULATORY', param_key: 'freq_response_beta_sharing_factor', param_value: '0.5', data_type: 'NUMBER', unit: '', description: 'SJVN NJHPS sharing factor in beta incentive: (pct × β × factor × AFC)/12. Set 1 to disable (pure CERC).' },
];

const DEFAULT_BANKS = [
  { bank_name: 'HDFC Bank', ifsc_prefix: 'HDFC', branch_name: 'Corporate', city: 'Mumbai', swift_code: 'HDFCINBB' },
  { bank_name: 'State Bank of India', ifsc_prefix: 'SBIN', branch_name: 'Main Branch', city: 'New Delhi', swift_code: 'SBININBB' },
  { bank_name: 'Punjab National Bank', ifsc_prefix: 'PUNB', branch_name: 'Chandigarh', city: 'Chandigarh', swift_code: 'PUNBINBB' },
  { bank_name: 'ICICI Bank', ifsc_prefix: 'ICIC', branch_name: 'Corporate', city: 'Mumbai', swift_code: 'ICICINBB' },
  { bank_name: 'Bank of Baroda', ifsc_prefix: 'BARB', branch_name: 'Lucknow', city: 'Lucknow', swift_code: 'BARBINBB' },
];

const DEFAULT_LOOKUPS = [
  { category: 'PROJECT_TYPE', code: 'Solar', label: 'Solar', sort_order: 1 },
  { category: 'PROJECT_TYPE', code: 'Wind', label: 'Wind', sort_order: 2 },
  { category: 'PROJECT_TYPE', code: 'Hybrid', label: 'Hybrid', sort_order: 3 },
  { category: 'PROJECT_TYPE', code: 'Hydro', label: 'Hydro', sort_order: 4 },
  { category: 'PROJECT_TYPE', code: 'PSP', label: 'Pumped Storage', sort_order: 5 },
  { category: 'TECHNOLOGY', code: 'Solar', label: 'Solar PV', sort_order: 1 },
  { category: 'TECHNOLOGY', code: 'Wind', label: 'Wind', sort_order: 2 },
  { category: 'TECHNOLOGY', code: 'Hybrid', label: 'Hybrid', sort_order: 3 },
  { category: 'TECHNOLOGY', code: 'Hydro', label: 'Hydro', sort_order: 4 },
  { category: 'PBG_TYPE', code: 'BG', label: 'Bank Guarantee', sort_order: 1 },
  { category: 'PBG_TYPE', code: 'ISB', label: 'Insurance Surety Bond', sort_order: 2 },
  { category: 'PBG_TYPE', code: 'POI', label: 'Payment on Invoice / POI', sort_order: 3 },
  { category: 'BILLING_CYCLE', code: 'MONTHLY', label: 'Monthly', sort_order: 1 },
  { category: 'BILLING_CYCLE', code: 'QUARTERLY', label: 'Quarterly', sort_order: 2 },
  { category: 'ENTITY_CATEGORY', code: 'RE Generator', label: 'RE Generator', sort_order: 1 },
  { category: 'ENTITY_CATEGORY', code: 'DISCOM', label: 'DISCOM', sort_order: 2 },
  { category: 'ENTITY_CATEGORY', code: 'C&I', label: 'C&I Consumer', sort_order: 3 },
  { category: 'ENTITY_CATEGORY', code: 'SPV', label: 'SPV / Project Co', sort_order: 4 },
];

/** Mirrors frontend documentTaxonomy.js — seeded into document_type_master */
const DEFAULT_DOC_TYPES = [
  ['STAKEHOLDERS', 'COMPANY_REGISTRATION', 'Company Registration (PAN, GST, CIN)', 'VERIFY', 'Legal identity', 1, 1],
  ['STAKEHOLDERS', 'GENERATION_LICENSE', 'Generation License', 'VERIFY', 'Valid license required', 1, 2],
  ['STAKEHOLDERS', 'ENV_CLEARANCE', 'Environmental Clearance', 'VERIFY', 'Regulatory mandatory', 1, 3],
  ['STAKEHOLDERS', 'PLANT_TECHNICAL_DOCS', 'Plant Technical Docs (SLD, Capacity)', 'VERIFY', 'Capacity match', 1, 4],
  ['STAKEHOLDERS', 'DISCOM_LICENSE', 'DISCOM License/Registration', 'VERIFY', 'Buyer status', 1, 5],
  ['STAKEHOLDERS', 'BANK_ACCOUNT_PROOF', 'Bank Account Proof (Cancelled Cheque)', 'VERIFY', 'Fraud prevention', 1, 6],
  ['STAKEHOLDERS', 'BOARD_RESOLUTION', 'Board Resolution / Power of Attorney', 'VERIFY', 'Signing authority', 1, 7],
  ['STAKEHOLDERS', 'COD_CERTIFICATE', 'COD Certificate', 'VERIFY', 'Commissioned capacity', 1, 8],
  ['STAKEHOLDERS', 'REGULATORY_RENEWAL', 'Regulatory Approval Renewals', 'VERIFY', 'Expiry re-verify', 0, 9],
  ['STAKEHOLDERS', 'INVOICE_TEMPLATE', 'Invoice Letterhead Template (Word/Image)', 'RECORD', 'Custom invoicing', 0, 10],
  ['CONTRACTS', 'PPA_PSA_SIGNED', 'Signed PPA/PSA (Scanned Copy)', 'VERIFY', 'Legal contract proof', 1, 1],
  ['CONTRACTS', 'AMENDMENT_AGREEMENT', 'Amendment Agreement', 'VERIFY', 'Terms change proof', 0, 2],
  ['REIA_BILLING', 'SELLER_INVOICE', 'Seller Invoice (PDF)', 'VERIFY', 'Data match', 1, 1],
  ['REIA_BILLING', 'CALCULATION_SHEET', 'Supporting Calculation Sheet', 'RECORD', 'Reference', 0, 2],
  ['REIA_BILLING', 'SUPPLEMENTARY_NOTE', 'Supplementary Invoice Supporting Note', 'RECORD', 'Adjustment reason', 0, 3],
  ['REIA_BILLING', 'BETA_CERTIFICATE', 'NRPC/NRLDC Beta (β) Frequency Response Certificate', 'VERIFY', 'Certified Average Monthly Frequency Response Performance', 0, 4],
  ['DISPUTES', 'DISPUTE_EVIDENCE', 'Dispute Evidence (Meter reading, email, calc)', 'VERIFY', 'Review evidence', 1, 1],
  ['DISPUTES', 'RESOLUTION_NOTE', 'Resolution/Settlement Note', 'RECORD', 'Final decision', 0, 2],
  ['RECONCILIATION', 'SIGNED_ACKNOWLEDGMENT', 'Signed Acknowledgment (Joint)', 'VERIFY', 'Joint validation', 1, 1],
  ['RECONCILIATION', 'RAW_DATA_FILE', 'Supporting Raw Data Files', 'RECORD', 'Traceability', 0, 2],
  ['PAYMENT_SECURITY', 'LETTER_OF_CREDIT', 'Letter of Credit (LC) Copy', 'VERIFY', 'Authenticity', 1, 1],
  ['PAYMENT_SECURITY', 'BANK_GUARANTEE', 'Bank Guarantee (EMD/PBG) Copy', 'VERIFY', 'Fraud prevention', 1, 2],
  ['PAYMENT_SECURITY', 'CORPUS_FUND_PROOF', 'Corpus Fund Deposit Proof', 'VERIFY', 'Amount/validity', 1, 3],
  ['PAYMENT_SECURITY', 'BANK_CONFIRMATION', 'Bank Confirmation Reference (SWIFT/letter)', 'VERIFY', 'Bank cross-verify', 1, 4],
  ['PAYMENT_SECURITY', 'SECURITY_RENEWAL', 'LC/BG Renewal/Amendment', 'VERIFY', 'New validity', 0, 5],
  ['PAYMENT_SECURITY', 'SECURITY_RELEASE_NOTE', 'Security Release/Refund Approval Note', 'VERIFY', 'No pending dues', 0, 6],
  ['TRADING_CLIENTS', 'KYC_DOCS', 'KYC Documents', 'VERIFY', 'Onboarding', 1, 1],
  ['TRADING_CLIENTS', 'TRADING_AGREEMENT', 'Trading Agreement/LOI', 'VERIFY', 'Legal basis', 1, 2],
  ['TRADING_CLIENTS', 'NOC', 'NOC (No Objection Certificate)', 'VERIFY', 'Bidding validity', 1, 3],
  ['TRADING_CLIENTS', 'AUTHORIZATION_LETTER', 'Authorization Letter (Signatory)', 'VERIFY', 'Authorized person', 1, 4],
  ['TRADING_CLIENTS', 'RISK_ASSESSMENT_NOTE', 'Risk Assessment Supporting Notes', 'RECORD', 'Internal reference', 0, 5],
  ['EXCHANGE_BIDS', 'EXCHANGE_RECEIPT', 'Exchange Acknowledgment/Receipt', 'RECORD', 'Bid submitted proof', 0, 1],
  ['EXCHANGE_BIDS', 'NO_BID_JUSTIFICATION', 'No-Bid Justification Note', 'RECORD', 'Regulatory', 0, 2],
  ['EXCHANGE_BIDS', 'BULK_UPLOAD_TEMPLATE', 'Bulk-Upload Excel Template', 'RECORD', 'Audit', 0, 3],
  ['BILATERAL', 'LOI', 'LOI (Letter of Intent)', 'VERIFY', 'Deal basis', 1, 1],
  ['BILATERAL', 'OPEN_ACCESS_APP', 'Open Access Application Copy', 'RECORD', 'Application filed', 0, 2],
  ['BILATERAL', 'GRID_APPROVAL', 'SLDC/RLDC/NLDC Approval Letter', 'VERIFY', 'Schedule gate', 1, 3],
  ['BILATERAL', 'SCHEDULE_CONFIRMATION', 'Schedule Confirmation Document', 'RECORD', 'Confirmed schedule', 0, 4],
  ['BILATERAL', 'CURTAILMENT_NOTICE', 'Curtailment Notice', 'RECORD', 'Billing adjustment', 0, 5],
  ['TRADING_BILLING', 'EXCHANGE_OBLIGATION', 'Exchange Obligation Report', 'RECORD', 'Recon source', 0, 1],
  ['TRADING_BILLING', 'CLEARING_SETTLEMENT', 'Clearing House Settlement Statement', 'VERIFY', 'Match exchange data', 1, 2],
  ['TRADING_BILLING', 'TDS_CERTIFICATE', 'TDS Certificate', 'RECORD', 'Tax compliance', 0, 3],
  ['TRADING_BILLING', 'E_INVOICE_IRN', 'E-Invoice IRN Acknowledgment', 'RECORD', 'Compliance', 0, 4],
  ['COMPLIANCE', 'FORM_4', 'Form-4 Regulatory Report', 'RECORD', 'Submission proof', 0, 1],
  ['COMPLIANCE', 'CERC_LICENSE', 'CERC Trading License Copy', 'VERIFY', 'License validity', 1, 2],
  ['COMPLIANCE', 'IT_COMPLIANCE', 'MeitY/CERT-In Compliance Certificates', 'RECORD', 'Infra compliance', 0, 3],
];

let cache = null;
let cacheAt = 0;
const CACHE_MS = 5000;

export function invalidateParamCache() {
  cache = null;
  cacheAt = 0;
}

function loadParamMap() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;
  const rows = db.prepare(`SELECT param_key, param_value, data_type FROM system_parameters WHERE is_active = 1`).all();
  cache = Object.fromEntries(rows.map((r) => [r.param_key, r]));
  cacheAt = now;
  return cache;
}

export function getParam(key, fallback = null) {
  try {
    const map = loadParamMap();
    const row = map[key];
    if (!row) return fallback;
    const v = row.param_value;
    if (row.data_type === 'NUMBER' || row.data_type === 'PERCENT') {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    }
    if (row.data_type === 'JSON') {
      try { return JSON.parse(v); } catch { return fallback; }
    }
    return v;
  } catch {
    return fallback;
  }
}

export function getParamNumber(key, fallback) {
  const v = getParam(key, fallback);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Idempotent seed of defaults into master tables (safe on every boot). */
export function ensureMasterDefaults() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  if (!tables.includes('system_parameters')) return;

  const insParam = db.prepare(`
    INSERT OR IGNORE INTO system_parameters (id, category, param_key, param_value, data_type, unit, description, effective_from, is_active)
    VALUES (@id, @category, @param_key, @param_value, @data_type, @unit, @description, date('now'), 1)
  `);
  for (const p of DEFAULT_PARAMS) {
    insParam.run({ id: newId('PRM'), ...p });
  }

  if (tables.includes('bank_master')) {
    const bankCount = db.prepare('SELECT COUNT(*) c FROM bank_master').get().c;
    if (bankCount === 0) {
      const insBank = db.prepare(`
        INSERT INTO bank_master (id, bank_name, ifsc_prefix, branch_name, city, swift_code, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `);
      for (const b of DEFAULT_BANKS) {
        insBank.run(newId('BNK'), b.bank_name, b.ifsc_prefix, b.branch_name, b.city, b.swift_code);
      }
    }
  }

  if (tables.includes('lookup_master')) {
    const insLookup = db.prepare(`
      INSERT OR IGNORE INTO lookup_master (id, category, code, label, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    for (const l of DEFAULT_LOOKUPS) {
      insLookup.run(newId('LKP'), l.category, l.code, l.label, l.sort_order);
    }
  }

  if (tables.includes('document_type_master')) {
    const insDoc = db.prepare(`
      INSERT OR IGNORE INTO document_type_master (id, module_name, code, label, category, reason, is_mandatory, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    for (const [module_name, code, label, category, reason, is_mandatory, sort_order] of DEFAULT_DOC_TYPES) {
      insDoc.run(newId('DTM'), module_name, code, label, category, reason, is_mandatory, sort_order);
    }
  }

  invalidateParamCache();
}

export { DEFAULT_PARAMS, DEFAULT_BANKS, DEFAULT_LOOKUPS, DEFAULT_DOC_TYPES };
