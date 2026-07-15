import bcrypt from 'bcryptjs';
import db from './index.js';
import { newId } from '../util.js';
import {
  syncRequirementsFromContract,
  createInstrumentsFromRequirements,
  trailingMonthlyBilledAvg,
  genInstrumentNo,
  genInvocationNo,
  recordSecurityEvent,
} from '../paymentSecurityEngine.js';
import { WATERFALL_DEFAULTS } from '../paymentSecurityConstants.js';

const already = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (already > 0) {
  console.log('Database already seeded. Skipping. (delete platform.db to reseed)');
  process.exit(0);
}

const hash = bcrypt.hashSync('password123', 8);

const insertUser = db.prepare(`
  INSERT INTO users (id, name, email, password_hash, role, linked_entity_id)
  VALUES (@id, @name, @email, @password_hash, @role, @linked_entity_id)
`);

const users = [
  { name: 'Admin User', email: 'admin@sjvn.in', role: 'SJVN_ADMIN' },
  { name: 'Rahul (REIA Ops)', email: 'reia@sjvn.in', role: 'REIA_USER' },
  { name: 'Shreya (Trading Ops)', email: 'trading@sjvn.in', role: 'TRADING_USER' },
  { name: 'Vikas (Finance)', email: 'finance@sjvn.in', role: 'FINANCE_USER' },
  { name: 'Divyankur (Management)', email: 'management@sjvn.in', role: 'MANAGEMENT' },
  { name: 'Ravi (Compliance)', email: 'auditor@sjvn.in', role: 'COMPLIANCE_AUDITOR' },
  { name: 'Sunrise Solar Pvt Ltd', email: 'seller@sunrise-solar.in', role: 'SELLER' },
  { name: 'State DISCOM Buyer', email: 'buyer@discom.gov.in', role: 'BUYER' },
  { name: 'ABC Trading Client', email: 'client@abctrading.in', role: 'TRADING_CLIENT' },
];

const userIds = {};
for (const u of users) {
  const id = newId('USR');
  userIds[u.email] = id;
  insertUser.run({ id, name: u.name, email: u.email, password_hash: hash, role: u.role, linked_entity_id: null });
}

// ---------------- Entities (Sellers / Buyers) ----------------
const insertEntity = db.prepare(`
  INSERT INTO entities (id, parent_entity_id, entity_type, category, name, pan_no, gst_no, cin, credit_rating, is_blacklisted, capacity_mw, technology, contracted_capacity_mw,
    psa_tariff, supply_criteria, organization_details, regulatory_approvals, bank_details, is_penny_drop_verified, status)
  VALUES (@id, @parent_entity_id, @entity_type, @category, @name, @pan_no, @gst_no, @cin, @credit_rating, @is_blacklisted, @capacity_mw, @technology, @contracted_capacity_mw,
    @psa_tariff, @supply_criteria, @organization_details, @regulatory_approvals, @bank_details, @is_penny_drop_verified, @status)
`);

const insertContact = db.prepare(`
  INSERT INTO entity_contacts (id, entity_id, contact_type, name, email, phone, is_primary)
  VALUES (@id, @entity_id, @contact_type, @name, @email, @phone, @is_primary)
`);

const insertDoc = db.prepare(`
  INSERT INTO entity_documents (id, entity_id, doc_type, url, validity_end, alert_sent)
  VALUES (@id, @entity_id, @doc_type, @url, @validity_end, @alert_sent)
`);

const parentAdani = { id: newId('SEL'), parent_entity_id: null, entity_type: 'SELLER', category: 'RE Generator', name: 'Adani Green Energy Ltd (Group)', pan_no: 'ABCDE1234F', gst_no: '27ABCDE1234F1Z5', cin: 'L40106GJ2015PLC082007', credit_rating: 'AAA', is_blacklisted: 0, capacity_mw: null, technology: null, contracted_capacity_mw: null, psa_tariff: null, supply_criteria: null, organization_details: 'Parent Group', regulatory_approvals: null, bank_details: null, is_penny_drop_verified: 0, status: 'APPROVED' };
const sellerAdani1 = { id: newId('SEL'), parent_entity_id: parentAdani.id, entity_type: 'SELLER', category: 'RE Generator', name: 'Adani Solar Rajasthan SPV', pan_no: 'ABCDE1234F', gst_no: '08ABCDE1234F1Z5', cin: 'U40106RJ2016PTC012345', credit_rating: 'AA', is_blacklisted: 0, capacity_mw: 150, technology: 'Solar', contracted_capacity_mw: 150, psa_tariff: null, supply_criteria: null, organization_details: 'SPV for Rajasthan Solar Project', regulatory_approvals: 'CEA, MNRE registered', bank_details: 'HDFC Bank - A/C 001122334455', is_penny_drop_verified: 1, status: 'APPROVED' };
const sellerWindforce = { id: newId('SEL'), parent_entity_id: null, entity_type: 'SELLER', category: 'RE Generator', name: 'Windforce Energy Ltd', pan_no: 'WINDD5678G', gst_no: '08WINDD5678G1Z5', cin: 'U40200RJ2016PLC654321', credit_rating: 'A+', is_blacklisted: 0, capacity_mw: 100, technology: 'Wind', contracted_capacity_mw: 100, psa_tariff: null, supply_criteria: null, organization_details: 'Independent Wind Generator', regulatory_approvals: 'CEA registered', bank_details: 'SBI - A/C 220033445566', is_penny_drop_verified: 1, status: 'APPROVED' };
const sellerHybrid = { id: newId('SEL'), parent_entity_id: null, entity_type: 'SELLER', category: 'RE Generator', name: 'Hybrid Power Generation Co', pan_no: 'HYBCC9012H', gst_no: '24HYBCC9012H1Z5', cin: 'U40109GJ2018PLC998877', credit_rating: 'A', is_blacklisted: 0, capacity_mw: 200, technology: 'Hybrid', contracted_capacity_mw: 200, psa_tariff: null, supply_criteria: null, organization_details: 'Hybrid SPV', regulatory_approvals: 'CEA, MNRE registered', bank_details: 'ICICI Bank - A/C 330044556677', is_penny_drop_verified: 1, status: 'APPROVED' };

