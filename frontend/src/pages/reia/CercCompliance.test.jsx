import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Which CERC returns are owed — including the periods nobody has started, which a
// register of prepared filings cannot show.

const state = vi.hoisted(() => ({ answer: null, calls: [] }));
vi.mock('../../api/client.js', () => {
  const api = {
    reports: {
      cercCompliance: (params) => { state.calls.push(params); return Promise.resolve(state.answer); },
    },
  };
  return { api, default: api };
});

const CercCompliance = (await import('./CercCompliance.jsx')).default;

const period = (over = {}) => ({
  period_type: 'MONTHLY', period: '2026-07', period_from: '2026-07-01', period_to: '2026-07-31',
  due_date: '2026-08-30', status: 'MISSING', overdue: true, days_past_due: 15,
  form_no: null, submission_date: null, reference_no: null,
  total_volume_mu: null, trading_margin: null, line_count: null, breach_count: 0, ...over,
});

const ANSWER = {
  from: '2026-06', to: '2026-08', today: '2026-09-14',
  totals: { expected: 4, submitted: 1, prepared: 0, draft: 0, missing: 3, overdue: 2, open_breaches: 2 },
  monthly: [
    period({ period: '2026-08', due_date: '2026-09-30', overdue: false, days_past_due: 0 }),
    period(),
    period({
      period: '2026-06', period_from: '2026-06-01', period_to: '2026-06-30', due_date: '2026-07-30',
      status: 'SUBMITTED', overdue: false, days_past_due: 0, form_no: 'FIV-2026-06',
      submission_date: '2026-07-20', reference_no: 'CERC/ACK/991',
      total_volume_mu: 12.345, trading_margin: 250000, breach_count: 2,
    }),
  ],
  annual: [
    period({ period_type: 'ANNUAL', period: '2025-26', period_from: '2025-04-01', period_to: '2026-03-31', due_date: '2026-04-30' }),
  ],
  note: null,
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

const render = async () => { await act(async () => { root.render(<CercCompliance />); }); };

describe('CERC filing calendar', () => {
  it('counts what has not been started and what is past its deadline', async () => {
    await render();
    expect(host.textContent).toMatch(/Not started/);
    expect(host.textContent).toMatch(/Periods with no return at all/);
    expect(host.textContent).toMatch(/Past their deadline/);
    expect(host.textContent).toMatch(/1 of 4/);
    expect(host.textContent).toMatch(/Margin breaches reported/);
  });

  it('shows a month nobody started, and how late it is', async () => {
    await render();
    const july = [...host.querySelectorAll('.report-table tbody tr')].find((r) => r.textContent.includes('2026-07'));
    expect(july.textContent).toMatch(/Not started/);
    expect(july.textContent).toMatch(/15 days past due/);
    expect(july.textContent).toMatch(/Overdue/);
  });

  it('shows a filed month with its acknowledgement and its breaches', async () => {
    await render();
    const june = [...host.querySelectorAll('.report-table tbody tr')].find((r) => r.textContent.includes('FIV-2026-06'));
    expect(june.textContent).toMatch(/Filed/);
    expect(june.textContent).toMatch(/CERC\/ACK\/991/);
    expect(june.textContent).toMatch(/12\.345/);
    expect(june.textContent).toMatch(/2/);
  });

  it('keeps annual returns in their own table', async () => {
    await render();
    expect(host.textContent).toMatch(/Annual returns/);
    const annual = [...host.querySelectorAll('.report-table')][1];
    expect(annual.textContent).toMatch(/2025-26/);
  });

  it('asks for the window the desk picks', async () => {
    await render();
    const [from, to] = host.querySelectorAll('input[type="month"]');
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(from, '2026-06');
      from.dispatchEvent(new Event('input', { bubbles: true }));
      set.call(to, '2026-07');
      to.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Apply').click(); });
    expect(state.calls[1]).toEqual({ from: '2026-06', to: '2026-07' });
  });

  it('says nothing is owed rather than showing an empty calendar', async () => {
    state.answer = { ...ANSWER, monthly: [], annual: [], note: 'Nothing has been traded yet, so no return is owed.' };
    await render();
    expect(host.textContent).toMatch(/Nothing has been traded yet/);
    expect(host.querySelector('.report-table')).toBeNull();
  });
});
