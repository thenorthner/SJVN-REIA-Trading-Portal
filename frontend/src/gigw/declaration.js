import { loadSiteInfo } from './siteInfo.js';
import { translate } from './GigwContext.jsx';

/**
 * Statutory declaration on critical submissions (maker / checker / approver).
 *
 * The list of critical endpoints comes from the server (site-info), which is
 * also where the declaration is recorded and, when switched on, enforced — so
 * the screen and the server can never disagree about which actions need it.
 *
 * The API client calls `declarationFor(config)` before each request. When the
 * request is critical, the mounted <DeclarationGate /> asks the user; ticking
 * and confirming sends the request with the declaration headers, cancelling
 * rejects it without anything reaching the server.
 */
let handler = null;

export function registerDeclarationHandler(fn) {
  handler = fn;
  return () => { if (handler === fn) handler = null; };
}

function compile(list) {
  return (list || []).map((d) => ({ ...d, re: new RegExp(d.pattern) })).filter((d) => d.re);
}

let compiled = null;
async function rules() {
  if (compiled) return compiled;
  const info = await loadSiteInfo();
  if (info?.declaration) compiled = { version: info.declaration.version, list: compile(info.declaration.endpoints) };
  return compiled;
}

export class DeclarationCancelled extends Error {
  constructor(lang) {
    const msg = translate(lang || document.documentElement.lang || 'en', 'decl.cancelled');
    super(msg);
    this.name = 'DeclarationCancelled';
    this.isDeclarationCancel = true;
    // Shaped like an axios error, so screens that show err.response.data.error
    // tell the user why nothing happened.
    this.response = { status: 0, data: { error: msg } };
  }
}

/** Request interceptor body. Returns the config, with headers when declared. */
export async function applyDeclaration(config) {
  const method = String(config.method || 'get').toUpperCase();
  if (method === 'GET' || !handler || config.skipDeclaration) return config;
  // The administrators and the auditor make no desk submissions (Target #2
  // Phase B); the server refuses them with its reason, so there is nothing to
  // affirm. Counterparty onboarding is still theirs, and is still declared.
  try {
    const role = JSON.parse(localStorage.getItem('sjvn_user') || 'null')?.role;
    const onboarding = /^\/?entities\//.test(String(config.url || ''));
    if (!onboarding && ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'COMPLIANCE_AUDITOR'].includes(role)) return config;
  } catch { /* fall through and ask */ }
  const r = await rules();
  if (!r) return config;
  const url = `/api${String(config.url || '').split('?')[0]}`.replace(/^\/api\/api\//, '/api/');
  const hit = r.list.find((d) => d.method === method && d.re.test(url));
  if (!hit) return config;
  const accepted = await handler({ label: hit.label, version: r.version });
  if (!accepted) throw new DeclarationCancelled();
  config.headers = config.headers || {};
  config.headers['X-Statutory-Declaration'] = r.version;
  config.headers['X-Declaration-Accepted-At'] = accepted.at;
  return config;
}
