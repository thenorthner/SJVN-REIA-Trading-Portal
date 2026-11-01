import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// A seller's and a buyer's Reports page is the REIA Dashboard's Reports tab
// under a page header; the API decides what each of them sees. These tests
// hold the page and its "How it works" guide to each side's own words.

vi.mock('../reia/ReiaReportsTab.jsx', () => ({ default: () => <div data-testid="reports-tab">tab</div> }));

const { default: SellerReports } = await import('../seller/SellerReports.jsx');
const { default: BuyerReports } = await import('../buyer/BuyerReports.jsx');
const { counterpartyGuide, COUNTERPARTY_GUIDE_KEYS } = await import('../../content/guides/counterparty.js');

let host, root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async (el) => { await act(async () => { root.render(el); }); };
const reportNames = (side) => counterpartyGuide('reports', side).sections.find((s) => s.id === 'rp-ready').blocks[0].rows.map((r) => r[0]);
const allText = (guide) => JSON.stringify(guide);

describe('Seller and buyer Reports pages', () => {
  it('puts the Reports tab under a header that names each side\'s records', async () => {
    await render(<SellerReports />);
    expect(host.querySelector('h1').textContent).toBe('Reports');
    expect(host.querySelector('.page-subtitle').textContent).toMatch(/Your bills to SJVN/);
    expect(host.querySelector('[data-testid="reports-tab"]')).not.toBeNull();

    await render(<BuyerReports />);
    expect(host.querySelector('.page-subtitle').textContent).toMatch(/SJVN's bills to you/);
    expect(host.querySelector('[data-testid="reports-tab"]')).not.toBeNull();
  });
});

describe('Reports guide', () => {
  it('is one of the counterparty guides', () => {
    expect(COUNTERPARTY_GUIDE_KEYS).toContain('reports');
  });

  it('names the reports a seller sees, from the seller\'s side', () => {
    const names = reportNames('SELLER');
    expect(names).toEqual(expect.arrayContaining(['My bills to SJVN (PPA)', 'Payments received from SJVN', 'What SJVN owes you, by age', 'Energy accounts (PPA)', 'My contracts (PPAs)']));
    expect(names.join(' ')).not.toMatch(/PSA|What you owe SJVN/);
  });

  it('names the reports a buyer sees, from the buyer\'s side', () => {
    const names = reportNames('BUYER');
    expect(names).toEqual(expect.arrayContaining(['Bills from SJVN (PSA)', 'Payments made to SJVN', 'What you owe SJVN, by age', 'Energy supplied to you (PSA)', 'My contracts (PSAs)']));
    expect(names.join(' ')).not.toMatch(/PPA|What SJVN owes you/);
  });

  it('mentions no other desk and no SJVN-only books', () => {
    for (const side of ['SELLER', 'BUYER']) {
      const text = allText(counterpartyGuide('reports', side));
      expect(text).not.toMatch(/Trading|Hydro|Thermal|Commercial|debit note|credit note|Share with/i);
    }
  });
});
