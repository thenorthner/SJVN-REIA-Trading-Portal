/**
 * Role powers: what each of SJVN's roles may do, laid out as powers × roles, and
 * changed by a platform administrator with a reason that goes on the record.
 *
 * A power is a named set of the platform's actions — "Raise, verify and send
 * bills" is the dozen API routes that do it. Who holds a power by default is
 * read from the routes' own requireRole gates, so the matrix shows what the
 * code actually allows rather than what someone wrote down about it. An
 * administrator's change is kept as an override (role_power_overrides):
 *
 *   REVOKE  the role is refused every action of the power, whatever the gate
 *           says — rolePowerGuard() stops the request before it reaches the
 *           router, so handler-decided routes are covered too;
 *   GRANT   the role passes the power's requireRole gates as if it were named
 *           in them (requireRole asks grantedPower()).
 *
 * An administrator may also make a role (custom_roles): it works like one of
 * the platform's roles (its base) for whatever the matrix does not list, and
 * holds the combination of powers it was made with. Where it was given a power
 * its base does not have, the request runs as the power's owner — the role the
 * code wrote that action for (actingRole) — so the screens' own checks work
 * for it as they do for the owner, while the audit trail keeps the role held.
 *
 * Changes are bounded by the platform's own rules (changeBlock): administrators
 * govern and do not transact (Target #2 Phase B), the auditor reads and changes
 * nothing, management does not enter data, a maker does not also check or
 * approve (Phase B.2), nobody changes their own role or a senior one, and no
 * power is left with nobody to use it.
 */
import db from '../db/index.js';
import { routeInventory } from './routeInventory.js';

// SJVN's own roles, most senior first. Companies' users have their levels in Team.
export const POWER_ROLES = [
  'IT_SUPER_ADMIN', 'SJVN_ADMIN', 'MANAGEMENT', 'COMMERCIAL_ADMIN', 'THERMAL_ADMIN', 'THERMAL_USER',
  'REIA_APPROVER', 'REIA_CHECKER', 'REIA_MAKER', 'FINANCE_USER', 'TRADING_ADMIN', 'TRADING_USER', 'COMPLIANCE_AUDITOR',
];
const ADMINS = ['IT_SUPER_ADMIN', 'SJVN_ADMIN'];
export const EDITORS = ADMINS;

export const KINDS = {
  view: 'See',
  prepare: 'Prepare (maker)',
  check: 'Check (checker)',
  approve: 'Sanction (approver)',
  finance: 'Money',
  content: 'Site content',
  governance: 'Governance',
};
const TRANSACTION = ['prepare', 'check', 'approve', 'finance'];
const SOD_VERB = { prepare: 'prepare', check: 'check', approve: 'sanction' };

const TRADING_PREFIXES = [
  '/api/trading', '/api/bids', '/api/billing', '/api/bilateral', '/api/bilateral-applications', '/api/bilateral-bidding',
  '/api/billing-settlement', '/api/cerc-market', '/api/client-bid-requests', '/api/client-portfolios', '/api/csv-uploads',
  '/api/deviations', '/api/escert-orders', '/api/exchange-applications', '/api/exchange-bidding', '/api/exchange-bidding-latest',
  '/api/exchange-contracts', '/api/exchange-update-charges', '/api/iex', '/api/iex-bid-book', '/api/import',
  '/api/iset-reports', '/api/margin', '/api/market-analytics', '/api/market-forecast', '/api/noar', '/api/noar-api',
  '/api/noc-updation', '/api/oa-charges', '/api/payment-cycle', '/api/pnl', '/api/pre-trade', '/api/pxil', '/api/pxil-orders',
  '/api/rec', '/api/rec-obligations', '/api/rec-trading', '/api/tds', '/api/trading-client', '/api/trading-clients',
  '/api/trading-invoices', '/api/trading-notes', '/api/view-bill-invoices',
];
const REIA_VIEW_PREFIXES = [
  '/api/invoices', '/api/contracts', '/api/energy-data', '/api/disputes', '/api/payment-security', '/api/reconciliation',
  '/api/energy-banking', '/api/power-diversion', '/api/station-beta', '/api/sjvn-desk', '/api/desk-tasks',
  '/api/balance-confirmations', '/api/notes', '/api/advances', '/api/tds-recon', '/api/reia-fi',
];
const under = (method, prefixes) => prefixes.map((p) => `${method} ${p}/**`);

/*
 * The catalogue. `routes` name inventory routes as "METHOD /path" exactly, or
 * "METHOD /prefix/**" for every route under a prefix; WRITE is every method
 * but GET. `holders` is for a power whose routes leave the decision to the
 * handler (no gate to read): who holds it, as the handler decides. `desk`
 * marks another vertical's power, which the REIA beta does not show. `sod`
 * groups powers whose maker, checker and approver must stay apart.
 */
