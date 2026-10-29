import { describe, it, expect } from 'vitest';
import fs from 'fs';
import db from '../src/db/index.js';
import { routeInventory } from './helpers/routeInventory.js';

// "Power taken from the SJVN Admin must land with someone — never vanish."
//
// Every role-gated API action must be open to at least one working role —
// an SJVN desk or the counterparty whose action it is — other than the two
// platform administrators, unless it is listed below as
// governance that deliberately stays with them. When roles are re-cut (maker /
// checker / approver, project scope), this is what fails if an action is left
// with nobody to take it.
//
// ROLE_MATRIX_OUT=path writes the full matrix as JSON for the governance doc.

const PLATFORM_ADMINS = new Set(['SJVN_ADMIN', 'IT_SUPER_ADMIN']);

// Governance kept with the platform administrators on purpose, with why.
const ADMIN_GOVERNANCE = {
  'PATCH /api/privacy/admin/requests/:id': 'Data Protection Officer queue (DPDP Act) — governance, not a transaction',
  'POST /api/entities/:id/own-station': 'Marks an entity as an SJVN-owned station — master data',
};
// Whole areas that are governance (Target #2 Phase B): masters are the
// administrators' alone.
const ADMIN_GOVERNANCE_PREFIXES = {
  '/api/masters/': 'Masters — banks, parameters, losses, holidays, lookups, document types',
  '/api/project-scope/': 'Assigning REIA officers to projects — user administration (Target #2 Phase C)',
  '/api/delegations/': 'Recording an additional charge — user administration (Target #2 Phase D)',
};

