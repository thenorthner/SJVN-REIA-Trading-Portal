/**
 * REIA beta: what the API shows a beta tester.
 *
 * The beta build of the front end lists the REIA desk alone. The hydro and
 * thermal stations, though, sit in the same entities and contracts tables as
 * REIA's generators (they are billed through them), and the desks' users,
 * audit entries and alerts come back from shared screens. With REIA_BETA=1 in
 * the environment, every GET answer under /api loses those rows before it is
 * sent. Nothing else changes: roles, permissions and writes are as they are,
 * and with the variable unset this module does nothing.
 */
import db from '../db/index.js';

export const REIA_BETA = process.env.REIA_BETA === '1';

// Roles of the desks the beta does not show.
const OTHER_ROLE_RE = /^(TRADING|COMMERCIAL|THERMAL|HYDRO)/;
// A word naming another desk, as a whole token ("HYDRO", "Hydro billing", "TRADING_MARGIN").
const OTHER_WORD_RE = /(^|[^a-z])(hydro|thermal|trading|station|iex|pxil|hpx|bilateral)([^a-z]|$)/i;
// Fields that say which desk or kind of thing a row belongs to.
const CLASSIFIER_KEYS = new Set(['module', 'action', 'category', 'vertical', 'desk', 'scope', 'project_type', 'sector', 'station_type', 'source_module', 'what', 'type', 'event', 'event_type', 'kind', 'entity_type', 'table', 'module_name']);
// A role field of any name ("role", "user_role", "actor_role").
const ROLE_KEY_RE = /(^|_)role$/;
// Fields that open a screen, and the other desks' screens they may open.
const LINK_KEYS = new Set(['link', 'url', 'path', 'href', 'to', 'route']);
const OTHER_PATH_RE = /^\/(hydro|thermal|trading|commercial|erp|market|portfolio|cerc|cea)/;
// Text an alert carries ("Hydro bill HB/2026/000008 approved").
const TEXT_KEYS = new Set(['title', 'message', 'subject', 'body', 'summary', 'label']);
const OTHER_TEXT_RE = /\b(hydro|thermal|power trading|trading licen[cs]e|iex|pxil|hpx)\b/i;
// Sign-in names of those desks ("hydroadmin@sjvn.in" on a failed sign-in).
const NAME_KEYS = new Set(['user_name', 'username', 'email', 'entity_id']);
const OTHER_NAME_RE = /^(hydro|thermal|trading|commercial)/i;
// Master parameters only the other desks read: station billing, frequency
// response, the trading licence and the exchanges' price cap.
const OTHER_PARAM_RE = /(^|_)(hydro|thermal)(_|$)|^freq_response_|^cerc_(licen|category|min_net_worth|afc_)|^market_price_cap$|^power_regulation_/;
// Prose the beta words for REIA alone: the REIA margin is the SJVN margin (as
// the front end has it; the CERC regulation's title stays), Quick Connect is
// between SJVN, sellers and buyers, CERT-In's idle timeout is for financial
// screens, and diverted power was sold to a third party (notices sent before
// 31-Oct-2026 named the exchange).
const BETA_PROSE = [
  [/(?<!Fixation of )\b([Tt])rading ([Mm])argin/g, (_, t, m) => `SJVN ${m}argin`],
  [/,? (and|or) trading clients/g, ''],
  [/trading and banking screens/g, 'financial screens'],
  [/sold on the exchange/g, 'sold to a third party'],
];
// Fields that name an exchange (a diverted sale's platform): the beta drops them.
const MARKET_KEYS = new Set(['exchange_platform']);
const betaProse = (v) => BETA_PROSE.reduce((out, [re, to]) => out.replace(re, to), v);
// A role code of those desks, as a list entry or a key ("THERMAL_ADMIN": "Full").
const OTHER_ROLE_CODE_RE = /^(TRADING|COMMERCIAL|THERMAL|HYDRO)(_[A-Z0-9]+)*$/;

