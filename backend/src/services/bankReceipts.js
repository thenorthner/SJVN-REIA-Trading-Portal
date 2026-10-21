import db from '../db/index.js';
import { newId } from '../util.js';

/**
 * Bank receipts that credit a trading client's pre-payment.
 *
 * A receipt names the client by its virtual account number (what the bank sees),
 * or failing that by portfolio. One that names nobody we know is kept as
 * UNRECONCILED, with no credit, until someone matches it to a client by hand.
 * The UTR is the receipt's identity: the same UTR pasted twice credits once.
 * Credit and the receipt row are written together or not at all.
 */
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (v) => String(v ?? '').trim();

/** Which client does this receipt belong to? VAN first, then portfolio. */
export function resolveReceiptClient({ van, portfolio_id: portfolio }) {
  const v = clean(van);
  if (v) {
    const byVan = db.prepare('SELECT * FROM trading_clients WHERE UPPER(virtual_account_no) = UPPER(?)').get(v);
    if (byVan) return byVan;
  }
  const p = clean(portfolio);
  if (p) {
    const byId = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(p);
    if (byId) return byId;
    const viaPortfolio = db.prepare(`
      SELECT c.* FROM client_exchange_portfolios cp JOIN trading_clients c ON c.id = cp.client_id
      WHERE cp.portfolio_id = ? COLLATE NOCASE LIMIT 1
    `).get(p);
    if (viaPortfolio) return viaPortfolio;
  }
  return null;
}

function credit(client, amount) {
  db.prepare('UPDATE trading_clients SET pre_payment_balance = ROUND(pre_payment_balance + ?, 2) WHERE id = ?').run(amount, client.id);
}

/** Record one receipt. Returns { outcome: 'APPLIED' | 'UNMATCHED' | 'DUPLICATE', transaction, client? }. */
export function recordReceipt(input, actorId = null) {
  const utr = clean(input.utr_no);
  const van = clean(input.van);
  const amount = money(input.amount);
  if (!utr) throw err(400, 'utr_no is required');
  if (!(amount > 0)) throw err(400, 'amount must be a positive number');
  if (!van && !clean(input.portfolio_id)) throw err(400, 'Give the virtual account number (van) or a portfolio_id so the receipt can be matched to a client');
  const when = clean(input.transaction_date) || new Date().toISOString().slice(0, 10);
  if (Number.isNaN(Date.parse(when))) throw err(400, 'transaction_date is not a valid date');

  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM bank_transactions WHERE UPPER(utr_no) = UPPER(?)').get(utr);
    if (existing) return { outcome: 'DUPLICATE', transaction: existing };

    const client = resolveReceiptClient(input);
    const id = newId('BTX');
    db.prepare(`
      INSERT INTO bank_transactions (id, portfolio_id, van, utr_no, amount, transaction_date, recon_status, sap_sync_status, client_id, applied_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `).run(id, client?.id || clean(input.portfolio_id), van, utr, amount, when,
      client ? 'MATCHED' : 'UNRECONCILED', client?.id || null, client ? new Date().toISOString() : null, actorId);
    if (client) credit(client, amount);
    return {
      outcome: client ? 'APPLIED' : 'UNMATCHED',
      transaction: db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id),
      client: client ? db.prepare('SELECT id, name, pre_payment_balance FROM trading_clients WHERE id = ?').get(client.id) : null,
    };
  })();
}

/** Match a receipt that named nobody to a client, and credit it. */
export function applyReceipt(transactionId, clientId) {
  return db.transaction(() => {
    const tx = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(transactionId);
    if (!tx) throw err(404, 'Receipt not found');
    if (tx.applied_at) throw err(400, 'This receipt has already been credited');
    const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(clientId);
    if (!client) throw err(400, 'Client not found');
    credit(client, tx.amount);
    db.prepare("UPDATE bank_transactions SET client_id = ?, portfolio_id = ?, applied_at = ?, recon_status = 'MATCHED' WHERE id = ?")
      .run(client.id, client.id, new Date().toISOString(), tx.id);
    return {
      transaction: db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(tx.id),
      client: db.prepare('SELECT id, name, pre_payment_balance FROM trading_clients WHERE id = ?').get(client.id),
    };
  })();
}
