/**
 * Reference content for the Energy Data & Validation module.
 *
 * The two validation tests and their thresholds, and the lock gate — the
 * things that decide whether a month can be billed at all.
 */

import { REIA_BETA } from '../../reiaBeta.js';

// The beta's contracts are solar, wind, hybrid and storage: hydro's wider band
// is the Hydro desk's and is left out of what a beta tester reads.
const energyGuide = {
  eyebrow: 'Module reference',
  title: 'Energy Data & Validation',
  summary:
    'Every bill rests on one number: how much energy the month actually carried. This module '
    + 'holds that number for each contract and month, checks it two ways before anyone bills '
    + 'against it, and then locks it — because a figure that can still move is a figure a '
    + 'bill cannot rest on.',

  facts: [
    { label: 'Checks', value: 'Two', hint: 'Against expectation, and against other sources' },
    { label: 'Normal tolerance', value: '30%', hint: 'Deviation from expected generation' },
    ...(REIA_BETA ? [] : [{ label: 'Hydro tolerance', value: '80%', hint: 'Seasonal flow makes hydro swing' }]),
    { label: 'Cross-source', value: '2%', hint: 'How far two sources may differ' },
  ],

  quickRef: {
    title: 'Quick reference',
    items: [
      { k: 'Draft', v: 'Recorded, not yet checked' },
      { k: 'Validated', v: 'Passed both checks' },
      { k: 'Disputed', v: 'Failed at least one' },
      { k: 'Locked', v: 'Frozen — the month is billable' },
      { k: 'Provisional', v: 'An early figure' },
      { k: 'Final', v: 'Supersedes the provisional' },
    ],
  },

  sections: [
    {
      id: 'energy-what',
      heading: 'Why a month has to be locked',
      blocks: [
        { type: 'p', text:
          'An energy figure arrives before it is certain. A provisional number comes early so '
          + 'the month can be seen; the final one follows from the regional account. Billing '
          + 'against a figure that is still moving means a bill that has to be restated, and '
          + 'restating a bill is far more expensive than waiting a week for the account.' },
        { type: 'p', text:
          'So a month moves through states, and locking is the moment it becomes billable. '
          + 'Before that it can be corrected freely; after it, the figure is fixed and anything '
          + 'billed against it has something stable underneath.' },
        { type: 'note', tone: 'info', title: 'Provisional figures are kept, not overwritten', text:
          'When a final figure arrives it supersedes the provisional one rather than replacing '
          + 'it, and the link between them is recorded. The provisional history has to survive '
          + 'so that a bill raised against it can still be traced to what was known at the '
          + 'time.' },
      ],
    },

    {
      id: 'energy-states',
      heading: 'The four states',
      blocks: [
        { type: 'table',
          columns: ['State', 'Means', 'Can it be billed?'],
          rows: [
            ['Draft', 'Recorded; nobody has checked it', 'No — it cannot even be locked'],
            ['Validated', 'Passed both checks', 'Once locked'],
            ['Disputed', 'Failed at least one check', 'Only with a recorded reason'],
            ['Locked', 'Frozen', 'Yes'],
          ] },
        { type: 'note', tone: 'stop', title: 'The lock gate', text:
          'A draft cannot be locked — validate it first, because locking is what makes it '
          + 'billable and that is the last point where a validation result can still mean '
          + 'anything. A disputed period can be locked, but only with a reason recorded against '
          + 'it, and doing so notifies the desk. A month billed over its own validation flag is '
          + 'worth somebody else seeing.' },
      ],
    },

    {
      id: 'energy-checks',
      heading: 'The two checks',
      blurb: 'One asks whether the number is plausible. The other asks whether the sources agree.',
      blocks: [
        { type: 'note', tone: 'info', title: 'Check one \u2014 against expectation', text:
          'What the plant could reasonably have generated is worked '
          + 'out from its commissioned capacity, the hours in the month, and a baseline '
          + 'utilisation factor for its project type. The reported figure is compared against '
          + 'that, and a deviation beyond the tolerance flags the month.' },
        { type: 'table',
          columns: ['Project type', 'Tolerance', 'Why'],
          rows: REIA_BETA
            ? [['Solar, wind, hybrid and storage', '30%', 'Sun and wind vary from month to month, within this band']]
            : [
              ['Hydro and pumped storage', '80%', 'Seasonal flow swings output enormously between months'],
              ['Everything else', '30%', 'Solar and wind vary, but within a narrower band'],
            ] },
        { type: 'note', tone: 'warn', title: 'Measured on commissioned capacity, not contracted', text:
          'A plant part-way through phased commissioning cannot generate from megawatts that '
          + 'are not built yet. Measuring against the full contracted capacity let a 10 MW '
          + 'plant file a month’s output as though it were 25 MW and be called clean.' },
        { type: 'note', tone: 'info', title: 'Check two — against other sources', text:
          'A plausible total can still be wrong. If the seller’s '
          + 'own figure and the meter or regional account figure for the same month disagree by '
          + 'more than 2%, one of them is wrong, and billing either without saying so hides '
          + 'that. Sources within tolerance pass, and the note records how many were '
          + 'cross-checked.' },
      ],
    },

    {
      id: 'energy-faq',
      heading: 'Questions that come up',
      blocks: [
        { type: 'faq', items: [
          { q: 'The month failed validation but the figure is genuinely right. What do I do?',
            a: 'Lock it with a reason. The period can be billed, the reason is recorded against '
              + 'it, and the desk is notified — so the decision is visible rather than '
              + 'silent. That is the intended path for a real outlier.' },
          { q: 'Why can I not just lock a draft?',
            a: 'Because locking is what makes a month billable, and it is the last point where '
              + 'validating it can still change anything. A period that was locked and billed '
              + 'without ever being checked is a bill resting on nothing.' },
          ...(REIA_BETA ? [] : [{ q: 'Hydro gets an 80% tolerance. Is that not far too loose?',
            a: 'For hydro it is the honest figure. A monsoon month and a lean month differ by '
              + 'more than any tighter band would allow, so a 30% tolerance would flag most '
              + 'months and train everyone to ignore the flag. The cross-source check is what '
              + 'catches a wrong hydro number.' }]),
          { q: 'Two sources disagree by 3%. Which one is right?',
            a: 'The module does not decide — it flags that they disagree, names both figures '
              + 'and the gap, and leaves it to whoever can find out. The regional account is '
              + 'usually the authority, but not always, and guessing would be worse than '
              + 'asking.' },
          { q: 'A final figure arrived. Does it replace the provisional one?',
            a: 'It supersedes it, and the link is recorded. The provisional row stays, because '
              + 'anything billed against it has to remain traceable to the figure that was '
              + 'known at the time.' },
          { q: 'The expected figure looks wrong for our plant.',
            a: 'It is a benchmark, not a forecast — commissioned capacity times the hours in '
              + 'a month times a baseline utilisation factor for the project type. Those '
              + 'baselines are master parameters, so if one is wrong for your fleet it can be '
              + 'corrected in one place.' },
        ] },
      ],
    },

    {
      id: 'energy-glossary',
      heading: 'Glossary',
      blocks: [
        { type: 'terms', items: [
          { term: 'Provisional / Final',
            def: 'An early figure, and the settled one that supersedes it. Both are kept.' },
          { term: 'CUF', also: 'Capacity Utilisation Factor',
            def: 'Energy generated as a share of what the plant could have generated running flat out. Baselines per project type live in masters.' },
          { term: 'Commissioned capacity',
            def: 'The megawatts actually built and in service. What the expected figure is benchmarked on.' },
          { term: 'Cross-source check',
            def: 'Comparing this month’s figure against the same month from another source. Beyond 2% apart, both are flagged.' },
          { term: 'Lock',
            def: 'Freezing a period so it can be billed. Irreversible in the ordinary course.' },
          { term: 'Lock override',
            def: 'Locking a period that failed validation, with a recorded reason. Notifies the desk.' },
          { term: 'Billing family reference',
            def: 'The thread tying a period’s energy, its bill and any restatement together, so a figure can be traced through to what was billed on it.' },
        ] },
      ],
    },
  ],

  footnote:
    'All three tolerances — 30%, 80% and 2% — and the CUF baselines behind the expected '
    + 'figure are master parameters. Where this page quotes one, the value actually applied is '
    + 'the one configured.',
};

export default energyGuide;
