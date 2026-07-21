/**
 * Audit Trail presentation helpers.
 *
 * The raw audit_logs rows are machine-shaped (JSON blobs, snake_case keys,
 * opaque IDs). Everything here exists to turn one row into something a human
 * can scan in under a second, and to keep the noisy parts (full payloads,
 * hash chain) out of the default view.
 */
import { fmtTime, localDayKey, relativeDayLabel } from './datetime.js';

/** action -> { label, tone, icon }. Tone maps to the Badge colour palette. */
export const ACTION_META = {
  CREATE: { label: 'Created', tone: 'blue', icon: '＋' },
  UPDATE: { label: 'Updated', tone: 'amber', icon: '✎' },
  DELETE: { label: 'Deleted', tone: 'red', icon: '✕' },
  LOGIN: { label: 'Signed in', tone: 'gray', icon: '→' },
  LOGOUT: { label: 'Signed out', tone: 'gray', icon: '←' },
  GENERATE: { label: 'Generated', tone: 'blue', icon: '⚙' },
  VALIDATE: { label: 'Validated', tone: 'green', icon: '✓' },
  LOCK: { label: 'Locked', tone: 'green', icon: '🔒' },
  SUBMIT: { label: 'Submitted', tone: 'blue', icon: '↑' },
  SUBMIT_FOR_APPROVAL: { label: 'Sent for approval', tone: 'amber', icon: '↑' },
  APPROVAL_APPROVED: { label: 'Approved', tone: 'green', icon: '✓' },
  APPROVAL_REJECTED: { label: 'Rejected', tone: 'red', icon: '✕' },
  SEND: { label: 'Dispatched', tone: 'blue', icon: '✈' },
  PAYMENT_RECORDED: { label: 'Payment recorded', tone: 'green', icon: '₹' },
  RECONCILIATION_RUN: { label: 'Reconciliation run', tone: 'blue', icon: '⟳' },
  RECON_OVERRIDE: { label: 'Variance overridden', tone: 'amber', icon: '!' },
  DISPUTE_RAISED: { label: 'Dispute raised', tone: 'red', icon: '⚠' },
  DISPUTE_RESOLVED: { label: 'Dispute resolved', tone: 'green', icon: '✓' },
  DISPUTE_ASSIGNED: { label: 'Dispute assigned', tone: 'blue', icon: '👤' },
  INVOKE: { label: 'Security invoked', tone: 'red', icon: '⚡' },
  INVOKE_WATERFALL: { label: 'Waterfall invoked', tone: 'red', icon: '⚡' },
  RENEW: { label: 'Renewed', tone: 'green', icon: '⟳' },
  SECURITY_OVERRIDE: { label: 'Adequacy overridden', tone: 'amber', icon: '!' },
  AMEND: { label: 'Amended', tone: 'amber', icon: '✎' },
  BULK_UPLOAD: { label: 'Bulk uploaded', tone: 'blue', icon: '⇪' },
  DATA_EXPORT: { label: 'Data exported', tone: 'amber', icon: '⇩' },
  INTEGRITY_CHECK: { label: 'Integrity checked', tone: 'gray', icon: '🛡' },
  PENNY_DROP_VERIFIED: { label: 'Bank verified', tone: 'green', icon: '✓' },
  REA_TRIGGER: { label: 'REA fetch triggered', tone: 'blue', icon: '⇩' },
};

export const MODULE_LABELS = {
  AUTH: 'Authentication',
  REIA: 'REIA Billing & Settlement',
  TRADING: 'Power Trading',
  SYSTEM: 'System',
};

export const ENTITY_LABELS = {
  energy_data: 'energy record',
  invoice: 'invoice',
  entity: 'stakeholder',
  contract: 'contract',
  dispute: 'dispute',
  reconciliation: 'reconciliation',
  payment_security: 'security instrument',
  security_invocation: 'invocation',
  user: 'user',
  document: 'document',
  rea_fetch_log: 'REA fetch',
};

export function actionMeta(action) {
  return ACTION_META[action] || { label: humanize(action), tone: 'gray', icon: '•' };
}

export function moduleLabel(m) {
  return MODULE_LABELS[m] || m || '—';
}

export function entityLabel(t) {
  return ENTITY_LABELS[t] || humanize(t || '').toLowerCase();
}

/** snake_case / SCREAMING_CASE -> "Sentence case" */
export function humanize(key = '') {
  return String(key)
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

/** Render any JSON value as a short readable string. */
export function formatValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (Array.isArray(v)) return v.length ? `${v.length} item(s)` : '—';
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    return keys.length ? `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''}}` : '—';
  }
  const s = String(v);
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

export function safeParse(json) {
  if (!json) return null;
  if (typeof json === 'object') return json;
  try {
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

/**
 * Compare before/after payloads and return ONLY the fields that actually
 * changed. Showing all ~30 invoice columns when two of them moved is the main
 * reason the old screen was unreadable.
 */
export function computeDiff(beforeRaw, afterRaw) {
  const before = safeParse(beforeRaw) || {};
  const after = safeParse(afterRaw) || {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];

  return keys
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ field: k, label: humanize(k), from: before[k], to: after[k] }));
}

