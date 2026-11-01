import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice } from './helpers/reia.js';
import { sapInvoiceNo, istStamp } from '../src/services/reiaSapPush.js';
import { buildBatch, readBatchResponse } from '../src/services/sapOdata.js';

// A REIA sale posting sent to SAP as FI lines (bill type RE), and read back
// with SAP's FI document number. SAP itself is faked at the fetch boundary.

const MONTH = '2031-06';
const SAP_ENV = {
  SAP_ODATA_ENABLED: 'true',
  SAP_ODATA_URL: 'http://sap.test:53000/sap/opu/odata/sap/ZCB_FI_REIA_SRV',
  SAP_CLIENT: '200',
  SAP_USER: 'TESTUSER',
  SAP_PASSWORD: 'test-only',
  SAP_FI_PLANT_ID: '301',
  SAP_FI_BENEFICIARY_NO: '05',
  SAP_FI_GL_RECEIVABLE: '310101',
  SAP_FI_PRCTR_RECEIVABLE: '1001',
  SAP_FI_PRCTR_INCOME: '1003',
  SAP_FI_GL_ENERGY: '550101',
  SAP_FI_GL_MARGIN: '550103',
  SAP_FI_GL_PASS_THROUGH: '550601',
};

let reia, checker, viewer, contract, calls;

function clear() {
  db.prepare('DELETE FROM reia_sap_pushes').run();
  db.prepare('DELETE FROM reia_fi_posting_lines').run();
  db.prepare('DELETE FROM reia_fi_postings').run();
  db.prepare('DELETE FROM invoices WHERE billing_period = ?').run(MONTH);
}

const created = (n) => [
  '--resp', 'Content-Type: multipart/mixed; boundary=cs', '',
  ...Array.from({ length: n }, () => ['--cs', 'Content-Type: application/http', '', 'HTTP/1.1 201 Created', 'Content-Type: application/json', '', '{"d":{}}', '']).flat(),
  '--cs--', '--resp--',
].join('\r\n');

const refused = (msg) => [
  '--resp', 'Content-Type: application/http', '', 'HTTP/1.1 400 Bad Request', 'Content-Type: application/json', '',
  JSON.stringify({ error: { code: '/IWBEP/CM_MGW_RT/022', message: { lang: 'en', value: msg } } }),
  '--resp--',
].join('\r\n');

/** A fake SAP: answers the token fetch, then each $batch with `batch()`. */
function fakeSap({ batch = (lines) => created(lines), read = () => [] } = {}) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const headers = init.headers || {};
    if (headers['x-csrf-token'] === 'Fetch') {
      return new Response('{}', {
        status: 200,
        headers: { 'x-csrf-token': 'TOKEN-1', 'set-cookie': 'SAP_SESSIONID_EDS_200=abc; path=/' },
      });
    }
    if (String(url).includes('$batch')) {
      const lines = (String(init.body).match(/POST FiLineSet/g) || []).length;
      return new Response(batch(lines, init), { status: 202, headers: { 'content-type': 'multipart/mixed; boundary=resp' } });
    }
    if (String(url).includes('FiLineSet')) {
      return new Response(JSON.stringify({ d: { results: read(String(url)) } }), { status: 200 });
    }
    return new Response(JSON.stringify({ d: { EntitySets: ['FiLineSet'] } }), { status: 200 });
  }));
}

const batchBodies = () => calls.filter((c) => c.url.includes('$batch'));
const sentLines = (call) => String(call.init.body).split('\r\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));

beforeEach(() => {
  clear();
  Object.assign(process.env, SAP_ENV);
  contract = makeContract();
  reia = tokenFor('REIA_USER');
  checker = tokenFor('REIA_ADMIN');
  viewer = tokenFor('FINANCE_USER');
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(SAP_ENV)) delete process.env[k];
});
afterAll(clear);

const post = (url, token, body) => request(app).post(url).set(auth(token)).send(body || {});
const get = (url, token) => request(app).get(url).set(auth(token));

function sale(no, o = {}) {
  return makeInvoice({
    invoice_no: no, contract_id: contract.id, billing_period: MONTH, direction: 'SJVN_TO_BUYER', status: 'SENT',
    energy_charges: 3000000, trading_margin: 70000, nrldc_fees: 5000, transmission_charges: 20000,
    taxes: 0, total_amount: 3095000, issued_at: '2031-07-05 10:00:00', ...o,
  });
}

