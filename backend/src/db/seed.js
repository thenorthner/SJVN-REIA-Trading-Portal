/**
 * Minimal clean seed — enough to walk REIA flows without clutter.
 * Delete platform.db and run: npm run seed
 */
import bcrypt from 'bcryptjs';
import db from './index.js';
import { newId, buildBillingFamilyRef } from '../util.js';
import {
  syncRequirementsFromContract,
  createInstrumentsFromRequirements,
} from '../paymentSecurityEngine.js';
import { ensureMasterDefaults } from '../mastersService.js';

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

const insertEntity = db.prepare(`
  INSERT INTO entities (id, parent_entity_id, entity_type, category, name, pan_no, gst_no, cin, credit_rating, is_blacklisted,
    capacity_mw, technology, contracted_capacity_mw, psa_tariff, supply_criteria, organization_details, regulatory_approvals,
    bank_name, account_no, ifsc_code, branch_address, is_penny_drop_verified, status, address, corporate_email, corporate_phone)
  VALUES (@id, @parent_entity_id, @entity_type, @category, @name, @pan_no, @gst_no, @cin, @credit_rating, @is_blacklisted,
    @capacity_mw, @technology, @contracted_capacity_mw, @psa_tariff, @supply_criteria, @organization_details, @regulatory_approvals,
    @bank_name, @account_no, @ifsc_code, @branch_address, @is_penny_drop_verified, @status, @address, @corporate_email, @corporate_phone)
`);

const seller = {
  id: newId('SEL'), parent_entity_id: null, entity_type: 'SELLER', category: 'RE Generator',
  name: 'Sunrise Solar Pvt Ltd', pan_no: 'ABCDE1234F', gst_no: '08ABCDE1234F1Z5', cin: 'U40106RJ2016PTC012345',
  credit_rating: 'AA', is_blacklisted: 0, capacity_mw: 150, technology: 'Solar', contracted_capacity_mw: 150,
  psa_tariff: null, supply_criteria: null, organization_details: 'Demo solar SPV', regulatory_approvals: 'CEA registered',
  bank_name: 'HDFC Bank', account_no: '001122334455', ifsc_code: 'HDFC0001234', branch_address: 'Jaipur',
  is_penny_drop_verified: 1, status: 'APPROVED', address: 'Jaipur, Rajasthan',
  corporate_email: 'ops@sunrise-solar.in', corporate_phone: '9876543210',
};

const buyer = {
  id: newId('BUY'), parent_entity_id: null, entity_type: 'BUYER', category: 'DISCOM',
  name: 'Punjab State Power Corp', pan_no: 'PSPBB3456I', gst_no: '03PSPBB3456I1Z5', cin: 'U40109PB2010SGC033813',
  credit_rating: 'A', is_blacklisted: 0, capacity_mw: null, technology: null, contracted_capacity_mw: 120,
  psa_tariff: 3.45, supply_criteria: 'Round the clock RE supply', organization_details: 'State DISCOM',
  regulatory_approvals: 'PSERC approved', bank_name: 'PNB', account_no: '550066778899', ifsc_code: 'PUNB0123456',
  branch_address: 'Chandigarh', is_penny_drop_verified: 1, status: 'APPROVED', address: 'Chandigarh',
  corporate_email: 'billing@pspcl.in', corporate_phone: '9811112233',
};

insertEntity.run(seller);
insertEntity.run(buyer);

db.prepare(`
  INSERT INTO entity_contacts (id, entity_id, contact_type, name, email, phone, is_primary)
  VALUES (?, ?, 'COMMERCIAL', ?, ?, ?, 1)
`).run(newId('CNT'), seller.id, 'Amit Sharma', 'billing@sunrise-solar.in', '9876543210');
db.prepare(`
  INSERT INTO entity_contacts (id, entity_id, contact_type, name, email, phone, is_primary)
  VALUES (?, ?, 'COMMERCIAL', ?, ?, ?, 1)
`).run(newId('CNT'), buyer.id, 'Priya Kaur', 'billing@pspcl.in', '9811112233');

db.prepare('UPDATE users SET linked_entity_id = ? WHERE email = ?').run(seller.id, 'seller@sunrise-solar.in');
db.prepare('UPDATE users SET linked_entity_id = ? WHERE email = ?').run(buyer.id, 'buyer@discom.gov.in');

const ppa = {
  id: newId('CON'),
  contract_no: 'PPA/SJVN/2024/001',
  contract_type: 'PPA',
  seller_id: seller.id,
  buyer_id: null,
  project_type: 'Solar',
  capacity_mw: 150,
  commissioned_capacity_mw: 150,
  cod_date: '2024-03-15',
  tariff_type: 'FLAT',
  tariff_per_unit: 2.55,
  tariff_structure_json: null,
  tenure_start: '2024-04-01',
  tenure_end: '2049-03-31',
  billing_cycle: 'MONTHLY',
  payment_terms: 'Net 30 days',
  emd_amount: 15000000,
  pbg_amount: 22500000,
  pbg_type: 'BG',
  pbg_expiry: '2027-03-31',
  termination_reason: null,
  termination_date: null,
  status: 'ACTIVE',
};

const psa = {
  id: newId('CON'),
  contract_no: 'PSA/SJVN/2024/101',
  contract_type: 'PSA',
  seller_id: null,
  buyer_id: buyer.id,
  project_type: 'Solar',
  capacity_mw: 120,
  commissioned_capacity_mw: 120,
  cod_date: '2024-03-15',
  tariff_type: 'FLAT',
  tariff_per_unit: 3.45,
  tariff_structure_json: null,
  tenure_start: '2024-04-01',
  tenure_end: '2049-03-31',
  billing_cycle: 'MONTHLY',
  payment_terms: 'Net 45 days',
  emd_amount: null,
  pbg_amount: null,
  pbg_type: null,
  pbg_expiry: null,
  termination_reason: null,
  termination_date: null,
  status: 'ACTIVE',
};

