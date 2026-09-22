// The records the browser suite seeds and then looks for. Kept in one place so a
// spec asks for "the hydro PPA" by name instead of repeating its number.
//
// Everything here lives only in the throwaway database under e2e/.data — the
// password is a fixture for that database, not a credential for any real one.

export const ADMIN = {
  id: 'USR-E2E-ADMIN',
  name: 'E2E Admin',
  email: 'e2e.admin@sjvn.test',
  password: 'e2e-Admin#2026',
  role: 'SJVN_ADMIN',
};

// Used only by the login spec, so its wrong-password attempt counts against this
// account's lockout and never against the one every other spec signs in as.
export const LOGIN_USER = {
  id: 'USR-E2E-LOGIN',
  name: 'E2E Reia User',
  email: 'e2e.reia@sjvn.test',
  password: 'e2e-Reia#2026',
  role: 'REIA_USER',
};

export const ENTITIES = {
  hydroSeller: { id: 'SELL-E2E-NJHPS', entity_type: 'SELLER', category: 'RE Generator', name: 'SJVN Nathpa Jhakri HEP' },
  solarSeller: { id: 'SELL-E2E-SOLAR', entity_type: 'SELLER', category: 'RE Generator', name: 'Sunrise Solar Pvt Ltd' },
  buyer: { id: 'BUY-E2E-PSPCL', entity_type: 'BUYER', category: 'DISCOM', name: 'Punjab State Power Corp' },
};

export const CONTRACTS = {
  hydro: {
    id: 'CON-E2E-HYDRO', contract_no: 'PPA/E2E/NJHPS/001', contract_type: 'PPA', project_type: 'Hydro',
    seller_id: ENTITIES.hydroSeller.id, capacity_mw: 1500, commissioned_capacity_mw: 1500,
    tariff_per_unit: 1.25, tariff_type: 'TWO_PART', cod_date: '2004-05-06',
    tenure_start: '2004-05-06', tenure_end: '2039-05-05',
  },
  solar: {
    id: 'CON-E2E-SOLAR', contract_no: 'PPA/E2E/SOLAR/001', contract_type: 'PPA', project_type: 'Solar',
    seller_id: ENTITIES.solarSeller.id, capacity_mw: 150, commissioned_capacity_mw: 150,
    tariff_per_unit: 2.55, tariff_type: 'FLAT', cod_date: '2024-04-01',
    tenure_start: '2024-04-01', tenure_end: '2049-03-31',
  },
  psa: {
    id: 'CON-E2E-PSA', contract_no: 'PSA/E2E/PSPCL/001', contract_type: 'PSA', project_type: 'Solar',
    buyer_id: ENTITIES.buyer.id, capacity_mw: 120, commissioned_capacity_mw: 120,
    tariff_per_unit: 3.45, tariff_type: 'FLAT', cod_date: '2024-04-01',
    tenure_start: '2024-04-01', tenure_end: '2049-03-31',
  },
};

export const INVOICE = {
  id: 'INV-E2E-1001', invoice_no: 'INV-PPA/E2E/1001', contract_id: CONTRACTS.hydro.id,
  invoice_type: 'FINAL', direction: 'SELLER_TO_SJVN', billing_period: '2026-05',
  energy_mwh: 49200, tariff_per_unit: 1.25, energy_charges: 6150000, total_amount: 6150000,
  status: 'SENT', due_date: '2026-06-30',
};

// A platform document that belongs to no dispute. The dispute screen once listed
// every document on the platform as that dispute's evidence; this one must never
// show up there.
export const UNRELATED_DOCUMENT = { id: 'DOC-E2E-CERC', title: 'CERC MMC Report 2026-02', document_type: 'CERC_REPORT' };

// Evidence the setup files against the dispute — one with the kind of long name
// that used to push the table past its box.
export const EVIDENCE = [
  { name: 'JMR May 2026 - NJHPS joint meter reading signed by SLDC and generator (final).pdf', mime: 'application/pdf', body: '%PDF-1.4 e2e joint meter reading' },
  { name: 'sem-readings.csv', mime: 'text/csv', body: 'block,mwh\n1,12.5\n' },
];

export const RECON_PERIOD = '2026-05';

// Where the setup writes the ids it created, for the specs to read.
export const RUNTIME_FILE = 'e2e/.data/runtime.json';