const buyers = [
  { id: newId('BUY'), parent_entity_id: null, entity_type: 'BUYER', category: 'DISCOM', name: 'Punjab State Power Corp', pan_no: 'PSPBB3456I', gst_no: '03PSPBB3456I1Z5', cin: 'U40109PB2010SGC033813', credit_rating: 'A', is_blacklisted: 0, capacity_mw: null, technology: null, contracted_capacity_mw: 120, psa_tariff: 3.45, supply_criteria: 'Round the clock RE supply', organization_details: 'State DISCOM', regulatory_approvals: 'PSERC approved', bank_details: 'PNB - A/C 550066778899', is_penny_drop_verified: 1, status: 'APPROVED' },
  { id: newId('BUY'), parent_entity_id: null, entity_type: 'BUYER', category: 'DISCOM', name: 'Uttar Pradesh Power Corp', pan_no: 'UPPCC7890J', gst_no: '09UPPCC7890J1Z5', cin: 'U40101UP1999SGC024928', credit_rating: 'B+', is_blacklisted: 0, capacity_mw: null, technology: null, contracted_capacity_mw: 200, psa_tariff: 3.60, supply_criteria: 'Peak power supply', organization_details: 'State DISCOM', regulatory_approvals: 'UPERC approved', bank_details: 'BOB - A/C 660077889900', is_penny_drop_verified: 1, status: 'APPROVED' }
];

const sellers = [parentAdani, sellerAdani1, sellerWindforce, sellerHybrid];
for (const e of [...sellers, ...buyers]) {
  insertEntity.run(e);
  insertContact.run({ id: newId('CNT'), entity_id: e.id, contact_type: 'COMMERCIAL', name: 'Commercial Lead', email: 'billing@' + e.name.replace(/\\s+/g, '').toLowerCase() + '.in', phone: '9876543210', is_primary: 1 });
  insertDoc.run({ id: newId('DOC'), entity_id: e.id, doc_type: 'Registration Certificate', url: 'https://sjvn.in/docs/reg.pdf', validity_end: '2030-12-31', alert_sent: 0 });
}

// Link external users to their entities for data isolation
db.prepare('UPDATE users SET linked_entity_id = ? WHERE email = ?').run(sellers[1].id, 'seller@sunrise-solar.in');
db.prepare('UPDATE users SET linked_entity_id = ? WHERE email = ?').run(buyers[0].id, 'buyer@discom.gov.in');

// ---------------- Contracts ----------------
const insertContract = db.prepare(`
  INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw, commissioned_capacity_mw, cod_date,
    tariff_type, tariff_per_unit, tariff_structure_json, tenure_start, tenure_end, billing_cycle, payment_terms, emd_amount, pbg_amount, pbg_type, pbg_expiry, termination_reason, termination_date, status)
  VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw, @commissioned_capacity_mw, @cod_date,
    @tariff_type, @tariff_per_unit, @tariff_structure_json, @tenure_start, @tenure_end, @billing_cycle, @payment_terms, @emd_amount, @pbg_amount, @pbg_type, @pbg_expiry, @termination_reason, @termination_date, @status)
`);

const insertContractProject = db.prepare(`
  INSERT INTO contract_projects (contract_id, project_entity_id, allocated_capacity_mw)
  VALUES (@contract_id, @project_entity_id, @allocated_capacity_mw)
`);

const contracts = [
  { id: newId('CON'), contract_no: 'PPA/SJVN/2024/001', contract_type: 'PPA', seller_id: sellers[0].id, buyer_id: null, project_type: 'Solar', capacity_mw: 150, commissioned_capacity_mw: 150, cod_date: '2024-03-15', tariff_type: 'FLAT', tariff_per_unit: 2.55, tariff_structure_json: null, tenure_start: '2024-04-01', tenure_end: '2049-03-31', billing_cycle: 'MONTHLY', payment_terms: 'Net 30 days', emd_amount: 15000000, pbg_amount: 22500000, pbg_type: 'BG', pbg_expiry: '2026-03-31', termination_reason: null, termination_date: null, status: 'ACTIVE' },
  { id: newId('CON'), contract_no: 'PPA/SJVN/2024/002', contract_type: 'PPA', seller_id: sellers[2].id, buyer_id: null, project_type: 'Wind', capacity_mw: 100, commissioned_capacity_mw: 40, cod_date: '2024-05-15', tariff_type: 'TWO_PART', tariff_per_unit: 2.85, tariff_structure_json: JSON.stringify({ fixedCapacityCharge: 1.20, variableEnergyCharge: 1.65 }), tenure_start: '2024-06-01', tenure_end: '2049-05-31', billing_cycle: 'MONTHLY', payment_terms: 'Net 30 days', emd_amount: 10000000, pbg_amount: 15000000, pbg_type: 'BG', pbg_expiry: '2026-05-31', termination_reason: null, termination_date: null, status: 'ACTIVE' },
  { id: newId('CON'), contract_no: 'PSA/SJVN/2024/101', contract_type: 'PSA', seller_id: null, buyer_id: buyers[0].id, project_type: 'Solar', capacity_mw: 120, commissioned_capacity_mw: 120, cod_date: '2024-03-15', tariff_type: 'FLAT', tariff_per_unit: 3.45, tariff_structure_json: null, tenure_start: '2024-04-01', tenure_end: '2049-03-31', billing_cycle: 'MONTHLY', payment_terms: 'Net 45 days', emd_amount: null, pbg_amount: null, pbg_type: null, pbg_expiry: null, termination_reason: null, termination_date: null, status: 'ACTIVE' },
];

for (const c of contracts) {
  insertContract.run(c);
  if (c.contract_type === 'PPA') {
    insertContractProject.run({ contract_id: c.id, project_entity_id: c.seller_id === sellers[0].id ? sellers[1].id : c.seller_id, allocated_capacity_mw: c.capacity_mw });
  }
}

// ---------------- Energy Data ----------------
const insertEnergy = db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, availability_percent, status)
  VALUES (@id, @contract_id, @period_month, @data_type, @source, @energy_mwh, @cuf_percent, @availability_percent, @status)
`);

const months = ['2025-04', '2025-05', '2025-06'];
for (const c of contracts) {
  for (const m of months) {
    const baseEnergy = c.capacity_mw * 24 * 30 * 0.25; // rough MWh estimate
    insertEnergy.run({
      id: newId('ENG'),
      contract_id: c.id,
      period_month: m,
      data_type: 'FINAL',
      source: 'REA',
      energy_mwh: Math.round(baseEnergy),
      cuf_percent: 22 + Math.random() * 8,
      availability_percent: 95 + Math.random() * 4,
      status: 'LOCKED',
    });
  }
}

// ---------------- Invoices ----------------
const insertInvoice = db.prepare(`
  INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
    tariff_per_unit, energy_charges, transmission_charges, rebate, lps, penalty, trading_margin, taxes,
    other_adjustments, total_amount, disputed_amount, due_date, status)
  VALUES (@id, @invoice_no, @contract_id, @invoice_type, @direction, @billing_period, @energy_mwh,
    @tariff_per_unit, @energy_charges, @transmission_charges, @rebate, @lps, @penalty, @trading_margin, @taxes,
    @other_adjustments, @total_amount, @disputed_amount, @due_date, @status)
