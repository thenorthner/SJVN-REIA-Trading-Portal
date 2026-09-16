import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// A REC lot used to go from APPLIED straight to ISSUED, so an application the
// NLDC had sat on for a month looked exactly like one filed yesterday. The
// screen now carries the JMR, the registry application, its papers, and the
// queue of applications somebody has to chase.

const state = vi.hoisted(() => ({ rows: [], summary: {}, reference: {}, issuable: [], followUps: [], detail: null, stepBody: null, stepError: null }));
vi.mock('../../api/client.js', () => {
  const api = {
    rec: {
      list: () => Promise.resolve(state.rows),
      summary: () => Promise.resolve(state.summary),
      reference: () => Promise.resolve(state.reference),
      issuable: () => Promise.resolve(state.issuable),
      followUps: () => Promise.resolve(state.followUps),
      get: () => Promise.resolve(state.detail),
      registryStep: (id, body) => {
        state.stepBody = body;
        if (state.stepError) return Promise.reject({ response: { data: { error: state.stepError } } });
        return Promise.resolve(state.detail);
      },
      uploadDocument: () => Promise.resolve({ id: 'RLD-1' }),
      downloadDocument: () => Promise.resolve(new Blob(['x'])),
    },
  };
  return { api, default: api };
});
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { role: 'TRADING_USER', name: 'Verify' } }) }));

const RECManagement = (await import('./RECManagement.jsx')).default;

const LOT = {
  id: 'REC-1', rec_no: 'REC/2026/001', source: 'CSPP Charanka', technology: 'Solar', vintage_month: '2026-08',
  status: 'APPLIED', position: 'NOT_ISSUED', applied_qty: 1250, issued_qty: 0, sold_qty: 0, redeemed_qty: 0,
  held_qty: 0, certificate_multiplier: 1, issuance_date: null, registry_stage: 'SUBMITTED',
  application_no: 'NLDC/REC/2026/1142', application_date: '2026-09-05', jmr_reference: 'JMR/CSPP/2026-08',
  jmr_date: '2026-09-03', next_follow_up_date: '2026-09-20',
  registry_events: [
    { id: 'E1', stage: 'JMR_RECEIVED', label: 'JMR received from CSPP', note: null, next_follow_up_date: null, actor: 'Desk', created_at: '2026-09-03 10:00:00' },
    { id: 'E2', stage: 'SUBMITTED', label: 'Application submitted on the NLDC REC Registry', note: null, next_follow_up_date: '2026-09-20', actor: 'Desk', created_at: '2026-09-05 11:30:00' },
  ],
  documents: [
    { id: 'D1', doc_type: 'JMR', file_name: 'jmr-aug.pdf', size_bytes: 20480, uploaded_by: 'Desk', created_at: '2026-09-03 10:05:00' },
  ],
  transactions: [],
};

let host, root;
beforeEach(() => {
  state.rows = [LOT];
  state.summary = { issued_recs: 0, held_recs: 0, sold_recs: 0, aging: {}, by_technology: [] };
  state.reference = { multipliers: { Solar: 1 }, next_sessions: [] };
  state.issuable = [];
  state.followUps = [];
  state.detail = LOT;
  state.stepBody = null;
  state.stepError = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => { await act(async () => { root.render(<RECManagement />); }); };
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const click = async (text) => {
  const el = button(text);
  expect(el, `no button "${text}"`).toBeTruthy();
  await act(async () => { el.click(); });
};
const openLot = async () => {
  const row = [...host.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('REC/2026/001'));
  await act(async () => { row.click(); });
};
const setValue = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('REC registry application', () => {
  it('shows where the application stands and every step it took', async () => {
    await render();
    await openLot();
    expect(host.textContent).toMatch(/Application submitted on the NLDC REC Registry/);
    expect(host.textContent).toMatch(/NLDC\/REC\/2026\/1142/);
    expect(host.textContent).toMatch(/JMR\/CSPP\/2026-08/);
    // Both steps are on the lot, and each carries the stored UTC timestamp
    // rendered in the reader's own timezone rather than raw.
    const steps = [...host.querySelectorAll('tbody tr')].filter((tr) => /JMR received from CSPP|Application submitted on the NLDC/.test(tr.textContent));
    expect(steps).toHaveLength(2);
    expect(steps[0].textContent).toMatch(/2026, \d{2}:\d{2}/);
    expect(host.textContent).toMatch(/jmr-aug\.pdf/);
  });

  it('asks only for what the chosen step needs, and sends nothing blank', async () => {
    await render();
    await openLot();
    await click('Record a step / follow-up');
    const stage = [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'FOLLOW_UP'));
    await setValue(stage, 'FOLLOW_UP');
    // A follow-up is about the chase, so it asks what was done, not for an application number.
    expect(host.textContent).toMatch(/What the follow-up was/);
    const note = [...host.querySelectorAll('input')].find((i) => i.required && i.type === 'text');
    await setValue(note, 'Rang the SLDC, energy account promised this week');
    await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(state.stepBody).toEqual({ stage: 'FOLLOW_UP', note: 'Rang the SLDC, energy account promised this week' });
  });

  it('shows the server\'s refusal instead of pretending the step was recorded', async () => {
    state.stepError = 'Record the NLDC REC Registry application number first.';
    await render();
    await openLot();
    await click('Record a step / follow-up');
    const stage = [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'FOLLOW_UP'));
    await setValue(stage, 'APPROVED');
    await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(host.textContent).toMatch(/Record the NLDC REC Registry application number first/);
  });

  it('hides the application panel once the certificates are issued', async () => {
    state.detail = { ...LOT, issuance_date: '2026-09-20', registry_ref: 'REG-99', status: 'ISSUED', position: 'HELD', issued_qty: 1250, held_qty: 1250 };
    await render();
    await openLot();
    expect(host.textContent).not.toMatch(/NLDC REC Registry application/);
    expect(host.textContent).toMatch(/registry reference/i);
  });

  it('lists the applications somebody has to chase, worst first', async () => {
    state.followUps = [
      { lot_id: 'REC-1', rec_no: 'REC/2026/001', source: 'CSPP Charanka', vintage_month: '2026-08', application_no: 'NLDC/REC/2026/1142', stage_label: 'Application submitted on the NLDC REC Registry', next_follow_up_date: '2026-09-10', due_in_days: -6, idle_days: 11, reason: 'OVERDUE' },
      { lot_id: 'REC-2', rec_no: 'REC/2026/002', source: 'CSPP Bhadla', vintage_month: '2026-08', application_no: null, stage_label: 'Not started', next_follow_up_date: null, due_in_days: null, idle_days: 30, reason: 'NO_FOLLOW_UP_SET' },
    ];
    await render();
    expect(host.textContent).toMatch(/Registry applications needing a follow-up/);
    expect(host.textContent).toMatch(/6d late/);
    expect(host.textContent).toMatch(/Untouched 30d/);
    expect(host.textContent).toMatch(/Not filed yet/);
  });
});
