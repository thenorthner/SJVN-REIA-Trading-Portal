/**
 * Handing the month's REIA billing to corporate Finance.
 *
 * The same three steps as the hydro handover (services/hydroFiPosting.js), and
 * for the same reasons:
 *
 *   prepare  gather the month's documents into a posting and total them,
 *            which is checkable and changes nothing
 *   post     book it, recording the voucher number Finance returns
 *   reverse  back a posted entry out
 *
 * What differs is the shape of the books. A hydro station is one seller billing
 * its beneficiaries; REIA sits between two sides, so a month is booked by what
 * it is to Finance rather than by contract:
 *
 *   SALE         SJVN's bills to buyers (PSA) — receivables
 *   PURCHASE     developers' bills to SJVN (PPA) that SJVN has accepted — payables
 *   CREDIT_NOTE  credit notes issued against either, which reduce the one they
 *                were raised on
 *
 * A debit note is its own supplementary invoice, so it is already in SALE or
 * PURCHASE and is not booked a second time here.
 *
 * A posted entry is Finance's record, so it is never edited: a wrong posting is
 * reversed and the month prepared again. Each document is frozen into the
 * posting's lines at the amount it was booked at.
 */
import db from '../db/index.js';
import { newId } from '../util.js';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

export const CATEGORIES = ['SALE', 'PURCHASE', 'CREDIT_NOTE'];

export const CATEGORY_LABELS = {
  SALE: 'Sale to buyers (receivable)',
  PURCHASE: 'Purchase from developers (payable)',
  CREDIT_NOTE: 'Credit notes issued',
};

