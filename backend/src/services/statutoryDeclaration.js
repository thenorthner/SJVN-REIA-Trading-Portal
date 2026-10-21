import db from '../db/index.js';
import { newId, logAudit } from '../util.js';
import { getParam } from '../mastersService.js';

/**
 * Statutory declaration on critical submissions (GIGW 3.0 / maker–checker–
 * approver). The screen asks the user to accept the declaration and sends the
 * accepted version in `X-Statutory-Declaration`; this records it — user, server
 * time, IP, request — and, while `statutory_declaration_enforced` is 1, refuses
 * a critical request that arrives without it.
 *
 * The same list drives the screen (it is served in /api/public/site-info), so
 * the two never disagree about which actions need a declaration.
 */
const ID = '[^/]+';
export const DECLARATION_ENDPOINTS = [
  { method: 'POST', pattern: `^/api/bids/${ID}/(submit|approve)$`, label: 'Exchange bid submission / approval' },
  { method: 'POST', pattern: `^/api/rec-trading/bids/${ID}/approve$`, label: 'REC bid approval' },
  { method: 'POST', pattern: `^/api/invoices/${ID}/(submit-for-approval|submit-l2|approve-l2|release-to-generator|send)$`, label: 'Invoice submission / approval / release' },
  { method: 'POST', pattern: `^/api/invoices/${ID}/approvals/${ID}/act$`, label: 'Invoice approval decision' },
  { method: 'POST', pattern: `^/api/contracts/${ID}/(status|amend)$`, label: 'Contract status change / amendment' },
  { method: 'POST', pattern: `^/api/deviation/${ID}/dispatch$`, label: 'Deviation settlement dispatch' },
  { method: 'POST', pattern: `^/api/payment-security/${ID}/(verify|invoke|release-request)$`, label: 'Payment security (LC / BG) verification, invocation or release' },
  { method: 'POST', pattern: `^/api/payment-security/releases/${ID}/(act|finance-signoff)$`, label: 'Payment security release approval' },
  { method: 'POST', pattern: `^/api/payment-security/invocations/${ID}/transition$`, label: 'Payment security invocation step' },
  { method: 'POST', pattern: `^/api/hydro-billing/${ID}/(approve|issue|release)$`, label: 'Station bill approval / issue' },
  { method: 'POST', pattern: `^/api/hydro-billing/notes/${ID}/approve$`, label: 'Debit / credit note approval' },
  { method: 'POST', pattern: `^/api/hydro-desk/security/${ID}/(invoke|release)$`, label: 'Station payment security invocation / release' },
  { method: 'POST', pattern: `^/api/entities/${ID}/approve$`, label: 'Counterparty onboarding (KYC) approval' },
  { method: 'POST', pattern: `^/api/(notes|trading-notes)/${ID}/approve$`, label: 'Note approval' },
  { method: 'POST', pattern: `^/api/form-iv/${ID}/submit$`, label: 'CERC Form-IV submission' },
  { method: 'POST', pattern: `^/api/recon-signoff/${ID}/sign$`, label: 'Reconciliation statement sign-off' },
  { method: 'POST', pattern: `^/api/exchange-applications/${ID}/approve$`, label: 'Exchange application approval' },
];
const COMPILED = DECLARATION_ENDPOINTS.map((d) => ({ ...d, re: new RegExp(d.pattern) }));

export function declarationVersion() {
  return String(getParam('statutory_declaration_version', 'SJVN-2026-V1') || 'SJVN-2026-V1');
}

export function matchCritical(method, path) {
  const m = String(method || '').toUpperCase();
  const p = String(path || '').split('?')[0];
  return COMPILED.find((d) => d.method === m && d.re.test(p)) || null;
}

let insert = null;
let stampOutcome = null;

/**
 * Express middleware, mounted after authentication has had its chance: it reads
 * the bearer token's user if a route's own requireAuth has not run yet, so the
 * record names the person even though this runs ahead of the routers.
 */
export function statutoryDeclarations(resolveUser) {
  return (req, res, next) => {
    const hit = matchCritical(req.method, req.originalUrl || req.url);
    if (!hit) return next();
    // Not signed in: the route's own auth check answers (401), not this.
    const user = req.user || resolveUser?.(req) || null;
    if (!user) return next();
    const given = String(req.get('X-Statutory-Declaration') || '').trim();
    const current = declarationVersion();
    const enforced = Number(getParam('statutory_declaration_enforced', 1)) === 1;

    if (!given || given !== current) {
      if (!enforced) return next();
      return res.status(428).json({
        error: given
          ? `The statutory declaration has been revised (now ${current}). Reload the page and accept the current declaration.`
          : 'This submission needs your statutory declaration. Tick the declaration and submit again.',
        code: 'DECLARATION_REQUIRED',
        declaration_version: current,
        trace_id: req.traceId,
      });
    }

    const id = newId('DCL');
    try {
      insert = insert || db.prepare(`
        INSERT INTO statutory_declarations
          (id, user_id, user_name, user_role, version, action_label, method, path, ip_address, user_agent, trace_id, client_accepted_at)
        VALUES (@id, @user_id, @user_name, @user_role, @version, @action_label, @method, @path, @ip, @ua, @trace, @client_at)
      `);
      insert.run({
        id,
        user_id: user.id || null,
        user_name: user.name || null,
        user_role: user.role || null,
        version: given,
        action_label: hit.label,
        method: req.method,
        path: String(req.originalUrl || req.url).split('?')[0],
        ip: req.ip || null,
        ua: String(req.get('User-Agent') || '').slice(0, 300),
        trace: req.traceId || null,
        client_at: String(req.get('X-Declaration-Accepted-At') || '').slice(0, 40) || null,
      });
      logAudit({
        req: { user, ip: req.ip, traceId: req.traceId },
        user,
        action: 'STATUTORY_DECLARATION',
        module: 'COMPLIANCE',
        entityType: 'declaration',
        entityId: id,
        details: { version: given, action: hit.label, path: String(req.originalUrl || req.url).split('?')[0] },
      });
    } catch (err) {
      // A declaration that cannot be recorded is not a declaration: refuse
      // rather than let the submission through unrecorded.
      console.error('[DECLARATION] could not record', err.message);
      return res.status(503).json({ error: 'The declaration could not be recorded; nothing was submitted. Try again.', trace_id: req.traceId });
    }
    res.on('finish', () => {
      try {
        stampOutcome = stampOutcome || db.prepare('UPDATE statutory_declarations SET outcome_status = ? WHERE id = ?');
        stampOutcome.run(res.statusCode, id);
      } catch { /* the declaration itself is already recorded */ }
    });
    return next();
  };
}
