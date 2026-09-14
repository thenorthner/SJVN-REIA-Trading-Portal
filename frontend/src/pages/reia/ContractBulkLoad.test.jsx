import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// The loader had been in the API with nothing calling it, so fifty signed PPAs
// meant fifty forms. These hold the panel to the order the desk works in: check
// first, load only what checks out, and never write on a check.

const calls = vi.hoisted(() => ({ list: [], answer: null }));
vi.mock('../../api/client.js', () => {
  const api = {
    contracts: {
      bulkUpload: (rows, dryRun) => {
        calls.list.push({ rows, dryRun });
        return Promise.resolve(typeof calls.answer === 'function' ? calls.answer(rows, dryRun) : calls.answer);
      },
      bulkTemplate: () => Promise.resolve(new Blob(['contract_no\n'])),
    },
  };
  return { api, default: api };
});

const ContractBulkLoad = (await import('./ContractBulkLoad.jsx')).default;

const SHEET = [
  'contract_no,contract_type,project_type,seller_id,capacity_mw,tariff_per_unit,tenure_start,tenure_end',
  'PPA/A,PPA,SOLAR,SELL-1,100,3.15,2026-04-01,2051-03-31',
  'PPA/B,PPA,SOLAR,SELL-1,50,3.20,2026-04-01,2051-03-31',
].join('\n');

const CLEAN_DRY_RUN = {
  dry_run: true, rows_received: 2, would_load: 2, successful: 0, failed: 0, errors: [],
  preview: [
    { row: 1, contract_no: 'PPA/A', contract_type: 'PPA', counterparty: 'Test Solar Ltd', capacity_mw: 100, tariff_per_unit: 3.15, tenure: '2026-04-01 → 2051-03-31', status: 'DRAFT' },
    { row: 2, contract_no: 'PPA/B', contract_type: 'PPA', counterparty: 'Test Solar Ltd', capacity_mw: 50, tariff_per_unit: 3.2, tenure: '2026-04-01 → 2051-03-31', status: 'DRAFT' },
  ],
};

let host, root;
beforeEach(() => {
  calls.list = [];
  calls.answer = CLEAN_DRY_RUN;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async (props = {}) => {
  await act(async () => {
    root.render(<ContractBulkLoad open onClose={() => {}} {...props} />);
  });
};
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const paste = async (text) => {
  const el = host.querySelector('textarea');
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const click = async (label) => { await act(async () => { button(label).click(); }); };

describe('loading contracts from a spreadsheet', () => {
  it('will not check or load an empty sheet', async () => {
    await render();
    expect(host.textContent).toMatch(/Nothing to load yet/);
    expect(button('Check the sheet').disabled).toBe(true);
    expect(button('Load').disabled).toBe(true);
  });

  it('counts what it read, checks without writing, then loads', async () => {
    await render();
    await paste(SHEET);
    expect(host.textContent).toMatch(/2 rows read from the sheet/);

    await click('Check the sheet');
    expect(calls.list).toEqual([{ rows: expect.any(Array), dryRun: true }]);
    expect(host.textContent).toMatch(/Every row is loadable. Nothing has been written yet/);
    expect(host.textContent).toMatch(/What would load/);
    expect(host.querySelectorAll('.report-table tbody tr')).toHaveLength(2);
    expect(host.textContent).toMatch(/Test Solar Ltd/);

    calls.answer = { rows_received: 2, successful: 2, failed: 0, errors: [] };
    await click('Load 2 contracts');
    expect(calls.list[1].dryRun).toBe(false);
    expect(host.textContent).toMatch(/Loaded 2 of 2 as drafts/);
  });

  it('refuses to load until the sheet checks out, and shows why by line', async () => {
    calls.answer = {
      dry_run: true, rows_received: 2, would_load: 1, failed: 1,
      errors: [{ row: 2, contract_no: 'PPA/B', error: 'seller SELL-1 not found' }],
      preview: [CLEAN_DRY_RUN.preview[0]],
    };
    await render();
    await paste(SHEET);
    await click('Check the sheet');
    expect(host.textContent).toMatch(/Rows that cannot load/);
    expect(host.textContent).toMatch(/seller SELL-1 not found/);
    expect(button('Load').disabled, 'a sheet with a bad row could be loaded anyway').toBe(true);
  });

  it('reads the sheet itself before asking the server, and names columns it ignores', async () => {
    await render();
    await paste('contract_no,status\nPPA/A,ACTIVE');
    expect(host.textContent).toMatch(/not read and will be ignored: status/);
    await paste('PPA/A,PPA,SOLAR');
    expect(host.textContent).toMatch(/first line must name the columns/);
    expect(button('Check the sheet').disabled).toBe(true);
    expect(calls.list, 'the panel called the API for a sheet it could not read').toEqual([]);
  });

  it('forgets an earlier answer as soon as the sheet is edited', async () => {
    await render();
    await paste(SHEET);
    await click('Check the sheet');
    expect(host.textContent).toMatch(/Every row is loadable/);
    await paste(`${SHEET}\nPPA/C,PPA,SOLAR,SELL-1,25,3.1,2026-04-01,2051-03-31`);
    expect(host.textContent).not.toMatch(/Every row is loadable/);
    expect(host.textContent).toMatch(/3 rows read from the sheet/);
    expect(button('Load').disabled).toBe(true);
  });

  it('tells the page to refresh only when something actually loaded', async () => {
    const onLoaded = vi.fn();
    await render({ onLoaded });
    await paste(SHEET);
    await click('Check the sheet');
    calls.answer = { rows_received: 2, successful: 0, failed: 2, errors: [{ row: 1, error: 'x' }, { row: 2, error: 'y' }] };
    await click('Load 2 contracts');
    expect(onLoaded).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/Loaded 0 of 2 as drafts; 2 refused/);
  });
});
