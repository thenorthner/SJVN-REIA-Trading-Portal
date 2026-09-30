/**
 * Reference content for the Deviation Settlement (DSM) module.
 *
 * Written against the statements themselves rather than against the screen, so
 * the units, signs and week numbering here are NRPC's — including the places
 * where they are the opposite of what the screen shows, which is exactly where
 * people go wrong.
 */

const dsmGuide = {
  eyebrow: 'Module reference',
  title: 'Deviation Settlement (DSM)',
  summary:
    'Every week, NRPC publishes a Deviation Settlement Account: what each entity in the '
    + 'Northern Region was scheduled to inject, what it actually injected, and what that '
    + 'difference costs or earns. This module records SJVN’s stations from that statement '
    + 'and turns each week into a supplementary invoice.',

  facts: [
    { label: 'Published', value: 'Weekly', hint: 'Usually 10–12 days after the week ends' },
    { label: 'Payment due', value: 'Within 10 days', hint: 'Then LPS at 0.04% per day of delay' },
    { label: 'Regulation', value: 'CERC DSM 2024', hint: 'With CERC Ancillary Services 2022' },
    { label: 'Settles into', value: 'NRLDC pool account', hint: 'NR Deviation & Ancillary Services Pool' },
  ],

  quickRef: {
    title: 'Quick reference',
    items: [
      { k: '1 LU', v: '1 Lakh Unit = 100 MWh' },
      { k: '1 Rs Lakh', v: '₹100,000' },
      { k: 'Statement sign', v: '+ pay · − receive' },
      { k: 'This screen’s sign', v: '+ recoverable · − payable' },
      { k: 'Week numbering', v: 'Financial year, WK-01 to WK-52/53' },
      { k: 'Settling column', v: 'NET DEVI, else DEVI AMT' },
    ],
  },

  sections: [
    {
      id: 'dsm-what',
      heading: 'What deviation settlement is',
      blocks: [
        { type: 'p', text:
          'A generating station tells the grid in advance how much it will inject in each '
          + '15-minute block. What it actually injects is never exactly that. Deviation '
          + 'settlement is the mechanism that prices the gap — and it is not a penalty '
          + 'system. Depending on which way the grid frequency was running at the time, the '
          + 'same gap can earn money or cost money, because the point is to reward whoever '
          + 'happened to be helping the grid at that moment.' },
        { type: 'p', text:
          'That is why this module has no simple formula in it. The charge is computed block '
          + 'by block, 96 blocks a day, each against the frequency in that block. NRPC does '
          + 'that arithmetic and publishes the result. This module records the result.' },
        { type: 'note', tone: 'info', title: 'One statement for the whole region', text:
          'NRPC does not publish a feed per plant. It publishes one PDF per week covering '
          + 'every entity in the Northern Region — around 98 of them — and SJVN’s '
          + 'stations are sections inside it, named NATHPA JHAKRI HEP, RAMPUR HEP and '
          + 'SJVN GREEN ENERGY.' },
      ],
    },

    {
      id: 'dsm-workflow',
      heading: 'How a week gets settled',
      blurb: 'Five steps, from the PDF landing on NRPC’s site to an invoice in the approval queue.',
      blocks: [
        { type: 'steps', items: [
          { title: 'Bring in the week’s statement',
            detail: 'Download the Deviation Settlement Account PDF from NRPC and upload it. '
              + 'The whole statement is imported at once — every entity, every day — not '
              + 'just SJVN’s rows.' },
          { title: 'Promote a station into a settlement row',
            detail: 'Pick the statement, the entity name as the statement spells it, and the '
              + 'contract it settles against. The row is created carrying the published figure. '
              + 'Nothing is calculated at this step.' },
          { title: 'Review it',
            detail: 'The row lands as CALCULATED. Check it against the PDF — the scheduled '
              + 'and actual energy shown here are the statement’s LU figures converted to MWh. '
              + 'Add the account reference in Notes.' },
          { title: 'Submit',
            detail: 'Moves the row to SUBMITTED. This is the point of no casual return: after '
              + 'this it is heading for a bill.' },
          { title: 'Dispatch',
            detail: 'Creates a SUPPLEMENTARY invoice in DRAFT with a level-1 approval pending, '
              + 'and links it back to the row. A dispatched row can no longer be edited or '
              + 'deleted.' },
        ] },
        { type: 'table',
          columns: ['Status', 'Means', 'What you can do'],
          rows: [
            ['CALCULATED', 'Figures are in, nothing committed', 'Edit notes, submit, or cancel'],
            ['SUBMITTED', 'Approved internally for billing', 'Dispatch, or cancel'],
            ['DISPATCHED', 'An invoice exists and is linked', 'Nothing — the row is frozen'],
            ['CANCELLED', 'Withdrawn', 'Nothing; raise a fresh row instead'],
          ],
          caption: 'A cancelled row cannot be submitted back into the flow.' },
      ],
    },

    {
      id: 'dsm-units',
      heading: 'Units and signs — read this before checking any figure',
      blurb: 'The statement and this screen disagree on both. Both disagreements are handled for you, but you need to know they exist to reconcile a number by eye.',
      blocks: [
        { type: 'table',
          columns: ['', 'NRPC statement', 'This screen'],
          rows: [
            ['Energy', 'LU (Lakh Units)', 'MWh — the LU figure × 100'],
            ['Money', 'Rs Lakh', 'Rupees — the Lakh figure × 100,000'],
            ['Positive means', 'SJVN pays the pool', 'Recoverable by SJVN'],
            ['Negative means', 'SJVN receives', 'Payable by SJVN'],
          ] },
        { type: 'note', tone: 'warn', title: 'The signs are opposites', text:
          'The statement’s header reads “Deviation Amount to be Paid (+) / Received (−)”. '
          + 'This screen reads “+ recoverable / − payable”. So a statement figure of '
          + '−8.37312 Rs Lakh — money coming in — appears here as +₹8,37,312 recoverable. '
          + 'Reading one as the other flips every receipt into a payable.' },
        { type: 'p', text:
          'A worked example, Nathpa Jhakri for the week of 29 December 2025: the statement '
          + 'shows 511.07 LU scheduled, 517.20474 LU actual, NET DEVI −8.37312. This screen '
          + 'shows 51,107 MWh, 51,720.474 MWh, and +₹8,37,312 recoverable. Same week, same '
          + 'money, two conventions.' },
      ],
    },

    {
      id: 'dsm-no-rate',
      heading: 'Why there is no rate on a statement-backed row',
      blocks: [
        { type: 'p', text:
          'It is tempting to expect deviation × rate = amount. It does not work, and the '
          + 'archive shows how badly. Each 15-minute block is priced against the grid '
          + 'frequency during that block, so a week’s amount is the sum of 672 separately '
          + 'priced blocks. No single rate reproduces it, and the direction does not '
          + 'reliably follow the deviation either.' },
        { type: 'table',
          columns: ['Station', 'Days measured', 'Days the settlement ran against the deviation'],
          rows: [
            ['Nathpa Jhakri HEP', '1,715', '88'],
            ['Rampur HEP', '1,715', '33'],
          ],
          caption: 'Measured across every NRPC statement from March 2021 to January 2026. '
            + 'On those days the station under-injected and still received money, or '
            + 'over-injected and still paid.' },
        { type: 'note', tone: 'good', title: 'What this means in practice', text:
          'A row sourced from an NRPC statement carries the published amount and shows no '
          + 'rate, because the statement publishes none. Its energy figures and amount cannot '
          + 'be edited — if the numbers are wrong, the statement is what has to change, and '
          + 'NRPC reissues it.' },
      ],
    },

    {
      id: 'dsm-source',
      heading: 'Statement rows and estimates',
      blurb: 'Every row says where its amount came from. The difference matters more than it looks.',
      blocks: [
        { type: 'table',
          columns: ['Source', 'Where the amount comes from', 'Use it when'],
          rows: [
            ['NRPC statement', 'The published NET DEVI for that entity and week',
              'The statement for the week has been imported — always prefer this'],
            ['Estimate', 'Your figures × a rate you entered',
              'The statement has not been published yet and a provisional number is needed'],
            ['NRPC — superseded', 'A statement NRPC has since reissued',
              'Never bill from it; import the current statement instead'],
          ] },
        { type: 'note', tone: 'warn', title: 'An estimate is not a settlement', text:
          'Manual entry is kept because the statement lands a week and a half after the week '
          + 'ends, and sometimes a provisional figure is needed before that. But it uses the '
          + 'rate formula, which as the section above shows does not reproduce the '
          + 'settlement — sometimes not even its direction. Replace an estimate with the '
          + 'statement row as soon as the statement is out.' },
      ],
    },

    {
      id: 'dsm-weeks',
      heading: 'Weeks, periods and revisions',
      blocks: [
        { type: 'p', text:
          'NRPC numbers weeks by financial year, not by month. WK-01 of 2021-22 begins on '
          + '29 March 2021 — before 1 April — so the week number never lines up with '
          + 'a calendar month, and a week routinely straddles two of them.' },
        { type: 'p', text:
          'A week is filed under the month it starts in, so it lands in exactly one period. '
          + 'The week of 29 December 2025 to 4 January 2026 is filed under 2025-12.' },
        { type: 'note', tone: 'info', title: 'Revisions replace, they do not add', text:
          'NRPC reissues statements often — more than half of the published archive is '
          + 'marked _R1, _R2 or _Corrigendum. When a revision is imported, the statement it '
          + 'revises is marked superseded, and any settlement row already raised from the old '
          + 'one can no longer be submitted. Totals count the operative row for a week once, '
          + 'never the original and its revision together.' },
      ],
    },

    {
      id: 'dsm-sources',
      heading: 'Where the statements come from',
      blocks: [
        { type: 'table',
          columns: ['Period', 'Source', 'How it arrives'],
          rows: [
            ['March 2021 – January 2026', 'NRPC static archive',
              'Fetched automatically by week; already backfilled'],
            ['After January 2026', 'NRPC main site',
              'Downloaded by hand and uploaded here'],
          ] },
        { type: 'p', text:
          'The archive at nrpc.gov.in/comm/dsa.html stops at the week ending 4 January 2026. '
          + 'Current weeks are published on NRPC’s newer site, where each PDF is named by '
          + 'its upload timestamp and the document list is served by an API that refuses '
          + 'unauthenticated requests — so there is no address a job could work out on its '
          + 'own. Until NRPC offers a documented feed, current weeks are uploaded manually. '
          + 'Everything after that upload is automatic.' },
        { type: 'note', tone: 'info', title: 'What a statement import checks', text:
          'Each entity’s daily rows are added up and compared against the Total the '
          + 'statement prints for that entity. A statement that does not reconcile against '
          + 'itself is refused rather than stored with a warning, so a half-read week never '
          + 'sits in the system looking like data.' },
      ],
    },

    {
      id: 'dsm-faq',
      heading: 'Questions that come up',
      blocks: [
        { type: 'faq', items: [
          { q: 'The station under-injected, so why does the row show money coming in?',
            a: 'Because the grid frequency was above the normal band during those blocks. '
              + 'Under-injecting when the system is over-supplied helps the grid, and the '
              + 'mechanism pays for that. This is the single most common surprise in this '
              + 'module, and it is the statement behaving correctly, not an error.' },
          { q: 'Why can’t I edit the scheduled or actual MWh on a row?',
            a: 'Because it came from the statement. Editing it would recompute the amount '
              + 'from the rate formula and quietly replace a published figure with an '
              + 'estimate. Notes and the plant label are still editable. If the figures are '
              + 'genuinely wrong, NRPC issues a revision — import that.' },
          { q: 'Which entity name do I use when promoting a week?',
            a: 'Exactly the one the statement uses, for example NATHPA JHAKRI HEP, not NJHPS '
              + 'or Nathpa Jhakri. If the name does not match, you will get a clear error '
              + 'naming the week rather than a silently empty row.' },
          { q: 'I have two rows for the same week but the total counts one. Is something missing?',
            a: 'No. That will be a PRIMARY row and a REVISED one. A revision replaces the '
              + 'statement it revises, so counting both would double the week. The totals '
              + 'take the operative row.' },
          { q: 'The statement behind my row was superseded. What now?',
            a: 'Import the current statement for that week, promote a fresh row from it, and '
              + 'cancel the old one. The old row cannot be submitted — that is deliberate, '
              + 'so a withdrawn figure cannot reach an invoice.' },
          { q: 'Why can’t the system just fetch this week’s statement automatically?',
            a: 'NRPC’s current site names each PDF by upload timestamp and serves its '
              + 'document list from an API that refuses unauthenticated calls, so there is no '
              + 'URL to derive. Weeks up to January 2026 are in a static archive and are '
              + 'fetched automatically; later ones are uploaded. See the section above.' },
          { q: 'What is the ADJ ON A/C OF NUC.STN & IW column?',
            a: 'An adjustment on account of nuclear stations and inter-regional exchange. It '
              + 'is added to DEVI AMT to give NET DEVI, which is the figure that settles. '
              + 'Where a statement prints no NET DEVI — the inter-regional entities — '
              + 'DEVI AMT is what settles.' },
          { q: 'When does payment fall due?',
            a: 'Within ten days of the statement’s issue date, into the NR Deviation and '
              + 'Ancillary Services Pool Account maintained by NRLDC. Late payment carries a '
              + 'surcharge of 0.04% for each day of delay under the CERC DSM Regulations 2024.' },
          { q: 'Is this the same as the frequency-linked DSM charge on bilateral schedules?',
            a: 'No. That is a separate calculator on the trading side that prices individual '
              + 'blocks against slabs the desk maintains. This module records what NRPC has '
              + 'already settled for SJVN’s own stations.' },
        ] },
      ],
    },

    {
      id: 'dsm-glossary',
      heading: 'Glossary',
      blocks: [
        { type: 'terms', items: [
          { term: 'DSM', also: 'Deviation Settlement Mechanism',
            def: 'The regulatory framework that prices the difference between scheduled and actual injection, block by block, against grid frequency.' },
          { term: 'DSA', also: 'Deviation Settlement Account',
            def: 'The weekly statement NRPC issues covering every entity in the Northern Region. The source document for this module.' },
          { term: 'LU', also: 'Lakh Unit',
            def: '100,000 kWh, which is 100 MWh. The unit the statement uses for scheduled and actual energy.' },
          { term: 'SCHDL / ACTUAL',
            def: 'The energy the entity was scheduled to inject, and what it actually injected, in LU.' },
          { term: 'DEVI AMT',
            def: 'The deviation charge for the day, in Rs Lakh, positive meaning payable to the pool.' },
          { term: 'NET DEVI',
            def: 'DEVI AMT after the nuclear-station and inter-regional adjustment. This is the figure that settles.' },
          { term: 'WK-nn',
            def: 'The week number within a financial year. WK-01 starts in late March, so week numbers do not align with calendar months.' },
          { term: '_R1 / _R2 / _Corrigendum',
            def: 'A reissued statement. It replaces the one it revises rather than adding to it.' },
          { term: 'LPS', also: 'Late Payment Surcharge',
            def: '0.04% for each day past the due date, under the CERC DSM Regulations 2024.' },
          { term: 'NRLDC pool account',
            def: 'The NR Deviation and Ancillary Services Pool Account that deviation charges are settled into.' },
          { term: 'Supplementary invoice',
            def: 'The invoice type a dispatched DSM row raises — separate from the station’s regular energy bill.' },
        ] },
      ],
    },
  ],

  footnote:
    'Figures quoted in this reference are drawn from NRPC’s published Deviation Settlement '
    + 'Accounts for March 2021 to January 2026. The statement itself is always the authority; '
    + 'where this page and a statement disagree, the statement is right.',
};

export default dsmGuide;
