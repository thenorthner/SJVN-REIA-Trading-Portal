import bcrypt from 'bcryptjs';
import db from './index.js';
import { newId } from '../util.js';

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
  INSERT INTO entities (id, entity_type, category, name, capacity_mw, technology, contracted_capacity_mw,
    psa_tariff, supply_criteria, organization_details, regulatory_approvals, bank_details, contact_details, status)
  VALUES (@id, @entity_type, @category, @name, @capacity_mw, @technology, @contracted_capacity_mw,
    @psa_tariff, @supply_criteria, @organization_details, @regulatory_approvals, @bank_details, @contact_details, @status)
`);

const sellers = [
  { id: newId('SEL'), entity_type: 'SELLER', category: 'RE Generator', name: 'Sunrise Solar Pvt Ltd', capacity_mw: 150, technology: 'Solar', contracted_capacity_mw: 150, psa_tariff: null, supply_criteria: null, organization_details: 'CIN U40106DL2015PTC123456', regulatory_approvals: 'CEA, MNRE registered', bank_details: 'HDFC Bank - A/C 001122334455', contact_details: 'ops@sunrise-solar.in', status: 'APPROVED' },
  { id: newId('SEL'), entity_type: 'SELLER', category: 'RE Generator', name: 'Windforce Energy Ltd', capacity_mw: 100, technology: 'Wind', contracted_capacity_mw: 100, psa_tariff: null, supply_criteria: null, organization_details: 'CIN U40200RJ2016PLC654321', regulatory_approvals: 'CEA registered', bank_details: 'SBI - A/C 220033445566', contact_details: 'ops@windforce.in', status: 'APPROVED' },
  { id: newId('SEL'), entity_type: 'SELLER', category: 'RE Generator', name: 'Hybrid Power Generation Co', capacity_mw: 200, technology: 'Hybrid', contracted_capacity_mw: 200, psa_tariff: null, supply_criteria: null, organization_details: 'CIN U40109GJ2018PLC998877', regulatory_approvals: 'CEA, MNRE registered', bank_details: 'ICICI Bank - A/C 330044556677', contact_details: 'ops@hybridpower.in', status: 'APPROVED' },
  { id: newId('SEL'), entity_type: 'SELLER', category: 'RE Generator', name: 'FDRE Renewables Ltd', capacity_mw: 300, technology: 'FDRE', contracted_capacity_mw: 300, psa_tariff: null, supply_criteria: null, organization_details: 'CIN U40300MH2019PLC112233', regulatory_approvals: 'Pending CEA approval', bank_details: 'Axis Bank - A/C 440055667788', contact_details: 'ops@fdre-renewables.in', status: 'PENDING' },
];

const buyers = [
  { id: newId('BUY'), entity_type: 'BUYER', category: 'DISCOM', name: 'Punjab State Power Corp', capacity_mw: null, technology: null, contracted_capacity_mw: 120, psa_tariff: 3.45, supply_criteria: 'Round the clock RE supply', organization_details: 'State DISCOM', regulatory_approvals: 'PSERC approved', bank_details: 'PNB - A/C 550066778899', contact_details: 'billing@pspcl.gov.in', status: 'APPROVED' },
  { id: newId('BUY'), entity_type: 'BUYER', category: 'DISCOM', name: 'Uttar Pradesh Power Corp', capacity_mw: null, technology: null, contracted_capacity_mw: 200, psa_tariff: 3.60, supply_criteria: 'Peak power supply', organization_details: 'State DISCOM', regulatory_approvals: 'UPERC approved', bank_details: 'BOB - A/C 660077889900', contact_details: 'billing@uppcl.gov.in', status: 'APPROVED' },
  { id: newId('BUY'), entity_type: 'BUYER', category: 'DISCOM', name: 'Bihar State Power Holding', capacity_mw: null, technology: null, contracted_capacity_mw: 180, psa_tariff: 3.30, supply_criteria: 'FDRE supply', organization_details: 'State DISCOM', regulatory_approvals: 'BERC approved', bank_details: 'Canara Bank - A/C 770088990011', contact_details: 'billing@bihar-power.gov.in', status: 'APPROVED' },
];

for (const e of [...sellers, ...buyers]) insertEntity.run(e);

// Link external users to their entities for data isolation
db.prepare('UPDATE users SET linked_entity_id = ? WHERE email = ?').run(sellers[0].id, 'seller@sunrise-solar.in');
db.prepare('UPDATE users SET linked_entity_id = ? WHERE email = ?').run(buyers[0].id, 'buyer@discom.gov.in');

// ---------------- Contracts ----------------
const insertContract = db.prepare(`
  INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw,
    tariff_per_unit, tenure_start, tenure_end, billing_cycle, payment_terms, emd_amount, pbg_amount, pbg_type, pbg_expiry, status)
  VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw,
    @tariff_per_unit, @tenure_start, @tenure_end, @billing_cycle, @payment_terms, @emd_amount, @pbg_amount, @pbg_type, @pbg_expiry, @status)
