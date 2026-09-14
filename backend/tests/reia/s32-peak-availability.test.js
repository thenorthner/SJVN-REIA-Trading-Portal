import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, resetReia } from '../helpers/reia.js';
import { computePeakAvailabilityPenalty, peakWindowHours } from '../../src/services/peakAvailability.js';

// A peak-power or FDRE PSA does not only buy energy; it buys energy when the
// system needs it, and pays a penalty on the availability it fails to hold inside
// the peak window. The platform charged a CUF shortfall and had nothing for this,
// so that half of those contracts was not priced at all.

let reia, seller;

const peakContract = (over = {}) => makeContract({
  seller_id: seller.id, status: 'ACTIVE', project_type: 'Solar',
  capacity_mw: 100, commissioned_capacity_mw: 100, tariff_per_unit: 3,
  peak_window_start: '18:00', peak_window_end: '23:00',
  min_peak_availability_percent: 90, peak_penalty_per_mwh: 2000,
  ...over,
});

const energy = (contractId, period, over = {}) => {
  const id = newId('ENG');
  db.prepare(`
    INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh,
      cuf_percent, availability_percent, peak_availability_percent, status)
    VALUES (?, ?, ?, 'FINAL', 'REA', ?, ?, ?, ?, 'LOCKED')
  `).run(id, contractId, period, over.energy_mwh ?? 16368, over.cuf_percent ?? 22,
    over.availability_percent ?? null, over.peak_availability_percent ?? null);
  return id;
};

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  seller = makeEntity('SELLER', { name: 'Test Peak Power Ltd' });
});

