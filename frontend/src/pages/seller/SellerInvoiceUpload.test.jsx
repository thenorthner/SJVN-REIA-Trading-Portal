import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// A generator with twenty PPAs raised twenty bills through one form. The panel
// checks the sheet before anything is raised, and will not offer to raise a sheet
// that has not checked out.

const calls = vi.hoisted(() => ({ list: [], answer: null }));
vi.mock('../../api/client.js', () => {
  const api = {
    invoices: {
      upload: (rows, dryRun) => {
        calls.list.push({ rows, dryRun });
        return Promise.resolve(typeof calls.answer === 'function' ? calls.answer(rows, dryRun) : calls.answer);
      },
      uploadTemplate: () => Promise.resolve(new Blob(['contract_no\n'])),
    },
  };
  return { api, default: api };
});

const SellerInvoiceUpload = (await import('./SellerInvoiceUpload.jsx')).default;

const SHEET = [
  'contract_no,billing_period,invoice_type,energy_mwh,tariff_per_unit,energy_charges',
  'PPA/SOLAR/001,2026-08,FINAL,1000,3.15,3150000',
  'PPA/WIND/002,2026-08,FINAL,880,3.4,2992000',
].join('\n');

const CLEAN = {
  dry_run: true, rows_received: 2, would_raise: 2, successful: 0, failed: 0, errors: [],
  preview: [
    { row: 1, contract_no: 'PPA/SOLAR/001', billing_period: '2026-08', invoice_type: 'FINAL', energy_mwh: 1000, total_amount: 3150000, status: 'SUBMITTED' },
    { row: 2, contract_no: 'PPA/WIND/002', billing_period: '2026-08', invoice_type: 'FINAL', energy_mwh: 880, total_amount: 2992000, status: 'SUBMITTED' },
  ],
};

let host, root;
beforeEach(() => {
  calls.list = [];
  calls.answer = CLEAN;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async (props = {}) => {
  await act(async () => { root.render(<SellerInvoiceUpload open onClose={() => {}} {...props} />); });
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

describe('raising seller invoices from a sheet', () => {
  it('reads the sheet, checks it without raising, then raises', async () => {
    await render();
    await paste(SHEET);
    expect(host.textContent).toMatch(/2 bills read from the sheet/);

    await click('Check the sheet');
    expect(calls.list).toEqual([{ rows: expect.any(Array), dryRun: true }]);
    expect(host.textContent).toMatch(/Every row is billable/);
    expect(host.textContent).toMatch(/What would be raised/);
    expect(host.querySelectorAll('.report-table tbody tr')).toHaveLength(2);

    calls.answer = {
      rows_received: 2, successful: 2, failed: 0, errors: [],
      invoices: [
        { id: 'INV-1', row: 1, invoice_no: 'SELLER/2026/08/01', status: 'SUBMITTED', validation_status: 'MATCHED', total_amount: 3150000 },
        { id: 'INV-2', row: 2, invoice_no: 'SELLER/2026/08/02', status: 'SUBMITTED', validation_status: 'PENDING', total_amount: 2992000 },
      ],
    };
    await click('Raise 2 bills');
    expect(calls.list[1].dryRun).toBe(false);
    expect(host.textContent).toMatch(/Raised 2 of 2 and submitted to SJVN/);
    expect(host.textContent).toMatch(/SELLER\/2026\/08\/01/);
    // What SJVN's own figure said about each bill, which is the point of the check.
    expect(host.textContent).toMatch(/MATCHED/);
  });

  it('says drafts when the maker is the one uploading', async () => {
    await render();
    await paste(SHEET);
    await click('Check the sheet');
    calls.answer = {
      rows_received: 2, successful: 2, failed: 0, errors: [],
      invoices: [{ id: 'INV-1', invoice_no: 'X', status: 'DRAFT', validation_status: 'PENDING', total_amount: 1 }],
    };
    await click('Raise 2 bills');
    expect(host.textContent).toMatch(/as drafts for your checker/);
  });

  it('will not raise a sheet that has not checked out, and says why by line', async () => {
    calls.answer = {
      dry_run: true, rows_received: 2, would_raise: 1, failed: 1,
      errors: [{ row: 2, contract_no: 'PPA/WIND/002', error: 'PPA/WIND/002 2026-08 is already billed by SELLER/2026/08/09' }],
      preview: [CLEAN.preview[0]],
    };
    await render();
    await paste(SHEET);
    await click('Check the sheet');
    expect(host.textContent).toMatch(/already billed by SELLER\/2026\/08\/09/);
    expect(button('Raise').disabled, 'a sheet with a rejected row could be raised anyway').toBe(true);
  });

  it('reads the sheet itself before asking the server', async () => {
    await render();
    await paste('contract_no,status\nPPA/A,APPROVED');
    expect(host.textContent).toMatch(/not read and will be ignored: status/);
    await paste('PPA/A,2026-08,FINAL');
    expect(host.textContent).toMatch(/first line must name the columns/);
    expect(calls.list).toEqual([]);
  });

  it('drops an earlier check as soon as the sheet changes', async () => {
    await render();
    await paste(SHEET);
    await click('Check the sheet');
    expect(host.textContent).toMatch(/Every row is billable/);
    await paste(`${SHEET}\nPPA/HYDRO/003,2026-08,FINAL,500,3.0,1500000`);
    expect(host.textContent).not.toMatch(/Every row is billable/);
    expect(button('Raise').disabled).toBe(true);
  });

  it('refreshes the list only when something was actually raised', async () => {
    const onRaised = vi.fn();
    await render({ onRaised });
    await paste(SHEET);
    await click('Check the sheet');
    calls.answer = { rows_received: 2, successful: 0, failed: 2, errors: [{ row: 1, error: 'x' }, { row: 2, error: 'y' }], invoices: [] };
    await click('Raise 2 bills');
    expect(onRaised).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/Raised 0 of 2/);
  });
});
