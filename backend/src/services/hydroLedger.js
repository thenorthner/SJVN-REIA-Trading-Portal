/**
 * The beneficiary ledger behind a hydro station bill — SAP's "Account Display".
 *
 * A station bill is one document, but fifteen beneficiaries pay against it
 * separately, so what each of them owes lives in its own running account. Every
 * movement in that account is a numbered document:
 *
 *   PB   periodic bill    the beneficiary's share of a station bill   (debit)
 *   LPS  surcharge        late payment surcharge on an overdue PB     (debit)
 *   PMT  payment          money received                              (credit)
 *   RBT  rebate           early-payment rebate allowed on a PB        (credit)
 *        — stored as a PMT with mode REBATE, pointing at the payment that
 *          earned it, so the table's type check did not have to be rebuilt.
 *   DN   debit note       an approved debit note: the beneficiary owes more
 *        — stored as a PB with mode DEBIT_NOTE, with its own due date, so it
 *          is paid, cleared and surcharged like any other bill.
 *   CN   credit note      an approved credit note: the beneficiary owes less
 *        — stored as a PMT with mode CREDIT_NOTE. It clears bills but is not
 *          money received, so it never counts as a collection or earns a rebate.
 *
 * A credit that has not been applied to anything is what the desk reads as ADV
 * (advance). That is a state rather than a document type: it falls out of having
 * no clearings, which is exactly why "reset clearing" turns a payment back into
 * an advance without rewriting the payment.
 *
 * Amounts are always stored positive. The document type says which side of the
 * account it falls on, so no call site has to remember a sign convention.
 */
import db from '../db/index.js';
import { newId } from '../util.js';
import { getParamNumber, getParam } from '../mastersService.js';
import { tieredRebatePct, daysBetween } from '../disputesConstants.js';
import { resolvePaymentTermsDays, addDays, contractRebatePct } from '../util.js';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Rupee amounts below this are rounding dust, not a balance worth chasing. */
const EPSILON = 0.005;

const DEBIT_TYPES = ['PB', 'LPS'];
const CREDIT_TYPES = ['PMT'];

/** A rebate credit — allowed by SJVN, not money received. */
const isRebate = (doc) => doc?.doc_type === 'PMT' && doc?.mode === 'REBATE';
const isCreditNote = (doc) => doc?.doc_type === 'PMT' && doc?.mode === 'CREDIT_NOTE';
const isDebitNote = (doc) => doc?.doc_type === 'PB' && doc?.mode === 'DEBIT_NOTE';
// Tax the beneficiary deducted at source and paid to government on SJVN's
// account: it settles the bill, but no money reached SJVN's bank.
const isTds = (doc) => doc?.doc_type === 'PMT' && doc?.mode === 'TDS';

/** Payment modes the ledger keeps for its own documents, which a payment entry may not use. */
export const RESERVED_MODES = ['REBATE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'TDS', 'LC_INVOCATION'];

/**
 * Document numbers the desk can read aloud and search on.
 *
 * The type is in the number because the Account Display is read by type first —
 * "which PB is this PMT against" — and a bare serial would make that a lookup.
 */
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export function genDocNo(docType, periodMonth) {
  const stamp = String(periodMonth || new Date().toISOString().slice(0, 7)).replace('-', '');
  for (let i = 0; i < 12; i += 1) {
    const rand = Math.floor(100000 + Math.random() * 900000);
    const no = `${docType}/${stamp}/${rand}`;
    if (!db.prepare('SELECT 1 FROM hydro_ledger_docs WHERE doc_no = ?').get(no)) return no;
  }
  throw new Error(`Could not allocate a ${docType} document number`);
}

/** How much of a debit document is still unpaid. */
export function outstandingOf(docId) {
  const doc = db.prepare('SELECT * FROM hydro_ledger_docs WHERE id = ?').get(docId);
  if (!doc || doc.status === 'REVERSED') return 0;
  const applied = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) s FROM hydro_ledger_clearings WHERE debit_doc_id = ?',
  ).get(docId).s;
  return money(doc.amount - applied);
}

/** How much of a credit document has not been applied to anything yet. */
export function unappliedOf(docId) {
  const doc = db.prepare('SELECT * FROM hydro_ledger_docs WHERE id = ?').get(docId);
  if (!doc || doc.status === 'REVERSED') return 0;
  const applied = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) s FROM hydro_ledger_clearings WHERE credit_doc_id = ?',
  ).get(docId).s;
  return money(doc.amount - applied);
}

export function insertDoc(row) {
  const id = newId('HLD');
  db.prepare(`
    INSERT INTO hydro_ledger_docs (
      id, doc_no, contract_id, beneficiary_name, beneficiary_id, doc_type,
      bill_id, bill_line_id, amount, doc_date, due_date, status,
      reverses_doc_no, mode, reference, info, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)
  `).run(
    id, row.doc_no, row.contract_id, row.beneficiary_name, row.beneficiary_id || null,
    row.doc_type, row.bill_id || null, row.bill_line_id || null, money(row.amount),
    row.doc_date, row.due_date || null, row.reverses_doc_no || null,
    row.mode || null, row.reference || null, row.info || null, row.created_by || null,
  );
  return db.prepare('SELECT * FROM hydro_ledger_docs WHERE id = ?').get(id);
}

/**
 * The date a beneficiary must pay by.
 *
 * Taken from the contract's own payment terms rather than a constant, because
 * the terms are what the PPA actually says and they differ between stations.
 */
export function dueDateFor(contract, billDate) {
  const days = resolvePaymentTermsDays(contract, getParamNumber('default_payment_terms_days', 45));
  return addDays(billDate, days);
}

/** Energy bills: the monthly tariff bill and the documents that restate it. */
const ENERGY_KINDS = ['PROVISIONAL', 'FINAL', 'REVISION'];
const lineAmount = (l) => money(Number(l.total_charges) + Number(l.nrldc_fee || 0));