`);

const contracts = [
  { id: newId('CON'), contract_no: 'PPA/SJVN/2024/001', contract_type: 'PPA', seller_id: sellers[0].id, buyer_id: null, project_type: 'Solar', capacity_mw: 150, tariff_per_unit: 2.55, tenure_start: '2024-04-01', tenure_end: '2049-03-31', billing_cycle: 'MONTHLY', payment_terms: 'Net 30 days', emd_amount: 15000000, pbg_amount: 22500000, pbg_type: 'BG', pbg_expiry: '2026-03-31', status: 'ACTIVE' },
  { id: newId('CON'), contract_no: 'PPA/SJVN/2024/002', contract_type: 'PPA', seller_id: sellers[1].id, buyer_id: null, project_type: 'Wind', capacity_mw: 100, tariff_per_unit: 2.85, tenure_start: '2024-06-01', tenure_end: '2049-05-31', billing_cycle: 'MONTHLY', payment_terms: 'Net 30 days', emd_amount: 10000000, pbg_amount: 15000000, pbg_type: 'BG', pbg_expiry: '2026-05-31', status: 'ACTIVE' },
  { id: newId('CON'), contract_no: 'PPA/SJVN/2025/003', contract_type: 'PPA', seller_id: sellers[2].id, buyer_id: null, project_type: 'Hybrid', capacity_mw: 200, tariff_per_unit: 3.10, tenure_start: '2025-01-01', tenure_end: '2050-12-31', billing_cycle: 'MONTHLY', payment_terms: 'Net 45 days', emd_amount: 20000000, pbg_amount: 30000000, pbg_type: 'ISB', pbg_expiry: '2027-01-01', status: 'ACTIVE' },
  { id: newId('CON'), contract_no: 'PSA/SJVN/2024/101', contract_type: 'PSA', seller_id: null, buyer_id: buyers[0].id, project_type: 'Solar', capacity_mw: 120, tariff_per_unit: 3.45, tenure_start: '2024-04-01', tenure_end: '2049-03-31', billing_cycle: 'MONTHLY', payment_terms: 'Net 45 days', emd_amount: null, pbg_amount: null, pbg_type: null, pbg_expiry: null, status: 'ACTIVE' },
  { id: newId('CON'), contract_no: 'PSA/SJVN/2024/102', contract_type: 'PSA', seller_id: null, buyer_id: buyers[1].id, project_type: 'Wind', capacity_mw: 100, tariff_per_unit: 3.60, tenure_start: '2024-06-01', tenure_end: '2049-05-31', billing_cycle: 'MONTHLY', payment_terms: 'Net 45 days', emd_amount: null, pbg_amount: null, pbg_type: null, pbg_expiry: null, status: 'ACTIVE' },
  { id: newId('CON'), contract_no: 'PSA/SJVN/2025/103', contract_type: 'PSA', seller_id: null, buyer_id: buyers[2].id, project_type: 'Hybrid', capacity_mw: 180, tariff_per_unit: 3.30, tenure_start: '2025-01-01', tenure_end: '2050-12-31', billing_cycle: 'MONTHLY', payment_terms: 'Net 45 days', emd_amount: null, pbg_amount: null, pbg_type: null, pbg_expiry: null, status: 'ACTIVE' },
];

for (const c of contracts) insertContract.run(c);

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

// A disputed invoice for demo
const disputedInvoice = invoices[0];
db.prepare(`UPDATE invoices SET status = 'DISPUTED', disputed_amount = ? WHERE id = ?`)
  .run(Math.round(disputedInvoice.total_amount * 0.1), disputedInvoice.id);

const insertDispute = db.prepare(`
  INSERT INTO disputes (id, invoice_id, raised_by, issue_description, disputed_amount, status)
  VALUES (@id, @invoice_id, @raised_by, @issue_description, @disputed_amount, @status)
`);
insertDispute.run({
  id: newId('DIS'),
  invoice_id: disputedInvoice.id,
  raised_by: 'BUYER',
  issue_description: 'Energy quantum billed does not match SLDC data for the period.',
  disputed_amount: Math.round(disputedInvoice.total_amount * 0.1),
  status: 'UNDER_REVIEW',
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

// ---------------- Payment Security ----------------
const insertPS = db.prepare(`
  INSERT INTO payment_security (id, contract_id, mechanism_type, amount, issuing_bank, beneficiary,
    validity_start, validity_end, utilized_amount, status)
  VALUES (@id, @contract_id, @mechanism_type, @amount, @issuing_bank, @beneficiary,
    @validity_start, @validity_end, @utilized_amount, @status)
`);
for (const c of contracts.filter((c) => c.contract_type === 'PSA')) {
  insertPS.run({
    id: newId('PSC'),
    contract_id: c.id,
    mechanism_type: 'LC',
    amount: Math.round(c.capacity_mw * 24 * 30 * 0.25 * c.tariff_per_unit * 1.1),
    issuing_bank: 'State Bank of India',
    beneficiary: 'SJVN Limited',
    validity_start: '2025-01-01',
    validity_end: '2025-12-31',
    utilized_amount: 0,
    status: 'ACTIVE',
  });
}

// ---------------- Reconciliation ----------------
const insertRecon = db.prepare(`
  INSERT INTO reconciliations (id, contract_id, period_type, period, energy_match, payment_match, performance_match, discrepancy_notes, status)
  VALUES (@id, @contract_id, @period_type, @period, @energy_match, @payment_match, @performance_match, @discrepancy_notes, @status)
`);
for (const c of contracts) {
  insertRecon.run({
    id: newId('REC'),
    contract_id: c.id,
    period_type: 'MONTHLY',
    period: '2025-05',
    energy_match: 1,
    payment_match: 1,
    performance_match: 1,
    discrepancy_notes: null,
    status: 'RESOLVED',
  });
}
insertRecon.run({
  id: newId('REC'),
  contract_id: contracts[0].id,
  period_type: 'MONTHLY',
  period: '2025-06',
  energy_match: 0,
  payment_match: 1,
  performance_match: 1,
  discrepancy_notes: 'Energy mismatch of 45 MWh vs SLDC data - under review',
  status: 'OPEN',
});

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
  insertTInvoice.run({
    id: newId('TIN'),
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

console.log('Database seeded successfully.');
console.log('Demo login (all roles use password: password123):');
users.forEach((u) => console.log(`  ${u.role.padEnd(14)} -> ${u.email}`));