`);

let invCounter = 1000;
const invoices = [];
for (const c of contracts) {
  for (const m of months) {
    const energy = c.capacity_mw * 24 * 30 * 0.25;
    const energyCharges = Math.round(energy * c.tariff_per_unit);
    const margin = c.contract_type === 'PSA' ? Math.round(energyCharges * 0.02) : 0;
    const taxes = Math.round(energyCharges * 0.0);
    const total = energyCharges + margin + taxes;
    const status = m === months[2] ? 'UNDER_APPROVAL' : (m === months[1] ? 'PAID' : 'PAID');
    const inv = {
      id: newId('INV'),
      invoice_no: `INV/2025/${invCounter++}`,
      contract_id: c.id,
      invoice_type: 'FINAL',
      direction: c.contract_type === 'PPA' ? 'SELLER_TO_SJVN' : 'SJVN_TO_BUYER',
      billing_period: m,
      energy_mwh: Math.round(energy),
      tariff_per_unit: c.tariff_per_unit,
      energy_charges: energyCharges,
      transmission_charges: 0,
      rebate: 0,
      lps: 0,
      penalty: 0,
      trading_margin: margin,
      taxes,
      other_adjustments: 0,
      total_amount: total,
      disputed_amount: 0,
      due_date: `${m}-28`,
      status,
    };
    invoices.push(inv);
    insertInvoice.run(inv);
  }
}

// A disputed invoice for demo + rich dispute samples
const disputedInvoice = invoices[0];
const buyerInvoice = invoices.find((i) => i.direction === 'SJVN_TO_BUYER') || invoices[6] || invoices[1];
const sellerInvoice2 = invoices.find((i, idx) => i.direction === 'SELLER_TO_SJVN' && idx > 0) || invoices[1];

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
function daysFromIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const insertDispute = db.prepare(`
  INSERT INTO disputes (
    id, dispute_no, invoice_id, raised_by_role, raised_by_user_id, reason_code, charge_line,
    issue_description, disputed_amount, status, assigned_to, acknowledged_at, acknowledged_by,
    resolution_outcome, resolution_notes, accepted_amount, credit_amount, lps_on_resolution,
    before_total, after_total, sla_ack_due, sla_resolve_due, sla_breached_at, escalated_at,
    created_at, updated_at, resolved_at, resolved_by
  ) VALUES (
    @id, @dispute_no, @invoice_id, @raised_by_role, @raised_by_user_id, @reason_code, @charge_line,
    @issue_description, @disputed_amount, @status, @assigned_to, @acknowledged_at, @acknowledged_by,
    @resolution_outcome, @resolution_notes, @accepted_amount, @credit_amount, @lps_on_resolution,
    @before_total, @after_total, @sla_ack_due, @sla_resolve_due, @sla_breached_at, @escalated_at,
    @created_at, @updated_at, @resolved_at, @resolved_by
  )
`);

const insertComment = db.prepare(`
  INSERT INTO dispute_comments (id, dispute_id, user_id, user_name, role, body, is_internal, created_at)
  VALUES (@id, @dispute_id, @user_id, @user_name, @role, @body, @is_internal, @created_at)
`);

const insertEvent = db.prepare(`
  INSERT INTO dispute_events (id, dispute_id, actor_id, actor_name, event_type, from_status, to_status, details, created_at)
  VALUES (@id, @dispute_id, @actor_id, @actor_name, @event_type, @from_status, @to_status, @details, @created_at)
