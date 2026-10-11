import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// Sending a hydro bill to its beneficiaries: each one gets its own page with
// the station bill behind it, by email, and each send is on record line by
// line — what the REIA invoice screen does for its one counterparty.
//
// The mail transport is stood in for, so a test neither needs an SMTP server
// nor leaves PDFs in backend/outbox.
const mail = vi.hoisted(() => ({ sent: [], fail: null }));
vi.mock('../src/services/mailService.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    sendMail: async (opts) => {
      mail.sent.push(opts);
      const to = Array.isArray(opts.to) ? opts.to : [opts.to];
      if (mail.fail && to.includes(mail.fail)) return { ok: false, mode: 'SMTP', error: 'mailbox unavailable', to };
      return { ok: true, mode: 'SMTP', to };
    },
  };
});

const { app } = await import('../src/server.js');
const { default: db } = await import('../src/db/index.js');
const { tokenFor, auth, makeUser, makeEntity } = await import('./helpers/reia.js');
const { signToken } = await import('../src/middleware/auth.js');
const { seedNjhpsAllocations } = await import('../src/services/hydroStationBill.js');

const COLS = ['annual_afc', 'annual_design_energy_mwh', 'normative_aux', 'free_energy_home_state',
  'napaf_percent', 'capacity_mw', 'capacity_charges_total'];
let snapshot;
let contract;
let reia;
let viewer;

const JUNE = {
  billing_month: '2026-06', ex_bus_scheduled_kwh: 731158750, free_power_kwh: 87739035,
  pafm_percent: 109.667, beta_value: 0, prior_scheduled_kwh: 714468750, prior_free_kwh: 85736250,
};

