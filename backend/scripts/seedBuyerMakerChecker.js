import db from '../src/db/index.js';
import bcrypt from 'bcryptjs';

const entity = db.prepare("SELECT * FROM entities WHERE id = 'ENT-EX-PSPCL'").get();
if (!entity) {
  console.error('ENT-EX-PSPCL not found!');
  process.exit(1);
}
console.log('Entity found:', entity.id, entity.name);

// Find existing hash from buyer@discom.gov.in
const existingUser = db.prepare("SELECT password_hash FROM users WHERE email = 'buyer@discom.gov.in'").get();
const hash = existingUser ? existingUser.password_hash : bcrypt.hashSync('password123', 8);

// Update buyer@discom.gov.in to ENT-EX-PSPCL
db.prepare("UPDATE users SET linked_entity_id = ? WHERE email = 'buyer@discom.gov.in'").run(entity.id);

// Insert or update buyer.maker@discom.gov.in
const makerUser = db.prepare("SELECT id FROM users WHERE email = 'buyer.maker@discom.gov.in'").get();
let makerId = makerUser?.id;
if (!makerId) {
  makerId = 'USR-BUYER-L1-' + Date.now().toString(36);
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, linked_entity_id, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).run(makerId, 'Gurpreet Singh (Buyer Maker)', 'buyer.maker@discom.gov.in', hash, 'BUYER_L1', entity.id);
  console.log('Created buyer.maker user:', makerId);
} else {
  db.prepare("UPDATE users SET role = 'BUYER_L1', linked_entity_id = ? WHERE id = ?").run(entity.id, makerId);
  console.log('Updated buyer.maker user:', makerId);
}

// Insert or update buyer.checker@discom.gov.in
const checkerUser = db.prepare("SELECT id FROM users WHERE email = 'buyer.checker@discom.gov.in'").get();
let checkerId = checkerUser?.id;
if (!checkerId) {
  checkerId = 'USR-BUYER-L2-' + Date.now().toString(36);
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, linked_entity_id, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).run(checkerId, 'Harpreet Kaur (Buyer Checker)', 'buyer.checker@discom.gov.in', hash, 'BUYER_L2', entity.id);
  console.log('Created buyer.checker user:', checkerId);
} else {
  db.prepare("UPDATE users SET role = 'BUYER_L2', linked_entity_id = ? WHERE id = ?").run(entity.id, checkerId);
  console.log('Updated buyer.checker user:', checkerId);
}

// Link contract CON-70b914ee69bd4e34 to ENT-EX-PSPCL if exists
db.prepare("UPDATE contracts SET buyer_id = ? WHERE id = 'CON-70b914ee69bd4e34'").run(entity.id);

// Seed sample PENDING_CHECKER intimation for INV-PSA-PSPCL-202610 so Checker has one ready to test
const inv = db.prepare("SELECT * FROM invoices WHERE id = 'INV-PSA-PSPCL-202610'").get();
if (inv) {
  const existingIntimation = db.prepare("SELECT id FROM payment_intimations WHERE invoice_id = ? AND reference = 'SBIN20261015001'").get(inv.id);
  if (!existingIntimation) {
    const pinId = 'PIN-DEMO-' + Date.now().toString(36);
    db.prepare(`
      INSERT INTO payment_intimations (
        id, invoice_id, contract_id, entity_id, amount, tds_amount, tds_section,
        other_deduction, deduction_note, payment_date, mode, reference,
        status, prepared_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, 25000000, 25000, '194Q',
        0, null, date('now'), 'RTGS', 'SBIN20261015001',
        'PENDING_CHECKER', ?, datetime('now'), datetime('now')
      )
    `).run(pinId, inv.id, inv.contract_id, entity.id, makerId);
    console.log('Seeded sample PENDING_CHECKER intimation:', pinId);
  } else {
    console.log('Sample intimation already exists');
  }
}

console.log('All buyer maker-checker users and sample intimation initialized successfully.');