`);

const reiaUserId = userIds['reia@sjvn.in'];
const buyerUserId = userIds['buyer@discom.gov.in'];
const sellerUserId = userIds['seller@sunrise-solar.in'];

const amt1 = Math.round(disputedInvoice.energy_charges * 0.08);
const amt2 = Math.round((buyerInvoice?.trading_margin || buyerInvoice?.energy_charges || 50000) * 0.3) || 50000;
const amt3 = Math.round((sellerInvoice2?.energy_charges || 100000) * 0.05);
const amt4 = Math.round((buyerInvoice?.energy_charges || 80000) * 0.12);
const amt5 = Math.round((disputedInvoice.energy_charges || 100000) * 0.03);

const d1 = newId('DIS');
const d2 = newId('DIS');
const d3 = newId('DIS');
const d4 = newId('DIS');
const d5 = newId('DIS');
const d6 = newId('DIS');

insertDispute.run({
  id: d1,
  dispute_no: 'DSP/2026/1001',
  invoice_id: disputedInvoice.id,
  raised_by_role: 'SELLER',
  raised_by_user_id: sellerUserId,
  reason_code: 'ENERGY_DATA_MISMATCH',
  charge_line: 'energy_charges',
  issue_description: 'Billed energy does not match SLDC metered units for the period.',
  disputed_amount: amt1,
  status: 'UNDER_REVIEW',
  assigned_to: reiaUserId,
  acknowledged_at: daysAgoIso(9),
  acknowledged_by: 'system',
  resolution_outcome: null,
  resolution_notes: null,
  accepted_amount: 0,
  credit_amount: 0,
  lps_on_resolution: 0,
  before_total: null,
  after_total: null,
  sla_ack_due: daysAgoIso(8),
  sla_resolve_due: daysFromIso(5),
  sla_breached_at: null,
  escalated_at: null,
  created_at: daysAgoIso(10),
  updated_at: daysAgoIso(2),
  resolved_at: null,
  resolved_by: null,
});

insertDispute.run({
  id: d2,
  dispute_no: 'DSP/2026/1002',
  invoice_id: buyerInvoice.id,
  raised_by_role: 'BUYER',
  raised_by_user_id: buyerUserId,
  reason_code: 'TARIFF_RATE_ERROR',
  charge_line: 'energy_charges',
  issue_description: 'PSA tariff applied incorrectly vs contracted rate.',
  disputed_amount: amt2,
  status: 'INFO_REQUESTED',
  assigned_to: reiaUserId,
  acknowledged_at: daysAgoIso(4),
  acknowledged_by: 'system',
  resolution_outcome: null,
  resolution_notes: null,
  accepted_amount: 0,
  credit_amount: 0,
  lps_on_resolution: 0,
  before_total: null,
  after_total: null,
  sla_ack_due: daysAgoIso(3),
  sla_resolve_due: daysFromIso(10),
  sla_breached_at: null,
  escalated_at: null,
  created_at: daysAgoIso(5),
  updated_at: daysAgoIso(1),
  resolved_at: null,
  resolved_by: null,
});

insertDispute.run({
  id: d3,
  dispute_no: 'DSP/2026/1003',
  invoice_id: sellerInvoice2.id,
  raised_by_role: 'SELLER',
  raised_by_user_id: sellerUserId,
  reason_code: 'REBATE_ERROR',
  charge_line: 'rebate',
  issue_description: 'Prompt payment rebate not applied despite early settlement.',
  disputed_amount: Math.max(amt3, 25000),
  status: 'ESCALATED',
  assigned_to: reiaUserId,
  acknowledged_at: daysAgoIso(20),
  acknowledged_by: 'system',
  resolution_outcome: null,
  resolution_notes: null,
  accepted_amount: 0,
  credit_amount: 0,
  lps_on_resolution: 0,
  before_total: null,
  after_total: null,
  sla_ack_due: daysAgoIso(18),
  sla_resolve_due: daysAgoIso(5),
  sla_breached_at: daysAgoIso(5),
  escalated_at: daysAgoIso(5),
  created_at: daysAgoIso(20),
  updated_at: daysAgoIso(5),
  resolved_at: null,
  resolved_by: null,
});

insertDispute.run({
  id: d4,
  dispute_no: 'DSP/2026/1004',
  invoice_id: buyerInvoice.id,
  raised_by_role: 'BUYER',
  raised_by_user_id: buyerUserId,
  reason_code: 'TAX_GST_ERROR',
  charge_line: 'taxes',
  issue_description: 'GST computed on wrong taxable base.',
  disputed_amount: Math.max(amt4, 15000),
  status: 'RESOLVED_ACCEPTED',
  assigned_to: reiaUserId,
  acknowledged_at: daysAgoIso(28),
  acknowledged_by: 'system',
  resolution_outcome: 'PARTIAL_CREDIT',
  resolution_notes: 'Partial credit accepted for GST miscalculation on transmission component.',
  accepted_amount: Math.round(Math.max(amt4, 15000) * 0.6),
  credit_amount: Math.round(Math.max(amt4, 15000) * 0.6),
  lps_on_resolution: 0,
  before_total: buyerInvoice.total_amount,
  after_total: buyerInvoice.total_amount - Math.round(Math.max(amt4, 15000) * 0.6),
  sla_ack_due: daysAgoIso(26),
  sla_resolve_due: daysAgoIso(14),
  sla_breached_at: null,
  escalated_at: null,
  created_at: daysAgoIso(30),
  updated_at: daysAgoIso(12),
  resolved_at: daysAgoIso(12),
  resolved_by: 'Rahul (REIA Ops)',
});

insertDispute.run({
  id: d5,
  dispute_no: 'DSP/2026/1005',
  invoice_id: disputedInvoice.id,
  raised_by_role: 'SELLER',
  raised_by_user_id: sellerUserId,
  reason_code: 'TRANSMISSION_WHEELING',
  charge_line: 'transmission_charges',
  issue_description: 'Wheeling charges billed though OA was not applicable.',
  disputed_amount: amt5,
  status: 'ACKNOWLEDGED',
  assigned_to: null,
  acknowledged_at: daysAgoIso(1),
  acknowledged_by: 'system',
  resolution_outcome: null,
  resolution_notes: null,
  accepted_amount: 0,
  credit_amount: 0,
  lps_on_resolution: 0,
  before_total: null,
  after_total: null,
  sla_ack_due: daysFromIso(1),
  sla_resolve_due: daysFromIso(14),
  sla_breached_at: null,
  escalated_at: null,
  created_at: daysAgoIso(1),
  updated_at: daysAgoIso(1),
  resolved_at: null,
  resolved_by: null,
});

insertDispute.run({
  id: d6,
  dispute_no: 'DSP/2026/1006',
  invoice_id: sellerInvoice2.id,
  raised_by_role: 'SELLER',
  raised_by_user_id: sellerUserId,
  reason_code: 'DUPLICATE_BILLING',
  charge_line: 'energy_charges',
  issue_description: 'Same period billed twice under two invoice numbers.',
  disputed_amount: Math.round((sellerInvoice2.energy_charges || 50000) * 0.1),
  status: 'RESOLVED_REJECTED',
  assigned_to: reiaUserId,
  acknowledged_at: daysAgoIso(45),
  acknowledged_by: 'system',
  resolution_outcome: 'REJECTED',
  resolution_notes: 'Second invoice was amendment; original stands. Supporting docs reviewed.',
  accepted_amount: 0,
  credit_amount: 0,
  lps_on_resolution: 0,
  before_total: sellerInvoice2.total_amount,
  after_total: sellerInvoice2.total_amount,
  sla_ack_due: daysAgoIso(43),
  sla_resolve_due: daysAgoIso(30),
  sla_breached_at: null,
  escalated_at: null,
  created_at: daysAgoIso(45),
  updated_at: daysAgoIso(25),
  resolved_at: daysAgoIso(25),
  resolved_by: 'Rahul (REIA Ops)',
});

// Open disputed amounts on invoices
const openOnInv1 = amt1 + amt5;
db.prepare(`UPDATE invoices SET status = 'DISPUTED', disputed_amount = ? WHERE id = ?`).run(openOnInv1, disputedInvoice.id);
db.prepare(`UPDATE invoices SET status = 'DISPUTED', disputed_amount = ? WHERE id = ?`).run(amt2, buyerInvoice.id);
db.prepare(`UPDATE invoices SET status = 'DISPUTED', disputed_amount = ? WHERE id = ?`)
  .run(Math.max(amt3, 25000), sellerInvoice2.id);

insertComment.run({
  id: newId('DCM'), dispute_id: d2, user_id: reiaUserId, user_name: 'Rahul (REIA Ops)', role: 'REIA_USER',
  body: 'Please share the PSA rate schedule page referenced in your claim.', is_internal: 0, created_at: daysAgoIso(1),
});
insertComment.run({
  id: newId('DCM'), dispute_id: d2, user_id: reiaUserId, user_name: 'Rahul (REIA Ops)', role: 'REIA_USER',
  body: 'Internal: tariff table looks correct — waiting on buyer docs before rejecting.', is_internal: 1, created_at: daysAgoIso(1),
});
insertComment.run({
  id: newId('DCM'), dispute_id: d1, user_id: sellerUserId, user_name: 'Sunrise Solar Pvt Ltd', role: 'SELLER',
  body: 'Attached SLDC screenshot in evidence folder for Apr 2025.', is_internal: 0, created_at: daysAgoIso(3),
});

for (const [did, events] of [
  [d1, [['RAISED', null, 'RAISED'], ['ACKNOWLEDGED', 'RAISED', 'ACKNOWLEDGED'], ['STATUS_CHANGE', 'ACKNOWLEDGED', 'UNDER_REVIEW']]],
  [d2, [['RAISED', null, 'RAISED'], ['ACKNOWLEDGED', 'RAISED', 'ACKNOWLEDGED'], ['STATUS_CHANGE', 'UNDER_REVIEW', 'INFO_REQUESTED']]],
  [d3, [['RAISED', null, 'RAISED'], ['ACKNOWLEDGED', 'RAISED', 'ACKNOWLEDGED'], ['SLA_BREACH', 'UNDER_REVIEW', 'ESCALATED']]],
]) {
  for (const [etype, from, to] of events) {
    insertEvent.run({
      id: newId('DEV'), dispute_id: did, actor_id: reiaUserId, actor_name: 'system',
      event_type: etype, from_status: from, to_status: to, details: null, created_at: daysAgoIso(5),
    });
  }
}

insertEvent.run({
  id: newId('DEV'), dispute_id: d4, actor_id: reiaUserId, actor_name: 'Rahul (REIA Ops)',
  event_type: 'RESOLVED', from_status: 'UNDER_REVIEW', to_status: 'RESOLVED_ACCEPTED',
  details: JSON.stringify({ outcome: 'PARTIAL_CREDIT' }), created_at: daysAgoIso(12),
});

// ---------------- Payments ----------------
const insertPayment = db.prepare(`
  INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference, deduction)
  VALUES (@id, @invoice_id, @amount, @payment_date, @mode, @reference, @deduction)
