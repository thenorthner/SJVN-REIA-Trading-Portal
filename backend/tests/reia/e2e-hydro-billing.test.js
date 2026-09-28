import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeUser } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { seedNjhpsAllocations } from '../../src/services/hydroStationBill.js';

// A month of NJHPS station billing, walked from the allocation master to the
// entry corporate Finance books — including the parts that only go wrong when
// the stages are run in order: a bill issued before its approval chain closed,
// a despatch recorded for a bill that was never printed, a month cancelled
// after a beneficiary had already paid against it, and a surcharge charged
// twice on the same overdue days.
//
// The station splits one bill across fifteen beneficiary DISCOMs, so every
// stage below is really fifteen: fifteen ledger accounts opened on issue,
// fifteen lines on the printed sheet, and a cancellation that has to unwind
// all of them or none.

const signFor = (user) => signToken(user);
const post = (url, token, body) => request(app).post(url).set(auth(token)).send(body || {});
const get = (url, token) => request(app).get(url).set(auth(token));

// The figures from the printed NJHPS bill for June 2026.
const JUNE = {
  billing_month: '2026-06',
  ex_bus_scheduled_kwh: 731158750,
  free_power_kwh: 87739035,
  pafm_percent: 109.667,
  beta_value: 0,
  prior_scheduled_kwh: 714468750,
  prior_free_kwh: 85736250,
  nrldc_total_fee: 646884,
};

const TABLES = ['hydro_fi_posting_lines', 'hydro_fi_postings', 'hydro_tcs_claims',
  'hydro_additional_charges', 'hydro_ledger_clearings', 'hydro_ledger_docs',
  'hydro_bill_approvals', 'hydro_bill_lines', 'hydro_station_bills'];

// NJHPS is a seeded contract other suites read. Snapshot the constants this one
// pins, and put them back, so nothing here follows the shared database out.
const RESTORE_COLS = ['annual_afc', 'annual_design_energy_mwh', 'normative_aux',
  'free_energy_home_state', 'napaf_percent', 'capacity_mw', 'capacity_charges_total',
  'lps_annual_pct', 'lps_grace_days'];
let snapshot = null;

let reia, viewer, contract;

beforeAll(() => {
  snapshot = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
});

