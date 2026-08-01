import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';

const router = Router();
router.use(requireAuth);

const withDetailsAvailability = (av) => {
  if (!av) return av;
  const seller = db.prepare('SELECT name FROM trading_clients WHERE id = ?').get(av.seller_id);
  av.seller_name = seller?.name;
  av.consents = db.prepare('SELECT * FROM buyer_consents WHERE availability_id = ? ORDER BY created_at DESC').all(av.id).map(withDetailsConsent);
  return av;
};

const withDetailsConsent = (con) => {
  if (!con) return con;
  const buyer = db.prepare('SELECT name FROM trading_clients WHERE id = ?').get(con.buyer_id);
  con.buyer_name = buyer?.name;
  return con;
};

/** MW already committed on an availability — only CONFIRMED consents hold capacity. */
const confirmedMw = (availabilityId) => db
  .prepare(`SELECT COALESCE(SUM(quantum_mw), 0) AS total FROM buyer_consents WHERE availability_id = ? AND status = 'CONFIRMED'`)
  .get(availabilityId).total;

// ==========================================
// Seller Availabilities
// ==========================================

// List availabilities
router.get('/availabilities', (req, res) => {
  const { status, seller_id } = req.query;
  let sql = 'SELECT * FROM seller_availabilities WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (seller_id) { sql += ' AND seller_id = ?'; params.push(seller_id); }
  sql += ' ORDER BY created_at DESC';

  res.json(db.prepare(sql).all(...params).map(withDetailsAvailability));
});

// Declare availability (Sellers)
router.post('/availabilities', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body;
  const id = newId('AVL');
  
  if (!b.seller_id || !b.start_date || !b.end_date || !b.quantum_mw) {
    return res.status(400).json({ error: 'seller_id, start_date, end_date, quantum_mw are required' });
  }

  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(b.seller_id);
  if (!client) return res.status(404).json({ error: 'Seller not found' });
  
  db.prepare(`
    INSERT INTO seller_availabilities (id, seller_id, start_date, end_date, quantum_mw, expected_tariff, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?)
  `).run(id, b.seller_id, b.start_date, b.end_date, b.quantum_mw, b.expected_tariff || null, req.user.id);

  secureLogAudit(req, { action: 'DECLARE_AVAILABILITY', module: 'TRADING', entityType: 'seller_availability', entityId: id, details: b });
  res.status(201).json(withDetailsAvailability(db.prepare('SELECT * FROM seller_availabilities WHERE id = ?').get(id)));
});

// ==========================================
// Buyer Consents
// ==========================================

// List consents for the logged in buyer, or all for admins
router.get('/consents', (req, res) => {
  const { buyer_id, status } = req.query;
  let sql = 'SELECT c.*, a.seller_id, a.start_date, a.end_date, a.quantum_mw AS available_mw, a.expected_tariff FROM buyer_consents c JOIN seller_availabilities a ON c.availability_id = a.id WHERE 1=1';
  const params = [];
  if (buyer_id) { sql += ' AND c.buyer_id = ?'; params.push(buyer_id); }
  if (status) { sql += ' AND c.status = ?'; params.push(status); }
  sql += ' ORDER BY c.created_at DESC';

  res.json(db.prepare(sql).all(...params).map(withDetailsConsent));
});

// Submit consent (Buyers)
router.post('/availabilities/:id/consents', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const availability = db.prepare('SELECT * FROM seller_availabilities WHERE id = ?').get(req.params.id);
  if (!availability) return res.status(404).json({ error: 'Availability not found' });
  if (availability.status !== 'OPEN' && availability.status !== 'PARTIALLY_BOOKED') {
    return res.status(400).json({ error: 'This availability is no longer open for consent' });
  }

  const b = req.body;
  if (!b.buyer_id || !b.quantum_mw) {
    return res.status(400).json({ error: 'buyer_id and quantum_mw are required' });
  }

  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(b.buyer_id);
  if (!client) return res.status(404).json({ error: 'Buyer not found' });

  // Buyers may compete for the same MW, so a consent is not held against other
  // pending ones — but it can never exceed what is left uncommitted.
  const remaining = availability.quantum_mw - confirmedMw(availability.id);
  if (Number(b.quantum_mw) <= 0) {
    return res.status(400).json({ error: 'quantum_mw must be greater than zero' });
  }
  if (Number(b.quantum_mw) > remaining + 1e-9) {
    return res.status(400).json({
      error: `Only ${remaining} MW is still uncommitted on this availability; consent requested ${b.quantum_mw} MW`,
      available_mw: remaining,
    });
  }

  const consentId = newId('CON');
  
  db.prepare(`
    INSERT INTO buyer_consents (id, availability_id, buyer_id, quantum_mw, offered_tariff, status, created_by)
    VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
  `).run(consentId, availability.id, b.buyer_id, b.quantum_mw, b.offered_tariff || null, req.user.id);

  secureLogAudit(req, { action: 'SUBMIT_CONSENT', module: 'TRADING', entityType: 'buyer_consent', entityId: consentId, details: b });
  res.status(201).json(withDetailsConsent(db.prepare('SELECT * FROM buyer_consents WHERE id = ?').get(consentId)));
});

