// The four trading screens that used to carry rows transcribed from the live
// ISET portal inline, behind criteria boxes that changed nothing.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const store = vi.hoisted(() => ({ rows: {}, meta: {} }));
vi.mock('../../api/client.js', () => {
  const api = {
    isetReports: {
      meta: () => Promise.resolve({ catalogs: store.meta }),
      list: (kind) => Promise.resolve(store.rows[kind] || []),
    },
  };
  return { api, default: api };
});

const VendorMaster = (await import('./ERPVendorMasterTable.jsx')).default;
const Payable = (await import('./ERPVendorPayableLedger.jsx')).default;
const Receivable = (await import('./CustomerReceivablesTable.jsx')).default;
const ReaSea = (await import('./REAReconciliationGrid.jsx')).default;

const cols = (...keys) => keys.map((k) => ({ key: k, label: k }));
store.meta = {
  'erp-vendor-master': { title: 'Vendor Format', showSr: false, columns: [...cols('type'), { key: 'firstName', label: 'First Name', code: 'NAME_FIRST' }] },
  'erp-vendor-payable': { title: 'Vendor Payable Format', showSr: false, columns: cols('desc', 'docDate', 'vendorNo') },
  'erp-customer-receivable': { title: 'Customer Receivables Format', showSr: false, columns: cols('desc', 'docDate', 'customerNo') },
  'rea-sea-reconciliation': { title: 'REA/SEA Reconciliation', columns: cols('month', 'contract', 'entity', 'appNo', 'approvalNo', 'approved', 'rea', 'rldc', 'status') },
};
store.rows = {
  'erp-vendor-master': [
    { type: 'Discom', firstName: 'Alpha Discom' },
    { type: 'Generator', firstName: 'Beta Hydro' },
  ],
  'erp-vendor-payable': [
    { desc: 'August energy bill', docDate: '16.08.2023', vendorNo: '1000001' },
    { desc: 'September energy bill', docDate: '18.09.2023', vendorNo: '1000002' },
  ],
  'erp-customer-receivable': [
    { desc: 'Open access August', docDate: '07.08.2023', customerNo: '2000001' },
    { desc: 'Open access March', docDate: '20.03.2024', customerNo: '2000002' },
  ],
  'rea-sea-reconciliation': [
    { month: 'June 2026', contract: 'LOA/1', entity: 'Alpha Council', appNo: 'AD1', approvalNo: 'NR/1', approved: 200, rea: 180, rldc: 180, status: 'Pending' },
    { month: 'June 2026', contract: 'LOA/1', entity: 'Beta Council', appNo: 'AD2', approvalNo: 'NR/2', approved: 400, rea: 400, rldc: 400, status: 'Done' },
  ],
};

let host, root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async (El) => {
  await act(async () => { root.render(<El />); });
};
const bodyRows = () => [...host.querySelectorAll('tbody tr')].map((tr) => tr.textContent);
const setValue = async (el, value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('ERP upload formats', () => {
  it('draws the vendor layout from the register, SAP field names included', async () => {
    await render(VendorMaster);
    expect(host.textContent).toMatch(/FLVN00 \(FI Vendor\)/);
    expect(host.textContent).toMatch(/NAME_FIRST/);
    expect(bodyRows()).toHaveLength(2);
  });

  it('selects vendors on the one criterion the register can answer for', async () => {
    await render(VendorMaster);
    const select = host.querySelector('select');
    expect([...select.options].map((o) => o.value)).toEqual(['', 'Discom', 'Generator']);
    await setValue(select, 'Generator');
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toMatch(/Beta Hydro/);
  });

  it.each([
    ['payable', Payable, '18.09.2023', 'September energy bill'],
    ['receivable', Receivable, '20.03.2024', 'Open access March'],
  ])('selects %s documents on the document date, in the register format', async (_name, El, sap, expected) => {
    await render(El);
    expect(bodyRows()).toHaveLength(2);
    const iso = `${sap.slice(6)}-${sap.slice(3, 5)}-${sap.slice(0, 2)}`;
    await setValue(host.querySelector('input[type="date"]'), iso);
    expect(host.textContent).toMatch(new RegExp(`Showing documents dated ${sap.replace(/\./g, '\\.')}`));
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toMatch(expected);
  });

  it('says the register is empty rather than inventing a document', async () => {
    store.rows['erp-vendor-payable'] = [];
    await render(Payable);
    expect(host.textContent).toMatch(/No payable documents on record/);
    expect(host.textContent).not.toMatch(/Kreate|1010562|KEIPL/);
    store.rows['erp-vendor-payable'] = [{ desc: 'August energy bill', docDate: '16.08.2023', vendorNo: '1000001' }];
  });
});

describe('REA/SEA reconciliation', () => {
  it('totals the gap between approval and the energy account', async () => {
    await render(ReaSea);
    expect(bodyRows()).toHaveLength(2);
    // 600 approved, 580 per REA, so 20 MWh to reconcile and one application open.
    expect(host.textContent).toMatch(/Gap to reconcile/);
    expect(host.textContent).toMatch(/Gap to reconcile20 MWh/);
    expect(host.textContent).toMatch(/Applications pending/);
  });

  it('filters by entity instead of showing a read-only box', async () => {
    await render(ReaSea);
    const entity = [...host.querySelectorAll('select')][1];
    expect([...entity.options].map((o) => o.value)).toEqual(['', 'Alpha Council', 'Beta Council']);
    await setValue(entity, 'Beta Council');
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toMatch(/Done/);
  });
});
