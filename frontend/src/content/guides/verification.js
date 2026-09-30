/**
 * Reference content for the Invoice Verification module.
 *
 * Written against the checklist as it is actually derived — including the
 * thresholds behind the automatic answers, which are the part people cannot
 * see from the screen and therefore cannot argue with.
 */

const verificationGuide = {
  eyebrow: 'Module reference',
  title: 'Invoice Verification',
  summary:
    'Before SJVN pays a developer’s bill, that bill is checked — eight technical '
    + 'questions about whether the energy, tariff and contract terms hold up, and a '
    + 'commercial build-up that says what the bill should come to. This queue shows every '
    + 'bill waiting, and what each one is waiting on.',

  facts: [
    { label: 'Covers', value: 'Developer bills', hint: 'Bills coming in to SJVN, not going out' },
    { label: 'Technical checks', value: 'Eight', hint: 'Five answered automatically, three manual' },
    { label: 'Queue order', value: 'Worst first', hint: 'Failed, then longest waiting' },
    { label: 'Clears when', value: 'Every check passes', hint: 'Verified or marked not applicable' },
  ],

  quickRef: {
    title: 'Quick reference',
    items: [
      { k: 'Verified', v: 'The check passed' },
      { k: 'Failed', v: 'The check did not pass — blocks the bill' },
      { k: 'Pending', v: 'Nobody has answered it yet' },
      { k: 'Not applicable', v: 'Counts as passed for the rollup' },
      { k: 'One failure', v: 'Makes the whole bill Failed' },
      { k: 'Commercial gap', v: 'Build-up minus the amount raised' },
    ],
  },

  sections: [
    {
      id: 'ver-what',
      heading: 'What this queue is for',
      blocks: [
        { type: 'p', text:
          'The checklist itself is not new — it has always been there inside each invoice. '
          + 'What it could not answer was the question a desk actually has in the morning: of '
          + 'the forty bills open right now, which two are stuck, and on what? Finding that out '
          + 'meant opening forty bills.' },
        { type: 'p', text:
          'This queue draws the same checklist the invoice screen draws, merged with whatever '
          + 'the verifier has already saved, so the two cannot disagree. It adds the view '
          + 'across bills: which are failing, which nobody has started, how long the oldest has '
          + 'been waiting, and how much money is sitting behind unverified bills.' },
        { type: 'note', tone: 'info', title: 'Only bills coming in', text:
          'This covers developer bills — what a seller invoices SJVN under a PPA. Bills SJVN '
          + 'raises on its own beneficiaries go through their own approval chain, not this one. '
          + 'Bills that are paid, cancelled or rejected drop out of the queue, because nobody '
          + 'is waiting on them any more.' },
      ],
    },

    {
      id: 'ver-technical',
      heading: 'The eight technical checks',
      blurb: 'Five are answered from the contract and the energy data before anyone opens the bill. Three are yours.',
      blocks: [
        { type: 'table',
          columns: ['Check', 'Answered by', 'How'],
          rows: [
            ['REA Uploaded', 'Automatically',
              'Passes when the month’s energy data came from REA, RLDC or SLDC, or has been locked. Fails when there is no energy data at all'],
            ['Energy Verified', 'Automatically',
              'Follows the seller-vs-system validation: matched passes, mismatch fails, unrun stays pending'],
            ['Tariff Verified', 'Automatically',
              'Compares the rate on the invoice against the rate on the contract. Any difference fails'],
            ['CUF Compliance', 'Automatically',
              'Compares reported CUF against the baseline for that project type. See below'],
            ['COD Compliance', 'Automatically',
              'Passes when commercial operation started on or before the billing month'],
            ['Contract Capacity Verified', 'You', 'Always starts pending — the contract capacity is shown as a hint'],
            ['Curtailment Checked', 'You', 'Confirm any curtailment or backing-down instructions for the month'],
            ['Change in Law Verified', 'You', 'Confirm any change-in-law claim on the bill'],
          ] },
        { type: 'note', tone: 'warn', title: 'The CUF threshold is not what it looks like', text:
          'CUF Compliance does not fail a bill for missing its baseline. It fails when reported '
          + 'CUF is below half the baseline for that project type — so a solar project on a '
          + '20% baseline fails below 10%. It is a sanity check on the energy figure, not a '
          + 'performance test. Underperformance against the baseline is a contract compliance '
          + 'matter, handled elsewhere.' },
        { type: 'p', text:
          'An automatic answer is a starting point, not a verdict. Every check can be overridden '
          + '— confirm it, fail it, or mark it not applicable — and a note can be left '
          + 'against any of them. What you save is kept; the hint beside it is recomputed each '
          + 'time the bill is opened, so if the contract changes, the hint moves and your answer '
          + 'stays.' },
      ],
    },

    {
      id: 'ver-rollup',
      heading: 'How a bill’s overall state is decided',
      blocks: [
        { type: 'table',
          columns: ['Bill state', 'When'],
          rows: [
            ['Failed a check', 'Any one technical check is Failed'],
            ['Verified', 'Every check is Verified or Not applicable'],
            ['In progress', 'Some answered, none failed'],
            ['Not started', 'Nothing answered yet'],
          ] },
        { type: 'note', tone: 'stop', title: 'One failure fails the bill', text:
          'There is no partial pass. A single failed check makes the bill Failed regardless of '
          + 'the other seven, because a bill that cannot be paid as it stands should read that '
          + 'way at a glance rather than as “mostly fine”.' },
        { type: 'p', text:
          'Not applicable counts as passed. That is the honest way to close a check that does '
          + 'not apply to a particular bill — better than marking it verified, which would '
          + 'claim something was checked when it was not.' },
      ],
    },

    {
      id: 'ver-commercial',
      heading: 'The commercial build-up',
      blocks: [
        { type: 'p', text:
          'Alongside the technical checks, the bill is rebuilt from its parts. The build-up is '
          + 'a straight sum, with liquidated damages as the only deduction:' },
        { type: 'table',
          columns: ['Line', 'Sign'],
          rows: [
            ['Energy charges', 'Plus'],
            ['Change in law', 'Plus'],
            ['Compensation event', 'Plus'],
            ['Liquidated damages', 'Minus'],
            ['Previous adjustment', 'Plus — or minus, if the adjustment is negative'],
            ['Net invoice', 'The total these come to'],
          ] },
        { type: 'note', tone: 'warn', title: 'The gap is the point', text:
          'What the build-up comes to is compared against what the bill was actually raised '
          + 'for. A difference between the two is exactly what this check exists to find — it '
          + 'means the bill and its own components disagree, and one of them is wrong.' },
        { type: 'p', text:
          'Energy charges and previous adjustment are seeded from the invoice; the other three '
          + 'start at zero and are filled in by the verifier. So an untouched build-up on a '
          + 'straightforward bill should show no gap.' },
      ],
    },

    {
      id: 'ver-queue',
      heading: 'Reading the queue',
      blocks: [
        { type: 'p', text:
          'Bills are ordered worst first: failed, then in progress, then not started, then '
          + 'verified — and within each group, whatever has been waiting longest. A bill that '
          + 'cannot be paid as it stands, and has been sitting for three weeks, is at the top '
          + 'without anyone sorting for it.' },
        { type: 'note', tone: 'good', title: 'The blockers list', text:
          'Alongside the queue is a count of which check is holding up the most bills. That is '
          + 'usually the most useful thing on the page: twelve bills failing REA Uploaded is one '
          + 'missing upload, not twelve problems.' },
        { type: 'p', text:
          'The totals also carry the money — the value sitting behind bills that are not yet '
          + 'verified — and the age of the oldest one, which is the number worth quoting when '
          + 'a developer asks why they have not been paid.' },
      ],
    },

    {
      id: 'ver-pipeline',
      heading: 'Where verification sits in the invoice’s life',
      blocks: [
        { type: 'table',
          columns: ['Stage', 'Reached when'],
          rows: [
            ['Submitted', 'The bill exists; verification has not begun'],
            ['Under verification', 'Checks are being answered, or one has failed'],
            ['Commercial verification', 'Every check has passed'],
            ['Finance approval', 'The bill is with an approver'],
            ['Approved', 'Approved, sent, or partly paid'],
            ['Payment released', 'Paid'],
          ] },
        { type: 'note', tone: 'info', title: 'The stage is derived, not stored', text:
          'No one sets the stage. It is read off signals that already exist — the verification '
          + 'state, the approval state, and whether money has moved — so a bill cannot sit in '
          + 'a stage it has not actually reached, and nobody has to remember to advance it.' },
        { type: 'p', text:
          'Approval after verification carries its own control: whoever raised an invoice cannot '
          + 'approve it. Verification and approval are separate hands on purpose.' },
      ],
    },

    {
      id: 'ver-faq',
      heading: 'Questions that come up',
      blocks: [
        { type: 'faq', items: [
          { q: 'A check was answered automatically. Can I change it?',
            a: 'Yes — every check can be confirmed, failed, or marked not applicable, and you '
              + 'can leave a note against any of them. The automatic answer is a starting point '
              + 'derived from the contract and the energy data, not a verdict.' },
          { q: 'Why did CUF Compliance pass when the project is underperforming?',
            a: 'Because this check fails only below half the baseline CUF. It is a sanity check '
              + 'on whether the energy figure is plausible, not a performance test. Sustained '
              + 'underperformance against the baseline is a contract compliance matter and is '
              + 'tracked separately.' },
          { q: 'Contract Capacity Verified always starts pending, even when the contract has a capacity. Is that a bug?',
            a: 'No — it is manual by design. The contract capacity is shown as a hint, but '
              + 'whether the bill is consistent with it is a judgement, so nothing answers it for '
              + 'you. The same is true of curtailment and change in law.' },
          { q: 'Seven checks passed and one failed. Why is the whole bill Failed?',
            a: 'Because it cannot be paid as it stands, and that is the thing worth seeing at a '
              + 'glance. A bill reading “mostly fine” is a bill that gets waved through.' },
          { q: 'What is the difference between marking a check Not applicable and Verified?',
            a: 'Both let the bill clear, but they say different things. Verified claims the '
              + 'check was made and passed; not applicable says it did not apply to this bill. '
              + 'Use the honest one — the trail is read later.' },
          { q: 'The commercial build-up does not match the invoice total. What now?',
            a: 'That gap is what the check is for. Either the build-up is missing an adjustment '
              + 'you have not entered, or the bill was raised for the wrong amount. Work out '
              + 'which before clearing it.' },
          { q: 'Why is a paid bill not in the queue?',
            a: 'Paid, cancelled and rejected bills drop out — nobody is waiting on them. They '
              + 'can be brought back into view if you need to look at one.' },
          { q: 'Twelve bills are failing the same check. Do I fix them one by one?',
            a: 'Usually not. The blockers list exists for exactly this: twelve bills failing REA '
              + 'Uploaded is normally one missing upload. Fix the cause and the twelve clear '
              + 'together.' },
          { q: 'Is this the same as the verification page a QR code on a printed invoice opens?',
            a: 'No. That is a public page proving a printed invoice is genuine. This is the '
              + 'internal check on whether a bill should be paid. The names collide; the two are '
              + 'unrelated.' },
        ] },
      ],
    },

    {
      id: 'ver-glossary',
      heading: 'Glossary',
      blocks: [
        { type: 'terms', items: [
          { term: 'REA', also: 'Regional Energy Account',
            def: 'The regional account that states the month’s energy. Energy sourced from it, RLDC or SLDC — or locked — satisfies the REA check.' },
          { term: 'CUF', also: 'Capacity Utilisation Factor',
            def: 'Energy generated as a share of what the plant could have generated running flat out. Baselines are held per project type in masters.' },
          { term: 'COD', also: 'Commercial Operation Date',
            def: 'The date the project began commercial operation. A bill for a month before it is a bill for energy the contract did not cover.' },
          { term: 'Change in law',
            def: 'A claim for costs arising from a change in law or regulation after the contract was signed.' },
          { term: 'Compensation event',
            def: 'A contractually defined event entitling the developer to compensation.' },
          { term: 'Liquidated damages',
            def: 'Contractual damages deducted from the bill — the one line in the build-up that subtracts.' },
          { term: 'Previous adjustment',
            def: 'A correction carried forward from an earlier bill. Adds or subtracts depending on its sign.' },
          { term: 'Commercial gap',
            def: 'The build-up’s net total less the amount the bill was raised for. Should be nil.' },
          { term: 'Developer bill', also: 'SELLER_TO_SJVN',
            def: 'A bill a seller raises on SJVN under a PPA. What this queue covers.' },
        ] },
      ],
    },
  ],

  footnote:
    'CUF baselines, and the thresholds behind the automatic answers, are master parameters. '
    + 'Where this page quotes one, the value actually applied is the one in masters.',
};

export default verificationGuide;
