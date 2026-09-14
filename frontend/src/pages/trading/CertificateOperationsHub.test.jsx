import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// The hub used to invent its bid book with Math.random() while rec_bids,
// escert_orders and the REC ledger sat in the database unread, and its Submit
// button told the trader nothing had been sent. Both registers are real.

const state = vi.hoisted(() => ({
  recBids: [], escertOrders: [], inventory: null, escertMeta: null, calls: [], fail: null,
}));
// The screen reads the desk's active portfolio from context.
vi.mock('../../context/PortfolioContext.jsx', () => ({
  usePortfolios: () => ({ activeId: 'N1HP0PTC0850', portfolios: [] }),
  PortfolioSelect: () => null,
}));
vi.mock('../../api/client.js', () => {
  const api = {
    rec: { reference: () => Promise.resolve({ price_bands: { REC: { floor: 1000, forbearance: 1500 } } }) },
    recTrading: {
      listBids: () => Promise.resolve(state.recBids),
      inventory: () => Promise.resolve(state.inventory),
      createBid: (body) => { state.calls.push(['rec', body]); return state.fail ? Promise.reject(state.fail) : Promise.resolve({ id: 'RB-1' }); },
    },
    escertOrders: {
      list: () => Promise.resolve(state.escertOrders),
      meta: () => Promise.resolve(state.escertMeta),
      create: (body) => { state.calls.push(['escert', body]); return state.fail ? Promise.reject(state.fail) : Promise.resolve({ id: 'EO-1' }); },
    },
  };
  return { api, default: api };
});

const CertificateOperationsHub = (await import('./CertificateOperationsHub.jsx')).default;

const REC_BID = {
  id: 'RB-9', portfolio_code: 'N1HP0PTC0850', entity_name: 'SJVN Limited', exchange: 'IEX',
  rec_type: 'Non-Solar REC', side: 'Sell', quantity: 500, price: 1100, status: 'APPROVED',
  trade_date: '2026-09-10', created_at: '2026-09-09 10:00:00',
};

let host, root;
beforeEach(() => {
  state.recBids = [REC_BID];
  state.escertOrders = [];
  state.inventory = { held_qty: 1200, committed_qty: 500, sellable_qty: 700 };
  state.escertMeta = { registry_available: 4250, rec_types: ['ESCERT'] };
  state.calls = [];
  state.fail = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async (props = {}) => {
  await act(async () => { root.render(<CertificateOperationsHub defaultTab="REC" {...props} />); });
};
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const clickText = async (label) => { await act(async () => { button(label).click(); }); };
const setField = async (el, value) => {
  await act(async () => {
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};

describe('certificate operations hub', () => {
  it('shows the desk’s own bids and its real certificate position', async () => {
    await render();
    expect(host.textContent).toMatch(/N1HP0PTC0850/);
    expect(host.textContent).toMatch(/Non-Solar REC/);
    // Held, committed and what is actually sellable — not an invented 800/400.
    expect(host.textContent).toMatch(/1,200 units/);
    expect(host.textContent).toMatch(/700 units/);
    expect(host.textContent).toMatch(/Held less what is already committed/);
    // The price band comes from master data.
    expect(host.textContent).toMatch(/₹1,000 – ₹1,500/);
  });

  it('says plainly which views have nothing behind them', async () => {
    await render();
    await clickText('Registry Holdings');
    expect(host.textContent).toMatch(/national REC\/ESCert registry/);
    await clickText('Clearing Obligations');
    expect(host.textContent).toMatch(/RPO obligation records come from the state filings/);
  });

  it('raises a REC bid into the desk’s book instead of telling the trader nothing happened', async () => {
    await render();
    await clickText('Create New Bid');
    const numbers = [...host.querySelectorAll('input[type="number"]')];
    await setField(numbers[0], '100');   // quantity
    await setField(numbers[1], '1100');  // price, inside the master band
    await clickText('Save');             // the form's own submit, which confirms
    await clickText('Raise Bid');

    expect(state.calls.length).toBeGreaterThan(0);
    expect(state.calls[0][0]).toBe('rec');
    expect(state.calls[0][1]).toMatchObject({ exchange: 'IEX', side: 'Buy', rec_type: 'Non-Solar REC' });
  });

  it('will not offer to sell more than is sellable', async () => {
    state.inventory = { held_qty: 100, committed_qty: 90, sellable_qty: 10 };
    await render();
    await clickText('Create New Bid');
    const selects = [...host.querySelectorAll('select')];
    const side = selects.find((sel) => [...sel.options].some((o) => o.value === 'Sell'));
    await setField(side, 'Sell');
    const numbers = [...host.querySelectorAll('input[type="number"]')];
    await setField(numbers[0], '50');
    await setField(numbers[1], '1100');
    await clickText('Save');
    expect(host.textContent).toMatch(/Only 10 certificate\(s\) are sellable/);
    expect(state.calls).toEqual([]);
  });

  it('reads ESCerts from their own register, and labels a configured holding', async () => {
    state.escertOrders = [{
      id: 'EO-2', portfolio_code: 'ESC-PF-1', entity_name: 'SJVN Limited', exchange: 'PXIL',
      rec_type: 'PAT Cycle 2', side: 'Buy', quantity: 200, price: 1450, status: 'SUBMITTED',
      created_at: '2026-09-11 09:00:00',
    }];
    await render({ defaultTab: 'ESCERT' });
    expect(host.textContent).toMatch(/ESC-PF-1/);
    expect(host.textContent).toMatch(/PAT Cycle 2/);
    expect(host.textContent).toMatch(/4,250 units/);
    expect(host.textContent).toMatch(/Configured figure — the platform has no ESCert register/);
  });

  it('says the book is empty rather than showing invented rows', async () => {
    state.recBids = [];
    await render();
    expect(host.textContent).toMatch(/No REC bid has been raised yet/);
  });
});
