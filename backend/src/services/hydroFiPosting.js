/**
 * Handing the month's hydro billing to corporate Finance.
 *
 * C&SO raises the bills; Finance books the sale. The handover is three steps,
 * and they are separate on purpose:
 *
 *   prepare  gather the month's issued bills into a posting and total them,
 *            which is checkable and changes nothing
 *   post     book it, recording the voucher number Finance returns
 *   reverse  back a posted entry out
 *
 * A posted entry is Finance's record rather than ours, so it is never edited:
 * a wrong posting is reversed and the month prepared again. The bills a posting
 * booked are frozen into its lines at the amounts it booked them at, so a later
 * revision to a bill cannot silently restate what Finance already holds.
 */
import db from '../db/index.js';
import { newId } from '../util.js';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

export const CATEGORIES = ['HYDRO', 'ADDITIONAL', 'TCS', 'NOTES'];

/** Which bill kinds fall under each category Finance books to. */
const KINDS_BY_CATEGORY = {
  // Arrear, supplementary and PTC bills are energy sale too; they were left out
  // and never reached Finance (Hydro QA run 14).
  HYDRO: ['PROVISIONAL', 'FINAL', 'REVISION', 'ARREAR', 'SUPPLEMENTARY', 'PTC'],
  ADDITIONAL: ['ADDITIONAL'],
  TCS: ['TCS'],
};

export const CATEGORY_LABELS = {
  HYDRO: 'Energy sale (monthly, final, revision, arrear, supplementary and PTC bills)',
  ADDITIONAL: 'Additional charges claimed',
  TCS: 'Tax collected at source',
  NOTES: 'Debit and credit notes (approved)',
};