describe('S32 Peak availability shortfall', () => {
  it('reads a peak window, including one that crosses midnight', () => {
    expect(peakWindowHours('18:00', '23:00')).toBe(5);
    expect(peakWindowHours('22:30', '02:30')).toBe(4);
    expect(peakWindowHours('18:00', '18:00')).toBeNull();
    expect(peakWindowHours('evening', '23:00')).toBeNull();
  });

  it('prices the shortfall against the peak window', () => {
    const contract = peakContract();
    const r = computePeakAvailabilityPenalty({
      contract, periodMonth: '2026-08', capacityMw: 100,
      peakAvailabilityPercent: 80, tariffPerUnit: 3,
    });
    // 10 points short of 90%, over 5 h × 31 days = 155 peak hours on 100 MW:
    // 10% × 100 MW × 155 h = 1,550 MWh at 2,000/MWh.
    expect(r).toMatchObject({ applicable: true, shortfallPercent: 10, peakHours: 155, shortfallMwh: 1550, ratePerMwh: 2000 });
    expect(r.penalty).toBe(3100000);
    expect(r.label).toMatch(/80% against 90%/);
  });

  it('charges nothing when the peak obligation was met', () => {
    const r = computePeakAvailabilityPenalty({
      contract: peakContract(), periodMonth: '2026-08', capacityMw: 100,
      peakAvailabilityPercent: 95, tariffPerUnit: 3,
    });
    expect(r).toMatchObject({ applicable: true, penalty: 0, shortfallPercent: 0 });
    expect(r.label).toMatch(/Peak availability met/);
  });

  it('does not give a contract without a peak obligation one', () => {
    const plain = makeContract({ seller_id: seller.id, status: 'ACTIVE', capacity_mw: 100 });
    const r = computePeakAvailabilityPenalty({
      contract: plain, periodMonth: '2026-08', capacityMw: 100,
      peakAvailabilityPercent: 10, tariffPerUnit: 3,
    });
    expect(r).toMatchObject({ applicable: false, penalty: 0 });
    expect(r.label).toBeNull();
  });

  it('says so rather than charging when the month reported no peak availability', () => {
    const r = computePeakAvailabilityPenalty({
      contract: peakContract(), periodMonth: '2026-08', capacityMw: 100,
      peakAvailabilityPercent: null, tariffPerUnit: 3,
    });
    expect(r).toMatchObject({ applicable: false, penalty: 0, requiredPercent: 90 });
    expect(r.label).toMatch(/not reported for 2026-08/);
  });

  it('says so rather than charging when the obligation has no window', () => {
    const r = computePeakAvailabilityPenalty({
      contract: peakContract({ peak_window_start: null, peak_window_end: null }),
      periodMonth: '2026-08', capacityMw: 100, peakAvailabilityPercent: 50, tariffPerUnit: 3,
    });
    expect(r.penalty).toBe(0);
    expect(r.label).toMatch(/no peak window/);
  });

  it('falls back to the tariff when no penalty rate is set', () => {
    const r = computePeakAvailabilityPenalty({
      contract: peakContract({ peak_penalty_per_mwh: null }),
      periodMonth: '2026-08', capacityMw: 100, peakAvailabilityPercent: 89, tariffPerUnit: 3.5,
    });
    // 3.5 Rs/kWh is 3,500 Rs/MWh.
    expect(r.ratePerMwh).toBe(3500);
  });

  it('puts the shortfall on the bill, beside the CUF penalty', async () => {
    const contract = peakContract({ contract_no: 'PSA/PEAK/001', min_cuf_percent: 22 });
    energy(contract.id, '2026-08', { energy_mwh: 16368, cuf_percent: 22, peak_availability_percent: 80 });

    const r = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: contract.id, period_month: '2026-08' });
    expect(r.status).toBeLessThan(400);

    const invoice = db.prepare("SELECT * FROM invoices WHERE contract_id = ? AND billing_period = '2026-08'").get(contract.id);
    expect(invoice).toBeTruthy();
    const breakdown = JSON.parse(invoice.invoice_breakdown_json || '[]');
    const peakLine = breakdown.find((b) => b.code === 'PEAKPEN');
    expect(peakLine).toBeTruthy();
    expect(peakLine.value).toBe(3100000);
    expect(invoice.penalty).toBeGreaterThanOrEqual(3100000);
  });

  it('keeps the peak obligation through the form and an amendment', async () => {
    const created = await request(app).post('/api/contracts').set(auth(reia)).send({
      contract_no: 'PSA/PEAK/FORM', contract_type: 'PSA', project_type: 'Solar',
      buyer_id: makeEntity('BUYER', { name: 'Peak Discom' }).id,
      capacity_mw: 100, tariff_per_unit: 3, tenure_start: '2026-04-01', tenure_end: '2031-03-31',
      peak_window_start: '18:00', peak_window_end: '23:00',
      min_peak_availability_percent: 85, peak_penalty_per_mwh: 1500,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      peak_window_start: '18:00', peak_window_end: '23:00',
      min_peak_availability_percent: 85, peak_penalty_per_mwh: 1500,
    });

    // An amendment writes a new version row; the obligation has to come with it.
    const amended = await request(app).post(`/api/contracts/${created.body.id}/amend`).set(auth(reia))
      .send({ tariff_per_unit: 3.2, remarks: 'Tariff revision', effective_from: '2026-10-01' });
    expect(amended.status).toBeLessThan(400);
    const version = db.prepare(`
      SELECT min_peak_availability_percent, peak_window_start FROM contracts
      WHERE contract_no = 'PSA/PEAK/FORM' ORDER BY version DESC LIMIT 1
    `).get();
    expect(version, 'the amendment dropped the peak obligation').toMatchObject({
      min_peak_availability_percent: 85, peak_window_start: '18:00',
    });
  });

  it('leaves an ordinary contract’s bill exactly as it was', async () => {
    const plain = makeContract({
      seller_id: seller.id, status: 'ACTIVE', project_type: 'Solar', contract_no: 'PPA/PLAIN/001',
      capacity_mw: 100, commissioned_capacity_mw: 100, tariff_per_unit: 3, min_cuf_percent: 22,
    });
    energy(plain.id, '2026-08', { energy_mwh: 16368, cuf_percent: 22 });

    const r = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: plain.id, period_month: '2026-08' });
    expect(r.status).toBeLessThan(400);
    const invoice = db.prepare("SELECT * FROM invoices WHERE contract_id = ? AND billing_period = '2026-08'").get(plain.id);
    const breakdown = JSON.parse(invoice.invoice_breakdown_json || '[]');
    expect(breakdown.find((b) => b.code === 'PEAKPEN')).toBeUndefined();
  });
});