export const POWERS = [
  // ── REIA desk ─────────────────────────────────────────────────────────────
  { key: 'reia.view', area: 'REIA desk', kind: 'view', label: 'See the REIA desk',
    does: 'Contracts, energy data, bills, disputes, payment security, reconciliation, notes and the REIA dashboards.',
    routes: under('GET', REIA_VIEW_PREFIXES), pages: ['/reia', '/reia/**', '/trading/generator-billing'] },
  { key: 'reia.contracts.prepare', area: 'REIA desk', kind: 'prepare', sod: 'REIA', label: 'Draft, amend and allocate contracts',
    does: 'Create a PPA/PSA, amend it, bulk-load contracts and allocate energy between buyers.',
    routes: ['POST /api/contracts/', 'DELETE /api/contracts/:id', 'POST /api/contracts/:id/compliance-request', 'POST /api/contracts/:id/amend',
      'POST /api/contracts/:id/allocate-energy', 'POST /api/contracts/:id/allocations', 'DELETE /api/contracts/:id/allocations/:allocId',
      'POST /api/contracts/:id/allocations/revise', 'POST /api/contracts/bulk-upload'] },
  { key: 'reia.contracts.hold', area: 'REIA desk', kind: 'approve', sod: 'REIA', label: 'Lift a contract hold',
    does: 'Release a contract that someone on the desk put on hold.',
    routes: ['POST /api/contracts/:id/hold/override'] },
  { key: 'reia.energy.prepare', area: 'REIA desk', kind: 'prepare', sod: 'REIA', label: 'Record and upload energy data',
    does: 'Enter or upload a month\'s energy account, read the REA, record curtailment.',
    routes: ['POST /api/energy-data/parse-rea', 'POST /api/energy-data/upload-account', 'POST /api/energy-data/', 'POST /api/energy-data/:id/curtailment',
      'POST /api/energy-data/rea-trigger', 'POST /api/energy-data/rea-scan'] },
  { key: 'reia.energy.check', area: 'REIA desk', kind: 'check', sod: 'REIA', label: 'Validate and lock energy data',
    does: 'Check the maker\'s energy data and lock it for billing.',
    routes: ['POST /api/energy-data/:id/validate', 'POST /api/energy-data/:id/lock'] },
  { key: 'reia.banking.prepare', area: 'REIA desk', kind: 'prepare', sod: 'REIA', label: 'Bank and draw energy',
    does: 'Record energy banked with a buyer and drawn back.',
    routes: ['POST /api/energy-banking/', 'POST /api/energy-banking/draw'] },
  { key: 'reia.banking.settle', area: 'REIA desk', kind: 'check', sod: 'REIA', label: 'Settle banked energy',
    does: 'Close a banking account at the end of its period.',
    routes: ['POST /api/energy-banking/settle'] },
  { key: 'reia.diversion.prepare', area: 'REIA desk', kind: 'prepare', sod: 'REIA', label: 'Record power diversion',
    does: 'Record a diversion, its recovery and bill the deficit.',
    routes: ['POST /api/power-diversion/', 'POST /api/power-diversion/:id/recover', 'POST /api/power-diversion/:id/bill-deficit', 'DELETE /api/power-diversion/:id'] },
  { key: 'reia.beta.prepare', area: 'REIA desk', kind: 'prepare', sod: 'REIA', label: 'Keep station beta values',
    does: 'Enter, change and true-up the station beta used in CUF billing.',
    routes: ['POST /api/station-beta/', 'PUT /api/station-beta/:id', 'DELETE /api/station-beta/:id', 'POST /api/station-beta/:id/true-up'] },

  // ── REIA billing ──────────────────────────────────────────────────────────
  { key: 'reia.invoice.prepare', area: 'REIA billing', kind: 'prepare', sod: 'REIA', label: 'Raise, verify and send bills',
    does: 'Generate monthly, arrear, supplementary and LPS bills, upload a seller\'s bill, verify its checklist, submit it and send it.',
    routes: ['POST /api/invoices/lps-bills', 'POST /api/invoices/generate-ready', 'POST /api/invoices/generate', 'POST /api/invoices/arrear',
      'POST /api/invoices/supplementary', 'POST /api/invoices/upload', 'POST /api/invoices/', 'POST /api/invoices/verify-bulk',
      'POST /api/invoices/:id/verification', 'POST /api/invoices/:id/submit-l2', 'POST /api/invoices/:id/send', 'POST /api/invoices/:id/other-charges'] },
  { key: 'reia.invoice.check', area: 'REIA billing', kind: 'check', sod: 'REIA', label: 'Approve a bill at the first level',
    does: 'Approve a bill the maker submitted, waive a failed system check, or send the bill back.',
    routes: ['POST /api/invoices/:id/validation/waive', 'POST /api/invoices/:id/send-back', 'POST /api/invoices/:id/approve-l2'] },
  { key: 'reia.notes.prepare', area: 'REIA billing', kind: 'prepare', sod: 'REIA', label: 'Prepare debit and credit notes',
    does: 'Draft a note, raise one from a reconciliation exception or a CUF true-up, and apply an approved note.',
    routes: ['POST /api/notes/', 'POST /api/notes/from-exception', 'POST /api/notes/cuf-true-up', 'POST /api/notes/:id/apply'] },
  { key: 'reia.notes.check', area: 'REIA billing', kind: 'check', sod: 'REIA', label: 'Approve debit and credit notes',
    does: 'Approve, reject or cancel a note.',
    routes: ['POST /api/notes/:id/approve', 'POST /api/notes/:id/reject', 'POST /api/notes/:id/cancel'] },

  // ── Disputes and payment security ─────────────────────────────────────────
  { key: 'reia.disputes.raise', area: 'Disputes & payment security', kind: 'prepare', sod: 'REIA', label: 'Raise disputes',
    does: 'Open a dispute on a bill, one at a time or in a batch.',
    routes: ['POST /api/disputes/', 'POST /api/disputes/batch'] },
  { key: 'reia.disputes.assign', area: 'Disputes & payment security', kind: 'check', sod: 'REIA', label: 'Assign disputes',
    does: 'Give a dispute to an officer to handle.',
    routes: ['POST /api/disputes/:id/assign'] },
  { key: 'reia.disputes.decide', area: 'Disputes & payment security', kind: 'approve', sod: 'REIA', label: 'Decide disputes',
    does: 'Resolve a dispute — the decision the bill is then settled on.',
    routes: ['POST /api/disputes/:id/resolve'] },
  { key: 'reia.security.prepare', area: 'Disputes & payment security', kind: 'prepare', sod: 'REIA', label: 'Record LCs and bank guarantees',
    does: 'Record an instrument, renew or replenish it, and draft an invocation and its letter.',
    routes: ['POST /api/payment-security/board/:contractId/request', 'POST /api/payment-security/invocations/:id/letter', 'POST /api/payment-security/',
      'POST /api/payment-security/from-contract/:contractId', 'POST /api/payment-security/invocations', 'POST /api/payment-security/:id/replenish',
      'POST /api/payment-security/:id/renew'] },
  { key: 'reia.security.check', area: 'Disputes & payment security', kind: 'check', sod: 'REIA', label: 'Verify and invoke payment security',
    does: 'Verify an instrument, record its use and invoke it.',
    routes: ['POST /api/payment-security/invocations/:id/transition', 'POST /api/payment-security/:id/verify', 'POST /api/payment-security/:id/utilize',
      'POST /api/payment-security/:id/invoke'] },
  { key: 'reia.security.override', area: 'Disputes & payment security', kind: 'approve', sod: 'REIA', label: 'Waive a payment-security shortfall',
    does: 'Let a contract run without the full instrument, for a stated period.',
    routes: ['POST /api/payment-security/overrides'] },

  // ── Reconciliation ────────────────────────────────────────────────────────
  { key: 'reia.recon.prepare', area: 'Reconciliation', kind: 'prepare', sod: 'REIA', label: 'Run reconciliation and ask for sign-off',
    does: 'Run a reconciliation, raise a dispute from it and send the statement for the counterparty\'s signature.',
    routes: ['POST /api/reconciliation/run', 'POST /api/reconciliation/:id/raise-dispute', 'POST /api/reconciliation/:id/request-signoff'] },
  { key: 'reia.recon.check', area: 'Reconciliation', kind: 'check', sod: 'REIA', label: 'Override or withdraw a reconciliation',
    does: 'Accept a difference against the figures, or withdraw a statement.',
    routes: ['POST /api/reconciliation/:id/override', 'POST /api/reconciliation/:id/withdraw'] },

  // ── CERC Form-IV ──────────────────────────────────────────────────────────
  // The REIA workflow has the REIA team prepare and submit it (31-Oct-2026); the
  // trading desk, whose trades go on the same return, keeps both.
  { key: 'cerc.formiv.view', area: 'CERC Form-IV', kind: 'view', label: 'See the CERC Form-IV returns',
    does: 'The monthly and annual returns, their lines and annexures, as prepared and as filed.',
    routes: under('GET', ['/api/form-iv']), pages: ['/reia/form-iv', '/trading/form-iv'] },
  { key: 'cerc.formiv.prepare', area: 'CERC Form-IV', kind: 'prepare', sod: 'REIA', label: 'Prepare the CERC Form-IV return',
    does: 'Start a month\'s or a year\'s return, rebuild it from the bills and trades, and correct its lines.',
    routes: ['POST /api/form-iv/', 'POST /api/form-iv/:id/generate', 'PUT /api/form-iv/:id', 'POST /api/form-iv/annual/:fy/roll-up',
      'POST /api/form-iv/:id/lines', 'PUT /api/form-iv/lines/:lineId', 'DELETE /api/form-iv/lines/:lineId'] },
  { key: 'cerc.formiv.file', area: 'CERC Form-IV', kind: 'check', sod: 'REIA', label: 'File the Form-IV return with CERC',
    does: 'Mark a prepared return filed on CERC\'s reference, or record one filed outside the platform.',
    routes: ['POST /api/form-iv/:id/submit', 'POST /api/form-iv/mark-filed-outside'] },

  // ── Finance ───────────────────────────────────────────────────────────────
  { key: 'fin.payments.record', area: 'Finance & SAP', kind: 'finance', label: 'Record payments and balance confirmations',
    does: 'Record a buyer\'s payment against bills, and send and file balance confirmations.',
    routes: ['POST /api/invoices/waterfall-payment', 'POST /api/balance-confirmations/', 'POST /api/balance-confirmations/:id/response',
      'POST /api/balance-confirmations/:id/certificate'], pages: ['/reia/payment-monitoring'] },
  { key: 'fin.payments.confirm', area: 'Finance & SAP', kind: 'finance', label: 'Confirm money received',
    does: 'Confirm a buyer\'s payment reached SJVN\'s bank, apply or refund an advance, mark TDS as reconciled.',
    conflicts: ['reia.invoice.prepare'],
    routes: ['POST /api/invoices/:id/payments', 'POST /api/advances/:id/apply', 'POST /api/advances/:id/refund', 'POST /api/tds-recon/mark'],
    pages: ['/reia/payment-monitoring', '/reia/advances', '/reia/seller-ledgers'] },
  { key: 'fin.release', area: 'Finance & SAP', kind: 'finance', label: 'Release money to generators',
    does: 'Release a generator\'s payment once the buyer has paid, and sign off a security release.',
    routes: ['POST /api/invoices/:id/release-to-generator', 'POST /api/payment-security/releases/:id/act', 'POST /api/payment-security/releases/:id/finance-signoff'],
    pages: ['/reia/release-planner'] },
  { key: 'fin.sap.prepare', area: 'Finance & SAP', kind: 'prepare', sod: 'REIA', label: 'Prepare SAP postings',
    does: 'Draw up the FI document for a booked bill.',
    routes: ['POST /api/reia-fi/prepare'], pages: ['/reia/finance-posting'] },
  { key: 'fin.sap.post', area: 'Finance & SAP', kind: 'check', sod: 'REIA', label: 'Post to SAP and reverse',
    does: 'Post the prepared FI document to SAP, or reverse a posting.',
    routes: ['POST /api/reia-fi/:postingId/post', 'POST /api/reia-fi/:postingId/reverse'],
    pages: ['/reia/finance-posting'] },

  // ── Counterparties ────────────────────────────────────────────────────────
  { key: 'kyc.register', area: 'Counterparties & KYC', kind: 'governance', label: 'Register and edit counterparties',
    does: 'Onboard a seller or buyer, correct its record, its verticals and its logo. Master data, not a transaction.',
    routes: ['POST /api/entities/', 'PUT /api/entities/:id', 'POST /api/entities/:id/verticals', 'POST /api/entities/:id/logo'],
    pages: ['/reia/entities'] },
  { key: 'kyc.approve', area: 'Counterparties & KYC', kind: 'governance', label: 'Verify bank details and approve KYC',
    does: 'Verify a counterparty\'s bank account and approve its onboarding.',
    routes: ['POST /api/entities/:id/approve', 'POST /api/entities/:id/verify-bank', 'POST /api/entities/:id/penny-drop', 'POST /api/entities/:id/bank-callback'],
    pages: ['/reia/entities'] },
  { key: 'kyc.blacklist', area: 'Counterparties & KYC', kind: 'governance', label: 'Blacklist a counterparty',
    does: 'Bar a seller or buyer from new business.',
    routes: ['POST /api/entities/:id/blacklist'] },

  // ── Administration ────────────────────────────────────────────────────────
  { key: 'admin.users', area: 'Administration', kind: 'governance', label: 'Manage SJVN\'s users',
    does: 'Add officers, change their role, reset passwords, switch accounts off.',
    routes: ['GET /api/staff/**', 'WRITE /api/staff/**'], holders: ADMINS, pages: ['/admin/users'] },
  { key: 'admin.company-users', area: 'Administration', kind: 'governance', label: 'Manage companies\' users',
    does: 'Open a seller\'s or buyer\'s team; reset or switch off its Company Admin.',
    routes: ['GET /api/team/**', 'WRITE /api/team/**'], holders: ADMINS, pages: ['/reia/company-users'] },
  { key: 'admin.powers', area: 'Administration', kind: 'governance', fixed: 'Who may change role powers is fixed, so nobody can take the power from everyone or give it to themselves.',
    label: 'Change role powers', does: 'This screen: give or take away a role\'s powers.',
    routes: ['WRITE /api/role-powers/**'], holders: ADMINS, pages: ['/admin/role-powers'] },
  { key: 'masters.view', area: 'Administration', kind: 'view', label: 'See master data',
    does: 'Banks, parameters, losses, holidays, lookups, document types.',
    routes: ['GET /api/masters/**'], pages: ['/masters'] },
  { key: 'admin.masters', area: 'Administration', kind: 'governance', label: 'Change master data',
    does: 'Banks, parameters (approval levels, rates), losses, holidays, lookups, document types, generation assets.',
    routes: ['POST /api/masters/holidays/', 'POST /api/masters/holidays/:id/deactivate', 'POST /api/masters/holidays/:id/reactivate',
      'POST /api/masters/holidays/bulk', 'POST /api/masters/losses/', 'POST /api/masters/banks', 'PUT /api/masters/banks/:id',
      'DELETE /api/masters/banks/:id', 'POST /api/masters/parameters', 'PUT /api/masters/parameters/:key', 'POST /api/masters/document-types',
      'PUT /api/masters/document-types/:id', 'POST /api/masters/lookups', 'PUT /api/masters/lookups/:id', 'POST /api/masters/generation-assets',
      'PUT /api/masters/generation-assets/:id', 'DELETE /api/masters/generation-assets/:id'], pages: ['/masters'] },
  { key: 'admin.project-scope', area: 'Administration', kind: 'governance', label: 'Assign officers to projects',
    does: 'Decide which projects a REIA officer works on.',
    routes: ['PUT /api/project-scope/users/:id'] },
  { key: 'admin.delegations', area: 'Administration', kind: 'governance', label: 'Record an additional charge',
    does: 'Let an officer act for an absent colleague for a period, and end it.',
    routes: ['POST /api/delegations/', 'POST /api/delegations/:id/revoke'] },
  { key: 'admin.privacy', area: 'Administration', kind: 'governance', label: 'Handle data-protection requests',
    does: 'The Data Protection Officer\'s queue under the DPDP Act.',
    routes: ['GET /api/privacy/admin/requests', 'PATCH /api/privacy/admin/requests/:id', 'GET /api/privacy/admin/declarations'] },
  { key: 'admin.circulars', area: 'Administration', kind: 'content', label: 'Publish public circulars',
    does: 'Circulars and statutory disclosures on the public website.',
    routes: ['GET /api/circulars/admin', 'POST /api/circulars/admin', 'PUT /api/circulars/admin/:id', 'POST /api/circulars/admin/:id/pin',
      'POST /api/circulars/admin/:id/toggle-active', 'DELETE /api/circulars/admin/:id'], pages: ['/admin/circulars'] },

  // ── Oversight ─────────────────────────────────────────────────────────────
  { key: 'audit.trail', area: 'Oversight', kind: 'view', label: 'Read the audit trail',
    does: 'Every recorded action, its export and the integrity check of the chain.',
    routes: ['GET /api/audit-logs/**', 'POST /api/audit-logs/verify-integrity'], pages: ['/audit-logs'] },
  { key: 'exec.consolidated', area: 'Oversight', kind: 'view', label: 'See the consolidated dashboard',
    does: 'The cross-vertical executive view.',
    routes: ['GET /api/dashboard/consolidated'] },
  { key: 'reports.view', area: 'Oversight', kind: 'view', label: 'Run reports',
    does: 'The MIS and statutory reports.',
    routes: ['GET /api/reports/**'] },

  // ── The other desks, whole ───────────────────────────────────────────────
  { key: 'trading.view', area: 'Power trading', desk: 'TRADING', kind: 'view', label: 'See the power trading desk',
    does: 'Bids, exchange and bilateral contracts, clients, market data and trading bills.',
    routes: under('GET', TRADING_PREFIXES), pages: ['/trading/**', '/erp/**'] },
  { key: 'trading.work', area: 'Power trading', desk: 'TRADING', kind: 'prepare', sod: 'TRADING', label: 'Work the power trading desk',
    does: 'Everything the trading desk enters: bids, contracts, schedules, clients, bills and settlement.',
    routes: under('WRITE', TRADING_PREFIXES) },
  { key: 'hydro.view', area: 'Hydro billing', desk: 'HYDRO', kind: 'view', label: 'See hydro billing',
    does: 'Stations, PAF, allocations, bills, ledgers and claims.',
    routes: under('GET', ['/api/hydro-billing', '/api/hydro-desk']), pages: ['/hydro-thermal', '/hydro-thermal/**'] },
  { key: 'hydro.work', area: 'Hydro billing', desk: 'HYDRO', kind: 'prepare', sod: 'HYDRO', label: 'Work hydro billing',
    does: 'Station billing, allocations, PTC bills, claims and desk operations.',
    routes: under('WRITE', ['/api/hydro-billing', '/api/hydro-desk']) },
  { key: 'thermal.view', area: 'Thermal billing', desk: 'THERMAL', kind: 'view', label: 'See thermal billing',
    does: 'Thermal stations, stakeholders and bills.',
    routes: under('GET', ['/api/thermal']), pages: ['/thermal', '/thermal/**'] },
  { key: 'thermal.work', area: 'Thermal billing', desk: 'THERMAL', kind: 'prepare', sod: 'THERMAL', label: 'Work thermal billing',
    does: 'Thermal station data and billing.',
    routes: under('WRITE', ['/api/thermal']) },
];
const BY_KEY = new Map(POWERS.map((p) => [p.key, p]));
export const powerOf = (key) => BY_KEY.get(key) || null;