function postingNo(plantCode, periodMonth, category) {
  const stamp = String(periodMonth).replace('-', '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `FI/${plantCode || 'HYD'}/${category}/${stamp}/${rand}`;
}

/**
 * How a bill splits across what Finance books.
 *
 * NRLDC fees are a pass-through rather than SJVN's sale, and TCS is a tax
 * collected rather than revenue, so each is kept on its own line instead of
 * being rolled into the sale figure.
 */
const RESTATES = ['FINAL', 'REVISION'];
const ENERGY_KINDS = ['PROVISIONAL', 'FINAL', 'REVISION'];

/** The energy bill a final or revision bill restated: the one issued for the month just before it. */
function restatedBill(bill) {
  if (bill.revises_bill_id) {
    const r = db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(bill.revises_bill_id);
    if (r) return r;
  }
  return db.prepare(`
    SELECT * FROM hydro_station_bills
    WHERE contract_id = ? AND billing_month = ? AND id <> ? AND issued_at IS NOT NULL
      AND (? IS NULL OR issued_at <= ?)
      AND bill_kind IN (${ENERGY_KINDS.map(() => '?').join(',')})
    ORDER BY issued_at DESC, created_at DESC LIMIT 1
  `).get(bill.contract_id, bill.billing_month, bill.id, bill.issued_at ?? null, bill.issued_at ?? null, ...ENERGY_KINDS);
}

/** What the ledger charged for a bill: its bills less the credits it gave. Null if it posted nothing. */
function ledgerNet(billId) {
  const r = db.prepare(`
    SELECT COUNT(*) n,
      COALESCE(SUM(CASE WHEN doc_type = 'PB' THEN amount WHEN mode = 'CREDIT_NOTE' THEN -amount ELSE 0 END), 0) net
    FROM hydro_ledger_docs WHERE bill_id = ? AND status <> 'REVERSED'
  `).get(billId);
  return r.n ? money(r.net) : null;
}

function splitBill(bill) {
  const kind = bill.bill_kind;
  if (kind === 'TCS') {
    return { sale: 0, nrldc: 0, tcs: money(bill.total_charges), total: money(bill.total_charges) };
  }
  const sale = money(bill.total_charges);
  const nrldc = money(bill.nrldc_total_fee);
  if (RESTATES.includes(kind)) {
    // A final or revision bill restates the whole month; the ledger charged only
    // the difference, so Finance books only the difference. Booking it in full
    // booked the month twice (Hydro QA run 14). The difference can be a credit.
    // The ledger's figure is what was charged; the bill restated only splits
    // out the NRLDC fee's share of the difference.
    const before = restatedBill(bill);
    const net = ledgerNet(bill.id);
    if (before || net !== null) {
      const nrldcDiff = before ? money(nrldc - money(before.nrldc_total_fee)) : nrldc;
      const total = net ?? money(sale + nrldc - money(before.total_charges) - money(before.nrldc_total_fee));
      return { sale: money(total - nrldcDiff), nrldc: nrldcDiff, tcs: 0, total };
    }
  }
  return { sale, nrldc, tcs: 0, total: money(sale + nrldc) };
}

/**
 * The bills of a month that Finance has not booked yet.
 *
 * Only issued bills count: a draft is not a sale, and a cancelled one never
 * was. A bill already on a live posting is excluded, which is what stops a
 * month being booked twice.
 */
export function bookableBills(contractId, periodMonth, category) {
  if (category === 'NOTES') return bookableNotes(contractId, periodMonth);
  const kinds = KINDS_BY_CATEGORY[category];
  if (!kinds) throw Object.assign(new Error(`bill_category must be one of ${CATEGORIES.join(', ')}`), { status: 400 });
  const placeholders = kinds.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT b.* FROM hydro_station_bills b
    WHERE b.contract_id = ? AND b.billing_month = ? AND b.status = 'ISSUED'
      AND b.bill_kind IN (${placeholders})
      AND NOT EXISTS (
        SELECT 1 FROM hydro_fi_posting_lines l
        JOIN hydro_fi_postings p ON p.id = l.posting_id
        WHERE l.bill_id = b.id AND p.status <> 'REVERSED'
      )
    ORDER BY b.created_at
  `).all(contractId, periodMonth, ...kinds);

  return rows.map((b) => ({ ...b, ...splitBill(b) }));
}

/**
 * The approved debit and credit notes of a month that Finance has not booked.
 *
 * A note restates the sale, so it books against the sale figure: a credit note
 * as a negative sale and a debit note as a positive one. Leaving them out kept
 * Finance's sale overstated by every credit note (Hydro QA run 14). The month a
 * note falls in is its note date, the date it carries as a document. Drafts,
 * rejected and withdrawn notes moved nothing and are not booked.
 */
export function bookableNotes(contractId, periodMonth) {
  return db.prepare(`
    SELECT n.* FROM hydro_notes n
    WHERE n.contract_id = ? AND substr(n.note_date, 1, 7) = ? AND n.status = 'APPROVED'
      AND NOT EXISTS (
        SELECT 1 FROM hydro_fi_posting_lines l
        JOIN hydro_fi_postings p ON p.id = l.posting_id
        WHERE l.note_id = n.id AND p.status <> 'REVERSED'
      )
    ORDER BY n.note_date, n.created_at
  `).all(contractId, periodMonth).map((n) => {
    const sale = money(n.note_type === 'CREDIT' ? -n.amount : n.amount);
    return {
      ...n, note_id: n.id, bill_no: n.note_no, bill_kind: `${n.note_type}_NOTE`,
      sale, nrldc: 0, tcs: 0, total: sale,
    };
  });
}

/** The live posting a note is on, if any. */
export function notePosting(noteId) {
  return db.prepare(`
    SELECT p.posting_no, p.status FROM hydro_fi_posting_lines l
    JOIN hydro_fi_postings p ON p.id = l.posting_id
    WHERE l.note_id = ? AND p.status <> 'REVERSED'
  `).get(noteId) || null;
}

/** Gather the month into a posting Finance can check before it is booked. */
export function preparePosting({
  contract, periodMonth, category = 'HYDRO', notes = null, createdBy = null,
}) {
  if (!/^\d{4}-\d{2}$/.test(String(periodMonth || ''))) {
    throw Object.assign(new Error('period_month must be YYYY-MM'), { status: 400 });
  }
  if (!CATEGORIES.includes(category)) {
    throw Object.assign(new Error(`bill_category must be one of ${CATEGORIES.join(', ')}`), { status: 400 });
  }

  // One posting waiting at a time. A posted month can still take a posting for
  // bills issued after it (a supplementary, an arrear), which used to need the
  // whole month reversed (Hydro QA run 14).
  const open = db.prepare(`
    SELECT posting_no, status FROM hydro_fi_postings
    WHERE contract_id = ? AND period_month = ? AND bill_category = ? AND status = 'PREPARED'
  `).get(contract.id, periodMonth, category);
  if (open) {
    throw Object.assign(
      new Error(`${periodMonth} is already prepared for ${category} — ${open.posting_no}; post or reverse it first`),
      { status: 409 },
    );
  }

  const bills = bookableBills(contract.id, periodMonth, category);
  const posted = db.prepare(`
    SELECT posting_no FROM hydro_fi_postings
    WHERE contract_id = ? AND period_month = ? AND bill_category = ? AND status = 'POSTED'
  `).get(contract.id, periodMonth, category);
  if (!bills.length && posted) {
    throw Object.assign(
      new Error(`${periodMonth} is already posted for ${category} — ${posted.posting_no}; no ${category === 'NOTES' ? 'note approved' : 'bill issued'} since is waiting to be booked`),
      { status: 409 },
    );
  }
  if (!bills.length) {
    throw Object.assign(
      new Error(category === 'NOTES'
        ? `No approved debit or credit notes for ${contract.contract_no} in ${periodMonth} are waiting to be booked`
        : `No issued ${category} bills for ${contract.contract_no} in ${periodMonth} are waiting to be booked`),
      { status: 400 },
    );
  }

  const sale = money(bills.reduce((a, b) => a + b.sale, 0));
  const nrldc = money(bills.reduce((a, b) => a + b.nrldc, 0));
  const tcs = money(bills.reduce((a, b) => a + b.tcs, 0));

  const id = newId('HFP');
  const no = postingNo(contract.plant_code, periodMonth, category);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO hydro_fi_postings (
        id, posting_no, contract_id, station_name, plant_code, period_month, bill_category,
        bills_count, sale_amount, nrldc_amount, tcs_amount, total_amount, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, no, contract.id, contract.station_name || contract.contract_no,
      contract.plant_code || null, periodMonth, category,
      bills.length, sale, nrldc, tcs, money(sale + nrldc + tcs), notes, createdBy,
    );

    const line = db.prepare(`
      INSERT INTO hydro_fi_posting_lines
        (id, posting_id, bill_id, note_id, bill_no, bill_kind, sale_amount, nrldc_amount, tcs_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of bills) {
      line.run(
        newId('HFL'), id, b.note_id ? null : b.id, b.note_id || null,
        b.bill_no, b.bill_kind, b.sale, b.nrldc, b.tcs, b.total,
      );
    }
  })();

  return getPosting(id);
}

