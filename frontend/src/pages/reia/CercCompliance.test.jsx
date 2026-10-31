import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

// Which CERC returns are owed — including the periods nobody has started, which a
// register of prepared filings cannot show.

const state = vi.hoisted(() => ({ answer: null, calls: [], role: 'REIA_MAKER', annexures: null, licence: null, saved: [], path: '/' }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('../../api/client.js', () => {
  const api = {
    reports: {
      cercCompliance: (params) => { state.calls.push(params); return Promise.resolve(state.answer); },
      cercAnnexures: () => Promise.resolve(state.annexures),
      cercLicence: () => Promise.resolve(state.licence),
      saveCercLicence: (fy, body) => { state.saved.push([fy, body]); return Promise.resolve(state.licence); },
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
  state.role = 'REIA_MAKER';
  state.saved = [];
  state.path = '/';
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

// Where a click took the screen.
function Where() {
  state.at = useLocation();
  return null;
}
const render = async () => { await act(async () => { root.render(<MemoryRouter initialEntries={[state.path]}><CercCompliance /><Where /></MemoryRouter>); }); };

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
  // The REIA workflow has the REIA team prepare and submit Form-IV (31-Oct-2026):
  // its shortcut opens the REIA desk's own Form-IV screen, the trading desk's its own.
  it('offers the Form-IV shortcut to the desk that files it, on that desk\'s own screen', async () => {
    await render();
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent);
    // Not started → prepare; filed → view.
    expect(labels.filter((l) => l === 'Prepare Form-IV')).toHaveLength(3);
    expect(labels).toContain('View filing');
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Prepare Form-IV').click(); });
    expect(state.at.pathname).toBe('/reia/form-iv');

    act(() => root.unmount());
    root = createRoot(host);
    state.role = 'TRADING_USER';
    await render();
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Prepare Form-IV').click(); });
    expect(state.at.pathname).toBe('/trading/form-iv');
  });

  it('opens a period into its annexures, NIL where a form has nothing', async () => {
    state.annexures = {
      basis: 'TRADE_BOOK', form_no: null,
      annexures: [
        { code: 'IV-A', title: 'Short-term RTC', unverified: false, row_count: 1, volume_mu: 7.44, margins: null,
          sections: [{ key: 'A', label: 'Inter State Trading Transactions' }],
          columns: [{ key: 'sr', label: 'Sr.No', group: null }, { key: 'seller', label: 'Name of the Seller', group: 'Purchased from' }],
          rows: [{ section: 'A', seller: 'Teesta Urja', source_ref: 'X' }] },
        { code: 'IV-B', title: 'Short-term Peak', unverified: false, row_count: 0, volume_mu: 0, margins: null, sections: [], columns: [], rows: [] },
      ],
    };
    await render();
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Annexures');
    await act(async () => { btn.click(); });

    expect(host.textContent).toContain('read straight from the trade book');
    expect(host.textContent).toContain('IV-B · NIL');
    expect(host.textContent).toContain('Purchased from: Name of the Seller');
    expect(host.textContent).toContain('Teesta Urja');
  });

  it('shows the licence fee and net worth year by year, and lets a writer record them', async () => {
    state.path = '/?view=licence';
    state.licence = {
      category: 'I', licensee: 'SJVN Limited', fee_amount_due: 4000000, min_net_worth_cr: 50,
      next_fee: { fy: '2027-28', due_date: '2027-04-30', days_left: 200 },
      totals: { fee_overdue: 1, net_worth_pending: 1, net_worth_shortfall: 0 },
      years: [{
        fy: '2026-27', is_current: true, fee_due_date: '2026-04-30', fee_amount_due: 4000000, fee_status: 'OVERDUE',
        fee_days_past_due: 165, net_worth_status: 'PENDING', net_worth_cr: null, volume_mu: 142.8,
      }],
    };
    await render();
    expect(host.textContent).toContain('165 days past due');
    expect(host.textContent).toContain('Not recorded');

    const record = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Record');
    await act(async () => { record.click(); });
    await act(async () => { host.ownerDocument.querySelector('form').requestSubmit(); });
    expect(state.saved[0][0]).toBe('2026-27');
  });
});
