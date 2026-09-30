/**
 * Reference content for the Contract Compliance module.
 *
 * The five checks and the exact conditions that set each state, so a reader can
 * work out why a contract is showing as it is without opening the code.
 */

const complianceGuide = {
  eyebrow: 'Module reference',
  title: 'Contract Compliance',
  summary:
    'The platform already knows when each contract runs from and to, when its project was '
    + 'commissioned, what security it requires against what is lodged, and whether its '
    + 'counterparty’s statutory approvals are in order. This page puts those beside each '
    + 'other, so the questions a contract manager actually asks have a screen to ask them of.',

  facts: [
    { label: 'Checks per contract', value: 'Five', hint: 'Tenure, COD, capacity, security, approvals' },
    { label: 'States', value: 'OK / Due / Breach', hint: 'Plus not applicable' },
    { label: 'Expiry notice', value: '90 days', hint: 'Configurable' },
    { label: 'Order', value: 'Worst first', hint: 'Breaches, then nearest expiry' },
  ],

  quickRef: {
    title: 'Quick reference',
    items: [
      { k: 'OK', v: 'Nothing to do' },
      { k: 'Due', v: 'Something to do, nothing broken yet' },
      { k: 'Breach', v: 'Live and not compliant' },
      { k: 'Not applicable', v: 'Does not apply to this contract' },
      { k: 'Contract state', v: 'The worst of its five checks' },
      { k: 'Counterparty', v: 'Seller on a PPA, buyer on a PSA' },
    ],
  },

  sections: [
    {
      id: 'comp-what',
      heading: 'What this page is for',
      blocks: [
        { type: 'p', text:
          'Which PPAs expire this quarter? Which contracts are live without their guarantee? '
          + 'Whose licences have lapsed? Every one of those facts was already in the platform, '
          + 'and none of them was on a screen together — so answering any of them meant '
          + 'opening contracts one at a time and remembering what you found.' },
        { type: 'p', text:
          'Every contract that is not closed gets five checks, each with a plain state. The '
          + 'contract’s own state is the worst of the five, and the list is ordered worst '
          + 'first, then by whatever expires soonest.' },
      ],
    },

    {
      id: 'comp-states',
      heading: 'The three states, and what separates them',
      blocks: [
        { type: 'table',
          columns: ['State', 'Means', 'Example'],
          rows: [
            ['OK', 'Nothing needed', 'Tenure runs for another two years'],
            ['Due', 'Something to do, but nothing is broken yet', 'Tenure ends in 60 days; an instrument expires in 40'],
            ['Breach', 'The contract is live and not compliant', 'Tenure ended and the contract is still active; security lodged is short of what is required'],
            ['Not applicable', 'The check does not apply', 'No security required and none lodged'],
          ] },
        { type: 'note', tone: 'info', title: 'Live is what makes a shortfall a breach', text:
          'The same condition reads differently depending on whether the contract is live. A '
          + 'contract that is not active gets Due where a live one would get Breach — because '
          + 'a lapsed guarantee on a contract nobody is performing under is paperwork to tidy, '
          + 'while the same thing on a running contract is exposure.' },
      ],
    },

    {
      id: 'comp-checks',
      heading: 'The five checks',
      blocks: [
        { type: 'table',
          columns: ['Check', 'Breach when', 'Due when'],
          rows: [
            ['Contract tenure',
              'The end date has passed and the contract is still live, or there is no end date at all',
              'It ends inside the notice window, or has not started yet'],
            ['Commercial operation',
              'Energy has been accounted for months, with no COD on record',
              'A COD is scheduled but not reached, or none is recorded on a live contract'],
            ['Commissioned capacity', '—',
              'Nothing commissioned against the contracted MW, or only part of it'],
            ['Payment security',
              'What is lodged falls short of what the contract requires, or an instrument has already expired',
              'An instrument expires inside the notice window'],
            ['Statutory approvals',
              'A mandatory approval has lapsed, or one is outstanding',
              'The same, on a contract that is not live'],
          ] },
        { type: 'note', tone: 'warn', title: 'Billing energy without a COD is a breach, not a gap', text:
          'A contract that has months of energy accounted against it but no commercial '
          + 'operation date on record is a contract nobody can prove is commissioned. That is '
          + 'why it is the one COD condition that reads as a breach rather than something to '
          + 'get round to.' },
        { type: 'p', text:
          'Commissioned capacity never reads as a breach. Phased commissioning is normal — '
          + 'part of a plant being built is not a contractual failure — so it shows as Due '
          + 'until the full contracted capacity is commissioned, and that is all.' },
      ],
    },

    {
      id: 'comp-approvals',
      heading: 'Statutory approvals',
      blocks: [
        { type: 'p', text:
          'These are the checks onboarding exists to make — licences, registrations, '
          + 'clearances — and they do not stop mattering once a contract is signed. They are '
          + 'read against the counterparty on the other side: the seller on a PPA, the buyer on '
          + 'a PSA.' },
        { type: 'table',
          columns: ['Approval status', 'Counts as'],
          rows: [
            ['Verified', 'In order'],
            ['Submitted', 'In order — with the authority, awaiting their decision'],
            ['Not applicable', 'In order — a decision was taken that it does not apply'],
            ['Expired, or past its validity date', 'Lapsed'],
            ['Anything else, including rejected', 'Outstanding'],
          ] },
        { type: 'note', tone: 'info', title: 'Not applicable is a decision; expired is not', text:
          'Marking an approval not applicable is somebody deciding it does not apply, and it '
          + 'closes the check. An approval that expired or was rejected is a different thing '
          + 'entirely, and no amount of time passing turns one into the other.' },
      ],
    },

    {
      id: 'comp-faq',
      heading: 'Questions that come up',
      blocks: [
        { type: 'faq', items: [
          { q: 'A contract shows Breach on security, but we hold a guarantee. Why?',
            a: 'Two things produce that. Either what is lodged is less than the contract '
              + 'requires, or an instrument on it has already passed its validity date. Both '
              + 'read as breach on a live contract.' },
          { q: 'Why is a part-commissioned plant not a breach?',
            a: 'Because phased commissioning is normal. The check reads Due until the full '
              + 'contracted capacity is commissioned — it is there so nobody forgets the rest '
              + 'of it, not to say something has gone wrong.' },
          { q: 'The counterparty’s approval is with the authority. Does that count against us?',
            a: 'No. Submitted counts as in order — it is with them, not with us. Only lapsed, '
              + 'rejected or never-started approvals count against the contract.' },
          { q: 'Which counterparty’s approvals are checked?',
            a: 'The one on the other side of the contract: the seller on a PPA, the buyer on a '
              + 'PSA. The approvals themselves sit on the entity, so one counterparty’s lapsed '
              + 'licence shows on every contract they are party to.' },
          { q: 'A contract ended last month but shows Breach rather than just being closed.',
            a: 'Because it is still recorded as live. A contract past its tenure end that is '
              + 'still active is exactly the thing worth surfacing — either it needs closing '
              + 'or it needs extending, and neither has happened.' },
          { q: 'Can I change the 90-day expiry notice?',
            a: 'Yes — it is a setting on the view, so a desk that wants two quarters of '
              + 'warning can have it. It only moves the line between OK and Due; it does not '
              + 'change what is a breach.' },
        ] },
      ],
    },

    {
      id: 'comp-glossary',
      heading: 'Glossary',
      blocks: [
        { type: 'terms', items: [
          { term: 'Tenure',
            def: 'The period the contract runs for, from its start date to its end date.' },
          { term: 'COD', also: 'Commercial Operation Date',
            def: 'The date the project began commercial operation.' },
          { term: 'Commissioned capacity',
            def: 'The megawatts actually built and in service, against the megawatts contracted.' },
          { term: 'Security requirement',
            def: 'The minimum security the contract itself calls for, against which what is lodged is measured.' },
          { term: 'Statutory approval',
            def: 'A licence, registration or clearance a counterparty must hold. Mandatory ones are the ones checked.' },
          { term: 'Live',
            def: 'A contract that is active, amended, nearing expiry or renewed. Whether a contract is live decides whether a failing check is a breach or merely due.' },
          { term: 'Expiry notice window',
            def: 'How far ahead an expiry starts showing as Due. Ninety days by default.' },
        ] },
      ],
    },
  ],

  footnote:
    'Closed contracts are left out entirely. Everything else is listed, including contracts '
    + 'that have not started yet — a contract whose start date is still ahead shows as Due '
    + 'rather than being hidden.',
};

export default complianceGuide;
