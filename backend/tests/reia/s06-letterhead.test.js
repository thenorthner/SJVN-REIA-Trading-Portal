import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../src/db/index.js';
import { makeEntity, columnsOf, resetReia } from '../helpers/reia.js';
import fs from 'fs';
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

  it('renders SJVN outgoing bills from one fixed SJVN-branded template', () => {
    const logo = path.resolve('src/assets/sjvn_logo.jpg');
    expect(fs.existsSync(logo), 'SJVN brand asset missing').toBe(true);
    const pdf = fs.readFileSync('src/scripts/invoicePdf.js', 'utf-8');
    expect(pdf).toMatch(/sjvn_logo/i);
    // The outgoing template must not be selected from the seller's own record.
    expect(pdf).not.toMatch(/invoice_template_json/);
  });
});