`);
for (const inv of invoices.filter((i) => i.status === 'PAID')) {
  insertPayment.run({
    id: newId('PAY'),
    invoice_id: inv.id,
    amount: inv.total_amount,
    payment_date: `${inv.billing_period}-27`,
    mode: 'NEFT',
    reference: `REF-${Math.floor(Math.random() * 900000 + 100000)}`,
    deduction: 0,
  });
}

// ---------------- Payment Security (full module) ----------------
const insertPS = db.prepare(`
  INSERT INTO payment_security (
    id, instrument_no, contract_id, entity_id, mechanism_type, bg_subtype, is_revolving,
    limit_amount, utilized_amount, available_amount, required_amount, waterfall_priority,
    issuing_bank, beneficiary, bank_confirmation_ref, verified_at, verified_by,
    validity_start, validity_end, renewal_status, invocation_status, status, remarks
  ) VALUES (
    @id, @instrument_no, @contract_id, @entity_id, @mechanism_type, @bg_subtype, @is_revolving,
    @limit_amount, @utilized_amount, @available_amount, @required_amount, @waterfall_priority,
    @issuing_bank, @beneficiary, @bank_confirmation_ref, @verified_at, @verified_by,
    @validity_start, @validity_end, @renewal_status, @invocation_status, @status, @remarks
  )
`);

const seedUser = { id: userIds['reia@sjvn.in'], name: 'Rahul (REIA Ops)' };
const psas = contracts.filter((c) => c.contract_type === 'PSA');
const ppas = contracts.filter((c) => c.contract_type === 'PPA');

for (const c of contracts) {
  syncRequirementsFromContract(c.id);
}

// PPA: EMD + PBG instruments (from requirements)
for (const c of ppas) {
  createInstrumentsFromRequirements(c.id, seedUser);
  const instruments = db.prepare(`SELECT * FROM payment_security WHERE contract_id = ?`).all(c.id);
  for (const ps of instruments) {
    db.prepare(`
      UPDATE payment_security SET issuing_bank = ?, bank_confirmation_ref = ?, verified_at = ?, verified_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      ps.bg_subtype === 'EMD' ? 'HDFC Bank' : 'ICICI Bank',
      `BKCONF/${ps.bg_subtype || 'BG'}/${Math.floor(1000 + Math.random() * 9000)}`,
      daysAgoIso(20),
      'Rahul (REIA Ops)',
      ps.id
    );
  }
}

// PSA instruments — three demo profiles
const psaHealthy = psas[0];
const psaShortfall = psas[1];
const psaNearExpiry = psas[2];

function insertInstrument(row) {
  const limit = row.limit_amount;
  const utilized = row.utilized_amount || 0;
  insertPS.run({
    renewal_status: 'NONE',
    invocation_status: 'NONE',
    bank_confirmation_ref: null,
    verified_at: null,
    verified_by: null,
    bg_subtype: null,
    is_revolving: 0,
    ...row,
    available_amount: Math.max(0, limit - utilized),
  });
  recordSecurityEvent({
    instrumentId: row.id,
    contractId: row.contract_id,
    user: seedUser,
    eventType: 'CREATE',
    details: { seeded: true },
  });
}

if (psaHealthy) {
  const avg = trailingMonthlyBilledAvg(psaHealthy.id) || Math.round(psaHealthy.capacity_mw * 24 * 30 * 0.25 * psaHealthy.tariff_per_unit);
  const corpusAmt = Math.round(avg * 0.15);
  const lcLimit = Math.round(avg * 2.5);
  const corpusId = newId('PSC');
  const lcId = newId('PSC');
  insertInstrument({
    id: corpusId,
    instrument_no: genInstrumentNo('CORPUS'),
    contract_id: psaHealthy.id,
    entity_id: psaHealthy.buyer_id,
    mechanism_type: 'CORPUS_FUND',
    is_revolving: 0,
    limit_amount: corpusAmt,
    utilized_amount: 0,
    required_amount: corpusAmt,
    waterfall_priority: WATERFALL_DEFAULTS.CORPUS_FUND,
    issuing_bank: 'SJVN Payment Security Fund',
    beneficiary: 'SJVN Limited',
    bank_confirmation_ref: 'CORPUS/SEED/001',
    verified_at: daysAgoIso(60),
    verified_by: 'Rahul (REIA Ops)',
    validity_start: '2025-01-01',
    validity_end: '2027-12-31',
    status: 'ACTIVE',
    remarks: 'Corpus + LC waterfall demo (healthy coverage)',
  });
  insertInstrument({
    id: lcId,
    instrument_no: genInstrumentNo('LC'),
    contract_id: psaHealthy.id,
    entity_id: psaHealthy.buyer_id,
    mechanism_type: 'LC',
    is_revolving: 1,
    limit_amount: lcLimit,
    utilized_amount: Math.round(lcLimit * 0.12),
    required_amount: avg,
    waterfall_priority: WATERFALL_DEFAULTS.LC,
    issuing_bank: 'State Bank of India',
    beneficiary: 'SJVN Limited',
    bank_confirmation_ref: 'SBI/LC/CONF/7741',
    verified_at: daysAgoIso(45),
    verified_by: 'Rahul (REIA Ops)',
    validity_start: '2025-04-01',
    validity_end: '2027-03-31',
    status: 'PARTIALLY_UTILIZED',
    remarks: 'Revolving LC — healthy cover',
  });
  db.prepare(`UPDATE payment_security SET available_amount = limit_amount - utilized_amount WHERE id IN (?, ?)`).run(corpusId, lcId);
}