/*
 * For a role given a power its own role does not have: the role whose code
 * runs the power's actions (owner), the role its screens are drawn for
 * (seenAs — a read-only view is drawn as the auditor's, so no button offers
 * what the role cannot do), the screens that holds on, and the power without
 * which it cannot be used (needs: a bill cannot be approved by someone who
 * cannot open the bills).
 */
const TIER_OWNER = { prepare: 'REIA_MAKER', check: 'REIA_CHECKER', approve: 'REIA_APPROVER' };
const DESK_OWNER = { TRADING: 'TRADING_USER', HYDRO: 'COMMERCIAL_ADMIN', THERMAL: 'THERMAL_USER' };
const SCREENS = {
  'reia.contracts.prepare': ['/reia/contracts'], 'reia.contracts.hold': ['/reia/contracts'],
  'reia.energy.prepare': ['/reia/energy-data'], 'reia.energy.check': ['/reia/energy-data'],
  'reia.banking.prepare': ['/reia/energy-banking'], 'reia.banking.settle': ['/reia/energy-banking'],
  'reia.diversion.prepare': ['/reia/power-diversion'],
  'reia.invoice.prepare': ['/reia/invoices', '/reia/verification', '/reia/billing-readiness'],
  'reia.invoice.check': ['/reia/invoices', '/reia/verification'],
  'reia.notes.prepare': ['/reia/invoices'], 'reia.notes.check': ['/reia/note-approvals'],
  'reia.disputes.raise': ['/reia/disputes'], 'reia.disputes.assign': ['/reia/disputes'], 'reia.disputes.decide': ['/reia/disputes'],
  'reia.security.prepare': ['/reia/payment-security'], 'reia.security.check': ['/reia/payment-security'],
  'reia.security.override': ['/reia/payment-security'],
  'reia.recon.prepare': ['/reia/reconciliation'], 'reia.recon.check': ['/reia/reconciliation'],
  'cerc.formiv.prepare': ['/reia/form-iv'], 'cerc.formiv.file': ['/reia/form-iv'],
};
const VIEW_OWNER = { 'reia.view': 'REIA_CHECKER', 'masters.view': 'MANAGEMENT', 'audit.trail': 'COMPLIANCE_AUDITOR', 'exec.consolidated': 'MANAGEMENT', 'reports.view': 'MANAGEMENT' };
export function ownerOf(p) {
  if (p.actsAs) return p.actsAs;
  if (p.desk) return DESK_OWNER[p.desk];
  if (p.kind === 'view') return VIEW_OWNER[p.key] || 'MANAGEMENT';
  if (p.kind === 'finance') return 'FINANCE_USER';
  if (p.sod === 'REIA' && TIER_OWNER[p.kind]) return TIER_OWNER[p.kind];
  return ADMINS[1];
}
const seenAs = (p) => (p.kind === 'view' && !['exec.consolidated', 'reports.view'].includes(p.key) ? 'COMPLIANCE_AUDITOR' : ownerOf(p));
const screensOf = (p) => SCREENS[p.key] || p.pages || [];
const VIEW_OF_DESK = { TRADING: 'trading.view', HYDRO: 'hydro.view', THERMAL: 'thermal.view' };
export function needsOf(p) {
  if (p.kind === 'view' || p.kind === 'governance') return [];
  if (p.sod === 'REIA') return ['reia.view'];
  if (p.desk) return [VIEW_OF_DESK[p.desk]];
  return [];
}

