import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// The Reports tab only arranges keys the API's catalogue lists, and the API
// runs the report. These tests hold the screen to that: what it sends, what
// it refuses to send, and that it lays out groups and totals as received.

const calls = vi.hoisted(() => ({ run: [], download: [], save: [], alerts: [] }));
const state = vi.hoisted(() => ({ catalog: null, templates: [], report: null }));

vi.mock('../../api/client.js', () => {
  const reia = {
    catalog: () => Promise.resolve(state.catalog),
    facets: () => Promise.resolve({ status: [{ value: 'APPROVED', label: 'APPROVED' }, { value: 'PAID', label: 'PAID' }] }),
    templates: () => Promise.resolve(state.templates),
    run: (spec) => { calls.run.push(spec); return Promise.resolve(state.report); },
    download: (spec, format) => { calls.download.push([spec, format]); return Promise.resolve('file'); },
    saveTemplate: (body) => { calls.save.push(body); return Promise.resolve({ id: 'RPT-1' }); },
    deleteTemplate: () => Promise.resolve({}),
  };
  const api = { reports: { reia } };
  return { api, default: api };
});
vi.mock('../../lib/dialogs.js', () => ({
  showAlert: (msg, opts) => { calls.alerts.push({ msg, ...opts }); return Promise.resolve(); },
  askConfirm: () => Promise.resolve(true),
}));

const mod = await import('./ReiaReportsTab.jsx');
const ReiaReportsTab = mod.default;
const { cellText, quickPeriods, builderFrom, specOf, builderProblems, pairProblem } = mod;

const COLS = [
  { key: 'invoice_no', label: 'Bill no.', type: 'text', ops: ['contains'], group: false, agg: null, default: true, labels: null },
  { key: 'buyer_name', label: 'Buyer', type: 'text', ops: ['in'], group: true, agg: null, default: true, labels: null },
  { key: 'status', label: 'Status', type: 'enum', ops: ['in'], group: true, agg: null, default: true, labels: null },
  { key: 'bill_date', label: 'Bill date', type: 'date', ops: ['between'], group: false, agg: null, default: true, labels: null },
  { key: 'due_date', label: 'Due date', type: 'date', ops: ['between'], group: false, agg: null, default: false, labels: null },
  { key: 'billing_period', label: 'Billing period', type: 'month', ops: ['between'], group: true, agg: null, default: false, labels: null },
  { key: 'total_amount', label: 'Bill amount', type: 'money', ops: ['between'], group: false, agg: 'sum', default: true, labels: null },
];
const DS = { key: 'invoices', title: 'Bills register', blurb: 'Every REIA bill.', columns: COLS, default_sort: [{ key: 'bill_date', dir: 'desc' }] };
const CATALOG = {
  datasets: [DS],
  presets: [
    { id: 'bills-psa', group: 'Billing', title: 'Bills register — buyer side (PSA)', blurb: 'Bills SJVN raised on buyers.',
      spec: { dataset: 'invoices', title: 'Bills register — buyer side (PSA)', filters: [{ key: 'status', op: 'in', value: ['APPROVED'] }], group_by: 'buyer_name' } },
  ],
  scope_note: null,
  max_rows: 50000,
  can_share: true,
};
const REPORT = {
  dataset: 'invoices', title: 'Bills register — buyer side (PSA)', dataset_title: 'Bills register',
  spec: { dataset: 'invoices', title: 'Bills register — buyer side (PSA)', columns: ['invoice_no', 'buyer_name', 'total_amount'], filters: [], group_by: 'buyer_name', sort: [], summary: false },
  columns: [COLS[0], COLS[1], COLS[6]],
  group_column: COLS[1],
  rows: null,
  groups: [
    { key: 'Punjab', label: 'Punjab', count: 2, subtotals: { total_amount: 300 }, rows: [
      { invoice_no: 'INV-1', buyer_name: 'Punjab', total_amount: 100 },
      { invoice_no: 'INV-2', buyer_name: 'Punjab', total_amount: 200 },
    ] },
    { key: 'Haryana', label: 'Haryana', count: 1, subtotals: { total_amount: 1234567.5 }, rows: [
      { invoice_no: 'INV-3', buyer_name: 'Haryana', total_amount: 1234567.5 },
    ] },
  ],
  totals: { total_amount: 1234867.5 },
  count: 3, truncated: false, criteria: ['Status: APPROVED', 'Grouped by Buyer'], scope_note: null,
  generated_at: '2026-10-31T03:00:00.000Z', generated_by: 'Tester',
};

