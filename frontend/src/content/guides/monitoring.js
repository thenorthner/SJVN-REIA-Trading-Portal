/**
 * Reference content for the Payment Monitoring module.
 *
 * The outstanding definition, the ageing buckets and how surcharge is
 * accrued — including why the days it is charged for are not the days on the
 * calendar.
 */

const monitoringGuide = {
  eyebrow: 'Module reference',
  title: 'Payment Monitoring',
  summary:
    'Who owes what, how late it is, and what the lateness has earned. Every open bill in a '
    + 'direction with the days it is past due, what is still outstanding on it, the surcharge '
    + 'already raised and the surcharge earned since — rolled up per counterparty, which is '
    + 'how a treasury desk actually reads it.',

  facts: [
    { label: 'Two directions', value: 'Receivable / payable', hint: 'What buyers owe SJVN, what SJVN owes generators' },
    { label: 'Ageing', value: 'Five buckets', hint: 'Not due, then 30-day bands past 90' },
    { label: 'Default surcharge', value: '15% a year', hint: 'Overridable per contract' },
    { label: 'Rolled up by', value: 'Counterparty', hint: 'Because that is who gets chased' },
  ],

  quickRef: {
    title: 'Quick reference',
    items: [
      { k: 'Outstanding', v: 'Total − rebate + LPS − disputed − paid' },
      { k: 'Deductions', v: 'Count as paid' },
      { k: 'Disputed', v: 'Comes out of outstanding' },
      { k: 'Charged', v: 'Surcharge already on the bill' },
      { k: 'Accrued', v: 'Earned since, not yet raised' },
      { k: 'Surcharge days', v: 'May be fewer than calendar days' },
    ],
  },

  sections: [
    {
      id: 'mon-what',
      heading: 'One question, asked three ways',
      blocks: [
        { type: 'p', text:
          'Payment monitoring with delay days and surcharge, developer payments, and an '
          + 'outstanding ageing view look like three reports. They are the same question asked '
          + 'three ways, so this answers it once and presents it three ways — by bill, by '
          + 'counterparty, and by age.' },
        { type: 'note', tone: 'good', title: 'No two screens can disagree about one bill', text:
          'Every figure here runs on the same outstanding definition the dashboard uses, and '
          + 'the surcharge comes from the same helper the invoice screen shows. That is '
          + 'deliberate: a treasury desk and an invoice screen quoting different numbers for '
          + 'the same bill is worse than either of them being slightly wrong.' },
      ],
    },

    {
      id: 'mon-outstanding',
      heading: 'What outstanding means',
      blocks: [
        { type: 'table',
          columns: ['Component', 'Effect'],
          rows: [
            ['Invoice total', 'The starting figure'],
            ['Rebate allowed', 'Subtracted — it was never going to be collected'],
            ['Surcharge raised', 'Added — it is owed too'],
            ['Disputed amount', 'Subtracted — it is not collectable while it is in dispute'],
            ['Payments received', 'Subtracted, including deductions'],
          ] },
        { type: 'note', tone: 'warn', title: 'Deductions count as paid', text:
          'Money withheld at source is money that is never arriving, so it reduces what is '
          + 'outstanding just as a receipt does. Treating a deduction as still collectable '
          + 'would leave every bill showing a small permanent balance that nobody can ever '
          + 'clear.' },
        { type: 'p', text:
          'Only bills with something actually left on them are listed. A fully collected '
          + 'invoice whose status has not caught up is not ageing debt, and showing it as such '
          + 'would overstate the position.' },
      ],
    },

    {
      id: 'mon-ageing',
      heading: 'The ageing buckets',
      blocks: [
        { type: 'table',
          columns: ['Bucket', 'Covers'],
          rows: [
            ['Not yet due', 'Due date is today or later, or there is no due date'],
            ['1–30 days', 'Past due, within the last month'],
            ['31–60 days', 'Past due by one to two months'],
            ['61–90 days', 'Past due by two to three months'],
            ['Over 90 days', 'Past due by more than three months'],
          ] },
        { type: 'p', text:
          'Buckets are measured from the due date, not the invoice date, so a bill on sixty-day '
          + 'terms is not late the day after it is raised. A bill with no due date recorded '
          + 'falls into not-yet-due rather than being counted as overdue — the absence of a '
          + 'date is not evidence of lateness.' },
      ],
    },

    {
      id: 'mon-surcharge',
      heading: 'Late payment surcharge',
      blurb: 'Two numbers, and they mean different things.',
      blocks: [
        { type: 'table',
          columns: ['Figure', 'Is'],
          rows: [
            ['Charged', 'Surcharge already raised on the bill — part of what is owed'],
            ['Accrued, unbilled', 'Surcharge earned since, which nobody has raised yet'],
          ] },
        { type: 'p', text:
          'The accrued figure is what a desk uses to decide whether to raise a surcharge note. '
          + 'It is never counted twice: what has already been charged is netted off before the '
          + 'unbilled figure is worked out.' },
        { type: 'note', tone: 'warn', title: 'Surcharge days are not calendar days', text:
          'The days a bill is past due and the days its surcharge is charged for are different '
          + 'numbers. Where the platform counts working days for the payer’s state, holidays '
          + 'and weekends drop out of the charging period, so a bill forty days past due can '
          + 'carry surcharge for fewer. Both figures are shown, so neither has to be inferred '
          + 'from the other.' },
        { type: 'p', text:
          'The rate is the contract’s own, falling back to the platform default of 15% a '
          + 'year. A monthly step and a cap on that step can also apply, so the effective rate '
          + 'can rise the longer a bill stays open.' },
      ],
    },

    {
      id: 'mon-counterparty',
      heading: 'Reading it by counterparty',
      blocks: [
        { type: 'p', text:
          'Bills are chased from people, not from invoice numbers, so everything is also rolled '
          + 'up per counterparty: how many bills are open, how much is outstanding, how much of '
          + 'that is overdue, what surcharge has been charged and accrued, and how old the '
          + 'oldest overdue bill is. Counterparties are ordered by what they owe.' },
        { type: 'note', tone: 'info', title: 'Bills with no counterparty still appear', text:
          'An invoice whose contract does not resolve to an entity is grouped under a clearly '
          + 'labelled unlinked heading rather than being dropped. Money owed by nobody in '
          + 'particular is a data problem worth seeing, not one worth hiding.' },
      ],
    },

    {
      id: 'mon-faq',
      heading: 'Questions that come up',
      blocks: [
        { type: 'faq', items: [
          { q: 'A bill is 45 days past due but the surcharge is for fewer days. Why?',
            a: 'Because surcharge is charged on working days where the payer’s state '
              + 'calendar applies. Weekends and holidays drop out. The two figures are shown '
              + 'side by side for exactly this reason.' },
          { q: 'Why did an amount under dispute disappear from outstanding?',
            a: 'Because it is not collectable while it is disputed. It comes back into '
              + 'outstanding if the dispute is resolved in SJVN’s favour.' },
          { q: 'What is the difference between charged and accrued surcharge?',
            a: 'Charged is already on the bill and already owed. Accrued is what has been '
              + 'earned since and not yet raised — it is a prompt to raise a note, not a '
              + 'receivable yet. Adding the two together would double-count.' },
          { q: 'A fully paid bill is missing from the list. Is that right?',
            a: 'Yes. Only bills with something left on them are shown — a collected invoice '
              + 'whose status has not caught up is not ageing debt.' },
          { q: 'Why is a bill with no due date shown as not yet due rather than overdue?',
            a: 'Because there is nothing to be late against. A missing due date is a gap to '
              + 'fill on the invoice, not a reason to treat the bill as overdue.' },
          { q: 'Does this cover money SJVN owes as well as money owed to SJVN?',
            a: 'Yes — the same view runs in both directions. Receivable is what buyers owe '
              + 'SJVN; payable is what SJVN owes the generators.' },
        ] },
      ],
    },

    {
      id: 'mon-glossary',
      heading: 'Glossary',
      blocks: [
        { type: 'terms', items: [
          { term: 'Outstanding',
            def: 'Invoice total, less rebate, plus surcharge raised, less any disputed amount, less payments and deductions.' },
          { term: 'Receivable / payable',
            def: 'The direction of the bill: owed to SJVN, or owed by SJVN.' },
          { term: 'Days past due',
            def: 'Calendar days since the due date.' },
          { term: 'Surcharge days',
            def: 'The days surcharge is actually charged for, which may be fewer where working days are counted.' },
          { term: 'LPS', also: 'Late Payment Surcharge',
            def: 'The charge for paying late. The contract’s rate applies, falling back to 15% a year.' },
          { term: 'Accrued, unbilled',
            def: 'Surcharge earned but not yet raised on a note. Net of whatever has already been charged.' },
          { term: 'Deduction',
            def: 'Money withheld at source. Counts as paid, because it is never arriving.' },
          { term: 'Ageing bucket',
            def: 'How long a bill has been past its due date, in 30-day bands up to 90 days and one bucket beyond.' },
        ] },
      ],
    },
  ],

  footnote:
    'The surcharge rate, the monthly step and its cap are contract terms falling back to '
    + 'master parameters, and the working-day calendar depends on the payer’s state. Where '
    + 'this page quotes a figure, the value actually applied is the one configured.',
};

export default monitoringGuide;