/**
 * What each beneficiary already stands billed for a station-month, as the
 * ledger carries it: the latest issued energy bill for the month (other than
 * `exceptBillId`), plus any arrear issued on the month after it.
 *
 * A revision or a final bill restates a month that has usually been billed
 * already, so only the difference against this is new money owed — posting the
 * restated bill in full would bill the month twice.
 */
export function billedForMonth(contractId, month, { exceptBillId = null } = {}) {
  const basis = db.prepare(`
    SELECT * FROM hydro_station_bills
    WHERE contract_id = ? AND billing_month = ? AND status = 'ISSUED' AND id <> ?
      AND bill_kind IN (${ENERGY_KINDS.map(() => '?').join(',')})
    ORDER BY issued_at DESC, created_at DESC LIMIT 1
  `).get(contractId, month, exceptBillId || '', ...ENERGY_KINDS);
  const byName = {};
  // What arrears already added, split as capacity and energy, per beneficiary:
  // a later arrear is the difference against these as well as the bill.
  const arrearSplit = {};
  if (basis) {
    for (const l of db.prepare('SELECT * FROM hydro_bill_lines WHERE bill_id = ?').all(basis.id)) {
      byName[l.beneficiary_name] = money((byName[l.beneficiary_name] || 0) + lineAmount(l));
    }
  }
  // Arrears raised on the month after that bill was issued.
  let arrears = [];
  try {
    arrears = db.prepare(`
      SELECT m.lines_json FROM hydro_arrear_months m
      JOIN hydro_station_bills a ON a.id = m.arrear_bill_id
      WHERE a.contract_id = ? AND m.billing_month = ? AND a.status = 'ISSUED' AND a.id <> ?
        AND (? IS NULL OR a.issued_at >= ?)
    `).all(contractId, month, exceptBillId || '', basis?.issued_at ?? null, basis?.issued_at ?? null);
  } catch { /* no arrear table on a database that predates it */ }
  for (const r of arrears) {
    for (const l of JSON.parse(r.lines_json || '[]')) {
      byName[l.beneficiary_name] = money((byName[l.beneficiary_name] || 0) + Number(l.differential || 0));
      const cur = arrearSplit[l.beneficiary_name] || { capacity: 0, energy: 0 };
      cur.capacity = money(cur.capacity + Number(l.capacity_differential || 0));
      cur.energy = money(cur.energy + Number(l.energy_differential || 0));
      arrearSplit[l.beneficiary_name] = cur;
    }
  }
  return { basis, byName, arrearSplit };
}

/**
 * Post a station bill to the beneficiaries' accounts when it is issued.
 *
 * This is the moment the bill stops being an internal calculation and becomes
 * money fifteen parties owe, so it happens on issue and not on save. Idempotent:
 * a bill whose documents already exist is left alone rather than double-posted.
 *
 * What is posted depends on the kind of bill:
 *   - a provisional bill, a claim, a supplementary bill: each line in full;
 *   - a revision or final bill: each line less what the month already stands
 *     billed at (billedForMonth), so the month is never billed twice;
 *   - an arrear bill: its lines, which already are the differences.
 * A difference that comes out negative is a credit to the beneficiary and is
 * posted as a credit note against its open bills, not dropped.
 */
export function postBillToLedger(bill, { createdBy = null } = {}) {
  const existing = db.prepare(
    `SELECT COUNT(*) c FROM hydro_ledger_docs WHERE bill_id = ? AND status = 'OPEN'`,
  ).get(bill.id).c;
  if (existing > 0) return { posted: 0, already: existing };

  const lines = db.prepare('SELECT * FROM hydro_bill_lines WHERE bill_id = ? ORDER BY sr_no').all(bill.id);
  const billDate = (bill.issued_at || bill.created_at || new Date().toISOString()).slice(0, 10);
  const restates = ['REVISION', 'FINAL'].includes(bill.bill_kind);
  const already = restates ? billedForMonth(bill.contract_id, bill.billing_month, { exceptBillId: bill.id }).byName : {};

  const posted = [];
  const credits = [];
  db.transaction(() => {
    for (const line of lines) {
      // NRLDC fees are billed through to the beneficiary alongside its own
      // charges, so the account carries one figure to pay rather than two.
      const amount = money(lineAmount(line) - (already[line.beneficiary_name] || 0));
      const base = {
        contract_id: bill.contract_id,
        beneficiary_name: line.beneficiary_name,
        beneficiary_id: line.beneficiary_id,
        bill_id: bill.id,
        bill_line_id: line.id,
        doc_date: billDate,
        created_by: createdBy,
      };
      const what = `${bill.bill_no} — ${bill.station_name} ${bill.billing_month} ${bill.bill_kind.toLowerCase()}`;
      if (amount > EPSILON) {
        posted.push(insertDoc({
          ...base,
          doc_no: genDocNo('PB', bill.billing_month),
          doc_type: 'PB',
          amount,
          due_date: bill.due_date,
          info: restates ? `${what} (difference over the month as already billed)` : what,
        }));
      } else if (amount < -EPSILON) {
        const cn = insertDoc({
          ...base,
          doc_no: genDocNo('CN', bill.billing_month),
          doc_type: 'PMT',
          mode: 'CREDIT_NOTE',
          reference: bill.bill_no,
          amount: -amount,
          info: `${what} — billed less than before; the difference is credited`,
        });
        posted.push(cn);
        credits.push(cn);
      }
    }
  })();
  for (const cn of credits) applyCredit(cn.id, { onDate: billDate, createdBy, rebate: false });
  return { posted: posted.length, docs: posted, credits: credits.length };
}

