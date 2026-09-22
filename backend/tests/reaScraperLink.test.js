import { describe, it, expect } from 'vitest';
import { reaScraper } from '../src/services/reaScraper.js';

// NRPC's site files each REA under a timestamped name, so the desk can hand the
// run a link copied off the site. It is fetched from the server, so only the
// RPC's own host and only a PDF is accepted.
describe('REA link given by the desk', () => {
  const ok = 'https://nrpc.gov.in/allfile/090920261230385307REA0826_P.pdf';

  it('accepts a PDF on the RPC\'s own host', () => {
    expect(reaScraper.checkOverrideUrl('NRPC', ok)).toBe(ok);
  });

  it('refuses any other host, plain http, or something that is not a PDF', () => {
    expect(() => reaScraper.checkOverrideUrl('NRPC', 'https://evil.example/REA0826_P.pdf')).toThrow(/nrpc\.gov\.in/);
    expect(() => reaScraper.checkOverrideUrl('NRPC', 'https://nrpc.gov.in.evil.example/a.pdf')).toThrow(/nrpc\.gov\.in/);
    expect(() => reaScraper.checkOverrideUrl('NRPC', 'http://nrpc.gov.in/allfile/REA0826_P.pdf')).toThrow(/https/);
    expect(() => reaScraper.checkOverrideUrl('NRPC', 'https://127.0.0.1/REA.pdf')).toThrow();
    expect(() => reaScraper.checkOverrideUrl('NRPC', 'https://nrpc.gov.in/api/Topmenu')).toThrow(/PDF/);
    expect(() => reaScraper.checkOverrideUrl('NRPC', 'not a link')).toThrow(/valid link/);
  });
});