// ── The routes each power covers, read from the running app ────────────────

let appRef = null;
let index = null;
/** Given the app once its routers are mounted (server.js); the index is built on first use. */
export function attachApp(app) {
  appRef = app;
  index = null;
}

function selects(selector, r) {
  const [method, path] = selector.split(' ');
  const methodOk = method === 'WRITE' ? r.method !== 'GET' : r.method === method;
  if (!methodOk) return false;
  if (!path.endsWith('/**')) return r.path === path;
  const prefix = path.slice(0, -3);
  return r.path === prefix || r.path.startsWith(`${prefix}/`);
}

function buildIndex() {
  if (!appRef) return { routes: [], byPower: new Map(), missing: [] };
  const routes = routeInventory(appRef).map((r) => ({ ...r, powers: [] }));
  const byPower = new Map();
  const missing = [];
  for (const p of POWERS) {
    const mine = [];
    for (const sel of p.routes) {
      const hits = routes.filter((r) => selects(sel, r));
      // A prefix may hold no route of one method; a route named exactly must exist.
      if (!hits.length && !sel.endsWith('/**')) missing.push(`${p.key}: ${sel}`);
      for (const r of hits) if (!mine.includes(r)) mine.push(r);
    }
    for (const r of mine) r.powers.push(p.key);
    byPower.set(p.key, mine);
  }
  return { routes, byPower, missing };
}
const idx = () => {
  if (!index) index = buildIndex();
  return index;
};
/** The routes a power covers, and any of its selectors that name no route (the tests read this). */
export const routesOf = (key) => idx().byPower.get(key) || [];
export const unmatchedSelectors = () => idx().missing;

