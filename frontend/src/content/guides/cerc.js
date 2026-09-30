/**
 * Reference content for the CERC Compliance module.
 *
 * Written against the filing rules rather than the screen: the margin cap, what
 * makes a period owed, and what stops a return being filed.
 */

const cercGuide = {
  eyebrow: 'Module reference',
  title: 'CERC Compliance',
  summary:
    'SJVN holds an inter-state trading licence, and that licence carries a reporting '
    + 'obligation: Form-IV, a periodic return of every trading transaction, filed monthly '
    + 'and again for each financial year. This page is the filing calendar — every period '
    + 'that owes a return and where it stands.',

  facts: [
    { label: 'Return', value: 'Form-IV', hint: 'Filed transaction-wise, not as a period total' },
    { label: 'Periods owed', value: 'Monthly + annual', hint: 'A period is owed once it has ended' },
    { label: 'Deadline', value: 'Period end + 30 days', hint: 'Configurable in masters' },
    { label: 'Margin cap', value: '4p / 7p per kWh', hint: 'CERC Trading Margin Regulations, 2010' },
  ],

  quickRef: {
    title: 'Quick reference',
    items: [
      { k: 'Sale price ≤ ₹3/kWh', v: 'Margin capped at 4 paise/kWh' },
      { k: 'Sale price > ₹3/kWh', v: 'Margin capped at 7 paise/kWh' },
      { k: 'Cap is tested', v: 'Per transaction, not on the average' },
      { k: 'Exchange trades', v: 'Exempt — but still listed' },
      { k: 'Monthly period', v: 'YYYY-MM' },
      { k: 'Annual period', v: 'Financial year, 2026-27' },
    ],
  },

  sections: [
    {
      id: 'cerc-what',
      heading: 'What this page answers',
      blocks: [
        { type: 'p', text:
          'There are two different questions you can ask about filings, and they have '
          + 'different answers. “What have we prepared?” is answered by the Form-IV '
          + 'register — a list of the returns someone has started. “What do we owe the '
          + 'Commission?” is answered here.' },
        { type: 'note', tone: 'warn', title: 'Why the difference matters', text:
          'A month nobody has started has no row in the register. So a register alone shows '
          + 'a clean sheet for exactly the months that are the problem. This page walks the '
          + 'calendar instead — every month from the first one the platform has trading '
          + 'data for, up to the last completed month — and marks the untouched ones '
          + 'Not started.' },
        { type: 'p', text:
          'The current month is not listed, because it is not late until it ends. An annual '
          + 'return appears once its financial year has finished.' },
      ],
    },

    {
      id: 'cerc-status',
      heading: 'Reading the calendar',
      blocks: [
        { type: 'table',
          columns: ['Status', 'Means'],
          rows: [
            ['Not started', 'No Form-IV exists for this period at all'],
            ['Draft', 'A form exists; lines may be incomplete'],
            ['Prepared', 'Reviewed and ready, but not yet filed with the Commission'],
            ['Filed', 'Submitted, with a CERC reference number recorded'],
          ] },
        { type: 'p', text:
          'Overdue is not a status but a condition: any period that is not Filed once its '
          + 'deadline has passed is flagged overdue, with the number of days it is past due. '
          + 'A Prepared return sitting past its deadline is just as overdue as one nobody '
          + 'started.' },
        { type: 'p', text:
          'The deadline is the end of the period plus a grace window, thirty days by default. '
          + 'That window is a master parameter, so if the Commission changes it, it changes '
          + 'in one place and every period recalculates.' },
      ],
    },

    {
      id: 'cerc-margin',
      heading: 'The trading margin cap',
      blurb: 'The one compliance rule this module enforces, and the one that stops a filing.',
      blocks: [
        { type: 'p', text:
          'The CERC (Fixation of Trading Margin) Regulations, 2010 cap what a trading licensee '
          + 'may earn on a short-term inter-state trade. The cap depends on the sale price:' },
        { type: 'table',
          columns: ['Sale price', 'Maximum margin'],
          rows: [
            ['At or below ₹3/kWh', '4 paise/kWh'],
            ['Above ₹3/kWh', '7 paise/kWh'],
          ],
          caption: 'Both the threshold and the two caps are master parameters, so a revised '
            + 'notification is a settings change rather than a code change.' },
        { type: 'note', tone: 'stop', title: 'The cap is tested per transaction', text:
          'A period whose average margin is comfortably inside the cap can still contain a '
          + 'transaction that breaches it, and that transaction is the breach. Averaging is '
          + 'not a defence, and the form will not submit while a breach is on it.' },
        { type: 'p', text:
          'Trades cleared through a power exchange fall outside the cap. Those lines are not '
          + 'dropped from the return — they are marked exempt with a reason, so the filed '
          + 'form still reconciles to the volume actually traded. A silently skipped line '
          + 'would make the form disagree with the trade book.' },
      ],
    },

    {
      id: 'cerc-workflow',
      heading: 'Preparing and filing a return',
      blocks: [
        { type: 'steps', items: [
          { title: 'Open the period',
            detail: 'Create a Form-IV for the month, or for the financial year. The deadline '
              + 'is set from the period end.' },
          { title: 'Generate the lines',
            detail: 'Pulls every bilateral transaction overlapping the period out of the trade '
              + 'data, transaction by transaction, with its quantum, purchase price, sale price '
              + 'and margin.' },
          { title: 'Fix what the data could not answer',
            detail: 'Lines missing a purchase rate, or breaching the cap, are flagged. Correct '
              + 'the rate at source and regenerate, or record an exemption reason against the '
              + 'line if the trade is genuinely outside the cap.' },
          { title: 'Mark it prepared',
            detail: 'Signals the return is reviewed. It is still editable at this point.' },
          { title: 'File it and record the reference',
            detail: 'Submitting needs the CERC filing reference number. Once submitted the '
              + 'return is frozen — it is the filed record, and it must not drift afterwards.' },
        ] },
        { type: 'note', tone: 'good', title: 'Regenerating is safe', text:
          'Rebuilding the lines after a rate correction replaces only the rows derived from '
          + 'trade data. Lines you added by hand, and exemption reasons you recorded, survive '
          + 'and are renumbered after the derived block — so a correction does not cost you '
          + 'the review work.' },
      ],
    },

    {
      id: 'cerc-blockers',
      heading: 'What stops a return being filed',
      blurb: 'Submission runs a compliance gate. These are the four things it refuses on.',
      blocks: [
        { type: 'table',
          columns: ['Blocker', 'What to do'],
          rows: [
            ['No transactions on the form',
              'Generate from trade data, or add a line by hand if the trade is not in the platform'],
            ['A transaction exceeds the margin cap',
              'Correct the purchase or sale rate, or record an exemption reason if it is genuinely outside the cap'],
            ['A transaction is missing quantum, purchase price or sale price',
              'Fill it in — the return is filed transaction-wise, so a blank leg cannot be averaged over'],
            ['No CERC filing reference number',
              'Record the reference the Commission issued before marking the return filed'],
          ] },
      ],
    },

    {
      id: 'cerc-faq',
      heading: 'Questions that come up',
      blocks: [
        { type: 'faq', items: [
          { q: 'A month shows Not started but we did not trade anything that month. Is that wrong?',
            a: 'No, and it is deliberate. The calendar lists every completed month from the '
              + 'first one with trading data onward, whether or not anything happened in it. A '
              + 'nil return is still a return, and a month that quietly vanished from the list '
              + 'would be the one nobody chases.' },
          { q: 'Our average margin for the month is well under the cap. Why is the form blocked?',
            a: 'Because the cap applies to each transaction separately. One trade above the '
              + 'cap is a breach regardless of what the rest of the month looks like. Correct '
              + 'that trade’s rates, or record why it is exempt.' },
          { q: 'Exchange trades are exempt from the cap — why are they on the form at all?',
            a: 'So the return reconciles to the volume actually traded. They are listed and '
              + 'marked exempt with the reason, rather than dropped, because a form whose total '
              + 'volume disagrees with the trade book invites a question you then have to answer '
              + 'from memory.' },
          { q: 'I corrected a purchase rate. Do I have to redo the whole return?',
            a: 'No. Regenerate — it rebuilds only the lines derived from trade data. Lines '
              + 'you added manually and exemption reasons you recorded are kept.' },
          { q: 'Can I edit a return after filing it?',
            a: 'No. A submitted return is the filed record and is frozen, including its lines. '
              + 'If something filed was wrong, that is a matter for a revised filing with the '
              + 'Commission, not an edit here.' },
          { q: 'When is the annual return owed?',
            a: 'Once the financial year has ended. A financial year runs April to March and is '
              + 'named for both years — 2026-27 covers 1 April 2026 to 31 March 2027, and '
              + 'becomes owed after March 2027.' },
          { q: 'Why is this month not in the list?',
            a: 'A period is not owed until it ends, so the current month appears once it is '
              + 'over. Nothing is late that has not finished happening.' },
          { q: 'Where does the thirty-day deadline come from?',
            a: 'It is a master parameter applied to the period end. If the Commission changes '
              + 'the filing window, change it there and every period in the calendar '
              + 'recalculates.' },
        ] },
      ],
    },

    {
      id: 'cerc-glossary',
      heading: 'Glossary',
      blocks: [
        { type: 'terms', items: [
          { term: 'Form-IV',
            def: 'The periodic return of inter-state trading transactions a licensee files with CERC. Filed transaction-wise, with seller, buyer, quantum, purchase price, sale price, margin and period for each trade.' },
          { term: 'Trading margin',
            def: 'Sale price less purchase price, per unit. What the licensee earns on the trade.' },
          { term: 'Margin cap',
            def: 'The ceiling on that margin under the CERC (Fixation of Trading Margin) Regulations, 2010 — 4 paise/kWh at or below ₹3/kWh, 7 paise/kWh above.' },
          { term: 'Breach',
            def: 'A transaction whose margin exceeds the cap applicable to its sale price. Blocks submission until corrected or exempted.' },
          { term: 'Exemption',
            def: 'A recorded reason why a line falls outside the cap — typically a trade cleared through a power exchange. The line stays on the return.' },
          { term: 'MU', also: 'Million Units',
            def: 'A thousand MWh. The unit volumes are reported in.' },
          { term: 'Financial year',
            def: 'April to March, named for both years: 2026-27 runs 1 April 2026 to 31 March 2027.' },
          { term: 'Overdue',
            def: 'Not filed once the deadline has passed. A prepared-but-unfiled return is overdue too.' },
        ] },
      ],
    },
  ],

  footnote:
    'The cap thresholds, the filing window and the margin rates are all master parameters. '
    + 'Where this page quotes a figure, the value actually applied is the one in masters.',
};

export default cercGuide;
