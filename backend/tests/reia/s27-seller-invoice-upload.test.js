import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, resetReia } from '../helpers/reia.js';

// A generator with twenty PPAs raises twenty bills a month, one form at a time.
// The sheet those numbers already live in is the way in — held to the same rules
// the form is held to, and landing exactly where the form would put it.

let sellerEntity, otherSeller, contract, otherContract, seller, maker, reia;

const row = (over = {}) => ({
  contract_no: contract.contract_no,
  billing_period: '2026-08',
  invoice_type: 'FINAL',
  energy_mwh: 1000,
  tariff_per_unit: 3.15,
  energy_charges: 3150000,
  ...over,
});

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  sellerEntity = makeEntity('SELLER', { name: 'Test Solar Ltd' });
  otherSeller = makeEntity('SELLER', { name: 'Someone Else Ltd' });
  contract = makeContract({ seller_id: sellerEntity.id, status: 'ACTIVE', contract_no: 'PPA/SOLAR/001' });
  otherContract = makeContract({ seller_id: otherSeller.id, status: 'ACTIVE', contract_no: 'PPA/OTHER/001' });
  seller = tokenFor('SELLER', { linked_entity_id: sellerEntity.id, name: 'Primary Seller' });
  maker = tokenFor('SELLER_L1', { linked_entity_id: sellerEntity.id, name: 'Seller Maker' });
});

const upload = (rows, who = seller, extra = {}) =>
  request(app).post('/api/invoices/upload').set(auth(who)).send({ rows, ...extra });
const invoicesFor = (contractId) =>
  db.prepare('SELECT * FROM invoices WHERE contract_id = ? ORDER BY rowid').all(contractId);

