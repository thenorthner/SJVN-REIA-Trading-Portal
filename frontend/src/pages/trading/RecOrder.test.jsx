import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

// The settlement figures were read off the exchange's obligation report and
// typed in here, even once the report itself was being uploaded. Where it has
// been, the screen takes them from it — only what the report states.

const state = vi.hoisted(() => ({ draft: null, asked: null, created: null }));
vi.mock('../../api/client.js', () => {
  const api = {
    recObligations: {
      settlementDraft: (date, platform) => { state.asked = { date, platform }; return Promise.resolve(state.draft); },
    },
    recTrading: { createOrder: (body) => { state.created = body; return Promise.resolve({ id: 'RCO-1', trade_date: body.trade_date }); } },
  };
  return { api, default: api };
});

const RecOrder = (await import('./RecOrder.jsx')).default;

const FOUND = {
  found: true,
  trade_date: '2026-03-11',
  platform: 'IEX',
  fields: {
    total_recs_sold: 500,
    discovered_rate: 350,
    trade_obligation: 175000,
    exchange_fees: 875,
    net_revenue: 173967.5,
    gst_on_trade_obligation: null,
    gst_on_exchange_fees: null,
    buyer_name: 'Alpha Discom',
  },
  not_stated: ['gst_on_trade_obligation', 'gst_on_exchange_fees'],
  notes: ['The report states GST of ₹157.5, taken off the sale with the fee, without saying how much is on the obligation and how much on the fee — enter the split.'],
  lines: 1,
  files: ['iex-rec-obligation-mar.xlsx'],
};

let host, root;
beforeEach(() => {
  state.draft = FOUND;
  state.asked = null;
  state.created = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => {
  await act(async () => { root.render(<MemoryRouter><RecOrder /></MemoryRouter>); });
};
const setInput = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const fieldInput = (label) => {
  const lab = [...host.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(label));
  return lab?.querySelector('input,select');
};
const clickButton = async (text) => {
  const b = [...host.querySelectorAll('button')].find((x) => x.textContent.includes(text));
  expect(b, `no button "${text}"`).toBeTruthy();
  await act(async () => { b.click(); });
};

describe('REC Order from the obligation report', () => {
  it('asks for the trade date before reading any report', async () => {
    await render();
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent.includes('Fill from uploaded obligation report'));
    expect(button.disabled).toBe(true);
  });

  it('fills what the report states, and names what it left for the desk', async () => {
    await render();
    await setInput(host.querySelector('input[type="date"]'), '2026-03-11');
    await clickButton('Fill from uploaded obligation report');

    expect(state.asked).toEqual({ date: '2026-03-11', platform: 'IEX' });
    expect(fieldInput('Total RECs Sold').value).toBe('500');
    expect(fieldInput('Discovered Rate').value).toBe('350');
    expect(fieldInput('Trade Obligation').value).toBe('175000');
    expect(fieldInput('Exchange Fees').value).toBe('875');
    expect(fieldInput('Net revenue').value).toBe('173967.5');
    expect(fieldInput('Buyer Name').value).toBe('Alpha Discom');
    // The GST the report gives as one figure is not split for the desk.
    expect(fieldInput('GST on Trade Obligation').value).toBe('');
    expect(fieldInput('GST on Exchange Fees').value).toBe('');
    expect(host.textContent).toMatch(/Filled from iex-rec-obligation-mar\.xlsx \(1 sale line\)/);
    expect(host.textContent).toMatch(/does not state: GST on Trade Obligation, GST on Exchange Fees — enter these/);
    expect(host.textContent).toMatch(/GST of ₹157.5, taken off the sale with the fee/);
  });

  it('leaves the form alone when no report covers the session, and says so', async () => {
    state.draft = { found: false, trade_date: '2026-03-11', platform: 'PXIL', message: 'No PXIL obligation report uploaded so far covers 2026-03-11.' };
    await render();
    await setInput(host.querySelector('input[type="date"]'), '2026-03-11');
    await setInput(fieldInput('Exchange'), 'PXIL');
    await setInput(fieldInput('Total RECs Sold'), '42');
    await clickButton('Fill from uploaded obligation report');

    expect(state.asked.platform).toBe('PXIL');
    expect(host.textContent).toMatch(/No PXIL obligation report uploaded so far covers 2026-03-11/);
    expect(fieldInput('Total RECs Sold').value).toBe('42');
  });

  it('drops a stale report note when the trade date changes', async () => {
    await render();
    await setInput(host.querySelector('input[type="date"]'), '2026-03-11');
    await clickButton('Fill from uploaded obligation report');
    expect(host.textContent).toMatch(/Filled from/);
    await setInput(host.querySelector('input[type="date"]'), '2026-03-25');
    expect(host.textContent).not.toMatch(/Filled from/);
  });
});
