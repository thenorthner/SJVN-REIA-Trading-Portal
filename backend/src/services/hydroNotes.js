/**
 * Debit and credit notes on a hydro beneficiary's account.
 *
 * The same discipline as REIA's notes (routes/notes.js): a note is raised as a
 * DRAFT and moves no money until someone other than its maker approves it.
 *
 *   DEBIT   the beneficiary owes more — a revised REA, a change in law, a
 *           transmission charge missed on the bill. On approval it is posted to
 *           the account as its own debit (DN) with its own due date, so it is
 *           paid, cleared and surcharged like any bill. The bill it refers to is
 *           not rewritten: the bill as issued stays the bill as issued.
 *   CREDIT  the beneficiary owes less. On approval it is posted as a credit (CN)
 *           and set against the bill it names, or the oldest open bills. It is
 *           not money received, so it never shows as a collection and earns no
 *           rebate. What it cannot clear stays on the account as credit.
 *
 * An approved note is corrected by raising the opposite note, not by deleting
 * it — the account keeps both, which is what an auditor expects to find.
 */
import { isRealDay } from './realDay.js';
import db from '../db/index.js';
import { newId } from '../util.js';
import { insertDoc, genDocNo, applyCredit, dueDateFor, outstandingOf } from './hydroLedger.js';
import { makerCheckerConflict } from './hydroBillApproval.js';

export const NOTE_REASONS = {
  REVISED_REA: 'Revised / amended REA',
  CHANGE_IN_LAW: 'Change in Law',
  TRANSMISSION_CHARGES: 'Transmission / NRLDC charges',
  TARIFF_REVISION: 'Tariff order revision (AFC / ECR)',
  LPS: 'Late Payment Surcharge',
  BILLING_ERROR: 'Billing error',
  REBATE_ADJUSTMENT: 'Rebate adjustment',
  OTHER: 'Other',
};

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const fail = (status, message) => Object.assign(new Error(message), { status });