describe('S27 Seller invoices from a template', () => {
  it('publishes the template the sheet is filled from', async () => {
    const r = await request(app).get('/api/invoices/upload-template').set(auth(seller));
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/seller_invoice_template\.csv/);
    const [header] = r.text.trim().split('\n');
    expect(header.split(',')).toEqual([
      'contract_no', 'billing_period', 'invoice_no', 'invoice_type',
      'energy_mwh', 'tariff_per_unit', 'energy_charges', 'transmission_charges',
      'rebate', 'lps', 'penalty', 'other_adjustments', 'taxes',
    ]);
  });

  it('says what a sheet would raise without raising any of it', async () => {
    const r = await upload([row(), row({ billing_period: '2026-07' })], seller, { dry_run: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dry_run: true, would_raise: 2, failed: 0 });
    expect(r.body.preview[0]).toMatchObject({
      row: 1, contract_no: 'PPA/SOLAR/001', billing_period: '2026-08', status: 'SUBMITTED',
    });
    expect(invoicesFor(contract.id)).toHaveLength(0);
  });

  it('raises the bills, totalling each the way the form does', async () => {
    const r = await upload([row({ transmission_charges: 50000, rebate: 20000, taxes: 1000 })]);
    expect(r.status).toBe(201);
    expect(r.body.successful).toBe(1);
    const [invoice] = invoicesFor(contract.id);
    expect(invoice.total_amount).toBe(3150000 + 50000 + 1000 - 20000);
    expect(invoice.status).toBe('SUBMITTED');
    expect(invoice.direction).toBe('SELLER_TO_SJVN');
    expect(invoice.due_date).toBeTruthy();
    expect(invoice.created_by).toBe('Primary Seller');
    // An approval row, as the form creates.
    expect(db.prepare('SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ?').get(invoice.id).c).toBe(1);
  });

  it("leaves a maker's upload as drafts for its own checker", async () => {
    const r = await upload([row()], maker);
    expect(r.body.preview[0].status).toBe('DRAFT');
    expect(invoicesFor(contract.id)[0].status).toBe('DRAFT');
  });

  it('will not bill on a contract that is not the seller’s', async () => {
    const r = await upload([row({ contract_no: 'PPA/OTHER/001' })], seller, { dry_run: true });
    expect(r.body.errors[0].error).toMatch(/not yours to bill on/);
    expect(invoicesFor(otherContract.id)).toHaveLength(0);
  });

  it('refuses a contract that is missing or not active', async () => {
    db.prepare("UPDATE contracts SET status = 'TERMINATED' WHERE id = ?").run(contract.id);
    const r = await upload([row(), row({ contract_no: 'PPA/NOBODY' })], seller, { dry_run: true });
    expect(r.body.failed).toBe(2);
    expect(r.body.errors[0].error).toMatch(/is TERMINATED, not ACTIVE/);
    expect(r.body.errors[1].error).toMatch(/contract PPA\/NOBODY not found/);
  });

  it('checks the period, the type and every amount', async () => {
    const r = await upload([
      row({ billing_period: 'Aug-2026' }),
      row({ invoice_type: 'ESTIMATE' }),
      row({ energy_mwh: 0 }),
      row({ rebate: -5 }),
      row({ energy_charges: 'many' }),
    ], seller, { dry_run: true });
    expect(r.body.failed).toBe(5);
    const errors = r.body.errors.map((e) => e.error);
    expect(errors[0]).toMatch(/billing_period must be YYYY-MM/);
    expect(errors[1]).toMatch(/invoice_type must be one of/);
    expect(errors[2]).toMatch(/energy_mwh must be greater than zero/);
    expect(errors[3]).toMatch(/rebate cannot be negative/);
    expect(errors[4]).toMatch(/energy_charges must be a number/);
  });

  it('will not bill the same month twice, in one file or across two', async () => {
    const twice = await upload([row(), row()], seller, { dry_run: true });
    expect(twice.body.failed).toBe(1);
    expect(twice.body.errors[0].error).toMatch(/appears twice in this file/);

    await upload([row()]);
    const again = await upload([row()], seller, { dry_run: true });
    expect(again.body.errors[0].error).toMatch(/is already billed by/);

    // A supplementary for the same month is a different thing, and is allowed.
    const supp = await upload([row({ invoice_type: 'SUPPLEMENTARY' })], seller, { dry_run: true });
    expect(supp.body.failed).toBe(0);
  });

  it('refuses an invoice number the platform already holds', async () => {
    await upload([row({ invoice_no: 'SELLER/2026/08/01' })]);
    const r = await upload([row({ billing_period: '2026-07', invoice_no: 'SELLER/2026/08/01' })], seller, { dry_run: true });
    expect(r.body.errors[0].error).toMatch(/already on record/);
  });

  it('names a column it does not read', async () => {
    const r = await upload([{ ...row(), status: 'APPROVED' }], seller, { dry_run: true });
    expect(r.body.errors[0].error).toMatch(/unknown column\(s\): status/);
  });

  it('validates each bill against SJVN’s own figure, as the form does', async () => {
    const r = await upload([row()]);
    expect(r.body.invoices[0].validation_status).toBeTruthy();
    expect(invoicesFor(contract.id)[0].validation_status).toBeTruthy();
  });

  it('keeps the loader to sellers and the REIA desk', async () => {
    const buyer = tokenFor('BUYER');
    expect((await upload([row()], buyer)).status).toBe(403);
    expect((await request(app).get('/api/invoices/upload-template').set(auth(buyer))).status).toBe(403);
    expect((await upload([row()], reia)).status).toBe(201);
  });

  it('refuses an empty sheet', async () => {
    const r = await upload([]);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/No rows supplied/);
  });

  it('records the upload in the audit trail', async () => {
    await upload([row()]);
    const entry = db.prepare(`
      SELECT action, details FROM audit_logs WHERE action = 'BULK_UPLOAD_INVOICES' ORDER BY rowid DESC LIMIT 1
    `).get();
    expect(entry).toBeTruthy();
    expect(JSON.parse(entry.details)).toMatchObject({ successful: 1, failed: 0, status: 'SUBMITTED' });
  });
});
