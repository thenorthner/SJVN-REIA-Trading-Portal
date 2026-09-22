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

export const CATEGORIES = ['HYDRO', 'ADDITIONAL', 'TCS'];

/** Which bill kinds fall under each category Finance books to. */
const KINDS_BY_CATEGORY = {
  HYDRO: ['PROVISIONAL', 'FINAL', 'REVISION'],
  ADDITIONAL: ['ADDITIONAL'],
  TCS: ['TCS'],
};

export const CATEGORY_LABELS = {
  HYDRO: 'Hydro energy sale (provisional, final and revision bills)',
  ADDITIONAL: 'Additional charges claimed',
  TCS: 'Tax collected at source',
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
function splitBill(bill) {
  const kind = bill.bill_kind;
  if (kind === 'TCS') {
    return { sale: 0, nrldc: 0, tcs: money(bill.total_charges), total: money(bill.total_charges) };
  }
  const sale = money(bill.total_charges);
  const nrldc = money(bill.nrldc_total_fee);
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

  const open = db.prepare(`
    SELECT posting_no, status FROM hydro_fi_postings
    WHERE contract_id = ? AND period_month = ? AND bill_category = ? AND status <> 'REVERSED'
  `).get(contract.id, periodMonth, category);
  if (open) {
    throw Object.assign(
      new Error(`${periodMonth} is already ${open.status === 'POSTED' ? 'posted' : 'prepared'} for ${category} — ${open.posting_no}`),
      { status: 409 },
    );
  }

  const bills = bookableBills(contract.id, periodMonth, category);
  if (!bills.length) {
    throw Object.assign(
      new Error(`No issued ${category} bills for ${contract.contract_no} in ${periodMonth} are waiting to be booked`),
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
        (id, posting_id, bill_id, bill_no, bill_kind, sale_amount, nrldc_amount, tcs_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of bills) {
      line.run(newId('HFL'), id, b.id, b.bill_no, b.bill_kind, b.sale, b.nrldc, b.tcs, b.total);
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
 * and came back. Reversing frees its bills, so the month can be prepared again.
 */
export function reversePosting(postingId, { reason, reversedBy = null }) {
  if (!reason) throw Object.assign(new Error('A reversal must say why'), { status: 400 });
  const p = db.prepare('SELECT * FROM hydro_fi_postings WHERE id = ?').get(postingId);
  if (!p) throw Object.assign(new Error('Posting not found'), { status: 404 });
  if (p.status === 'REVERSED') {
    throw Object.assign(new Error(`${p.posting_no} is already reversed`), { status: 400 });
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
