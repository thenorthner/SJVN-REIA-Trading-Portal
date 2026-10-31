/**
 * Reference content for the Payment Security module.
 *
 * The rules here are the ones the engine actually applies — the waterfall
 * order, which instrument answers for whose default, the thirty-day invocation
 * rule and the expiry cascade — rather than a description of the screen.
 */

import { REIA_BETA } from '../../reiaBeta.js';

// The beta shows contracts alone; the trading clients' lines are left out.
const securityGuide = {
  eyebrow: 'Module reference',
  title: 'Payment Security',
  summary:
    'Every contract carries security against the other side failing to perform — a letter '
    + 'of credit from a buyer, a bank guarantee from a seller, and pooled funds behind both. '
    + 'This module holds those instruments, watches whether they still cover the exposure, '
    + 'warns before they expire, and draws on them in the right order when they have to be '
    + 'invoked.',

  facts: [
    { label: 'LC cover', value: '110% of monthly billing', hint: 'PSA Article 6.5.2' },
    { label: 'Invocation', value: '30 days past due', hint: 'Before an instrument can be drawn' },
    { label: 'Expiry warnings', value: '60 / 30 / 15 / 7 / 0 days', hint: 'Escalating to Management' },
    { label: 'Draw order', value: 'Dedicated before pooled', hint: 'Pooled funds cover every contract' },
  ],

  quickRef: {
    title: 'Quick reference',
    items: [
      { k: 'LC', v: 'Buyer’s payment instrument · drawn 1st' },
      { k: 'Bank guarantee', v: 'Seller’s performance instrument · 2nd' },
      { k: 'Payment security fund', v: 'Pooled · 3rd' },
      { k: 'Corpus fund', v: 'Pooled · 4th' },
      { k: 'Exposure', v: 'Outstanding dues + next bill' },
      { k: 'Coverage ratio', v: 'Available ÷ exposure' },
      { k: 'Adequate', v: 'Ratio of 1.0 or better' },
    ],
  },

  sections: [
    {
      id: 'sec-what',
      heading: 'What security is for',
      blocks: [
        { type: 'p', text:
          'A power contract runs for years and bills monthly, so at any moment one side is '
          + 'owed money by the other for power already delivered. Security is what stands '
          + 'behind that: an instrument that can be drawn on if the bill is not paid, or if the '
          + 'other side does not perform.' },
        { type: 'p', text:
          'The module answers three questions continuously. Is there enough security on this '
          + 'contract for what is at risk? Is any of it about to expire? And when a default '
          + 'happens, what gets drawn, in what order, and for how much?' },
        { type: 'note', tone: 'info', title: 'Adequacy is not only paperwork', text:
          (REIA_BETA ? '' : 'A trading client’s PSA cover is checked before their bids are placed. ')
          + 'A contract that is short on security is not just flagged — it can stop scheduling. Seller '
          + 'security on a PPA does not gate buyer scheduling; only PSA payment cover does.' },
      ],
    },

    {
      id: 'sec-instruments',
      heading: 'The instruments, and whose default each answers for',
      blurb: 'This is the distinction that matters most, and the one most easily got wrong.',
      blocks: [
        { type: 'table',
          columns: ['Instrument', 'Provided by', 'Answers for', 'Pooled?'],
          rows: [
            ['Letter of credit', 'The buyer', 'The buyer failing to pay', 'No — dedicated to one contract'],
            ['Bank guarantee', 'The seller', 'The seller failing to perform', 'No — dedicated to one contract'],
            ['Payment security fund', 'Pooled', 'Either side', 'Yes — covers every contract'],
            ['Corpus fund', 'Pooled', 'Either side', 'Yes — covers every contract'],
          ] },
        { type: 'note', tone: 'stop', title: 'The wrong instrument is not a fallback', text:
          'A letter of credit is a payment instrument and a bank guarantee is a performance '
          + 'instrument. Invoking a bank guarantee because the buyer did not pay is not falling '
          + 'back to the next thing available — it is drawing on the wrong party’s '
          + 'security. A buyer default draws the LC and the pooled funds; a seller default '
          + 'draws the guarantee and the pooled funds. Nothing crosses.' },
      ],
    },

    {
      id: 'sec-coverage',
      heading: 'How coverage is measured',
      blocks: [
        { type: 'table',
          columns: ['Figure', 'Is'],
          rows: [
            ['Available security', 'What can actually be drawn today, across the contract’s instruments'],
            ['Outstanding dues', 'What is owed and unpaid right now'],
            ['Projected next bill', 'What the next month is expected to come to'],
            ['Exposure', 'Outstanding dues plus the projected next bill'],
            ['Coverage ratio', 'Available divided by exposure'],
            ['Required amount', 'What the contract’s own security terms call for'],
            ['Shortfall', 'How far available falls below whichever of exposure or required is larger'],
          ] },
        { type: 'p', text:
          'A contract is adequate when the coverage ratio reaches 1.0 — or, where there is no '
          + 'exposure at all, when the available security meets what the contract requires. '
          + 'Exposure deliberately includes next month’s bill: security that only just covers '
          + 'what is already owed is security that runs out the day the next invoice lands.' },
        { type: 'note', tone: 'warn', title: 'Where the LC requirement comes from', text:
          'PSA Article 6.5.2 puts the letter of credit at 110% of estimated average monthly '
          + 'billing. For a contract that has billed before, the estimate is the trailing '
          + 'average of its own invoices. For a new one it is derived from capacity, a baseline '
          + 'utilisation factor for the project type, and the contract tariff.' },
      ],
    },

    {
      id: 'sec-verified',
      heading: 'Verified, unverified and lapsed cover',
      blurb: 'Three different things can sit behind a number that says a contract is covered.',
      blocks: [
        { type: 'table',
          columns: ['Bucket', 'Means', 'Counts toward adequacy?'],
          rows: [
            ['Verified', 'A bank confirmation reference has been recorded against it', 'Yes'],
            ['Unverified', 'Recorded in the system, but no bank has confirmed it', 'Currently yes — see below'],
            ['Lapsed', 'Past its validity, or not yet started', 'Never'],
          ] },
        { type: 'note', tone: 'warn', title: 'Unverified cover is shown separately on purpose', text:
          'An instrument someone typed in counts the same as one a bank has confirmed — so a '
          + 'large letter of credit that no bank has heard of can make a contract look secured. '
          + 'Whether unverified cover counts is a settings switch, currently off, because '
          + 'turning it on would show most contracts as uncovered overnight and block '
          + 'scheduling on work that is genuinely secured but not yet recorded as such. The '
          + 'split is visible either way, so the real position can be read before the rule is '
          + 'turned on.' },
        { type: 'note', tone: 'stop', title: 'Lapsed cover is never counted', text:
          'A guarantee whose validity has run out cannot be drawn on, whatever its status still '
          + 'says — status only catches up when a sweep relabels it. A demand issued against '
          + 'a lapsed instrument is one the bank refuses, after the money has already been '
          + 'counted as recovered. So validity is checked at the moment of drawing, not taken '
          + 'from the label.' },
      ],
    },

    {
      id: 'sec-expiry',
      heading: 'The expiry cascade',
      blocks: [
        { type: 'table',
          columns: ['Days to expiry', 'Alert', 'Goes to'],
          rows: [
            ['60', 'Reminder', 'REIA desk'],
            ['30', 'Urgent', 'REIA desk'],
            ['15', 'Escalation', 'Management'],
            ['7', 'Final warning', 'Management'],
            ['0', 'Critical — expiring or expired', 'Management'],
          ] },
        { type: 'p', text:
          'Each step fires once per instrument, so a warning is not repeated every time the '
          + 'sweep runs. The escalation is deliberate: sixty days out is a desk task, fifteen '
          + 'days out is a management problem, because renewing an instrument takes a bank’s '
          + 'time and not the platform’s.' },
      ],
    },

    {
      id: 'sec-invocation',
      heading: 'Invoking security',
      blurb: 'What has to be true first, what gets drawn, and what happens afterwards.',
      blocks: [
        { type: 'steps', items: [
          { title: 'The thirty-day rule',
            detail: 'Security can be invoked once an invoice is thirty days past its due date '
              + 'and still unpaid. The amount eligible is what those overdue bills still leave '
              + 'owing after any payments against them.' },
          { title: 'The waterfall decides what is drawn',
            detail: 'The contract’s own instrument goes first — the buyer’s LC on a '
              + 'buyer default, the seller’s guarantee on a seller default — and only when '
              + 'that is exhausted are the pooled funds touched. Spending pooled money on one '
              + 'counterparty removes cover that protects every other contract.' },
          { title: 'Lapsed instruments are skipped',
            detail: 'Validity is checked as the draw is made, so an instrument that has run out '
              + 'is passed over rather than demanded against.' },
          { title: 'The invocation moves through its own states',
            detail: 'Notice issued, then claimed, then funds received — or rejected. These '
              + 'track the bank’s side of the process, which does not complete the moment the '
              + 'demand is raised.' },
          { title: 'Replenishment is demanded',
            detail: 'When funds are received against a revolving letter of credit, the buyer is '
              + 'asked to restore it. Cover that has been drawn and not replaced is cover that '
              + 'is no longer there.' },
        ] },
        { type: 'note', tone: 'info', title: 'Replenish and renew are different things', text:
          'Replenishing restores cover that was actually drawn, and cannot exceed what was '
          + 'drawn — putting back more than was taken would invent cover. Raising the limit '
          + 'or extending validity is a renewal.' },
      ],
    },

    {
      id: 'sec-release',
      heading: 'Releasing an instrument',
      blocks: [
        { type: 'p', text:
          'When a contract completes, the security behind it is returned. A release request '
          + 'records two checks at the moment it is raised: whether anything is still '
          + 'outstanding on the contract, and whether any dispute is still open against its '
          + 'invoices. The instrument moves to release-pending, and the request is then approved '
          + 'or rejected.' },
        { type: 'note', tone: 'warn', title: 'The checklist records, it does not block', text:
          'A failing check does not stop the request being raised — it is captured on it, so '
          + 'whoever approves can see that money is still owed or a dispute is open. The '
          + 'judgement stays with the approver rather than being made by a rule that cannot '
          + 'know the circumstances.' },
      ],
    },

    {
      id: 'sec-faq',
      heading: 'Questions that come up',
      blocks: [
        { type: 'faq', items: [
          { q: 'A contract shows as covered, but its security is all unverified. Is it really covered?',
            a: 'Read the split rather than the headline. Unverified means no bank confirmation '
              + 'has been recorded against the instrument — it may be perfectly good and '
              + 'simply not captured, or it may be an instrument nobody has ever confirmed '
              + 'exists. Getting confirmations recorded is what closes that gap.' },
          { q: 'Why does exposure include a bill nobody has raised yet?',
            a: 'Because security that only just covers what is already owed runs out the day the '
              + 'next invoice lands. Covering the next month too is the point of holding security '
              + 'rather than chasing it.' },
          { q: 'The buyer has not paid. Can we invoke the bank guarantee?',
            a: 'No. The bank guarantee is the seller’s performance instrument. A buyer’s '
              + 'failure to pay is answered by their letter of credit and then by the pooled '
              + 'funds. Drawing the guarantee would be taking the wrong party’s security.' },
          { q: 'Why are the pooled funds drawn last?',
            a: 'Because a corpus or payment security fund stands behind every contract. Spending '
              + 'it on one counterparty’s default removes cover protecting all the others, so '
              + 'the defaulting party’s own instrument is exhausted first.' },
          { q: 'An invoice is twenty days overdue. Why can we not invoke yet?',
            a: 'The rule is thirty days past due. Before that the bill is late, not defaulted.' },
          { q: 'We drew on an LC and the buyer paid back more than was drawn. Can I replenish the full amount?',
            a: 'No — replenishing is capped at what was actually drawn, because restoring more '
              + 'would create cover that was never used. If the limit itself is going up, renew '
              + 'the instrument instead.' },
          { q: 'Why did an instrument get skipped during a draw?',
            a: 'Most likely its validity had run out. Validity is checked at the moment of '
              + 'drawing rather than trusted from the status label, because a demand against a '
              + 'lapsed instrument is refused by the bank — after the money was already '
              + 'counted as recovered.' },
          { q: 'A release request went through with money still outstanding. Should it have?',
            a: 'The checklist records the position; it does not block. That is a judgement for '
              + 'the approver, who can see on the request that dues or disputes are open. If it '
              + 'went through anyway, that decision is on the record.' },
          { q: 'Our bids were blocked for inadequate security. What clears it?',
            a: 'Either more security against the PSA, or a recorded adequacy override with a '
              + 'validity date. The override is deliberately time-limited — it is a decision '
              + 'to carry risk for a period, not a permanent exemption.' },
        ] },
      ],
    },

    {
      id: 'sec-glossary',
      heading: 'Glossary',
      blocks: [
        { type: 'terms', items: [
          { term: 'LC', also: 'Letter of Credit',
            def: 'A bank undertaking provided by the buyer, drawn on when they fail to pay. Set at 110% of estimated average monthly billing under PSA Article 6.5.2.' },
          { term: 'Bank guarantee', also: 'PBG',
            def: 'A bank undertaking provided by the seller, answering for their failure to perform.' },
          { term: 'Corpus fund / Payment security fund',
            def: 'Pooled security standing behind every contract rather than one. Drawn only after the defaulting party’s own instrument is exhausted.' },
          { term: 'Waterfall',
            def: 'The order instruments are drawn in on a default: dedicated first, pooled last.' },
          { term: 'Exposure',
            def: 'Outstanding dues plus the projected next bill — what is at risk, not only what is already owed.' },
          { term: 'Coverage ratio',
            def: 'Available security divided by exposure. One or better is adequate.' },
          { term: 'Shortfall',
            def: 'How far available security falls below the greater of exposure and the contract’s required amount.' },
          { term: 'Revolving',
            def: 'An instrument that reinstates on its own terms after a draw. A non-revolving one does not — restoring it means someone actually paid back in.' },
          { term: 'Replenishment',
            def: 'Restoring cover that has been drawn, capped at the amount drawn.' },
          { term: 'Renewal',
            def: 'Extending validity or raising the limit. Not the same as replenishing.' },
          { term: 'Invocation',
            def: 'The demand made on an instrument after a default. Moves through notice issued, claimed, and funds received or rejected.' },
          { term: 'Adequacy override',
            def: 'A time-limited recorded decision to let a contract pass the adequacy gate despite a shortfall.' },
        ] },
      ],
    },
  ],

  footnote:
    'The cover multiple, the thirty-day invocation rule, the alert cascade and whether '
    + 'unverified security counts are all settings. Where this page quotes a figure, the value '
    + 'actually applied is the one configured.',
};

export default securityGuide;
