import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DemandLetterViewer } from './ui.jsx';
import { typeLabel } from '../pages/reia/PaymentSecurity.jsx';
import { eventLabel } from './SecurityInstrumentPanel.jsx';

// The demand notice as the waterfall writes it. The viewer read `invoice_ids`
// where the letter says `invoices`, and printed each draw — an object — straight
// into the page, which React refuses: the first invocation anyone raised took
// the whole Payment Security screen down with it.

let host;
let root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (ui) => act(() => root.render(ui));

const LETTER = {
  to: 'Issuing Bank / Counterparty',
  subject: 'Demand for payment under security — PSA/SJVN/PSPCL/TEST-001',
  side: 'BUYER',
  amount: 300000,
  requested: 350000,
  shortfall_uncovered: 50000,
  invoices: ['INV-abc'],
  invoice_nos: ['INV-PSA/2026/000007'],
  waterfall: [
    { id: 'PSC-1', instrument_no: 'PS/LC/2026/00001', type: 'LC', amount: 100000 },
    { id: 'PSC-2', instrument_no: 'PS/CORPUS_FUND/2026/00001', type: 'CORPUS_FUND', amount: 200000 },
  ],
  issued_at: '2026-10-06T09:30:00.000Z',
};

describe('DemandLetterViewer', () => {
  it('shows each draw, the bills by number, and the day the notice was raised', () => {
    render(<DemandLetterViewer letterStr={JSON.stringify(LETTER)} status="CLAIMED" invocationNo="INVOK/2026/00001" />);
    const text = host.textContent;
    expect(text).toContain('INVOK/2026/00001');
    expect(text).toContain('PS/LC/2026/00001');
    expect(text).toContain('₹1,00,000');
    expect(text).toContain('CORPUS FUND');
    expect(text).toContain('₹2,00,000');
    expect(text).toContain('INV-PSA/2026/000007');
    expect(text, 'the bill was named by its internal id').not.toContain('INV-abc');
    expect(text).toContain('₹50,000');
    expect(text).toMatch(/0?6 Oct 2026/);
    expect(text).toContain('CLAIMED');
  });

  it('offers the PDF only when it has somewhere to get it', () => {
    const onDownload = vi.fn();
    render(<DemandLetterViewer letterStr={JSON.stringify(LETTER)} onDownload={onDownload} />);
    const button = [...host.querySelectorAll('button')].find((b) => /Download demand letter/.test(b.textContent));
    act(() => button.click());
    expect(onDownload).toHaveBeenCalledTimes(1);

    render(<DemandLetterViewer letterStr={JSON.stringify(LETTER)} />);
    expect(host.querySelector('button')).toBeNull();
  });

  it('reads an older notice that names no bills', () => {
    render(<DemandLetterViewer letterStr={JSON.stringify({ subject: 'Demand', to: 'Bank', amount: 5, waterfall: [] })} />);
    expect(host.textContent).toContain('None named');
    render(<DemandLetterViewer letterStr="not json" />);
    expect(host.textContent).toContain('Invalid letter format');
  });
});

describe('How an instrument and its history read', () => {
  it('names the kind of instrument the way the filter does', () => {
    expect(typeLabel({ mechanism_type: 'LC', is_revolving: 1 })).toBe('LC · revolving');
    expect(typeLabel({ mechanism_type: 'BANK_GUARANTEE', bg_subtype: 'PBG' })).toBe('BG · PBG');
    expect(typeLabel({ mechanism_type: 'BANK_GUARANTEE', bg_subtype: null })).toBe('BG');
    expect(typeLabel({ mechanism_type: 'CORPUS_FUND' })).toBe('Corpus fund');
  });

  it('puts an event in words, including one nobody listed', () => {
    expect(eventLabel('UTILIZE')).toBe('Drawn on');
    expect(eventLabel('RELEASE_REJECTED')).toBe('Release refused');
    expect(eventLabel('INVOCATION_FUNDS_RECEIVED')).toBe('Funds received under the demand');
    expect(eventLabel('SOMETHING_NEW')).toBe('Something new');
  });
});
