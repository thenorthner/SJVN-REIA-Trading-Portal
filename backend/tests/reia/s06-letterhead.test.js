import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../src/db/index.js';
import { makeEntity, columnsOf, resetReia } from '../helpers/reia.js';
import fs, { readFileSync } from 'fs';
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
