/**
 * Note-from-exception engine (Batch 2, 17-Oct-2026: R4, G3, V4).
 *
 * One door for every note the platform drafts out of something already
 * decided elsewhere:
 *   RECON_EXCEPTION  an exception SJVN accepted on a reconciliation   (R4)
 *   CUF_SHORTFALL    a contract year's CUF shortfall at the true-up   (G3)
 *   VERIFICATION_LD  liquidated damages the verifier assessed         (V4)
 * Each note is a DRAFT for Finance's approval queue, carries its source
 * (source_kind / source_ref) so the queue and the audit trail say where it
 * came from, and one source raises one live note — a second click finds the
 * first rather than raising money twice.
 *
 * Money direction follows the bill the note is on: on a developer's bill a
 * CREDIT note reduces what SJVN owes the generator (how damages are
 * recovered); on a buyer's bill it reduces what the buyer owes.
 */
import db from '../db/index.js';
import { logAudit } from '../util.js';
import { draftNote } from './noteDrafts.js';
import { raiseTrueUp } from './cufTrueUp.js';
import { liveVerification } from './invoiceVerification.js';

export const NOTE_SOURCES = ['RECON_EXCEPTION', 'CUF_SHORTFALL', 'VERIFICATION_LD'];
const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra });
const PRESENTED = ['APPROVED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'DISPUTED'];

/** The live note already drafted from a source, if any. */
export function noteForSource(kind, ref) {
  return db.prepare(`SELECT * FROM debit_credit_notes WHERE source_kind = ? AND source_ref = ? AND status IN ('DRAFT', 'ISSUED', 'SETTLED') ORDER BY created_at DESC LIMIT 1`).get(kind, ref);
}

function fromReconException(exceptionId, user) {
  const x = db.prepare('SELECT * FROM recon_exceptions WHERE id = ?').get(exceptionId);
  if (!x) throw err(404, 'Exception not found');
  if (x.status !== 'ACCEPTED') throw err(400, 'Only an exception SJVN has accepted becomes a note');
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(x.reconciliation_id);
  if (!recon?.contract_id) throw err(400, 'The exception is not on a contract statement');
  if (!(Number(x.amount) > 0)) throw err(400, 'The exception carries no amount');
  const item = x.item_id ? db.prepare('SELECT invoice_id FROM recon_items WHERE id = ?').get(x.item_id) : null;
  const direction = recon.counterparty_role === 'BUYER' ? 'SJVN_TO_BUYER' : 'SELLER_TO_SJVN';
  const inv = (item?.invoice_id && db.prepare('SELECT * FROM invoices WHERE id = ?').get(item.invoice_id))
    || db.prepare(`
      SELECT * FROM invoices WHERE contract_id = ? AND direction = ? AND status IN (${PRESENTED.map(() => '?').join(',')})
        AND invoice_no NOT LIKE 'DSM-%' ORDER BY billing_period DESC, created_at DESC LIMIT 1
    `).get(recon.contract_id, direction, ...PRESENTED);
  if (!inv) throw err(400, `There is no presented bill on this contract to put the accepted ₹${Number(x.amount).toLocaleString('en-IN')} against.`);
  const note = draftNote({
    // The counterparty was right: on its own bill to SJVN it is owed more
    // (debit); on SJVN's bill to it, it owes less (credit).
    noteType: inv.direction === 'SELLER_TO_SJVN' ? 'DEBIT' : 'CREDIT',
    invoice: inv, amount: x.amount, user, sourceKind: 'RECON_EXCEPTION', sourceRef: x.id,
    reason: `Reconciliation ${recon.recon_no} — exception "${x.label}" accepted${x.resolution_note ? `: ${x.resolution_note}` : ''}`,
  });
  db.prepare('UPDATE recon_exceptions SET note_id = ? WHERE id = ?').run(note.id, x.id);
  return note;
}

function fromCufShortfall(contractId, contractYear, user, req) {
  const r = raiseTrueUp({ contractId, contractYear, user, req });
  db.prepare('UPDATE debit_credit_notes SET source_kind = ?, source_ref = ? WHERE id = ?').run('CUF_SHORTFALL', `${contractId}:${contractYear}`, r.raised_note_id);
  return { ...db.prepare('SELECT * FROM debit_credit_notes WHERE id = ?').get(r.raised_note_id), true_up: r };
}

function fromVerificationLd(invoiceId, user) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) throw err(404, 'Invoice not found');
  if (inv.direction !== 'SELLER_TO_SJVN') throw err(400, 'Liquidated damages are recovered on a developer\'s bill');
  if (inv.status === 'CANCELLED') throw err(400, 'The bill is cancelled');
  const live = liveVerification(inv);
  const ld = Math.round(Number(live?.commercial?.liquidated_damages) || 0);
  if (!(ld > 0)) throw err(400, 'The verification records no liquidated damages on this bill. Enter them on the checklist first.');
  return draftNote({
    noteType: 'CREDIT', invoice: inv, amount: ld, user, reasonCode: 'LIQUIDATED_DAMAGES',
    sourceKind: 'VERIFICATION_LD', sourceRef: inv.id,
    reason: `Liquidated damages assessed on verification of ${inv.invoice_no} (${inv.billing_period}) — recovered from the generator`,
  });
}

/**
 * Draft the note a source calls for. `ref` is the exception id, the invoice
 * id, or "contractId:contractYear" for a CUF shortfall.
 */
export function noteFromException({ kind, ref, user, req = null }) {
  if (!NOTE_SOURCES.includes(kind)) throw err(400, `kind must be one of ${NOTE_SOURCES.join(', ')}`);
  if (!ref) throw err(400, 'Say which exception, bill or contract year the note is for');
  const existing = noteForSource(kind, ref);
  if (existing) throw err(409, `A note for this is already ${existing.status === 'DRAFT' ? 'waiting for approval' : 'issued'} — ${existing.note_no}.`, { note: existing });
  let note;
  db.transaction(() => {
    if (kind === 'RECON_EXCEPTION') note = fromReconException(ref, user);
    else if (kind === 'VERIFICATION_LD') note = fromVerificationLd(ref, user);
    else {
      const [contractId, year] = String(ref).split(':');
      note = fromCufShortfall(contractId, Number(year), user, req);
    }
  })();
  logAudit({ req, user, action: 'NOTE_FROM_EXCEPTION', module: 'REIA', entityType: 'debit_credit_note', entityId: note.id, details: { kind, ref, amount: note.amount, note_type: note.note_type } });
  return note;
}