if (psaShortfall) {
  const avg = trailingMonthlyBilledAvg(psaShortfall.id) || Math.round(psaShortfall.capacity_mw * 24 * 30 * 0.25 * psaShortfall.tariff_per_unit);
  const lcLimit = Math.round(avg * 0.4);
  const id = newId('PSC');
  insertInstrument({
    id,
    instrument_no: genInstrumentNo('LC'),
    contract_id: psaShortfall.id,
    entity_id: psaShortfall.buyer_id,
    mechanism_type: 'LC',
    is_revolving: 1,
    limit_amount: lcLimit,
    utilized_amount: Math.round(lcLimit * 0.85),
    required_amount: avg,
    waterfall_priority: WATERFALL_DEFAULTS.LC,
    issuing_bank: 'Punjab National Bank',
    beneficiary: 'SJVN Limited',
    bank_confirmation_ref: 'PNB/LC/CONF/2201',
    verified_at: daysAgoIso(30),
    verified_by: 'Rahul (REIA Ops)',
    validity_start: '2025-06-01',
    validity_end: '2026-12-31',
    status: 'PARTIALLY_UTILIZED',
    remarks: 'Shortfall demo — coverage < 1.0',
  });
  db.prepare(`UPDATE payment_security SET available_amount = limit_amount - utilized_amount WHERE id = ?`).run(id);
  const ovId = newId('SOV');
  db.prepare(`
    INSERT INTO security_adequacy_overrides (id, contract_id, reason, approved_by, valid_until)
    VALUES (?, ?, ?, ?, ?)
  `).run(ovId, psaShortfall.id, 'Temporary trading allowance pending LC replenishment (seed)', 'Divyankur (Management)', daysFromIso(30).slice(0, 10));
  recordSecurityEvent({
    contractId: psaShortfall.id,
    user: seedUser,
    eventType: 'ADEQUACY_OVERRIDE',
    details: { override_id: ovId },
  });
}

if (psaNearExpiry) {
  const avg = trailingMonthlyBilledAvg(psaNearExpiry.id) || Math.round(psaNearExpiry.capacity_mw * 24 * 30 * 0.25 * psaNearExpiry.tariff_per_unit);
  const lcLimit = Math.round(avg * 2.2);
  const id = newId('PSC');
  insertInstrument({
    id,
    instrument_no: genInstrumentNo('LC'),
    contract_id: psaNearExpiry.id,
    entity_id: psaNearExpiry.buyer_id,
    mechanism_type: 'LC',
    is_revolving: 1,
    limit_amount: lcLimit,
    utilized_amount: 0,
    required_amount: avg,
    waterfall_priority: WATERFALL_DEFAULTS.LC,
    issuing_bank: 'Bank of Baroda',
    beneficiary: 'SJVN Limited',
    bank_confirmation_ref: 'BOB/LC/CONF/9910',
    verified_at: daysAgoIso(90),
    verified_by: 'Rahul (REIA Ops)',
    validity_start: '2025-07-01',
    validity_end: daysFromIso(15).slice(0, 10),
    status: 'ACTIVE',
    remarks: 'Near-expiry — 15-day cascade demo',
  });
  db.prepare(`UPDATE payment_security SET available_amount = limit_amount - utilized_amount WHERE id = ?`).run(id);
  for (const days of [60, 30, 15]) {
    db.prepare(`
      INSERT INTO security_alerts (id, payment_security_id, contract_id, alert_type, days_before, sent_to, message, created_at)
      VALUES (?, ?, ?, 'EXPIRY', ?, 'BUYER,REIA_USER', ?, ?)
    `).run(
      newId('SAL'),
      id,
      psaNearExpiry.id,
      days,
      `Payment security ${id} expires in ${days} days`,
      daysAgoIso(60 - days)
    );
  }
}

// Invocations: one in-progress (NOTICE), one completed (FUNDS_RECEIVED)
if (psaHealthy) {
  const overdueInv = invoices.find((i) => i.contract_id === psaHealthy.id && i.status === 'UNDER_APPROVAL');
  const invAmt = Math.round((overdueInv?.total_amount || 50000) * 0.25);
  const instruments = db.prepare(`
    SELECT * FROM payment_security WHERE contract_id = ? ORDER BY waterfall_priority ASC
  `).all(psaHealthy.id);
  const first = instruments[0];
  if (first) {
    const invId = newId('SIV');
    db.prepare(`
      INSERT INTO security_invocations (
        id, invocation_no, contract_id, payment_security_id, amount, invoice_ids, status,
        demand_letter_json, waterfall_used, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'NOTICE_ISSUED', ?, ?, ?, ?, ?, ?)
    `).run(
      invId,
      genInvocationNo(),
      psaHealthy.id,
      first.id,
      invAmt,
      JSON.stringify(overdueInv ? [overdueInv.id] : []),
      JSON.stringify({
        to: 'Buyer DISCOM',
        subject: `Demand under payment security — ${psaHealthy.contract_no}`,
        amount: invAmt,
        invoice_ids: overdueInv ? [overdueInv.id] : [],
        waterfall: instruments.map((i) => i.instrument_no),
      }),
      JSON.stringify([{ id: first.id, amount: invAmt }]),
      'Partial waterfall draw — notice issued (seed)',
      'Rahul (REIA Ops)',
      daysAgoIso(5),
      daysAgoIso(5)
    );
    db.prepare(`UPDATE payment_security SET utilized_amount = utilized_amount + ?, available_amount = available_amount - ?, invocation_status = 'NOTICE_ISSUED', status = 'PARTIALLY_UTILIZED' WHERE id = ?`)
      .run(invAmt, invAmt, first.id);
  }
}

if (psaNearExpiry) {
  const invId = newId('SIV');
  const ps = db.prepare(`SELECT * FROM payment_security WHERE contract_id = ? AND mechanism_type = 'LC'`).get(psaNearExpiry.id);
  const amt = 250000;
  db.prepare(`
    INSERT INTO security_invocations (
      id, invocation_no, contract_id, payment_security_id, amount, invoice_ids, status,
      demand_letter_json, waterfall_used, notes, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '[]', 'FUNDS_RECEIVED', ?, ?, ?, ?, ?, ?)
  `).run(
    invId,
    genInvocationNo(),
    psaNearExpiry.id,
    ps?.id || null,
    amt,
    JSON.stringify({ subject: 'Completed invocation (seed)', amount: amt }),
    JSON.stringify(ps ? [{ id: ps.id, amount: amt }] : []),
    'Historical invocation — funds received',
    'Rahul (REIA Ops)',
    daysAgoIso(120),
    daysAgoIso(100)
  );
}

