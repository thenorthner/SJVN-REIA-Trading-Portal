import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ModuleGuide from './ModuleGuide.jsx';
import dsmGuide from '../content/guides/dsm.js';
import cercGuide from '../content/guides/cerc.js';
import hydroGuide from '../content/guides/hydro.js';
import verificationGuide from '../content/guides/verification.js';
import securityGuide from '../content/guides/security.js';
import complianceGuide from '../content/guides/compliance.js';
import energyGuide from '../content/guides/energy.js';
import monitoringGuide from '../content/guides/monitoring.js';
import reconciliationGuide from '../content/guides/reconciliation.js';
import { getGuide, GUIDES } from '../content/guides/index.js';

// The guide renders content, not markup, so these check that every block type
// a content file can use actually reaches the page — a guide that silently
// dropped its tables or its FAQ would still look fine at a glance.

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

const render = (guide) => act(() => root.render(<ModuleGuide guide={guide} />));

const FIXTURE = {
  title: 'Test module',
  summary: 'What it does.',
  facts: [{ label: 'Cadence', value: 'Weekly', hint: 'every Monday' }],
  quickRef: { title: 'Quick reference', items: [{ k: '1 LU', v: '100 MWh' }] },
  sections: [{
    id: 'sec-one',
    heading: 'First section',
    blurb: 'A blurb.',
    blocks: [
      { type: 'p', text: 'A paragraph.' },
      { type: 'steps', items: [{ title: 'Step one', detail: 'Do the thing.' }] },
      { type: 'table', columns: ['A', 'B'], rows: [['left', 'right']], caption: 'A caption.' },
      { type: 'note', tone: 'warn', title: 'Careful', text: 'A warning.' },
      { type: 'terms', items: [{ term: 'LU', also: 'Lakh Unit', def: '100 MWh.' }] },
      { type: 'faq', items: [{ q: 'A question?', a: 'An answer.' }] },
    ],
  }],
  footnote: 'A footnote.',
};

