import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test as setup, expect } from '@playwright/test';
import { ADMIN, INVOICE, CONTRACTS, EVIDENCE, RECON_PERIOD } from './fixtures.js';

// Signs in once for every spec, then raises the records the screens will show —
// through the API the screens use, so the fixtures have the shape real ones do
// (numbering, SLA dates, the reconciliation statement) rather than one a test
// guessed at.

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '.data');

setup('sign in and raise a dispute with evidence, and a reconciliation', async ({ request, baseURL }) => {
  const login = await request.post('/api/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } });
  expect(login.status(), await login.text()).toBe(200);
  const { token, user } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };

  const dispute = await request.post('/api/disputes', {
    headers,
    data: {
      invoice_id: INVOICE.id, reason_code: 'ENERGY_DATA_MISMATCH', charge_line: 'energy_charges',
      issue_description: 'Metered energy for May differs from the billed quantity.',
      disputed_amount: 1000000, raised_by_role: 'SELLER',
    },
  });
  expect(dispute.status(), await dispute.text()).toBeLessThan(300);
  const { id: disputeId, dispute_no: disputeNo } = await dispute.json();

  for (const file of EVIDENCE) {
    const up = await request.post(`/api/disputes/${disputeId}/evidence`, {
      headers,
      multipart: { file: { name: file.name, mimeType: file.mime, buffer: Buffer.from(file.body) } },
    });
    expect(up.status(), await up.text()).toBe(201);
  }

  const recon = await request.post('/api/reconciliation/run', {
    headers,
    data: { contract_id: CONTRACTS.hydro.id, period: RECON_PERIOD, scope: 'REIA_CONTRACT' },
  });
  expect(recon.status(), await recon.text()).toBe(201);
  const { id: reconId, recon_no: reconNo } = await recon.json();

  // The app keeps its session in localStorage, so that is what the specs start with.
  fs.writeFileSync(path.join(DATA, 'admin-state.json'), JSON.stringify({
    cookies: [],
    origins: [{
      origin: new URL(baseURL).origin,
      localStorage: [
        { name: 'sjvn_token', value: token },
        { name: 'sjvn_user', value: JSON.stringify(user) },
      ],
    }],
  }));
  fs.writeFileSync(path.join(DATA, 'runtime.json'), JSON.stringify({ token, disputeId, disputeNo, reconId, reconNo }, null, 2));
});