const insertContract = db.prepare(`
  INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw, commissioned_capacity_mw, cod_date,
    tariff_type, tariff_per_unit, tariff_structure_json, tenure_start, tenure_end, billing_cycle, payment_terms,
    emd_amount, pbg_amount, pbg_type, pbg_expiry, termination_reason, termination_date, status)
  VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw, @commissioned_capacity_mw, @cod_date,
    @tariff_type, @tariff_per_unit, @tariff_structure_json, @tenure_start, @tenure_end, @billing_cycle, @payment_terms,
    @emd_amount, @pbg_amount, @pbg_type, @pbg_expiry, @termination_reason, @termination_date, @status)
`);
insertContract.run(ppa);
insertContract.run(psa);

db.prepare(`
  INSERT INTO contract_projects (contract_id, project_entity_id, allocated_capacity_mw) VALUES (?, ?, ?)
`).run(ppa.id, seller.id, 150);

db.prepare(`
  INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from)
  VALUES (?, ?, ?, ?, ?)
`).run(newId('ALC'), ppa.id, psa.id, 80, '2024-04-01');

// ── One clear billing story for May 2026 (BFR demo) ──
const period = '2026-05';
const bfrPpa = buildBillingFamilyRef(ppa.contract_no, period, 'SELLER_TO_SJVN');

const engProvId = newId('ENG');
const engFinalId = newId('ENG');
const provMwh = 24000;
const finalMwh = 25200;

db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, availability_percent, status, billing_family_ref, supersedes_energy_id)
  VALUES (?, ?, ?, 'PROVISIONAL', 'REA', ?, 22.2, 98.1, 'LOCKED', ?, NULL)
`).run(engProvId, ppa.id, period, provMwh, bfrPpa);

db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, availability_percent, status, billing_family_ref, supersedes_energy_id)
  VALUES (?, ?, ?, 'FINAL', 'REA', ?, 23.3, 98.5, 'LOCKED', ?, ?)
`).run(engFinalId, ppa.id, period, finalMwh, bfrPpa, engProvId);

// tariff is ₹/kWh; energy in MWh → ×1000 for rupee charges
const provCharges = Math.round(provMwh * 1000 * ppa.tariff_per_unit);
const invProvId = newId('INV');
db.prepare(`
  INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
    tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees,
    transmission_charges, lps, penalty, trading_margin, taxes, other_adjustments, total_amount,
    disputed_amount, due_date, status, billing_family_ref, energy_data_id, created_by)
  VALUES (?, ?, ?, 'PROVISIONAL', 'SELLER_TO_SJVN', ?, ?,
    ?, ?, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, ?,
    0, '2026-06-30', 'PARTIALLY_PAID', ?, ?, ?)
`).run(
  invProvId, 'INV-PPA/2026/1001', ppa.id, period, provMwh,
  ppa.tariff_per_unit, provCharges, provCharges,
  bfrPpa, engProvId, 'Rahul (REIA Ops)'
);

const paidAmt = Math.round(provCharges * 0.6);
db.prepare(`
  INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference, deduction)
  VALUES (?, ?, ?, '2026-06-15', 'NEFT', 'UTR-DEMO-001', 0)
`).run(newId('PAY'), invProvId, paidAmt);

// Light payment security on PPA (requirements + instruments)
try {
  const seedUser = { id: userIds['reia@sjvn.in'], name: 'Rahul (REIA Ops)' };
  syncRequirementsFromContract(ppa.id);
  createInstrumentsFromRequirements(ppa.id, seedUser);
} catch (e) {
  console.warn('Payment security seed skipped:', e.message);
}

// One trading client shell (empty bids — portal not empty on Trading nav)
db.prepare(`
  INSERT INTO trading_clients (id, name, client_type, risk_rating, exposure_limit, status)
  VALUES (?, 'ABC Trading Client', 'TRADER', 'LOW', 50000000, 'ACTIVE')
`).run(newId('TCL'));

// Master data defaults (also applied on every server boot)
try {
  ensureMasterDefaults();
  console.log('Master data seeded:', {
    banks: db.prepare('SELECT COUNT(*) c FROM bank_master').get().c,
    params: db.prepare('SELECT COUNT(*) c FROM system_parameters').get().c,
    doc_types: db.prepare('SELECT COUNT(*) c FROM document_type_master').get().c,
    lookups: db.prepare('SELECT COUNT(*) c FROM lookup_master').get().c,
  });
} catch (e) {
  console.warn('Master defaults seed skipped:', e.message);
}

console.log('── Fresh minimal seed complete ──');
console.log('Logins (password: password123):');
console.log('  reia@sjvn.in / admin@sjvn.in / seller@sunrise-solar.in / buyer@discom.gov.in');
console.log('Demo story: PPA/SJVN/2024/001 · period 2026-05');
console.log('  Provisional energy + invoice (60% paid) + Final energy (same BFR)');
console.log('  Open Invoices → click BFR / Settlement Trail');
console.log('Counts:', {
  entities: db.prepare('SELECT COUNT(*) c FROM entities').get().c,
  contracts: db.prepare('SELECT COUNT(*) c FROM contracts').get().c,
  energy: db.prepare('SELECT COUNT(*) c FROM energy_data').get().c,
  invoices: db.prepare('SELECT COUNT(*) c FROM invoices').get().c,
  payments: db.prepare('SELECT COUNT(*) c FROM payments').get().c,
});
