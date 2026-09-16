import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// A JMR or a state energy account, read from its table. The file is read and
// shown back before anything is written, and the unit is never guessed.

const state = vi.hoisted(() => ({ calls: [], preview: null, fail: null }));
vi.mock('../api/client.js', () => {
  const api = {
    energyData: {
      accountTypes: () => Promise.resolve({
        account_types: [{ key: 'JMR', label: 'Joint meter reading' }, { key: 'SEA', label: 'State energy account (SLDC)' }],
        units: [{ key: 'MWH', label: 'MWh' }, { key: 'MU', label: 'MU (million units)' }],
      }),
      accountTemplate: () => Promise.resolve(new Blob(['x'])),
      uploadAccount: (file, fields, dryRun) => {
        state.calls.push({ name: file.name, fields, dryRun });
        if (state.fail) return Promise.reject(state.fail);
        return Promise.resolve({ ...state.preview, dry_run: dryRun });
      },
    },
  };
  return { api, default: api };
});

const EnergyAccountUpload = (await import('./EnergyAccountUpload.jsx')).default;

const PREVIEW = {
  ok: true,
  account_type: 'SEA',
  account_label: 'State energy account (SLDC)',
  file_name: 'delhi-sea-jun.csv',
  unit_used: 'MU',
  unit_from: 'the energy column heading',
  rows_read: 3,
  created: 1,
  replaced: 1,
  skipped: 1,
  errors: [],
  unmapped_columns: ['Remarks'],
  rows: [
    { row_no: 2, station: 'NATHPA JHAKRI', matched_contract_no: 'PPA/NJHPS/001', period_month: '2026-06', energy_value: 81.61638, unit: 'MU', energy_mwh: 81616.38, action: 'CREATED' },
    { row_no: 3, station: 'Rampur HEP', matched_contract_no: 'PPA/RHPS/002', period_month: '2026-06', energy_value: 26.84, unit: 'MU', energy_mwh: 26840, action: 'REPLACED', was_energy_mwh: 26500, changed: true },
    { row_no: 4, station: 'Koldam HEP', period_month: '2026-06', energy_value: 30, unit: 'MU', energy_mwh: 30000, action: 'SKIPPED', reason: '"Koldam HEP" matches no contract.' },
  ],
};

let host, root, done;
beforeEach(() => {
  state.calls = [];
  state.preview = PREVIEW;
  state.fail = null;
  done = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => {
  await act(async () => { root.render(<EnergyAccountUpload onDone={done} onCancel={() => {}} />); });
};
const setSelect = async (label, value) => {
  const select = [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === value));
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const chooseFile = async (name = 'delhi-sea-jun.csv') => {
  const input = host.querySelector('input[type="file"]');
  const file = new File(['Station,Period,Scheduled Energy (in MUs)'], name, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
};
const submit = async () => {
  await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
};
const clickButton = async (text) => {
  const b = [...host.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(text));
  expect(b, `no button "${text}"`).toBeTruthy();
  await act(async () => { b.click(); });
};

describe('Energy account upload', () => {
  it('reads the file first and writes nothing until the desk has seen it', async () => {
    await render();
    await setSelect('Account', 'SEA');
    await chooseFile();
    await submit();

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ dryRun: true, fields: { account_type: 'SEA', data_type: 'PROVISIONAL' } });
    // What each row will do, in the unit it was stated in and in MWh.
    expect(host.textContent).toMatch(/Energy read in MU, taken from the energy column heading/);
    expect(host.textContent).toMatch(/1 new, 1 replacing a draft, 1 left alone/);
    expect(host.textContent).toMatch(/81\.61638 MU/);
    expect(host.textContent).toMatch(/81,616\.38/);
    expect(host.textContent).toMatch(/was 26,500 MWh/);
    expect(host.textContent).toMatch(/"Koldam HEP" matches no contract/);
    expect(host.textContent).toMatch(/Columns not read: Remarks/);
    expect(done).not.toHaveBeenCalled();
  });

  it('imports only what the preview said it would, then hands the result back', async () => {
    await render();
    await chooseFile();
    await submit();
    await clickButton('Import 2 row(s)');
    expect(state.calls.map((c) => c.dryRun)).toEqual([true, false]);
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ created: 1, replaced: 1 }));
  });

  it('offers no import when every row was left alone', async () => {
    state.preview = { ...PREVIEW, created: 0, replaced: 0, skipped: 3 };
    await render();
    await chooseFile();
    await submit();
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent.includes('Nothing to import'));
    expect(button.disabled).toBe(true);
  });

  it('passes the unit on when the desk chooses one, and shows the refusal when the file states none', async () => {
    state.fail = { response: { data: { errors: ['The unit of the energy column is not stated. Say which unit the file is in, or give it a "Unit" column — the same number is a thousand times bigger in MUs than in MWh.'] } } };
    await render();
    await chooseFile('jmr.csv');
    await submit();
    expect(host.textContent).toMatch(/thousand times bigger in MUs than in MWh/);

    state.fail = null;
    await setSelect('Energy is stated in', 'MWH');
    await submit();
    expect(state.calls[1].fields.unit).toBe('MWH');
  });
});