// Where a platform administrator may still write. Everything else that changes
// data is a transaction, and the administrators take no part in transactions.
const ADMIN_MAY_WRITE = [
  [/^\/api\/masters\//, 'masters'],
  [/^\/api\/privacy\//, 'DPDP requests'],
  [/^\/api\/entities\//, 'counterparty onboarding, KYC, blacklist, regulatory catalogue — master data'],
  [/^\/api\/audit-logs\//, 'audit trail integrity check and the record of an export'],
  [/^\/api\/alerts\//, 'broadcasts, and the user\'s own alert acknowledgements and preferences'],
  [/^\/api\/communications\/broadcast$/, 'notices to counterparties'],
  [/^\/api\/circulars\/admin/, 'public circulars and statutory disclosures on the website — site content, like broadcasts'],
  [/^\/api\/project-scope\//, 'assigning REIA officers to projects — user administration'],
  [/^\/api\/delegations\//, 'recording an additional charge; approving break-glass — governance (Target #2 Phase D)'],
  [/^\/api\/notifications\//, 'mail delivery retries and the test e-mail — platform operation'],
  [/^\/api\/market-analytics\/alerts/, 'the user\'s own price alerts'],
  [/^\/api\/cerc-market\/(trigger|scan)$/, 'fetching CERC\'s published reports — a data feed, not a transaction'],
  [/\/(preview|estimate|ecr-preview|arrears\/preview|tcs\/preview|consolidate)$/, 'computes and returns figures; saves nothing'],
];

// Target #2 Phase B.2 (22-Oct-2026): on the REIA desk the maker prepares and
// the checker decides. These are the only writes left open to both, each with
// why. Two of them are split inside the handler by what is being done.
const MAKER_CHECKER_SHARED = {
  'POST /api/contracts/:id/hold': 'putting a contract on hold is a protective stop anyone on the desk (or its approver) may pull; lifting it is the approver\'s',
  'POST /api/contracts/:id/status': 'split inside: the maker moves a draft through negotiation, the checker signs, activates, terminates and closes',
  'PUT /api/entities/:id/regulatory-approvals/:approvalId': 'split inside: the maker records a clearance\'s details, the checker marks it verified, rejected or not applicable',
  'POST /api/invoices/:id/cancel': 'split inside: the maker withdraws a draft or a returned bill, the checker cancels one that is with the reviewers',
  'POST /api/invoices/:id/validate': 'runs the system\'s own comparison of a bill against the contract; it decides nothing',
  'POST /api/desk-tasks/:id/close': 'closing one\'s own desk reminder',
  'POST /api/disputes/sla/check': 'a sweep that marks overdue clocks; decides nothing',
  'POST /api/payment-security/alerts/run': 'a sweep that raises expiry alerts; decides nothing',
  'POST /api/reconciliation/run-scheduled': 'the scheduled run, on demand; produces statements for the maker to send',
  'POST /api/reconciliation/:id/regenerate-statement': 'redraws the statement document from figures already on record',
  'POST /api/communications/broadcast': 'notices to counterparties',
  'PUT /api/reports/cerc-compliance/licence/:fy': 'the licence register for the CERC filing calendar',
  'POST /api/notifications/test-email': 'the user\'s own test mail',
  'POST /api/alerts/board/ack': 'the user\'s own alert acknowledgement',
  'POST /api/alerts/board/unack': 'the user\'s own alert acknowledgement',
  'PUT /api/alerts/preferences': 'the user\'s own alert preferences',
  'POST /api/alerts/broadcasts': 'desk-wide notices on the alert board',
  'DELETE /api/alerts/broadcasts/:id': 'desk-wide notices on the alert board',
  'POST /api/audit-logs/log-export': 'records that an export was taken',
  'POST /api/sandbox/age': 'test-environment clock, not a transaction',
};

const inventory = routeInventory();
if (process.env.ROLE_MATRIX_OUT) fs.writeFileSync(process.env.ROLE_MATRIX_OUT, JSON.stringify(inventory, null, 1));

describe('role matrix', () => {
  it('reads the gates of the running app', () => {
    expect(inventory.length).toBeGreaterThan(900);
    expect(inventory.filter((r) => r.roles).length).toBeGreaterThan(600);
  });

  it('leaves no action reachable only by the platform administrators', () => {
    const orphans = inventory
      .filter((r) => r.roles && r.roles.length)
      .filter((r) => !r.roles.some((role) => !PLATFORM_ADMINS.has(role)))
      .filter((r) => !Object.keys(ADMIN_GOVERNANCE_PREFIXES).some((p) => r.path.startsWith(p)))
      .map((r) => `${r.method} ${r.path}`)
      .filter((key) => !ADMIN_GOVERNANCE[key]);
    expect(orphans).toEqual([]);
  });

  it('lets the platform administrators write nothing outside governance (Target #2 Phase B)', () => {
    const open = inventory
      .filter((r) => r.method !== 'GET' && r.roles && r.roles.some((role) => PLATFORM_ADMINS.has(role)))
      .filter((r) => !ADMIN_MAY_WRITE.some(([re]) => re.test(r.path)))
      .map((r) => `${r.method} ${r.path}`);
    expect(open).toEqual([]);
  });

  // What Target #2 says the administrators keep. Write groups built from the desks'
  // *_WRITE lists silently dropped some of these when the administrators left
  // those lists; this names them so it cannot happen unnoticed again.
  it('keeps the administrators\' governance powers', () => {
    const KEPT = [
      ['POST', '/api/masters/parameters'], ['PUT', '/api/masters/parameters/:key'], ['POST', '/api/masters/banks'],
      ['POST', '/api/entities/'], ['POST', '/api/entities/:id/approve'], ['POST', '/api/entities/:id/blacklist'],
      ['POST', '/api/alerts/broadcasts'], ['POST', '/api/communications/broadcast'],
      ['PATCH', '/api/privacy/admin/requests/:id'], ['GET', '/api/audit-logs/'],
      ['PUT', '/api/project-scope/users/:id'], ['GET', '/api/project-scope/coverage'],
    ];
    const missing = KEPT.filter(([m, p]) => {
      const r = inventory.find((x) => x.method === m && x.path === p);
      return !r || (r.roles && !r.roles.includes('SJVN_ADMIN'));
    }).map(([m, p]) => `${m} ${p}`);
    expect(missing).toEqual([]);
  });

  it('keeps the administrators reading every desk', () => {
    const reads = inventory.filter((r) => r.method === 'GET' && r.roles && r.roles.includes('SJVN_ADMIN')).length;
    expect(reads).toBeGreaterThan(300);
  });

  it('gives each REIA tier a role a user can hold, and someone at every invoice level', async () => {
    const { DEFAULT_LEVEL_ROLES } = await import('../src/routes/invoices.js');
    expect(DEFAULT_LEVEL_ROLES[1]).toContain('REIA_CHECKER');
    expect(DEFAULT_LEVEL_ROLES[3]).toEqual(expect.arrayContaining(['REIA_APPROVER', 'MANAGEMENT']));
    for (const roles of Object.values(DEFAULT_LEVEL_ROLES)) expect(roles.some((r) => !PLATFORM_ADMINS.has(r))).toBe(true);
  });

  it('keeps every governance exception pointing at a route that still exists', () => {
    const keys = new Set(inventory.map((r) => `${r.method} ${r.path}`));
    expect(Object.keys(ADMIN_GOVERNANCE).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('names only roles a user can actually hold', () => {
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get().sql;
    const valid = new Set([...ddl.matchAll(/'([A-Z_0-9]+)'/g)].map((m) => m[1]));
    const named = new Set(inventory.flatMap((r) => r.roles || []));
    expect([...named].filter((r) => !valid.has(r)).sort()).toEqual([]);
  });

  it('keeps the REIA maker and checker apart (Target #2 Phase B.2)', () => {
    const shared = inventory
      .filter((r) => r.method !== 'GET' && r.roles && r.roles.includes('REIA_MAKER') && r.roles.includes('REIA_CHECKER'))
      .map((r) => `${r.method} ${r.path}`)
      .filter((key) => !MAKER_CHECKER_SHARED[key]);
    expect(shared).toEqual([]);
  });

  it('keeps every maker/checker exception pointing at a route that still exists', () => {
    const keys = new Set(inventory.map((r) => `${r.method} ${r.path}`));
    expect(Object.keys(MAKER_CHECKER_SHARED).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('has no gate that nobody at all can pass', () => {
    expect(inventory.filter((r) => r.roles && r.roles.length === 0).map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });
});