async function prepared(category = 'SALE') {
  const r = await post('/api/reia-fi/prepare', reia, { period_month: MONTH, category });
  expect(r.status).toBe(200);
  return r.body;
}

describe('the invoice number SAP holds', () => {
  it('keeps a number that fits, drops INV- from a long one, and refuses what still does not fit', () => {
    expect(sapInvoiceNo('REIA/2627/000002')).toBe('REIA/2627/000002');
    expect(sapInvoiceNo('INV-PSA/2026/000002')).toBe('PSA/2026/000002');
    expect(() => sapInvoiceNo('INV-SUPPLEMENTARY/2026/1')).toThrow(/16 characters/);
  });

  it('stamps a push with the IST time', () => {
    expect(istStamp(new Date('2026-10-28T05:00:00Z'))).toBe('20261028103000');
  });
});

describe('the $batch wire format', () => {
  it('puts every line of an invoice in one changeset, with CRLF line ends', () => {
    const { boundary, body } = buildBatch('FiLineSet', [{ Cpos: '0001' }, { Cpos: '0002' }], 7);
    expect(boundary).toBe('batch_7');
    expect(body.startsWith('--batch_7\r\nContent-Type: multipart/mixed; boundary=changeset_7\r\n')).toBe(true);
    expect(body.match(/POST FiLineSet HTTP\/1\.1/g)).toHaveLength(2);
    expect(body.trimEnd().endsWith('--changeset_7--\r\n--batch_7--')).toBe(true);
  });

  it('reads the verdict from inside the 202 envelope', () => {
    expect(readBatchResponse(created(3))).toMatchObject({ ok: true, created: 3 });
    expect(readBatchResponse(refused('This invoice push (Timestamp + Belnr) is already in SAP')))
      .toMatchObject({ ok: false, error: 'This invoice push (Timestamp + Belnr) is already in SAP' });
  });
});