/** The route Express will serve a request with: the first in its own order that matches. */
function routeFor(req) {
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  return idx().routes.find((r) => r.method === method && r.pattern.test(path)) || null;
}

// ── Overrides ────────────────────────────────────────────────────────────────

let cache = null; // role → Map(power → { effect, … })
function overrides() {
  if (cache) return cache;
  cache = new Map();
  try {
    for (const o of db.prepare('SELECT * FROM role_power_overrides').all()) {
      if (!cache.has(o.role)) cache.set(o.role, new Map());
      cache.get(o.role).set(o.power_key, o);
    }
  } catch { /* a database without the table yet */ }
  return cache;
}
export const forgetOverrides = () => { cache = null; };
export const overrideOf = (key, role) => overrides().get(role)?.get(key) || null;
/** For a handler that decides by role inside: has an administrator given this role the power? */
export const hasGrant = (role, key) => overrideOf(key, role)?.effect === 'GRANT';

/** Whether an override settles this request for this role: 'GRANT', 'REVOKE' (with the power), or null. */
function verdict(req, role) {
  const mine = overrides().get(role);
  if (!mine || !mine.size) return null;
  const route = routeFor(req);
  if (!route || !route.powers.length) return null;
  const effects = route.powers.map((k) => [k, mine.get(k)?.effect]).filter(([, e]) => e);
  if (effects.some(([, e]) => e === 'GRANT')) return { effect: 'GRANT' };
  const revoked = effects.find(([, e]) => e === 'REVOKE');
  return revoked ? { effect: 'REVOKE', power: powerOf(revoked[0]) } : null;
}
/** requireRole asks this before refusing: has an administrator given this role the power? */
export function grantedPower(req, role) {
  try { return verdict(req, role)?.effect === 'GRANT'; } catch { return false; }
}
/** The power an administrator took from this role that this request needs, if any. */
export function revokedPower(req, role) {
  try {
    const v = verdict(req, role);
    return v?.effect === 'REVOKE' ? v.power : null;
  } catch { return null; }
}

