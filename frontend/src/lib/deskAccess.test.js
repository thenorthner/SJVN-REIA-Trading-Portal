import { describe, it, expect } from 'vitest';
import { deskOf } from './deskAccess.js';

// Which screens the administrators see read-only (desk screens) and which they
// still work on (governance) — Target #2 Phase B.
describe('deskOf', () => {
  it('names the desk of a desk screen', () => {
    expect(deskOf('/reia/invoices')).toBe('REIA');
    expect(deskOf('/reia')).toBe('REIA');
    expect(deskOf('/hydro-thermal/hydro-billing')).toBe('HYDRO');
    expect(deskOf('/thermal')).toBe('THERMAL');
    expect(deskOf('/trading/bids')).toBe('TRADING');
    expect(deskOf('/cerc/form-iv-a')).toBe('TRADING');
  });

  it('leaves governance screens off every desk', () => {
    for (const p of ['/reia/entities', '/reia/document-desk', '/reia/company-users', '/hydro-thermal/stakeholders',
      '/thermal/document-desk', '/masters/hub', '/admin/users', '/admin/project-assignments', '/settings/delegations',
      '/audit-logs', '/notification-board', '/mail', '/trading/bulk-communications', '/']) {
      expect(deskOf(p), p).toBeNull();
    }
  });
});