/** The debit documents a beneficiary still owes on, oldest first. */
export function openDebits(contractId, beneficiaryName) {
  const rows = db.prepare(`
    SELECT * FROM hydro_ledger_docs
    WHERE contract_id = ? AND beneficiary_name = ? AND status = 'OPEN'
      AND doc_type IN ('PB','LPS')
    -- MoP LPS Rules 2022, rule 5: a payment goes first to late payment
    -- surcharge, then to the bills, the longest overdue first.
    ORDER BY CASE doc_type WHEN 'LPS' THEN 0 ELSE 1 END, COALESCE(due_date, doc_date), doc_date, created_at
  `).all(contractId, beneficiaryName);
  return rows
    .map((d) => ({ ...d, outstanding: outstandingOf(d.id) }))
    .filter((d) => d.outstanding > EPSILON);
}

/** The credit documents with money still sitting on them (the advances). */
export function openCredits(contractId, beneficiaryName) {
  const rows = db.prepare(`
    SELECT * FROM hydro_ledger_docs
    WHERE contract_id = ? AND beneficiary_name = ? AND status = 'OPEN' AND doc_type = 'PMT'
      AND COALESCE(mode, '') <> 'REBATE'
    ORDER BY doc_date, created_at
  `).all(contractId, beneficiaryName);
  return rows
    .map((d) => ({ ...d, unapplied: unappliedOf(d.id) }))
    .filter((d) => d.unapplied > EPSILON);
}

/**
 * Apply a credit to the beneficiary's open debits, oldest first.
 *
 * Oldest-first is the convention the account is read in, and it is what makes a
 * surcharge stop growing on the bill that has been outstanding longest. Anything
 * left over stays on the credit and shows as an advance.
 */
/**
 * The early-payment rebate a beneficiary earns on a bill by paying it on
 * `payDate`, as a fraction of the amount it settles.
 *
 * CERC's tariff regulations give 1.5% for payment within five days of the bill
 * being presented and 1% within thirty; the platform holds that as the
 * `early_payment_rebate_tiers` master, and a station contract with its own
 * rebate terms uses those instead. It is on the station's charges only — the
 * NRLDC fee billed alongside is a pass-through and earns none.
 */
export function rebateRateFor(pb, payDate, contract = null) {
  const c = contract || db.prepare('SELECT rebate_pct, rebate_days, rebate_basis FROM contracts WHERE id = ?').get(pb.contract_id);
  let pct = contractRebatePct(c, { billDate: pb.doc_date, dueDate: pb.due_date, payDate: new Date(payDate) });
  if (pct === null) {
    pct = tieredRebatePct(Math.max(0, daysBetween(new Date(pb.doc_date), new Date(payDate))), getParam('early_payment_rebate_tiers', null));
  }
  if (!(pct > 0)) return { pct: 0, rate: 0 };
  const line = pb.bill_line_id
    ? db.prepare('SELECT total_charges, nrldc_fee FROM hydro_bill_lines WHERE id = ?').get(pb.bill_line_id)
    : null;
  const charges = Number(line?.total_charges) || 0;
  const fee = Number(line?.nrldc_fee) || 0;
  const eligible = line && charges + fee > 0 ? charges / (charges + fee) : 1;
  return { pct, rate: (pct / 100) * eligible };
}

