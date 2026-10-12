/**
 * Reference content for Hydro PTC Sale Bills (Power Trading).
 *
 * Details how generating stations sell merchant/surplus power through
 * power traders (e.g. PTC India Limited), the gross sale less trading expense
 * formula, consolidation preview, and ledger posting.
 */

const hydroPtcGuide = {
  eyebrow: 'Module reference',
  title: 'Hydro PTC Sale Bills (Power Trading Desk)',
  summary:
    'Bills a hydro generating station raises on the power trader (such as PTC India Limited) for '
    + 'energy sold through power exchanges (IEX/PXIL/HPX) or bilateral trading arrangements. '
    + 'Unlike tariff-based energy bills, these represent merchant sales where revenue equals gross sale '
    + 'less trading margin and exchange expenses, sitting on the generating station’s own revenue account.',

  facts: [
    { label: 'Asset Basis', value: 'Station revenue asset', hint: 'Sits on station contract, not SJVN trading desk' },
    { label: 'Pricing Rule', value: 'Net = Gross Sale − Expense', hint: 'Sale realization less trading commission' },
    { label: 'Counterparty', value: 'Power Trader (e.g. PTC India)', hint: 'Single buyer/trader debtor' },
    { label: 'Lifecycle', value: 'Trade Window → Bill → Approval → Ledger', hint: 'Opens account in Hydro Account Display' },
  ],

  quickRef: {
    title: 'Quick reference',
    items: [
      { k: 'Counterparty', v: 'Power trader acting as intermediary (PTC India, NVVN, etc.)' },
      { k: 'Trade Window', v: 'from_date to to_date (delivery schedule period)' },
      { k: 'Energy (MU)', v: 'Total energy traded in kWh / Million Units (MU)' },
      { k: 'Gross Sale', v: 'Total revenue realized from buyer / exchange clearing price' },
      { k: 'Trading Expense', v: 'Trader margin (e.g. 2-4 paise/kWh) + open access/POSOCO charges' },
      { k: 'Net Amount', v: 'Net receivable amount payable by trader to SJVN' },
      { k: 'Bill Prefix', v: 'HPTC... generated sequentially on the station contract' },
    ],
  },

  sections: [
    {
      id: 'ptc-why-hydro',
      heading: 'Why PTC sale bills live under Hydro & Thermal',
      blocks: [
        { type: 'p', text:
          'SJVN operates both generating stations (Hydro & Thermal plants) and an active power trading desk. '
          + 'It is critical to distinguish between these two operations:' },
        { type: 'table',
          columns: ['Dimension', 'Hydro Station PTC Sale (This Module)', 'SJVN Trading Desk Operations'],
          rows: [
            ['Whose revenue?', 'The generating station itself (e.g. Nathpa Jhakri, Rampur)', 'SJVN Corporate Trading division'],
            ['Power origin', 'Station surplus generation above normative / unrequisitioned power', 'Power procured from 3rd party generators for resale'],
            ['Accounting ledger', 'Station contract & balance sheet in Hydro ledger', 'Power Trading settlement & margin ledgers'],
            ['Bill structure', 'Net realization from trader against station capacity', 'Trader margin bills & bilateral supply invoices'],
          ] },
        { type: 'note', tone: 'info', title: 'Single station asset', text:
          'Because the power originates from SJVN’s own generation assets, the money owed belongs to the plant. '
          + 'It is tracked under the station’s contract so the station’s total annual commercial realization reflects both tariff and merchant income.' },
      ],
    },

    {
      id: 'ptc-formula',
      heading: 'How a PTC sale bill is computed',
      blocks: [
        { type: 'p', text:
          'A power trading bill is not a tariff bill: there is no Plant Availability Factor (PAFM), '
          + 'no normative design energy, and no multi-beneficiary REA percentage split. SJVN sells a quantum '
          + 'to one counterparty over a specified date range:' },
        { type: 'steps', items: [
          { title: '1. Trade Window & Quantum',
            detail: 'The desk records the delivery dates (from_date to to_date) and the net scheduled energy '
              + 'in kWh (converted automatically to Million Units for reporting).' },
          { title: '2. Gross Realization',
            detail: 'The total value generated on the exchange or bilateral transaction based on Market Clearing Price (MCP) '
              + 'or contracted tariff.' },
          { title: '3. Deducting Trading Expenses',
            detail: 'The trader’s agreed service commission, transmission wheeling charges, and application fees '
              + 'are deducted from the gross sale.' },
          { title: '4. Net Receivable Consolidation',
            detail: 'Net Amount = Gross Sale − Trading Expense. The desk uses the real-time "Consolidate" preview '
              + 'to inspect the exact net figure before committing to raise the bill.' },
        ] },
        { type: 'note', tone: 'warn', title: 'Trading Loss Guardrail', text:
          'If the trading expense equals or exceeds the gross sale, the system prevents raising a sale bill. '
          + 'A negative sale represents a trading loss to be settled through separate claims, not a customer sale invoice.' },
      ],
    },

    {
      id: 'ptc-lifecycle',
      heading: 'Approval workflow & issuance',
      blocks: [
        { type: 'p', text:
          'Once raised, a PTC sale bill behaves exactly like a standard monthly station bill:' },
        { type: 'steps', items: [
          { title: 'Maker-Checker Approval',
            detail: 'The bill enters the commercial approval queue (DRAFT → IN_APPROVAL → APPROVED). '
              + 'Segregation of duties ensures the maker who created the trade cannot approve it.' },
          { title: 'Formal Issuance & Despatch',
            detail: 'Upon approval, the bill is released and formally despatched to the counterparty (e.g. PTC India Ltd).' },
          { title: 'Debtor Account Opening',
            detail: 'Issuing the bill automatically registers the counterparty in the Hydro Account Display '
              + 'with an open debit entry for the net amount and agreed payment due date.' },
        ] },
      ],
    },

    {
      id: 'ptc-settlement',
      heading: 'Settlement in Hydro Account Display',
      blocks: [
        { type: 'p', text:
          'All downstream financial activities for the trader occur in the Hydro Account Display:' },
        { type: 'table',
          columns: ['Event', 'Document Type', 'Accounting Action'],
          rows: [
            ['Bill issued', 'PB (Periodic Bill)', 'Debits the trader account with the net receivable amount'],
            ['Payment received', 'PMT (Payment)', 'Credits the trader account upon bank RTGS receipt'],
            ['Rebate (if applicable)', 'RBT (Rebate)', 'Credited if PPA provides prompt payment discount'],
            ['Delay / Surcharge', 'LPS (Surcharge)', 'Debited if trader fails to remit funds by due date'],
            ['Surplus remittance', 'ADV (Advance)', 'Unapplied funds remain as credit until next trade'],
          ] },
      ],
    },

    {
      id: 'ptc-faq',
      heading: 'Frequently asked questions',
      blocks: [
        { type: 'faq', items: [
          { q: 'Can multiple trades over a month be billed together?',
            a: 'Yes. You can specify a month-long trade window (e.g. 01-Apr to 30-Apr) representing the aggregate merchant volume sold through the trader during that billing cycle.' },
          { q: 'Who is responsible for paying Late Payment Surcharge (LPS)?',
            a: 'If the trader does not remit the net amount by the due date specified in the PPA/trade schedule, the system automatically accrues LPS against the trader on the Hydro Account Display.' },
          { q: 'Can counterparties other than PTC India be billed here?',
            a: 'Yes. Any licensed power trader or bulk merchant buyer (e.g. NVVN, Tata Power Trading, Reliance) buying directly from the station can be billed in this module.' },
        ] },
      ],
    },
  ],
};

export default hydroPtcGuide;
