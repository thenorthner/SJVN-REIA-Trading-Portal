import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { seedTdsVendors, recordTds, recordChallan, pendingByVendor, summary, panComplianceGaps } from '../src/services/tdsLedger.js';

beforeEach(() => {
  db.prepare('DELETE FROM tds_ledger').run();
  db.prepare('DELETE FROM tds_vendors').run();
  seedTdsVendors();
});

describe('vendor master', () => {
  it('carries the real agency PANs from the ledger', () => {
    const byName = Object.fromEntries(db.prepare('SELECT name, pan FROM tds_vendors').all().map(v => [v.name, v.pan]));
    expect(byName['CTUIL']).toBe('AAJCC2026N');
    expect(byName['GRID-INDIA']).toBe('AAFCP2086B');
    expect(byName['Delhi STU']).toBe('AABCD6342A');
    expect(byName['West Bengal STU']).toBe('AAACW6952G');
  });

  it('is idempotent', () => {
    const before = db.prepare('SELECT COUNT(*) c FROM tds_vendors').get().c;
    seedTdsVendors();
    expect(db.prepare('SELECT COUNT(*) c FROM tds_vendors').get().c).toBe(before);
  });
});

describe('recordTds', () => {
  it('reproduces the ledger deduction on open-access charges', () => {
    // April ledger: CTUIL ISTS 80,568 withheld 8,057 under 194C at 10%.
    const r = recordTds({ vendorName: 'CTUIL', taxableAmount: 80568 });
    expect(r.section).toBe('194C');
    expect(r.rate).toBe(0.10);
    expect(r.tds_amount).toBe(8057);
    expect(r.vendor_pan).toBe('AAJCC2026N');
  });

  it('reproduces the May deduction too', () => {
    expect(recordTds({ vendorName: 'CTUIL', taxableAmount: 97111 }).tds_amount).toBe(9711);
  });

  it('applies a 194Q override at 0.1% for energy', () => {
    // Energy invoice 86,60,920 withheld 8,661.
    const r = recordTds({ vendorName: 'NTPCREL', section: '194Q', rate: 0.001, taxableAmount: 8660920 });
    expect(r.tds_amount).toBe(8661);
    expect(r.section).toBe('194Q');
  });

  it('always derives the amount from taxable x rate', () => {
    const r = recordTds({ vendorName: 'CTUIL', taxableAmount: 1000 });
    expect(r.tds_amount).toBe(Math.round(r.taxable_amount * r.rate));
  });

  it('records an unknown vendor under the name given', () => {
    const r = recordTds({ vendorName: 'Some New Agency', taxableAmount: 1000 });
    expect(r.vendor_name).toBe('Some New Agency');
    expect(r.vendor_pan).toBeNull();
  });

  it('refuses to record without a vendor', () => {
    expect(() => recordTds({ taxableAmount: 1000 })).toThrow(/vendorName/);
  });

  it('starts life as an outstanding liability', () => {
    expect(recordTds({ vendorName: 'CTUIL', taxableAmount: 1000 }).status).toBe('DEDUCTED');
  });
});

describe('challan and liability', () => {
  it('clears the liability once a challan is recorded', () => {
    const a = recordTds({ vendorName: 'CTUIL', taxableAmount: 80568 });
    recordTds({ vendorName: 'CTUIL', taxableAmount: 97111 });
    expect(pendingByVendor().find(v => v.vendor_name === 'CTUIL').tds_pending).toBe(8057 + 9711);

    recordChallan(a.id, { challanNo: 'CH-001', challanDate: '2026-05-07' });
    expect(pendingByVendor().find(v => v.vendor_name === 'CTUIL').tds_pending).toBe(9711);
  });

  it('marks the entry deposited', () => {
    const a = recordTds({ vendorName: 'CTUIL', taxableAmount: 1000 });
    expect(recordChallan(a.id, { challanNo: 'CH-002' }).status).toBe('DEPOSITED');
  });

  it('returns null for an entry that does not exist', () => {
    expect(recordChallan('nope', { challanNo: 'CH-003' })).toBeNull();
  });

  it('splits deposited from pending in the 26Q summary', () => {
    const a = recordTds({ vendorName: 'CTUIL', taxableAmount: 80568, period: '2026-04' });
    recordTds({ vendorName: 'CTUIL', taxableAmount: 97111, period: '2026-04' });
    recordChallan(a.id, { challanNo: 'CH-004' });
    const row = summary('2026-04').find(s => s.vendor_name === 'CTUIL');
    expect(row.tds_total).toBe(8057 + 9711);
    expect(row.tds_deposited).toBe(8057);
    expect(row.tds_pending).toBe(9711);
  });
});

describe('194Q PAN compliance', () => {
  it('flags a buyer with no PAN at the higher 206AA rate', () => {
    db.prepare(`INSERT INTO entities (id, entity_type, category, name, status)
                VALUES ('BUY-NOPAN', 'BUYER', 'C&I', 'No PAN Buyer', 'APPROVED')`).run();
    const item = panComplianceGaps().items.find(i => i.entity_id === 'BUY-NOPAN');
    expect(item.has_pan).toBe(false);
    expect(item.tds_rate_applicable).toBe(0.05);
    expect(item.note).toMatch(/206AA/);
  });

  it('puts a buyer with a PAN on the 194Q rate', () => {
    db.prepare(`INSERT INTO entities (id, entity_type, category, name, pan_no, status)
                VALUES ('BUY-PAN', 'BUYER', 'C&I', 'Has PAN Buyer', 'AAAAA1111A', 'APPROVED')`).run();
    const item = panComplianceGaps().items.find(i => i.entity_id === 'BUY-PAN');
    expect(item.has_pan).toBe(true);
    expect(item.tds_rate_applicable).toBe(0.001);
  });

  it('counts the gap', () => {
    const g = panComplianceGaps();
    expect(g.with_pan + g.missing_pan).toBe(g.buyers);
  });
});
