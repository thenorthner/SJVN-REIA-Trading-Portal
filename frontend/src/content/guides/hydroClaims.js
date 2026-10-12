/**
 * Reference content for Additional Charges & TCS Claims in Hydro & Thermal.
 *
 * Documents what a hydro station bills beyond its monthly energy bill:
 * station overheads apportioned across beneficiaries and TCS claims against
 * individual paying beneficiaries under Section 206C(1H) of the Income Tax Act.
 */

const hydroClaimsGuide = {
  eyebrow: 'Module reference',
  title: 'Additional Charges & TCS (Supplementary Claims)',
  summary:
    'A hydro station incurs certain costs and statutory tax obligations that do not sit inside '
    + 'the monthly tariff energy bill. This module handles both categories: station-wide additional '
    + 'charges (auxiliary consumption beyond normative allowance, foreign exchange variation) apportioned '
    + 'across all beneficiaries, and Tax Collected at Source (TCS) charged directly against individual '
    + 'beneficiaries upon receipt of payments.',

  facts: [
    { label: 'Additional Charges', value: 'Apportioned across all beneficiaries', hint: 'Shared in capacity charge allocation ratios' },
    { label: 'TCS Claims', value: 'Single beneficiary debtor', hint: '100% charged to the specific paying utility' },
    { label: 'Lifecycle', value: 'Accrual → Bill → Approval → Ledger', hint: 'Inherits full station bill machinery' },
    { label: 'Legal Basis', value: 'CERC Tariff & IT Act 206C(1H)', hint: 'Statutory compliance and tariff orders' },
  ],

  quickRef: {
    title: 'Quick reference',
    items: [
      { k: 'AUX_CONSUMPTION', v: 'Auxiliary energy consumption exceeding normative allowance' },
      { k: 'FERV', v: 'Foreign exchange rate variation on foreign currency debt/capex' },
      { k: 'OTHER', v: 'Other legitimate expenses allowed by CERC tariff orders' },
      { k: 'TCS Rate', v: 'Statutory rate (0.1% default under Section 206C(1H))' },
      { k: 'Claim Bill No.', v: 'Sequential station bill (HADD... or HTCS...)' },
      { k: 'Segregation', v: 'Maker cannot approve; standard two-step verification' },
    ],
  },

  sections: [
    {
      id: 'hc-two-shapes',
      heading: 'Two distinct categories of supplementary claims',
      blurb: 'Additional charges and TCS are fundamentally different in their legal structure and accounting shape.',
      blocks: [
        { type: 'table',
          columns: ['Attribute', 'Additional Charges', 'Tax Collected at Source (TCS)'],
          rows: [
            ['Cost nature', 'Station-wide generation & financing overhead', 'Direct statutory income tax collection'],
            ['Legal ground', 'CERC Tariff Regulations / Station Tariff Order', 'Income Tax Act 1961, Section 206C(1H)'],
            ['Debtor target', 'Split across ALL beneficiaries via REA ratio', 'Single beneficiary who remitted payment'],
            ['Trigger event', 'Month-by-month accrual & consolidated claim', 'Actual realization of payment exceeding statutory threshold'],
            ['Allocation', 'Apportioned like capacity charges', 'Zero apportionment — 100% on the paying debtor'],
          ] },
        { type: 'note', tone: 'info', title: 'Why they share the station bills engine', text:
          'Both Additional Charges and TCS claims are raised as hydro_station_bills rows. They inherit '
          + 'the full lifecycle: maker-checker approval, formal bill print format, despatch tracking, '
          + 'automatic debtor ledger posting in Account Display, and payment receipt clearing.' },
      ],
    },

    {
      id: 'hc-additional-charges',
      heading: 'Additional Charges: Accrual & Apportionment',
      blocks: [
        { type: 'p', text:
          'Certain operational expenses cannot be billed on the monthly two-part energy bill '
          + 'because they accrue unevenly or require periodic reconciliation under CERC orders:' },
        { type: 'steps', items: [
          { title: '1. Month-by-month Accrual',
            detail: 'Commercial desk logs individual charge items as they occur (e.g. auxiliary power consumption '
              + 'beyond normative limits due to high silt pumping, or foreign exchange rate fluctuations on loan servicing). '
              + 'These remain UNCLAIMED in the ledger.' },
          { title: '2. Claim Selection',
            detail: 'When the desk prepares a claim bill, it can either select specific unclaimed items or sweep '
              + 'all outstanding items for that generating station.' },
          { title: '3. Capacity Ratio Apportionment',
            detail: 'Because these expenses represent generating station costs rather than any single state’s '
              + 'energy drawal, the system looks up the station’s beneficiary allocation percentages and splits '
              + 'the total claim among all beneficiaries (Haryana, Punjab, UP, HPSEB, Rajasthan, etc.).' },
          { title: '4. Bill Generation & Approval',
            detail: 'A consolidated station claim bill (prefixed HADD) is created along with individual beneficiary '
              + 'line items, ready for commercial approval.' },
        ] },
        { type: 'note', tone: 'good', title: 'Normative vs Actual Auxiliary Consumption', text:
          'Under CERC norms, hydro stations have an auxiliary consumption allowance (typically 1.2% for surface '
          + 'powerhouses, 1.5% for underground powerhouses). Any energy drawn beyond this allowance due to '
          + 'exceptional operational conditions is recorded here for reimbursement.' },
      ],
    },

    {
      id: 'hc-tcs',
      heading: 'TCS Claims: Statutory Tax Collection',
      blocks: [
        { type: 'p', text:
          'Under Section 206C(1H) of the Income Tax Act, a power generator whose gross turnover exceeds ₹10 Crore '
          + 'must collect tax at source at 0.1% on the sale consideration received from a buyer exceeding ₹50 Lakh in a financial year.' },
        { type: 'steps', items: [
          { title: '1. Payment Realization',
            detail: 'TCS cannot be billed in advance on an energy invoice — it is legally triggered only when money '
              + 'is actually received into SJVN’s bank account.' },
          { title: '2. Base & Applicability Calculation',
            detail: 'The desk enters the payment received, the applicable amount subject to TCS, and the statutory rate '
              + '(default 0.1%). The real-time preview computes the exact tax liability before saving.' },
          { title: '3. Dedicated Beneficiary Invoice',
            detail: 'A dedicated TCS bill (prefixed HTCS) is raised against that specific beneficiary alone. '
              + 'It carries the date and receipt reference of the underlying payment.' },
          { title: '4. Form 27EQ & IT Compliance',
            detail: 'Once collected and posted to the ledger, TCS is deposited to the government treasury and reported '
              + 'in SJVN’s quarterly Form 27EQ filings.' },
        ] },
      ],
    },

    {
      id: 'hc-ledger-flow',
      heading: 'Integration with Hydro Account Display',
      blocks: [
        { type: 'p', text:
          'Once an Additional Charges or TCS bill is approved and issued:' },
        { type: 'steps', items: [
          { title: 'Beneficiary Debtor Ledger Updated',
            detail: 'Each beneficiary’s account in the Hydro Account Display receives a Periodic Bill (PB) debit '
              + 'entry representing their share of additional charges or their dedicated TCS bill.' },
          { title: 'Separate Tracking & Due Dates',
            detail: 'The debit reflects the statutory payment terms. Prompt payment rebates and late payment '
              + 'surcharges (LPS) apply according to standard commercial regulations.' },
          { title: 'Payment Settlement',
            detail: 'When the counterparty remits payment for these claims, it is cleared against the claim document '
              + 'using the FIFO or specific matching protocol.' },
        ] },
      ],
    },

    {
      id: 'hc-faq',
      heading: 'Frequently asked questions',
      blocks: [
        { type: 'faq', items: [
          { q: 'Can we claim additional charges from multiple prior months on one bill?',
            a: 'Yes. Commercial desk can accumulate auxiliary consumption or FERV entries across several months and sweep them together into a single quarterly or annual claim bill.' },
          { q: 'Why is TCS not included directly inside the monthly energy bill?',
            a: 'Income Tax Section 206C(1H) mandates tax collection upon receipt of consideration, not upon invoice accrual. Raising TCS on the energy bill before receipt would violate statutory timing rules.' },
          { q: 'What happens if a beneficiary disputes an additional charge line?',
            a: 'The approval workflow allows rejecting or sending back the draft claim bill for revision before issuance, ensuring disputed amounts are rectified prior to ledger posting.' },
        ] },
      ],
    },
  ],
};

export default hydroClaimsGuide;
