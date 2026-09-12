import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth } from './helpers/reia.js';

// One NOAR application in full: the approval NRLDC granted, and the open-access
// charges booked against it. Both were on record in different tables and nothing
// read them together, so the detail screen carried one application's numbers
// written into the page.

const APP_NO = 'SJVN-TEST-NR-0001';
const OTHER = 'SJVN-TEST-NR-0002';

let trader;

beforeEach(() => {
  db.prepare('DELETE FROM noar_approval_entries WHERE application_no LIKE ?').run('SJVN-TEST-%');
  db.prepare('DELETE FROM tds_format_entries WHERE application_no LIKE ?').run('SJVN-TEST-%');
  trader = tokenFor('TRADING_USER');

  db.prepare(`
    INSERT INTO noar_approval_entries (
      id, application_no, applicant_name, seller_name, buyer_name,
      from_date, to_date, applied_capacity_mwh, approved_capacity_mwh, approval_no, approval_date
    ) VALUES (?, ?, 'SJVN Limited', 'Test Solar Ltd', 'Test Municipal Council',
      '2026-09-01', '2026-09-01', 437.775, 400.5, 'NR/2026/1/A', '2026-08-30')
  `).run(newId('NOA'), APP_NO);

  db.prepare(`
    INSERT INTO tds_format_entries (
      id, nodal_rldc, application_no, noar_fee, approval_no,
      stoa_posoco, stoa_ctu, stoa_buyer_sldc, total_stoa,
      payment_date, vendor_posoco, pan_posoco, tds_posoco,
      vendor_ctu, pan_ctu, tds_ctu,
      name_buyer_sldc, pan_buyer_sldc, tds_buyer_sldc,
      total_tds, net_payment, actual_stoa_paid, actual_tds_paid
    ) VALUES (?, 'NRLDC', ?, 5000, 'NR/2026/1/A',
      38000, 905920, 19000, 967920,
      '2026-09-04', 'GRID_INDIA', 'AAACP1234A', 3800,
      'PGCIL', 'AAACP5678B', 90592,
      'Delhi SLDC', 'AAACP9999C', 1900,
      96292, 871628, 967920, 96292)
  `).run(newId('TDF'), APP_NO);
});

const get = (path, who = trader) => request(app).get(path).set(auth(who));

describe('one NOAR application', () => {
  it('returns the approval and every charge booked against it', async () => {
    const r = await get(`/api/iset-reports/noar-approvals/${APP_NO}`);
    expect(r.status).toBe(200);
    expect(r.body.approval).toMatchObject({
      applicant_name: 'SJVN Limited',
      seller_name: 'Test Solar Ltd',
      approved_capacity_mwh: 400.5,
      approval_no: 'NR/2026/1/A',
    });

    // The application fee, then one line per agency that charged for the corridor.
    expect(r.body.charges.map((c) => c.name)).toEqual([
      'Application Fee',
      'STOA — Grid India (POSOCO)',
      'STOA — CTU',
      "STOA — Buyer's SLDC",
    ]);
    const ctu = r.body.charges.find((c) => c.name === 'STOA — CTU');
    expect(ctu).toMatchObject({ vendor: 'PGCIL', pan: 'AAACP5678B', payable: 905920, tds: 90592, net: 815328 });
    // A fee with no tax withheld still nets to the amount payable.
    expect(r.body.charges[0]).toMatchObject({ payable: 5000, tds: null, net: 5000 });

    expect(r.body.payment).toMatchObject({
      nodal_rldc: 'NRLDC', payment_date: '2026-09-04',
      total_stoa: 967920, total_tds: 96292, net_payment: 871628,
    });
  });

  it("leaves out the agencies that did not charge for this corridor", async () => {
    const r = await get(`/api/iset-reports/noar-approvals/${APP_NO}`);
    const names = r.body.charges.map((c) => c.name).join('|');
    expect(names).not.toMatch(/Seller's STU|Seller's SLDC|Buyer's STU/);
  });

  it('answers for an application that has charges but no approval yet', async () => {
    db.prepare('DELETE FROM noar_approval_entries WHERE application_no = ?').run(APP_NO);
    const r = await get(`/api/iset-reports/noar-approvals/${APP_NO}`);
    expect(r.status).toBe(200);
    expect(r.body.approval).toBeNull();
    expect(r.body.charges).toHaveLength(4);
  });

  it('says so when no such application is on record', async () => {
    const r = await get(`/api/iset-reports/noar-approvals/${OTHER}`);
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(OTHER);
  });

  it('is still read as an application number, not as a report kind', async () => {
    // '/noar-approvals' itself is the report; '/noar-approvals/<no>' is one row.
    const list = await get('/api/iset-reports/noar-approvals');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
  });

  it('keeps the application inside the trading desk', async () => {
    const seller = tokenFor('SELLER');
    expect((await get(`/api/iset-reports/noar-approvals/${APP_NO}`, seller)).status).toBe(403);
  });
});