describe('pushing a sale posting to SAP', () => {
  it('says plainly when SAP is not configured, and sends nothing', async () => {
    sale('INV-PSA/2031/000001');
    const p = await prepared();
    delete process.env.SAP_ODATA_ENABLED;
    fakeSap();
    const r = await post(`/api/reia-fi/${p.id}/sap-push`, checker);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/SAP is not configured.*SAP_ODATA_ENABLED/);
    expect(batchBodies()).toHaveLength(0);
  });

  it('sends each invoice as one balanced changeset: receivable on 40, its parts on 50', async () => {
    sale('INV-PSA/2031/000001');
    sale('INV-PSA/2031/000002', { trading_margin: 0, total_amount: 3025000 });
    const p = await prepared();
    fakeSap();

    const r = await post(`/api/reia-fi/${p.id}/sap-push`, checker);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sent: 2, failed: 0 });

    const batches = batchBodies();
    expect(batches).toHaveLength(2);
    const [first] = batches;
    expect(first.url).toContain('sap-client=200');
    expect(first.init.headers['x-csrf-token']).toBe('TOKEN-1');
    expect(first.init.headers.Cookie).toBe('SAP_SESSIONID_EDS_200=abc');

    const lines = sentLines(first);
    expect(lines.map((l) => [l.Cpos, l.Newbs, l.Hkont, l.Dmbtr])).toEqual([
      ['0001', '40', '310101', '3095000.00'],
      ['0002', '50', '550101', '3000000.00'],
      ['0003', '50', '550103', '70000.00'],
      ['0004', '50', '550601', '25000.00'],
    ]);
    expect(lines[0]).toMatchObject({
      BillId: 'RE', PlantId: '301', BeneficiaryNo: '05', Zmonth: '06', Zyear: '2031', TrnType: 'BL',
      InvoiceNo: 'PSA/2031/000001', ReversalEntry: false, Bldat: '2031-07-05T00:00:00', Blart: 'CB',
    });
    expect(new Set(lines.map((l) => l.Belnr)).size).toBe(1);
    expect(lines[0].Belnr).toMatch(/^RE\d{8}$/);
    expect(lines[0].CbDocNo).toBe(lines[0].Belnr);

    // A margin of zero is no line at all.
    expect(sentLines(batches[1]).map((l) => l.Hkont)).toEqual(['310101', '550101', '550601']);
    expect(sentLines(batches[1])[0].Belnr).not.toBe(lines[0].Belnr);
  });

  it('does not send an invoice twice once SAP holds it', async () => {
    sale('INV-PSA/2031/000001');
    const p = await prepared();
    fakeSap();
    await post(`/api/reia-fi/${p.id}/sap-push`, checker);
    const again = await post(`/api/reia-fi/${p.id}/sap-push`, checker);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already in SAP/);
    expect(batchBodies()).toHaveLength(1);
  });

  it('records what SAP refused, and sends that invoice again on the next push', async () => {
    sale('INV-PSA/2031/000001');
    const p = await prepared();
    fakeSap({ batch: () => refused('Line 0002 GL 550101 does not exist in company code 1000') });
    const r = await post(`/api/reia-fi/${p.id}/sap-push`, checker);
    expect(r.body).toMatchObject({ sent: 0, failed: 1 });
    expect(r.body.results[0].error).toMatch(/does not exist in company code 1000/);

    const list = await get(`/api/reia-fi/${p.id}/sap`, viewer);
    expect(list.body.pushes[0]).toMatchObject({ status: 'FAILED', lines: 4 });

    fakeSap();
    const retry = await post(`/api/reia-fi/${p.id}/sap-push`, checker);
    expect(retry.body).toMatchObject({ sent: 1, failed: 0 });
  });

  it('stops before sending anything when a part has no GL configured', async () => {
    sale('INV-PSA/2031/000001', { taxes: 18000, total_amount: 3113000 });
    const p = await prepared();
    fakeSap();
    const r = await post(`/api/reia-fi/${p.id}/sap-push`, checker);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/SAP_FI_GL_TAX/);
    expect(batchBodies()).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM reia_sap_pushes').get().n).toBe(0);
  });

  it('sends only sale postings, and only by the checker: the maker who prepared it does not book it', async () => {
    makeInvoice({ invoice_no: 'INV-PPA/2031/000001', contract_id: contract.id, billing_period: MONTH, direction: 'SELLER_TO_SJVN', status: 'APPROVED' });
    const p = await prepared('PURCHASE');
    fakeSap();
    expect((await post(`/api/reia-fi/${p.id}/sap-push`, checker)).body.error).toMatch(/Only sale postings/);
    expect((await post(`/api/reia-fi/${p.id}/sap-push`, reia)).status).toBe(403);
    expect((await post(`/api/reia-fi/${p.id}/sap-push`, viewer)).status).toBe(403);
    expect(batchBodies()).toHaveLength(0);
  });

  it('sends only a prepared posting: one booked by a typed voucher would be booked twice', async () => {
    sale('INV-PSA/2031/000001');
    const p = await prepared();
    expect((await post(`/api/reia-fi/${p.id}/post`, checker, { fi_document_no: 'JV-77' })).status).toBe(200);
    fakeSap();
    const r = await post(`/api/reia-fi/${p.id}/sap-push`, checker);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/only a prepared posting goes to SAP/);
    expect(batchBodies()).toHaveLength(0);
  });

  it('refuses an invoice changed since the posting was prepared', async () => {
    sale('INV-PSA/2031/000001');
    const p = await prepared();
    db.prepare('UPDATE invoices SET total_amount = 1 WHERE invoice_no = ?').run('INV-PSA/2031/000001');
    fakeSap();
    const r = await post(`/api/reia-fi/${p.id}/sap-push`, checker);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Changed since this posting was prepared/);
    expect(batchBodies()).toHaveLength(0);
  });

  it('once in SAP, takes no typed voucher and no reversal here', async () => {
    sale('INV-PSA/2031/000001');
    const p = await prepared();
    fakeSap();
    expect((await get(`/api/reia-fi?period_month=${MONTH}`, viewer)).body.postings[0].in_sap).toBe(0);
    await post(`/api/reia-fi/${p.id}/sap-push`, checker);
    // The list says so, and the screen hides the voucher and reversal for it.
    expect((await get(`/api/reia-fi?period_month=${MONTH}`, viewer)).body.postings[0].in_sap).toBe(1);
    const typed = await post(`/api/reia-fi/${p.id}/post`, checker, { fi_document_no: 'JV-77' });
    expect(typed.status).toBe(409);
    expect(typed.body.error).toMatch(/has gone to SAP/);
    const back = await post(`/api/reia-fi/${p.id}/reverse`, checker, { reason: 'Wrong month entirely' });
    expect(back.status).toBe(409);
    expect(back.body.error).toMatch(/has gone to SAP/);
  });

  it('holds an invoice SAP never answered for until a read back settles it', async () => {
    sale('INV-PSA/2031/000001');
    const p = await prepared();
    fakeSap();
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      if (String(url).includes('$batch')) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      return real(url, init);
    }));
    const r = await post(`/api/reia-fi/${p.id}/sap-push`, checker);
    expect(r.body).toMatchObject({ sent: 0, failed: 0, unknown: 1 });
    expect(r.body.results[0].error).toMatch(/SAP may hold it/);

    // No second push while SAP may already hold it.
    fakeSap();
    const again = await post(`/api/reia-fi/${p.id}/sap-push`, checker);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/got no answer from it.*Read back/);
    expect(batchBodies()).toHaveLength(0);

    // SAP does not hold it: the invoice is free to go again.
    fakeSap({ read: () => [] });
    const check = await post(`/api/reia-fi/${p.id}/sap-check`, reia);
    expect(check.body.pushes[0]).toMatchObject({ status: 'FAILED', sap_message: 'SAP does not hold these lines; push again' });
    fakeSap();
    expect((await post(`/api/reia-fi/${p.id}/sap-push`, checker)).body).toMatchObject({ sent: 1 });
  });

  it('takes an unanswered push as sent once SAP is found to hold its lines', async () => {
    sale('INV-PSA/2031/000001');
    const p = await prepared();
    fakeSap();
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      if (String(url).includes('$batch')) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      return real(url, init);
    }));
    await post(`/api/reia-fi/${p.id}/sap-push`, checker);
    fakeSap({ read: () => [1, 2, 3, 4].map(() => ({ Flag: false, ErpFiDocNum: '', Description: '' })) });
    const check = await post(`/api/reia-fi/${p.id}/sap-check`, reia);
    // The no-answer note goes once SAP's own answer is in.
    expect(check.body.pushes[0]).toMatchObject({ status: 'SENT', error: null, sap_message: '4 line(s) in SAP, waiting for the FI posting run' });
  });
});