// ── Roles an administrator made ─────────────────────────────────────────────

export const isCustomRole = (role) => /^CUSTOM_/.test(String(role || ''));
/** The platform's roles a made role may work like: any but the administrators, who govern and do not transact. */
export const ROLE_BASES = POWER_ROLES.filter((r) => !ADMINS.includes(r));

let customCache = null; // code → row, every status
function customs() {
  if (customCache) return customCache;
  customCache = new Map();
  try {
    for (const c of db.prepare('SELECT * FROM custom_roles ORDER BY created_at, code').all()) customCache.set(c.code, c);
  } catch { /* a database without the table yet */ }
  return customCache;
}
export const forgetCustomRoles = () => { customCache = null; };
export const customRole = (code) => customs().get(code) || null;
/** The made roles in use, oldest first. */
export const customRoles = () => [...customs().values()].filter((c) => c.status === 'ACTIVE');
/** Every role the matrix shows: the platform's, then the ones administrators made. */
export const matrixRoles = () => [...POWER_ROLES, ...customRoles().map((c) => c.code)];
/** The role a role works like: a made role's base, any other role itself. */
export const baseOf = (role) => (isCustomRole(role) ? customRole(role)?.base_role || null : role);

// ── Who holds what ───────────────────────────────────────────────────────────

/** 'all', 'some' or 'none' of a power's actions, as the code grants them. */
export function defaultHolding(key, role) {
  // A made role starts with what its base has.
  if (isCustomRole(role)) {
    const base = baseOf(role);
    return base ? defaultHolding(key, base) : 'none';
  }
  const p = powerOf(key);
  if (p.holders) return p.holders.includes(role) ? 'all' : 'none';
  const gated = routesOf(key).filter((r) => r.roles);
  if (!gated.length) return 'none';
  const n = gated.filter((r) => r.roles.includes(role)).length;
  return n === gated.length ? 'all' : n ? 'some' : 'none';
}
export function holding(key, role) {
  const o = overrideOf(key, role);
  if (o) return o.effect === 'GRANT' ? 'all' : 'none';
  return defaultHolding(key, role);
}
const holds = (key, role) => holding(key, role) !== 'none';

