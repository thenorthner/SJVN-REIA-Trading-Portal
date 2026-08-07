import db from '../db/index.js';
import { newId } from '../util.js';

// Reduce a company name to a stable match key: lowercase, drop legal-form noise
// ("m/s", "pvt", "ltd", "limited", "&"/"and"), strip trailing consumer/ref codes
// like "-13032" or "Cons.No.63869", and remove all remaining punctuation and
// spacing. So "M/s. GUJARAT ALKALIES ANDCHEMICALS LIMITED -13032" and
// "M/s Gujarat Alkalies & Chemicals Limited" both fold to "gujaratalkalieschemicals".
export function normalizeName(name) {
  if (!name) return '';
  let s = String(name).toLowerCase();
  s = s.replace(/cons\.?\s*no\.?\s*\d+/g, ' ');   // "Cons.No.63869"
  s = s.replace(/[-–]\s*\d+\b/g, ' ');            // trailing "-13032"
  s = s.replace(/\bm\/?s\b\.?/g, ' ');            // "m/s"
  s = s.replace(/\b(private|pvt|limited|ltd|company|co|corporation|corp|the)\b/g, ' ');
  s = s.replace(/&/g, ' and ');
  s = s.replace(/\band\b/g, ' ');                 // treat "and" as filler after &-expansion
  s = s.replace(/[^a-z0-9]+/g, '');               // drop all punctuation/space
  return s;
}

// Resolve a raw name to a canonical entity_id via the alias table, or null.
export function resolveEntityByName(name) {
  const norm = normalizeName(name);
  if (!norm) return null;
  const alias = db.prepare('SELECT entity_id FROM entity_aliases WHERE normalized_name = ?').get(norm);
  if (alias) return alias.entity_id;
  // Fall back to a direct match against an entity's own name.
  const entities = db.prepare('SELECT id, name FROM entities').all();
  const hit = entities.find(e => normalizeName(e.name) === norm);
  return hit ? hit.id : null;
}

// Register a spelling for an entity. Idempotent on normalized_name; if the same
// spelling already maps elsewhere it is left as-is and that mapping is returned.
export function addAlias(entityId, aliasName, source = 'MANUAL') {
  const norm = normalizeName(aliasName);
  if (!norm) return null;
  const existing = db.prepare('SELECT id, entity_id FROM entity_aliases WHERE normalized_name = ?').get(norm);
  if (existing) return existing.id;
  const id = newId('ALIAS');
  db.prepare(`
    INSERT INTO entity_aliases (id, entity_id, alias_name, normalized_name, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, entityId, aliasName, norm, source);
  return id;
}

// The four GACL spellings the ISET ledger carries, plus the seller. Seeds a
// canonical entity for each if absent, then registers every spelling as an alias.
const ALIAS_SEED = [
  {
    canonical: { name: 'Gujarat Alkalies and Chemicals Limited', short_code: 'GACL', entity_type: 'BUYER', category: 'C&I', pan_no: null },
    spellings: [
      'M/s. GUJARAT ALKALIES ANDCHEMICALS LIMITED -13032',
      'M/s Gujarat Alkalies & Chemicals Limited',
      'M/s. GUJARAT ALKALIES AND CHEMICALS LIMITED',
      'GACL NALCO Alkalies & Chemicals Pvt Ltd Cons.No.63869',
    ],
  },
  {
    canonical: { name: 'NTPC Renewable Energy Limited', short_code: 'NTPCREL', entity_type: 'SELLER', category: 'RE Generator', pan_no: null },
    spellings: [
      'NTPC Renewable Energy Limited_KPS3',
      'NTPCREL_PSS1_KPS3_S',
    ],
  },
];

export function seedEntityAliases() {
  const insertEntity = db.prepare(`
    INSERT INTO entities (id, entity_type, category, name, short_code, pan_no, status)
    VALUES (?, ?, ?, ?, ?, ?, 'APPROVED')
  `);
  const setShortCode = db.prepare('UPDATE entities SET short_code = ? WHERE id = ? AND short_code IS NULL');
  const tx = db.transaction(() => {
    for (const group of ALIAS_SEED) {
      const canonNorm = normalizeName(group.canonical.name);
      // Reuse an existing entity if one already normalizes to the canonical name.
      let entityId = null;
      for (const e of db.prepare('SELECT id, name FROM entities').all()) {
        if (normalizeName(e.name) === canonNorm) { entityId = e.id; break; }
      }
      if (!entityId) {
        entityId = newId(group.canonical.entity_type === 'SELLER' ? 'SELL' : 'BUY');
        insertEntity.run(entityId, group.canonical.entity_type, group.canonical.category, group.canonical.name,
          group.canonical.short_code || null, group.canonical.pan_no);
      } else if (group.canonical.short_code) {
        // An entity created before short codes existed still needs one.
        setShortCode.run(group.canonical.short_code, entityId);
      }
      addAlias(entityId, group.canonical.name, 'LEDGER');
      for (const sp of group.spellings) addAlias(entityId, sp, 'LEDGER');
    }
  });
  tx();
}
