import { describe, it, expect } from 'vitest';
import { ROLE_GROUPS as API } from '../src/middleware/auth.js';
import { ROLE_GROUPS as UI } from '../../frontend/src/roles.js';

// The frontend decides what to show; the API decides what is allowed. For the
// groups both of them define, the two have to name the same roles, or a user
// is either shown screens that answer 403 or allowed things the menu never
// offers them. Both had drifted: the UI offered IT_SUPER_ADMIN the trading desk
// the API refused it, and hid the REIA module from REIA_ADMIN, whom it allowed.
const SHARED = ['REIA_ALL', 'REIA_WRITE', 'TRADING_ALL', 'TRADING_WRITE', 'EXECUTIVE', 'AUDITOR'];

describe('role groups', () => {
  it.each(SHARED)('%s names the same roles in the UI as in the API', (key) => {
    expect([...UI[key]].sort()).toEqual([...API[key]].sort());
  });
});