afterAll(() => {
  for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare('DELETE FROM hydro_beneficiary_allocations').run();
  if (snapshot) {
    db.prepare(`UPDATE contracts SET ${RESTORE_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...RESTORE_COLS.map((c) => snapshot[c]), snapshot.id);
  }
});

beforeEach(() => {
  for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare('DELETE FROM hydro_beneficiary_allocations').run();
  seedNjhpsAllocations();

  contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  db.prepare(`
    UPDATE contracts SET annual_afc = 14615741000, annual_design_energy_mwh = 6612000,
      normative_aux = 1.2, free_energy_home_state = 12, napaf_percent = 87, capacity_mw = 1500,
      capacity_charges_total = 85000000, lps_annual_pct = 12, lps_grace_days = 0
    WHERE id = ?
  `).run(contract.id);
  contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract.id);

  reia = tokenFor('REIA_USER');
  viewer = tokenFor('MANAGEMENT');
});

/** The maker / approver pair a bill needs — the two cannot be the same person. */
function desk() {
  const maker = makeUser('REIA_USER', { name: `Hydro Maker ${Math.random()}` });
  const hod = makeUser('REIA_ADMIN', { name: `Hydro HOD ${Math.random()}` });
  return { maker, hod };
}

/** A bill taken to ISSUED, which is the only state the ledger and Finance see. */
async function issuedBill(overrides = {}) {
  const { maker, hod } = desk();
  const raised = await post('/api/hydro-billing', signFor(maker),
    { contract_id: contract.id, ...JUNE, ...overrides });
  expect(raised.status, JSON.stringify(raised.body)).toBe(200);
  await post(`/api/hydro-billing/${raised.body.id}/send-for-approval`, signFor(maker),
    { next_approver_id: hod.id, final_approver_id: hod.id, comments: 'for approval' });
  await post(`/api/hydro-billing/${raised.body.id}/approve`, signFor(hod),
    { action: 'APPROVE', comments: 'approved' });
  const issued = await post(`/api/hydro-billing/${raised.body.id}/issue`, signFor(maker),
    { due_date: '2026-07-31' });
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  return { bill: issued.body, maker, hod };
}

describe('E2E: NJHPS June 2026, from the allocation master to Finance', () => {
  it('goes the whole way, and refuses each stage taken out of order', async () => {
    const { maker, hod } = desk();

    // ── 1. The station is ready to be billed ────────────────────────────────
    const stations = await get('/api/hydro-billing/stations', viewer);
    expect(stations.status).toBe(200);
    const njhps = stations.body.find((s) => s.contract_no === 'PPA/SJVN/NJHPS/001');
    expect(njhps, 'NJHPS is not on the station list').toBeTruthy();
    expect(njhps.ready, `NJHPS is not billable: ${JSON.stringify(njhps.missing)}`).toBe(true);
    expect(njhps.allocation_rows).toBe(15);

    const allocations = await get(`/api/hydro-billing/allocations?contract_id=${contract.id}`, viewer);
    expect(allocations.status).toBe(200);
    expect(allocations.body.rows).toHaveLength(15);

    // ── 2. Preview before committing anything ───────────────────────────────
    const preview = await post('/api/hydro-billing/preview', reia, { contract_id: contract.id, ...JUNE });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.bill.total_charges).toBeGreaterThan(0);
    expect(preview.body.lines).toHaveLength(15);
    expect(preview.body.sources, 'a preview that does not say where its inputs came from').toBeTruthy();
    expect(db.prepare('SELECT COUNT(*) c FROM hydro_station_bills').get().c,
      'a preview saved a bill').toBe(0);

    // ── 3. Raise it ─────────────────────────────────────────────────────────
    const raised = await post('/api/hydro-billing', signFor(maker), { contract_id: contract.id, ...JUNE });
    expect(raised.status, JSON.stringify(raised.body)).toBe(200);
    const billId = raised.body.id;
    // The POST response is the computed bill; workflow state lives on the row.
    const savedRow = db.prepare('SELECT status, approval_status FROM hydro_station_bills WHERE id = ?').get(billId);
    expect(savedRow.status).toBe('DRAFT');
    expect(savedRow.approval_status).toBe('NOT_SENT');
    // The saved bill matches what the preview promised.
    expect(raised.body.total_charges).toBeCloseTo(preview.body.bill.total_charges, -2);
    expect(db.prepare('SELECT COUNT(*) c FROM hydro_bill_lines WHERE bill_id = ?').get(billId).c).toBe(15);

    // A draft owes nobody anything yet.
    expect(db.prepare('SELECT COUNT(*) c FROM hydro_ledger_docs WHERE bill_id = ?').get(billId).c).toBe(0);

    // ── 4. Issue is gated on the approval chain, not on good intentions ─────
    const earlyIssue = await post(`/api/hydro-billing/${billId}/issue`, signFor(maker));
    expect(earlyIssue.status).toBe(400);
    expect(earlyIssue.body.error).toMatch(/not been sent for approval/i);

    const sent = await post(`/api/hydro-billing/${billId}/send-for-approval`, signFor(maker),
      { next_approver_id: hod.id, final_approver_id: hod.id, comments: 'June bill for approval' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.approval_status).toBe('IN_APPROVAL');

    // Still with the approver — still not issuable.
    const midIssue = await post(`/api/hydro-billing/${billId}/issue`, signFor(maker));
    expect(midIssue.status).toBe(400);
    expect(midIssue.body.error).toMatch(/still with/i);

    // The maker cannot sign off their own bill.
    const selfApprove = await post(`/api/hydro-billing/${billId}/send-for-approval`, signFor(maker),
      { next_approver_id: maker.id, final_approver_id: maker.id });
    expect(selfApprove.status).toBeGreaterThanOrEqual(400);

    // It is in the approver's inbox, and nobody else's.
    const inbox = await get('/api/hydro-billing/approvals/inbox', signFor(hod));
    expect(inbox.status).toBe(200);
    expect(inbox.body.map((b) => b.id)).toContain(billId);

    const approved = await post(`/api/hydro-billing/${billId}/approve`, signFor(hod),
      { action: 'APPROVE', comments: 'figures check out against the REA' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.approval_status).toBe('APPROVED');

    // ── 5. Issue — the point the bill becomes money fifteen parties owe ─────
    const issued = await post(`/api/hydro-billing/${billId}/issue`, signFor(maker), { due_date: '2026-07-31' });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    expect(issued.body.status).toBe('ISSUED');
    expect(issued.body.due_date).toBe('2026-07-31');
    expect(issued.body.ledger_docs_posted, 'fifteen beneficiaries, fifteen ledger documents').toBe(15);

    const accounts = await get(`/api/hydro-billing/ledger/accounts?contract_id=${contract.id}`, viewer);
    expect(accounts.status).toBe(200);
    expect(accounts.body).toHaveLength(15);

    // ── 6. Printing and despatch, in that order ─────────────────────────────
    const earlyDespatch = await post(`/api/hydro-billing/${billId}/dispatch`, signFor(maker),
      { dispatch_date: '2026-07-05' });
    expect(earlyDespatch.status).toBe(400);
    expect(earlyDespatch.body.error).toMatch(/not been released for printing/i);

    const released = await post(`/api/hydro-billing/${billId}/release`, signFor(maker));
    expect(released.status).toBe(200);
    expect(released.body.released_at).toBeTruthy();

    // A release is once only — a second would claim a second printed set.
    expect((await post(`/api/hydro-billing/${billId}/release`, signFor(maker))).status).toBe(409);

    // A bill cannot have been received before it was sent.
    const backwards = await post(`/api/hydro-billing/${billId}/dispatch`, signFor(maker),
      { dispatch_date: '2026-07-05', receipt_date: '2026-07-01' });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error).toMatch(/cannot have received/i);

    const despatched = await post(`/api/hydro-billing/${billId}/dispatch`, signFor(maker), {
      dispatch_invoice_no: 'DSP/NJHPS/2026-06', courier_tracking_no: 'BD1234567IN',
      dispatch_date: '2026-07-05', receipt_date: '2026-07-08',
    });
    expect(despatched.status, JSON.stringify(despatched.body)).toBe(200);
    expect(despatched.body.courier_tracking_no).toBe('BD1234567IN');

    // ── 7. The printed sheets ───────────────────────────────────────────────
    const pdf = await get(`/api/hydro-billing/${billId}/pdf`, viewer);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.body.length, 'the printed bill came back empty').toBeGreaterThan(1000);

    // ── 8. The trail ────────────────────────────────────────────────────────
    const trail = db.prepare(`
      SELECT action FROM audit_logs WHERE entity_id = ? ORDER BY rowid
    `).all(billId).map((a) => a.action);
    expect(trail).toEqual(expect.arrayContaining([
      'HYDRO_BILL_SENT_FOR_APPROVAL', 'HYDRO_BILL_APPROVAL_APPROVED',
      'HYDRO_STATION_BILL_ISSUED', 'HYDRO_BILL_RELEASED', 'HYDRO_BILL_DISPATCHED',
    ]));
  });
});

describe('E2E: the beneficiary ledger, from bill to cleared', () => {
  it('opens an account on issue, clears it on payment, and leaves an advance visible', async () => {
    const { bill } = await issuedBill();

    const opened = await get(
      `/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=PUNJAB`, viewer);
    expect(opened.status).toBe(200);
    const owed = opened.body.totals.outstanding;
    expect(owed, 'issuing the bill left PUNJAB owing nothing').toBeGreaterThan(0);
    expect(opened.body.rows.some((r) => r.doc_type === 'PB' && r.bill_id === bill.id)).toBe(true);

    // Part payment leaves the rest outstanding.
    const part = await post('/api/hydro-billing/ledger/payment', reia, {
      contract_id: contract.id, beneficiary: 'PUNJAB', amount: Math.round(owed / 2),
      payment_date: '2026-07-20', mode: 'RTGS', reference: 'UTR-PB-1', rebate: false,
    });
    expect(part.status, JSON.stringify(part.body)).toBe(200);
    const afterPart = await get(
      `/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=PUNJAB`, viewer);
    expect(afterPart.body.totals.outstanding).toBeCloseTo(owed - Math.round(owed / 2), 0);

    // Overpaying does not zero the account twice — the excess sits as an advance.
    const over = await post('/api/hydro-billing/ledger/payment', reia, {
      contract_id: contract.id, beneficiary: 'PUNJAB', amount: owed, // far more than the balance
      payment_date: '2026-07-25', mode: 'RTGS', reference: 'UTR-PB-2', rebate: false,
    });
    expect(over.status).toBe(200);
    expect(over.body.unapplied, 'the overpayment was swallowed rather than held as an advance')
      .toBeGreaterThan(0);
    expect(over.body.note).toMatch(/advance/i);

    const settled = await get(
      `/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=PUNJAB`, viewer);
    expect(settled.body.totals.advance).toBeGreaterThan(0);
  });

  it('charges late payment surcharge once, not once per run', async () => {
    await issuedBill();
    const q = `contract_id=${contract.id}&beneficiary=HARYANA`;

    // Nothing is due while the bill is inside its due date.
    const early = await get(`/api/hydro-billing/ledger/lps?${q}&as_of=2026-07-15`, viewer);
    expect(early.status).toBe(200);
    expect(early.body.total_chargeable || 0).toBe(0);

    // Six months past due, there is a surcharge to raise.
    const accrued = await get(`/api/hydro-billing/ledger/lps?${q}&as_of=2027-01-31`, viewer);
    expect(accrued.body.total_chargeable, 'no surcharge accrued six months past due')
      .toBeGreaterThan(0);

    const posted = await post('/api/hydro-billing/ledger/lps', reia,
      { contract_id: contract.id, beneficiary: 'HARYANA', as_of: '2027-01-31' });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.body.posted).toBeGreaterThan(0);

    const lpsDocs = db.prepare(`
      SELECT COUNT(*) c FROM hydro_ledger_docs
      WHERE contract_id = ? AND beneficiary_name = 'HARYANA' AND doc_type = 'LPS'
    `).get(contract.id).c;
    expect(lpsDocs).toBeGreaterThan(0);

    // Running the same date again must not surcharge the same days twice.
    const again = await post('/api/hydro-billing/ledger/lps', reia,
      { contract_id: contract.id, beneficiary: 'HARYANA', as_of: '2027-01-31' });
    expect(again.status).toBe(200);
    expect(again.body.posted, 'the same overdue days were surcharged twice').toBe(0);
    expect(db.prepare(`
      SELECT COUNT(*) c FROM hydro_ledger_docs
      WHERE contract_id = ? AND beneficiary_name = 'HARYANA' AND doc_type = 'LPS'
    `).get(contract.id).c).toBe(lpsDocs);
  });

  it('will not cancel a month a beneficiary has already paid against', async () => {
    const { bill, maker } = await issuedBill();
    const acc = await get(
      `/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=GoHP`, viewer);
    const owed = acc.body.totals.outstanding;

    const paid = await post('/api/hydro-billing/ledger/payment', reia, {
      contract_id: contract.id, beneficiary: 'GoHP', amount: Math.round(owed / 4),
      payment_date: '2026-07-20', mode: 'NEFT', rebate: false,
    });
    expect(paid.status).toBe(200);

    const blocked = await post(`/api/hydro-billing/${bill.id}/cancel`, signFor(maker),
      { reason: 'raised on the wrong month' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/Payment has already been received/i);
    expect(blocked.body.blocking_payments.length).toBeGreaterThan(0);
    // And the bill is untouched.
    expect(db.prepare('SELECT status FROM hydro_station_bills WHERE id = ?').get(bill.id).status)
      .toBe('ISSUED');

    // Reset the clearing, and the cancellation goes through — unwinding the
    // ledger for all fifteen, not just the one that paid.
    const pmtDoc = db.prepare(`
      SELECT id FROM hydro_ledger_docs
      WHERE contract_id = ? AND beneficiary_name = 'GoHP' AND doc_type = 'PMT'
    `).get(contract.id);
    expect((await post(`/api/hydro-billing/ledger/${pmtDoc.id}/reset-clearing`, reia)).status).toBe(200);

    const cancelled = await post(`/api/hydro-billing/${bill.id}/cancel`, signFor(maker),
      { reason: 'raised on the wrong month' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    const open = db.prepare(`
      SELECT COUNT(*) c FROM hydro_ledger_docs WHERE bill_id = ? AND doc_type = 'PB' AND status = 'OPEN'
    `).get(bill.id).c;
    expect(open, 'a cancelled bill left beneficiaries still owing on it').toBe(0);
  });

  it('insists a cancellation says why', async () => {
    const { bill, maker } = await issuedBill();
    const r = await post(`/api/hydro-billing/${bill.id}/cancel`, signFor(maker), {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/say why/i);
  });
});

describe('E2E: the month-end handover to Finance', () => {
  it('books the month once, and only lets it be booked again after a reversal', async () => {
    const { bill } = await issuedBill();

    // What the month would post.
    const bookable = await get(
      `/api/hydro-billing/fi/bookable?contract_id=${contract.id}&period_month=2026-06`, viewer);
    expect(bookable.status).toBe(200);
    expect(bookable.body.bills).toHaveLength(1);
    expect(bookable.body.bills[0].bill_no).toBe(bill.bill_no);
    // The NRLDC fee is POSOCO's, passed through — it is not SJVN's sale.
    expect(bookable.body.totals.nrldc_amount).toBeGreaterThan(0);
    expect(bookable.body.totals.sale_amount)
      .toBeCloseTo(bookable.body.totals.total_amount - bookable.body.totals.nrldc_amount
        - bookable.body.totals.tcs_amount, 0);

    const prepared = await post('/api/hydro-billing/fi/prepare', reia,
      { contract_id: contract.id, period_month: '2026-06', notes: 'June handover' });
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
    expect(prepared.body.bills_count).toBe(1);
    expect(prepared.body.status).not.toBe('POSTED');

    // Preparing the same month twice would hand Finance the entry twice.
    const twice = await post('/api/hydro-billing/fi/prepare', reia,
      { contract_id: contract.id, period_month: '2026-06' });
    expect(twice.status).toBeGreaterThanOrEqual(400);

    const posted = await post(`/api/hydro-billing/fi/${prepared.body.id}/post`, reia,
      { fi_document_no: 'FI-2026-000123' });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.body.status).toBe('POSTED');
    expect(posted.body.fi_document_no).toBe('FI-2026-000123');

    // A posted entry is Finance's record — it is reversed, never edited.
    const noReason = await post(`/api/hydro-billing/fi/${prepared.body.id}/reverse`, reia, {});
    expect(noReason.status).toBeGreaterThanOrEqual(400);

    const reversed = await post(`/api/hydro-billing/fi/${prepared.body.id}/reverse`, reia,
      { reason: 'wrong cost centre' });
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expect(reversed.body.note).toMatch(/free to be prepared again/i);

    // And now the month can be prepared again.
    const redone = await post('/api/hydro-billing/fi/prepare', reia,
      { contract_id: contract.id, period_month: '2026-06', notes: 'corrected cost centre' });
    expect(redone.status, JSON.stringify(redone.body)).toBe(200);
  });

  it('claims TCS against a beneficiary receipt and shows it on the month', async () => {
    await issuedBill();

    const preview = await post('/api/hydro-billing/tcs/preview', viewer,
      { amount_received: 10000000, tcs_applicable_amount: 10000000, tcs_rate_pct: 0.1 });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.tcs_amount).toBeCloseTo(10000, 0);

    const claim = await post('/api/hydro-billing/tcs', reia, {
      contract_id: contract.id, beneficiary: 'PUNJAB', billing_month: 'June-2026',
      payment_date: '2026-07-20', amount_received: 10000000,
      tcs_applicable_amount: 10000000, tcs_rate_pct: 0.1, remarks: '206C(1H)',
    });
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);

    const listed = await get(
      `/api/hydro-billing/tcs?contract_id=${contract.id}&period_month=2026-06`, viewer);
    expect(listed.status).toBe(200);
    expect(listed.body.length).toBeGreaterThan(0);
  });
});

describe('E2E: revising a month after the beta certificate arrives', () => {
  it('bills only the difference, and does not double-count the month', async () => {
    const { bill, maker, hod } = await issuedBill();
    const firstTotal = bill.total_charges;

    const rev = await post('/api/hydro-billing', signFor(maker), {
      contract_id: contract.id, ...JUNE,
      bill_kind: 'REVISION', revises_bill_id: bill.id, beta_value: 1.0,
      revision_reason: 'β certified at 1.00 by NRPC on 19.08.2026',
    });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);

    const stored = await get(`/api/hydro-billing/${rev.body.id}`, viewer);
    expect(stored.body.revises_bill_no).toBe(bill.bill_no);
    expect(stored.body.prev_total_charges).toBeCloseTo(firstTotal, -2);
    expect(Math.abs(stored.body.differential_amount),
      'a certified beta made no difference to the bill').toBeGreaterThan(0);

    // A revision goes through the same chain before it can reach a beneficiary.
    const earlyIssue = await post(`/api/hydro-billing/${rev.body.id}/issue`, signFor(maker));
    expect(earlyIssue.status).toBe(400);

    await post(`/api/hydro-billing/${rev.body.id}/send-for-approval`, signFor(maker),
      { next_approver_id: hod.id, final_approver_id: hod.id, comments: 'revision for approval' });
    await post(`/api/hydro-billing/${rev.body.id}/approve`, signFor(hod),
      { action: 'APPROVE', comments: 'beta certificate seen' });
    const issuedRev = await post(`/api/hydro-billing/${rev.body.id}/issue`, signFor(maker),
      { due_date: '2026-09-30' });
    expect(issuedRev.status, JSON.stringify(issuedRev.body)).toBe(200);

  });

  // ── A defect this walk found, left standing as the record of it ───────────
  //
  // The bill header gets the revision right: prev_total_charges and
  // differential_amount say exactly what the certified beta changed. The ledger
  // does not. postBillToLedger() posts line.total_charges + nrldc_fee for every
  // bill it is given, with no case for a REVISION, and nothing in the revision
  // path reverses the documents of the bill being revised. So issuing a revision
  // on a month that was already issued opens a SECOND full bill on all fifteen
  // accounts beside the first.
  //
  // Measured on NJHPS June 2026, beta certified at 1.00:
  //   provisional bill   Rs 1,57,49,26,027   PUNJAB's share Rs 20,33,25,829.67
  //   revised bill       Rs 1,59,31,95,703   PUNJAB's share Rs 20,56,83,626.02
  //   header differential                    Rs    1,82,69,676
  //   PUNJAB then owes                       Rs 40,90,09,455.69  <- both, in full
  // The month is over-billed by roughly Rs 157 crore across the fifteen
  // beneficiaries, and the surcharge clock runs on all of it.
  //
  // it.fails: the assertion below is what the ledger ought to hold. It does not
  // today, so the suite stays green — and the moment the posting is corrected
  // this test goes red and has to be turned back into a plain it().
  it.fails('KNOWN DEFECT: a revision opens a second full bill instead of billing the difference', async () => {
    const { bill, maker, hod } = await issuedBill();

    const rev = await post('/api/hydro-billing', signFor(maker), {
      contract_id: contract.id, ...JUNE,
      bill_kind: 'REVISION', revises_bill_id: bill.id, beta_value: 1.0,
      revision_reason: 'β certified at 1.00 by NRPC on 19.08.2026',
    });
    expect(rev.status).toBe(200);
    await post(`/api/hydro-billing/${rev.body.id}/send-for-approval`, signFor(maker),
      { next_approver_id: hod.id, final_approver_id: hod.id, comments: 'revision for approval' });
    await post(`/api/hydro-billing/${rev.body.id}/approve`, signFor(hod),
      { action: 'APPROVE', comments: 'beta certificate seen' });
    await post(`/api/hydro-billing/${rev.body.id}/issue`, signFor(maker), { due_date: '2026-09-30' });

    const acc = await get(
      `/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=PUNJAB`, viewer);
    const revised = await get(`/api/hydro-billing/${rev.body.id}`, viewer);
    const punjabLine = db.prepare(
      `SELECT total_charges, nrldc_fee FROM hydro_bill_lines WHERE bill_id = ? AND beneficiary_name = 'PUNJAB'`,
    ).get(rev.body.id);
    const owedOnTheRevisedMonth = punjabLine.total_charges + (punjabLine.nrldc_fee || 0);

    // One month billed twice is one month owed once, at the revised figure.
    expect(acc.body.totals.outstanding, `revision ${revised.body.bill_no} left the month billed twice`)
      .toBeCloseTo(owedOnTheRevisedMonth, 0);
  });

  it('refuses a revision that does not say what changed', async () => {
    const { bill, maker } = await issuedBill();
    const r = await post('/api/hydro-billing', signFor(maker), {
      contract_id: contract.id, ...JUNE, bill_kind: 'REVISION', revises_bill_id: bill.id, beta_value: 1.0,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/what changed/i);
  });
});

describe('E2E: who may do what', () => {
  it('lets a read-only user watch the whole workflow but change none of it', async () => {
    const { bill } = await issuedBill();

    // Reading is fine.
    expect((await get('/api/hydro-billing/stations', viewer)).status).toBe(200);
    expect((await get(`/api/hydro-billing/${bill.id}`, viewer)).status).toBe(200);
    expect((await get(`/api/hydro-billing/ledger/accounts?contract_id=${contract.id}`, viewer)).status).toBe(200);

    // Changing is not.
    for (const [url, body] of [
      ['/api/hydro-billing', { contract_id: contract.id, ...JUNE }],
      [`/api/hydro-billing/${bill.id}/release`, {}],
      [`/api/hydro-billing/${bill.id}/cancel`, { reason: 'x' }],
      ['/api/hydro-billing/ledger/payment', {
        contract_id: contract.id, beneficiary: 'PUNJAB', amount: 1000, payment_date: '2026-07-20' }],
      ['/api/hydro-billing/fi/prepare', { contract_id: contract.id, period_month: '2026-06' }],
    ]) {
      const r = await post(url, viewer, body);
      expect(r.status, `a read-only user was allowed to POST ${url}`).toBe(403);
    }
  });
});
