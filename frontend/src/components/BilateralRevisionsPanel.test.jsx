import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// A rate revised partway through a bilateral deal, and its power split between
// buyers — recorded here, read by the settlement beside it.

const state = vi.hoisted(() => ({ role: 'TRADING_USER', revisions: [], sets: [], sent: [], fail: null }));
vi.mock('../api/client.js', () => {
  const answer = (name) => (...args) => {
    state.sent.push([name, ...args]);
    return state.fail ? Promise.reject(state.fail) : Promise.resolve({});
  };
  const api = {
    bilateral: {
      rateRevisions: () => Promise.resolve(state.revisions),
      buyerSplits: () => Promise.resolve(state.sets),
      addRateRevision: answer('addRateRevision'),
      removeRateRevision: answer('removeRateRevision'),
      setBuyerSplit: answer('setBuyerSplit'),
      removeBuyerSplit: answer('removeBuyerSplit'),
    },
  };
  return { api, default: api };
});
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { role: state.role } }) }));

const Panel = (await import('./BilateralRevisionsPanel.jsx')).default;

const TX = {
  id: 'BIL-1', start_date: '2026-09-01', end_date: '2026-09-30', procurer_name: 'New Delhi Municipal Council',
  counterparty: 'NDMC', sale_rate_per_unit: 4.5, purchase_rate_per_unit: 4.47, trading_margin_per_unit: 0.03,
};

let host, root, changed;
beforeEach(() => {
  Object.assign(state, { role: 'TRADING_USER', revisions: [], sets: [], sent: [], fail: null });
  changed = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => { await act(async () => { root.render(<Panel transaction={TX} onChanged={changed} />); }); };
const click = async (text) => {
  const b = [...host.querySelectorAll('button')].find((x) => x.textContent.trim() === text);
  expect(b, `no button "${text}"`).toBeTruthy();
  await act(async () => { b.click(); });
};
const type = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const byLabel = (label) => host.querySelector(`[aria-label="${label}"]`);
const submitForm = async (form) => {
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
};

describe('Rate revisions and buyer splits', () => {
  it('shows the contract rate, each revision after it, and who the power goes to', async () => {
    state.revisions = [{ id: 'BRR-1', effective_from: '2026-09-16', sale_rate_per_unit: 4.8, purchase_rate_per_unit: 4.77, trading_margin_per_unit: 0.03, reason: 'Amendment No. 2', reference: 'LoA/2026/17' }];
    state.sets = [{ effective_from: '2026-09-10', buyers: [{ buyer_name: 'Delhi DISCOM A', share_percent: 60, drawal_state: 'Delhi' }, { buyer_name: 'Haryana DISCOM B', share_percent: 40, drawal_state: 'Haryana' }] }];
    await render();
    expect(host.textContent).toMatch(/From 2026-09-01: ₹4\.5 sale, ₹4\.47 purchase, ₹0\.03 margin \(contract\)/);
    expect(host.textContent).toMatch(/From 2026-09-16: ₹4\.8 sale.*Amendment No\. 2 · LoA\/2026\/17/);
    expect(host.textContent).toMatch(/From 2026-09-10: Delhi DISCOM A 60% \(Delhi\), Haryana DISCOM B 40% \(Haryana\)/);
    // The days before the first split still belong to the transaction's own buyer.
    expect(host.textContent).toMatch(/Before 2026-09-10, all power to New Delhi Municipal Council/);
  });

  it('will not save a split whose shares do not total 100%', async () => {
    await render();
    await click('Split between buyers');
    await type(byLabel('Buyer 1'), 'Delhi DISCOM A');
    await type(byLabel('Share 1'), '60');
    await type(byLabel('Buyer 2'), 'Haryana DISCOM B');
    await type(byLabel('Share 2'), '30');
    expect(host.textContent).toMatch(/Shares total 90% — they must total 100%/);
    expect([...host.querySelectorAll('button')].find((b) => b.textContent === 'Save split').disabled).toBe(true);

    await type(byLabel('Share 2'), '40');
    await type(byLabel('Drawal state 2'), 'Haryana');
    const form = byLabel('Buyer 1').closest('form');
    await submitForm(form);
    expect(state.sent).toEqual([['setBuyerSplit', 'BIL-1', {
      effective_from: undefined,
      buyers: [
        { buyer_name: 'Delhi DISCOM A', share_percent: 60, drawal_state: undefined },
        { buyer_name: 'Haryana DISCOM B', share_percent: 40, drawal_state: 'Haryana' },
      ],
    }]]);
    expect(changed).toHaveBeenCalled();
  });

  it('shows why the server refused a change, and keeps the form open', async () => {
    state.fail = { response: { data: { error: 'A rate revision from 2026-09-04 reaches into SJVN/ENERGY/NDMC/0007, billed FINAL for 2026-09-01 to 2026-09-07.' } } };
    await render();
    await click('Revise rate');
    const inputs = [...host.querySelectorAll('form input')];
    await type(inputs[0], '2026-09-04');
    await type(inputs[1], '4.8');
    await type(inputs[3], 'Amendment No. 2');
    await submitForm(host.querySelector('form'));
    expect(host.textContent).toMatch(/billed FINAL for 2026-09-01 to 2026-09-07/);
    expect(host.querySelector('form')).toBeTruthy();
    expect(changed).not.toHaveBeenCalled();
  });

  it('offers no changes to someone who may only read', async () => {
    state.role = 'FINANCE_USER';
    state.sets = [{ effective_from: '2026-09-01', buyers: [{ buyer_name: 'A', share_percent: 50 }, { buyer_name: 'B', share_percent: 50 }] }];
    await render();
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).not.toContain('Revise rate');
    expect(labels).not.toContain('Change split');
    expect(labels).not.toContain('Remove');
  });
});