export function applyCredit(creditDocId, { onDate, createdBy = null, targetDebitIds = null, rebate = true } = {}) {
  const credit = db.prepare('SELECT * FROM hydro_ledger_docs WHERE id = ?').get(creditDocId);
  if (!credit) throw new Error('Payment document not found');
  if (credit.status === 'REVERSED') throw new Error(`${credit.doc_no} has been reversed`);
  if (!CREDIT_TYPES.includes(credit.doc_type)) throw new Error(`${credit.doc_no} is not a payment`);
  if (isRebate(credit)) throw new Error(`${credit.doc_no} is a rebate, not money to apply`);

  let remaining = unappliedOf(creditDocId);
  if (remaining <= EPSILON) return { applied: 0, clearings: [], unapplied: remaining, rebate: 0, rebates: [] };

  let debits = openDebits(credit.contract_id, credit.beneficiary_name);
  if (targetDebitIds) {
    const wanted = new Set(targetDebitIds);
    debits = debits.filter((d) => wanted.has(d.id));
  }

  const clearings = [];
  const rebates = [];
  const insert = db.prepare(`
    INSERT INTO hydro_ledger_clearings (id, credit_doc_id, debit_doc_id, amount, cleared_on, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const on = onDate || credit.doc_date;
  const contract = db.prepare('SELECT rebate_pct, rebate_days, rebate_basis FROM contracts WHERE id = ?').get(credit.contract_id);

  db.transaction(() => {
    for (const debit of debits) {
      if (remaining <= EPSILON) break;
      // The rebate is earned by when the money arrived, not by when an advance
      // was later set against the bill.
      // A credit note is not money arriving, and a debit note is not the
      // station's energy bill, so neither side of either earns a rebate.
      const { pct, rate } = rebate && !isCreditNote(credit) && !isTds(credit) && debit.doc_type === 'PB' && !isDebitNote(debit)
        ? rebateRateFor(debit, credit.doc_date, contract) : { pct: 0, rate: 0 };
      let cash;
      let allowed = 0;
      if (rate > 0) {
        // Paying (1 - rate) of the bill settles all of it; a part payment
        // settles its own share grossed up by the rebate it earns.
        const need = money(debit.outstanding * (1 - rate));
        if (remaining >= need - EPSILON) {
          cash = Math.min(remaining, need);
          allowed = money(debit.outstanding - cash);
        } else {
          cash = remaining;
          allowed = money(Math.min(debit.outstanding - cash, (remaining * rate) / (1 - rate)));
        }
      } else {
        cash = money(Math.min(remaining, debit.outstanding));
      }
      if (cash > EPSILON) {
        const id = newId('HLC');
        insert.run(id, creditDocId, debit.id, cash, on, createdBy);
        clearings.push({ id, debit_doc_no: debit.doc_no, amount: cash });
        remaining = money(remaining - cash);
      }
      if (allowed > EPSILON) {
        const days = Math.max(0, daysBetween(new Date(debit.doc_date), new Date(credit.doc_date)));
        const rb = insertDoc({
          doc_no: genDocNo('RBT', String(credit.doc_date).slice(0, 7)),
          contract_id: credit.contract_id,
          beneficiary_name: credit.beneficiary_name,
          beneficiary_id: credit.beneficiary_id,
          doc_type: 'PMT',
          amount: allowed,
          doc_date: credit.doc_date,
          mode: 'REBATE',
          reference: credit.doc_no,
          info: `Rebate ${pct}% on ${debit.doc_no} — paid ${days} day(s) after the bill`,
          created_by: createdBy,
        });
        insert.run(newId('HLC'), rb.id, debit.id, allowed, on, createdBy);
        rebates.push({ doc_no: rb.doc_no, debit_doc_no: debit.doc_no, amount: allowed, pct });
      }
    }
  })();

  return {
    applied: money(credit.amount - remaining),
    clearings,
    unapplied: remaining,
    rebate: money(rebates.reduce((a, r) => a + r.amount, 0)),
    rebates,
  };
}

/** Withdraw the rebates a payment earned, when the payment is undone or released. */
function withdrawRebatesOf(pmt, reason) {
  const docs = db.prepare(`
    SELECT id FROM hydro_ledger_docs
    WHERE doc_type = 'PMT' AND mode = 'REBATE' AND reference = ? AND status = 'OPEN'
      AND contract_id = ? AND beneficiary_name = ?
  `).all(pmt.doc_no, pmt.contract_id, pmt.beneficiary_name);
  for (const d of docs) {
    db.prepare('DELETE FROM hydro_ledger_clearings WHERE credit_doc_id = ?').run(d.id);
    db.prepare(`UPDATE hydro_ledger_docs SET status = 'REVERSED', reversal_reason = ? WHERE id = ?`).run(reason, d.id);
  }
  return docs.length;
}

/**
 * Record money received from a beneficiary and apply it to what they owe.
 *
 * A payment larger than the outstanding balance is not refused — beneficiaries
 * do pay ahead, and SAP shows the excess as an advance — but the excess is
 * reported so it is never mistaken for a cleared bill.
 */
export function recordPayment({
  contractId, beneficiaryName, beneficiaryId = null, amount, paymentDate,
  mode = null, reference = null, info = null, createdBy = null, rebate = true,
}) {
  const amt = money(amount);
  if (!(amt > 0)) throw new Error('A payment must be a positive amount');
  if (mode && RESERVED_MODES.includes(String(mode).trim().toUpperCase())) {
    throw new Error(`"${mode}" is not a payment mode — rebates and debit/credit notes are posted by the ledger itself`);
  }
  if (!contractId || !beneficiaryName) throw new Error('contractId and beneficiaryName are required');
  if (!paymentDate) throw new Error('paymentDate is required');
  // Hydro QA run 4: a payment dated 2099 was taken, money for a name no
  // station bills sat as a phantom advance, and one UTR was posted twice.
  const day = String(paymentDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new Error('paymentDate must be a date (YYYY-MM-DD)');
  if (day > istToday()) throw new Error(`The payment date ${day} is after today — record money once it has arrived`);
  const known = db.prepare(`
    SELECT 1 FROM hydro_beneficiary_allocations WHERE contract_id = ? AND UPPER(TRIM(beneficiary_name)) = UPPER(TRIM(?))
    UNION SELECT 1 FROM hydro_bill_lines l JOIN hydro_station_bills b ON b.id = l.bill_id
      WHERE b.contract_id = ? AND UPPER(TRIM(l.beneficiary_name)) = UPPER(TRIM(?))
  `).get(contractId, beneficiaryName, contractId, beneficiaryName);
  if (!known) throw new Error(`${beneficiaryName} is not a beneficiary of this station`);
  const ref = String(reference || '').trim();
  if (ref) {
    const dup = db.prepare(`
      SELECT doc_no FROM hydro_ledger_docs WHERE contract_id = ? AND beneficiary_name = ? AND doc_type = 'PMT'
        AND COALESCE(mode, '') <> 'REBATE' AND status <> 'REVERSED' AND UPPER(TRIM(reference)) = UPPER(?)
    `).get(contractId, beneficiaryName, ref);
    if (dup) throw Object.assign(new Error(`${ref} is already on ${beneficiaryName}'s account as ${dup.doc_no} — the same payment cannot be recorded twice`), { status: 409 });
  }

  const doc = insertDoc({
    doc_no: genDocNo('PMT', paymentDate.slice(0, 7)),
    contract_id: contractId,
    beneficiary_name: beneficiaryName,
    beneficiary_id: beneficiaryId,
    doc_type: 'PMT',
    amount: amt,
    doc_date: paymentDate,
    mode,
    reference,
    info,
    created_by: createdBy,
  });

  const applied = applyCredit(doc.id, { onDate: paymentDate, createdBy, rebate });
  return { doc, ...applied };
}

/**
 * Undo a payment entirely: the clearings go, and the bills it paid reopen.
 *
 * The payment document is marked rather than deleted, and the reversal is its
 * own document, so the account still shows that money arrived and went back.
 */