// Keys that add noise rather than meaning in the collapsed view.
const NOISY_KEYS = new Set(['id', 'created_by', 'created_at', 'updated_at', 'password', 'password_hash']);

// Fields worth surfacing first, per entity type, when there is no before/after
// diff to show (most rows only carry a `details` payload).
const HIGHLIGHT_KEYS = [
  'invoice_no', 'contract_no', 'dispute_no', 'recon_no', 'instrument_no', 'name', 'title',
  'period', 'billing_period', 'period_month', 'contract_id', 'entity_id',
  'total_amount', 'amount', 'disputed_amount', 'energy_mwh', 'tariff_per_unit',
  'status', 'outcome', 'decision', 'reason_code', 'data_type', 'source',
  'triggerType', 'scope', 'rpc', 'module', 'level', 'assigned_to',
];

/**
 * Pick the handful of fields worth showing inline for a payload, in a stable,
 * meaningful order. Everything else stays behind "View full record".
 */
export function summarizeDetails(detailsRaw, limit = 6) {
  const details = safeParse(detailsRaw);
  if (!details || typeof details !== 'object') return [];

  const entries = Object.entries(details).filter(
    ([k, v]) => !NOISY_KEYS.has(k) && v !== null && v !== undefined && v !== '' && v !== 0
  );

  const rank = (k) => {
    const i = HIGHLIGHT_KEYS.indexOf(k);
    return i === -1 ? HIGHLIGHT_KEYS.length : i;
  };

  return entries
    .sort(([a], [b]) => rank(a) - rank(b))
    .slice(0, limit)
    .map(([k, v]) => ({ field: k, label: humanize(k), value: v }));
}

export function detailsFieldCount(detailsRaw) {
  const d = safeParse(detailsRaw);
  return d && typeof d === 'object' ? Object.keys(d).length : 0;
}

/**
 * One-line, human-readable description of an event.
 * e.g. "Created energy record ENG-1a2b" / "Signed in"
 */
export function describeEvent(log) {
  const { label } = actionMeta(log.action);
  const entity = log.entity_type ? entityLabel(log.entity_type) : '';
  const details = safeParse(log.details) || {};

  const ref =
    details.invoice_no || details.dispute_no || details.recon_no ||
    details.contract_no || details.instrument_no || details.name ||
    details.title || log.entity_id || '';

  if (log.action === 'LOGIN' || log.action === 'LOGOUT') return label;
  if (!entity) return ref ? `${label} ${ref}` : label;
  // Skip the entity noun when the action label already says it, so we get
  // "Reconciliation run RCN/2026/7334" not "Reconciliation run reconciliation …".
  if (labelContainsEntity(label, entity)) return ref ? `${label} ${ref}` : label;
  return ref ? `${label} ${entity} ${ref}` : `${label} ${entity}`;
}

function labelContainsEntity(label, noun) {
  const l = label.toLowerCase();
  return noun.split(' ').some((w) => w.length > 3 && l.includes(w.toLowerCase()));
}

function pluralize(word, n) {
  if (n === 1) return word;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/**
 * Label for a collapsed run of identical events.
 * "Created 114 energy records" reads far better than 114 separate lines, and
 * sign-ins get their own phrasing since "18 user records" is nonsense there.
 */
export function groupSummary(group) {
  const n = group.items.length;
  const { label } = actionMeta(group.action);

  if (group.action === 'LOGIN') return `${n} sign-ins`;
  if (group.action === 'LOGOUT') return `${n} sign-outs`;
  if (!group.entity_type) return `${label} · ${n} events`;

  const noun = entityLabel(group.entity_type);
  // Avoid "Reconciliation run 5 reconciliations" — the action label already
  // names the entity in several cases.
  if (labelContainsEntity(label, noun)) return `${label} · ${n} times`;

  return `${label} ${n} ${pluralize(noun, n)}`;
}

/**
 * Date/time formatting delegates to the shared helpers, which convert the
 * UTC timestamps SQLite writes into the viewer's local timezone. Slicing the
 * raw string (as this used to do) shows UTC and groups by the UTC calendar
 * day — off by 5:30 hours for IST users.
 */
export const dayLabel = relativeDayLabel;
export const timeLabel = fmtTime;
export const dayKey = localDayKey;

/**
 * Collapse consecutive events that are the same action, entity type and actor
 * into a single row. A seeding run or a bulk REA import produces a hundred
 * identical "Created energy record" lines; as one collapsible group it reads
 * as a single fact.
 */
export function groupEvents(logs) {
  const days = [];
  let currentDay = null;

  for (const log of logs) {
    const key = dayKey(log.created_at);
    if (!currentDay || currentDay.key !== key) {
      currentDay = { key, label: dayLabel(log.created_at), groups: [] };
      days.push(currentDay);
    }

    const last = currentDay.groups[currentDay.groups.length - 1];
    const sameRun =
      last &&
      last.action === log.action &&
      last.entity_type === log.entity_type &&
      last.user_name === log.user_name &&
      last.module === log.module;

    if (sameRun) {
      last.items.push(log);
    } else {
      currentDay.groups.push({
        id: log.id,
        action: log.action,
        entity_type: log.entity_type,
        user_name: log.user_name,
        user_role: log.user_role,
        module: log.module,
        items: [log],
      });
    }
  }

  return days;
}