/**
 * For a role an administrator has changed: each power that lists pages, with
 * whether the role holds it and whether it was given. The portal shows a page
 * when a power covering it was given, or when the role's menu has it and some
 * power covering it is still held (frontend/src/lib/rolePages.js). Null for a
 * role nobody has changed, whose menu stays as the code has it.
 */
export function pagesFor(role) {
  const mine = overrides().get(role);
  if (!mine || !mine.size) return null;
  return POWERS.filter((p) => p.pages?.length)
    .map((p) => ({ pages: p.pages, held: holds(p.key, role), given: mine.get(p.key)?.effect === 'GRANT' }));
}

/**
 * The screens of each power a role was given that its own role does not hold
 * at all, and the role to draw them as. `except` is what the role's own powers
 * draw: where one of those names a page more closely (Finance's own screen
 * under /reia/**), the page stays the role's own (frontend lib/rolePages.js,
 * screenRole). Exact addresses first. Empty for a role with nothing given.
 */
export function screensFor(role) {
  const mine = overrides().get(role);
  if (!mine || !mine.size) return [];
  const own = (p) => defaultHolding(p.key, role) !== 'none' && mine.get(p.key)?.effect !== 'REVOKE';
  const except = [...new Set(POWERS.filter(own).flatMap(screensOf))];
  const out = [];
  for (const p of POWERS) {
    if (mine.get(p.key)?.effect !== 'GRANT' || defaultHolding(p.key, role) !== 'none') continue;
    const pages = screensOf(p);
    if (pages.length) out.push({ pages, except, role: seenAs(p), power: p.key });
  }
  const wild = (e) => e.pages.every((x) => x.endsWith('/**'));
  return [...out.filter((e) => !wild(e)), ...out.filter(wild)];
}

/**
 * The role a request runs as. A made role works as its base; any role given a
 * power its own gates do not admit works, for that power's actions, as the
 * power's owner (or another role the action's gate admits), so the checks the
 * code makes by role inside the action pass for it as they do for the owner.
 */
export function actingRole(req, held) {
  const persona = baseOf(held) || held;
  try {
    const mine = overrides().get(held);
    if (!mine?.size) return persona;
    const route = routeFor(req);
    if (!route?.powers.length || route.roles?.includes(persona)) return persona;
    const given = route.powers.find((k) => mine.get(k)?.effect === 'GRANT');
    if (!given) return persona;
    const owner = ownerOf(powerOf(given));
    if (!route.roles || route.roles.includes(owner)) return owner;
    return route.roles.find((r) => !ADMINS.includes(r) && r !== 'COMPLIANCE_AUDITOR') || route.roles[0];
  } catch {
    return persona;
  }
}

// ── What may be changed ──────────────────────────────────────────────────────

const label = (role, roleLabels) => roleLabels?.[role] || customRole(role)?.label || role.replace(/_/g, ' ').toLowerCase();
const SOD_KINDS = Object.keys(SOD_VERB);

/**
 * Why `role` may not be given power `p`, or null. `has` says whether the role
 * holds a power (now, or in the combination a role is being made with); its
 * base decides what kind of role it is.
 */
function giveBlock(p, role, has, roleLabels) {
  const base = baseOf(role);
  const made = isCustomRole(role);
  const who = label(role, roleLabels);
  if (p.holders) return 'This power is decided inside its own screens, so it can be taken away here but not given';
  if (base === 'COMPLIANCE_AUDITOR' && p.kind !== 'view') return `${made ? `${who} works like Compliance / Audit, which` : 'Compliance / Audit'} reads everything and changes nothing`;
  if (ADMINS.includes(base) && TRANSACTION.includes(p.kind)) return 'The administrators govern and take no part in transactions (Target #2 Phase B)';
  if (p.kind === 'governance' && !ADMINS.includes(role)) return 'Governance stays with the platform administrators (Target #2 Phase B)';
  if (base === 'MANAGEMENT' && p.kind === 'prepare') return `${made ? `${who} works like Management, which` : 'Management'} sanctions and does not enter data`;
  // Maker, checker and approver stay apart (Target #2 Phase B.2).
  if (p.sod && SOD_VERB[p.kind]) {
    const clash = POWERS.find((q) => q.sod === p.sod && SOD_VERB[q.kind] && q.kind !== p.kind && has(q.key));
    if (clash) return `${who} holds "${clash.label}" — one role does not both ${SOD_VERB[clash.kind]} and ${SOD_VERB[p.kind]} the same work (maker, checker and approver stay apart)`;
    // A made role does, unlisted, whatever its base does on the desk: it takes the base's side.
    if (made) {
      const sides = new Set(POWERS.filter((q) => q.sod === p.sod && SOD_VERB[q.kind] && defaultHolding(q.key, base) !== 'none').map((q) => q.kind));
      if (sides.size && !sides.has(p.kind)) {
        return `${who} works like ${label(base, roleLabels)}, which ${[...sides].map((k) => `${SOD_VERB[k]}s`).join(' and ')} on this desk — it cannot also ${SOD_VERB[p.kind]}. Make the role from one that ${SOD_VERB[p.kind]}s`;
      }
    }
  }
  const conflict = POWERS.find((q) => (p.conflicts?.includes(q.key) || q.conflicts?.includes(p.key)) && has(q.key));
  if (conflict) return `${who} holds "${conflict.label}" — the desk that raises a bill does not confirm it was paid`;
  const missing = needsOf(p).find((k) => !has(k));
  if (missing) return `It needs "${powerOf(missing).label}" too — without it the role cannot open the screens this power works from`;
  return null;
}

/**
 * Why `editor` may not give (give = true) or take away the power from `role`,
 * or null when the change is allowed.
 */
