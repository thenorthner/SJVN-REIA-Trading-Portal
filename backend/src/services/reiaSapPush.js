/**
 * Sending a REIA sale posting to SAP, and reading back what SAP did with it.
 *
 * Each invoice on the posting becomes one FI document's worth of lines in
 * SAP's CB FI table (bill type RE), sent as one changeset through
 * services/sapOdata.js:
 *
 *   CPOS 1     key 40  receivable from the buyer, the bill total
 *   CPOS 2…    key 50  one credit line per part that is not zero: energy,
 *                      SJVN margin, pass-through, tax, adjustment
 *
 * The parts add back to the total (reiaFiPosting.splitInvoice), so the
 * document balances. SAP's own posting run books it and writes the FI
 * document number back; "check" reads that number.
 *
 * TEST STAGE (28-Oct-2026). The GL accounts, profit centres, plant code and
 * beneficiary number come from backend/.env, not from a plant map or a buyer
 * master: Finance has not given the REIA GLs yet, and the buyer → beneficiary
 * mapping does not exist. Every invoice therefore goes in under the one
 * configured beneficiary. Only SALE postings are sent.
 *
 * A push is recorded before it is sent (UNKNOWN), so an invoice SAP may hold
 * is never sent again from here until a read back says it is not there; SAP
 * refuses a second booking of the same invoice in any case.
 */
import db from '../db/index.js';
import { newId } from '../util.js';
import { getPosting, assertUnchanged } from './reiaFiPosting.js';
import { openSession, postChangeset, readEntities } from './sapOdata.js';
import { buildInvoiceLines, sapPostingConfig, istStamp } from './reiaSapLines.js';

export { sapInvoiceNo, istStamp, buildInvoiceLines, sapPostingConfig } from './reiaSapLines.js';

const ENTITY_SET = 'FiLineSet';

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function nextSeq() {
  return db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM reia_sap_pushes').get().n;
}

/** Pushes of a posting, newest first. */
export function listPushes(postingId) {
  return db.prepare(`
    SELECT * FROM reia_sap_pushes WHERE posting_id = ? ORDER BY created_at DESC, seq DESC
  `).all(postingId).map(({ lines_json, ...p }) => ({ ...p, lines: JSON.parse(lines_json || '[]').length }));
}

/**
 * Send every invoice of a posting that SAP does not hold yet.
 *
 * Pushing is the checker's step, in place of typing Finance's voucher: only a
 * PREPARED posting goes, and not by whoever prepared it. Once SAP has posted
 * every invoice, checkPosting marks the posting POSTED with SAP's FI documents.
 */
export async function pushPosting(postingId, { pushedBy = null, pushedById = null } = {}) {
  const posting = getPosting(postingId);
  if (!posting) throw bad('Posting not found', 404);
  if (posting.category !== 'SALE') throw bad('Only sale postings go to SAP for now');
  if (posting.status !== 'PREPARED') {
    throw bad(`${posting.posting_no} is ${posting.status.toLowerCase()}; only a prepared posting goes to SAP`, 409);
  }
  if (posting.created_by && pushedById && posting.created_by === pushedById) {
    throw bad('You prepared this posting, so someone else sends it to SAP.', 403);
  }

  const cfg = sapPostingConfig();
  if (cfg.missing.length) throw bad(`Set ${cfg.missing.join(', ')} in backend/.env before pushing to SAP`);

  const earlier = db.prepare(`
    SELECT posting_line_id, doc_no, status FROM reia_sap_pushes WHERE posting_id = ? AND status <> 'FAILED'
  `).all(postingId);
  const unknown = earlier.filter((r) => r.status === 'UNKNOWN').map((r) => r.doc_no);
  if (unknown.length) {
    // Being sent right now by someone else, or sent with no answer: either way
    // SAP may hold it, and only a read back can say.
    throw bad(`${unknown.join(', ')} is being sent to SAP or got no answer from it; use "Read back from SAP" before pushing again`, 409);
  }
  const inSap = new Set(earlier.map((r) => r.posting_line_id));
  const waiting = posting.lines.filter((l) => !inSap.has(l.id));
  if (!waiting.length) throw bad(`Every invoice of ${posting.posting_no} is already in SAP`, 409);
  assertUnchanged(posting);

  // Lines are built for all before anything is sent, so a missing GL stops
  // the push instead of leaving half the posting in SAP.
  const timestamp = istStamp();
  const planned = waiting.map((line) => {
    const inv = db.prepare('SELECT issued_at, created_at FROM invoices WHERE id = ?').get(line.source_id);
    const bldat = String(inv?.issued_at || inv?.created_at || posting.created_at).slice(0, 10);
    return { line, bldat };
  });
  const insert = db.prepare(`
    INSERT INTO reia_sap_pushes (
      id, posting_id, posting_line_id, doc_no, sap_invoice_no, seq, belnr, sap_timestamp,
      status, lines_json, error, pushed_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNKNOWN', ?, 'Sending; no answer from SAP recorded', ?)
  `);
  const pushes = db.transaction(() => planned.map(({ line, bldat }) => {
    const seq = nextSeq();
    const belnr = `RE${String(seq).padStart(8, '0')}`;
    const lines = buildInvoiceLines({ line, posting, bldat, belnr, timestamp, cfg });
    const id = newId('RSP');
    insert.run(id, postingId, line.id, line.doc_no, lines[0].InvoiceNo, seq, belnr, timestamp,
      JSON.stringify(lines), pushedBy);
    return { id, doc_no: line.doc_no, belnr, lines };
  }))();

  const settle = db.prepare('UPDATE reia_sap_pushes SET status = ?, error = ? WHERE id = ?');
  let session;
  try {
    session = await openSession();
  } catch (err) {
    // Nothing was sent: the token fetch comes before any line.
    for (const p of pushes) settle.run('FAILED', err.message, p.id);
    throw err;
  }

  const results = [];
  for (const p of pushes) {
    let status;
    let error = null;
    try {
      const r = await postChangeset(session, ENTITY_SET, p.lines);
      status = r.ok ? 'SENT' : 'FAILED';
      error = r.ok ? null : r.error;
    } catch (err) {
      // Without an answer SAP may still have stored the lines; the row stays
      // UNKNOWN until a read back settles it, and blocks a second push.
      status = err.noAnswer ? 'UNKNOWN' : 'FAILED';
      error = err.noAnswer ? `${err.message}. SAP may hold it; read back before pushing again.` : err.message;
    }
    settle.run(status, error, p.id);
    results.push({ doc_no: p.doc_no, belnr: p.belnr, lines: p.lines.length, status, error });
  }

  return {
    posting_no: posting.posting_no,
    timestamp,
    sent: results.filter((r) => r.status === 'SENT').length,
    failed: results.filter((r) => r.status === 'FAILED').length,
    unknown: results.filter((r) => r.status === 'UNKNOWN').length,
    results,
  };
}