let host, root;
beforeEach(() => {
  calls.run.length = 0; calls.download.length = 0; calls.save.length = 0; calls.alerts.length = 0;
  state.catalog = CATALOG; state.templates = []; state.report = REPORT;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => { await act(async () => { root.render(<ReiaReportsTab />); }); };
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const click = async (el) => { await act(async () => { el.click(); }); };

describe('REIA reports — the helpers', () => {
  it('formats money, months, dates and codes as the desk reads them', () => {
    expect(cellText({ type: 'money' }, 1234567.5)).toBe('₹12,34,567.50');
    expect(cellText({ type: 'money' }, -800)).toBe('-₹800.00');
    expect(cellText({ type: 'month' }, '2026-10')).toBe('Oct 2026');
    expect(cellText({ type: 'date' }, '2026-04-01')).toMatch(/1 Apr 2026/);
    expect(cellText({ type: 'enum' }, 'PARTIALLY_PAID')).toBe('PARTIALLY PAID');
    expect(cellText({ type: 'enum', labels: { SJVN_TO_BUYER: 'SJVN → Buyer' } }, 'SJVN_TO_BUYER')).toBe('SJVN → Buyer');
    expect(cellText({ type: 'text' }, null)).toBe('—');
  });

  it('runs the financial year from April to March', () => {
    const oct = Object.fromEntries(quickPeriods(new Date(2026, 9, 31)).map((p) => [p.id, p.range]));
    expect(oct['this-fy']).toEqual(['2026-04-01', '2027-03-31']);
    expect(oct['last-fy']).toEqual(['2025-04-01', '2026-03-31']);
    expect(oct['this-month']).toEqual(['2026-10-01', '2026-10-31']);
    expect(oct['last-month']).toEqual(['2026-09-01', '2026-09-30']);
    const jan = Object.fromEntries(quickPeriods(new Date(2027, 0, 15)).map((p) => [p.id, p.range]));
    expect(jan['this-fy']).toEqual(['2026-04-01', '2027-03-31']);
    expect(jan['last-month']).toEqual(['2026-12-01', '2026-12-31']);
  });

  it('turns a preset into builder fields and back without losing a filter', () => {
    const spec = {
      dataset: 'invoices', title: 'Mine', columns: ['invoice_no', 'total_amount'],
      filters: [
        { key: 'due_date', op: 'between', value: ['2026-04-01', null] },
        { key: 'status', op: 'in', value: ['APPROVED', 'PAID'] },
        { key: 'total_amount', op: 'between', value: [100, null] },
      ],
      group_by: 'buyer_name', summary: true, sort: [{ key: 'total_amount', dir: 'desc' }],
    };
    const b = builderFrom(spec, DS);
    // The first date range goes to the date-range block, whichever date it is on.
    expect(b.range).toEqual({ key: 'due_date', from: '2026-04-01', to: '' });
    expect(b.filters.map((f) => f.key)).toEqual(['status', 'total_amount']);
    const back = specOf(b);
    expect(back).toEqual({
      dataset: 'invoices', title: 'Mine', columns: ['invoice_no', 'total_amount'],
      filters: [
        { key: 'due_date', op: 'between', value: ['2026-04-01', null] },
        { key: 'status', op: 'in', value: ['APPROVED', 'PAID'] },
        { key: 'total_amount', op: 'between', value: [100, null] },
      ],
      group_by: 'buyer_name', summary: true, sort: [{ key: 'total_amount', dir: 'desc' }],
    });
  });

  it('drops empty filters and a column the catalogue does not list', () => {
    const b = builderFrom({ dataset: 'invoices', columns: ['invoice_no', 'secret_col'], filters: [{ key: 'secret_col', op: 'in', value: ['x'] }] }, DS);
    expect(b.columns).toEqual(['invoice_no']);
    expect(b.filters).toEqual([]);
    const spec = specOf({ ...b, filters: [{ key: 'status', op: 'in', value: [] }, { key: 'invoice_no', op: 'contains', value: '  ' }, { key: 'total_amount', op: 'between', value: ['', ''] }] });
    expect(spec.filters).toEqual([]);
    expect(spec.title).toBeUndefined();
  });

  it('lists every problem at once, and says a reversed range in words', () => {
    const b = builderFrom({}, DS);
    const bad = { ...b, columns: [], range: { key: 'bill_date', from: '2026-05-01', to: '2026-04-01' },
      filters: [{ key: 'total_amount', op: 'between', value: ['500', '100'] }, { key: 'billing_period', op: 'between', value: ['2026/04', ''] }] };
    const problems = builderProblems(bad, DS);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/at least one column/);
    expect(problems[1]).toMatch(/Bill date.*"from" date is after the "to" date/);
    expect(problems[2]).toMatch(/Bill amount.*minimum is more than the maximum/);
    expect(problems[3]).toMatch(/month as YYYY-MM/);
    // Numbers compare as numbers: 9 is less than 10.
    expect(pairProblem(COLS[6], '9', '10')).toBeNull();
    expect(builderProblems(b, DS)).toEqual([]);
  });
});

describe('REIA reports — the tab', () => {
  it('runs a predefined report in one click and lays out groups, subtotals and the total', async () => {
    await render();
    expect(host.textContent).toMatch(/Billing/);
    expect(host.textContent).toMatch(/Bills register — buyer side \(PSA\)/);
    await click(button('View report'));
    expect(calls.run).toEqual([CATALOG.presets[0].spec]);

    const table = host.querySelector('.rr-result table');
    expect([...table.querySelectorAll('tr.rr-group-row')].map((r) => r.textContent)).toEqual(['Buyer: Punjab', 'Buyer: Haryana']);
    const subs = [...table.querySelectorAll('tr.rr-subtotal')].map((r) => r.textContent);
    expect(subs[0]).toMatch(/Subtotal — Punjab \(2 rows\).*₹300\.00/);
    expect(subs[1]).toMatch(/Subtotal — Haryana \(1 row\).*₹12,34,567\.50/);
    expect(table.querySelector('tfoot').textContent).toMatch(/Total \(3 rows\).*₹12,34,867\.50/);
    expect(host.querySelector('.rr-criteria').textContent).toMatch(/Status: APPROVED/);
  });

  it('downloads the report it shows, in the format asked', async () => {
    await render();
    await click(button('View report'));
    await click(button('Download Excel'));
    await click(button('Download PDF'));
    await click(button('Download CSV'));
    expect(calls.download.map(([, f]) => f)).toEqual(['xlsx', 'pdf', 'csv']);
    // The spec the API answered with, so the file matches the screen.
    expect(calls.download[0][0]).toBe(REPORT.spec);
  });

  it('opens a preset in the builder and refuses to run it without columns', async () => {
    await render();
    await click(button('Customise'));
    expect(host.querySelector('#rr-dataset').value).toBe('invoices');
    expect(host.querySelector('#rr-name').value).toBe('Bills register — buyer side (PSA)');
    expect(host.querySelector('#rr-group').value).toBe('buyer_name');
    expect(host.textContent).toMatch(/Status\s*is one of/);

    await click(button('None'));
    await click(button('Run report'));
    expect(calls.run).toEqual([]);
    expect(calls.alerts).toHaveLength(1);
    expect(calls.alerts[0].msg).toMatch(/at least one column/);
  });

  it('runs the builder\'s report with its filters and grouping', async () => {
    await render();
    await click(button('Customise'));
    await click(button('Run report'));
    expect(calls.run).toHaveLength(1);
    expect(calls.run[0]).toMatchObject({
      dataset: 'invoices',
      filters: [{ key: 'status', op: 'in', value: ['APPROVED'] }],
      group_by: 'buyer_name',
      title: 'Bills register — buyer side (PSA)',
    });
  });

  it('asks for a name before saving, and saves the layout with its sharing', async () => {
    await render();
    await click(button('Custom report'));
    await click(button('Save to my reports'));
    expect(calls.save).toEqual([]);
    expect(calls.alerts[0].msg).toMatch(/Give the report a name/);

    const name = host.querySelector('#rr-name');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'My bills');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const share = [...host.querySelectorAll('label')].find((l) => l.textContent.includes('Share with other SJVN officers')).querySelector('input');
    await click(share);
    await click(button('Save to my reports'));
    expect(calls.save).toHaveLength(1);
    expect(calls.save[0]).toMatchObject({ name: 'My bills', shared: true, spec: { dataset: 'invoices', title: 'My bills' } });
  });

  it('lists saved reports, and offers removal only on one\'s own', async () => {
    state.templates = [
      { id: 'RPT-1', name: 'Mine', dataset: 'invoices', spec: { dataset: 'invoices' }, mine: true, shared: false, updated_at: '2026-10-30 10:00:00' },
      { id: 'RPT-2', name: 'Theirs', dataset: 'invoices', spec: { dataset: 'invoices' }, mine: false, shared: true, owner_name: 'Meera' },
    ];
    await render();
    await click(button('Saved reports (2)'));
    const cards = [...host.querySelectorAll('.rr-card')];
    expect(cards.map((c) => c.querySelector('h4').textContent)).toEqual(['Mine', 'Theirs']);
    expect(cards[0].textContent).toMatch(/Only you/);
    expect(cards[0].textContent).toMatch(/Remove/);
    expect(cards[1].textContent).toMatch(/Shared by Meera/);
    expect(cards[1].textContent).not.toMatch(/Remove/);
  });

  it('speaks to a seller or buyer about their own records, and saves without sharing', async () => {
    state.catalog = { ...CATALOG, side: 'SELLER', can_share: false };
    await render();
    expect(host.querySelector('.rr-intro').textContent).toMatch(/your live records with SJVN/);
    expect(host.querySelector('.rr-intro').textContent).not.toMatch(/desk/);

    await click(button('Custom report'));
    expect(host.textContent).not.toMatch(/Share with other SJVN officers/);
    const name = host.querySelector('#rr-name');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'My open bills');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Save to my reports'));
    expect(calls.save[0]).toMatchObject({ name: 'My open bills', shared: false });
  });

  it('says so when the role has no reports, rather than an empty page', async () => {
    state.catalog = { ...CATALOG, datasets: [], presets: [] };
    await render();
    expect(host.textContent).toMatch(/No reports are available to your role/);
  });
});
