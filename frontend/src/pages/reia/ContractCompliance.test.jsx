import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

// Which contracts are out of compliance, and on what.

const state = vi.hoisted(() => ({ answer: null, calls: [] }));
vi.mock('../../api/client.js', () => {
  const api = {
    reports: {
      contractCompliance: (params) => { state.calls.push(params); return Promise.resolve(state.answer); },
    },
  };
  return { api, default: api };
});

const ContractCompliance = (await import('./ContractCompliance.jsx')).default;

const check = (code, label, st, detail) => ({ code, label, state: st, detail, due_in_days: null });

const ANSWER = {
  expiry_notice_days: 90,
  totals: { contracts: 3, breach: 1, due: 1, ok: 1, expiring_within_notice: 1 },
  contracts: [
    {
      contract_id: 'CON-B', contract_no: 'PPA/BROKEN/1', contract_type: 'PPA', project_type: 'SOLAR',
      counterparty: 'Lapsed Licence Ltd', status: 'ACTIVE', tenure_start: '2020-04-01', tenure_end: '2026-09-01',
      days_to_expiry: -13, cod_date: null, capacity_mw: 100, commissioned_capacity_mw: 0,
      breach_count: 2, due_count: 1, state: 'BREACH',
      checks: [
        check('TENURE', 'Contract tenure', 'BREACH', 'Ended 13 days ago and still ACTIVE'),
        check('COD', 'Commercial operation', 'BREACH', '2 month(s) of energy accounted with no COD on record'),
        check('CAPACITY', 'Commissioned capacity', 'DUE', 'Nothing commissioned against 100 MW'),
        check('SECURITY', 'Payment security', 'OK', '5000000 lodged'),
        check('APPROVALS', 'Statutory approvals', 'OK', '2 in order'),
      ],
    },
    {
      contract_id: 'CON-D', contract_no: 'PPA/SOON/1', contract_type: 'PPA', project_type: 'WIND',
      counterparty: 'Test Wind Ltd', status: 'ACTIVE', tenure_start: '2021-04-01', tenure_end: '2026-11-01',
      days_to_expiry: 48, cod_date: '2021-06-01', capacity_mw: 50, commissioned_capacity_mw: 50,
      breach_count: 0, due_count: 1, state: 'DUE',
      checks: [check('TENURE', 'Contract tenure', 'DUE', 'Ends in 48 days')],
    },
    {
      contract_id: 'CON-O', contract_no: 'PSA/FINE/1', contract_type: 'PSA', project_type: 'SOLAR',
      counterparty: 'Test Discom', status: 'ACTIVE', tenure_start: '2022-04-01', tenure_end: '2032-03-31',
      days_to_expiry: 2000, cod_date: '2022-05-01', capacity_mw: 80, commissioned_capacity_mw: 80,
      breach_count: 0, due_count: 0, state: 'OK',
      checks: [check('TENURE', 'Contract tenure', 'OK', 'Ends in 2000 days')],
    },
  ],
};

let host, root;
beforeEach(() => {
  state.answer = ANSWER;
  state.calls = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => {
  await act(async () => { root.render(<MemoryRouter><ContractCompliance /></MemoryRouter>); });
};
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const rows = () => [...host.querySelectorAll('.report-table tbody tr')];

describe('contract compliance', () => {
  it('counts each state and lists the worst first', async () => {
    await render();
    expect(host.textContent).toMatch(/Not compliant/);
    expect(host.textContent).toMatch(/Expiring within 90 days/);
    expect(rows()[0].textContent).toMatch(/PPA\/BROKEN\/1/);
    expect(rows()[0].textContent).toMatch(/13d ago/);
    expect(rows()[0].textContent).toMatch(/2 failing, 1 due/);
    expect(rows()[0].textContent).toMatch(/not on record/);
  });

  it('opens a contract to show every check and why', async () => {
    await render();
    await act(async () => { rows()[0].click(); });
    expect(host.textContent).toMatch(/Ended 13 days ago and still ACTIVE/);
    expect(host.textContent).toMatch(/2 month\(s\) of energy accounted with no COD/);
    expect(host.textContent).toMatch(/Nothing commissioned against 100 MW/);
    // Clicking again closes it.
    await act(async () => { rows()[0].click(); });
    expect(host.textContent).not.toMatch(/Ended 13 days ago/);
  });

  it('filters to one state', async () => {
    await render();
    await act(async () => { button('Action due').click(); });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toMatch(/PPA\/SOON\/1/);
    await act(async () => { button('In order').click(); });
    expect(rows()[0].textContent).toMatch(/PSA\/FINE\/1/);
  });

  it('asks again when the notice window changes', async () => {
    await render();
    const input = host.querySelector('input[type="number"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '30');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // React listens for focusout, not blur, and the handler has to be the one
    // rendered after the value changed.
    await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(state.calls[1]).toEqual({ expiry_notice_days: 30 });
  });

  it('says so when a filter matches nothing', async () => {
    state.answer = { ...ANSWER, contracts: [ANSWER.contracts[2]], totals: { ...ANSWER.totals, breach: 0 } };
    await render();
    await act(async () => { button('Not compliant').click(); });
    expect(host.textContent).toMatch(/No contract in this state/);
  });
});
