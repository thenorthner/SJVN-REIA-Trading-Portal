import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

// Which developer bills are stuck in verification, and on what.

const state = vi.hoisted(() => ({ answer: null }));
vi.mock('../../api/client.js', () => {
  const api = { reports: { verificationQueue: () => Promise.resolve(state.answer) } };
  return { api, default: api };
});

const VerificationQueue = (await import('./VerificationQueue.jsx')).default;

const check = (key, label, status, hint = '', note = '') => ({ key, label, status, hint, note });

const ANSWER = {
  totals: { invoices: 2, failed: 1, in_progress: 0, pending: 1, verified: 0, value_awaiting: 1100000, oldest_days: 41 },
  blockers: [{ label: 'Tariff Verified', invoices_blocked: 1 }, { label: 'REA Uploaded', invoices_blocked: 1 }],
  invoices: [
    {
      invoice_id: 'INV-1', invoice_no: 'SELLER/2026/08/01', contract_no: 'PPA/VER/001',
      developer_name: 'Test Solar Ltd', billing_period: '2026-08', invoice_type: 'FINAL', status: 'SUBMITTED',
      total_amount: 600000, outstanding: 600000, validation_status: 'MISMATCH',
      verification_status: 'FAILED', days_since_raised: 41,
      technical: [
        check('TARIFF_VERIFIED', 'Tariff Verified', 'FAILED', 'Invoice ₹9.9 vs contract ₹3/unit'),
        check('REA_UPLOADED', 'REA Uploaded', 'VERIFIED', 'REA · LOCKED · 1000 MWh'),
      ],
      commercial: { energy_charges: 500000, change_in_law: 0, compensation_event: 0, liquidated_damages: 0, previous_adjustment: 0, net_invoice: 500000 },
      failed_checks: ['Tariff Verified'], pending_checks: [],
      commercial_net: 500000, commercial_gap: -100000,
      verified_by: null, verified_at: null,
    },
    {
      invoice_id: 'INV-2', invoice_no: 'SELLER/2026/08/02', contract_no: 'PPA/VER/002',
      developer_name: 'Another Solar', billing_period: '2026-08', invoice_type: 'FINAL', status: 'SUBMITTED',
      total_amount: 500000, outstanding: 500000, validation_status: 'PENDING',
      verification_status: 'PENDING', days_since_raised: 4,
      technical: [check('REA_UPLOADED', 'REA Uploaded', 'PENDING', 'No energy data found')],
      commercial: { energy_charges: 500000, change_in_law: 0, compensation_event: 0, liquidated_damages: 0, previous_adjustment: 0, net_invoice: 500000 },
      failed_checks: [], pending_checks: ['REA Uploaded'],
      commercial_net: 500000, commercial_gap: 0,
      verified_by: null, verified_at: null,
    },
  ],
};

let host, root;
beforeEach(() => {
  state.answer = ANSWER;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => {
  await act(async () => { root.render(<MemoryRouter><VerificationQueue /></MemoryRouter>); });
};
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const rows = () => [...host.querySelectorAll('.report-table tbody tr')];

describe('verification queue', () => {
  it('counts what is stuck and names what each bill failed', async () => {
    await render();
    expect(host.textContent).toMatch(/Failed a check/);
    expect(host.textContent).toMatch(/Oldest raised 41 days ago/);
    expect(rows()[0].textContent).toMatch(/SELLER\/2026\/08\/01/);
    expect(rows()[0].textContent).toMatch(/Tariff Verified/);
    expect(rows()[0].textContent).toMatch(/MISMATCH/);
  });

  it('says which check is holding the most bills up', async () => {
    await render();
    expect(host.textContent).toMatch(/What is holding bills up/);
    const blockers = [...host.querySelectorAll('table.data-table tbody tr')].map((r) => r.textContent);
    expect(blockers[0]).toMatch(/Tariff Verified/);
  });

  it('opens a bill to show both halves of the check', async () => {
    await render();
    await act(async () => { rows()[0].click(); });
    expect(host.textContent).toMatch(/Invoice ₹9.9 vs contract ₹3\/unit/);
    expect(host.textContent).toMatch(/Net by the build-up/);
    // The build-up and the bill differ, and the screen says by how much.
    expect(host.textContent).toMatch(/differ by ₹1,00,000/);
  });

  it('does not claim a gap when the build-up matches the bill', async () => {
    await render();
    await act(async () => { rows()[1].click(); });
    expect(host.textContent).not.toMatch(/differ by/);
  });

  it('filters to one state', async () => {
    await render();
    await act(async () => { button('Not started').click(); });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toMatch(/SELLER\/2026\/08\/02/);
    await act(async () => { button('Verified').click(); });
    expect(host.textContent).toMatch(/No bill in this state/);
  });
});
