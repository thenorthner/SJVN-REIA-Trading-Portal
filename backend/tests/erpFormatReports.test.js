import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth } from './helpers/reia.js';

// The two SAP upload layouts finance pulls out of the trading module — Vendor
// (FLVN00) and Vendor Payable. Their rows were transcribed from the live ISET
// portal and sat inline in the frontend; they are register rows like every other
// pending report now, which is what these two screens read.

const KINDS = ['erp-vendor-master', 'erp-vendor-payable', 'erp-customer-receivable', 'rea-sea-reconciliation'];

const put = (kind, sort, payload) => db.prepare(`
  INSERT INTO generic_report_entries (id, report_kind, sort_order, payload_json) VALUES (?, ?, ?, ?)
`).run(newId('GRE'), kind, sort, JSON.stringify(payload));

let trader;

beforeEach(() => {
  for (const kind of KINDS) db.prepare('DELETE FROM generic_report_entries WHERE report_kind = ?').run(kind);
  // The vendor extract prefers the TDS register — the vendors SJVN actually pays
  // — and falls back to the pasted one. These start from the fallback; the test
  // below fills the register.
  db.prepare('DELETE FROM tds_vendors').run();
  trader = tokenFor('TRADING_USER');
  put('erp-vendor-master', 1, { type: 'Discom', firstName: 'Test Discom Ltd', lang: 'EN', searchTerm: 'Test Discom Ltd' });
  put('erp-vendor-master', 2, { type: 'Generator', firstName: 'Test Generator Ltd', lang: 'EN', searchTerm: 'Test Generator Ltd' });
  put('erp-vendor-payable', 1, {
    desc: 'Energy bill', docDate: '16.08.2023', docType: 'PW', companyCode: '1000',
    postingDate: '22.08.2023', currency: 'INR', reference: 'REF/1', headerText: 'REF/1',
    postingKey: '31', vendorNo: '1000001',
  });
  put('erp-customer-receivable', 1, {
    desc: 'Open access bill', docDate: '07.08.2023', docType: 'DW', companyCode: '1000',
    postingDate: '07.08.2023', currency: 'INR', reference: 'REF/2', headerText: 'REF/2',
    postingKey: '01', customerNo: '2000001',
  });
  put('rea-sea-reconciliation', 1, {
    month: 'June 2026', contract: 'LOA/TEST/1', entity: 'Test Municipal Council',
    appNo: 'AD20260601', approvalNo: 'NR/2026/1/A', approved: 200, rea: 180, rldc: 180, status: 'Pending',
  });
});

const get = (path, who = trader) => request(app).get(path).set(auth(who));

describe('ERP upload formats', () => {
  it('publishes the column layout each screen draws, SAP field names included', async () => {
    const r = await get('/api/iset-reports/meta');
    expect(r.status).toBe(200);
    for (const kind of KINDS) expect(r.body.kinds).toContain(kind);

    const vendor = r.body.catalogs['erp-vendor-master'];
    expect(vendor.title).toBe('Vendor Format');
    expect(vendor.showSr).toBe(false);
    expect(vendor.columns.map((c) => c.key)).toEqual([
      'type', 'partnerRole', 'creationGroup', 'firstName', 'lastName', 'lang', 'searchTerm',
    ]);
    expect(vendor.columns.find((c) => c.key === 'firstName').code).toBe('NAME_FIRST');

    const payable = r.body.catalogs['erp-vendor-payable'];
    expect(payable.title).toBe('Vendor Payable Format');
    expect(payable.columns.map((c) => c.key)).toContain('vendorNo');

    // The receivable side is the same document keyed on the customer.
    const receivable = r.body.catalogs['erp-customer-receivable'];
    expect(receivable.columns.map((c) => c.key)).toContain('customerNo');
    expect(receivable.columns.map((c) => c.key)).not.toContain('vendorNo');

    const reaSea = r.body.catalogs['rea-sea-reconciliation'];
    expect(reaSea.title).toBe('REA/SEA Reconciliation');
    expect(reaSea.columns.map((c) => c.key)).toEqual([
      'month', 'contract', 'entity', 'appNo', 'approvalNo', 'approved', 'rea', 'rldc', 'status',
    ]);
  });

  it('serves the rows on record, in register order', async () => {
    const vendors = await get('/api/iset-reports/erp-vendor-master');
    expect(vendors.status).toBe(200);
    expect(vendors.body.map((v) => v.firstName)).toEqual(['Test Discom Ltd', 'Test Generator Ltd']);
    expect(vendors.body[0].type).toBe('Discom');
    // The pasted register is the fallback; the TDS vendor register wins when it
    // has anything in it — see the test below.


    const payables = await get('/api/iset-reports/erp-vendor-payable');
    expect(payables.body).toHaveLength(1);
    expect(payables.body[0]).toMatchObject({ docDate: '16.08.2023', vendorNo: '1000001' });

    const receivables = await get('/api/iset-reports/erp-customer-receivable');
    expect(receivables.body[0]).toMatchObject({ docDate: '07.08.2023', customerNo: '2000001' });

    const reaSea = await get('/api/iset-reports/rea-sea-reconciliation');
    expect(reaSea.body[0]).toMatchObject({ appNo: 'AD20260601', approved: 200, rea: 180, status: 'Pending' });
  });

  it('builds the vendor extract from the vendors SJVN actually pays', async () => {
    // FLVN00 is a list of payees, and the platform keeps that list: the TDS
    // register the deduction entries hang off.
    db.prepare('DELETE FROM tds_vendors').run();
    db.prepare(`
      INSERT INTO tds_vendors (id, name, pan, category, is_active) VALUES
        (?, 'GRID-INDIA', 'AAFCP2086B', 'RLDC', 1),
        (?, 'CTUIL', 'AAJCC2026N', 'CTU', 1),
        (?, 'Retired Agency', 'AAACR1111R', 'OTHER', 0)
    `).run(newId('TDV'), newId('TDV'), newId('TDV'));

    const r = await get('/api/iset-reports/erp-vendor-master');
    expect(r.body.map((v) => v.firstName)).toEqual(['CTUIL', 'GRID-INDIA']);
    expect(r.body[0]).toMatchObject({ type: 'CTU', lang: 'EN', searchTerm: 'CTUIL (AAJCC2026N)' });
    // An inactive vendor is not somebody to pay.
    expect(r.text).not.toMatch(/Retired Agency/);

    db.prepare('DELETE FROM tds_vendors').run();
  });

  it('renders the layout with no rows when nothing has been loaded', async () => {
    for (const kind of KINDS) db.prepare('DELETE FROM generic_report_entries WHERE report_kind = ?').run(kind);
    for (const kind of KINDS) {
      const r = await get(`/api/iset-reports/${kind}`);
      expect(r.status).toBe(200);
      expect(r.body).toEqual([]);
    }
  });

  it('keeps both formats inside the trading desk', async () => {
    const seller = tokenFor('SELLER');
    for (const kind of KINDS) {
      expect((await get(`/api/iset-reports/${kind}`, seller)).status).toBe(403);
    }
    expect((await get('/api/iset-reports/meta', seller)).status).toBe(403);
  });
});
