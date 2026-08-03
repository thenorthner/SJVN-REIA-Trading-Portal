/**
 * Master-data helpers: system parameters, default seed, typed getters.
 */
import db from './db/index.js';
import { newId } from './util.js';

const DEFAULT_PARAMS = [
  { category: 'BILLING', param_key: 'trading_margin_per_mwh', param_value: '70', data_type: 'NUMBER', unit: 'INR/MWh', description: 'PSA trading margin (7 paise/unit = ₹70/MWh)' },
  { category: 'BILLING', param_key: 'early_payment_rebate_pct', param_value: '1.5', data_type: 'PERCENT', unit: '%', description: 'Flat early-payment rebate (fallback when tiers empty). PSA Art. 6.4: 1.5% within 5 days.' },
  { category: 'BILLING', param_key: 'early_payment_rebate_tiers', param_value: JSON.stringify([{ within_days: 5, pct: 1.5 }, { within_days: 30, pct: 1 }]), data_type: 'JSON', unit: '', description: 'Tiered early-payment rebate per PSA Art. 6.4: 1.5% within 5 days, 1% within 30 days, nil thereafter (on energy charges; not on taxes/CiL/LPS/transmission).' },
  { category: 'BILLING', param_key: 'lps_annual_pct', param_value: '15', data_type: 'PERCENT', unit: '% p.a.', description: 'LPS BASE rate (first month of default) = SBI 1yr MCLR as on 1 Apr + 5% (MoP LPS Rules 2022). Update each FY.' },
  { category: 'BILLING', param_key: 'lps_monthly_step_pct', param_value: '0.5', data_type: 'PERCENT', unit: '%', description: 'LPS increases by this much (50 bps) for each successive month of default (MoP LPS Rules 2022).' },
  { category: 'BILLING', param_key: 'lps_step_cap_pct', param_value: '3', data_type: 'PERCENT', unit: '%', description: 'LPS shall not exceed base rate + this cap (3% above base per PSA Art. 6.3).' },
  { category: 'BILLING', param_key: 'nrldc_fee_per_mw', param_value: '100', data_type: 'NUMBER', unit: 'INR/MW', description: 'NRLDC/SLDC fee per MW capacity' },
  { category: 'BILLING', param_key: 'default_payment_terms_days', param_value: '45', data_type: 'NUMBER', unit: 'days', description: 'Default payment terms (Due Date = bill receipt/zero date + N days). PSA Art. 6.2.1: within 45 days.' },
  { category: 'BILLING', param_key: 'due_date_counting_mode', param_value: 'CALENDAR_ROLL_FORWARD', data_type: 'TEXT', unit: '', description: 'How payment terms are counted. CALENDAR_ROLL_FORWARD = bill date + N calendar days, moved to the next working day if it lands on a weekly off or holiday (the usual PSA reading). WORKING_DAYS = N working days counted from the bill date, which on 45-day terms falls roughly three weeks later. Set from the contract wording, not by assumption.' },
  { category: 'BILLING', param_key: 'lps_day_count_mode', param_value: 'WORKING_DAYS', data_type: 'TEXT', unit: '', description: 'Which days late-payment surcharge accrues on. WORKING_DAYS excludes the paying party\'s weekly offs and holidays, so a beneficiary is not charged for days its office was shut. CALENDAR charges every day past the due date.' },
  { category: 'BILLING', param_key: 'weekly_off_days', param_value: JSON.stringify([0, 6]), data_type: 'JSON', unit: '', description: 'Weekly non-working days, 0 = Sunday through 6 = Saturday. Default [0,6] is Saturday and Sunday. Change only if a counterparty genuinely works a different week.' },
  { category: 'BILLING', param_key: 'dispute_window_days', param_value: '15', data_type: 'NUMBER', unit: 'days', description: 'PSA Art. 6.7.1: a bill not disputed within N days of presentation becomes conclusive & binding.' },
  { category: 'BILLING', param_key: 'gst_rate_percent', param_value: '0', data_type: 'PERCENT', unit: '%', description: 'GST on the taxable service component (trading margin). Default 0 — sale of electricity is GST-exempt (HSN 2716). Set >0 only where GST genuinely applies; PDF then splits CGST+SGST (intra-state) or IGST (inter-state).' },
  { category: 'BILLING', param_key: 'transmission_charge_per_mwh', param_value: '0', data_type: 'NUMBER', unit: 'INR/MWh', description: 'Default transmission/wheeling charge ₹/MWh when contract has no override' },
  { category: 'BILLING', param_key: 'smtp_host', param_value: '', data_type: 'TEXT', unit: '', description: 'SMTP host for invoice email (or set SMTP_HOST env). Empty = write PDF to backend/outbox/' },
  { category: 'BILLING', param_key: 'smtp_port', param_value: '587', data_type: 'NUMBER', unit: '', description: 'SMTP port (587 STARTTLS / 465 SSL)' },
  { category: 'BILLING', param_key: 'smtp_user', param_value: '', data_type: 'TEXT', unit: '', description: 'SMTP username (or SMTP_USER env)' },
  { category: 'BILLING', param_key: 'smtp_from', param_value: 'noreply@sjvn.local', data_type: 'TEXT', unit: '', description: 'From address for invoice emails (or SMTP_FROM env)' },
  { category: 'REGULATORY', param_key: 'solar_base_cuf_pct', param_value: '22', data_type: 'PERCENT', unit: '%', description: 'Baseline / default min CUF % for Solar (validation + shortfall penalty)' },
  { category: 'REGULATORY', param_key: 'wind_base_cuf_pct', param_value: '30', data_type: 'PERCENT', unit: '%', description: 'Baseline / default min CUF % for Wind (validation + shortfall penalty)' },
  { category: 'REGULATORY', param_key: 'hybrid_base_cuf_pct', param_value: '25', data_type: 'PERCENT', unit: '%', description: 'Baseline / default min CUF % for Hybrid/FDRE shortfall penalty' },
  { category: 'REGULATORY', param_key: 'hydro_base_cuf_pct', param_value: '65', data_type: 'PERCENT', unit: '%', description: 'Baseline CUF for Hydro energy validation' },
  { category: 'BILLING', param_key: 'cuf_penalty_per_mwh', param_value: '0', data_type: 'NUMBER', unit: 'INR/MWh', description: 'CUF shortfall penalty rate ₹/MWh. 0 = use contract tariff (₹/kWh × 1000)' },
  { category: 'BILLING', param_key: 'cuf_penalty_factor', param_value: '1', data_type: 'NUMBER', unit: '', description: 'Multiplier on CUF shortfall penalty (1 = full tariff compensation)' },
  { category: 'BILLING', param_key: 'seller_invoice_qty_tolerance_pct', param_value: '0.5', data_type: 'PERCENT', unit: '%', description: 'Seller vs system invoice energy (MWh) match tolerance' },
  { category: 'BILLING', param_key: 'seller_invoice_amount_tolerance_pct', param_value: '0.1', data_type: 'PERCENT', unit: '%', description: 'Seller vs system invoice amount match tolerance (%)' },
  { category: 'BILLING', param_key: 'seller_invoice_amount_tolerance_abs', param_value: '1', data_type: 'NUMBER', unit: 'INR', description: 'Seller vs system invoice absolute amount tolerance (₹)' },
  { category: 'REGULATORY', param_key: 'energy_validate_tolerance_pct', param_value: '30', data_type: 'PERCENT', unit: '%', description: 'Deviation tolerance for Solar/Wind validation' },
  { category: 'REGULATORY', param_key: 'hydro_validate_tolerance_pct', param_value: '80', data_type: 'PERCENT', unit: '%', description: 'Deviation tolerance for Hydro (seasonality)' },
  { category: 'REGULATORY', param_key: 'freq_response_incentive_pct_hydro', param_value: '3', data_type: 'PERCENT', unit: '%', description: 'CERC Reg 65(4): Hydro/PSP frequency-response incentive = (pct × β × AFC)/12' },
  { category: 'REGULATORY', param_key: 'freq_response_incentive_pct_thermal', param_value: '1', data_type: 'PERCENT', unit: '%', description: 'CERC Reg 62(5): Thermal frequency-response incentive = (pct × β × AFC)/12' },
  { category: 'REGULATORY', param_key: 'freq_response_beta_min', param_value: '0.30', data_type: 'NUMBER', unit: '', description: 'Minimum β for incentive eligibility (CERC: payable only if β > 0.30)' },
  { category: 'REGULATORY', param_key: 'freq_response_beta_sharing_factor', param_value: '0.5', data_type: 'NUMBER', unit: '', description: 'SJVN NJHPS sharing factor in beta incentive: (pct × β × factor × AFC)/12. Set 1 to disable (pure CERC).' },
  { category: 'REGULATORY', param_key: 'cerc_margin_cap_price_threshold', param_value: '3', data_type: 'NUMBER', unit: 'INR/kWh', description: 'CERC (Fixation of Trading Margin) Regulations 2010: sale price at/below which the lower margin cap applies.' },
  { category: 'REGULATORY', param_key: 'cerc_margin_cap_low', param_value: '0.04', data_type: 'NUMBER', unit: 'INR/kWh', description: 'CERC trading margin cap (4 paise/kWh) where sale price is at or below the threshold.' },
  { category: 'REGULATORY', param_key: 'cerc_margin_cap_high', param_value: '0.07', data_type: 'NUMBER', unit: 'INR/kWh', description: 'CERC trading margin cap (7 paise/kWh) where sale price is above the threshold.' },
  { category: 'REGULATORY', param_key: 'cerc_form_iv_due_days', param_value: '30', data_type: 'NUMBER', unit: 'days', description: 'Days after the reporting period ends by which Form-IV must be filed with CERC.' },
  { category: 'REGULATORY', param_key: 'cerc_afc_energy_share', param_value: '0.5', data_type: 'NUMBER', unit: 'fraction', description: 'Share of Annual Fixed Cost recovered through the energy charge in a two-part tariff; the remainder is recovered as capacity charge. CERC Tariff Regulations put this at 0.5 for hydro stations with pondage. Generator billing derives ECR = (share x AFC) / design energy from this, so the two halves always add back to one AFC.' },
  { category: 'REGULATORY', param_key: 'rec_certificate_multipliers', param_value: JSON.stringify({ Solar: 1, Wind: 1, Hybrid: 1, Hydro: 1.5, PSP: 1.5, MSW: 2, Cogeneration: 2, Biomass: 2.5, Biofuel: 2.5 }), data_type: 'JSON', unit: '', description: 'CERC REC Regulations 2022 cl.12(2) Certificate Multiplier by technology: RECs issued = injected MWh × multiplier. Wind/Solar 1, Hydro 1.5, MSW & non-fossil cogen 2, Biomass/Biofuel 2.5.' },
  { category: 'REGULATORY', param_key: 'rec_issuance_fee_per_rec', param_value: '4', data_type: 'NUMBER', unit: 'INR/REC', description: 'Central Agency (Grid India) registry issuance charge per REC — default cost basis for a new lot.' },
  { category: 'TRADING', param_key: 'ocf_carry_forward_chains', param_value: JSON.stringify({ GDAM: ['DAM', 'RTM'], DAM: ['RTM'] }), data_type: 'JSON', unit: '', description: 'OCF carry-forward: which market segments a bid\'s uncleared quantity may be carried forward into, keyed by the source product. Covers DAM→RTM, GDAM→DAM→RTM and GDAM→RTM. Edit to open or close a route without a code change.' },
  { category: 'TRADING', param_key: 'ocf_default_premium', param_value: JSON.stringify({ 'GDAM>DAM': 0, 'GDAM>RTM': 0, 'DAM>RTM': 0 }), data_type: 'JSON', unit: 'INR/kWh', description: 'Default premium (+) or discount (−) in Rs/unit pre-filled on the carry-forward form, keyed "FROM>TO". The trader can still override it per bid.' },
  { category: 'REGULATORY', param_key: 'certificate_price_bands', param_value: JSON.stringify({ REC: { floor: 0, forbearance: null }, ESCERT: { floor: 0, forbearance: null } }), data_type: 'JSON', unit: 'INR/certificate', description: 'Floor and forbearance (ceiling) price per certificate, as set by the prevailing CERC order for RECs and by BEE/CERC for ESCerts. A null forbearance means no ceiling has been recorded — the bid screen then says the ceiling is not configured rather than accepting any price. Update these whenever a new order is issued; they are not derivable.' },
  { category: 'TRADING', param_key: 'escert_session_dates', param_value: '[]', data_type: 'JSON', unit: '', description: 'Upcoming ESCert trading session dates (ISO, e.g. ["2026-08-26"]), as notified by BEE and the exchanges. Unlike RECs, ESCert sessions follow no fixed calendar rule, so they cannot be derived — the compliance ticker shows "not scheduled" until dates are entered here.' },
  { category: 'TRADING', param_key: 'sldc_renewal_notice_days', param_value: '7', data_type: 'NUMBER', unit: 'days', description: 'Clause 26 of the SLDC standing clearance: the generator must approach the SLDC at least this many days before expiry. Inside this window the bidding screen raises a renewal warning — it does not block bidding. Bids are only refused once the clearance has actually lapsed.' },
  { category: 'TRADING', param_key: 'trading_enforce_maker_checker', param_value: 'true', data_type: 'TEXT', unit: '', description: 'When true, the user who raised a bid cannot approve it — approval must come from a different member of the checker group. Set to "false" only if the desk has too few users to segregate the roles; the change is audited.' },
  { category: 'TRADING', param_key: 'bid_block_duration_hours', param_value: JSON.stringify({ DAM: 0.25, GDAM: 0.25, GTAM: 0.25, RTM: 0.5 }), data_type: 'JSON', unit: 'hours', description: 'Delivery duration of one bid block, by product. Used to turn MW into MWh when valuing a bid: exposure = MW x 1000 x hours x price(Rs/kWh). DAM/GDAM/GTAM clear 15-minute blocks; an RTM session covers 30 minutes. Confirm against the exchange contract specs before relying on the limit checks.' },
  { category: 'GENERAL', param_key: 'sms_enabled', param_value: 'false', data_type: 'TEXT', unit: '', description: 'Master switch for outbound SMS. "true" sends via TextGuru (needs textguru_api_key + sender ID); anything else keeps SMS in outbox-only mode. Email and in-app are unaffected.' },
  { category: 'GENERAL', param_key: 'textguru_api_key', param_value: '', data_type: 'TEXT', unit: '', description: 'TextGuru SMS gateway API key (or TEXTGURU_API_KEY env). Empty = SMS written to backend/outbox/ instead of sent.' },
  { category: 'GENERAL', param_key: 'textguru_sender_id', param_value: '', data_type: 'TEXT', unit: '', description: 'DLT-registered 6-char sender ID / header for TextGuru (or TEXTGURU_SENDER env). Required by Indian carriers for transactional SMS.' },
  { category: 'GENERAL', param_key: 'ops_desk_phone', param_value: '', data_type: 'TEXT', unit: '', description: 'Fallback mobile number for internal desk alerts where the target user has no phone on record. Comma-separated for multiple.' },
  { category: 'GENERAL', param_key: 'notification_channel_policy', param_value: JSON.stringify({
    INVOICE_SENT: ['INAPP', 'EMAIL', 'SMS'],
    PAYMENT_RECEIVED: ['INAPP', 'EMAIL', 'SMS'],
    NOAR_WALLET_LOW: ['INAPP', 'EMAIL', 'SMS'],
    NOAR_APPROVED: ['INAPP', 'EMAIL', 'SMS'],
    NOAR_REJECTED: ['INAPP', 'EMAIL', 'SMS'],
    NOAR_SLA_BREACHED: ['INAPP', 'EMAIL', 'SMS'],
    NOAR_SLA_AT_RISK: ['INAPP', 'EMAIL'],
    DISPUTE_SLA_BREACHED: ['INAPP', 'EMAIL', 'SMS'],
    FORM_IV_DUE: ['INAPP', 'EMAIL', 'SMS'],
    DEFAULT: ['INAPP'],
  }), data_type: 'JSON', unit: '', description: 'Which channels each notification event uses, keyed by event type. Events not listed fall back to DEFAULT (in-app only). Channels: INAPP, EMAIL, SMS. Edit to add or silence a channel without a code change.' },
  { category: 'TRADING', param_key: 'iex_enabled', param_value: 'false', data_type: 'TEXT', unit: '', description: 'Master switch for the IEX exchange API. "true" pulls live cleared results and market prices (needs iex_api_token, iex_base_url, iex_login_user_id); anything else runs in stub mode. Bid submission stays manual either way.' },
  { category: 'TRADING', param_key: 'iex_api_token', param_value: '', data_type: 'TEXT', unit: '', description: 'IEX member authentication token, sent as "Authentication: Bearer <token>" (or IEX_API_TOKEN env). Issued by the exchange to each member.' },
  { category: 'TRADING', param_key: 'iex_base_url', param_value: '', data_type: 'TEXT', unit: '', description: 'IEX API base URL; the client appends {product}/api/v2/... for DAM, GDAM, RTM and HPDAM.' },
  { category: 'TRADING', param_key: 'iex_login_user_id', param_value: '', data_type: 'TEXT', unit: '', description: 'IEX LoginUserId sent in the request header and URL path.' },
  { category: 'TRADING', param_key: 'iex_participant_id', param_value: '', data_type: 'TEXT', unit: '', description: 'IEX ParticipantId for user/portfolio logins. Leave blank when connecting as the participant itself.' },
  { category: 'TRADING', param_key: 'wbes_enabled', param_value: 'false', data_type: 'TEXT', unit: '', description: 'Master switch for the NOAR / State WBES schedule pull. "true" calls the live Energy Scheduling Platform (needs wbes_api_key + wbes_base_url); anything else runs in stub mode against a sample payload.' },
  { category: 'TRADING', param_key: 'wbes_api_key', param_value: '', data_type: 'TEXT', unit: '', description: 'WBES API key, sent as the X-API-Key header (or WBES_API_KEY env). Issued by the Energy Scheduling Platform to the utility.' },
  { category: 'TRADING', param_key: 'wbes_base_url', param_value: '', data_type: 'TEXT', unit: '', description: 'WBES base URL, e.g. https://<host>/ — the client appends reports/1.0/WebAccessAPI/GetUtilityExternalSharedData.' },
  { category: 'TRADING', param_key: 'wbes_username', param_value: '', data_type: 'TEXT', unit: '', description: 'WBES integration username sent in the request body; must match the API credentials issued with the key.' },
  { category: 'TRADING', param_key: 'wbes_utility_acronym', param_value: '', data_type: 'TEXT', unit: '', description: 'Utility acronym to request schedules for (UtilAcronymList), e.g. the SJVN entity acronym on the scheduling platform.' },
  { category: 'TRADING', param_key: 'noar_sla_days', param_value: JSON.stringify({ STOA: 7, MTOA: 15, LTOA: 30 }), data_type: 'JSON', unit: 'days', description: 'SJVN internal target for NOAR open-access approval, measured from submission to NLDC approval, by open-access term. These are tracking targets set by SJVN, not statutory limits — set them to whatever the business commits to.' },
  { category: 'TRADING', param_key: 'noar_sla_warning_fraction', param_value: '0.7', data_type: 'NUMBER', unit: 'fraction', description: 'Fraction of the NOAR SLA target at which a pending approval is flagged AT_RISK (0.7 = warn once 70% of the allowed days have elapsed). Set to 1 to warn only on breach.' },
  { category: 'TRADING', param_key: 'noar_sla_digest_recipients', param_value: '', data_type: 'TEXT', unit: '', description: 'Comma-separated email addresses for the weekly NOAR approval digest (Monday 09:00 IST). Empty = digest is skipped. With no SMTP host configured the mail is written to backend/outbox/ instead of being sent.' },
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
  // Why a NOAR open-access application came back rejected. Editable in Masters
  // Hub so the desk can match whatever Grid India actually cites.
  { category: 'NOAR_REJECTION_REASON', code: 'INCOMPLETE_DOCS', label: 'Incomplete or invalid documents', sort_order: 1 },
  { category: 'NOAR_REJECTION_REASON', code: 'CORRIDOR_UNAVAILABLE', label: 'Transmission corridor unavailable', sort_order: 2 },
  { category: 'NOAR_REJECTION_REASON', code: 'SCHEDULE_MISMATCH', label: 'Schedule / Format-D mismatch', sort_order: 3 },
  { category: 'NOAR_REJECTION_REASON', code: 'INSUFFICIENT_WALLET', label: 'Insufficient NOAR wallet balance', sort_order: 4 },
  { category: 'NOAR_REJECTION_REASON', code: 'COUNTERPARTY_CONSENT', label: 'Counterparty consent missing', sort_order: 5 },
  { category: 'NOAR_REJECTION_REASON', code: 'OTHER', label: 'Other (see notes)', sort_order: 99 },
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