function clean() {
  for (const t of ['hydro_bill_deliveries', 'hydro_beneficiary_contacts', 'hydro_ledger_clearings', 'hydro_ledger_docs',
    'hydro_bill_approvals', 'hydro_bill_lines', 'hydro_station_bills', 'hydro_beneficiary_allocations']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
}

beforeAll(() => {
  snapshot = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
});
afterAll(() => {
  clean();
  db.prepare(`UPDATE contracts SET ${COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...COLS.map((c) => snapshot[c]), snapshot.id);
});

beforeEach(() => {
  mail.sent.length = 0;
  mail.fail = null;
  clean();
  seedNjhpsAllocations();
  db.prepare(`
    UPDATE contracts SET annual_afc = 14615741000, annual_design_energy_mwh = 6612000, normative_aux = 1.2,
      free_energy_home_state = 12, napaf_percent = 87, capacity_mw = 1500, capacity_charges_total = 85000000
    WHERE contract_no = 'PPA/SJVN/NJHPS/001'
  `).run();
  contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  reia = tokenFor('COMMERCIAL_USER');
  viewer = tokenFor('MANAGEMENT');
});

const post = (url, token, body) => request(app).post(url).set(auth(token)).send(body);
const get = (url, token) => request(app).get(url).set(auth(token));

async function draft() {
  const maker = makeUser('COMMERCIAL_USER', { name: 'Send Maker' });
  const b = await post('/api/hydro-billing', signToken(maker), { contract_id: contract.id, ...JUNE });
  return { id: b.body.id, maker };
}
async function issued() {
  const { id, maker } = await draft();
  const hod = makeUser('COMMERCIAL_ADMIN', { name: 'Send HOD' });
  await post(`/api/hydro-billing/${id}/send-for-approval`, signToken(maker), { next_approver_id: hod.id, final_approver_id: hod.id, comments: 'go' });
  await post(`/api/hydro-billing/${id}/approve`, signToken(hod), { action: 'APPROVE', comments: 'ok' });
  await post(`/api/hydro-billing/${id}/issue`, reia, { due_date: '2026-07-31' });
  return id;
}
// Approvals and the issue itself send notices of their own; a bill send is the
// mail that carries the PDF.
const billMails = () => mail.sent.filter((m) => m.attachments?.length);
const lineOf = (billId, name) => db.prepare('SELECT * FROM hydro_bill_lines WHERE bill_id = ? AND beneficiary_name = ?').get(billId, name);

describe('sending a hydro bill to its beneficiaries', () => {
  it('will not send a bill that has not been issued', async () => {
    const { id } = await draft();
    const r = await post(`/api/hydro-billing/${id}/send`, reia, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/only once it has been approved and issued/);
    expect(billMails()).toHaveLength(0);
  });

  it('mails one beneficiary its own bill with the station bill behind it, and records the send', async () => {
    const id = await issued();
    const punjab = lineOf(id, 'PUNJAB');
    const r = await post(`/api/hydro-billing/${id}/send`, reia, { lines: [{ line_id: punjab.id, to: 'Commercial@pspcl.example' }] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sent: 1, failed: 0, no_email: 0 });
    expect(r.body.results[0]).toMatchObject({ beneficiary_name: 'PUNJAB', status: 'SENT', to: ['commercial@pspcl.example'] });

    expect(billMails()).toHaveLength(1);
    const m = billMails()[0];
    expect(m.to).toEqual(['commercial@pspcl.example']);
    expect(m.subject).toMatch(/Provisional bill HB\/\d+\/\d+\/09 — .*Nathpa Jhakri.* — June 2026 — Rs /);
    // The mail states this beneficiary's amount, not the station's.
    const share = Number(punjab.total_charges).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(m.text).toContain(`Amount payable: Rs ${share}`);
    expect(m.text).toContain('Due date: 2026-07-31');
    expect(m.attachments[0].filename).toMatch(/_09_PUNJAB\.pdf$/);
    expect(m.attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');

    const log = await get(`/api/hydro-billing/${id}/deliveries`, viewer);
    expect(log.body).toHaveLength(1);
    expect(log.body[0]).toMatchObject({ beneficiary_name: 'PUNJAB', channel: 'EMAIL', status: 'SENT', recipient: 'commercial@pspcl.example' });
  });

  it('keeps an address typed for a beneficiary and uses it for the next bill', async () => {
    const id = await issued();
    await post(`/api/hydro-billing/${id}/send`, reia, { lines: [{ line_id: lineOf(id, 'HARYANA').id, to: 'hppc@haryana.example; cc@haryana.example' }] });

    const list = await get(`/api/hydro-billing/${id}/recipients`, viewer);
    const haryana = list.body.lines.find((l) => l.beneficiary_name === 'HARYANA');
    expect(haryana).toMatchObject({ emails: ['hppc@haryana.example', 'cc@haryana.example'], source: 'SAVED' });
    expect(haryana.last_delivery.status).toBe('SENT');
    expect(list.body.lines.find((l) => l.beneficiary_name === 'PUNJAB')).toMatchObject({ emails: [], source: null, last_delivery: null });
  });

  it('sends to every beneficiary that has an address and says which have none', async () => {
    const id = await issued();
    const buyer = makeEntity('BUYER', { name: 'UPPCL' });
    db.prepare('UPDATE entities SET corporate_email = ? WHERE id = ?').run('bills@uppcl.example', buyer.id);
    db.prepare(`UPDATE hydro_bill_lines SET beneficiary_id = ? WHERE bill_id = ? AND beneficiary_name = 'UTTAR PRADESH'`).run(buyer.id, id);
    db.prepare(`INSERT INTO hydro_beneficiary_contacts (beneficiary_key, beneficiary_name, email) VALUES ('CHANDIGARH', 'CHANDIGARH', 'ed@chd.example')`).run();

    const r = await post(`/api/hydro-billing/${id}/send`, reia, {});
    expect(r.body.sent).toBe(2);
    expect(r.body.no_email).toBe(13);
    expect(billMails().map((m) => m.to[0]).sort()).toEqual(['bills@uppcl.example', 'ed@chd.example']);
    expect(db.prepare('SELECT COUNT(*) c FROM hydro_bill_deliveries WHERE bill_id = ?').get(id).c).toBe(2);
  });

  it('carries on past a beneficiary whose mail fails, and records the failure', async () => {
    const id = await issued();
    mail.fail = 'bad@punjab.example';
    const r = await post(`/api/hydro-billing/${id}/send`, reia, {
      lines: [
        { line_id: lineOf(id, 'PUNJAB').id, to: 'bad@punjab.example' },
        { line_id: lineOf(id, 'HARYANA').id, to: 'ok@haryana.example' },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sent: 1, failed: 1 });
    expect(r.body.results.find((x) => x.beneficiary_name === 'PUNJAB')).toMatchObject({ status: 'FAILED', reason: 'mailbox unavailable' });
    const rows = db.prepare('SELECT beneficiary_name, status FROM hydro_bill_deliveries WHERE bill_id = ? ORDER BY beneficiary_name').all(id);
    expect(rows).toEqual([{ beneficiary_name: 'HARYANA', status: 'SENT' }, { beneficiary_name: 'PUNJAB', status: 'FAILED' }]);
  });

  it('refuses the whole send when any address is not an address, before mailing anyone', async () => {
    const id = await issued();
    const r = await post(`/api/hydro-billing/${id}/send`, reia, {
      lines: [
        { line_id: lineOf(id, 'HARYANA').id, to: 'ok@haryana.example' },
        { line_id: lineOf(id, 'PUNJAB').id, to: 'not-an-address' },
      ],
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Not an email address: not-an-address/);
    expect(billMails()).toHaveLength(0);
  });

  it('is not open to a read-only role', async () => {
    const id = await issued();
    const r = await post(`/api/hydro-billing/${id}/send`, viewer, {});
    expect(r.status).toBe(403);
  });
});

describe('the beneficiary bills PDF', () => {
  it('prints one page per beneficiary for a draft, or a single beneficiary\'s page', async () => {
    const { id } = await draft();
    const fetchPdf = (url) => request(app).get(url).set(auth(viewer)).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const pages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;

    const all = await fetchPdf(`/api/hydro-billing/${id}/beneficiary-bills/pdf`);
    expect(all.status).toBe(200);
    expect(all.headers['content-type']).toMatch(/application\/pdf/);
    expect(pages(all.body)).toBe(15);

    const one = await fetchPdf(`/api/hydro-billing/${id}/beneficiary-bills/pdf?line=${lineOf(id, 'PUNJAB').id}`);
    expect(pages(one.body)).toBe(1);
    expect(one.headers['content-disposition']).toMatch(/_09_PUNJAB\.pdf/);

    const none = await get(`/api/hydro-billing/${id}/beneficiary-bills/pdf?line=NOPE`, viewer);
    expect(none.status).toBe(404);
  });
});
