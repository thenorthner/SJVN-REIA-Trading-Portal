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
  [/^\/api\/project-scope\//, 'assigning REIA officers to projects — user administration'],
  [/^\/api\/delegations\//, 'recording an additional charge; approving break-glass — governance (Target #2 Phase D)'],
  [/^\/api\/notifications\//, 'mail delivery retries and the test e-mail — platform operation'],
  [/^\/api\/market-analytics\/alerts/, 'the user\'s own price alerts'],
  [/^\/api\/cerc-market\/(trigger|scan)$/, 'fetching CERC\'s published reports — a data feed, not a transaction'],
  [/\/(preview|estimate|ecr-preview|arrears\/preview|tcs\/preview|consolidate)$/, 'computes and returns figures; saves nothing'],
];

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

  it('has no gate that nobody at all can pass', () => {
    expect(inventory.filter((r) => r.roles && r.roles.length === 0).map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });
});