export function reversePayment(paymentDocId, { reason, onDate = null, createdBy = null }) {
  const pmt = db.prepare('SELECT * FROM hydro_ledger_docs WHERE id = ?').get(paymentDocId);
  if (!pmt) throw new Error('Payment document not found');
  if (pmt.doc_type !== 'PMT') throw new Error(`${pmt.doc_no} is not a payment`);
  if (isRebate(pmt)) throw new Error(`${pmt.doc_no} is a rebate — reverse the payment that earned it`);
  if (isCreditNote(pmt)) throw new Error(`${pmt.doc_no} is a credit note — correct it with a debit note, not by reversing it as a payment`);
  if (pmt.status === 'REVERSED') throw new Error(`${pmt.doc_no} is already reversed`);
  if (!reason) throw new Error('A reversal must say why');

  const on = onDate || new Date().toISOString().slice(0, 10);
  let reversal;
  db.transaction(() => {
    db.prepare('DELETE FROM hydro_ledger_clearings WHERE credit_doc_id = ?').run(paymentDocId);
    // A rebate stands only on the payment that earned it.
    withdrawRebatesOf(pmt, `Payment ${pmt.doc_no} reversed: ${reason}`);
    reversal = insertDoc({
      doc_no: genDocNo('PMT', on.slice(0, 7)),
      contract_id: pmt.contract_id,
      beneficiary_name: pmt.beneficiary_name,
      beneficiary_id: pmt.beneficiary_id,
      doc_type: 'PMT',
      amount: pmt.amount,
      doc_date: on,
      reverses_doc_no: pmt.doc_no,
      info: `Reversal of ${pmt.doc_no}: ${reason}`,
      created_by: createdBy,
    });
    // The reversal is a bookkeeping counter-entry, not money to spend, so it is
    // closed immediately rather than left sitting as an advance.
    db.prepare(`UPDATE hydro_ledger_docs SET status = 'REVERSED', reversed_by_doc_no = ?, reversal_reason = ? WHERE id = ?`)
      .run(reversal.doc_no, reason, paymentDocId);
    db.prepare(`UPDATE hydro_ledger_docs SET status = 'REVERSED', reversed_by_doc_no = ? WHERE id = ?`)
      .run(pmt.doc_no, reversal.id);
  })();

  return { reversed: pmt.doc_no, reversal_doc_no: reversal.doc_no };
}

/**
 * Unhook a payment from the bills it cleared, leaving the money as an advance.
 *
 * This is SAP's "reset clearing", and it exists for one reason: a bill cannot be
 * reversed while a payment is sitting against it, so the payment is released
 * first and re-applied afterwards. The money stays in the account throughout.
 */
export function resetClearing(paymentDocId, { createdBy = null } = {}) {
  const pmt = db.prepare('SELECT * FROM hydro_ledger_docs WHERE id = ?').get(paymentDocId);
  if (!pmt) throw new Error('Payment document not found');
  if (pmt.doc_type !== 'PMT') throw new Error(`${pmt.doc_no} is not a payment`);
  if (isRebate(pmt)) throw new Error(`${pmt.doc_no} is a rebate — reset the payment that earned it`);
  if (pmt.status === 'REVERSED') throw new Error(`${pmt.doc_no} has been reversed`);

  const cleared = db.prepare(
    'SELECT COUNT(*) c FROM hydro_ledger_clearings WHERE credit_doc_id = ?',
  ).get(paymentDocId).c;
  if (!cleared) throw new Error(`${pmt.doc_no} is not applied to any bill — it is already an advance`);

  let withdrawn = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM hydro_ledger_clearings WHERE credit_doc_id = ?').run(paymentDocId);
    // The rebate goes with the clearing: applying the advance again earns it afresh.
    withdrawn = withdrawRebatesOf(pmt, `Clearing of ${pmt.doc_no} reset`);
  })();
  return { doc_no: pmt.doc_no, released: cleared, rebates_withdrawn: withdrawn, unapplied: unappliedOf(paymentDocId) };
}

/**
 * Apply an advance sitting on the account to specific open bills.
 *
 * SAP calls this account maintenance. Without a target it behaves like a
 * payment and clears oldest first.
 */
export function accountMaintenance(paymentDocId, { debitDocIds = null, onDate = null, createdBy = null } = {}) {
  const pmt = db.prepare('SELECT * FROM hydro_ledger_docs WHERE id = ?').get(paymentDocId);
  if (!pmt) throw new Error('Advance document not found');
  if (isRebate(pmt)) throw new Error(`${pmt.doc_no} is a rebate, not an advance`);
  if (unappliedOf(paymentDocId) <= EPSILON) throw new Error(`${pmt.doc_no} has nothing left to apply`);
  return applyCredit(paymentDocId, {
    onDate: onDate || new Date().toISOString().slice(0, 10),
    createdBy,
    targetDebitIds: debitDocIds,
  });
}

const DAY_MS = 86400000;
const utcDay = (d) => {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
};
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Late payment surcharge earned on one bill, from its due date to `asOf`.
 *
 * Every day past the due date is charged on what was actually unpaid that day,
 * so money that came in late is surcharged for the days it was late and a bill
 * paid off late still carries the surcharge it earned — including one that was
 * cleared before anyone ran the LPS posting. MoP LPS Rules 2022: the base rate
 * for the first month of default, then +step for each further month, capped
 * at base + cap. No surcharge at all if the bill was settled inside the grace
 * days.
 */
export function lpsOnBill(pb, { annualPct, graceDays = 0, monthlyStepPct = 0, stepCapPct = 0, asOf = new Date() }) {
  const none = { lps: 0, days_overdue: 0, effective_pct: annualPct, outstanding: outstandingOf(pb.id) };
  if (!pb.due_date) return none;
  const due = utcDay(pb.due_date);
  const end = utcDay(asOf);
  if (end <= due) return none;

  const clearings = db.prepare(`
    SELECT amount, cleared_on FROM hydro_ledger_clearings WHERE debit_doc_id = ? ORDER BY cleared_on
  `).all(pb.id).map((c) => ({ amount: Number(c.amount), on: utcDay(c.cleared_on) }));

  // Unpaid on a day = the bill less everything cleared before that day. A
  // payment on day D covers day D itself, as the invoice engine counts it.
  const unpaidOn = (dayMs) => money(pb.amount - clearings.filter((c) => c.on < dayMs).reduce((a, c) => a + c.amount, 0));

  let lps = 0;
  let lastLate = 0;
  let pct = annualPct;
  for (let d = 1; due + d * DAY_MS <= end; d += 1) {
    const bal = unpaidOn(due + d * DAY_MS);
    if (bal <= EPSILON) break;
    const month = Math.floor((d - 1) / 30);
    pct = annualPct + Math.min((monthlyStepPct || 0) * month, stepCapPct || 0);
    lps += (bal * pct) / 100 / 365;
    lastLate = d;
  }
  if (lastLate <= (graceDays || 0)) return { ...none, days_overdue: lastLate };
  return { lps: Math.round(lps), days_overdue: lastLate, effective_pct: pct, outstanding: outstandingOf(pb.id) };
}