/** Book a prepared posting, recording the voucher Finance returned. */
export function postToFinance(postingId, { fiDocumentNo = null, postedBy = null }) {
  const p = db.prepare('SELECT * FROM hydro_fi_postings WHERE id = ?').get(postingId);
  if (!p) throw Object.assign(new Error('Posting not found'), { status: 404 });
  if (p.status === 'POSTED') {
    throw Object.assign(new Error(`${p.posting_no} was already posted on ${p.posted_at}`), { status: 409 });
  }
  if (p.status === 'REVERSED') {
    throw Object.assign(new Error(`${p.posting_no} has been reversed — prepare the month again`), { status: 400 });
  }
  // The voucher is the only link from our record to Finance's; without it, or
  // with one already used, nothing ties the two together (Hydro QA run 14).
  const voucher = String(fiDocumentNo ?? '').trim();
  if (!voucher) {
    throw Object.assign(new Error('Enter the voucher (FI document) number Finance booked this under'), { status: 400 });
  }
  const used = db.prepare(`
    SELECT posting_no FROM hydro_fi_postings
    WHERE status = 'POSTED' AND id <> ? AND UPPER(fi_document_no) = UPPER(?)
  `).get(postingId, voucher);
  if (used) {
    throw Object.assign(new Error(`Voucher ${voucher} is already on ${used.posting_no}`), { status: 409 });
  }
  // A bill cancelled since the month was prepared is no longer a sale.
  const gone = db.prepare(`
    SELECT b.bill_no FROM hydro_fi_posting_lines l JOIN hydro_station_bills b ON b.id = l.bill_id
    WHERE l.posting_id = ? AND b.status <> 'ISSUED'
    UNION ALL
    SELECT n.note_no FROM hydro_fi_posting_lines l JOIN hydro_notes n ON n.id = l.note_id
    WHERE l.posting_id = ? AND n.status <> 'APPROVED'
  `).all(postingId, postingId).map((r) => r.bill_no);
  if (gone.length) {
    throw Object.assign(new Error(`${gone.join(', ')} ${gone.length > 1 ? 'are' : 'is'} no longer issued — reverse ${p.posting_no} and prepare the month again`), { status: 409 });
  }
  fiDocumentNo = voucher;

  db.prepare(`
    UPDATE hydro_fi_postings
    SET status = 'POSTED', fi_document_no = ?, posted_at = datetime('now'), posted_by = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(fiDocumentNo, postedBy, postingId);
  return getPosting(postingId);
}

/**
 * Back a posting out.
 *
 * The posting is marked rather than deleted and a reversing posting is written
 * beside it, so the handover still shows that the month went to Finance once
 * and came back. Reversing frees its bills and notes, so the month can be
 * prepared again.
 */
export function reversePosting(postingId, { reason, reversedBy = null }) {
  if (!reason) throw Object.assign(new Error('A reversal must say why'), { status: 400 });
  const p = db.prepare('SELECT * FROM hydro_fi_postings WHERE id = ?').get(postingId);
  if (!p) throw Object.assign(new Error('Posting not found'), { status: 404 });
  if (p.status === 'REVERSED') {
    throw Object.assign(new Error(`${p.posting_no} is already reversed`), { status: 400 });
  }
  // A prepared posting never reached Finance, so there is nothing to counter:
  // it is withdrawn, not answered with a negative entry Finance never had.
  if (p.status === 'PREPARED') {
    db.prepare(`
      UPDATE hydro_fi_postings
      SET status = 'REVERSED', reversed_at = datetime('now'), reversed_by = ?,
          reversal_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(reversedBy, `Withdrawn before posting: ${reason}`, postingId);
    return { reversed: p.posting_no, reversal_posting_no: null, reversal_id: null, withdrawn: true };
  }

  const id = newId('HFP');
  const no = `${p.posting_no}/REV`;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO hydro_fi_postings (
        id, posting_no, contract_id, station_name, plant_code, period_month, bill_category,
        bills_count, sale_amount, nrldc_amount, tcs_amount, total_amount,
        status, reverses_posting_id, reversal_reason, reversed_at, reversed_by, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REVERSED', ?, ?, datetime('now'), ?, ?)
    `).run(
      id, no, p.contract_id, p.station_name, p.plant_code, p.period_month, p.bill_category,
      p.bills_count, -p.sale_amount, -p.nrldc_amount, -p.tcs_amount, -p.total_amount,
      p.id, reason, reversedBy, reversedBy,
    );
    db.prepare(`
      UPDATE hydro_fi_postings
      SET status = 'REVERSED', reversed_at = datetime('now'), reversed_by = ?,
          reversal_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(reversedBy, reason, postingId);
  })();

  return { reversed: p.posting_no, reversal_posting_no: no, reversal_id: id };
}

/** A posting with the bills it booked. */
export function getPosting(id) {
  const p = db.prepare(`
    SELECT p.*, r.posting_no AS reverses_posting_no
    FROM hydro_fi_postings p
    LEFT JOIN hydro_fi_postings r ON r.id = p.reverses_posting_id
    WHERE p.id = ?
  `).get(id);
  if (!p) return null;
  const lines = db.prepare(
    'SELECT * FROM hydro_fi_posting_lines WHERE posting_id = ? ORDER BY created_at',
  ).all(id);
  return { ...p, category_label: CATEGORY_LABELS[p.bill_category], lines };
}

/** Postings for a station, newest month first. */
export function listPostings(contractId, { periodMonth = null, status = null } = {}) {
  return db.prepare(`
    SELECT * FROM hydro_fi_postings
    WHERE contract_id = ?
      AND (? IS NULL OR period_month = ?)
      AND (? IS NULL OR status = ?)
    ORDER BY period_month DESC, created_at DESC
  `).all(contractId, periodMonth, periodMonth, status, status)
    .map((p) => ({ ...p, category_label: CATEGORY_LABELS[p.bill_category] }));
}