describe('reading back from SAP', () => {
  it('marks an invoice booked once SAP has posted every line, with its FI document', async () => {
    sale('INV-PSA/2031/000001');
    const p = await prepared();
    fakeSap();
    await post(`/api/reia-fi/${p.id}/sap-push`, checker);

    fakeSap({ read: () => [1, 2, 3, 4].map(() => ({ Flag: true, ErpFiDocNum: '100005143', Gjahr: '2031', Description: '' })) });
    const r = await post(`/api/reia-fi/${p.id}/sap-check`, reia);
    expect(r.status).toBe(200);
    expect(r.body.pushes[0]).toMatchObject({ status: 'BOOKED', sap_fi_doc: '100005143', sap_fi_year: '2031' });
    // Every invoice posted in SAP: the posting is booked, under SAP's FI document.
    const after = await get(`/api/reia-fi/${p.id}`, viewer);
    expect(after.body).toMatchObject({ status: 'POSTED', fi_document_no: 'SAP 100005143/2031' });
    const readUrl = calls.find((c) => c.url.includes('FiLineSet')).url;
    expect(decodeURIComponent(readUrl)).toMatch(/\$filter=Timestamp eq '\d{14}' and Belnr eq 'RE\d{8}'/);
  });

  it('keeps it waiting, with SAP\'s posting error, while SAP has not posted', async () => {
    sale('INV-PSA/2031/000001');
    const p = await prepared();
    fakeSap();
    await post(`/api/reia-fi/${p.id}/sap-push`, checker);

    fakeSap({ read: () => [{ Flag: false, ErpFiDocNum: '', Description: 'Posting period 007 2031 is not open' }] });
    const r = await post(`/api/reia-fi/${p.id}/sap-check`, reia);
    expect(r.body.pushes[0]).toMatchObject({ status: 'SENT', sap_message: 'Posting period 007 2031 is not open' });
    expect((await get(`/api/reia-fi/${p.id}`, viewer)).body.status).toBe('PREPARED');
    expect((await post(`/api/reia-fi/${p.id}/sap-check`, viewer)).status).toBe(403);
  });
});
