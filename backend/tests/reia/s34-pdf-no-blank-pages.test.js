import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import { app } from '../../src/server.js';
import { tokenFor, auth } from '../helpers/reia.js';

// Every report stamps "Page N of M" on each page once the body is drawn: it
// switches back to each page and writes the footer below the bottom margin.
// PDFKit treats any text drawn with a `width` past that margin as overflow and
// quietly starts a new page for it, so the REIA Dashboard Snapshot went out as a
// full page followed by a blank one carrying nothing but its own page number —
// and a two-page report grew two blank pages.
//
// Whether it happens depends on where each script puts its footer relative to
// its own margins, so the check is on behaviour, not on source: once the footer
// pass has begun (the first switchToPage), no page may be added.

const REPORTS = [
  '/api/reports/billing-summary/pdf',
  '/api/reports/energy-summary/pdf',
  '/api/reports/dispute-summary/pdf',
  '/api/reports/recon-summary/pdf',
  '/api/reports/contract-summary/pdf',
  '/api/reports/reia-dashboard/pdf',
  '/api/reports/market-analytics/pdf',
  '/api/reports/trading-profitability/pdf',
  '/api/reports/trading-dashboard/pdf',
  '/api/reports/activity/pdf',
  '/api/reports/regulatory/pdf',
  '/api/reports/audit/pdf',
  '/api/reports/mis/pdf',
  '/api/bilateral/noar-approval-report.pdf',
];

const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const pageCount = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;

let token;
const addedDuringFooter = [];
const original = {};

beforeAll(() => {
  token = tokenFor('SJVN_ADMIN');
  original.switchToPage = PDFDocument.prototype.switchToPage;
  original.addPage = PDFDocument.prototype.addPage;
  PDFDocument.prototype.switchToPage = function patchedSwitch(...args) {
    this.__footerPass = true;
    return original.switchToPage.apply(this, args);
  };
  PDFDocument.prototype.addPage = function patchedAdd(...args) {
    if (this.__footerPass) addedDuringFooter.push(this.info?.Title || 'untitled');
    return original.addPage.apply(this, args);
  };
});

afterAll(() => {
  PDFDocument.prototype.switchToPage = original.switchToPage;
  PDFDocument.prototype.addPage = original.addPage;
});

describe('S34 Report PDFs carry no blank trailing pages', () => {
  for (const path of REPORTS) {
    it(`${path} adds no page while numbering its pages`, async () => {
      addedDuringFooter.length = 0;
      const res = await request(app).get(path).set(auth(token)).buffer(true).parse(binary);
      expect(res.status, res.text).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect(addedDuringFooter, `the footer pass of ${path} opened new pages`).toEqual([]);
      expect(pageCount(res.body)).toBeGreaterThan(0);
    });
  }

  it('an empty REIA Dashboard Snapshot is one page, not two', async () => {
    const res = await request(app).get('/api/reports/reia-dashboard/pdf').set(auth(token)).buffer(true).parse(binary);
    expect(pageCount(res.body)).toBe(1);
  });
});