/** The station entities and contracts, by id and by the names and numbers a screen prints. */
function hiddenSets() {
  const entities = db.prepare(`
    SELECT id, name FROM entities
    WHERE COALESCE(verticals, 'REIA') NOT LIKE '%REIA%'
  `).all();
  const ids = new Set(entities.map((e) => e.id));
  const contracts = db.prepare(`
    SELECT id, contract_no, seller_id, buyer_id FROM contracts
    WHERE project_type IN ('Hydro', 'Thermal') OR seller_id IN (SELECT id FROM entities WHERE COALESCE(verticals, 'REIA') NOT LIKE '%REIA%')
       OR buyer_id IN (SELECT id FROM entities WHERE COALESCE(verticals, 'REIA') NOT LIKE '%REIA%')
  `).all();
  for (const c of contracts) ids.add(c.id);
  // The other desks' users, so their audit entries and facets go too.
  const users = db.prepare('SELECT id, role FROM users').all().filter((u) => OTHER_ROLE_RE.test(u.role || ''));
  for (const u of users) ids.add(u.id);
  // Names are matched case-blind inside longer text ("NATHPA JHAKRI HEP · PPA/SJVN/NJHPS/001").
  const words = [...entities.map((e) => e.name), ...contracts.map((c) => c.contract_no)]
    .filter((w) => w && w.length >= 6)
    .map((w) => w.toLowerCase());
  // A station is also printed without its owner's prefix ("RAMPUR HEP").
  for (const e of entities) {
    const short = String(e.name || '').replace(/^SJVN\s+/i, '');
    if (short.length >= 6) words.push(short.toLowerCase());
  }
  return { ids, words };
}

function hides(row, h) {
  for (const [k, v] of Object.entries(row)) {
    if (typeof v !== 'string' || !v) continue;
    if (h.ids.has(v)) return true;
    // A lookup or option that is another desk by name ({ code: 'Hydro' }).
    if (/^(hydro|thermal|trading|power trading)$/i.test(v)) return true;
    if (ROLE_KEY_RE.test(k) && OTHER_ROLE_RE.test(v)) return true;
    if (CLASSIFIER_KEYS.has(k) && OTHER_WORD_RE.test(v)) return true;
    if (LINK_KEYS.has(k) && OTHER_PATH_RE.test(v)) return true;
    if (TEXT_KEYS.has(k) && OTHER_TEXT_RE.test(v)) return true;
    if (NAME_KEYS.has(k) && OTHER_NAME_RE.test(v)) return true;
    if (k === 'param_key' && OTHER_PARAM_RE.test(v)) return true;
    const low = v.toLowerCase();
    if (h.words.some((w) => low.includes(w))) return true;
  }
  return false;
}

/** The body with other desks' rows taken out of every list in it, at any depth. */
export function scrub(body, h) {
  if (Array.isArray(body)) {
    return body
      .filter((x) => {
        if (typeof x === 'string') return !/^(hydro|thermal|trading)$/i.test(x) && !OTHER_ROLE_CODE_RE.test(x);
        return !(x && typeof x === 'object' && !Array.isArray(x) && hides(x, h));
      })
      .map((x) => scrub(x, h));
  }
  if (typeof body === 'string') return betaProse(body);
  if (body && typeof body === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(body)) {
      if (OTHER_ROLE_CODE_RE.test(k) || MARKET_KEYS.has(k)) continue;
      // An entity also billed by another desk is shown as REIA's alone.
      if (k === 'verticals' && typeof v === 'string') out[k] = 'REIA';
      else out[k] = v && typeof v === 'object' ? scrub(v, h) : typeof v === 'string' ? betaProse(v) : v;
    }
    return out;
  }
  return body;
}

/** Rows sent some other way than res.json (a CSV export), as the beta shows them. */
export function betaRows(rows) {
  return REIA_BETA ? scrub(rows, hiddenSets()) : rows;
}

/** Express middleware for /api: GET answers pass through scrub(). */
export function reiaBetaFilter() {
  return (req, res, next) => {
    if (!REIA_BETA || req.method !== 'GET') return next();
    const json = res.json.bind(res);
    res.json = (body) => {
      try {
        return json(scrub(body, hiddenSets()));
      } catch {
        return json(body);
      }
    };
    return next();
  };
}
