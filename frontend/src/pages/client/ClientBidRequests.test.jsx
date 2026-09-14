import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// The client's own maker/checker screen: a maker raises, a checker clears, and
// the read-only login does neither. Each role sees only what it may do — a button
// the API would refuse is worse than no button.

const state = vi.hoisted(() => ({ rows: [], user: null, calls: [] }));
vi.mock('../../api/client.js', () => {
  const api = {
    clientBidRequests: {
      list: () => Promise.resolve(state.rows),
      raise: (body) => { state.calls.push(['raise', body]); return Promise.resolve({ ...body, id: 'CBR-NEW' }); },
      check: (id, body) => { state.calls.push(['check', id, body]); return Promise.resolve({}); },
      withdraw: (id, body) => { state.calls.push(['withdraw', id, body]); return Promise.resolve({}); },
    },
  };
  return { api, default: api };
});
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: state.user }) }));

const ClientBidRequests = (await import('./ClientBidRequests.jsx')).default;

const PENDING = {
  id: 'CBR-1', client_id: 'TCL-1', side: 'BUY', exchange: 'IEX', product: 'DAM',
  delivery_date: '2026-09-20', quantum_mw: 50, price_limit_per_unit: 4.5,
  notes: 'Cover the evening peak', status: 'PENDING_CHECK',
  raised_by_name: 'A Maker', raised_at: '2026-09-14 10:00:00',
};
const PLACED = {
  ...PENDING, id: 'CBR-2', status: 'PLACED', quantum_mw: 20,
  checked_by_name: 'A Checker', checked_at: '2026-09-14 11:00:00',
  bid_id: 'BID-77', bid_status: 'CLEARED',
};

let host, root;
beforeEach(() => {
  state.rows = [PENDING, PLACED];
  state.calls = [];
  state.user = { role: 'TRADING_CLIENT_MAKER', name: 'A Maker' };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => { await act(async () => { root.render(<ClientBidRequests />); }); };
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const click = async (label) => { await act(async () => { button(label).click(); }); };
const setField = async (el, value) => {
  await act(async () => {
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};

describe('the client’s bid requests', () => {
  it('shows each request, who raised it and what became of it', async () => {
    await render();
    expect(host.textContent).toMatch(/Awaiting our checker/);
    expect(host.textContent).toMatch(/A Maker/);
    expect(host.textContent).toMatch(/Bid BID-77 · CLEARED/);
    // fmtNumber does not pad decimals anywhere in this app, so 4.5 stays 4.5.
    expect(host.textContent).toMatch(/up to 4\.5/);
    // 50 MW pending + 20 MW placed: only the open one counts as open quantum.
    expect(host.textContent).toMatch(/Open quantum/);
    expect(host.textContent).toMatch(/50 MW/);
  });

  it('lets the maker raise one, and sends what was typed', async () => {
    await render();
    await click('Raise a request');
    const form = host.querySelector('form');
    await setField(form.querySelector('input[type="date"]'), '2026-10-01');
    await setField(form.querySelector('input[type="number"]'), '30');
    await click('Raise the request');
    expect(state.calls[0][0]).toBe('raise');
    expect(state.calls[0][1]).toMatchObject({
      side: 'BUY', exchange: 'IEX', product: 'DAM', delivery_date: '2026-10-01', quantum_mw: 30,
    });
    expect(host.textContent).toMatch(/it now needs your checker/);
  });

  it('gives the maker no way to clear its own request', async () => {
    await render();
    expect(button('Review')).toBeUndefined();
    expect(button('Withdraw')).toBeTruthy();
  });

  it('lets the checker approve, and says what was decided', async () => {
    state.user = { role: 'TRADING_CLIENT_CHECKER', name: 'A Checker' };
    await render();
    expect(button('Raise a request')).toBeUndefined();
    await click('Review');
    expect(host.textContent).toMatch(/Cover the evening peak/);
    await click('Approve');
    expect(state.calls[0]).toEqual(['check', 'CBR-1', { decision: 'APPROVE', remarks: undefined }]);
    expect(host.textContent).toMatch(/the desk can act on it now/);
  });

  it('passes the checker’s remarks when it goes back', async () => {
    state.user = { role: 'TRADING_CLIENT_CHECKER', name: 'A Checker' };
    await render();
    await click('Review');
    await setField(host.querySelector('.modal input.input'), 'Price cap too low');
    await click('Send back');
    expect(state.calls[0]).toEqual(['check', 'CBR-1', { decision: 'REJECT', remarks: 'Price cap too low' }]);
  });

  it('tells the read-only login whose job each half is, and offers neither', async () => {
    state.user = { role: 'TRADING_CLIENT', name: 'A Viewer' };
    await render();
    expect(host.textContent).toMatch(/Raising a request is the maker's to do and clearing it the checker's/);
    expect(button('Raise a request')).toBeUndefined();
    expect(button('Review')).toBeUndefined();
    expect(button('Withdraw')).toBeUndefined();
  });
});
