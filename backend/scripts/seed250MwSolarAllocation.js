import db from '../src/db/index.js';
import crypto from 'crypto';

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

console.log('Seeding 250 MW Solar PPA & 3 Branching Carve-Out PSAs (Punjab, Haryana, Delhi)...');

// 1. PPA: 250 MW Solar with Adani Green Energy Ltd
db.prepare(`
  INSERT OR REPLACE INTO contracts (
    id, contract_no, contract_type, seller_id, project_type,
    capacity_mw, commissioned_capacity_mw, cod_date,
    tariff_type, tariff_per_unit, tenure_start, tenure_end,
    billing_cycle, payment_terms_days, payment_security_type,
    min_cuf_percent, status, remarks
  ) VALUES (
    'CON-SOLAR-250MW', 'PPA/REIA/SOLAR/250MW-001', 'PPA', 'ENT-EX-ADANI', 'Solar',
    250, 250, '2025-04-01',
    'FLAT', 2.82, '2025-04-01', '2050-03-31',
    'MONTHLY', 30, 'LETTER_OF_CREDIT',
    22, 'ACTIVE', '250 MW Mega Solar Project (Khavda / Rajasthan RE Park)'
  )
`).run();

// 2. Carve-Out PSA 1: 100 MW (40%) to Punjab State Power Corp Ltd (PSPCL)
db.prepare(`
  INSERT OR REPLACE INTO contracts (
    id, contract_no, contract_type, buyer_id, project_type,
    capacity_mw, commissioned_capacity_mw, cod_date,
    tariff_type, tariff_per_unit, trading_margin_per_mwh,
    tenure_start, tenure_end, billing_cycle, payment_terms_days,
    payment_security_type, status, remarks
  ) VALUES (
    'CON-PSA-PSPCL-100MW', 'PSA/REIA/PSPCL/100MW-001', 'PSA', 'ENT-EX-PSPCL', 'Solar',
    100, 100, '2025-04-01',
    'FLAT', 2.89, 70,
    '2025-04-01', '2050-03-31', 'MONTHLY', 30,
    'LETTER_OF_CREDIT', 'ACTIVE', '100 MW (40% Share) carved out from 250 MW Solar PPA'
  )
`).run();

// 3. Carve-Out PSA 2: 100 MW (40%) to Haryana Power Purchase Centre (HPPC)
db.prepare(`
  INSERT OR REPLACE INTO contracts (
    id, contract_no, contract_type, buyer_id, project_type,
    capacity_mw, commissioned_capacity_mw, cod_date,
    tariff_type, tariff_per_unit, trading_margin_per_mwh,
    tenure_start, tenure_end, billing_cycle, payment_terms_days,
    payment_security_type, status, remarks
  ) VALUES (
    'CON-PSA-HPPC-100MW', 'PSA/REIA/HPPC/100MW-001', 'PSA', 'ENT-EX-HPPC', 'Solar',
    100, 100, '2025-04-01',
    'FLAT', 2.89, 70,
    '2025-04-01', '2050-03-31', 'MONTHLY', 30,
    'LETTER_OF_CREDIT', 'ACTIVE', '100 MW (40% Share) carved out from 250 MW Solar PPA'
  )
`).run();

// 4. Carve-Out PSA 3: 50 MW (20%) to New Delhi Municipal Council (NDMC)
db.prepare(`
  INSERT OR REPLACE INTO contracts (
    id, contract_no, contract_type, buyer_id, project_type,
    capacity_mw, commissioned_capacity_mw, cod_date,
    tariff_type, tariff_per_unit, trading_margin_per_mwh,
    tenure_start, tenure_end, billing_cycle, payment_terms_days,
    payment_security_type, status, remarks
  ) VALUES (
    'CON-PSA-NDMC-50MW', 'PSA/REIA/NDMC/50MW-001', 'PSA', 'ENT-EX-NDMC', 'Solar',
    50, 50, '2025-04-01',
    'FLAT', 2.89, 70,
    '2025-04-01', '2050-03-31', 'MONTHLY', 30,
    'LETTER_OF_CREDIT', 'ACTIVE', '50 MW (20% Share) carved out from 250 MW Solar PPA'
  )
`).run();

// 5. Clean existing allocations for CON-SOLAR-250MW
db.prepare('DELETE FROM contract_allocations WHERE ppa_id = ?').run('CON-SOLAR-250MW');

// 6. Insert Allocations (40% Punjab, 40% Haryana, 20% Delhi)
db.prepare(`
  INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from, effective_to)
  VALUES ('CAL-PUNJAB-40', 'CON-SOLAR-250MW', 'CON-PSA-PSPCL-100MW', 40, '2025-04-01', NULL)
`).run();