export function changeBlock(editor, key, role, give, roleLabels = {}) {
  const p = powerOf(key);
  if (!p) return 'There is no such power';
  if (!matrixRoles().includes(role)) return 'There is no such role';
  if (!EDITORS.includes(editor)) return 'Only a platform administrator changes role powers';
  if (p.fixed) return p.fixed;
  if (role === editor) return 'Nobody changes their own role\'s powers — another administrator has to';
  if (role === 'IT_SUPER_ADMIN') return 'The IT Super Administrator\'s powers are not changed from this screen';
  const now = holding(key, role);
  if (give) {
    if (now === 'all') return `${label(role, roleLabels)} already holds this power`;
    return giveBlock(p, role, (k) => holds(k, role), roleLabels);
  }
  if (now === 'none') return `${label(role, roleLabels)} does not hold this power`;
  // A power taken from its last holder is a power nobody can use (tests/roleMatrix.test.js).
  // Only the platform's own roles count: a made role can be retired at any time.
  const others = POWER_ROLES.filter((r) => r !== role && holding(key, r) === 'all' && !(TRANSACTION.includes(p.kind) && ADMINS.includes(r)));
  if (!others.length) return 'No other role holds all of this power — give it to another role first';
  return null;
}

/**
 * What stands in the way of making a role that works like `base` and holds
 * `keys` (of the powers `shown` — others stay as the base has them). Each
 * power given beyond the base is held to the rules a single change is.
 */
export function newRoleProblems({ base, keys, shown, roleLabels = {} }) {
  if (!ROLE_BASES.includes(base)) return [{ power: null, why: 'Choose the role it works like' }];
  const want = new Set(keys);
  const inScope = new Set(shown);
  const has = (k) => (inScope.has(k) ? want.has(k) : defaultHolding(k, base) !== 'none');
  const problems = [];
  for (const k of want) if (!powerOf(k) || !inScope.has(k)) problems.push({ power: k, why: 'There is no such power' });
  if (![...want].length) problems.push({ power: null, why: 'Tick at least one power' });
  // giveBlock reads the role's base; a role not yet made is described by a stand-in.
  const probe = { code: 'CUSTOM__NEW', label: 'The new role', base_role: base, status: 'PROBE' };
  const saved = customs().get(probe.code);
  customs().set(probe.code, probe);
  try {
    for (const p of POWERS) {
      if (!inScope.has(p.key)) continue;
      const before = defaultHolding(p.key, base);
      if (want.has(p.key) && before === 'none') {
        const why = giveBlock(p, probe.code, has, { ...roleLabels, [probe.code]: probe.label });
        if (why) problems.push({ power: p.key, why });
      } else if (!want.has(p.key) && before !== 'none' && p.fixed) {
        problems.push({ power: p.key, why: p.fixed });
      }
    }
  } finally {
    if (saved) customs().set(probe.code, saved); else customs().delete(probe.code);
  }
  return problems;
}

const slug = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'ROLE';

/**
 * Make a role. Its differences from the base are written as overrides, so the
 * matrix, the gates and the history treat it as any other role. Returns its
 * code and the powers given and taken against the base.
 */
export function createCustomRole({ label: name, description, base, keys, shown, reason, reference, by }) {
  let code = `CUSTOM_${slug(name)}`;
  for (let n = 2; customRole(code); n += 1) code = `CUSTOM_${slug(name).slice(0, 27)}_${n}`;
  db.prepare(`
    INSERT INTO custom_roles (code, label, description, base_role, reason, reference, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(code, name, description, base, reason, reference || null, by);
  forgetCustomRoles();
  const want = new Set(keys);
  const given = [];
  const taken = [];
  const put = db.prepare(`
    INSERT INTO role_power_overrides (power_key, role, effect, reason, reference, changed_by, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  for (const k of shown) {
    const before = defaultHolding(k, base);
    if (want.has(k) && before === 'none') { put.run(k, code, 'GRANT', reason, reference || null, by); given.push(k); }
    if (!want.has(k) && before !== 'none') { put.run(k, code, 'REVOKE', reason, reference || null, by); taken.push(k); }
  }
  forgetOverrides();
  return { code, given, taken };
}

/** Rename a made role or say again what it is for. */
export function updateCustomRole(code, { label: name, description, by }) {
  db.prepare(`UPDATE custom_roles SET label = ?, description = ?, updated_by = ?, updated_at = datetime('now') WHERE code = ?`)
    .run(name, description, by, code);
  forgetCustomRoles();
}

/** Retire a made role nobody holds any longer. Its overrides stay, for the history. */
export function retireCustomRole(code, { reason, by }) {
  db.prepare(`UPDATE custom_roles SET status = 'RETIRED', retired_by = ?, retired_at = datetime('now'), retired_reason = ? WHERE code = ?`)
    .run(by, reason, code);
  forgetCustomRoles();
}

// ── Recording a change ───────────────────────────────────────────────────────

/**
 * Give or take away a power. The override is dropped when the change brings the
 * role back to what the code grants it, so "changed" always means "differs".
 * Returns the state before and after.
 */
export function applyChange({ key, role, give, reason, reference, by }) {
  const before = holding(key, role);
  const def = defaultHolding(key, role);
  const target = give ? 'all' : 'none';
  if (def === target) {
    db.prepare('DELETE FROM role_power_overrides WHERE power_key = ? AND role = ?').run(key, role);
  } else {
    db.prepare(`
      INSERT INTO role_power_overrides (power_key, role, effect, reason, reference, changed_by, changed_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(power_key, role) DO UPDATE SET effect = excluded.effect, reason = excluded.reason,
        reference = excluded.reference, changed_by = excluded.changed_by, changed_at = excluded.changed_at
    `).run(key, role, give ? 'GRANT' : 'REVOKE', reason, reference || null, by);
  }
  forgetOverrides();
  return { before, after: holding(key, role), default: def };
}
