import { describe, it, expect } from 'vitest';
import { pageOpen, pageWithdrawn, firstOpenPage, screenRole, screenRoles, actsAs } from './rolePages.js';

const finance = (pages) => ({ role: 'FINANCE_USER', pages });
const REIA = ['FINANCE_USER', 'REIA_MAKER'];

describe('pageOpen', () => {
  it('keeps the menu as written for a role nobody changed', () => {
    expect(pageOpen(finance(null), '/reia/invoices', REIA)).toBe(true);
    expect(pageOpen(finance(null), '/admin/users', ['SJVN_ADMIN'])).toBe(false);
  });

  it('closes a page every power covering it was taken from, and keeps one another power still covers', () => {
    const pages = [
      { pages: ['/reia', '/reia/**'], held: false, given: false },
      { pages: ['/reia/payment-monitoring'], held: true, given: false },
    ];
    expect(pageOpen(finance(pages), '/reia/invoices', REIA)).toBe(false);
    expect(pageOpen(finance(pages), '/reia', REIA)).toBe(false);
    expect(pageOpen(finance(pages), '/reia/payment-monitoring', REIA)).toBe(true);
    // A page no power lists is the menu's to decide.
    expect(pageOpen(finance(pages), '/mail', null)).toBe(true);
  });

  it('opens a page a given power covers, even outside the role\'s menu', () => {
    const pages = [{ pages: ['/audit-logs'], held: true, given: true }];
    expect(pageOpen(finance(pages), '/audit-logs', ['SJVN_ADMIN', 'COMPLIANCE_AUDITOR'])).toBe(true);
  });
});

describe('a role whose landing page was taken away', () => {
  const pages = [
    { pages: ['/reia', '/reia/**', '/trading/generator-billing'], held: false, given: false },
    { pages: ['/reia/payment-monitoring', '/reia/advances'], held: true, given: false },
  ];

  it('tells a withdrawn page from one the role never had', () => {
    expect(pageWithdrawn(finance(pages), '/reia', REIA)).toBe(true);
    expect(pageWithdrawn(finance(pages), '/admin/users', ['SJVN_ADMIN'])).toBe(false);
  });

  it('lands on the first page the role can still open', () => {
    expect(firstOpenPage(finance(pages))).toBe('/reia/payment-monitoring');
    expect(firstOpenPage(finance(pages), (p) => p !== '/reia/payment-monitoring')).toBe('/reia/advances');
    expect(firstOpenPage(finance(null))).toBe(null);
  });
});

describe('screenRole', () => {
  it('draws a given power\'s screens as its owner, and the role\'s own screens as its own', () => {
    // A checker-like role given Finance's confirmation of payments.
    const user = {
      role: 'REIA_CHECKER',
      screens: [{ pages: ['/reia/payment-monitoring', '/reia/advances'], except: ['/reia', '/reia/**', '/reia/invoices'], role: 'FINANCE_USER' }],
    };
    expect(screenRole(user, '/reia/payment-monitoring')).toBe('FINANCE_USER');
    expect(screenRole(user, '/reia/invoices')).toBe('REIA_CHECKER');
    expect(screenRole({ role: 'REIA_MAKER' }, '/reia/invoices')).toBe('REIA_MAKER');
  });

  it('leaves a page the role\'s own power names more closely to the role', () => {
    // A Finance-like role given the whole REIA desk to read: Finance's own screen under it stays Finance's.
    const user = {
      role: 'TRADING_USER',
      screens: [{ pages: ['/reia', '/reia/**'], except: ['/trading/**', '/reia/payment-monitoring'], role: 'COMPLIANCE_AUDITOR' }],
    };
    expect(screenRole(user, '/reia/contracts')).toBe('COMPLIANCE_AUDITOR');
    expect(screenRole(user, '/reia/payment-monitoring')).toBe('TRADING_USER');
    expect(screenRole(user, '/trading/bids')).toBe('TRADING_USER');
  });
});

describe('screenRoles and actsAs', () => {
  // A Finance-like role given the first-level approval of bills.
  const user = {
    role: 'FINANCE_USER',
    screens: [{ pages: ['/reia/invoices', '/reia/verification'], except: ['/reia', '/reia/**', '/reia/payment-monitoring'], role: 'REIA_CHECKER' }],
  };

  it('draws the bills screen with the checker\'s controls and Finance\'s own', () => {
    const roles = screenRoles(user, '/reia/invoices');
    expect(roles).toEqual(['REIA_CHECKER', 'FINANCE_USER']);
    const drawn = { ...user, role: roles[0], roles };
    expect(actsAs(drawn, ['REIA_CHECKER'])).toBe(true);
    expect(actsAs(drawn, ['FINANCE_USER', 'REIA_MAKER'])).toBe(true);
    expect(actsAs(drawn, ['REIA_MAKER'])).toBe(false);
  });

  it('leaves every other screen, and every other user, to the one role', () => {
    expect(screenRoles(user, '/reia/payment-monitoring')).toEqual(['FINANCE_USER']);
    expect(screenRoles({ role: 'REIA_MAKER' }, '/reia/invoices')).toEqual(['REIA_MAKER']);
    expect(actsAs({ role: 'REIA_MAKER' }, ['REIA_MAKER'])).toBe(true);
    expect(actsAs({ role: 'REIA_MAKER' }, ['REIA_CHECKER'])).toBe(false);
    expect(actsAs(null, ['REIA_CHECKER'])).toBe(false);
  });

  it('does not draw a read-only role beside one that acts', () => {
    const both = { role: 'TRADING_USER', screens: [
      { pages: ['/reia/invoices'], except: [], role: 'REIA_CHECKER' },
      { pages: ['/reia', '/reia/**'], except: [], role: 'COMPLIANCE_AUDITOR' },
    ] };
    expect(screenRoles(both, '/reia/invoices')).toEqual(['REIA_CHECKER', 'TRADING_USER']);
    expect(screenRoles(both, '/reia/contracts')).toEqual(['COMPLIANCE_AUDITOR', 'TRADING_USER']);
  });
});