db.prepare(`
  INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from, effective_to)
  VALUES ('CAL-HARYANA-40', 'CON-SOLAR-250MW', 'CON-PSA-HPPC-100MW', 40, '2025-04-01', NULL)
`).run();

db.prepare(`
  INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from, effective_to)
  VALUES ('CAL-DELHI-20', 'CON-SOLAR-250MW', 'CON-PSA-NDMC-50MW', 20, '2025-04-01', NULL)
`).run();

// 7. Seed Energy generation for period 2026-10: 42,500 MWh
db.prepare(`
  INSERT OR REPLACE INTO energy_data (
    id, contract_id, period_month, data_type, source,
    energy_mwh, status, created_at
  ) VALUES (
    'ED-SOLAR-250MW-202610-P', 'CON-SOLAR-250MW', '2026-10', 'PROVISIONAL', 'JMR',
    42500, 'LOCKED', '2026-10-02 10:00:00'
  )
`).run();

// 8. Seed Invoices for 2026-10
// PPA Bill from Seller (Adani Green): 42,500 MWh * 1000 * 2.82 = Rs 11,98,50,000 (11.98 Cr)
db.prepare(`
  INSERT OR REPLACE INTO invoices (
    id, invoice_no, contract_id, direction, billing_period,
    invoice_type, tariff_per_unit, energy_charges, total_amount, energy_mwh, status,
    validation_status, created_at
  ) VALUES (
    'INV-ADANI-202610', 'INV-ADANI/2026/00101', 'CON-SOLAR-250MW', 'SELLER_TO_SJVN', '2026-10',
    'PROVISIONAL', 2.82, 119850000, 119850000, 42500, 'APPROVED',
    'MATCHED', '2026-10-03 14:00:00'
  )
`).run();

// PSA Bill to Punjab (17,000 MWh @ Rs 2.89 = Rs 4,91,30,000)
db.prepare(`
  INSERT OR REPLACE INTO invoices (
    id, invoice_no, contract_id, direction, billing_period,
    invoice_type, tariff_per_unit, energy_charges, total_amount, energy_mwh, status,
    validation_status, created_at
  ) VALUES (
    'INV-PSA-PSPCL-202610', 'INV-PSA/PSPCL/2026/001', 'CON-PSA-PSPCL-100MW', 'SJVN_TO_BUYER', '2026-10',
    'PROVISIONAL', 2.89, 49130000, 49130000, 17000, 'SENT',
    'MATCHED', '2026-10-05 11:00:00'
  )
`).run();

// PSA Bill to Haryana (17,000 MWh @ Rs 2.89 = Rs 4,91,30,000)
db.prepare(`
  INSERT OR REPLACE INTO invoices (
    id, invoice_no, contract_id, direction, billing_period,
    invoice_type, tariff_per_unit, energy_charges, total_amount, energy_mwh, status,
    validation_status, created_at
  ) VALUES (
    'INV-PSA-HPPC-202610', 'INV-PSA/HPPC/2026/001', 'CON-PSA-HPPC-100MW', 'SJVN_TO_BUYER', '2026-10',
    'PROVISIONAL', 2.89, 49130000, 49130000, 17000, 'SENT',
    'MATCHED', '2026-10-05 11:30:00'
  )
`).run();

// PSA Bill to Delhi (8,500 MWh @ Rs 2.89 = Rs 2,45,65,000)
db.prepare(`
  INSERT OR REPLACE INTO invoices (
    id, invoice_no, contract_id, direction, billing_period,
    invoice_type, tariff_per_unit, energy_charges, total_amount, energy_mwh, status,
    validation_status, created_at
  ) VALUES (
    'INV-PSA-NDMC-202610', 'INV-PSA/NDMC/2026/001', 'CON-PSA-NDMC-50MW', 'SJVN_TO_BUYER', '2026-10',
    'PROVISIONAL', 2.89, 24565000, 24565000, 8500, 'SENT',
    'MATCHED', '2026-10-05 12:00:00'
  )
`).run();

console.log('✓ Successfully seeded:');
console.log('  - 1x 250 MW Solar PPA (PPA/REIA/SOLAR/250MW-001) @ Rs 2.82/kWh');
console.log('  - 3x Carve-out PSAs:');
console.log('      • Punjab (PSPCL): 100 MW (40%) @ Rs 2.89/kWh');
console.log('      • Haryana (HPPC): 100 MW (40%) @ Rs 2.89/kWh');
console.log('      • Delhi (NDMC):    50 MW (20%) @ Rs 2.89/kWh');
console.log('  - Total allocated: 100% (250 MW)');
console.log('  - Trading margin: Rs 0.07/kWh (7.00 paise)');
console.log('  - Energy: 42,500 MWh metered & billed across all 3 DISCOMs.');