// A sale is booked once it has gone to the buyer; a developer's bill once SJVN
// has accepted it. A draft or a bill still in approval is neither, and a
// cancelled one never was.
const SALE_STATUSES = ['SENT', 'PARTIALLY_PAID', 'PAID', 'DISPUTED'];
const PURCHASE_STATUSES = ['APPROVED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'DISPUTED'];

function postingNo(periodMonth, category) {
  const stamp = String(periodMonth).replace('-', '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `FI/REIA/${category}/${stamp}/${rand}`;
}

/**
 * How an invoice splits across what Finance books.
 *
 * Trading margin is SJVN's own income; NRLDC and transmission are passed
 * through; GST is tax, not revenue; and the adjustment is what a final bill
 * takes off for what was already paid on its provisional. Energy is what is
 * left, so the parts always add back to the bill.
 */
function splitInvoice(inv) {
  const total = money(inv.total_amount);
  const margin = money(inv.trading_margin);
  const passThrough = money(Number(inv.nrldc_fees || 0) + Number(inv.transmission_charges || 0));
  const tax = money(inv.taxes);
  const adjustment = money(inv.other_adjustments);
  return {
    energy: money(total - margin - passThrough - tax - adjustment),
    margin, pass_through: passThrough, tax, adjustment, total,
  };
}

/** A credit note takes value off, so every part of it books negative. */
function splitCreditNote(n) {
  const total = money(n.amount);
  const tax = money(n.tax_amount);
  const taxable = n.taxable_amount != null ? money(n.taxable_amount) : money(total - tax);
  return {
    energy: -taxable, margin: 0, pass_through: 0, tax: -tax, adjustment: 0, total: -total,
  };
}

const NOT_ON_A_LIVE_POSTING = `
  NOT EXISTS (
    SELECT 1 FROM reia_fi_posting_lines l
    JOIN reia_fi_postings p ON p.id = l.posting_id
    WHERE l.source_id = %ID% AND p.status <> 'REVERSED'
  )`;

/**
 * The documents of a month that Finance has not booked yet.
 *
 * One already on a live posting is left out, which is what stops a month being
 * booked twice.
 */
export function bookableDocuments(periodMonth, category) {
  if (!CATEGORIES.includes(category)) {
    throw Object.assign(new Error(`category must be one of ${CATEGORIES.join(', ')}`), { status: 400 });
  }

  if (category === 'CREDIT_NOTE') {
    return db.prepare(`
      SELECT n.*, i.invoice_no, i.direction, c.contract_no,
             CASE WHEN i.direction = 'SJVN_TO_BUYER' THEN be.name ELSE se.name END AS counterparty
      FROM debit_credit_notes n
      JOIN invoices i ON i.id = n.invoice_id
      LEFT JOIN contracts c ON c.id = COALESCE(n.contract_id, i.contract_id)
      LEFT JOIN entities se ON se.id = c.seller_id
      LEFT JOIN entities be ON be.id = c.buyer_id
      WHERE n.note_type = 'CREDIT' AND n.model = 'V2'
        AND n.status IN ('ISSUED', 'SETTLED')
        AND COALESCE(n.period_month, i.billing_period) = ?
        AND ${NOT_ON_A_LIVE_POSTING.replace('%ID%', 'n.id')}
      ORDER BY n.created_at
    `).all(periodMonth).map((n) => ({
      source_type: 'CREDIT_NOTE',
      source_id: n.id,
      doc_no: n.note_no,
      doc_kind: `CREDIT on ${n.invoice_no}`,
      direction: n.direction,
      contract_no: n.contract_no,
      counterparty: n.counterparty,
      ...splitCreditNote(n),
    }));
  }

  const direction = category === 'SALE' ? 'SJVN_TO_BUYER' : 'SELLER_TO_SJVN';
  const statuses = category === 'SALE' ? SALE_STATUSES : PURCHASE_STATUSES;
  return db.prepare(`
    SELECT i.*, c.contract_no,
           CASE WHEN i.direction = 'SJVN_TO_BUYER' THEN be.name ELSE se.name END AS counterparty
    FROM invoices i
    LEFT JOIN contracts c ON c.id = i.contract_id
    LEFT JOIN entities se ON se.id = c.seller_id
    LEFT JOIN entities be ON be.id = c.buyer_id
    WHERE i.direction = ? AND i.billing_period = ?
      AND i.status IN (${statuses.map(() => '?').join(',')})
      AND ${NOT_ON_A_LIVE_POSTING.replace('%ID%', 'i.id')}
    ORDER BY c.contract_no, i.created_at
  `).all(direction, periodMonth, ...statuses).map((i) => ({
    source_type: 'INVOICE',
    source_id: i.id,
    doc_no: i.invoice_no,
    doc_kind: i.invoice_type,
    direction: i.direction,
    contract_no: i.contract_no,
    counterparty: i.counterparty,
    ...splitInvoice(i),
  }));
}

/** What a set of documents adds up to, part by part. */
export function totalsOf(docs) {
  const sum = (k) => money(docs.reduce((a, d) => a + d[k], 0));
  return {
    docs_count: docs.length,
    energy_amount: sum('energy'),
    margin_amount: sum('margin'),
    pass_through_amount: sum('pass_through'),
    tax_amount: sum('tax'),
    adjustment_amount: sum('adjustment'),
    total_amount: sum('total'),
  };
}

/** Gather the month into a posting Finance can check before it is booked. */
export function preparePosting({ periodMonth, category = 'SALE', notes = null, createdBy = null }) {
  if (!/^\d{4}-\d{2}$/.test(String(periodMonth || ''))) {
    throw Object.assign(new Error('period_month must be YYYY-MM'), { status: 400 });
  }
  if (!CATEGORIES.includes(category)) {
    throw Object.assign(new Error(`category must be one of ${CATEGORIES.join(', ')}`), { status: 400 });
  }

  const open = db.prepare(`
    SELECT posting_no, status FROM reia_fi_postings
    WHERE period_month = ? AND category = ? AND status <> 'REVERSED'
  `).get(periodMonth, category);
  if (open) {
    throw Object.assign(
      new Error(`${periodMonth} is already ${open.status === 'POSTED' ? 'posted' : 'prepared'} for ${category} — ${open.posting_no}`),
      { status: 409 },
    );
  }

  const docs = bookableDocuments(periodMonth, category);
  if (!docs.length) {
    throw Object.assign(
      new Error(`Nothing in ${CATEGORY_LABELS[category].toLowerCase()} for ${periodMonth} is waiting to be booked`),
      { status: 400 },
    );
  }

  const t = totalsOf(docs);
  const id = newId('RFP');
  const no = postingNo(periodMonth, category);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO reia_fi_postings (
        id, posting_no, period_month, category, docs_count,
        energy_amount, margin_amount, pass_through_amount, tax_amount, adjustment_amount, total_amount,
        notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, no, periodMonth, category, t.docs_count,
      t.energy_amount, t.margin_amount, t.pass_through_amount, t.tax_amount, t.adjustment_amount, t.total_amount,
      notes, createdBy,
    );

    const line = db.prepare(`
      INSERT INTO reia_fi_posting_lines (
        id, posting_id, source_type, source_id, doc_no, doc_kind, direction, contract_no, counterparty,
        energy_amount, margin_amount, pass_through_amount, tax_amount, adjustment_amount, total_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of docs) {
      line.run(
        newId('RFL'), id, d.source_type, d.source_id, d.doc_no, d.doc_kind, d.direction,
        d.contract_no || null, d.counterparty || null,
        d.energy, d.margin, d.pass_through, d.tax, d.adjustment, d.total,
      );
    }
  })();

  return getPosting(id);
}

/** Book a prepared posting, recording the voucher Finance returned. */
export function postToFinance(postingId, { fiDocumentNo = null, postedBy = null }) {
  const p = db.prepare('SELECT * FROM reia_fi_postings WHERE id = ?').get(postingId);
  if (!p) throw Object.assign(new Error('Posting not found'), { status: 404 });
  if (p.status === 'POSTED') {
    throw Object.assign(new Error(`${p.posting_no} was already posted on ${p.posted_at}`), { status: 409 });
  }
  if (p.status === 'REVERSED') {
    throw Object.assign(new Error(`${p.posting_no} has been reversed — prepare the month again`), { status: 400 });
  }

  db.prepare(`
    UPDATE reia_fi_postings
    SET status = 'POSTED', fi_document_no = ?, posted_at = datetime('now'), posted_by = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(fiDocumentNo, postedBy, postingId);
  return getPosting(postingId);
}

/**
 * Back a posting out.
 *
 * The posting is marked rather than deleted and a counter-entry is written
 * beside it, so the record still shows the month went to Finance and came
 * back. Reversing frees its documents, so the month can be prepared again.
 */
export function reversePosting(postingId, { reason, reversedBy = null }) {
  if (!reason) throw Object.assign(new Error('A reversal must say why'), { status: 400 });
  const p = db.prepare('SELECT * FROM reia_fi_postings WHERE id = ?').get(postingId);
  if (!p) throw Object.assign(new Error('Posting not found'), { status: 404 });
  if (p.status === 'REVERSED') {
    throw Object.assign(new Error(`${p.posting_no} is already reversed`), { status: 400 });
  }

  const id = newId('RFP');
  const no = `${p.posting_no}/REV`;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO reia_fi_postings (
        id, posting_no, period_month, category, docs_count,
        energy_amount, margin_amount, pass_through_amount, tax_amount, adjustment_amount, total_amount,
        status, reverses_posting_id, reversal_reason, reversed_at, reversed_by, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REVERSED', ?, ?, datetime('now'), ?, ?)
    `).run(
      id, no, p.period_month, p.category, p.docs_count,
      -p.energy_amount, -p.margin_amount, -p.pass_through_amount, -p.tax_amount,
      -p.adjustment_amount, -p.total_amount,
      p.id, reason, reversedBy, reversedBy,
    );
    db.prepare(`
      UPDATE reia_fi_postings
      SET status = 'REVERSED', reversed_at = datetime('now'), reversed_by = ?,
          reversal_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(reversedBy, reason, postingId);
  })();

  return {
    reversed: p.posting_no,
    reversal_posting_no: no,
    reversal_id: id,
    note: 'Its documents are free to be prepared again.',
  };
}

/** A posting with the documents it booked. */
export function getPosting(id) {
  const p = db.prepare(`
    SELECT p.*, r.posting_no AS reverses_posting_no
    FROM reia_fi_postings p
    LEFT JOIN reia_fi_postings r ON r.id = p.reverses_posting_id
    WHERE p.id = ?
  `).get(id);
  if (!p) return null;
  const lines = db.prepare(
    'SELECT * FROM reia_fi_posting_lines WHERE posting_id = ? ORDER BY contract_no, doc_no',
  ).all(id);
  return { ...p, category_label: CATEGORY_LABELS[p.category], lines };
}

/** Postings, newest month first. */
export function listPostings({ periodMonth = null, category = null, status = null } = {}) {
  return db.prepare(`
    SELECT * FROM reia_fi_postings
    WHERE (? IS NULL OR period_month = ?)
      AND (? IS NULL OR category = ?)
      AND (? IS NULL OR status = ?)
    ORDER BY period_month DESC, created_at DESC
  `).all(periodMonth, periodMonth, category, category, status, status)
    .map((p) => ({ ...p, category_label: CATEGORY_LABELS[p.category] }));
}
