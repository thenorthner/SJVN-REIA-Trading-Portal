import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import XLSX from 'xlsx';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { invalidateParamCache } from '../src/mastersService.js';
import { periodWindow } from '../src/routes/reconSignoff.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia, auditFor } from './helpers/reia.js';

// Around the signatures of a reconciliation statement: the balance rolled
// forward, a counterparty agreeing with exceptions, the auditor's certificate,
// and the statement as a document carrying both signatures.

let reia, reia2, seller, otherSeller, alpha, beta, contract, recon;
const as = (u) => auth(signToken(u));
const get = (u, p) => request(app).get(`/api/recon-signoff${p}`).set(as(u));
const post = (u, p, body) => request(app).post(`/api/recon-signoff${p}`).set(as(u)).send(body);
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

function makeRecon({ period = '2026-06', periodType = 'MONTHLY', status = 'PENDING_SIGN_OFF' } = {}) {
  const id = `RCN-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(`
    INSERT INTO reconciliations (id, recon_no, scope, contract_id, period_type, period, status, counterparty_role, items_total)
    VALUES (?, ?, 'REIA_CONTRACT', ?, ?, ?, ?, 'SELLER', 1)
  `).run(id, `RCN/T/${id.slice(4)}`, contract.id, periodType, period, status);
  db.prepare(`
    INSERT INTO recon_items (id, reconciliation_id, item_type, label, metered_value, billed_value, variance, match_status)
    VALUES (?, ?, 'ENERGY_THREE_WAY', 'Energy: meter vs bill', 1000, 1000, 0, 'EXACT')
  `).run(`RIT-${id}`, id);
  return db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(id);
}
function bill(no, total, period, extra = {}) {
  return makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', invoice_no: no, total_amount: total, billing_period: period, ...extra });
}
const pay = (inv, amount, on, extra = {}) => db.prepare(`
  INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference, deduction, tds_amount, rebate_amount) VALUES (?, ?, ?, ?, ?, 'UTR', ?, ?, ?)
