import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Which projects are underperforming, and since when.

const state = vi.hoisted(() => ({ answer: null, calls: [] }));
vi.mock('../../api/client.js', () => {
  const api = {
    reports: {
      generationPerformance: (params) => { state.calls.push(params); return Promise.resolve(state.answer); },
    },
  };
  return { api, default: api };
});

const GenerationPerformance = (await import('./GenerationPerformance.jsx')).default;

const ANSWER = {
  from: null, to: null,
  totals: { months: 3, projects: 2, energy_mwh: 48360, possible_mwh: 223200, shortfall_mwh: 2976, months_below_cuf: 2, period_cuf_percent: 21.67 },
  projects: [
    { contract_id: 'CON-1', contract_no: 'PPA/SOLAR/001', seller_name: 'Test Solar Ltd', project_type: 'Solar', capacity_mw: 100, months: 2, energy_mwh: 29760, possible_mwh: 148800, months_below_cuf: 2, shortfall_mwh: 2976, min_cuf_percent: 22, period_cuf_percent: 20, avg_availability_percent: 95 },
    { contract_id: 'CON-2', contract_no: 'PPA/SOLAR/002', seller_name: 'Another Solar', project_type: 'Solar', capacity_mw: 100, months: 1, energy_mwh: 18600, possible_mwh: 74400, months_below_cuf: 0, shortfall_mwh: 0, min_cuf_percent: 22, period_cuf_percent: 25, avg_availability_percent: null },
  ],
  months: [
    { contract_id: 'CON-1', contract_no: 'PPA/SOLAR/001', period_month: '2026-08', energy_mwh: 14880, possible_mwh: 74400, actual_cuf_percent: 20, min_cuf_percent: 22, cuf_shortfall_percent: 2, shortfall_mwh: 1488, availability_percent: 94, meets_cuf: false, data_type: 'FINAL', source: 'REA', status: 'LOCKED' },
    { contract_id: 'CON-1', contract_no: 'PPA/SOLAR/001', period_month: '2026-07', energy_mwh: 14880, possible_mwh: 74400, actual_cuf_percent: 20, min_cuf_percent: 22, cuf_shortfall_percent: 2, shortfall_mwh: 1488, availability_percent: 96, meets_cuf: false, data_type: 'FINAL', source: 'REA', status: 'LOCKED' },
    { contract_id: 'CON-2', contract_no: 'PPA/SOLAR/002', period_month: '2026-08', energy_mwh: 18600, possible_mwh: 74400, actual_cuf_percent: 25, min_cuf_percent: 22, cuf_shortfall_percent: 0, shortfall_mwh: 0, availability_percent: null, meets_cuf: true, data_type: 'PROVISIONAL', source: 'MANUAL', status: 'VALIDATED' },
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

const render = async () => { await act(async () => { root.render(<GenerationPerformance />); }); };
const rows = (selector) => [...host.querySelectorAll(selector)].map((tr) => tr.textContent);

describe('generation performance', () => {
  it('shows the CUF against what each contract requires', async () => {
    await render();
    expect(host.textContent).toMatch(/CUF over the period/);
    expect(host.textContent).toMatch(/21\.67%/);
    expect(host.textContent).toMatch(/Months below the contract CUF/);
    expect(host.textContent).toMatch(/2,976 MWh short/);
    // Both projects, worst first as the API ordered them.
    const projects = rows('.report-table tbody tr').slice(0, 2);
    expect(projects[0]).toMatch(/PPA\/SOLAR\/001/);
  });

  it('marks a month that missed its CUF and one that met it', async () => {
    await render();
    const monthRows = [...host.querySelectorAll('.report-table')][1].querySelectorAll('tbody tr');
    expect(monthRows[0].querySelector('.badge-red, .badge-danger, .badge')).toBeTruthy();
    // fmtNumber does not pad decimals, so 20 stays 20%.
    expect(monthRows[0].textContent).toMatch(/20%/);
    expect(monthRows[2].textContent).toMatch(/25%/);
    // Where the reading came from, and whether it is final.
    expect(monthRows[2].textContent).toMatch(/PROVISIONAL/);
    expect(monthRows[2].textContent).toMatch(/MANUAL · VALIDATED/);
  });

  it('narrows the months to one project when its row is clicked', async () => {
    await render();
    const row = [...host.querySelectorAll('.report-table tbody tr')].find((tr) => tr.textContent.includes('PPA/SOLAR/002') && tr.className.includes('clickable'));
    await act(async () => { row.click(); });
    const monthRows = [...host.querySelectorAll('.report-table')][1].querySelectorAll('tbody tr');
    expect(monthRows).toHaveLength(1);
    expect(monthRows[0].textContent).toMatch(/PPA\/SOLAR\/002/);
    expect(host.textContent).toMatch(/Showing one project's months below/);
  });

  it('asks the API for the window the desk picks', async () => {
    await render();
    const [from, to] = host.querySelectorAll('input[type="month"]');
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(from, '2026-07');
      from.dispatchEvent(new Event('input', { bubbles: true }));
      set.call(to, '2026-08');
      to.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Apply').click(); });
    expect(state.calls[1]).toEqual({ from: '2026-07', to: '2026-08' });
  });

  it('says nothing is accounted rather than showing an empty grid', async () => {
    state.answer = { ...ANSWER, projects: [], months: [], totals: { ...ANSWER.totals, projects: 0, months: 0, months_below_cuf: 0 } };
    await render();
    expect(host.textContent).toMatch(/No energy has been accounted for this period/);
  });

  it('says when a capacity is missing instead of printing a CUF of zero', async () => {
    state.answer = {
      ...ANSWER,
      projects: [ANSWER.projects[0]],
      months: [{ ...ANSWER.months[0], actual_cuf_percent: null, meets_cuf: null, possible_mwh: 0 }],
    };
    await render();
    expect(host.textContent).toMatch(/capacity not on record/);
  });
});