/**
 * Late payment surcharge accrued on a beneficiary's bills as of a date.
 *
 * Each bill is surcharged on its own balance and its own due date, which is
 * what the rules require: they run per bill, not per account. Bills already
 * paid off are included — a late payment earns surcharge even after it clears.
 */
export function accruedLpsFor(contractId, beneficiaryName, { asOf = new Date() } = {}) {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  const opts = {
    annualPct: contract?.lps_annual_pct ?? getParamNumber('lps_annual_pct', 15),
    graceDays: contract?.lps_grace_days ?? 0,
    monthlyStepPct: getParamNumber('lps_monthly_step_pct', 0.5),
    stepCapPct: getParamNumber('lps_step_cap_pct', 3),
    asOf,
  };

  const bills = db.prepare(`
    SELECT * FROM hydro_ledger_docs
    WHERE contract_id = ? AND beneficiary_name = ? AND doc_type = 'PB' AND status = 'OPEN' AND due_date IS NOT NULL
    ORDER BY due_date, doc_date, created_at
  `).all(contractId, beneficiaryName);
  const lines = [];
  for (const b of bills) {
    const calc = lpsOnBill(b, opts);
    // What has already been charged on this bill, so a second run does not
    // surcharge the same days twice.
    const alreadyCharged = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) s FROM hydro_ledger_docs
      WHERE bill_id = ? AND beneficiary_name = ? AND doc_type = 'LPS' AND status = 'OPEN'
    `).get(b.bill_id, beneficiaryName).s;
    if (calc.lps <= 0 && calc.outstanding <= EPSILON && alreadyCharged <= 0) continue;

    lines.push({
      doc_id: b.id,
      doc_no: b.doc_no,
      bill_id: b.bill_id,
      due_date: b.due_date,
      outstanding: calc.outstanding,
      days_overdue: calc.days_overdue,
      effective_pct: calc.effective_pct,
      accrued: money(calc.lps),
      already_charged: money(alreadyCharged),
      chargeable: money(Math.max(0, calc.lps - alreadyCharged)),
    });
  }
  return {
    beneficiary_name: beneficiaryName,
    as_of: isoDay(utcDay(asOf)),
    annual_pct: opts.annualPct,
    lines,
    total_accrued: money(lines.reduce((a, l) => a + l.accrued, 0)),
    total_chargeable: money(lines.reduce((a, l) => a + l.chargeable, 0)),
  };
}

/**
 * Raise LPS documents for what has accrued but not yet been charged.
 *
 * Only the increment is posted, so running this twice in a month does not
 * surcharge the same days again.
 */
export function postLps(contractId, beneficiaryName, { asOf = new Date(), createdBy = null } = {}) {
  const accrual = accruedLpsFor(contractId, beneficiaryName, { asOf });
  const on = accrual.as_of;
  const posted = [];
  db.transaction(() => {
    for (const l of accrual.lines) {
      if (l.chargeable <= EPSILON) continue;
      const src = db.prepare('SELECT * FROM hydro_ledger_docs WHERE id = ?').get(l.doc_id);
      posted.push(insertDoc({
        doc_no: genDocNo('LPS', on.slice(0, 7)),
        contract_id: contractId,
        beneficiary_name: beneficiaryName,
        beneficiary_id: src.beneficiary_id,
        doc_type: 'LPS',
        bill_id: l.bill_id,
        amount: l.chargeable,
        doc_date: on,
        due_date: on,
        info: `Late payment surcharge on ${l.doc_no} — ${l.days_overdue} days overdue at ${l.effective_pct}% p.a.`,
        created_by: createdBy,
      }));
    }
  })();
  return { posted: posted.length, docs: posted, accrual };
}

/**
 * The Account Display: every document on a beneficiary's account, with what
 * cleared what.
 *
 * `display_type` is what the desk reads on the screen: a payment with nothing
 * applied to it shows as ADV, which is why resetting a clearing appears to turn
 * a PMT into an advance.
 */
export function accountDisplay(contractId, beneficiaryName) {
  const docs = db.prepare(`
    SELECT * FROM hydro_ledger_docs
    WHERE contract_id = ? AND beneficiary_name = ?
    ORDER BY doc_date, created_at
  `).all(contractId, beneficiaryName);

  const clearingsByDebit = db.prepare(`
    SELECT c.debit_doc_id, c.amount, c.cleared_on, d.doc_no
    FROM hydro_ledger_clearings c JOIN hydro_ledger_docs d ON d.id = c.credit_doc_id
  `).all().reduce((m, r) => {
    (m[r.debit_doc_id] ||= []).push(r);
    return m;
  }, {});

  const rows = docs.map((d) => {
    const isDebit = DEBIT_TYPES.includes(d.doc_type);
    const applied = clearingsByDebit[d.id] || [];
    const outstanding = isDebit ? outstandingOf(d.id) : 0;
    const unapplied = isDebit ? 0 : unappliedOf(d.id);
    return {
      ...d,
      // How much of a credit is set against bills. The clearing rows are keyed
      // by the debit they paid, so a payment cannot see them from its own row —
      // without this a screen has no way to tell an applied payment from an
      // advance, and so no way to know whether a clearing can be reset.
      applied: isDebit ? 0 : money(d.amount - unapplied),
      // A payment carrying nothing applied is an advance on this screen.
      display_type: isRebate(d) ? 'RBT'
        : isCreditNote(d) ? 'CN'
        : isTds(d) ? 'TDS'
        : isDebitNote(d) ? 'DN'
        : (d.doc_type === 'PMT' && d.status === 'OPEN' && unapplied >= money(d.amount) - EPSILON ? 'ADV' : d.doc_type),
      side: isDebit ? 'DEBIT' : 'CREDIT',
      outstanding,
      unapplied,
      // The CLR DOC / CLR Date columns of the printed screen.
      clr_doc: applied.map((a) => a.doc_no).join(', ') || null,
      clr_date: applied.length ? applied[applied.length - 1].cleared_on : null,
    };
  });

  const debit = rows.filter((r) => r.side === 'DEBIT' && r.status === 'OPEN')
    .reduce((a, r) => a + r.amount, 0);
  const credit = rows.filter((r) => r.side === 'CREDIT' && r.status === 'OPEN')
    .reduce((a, r) => a + r.amount, 0);
  const rebateAllowed = rows.filter((r) => isRebate(r) && r.status === 'OPEN')
    .reduce((a, r) => a + r.amount, 0);
  const creditNotes = rows.filter((r) => isCreditNote(r) && r.status === 'OPEN')
    .reduce((a, r) => a + r.amount, 0);
  const debitNotes = rows.filter((r) => isDebitNote(r) && r.status === 'OPEN')
    .reduce((a, r) => a + r.amount, 0);
  const tds = rows.filter((r) => isTds(r) && r.status === 'OPEN')
    .reduce((a, r) => a + r.amount, 0);

  return {
    contract_id: contractId,
    beneficiary_name: beneficiaryName,
    rows,
    totals: {
      billed: money(rows.filter((r) => r.doc_type === 'PB' && !isDebitNote(r) && r.status === 'OPEN').reduce((a, r) => a + r.amount, 0)),
      debit_notes: money(debitNotes),
      credit_notes: money(creditNotes),
      surcharge: money(rows.filter((r) => r.doc_type === 'LPS' && r.status === 'OPEN').reduce((a, r) => a + r.amount, 0)),
      // Money in; the rebate SJVN allowed is a credit too, but not cash.
      received: money(credit - rebateAllowed - creditNotes - tds),
      tds: money(tds),
      rebate: money(rebateAllowed),
      outstanding: money(rows.reduce((a, r) => a + r.outstanding, 0)),
      advance: money(rows.reduce((a, r) => a + r.unapplied, 0)),
      balance: money(debit - credit),
    },
  };
}

/**
 * Whether a station bill can still be reversed.
 *
 * A bill that has been paid against cannot simply be withdrawn — SAP refuses it
 * and tells the user to reset the payment first, and so does this. Saying which
 * payments are in the way is what makes that instruction actionable.
 */
export function billReversalBlockers(billId) {
  const rows = db.prepare(`
    SELECT DISTINCT p.doc_no, p.beneficiary_name, c.amount
    FROM hydro_ledger_clearings c
    JOIN hydro_ledger_docs d ON d.id = c.debit_doc_id
    JOIN hydro_ledger_docs p ON p.id = c.credit_doc_id
    WHERE d.bill_id = ? AND d.status = 'OPEN'
    ORDER BY p.beneficiary_name
  `).all(billId);
  return rows;
}

/** Withdraw a bill's documents from the ledger when the bill is reversed. */
export function reverseBillDocs(billId, { reason, createdBy = null }) {
  const blockers = billReversalBlockers(billId);
  if (blockers.length) {
    throw new Error(
      `Payment already received against this bill (${blockers.map((b) => `${b.doc_no} — ${b.beneficiary_name}`).join('; ')}). `
      + 'Reset the clearing on those payments before reversing the bill.',
    );
  }
  const docs = db.prepare(
    `SELECT * FROM hydro_ledger_docs WHERE bill_id = ? AND status = 'OPEN'`,
  ).all(billId);
  db.transaction(() => {
    for (const d of docs) {
      // A credit the bill posted (a revision that came out lower) goes back
      // with what it cleared, or those bills would stay paid by nothing.
      if (CREDIT_TYPES.includes(d.doc_type)) {
        db.prepare('DELETE FROM hydro_ledger_clearings WHERE credit_doc_id = ?').run(d.id);
      }
      db.prepare(`UPDATE hydro_ledger_docs SET status = 'REVERSED', reversal_reason = ? WHERE id = ?`)
        .run(reason, d.id);
    }
  })();
  return { reversed: docs.length };
}

/** Every beneficiary with an account on this station, for the picker. */
export function beneficiariesWithAccounts(contractId) {
  return db.prepare(`
    SELECT beneficiary_name,
           COUNT(*) AS doc_count,
           MAX(doc_date) AS last_activity
    FROM hydro_ledger_docs WHERE contract_id = ?
    GROUP BY beneficiary_name ORDER BY beneficiary_name
  `).all(contractId).map((r) => ({
    ...r,
    outstanding: openDebits(contractId, r.beneficiary_name).reduce((a, d) => a + d.outstanding, 0),
  }));
}

/**
 * Receivables across a station's beneficiaries, aged by days past due — the
 * hydro desk's payment monitoring. Each open debit is placed in a bucket by how
 * far past its due date it is today; one not yet due is "current".
 */
export function receivablesAgeing(contractId, { asOf = new Date() } = {}) {
  const today = new Date(asOf);
  const bucketOf = (due) => {
    if (!due) return 'current';
    const days = Math.floor((today - new Date(due)) / 86400000);
    if (days <= 0) return 'current';
    if (days <= 30) return 'd1_30';
    if (days <= 60) return 'd31_60';
    if (days <= 90) return 'd61_90';
    return 'd90_plus';
  };
  const names = db.prepare(`
    SELECT DISTINCT beneficiary_name FROM hydro_ledger_docs WHERE contract_id = ? ORDER BY beneficiary_name
  `).all(contractId).map((r) => r.beneficiary_name);
  const rows = names.map((name) => {
    const debits = openDebits(contractId, name);
    const b = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    let oldestDue = null;
    for (const d of debits) {
      b[bucketOf(d.due_date)] = money(b[bucketOf(d.due_date)] + d.outstanding);
      if (d.due_date && (!oldestDue || d.due_date < oldestDue)) oldestDue = d.due_date;
    }
    const lastPayment = db.prepare(`
      SELECT doc_date, amount FROM hydro_ledger_docs
      WHERE contract_id = ? AND beneficiary_name = ? AND doc_type = 'PMT' AND status = 'OPEN'
        AND COALESCE(mode, '') NOT IN ('REBATE', 'CREDIT_NOTE')
      ORDER BY doc_date DESC, created_at DESC LIMIT 1
    `).get(contractId, name);
    let lpsAccrued = 0;
    try { lpsAccrued = money(accruedLpsFor(contractId, name, { asOf }).total_chargeable || 0); } catch { lpsAccrued = 0; }
    const outstanding = money(Object.values(b).reduce((x, y) => x + y, 0));
    const overdue = money(outstanding - b.current);
    const advance = money(openCredits(contractId, name).reduce((x, c) => x + c.unapplied, 0));
    return {
      beneficiary_name: name, ...b, outstanding, overdue, advance,
      oldest_due_date: oldestDue,
      days_overdue: oldestDue ? Math.max(0, Math.floor((today - new Date(oldestDue)) / 86400000)) : 0,
      last_payment_date: lastPayment?.doc_date || null,
      last_payment_amount: lastPayment?.amount || null,
      lps_accrued_not_charged: lpsAccrued,
    };
  });
  const sum = (k) => money(rows.reduce((x, r) => x + (r[k] || 0), 0));
  return {
    contract_id: contractId,
    as_of: today.toISOString().slice(0, 10),
    rows,
    totals: {
      current: sum('current'), d1_30: sum('d1_30'), d31_60: sum('d31_60'), d61_90: sum('d61_90'), d90_plus: sum('d90_plus'),
      outstanding: sum('outstanding'), overdue: sum('overdue'), advance: sum('advance'), lps_accrued_not_charged: sum('lps_accrued_not_charged'),
    },
  };
}

/**
 * Post a credit that is not money from the beneficiary's own pocket in the
 * ordinary way — TDS it deducted, an LC the bank honoured — and set it against
 * its open bills, oldest first or the ones named. No rebate is earned on it.
 */
export function postSpecialCredit({
  contractId, beneficiaryName, beneficiaryId = null, amount, onDate, mode, reference = null, info = null,
  createdBy = null, targetDebitIds = null,
}) {
  const amt = money(amount);
  if (!(amt > 0)) throw new Error('The amount must be greater than zero');
  if (!['TDS', 'LC_INVOCATION'].includes(mode)) throw new Error(`Unknown credit mode ${mode}`);
  const doc = insertDoc({
    doc_no: genDocNo(mode === 'TDS' ? 'TDS' : 'PMT', onDate.slice(0, 7)),
    contract_id: contractId,
    beneficiary_name: beneficiaryName,
    beneficiary_id: beneficiaryId,
    doc_type: 'PMT',
    mode,
    reference,
    amount: amt,
    doc_date: onDate,
    info,
    created_by: createdBy,
  });
  const applied = applyCredit(doc.id, { onDate, createdBy, targetDebitIds, rebate: false });
  return { doc, ...applied };
}

/** How a ledger document is classified on a statement of account. */
function statementKind(d) {
  if (d.doc_type === 'LPS') return 'surcharge';
  if (d.doc_type === 'PB') return isDebitNote(d) ? 'debit_notes' : 'billed';
  if (isRebate(d)) return 'rebate';
  if (isCreditNote(d)) return 'credit_notes';
  if (isTds(d)) return 'tds';
  return 'received';
}

/**
 * A beneficiary's statement of account for a period, from the ledger: the
 * opening balance, every movement in the period by kind, and the closing
 * balance. Reversed documents and their reversal entries net to nothing, so
 * both are left out.
 */
export function ledgerStatement(contractId, beneficiaryName, fromDate, toDate) {
  const docs = db.prepare(`
    SELECT * FROM hydro_ledger_docs
    WHERE contract_id = ? AND beneficiary_name = ? AND status = 'OPEN' AND reverses_doc_no IS NULL
      AND doc_date <= ?
    ORDER BY doc_date, created_at
  `).all(contractId, beneficiaryName, toDate);
  const sign = (d) => (DEBIT_TYPES.includes(d.doc_type) ? 1 : -1);
  let opening = 0;
  const movements = { billed: 0, debit_notes: 0, surcharge: 0, received: 0, rebate: 0, credit_notes: 0, tds: 0 };
  const lines = [];
  let running = 0;
  for (const d of docs) {
    if (d.doc_date < fromDate) { opening += sign(d) * d.amount; continue; }
  }
  running = money(opening);
  for (const d of docs) {
    if (d.doc_date < fromDate) continue;
    const kind = statementKind(d);
    movements[kind] = money(movements[kind] + d.amount);
    running = money(running + sign(d) * d.amount);
    lines.push({
      doc_no: d.doc_no, doc_date: d.doc_date, kind, info: d.info,
      debit: sign(d) > 0 ? money(d.amount) : 0, credit: sign(d) < 0 ? money(d.amount) : 0, balance: running,
    });
  }
  return { opening_balance: money(opening), movements, lines, closing_balance: running };
}