// Confirm consent (Sellers)
router.post('/consents/:id/confirm', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const consent = db.prepare('SELECT * FROM buyer_consents WHERE id = ?').get(req.params.id);
  if (!consent) return res.status(404).json({ error: 'Consent not found' });
  if (consent.status !== 'PENDING') return res.status(400).json({ error: 'Only pending consents can be confirmed' });

  const availability = db.prepare('SELECT * FROM seller_availabilities WHERE id = ?').get(consent.availability_id);
  if (!availability) return res.status(404).json({ error: 'The availability this consent belongs to no longer exists' });

  // Capacity check. Several buyers can hold PENDING consents against the same
  // MW; whoever the seller confirms first takes it. Without this, confirming
  // past the declared quantum would create bilateral transactions for power
  // that was never offered.
  const alreadyBooked = confirmedMw(availability.id);
  const remaining = availability.quantum_mw - alreadyBooked;
  if (consent.quantum_mw > remaining + 1e-9) {
    return res.status(400).json({
      error: `Only ${remaining} MW of the declared ${availability.quantum_mw} MW is still uncommitted; this consent asks for ${consent.quantum_mw} MW`,
      available_mw: remaining,
      requested_mw: consent.quantum_mw,
    });
  }

  const buyer = db.prepare('SELECT name FROM trading_clients WHERE id = ?').get(consent.buyer_id);
  if (!buyer) return res.status(404).json({ error: 'The buyer on this consent no longer exists' });

  const tariff = consent.offered_tariff ?? availability.expected_tariff ?? null;
  if (tariff == null) {
    return res.status(400).json({ error: 'Neither the consent nor the availability carries a tariff — set one before confirming' });
  }

  // Generate a draft Bilateral Transaction
  const txId = newId('BIL');

  const write = db.transaction(() => {
    // 1. Update Consent
    db.prepare(`UPDATE buyer_consents SET status = 'CONFIRMED', linked_transaction_id = ?, confirmed_at = ? WHERE id = ?`)
      .run(txId, new Date().toISOString(), consent.id);
      
    // 2. Create Bilateral Transaction (Draft)
    // NOTE: client_id in bilateral_transactions is the SJVN client. But since a bilateral trade involves two parties, 
    // the system treats 'client_id' as the initiator, and 'counterparty' as the string name or entity id. 
    // To match how bilateral is done in the app, we set client_id = buyer_id or seller_id based on who is the primary.
    // In SJVN context, seller_id is usually a generator client and buyer is another client. Let's use seller_id.
    db.prepare(`
      INSERT INTO bilateral_transactions (
        id, client_id, counterparty, quantum_mw, tariff_per_unit, open_access_status, schedule_status, status, start_date, end_date, oa_type, is_standing_clearance
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', 'DRAFT', 'ACTIVE', ?, ?, 'STOA', 0)
    `).run(
      txId, availability.seller_id, buyer.name, consent.quantum_mw, tariff,
      availability.start_date, availability.end_date
    );

    // 3. Update Availability Status. Step 1 has already flipped this consent to
    // CONFIRMED, so the sum below includes it — adding consent.quantum_mw again
    // would count it twice and retire the availability while MW remained unsold.
    const totalConfirmed = confirmedMw(availability.id);
    const newStatus = totalConfirmed >= availability.quantum_mw ? 'FULLY_BOOKED' : 'PARTIALLY_BOOKED';
    db.prepare('UPDATE seller_availabilities SET status = ? WHERE id = ?').run(newStatus, availability.id);
  });
  
  write();

  secureLogAudit(req, { action: 'CONFIRM_CONSENT', module: 'TRADING', entityType: 'buyer_consent', entityId: consent.id, details: { linked_tx_id: txId } });
  res.json({ success: true, consentId: consent.id, transactionId: txId });
});

// Reject consent
router.post('/consents/:id/reject', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const consent = db.prepare('SELECT * FROM buyer_consents WHERE id = ?').get(req.params.id);
  if (!consent) return res.status(404).json({ error: 'Consent not found' });
  if (consent.status !== 'PENDING') return res.status(400).json({ error: 'Only pending consents can be rejected' });

  db.prepare(`UPDATE buyer_consents SET status = 'REJECTED' WHERE id = ?`).run(consent.id);
  secureLogAudit(req, { action: 'REJECT_CONSENT', module: 'TRADING', entityType: 'buyer_consent', entityId: consent.id });
  res.json({ success: true, consentId: consent.id });
});


export default router;
