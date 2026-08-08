import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../src/db/index.js';
import { makeEntity, columnsOf, resetReia } from '../helpers/reia.js';
import fs, { readFileSync } from 'fs';
import { billParts } from '../../src/scripts/invoicePdf.js';
import path from 'path';

beforeEach(() => resetReia());

describe('S6 Seller letterhead handling', () => {
  it('captures a per-seller invoice template at onboarding', () => {
    expect(columnsOf('entities')).toEqual(expect.arrayContaining(['invoice_template_json', 'logo_url', 'signature_url']));
  });

  it('keeps each seller template separate', () => {
    const a = makeEntity('SELLER', { name: 'Seller A' });
    const b = makeEntity('SELLER', { name: 'Seller B' });
    db.prepare('UPDATE entities SET invoice_template_json = ? WHERE id = ?').run(JSON.stringify({ header: 'A Ltd' }), a.id);
    db.prepare('UPDATE entities SET invoice_template_json = ? WHERE id = ?').run(JSON.stringify({ header: 'B Ltd' }), b.id);
    expect(db.prepare('SELECT invoice_template_json t FROM entities WHERE id = ?').get(a.id).t)
      .not.toBe(db.prepare('SELECT invoice_template_json t FROM entities WHERE id = ?').get(b.id).t);
  });

  it('renders SJVN outgoing bills on SJVN letterhead, not the seller\'s', () => {
    const src = readFileSync('src/scripts/invoicePdf.js', 'utf-8');
    expect(fs.existsSync(path.resolve('src/assets/sjvn_logo.jpg')), 'SJVN brand asset missing').toBe(true);
    expect(src).toMatch(/sjvn_logo/i);

    const fn = src.slice(src.indexOf('function resolveParties'), src.indexOf('function resolveParties') + 900);
    const outgoing = fn.slice(fn.indexOf('SJVN_TO_BUYER'), fn.indexOf('} else {'));
    expect(outgoing.length, 'could not read the outgoing branch').toBeGreaterThan(0);
    // The outgoing branch must not take its issuer from the seller record.
    expect(outgoing, 'an outgoing bill still takes its issuer from the seller').not.toMatch(/issuer = seller/);
    expect(outgoing).toMatch(/SJVN_FALLBACK/);
  });

  it('still bills SJVN on the seller\'s own letterhead for an inbound bill', () => {
    const src = readFileSync('src/scripts/invoicePdf.js', 'utf-8');
    const inbound = src.slice(src.indexOf('} else {', src.indexOf('resolveParties')));
    expect(inbound).toMatch(/issuer = seller/);
  });
});

describe('S6 The printed bill adds up to what it asks for', () => {
  // The grand total row is labelled "(A+B)" but printed total_amount, which
  // carries neither the rebate nor the surcharge. A seller bill showing a
  // -2,625 rebate line still demanded the full 1,75,000 directly beneath it,
  // and the API's own payable_now disagreed with the paper at 1,72,375.
  //
  // Part A compounded it by carrying only energy charges, so a two-part
  // tariff's fixed charge and deemed generation were inside the total without
  // appearing anywhere on the bill; and Part B summed an expression rather than
  // its own printed lines, so pass-through charges were itemised and then left
  // out of the subtotal.

  /** What the billing engine puts in total_amount for a given set of charges. */
  const totalAmountFor = (i) =>
    (i.energy_charges || 0) + (i.capacity_charges || 0) + (i.deemed_charges || 0) +
    (i.incentive_charges || 0) + (i.trading_margin || 0) + (i.nrldc_fees || 0) +
    (i.transmission_charges || 0) + (i.taxes || 0) - (i.free_power_deduction || 0) -
    (i.penalty || 0) + (i.other_adjustments || 0) +
    JSON.parse(i.other_charges_json || '[]').reduce((a, c) => a + (Number(c.amount) || 0), 0);

  const shapes = {
    'a plain energy bill': { energy_charges: 200000, transmission_charges: 5000 },
    'one carrying a rebate': { energy_charges: 175000, rebate: 2625 },
    'one carrying a surcharge': { energy_charges: 175000, lps: 1438 },
    'a two-part tariff': { energy_charges: 168000, capacity_charges: 100000 },
    'deemed generation': { energy_charges: 175000, deemed_charges: 105000, deemed_energy_mwh: 30 },
    'a true-up credit note': { energy_charges: 192000, transmission_charges: 4800, other_adjustments: -246000 },
    'GST on the trading margin': { energy_charges: 200000, trading_margin: 3500, taxes: 630 },
    'pass-through other charges': { energy_charges: 100000, other_charges_json: '[{"code":"RLDC_SLDC","label":"RLDC","amount":7500}]' },
    'a CUF penalty': { energy_charges: 175000, penalty: 9000 },
    'free power deducted': { energy_charges: 175000, free_power_deduction: 21000 },
  };

  for (const [name, invoice] of Object.entries(shapes)) {
    it(`reconciles on ${name}`, () => {
      const { subTotalA, subTotalB, grand } = billParts(invoice);
      expect(subTotalA + subTotalB, 'the grand total is not the sum of its own two parts').toBe(grand);
      expect(grand, 'A+B does not rebuild total_amount once rebate and surcharge are put back')
        .toBe(totalAmountFor(invoice) - (invoice.rebate || 0) + (invoice.lps || 0));
    });
  }

  it('sums Part B from the very lines it prints', () => {
    // Pass-through charges were listed and then dropped from the subtotal.
    const { partBItems, subTotalB } = billParts({
      energy_charges: 100000, transmission_charges: 5000, trading_margin: 3500,
      other_charges_json: '[{"code":"RLDC_SLDC","label":"RLDC","amount":7500}]',
    });
    expect(partBItems.reduce((a, [, v]) => a + v, 0)).toBe(subTotalB);
    expect(partBItems.map(([l]) => l)).toContain('RLDC');
    expect(subTotalB).toBe(5000 + 3500 + 7500);
  });

  it('shows the charges that used to be invisible on the face of the bill', () => {
    const { partAExtras } = billParts({
      energy_charges: 168000, capacity_charges: 100000, deemed_charges: 105000, deemed_energy_mwh: 30,
    });
    const labels = partAExtras.map(([l]) => l).join(' | ');
    expect(labels, 'a two-part fixed charge did not appear on the bill').toMatch(/Capacity/);
    expect(labels, 'deemed generation did not appear on the bill').toMatch(/Deemed/);
  });

  it('keeps a clean bill free of empty lines', () => {
    const { partAExtras, partBItems } = billParts({ energy_charges: 200000 });
    expect(partAExtras).toHaveLength(0);
    expect(partBItems).toHaveLength(0);
  });
});
