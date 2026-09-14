import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, resetReia } from '../helpers/reia.js';

// Loading signed contracts from a spreadsheet. The loader existed; what was
// missing around it was the template that says which columns it reads, a dry run
// that says what would happen before anything is written, and the checks the
// form route applies — a file could name a counterparty that does not exist, or
// one still in onboarding, and the row loaded anyway.

let reia, seller, buyer;

const row = (over = {}) => ({
  contract_no: 'BULK/PPA/001',
  contract_type: 'PPA',
  project_type: 'SOLAR',
  seller_id: seller.id,
  capacity_mw: 100,
  tariff_per_unit: 3.15,
  tenure_start: '2026-04-01',
  tenure_end: '2051-03-31',
  ...over,
});

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  seller = makeEntity('SELLER', { name: 'Test Solar Ltd' });
  buyer = makeEntity('BUYER', { name: 'Test Discom' });
});

const upload = (rows, extra = {}) =>
  request(app).post('/api/contracts/bulk-upload').set(auth(reia)).send({ rows, ...extra });
const count = (no) => db.prepare('SELECT COUNT(*) c FROM contracts WHERE contract_no = ?').get(no).c;

describe('S24 Contract bulk load', () => {
  it('publishes a template naming the columns it reads', async () => {
    const r = await request(app).get('/api/contracts/bulk-template').set(auth(reia));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toMatch(/contract_bulk_template\.csv/);
    const [header, ppa, psa] = r.text.trim().split('\n');
    expect(header.split(',')).toEqual([
      'contract_no', 'contract_type', 'project_type', 'seller_id', 'buyer_id',
      'capacity_mw', 'commissioned_capacity_mw', 'cod_date',
      'tariff_per_unit', 'tenure_start', 'tenure_end', 'billing_cycle',
      'emd_amount', 'pbg_amount',
    ]);
    // The two shapes, so nobody has to guess which side a PPA names.
    expect(ppa).toMatch(/^PPA\//);
    expect(psa).toMatch(/^PSA\//);
  });

  it('says what a file would do without writing any of it', async () => {
    const r = await upload([row(), row({ contract_no: 'BULK/PPA/002' })], { dry_run: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dry_run: true, rows_received: 2, would_load: 2, failed: 0 });
    expect(r.body.preview[0]).toMatchObject({
      row: 1, contract_no: 'BULK/PPA/001', counterparty: 'Test Solar Ltd', status: 'DRAFT',
    });
    expect(count('BULK/PPA/001'), 'a dry run wrote to the database').toBe(0);
  });

  it('loads the good rows as drafts and names the bad ones by their line', async () => {
    const r = await upload([
      row({ contract_no: 'BULK/A' }),
      row({ contract_no: 'BULK/B', capacity_mw: 0 }),
      row({ contract_no: 'BULK/C' }),
    ]);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ successful: 2, failed: 1 });
    expect(r.body.errors[0].row).toBe(2);
    expect(r.body.errors[0].error).toMatch(/capacity_mw must be a positive number/);
    expect(db.prepare("SELECT status FROM contracts WHERE contract_no = 'BULK/A'").get().status).toBe('DRAFT');
    expect(count('BULK/B')).toBe(0);
  });

  it('refuses a counterparty that is not on record or not through onboarding', async () => {
    const pending = makeEntity('SELLER', { name: 'Half Onboarded Ltd', status: 'PENDING' });
    const r = await upload([
      row({ contract_no: 'BULK/GHOST', seller_id: 'SELL-NOBODY' }),
      row({ contract_no: 'BULK/PENDING', seller_id: pending.id }),
    ], { dry_run: true });
    expect(r.body.failed).toBe(2);
    expect(r.body.errors[0].error).toMatch(/seller SELL-NOBODY not found/);
    expect(r.body.errors[1].error).toMatch(/Half Onboarded Ltd is PENDING, not APPROVED/);
  });

  it('will not take a buyer where a seller belongs', async () => {
    const r = await upload([row({ seller_id: buyer.id })], { dry_run: true });
    expect(r.body.errors[0].error).toMatch(/is a BUYER, not a SELLER/);
  });

  it('needs the side the contract type is about', async () => {
    const ppa = await upload([row({ seller_id: null })], { dry_run: true });
    expect(ppa.body.errors[0].error).toMatch(/a PPA needs seller_id/);
    const psa = await upload([row({ contract_type: 'PSA', seller_id: null })], { dry_run: true });
    expect(psa.body.errors[0].error).toMatch(/a PSA needs buyer_id/);
    // A PSA that names its buyer is fine, and needs no seller.
    const ok = await upload([row({ contract_type: 'PSA', seller_id: null, buyer_id: buyer.id })], { dry_run: true });
    expect(ok.body.failed).toBe(0);
  });

  it('refuses a contract number it already holds, or one twice in the same file', async () => {
    await upload([row({ contract_no: 'BULK/DUP' })]);
    const again = await upload([row({ contract_no: 'BULK/DUP' })], { dry_run: true });
    expect(again.body.errors[0].error).toMatch(/already on record/);

    const twice = await upload([row({ contract_no: 'BULK/TWICE' }), row({ contract_no: 'BULK/TWICE' })], { dry_run: true });
    expect(twice.body.failed).toBe(1);
    expect(twice.body.errors[0].row).toBe(2);
    expect(twice.body.errors[0].error).toMatch(/appears twice in this file/);
  });

  it('checks the tenure and the dates it is given', async () => {
    const r = await upload([
      row({ contract_no: 'BULK/D1', tenure_end: '2025-01-01' }),
      row({ contract_no: 'BULK/D2', tenure_start: '01-04-2026' }),
      row({ contract_no: 'BULK/D3', billing_cycle: 'FORTNIGHTLY' }),
    ], { dry_run: true });
    expect(r.body.failed).toBe(3);
    expect(r.body.errors[0].error).toMatch(/tenure_end must be after tenure_start/);
    expect(r.body.errors[1].error).toMatch(/tenure_start must be YYYY-MM-DD/);
    expect(r.body.errors[2].error).toMatch(/billing_cycle must be one of/);
  });

  it('names a column it does not read instead of failing on it obscurely', async () => {
    const r = await upload([row({ status: 'ACTIVE', remarks: 'load me live' })], { dry_run: true });
    expect(r.body.errors[0].error).toMatch(/unknown column\(s\): status, remarks/);
    expect(r.body.errors[0].error).toMatch(/bulk-template/);
  });

  it('defaults the commissioned capacity to the contracted capacity', async () => {
    await upload([row({ contract_no: 'BULK/CAP' })]);
    const c = db.prepare("SELECT capacity_mw, commissioned_capacity_mw FROM contracts WHERE contract_no = 'BULK/CAP'").get();
    expect(c.commissioned_capacity_mw).toBe(c.capacity_mw);
  });

  it('refuses an empty file rather than reporting a successful load of nothing', async () => {
    const r = await upload([]);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/No rows supplied/);
  });

  it('keeps the loader and its template inside the REIA desk', async () => {
    const sellerUser = tokenFor('SELLER');
    expect((await request(app).post('/api/contracts/bulk-upload').set(auth(sellerUser)).send({ rows: [row()] })).status).toBe(403);
    expect((await request(app).get('/api/contracts/bulk-template').set(auth(sellerUser))).status).toBe(403);
  });

  it('records the load in the audit trail, dry runs included', async () => {
    await upload([row({ contract_no: 'BULK/AUDIT' })], { dry_run: true });
    await upload([row({ contract_no: 'BULK/AUDIT' })]);
    const actions = db.prepare(`
      SELECT action FROM audit_logs WHERE entity_type = 'contract' AND action LIKE 'BULK_UPLOAD%'
      ORDER BY rowid
    `).all().map((r) => r.action);
    expect(actions).toContain('BULK_UPLOAD_DRY_RUN');
    expect(actions).toContain('BULK_UPLOAD');
  });
});
