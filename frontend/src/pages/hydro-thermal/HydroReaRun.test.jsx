import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import {
  monthFromReaLink, parseReaLinks, monthsBetween, describeAutoDraft, AutoDraftPanel,
} from './HydroReaRun.jsx';

// Links as NRPC's site serves them, September 2026.
describe('REA links pasted from nrpc.gov.in', () => {
  it('reads the month off the file name, provisional or final', () => {
    expect(monthFromReaLink('https://nrpc.gov.in/allfile/090920261230385307REA0826_P.pdf')).toBe('2026-08');
    expect(monthFromReaLink('https://nrpc.gov.in/allfile/230620261441432086Rea0625_F.pdf')).toBe('2025-06');
    expect(monthFromReaLink('https://nrpc.gov.in/comm/2021-22/REA/REA1225_P.pdf')).toBe('2025-12');
  });

  it('does not read a supporting workbook, an amendment code or a nonsense month as an REA', () => {
    expect(monthFromReaLink('https://nrpc.gov.in/allfile/090920261231098653Supporting_files_at_cr0826.xlsx')).toBeNull();
    expect(monthFromReaLink('https://nrpc.gov.in/allfile/x/REA1326_P.pdf')).toBeNull();
    expect(monthFromReaLink('hello')).toBeNull();
  });

  it('keys a pasted list by month and says what it could not read', () => {
    const { links, unread } = parseReaLinks(`
      https://nrpc.gov.in/allfile/090920261745080463REA0426_P.pdf
      https://nrpc.gov.in/allfile/090920261745379237REA0526_P.pdf
      https://nrpc.gov.in/allfile/150920261731280113Supporting_files_at_cr0426.xlsx
    `);
    expect(Object.keys(links)).toEqual(['2026-04', '2026-05']);
    expect(unread).toHaveLength(1);
  });
});

describe('months to run', () => {
  it('lists every month in the range, across a year end', () => {
    expect(monthsBetween('2026-04', '2026-08')).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsBetween('2026-06', '2026-06')).toEqual(['2026-06']);
  });
});

// The bills list looks the same whether the sweep ran and found nothing or
// never ran at all, so the page has to say which it was — in every state,
// including the ones where there is no good news to report.
describe('what the page says about drafting that happens by itself', () => {
  const at = '2026-09-29T00:31:00Z';

  it('says nothing at all until the status has loaded', () => {
    expect(describeAutoDraft(null)).toBeNull();
  });

  it('names the bills it drafted', () => {
    const said = describeAutoDraft({
      enabled: true,
      last: {
        outcome: 'DRAFTED', started_at: at, from_month: '2026-07', to_month: '2026-08',
        bills_created: 2, bill_nos: ['HB/2026/000012', 'HB/2026/000013'], blocked: [],
      },
    });
    expect(said.tone).toBe('ok');
    expect(said.text).toContain('2026-07..2026-08');
    expect(said.text).toContain('HB/2026/000013');
  });

  it('distinguishes a quiet morning from one where nothing could be drafted', () => {
    const quiet = describeAutoDraft({
      enabled: true,
      last: { outcome: 'NOTHING_TO_DO', started_at: at, detail: 'no month in the window has an unbilled account', blocked: [] },
    });
    expect(quiet.tone).toBe('info');
    expect(quiet.text).toContain('nothing to draft');

    const stuck = describeAutoDraft({
      enabled: true,
      last: { outcome: 'BLOCKED', started_at: at, from_month: '2026-08', to_month: '2026-08', blocked: [{}] },
    });
    expect(stuck.tone).toBe('warn');
    expect(stuck.text).toContain('nothing could be drafted');
  });

  it('says when it is switched off, and when it has never run', () => {
    expect(describeAutoDraft({ enabled: false, last: null }).tone).toBe('warn');
    expect(describeAutoDraft({ enabled: true, last: null }).text).toContain('has not run yet');
  });

  it('reports a failure as a failure, with the reason', () => {
    const said = describeAutoDraft({
      enabled: true,
      last: { outcome: 'FAILED', started_at: at, from_month: '2026-08', to_month: '2026-08', detail: 'NRPC timed out' },
    });
    expect(said.tone).toBe('error');
    expect(said.text).toContain('NRPC timed out');
  });

  it('says it is drafting now, over anything it last did', () => {
    const said = describeAutoDraft({ enabled: true, running: true, last: { outcome: 'FAILED', started_at: at } });
    expect(said.text).toContain('right now');
  });

  it('lists each station-month it left unbilled, and why', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<AutoDraftPanel status={{
        enabled: true,
        last: {
          outcome: 'BLOCKED', started_at: at, from_month: '2026-08', to_month: '2026-08',
          bills_created: 0, bill_nos: [],
          blocked: [{ month: '2026-08', contract_no: 'PPA/SJVN/RHPS/001', reason: 'station not found in the PROVISIONAL REA' }],
        },
      }} />);
    });
    expect(host.textContent).toContain('PPA/SJVN/RHPS/001');
    expect(host.textContent).toContain('station not found in the PROVISIONAL REA');
    await act(async () => root.unmount());
    host.remove();
  });
});