// Release pending on a PPA EMD (phase expansion — no open dues expected on unused EMD framing)
const releasePpa = ppas.find((c) => c.contract_no.includes('001-A')) || ppas[1];
if (releasePpa) {
  const emd = db.prepare(`
    SELECT * FROM payment_security WHERE contract_id = ? AND bg_subtype = 'EMD' LIMIT 1
  `).get(releasePpa.id);
  if (emd) {
    const relId = newId('SRL');
    db.prepare(`
      INSERT INTO security_releases (
        id, payment_security_id, contract_id, status, checklist_no_dues, checklist_no_disputes, reason, requested_by
      ) VALUES (?, ?, ?, 'PENDING', 1, 1, ?, ?)
    `).run(relId, emd.id, releasePpa.id, 'Contract expansion EMD release after COD (seed)', 'Sunrise Solar Pvt Ltd');
    db.prepare(`UPDATE payment_security SET status = 'RELEASE_PENDING' WHERE id = ?`).run(emd.id);
    recordSecurityEvent({
      instrumentId: emd.id,
      contractId: releasePpa.id,
      user: seedUser,
      eventType: 'RELEASE_REQUESTED',
      details: { release_id: relId },
    });
  }
}

console.log('Payment security instruments seeded:', db.prepare('SELECT COUNT(*) c FROM payment_security').get().c);

// ---------------- Reconciliation (seeded after trading data — see end of file) ----------------

// ---------------- Trading Clients ----------------
const insertClient = db.prepare(`
  INSERT INTO trading_clients (id, name, client_type, noc_valid_till, ppa_ref, pre_payment_balance, margin_available, status)
  VALUES (@id, @name, @client_type, @noc_valid_till, @ppa_ref, @pre_payment_balance, @margin_available, @status)
`);
const tradingClients = [
  { id: newId('TCL'), name: 'ABC Trading Client', client_type: 'C&I', noc_valid_till: '2026-03-31', ppa_ref: 'NA', pre_payment_balance: 5000000, margin_available: 2000000, status: 'ACTIVE' },
  { id: newId('TCL'), name: 'Green Power Generators', client_type: 'GENERATOR', noc_valid_till: '2026-06-30', ppa_ref: 'PPA-GPG-001', pre_payment_balance: 8000000, margin_available: 3500000, status: 'ACTIVE' },
  { id: newId('TCL'), name: 'Metro DISCOM Trading Desk', client_type: 'DISCOM', noc_valid_till: '2025-12-31', ppa_ref: 'NA', pre_payment_balance: 3000000, margin_available: 1200000, status: 'ACTIVE' },
];
for (const c of tradingClients) insertClient.run(c);

// ---------------- Bids ----------------
const insertBid = db.prepare(`
  INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, time_block, quantum_mw,
    price_per_unit, carry_forward_from, premium_discount, cleared_quantum_mw, cleared_price, status)
  VALUES (@id, @client_id, @exchange, @product, @bid_date, @delivery_date, @time_block, @quantum_mw,
    @price_per_unit, @carry_forward_from, @premium_discount, @cleared_quantum_mw, @cleared_price, @status)
`);
const exchanges = ['IEX', 'PXIL', 'HPX'];
const products = ['DAM', 'RTM', 'GDAM', 'TAM'];
let bidDay = 1;
for (const client of tradingClients) {
  for (let i = 0; i < 4; i++) {
    const quantum = 10 + Math.round(Math.random() * 40);
    const price = 3 + Math.random() * 5;
    const cleared = Math.random() > 0.2;
    insertBid.run({
      id: newId('BID'),
      client_id: client.id,
      exchange: exchanges[i % exchanges.length],
      product: products[i % products.length],
      bid_date: `2025-07-${String(bidDay).padStart(2, '0')}`,
      delivery_date: `2025-07-${String(bidDay + 1).padStart(2, '0')}`,
      time_block: `Block-${(i % 96) + 1}`,
      quantum_mw: quantum,
      price_per_unit: Number(price.toFixed(2)),
      carry_forward_from: i === 2 ? 'GDAM->DAM' : null,
      premium_discount: 0,
      cleared_quantum_mw: cleared ? quantum : Math.round(quantum * 0.6),
      cleared_price: cleared ? Number(price.toFixed(2)) : Number((price - 0.3).toFixed(2)),
      status: cleared ? 'CLEARED' : 'PARTIALLY_CLEARED',
    });
    bidDay = (bidDay % 27) + 1;
  }
}

// ---------------- Bilateral Transactions ----------------
const insertBilateral = db.prepare(`
  INSERT INTO bilateral_transactions (id, client_id, counterparty, loi_contract_ref, quantum_mw, tariff_per_unit,
    open_access_status, schedule_status, wheeling_charges, transmission_charges, losses_percent, start_date, end_date, status)
  VALUES (@id, @client_id, @counterparty, @loi_contract_ref, @quantum_mw, @tariff_per_unit,
    @open_access_status, @schedule_status, @wheeling_charges, @transmission_charges, @losses_percent, @start_date, @end_date, @status)
`);
insertBilateral.run({
  id: newId('BIL'), client_id: tradingClients[1].id, counterparty: 'Industrial Buyer Co', loi_contract_ref: 'LOI-2025-045',
  quantum_mw: 25, tariff_per_unit: 4.2, open_access_status: 'APPROVED', schedule_status: 'APPROVED',
  wheeling_charges: 0.15, transmission_charges: 0.10, losses_percent: 3.2, start_date: '2025-07-01', end_date: '2025-09-30', status: 'ACTIVE',
});
insertBilateral.run({
  id: newId('BIL'), client_id: tradingClients[2].id, counterparty: 'Textile Cluster Ltd', loi_contract_ref: 'LOI-2025-050',
  quantum_mw: 12, tariff_per_unit: 4.5, open_access_status: 'PENDING', schedule_status: 'DRAFT',
  wheeling_charges: 0.18, transmission_charges: 0.12, losses_percent: 3.5, start_date: '2025-08-01', end_date: '2025-10-31', status: 'ACTIVE',
});

// ---------------- Trading Invoices ----------------
const insertTInvoice = db.prepare(`
  INSERT INTO trading_invoices (id, invoice_no, client_id, invoice_kind, billing_period, quantum_mwh,
    rate_per_unit, trading_margin, gst_applicable, gst_amount, total_amount, status)
  VALUES (@id, @invoice_no, @client_id, @invoice_kind, @billing_period, @quantum_mwh,
    @rate_per_unit, @trading_margin, @gst_applicable, @gst_amount, @total_amount, @status)
`);
let tInvCounter = 5000;
for (const client of tradingClients) {
  const qty = 500 + Math.round(Math.random() * 1000);
  const rate = 4 + Math.random();
  const margin = Math.round(qty * 0.05);
  const base = Math.round(qty * rate) + margin;
  const gst = Math.round(base * 0.18);
  const tinId = newId('TIN');
  insertTInvoice.run({
    id: tinId,
    invoice_no: `TRD/2025/${tInvCounter++}`,
    client_id: client.id,
    invoice_kind: 'COMBINED',
    billing_period: '2025-06',
    quantum_mwh: qty,
    rate_per_unit: Number(rate.toFixed(2)),
    trading_margin: margin,
    gst_applicable: 1,
    gst_amount: gst,
    total_amount: base + gst,
    status: 'PAID',
  });
  db.prepare(`
    INSERT INTO trading_payments (id, trading_invoice_id, amount, payment_date, mode, reference)
    VALUES (?, ?, ?, '2025-06-28', 'NEFT', ?)
  `).run(newId('TPY'), tinId, base + gst, `TREF-${Math.floor(Math.random() * 900000)}`);
}