/** "HDN/2026-27/0001" or "HCN/2026-27/0001": the series restarts each financial year. */
function nextNoteNo(type, onDate) {
  const [y, m] = onDate.slice(0, 7).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  const fy = `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
  const prefix = `${type === 'DEBIT' ? 'HDN' : 'HCN'}/${fy}/`;
  const last = db.prepare('SELECT note_no FROM hydro_notes WHERE note_no LIKE ? ORDER BY note_no DESC LIMIT 1').get(`${prefix}%`);
  const n = last ? Number(last.note_no.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

export function listNotes({ contractId = null, beneficiaryName = null, status = null, vertical = null } = {}) {
  let sql = `
    SELECT n.*, d.doc_no AS against_doc_no, l.doc_no AS ledger_doc_no
    FROM hydro_notes n
    LEFT JOIN hydro_ledger_docs d ON d.id = n.against_doc_id
    LEFT JOIN hydro_ledger_docs l ON l.id = n.ledger_doc_id
    WHERE 1=1`;
  const params = [];
  if (contractId) { sql += ' AND n.contract_id = ?'; params.push(contractId); }
  if (beneficiaryName) { sql += ' AND n.beneficiary_name = ?'; params.push(beneficiaryName); }
  if (status) { sql += ' AND n.status = ?'; params.push(status); }
  // A desk lists its own stations' notes; the Hydro desk read the Thermal desk's (Thermal QA run 7).
  if (vertical) {
    sql += ` AND n.contract_id IN (SELECT id FROM contracts WHERE project_type IN (${vertical === 'THERMAL' ? "'Thermal'" : "'Hydro','PSP'"}))`;
  }
  sql += ' ORDER BY n.created_at DESC';
  return db.prepare(sql).all(...params).map((n) => ({ ...n, reason_label: NOTE_REASONS[n.reason] || n.reason }));
}

export function raiseNote(body, user) {
  const type = String(body.note_type || '').toUpperCase();
  if (!['DEBIT', 'CREDIT'].includes(type)) throw fail(400, 'note_type must be DEBIT or CREDIT');
  const amount = money(body.amount);
  if (!(amount > 0)) throw fail(400, 'The note amount must be greater than zero');
  if (!body.contract_id || !body.beneficiary_name) throw fail(400, 'contract_id and beneficiary_name are required');
  if (!NOTE_REASONS[body.reason]) throw fail(400, `reason must be one of: ${Object.keys(NOTE_REASONS).join(', ')}`);
  const remarks = String(body.remarks ?? '').trim();
  if (remarks.length < 10) throw fail(400, 'Say what the note is for (at least 10 characters) — it is printed on the note.');

  const contract = db.prepare('SELECT id, contract_no FROM contracts WHERE id = ?').get(body.contract_id);
  if (!contract) throw fail(404, 'Station contract not found');

  // The account has to exist: a note is raised on a beneficiary SJVN bills.
  const known = db.prepare(`
    SELECT beneficiary_id FROM hydro_ledger_docs WHERE contract_id = ? AND beneficiary_name = ? LIMIT 1
  `).get(contract.id, body.beneficiary_name);
  if (!known) throw fail(400, `${body.beneficiary_name} has no account on this station yet — a note needs an issued bill to sit against.`);

  let against = null;
  if (body.against_doc_id) {
    against = db.prepare(`
      SELECT * FROM hydro_ledger_docs WHERE id = ? AND contract_id = ? AND beneficiary_name = ? AND status = 'OPEN'
    `).get(body.against_doc_id, contract.id, body.beneficiary_name);
    if (!against || !['PB', 'LPS'].includes(against.doc_type)) throw fail(400, 'The note must refer to an open bill or surcharge on this account');
  }
  // A credit note larger than what the named bill still owes would be a refund
  // dressed up as a correction.
  // Drafts already raised against the same document count too: two notes each
  // within the balance, together beyond it, left the excess as an advance
  // (Hydro QA run 5).
  if (type === 'CREDIT' && against) {
    const open = outstandingOf(against.id);
    const drafted = money(db.prepare(`SELECT COALESCE(SUM(amount), 0) s FROM hydro_notes WHERE against_doc_id = ? AND note_type = 'CREDIT' AND status = 'DRAFT'`).get(against.id).s);
    if (amount + drafted > open + 0.005) {
      throw fail(400, `${against.doc_no} has only ₹${open.toLocaleString('en-IN')} outstanding${drafted > 0 ? `, of which ₹${drafted.toLocaleString('en-IN')} is already on draft credit notes` : ''}; a credit note against it cannot be for more.`);
    }
  }

  if (body.note_date && !isRealDay(body.note_date)) throw fail(400, 'note_date must be a date (YYYY-MM-DD) that exists');
  const noteDate = body.note_date || today();
  if (noteDate > today()) throw fail(400, `A note cannot be dated ${noteDate}, after today`);
  const id = newId('HNT');
  const noteNo = nextNoteNo(type, noteDate);
  db.prepare(`
    INSERT INTO hydro_notes (id, note_no, note_type, contract_id, beneficiary_name, beneficiary_id,
      against_doc_id, amount, reason, remarks, note_date, status, created_by, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)
  `).run(id, noteNo, type, contract.id, body.beneficiary_name, known.beneficiary_id || null,
    against?.id || null, amount, body.reason, remarks, noteDate, user?.id || null, user?.name || null);
  return db.prepare('SELECT * FROM hydro_notes WHERE id = ?').get(id);
}

/** Approve a draft note and post it to the beneficiary's account. */
export function approveNote(id, user) {
  const note = db.prepare('SELECT * FROM hydro_notes WHERE id = ?').get(id);
  if (!note) throw fail(404, 'Note not found');
  if (note.status !== 'DRAFT') throw fail(400, `${note.note_no} is ${note.status}, not awaiting approval`);
  const conflict = makerCheckerConflict({ created_by: note.created_by, prepared_by: note.created_by_name }, user);
  if (conflict) throw fail(403, 'Segregation of duties: whoever raised this note cannot approve it. It needs a different approver.');

  // A credit note names the bill it corrects. If that bill has been paid,
  // reversed or credited since, posting the note would leave its amount as an
  // advance — a refund the note never said it was.
  if (note.note_type === 'CREDIT' && note.against_doc_id) {
    const doc = db.prepare('SELECT doc_no, status FROM hydro_ledger_docs WHERE id = ?').get(note.against_doc_id);
    const open = doc && doc.status === 'OPEN' ? outstandingOf(note.against_doc_id) : 0;
    if (note.amount > open + 0.005) {
      throw fail(400, `${doc?.doc_no || 'The bill'} now has only ₹${open.toLocaleString('en-IN')} outstanding, less than this ₹${Number(note.amount).toLocaleString('en-IN')} credit note — reject it and raise one for what is still owed, or one not tied to the bill if a credit balance is intended.`);
    }
  }
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(note.contract_id);
  const on = today();
  let ledgerDoc;
  let applied = null;
  db.transaction(() => {
    if (note.note_type === 'DEBIT') {
      ledgerDoc = insertDoc({
        doc_no: genDocNo('DN', on.slice(0, 7)),
        contract_id: note.contract_id,
        beneficiary_name: note.beneficiary_name,
        beneficiary_id: note.beneficiary_id,
        doc_type: 'PB',
        mode: 'DEBIT_NOTE',
        reference: note.note_no,
        bill_id: null,
        amount: note.amount,
        doc_date: on,
        due_date: dueDateFor(contract, on),
        info: `Debit note ${note.note_no} — ${NOTE_REASONS[note.reason] || note.reason}`,
        created_by: user?.id || null,
      });
    } else {
      ledgerDoc = insertDoc({
        doc_no: genDocNo('CN', on.slice(0, 7)),
        contract_id: note.contract_id,
        beneficiary_name: note.beneficiary_name,
        beneficiary_id: note.beneficiary_id,
        doc_type: 'PMT',
        mode: 'CREDIT_NOTE',
        reference: note.note_no,
        amount: note.amount,
        doc_date: on,
        info: `Credit note ${note.note_no} — ${NOTE_REASONS[note.reason] || note.reason}`,
        created_by: user?.id || null,
      });
      applied = applyCredit(ledgerDoc.id, {
        onDate: on,
        createdBy: user?.id || null,
        targetDebitIds: note.against_doc_id ? [note.against_doc_id] : null,
        rebate: false,
      });
    }
    db.prepare(`
      UPDATE hydro_notes SET status = 'APPROVED', approved_by = ?, approved_by_name = ?, approved_at = datetime('now'),
        ledger_doc_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(user?.id || null, user?.name || null, ledgerDoc.id, note.id);
  })();
  return { note: db.prepare('SELECT * FROM hydro_notes WHERE id = ?').get(note.id), ledger_doc: ledgerDoc, applied };
}

