/**
 * Reference content for Hydro Account Display (Beneficiary Ledger).
 *
 * Details the running ledger lifecycle, document numbering, allocation
 * split on bill issuance, prompt payment rebates, and late payment surcharges.
 */

const hydroLedgerGuide = {
  eyebrow: 'Module reference',
  title: 'Hydro Account Display (Beneficiary Ledger)',
  summary:
    'What each beneficiary of a hydro generating station owes, what it has paid, prompt payment '
    + 'rebates allowed, late payment surcharges accrued, and advances held on account. Every movement '
    + 'is tracked as a numbered document under CERC regulations.',

  facts: [
    { label: 'Basis', value: 'Per beneficiary per station', hint: 'One station bill splits into 15 running accounts' },
    { label: 'Lifecycle', value: 'PB · PMT · RBT · LPS', hint: 'Bills, receipts, rebates, and surcharges' },
    { label: 'Advance State', value: 'ADV (Unapplied credit)', hint: 'Receipts waiting to clear future bills' },
    { label: 'Rebate', value: '1.5% in 5d / 1.0% in 30d', hint: 'CERC prompt payment incentive' },
  ],

  quickRef: {
    title: 'Quick reference',
    items: [
      { k: 'PB (Bill)', v: 'Periodic bill debit — beneficiary allocation share' },
      { k: 'PMT (Payment)', v: 'Payment credit — money received from beneficiary' },
      { k: 'RBT (Rebate)', v: 'Prompt payment incentive allowed on a PB' },
      { k: 'LPS (Surcharge)', v: 'Late payment surcharge on overdue debits' },
      { k: 'ADV (Advance)', v: 'Unapplied credit amount awaiting open bills' },
      { k: 'CLR Doc / Date', v: 'Clearing link between receipt and bill' },
      { k: 'Payment terms', v: 'PPA contract terms (default 45 days)' },
    ],
  },

  sections: [
    {
      id: 'hl-when',
      heading: 'When does a beneficiary account open?',
      blocks: [
        { type: 'p', text:
          'A beneficiary account on this screen does not open when a contract is signed, nor when '
          + 'a draft bill is prepared. It opens at the exact moment a station bill is ISSUED.' },
        { type: 'steps', items: [
          { title: 'Drafting (Hydro Billing)',
            detail: 'The station’s total capacity and energy charges are computed from CERC tariff '
              + 'formulae and the Regional Energy Account (REA). At this stage, the bill is an internal '
              + 'calculation (DRAFT).' },
          { title: 'Approval Chain',
            detail: 'The draft bill is routed through the maker-checker workflow (IN_APPROVAL → APPROVED). '
              + 'No external entity owes SJVN any money yet.' },
          { title: 'Bill Issuance (The Turning Point)',
            detail: 'When the desk clicks "Issue Bill", the station bill stops being internal. The billing '
              + 'engine reads the REA allocation percentages and generates a Periodic Bill (PB) debit document '
              + 'for each beneficiary (Haryana, Punjab, UP, Delhi, HPSEB, Rajasthan, etc.).' },
          { title: 'Running Ledger Activated',
            detail: 'Once the PB documents are posted, each beneficiary appears in the Account Display dropdown '
              + 'with its outstanding balance, due date, and ledger history.' },
        ] },
        { type: 'note', tone: 'info', title: 'Why the dropdown says "No account yet — issue a bill first"', text:
          'If a station has no issued bills, no ledger documents exist for that station yet. As soon '
          + 'as the first monthly bill is approved and issued on the Hydro Billing page, the accounts '
          + 'open automatically.' },
      ],
    },

    {
      id: 'hl-docs',
      heading: 'The documents on an account',
      blurb: 'Every movement is a numbered document. Amounts are always stored positive; the type gives the side.',
      blocks: [
        { type: 'table',
          columns: ['Document', 'Full name', 'Side', 'What it represents'],
          rows: [
            ['PB', 'Periodic Bill', 'Debit', 'The beneficiary’s allocated share of a monthly station bill'],
            ['LPS', 'Late Payment Surcharge', 'Debit', 'Surcharge charged on an open bill past its due date'],
            ['PMT', 'Payment Receipt', 'Credit', 'Cash / RTGS received from the beneficiary'],
            ['RBT', 'Prompt Rebate', 'Credit', 'CERC early-payment rebate allowed against a PB'],
            ['ADV', 'Advance', 'Credit', 'State: a payment with nothing applied against it yet'],
          ] },
        { type: 'note', tone: 'good', title: 'ADV is a state, not a separate document', text:
          'A credit with no clearings against it reads as an advance (ADV). When open bills arrive, '
          + 'the advance can be applied to clear them. Resetting a clearing turns the payment back into an '
          + 'advance without rewriting the receipt.' },
      ],
    },

    {
      id: 'hl-payments',
      heading: 'Recording payments and clearing',
      blocks: [
        { type: 'p', text:
          'When a payment arrives from a beneficiary, the desk records the payment date, amount, mode '
          + '(RTGS, NEFT, Letter of Credit), and bank reference. The system automatically clears open '
          + 'bills on a FIFO (oldest bill first) basis.' },
        { type: 'p', text:
          'If the payment settles an eligible bill within the rebate window, the appropriate prompt payment '
          + 'rebate (RBT) is allowed automatically, reducing the net cash needed to clear the bill.' },
        { type: 'note', tone: 'warn', title: 'Reset and Reverse controls', text:
          'If a payment was matched against the wrong bills, "Reset" dissolves the clearing links and '
          + 'leaves the payment as an advance. If a payment was recorded in error (e.g. wrong amount or bank '
          + 'bounced), "Reverse" voids the payment document and withdraws any rebates it earned.' },
      ],
    },

    {
      id: 'hl-rebates',
      heading: 'CERC Prompt Payment Rebate',
      blocks: [
        { type: 'p', text:
          'Under CERC Tariff Regulations, beneficiaries are entitled to a rebate for prompt payment of monthly bills:' },
        { type: 'table',
          columns: ['Payment window', 'Rebate rate', 'Rule'],
          rows: [
            ['Within 5 days of presentation', '1.50%', 'Full 1.5% incentive for payment through Letter of Credit / RTGS'],
            ['Within 30 days of presentation', '1.00%', 'Standard 1.0% prompt payment rebate'],
            ['Beyond 30 days up to due date', '0.00%', 'Net bill amount payable, no rebate'],
          ] },
        { type: 'p', text:
          'Part payments earn proportionate rebates: paying (1 − rate) of the outstanding balance settles '
          + 'the entire bill.' },
      ],
    },

    {
      id: 'hl-lps',
      heading: 'Late Payment Surcharge (LPS)',
      blocks: [
        { type: 'p', text:
          'When a bill remains unpaid past its due date (typically 45 days from presentation, as fixed in the '
          + 'PPA), Late Payment Surcharge begins accruing under Ministry of Power Electricity (LPS) Rules.' },
        { type: 'p', text:
          'The platform tracks accrued surcharge daily at the base rate (SBI MCLR + margin) and displays '
          + 'the chargeable amount. When ready, the desk charges the surcharge onto the ledger as an LPS debit document.' },
      ],
    },

    {
      id: 'hl-faq',
      heading: 'Frequently asked questions',
      blocks: [
        { type: 'faq', items: [
          { q: 'Why is the Beneficiary dropdown empty or showing "No account yet"?',
            a: 'Because no station bill has been Issued for this station yet. Accounts only open when a bill '
              + 'transitions to ISSUED. Go to Hydro Billing (Station-wise), approve the draft bill, and click "Issue Bill".' },
          { q: 'Can a beneficiary pay before the bill is issued?',
            a: 'Yes. Beneficiaries who remit advance funds before billing have their payments recorded; the money '
              + 'sits as an Advance (ADV) and is automatically applied when the monthly bill is issued.' },
          { q: 'What does "CLR Doc" in the table mean?',
            a: 'Clearing Document. It shows which payment (PMT) cleared a bill (PB), or conversely which bill a '
              + 'payment was applied against.' },
          { q: 'How does Account Display connect with Finance (SAP)?',
            a: 'Once bills are issued and ledger movements are recorded, the monthly summaries are posted to '
              + 'Finance under "Finance Posting (FI)" using SAP-compatible accounting document vouchers.' },
        ] },
      ],
    },
  ],
};

export default hydroLedgerGuide;
