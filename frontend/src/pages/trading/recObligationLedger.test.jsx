import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

// The obligation ledger screen. Two things it must not do: save a file before
// anyone has seen how it was read, and draw a figure this platform computed the
// same way as one the exchange stated.

const state = vi.hoisted(() => ({ ledger: null, uploads: [], preview: null, committed: null, calls: [] }));
vi.mock('../../api/client.js', () => {
  const api = {
    recObligations: {
      ledger: () => Promise.resolve(state.ledger),
      uploads: () => Promise.resolve(state.uploads),
      upload: () => Promise.resolve({ upload: state.uploads[0], lines: [], reconciliation: [] }),
      upload_: (file, opts) => {
        state.calls.push({ name: file.name, ...opts });
        if (opts.dry_run) return state.preview?.response ? Promise.reject(state.preview) : Promise.resolve(state.preview);
        return Promise.resolve(state.committed);
      },
      withdraw: () => Promise.resolve({ ok: true }),
    },
  };
  return { api, default: api };
});

const RECObligationLedger = (await import('./RECObligationLedger.jsx')).default;

const LINE = {
  id: 'ROL-1', trade_date: '2026-03-11', settlement_date: '2026-03-13', platform: 'IEX',
  instrument: 'NON_SOLAR', side: 'SELL', quantity: 500, price_per_rec: 350, trade_value: 175000,
  exchange_fee: 875, gst: 157.5, net_amount: 173967.5, reference_no: 'IEX-REC-0001', derived_fields: [],
};

const EMPTY_SUMMARY = {
  sold_qty: 0, bought_qty: 0, sale_value: 0, purchase_value: 0, net_amount: 0, session_count: 0, by_instrument: {},
};

let host, root;
beforeEach(() => {
  state.ledger = { summary: EMPTY_SUMMARY, reconciliation: [], lines: [] };
  state.uploads = [];
  state.preview = null;
  state.committed = null;
  state.calls = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => {
  await act(async () => { root.render(<MemoryRouter><RECObligationLedger /></MemoryRouter>); });
};

/** Drop a file on the picker the way the browser does. */
const pickFile = async (name = 'obligation.xlsx') => {
  const input = host.querySelector('input[type="file"]');
  const file = new File(['x'], name);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
};

describe('REC purchase and sale ledger', () => {
  it('says nothing has been uploaded rather than showing an empty total as fact', async () => {
    await render();
    expect(host.textContent).toMatch(/No obligation report has been uploaded yet/);
    expect(host.textContent).toMatch(/Nothing uploaded yet/);
  });

  it('shows purchases and sales with what each settled to', async () => {
    state.ledger = {
      summary: { ...EMPTY_SUMMARY, sold_qty: 500, sale_value: 175000, net_amount: 173967.5, session_count: 1 },
      reconciliation: [],
      lines: [LINE],
    };
    await render();
    expect(host.textContent).toMatch(/Sale/);
    expect(host.textContent).toMatch(/Non-solar/);
    expect(host.textContent).toMatch(/IEX-REC-0001/);
    expect(host.textContent).toMatch(/₹1,73,968/);
  });

  it('marks a computed amount and explains the mark', async () => {
    state.ledger = {
      summary: { ...EMPTY_SUMMARY, sold_qty: 500 },
      reconciliation: [],
      lines: [{ ...LINE, derived_fields: ['trade_value', 'net_amount'] }],
    };
    await render();
    expect(host.textContent).toMatch(/\*/);
    expect(host.textContent).toMatch(/computed here from quantity, rate/);
  });

  it('surfaces a session the exchange settled that no lot was sold against', async () => {
    state.ledger = {
      summary: { ...EMPTY_SUMMARY, sold_qty: 500 },
      reconciliation: [{ kind: 'SALE_NOT_BOOKED', trade_date: '2026-03-11', detail: 'IEX settled 500 REC(s) on 2026-03-11; no sale is booked against any lot for that session' }],
      lines: [LINE],
    };
    await render();
    expect(host.textContent).toMatch(/Settled at the exchange, not booked against any lot/);
    expect(host.textContent).toMatch(/Disagreeing with the REC ledger/);
  });

  it('reads a chosen file without saving it, and shows how it was read', async () => {
    state.preview = {
      dry_run: true, upload_id: null, file_name: 'obligation.xlsx', platform: 'IEX', sheet: 'Obligation Report',
      session_from: '2026-03-11', session_to: '2026-03-11', lines_read: 2,
      columns_mapped: [{ column: 'Trade Date', field: 'trade_date' }, { column: 'Price (Rs/REC)', field: 'price_per_rec' }],
      columns_ignored: ['Clearing Member Remarks'], skipped: [], warnings: [],
      totals: { sold_qty: 500, bought_qty: 200 }, reconciliation: [],
    };
    await render();
    await pickFile();

    // The first call is a dry run — nothing has been committed.
    expect(state.calls).toEqual([{ name: 'obligation.xlsx', platform: 'IEX', dry_run: true }]);
    expect(host.textContent).toMatch(/Read from obligation.xlsx/);
    expect(host.textContent).toMatch(/Trade Date/);
    expect(host.textContent).toMatch(/Clearing Member Remarks/);
    expect(host.textContent).toMatch(/Record 2 trade\(s\)/);
  });

  it('commits only when the desk confirms what it saw', async () => {
    state.preview = {
      dry_run: true, file_name: 'obligation.xlsx', platform: 'IEX', sheet: 'Sheet1',
      session_from: '2026-03-11', session_to: '2026-03-11', lines_read: 1,
      columns_mapped: [], columns_ignored: [], skipped: [], warnings: [], totals: {}, reconciliation: [],
    };
    state.committed = { ...state.preview, dry_run: false, upload_id: 'ROB-1', lines_created: 1, lines_updated: 0 };
    await render();
    await pickFile();

    const confirm = [...host.querySelectorAll('button')].find((b) => /Record 1 trade/.test(b.textContent));
    await act(async () => { confirm.click(); });

    expect(state.calls.map((c) => c.dry_run)).toEqual([true, false]);
    expect(host.textContent).toMatch(/1 new trade\(s\) recorded/);
  });

  it('reports a file it could not read instead of half-importing it', async () => {
    state.preview = { response: { data: { error: 'No obligation table was recognised in this file.' } } };
    await render();
    await pickFile('holiday-photos.xlsx');
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/No obligation table was recognised/);
    // Nothing was committed off a file that could not be read.
    expect(state.calls.every((c) => c.dry_run)).toBe(true);
  });
});
