/**
 * Reference content for the Hydro Billing module.
 *
 * The formulae quoted here are the ones printed on the bill itself, under the
 * CERC Tariff Regulations 2024 for a hydro generating station. Where a figure
 * appears, it is the one the platform computes, not an illustration.
 */

const hydroGuide = {
  eyebrow: 'Module reference',
  title: 'Hydro Billing (Station-wise)',
  summary:
    'Each month a hydro station raises one bill for the whole station, and that bill is then '
    + 'split across the beneficiaries who take power from it, in the proportions the Regional '
    + 'Energy Account fixes. This module does both halves, then carries each beneficiary’s '
    + 'share through approval, issue, despatch, payment and surcharge.',

  facts: [
    { label: 'Tariff', value: 'CERC two-part', hint: 'Capacity charge + energy charge' },
    { label: 'Basis', value: 'Tariff Regulations 2024', hint: 'For a hydro generating station' },
    { label: 'Split by', value: 'Regional Energy Account', hint: 'Beneficiary allocation percentages' },
    { label: 'Approval', value: 'Maker cannot approve', hint: 'Segregation of duties is enforced' },
  ],

  quickRef: {
    title: 'Quick reference',
    items: [
      { k: 'A block', v: 'Tariff constants and derived rates' },
      { k: 'C block', v: 'Capacity charges, incl. incentive' },
      { k: 'E block', v: 'Energy, month and cumulative' },
      { k: 'EE block', v: 'Energy charges' },
      { k: 'Half of AFC', v: 'Via capacity, half via energy' },
      { k: 'Energy unit', v: 'kWh (design energy in MWh)' },
      { k: 'Ledger docs', v: 'PB · LPS · PMT · RBT' },
    ],
  },

  sections: [
    {
      id: 'hydro-what',
      heading: 'What a station bill is',
      blocks: [
        { type: 'p', text:
          'A hydro station under CERC tariff is paid on a two-part tariff. Half of its Annual '
          + 'Fixed Charges is recovered through a capacity charge, earned by being available '
          + 'whether or not anyone draws power; the other half is recovered through an energy '
          + 'charge on what is actually scheduled. That is the whole shape of the bill.' },
        { type: 'note', tone: 'info', title: 'Why 0.5 appears twice', text:
          'The capacity charge takes AFC × 0.5, and the energy charge rate is also derived '
          + 'from AFC × 0.5. That is not a duplication — it is what makes the two halves add '
          + 'back to exactly one AFC over the year. Deriving the energy rate from the same AFC '
          + 'is the point.' },
        { type: 'p', text:
          'The station is billed once. Its beneficiaries — the states and utilities entitled '
          + 'to its power — then take shares of that one bill, in the percentages the Regional '
          + 'Energy Account fixes for the month. Nobody is billed separately; everyone is billed '
          + 'a slice of the same thing, which is what keeps the slices adding back to the whole.' },
      ],
    },

    {
      id: 'hydro-blocks',
      heading: 'The four blocks on the bill',
      blurb: 'The bill prints its own formulae beside each row. These are those formulae.',
      blocks: [
        { type: 'table',
          columns: ['Block', 'Holds', 'Notable rows'],
          rows: [
            ['A', 'Tariff constants and the rates that fall out of them',
              'A5 ex-bus design energy · A6 saleable design energy · A12 energy charge rate · A13 excess rate'],
            ['C', 'Capacity charges, including the incentive',
              'C1 availability achieved · C2 capacity charge · C4 incentive · C5 total'],
            ['E', 'Energy for the month and cumulative for the financial year',
              'E1 scheduled · E2 free power · E3 saleable · E7 beyond the annual cap · E8 within it'],
            ['EE', 'What the energy is charged at',
              'EE1 = E8 × A12 · EE2 = E7 × A13'],
          ] },
        { type: 'table',
          columns: ['Row', 'Formula', 'Unit'],
          rows: [
            ['A5', 'DE × (100 − AUX) / 100', 'MWh'],
            ['A6', 'DE × (100 − AUX) × (100 − FEHS) / 10000', 'MWh'],
            ['A12', 'AFC × 0.5 × 10 / { DE × (100 − AUX) × (100 − FEHS) }', '₹/kWh'],
            ['C2', 'AFC × 0.5 × NDM / NDY × (PAFM / NAPAF)', '₹'],
            ['C4', '3% × beta × 0.5 × AFC / 12', '₹'],
            ['E3', 'E1 − E2', 'kWh'],
            ['E7', 'cumulative saleable − annual saleable design energy', 'kWh'],
          ],
          caption: 'Energy is in kWh throughout, matching the printed bill. Design energy '
            + '(A2, A5, A6) stays in MWh, also as printed.' },
      ],
    },

    {
      id: 'hydro-inputs',
      heading: 'What a station needs before it can be billed',
      blocks: [
        { type: 'p', text:
          'Most of the bill is derived, but a handful of values have to be on the contract '
          + 'first. Without them the month refuses to compute rather than billing a wrong '
          + 'number.' },
        { type: 'table',
          columns: ['Input', 'What it is', 'If missing'],
          rows: [
            ['AFC', 'Annual Fixed Charges from the tariff order', 'The month will not compute'],
            ['Annual design energy', 'The station’s design generation for the year', 'The month will not compute'],
            ['NAPAF', 'Normative annual plant availability factor', 'The month will not compute'],
            ['Normative auxiliary', 'Allowed in-house consumption, as a percentage', 'Treated as zero'],
            ['FEHS', 'Free energy to the home state, as a percentage', 'Treated as zero'],
          ] },
        { type: 'note', tone: 'good', title: 'Two inputs have sensible fallbacks', text:
          'Availability achieved (PAFM) falls back to NAPAF, so a month whose availability has '
          + 'not yet been certified bills at normative rather than at zero. Free power falls '
          + 'back to the contracted FEHS percentage when the Regional Energy Account does not '
          + 'yet carry the line. Both are replaced by the real figure when it arrives.' },
      ],
    },

    {
      id: 'hydro-workflow',
      heading: 'From a month to a despatched bill',
      blocks: [
        { type: 'steps', items: [
          { title: 'Preview the month',
            detail: 'Computes the station bill and the beneficiary breakup without saving '
              + 'anything. Check the A, C, E and EE blocks and the allocation sheet here.' },
          { title: 'Save it',
            detail: 'Creates the bill as DRAFT, with its beneficiary lines.' },
          { title: 'Send it for approval',
            detail: 'Names the next approver and the final approver. Each approver may approve, '
              + 'reject, or forward it to a colleague — the chain is built a step at a time, '
              + 'because who signs next genuinely changes as a bill moves.' },
          { title: 'Issue it',
            detail: 'Only once the chain is complete. Issuing is what puts the bill in front of '
              + 'the beneficiaries, so it is gated on approval having actually finished, not on '
              + 'anyone’s say-so.' },
          { title: 'Release, print and despatch',
            detail: 'Release marks it ready for printing; despatch records that it has gone out. '
              + 'Each beneficiary’s share is posted to their account as a PB document, with a '
              + 'due date.' },
        ] },
        { type: 'note', tone: 'stop', title: 'Whoever raised a bill cannot approve it', text:
          'Approval is what makes a bill payable to fifteen beneficiaries, so it is the one '
          + 'control the module is strict about. Identity is matched on the recorded user, '
          + 'falling back to the name — which can in principle catch two people sharing an '
          + 'account, and that is the safe direction to err in. Being asked for a second '
          + 'approver costs a message; letting the maker clear their own bill is the failure '
          + 'the control exists for.' },
      ],
    },

    {
      id: 'hydro-rea',
      heading: 'Filling a month from the Regional Energy Account',
      blocks: [
        { type: 'p', text:
          'The REA is what fixes the month’s scheduled energy, free power and beneficiary '
          + 'allocation percentages. Rather than keying those in, a month can be built straight '
          + 'from the published account — and a run can cover several months at once, which '
          + 'is how a backlog is cleared.' },
        { type: 'p', text:
          'A long run reports progress as it goes and can be watched rather than waited on. '
          + 'Only one REA run happens at a time, so a second request while one is in flight is '
          + 'refused rather than queued behind it.' },
      ],
    },

    {
      id: 'hydro-ledger',
      heading: 'The beneficiary account',
      blurb: 'One bill, fifteen running accounts. Every movement is a numbered document.',
      blocks: [
        { type: 'table',
          columns: ['Document', 'Is', 'Side'],
          rows: [
            ['PB', 'The beneficiary’s share of a station bill', 'Debit'],
            ['LPS', 'Late payment surcharge on an overdue PB', 'Debit'],
            ['PMT', 'Money received', 'Credit'],
            ['RBT', 'Early-payment rebate allowed on a PB', 'Credit'],
          ],
          caption: 'Amounts are always stored positive — the document type says which side '
            + 'of the account it falls on, so no screen has to remember a sign convention.' },
        { type: 'note', tone: 'info', title: 'ADV is a state, not a document', text:
          'A credit that has not been applied to anything reads as an advance. That falls out '
          + 'of the payment having no clearings against it, which is exactly why resetting '
          + 'clearing turns a payment back into an advance without rewriting the payment '
          + 'itself.' },
        { type: 'p', text:
          'Late payment surcharge accrues on open bills past their due date, at the contract’s '
          + 'annual rate with a monthly step and a cap. Running it twice does not charge twice: '
          + 'what has already been posted against a bill is netted off before anything new is '
          + 'raised.' },
      ],
    },

    {
      id: 'hydro-claims',
      heading: 'Claims besides the monthly bill',
      blocks: [
        { type: 'table',
          columns: ['Claim', 'What it covers', 'How it is split'],
          rows: [
            ['Additional charges',
              'Auxiliary consumption beyond the normative allowance, foreign exchange rate variation, and similar tariff-order items',
              'Apportioned across beneficiaries the same way capacity charges are — they are a cost of the station, not of anyone’s energy'],
            ['TCS',
              'Tax collected at source, on money actually received',
              'Never apportioned. The claim is against the one beneficiary who paid, and carries the receipt it was computed on'],
            ['PTC',
              'Power trading bills: a quantum sold to one counterparty over a date range',
              'Not split at all — no availability, no design energy, no allocation. Net = gross sale − trading expense'],
          ] },
        { type: 'p', text:
          'All three become station-bill rows, so they inherit the lifecycle already built '
          + 'around one — approval, release, printing, despatch, ledger posting, payment — '
          + 'rather than growing a parallel one that would drift from it.' },
      ],
    },

    {
      id: 'hydro-fi',
      heading: 'Handing the month to Finance',
      blocks: [
        { type: 'p', text:
          'C&SO raises the bills; corporate Finance books the sale. The handover is three '
          + 'deliberately separate steps: prepare gathers the month’s issued bills into a '
          + 'posting and totals them, which changes nothing and can be checked; post books it '
          + 'against the voucher number Finance returns; reverse backs a posted entry out.' },
        { type: 'note', tone: 'warn', title: 'A posted entry is never edited', text:
          'It is Finance’s record, not ours. A wrong posting is reversed and the month '
          + 'prepared again. The bills a posting booked are frozen into its lines at the '
          + 'amounts booked, so a later revision to a bill cannot silently restate what Finance '
          + 'already holds.' },
      ],
    },

    {
      id: 'hydro-faq',
      heading: 'Questions that come up',
      blocks: [
        { type: 'faq', items: [
          { q: 'Availability for the month has not been certified. Will the bill come out zero?',
            a: 'No. Availability achieved falls back to the normative figure (NAPAF), so the '
              + 'capacity charge bills at normative rather than collapsing to nothing. Restate '
              + 'the month when the certified figure arrives.' },
          { q: 'Why was my energy billed at two different rates this month?',
            a: 'Because part of it went past the station’s annual saleable design energy. '
              + 'Energy within the annual cap is charged at the energy charge rate (A12); energy '
              + 'beyond it is charged at the excess rate (A13). At some stations the two are '
              + 'equal, at others they are not — Rampur bills the excess well below its '
              + 'normal rate — so the station’s own excess rate is used where it has one.' },
          { q: 'The cap seems to have reset. Why?',
            a: 'The annual design energy cap resets with the financial year, which starts in '
              + 'April. So March and April of the same calendar year sit in different years for '
              + 'this purpose.' },
          { q: 'What is beta?',
            a: 'The factor behind the capacity incentive in row C4. It scales the incentive by '
              + 'the station’s type and performance; the computed value is shown on the bill '
              + 'beside the charge it produced.' },
          { q: 'What does un-requisitioned surplus do to the bill?',
            a: 'It is energy the station scheduled that no beneficiary is billed for, because '
              + 'its supply was regulated. It comes off the saleable energy before anything is '
              + 'charged on it. In a month with no regulation it is zero and every figure is '
              + 'exactly what it would have been.' },
          { q: 'Why can I not approve a bill I raised?',
            a: 'Segregation of duties. Approval is what makes the bill payable to every '
              + 'beneficiary on it, so one person cannot take it from raised to payable on '
              + 'their own. Send it to a different approver.' },
          { q: 'What is the difference between issue, release and despatch?',
            a: 'Issue is the commercial act — the bill becomes real and the beneficiary '
              + 'accounts are charged; it needs the approval chain to be complete. Release marks '
              + 'it ready for printing. Despatch records that it has physically gone out. They '
              + 'are separate because they happen at different times and by different hands.' },
          { q: 'An input arrived after the bill was issued. How do I correct it?',
            a: 'The month is restated rather than edited in place, so what was already issued '
              + 'stays on the record alongside the correction. That matters because the '
              + 'beneficiary accounts and any Finance posting already reflect the original.' },
          { q: 'Why is TCS not split across the beneficiaries like everything else?',
            a: 'Because it is charged on money actually received from one beneficiary. '
              + 'Apportioning it would charge fourteen parties for a receipt from the '
              + 'fifteenth. The claim carries the receipt it was computed on.' },
          { q: 'A payment shows as an advance. Is something wrong?',
            a: 'No — it means the credit has not been applied against any bill yet. Clear it '
              + 'against the bills it is meant for, or leave it as an advance if that is what it '
              + 'is.' },
          { q: 'I ran the surcharge twice. Has the beneficiary been charged twice?',
            a: 'No. What has already been posted against a bill is netted off before a new '
              + 'surcharge is raised, so a second run charges only what has accrued since.' },
        ] },
      ],
    },

    {
      id: 'hydro-glossary',
      heading: 'Glossary',
      blocks: [
        { type: 'terms', items: [
          { term: 'AFC', also: 'Annual Fixed Charges',
            def: 'The station’s annual entitlement under its tariff order. Half is recovered through the capacity charge and half through the energy charge.' },
          { term: 'Two-part tariff',
            def: 'A tariff paid partly for being available and partly for energy actually supplied.' },
          { term: 'DE', also: 'Design energy',
            def: 'The generation the station is designed to produce in a year, in MWh.' },
          { term: 'AUX',
            def: 'Normative auxiliary consumption — the in-house use allowed before energy counts as ex-bus.' },
          { term: 'FEHS', also: 'Free Energy to Home State',
            def: 'The share of generation supplied free to the state the station sits in, as a percentage.' },
          { term: 'NAPAF',
            def: 'Normative annual plant availability factor — the availability the capacity charge is set against.' },
          { term: 'PAFM',
            def: 'Plant availability achieved in the month. Falls back to NAPAF until certified.' },
          { term: 'ECR', also: 'A12',
            def: 'Energy charge rate, in ₹/kWh, derived from half of AFC over the station’s saleable design energy.' },
          { term: 'Excess rate', also: 'A13',
            def: 'The rate charged on energy beyond the annual saleable design energy. Equal to the ECR at some stations, lower at others.' },
          { term: 'Beta',
            def: 'The factor scaling the capacity incentive in row C4.' },
          { term: 'URS', also: 'Un-requisitioned surplus',
            def: 'Scheduled energy no beneficiary is billed for because supply was regulated. Removed from saleable energy before charging.' },
          { term: 'REA', also: 'Regional Energy Account',
            def: 'The regional account that fixes the month’s scheduled energy, free power and beneficiary allocation percentages.' },
          { term: 'PB / LPS / PMT / RBT',
            def: 'Ledger documents: periodic bill, late payment surcharge, payment received, and rebate allowed.' },
          { term: 'ADV', also: 'Advance',
            def: 'A credit not yet applied to any bill. A state of the account rather than a document type.' },
          { term: 'TCS', also: 'Tax Collected at Source',
            def: 'Tax charged on money actually received from a beneficiary, claimed against that beneficiary alone.' },
          { term: 'FERV',
            def: 'Foreign exchange rate variation — a tariff-order item claimed as an additional charge.' },
          { term: 'PTC', also: 'Power trading bill',
            def: 'A bill for a quantum sold to one counterparty. No availability, design energy or beneficiary split; net is gross sale less trading expense.' },
          { term: 'C&SO',
            def: 'SJVN’s Commercial & System Operation Department, which raises these bills.' },
        ] },
      ],
    },
  ],

  footnote:
    'The formulae quoted here are the ones printed on the bill itself, under the CERC Tariff '
    + 'Regulations 2024 for a hydro generating station. Station-specific values — AFC, design '
    + 'energy, NAPAF, auxiliary and FEHS percentages — come from each station’s contract.',
};

export default hydroGuide;
