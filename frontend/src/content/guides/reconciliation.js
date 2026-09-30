/**
 * Reference content for the Reconciliation module.
 *
 * Includes the two lines that have no system to check against. They used to
 * compare a figure with itself and report an exact match; they now say they
 * were not checked, and a reference page has to explain why a statement shows
 * fewer checked lines than it has lines.
 */

const reconciliationGuide = {
  eyebrow: 'Module reference',
  title: 'Reconciliation',
  summary:
    'At the end of a period, SJVN and the other side need to agree what happened: how much '
    + 'energy, how much billed, how much paid, and what is still in dispute. This module builds '
    + 'that comparison line by line, marks what matches and what does not, and carries the '
    + 'statement through both sides signing it off.',

  facts: [
    { label: 'Quantity tolerance', value: '±0.5%', hint: 'Energy and availability' },
    { label: 'Amount tolerance', value: '±₹100 or 0.5%', hint: 'Whichever is met' },
    { label: 'Availability floor', value: '90%', hint: 'Below it, a penalty is expected' },
    { label: 'Pattern flag', value: '3 in 6', hint: 'Same line failing repeatedly' },
  ],

  quickRef: {
    title: 'Quick reference',
    items: [
      { k: 'Exact', v: 'No variance at all' },
      { k: 'Auto-matched', v: 'Within tolerance' },
      { k: 'Exception', v: 'Outside tolerance — needs review' },
      { k: 'Overridden', v: 'Accepted with a recorded reason' },
      { k: 'Carried', v: 'Unresolved from the previous period' },
      { k: 'Agreed', v: 'Both sides have signed off' },
    ],
  },

  sections: [
    {
      id: 'recon-what',
      heading: 'What a reconciliation is',
      blocks: [
        { type: 'p', text:
          'A reconciliation is a statement for one counterparty and one period, built from what '
          + 'the platform already holds — the metered energy, the invoices raised, the '
          + 'payments received, the open disputes — and set out as a list of comparisons. '
          + 'Each comparison is a line, and each line either matches or does not.' },
        { type: 'p', text:
          'It runs for a contract, or for a trading client. The lines differ between the two '
          + 'because the questions differ: a contract has metered energy and availability, a '
          + 'trading client has bids and clearing.' },
        { type: 'note', tone: 'info', title: 'Both sides sign it', text:
          'The point of the statement is agreement, not a report. SJVN acknowledges it and so '
          + 'does the counterparty, each from their own screen, and only when both have is the '
          + 'period agreed. Either side can disagree instead, which puts the statement into '
          + 'dispute rather than closing it.' },
      ],
    },

    {
      id: 'recon-lines',
      heading: 'The lines on a contract statement',
      blocks: [
        { type: 'table',
          columns: ['Line', 'Compares'],
          rows: [
            ['Energy: metered vs billed', 'The month’s metered energy against what the invoices billed, in MWh'],
            ['Financial: billed vs paid', 'What was invoiced against what has been received'],
            ['Tax: billed vs filed', 'Tax on the invoices against tax filed, where a filed figure is supplied'],
            ['Performance: availability', 'Availability achieved against the 90% floor'],
            ['Penalty: expected vs billed', 'The penalty a shortfall implies against the penalty actually billed'],
            ['Internal: system vs SAP', 'The platform’s figure against the SAP mirror, where one is supplied'],
            ['Open disputes', 'One line per dispute still open on the period, carrying its amount'],
            ['Carry-forward', 'Anything left unresolved from the previous period'],
          ] },
        { type: 'p', text:
          'A trading client statement carries three lines instead: bid against cleared quantum, '
          + 'billed against paid, and the SAP mirror.' },
        { type: 'note', tone: 'warn', title: 'Two lines show as Not checked', text:
          'The tax line needs a figure filed with the GST portal and the SAP line needs the '
          + 'finance system’s own total. Neither connector exists, so unless a run is given '
          + 'those figures there is nothing to compare against, and both lines report Not '
          + 'checked rather than an exact match. They count as neither matched nor an '
          + 'exception: they do not block sign-off, because there is nothing for anyone to '
          + 'resolve, and they stay out of the auto-match percentage, so a missing connector '
          + 'cannot make the books look more agreed than they are.' },
      ],
    },

    {
      id: 'recon-matching',
      heading: 'How a line is classified',
      blocks: [
        { type: 'table',
          columns: ['Status', 'When'],
          rows: [
            ['Exact', 'No variance at all'],
            ['Auto-matched', 'Within tolerance: 0.5% on a quantity, or ₹100 or 0.5% on an amount'],
            ['Exception', 'Outside tolerance — somebody has to look at it'],
            ['Overridden', 'An exception accepted with a recorded reason. Counts as matched'],
            ['Carried', 'Brought forward unresolved from the previous period. Counts as an exception'],
            ['Not checked', 'No system to compare against. Counts as neither, and stays out of the percentage'],
          ] },
        { type: 'note', tone: 'info', title: 'An amount passes on either test', text:
          'A money line matches if it is within ₹100 or within 0.5%, whichever it meets. The '
          + 'flat figure is there so small absolute differences on a large bill do not need a '
          + 'percentage argument, and the percentage is there so a small bill is not held to a '
          + 'figure larger than itself.' },
        { type: 'p', text:
          'Availability is compared against a 90% floor rather than a tolerance band. Below it '
          + 'the line is an exception and a penalty of 1% of the billed amount is expected, '
          + 'which the penalty line then checks against what was actually billed.' },
      ],
    },

    {
      id: 'recon-patterns',
      heading: 'Carry-forward and pattern flags',
      blocks: [
        { type: 'p', text:
          'An exception nobody resolved does not disappear when the month ends. It is carried '
          + 'into the next period’s statement as its own line, labelled with the period it '
          + 'came from and the statement it came from, and it counts as an exception there too. '
          + 'A problem has to be resolved or overridden to stop following the counterparty '
          + 'around.' },
        { type: 'note', tone: 'warn', title: 'Three times in six is a pattern, not an accident', text:
          'When the same kind of line has been an exception three times across the last six '
          + 'reconciliations for a counterparty, it is flagged as a pattern. One month’s '
          + 'energy mismatch is a discrepancy; the same mismatch every other month is a '
          + 'measurement or process problem that resolving each instance will never fix.' },
      ],
    },

    {
      id: 'recon-workflow',
      heading: 'From a run to an agreed period',
      blocks: [
        { type: 'steps', items: [
          { title: 'Run the period',
            detail: 'Builds the statement from current data. A period that is already agreed or '
              + 'closed is not re-run over — reopening is its own path.' },
          { title: 'Work the exceptions',
            detail: 'Each one is either corrected at source and the period re-run, accepted with '
              + 'a recorded reason, or turned into a dispute. A reason is required to override; '
              + 'there is no silent accept.' },
          { title: 'Request sign-off',
            detail: 'Once nothing is outstanding the statement moves to pending sign-off and the '
              + 'counterparty is asked to look at it.' },
          { title: 'Both sides acknowledge',
            detail: 'SJVN and the counterparty each acknowledge from their own screen. Either '
              + 'may disagree instead, which puts the statement into dispute with the reason '
              + 'recorded.' },
          { title: 'Reopen if something changes',
            detail: 'An agreed or closed period can be reopened by request. Approving it creates '
              + 'a new version rather than editing the old one, so what was agreed at the time '
              + 'survives.' },
        ] },
        { type: 'table',
          columns: ['Status', 'Means'],
          rows: [
            ['Auto-matched', 'Every line matched on the run — nothing to review'],
            ['Needs review', 'At least one exception is open'],
            ['Pending sign-off', 'Nothing outstanding; waiting on acknowledgements'],
            ['Agreed', 'Both sides have signed'],
            ['Disputed', 'One side disagreed'],
            ['Reopened', 'A new version of a period that had been settled'],
          ] },
      ],
    },

    {
      id: 'recon-faq',
      heading: 'Questions that come up',
      blocks: [
        { type: 'faq', items: [
          { q: 'Why does a six-line statement show only four checked lines?',
            a: 'Because the tax and SAP lines have no system to check against, so they report '
              + 'Not checked. The percentage is worked out over the lines that could have gone '
              + 'either way — four here — rather than over all six, so it tells you how '
              + 'much of what was actually checkable agreed.' },
          { q: 'Can I check the tax or SAP line myself?',
            a: 'Yes — a run accepts a filed tax figure and a SAP mirror figure, and where '
              + 'one is supplied the line is compared against it properly. What the module will '
              + 'not do is invent the figure and then agree with itself.' },
          { q: 'Why is a ₹90 difference matched when a 0.6% difference is not?',
            a: 'An amount passes if it is within ₹100 or within 0.5%. Ninety rupees clears the '
              + 'flat test. A 0.6% gap clears neither unless it is also under ₹100.' },
          { q: 'An exception from last month is on this month’s statement. Is it duplicated?',
            a: 'No — it is carried, not copied. It stays on each period’s statement until '
              + 'it is resolved or overridden, which is the point: an unresolved variance should '
              + 'not quietly age out.' },
          { q: 'What does the pattern flag mean?',
            a: 'That this kind of line has been an exception three times in the last six '
              + 'reconciliations for this counterparty. It is a prompt to fix the cause rather '
              + 'than the instance.' },
          { q: 'I overrode an exception. Does that hide it?',
            a: 'No. The line is marked overridden with your reason against it, and it counts as '
              + 'matched from then on. The reason is on the statement and in the trail.' },
          { q: 'Can I edit a period that has been agreed?',
            a: 'No — you reopen it, and that creates a new version. What both sides agreed to '
              + 'at the time stays exactly as it was.' },
          { q: 'The counterparty’s sub-user cannot acknowledge. Why?',
            a: 'They should be able to. Acknowledgement is checked by which side of the contract '
              + 'the user sits on, not by their exact role, so a company’s L1 to L3 users all '
              + 'count as that counterparty. If it is still refused, the statement may be '
              + 'recorded against a different side than expected.' },
          { q: 'Does a dispute on an invoice show up here?',
            a: 'Yes — every dispute still open on the period gets its own line carrying its '
              + 'amount, so the statement and the dispute register cannot drift apart.' },
        ] },
      ],
    },

    {
      id: 'recon-glossary',
      heading: 'Glossary',
      blocks: [
        { type: 'terms', items: [
          { term: 'Three-way match',
            def: 'Comparing a figure across the three places it should agree — metered, billed and paid.' },
          { term: 'Variance',
            def: 'The difference between the two figures on a line, with its size as a percentage of the base.' },
          { term: 'Tolerance',
            def: 'How far two figures may differ and still be treated as agreeing: 0.5% on a quantity, ₹100 or 0.5% on an amount.' },
          { term: 'Exception',
            def: 'A line outside tolerance. Must be resolved, overridden or disputed before sign-off.' },
          { term: 'Override',
            def: 'Accepting an exception with a recorded reason. The line then counts as matched.' },
          { term: 'Carry-forward',
            def: 'An unresolved exception brought into the next period’s statement.' },
          { term: 'Pattern flag',
            def: 'The same kind of line failing three times in the last six reconciliations for a counterparty.' },
          { term: 'SAP mirror',
            def: 'The figure the finance system is expected to hold. With no connector it has to be supplied with the run, and without it the line reports Not checked.' },
          { term: 'Not checked',
            def: 'A line with no system to compare against. Neither a pass nor a failure, and outside the auto-match percentage.' },
          { term: 'Sign-off',
            def: 'Both sides acknowledging the statement. Only then is the period agreed.' },
          { term: 'Reopen',
            def: 'Creating a new version of a settled period. The earlier version is kept.' },
        ] },
      ],
    },
  ],

  footnote:
    'Tolerances, the availability floor and the pattern thresholds are constants in the '
    + 'reconciliation engine rather than master parameters, so changing one is a code change '
    + 'rather than a settings change.',
};

export default reconciliationGuide;
