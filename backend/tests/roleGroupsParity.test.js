import { describe, it, expect } from 'vitest';
import db from '../src/db/index.js';
import { ROLE_GROUPS as API } from '../src/middleware/auth.js';
import { ROLE_GROUPS as UI } from '../../frontend/src/roles.js';

// The frontend decides what to show; the API decides what is allowed; the
// database decides what can exist at all. All three have drifted apart before:
// the UI offered IT_SUPER_ADMIN the trading desk the API refused it, hid the
// REIA module from REIA_ADMIN whom the API allowed, and listed four
// trading-client sub-roles the users table would not accept.
const SHARED = ['REIA_ALL', 'REIA_WRITE', 'TRADING_ALL', 'TRADING_WRITE', 'EXECUTIVE', 'AUDITOR'];

/** The roles users.role will actually accept, read from its CHECK constraint. */
function rolesTheDatabaseAccepts() {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get().sql;
  const check = /role\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*role\s+IN\s*\(([\s\S]*?)\)\s*\)/i.exec(sql);
  if (!check) throw new Error('users.role no longer has a CHECK constraint — this test needs updating');
  return new Set([...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

describe('role groups', () => {
  it.each(SHARED)('%s names the same roles in the UI as in the API', (key) => {
    expect([...UI[key]].sort()).toEqual([...API[key]].sort());
  });

  it('names only roles the database will accept', () => {
    const allowed = rolesTheDatabaseAccepts();
    const named = new Set([...Object.values(UI).flat(), ...Object.values(API).flat()]);
    const unknown = [...named].filter((role) => !allowed.has(role)).sort();
    expect(unknown).toEqual([]);
  });
});