`).run(`PAY-${Math.random().toString(36).slice(2, 10)}`, inv.id, amount, on, extra.mode || 'NEFT', extra.deduction || 0, extra.tds ?? null, extra.rebate ?? null);

beforeEach(() => {
  resetReia();
  for (const t of ['recon_exceptions', 'recon_events', 'recon_statements', 'recon_items', 'reconciliations']) db.prepare(`DELETE FROM ${t}`).run();
  alpha = makeEntity('SELLER', { name: 'Alpha Solar' });
  beta = makeEntity('SELLER', { name: 'Beta Wind' });
  contract = makeContract({ seller_id: alpha.id });
  reia = makeUser('REIA_USER', { name: 'Riya REIA' });
  reia2 = makeUser('REIA_ADMIN', { name: 'Ravi REIA' });
  seller = makeUser('SELLER', { name: 'Arun Alpha', linked_entity_id: alpha.id });
  otherSeller = makeUser('SELLER', { name: 'Bina Beta', linked_entity_id: beta.id });
  recon = makeRecon();
});

describe('roll-forward', () => {
  it('reads a month, a financial year and a quarter out of a period', () => {
    expect(periodWindow('2026-06')).toMatchObject({ from: '2026-06', to: '2026-06' });
    expect(periodWindow('2026-27')).toMatchObject({ from: '2026-04', to: '2027-03' });
    expect(periodWindow('2026-Q4')).toMatchObject({ from: '2027-01', to: '2027-03' });
    expect(periodWindow('whenever')).toBeNull();
  });

  it('is opening + billed − received − adjustments = closing, with the bills carried in', async () => {
    const may = bill('A/MAY', 1000000, '2026-05');
    pay(may, 400000, '2026-05-25');                                   // before the period: inside the opening balance
    pay(may, 300000, '2026-06-10', { deduction: 5000, tds: 1000 });   // in the period, against the carried bill
    const june = bill('A/JUN', 2000000, '2026-06');
    pay(june, 500000, '2026-06-28', { rebate: 10000 });
    pay(june, 700000, '2026-07-15');                                  // after the period closed
    bill('A/JUL', 9999999, '2026-07');                                // a later period's bill is not in it

    const rf = (await get(seller, `/${recon.id}`)).body.rollforward;
    expect(rf).toMatchObject({
      opening: 600000, billed: 2000000, received: 800000, tds: 1000, deductions: 4000, rebate: 10000,
      adjustments: 15000, closing: 1785000, since_received: 700000, balance_today: 1085000, as_at: '2026-06-30',
    });
    expect(rf.carried_forward).toEqual([expect.objectContaining({ invoice_no: 'A/MAY', balance: 600000 })]);
    expect(rf.bills.map((b) => b.invoice_no)).toEqual(['A/JUN']);
    expect((await get(otherSeller, `/${recon.id}`)).status).toBe(403);
  });
});

describe('signing', () => {
  it('is once per side, records what was signed, and closes when both have', async () => {
    const mine = await post(seller, `/${recon.id}/sign`, { decision: 'AGREE', remarks: 'Checked against JMR' });
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body).toMatchObject({ side: 'COUNTERPARTY', dual_signed: false });
    expect(mine.body.signoff.signatures.counterparty).toMatchObject({ by: 'Arun Alpha', decision: 'AGREE' });
    expect(mine.body.signoff.signatures.counterparty.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect((await post(seller, `/${recon.id}/sign`, { decision: 'AGREE' })).status).toBe(400);
    // The older route holds to the same rule.
    expect((await request(app).post(`/api/reconciliation/${recon.id}/acknowledge`).set(as(seller)).send({ decision: 'AGREE' })).status).toBe(400);
    expect((await post(otherSeller, `/${recon.id}/sign`, { decision: 'AGREE' })).status).toBe(403);

    const theirs = await post(reia, `/${recon.id}/sign`, { decision: 'AGREE' });
    expect(theirs.body).toMatchObject({ dual_signed: true });
    expect(theirs.body.reconciliation.status).toBe('CLOSED');
    expect(theirs.body.signoff.same_content).toBe(true);
    expect(auditFor(recon.id).map((a) => a.action)).toContain('RECON_ACKNOWLEDGE');
  });

  it('lets the counterparty agree with exceptions, holding the statement open until they are settled', async () => {
    bill('A/JUN', 1000000, '2026-06');
    expect((await post(seller, `/${recon.id}/sign`, { decision: 'AGREE_WITH_EXCEPTIONS' })).status).toBe(400);
    expect((await post(seller, `/${recon.id}/sign`, { decision: 'AGREE_WITH_EXCEPTIONS', exceptions: [{ label: 'Everything', amount: 2000000, reason: 'x' }] })).status).toBe(400);
    expect((await post(reia, `/${recon.id}/sign`, { decision: 'AGREE_WITH_EXCEPTIONS', exceptions: [{ label: 'x', amount: 1, reason: 'y' }] })).status).toBe(400);

    const signed = await post(seller, `/${recon.id}/sign`, {
      decision: 'AGREE_WITH_EXCEPTIONS',
      exceptions: [{ label: 'Liquidated damages', amount: 50000, reason: 'Delay was force majeure' }, { item_id: `RIT-${recon.id}`, amount: 25000, reason: 'Meter reading differs' }],
    });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(signed.body.signoff).toMatchObject({ excepted_amount: 75000, agreed_amount: 925000 });
    expect(signed.body.signoff.exceptions.map((e) => e.label)).toEqual(['Liquidated damages', 'Energy: meter vs bill']);

    // Both signed with exceptions open: agreed, not closed.
    const sjvn = await post(reia, `/${recon.id}/sign`, { decision: 'AGREE' });
    expect(sjvn.body.reconciliation.status).toBe('AGREED');
    const [a, b] = sjvn.body.signoff.exceptions;
    expect((await post(seller, `/exceptions/${a.id}/resolve`, { outcome: 'ACCEPTED', note: 'x' })).status).toBe(403);
    expect((await post(reia, `/exceptions/${a.id}/resolve`, { outcome: 'ACCEPTED' })).status).toBe(400);
    const one = await post(reia, `/exceptions/${a.id}/resolve`, { outcome: 'ACCEPTED', note: 'Force majeure notice was on record' });
    expect(one.body).toMatchObject({ status: 'AGREED', excepted_amount: 25000 });
    const two = await post(reia2, `/exceptions/${b.id}/resolve`, { outcome: 'REJECTED', note: 'JMR is jointly signed' });
    expect(two.body).toMatchObject({ status: 'CLOSED', excepted_amount: 0 });
  });

  it('takes an auditor’s certificate with the signature, and insists on one where SJVN says so', async () => {
    const annual = makeRecon({ period: '2026-27', periodType: 'ANNUAL' });
    db.prepare(`INSERT INTO documents (id, contract_id, document_type, category, title) VALUES ('DC', ?, 'AUDITOR_CERTIFICATE', 'RECORD', 'CA cert')`).run(contract.id);
    db.prepare(`INSERT INTO document_versions (id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type) VALUES ('VC', 'DC', 1, '/nowhere', 'ca-certificate.pdf', 10, 'application/pdf')`).run();
    const cert = { version_id: 'VC', auditor_name: 'S. Mehta & Co.', firm_reg_no: '012345N', udin: '26123456ABCDEF1234' };

    db.prepare(`UPDATE system_parameters SET param_value = 'ANNUAL' WHERE param_key = 'recon_auditor_certificate_required_for'`).run();
    invalidateParamCache();
    try {
      expect((await get(seller, `/${annual.id}`)).body.certificate_required).toBe(true);
      const refused = await post(seller, `/${annual.id}/sign`, { decision: 'AGREE' });
      expect(refused.status).toBe(400);
      expect(refused.body.error).toMatch(/auditor's certificate is required/);
      expect((await post(seller, `/${annual.id}/sign`, { decision: 'AGREE', certificate: { ...cert, udin: 'short' } })).status).toBe(400);
      expect((await post(seller, `/${annual.id}/sign`, { decision: 'AGREE', certificate: { ...cert, version_id: 'nope' } })).status).toBe(400);
      const ok = await post(seller, `/${annual.id}/sign`, { decision: 'AGREE', certificate: cert });
      expect(ok.body.signoff.certificate).toMatchObject({ file_name: 'ca-certificate.pdf', auditor_name: 'S. Mehta & Co.', udin: '26123456ABCDEF1234' });
      // A monthly statement is not held to it.
      expect((await post(seller, `/${recon.id}/sign`, { decision: 'AGREE' })).status).toBe(200);
    } finally {
      db.prepare(`UPDATE system_parameters SET param_value = '' WHERE param_key = 'recon_auditor_certificate_required_for'`).run();
      invalidateParamCache();
    }
  });
});

describe('the statement as a document', () => {
  it('comes as a PDF and a workbook, to the parties only', async () => {
    bill('A/JUN', 1000000, '2026-06');
    await post(seller, `/${recon.id}/sign`, { decision: 'AGREE_WITH_EXCEPTIONS', exceptions: [{ label: 'Rebate', amount: 1000, reason: 'Not due' }] });
    const pdf = await get(seller, `/${recon.id}/statement.pdf`).buffer().parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    const x = await get(reia, `/${recon.id}/statement.xlsx`).buffer().parse(binary);
    const wb = XLSX.read(x.body);
    expect(wb.SheetNames).toEqual(['Statement', 'Line checks', 'Exceptions']);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Statement, { header: 1 });
    expect(rows.find((r) => r[0] === 'Standing')[1]).toBe('NOT YET SIGNED BY BOTH PARTIES');
    expect(rows.find((r) => r[0] === 'Seller')[1]).toBe('Arun Alpha');
    expect((await get(otherSeller, `/${recon.id}/statement.pdf`)).status).toBe(403);
  });
});
