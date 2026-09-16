import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// The screen's whole job is to say where the registry and our books disagree —
// and to never let a sample pull be read as the registry.

const state = vi.hoisted(() => ({ status: null, apps: [], recon: null, sync: null, syncArgs: null }));
vi.mock('../../api/client.js', () => {
  const api = {
    noarApi: {
      status: () => Promise.resolve(state.status),
      applications: () => Promise.resolve(state.apps),
      reconciliation: () => Promise.resolve(state.recon),
      application: (no) => Promise.resolve({
        application_no: no,
        latest: state.apps[0],
        revisions: state.apps,
        transaction: { id: 'BLT-1', counterparty: 'Alpha Discom', noar_status: 'PENDING', noar_contract_no: null },
        differences: state.recon.items[0].differences,
      }),
      sync: (body) => { state.syncArgs = body; return Promise.resolve(state.sync); },
    },
  };
  return { api, default: api };
});

const NOARApiReconciliation = (await import('./NOARApiReconciliation.jsx')).default;

const app = (over = {}) => ({
  id: 'NAP-1',
  application_no: 'SJVN010926WR001',
  revision_no: 0,
  applicant_name: 'SJVN Limited',
  seller_name: 'SJVN Limited',
  buyer_name: 'Alpha Discom',
  from_date: '2026-09-01',
  to_date: '2026-09-30',
  applied_mwh: 7200,
  approved_mwh: 7200,
  scheduled_mwh: 7100,
  approval_no: 'NLDC/OA/2026/4417',
  is_rejected: false,
  applied_summary: [],
  approved_summary: [],
  ...over,
});

let host, root;
beforeEach(() => {
  state.status = { live: false, enabled: false, environment: 'TEST', base_url: 'https://devdr.noar.in:84', mode: 'STUB', last_synced_at: null, applications_held: 0 };
  state.apps = [];
  state.recon = { applications_compared: 0, applications_with_differences: 0, by_kind: {}, items: [] };
  state.sync = null;
  state.syncArgs = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => { await act(async () => { root.render(<NOARApiReconciliation />); }); };
const click = async (text) => {
  const el = [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  expect(el, `no button matching ${text}`).toBeTruthy();
  await act(async () => { el.click(); });
};

describe('NOAR registry pull', () => {
  it('says plainly that an unconfigured pull is a sample, not the registry', async () => {
    await render();
    expect(host.textContent).toMatch(/Sample data, not the registry/);
    expect(host.textContent).toMatch(/Nothing has been pulled from NOAR yet/);
  });

  it('drops the sample warning once the pull is live', async () => {
    state.status = { ...state.status, live: true, enabled: true, environment: 'PRODUCTION', mode: 'PRODUCTION' };
    await render();
    expect(host.textContent).not.toMatch(/Sample data, not the registry/);
  });

  it('flags the applications that disagree and leaves the rest alone', async () => {
    state.apps = [app(), app({ id: 'NAP-2', application_no: 'SJVN020926WR002', approval_no: null, approved_mwh: 0 })];
    state.recon = {
      applications_compared: 2,
      applications_with_differences: 1,
      by_kind: { APPROVAL_NOT_RECORDED: 1 },
      items: [{
        application_no: 'SJVN010926WR001',
        differences: [
          { kind: 'APPROVAL_NOT_RECORDED', detail: 'NOAR has granted NLDC/OA/2026/4417; the platform still shows PENDING.' },
          { kind: 'PARTIAL_APPROVAL', detail: 'Approved 7,200 MWh against 7,200 applied.' },
        ],
      }],
    };
    await render();
    expect(host.textContent).toMatch(/Approval not recorded here \+1/);
    expect(host.textContent).toMatch(/Agrees/);
  });

  it('shows only the newest revision of an application', async () => {
    state.apps = [app(), app({ id: 'NAP-1b', revision_no: 2, approved_mwh: 6000 })];
    await render();
    const rows = host.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toMatch(/Rev 2/);
  });

  it('pulls the range the desk asked for and reports what came back', async () => {
    state.sync = {
      ok: true, mode: 'STUB', from_date: '2026-09-01', to_date: '2026-09-16',
      applications_received: 3, matched: 2, unmatched: 1, differences: [{ kind: 'STATUS_BEHIND' }],
    };
    await render();
    await click('Pull from NOAR');
    expect(state.syncArgs).toMatchObject({ include_rejected: true });
    expect(state.syncArgs.from_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(host.textContent).toMatch(/Sample pull:/);
    expect(host.textContent).toMatch(/2 matched to a transaction, 1 with no match/);
    expect(host.textContent).toMatch(/1 disagree with our record/);
  });

  it('shows NOAR\'s undocumented status codes as received, deciding nothing from them', async () => {
    state.apps = [app({ status_code: 4, bid_status: 1, congestion_status: 0, payment_status: 2 })];
    state.recon = {
      applications_compared: 1,
      applications_with_differences: 1,
      by_kind: { APPROVAL_NOT_RECORDED: 1 },
      items: [{ application_no: 'SJVN010926WR001', differences: [{ kind: 'APPROVAL_NOT_RECORDED', detail: 'Approval NLDC/OA/2026/4417 is not on the deal.' }] }],
    };
    await render();
    await click('View');
    expect(host.textContent).toMatch(/Status 4, Bid 1/);
    expect(host.textContent).toMatch(/defines no meaning for them/);
    expect(host.textContent).toMatch(/Approval NLDC\/OA\/2026\/4417 is not on the deal/);
  });
});