// ---------------- Market Rates (for analytics/forecast demo) ----------------
const insertRate = db.prepare(`
  INSERT INTO market_rates (id, product, rate_date, mcp_rate, forecast_rate)
  VALUES (@id, @product, @rate_date, @mcp_rate, @forecast_rate)
`);
for (let d = 1; d <= 15; d++) {
  const date = `2025-07-${String(d).padStart(2, '0')}`;
  const mcp = 3 + Math.sin(d / 2) * 1.2 + Math.random() * 0.5;
  insertRate.run({ id: newId('MKT'), product: 'DAM', rate_date: date, mcp_rate: Number(mcp.toFixed(2)), forecast_rate: Number((mcp + (Math.random() - 0.5)).toFixed(2)) });
}

// ---------------- Reconciliation (engine-driven samples) ----------------
const { persistRun } = await import('../routes/reconciliation.js');

// Matched May runs for first few contracts
for (const c of contracts.slice(0, 3)) {
  const r = persistRun({
    scope: 'REIA_CONTRACT', contractId: c.id, periodType: 'MONTHLY', period: '2025-05',
    triggerType: 'SCHEDULED', user: seedUser,
  });
  // Dual ack → CLOSED
  db.prepare(`
    UPDATE reconciliations SET status = 'CLOSED', sjvn_ack_at = datetime('now'), sjvn_ack_by = 'Rahul (REIA Ops)',
      counterparty_ack_at = datetime('now'), counterparty_ack_by = 'Stakeholder', closed_at = datetime('now')
    WHERE id = ?
  `).run(r.id);
}

// April matched (for carry baseline)
persistRun({
  scope: 'REIA_CONTRACT', contractId: contracts[0].id, periodType: 'MONTHLY', period: '2025-04',
  triggerType: 'MANUAL', user: seedUser,
});

// Needs review: SAP mirror mismatch on June
const needsReview = persistRun({
  scope: 'REIA_CONTRACT', contractId: contracts[0].id, periodType: 'MONTHLY', period: '2025-06',
  triggerType: 'MANUAL', user: seedUser,
  sapOverride: { sap_amount: 1, sap_factor: 0.85 },
});

// Provisional-based run for another contract period
const prov = persistRun({
  scope: 'REIA_CONTRACT', contractId: contracts[1].id, periodType: 'MONTHLY', period: '2025-06',
  triggerType: 'MANUAL', user: seedUser, forceDataBasis: 'PROVISIONAL',
});
db.prepare(`UPDATE reconciliations SET data_basis = 'PROVISIONAL', status = 'PENDING_SIGN_OFF' WHERE id = ?`).run(prov.id);

// Pending sign-off clean run
const signoff = persistRun({
  scope: 'REIA_CONTRACT', contractId: contracts[5]?.id || contracts[2].id, periodType: 'MONTHLY', period: '2025-05',
  triggerType: 'MANUAL', user: seedUser,
});
db.prepare(`
  UPDATE reconciliations SET status = 'PENDING_SIGN_OFF', sjvn_ack_at = datetime('now'), sjvn_ack_by = 'Rahul (REIA Ops)'
  WHERE id = ?
`).run(signoff.id);

// Trading reconciliation
persistRun({
  scope: 'TRADING_CLIENT', tradingClientId: tradingClients[0].id, periodType: 'MONTHLY', period: '2025-06',
  triggerType: 'MANUAL', user: seedUser,
});

// Pattern: force historical exceptions on ENERGY for pattern flag demo
for (let i = 0; i < 3; i++) {
  const month = `2025-0${1 + i}`;
  const fakeId = newId('RCN');
  db.prepare(`
    INSERT INTO reconciliations (
      id, recon_no, scope, contract_id, period_type, period, data_basis, status, trigger_type,
      items_total, items_auto_matched, items_exception, auto_match_pct, unreconciled_amount,
      energy_match, payment_match, performance_match, created_by, created_at
    ) VALUES (?, ?, 'REIA_CONTRACT', ?, 'MONTHLY', ?, 'FINAL', 'CLOSED', 'MANUAL',
      1, 0, 1, 0, 1000, 0, 1, 1, 'seed', ?)
  `).run(fakeId, `RCN/2025/P${100 + i}`, contracts[0].id, month, `2025-0${1 + i}-28 10:00:00`);
  db.prepare(`
    INSERT INTO recon_items (id, reconciliation_id, item_type, label, metered_value, billed_value, variance, unit, match_status, pattern_flag)
    VALUES (?, ?, 'ENERGY_THREE_WAY', 'Energy mismatch', 100, 145, -45, 'MWh', 'EXCEPTION', 0)
  `).run(newId('RCI'), fakeId);
}

// Re-run June so pattern_flag may trip on ENERGY if still exception from sap and carry
persistRun({
  scope: 'REIA_CONTRACT', contractId: contracts[0].id, periodType: 'MONTHLY', period: '2025-06',
  triggerType: 'MANUAL', user: seedUser,
  sapOverride: { sap_factor: 0.9 },
});

// Reopen request on a closed May recon
const closedMay = db.prepare(`
  SELECT id FROM reconciliations WHERE contract_id = ? AND period = '2025-05' AND status = 'CLOSED' LIMIT 1
`).get(contracts[0].id);
if (closedMay) {
  db.prepare(`
    INSERT INTO recon_reopen_requests (id, reconciliation_id, requested_by, requested_by_name, reason, status)
    VALUES (?, ?, ?, 'Sunrise Solar Pvt Ltd', 'SLDC revised metered data for May 2025', 'PENDING')
  `).run(newId('RRQ'), closedMay.id, userIds['seller@sunrise-solar.in']);
}

console.log('Database seeded successfully.');
console.log('Demo login (all roles use password: password123):');
users.forEach((u) => console.log(`  ${u.role.padEnd(14)} -> ${u.email}`));
console.log(`Reconciliation samples: ${db.prepare('SELECT COUNT(*) c FROM reconciliations').get().c} runs, needs-review=${needsReview.recon_no}`);