export function rejectNote(id, user, reason) {
  const note = db.prepare('SELECT * FROM hydro_notes WHERE id = ?').get(id);
  if (!note) throw fail(404, 'Note not found');
  if (note.status !== 'DRAFT') throw fail(400, `${note.note_no} is ${note.status}; only a draft can be rejected or withdrawn`);
  const why = String(reason ?? '').trim();
  if (why.length < 5) throw fail(400, 'Give a reason for rejecting the note');
  const own = note.created_by && user?.id === note.created_by;
  db.prepare(`
    UPDATE hydro_notes SET status = ?, rejection_reason = ?, approved_by = ?, approved_by_name = ?, approved_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(own ? 'CANCELLED' : 'REJECTED', why, user?.id || null, user?.name || null, note.id);
  // A credit note raised by accepting a dispute: without it the acceptance
  // credits nothing, so the dispute goes back to review rather than standing
  // as accepted (Hydro QA run 7).
  const dispute = db.prepare(`SELECT * FROM hydro_disputes WHERE credit_note_id = ? AND status = 'RESOLVED_ACCEPTED'`).get(note.id);
  if (dispute) {
    db.prepare(`UPDATE hydro_disputes SET status = 'UNDER_REVIEW', accepted_amount = NULL, credit_note_id = NULL, resolution = NULL,
      resolved_by = NULL, resolved_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(dispute.id);
    db.prepare(`INSERT INTO hydro_dispute_events (id, dispute_id, from_status, to_status, remarks, actor) VALUES (?, ?, 'RESOLVED_ACCEPTED', 'UNDER_REVIEW', ?, ?)`)
      .run(newId('HDE'), dispute.id, `Credit note ${note.note_no} ${own ? 'withdrawn' : 'rejected'}: ${why}`, user?.name || null);
  }
  return db.prepare('SELECT * FROM hydro_notes WHERE id = ?').get(note.id);
}
