import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// The set-off dialog: no typed totals, a preview of the bills and the proceeds
// it would net, and a button that only works when there is something to set off.

const state = vi.hoisted(() => ({ preview: null, calls: [], applyError: null }));
vi.mock('../../api/client.js', () => {
  const api = {
    billingSettlement: {
      nettingPreview: (params) => { state.calls.push(['preview', params]); return Promise.resolve(state.preview); },
      applyNetting: (body) => {
        state.calls.push(['apply', body]);
        return state.applyError ? Promise.reject(state.applyError) : Promise.resolve({ ...state.preview, allocations: [] });
      },
    },
  };
  return { api, default: api };
});

const NettingModal = (await import('./NettingModal.jsx')).default;

const PREVIEW = {
  client_id: 'TCL-1', client_name: 'Teesta Urja Ltd', period: '2026-09', reference: 'NET-2026-09',
  receivable: {
    total: 1100000, drafts_not_counted: 1,
    invoices: [
      { invoice_id: 'TIN-1', invoice_no: 'SJVN/ENERGY/TEESTA/202609/1', status: 'SENT', outstanding: 600000 },
      { invoice_id: 'TIN-2', invoice_no: 'SJVN/ENERGY/TEESTA/202609/2', status: 'PARTIALLY_PAID', outstanding: 500000 },
    ],
  },
  payable: { total: 952800, contracts: [{ contract_id: 'EXC-1', loa_no: 'EXC/LOA/9', product: 'DAM', cleared_mwh: 240, amount: 952800 }] },
  set_off: 952800,
  after: { client_owes: 147200, sjvn_owes: 0 },
  already_netted: null,
  not_included: 'Bilateral seller proceeds: a bilateral transaction does not record which side the client is on.',
};

let host, root, applied;
beforeEach(() => {
  state.preview = PREVIEW;
  state.calls = [];
  state.applyError = null;
  applied = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const setValue = (el, value) => {
  const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};

async function openAndChoose() {
  await act(async () => {
    root.render(<NettingModal open clients={[{ id: 'TCL-1', name: 'Teesta Urja Ltd' }]} onClose={() => {}} onApplied={applied} />);
  });
  await act(async () => {
    setValue(host.querySelector('select'), 'TCL-1');
  });
  await act(async () => {
    setValue(host.querySelector('input[type="month"]'), '2026-09');
  });
}

const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.startsWith(text));

describe('Netting dialog', () => {
  it('has no box to type an amount into', async () => {
    await openAndChoose();
    expect(host.querySelectorAll('input[type="number"]')).toHaveLength(0);
  });

  it('previews the bills and the proceeds it would set off, and what is left on each side', async () => {
    await openAndChoose();
    expect(state.calls).toContainEqual(['preview', { client_id: 'TCL-1', period: '2026-09' }]);
    expect(host.textContent).toMatch(/SJVN\/ENERGY\/TEESTA\/202609\/1/);
    expect(host.textContent).toMatch(/EXC\/LOA\/9/);
    expect(host.textContent).toMatch(/1 draft bill\(s\) not counted/);
    expect(host.textContent).toMatch(/Client still owes₹1,47,200/);
    expect(host.textContent).toMatch(/Bilateral seller proceeds/);
    expect(button('Set off ₹9,52,800').disabled).toBe(false);
  });

  it('sets off the month it previewed', async () => {
    await openAndChoose();
    await act(async () => { button('Set off ₹9,52,800').click(); });
    expect(state.calls).toContainEqual(['apply', { client_id: 'TCL-1', period: '2026-09' }]);
    expect(applied).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'TCL-1' }));
  });

  it('will not net a month twice, or net nothing', async () => {
    state.preview = { ...PREVIEW, already_netted: { reference: 'NET-2026-09', netted_on: '2026-09-15', amount: 952800 } };
    await openAndChoose();
    expect(host.textContent).toMatch(/Already netted for 2026-09 on 2026-09-15/);
    expect(button('Set off').disabled).toBe(true);

    state.preview = { ...PREVIEW, set_off: 0, payable: { total: 0, contracts: [] } };
    await act(async () => { setValue(host.querySelector('input[type="month"]'), '2026-08'); });
    expect(host.textContent).toMatch(/No Seller exchange contract cleared anything/);
    expect(button('Set off').disabled).toBe(true);
  });

  it('shows the API\'s reason when the set-off is refused', async () => {
    state.applyError = { response: { data: { error: 'Teesta Urja Ltd was already netted for 2026-09' } } };
    await openAndChoose();
    await act(async () => { button('Set off ₹9,52,800').click(); });
    expect(host.querySelector('.alert-error').textContent).toMatch(/already netted/);
    expect(applied).not.toHaveBeenCalled();
  });
});
