import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { normalizeName, resolveEntityByName, addAlias, seedEntityAliases } from '../src/services/entityResolver.js';

// Entities are left in place — other tables reference them, and the seeder is
// idempotent, so re-seeding is enough to get a known starting point.
beforeEach(() => {
  db.prepare('DELETE FROM entity_aliases').run();
  seedEntityAliases();
});

// The ledger spells GACL four different ways. Without this they would import as
// four separate customers and split the exposure between them.
const GACL_SPELLINGS = [
  'M/s. GUJARAT ALKALIES ANDCHEMICALS LIMITED -13032',
  'M/s Gujarat Alkalies & Chemicals Limited',
  'M/s. GUJARAT ALKALIES AND CHEMICALS LIMITED',
  'GACL NALCO Alkalies & Chemicals Pvt Ltd Cons.No.63869',
];

describe('resolveEntityByName', () => {
  it('resolves every GACL spelling to one entity', () => {
    const ids = GACL_SPELLINGS.map(resolveEntityByName);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(1);
  });

  it('resolves both seller spellings to one entity', () => {
    const a = resolveEntityByName('NTPCREL_PSS1_KPS3_S');
    const b = resolveEntityByName('NTPC Renewable Energy Limited_KPS3');
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it('resolves an unseen but clean spelling', () => {
    expect(resolveEntityByName('Gujarat Alkalies Chemicals')).toBe(resolveEntityByName(GACL_SPELLINGS[0]));
  });

  it('returns null for a genuinely unknown counterparty', () => {
    expect(resolveEntityByName('Some Unlisted Buyer Pvt Ltd')).toBeNull();
  });

  it('does not confuse two different companies', () => {
    const gacl = resolveEntityByName(GACL_SPELLINGS[0]);
    const other = resolveEntityByName('NTPCREL_PSS1_KPS3_S');
    expect(gacl).not.toBe(other);
  });
});

describe('normalizeName', () => {
  it('strips legal form, honorifics and trailing consumer codes', () => {
    expect(normalizeName('M/s. ACME POWER LIMITED -13032')).toBe(normalizeName('Acme Power'));
    expect(normalizeName('Acme Power Pvt Ltd')).toBe(normalizeName('Acme Power'));
    expect(normalizeName('Acme Power Cons.No.63869')).toBe(normalizeName('Acme Power'));
  });

  it('treats & and "and" alike', () => {
    expect(normalizeName('Alpha & Beta')).toBe(normalizeName('Alpha and Beta'));
  });

  it('is empty for nothing', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName(null)).toBe('');
  });
});

describe('addAlias', () => {
  it('is idempotent on the same spelling', () => {
    const id = resolveEntityByName(GACL_SPELLINGS[0]);
    const before = db.prepare('SELECT COUNT(*) c FROM entity_aliases').get().c;
    addAlias(id, GACL_SPELLINGS[0]);
    expect(db.prepare('SELECT COUNT(*) c FROM entity_aliases').get().c).toBe(before);
  });

  it('makes a new spelling resolve', () => {
    const id = resolveEntityByName(GACL_SPELLINGS[0]);
    addAlias(id, 'GACL Baroda Works');
    expect(resolveEntityByName('GACL Baroda Works')).toBe(id);
  });
});