describe('ModuleGuide', () => {
  it('renders every block type a content file can use', () => {
    render(FIXTURE);
    const text = host.textContent;
    for (const expected of [
      'What it does.', 'Cadence', 'Weekly', 'First section', 'A blurb.',
      'A paragraph.', 'Step one', 'Do the thing.', 'left', 'right', 'A caption.',
      'Careful', 'A warning.', 'Lakh Unit', 'A question?', 'An answer.', 'A footnote.',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('gives each section an id so the page nav can reach it', () => {
    render(FIXTURE);
    expect(host.querySelector('#sec-one')).toBeTruthy();
  });

  it('puts the FAQ in <details>, so it is keyboard-reachable and findable by Ctrl+F', () => {
    render(FIXTURE);
    expect(host.querySelectorAll('details').length).toBe(1);
  });

  it('renders without a facts strip or quick reference', () => {
    render({ ...FIXTURE, facts: undefined, quickRef: undefined });
    expect(host.textContent).toContain('First section');
  });
});

describe('the DSM guide', () => {
  it('is registered under its key', () => {
    expect(getGuide('dsm')).toBe(dsmGuide);
    expect(getGuide('nope')).toBeNull();
  });

  it('renders, with every section reachable by id', () => {
    render(dsmGuide);
    for (const s of dsmGuide.sections) {
      expect(host.querySelector(`#${s.id}`)).toBeTruthy();
    }
  });

  it('states both unit conversions and both sign conventions', () => {
    // These are the four facts people get wrong when reconciling a figure
    // against the PDF, so the guide is not allowed to lose them.
    render(dsmGuide);
    const text = host.textContent;
    expect(text).toContain('100 MWh');
    expect(text).toContain('100,000');
    expect(text).toContain('SJVN pays the pool');
    expect(text).toContain('Recoverable by SJVN');
  });

  it('says plainly that the amount is not deviation times a rate', () => {
    render(dsmGuide);
    expect(host.textContent).toMatch(/no single rate reproduces it/i);
  });

  it('every guide in the registry has the shape ModuleGuide expects', () => {
    for (const [key, guide] of Object.entries(GUIDES)) {
      expect(guide.title, key).toBeTruthy();
      expect(guide.summary, key).toBeTruthy();
      expect(Array.isArray(guide.sections), key).toBe(true);
      const ids = guide.sections.map((s) => s.id);
      expect(new Set(ids).size, `${key} has duplicate section ids`).toBe(ids.length);
      for (const s of guide.sections) {
        expect(s.id, key).toBeTruthy();
        expect(s.heading, key).toBeTruthy();
        expect(Array.isArray(s.blocks), `${key}/${s.id}`).toBe(true);
        for (const b of s.blocks) {
          expect(['p', 'steps', 'table', 'note', 'terms', 'faq'], `${key}/${s.id}`).toContain(b.type);
        }
      }
    }
  });
});

describe('the CERC guide', () => {
  it('renders, with every section reachable by id', () => {
    render(cercGuide);
    for (const s of cercGuide.sections) expect(host.querySelector(`#${s.id}`)).toBeTruthy();
  });

  it('states both margin caps and that the cap is tested per transaction', () => {
    // Someone reading only the average is the mistake this module exists to
    // catch, so the guide is not allowed to lose either half of the rule.
    render(cercGuide);
    const text = host.textContent;
    expect(text).toContain('4 paise/kWh');
    expect(text).toContain('7 paise/kWh');
    expect(text).toMatch(/tested per transaction/i);
  });

  it('says exempt lines stay on the return rather than being dropped', () => {
    render(cercGuide);
    expect(host.textContent).toMatch(/marked exempt with a reason/i);
  });
});

describe('the hydro guide', () => {
  it('renders, with every section reachable by id', () => {
    render(hydroGuide);
    for (const s of hydroGuide.sections) expect(host.querySelector(`#${s.id}`)).toBeTruthy();
  });

  it('explains why half the AFC appears on both sides of the tariff', () => {
    render(hydroGuide);
    expect(host.textContent).toMatch(/add\s*\n?\s*back to exactly one AFC/i);
  });

  it('names all four bill blocks', () => {
    render(hydroGuide);
    const text = host.textContent;
    for (const row of ['A5', 'A12', 'C2', 'EE1']) expect(text).toContain(row);
  });

  it('states the segregation-of-duties rule', () => {
    render(hydroGuide);
    expect(host.textContent).toMatch(/cannot approve it/i);
  });
});

describe('the verification guide', () => {
  it('renders, with every section reachable by id', () => {
    render(verificationGuide);
    for (const s of verificationGuide.sections) expect(host.querySelector(`#${s.id}`)).toBeTruthy();
  });

  it('names all eight technical checks', () => {
    render(verificationGuide);
    const text = host.textContent;
    for (const check of [
      'REA Uploaded', 'Energy Verified', 'Tariff Verified', 'CUF Compliance',
      'COD Compliance', 'Contract Capacity Verified', 'Curtailment Checked',
      'Change in Law Verified',
    ]) {
      expect(text).toContain(check);
    }
  });

  it('states that CUF fails below HALF the baseline, not below it', () => {
    // The threshold nobody can see from the screen, and the one that otherwise
    // gets read as a performance test.
    render(verificationGuide);
    expect(host.textContent).toMatch(/below half the baseline/i);
  });

  it('says one failed check fails the whole bill', () => {
    render(verificationGuide);
    expect(host.textContent).toMatch(/one failure fails the bill/i);
  });

  it('shows liquidated damages as the only deduction in the build-up', () => {
    render(verificationGuide);
    expect(host.textContent).toMatch(/liquidated damages as the only deduction/i);
  });
});

describe('the payment security guide', () => {
  it('renders, with every section reachable by id', () => {
    render(securityGuide);
    for (const s of securityGuide.sections) expect(host.querySelector(`#${s.id}`)).toBeTruthy();
  });

  it('states which instrument answers for whose default', () => {
    // Drawing the seller's guarantee for a buyer's non-payment is the mistake
    // the waterfall exists to prevent, so the guide must say so outright.
    render(securityGuide);
    const text = host.textContent;
    expect(text).toMatch(/wrong instrument is not a fallback/i);
    expect(text).toMatch(/buyer default draws the LC/i);
  });

  it('gives the draw order, dedicated before pooled', () => {
    render(securityGuide);
    expect(host.textContent).toMatch(/dedicated first, pooled last/i);
  });

  it('states the thirty-day invocation rule and the 110% LC cover', () => {
    render(securityGuide);
    const text = host.textContent;
    expect(text).toMatch(/thirty days past/i);
    expect(text).toContain('110%');
  });

  it('says lapsed cover is never counted', () => {
    render(securityGuide);
    expect(host.textContent).toMatch(/Lapsed cover is never counted/i);
  });

  it('lists every step of the expiry cascade', () => {
    render(securityGuide);
    const text = host.textContent;
    for (const d of ['60', '30', '15', '7', '0']) expect(text).toContain(d);
  });
});

describe('the contract compliance guide', () => {
  it('renders, with every section reachable by id', () => {
    render(complianceGuide);
    for (const s of complianceGuide.sections) expect(host.querySelector(`#${s.id}`)).toBeTruthy();
  });

  it('says being live is what turns a shortfall into a breach', () => {
    render(complianceGuide);
    expect(host.textContent).toMatch(/Live is what makes a shortfall a breach/i);
  });

  it('says energy billed without a COD is a breach', () => {
    render(complianceGuide);
    expect(host.textContent).toMatch(/without a COD is a breach/i);
  });

  it('separates a not-applicable approval from an expired one', () => {
    render(complianceGuide);
    expect(host.textContent).toMatch(/Not applicable is a decision; expired is not/i);
  });
});

describe('the energy data guide', () => {
  it('renders, with every section reachable by id', () => {
    render(energyGuide);
    for (const s of energyGuide.sections) expect(host.querySelector(`#${s.id}`)).toBeTruthy();
  });

  it('gives all three tolerances', () => {
    render(energyGuide);
    const text = host.textContent;
    expect(text).toContain('80%');
    expect(text).toContain('30%');
    expect(text).toContain('2%');
  });

  it('says the benchmark is commissioned capacity, not contracted', () => {
    render(energyGuide);
    expect(host.textContent).toMatch(/commissioned capacity, not contracted/i);
  });

  it('states the lock gate on both draft and disputed periods', () => {
    render(energyGuide);
    const text = host.textContent;
    expect(text).toMatch(/draft cannot be locked/i);
    expect(text).toMatch(/only with a reason recorded/i);
  });
});

describe('the payment monitoring guide', () => {
  it('renders, with every section reachable by id', () => {
    render(monitoringGuide);
    for (const s of monitoringGuide.sections) expect(host.querySelector(`#${s.id}`)).toBeTruthy();
  });

  it('spells out the outstanding definition', () => {
    render(monitoringGuide);
    const text = host.textContent;
    for (const part of ['Invoice total', 'Rebate allowed', 'Surcharge raised', 'Disputed amount', 'Payments received']) {
      expect(text).toContain(part);
    }
  });

  it('says deductions count as paid', () => {
    render(monitoringGuide);
    expect(host.textContent).toMatch(/Deductions count as paid/i);
  });

  it('warns that surcharge days are not calendar days', () => {
    render(monitoringGuide);
    expect(host.textContent).toMatch(/Surcharge days are not calendar days/i);
  });

  it('separates charged surcharge from accrued', () => {
    render(monitoringGuide);
    expect(host.textContent).toMatch(/Adding the two together would double-count/i);
  });
});

describe('the reconciliation guide', () => {
  it('renders, with every section reachable by id', () => {
    render(reconciliationGuide);
    for (const s of reconciliationGuide.sections) expect(host.querySelector(`#${s.id}`)).toBeTruthy();
  });

  it('explains the lines that show as Not checked, and why they are excluded', () => {
    // These two have no system to compare against. They must not read as
    // passes, and the guide has to say why a six-line statement reports four.
    render(reconciliationGuide);
    const text = host.textContent;
    expect(text).toMatch(/Two lines show as Not checked/i);
    expect(text).toMatch(/neither matched nor an exception/i);
    expect(text).toMatch(/stay out of the auto-match percentage/i);
  });

  it('gives both halves of the amount tolerance', () => {
    render(reconciliationGuide);
    const text = host.textContent;
    expect(text).toContain('100');
    expect(text).toContain('0.5%');
  });

  it('explains carry-forward and the pattern threshold', () => {
    render(reconciliationGuide);
    const text = host.textContent;
    expect(text).toMatch(/Three times in six is a pattern/i);
    expect(text).toMatch(/carried, not copied/i);
  });

  it('says an agreed period is reopened as a new version, not edited', () => {
    render(reconciliationGuide);
    expect(host.textContent).toMatch(/creates a new version/i);
  });
});

describe('every guide', () => {
  it('carries no unrendered markdown', () => {
    // Blocks render as plain text, so a stray ** or _ would show literally.
    for (const [key, guide] of Object.entries(GUIDES)) {
      render(guide);
      expect(host.textContent, key).not.toMatch(/\*\*|__/);
    }
  });
});
