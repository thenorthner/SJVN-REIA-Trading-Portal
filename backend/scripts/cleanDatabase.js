import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../src/db/platform.db');
const db = new Database(dbPath);

console.log('--- Cleaning SJVN Platform Database ---');

db.transaction(() => {
  // Canonical entities to keep:
  const canonicalEntityIds = new Set([
    'ENT-EX-NDMC', 'ENT-EX-HPPC', 'ENT-EX-PSPCL', 'ENT-EX-GUVNL',
    'ENT-EX-TEESTA', 'ENT-EX-ADANI', 'ENT-EX-NTPCRE', 'ENT-EX-JAYPEE',
    'SEL-NJHPS', 'SEL-RHPS', 'SEL-6ae584d5', 'BUY-e4c7ccec',
    'BUY-79fce9c4', 'BUY-fe57949d', 'BUY-15974d4b', 'BUY-3fc2e4af', 'BUY-97ec52cf', 'BUY-24d312c8',
    'E-GACL', 'E-PLAIN'
  ]);

  const keepTradingClients = new Set([
    'TCL-EX-NDMC', 'TCL-EX-HPPC', 'TCL-EX-PSPCL', 'TCL-EX-GUVNL',
    'TCL-SEED-GEN1', 'TCL-SEED-GEN2', 'TCL-SEED-GEN3', 'TCL-SEED-GEN4',
    'TCL-9d4381a7', 'TCL-6ada4397', 'TCL-e6872643', 'TCL-ac6d751f',
    'TCL-ec99cc06', 'TCL-dfb97aab', 'TCL-a8075c17', 'TCL-GACL', 'TCL-PLAIN'
  ]);

  function deleteTradingClient(cId) {
    db.prepare('DELETE FROM trading_client_signatories WHERE client_id = ?').run(cId);
    db.prepare('DELETE FROM trading_client_exchanges WHERE client_id = ?').run(cId);
    db.prepare('DELETE FROM client_exchange_portfolios WHERE client_id = ?').run(cId);
    db.prepare('DELETE FROM client_bid_requests WHERE client_id = ?').run(cId);
    db.prepare('DELETE FROM bilateral_buyer_splits WHERE client_id = ?').run(cId);
    db.prepare('DELETE FROM trading_debit_credit_notes WHERE client_id = ?').run(cId);
    db.prepare('DELETE FROM seller_availabilities WHERE seller_id = ?').run(cId);
    db.prepare('DELETE FROM buyer_consents WHERE buyer_id = ?').run(cId);
    db.prepare('DELETE FROM client_ledgers WHERE client_id = ?').run(cId);
    db.prepare('DELETE FROM settlement_statements WHERE client_id = ?').run(cId);
    db.prepare('DELETE FROM trading_invoices WHERE client_id = ?').run(cId);
    db.prepare('DELETE FROM bill_of_supply WHERE client_id = ?').run(cId);
    db.prepare('DELETE FROM trading_clients WHERE id = ?').run(cId);
  }

  function deleteEntity(entityId) {
    const tc = db.prepare('SELECT id FROM trading_clients WHERE entity_id = ?').all(entityId);
    for (const c of tc) {
      deleteTradingClient(c.id);
    }
    const docs = db.prepare('SELECT id FROM documents WHERE entity_id = ?').all(entityId);
    for (const d of docs) {
      db.prepare('DELETE FROM document_versions WHERE document_id = ?').run(d.id);
    }
    db.prepare('DELETE FROM documents WHERE entity_id = ?').run(entityId);
    db.prepare('DELETE FROM document_requests WHERE entity_id = ?').run(entityId);
    db.prepare('DELETE FROM entity_documents WHERE entity_id = ?').run(entityId);
    db.prepare('DELETE FROM entity_regulatory_approvals WHERE entity_id = ?').run(entityId);
    db.prepare('DELETE FROM entity_contacts WHERE entity_id = ?').run(entityId);
    db.prepare('DELETE FROM entity_aliases WHERE entity_id = ?').run(entityId);
    db.prepare('DELETE FROM entity_audit WHERE entity_id = ?').run(entityId);
    db.prepare('DELETE FROM contract_projects WHERE project_entity_id = ?').run(entityId);
    db.prepare('DELETE FROM power_diversions WHERE buyer_id = ?').run(entityId);
    db.prepare('DELETE FROM generator_bills WHERE beneficiary_id = ?').run(entityId);
    db.prepare('DELETE FROM hydro_beneficiary_allocations WHERE beneficiary_id = ?').run(entityId);
    db.prepare('DELETE FROM hydro_bill_lines WHERE beneficiary_id = ?').run(entityId);
    db.prepare('DELETE FROM hydro_ledger_docs WHERE beneficiary_id = ?').run(entityId);
    db.prepare('DELETE FROM hydro_tcs_claims WHERE beneficiary_id = ?').run(entityId);
    db.prepare('DELETE FROM tds_certificates WHERE entity_id = ?').run(entityId);
    db.prepare('DELETE FROM entities WHERE id = ?').run(entityId);
  }

  // 1. Identify Junk Entities
  const allEntities = db.prepare('SELECT id, name FROM entities').all();
  let deletedCount = 0;
  for (const e of allEntities) {
    if (!canonicalEntityIds.has(e.id)) {
      deleteEntity(e.id);
      deletedCount++;
    }
  }
  console.log(`Successfully deleted ${deletedCount} junk entities and child records.`);

  // 2. Clean Junk Trading Clients with no entity or dummy names
  const allClients = db.prepare('SELECT id, name FROM trading_clients').all();
  let deletedClientsCount = 0;
  for (const c of allClients) {
    if (!keepTradingClients.has(c.id)) {
      deleteTradingClient(c.id);
      deletedClientsCount++;
    }
  }
  console.log(`Successfully deleted ${deletedClientsCount} junk/orphaned trading clients.`);

  // 3. Clear Stale / Spammed SLA Breach Notifications
  const delNotif = db.prepare("DELETE FROM notifications WHERE type = 'ONBOARDING_SLA_BREACH'").run();
  console.log(`Cleared ${delNotif.changes} stale onboarding SLA notifications.`);

  // 4. Enrich Canonical Entities with Complete, Professional Test Data
  const updates = [
    {
      id: 'ENT-EX-NDMC',
      pan_no: 'AAALN1234F',
      gst_no: '07AAALN1234F1Z5',
      tan_no: 'DELN01234B',
      cin: null,
      address: 'Palika Kendra, Sansad Marg, New Delhi 110001',
      corporate_email: 'commercial@ndmc.gov.in',
      corporate_phone: '011-23360248',
      corporate_website: 'www.ndmc.gov.in',
      credit_rating: 'AA',
      bank_name: 'State Bank of India',
      account_no: '100234567890',
      ifsc_code: 'SBIN0000691',
      branch_address: 'Parliament Street, New Delhi',
      contracted_capacity_mw: 125,
      psa_tariff: 3.25,
      supply_criteria: 'Round-The-Clock (RTC)',
      is_penny_drop_verified: 1,
      regulatory_approvals: '4/4 mandatory verified'
    },
    {
      id: 'ENT-EX-GUVNL',
      pan_no: 'AABCG1234G',
      gst_no: '24AABCG1234G1Z8',
      tan_no: 'BRDG01234A',
      cin: 'U40109GJ2004SGC045195',
      address: 'Sardar Patel Vidyut Bhavan, Race Course, Vadodara 390007',
      corporate_email: 'powerpurchase@guvnl.com',
      corporate_phone: '0265-2310582',
      corporate_website: 'www.guvnl.com',
      credit_rating: 'AAA',
      bank_name: 'Bank of Baroda',
      account_no: '02650200001234',
      ifsc_code: 'BARB0VADODA',
      branch_address: 'Alkapuri, Vadodara',
      contracted_capacity_mw: 350,
      psa_tariff: 2.95,
      supply_criteria: 'Peak & Solar Hours',
      is_penny_drop_verified: 1,
      regulatory_approvals: '4/4 mandatory verified'
    },
    {
      id: 'ENT-EX-HPPC',
      pan_no: 'AAACH5678H',
      gst_no: '06AAACH5678H1Z2',
      tan_no: 'PNAH05678A',
      cin: null,
      address: 'Shakti Bhawan, Sector 6, Panchkula, Haryana 134109',
      corporate_email: 'cehppc@uhbvn.org.in',
      corporate_phone: '0172-2563104',
      corporate_website: 'www.hpenergy.gov.in',
      credit_rating: 'AA+',
      bank_name: 'Punjab National Bank',
      account_no: '1234002100056789',
      ifsc_code: 'PUNB0123400',
      branch_address: 'Panchkula Sector 6',
      contracted_capacity_mw: 200,
      psa_tariff: 3.10,
      supply_criteria: 'RTC Firm Power',
      is_penny_drop_verified: 1,
      regulatory_approvals: '4/4 mandatory verified'
    },
    {
      id: 'ENT-EX-PSPCL',
      pan_no: 'AABCP9012J',
      gst_no: '03AABCP9012J1Z9',
      tan_no: 'PTLP09012A',
      cin: 'U40109PB2010SGC033813',
      address: 'PSEB Head Office, The Mall, Patiala, Punjab 147001',
      corporate_email: 'billing@pspcl.in',
      corporate_phone: '0175-2212000',
      corporate_website: 'www.pspcl.in',
      credit_rating: 'A+',
      bank_name: 'State Bank of India',
      account_no: '301234567890',
      ifsc_code: 'SBIN0000726',
      branch_address: 'The Mall, Patiala',
      contracted_capacity_mw: 300,
      psa_tariff: 3.05,
      supply_criteria: 'Agricultural Day Hours',
      is_penny_drop_verified: 1,
      regulatory_approvals: '4/4 mandatory verified'
    },
    {
      id: 'ENT-EX-ADANI',
      pan_no: 'AABCA4321A',
      gst_no: '24AABCA4321A1Z1',
      tan_no: 'AHDA04321A',
      cin: 'L40300GJ2015PLC082578',
      address: 'Adani Corporate House, Shantigram, Ahmedabad 382421',
      corporate_email: 'billing.renewables@adani.com',
      corporate_phone: '079-25555555',
      corporate_website: 'www.adanigreenenergy.com',
      credit_rating: 'AAA',
      bank_name: 'HDFC Bank',
      account_no: '50200012345678',
      ifsc_code: 'HDFC0000123',
      branch_address: 'Navrangpura, Ahmedabad',
      technology: 'Solar/Wind Hybrid',
      capacity_mw: 300,
      is_penny_drop_verified: 1,
      regulatory_approvals: '4/4 mandatory verified'
    },
    {
      id: 'ENT-EX-TEESTA',
      pan_no: 'AABCT9876T',
      gst_no: '11AABCT9876T1Z4',
      tan_no: 'DELT09876A',
      cin: 'U40101SK2005PLC007304',
      address: 'Vijaya Building, Barakhamba Road, New Delhi 110001',
      corporate_email: 'commercial@teestaurja.in',
      corporate_phone: '011-43576000',
      corporate_website: 'www.teestaurja.in',
      credit_rating: 'A',
      bank_name: 'ICICI Bank',
      account_no: '000705012345',
      ifsc_code: 'ICIC0000007',
      branch_address: 'Connaught Place, New Delhi',
      technology: 'Hydro',
      capacity_mw: 1200,
      is_penny_drop_verified: 1,
      regulatory_approvals: '4/4 mandatory verified'
    },
    {
      id: 'ENT-EX-NTPCRE',
      pan_no: 'AABCN5432N',
      gst_no: '07AABCN5432N1Z6',
      tan_no: 'DELN05432A',
      cin: 'U40107DL2020GOI371078',
      address: 'NTPC Bhawan, SCOPE Complex, Lodhi Road, New Delhi 110003',
      corporate_email: 're.commercial@ntpc.co.in',
      corporate_phone: '011-24360100',
      corporate_website: 'www.ntpc.co.in',
      credit_rating: 'AAA',
      bank_name: 'State Bank of India',
      account_no: '312345678901',
      ifsc_code: 'SBIN0001187',
      branch_address: 'CAG Branch, New Delhi',
      technology: 'Solar',
      capacity_mw: 250,
      is_penny_drop_verified: 1,
      regulatory_approvals: '4/4 mandatory verified'
    },
    {
      id: 'ENT-EX-JAYPEE',
      pan_no: 'AABCJ8765J',
      gst_no: '02AABCJ8765J1Z3',
      tan_no: 'NOIJ08765A',
      cin: 'L14100HP1995PLC015841',
      address: 'Sector 128, Noida, Uttar Pradesh 201304',
      corporate_email: 'karcham.hydro@jalindia.co.in',
      corporate_phone: '0120-4609000',
      corporate_website: 'www.jalindia.com',
      credit_rating: 'BBB+',
      bank_name: 'State Bank of India',
      account_no: '323456789012',
      ifsc_code: 'SBIN0000691',
      branch_address: 'Parliament Street, New Delhi',
      technology: 'Hydro',
      capacity_mw: 1000,
      is_penny_drop_verified: 1,
      regulatory_approvals: '4/4 mandatory verified'
    }
  ];

  const updateStmt = db.prepare(`
    UPDATE entities SET
      pan_no = @pan_no, gst_no = @gst_no, tan_no = @tan_no, cin = @cin,
      address = @address, corporate_email = @corporate_email, corporate_phone = @corporate_phone,
      corporate_website = @corporate_website, credit_rating = @credit_rating,
      bank_name = @bank_name, account_no = @account_no, ifsc_code = @ifsc_code,
      branch_address = @branch_address,
      contracted_capacity_mw = COALESCE(@contracted_capacity_mw, contracted_capacity_mw),
      psa_tariff = COALESCE(@psa_tariff, psa_tariff),
      supply_criteria = COALESCE(@supply_criteria, supply_criteria),
      capacity_mw = COALESCE(@capacity_mw, capacity_mw),
      technology = COALESCE(@technology, technology),
      is_penny_drop_verified = @is_penny_drop_verified,
      regulatory_approvals = @regulatory_approvals
    WHERE id = @id
  `);

  for (const u of updates) {
    updateStmt.run({
      capacity_mw: null,
      technology: null,
      contracted_capacity_mw: null,
      psa_tariff: null,
      supply_criteria: null,
      ...u,
    });
  }

  // 5. Seed 2 realistic pending counterparties for verification/onboarding testing
  const pendingSeller = {
    id: 'ENT-PENDING-SOLAR',
    parent_entity_id: null,
    entity_type: 'SELLER',
    category: 'RE Generator',
    name: 'Bikaner Green Solar Energy Pvt Ltd',
    pan_no: 'AABCB9999K',
    gst_no: '08AABCB9999K1Z7',
    tan_no: 'JODB09999K',
    cin: 'U40106RJ2022PTC081234',
    address: 'Solar Park, Kolayat, Bikaner, Rajasthan 334001',
    corporate_email: 'ops@bikanersolar.in',
    corporate_phone: '0151-2233445',
    corporate_website: 'www.bikanersolar.in',
    credit_rating: 'A',
    technology: 'Solar',
    capacity_mw: 100,
    contracted_capacity_mw: null,
    psa_tariff: null,
    supply_criteria: null,
    bank_name: 'HDFC Bank',
    account_no: '50200099887766',
    ifsc_code: 'HDFC0000249',
    branch_address: 'Bikaner Main Branch',
    is_penny_drop_verified: 0,
    status: 'PENDING',
    regulatory_approvals: '0/4 mandatory verified',
    verticals: 'REIA'
  };

  const pendingBuyer = {
    id: 'ENT-PENDING-DISCOM',
    parent_entity_id: null,
    entity_type: 'BUYER',
    category: 'DISCOM',
    name: 'Uttarakhand Power Corporation Ltd (UPCL)',
    pan_no: 'AABCU7777M',
    gst_no: '05AABCU7777M1Z4',
    tan_no: 'DDNU07777M',
    cin: 'U40109UR2001SGC025867',
    address: 'Victoria Cross Vijeta Gabar Singh Bhawan, Kanwali Road, Dehradun 248001',
    corporate_email: 'commercial@upcl.org',
    corporate_phone: '0135-2763672',
    corporate_website: 'www.upcl.org',
    credit_rating: 'BBB+',
    technology: null,
    capacity_mw: null,
    contracted_capacity_mw: 80,
    psa_tariff: 3.35,
    supply_criteria: 'Round-The-Clock (RTC)',
    bank_name: 'Punjab National Bank',
    account_no: '0123002100099887',
    ifsc_code: 'PUNB0012300',
    branch_address: 'Astley Hall, Dehradun',
    is_penny_drop_verified: 0,
    status: 'PENDING',
    regulatory_approvals: '0/4 mandatory verified',
    verticals: 'REIA'
  };

  const insertEntity = db.prepare(`
    INSERT OR REPLACE INTO entities (
      id, parent_entity_id, entity_type, category, name, pan_no, gst_no, tan_no, cin,
      address, corporate_email, corporate_phone, corporate_website, credit_rating,
      technology, capacity_mw, contracted_capacity_mw, psa_tariff, supply_criteria,
      bank_name, account_no, ifsc_code, branch_address, is_penny_drop_verified,
      status, regulatory_approvals, verticals
    ) VALUES (
      @id, @parent_entity_id, @entity_type, @category, @name, @pan_no, @gst_no, @tan_no, @cin,
      @address, @corporate_email, @corporate_phone, @corporate_website, @credit_rating,
      @technology, @capacity_mw, @contracted_capacity_mw, @psa_tariff, @supply_criteria,
      @bank_name, @account_no, @ifsc_code, @branch_address, @is_penny_drop_verified,
      @status, @regulatory_approvals, @verticals
    )
  `);

  insertEntity.run(pendingSeller);
  insertEntity.run(pendingBuyer);

  console.log('Seeded realistic pending test entities: Bikaner Green Solar & UPCL.');
})();

console.log('Optimizing database (VACUUM)...');
db.pragma('vacuum');
console.log('--- Cleanup Finished Successfully! ---');