/**
 * Ask SAP what became of a posting's invoices.
 *
 * An invoice is BOOKED once every one of its lines carries SAP's posted flag
 * and FI document number. Until then it stays SENT; a posting error SAP wrote
 * on the lines is shown as its message.
 */
export async function checkPosting(postingId) {
  const posting = getPosting(postingId);
  if (!posting) throw bad('Posting not found', 404);
  const sent = db.prepare(`
    SELECT * FROM reia_sap_pushes WHERE posting_id = ? AND status IN ('SENT','BOOKED','UNKNOWN')
  `).all(postingId);
  if (!sent.length) throw bad(`Nothing of ${posting.posting_no} has gone to SAP yet`);

  for (const p of sent) {
    const rows = await readEntities(ENTITY_SET, `Timestamp eq '${p.sap_timestamp}' and Belnr eq '${p.belnr}'`);
    let status = p.status;
    let fiDoc = p.sap_fi_doc;
    let year = p.sap_fi_year;
    let message;
    if (!rows.length && p.status === 'UNKNOWN') {
      // SAP never got it: free the invoice for the next push.
      status = 'FAILED';
      message = 'SAP does not hold these lines; push again';
    } else if (!rows.length) {
      message = 'SAP does not hold these lines';
    } else if (rows.every((r) => r.Flag === true && r.ErpFiDocNum)) {
      status = 'BOOKED';
      fiDoc = rows[0].ErpFiDocNum;
      year = rows[0].Gjahr;
      message = null;
    } else {
      status = 'SENT';
      message = rows.map((r) => r.Description).find(Boolean) || `${rows.length} line(s) in SAP, waiting for the FI posting run`;
    }
    db.prepare(`
      UPDATE reia_sap_pushes
      SET status = ?, sap_fi_doc = ?, sap_fi_year = ?, sap_message = ?, checked_at = datetime('now'),
          error = CASE WHEN status = 'UNKNOWN' THEN NULL ELSE error END
      WHERE id = ?
    `).run(status, fiDoc || null, year || null, message, p.id);
  }
  markPostedOnceBooked(postingId);
  return listPushes(postingId);
}

/**
 * The posting is booked once SAP has posted every invoice on it: it becomes
 * POSTED, its voucher being SAP's FI documents, posted by whoever pushed.
 */
function markPostedOnceBooked(postingId) {
  const posting = getPosting(postingId);
  if (posting.status !== 'PREPARED') return;
  const booked = db.prepare(`
    SELECT posting_line_id, sap_fi_doc, sap_fi_year, pushed_by FROM reia_sap_pushes
    WHERE posting_id = ? AND status = 'BOOKED' ORDER BY seq
  `).all(postingId);
  const bookedLines = new Set(booked.map((b) => b.posting_line_id));
  if (!posting.lines.length || !posting.lines.every((l) => bookedLines.has(l.id))) return;
  const docs = [...new Set(booked.map((b) => `${b.sap_fi_doc}/${b.sap_fi_year}`))];
  db.prepare(`
    UPDATE reia_fi_postings
    SET status = 'POSTED', fi_document_no = ?, posted_at = datetime('now'), posted_by = ?,
        updated_at = datetime('now')
    WHERE id = ? AND status = 'PREPARED'
  `).run(`SAP ${docs.join(', ')}`, booked[booked.length - 1].pushed_by, postingId);
}
